import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { z } from "zod";

const TOKEN_PREFIX = "ccr1";
const TOKEN_ISSUER = "commandcanvas";
const TOKEN_AUDIENCE = "commandcanvas-private-hand-relay";
const MAX_TOKEN_BYTES = 4_096;
const MIN_TTL_SECONDS = 15;
const MAX_TTL_SECONDS = 120;

const tokenClaimsSchema = z
  .object({
    version: z.literal(1),
    issuer: z.literal(TOKEN_ISSUER),
    audience: z.literal(TOKEN_AUDIENCE),
    roomId: z.uuid(),
    actorUserId: z.uuid(),
    sessionId: z.uuid(),
    jti: z.uuid(),
    issuedAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().positive(),
  })
  .strict()
  .refine(
    (value) =>
      value.expiresAt - value.issuedAt >= MIN_TTL_SECONDS &&
      value.expiresAt - value.issuedAt <= MAX_TTL_SECONDS,
    { message: "Relay capability lifetime is invalid." },
  );

export interface CreatePrivateHandRelayTokenInput {
  roomId: string;
  actorUserId: string;
  sessionId: string;
  jti: string;
  nowSeconds: number;
  ttlSeconds: number;
  signingKey: Uint8Array;
}

export interface VerifyPrivateHandRelayTokenOptions {
  signingKey: Uint8Array;
  nowSeconds: number;
}

export function createPrivateHandRelayToken(
  input: CreatePrivateHandRelayTokenInput,
) {
  assertSigningKey(input.signingKey);
  if (
    !Number.isInteger(input.nowSeconds) ||
    !Number.isInteger(input.ttlSeconds) ||
    input.ttlSeconds < MIN_TTL_SECONDS ||
    input.ttlSeconds > MAX_TTL_SECONDS
  )
    throw new Error("Private relay token timing is invalid.");
  const claims = tokenClaimsSchema.parse({
    version: 1,
    issuer: TOKEN_ISSUER,
    audience: TOKEN_AUDIENCE,
    roomId: input.roomId,
    actorUserId: input.actorUserId,
    sessionId: input.sessionId,
    jti: input.jti,
    issuedAt: input.nowSeconds,
    expiresAt: input.nowSeconds + input.ttlSeconds,
  });
  const payload = Buffer.from(JSON.stringify(claims), "utf8").toString(
    "base64url",
  );
  const signed = `${TOKEN_PREFIX}.${payload}`;
  const signature = sign(signed, input.signingKey).toString("base64url");
  return `${signed}.${signature}`;
}

export function verifyPrivateHandRelayToken(
  token: string,
  options: VerifyPrivateHandRelayTokenOptions,
):
  | { ok: true; claims: z.infer<typeof tokenClaimsSchema> }
  | {
      ok: false;
      code: "invalid_token" | "expired_token" | "not_yet_valid";
    } {
  try {
    assertSigningKey(options.signingKey);
    if (
      Buffer.byteLength(token, "utf8") > MAX_TOKEN_BYTES ||
      !Number.isInteger(options.nowSeconds)
    )
      return { ok: false, code: "invalid_token" };
    const parts = token.split(".");
    if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX)
      return { ok: false, code: "invalid_token" };
    const signed = `${parts[0]}.${parts[1]}`;
    const presented = Buffer.from(parts[2]!, "base64url");
    const expected = sign(signed, options.signingKey);
    if (
      presented.byteLength !== expected.byteLength ||
      !timingSafeEqual(presented, expected)
    )
      return { ok: false, code: "invalid_token" };
    const decoded = JSON.parse(
      Buffer.from(parts[1]!, "base64url").toString("utf8"),
    ) as unknown;
    const claims = tokenClaimsSchema.safeParse(decoded);
    if (!claims.success) return { ok: false, code: "invalid_token" };
    if (options.nowSeconds >= claims.data.expiresAt)
      return { ok: false, code: "expired_token" };
    if (options.nowSeconds + 30 < claims.data.issuedAt)
      return { ok: false, code: "not_yet_valid" };
    return { ok: true, claims: claims.data };
  } catch {
    return { ok: false, code: "invalid_token" };
  }
}

function assertSigningKey(signingKey: Uint8Array) {
  if (signingKey.byteLength !== 32)
    throw new Error("Private relay signing keys must contain exactly 32 bytes.");
}

function sign(value: string, signingKey: Uint8Array) {
  return createHmac("sha256", signingKey).update(value, "utf8").digest();
}
