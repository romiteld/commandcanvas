import "server-only";

import { z } from "zod";

import {
  authenticateRequestActor,
  type SupabaseUserVerifier,
} from "@/lib/supabase/server-auth";

const roomIdSchema = z.uuid();
const eligibleRosterSchema = z
  .object({
    ok: z.literal(true),
    status: z.literal("eligible"),
    participantIds: z.array(z.uuid()).min(1).max(4),
  })
  .strict()
  .refine(({ participantIds }) => new Set(participantIds).size === participantIds.length);
const overCapacityRosterSchema = z
  .object({
    ok: z.literal(true),
    status: z.literal("over_capacity"),
  })
  .strict();
const rosterSchema = z.discriminatedUnion("status", [
  eligibleRosterSchema,
  overCapacityRosterSchema,
]);

export interface MeetingRosterRouteDependencies {
  verifier: SupabaseUserVerifier;
  loadRoster: (
    roomId: string,
    actorUserId: string,
  ) => Promise<z.infer<typeof rosterSchema> | { ok: false }>;
}

export async function handleMeetingRosterRequest(
  request: Request,
  pathRoomId: string,
  dependencies: MeetingRosterRouteDependencies,
): Promise<Response> {
  const actor = await authenticateRequestActor(
    request.headers.get("authorization"),
    dependencies.verifier,
  );
  if (!actor.ok) return json(401, { ok: false, error: actor.error });
  if (!roomIdSchema.safeParse(pathRoomId).success)
    return json(400, {
      ok: false,
      error: { code: "invalid_room_id", message: "Room ID is invalid." },
    });

  try {
    const roster = rosterSchema.safeParse(
      await dependencies.loadRoster(pathRoomId, actor.actorUserId),
    );
    if (roster.success) return json(200, roster.data);
  } catch {
    // Membership failure below is intentionally fail-closed.
  }
  return json(403, {
    ok: false,
    error: {
      code: "member_required",
      message: "Join this active room before starting meeting media.",
    },
  });
}

export function meetingRosterUnavailableResponse() {
  return json(503, {
    ok: false,
    error: {
      code: "roster_unavailable",
      message: "The verified meeting roster is unavailable.",
    },
  });
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
