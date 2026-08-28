import { describe, expect, it, vi } from "vitest";

import {
  createPrivateHandRelayTransport,
  requestPrivateHandRelaySession,
  type PrivateHandRelayWebSocketLike,
} from "@/lib/gesture/private-hand-relay-client";
import { PRIVATE_HAND_RELAY_PROTOCOL } from "@/lib/gesture/private-hand-relay-contract";

const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const ACTOR_ID = "22222222-2222-4222-8222-222222222222";

function relaySession() {
  return {
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
  };
}

class FakeSocket implements PrivateHandRelayWebSocketLike {
  readyState = 0;
  bufferedAmount = 0;
  binaryType = "blob";
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  sent: unknown[] = [];
  close = vi.fn(() => {
    this.readyState = 3;
  });
  send(value: string | ArrayBufferLike | Blob | ArrayBufferView) {
    this.sent.push(value);
  }
  open() {
    this.readyState = 1;
    this.onopen?.(new Event("open"));
  }
  message(value: unknown) {
    this.onmessage?.(new MessageEvent("message", { data: value }));
  }
}

describe("private hand relay browser client", () => {
  it("does no network work without explicit camera upload consent", async () => {
    const fetcher = vi.fn();
    const result = await requestPrivateHandRelaySession({
      roomId: ROOM_ID,
      accessToken: "header.payload.signature",
      cameraUploadConsent: false,
      fetch: fetcher,
    });

    expect(result).toEqual({
      ok: false,
      code: "camera_upload_consent_required",
      fallback: "local",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("requests the server-minted session without exposing a static relay secret", async () => {
    const fetcher = vi.fn(async () =>
      new Response(JSON.stringify(relaySession()), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const result = await requestPrivateHandRelaySession({
      roomId: ROOM_ID,
      accessToken: "header.payload.signature",
      cameraUploadConsent: true,
      fetch: fetcher,
    });

    expect(result).toEqual(relaySession());
    expect(fetcher).toHaveBeenCalledWith(
      `/api/rooms/${ROOM_ID}/hand-relay/session`,
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer header.payload.signature",
        }),
        body: JSON.stringify({ cameraUploadConsent: true }),
      }),
    );
  });

  it("rejects a malformed successful session response distinctly from relay unavailability", async () => {
    const malformedJson = await requestPrivateHandRelaySession({
      roomId: ROOM_ID,
      accessToken: "header.payload.signature",
      cameraUploadConsent: true,
      fetch: vi.fn(async () =>
        new Response("{", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    });
    const malformedShape = await requestPrivateHandRelaySession({
      roomId: ROOM_ID,
      accessToken: "header.payload.signature",
      cameraUploadConsent: true,
      fetch: vi.fn(async () =>
        new Response(JSON.stringify({ ok: true, relay: {} }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    });

    expect(malformedJson).toEqual({
      ok: false,
      code: "invalid_relay_response",
      fallback: "local",
    });
    expect(malformedShape).toEqual({
      ok: false,
      code: "invalid_relay_response",
      fallback: "local",
    });
  });

  it("rejects a schema-valid relay session bound to a different room", async () => {
    const otherRoomId = "33333333-3333-4333-8333-333333333333";
    const response = relaySession();
    const result = await requestPrivateHandRelaySession({
      roomId: ROOM_ID,
      accessToken: "header.payload.signature",
      cameraUploadConsent: true,
      fetch: vi.fn(async () =>
        new Response(
          JSON.stringify({
            ...response,
            relay: { ...response.relay, roomId: otherRoomId },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
      ),
    });

    expect(result).toEqual({
      ok: false,
      code: "invalid_relay_response",
      fallback: "local",
    });
  });

  it("authenticates inside the socket and keeps only the newest waiting frame", () => {
    const socket = new FakeSocket();
    let now = 0;
    const onResult = vi.fn();
    const onFallback = vi.fn();
    const transport = createPrivateHandRelayTransport({
      session: relaySession().relay,
      cameraUploadConsent: true,
      createWebSocket: (url) => {
        expect(url).toBe("wss://hand.example.test/v1/hand-pose");
        expect(url).not.toContain("token");
        return socket;
      },
      onResult,
      onFallback,
      now: () => now,
    });
    socket.open();

    expect(JSON.parse(String(socket.sent[0]))).toEqual({
      type: "hello",
      protocol: PRIVATE_HAND_RELAY_PROTOCOL,
      token: "ccr1.payload.signature",
    });
    now = 100;
    socket.message(
      JSON.stringify({ type: "ready", protocol: PRIVATE_HAND_RELAY_PROTOCOL }),
    );
    transport.enqueueFrame(new Blob(["one"], { type: "image/webp" }), 100);
    transport.enqueueFrame(new Blob(["two"], { type: "image/webp" }), 110);
    transport.enqueueFrame(new Blob(["three"], { type: "image/webp" }), 120);

    expect(socket.sent).toHaveLength(3);
    expect(JSON.parse(String(socket.sent[1]))).toMatchObject({
      type: "frame",
      frameId: 1,
      capturedAtMs: 100,
    });
    expect(socket.sent[2]).toBeInstanceOf(Blob);

    now = 200;
    socket.message(
      JSON.stringify({
        type: "result",
        protocol: PRIVATE_HAND_RELAY_PROTOCOL,
        frameId: 1,
        capturedAtMs: 100,
        processedAtMs: 125,
        hands: [],
      }),
    );

    expect(socket.sent).toHaveLength(5);
    expect(JSON.parse(String(socket.sent[3]))).toMatchObject({
      type: "frame",
      frameId: 3,
      capturedAtMs: 120,
    });
    expect(onResult).toHaveBeenCalledTimes(1);
    expect(onFallback).not.toHaveBeenCalled();
  });

  it("fails closed to local tracking on malformed server output", () => {
    const socket = new FakeSocket();
    const onFallback = vi.fn();
    createPrivateHandRelayTransport({
      session: relaySession().relay,
      cameraUploadConsent: true,
      createWebSocket: () => socket,
      onResult: vi.fn(),
      onFallback,
    });
    socket.open();
    socket.message("not-json");

    expect(onFallback).toHaveBeenCalledWith("invalid_relay_message");
    expect(socket.close).toHaveBeenCalled();
  });

  it("falls back when the socket opens but never receives relay readiness", () => {
    vi.useFakeTimers();
    try {
      const socket = new FakeSocket();
      const onFallback = vi.fn();
      createPrivateHandRelayTransport({
        session: relaySession().relay,
        cameraUploadConsent: true,
        createWebSocket: () => socket,
        onResult: vi.fn(),
        onFallback,
        handshakeTimeoutMs: 75,
      });
      socket.open();

      vi.advanceTimersByTime(74);
      expect(onFallback).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);

      expect(onFallback).toHaveBeenCalledOnce();
      expect(onFallback).toHaveBeenCalledWith("relay_timeout");
      expect(socket.close).toHaveBeenCalledWith(1000, "local fallback");
    } finally {
      vi.useRealTimers();
    }
  });

  it("falls back when the socket remains stuck connecting", () => {
    vi.useFakeTimers();
    try {
      const socket = new FakeSocket();
      const onFallback = vi.fn();
      createPrivateHandRelayTransport({
        session: relaySession().relay,
        cameraUploadConsent: true,
        createWebSocket: () => socket,
        onResult: vi.fn(),
        onFallback,
        handshakeTimeoutMs: 75,
      });

      vi.advanceTimersByTime(74);
      expect(onFallback).not.toHaveBeenCalled();
      vi.advanceTimersByTime(1);

      expect(onFallback).toHaveBeenCalledOnce();
      expect(onFallback).toHaveBeenCalledWith("relay_timeout");
      expect(socket.close).toHaveBeenCalledWith(1000, "local fallback");
    } finally {
      vi.useRealTimers();
    }
  });

  it("falls back safely when sending the socket hello throws synchronously", () => {
    const socket = new FakeSocket();
    socket.send = () => {
      throw new Error("socket send failed");
    };
    const onFallback = vi.fn();
    createPrivateHandRelayTransport({
      session: relaySession().relay,
      cameraUploadConsent: true,
      createWebSocket: () => socket,
      onResult: vi.fn(),
      onFallback,
    });

    expect(() => socket.open()).not.toThrow();
    expect(onFallback).toHaveBeenCalledOnce();
    expect(onFallback).toHaveBeenCalledWith("connection_failed");
    expect(socket.close).toHaveBeenCalledWith(1000, "local fallback");
  });

  it.each([2, 3])(
    "falls back safely when frame socket send %i throws synchronously",
    (failingSend) => {
      const socket = new FakeSocket();
      let sendCount = 0;
      socket.send = (value) => {
        sendCount += 1;
        if (sendCount === failingSend) throw new Error("socket send failed");
        socket.sent.push(value);
      };
      const onFallback = vi.fn();
      const transport = createPrivateHandRelayTransport({
        session: relaySession().relay,
        cameraUploadConsent: true,
        createWebSocket: () => socket,
        onResult: vi.fn(),
        onFallback,
      });
      socket.open();
      socket.message(
        JSON.stringify({
          type: "ready",
          protocol: PRIVATE_HAND_RELAY_PROTOCOL,
        }),
      );

      expect(() =>
        transport.enqueueFrame(
          new Blob(["frame"], { type: "image/webp" }),
          100,
        ),
      ).not.toThrow();
      expect(onFallback).toHaveBeenCalledOnce();
      expect(onFallback).toHaveBeenCalledWith("connection_failed");
      expect(socket.close).toHaveBeenCalledWith(1000, "local fallback");
    },
  );

  it("honors the relay's advertised frame-rate ceiling", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    try {
      const socket = new FakeSocket();
      const transport = createPrivateHandRelayTransport({
        session: relaySession().relay,
        cameraUploadConsent: true,
        createWebSocket: () => socket,
        onResult: vi.fn(),
        onFallback: vi.fn(),
      });
      socket.open();
      socket.message(
        JSON.stringify({
          type: "ready",
          protocol: PRIVATE_HAND_RELAY_PROTOCOL,
        }),
      );
      transport.enqueueFrame(
        new Blob(["one"], { type: "image/webp" }),
        100,
      );
      transport.enqueueFrame(
        new Blob(["two"], { type: "image/webp" }),
        105,
      );
      socket.message(
        JSON.stringify({
          type: "result",
          protocol: PRIVATE_HAND_RELAY_PROTOCOL,
          frameId: 1,
          capturedAtMs: 100,
          processedAtMs: 110,
          hands: [],
        }),
      );

      expect(socket.sent).toHaveLength(3);
      vi.advanceTimersByTime(66);
      expect(socket.sent).toHaveLength(3);
      vi.advanceTimersByTime(1);
      expect(socket.sent).toHaveLength(5);
      transport.stop();
    } finally {
      vi.useRealTimers();
    }
  });
});
