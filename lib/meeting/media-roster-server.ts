import "server-only";

import { z } from "zod";

import type { MeetingRosterRouteDependencies } from "@/lib/meeting/media-roster-route";
import {
  isPersistedRoomAccessActive,
  persistedRoomAccessRowSchema,
} from "@/lib/supabase/room-access";
import type { SupabaseUserVerifier } from "@/lib/supabase/server-auth";
import {
  createServerServiceClient,
  createServerUserVerifierClient,
  readServerSupabaseConfig,
} from "@/lib/supabase/server-client";

const rosterRowSchema = z
  .object({
    user_id: z.uuid(),
    rooms: persistedRoomAccessRowSchema,
  })
  .strict();
const rosterRowsSchema = z.array(rosterRowSchema).min(1).max(64);

interface RosterQueryResult {
  data: unknown;
  error: unknown;
}

interface RosterQueryBuilder extends PromiseLike<RosterQueryResult> {
  select(columns: string): RosterQueryBuilder;
  eq(column: string, value: unknown): RosterQueryBuilder;
}

interface MeetingRosterServiceClient extends SupabaseUserVerifier {
  from(table: string): RosterQueryBuilder;
}

interface ServerMeetingRosterOptions {
  environment?: Readonly<Record<string, string | undefined>>;
  createClient?: (config: {
    supabaseUrl: string;
    publishableKey: string;
    secretKey: string;
  }) => MeetingRosterServiceClient;
}

export type ServerMeetingRosterDependenciesResult =
  | { ok: true; dependencies: MeetingRosterRouteDependencies }
  | { ok: false };

export function createServerMeetingRosterDependencies(
  options: ServerMeetingRosterOptions = {},
): ServerMeetingRosterDependenciesResult {
  const config = readServerSupabaseConfig(options.environment ?? process.env);
  if (!config.ok) return { ok: false };

  let client: MeetingRosterServiceClient;
  let verifier: SupabaseUserVerifier;
  try {
    client = options.createClient
      ? options.createClient(config.config)
      : createServerServiceClient<MeetingRosterServiceClient>(config.config);
    verifier = options.createClient
      ? client
      : createServerUserVerifierClient<SupabaseUserVerifier>(config.config);
  } catch {
    return { ok: false };
  }

  return {
    ok: true,
    dependencies: {
      verifier,
      async loadRoster(roomId, actorUserId) {
        try {
          const response = await client
            .from("room_members")
            .select(
              "user_id, rooms!inner(mode,created_at,demo_hard_expires_at)",
            )
            .eq("room_id", roomId);
          if (response.error) return { ok: false as const };
          const parsed = rosterRowsSchema.safeParse(response.data);
          if (!parsed.success) return { ok: false as const };
          const participantIds = parsed.data.map(({ user_id }) => user_id).sort();
          if (
            new Set(participantIds).size !== participantIds.length ||
            !participantIds.includes(actorUserId) ||
            parsed.data.some(({ rooms }) => !isPersistedRoomAccessActive(rooms))
          )
            return { ok: false as const };
          if (participantIds.length > 4)
            return {
              ok: true as const,
              status: "over_capacity" as const,
            };
          return {
            ok: true as const,
            status: "eligible" as const,
            participantIds,
          };
        } catch {
          return { ok: false as const };
        }
      },
    },
  };
}
