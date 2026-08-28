import "server-only";

import { z } from "zod";

import {
  privateHandRelaySessionRequestSchema,
  privateHandRelaySessionSchema,
  type PrivateHandRelaySession,
} from "@/lib/gesture/private-hand-relay-contract";
import {
  authenticateRequestActor,
  type SupabaseUserVerifier,
} from "@/lib/supabase/server-auth";
import { readBoundedUtf8Body } from "@/lib/http/read-bounded-body";

const MAX_REQUEST_BYTES = 1_024;
const roomIdSchema = z.uuid();

export type PrivateHandRelayStartResult =
  | { ok: true; relay: PrivateHandRelaySession }
  | {
      ok: false;
      code: "rate_limited";
      retryAfterSeconds: number;
    }
  | { ok: false; code: "relay_unavailable" };

export interface PrivateHandRelaySessionRouteDependencies {
  verifier: SupabaseUserVerifier;
  verifyMembership: (
    roomId: string,
    actorUserId: string,
  ) => Promise<{ ok: true } | { ok: false }>;
  startSession: (input: {
    roomId: string;
    actorUserId: string;
    signal: AbortSignal;
  }) => Promise<PrivateHandRelayStartResult>;
}

export async function handlePrivateHandRelaySessionRequest(
  request: Request,
  pathRoomId: string,
  dependencies: PrivateHandRelaySessionRouteDependencies,
): Promise<Response> {
  const actor = await authenticateRequestActor(
    request.headers.get("authorization"),
    dependencies.verifier,
  );
  if (!actor.ok)
    return jsonError(401, actor.error.code, actor.error.message);
  if (!roomIdSchema.safeParse(pathRoomId).success)
    return jsonError(400, "invalid_room_id", "Room ID is invalid.");
  if (!isApplicationJson(request.headers.get("content-type")))
    return jsonError(
      415,
      "unsupported_media_type",
      "Content-Type must be application/json.",
    );
  const declaredLength = request.headers.get("content-length");
  if (declaredLength && /^\d+$/.test(declaredLength)) {
    const bytes = Number(declaredLength);
    if (Number.isSafeInteger(bytes) && bytes > MAX_REQUEST_BYTES)
      return jsonError(413, "request_too_large", "Request body is too large.");
  }
  let raw: unknown;
  try {
    const body = await readBoundedUtf8Body(
      request.body,
      MAX_REQUEST_BYTES,
      request.signal,
    );
    if (!body.ok && body.reason === "too_large")
      return jsonError(413, "request_too_large", "Request body is too large.");
    if (!body.ok) throw new Error(body.reason);
    raw = JSON.parse(body.text);
  } catch {
    return jsonError(400, "invalid_request", "Request body is invalid.");
  }
  const consent = privateHandRelaySessionRequestSchema.safeParse(raw);
  if (!consent.success)
    return jsonError(
      403,
      "camera_upload_consent_required",
      "Private GPU tracking requires explicit camera upload consent.",
      true,
    );

  let membership: { ok: true } | { ok: false };
  try {
    membership = await dependencies.verifyMembership(
      pathRoomId,
      actor.actorUserId,
    );
  } catch {
    membership = { ok: false };
  }
  if (!membership.ok)
    return jsonError(
      403,
      "member_required",
      "Join this room before starting private GPU tracking.",
    );

  let started: PrivateHandRelayStartResult;
  try {
    started = await dependencies.startSession({
      roomId: pathRoomId,
      actorUserId: actor.actorUserId,
      signal: request.signal,
    });
  } catch {
    started = { ok: false, code: "relay_unavailable" };
  }
  if (!started.ok && started.code === "rate_limited")
    return jsonError(
      429,
      "relay_rate_limited",
      "Private GPU hand tracking has reached its session-start limit. Local tracking remains active.",
      true,
      { "retry-after": String(started.retryAfterSeconds) },
    );
  if (!started.ok)
    return jsonError(
      503,
      "relay_unavailable",
      "Private GPU hand tracking is unavailable. Local tracking remains active.",
      true,
    );
  const relay = privateHandRelaySessionSchema.safeParse(started.relay);
  if (!relay.success)
    return jsonError(
      503,
      "relay_unavailable",
      "Private GPU hand tracking is unavailable. Local tracking remains active.",
      true,
    );
  return jsonResponse(200, { ok: true, relay: relay.data });
}

export function privateHandRelayUnavailableResponse() {
  return jsonError(
    503,
    "relay_unavailable",
    "Private GPU hand tracking is unavailable. Local tracking remains active.",
    true,
  );
}

function isApplicationJson(contentType: string | null) {
  return contentType?.split(";", 1)[0]?.trim().toLowerCase() ===
    "application/json";
}

function jsonError(
  status: number,
  code: string,
  message: string,
  localFallback = false,
  additionalHeaders: Record<string, string> = {},
) {
  return jsonResponse(
    status,
    {
      ok: false,
      ...(localFallback ? { fallback: "local" } : {}),
      error: { code, message },
    },
    additionalHeaders,
  );
}

function jsonResponse(
  status: number,
  body: unknown,
  additionalHeaders: Record<string, string> = {},
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      "x-content-type-options": "nosniff",
      ...additionalHeaders,
    },
  });
}
