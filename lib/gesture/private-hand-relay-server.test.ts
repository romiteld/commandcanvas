// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { PRIVATE_HAND_RELAY_PROTOCOL } from "@/lib/gesture/private-hand-relay-contract";
import { createServerPrivateHandRelayDependencies } from "@/lib/gesture/private-hand-relay-server";
import { verifyPrivateHandRelayToken } from "@/lib/gesture/private-hand-relay-token";

const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const ACTOR_ID = "22222222-2222-4222-8222-222222222222";
const SESSION_ID = "33333333-3333-4333-8333-333333333333";
const JTI = "44444444-4444-4444-8444-444444444444";
const SIGNING_KEY = new Uint8Array(32).fill(23);

function environment(overrides: Record<string, string | undefined> = {}) {
  return {
    NEXT_PUBLIC_SUPABASE_URL: "https://supabase.example.test",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-key",
    SUPABASE_SECRET_KEY: "service-secret",
    PRIVATE_HAND_RELAY_ENABLED: "true",
    PRIVATE_HAND_RELAY_ORIGIN: "https://hand.example.test",
    PRIVATE_HAND_RELAY_SIGNING_KEY: Buffer.from(SIGNING_KEY).toString(
      "base64url",
    ),
    PRIVATE_HAND_RELAY_TOKEN_TTL_SECONDS: "60",
    PRIVATE_HAND_RELAY_ALLOWED_ACTOR_IDS: ACTOR_ID,
    ...overrides,
  };
}

function capability(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    protocol: PRIVATE_HAND_RELAY_PROTOCOL,
    service: "commandcanvas-private-hand-relay",
    ready: true,
    warm: true,
    model: {
      id: "poptoz/yolo26-hand-pose-face-detection",
      revision: "1234567890abcdef1234567890abcdef12345678",
      format: "onnx",
      keypoints: 21,
      license: "AGPL-3.0",
    },
    runtime: {
      provider: "cuda",
      device: "NVIDIA GeForce RTX 3090",
      precision: "fp16",
    },
    limits: {
      maxFrameBytes: 262_144,
      maxFps: 15,
      maxWidth: 640,
      maxHeight: 480,
      maxInFlight: 1,
      newestFrameOnly: true,
    },
    privacy: {
      rawFramesPersisted: false,
      semanticResultsOnly: true,
      maxRetentionSeconds: 0,
    },
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
    data: { outcome: "admitted" },
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

describe("private hand relay server dependencies", () => {
  it("stops reading a chunked capability response once the size limit is exceeded", async () => {
    const fakeClient = client();
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls > 100) {
          controller.close();
          return;
        }
        controller.enqueue(new Uint8Array(1_024));
      },
    });
    const built = createServerPrivateHandRelayDependencies({
      environment: environment(),
      createClient: () => fakeClient,
      fetch: vi.fn(async () => new Response(stream, { status: 200 })),
      createUuid: vi.fn(() => SESSION_ID),
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    await expect(
      built.dependencies.startSession({
        roomId: ROOM_ID,
        actorUserId: ACTOR_ID,
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({ ok: false, code: "relay_unavailable" });
    expect(pulls).toBeLessThanOrEqual(66);
  });

  it("stays off unless explicitly enabled with HTTPS and a 32-byte key", () => {
    expect(
      createServerPrivateHandRelayDependencies({
        environment: environment({ PRIVATE_HAND_RELAY_ENABLED: "false" }),
      }),
    ).toEqual({ ok: false });
    expect(
      createServerPrivateHandRelayDependencies({
        environment: environment({
          PRIVATE_HAND_RELAY_ORIGIN: "http://192.0.2.10:8099",
        }),
      }),
    ).toEqual({ ok: false });
    expect(
      createServerPrivateHandRelayDependencies({
        environment: environment({
          PRIVATE_HAND_RELAY_SIGNING_KEY: Buffer.from("too-short").toString(
            "base64url",
          ),
        }),
      }),
    ).toEqual({ ok: false });
    expect(
      createServerPrivateHandRelayDependencies({
        environment: environment({
          PRIVATE_HAND_RELAY_ALLOWED_ACTOR_IDS: undefined,
        }),
      }),
    ).toEqual({ ok: false });
    expect(
      createServerPrivateHandRelayDependencies({
        environment: environment({
          PRIVATE_HAND_RELAY_ALLOWED_ACTOR_IDS: "not-a-user-id",
        }),
      }),
    ).toEqual({ ok: false });
  });

  it("authorizes only server-configured owner actor ids", async () => {
    const fakeClient = client();
    const built = createServerPrivateHandRelayDependencies({
      environment: environment(),
      createClient: () => fakeClient,
      fetch: vi.fn(),
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    await expect(built.dependencies.authorizeActor(ACTOR_ID)).resolves.toEqual({
      ok: true,
    });
    await expect(
      built.dependencies.authorizeActor(
        "55555555-5555-4555-8555-555555555555",
      ),
    ).resolves.toEqual({ ok: false });
    expect(fakeClient.query.maybeSingle).not.toHaveBeenCalled();
    expect(fakeClient.rpc).not.toHaveBeenCalled();
  });

  it("probes honest readiness then issues a short-lived room/user token", async () => {
    const fakeClient = client();
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify(capability()), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const ids = [SESSION_ID, JTI];
    const built = createServerPrivateHandRelayDependencies({
      environment: environment(),
      createClient: () => fakeClient,
      fetch: fetcher,
      now: () => 1_788_000_000_000,
      createUuid: () => ids.shift()!,
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    await expect(
      built.dependencies.verifyMembership(ROOM_ID, ACTOR_ID),
    ).resolves.toEqual({ ok: true });
    expect(fakeClient.query.select).toHaveBeenCalledWith(
      "role, rooms!inner(mode,created_at,demo_hard_expires_at)",
    );
    const started = await built.dependencies.startSession({
      roomId: ROOM_ID,
      actorUserId: ACTOR_ID,
      signal: new AbortController().signal,
    });

    expect(fetcher).toHaveBeenCalledWith(
      "https://hand.example.test/v1/capabilities",
      expect.objectContaining({ method: "GET", cache: "no-store" }),
    );
    expect(fakeClient.rpc).toHaveBeenCalledWith(
      "admit_private_hand_relay_session",
      {
        p_room_id: ROOM_ID,
        p_actor_user_id: ACTOR_ID,
      },
    );
    expect(started).toMatchObject({
      ok: true,
      relay: {
        websocketUrl: "wss://hand.example.test/v1/hand-pose",
        roomId: ROOM_ID,
        actorUserId: ACTOR_ID,
        expiresAt: "2026-08-29T10:41:00.000Z",
      },
    });
    if (!started.ok) return;
    expect(started.relay.websocketUrl).not.toContain(started.relay.token);
    expect(
      verifyPrivateHandRelayToken(started.relay.token, {
        signingKey: SIGNING_KEY,
        nowSeconds: 1_788_000_030,
      }),
    ).toMatchObject({
      ok: true,
      claims: {
        roomId: ROOM_ID,
        actorUserId: ACTOR_ID,
        sessionId: SESSION_ID,
        jti: JTI,
      },
    });
  });

  it("fails service-role membership closed after demo hard expiry", async () => {
    const fakeClient = client({
      role: "participant",
      rooms: {
        mode: "demo",
        created_at: "2026-08-30T00:00:00.000Z",
        demo_hard_expires_at: "2026-08-31T00:00:00.000Z",
      },
    });
    const built = createServerPrivateHandRelayDependencies({
      environment: environment(),
      createClient: () => fakeClient,
      fetch: vi.fn(),
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    await expect(
      built.dependencies.verifyMembership(ROOM_ID, ACTOR_ID),
    ).resolves.toEqual({ ok: false });
  });

  it("refuses cold or malformed capability reports instead of minting", async () => {
    const fakeClient = client();
    const createUuid = vi.fn(() => SESSION_ID);
    const built = createServerPrivateHandRelayDependencies({
      environment: environment(),
      createClient: () => fakeClient,
      fetch: vi.fn(async () =>
        new Response(
          JSON.stringify(
            capability({
              ready: false,
              warm: false,
              unavailableReason: "model_cold",
            }),
          ),
          { status: 200 },
        ),
      ),
      createUuid,
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    await expect(
      built.dependencies.startSession({
        roomId: ROOM_ID,
        actorUserId: ACTOR_ID,
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({ ok: false, code: "relay_unavailable" });
    expect(createUuid).not.toHaveBeenCalled();
  });

  it("fails closed before token minting when durable relay admission is denied or unavailable", async () => {
    for (const admission of [
      {
        data: {
          outcome: "denied",
          code: "hand_relay_actor_rate_limit",
          retryAfterSeconds: 83,
        },
        error: null,
      },
      { data: null, error: { message: "database unavailable" } },
    ]) {
      const fakeClient = client({ role: "participant" }, admission);
      const createUuid = vi.fn(() => SESSION_ID);
      const fetcher = vi.fn(async () =>
        new Response(JSON.stringify(capability()), { status: 200 }),
      );
      const built = createServerPrivateHandRelayDependencies({
        environment: environment(),
        createClient: () => fakeClient,
        fetch: fetcher,
        createUuid,
      });
      expect(built.ok).toBe(true);
      if (!built.ok) continue;

      const result = await built.dependencies.startSession({
        roomId: ROOM_ID,
        actorUserId: ACTOR_ID,
        signal: new AbortController().signal,
      });

      if (admission.error) {
        expect(result).toEqual({ ok: false, code: "relay_unavailable" });
      } else {
        expect(result).toEqual({
          ok: false,
          code: "rate_limited",
          retryAfterSeconds: 83,
        });
      }
      expect(createUuid).not.toHaveBeenCalled();
      expect(fetcher).not.toHaveBeenCalled();
    }
  });
});
