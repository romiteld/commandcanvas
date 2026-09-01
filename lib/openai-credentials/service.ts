import "server-only";

import { z } from "zod";

import { parseOpenAiApiKey } from "@/lib/openai-credentials/key";
import {
  createServerServiceClient,
  readServerSupabaseConfig,
} from "@/lib/supabase/server-client";

export interface OpenAiCredentialStatus {
  configured: boolean;
  fingerprint?: string;
  updatedAt?: string;
}

export interface OpenAiCredentialRpcClient {
  rpc: (
    functionName: string,
    parameters: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: unknown }>;
}

interface ServerOpenAiCredentialServiceOptions {
  environment?: Readonly<Record<string, string | undefined>>;
  createClient?: (config: {
    supabaseUrl: string;
    publishableKey: string;
    secretKey: string;
  }) => OpenAiCredentialRpcClient;
}

export type ServerOpenAiCredentialServiceResult =
  | { ok: true; service: OpenAiCredentialService }
  | { ok: false };

export interface OpenAiCredentialService {
  getStatus: (actorUserId: string) => Promise<OpenAiCredentialStatus>;
  save: (
    actorUserId: string,
    apiKey: string,
    fingerprint: string,
  ) => Promise<OpenAiCredentialStatus>;
  remove: (actorUserId: string) => Promise<OpenAiCredentialStatus>;
  resolve: (actorUserId: string) => Promise<string | null>;
}

export function createOpenAiCredentialService(
  client: OpenAiCredentialRpcClient,
): OpenAiCredentialService {
  return {
    async getStatus(actorUserId) {
      return statusCall(client, "get_user_openai_credential_status", {
        p_user_id: requireActorId(actorUserId),
      });
    },
    async save(actorUserId, apiKey, fingerprint) {
      const parsedKey = parseOpenAiApiKey(apiKey);
      if (!parsedKey.ok || parsedKey.fingerprint !== fingerprint)
        throw unavailable();
      return statusCall(client, "upsert_user_openai_credential", {
        p_api_key: parsedKey.key,
        p_key_fingerprint: fingerprint,
        p_user_id: requireActorId(actorUserId),
      });
    },
    async remove(actorUserId) {
      return statusCall(client, "delete_user_openai_credential", {
        p_user_id: requireActorId(actorUserId),
      });
    },
    async resolve(actorUserId) {
      const response = await safeRpc(client, "resolve_user_openai_credential", {
        p_user_id: requireActorId(actorUserId),
      });
      if (response === null) return null;
      const parsed = parseOpenAiApiKey(response);
      if (!parsed.ok) throw unavailable();
      return parsed.key;
    },
  };
}

export function createServerOpenAiCredentialService(
  options: ServerOpenAiCredentialServiceOptions = {},
): ServerOpenAiCredentialServiceResult {
  const config = readServerSupabaseConfig(options.environment ?? process.env);
  if (!config.ok) return { ok: false };
  try {
    const client = options.createClient
      ? options.createClient(config.config)
      : createServerServiceClient<OpenAiCredentialRpcClient>(config.config);
    return { ok: true, service: createOpenAiCredentialService(client) };
  } catch {
    return { ok: false };
  }
}

export async function resolveSavedOpenAiApiKey(
  actorUserId: string,
  options: ServerOpenAiCredentialServiceOptions = {},
): Promise<string | null> {
  const result = createServerOpenAiCredentialService(options);
  if (!result.ok) throw unavailable();
  return result.service.resolve(actorUserId);
}

const actorIdSchema = z.uuid();
const fingerprintSchema = z.string().regex(/^sha256:[0-9a-f]{16}$/);
const storedStatusSchema = z
  .union([
    z.object({ configured: z.literal(false) }).strict(),
    z
      .object({
        configured: z.literal(true),
        key_fingerprint: fingerprintSchema,
        updated_at: z.iso.datetime({ offset: true }),
      })
      .strict(),
  ]);

function requireActorId(actorUserId: string) {
  const parsed = actorIdSchema.safeParse(actorUserId);
  if (!parsed.success) throw unavailable();
  return parsed.data;
}

async function statusCall(
  client: OpenAiCredentialRpcClient,
  functionName: string,
  parameters: Record<string, unknown>,
): Promise<OpenAiCredentialStatus> {
  const value = await safeRpc(client, functionName, parameters);
  const parsed = storedStatusSchema.safeParse(value);
  if (!parsed.success) throw unavailable();
  if (!parsed.data.configured) return { configured: false };
  return {
    configured: true,
    fingerprint: parsed.data.key_fingerprint,
    updatedAt: parsed.data.updated_at,
  };
}

async function safeRpc(
  client: OpenAiCredentialRpcClient,
  functionName: string,
  parameters: Record<string, unknown>,
) {
  try {
    const response = await client.rpc(functionName, parameters);
    if (response.error) throw unavailable();
    return response.data;
  } catch {
    throw unavailable();
  }
}

function unavailable() {
  return new Error("OpenAI credential storage is unavailable.");
}
