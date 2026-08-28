import "server-only";

import { createHmac } from "node:crypto";

import { z } from "zod";

import type { RealtimeSessionRouteDependencies } from "@/lib/realtime-voice/route-handler";
import { createRealtimeVoiceSessionConfig } from "@/lib/realtime-voice/tools";
import type { SupabaseUserVerifier } from "@/lib/supabase/server-auth";
import {
  createServerServiceClient,
  createServerUserVerifierClient,
  readServerSupabaseConfig,
} from "@/lib/supabase/server-client";

const memberSchema = z
  .object({
    role: z.enum(["host", "participant"]),
    rooms: z.object({ mode: z.enum(["standard", "demo"]) }).strict(),
  })
  .strict();

interface MembershipQueryResult {
  data: unknown;
  error: unknown;
}

interface MembershipQueryBuilder {
  select: (columns: string) => MembershipQueryBuilder;
  eq: (column: string, value: unknown) => MembershipQueryBuilder;
  maybeSingle: () => PromiseLike<MembershipQueryResult>;
}

interface RealtimeServiceClient extends SupabaseUserVerifier {
  from: (table: string) => MembershipQueryBuilder;
  rpc: (
    functionName: string,
    parameters: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: unknown }>;
}

const admittedSessionSchema = z
  .object({ outcome: z.literal("admitted") })
  .strict();
const deniedSessionSchema = z
  .object({
    outcome: z.literal("denied"),
    code: z.enum([
      "voice_actor_rate_limit",
      "voice_actor_daily_limit",
      "voice_room_daily_limit",
      "voice_global_daily_limit",
    ]),
    retryAfterSeconds: z.number().int().min(1).max(86_400),
  })
  .strict();
const wrongRoomSessionSchema = z
  .object({
    outcome: z.literal("denied"),
    code: z.literal("voice_demo_room_required"),
  })
  .strict();
const sessionAdmissionSchema = z.union([
  admittedSessionSchema,
  deniedSessionSchema,
  wrongRoomSessionSchema,
]);

interface ServerRealtimeDependenciesOptions {
  environment?: Readonly<Record<string, string | undefined>>;
  createClient?: (config: {
    supabaseUrl: string;
    publishableKey: string;
    secretKey: string;
  }) => RealtimeServiceClient;
  fetch?: typeof fetch;
}

export type ServerRealtimeDependenciesResult =
  | { ok: true; dependencies: RealtimeSessionRouteDependencies }
  | { ok: false };

export function createServerRealtimeSessionDependencies(
  options: ServerRealtimeDependenciesOptions = {},
): ServerRealtimeDependenciesResult {
  const environment = options.environment ?? process.env;
  const supabaseConfig = readServerSupabaseConfig(environment);
  const enabled = environment.REALTIME_VOICE_ENABLED?.trim() === "true";
  const apiKey = environment.OPENAI_REALTIME_API_KEY?.trim() ?? "";
  if (!enabled || !supabaseConfig.ok || apiKey.length < 20)
    return { ok: false };

  let client: RealtimeServiceClient;
  let verifier: SupabaseUserVerifier;
  try {
    client = options.createClient
      ? options.createClient(supabaseConfig.config)
      : createServerServiceClient<RealtimeServiceClient>(supabaseConfig.config);
    verifier = options.createClient
      ? client
      : createServerUserVerifierClient<SupabaseUserVerifier>(
          supabaseConfig.config,
        );
  } catch {
    return { ok: false };
  }
  const fetcher = options.fetch ?? fetch;
  const safetySecret = supabaseConfig.config.secretKey;

  return {
    ok: true,
    dependencies: {
      verifier,
      async verifyMembership(roomId, actorUserId) {
        try {
          const response = await client
            .from("room_members")
            .select("role, rooms!inner(mode)")
            .eq("room_id", roomId)
            .eq("user_id", actorUserId)
            .maybeSingle();
          const member = memberSchema.safeParse(response.data);
          return !response.error && member.success
            ? { ok: true, roomMode: member.data.rooms.mode }
            : { ok: false };
        } catch {
          return { ok: false };
        }
      },
      async admitSession(roomId, actorUserId) {
        try {
          const response = await client.rpc("admit_realtime_voice_session", {
            p_room_id: roomId,
            p_actor_user_id: actorUserId,
          });
          if (response.error)
            return { ok: false as const, code: "admission_unavailable" as const };
          const parsed = sessionAdmissionSchema.safeParse(response.data);
          if (!parsed.success)
            return { ok: false as const, code: "admission_unavailable" as const };
          if (parsed.data.outcome === "denied") {
            if (parsed.data.code === "voice_demo_room_required")
              return {
                ok: false as const,
                code: "demo_room_required" as const,
              };
            return {
              ok: false as const,
              code: "rate_limited" as const,
              retryAfterSeconds: parsed.data.retryAfterSeconds,
            };
          }
          return { ok: true as const };
        } catch {
          return { ok: false as const, code: "admission_unavailable" as const };
        }
      },
      createCall: ({ sdp, safetyIdentifier, signal }) =>
        createOpenAiRealtimeCall(
          { apiKey, sdp, safetyIdentifier, signal },
          fetcher,
        ),
      safetyIdentifier: (actorUserId) =>
        createRealtimeSafetyIdentifier(actorUserId, safetySecret),
    },
  };
}

export async function createOpenAiRealtimeCall(
  input: {
    apiKey: string;
    sdp: string;
    safetyIdentifier: string;
    signal: AbortSignal;
  },
  fetcher: typeof fetch = fetch,
): Promise<{ ok: true; sdp: string } | { ok: false }> {
  const form = new FormData();
  form.set("sdp", input.sdp);
  form.set(
    "session",
    JSON.stringify(createRealtimeVoiceSessionConfig()),
  );
  try {
    const response = await fetcher(
      "https://api.openai.com/v1/realtime/calls",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${input.apiKey}`,
          "openai-safety-identifier": input.safetyIdentifier,
        },
        body: form,
        signal: input.signal,
      },
    );
    if (!response.ok) return { ok: false };
    const sdp = await response.text();
    return sdp.startsWith("v=0") && sdp.length <= 1_048_576
      ? { ok: true, sdp }
      : { ok: false };
  } catch {
    return { ok: false };
  }
}

export function createRealtimeSafetyIdentifier(
  actorUserId: string,
  serverSecret: string,
) {
  const digest = createHmac("sha256", serverSecret)
    .update(`commandcanvas-realtime:${actorUserId}`)
    .digest("hex")
    .slice(0, 24);
  return `cc_voice_${digest}`;
}
