import "server-only";

import { readBoundedUtf8Body } from "@/lib/http/read-bounded-body";
import {
  createServerUserProfileService,
  type UserProfileService,
} from "@/lib/user-profiles/service";
import { userProfileDraftSchema } from "@/lib/user-profiles/contracts";
import {
  authenticatePermanentEmailUser,
  type SupabaseUserVerifier,
} from "@/lib/supabase/server-auth";
import {
  createServerUserVerifierClient,
  readServerSupabaseConfig,
} from "@/lib/supabase/server-client";

export interface UserProfileRouteDependencies {
  verifier: SupabaseUserVerifier;
  service: UserProfileService;
}

const MAX_REQUEST_BYTES = 2 * 1_024;

export async function handleGetUserProfileRequest(
  request: Request,
  dependencies: UserProfileRouteDependencies,
) {
  const auth = await authenticate(request, dependencies.verifier);
  if (!auth.ok) return auth.response;
  try {
    return json(200, { profile: await dependencies.service.get(auth.actorUserId) });
  } catch {
    return unavailableResponse();
  }
}

export async function handlePutUserProfileRequest(
  request: Request,
  dependencies: UserProfileRouteDependencies,
) {
  const auth = await authenticate(request, dependencies.verifier);
  if (!auth.ok) return auth.response;
  const parsed = await parseProfileRequest(request);
  if (!parsed.ok) return parsed.response;
  try {
    return json(200, {
      profile: await dependencies.service.upsert(auth.actorUserId, parsed.value),
    });
  } catch {
    return unavailableResponse();
  }
}

export function createServerUserProfileRouteDependencies(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): { ok: true; dependencies: UserProfileRouteDependencies } | { ok: false } {
  const config = readServerSupabaseConfig(environment);
  if (!config.ok) return { ok: false };
  const service = createServerUserProfileService({ environment });
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

export function userProfileUnavailableResponse() {
  return unavailableResponse();
}

async function authenticate(request: Request, verifier: SupabaseUserVerifier) {
  const result = await authenticatePermanentEmailUser(
    request.headers.get("authorization"),
    verifier,
  );
  if (result.ok) return result;
  return {
    ok: false as const,
    response: jsonError(
      result.error.code === "permanent_email_auth_required" ? 403 : 401,
      result.error.code,
      result.error.message,
    ),
  };
}

async function parseProfileRequest(request: Request) {
  if (
    request.headers.get("content-type")?.split(";", 1)[0]?.trim() !==
    "application/json"
  )
    return {
      ok: false as const,
      response: jsonError(415, "unsupported_media_type", "Use application/json."),
    };
  try {
    const body = await readBoundedUtf8Body(
      request.body,
      MAX_REQUEST_BYTES,
      request.signal,
    );
    if (!body.ok)
      return {
        ok: false as const,
        response: jsonError(
          body.reason === "too_large" ? 413 : 400,
          body.reason === "too_large" ? "request_too_large" : "invalid_request",
          body.reason === "too_large"
            ? "Request body is too large."
            : "Request body is invalid.",
        ),
      };
    const parsed = userProfileDraftSchema.safeParse(JSON.parse(body.text));
    if (!parsed.success) throw new Error("invalid");
    return { ok: true as const, value: parsed.data };
  } catch {
    return {
      ok: false as const,
      response: jsonError(400, "invalid_request", "Request body is invalid."),
    };
  }
}

function unavailableResponse() {
  return jsonError(
    503,
    "profile_store_unavailable",
    "Your saved profile is temporarily unavailable.",
  );
}

function jsonError(status: number, code: string, message: string) {
  return json(status, { ok: false, error: { code, message } });
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
    },
  });
}
