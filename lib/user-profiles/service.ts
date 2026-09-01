import "server-only";

import { z } from "zod";

import {
  userProfileDraftSchema,
  type UserProfile,
  type UserProfileDraft,
} from "@/lib/user-profiles/contracts";
import {
  createServerServiceClient,
  readServerSupabaseConfig,
} from "@/lib/supabase/server-client";

export interface UserProfileRpcClient {
  rpc: (
    functionName: string,
    parameters: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: unknown }>;
}

export interface UserProfileService {
  get: (actorUserId: string) => Promise<UserProfile | null>;
  upsert: (
    actorUserId: string,
    profile: UserProfileDraft,
  ) => Promise<UserProfile>;
}

interface ServerUserProfileServiceOptions {
  environment?: Readonly<Record<string, string | undefined>>;
  createClient?: (config: {
    supabaseUrl: string;
    publishableKey: string;
    secretKey: string;
  }) => UserProfileRpcClient;
}

const actorIdSchema = z.uuid();
const storedProfileSchema = z.discriminatedUnion("configured", [
  z.object({ configured: z.literal(false) }).strict(),
  z
    .object({
      configured: z.literal(true),
      display_name: z.string().trim().min(1).max(64),
      color: z.string().regex(/^#[0-9A-F]{6}$/),
      updated_at: z.iso.datetime({ offset: true }),
    })
    .strict(),
]);

export function createUserProfileService(
  client: UserProfileRpcClient,
): UserProfileService {
  return {
    async get(actorUserId) {
      const value = await safeRpc(client, "get_user_profile", {
        p_user_id: requireActorId(actorUserId),
      });
      const parsed = storedProfileSchema.safeParse(value);
      if (!parsed.success) throw unavailable();
      return parsed.data.configured ? toProfile(parsed.data) : null;
    },
    async upsert(actorUserId, rawProfile) {
      const profile = userProfileDraftSchema.safeParse(rawProfile);
      if (!profile.success) throw unavailable();
      const value = await safeRpc(client, "upsert_user_profile", {
        p_user_id: requireActorId(actorUserId),
        p_display_name: profile.data.displayName,
        p_color: profile.data.color.toUpperCase(),
      });
      const parsed = storedProfileSchema.safeParse(value);
      if (!parsed.success || !parsed.data.configured) throw unavailable();
      return toProfile(parsed.data);
    },
  };
}

export function createServerUserProfileService(
  options: ServerUserProfileServiceOptions = {},
): { ok: true; service: UserProfileService } | { ok: false } {
  const config = readServerSupabaseConfig(options.environment ?? process.env);
  if (!config.ok) return { ok: false };
  try {
    const client = options.createClient
      ? options.createClient(config.config)
      : createServerServiceClient<UserProfileRpcClient>(config.config);
    return { ok: true, service: createUserProfileService(client) };
  } catch {
    return { ok: false };
  }
}

function requireActorId(actorUserId: string) {
  const parsed = actorIdSchema.safeParse(actorUserId);
  if (!parsed.success) throw unavailable();
  return parsed.data;
}

async function safeRpc(
  client: UserProfileRpcClient,
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

function toProfile(input: {
  display_name: string;
  color: string;
  updated_at: string;
}): UserProfile {
  return {
    displayName: input.display_name,
    color: input.color,
    updatedAt: input.updated_at,
  };
}

function unavailable() {
  return new Error("User profile storage is unavailable.");
}
