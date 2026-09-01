import "server-only";

import { randomUUID } from "node:crypto";

import { z } from "zod";

import { privateHandRelayCapabilitySchema } from "@/lib/gesture/private-hand-relay-contract";
import type { PrivateHandRelaySessionRouteDependencies } from "@/lib/gesture/private-hand-relay-route";
import { createPrivateHandRelayToken } from "@/lib/gesture/private-hand-relay-token";
import { readBoundedUtf8Body } from "@/lib/http/read-bounded-body";
import type { SupabaseUserVerifier } from "@/lib/supabase/server-auth";
import {
  isPersistedRoomAccessActive,
  persistedRoomAccessRowSchema,
} from "@/lib/supabase/room-access";
import {
  createServerServiceClient,
  createServerUserVerifierClient,
  readServerSupabaseConfig,
} from "@/lib/supabase/server-client";

const MAX_CAPABILITY_RESPONSE_BYTES = 64 * 1_024;
const CAPABILITY_PROBE_TIMEOUT_MS = 1_500;

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

interface PrivateHandRelayServiceClient extends SupabaseUserVerifier {
  from(table: string): MembershipQueryBuilder;
  rpc(
    functionName: string,
    parameters: Record<string, unknown>,
  ): PromiseLike<{ data: unknown; error: unknown }>;
}

const admittedRelaySessionSchema = z
  .object({ outcome: z.literal("admitted") })
  .strict();
const deniedRelaySessionSchema = z
  .object({
    outcome: z.literal("denied"),
    code: z.enum([
      "hand_relay_global_burst_rate_limit",
      "hand_relay_global_daily_rate_limit",
      "hand_relay_actor_rate_limit",
      "hand_relay_room_rate_limit",
    ]),
    retryAfterSeconds: z.number().int().min(1).max(86_400),
  })
  .strict();
const relaySessionAdmissionSchema = z.union([
  admittedRelaySessionSchema,
  deniedRelaySessionSchema,
]);

interface ServerPrivateHandRelayOptions {
  environment?: Readonly<Record<string, string | undefined>>;
  createClient?: (config: {
    supabaseUrl: string;
    publishableKey: string;
    secretKey: string;
  }) => PrivateHandRelayServiceClient;
  fetch?: typeof fetch;
  now?: () => number;
  createUuid?: () => string;
}

export type ServerPrivateHandRelayDependenciesResult =
  | { ok: true; dependencies: PrivateHandRelaySessionRouteDependencies }
  | { ok: false };

export function isPrivateHandRelayConfigured(
  environment: Readonly<Record<string, string | undefined>> = process.env,
) {
  return (
    readPrivateHandRelayConfig(environment).ok &&
    readServerSupabaseConfig(environment).ok
  );
}

export function createServerPrivateHandRelayDependencies(
  options: ServerPrivateHandRelayOptions = {},
): ServerPrivateHandRelayDependenciesResult {
  const environment = options.environment ?? process.env;
  const relayConfig = readPrivateHandRelayConfig(environment);
  const supabaseConfig = readServerSupabaseConfig(environment);
  if (!relayConfig.ok || !supabaseConfig.ok) return { ok: false };

  let client: PrivateHandRelayServiceClient;
  let verifier: SupabaseUserVerifier;
  try {
    client = options.createClient
      ? options.createClient(supabaseConfig.config)
      : createServerServiceClient<PrivateHandRelayServiceClient>(
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

  const fetcher = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  const createUuid = options.createUuid ?? randomUUID;

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
      async startSession(input) {
        // Admission is deliberately evaluated before the network probe. A
        // denied anonymous/demo identity must not be able to spend relay
        // bandwidth or wake the private service merely by requesting tokens.
        const admission = await admitPrivateHandRelaySession(
          client,
          input.roomId,
          input.actorUserId,
        );
        if (!admission.ok) return admission;

        const capability = await probePrivateHandRelayCapability(
          relayConfig.origin,
          input.signal,
          fetcher,
        );
        if (!capability.ok || !capability.value.ready)
          return { ok: false as const, code: "relay_unavailable" as const };

        try {
          const sessionId = z.uuid().parse(createUuid());
          const jti = z.uuid().parse(createUuid());
          const nowSeconds = Math.floor(now() / 1_000);
          const token = createPrivateHandRelayToken({
            roomId: input.roomId,
            actorUserId: input.actorUserId,
            sessionId,
            jti,
            nowSeconds,
            ttlSeconds: relayConfig.tokenTtlSeconds,
            signingKey: relayConfig.signingKey,
          });
          return {
            ok: true as const,
            relay: {
              protocol: capability.value.protocol,
              roomId: input.roomId,
              actorUserId: input.actorUserId,
              websocketUrl: websocketUrl(relayConfig.origin),
              token,
              expiresAt: new Date(
                (nowSeconds + relayConfig.tokenTtlSeconds) * 1_000,
              ).toISOString(),
              capability: capability.value,
            },
          };
        } catch {
          return { ok: false as const, code: "relay_unavailable" as const };
        }
      },
    },
  };
}

async function admitPrivateHandRelaySession(
  client: PrivateHandRelayServiceClient,
  roomId: string,
  actorUserId: string,
) {
  try {
    const response = await client.rpc("admit_private_hand_relay_session", {
      p_room_id: roomId,
      p_actor_user_id: actorUserId,
    });
    if (response.error)
      return { ok: false as const, code: "relay_unavailable" as const };
    const parsed = relaySessionAdmissionSchema.safeParse(response.data);
    if (!parsed.success)
      return { ok: false as const, code: "relay_unavailable" as const };
    if (parsed.data.outcome === "denied")
      return {
        ok: false as const,
        code: "rate_limited" as const,
        retryAfterSeconds: parsed.data.retryAfterSeconds,
      };
    return { ok: true as const };
  } catch {
    return { ok: false as const, code: "relay_unavailable" as const };
  }
}

type PrivateHandRelayConfigResult =
  | {
      ok: true;
      origin: string;
      signingKey: Uint8Array;
      tokenTtlSeconds: number;
    }
  | { ok: false };

export function readPrivateHandRelayConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): PrivateHandRelayConfigResult {
  if (environment.PRIVATE_HAND_RELAY_ENABLED?.trim() !== "true")
    return { ok: false };
  const rawOrigin = environment.PRIVATE_HAND_RELAY_ORIGIN?.trim() ?? "";
  let origin: URL;
  try {
    origin = new URL(rawOrigin);
  } catch {
    return { ok: false };
  }
  if (
    origin.protocol !== "https:" ||
    origin.username !== "" ||
    origin.password !== "" ||
    (origin.pathname !== "" && origin.pathname !== "/") ||
    origin.search !== "" ||
    origin.hash !== ""
  )
    return { ok: false };
  const encodedKey =
    environment.PRIVATE_HAND_RELAY_SIGNING_KEY?.trim() ?? "";
  if (!/^[A-Za-z0-9_-]+$/.test(encodedKey)) return { ok: false };
  const signingKey = Buffer.from(encodedKey, "base64url");
  if (
    signingKey.byteLength !== 32 ||
    signingKey.toString("base64url") !== encodedKey
  )
    return { ok: false };
  const rawTtl =
    environment.PRIVATE_HAND_RELAY_TOKEN_TTL_SECONDS?.trim() ?? "60";
  if (!/^\d+$/.test(rawTtl)) return { ok: false };
  const tokenTtlSeconds = Number(rawTtl);
  if (
    !Number.isSafeInteger(tokenTtlSeconds) ||
    tokenTtlSeconds < 15 ||
    tokenTtlSeconds > 120
  )
    return { ok: false };
  return {
    ok: true,
    origin: origin.origin,
    signingKey: new Uint8Array(signingKey),
    tokenTtlSeconds,
  };
}

async function probePrivateHandRelayCapability(
  origin: string,
  requestSignal: AbortSignal,
  fetcher: typeof fetch,
) {
  try {
    const timeoutSignal = AbortSignal.timeout(CAPABILITY_PROBE_TIMEOUT_MS);
    const signal = AbortSignal.any([requestSignal, timeoutSignal]);
    const response = await fetcher(`${origin}/v1/capabilities`, {
      method: "GET",
      headers: { accept: "application/json" },
      cache: "no-store",
      signal,
    });
    if (!response.ok) return { ok: false as const };
    const length = response.headers.get("content-length");
    if (length && /^\d+$/.test(length) && Number(length) > MAX_CAPABILITY_RESPONSE_BYTES)
      return { ok: false as const };
    const body = await readBoundedUtf8Body(
      response.body,
      MAX_CAPABILITY_RESPONSE_BYTES,
      signal,
    );
    if (!body.ok) return { ok: false as const };
    const parsed = privateHandRelayCapabilitySchema.safeParse(
      JSON.parse(body.text),
    );
    return parsed.success
      ? { ok: true as const, value: parsed.data }
      : { ok: false as const };
  } catch {
    return { ok: false as const };
  }
}

function websocketUrl(origin: string) {
  const url = new URL(origin);
  url.protocol = "wss:";
  url.pathname = "/v1/hand-pose";
  return url.toString();
}
