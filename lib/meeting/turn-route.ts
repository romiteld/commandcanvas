import "server-only";

import { z } from "zod";

import {
  authenticatePermanentEmailUser,
  type SupabaseUserVerifier,
} from "@/lib/supabase/server-auth";

const roomIdSchema = z.uuid();
const requestIdSchema = z.uuid();
const iceServerSchema = z
  .object({
    urls: z.union([
      z.string().min(1).max(2_048),
      z.array(z.string().min(1).max(2_048)).min(1).max(8),
    ]),
    username: z.string().min(1).max(512).optional(),
    credential: z.string().min(1).max(2_048).optional(),
  })
  .strict();
const issuedCredentialsSchema = z
  .object({
    ok: z.literal(true),
    expiresAt: z.iso.datetime(),
    iceServers: z.array(iceServerSchema).min(1).max(9),
  })
  .strict();

export type MeetingTurnCredentialResult =
  | z.infer<typeof issuedCredentialsSchema>
  | { ok: false };

export interface MeetingTurnRouteDependencies {
  verifier: SupabaseUserVerifier;
  verifyMembership: (
    roomId: string,
    actorUserId: string,
  ) => Promise<{ ok: true } | { ok: false }>;
  admitIssuance: (input: {
    roomId: string;
    actorUserId: string;
    requestId: string;
  }) => Promise<
    | { ok: true; issuedAtSeconds: number }
    | { ok: false; code: "rate_limited"; retryAfterSeconds: number }
    | { ok: false; code: "unavailable" }
  >;
  issueCredentials: (
    actorUserId: string,
    issuedAtSeconds: number,
  ) => MeetingTurnCredentialResult | Promise<MeetingTurnCredentialResult>;
}

export async function handleMeetingTurnCredentialRequest(
  request: Request,
  pathRoomId: string,
  dependencies: MeetingTurnRouteDependencies,
): Promise<Response> {
  const actor = await authenticatePermanentEmailUser(
    request.headers.get("authorization"),
    dependencies.verifier,
  );
  if (!actor.ok) {
    if (actor.error.code === "permanent_email_auth_required")
      return jsonResponse(403, {
        ok: false,
        fallback: "direct",
        error: actor.error,
      });
    return jsonResponse(401, { ok: false, error: actor.error });
  }
  if (!roomIdSchema.safeParse(pathRoomId).success)
    return jsonResponse(400, {
      ok: false,
      error: { code: "invalid_room_id", message: "Room ID is invalid." },
    });
  const requestId = request.headers.get("idempotency-key");
  if (!requestIdSchema.safeParse(requestId).success)
    return jsonResponse(400, {
      ok: false,
      error: {
        code: "idempotency_key_required",
        message: "A UUID Idempotency-Key is required.",
      },
    });

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
    return jsonResponse(403, {
      ok: false,
      error: {
        code: "member_required",
        message: "Join this room before starting meeting media.",
      },
    });

  let admission:
    | { ok: true; issuedAtSeconds: number }
    | { ok: false; code: "rate_limited"; retryAfterSeconds: number }
    | { ok: false; code: "unavailable" };
  try {
    admission = await dependencies.admitIssuance({
      roomId: pathRoomId,
      actorUserId: actor.actorUserId,
      requestId: requestId!,
    });
  } catch {
    admission = { ok: false, code: "unavailable" };
  }
  if (!admission.ok && admission.code === "rate_limited")
    return jsonResponse(
      429,
      {
        ok: false,
        fallback: "direct",
        error: {
          code: "turn_rate_limited",
          message: "TURN credential issuance is temporarily rate-limited.",
        },
      },
      { "retry-after": String(admission.retryAfterSeconds) },
    );
  if (!admission.ok) return meetingTurnUnavailableResponse();

  try {
    const issued = issuedCredentialsSchema.safeParse(
      await dependencies.issueCredentials(
        actor.actorUserId,
        admission.issuedAtSeconds,
      ),
    );
    if (issued.success) return jsonResponse(200, issued.data);
  } catch {
    // The direct-media fallback below is authoritative.
  }
  return jsonResponse(503, {
    ok: false,
    fallback: "direct",
    error: {
      code: "turn_unavailable",
      message:
        "TURN relay credentials are unavailable. Direct meeting media may still connect.",
    },
  });
}

export function meetingTurnUnavailableResponse() {
  return jsonResponse(503, {
    ok: false,
    fallback: "direct",
    error: {
      code: "turn_unavailable",
      message:
        "TURN relay credentials are unavailable. Direct meeting media may still connect.",
    },
  });
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
