// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
  handleMeetingTurnCredentialRequest,
  type MeetingTurnRouteDependencies,
} from "@/lib/meeting/turn-route";

const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const ACTOR_ID = "22222222-2222-4222-8222-222222222222";
const AUTHORIZATION = "Bearer header.payload.signature";
const REQUEST_ID = "33333333-3333-4333-8333-333333333333";

function dependencies(
  overrides: Partial<MeetingTurnRouteDependencies> = {},
): MeetingTurnRouteDependencies {
  return {
    verifier: {
      auth: {
        getUser: vi.fn(async () => ({
          data: {
            user: {
              id: ACTOR_ID,
              email: "danny@example.com",
              email_confirmed_at: "2026-09-01T12:00:00.000Z",
              is_anonymous: false,
            },
          },
          error: null,
        })),
      },
    },
    verifyMembership: vi.fn(async () => ({ ok: true as const })),
    admitIssuance: vi.fn(async () => ({
      ok: true as const,
      issuedAtSeconds: 1_788_000_000,
    })),
    issueCredentials: vi.fn((actorUserId, issuedAtSeconds) => ({
      ok: true as const,
      expiresAt: "2026-08-29T10:50:00.000Z",
      iceServers: [
        { urls: ["stun:stun.l.google.com:19302"] },
        {
          urls: ["turn:turn.commandcanvas.example:3478?transport=udp"],
          username: `${issuedAtSeconds + 600}:${actorUserId}`,
          credential: "ephemeral-credential",
        },
      ],
    })),
    ...overrides,
  };
}

function request(
  authorization: string | null = AUTHORIZATION,
  requestId: string | null = REQUEST_ID,
) {
  const headers = new Headers();
  if (authorization !== null) headers.set("authorization", authorization);
  if (requestId !== null) headers.set("idempotency-key", requestId);
  return new Request(
    `https://commandcanvas.example/api/rooms/${ROOM_ID}/media/turn`,
    { method: "POST", headers },
  );
}

describe("meeting TURN credential route", () => {
  it("default-denies anonymous demo identities before membership or admission", async () => {
    const deps = dependencies({
      verifier: {
        auth: {
          getUser: vi.fn(async () => ({
            data: { user: { id: ACTOR_ID, is_anonymous: true } },
            error: null,
          })),
        },
      },
    });
    const response = await handleMeetingTurnCredentialRequest(
      request(),
      ROOM_ID,
      deps,
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      fallback: "direct",
      error: { code: "permanent_email_auth_required" },
    });
    expect(deps.verifyMembership).not.toHaveBeenCalled();
    expect(deps.admitIssuance).not.toHaveBeenCalled();
    expect(deps.issueCredentials).not.toHaveBeenCalled();
  });

  it("refuses unauthenticated callers before membership or credential work", async () => {
    const deps = dependencies();
    const response = await handleMeetingTurnCredentialRequest(
      request(null),
      ROOM_ID,
      deps,
    );

    expect(response.status).toBe(401);
    expect(deps.verifyMembership).not.toHaveBeenCalled();
    expect(deps.admitIssuance).not.toHaveBeenCalled();
    expect(deps.issueCredentials).not.toHaveBeenCalled();
  });

  it("requires current room membership", async () => {
    const deps = dependencies({
      verifyMembership: vi.fn(async () => ({ ok: false as const })),
    });
    const response = await handleMeetingTurnCredentialRequest(
      request(),
      ROOM_ID,
      deps,
    );

    expect(response.status).toBe(403);
    expect(deps.admitIssuance).not.toHaveBeenCalled();
    expect(deps.issueCredentials).not.toHaveBeenCalled();
  });

  it("requires a UUID idempotency key before durable admission", async () => {
    const deps = dependencies();
    const response = await handleMeetingTurnCredentialRequest(
      request(AUTHORIZATION, null),
      ROOM_ID,
      deps,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: "idempotency_key_required" },
    });
    expect(deps.verifyMembership).not.toHaveBeenCalled();
    expect(deps.admitIssuance).not.toHaveBeenCalled();
  });

  it("returns one short-lived no-store actor-bound ICE configuration", async () => {
    const deps = dependencies();
    const response = await handleMeetingTurnCredentialRequest(
      request(),
      ROOM_ID,
      deps,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(deps.verifyMembership).toHaveBeenCalledWith(ROOM_ID, ACTOR_ID);
    expect(deps.admitIssuance).toHaveBeenCalledWith({
      roomId: ROOM_ID,
      actorUserId: ACTOR_ID,
      requestId: REQUEST_ID,
    });
    expect(deps.issueCredentials).toHaveBeenCalledWith(
      ACTOR_ID,
      1_788_000_000,
    );
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      expiresAt: "2026-08-29T10:50:00.000Z",
      iceServers: [
        { urls: ["stun:stun.l.google.com:19302"] },
        { username: `1788000600:${ACTOR_ID}` },
      ],
    });
  });

  it("returns a durable retry boundary without minting when admission is rate-limited", async () => {
    const deps = dependencies({
      admitIssuance: vi.fn(async () => ({
        ok: false as const,
        code: "rate_limited" as const,
        retryAfterSeconds: 37,
      })),
    });
    const response = await handleMeetingTurnCredentialRequest(
      request(),
      ROOM_ID,
      deps,
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("37");
    expect(deps.issueCredentials).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      fallback: "direct",
      error: { code: "turn_rate_limited" },
    });
  });

  it("reports direct-media fallback when TURN is not configured", async () => {
    const deps = dependencies({
      issueCredentials: vi.fn(() => ({ ok: false as const })),
    });
    const response = await handleMeetingTurnCredentialRequest(
      request(),
      ROOM_ID,
      deps,
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      fallback: "direct",
      error: {
        code: "turn_unavailable",
        message:
          "TURN relay credentials are unavailable. Direct meeting media may still connect.",
      },
    });
  });
});
