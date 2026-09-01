import { z } from "zod";

import { readBoundedUtf8Body } from "@/lib/http/read-bounded-body";
import {
  authenticatePermanentEmailUser,
  authenticateRequestActor,
  type SupabaseUserVerifier,
} from "@/lib/supabase/server-auth";

const MAX_SDP_BYTES = 256 * 1_024;
const roomIdSchema = z.uuid();
const openAiApiKeySchema = z
  .string()
  .trim()
  .min(20)
  .max(512)
  .regex(/^sk-[A-Za-z0-9_-]+$/);

export type RealtimeSessionAdmissionResult =
  | { ok: true }
  | {
      ok: false;
      code: "rate_limited";
      retryAfterSeconds: number;
    }
  | { ok: false; code: "demo_room_required" }
  | { ok: false; code: "admission_unavailable" };

export interface RealtimeSessionRouteDependencies {
  verifier: SupabaseUserVerifier;
  verifyMembership: (
    roomId: string,
    actorUserId: string,
  ) => Promise<
    | { ok: true; roomMode: "standard" | "demo" }
    | { ok: false }
  >;
  admitSession: (
    roomId: string,
    actorUserId: string,
  ) => Promise<RealtimeSessionAdmissionResult>;
  resolveSavedOpenAiApiKey: (actorUserId: string) => Promise<string | null>;
  createCall: (input: {
    apiKey: string;
    sdp: string;
    safetyIdentifier: string;
    signal: AbortSignal;
  }) => Promise<{ ok: true; sdp: string } | { ok: false }>;
  safetyIdentifier: (actorUserId: string) => string;
}

export async function handleRealtimeSessionRequest(
  request: Request,
  dependencies: RealtimeSessionRouteDependencies,
): Promise<Response> {
  const actor = await authenticateRequestActor(
    request.headers.get("authorization"),
    dependencies.verifier,
  );
  if (!actor.ok)
    return jsonError(401, actor.error.code, actor.error.message);

  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim();
  if (contentType !== "application/sdp")
    return jsonError(
      415,
      "unsupported_media_type",
      "Realtime session requests require application/sdp.",
    );

  const roomId = request.headers.get("x-commandcanvas-room-id")?.trim() ?? "";
  if (!roomIdSchema.safeParse(roomId).success)
    return jsonError(400, "invalid_room_id", "Room ID is invalid.");

  const declaredLength = request.headers.get("content-length");
  if (declaredLength && /^\d+$/.test(declaredLength)) {
    const bytes = Number(declaredLength);
    if (Number.isSafeInteger(bytes) && bytes > MAX_SDP_BYTES)
      return jsonError(413, "request_too_large", "SDP offer is too large.");
  }

  let membership:
    | { ok: true; roomMode: "standard" | "demo" }
    | { ok: false };
  try {
    membership = await dependencies.verifyMembership(
      roomId,
      actor.actorUserId,
    );
  } catch {
    membership = { ok: false };
  }
  if (!membership.ok)
    return jsonError(
      403,
      "member_required",
      "Join this room before starting live voice.",
    );
  if (membership.roomMode === "standard") {
    const permanentActor = await authenticatePermanentEmailUser(
      request.headers.get("authorization"),
      dependencies.verifier,
    );
    if (!permanentActor.ok || permanentActor.actorUserId !== actor.actorUserId)
      return jsonError(
        403,
        "permanent_email_auth_required",
        "Verify your email before using live voice in a meeting room.",
      );
  }

  const credential = await resolveOpenAiCredential(
    request,
    membership.roomMode,
    actor.actorUserId,
    dependencies,
  );
  if (!credential.ok) return credential.response;

  const body = await readBoundedUtf8Body(
    request.body,
    MAX_SDP_BYTES,
    request.signal,
  );
  if (!body.ok && body.reason === "too_large")
    return jsonError(413, "request_too_large", "SDP offer is too large.");
  if (!body.ok)
    return jsonError(400, "invalid_sdp", "SDP offer is invalid.");
  const sdp = body.text;
  if (!sdp.startsWith("v=0"))
    return jsonError(400, "invalid_sdp", "SDP offer is invalid.");

  let admission: RealtimeSessionAdmissionResult;
  try {
    admission = await dependencies.admitSession(roomId, actor.actorUserId);
  } catch {
    admission = { ok: false, code: "admission_unavailable" };
  }
  if (!admission.ok) {
    if (admission.code === "demo_room_required")
      return jsonError(
        403,
        "demo_room_required",
        "Live voice is available in the no-signup demo room.",
      );
    if (admission.code === "rate_limited")
      return jsonError(
        429,
        "voice_rate_limited",
        "Live voice has reached its usage limit. Try again later.",
        { "retry-after": String(admission.retryAfterSeconds) },
      );
    return unavailable();
  }

  try {
    const result = await dependencies.createCall({
      apiKey: credential.apiKey,
      sdp,
      safetyIdentifier: dependencies.safetyIdentifier(actor.actorUserId),
      signal: request.signal,
    });
    if (!result.ok) return unavailable();
    return new Response(result.sdp, {
      status: 200,
      headers: responseHeaders("application/sdp"),
    });
  } catch {
    return unavailable();
  }
}

async function resolveOpenAiCredential(
  request: Request,
  roomMode: "standard" | "demo",
  actorUserId: string,
  dependencies: RealtimeSessionRouteDependencies,
): Promise<
  | { ok: true; apiKey: string }
  | { ok: false; response: Response }
> {
  const rawKey = request.headers.get("x-commandcanvas-openai-key");
  const savedHeader = request.headers.get(
    "x-commandcanvas-openai-credential",
  );
  if (savedHeader !== null && savedHeader !== "saved")
    return {
      ok: false,
      response: jsonError(
        400,
        "invalid_openai_credential",
        "OpenAI credential selection is invalid.",
      ),
    };
  const useSaved = savedHeader === "saved";
  if (useSaved && rawKey !== null)
    return {
      ok: false,
      response: jsonError(
        400,
        "ambiguous_openai_credential",
        "Choose either a saved OpenAI credential or a temporary key.",
      ),
    };
  if (!useSaved) {
    const parsed = openAiApiKeySchema.safeParse(rawKey);
    return parsed.success
      ? { ok: true, apiKey: parsed.data }
      : {
          ok: false,
          response: jsonError(
            400,
            "invalid_openai_api_key",
            "Enter a valid OpenAI API key for this live voice session.",
          ),
        };
  }
  if (roomMode !== "standard")
    return {
      ok: false,
      response: jsonError(
        403,
        "saved_credential_unavailable",
        "Saved credentials are available after email sign-in in a meeting room.",
      ),
    };
  try {
    const savedKey = await dependencies.resolveSavedOpenAiApiKey(actorUserId);
    const parsed = openAiApiKeySchema.safeParse(savedKey);
    return parsed.success
      ? { ok: true, apiKey: parsed.data }
      : {
          ok: false,
          response: jsonError(
            409,
            "openai_credential_not_configured",
            "Save an OpenAI API key to your CommandCanvas account first.",
          ),
        };
  } catch {
    return {
      ok: false,
      response: jsonError(
        503,
        "openai_credential_unavailable",
        "Your saved OpenAI credential is temporarily unavailable.",
      ),
    };
  }
}

export function realtimeSessionUnavailableResponse() {
  return unavailable();
}

function unavailable() {
  return jsonError(
    503,
    "realtime_unavailable",
    "Live voice is temporarily unavailable.",
  );
}

function jsonError(
  status: number,
  code: string,
  message: string,
  additionalHeaders: Record<string, string> = {},
) {
  return new Response(JSON.stringify({ ok: false, error: { code, message } }), {
    status,
    headers: {
      ...responseHeaders("application/json; charset=utf-8"),
      ...additionalHeaders,
    },
  });
}

function responseHeaders(contentType: string) {
  return {
    "cache-control": "no-store",
    "content-type": contentType,
    "x-content-type-options": "nosniff",
  };
}
