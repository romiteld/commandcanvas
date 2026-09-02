// @vitest-environment node

import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  createTurnIceServers,
  readTurnCredentialConfig,
} from "@/lib/meeting/turn-credentials";

const ACTOR_ID = "11111111-1111-4111-8111-111111111111";

function environment(overrides: Record<string, string | undefined> = {}) {
  return {
    TURN_ENABLED: "true",
    TURN_URLS:
      "turn:turn.commandcanvas.example:3478?transport=udp,turns:turn.commandcanvas.example:5349?transport=tcp",
    TURN_SHARED_SECRET: "owner-managed-coturn-secret-with-enough-entropy",
    TURN_TOKEN_TTL_SECONDS: "600",
    TURN_COTURN_USER_QUOTA: "4",
    TURN_COTURN_TOTAL_QUOTA: "32",
    TURN_COTURN_MAX_BPS: "2000000",
    ...overrides,
  };
}

describe("short-lived coturn credentials", () => {
  it("mints an actor-bound TURN REST credential without exposing the shared secret", () => {
    const parsed = readTurnCredentialConfig(environment());
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    const result = createTurnIceServers({
      actorUserId: ACTOR_ID,
      nowSeconds: 1_788_000_000,
      config: parsed.config,
    });
    const username = `1788000600:${ACTOR_ID}`;
    const expectedCredential = createHmac(
      "sha1",
      "owner-managed-coturn-secret-with-enough-entropy",
    )
      .update(username)
      .digest("base64");

    expect(result).toEqual({
      expiresAt: "2026-08-29T10:50:00.000Z",
      iceServers: [
        { urls: ["stun:stun.l.google.com:19302"] },
        {
          urls: [
            "turn:turn.commandcanvas.example:3478?transport=udp",
            "turns:turn.commandcanvas.example:5349?transport=tcp",
          ],
          username,
          credential: expectedCredential,
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain(
      "owner-managed-coturn-secret-with-enough-entropy",
    );
  });

  it("fails closed for disabled, malformed, non-TURN, weak-secret, or excessive configurations", () => {
    for (const candidate of [
      environment({ TURN_ENABLED: "false" }),
      environment({ TURN_URLS: "https://turn.example.test" }),
      environment({ TURN_SHARED_SECRET: "too-short" }),
      environment({ TURN_TOKEN_TTL_SECONDS: "86400" }),
      environment({ TURN_COTURN_USER_QUOTA: undefined }),
      environment({ TURN_COTURN_USER_QUOTA: "0" }),
      environment({ TURN_COTURN_TOTAL_QUOTA: "2" }),
      environment({ TURN_COTURN_MAX_BPS: "100" }),
      environment({
        TURN_URLS: Array.from(
          { length: 9 },
          (_, index) => `turn:turn${index}.example.test:3478`,
        ).join(","),
      }),
    ])
      expect(readTurnCredentialConfig(candidate)).toEqual({ ok: false });
  });
});
