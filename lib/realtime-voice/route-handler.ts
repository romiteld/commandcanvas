import { z } from "zod";

import {
  authenticateRequestActor,
  type SupabaseUserVerifier,
} from "@/lib/supabase/server-auth";

const MAX_SDP_BYTES = 256 * 1_024;
const roomIdSchema = z.uuid();

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
  createCall: (input: {
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
  if (membership.roomMode !== "demo")
    return jsonError(
      403,
      "demo_room_required",
      "Live voice is available in the no-signup demo room.",
    );

  let sdp: string;
  try {
    sdp = await request.text();
  } catch {
    return jsonError(400, "invalid_sdp", "SDP offer is invalid.");
  }
  if (
    Buffer.byteLength(sdp, "utf8") > MAX_SDP_BYTES ||
    !sdp.startsWith("v=0")
  )
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
