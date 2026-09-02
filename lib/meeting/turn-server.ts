import "server-only";

import { z } from "zod";

import {
  createTurnIceServers,
  readTurnCredentialConfig,
} from "@/lib/meeting/turn-credentials";
import type { MeetingTurnRouteDependencies } from "@/lib/meeting/turn-route";
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

const memberSchema = z
  .object({
    role: z.enum(["host", "participant"]),
    rooms: persistedRoomAccessRowSchema,
  })
  .strict();

interface MembershipQueryResult {
  data: unknown;
  error: unknown;
}

interface MembershipQueryBuilder {
  select(columns: string): MembershipQueryBuilder;
  eq(column: string, value: unknown): MembershipQueryBuilder;
  maybeSingle(): PromiseLike<MembershipQueryResult>;
}

interface MeetingTurnServiceClient extends SupabaseUserVerifier {
  from(table: string): MembershipQueryBuilder;
  rpc(
    functionName: string,
    parameters: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: unknown }>;
}

const admittedIssuanceSchema = z
  .object({
    outcome: z.literal("admitted"),
    issuedAtSeconds: z.number().int().nonnegative(),
    replayed: z.boolean(),
  })
  .strict();
const deniedIssuanceSchema = z
  .object({
    outcome: z.literal("denied"),
    code: z.enum([
      "turn_actor_rate_limit",
      "turn_room_rate_limit",
      "turn_global_rate_limit",
    ]),
    retryAfterSeconds: z.number().int().min(1).max(86_400),
  })
  .strict();
const issuanceAdmissionSchema = z.union([
  admittedIssuanceSchema,
  deniedIssuanceSchema,
]);

interface ServerMeetingTurnOptions {
  environment?: Readonly<Record<string, string | undefined>>;
  createClient?: (config: {
    supabaseUrl: string;
    publishableKey: string;
    secretKey: string;
  }) => MeetingTurnServiceClient;
}

export type ServerMeetingTurnDependenciesResult =
  | { ok: true; dependencies: MeetingTurnRouteDependencies }
  | { ok: false };

export function createServerMeetingTurnDependencies(
  options: ServerMeetingTurnOptions = {},
): ServerMeetingTurnDependenciesResult {
  const environment = options.environment ?? process.env;
  const turnConfig = readTurnCredentialConfig(environment);
  const supabaseConfig = readServerSupabaseConfig(environment);
  if (!turnConfig.ok || !supabaseConfig.ok) return { ok: false };

  let client: MeetingTurnServiceClient;
  let verifier: SupabaseUserVerifier;
  try {
    client = options.createClient
      ? options.createClient(supabaseConfig.config)
      : createServerServiceClient<MeetingTurnServiceClient>(
          supabaseConfig.config,
        );
    verifier = options.createClient
      ? client
      : createServerUserVerifierClient<SupabaseUserVerifier>(
          supabaseConfig.config,
        );
  } catch {
    return { ok: false };
  }

  return {
    ok: true,
    dependencies: {
      verifier,
      async verifyMembership(roomId, actorUserId) {
        try {
          const response = await client
            .from("room_members")
            .select(
              "role, rooms!inner(mode,created_at,demo_hard_expires_at)",
            )
            .eq("room_id", roomId)
            .eq("user_id", actorUserId)
            .maybeSingle();
          const parsed = memberSchema.safeParse(response.data);
          return !response.error &&
            parsed.success &&
            isPersistedRoomAccessActive(parsed.data.rooms)
            ? { ok: true as const }
            : { ok: false as const };
        } catch {
          return { ok: false as const };
        }
      },
      async admitIssuance(input) {
        try {
          const response = await client.rpc(
            "admit_turn_credential_issuance",
            {
              p_room_id: input.roomId,
              p_actor_user_id: input.actorUserId,
              p_request_id: input.requestId,
            },
          );
          if (response.error)
            return { ok: false as const, code: "unavailable" as const };
          const parsed = issuanceAdmissionSchema.safeParse(response.data);
          if (!parsed.success)
            return { ok: false as const, code: "unavailable" as const };
          if (parsed.data.outcome === "denied")
            return {
              ok: false as const,
              code: "rate_limited" as const,
              retryAfterSeconds: parsed.data.retryAfterSeconds,
            };
          return {
            ok: true as const,
            issuedAtSeconds: parsed.data.issuedAtSeconds,
          };
        } catch {
          return { ok: false as const, code: "unavailable" as const };
        }
      },
      issueCredentials(actorUserId, issuedAtSeconds) {
        try {
          const issued = createTurnIceServers({
            actorUserId,
            nowSeconds: issuedAtSeconds,
            config: turnConfig.config,
          });
          return { ok: true as const, ...issued };
        } catch {
          return { ok: false as const };
        }
      },
    },
  };
}
