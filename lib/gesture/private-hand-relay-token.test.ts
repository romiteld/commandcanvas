// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  createPrivateHandRelayToken,
  verifyPrivateHandRelayToken,
} from "@/lib/gesture/private-hand-relay-token";

const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const ACTOR_ID = "22222222-2222-4222-8222-222222222222";
const SESSION_ID = "33333333-3333-4333-8333-333333333333";
const JTI = "44444444-4444-4444-8444-444444444444";
const KEY = new Uint8Array(32).fill(19);

describe("private hand relay token", () => {
  it("mints a short-lived room, actor, and session-bound capability", () => {
    const token = createPrivateHandRelayToken({
      roomId: ROOM_ID,
      actorUserId: ACTOR_ID,
      sessionId: SESSION_ID,
      jti: JTI,
      nowSeconds: 1_788_000_000,
      ttlSeconds: 60,
      signingKey: KEY,
    });

    expect(token.startsWith("ccr1.")).toBe(true);
    expect(token).not.toContain(Buffer.from(KEY).toString("base64url"));
    expect(
      verifyPrivateHandRelayToken(token, {
        signingKey: KEY,
        nowSeconds: 1_788_000_030,
      }),
    ).toEqual({
      ok: true,
      claims: {
        version: 1,
        issuer: "commandcanvas",
        audience: "commandcanvas-private-hand-relay",
        roomId: ROOM_ID,
        actorUserId: ACTOR_ID,
        sessionId: SESSION_ID,
        jti: JTI,
        issuedAt: 1_788_000_000,
        expiresAt: 1_788_000_060,
      },
    });
  });

  it("rejects tampering, expiry, wrong keys, and overlong capabilities", () => {
    const input = {
      roomId: ROOM_ID,
      actorUserId: ACTOR_ID,
      sessionId: SESSION_ID,
      jti: JTI,
      nowSeconds: 1_788_000_000,
      ttlSeconds: 60,
      signingKey: KEY,
    } as const;
    const token = createPrivateHandRelayToken(input);
    const [prefix, payload, signature] = token.split(".");

    expect(
      verifyPrivateHandRelayToken(`${prefix}.${payload}x.${signature}`, {
        signingKey: KEY,
        nowSeconds: 1_788_000_030,
      }),
    ).toEqual({ ok: false, code: "invalid_token" });
    expect(
      verifyPrivateHandRelayToken(token, {
        signingKey: new Uint8Array(32).fill(20),
        nowSeconds: 1_788_000_030,
      }),
    ).toEqual({ ok: false, code: "invalid_token" });
    expect(
      verifyPrivateHandRelayToken(token, {
        signingKey: KEY,
        nowSeconds: 1_788_000_061,
      }),
    ).toEqual({ ok: false, code: "expired_token" });
    expect(() =>
      createPrivateHandRelayToken({ ...input, ttlSeconds: 121 }),
    ).toThrow();
  });
});
