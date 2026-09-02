// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { createServerMeetingTurnDependencies } from "@/lib/meeting/turn-server";

const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const ACTOR_ID = "22222222-2222-4222-8222-222222222222";

function environment(overrides: Record<string, string | undefined> = {}) {
  return {
    NEXT_PUBLIC_SUPABASE_URL: "https://supabase.example.test",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-key",
    SUPABASE_SECRET_KEY: "service-secret",
    TURN_ENABLED: "true",
    TURN_URLS: "turn:turn.commandcanvas.example:3478?transport=udp",
    TURN_SHARED_SECRET: "owner-managed-coturn-secret-with-enough-entropy",
    TURN_TOKEN_TTL_SECONDS: "600",
    TURN_COTURN_USER_QUOTA: "4",
    TURN_COTURN_TOTAL_QUOTA: "32",
    TURN_COTURN_MAX_BPS: "2000000",
    ...overrides,
  };
}

function client(
  member: unknown = {
    role: "participant",
    rooms: {
      mode: "demo",
      created_at: "2026-09-01T00:00:00.000Z",
      demo_hard_expires_at: "2099-09-02T00:00:00.000Z",
    },
  },
  admission: { data: unknown; error: unknown } = {
    data: {
      outcome: "admitted",
      issuedAtSeconds: 1_788_000_000,
      replayed: false,
    },
    error: null,
  },
) {
  const query = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(async () => ({ data: member, error: null })),
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  return {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: ACTOR_ID } },
        error: null,
      })),
    },
    from: vi.fn(() => query),
    rpc: vi.fn(async () => admission),
    query,
  };
}

describe("server TURN dependencies", () => {
  it("stays unavailable unless TURN and Supabase are configured", () => {
    expect(
      createServerMeetingTurnDependencies({
        environment: environment({ TURN_ENABLED: "false" }),
      }),
    ).toEqual({ ok: false });
    expect(
      createServerMeetingTurnDependencies({
        environment: environment({ SUPABASE_SECRET_KEY: undefined }),
      }),
    ).toEqual({ ok: false });
    expect(
      createServerMeetingTurnDependencies({
        environment: environment({ TURN_COTURN_USER_QUOTA: undefined }),
      }),
    ).toEqual({ ok: false });
  });

  it("verifies active room membership and issues an actor-bound credential", async () => {
    const fakeClient = client();
    const built = createServerMeetingTurnDependencies({
      environment: environment(),
      createClient: () => fakeClient,
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    await expect(
      built.dependencies.verifyMembership(ROOM_ID, ACTOR_ID),
    ).resolves.toEqual({ ok: true });
    expect(fakeClient.query.select).toHaveBeenCalledWith(
      "role, rooms!inner(mode,created_at,demo_hard_expires_at)",
    );
    const admitted = await built.dependencies.admitIssuance({
      roomId: ROOM_ID,
      actorUserId: ACTOR_ID,
      requestId: "33333333-3333-4333-8333-333333333333",
    });
    expect(admitted).toEqual({
      ok: true,
      issuedAtSeconds: 1_788_000_000,
    });
    expect(fakeClient.rpc).toHaveBeenCalledWith(
      "admit_turn_credential_issuance",
      {
        p_room_id: ROOM_ID,
        p_actor_user_id: ACTOR_ID,
        p_request_id: "33333333-3333-4333-8333-333333333333",
      },
    );
    const issued = await built.dependencies.issueCredentials(
      ACTOR_ID,
      1_788_000_000,
    );
    expect(issued).toMatchObject({
      ok: true,
      expiresAt: "2026-08-29T10:50:00.000Z",
      iceServers: [
        { urls: ["stun:stun.l.google.com:19302"] },
        {
          urls: ["turn:turn.commandcanvas.example:3478?transport=udp"],
          username: `1788000600:${ACTOR_ID}`,
        },
      ],
    });
  });

  it("preserves durable rate-limit retry metadata and refuses malformed admission output", async () => {
    const rateLimitedClient = client(undefined, {
      data: {
        outcome: "denied",
        code: "turn_actor_rate_limit",
        retryAfterSeconds: 41,
      },
      error: null,
    });
    const limited = createServerMeetingTurnDependencies({
      environment: environment(),
      createClient: () => rateLimitedClient,
    });
    expect(limited.ok).toBe(true);
    if (limited.ok)
      await expect(
        limited.dependencies.admitIssuance({
          roomId: ROOM_ID,
          actorUserId: ACTOR_ID,
          requestId: "33333333-3333-4333-8333-333333333333",
        }),
      ).resolves.toEqual({
        ok: false,
        code: "rate_limited",
        retryAfterSeconds: 41,
      });

    const malformedClient = client(undefined, { data: {}, error: null });
    const malformed = createServerMeetingTurnDependencies({
      environment: environment(),
      createClient: () => malformedClient,
    });
    expect(malformed.ok).toBe(true);
    if (malformed.ok)
      await expect(
        malformed.dependencies.admitIssuance({
          roomId: ROOM_ID,
          actorUserId: ACTOR_ID,
          requestId: "33333333-3333-4333-8333-333333333333",
        }),
      ).resolves.toEqual({ ok: false, code: "unavailable" });
  });

  it("fails membership closed after a demo room expires", async () => {
    const fakeClient = client({
      role: "participant",
      rooms: {
        mode: "demo",
        created_at: "2026-08-30T00:00:00.000Z",
        demo_hard_expires_at: "2026-08-31T00:00:00.000Z",
      },
    });
    const built = createServerMeetingTurnDependencies({
      environment: environment(),
      createClient: () => fakeClient,
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    await expect(
      built.dependencies.verifyMembership(ROOM_ID, ACTOR_ID),
    ).resolves.toEqual({ ok: false });
  });
});
