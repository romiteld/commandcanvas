import "server-only";

import { createHmac } from "node:crypto";

import { z } from "zod";

const actorIdSchema = z.uuid();
const ttlSchema = z.coerce.number().int().min(60).max(3_600);
const userQuotaSchema = z.coerce.number().int().min(1).max(8);
const totalQuotaSchema = z.coerce.number().int().min(4).max(256);
const maxBpsSchema = z.coerce.number().int().min(64_000).max(20_000_000);
const turnUrlSchema = z
  .string()
  .trim()
  .min(8)
  .max(2_048)
  .refine((value) => value.startsWith("turn:") || value.startsWith("turns:"));

export interface TurnCredentialConfig {
  urls: readonly string[];
  sharedSecret: string;
  ttlSeconds: number;
  coturnBoundary: {
    userQuota: number;
    totalQuota: number;
    maxBps: number;
  };
}

export type TurnCredentialConfigResult =
  | { ok: true; config: TurnCredentialConfig }
  | { ok: false };

export function readTurnCredentialConfig(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): TurnCredentialConfigResult {
  if (environment.TURN_ENABLED !== "true") return { ok: false };
  const urls = (environment.TURN_URLS ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const parsedUrls = z.array(turnUrlSchema).min(1).max(8).safeParse(urls);
  const parsedSecret = z
    .string()
    .min(32)
    .max(1_024)
    .safeParse(environment.TURN_SHARED_SECRET);
  const parsedTtl = ttlSchema.safeParse(
    environment.TURN_TOKEN_TTL_SECONDS ?? "600",
  );
  const parsedUserQuota = userQuotaSchema.safeParse(
    environment.TURN_COTURN_USER_QUOTA,
  );
  const parsedTotalQuota = totalQuotaSchema.safeParse(
    environment.TURN_COTURN_TOTAL_QUOTA,
  );
  const parsedMaxBps = maxBpsSchema.safeParse(
    environment.TURN_COTURN_MAX_BPS,
  );
  if (
    !parsedUrls.success ||
    !parsedSecret.success ||
    !parsedTtl.success ||
    !parsedUserQuota.success ||
    !parsedTotalQuota.success ||
    !parsedMaxBps.success ||
    parsedTotalQuota.data < parsedUserQuota.data
  )
    return { ok: false };
  return {
    ok: true,
    config: {
      urls: parsedUrls.data,
      sharedSecret: parsedSecret.data,
      ttlSeconds: parsedTtl.data,
      coturnBoundary: {
        userQuota: parsedUserQuota.data,
        totalQuota: parsedTotalQuota.data,
        maxBps: parsedMaxBps.data,
      },
    },
  };
}

export function createTurnIceServers(input: {
  actorUserId: string;
  nowSeconds: number;
  config: TurnCredentialConfig;
}) {
  const actorUserId = actorIdSchema.parse(input.actorUserId);
  const nowSeconds = z.number().int().nonnegative().parse(input.nowSeconds);
  const expiresAtSeconds = nowSeconds + input.config.ttlSeconds;
  const username = `${expiresAtSeconds}:${actorUserId}`;
  const credential = createHmac("sha1", input.config.sharedSecret)
    .update(username)
    .digest("base64");

  return {
    expiresAt: new Date(expiresAtSeconds * 1_000).toISOString(),
    iceServers: [
      { urls: ["stun:stun.l.google.com:19302"] },
      {
        urls: [...input.config.urls],
        username,
        credential,
      },
    ] satisfies RTCIceServer[],
  };
}
