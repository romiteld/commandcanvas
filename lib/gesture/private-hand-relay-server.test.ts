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

function client(member: unknown = { role: "participant" }) {
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
    const started = await built.dependencies.startSession({
      roomId: ROOM_ID,
      actorUserId: ACTOR_ID,
      signal: new AbortController().signal,
    });

    expect(fetcher).toHaveBeenCalledWith(
      "https://hand.example.test/v1/capabilities",
      expect.objectContaining({ method: "GET", cache: "no-store" }),
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
});
