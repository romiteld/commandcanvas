// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
  handlePrivateHandRelaySessionRequest,
  type PrivateHandRelaySessionRouteDependencies,
} from "@/lib/gesture/private-hand-relay-route";
import { PRIVATE_HAND_RELAY_PROTOCOL } from "@/lib/gesture/private-hand-relay-contract";

const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const ACTOR_ID = "22222222-2222-4222-8222-222222222222";
const AUTHORIZATION = "Bearer header.payload.signature";

function dependencies(
  overrides: Partial<PrivateHandRelaySessionRouteDependencies> = {},
): PrivateHandRelaySessionRouteDependencies {
  return {
    verifier: {
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: { id: ACTOR_ID, is_anonymous: true } },
          error: null,
        })),
      },
    },
    verifyMembership: vi.fn(async () => ({ ok: true as const })),
    startSession: vi.fn(async () => ({
      ok: true as const,
      relay: {
        protocol: PRIVATE_HAND_RELAY_PROTOCOL,
        roomId: ROOM_ID,
        actorUserId: ACTOR_ID,
        websocketUrl: "wss://hand.example.test/v1/hand-pose",
        token: "ccr1.payload.signature",
        expiresAt: "2026-08-28T15:01:00.000Z",
        capability: {
          ok: true as const,
          protocol: PRIVATE_HAND_RELAY_PROTOCOL,
          service: "commandcanvas-private-hand-relay" as const,
          ready: true,
          warm: true,
          model: {
            id: "poptoz/yolo26-hand-pose-face-detection",
            revision: "1234567890abcdef1234567890abcdef12345678",
            format: "onnx" as const,
            keypoints: 21 as const,
            license: "AGPL-3.0" as const,
          },
          runtime: {
            provider: "cuda" as const,
            device: "NVIDIA GeForce RTX 3090",
            precision: "fp16" as const,
          },
          limits: {
            maxFrameBytes: 262_144,
            maxFps: 15,
            maxWidth: 640,
            maxHeight: 480,
            maxInFlight: 1 as const,
            newestFrameOnly: true as const,
          },
          privacy: {
            rawFramesPersisted: false as const,
            semanticResultsOnly: true as const,
            maxRetentionSeconds: 0 as const,
          },
        },
      },
    })),
    ...overrides,
  };
}

function request(input?: { authorization?: string | null; consent?: boolean }) {
  const headers = new Headers({ "content-type": "application/json" });
  if (input?.authorization !== null)
    headers.set("authorization", input?.authorization ?? AUTHORIZATION);
  return new Request(
    `https://commandcanvas.example/api/rooms/${ROOM_ID}/hand-relay/session`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({ cameraUploadConsent: input?.consent ?? true }),
    },
  );
}

describe("private hand relay session route", () => {
  it("stops reading a chunked request as soon as the body exceeds the limit", async () => {
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls > 20) {
          controller.close();
          return;
        }
        controller.enqueue(new Uint8Array(600));
      },
    });
    const oversized = new Request(
      `https://commandcanvas.example/api/rooms/${ROOM_ID}/hand-relay/session`,
      {
        method: "POST",
        headers: {
          authorization: AUTHORIZATION,
          "content-type": "application/json",
        },
        body,
        // Node requires this for a streaming request body.
        duplex: "half",
      } as RequestInit & { duplex: "half" },
    );

    const response = await handlePrivateHandRelaySessionRequest(
      oversized,
      ROOM_ID,
      dependencies(),
    );

    expect(response.status).toBe(413);
    expect(pulls).toBeLessThanOrEqual(3);
  });

  it("refuses unauthenticated requests before membership or relay work", async () => {
    const deps = dependencies();
    const response = await handlePrivateHandRelaySessionRequest(
      request({ authorization: null }),
      ROOM_ID,
      deps,
    );

    expect(response.status).toBe(401);
    expect(deps.verifyMembership).not.toHaveBeenCalled();
    expect(deps.startSession).not.toHaveBeenCalled();
  });

  it("requires explicit raw-camera upload consent", async () => {
    const deps = dependencies();
    const response = await handlePrivateHandRelaySessionRequest(
      request({ consent: false }),
      ROOM_ID,
      deps,
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      fallback: "local",
      error: { code: "camera_upload_consent_required" },
    });
    expect(deps.verifyMembership).not.toHaveBeenCalled();
    expect(deps.startSession).not.toHaveBeenCalled();
  });

  it("requires room membership before issuing an ephemeral relay token", async () => {
    const deps = dependencies({
      verifyMembership: vi.fn(async () => ({ ok: false as const })),
    });
    const response = await handlePrivateHandRelaySessionRequest(
      request(),
      ROOM_ID,
      deps,
    );

    expect(response.status).toBe(403);
    expect(deps.verifyMembership).toHaveBeenCalledWith(ROOM_ID, ACTOR_ID);
    expect(deps.startSession).not.toHaveBeenCalled();
  });

  it("returns a no-store room and actor-bound relay session", async () => {
    const deps = dependencies();
    const response = await handlePrivateHandRelaySessionRequest(
      request(),
      ROOM_ID,
      deps,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(deps.startSession).toHaveBeenCalledWith({
      roomId: ROOM_ID,
      actorUserId: ACTOR_ID,
      signal: expect.any(AbortSignal),
    });
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      relay: { roomId: ROOM_ID, actorUserId: ACTOR_ID },
    });
  });

  it("reports an honest local fallback when the private relay is unavailable", async () => {
    const deps = dependencies({
      startSession: vi.fn(async () => ({
        ok: false as const,
        code: "relay_unavailable" as const,
      })),
    });
    const response = await handlePrivateHandRelaySessionRequest(
      request(),
      ROOM_ID,
      deps,
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      fallback: "local",
      error: {
        code: "relay_unavailable",
        message: "Private GPU hand tracking is unavailable. Local tracking remains active.",
      },
    });
  });
});
