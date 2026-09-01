import "server-only";

import { z } from "zod";

import { parseOpenAiApiKey } from "@/lib/openai-credentials/key";
import {
  createServerOpenAiCredentialService,
  type OpenAiCredentialService,
} from "@/lib/openai-credentials/service";
import {
  authenticatePermanentEmailUser,
  type SupabaseUserVerifier,
} from "@/lib/supabase/server-auth";
import {
  createServerUserVerifierClient,
  readServerSupabaseConfig,
} from "@/lib/supabase/server-client";

export interface OpenAiCredentialRouteDependencies {
  verifier: SupabaseUserVerifier;
  service: OpenAiCredentialService;
}

const MAX_REQUEST_BYTES = 2 * 1_024;
const putRequestSchema = z
  .object({
    apiKey: z.string(),
    confirmSave: z.boolean(),
  })
  .strict();

export async function handleGetOpenAiCredentialRequest(
  request: Request,
  dependencies: OpenAiCredentialRouteDependencies,
) {
  const auth = await authenticate(request, dependencies.verifier);
  if (!auth.ok) return auth.response;
  try {
    return json(200, await dependencies.service.getStatus(auth.actorUserId));
  } catch {
    return unavailable();
  }
}

export async function handlePutOpenAiCredentialRequest(
  request: Request,
  dependencies: OpenAiCredentialRouteDependencies,
) {
  const auth = await authenticate(request, dependencies.verifier);
  if (!auth.ok) return auth.response;
  const input = await parsePutRequest(request);
  if (!input.ok) return input.response;
  if (!input.value.confirmSave)
    return jsonError(
      400,
      "save_confirmation_required",
      "Confirm before saving an OpenAI API key.",
    );
  const key = parseOpenAiApiKey(input.value.apiKey);
  if (!key.ok)
    return jsonError(
      400,
      "invalid_openai_api_key",
      "Enter a valid OpenAI API key.",
    );
  try {
    return json(
      200,
      await dependencies.service.save(
        auth.actorUserId,
        key.key,
        key.fingerprint,
      ),
    );
  } catch {
    return unavailable();
  }
}

export async function handleDeleteOpenAiCredentialRequest(
  request: Request,
  dependencies: OpenAiCredentialRouteDependencies,
) {
  const auth = await authenticate(request, dependencies.verifier);
  if (!auth.ok) return auth.response;
  try {
    return json(200, await dependencies.service.remove(auth.actorUserId));
  } catch {
    return unavailable();
  }
}

export function createServerOpenAiCredentialRouteDependencies(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): { ok: true; dependencies: OpenAiCredentialRouteDependencies } | { ok: false } {
  const config = readServerSupabaseConfig(environment);
  if (!config.ok) return { ok: false };
  const service = createServerOpenAiCredentialService({ environment });
  if (!service.ok) return { ok: false };
  try {
    return {
      ok: true,
      dependencies: {
        verifier: createServerUserVerifierClient<SupabaseUserVerifier>(
          config.config,
        ),
        service: service.service,
      },
    };
  } catch {
    return { ok: false };
  }
}

export function openAiCredentialUnavailableResponse() {
  return unavailable();
}

async function authenticate(request: Request, verifier: SupabaseUserVerifier) {
  const result = await authenticatePermanentEmailUser(
    request.headers.get("authorization"),
    verifier,
  );
  if (result.ok) return result;
  const status =
    result.error.code === "permanent_email_auth_required" ? 403 : 401;
  return {
    ok: false as const,
    response: jsonError(status, result.error.code, result.error.message),
  };
}

async function parsePutRequest(request: Request) {
  const contentType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim();
  if (contentType !== "application/json")
    return {
      ok: false as const,
      response: jsonError(415, "unsupported_media_type", "Use application/json."),
    };
  const declaredLength = request.headers.get("content-length");
  if (
    declaredLength &&
    /^\d+$/.test(declaredLength) &&
    Number(declaredLength) > MAX_REQUEST_BYTES
  )
    return {
      ok: false as const,
      response: jsonError(413, "request_too_large", "Request body is too large."),
    };
  try {
    const body = await request.text();
    if (Buffer.byteLength(body, "utf8") > MAX_REQUEST_BYTES)
      return {
        ok: false as const,
        response: jsonError(413, "request_too_large", "Request body is too large."),
      };
    const parsed = putRequestSchema.safeParse(JSON.parse(body));
    if (!parsed.success)
      return {
        ok: false as const,
        response: jsonError(400, "invalid_request", "Request body is invalid."),
      };
    return { ok: true as const, value: parsed.data };
  } catch {
    return {
      ok: false as const,
      response: jsonError(400, "invalid_request", "Request body is invalid."),
    };
  }
}

function unavailable() {
  return jsonError(
    503,
    "credential_store_unavailable",
    "Saved OpenAI credentials are temporarily unavailable.",
  );
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders(),
  });
}

function jsonError(status: number, code: string, message: string) {
  return json(status, { ok: false, error: { code, message } });
}

function responseHeaders() {
  return {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
    "x-content-type-options": "nosniff",
  };
}
