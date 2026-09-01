import { describe, expect, it, vi } from "vitest";

import {
  createPrivateHandRelaySpatialVisionEngine,
  createAdaptivePrivateHandRelayFrameEncoder,
  createPrivateHandRelayWorker,
  type PrivateHandRelayFrameEncoder,
} from "@/lib/gesture/private-hand-relay-worker";
import {
  PRIVATE_HAND_RELAY_PROTOCOL,
  type PrivateHandRelayResult,
  type PrivateHandRelaySession,
} from "@/lib/gesture/private-hand-relay-contract";
import type {
  PrivateHandRelayTransport,
  PrivateHandRelayTransportMetrics,
} from "@/lib/gesture/private-hand-relay-client";

const ROOM_ID = "11111111-1111-4111-8111-111111111111";

function session(): PrivateHandRelaySession {
  return {
    protocol: PRIVATE_HAND_RELAY_PROTOCOL,
    roomId: ROOM_ID,
    actorUserId: "22222222-2222-4222-8222-222222222222",
    websocketUrl: "wss://hand.example.test/v1/hand-pose",
    token: "ccr1.payload.signature",
    expiresAt: "2026-08-28T15:01:00.000Z",
    capability: {
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
        device: "NVIDIA GeForce RTX 3090 Ti",
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
    },
  };
}

function bitmap(name: string) {
  return {
    name,
    width: 1280,
    height: 720,
    close: vi.fn(),
  } as unknown as ImageBitmap & { name: string; close: ReturnType<typeof vi.fn> };
}

async function flush() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("private hand relay worker endpoint", () => {
  it("uses a model-neutral engine identity while retaining the AGPL relay-source review", () => {
    expect(createPrivateHandRelaySpatialVisionEngine().descriptor).toMatchObject({
      id: "private-gpu-hand-relay-v1",
      displayName: "Private GPU Hand Relay",
      evidence: { licenseReview: "agpl-3.0-source-release" },
    });
  });

  it("does not request a session without current explicit camera-upload consent", async () => {
    const requestSession = vi.fn();
    const worker = createPrivateHandRelayWorker({
      roomId: ROOM_ID,
      getAccessToken: vi.fn(async () => "access-token"),
      cameraUploadConsent: () => false,
      requestSession,
    });
    const messages: unknown[] = [];
    worker.onmessage = (event) => messages.push(event.data);

    worker.postMessage({
      type: "initialize",
      wasmBaseUrl: "private-relay",
      modelAssetUrl: "private-relay",
    });
    await flush();

    expect(requestSession).not.toHaveBeenCalled();
    expect(messages).toContainEqual({
      type: "error",
      message: "Private GPU camera upload consent is not active.",
    });
  });

  it("requests the exact room/token session and reports truthful provider metadata only after relay readiness", async () => {
    const requestSession = vi.fn(
      async (input: Parameters<NonNullable<Parameters<typeof createPrivateHandRelayWorker>[0]["requestSession"]>>[0]) => {
        void input;
        return { ok: true as const, relay: session() };
      },
    );
    let signal: AbortSignal | undefined;
    let announceReady: (() => void) | undefined;
    const stop = vi.fn();
    const createTransport = vi.fn((input) => {
      announceReady = input.onReady;
      return { enqueueFrame: vi.fn(() => true), stop } satisfies PrivateHandRelayTransport;
    });
    const worker = createPrivateHandRelayWorker({
      roomId: ROOM_ID,
      getAccessToken: vi.fn(async () => "exact-room-access-token"),
      cameraUploadConsent: () => true,
      requestSession: async (input) => {
        signal = input.signal;
        return requestSession(input);
      },
      createTransport,
    });
    const messages: unknown[] = [];
    worker.onmessage = (event) => messages.push(event.data);

    worker.postMessage({
      type: "initialize",
      wasmBaseUrl: "private-relay",
      modelAssetUrl: "private-relay",
    });
    await flush();

    expect(requestSession).toHaveBeenCalledWith(
      expect.objectContaining({
        roomId: ROOM_ID,
        accessToken: "exact-room-access-token",
        cameraUploadConsent: true,
        signal: expect.any(AbortSignal),
      }),
    );
    expect(messages).toEqual([]);

    announceReady?.();
    expect(messages).toContainEqual({
      type: "ready",
      diagnostics: expect.objectContaining({
        executionProvider: "cuda",
        processingLocation: "private-relay",
        highPerformanceGpuRequested: false,
        adapter: { description: "NVIDIA GeForce RTX 3090 Ti" },
      }),
    });

    worker.terminate();
    expect(signal?.aborted).toBe(true);
    expect(stop).toHaveBeenCalledOnce();
  });

  it("encodes one frame at a time, retains one newest raw bitmap, and reports pipeline metrics", async () => {
    let now = 0;
    let resolveFirst!: (blob: Blob) => void;
    const firstEncoding = new Promise<Blob>((resolve) => {
      resolveFirst = resolve;
    });
    const encodeFrame = vi
      .fn<PrivateHandRelayFrameEncoder>()
      .mockImplementationOnce(async () => firstEncoding)
      .mockResolvedValue(new Blob(["encoded"], { type: "image/webp" }));
    let onResult:
      | ((
          result: PrivateHandRelayResult,
          metrics: PrivateHandRelayTransportMetrics,
        ) => void)
      | undefined;
    let announceReady: (() => void) | undefined;
    const enqueueFrame = vi.fn(() => true);
    const worker = createPrivateHandRelayWorker({
      roomId: ROOM_ID,
      getAccessToken: async () => "access-token",
      cameraUploadConsent: () => true,
      requestSession: async () => ({ ok: true, relay: session() }),
      createTransport: (input) => {
        announceReady = input.onReady;
        onResult = input.onResult as typeof onResult;
        return { enqueueFrame, stop: vi.fn() };
      },
      encodeFrame,
      now: () => now,
    });
    const messages: unknown[] = [];
    worker.onmessage = (event) => messages.push(event.data);
    worker.postMessage({ type: "initialize", wasmBaseUrl: "", modelAssetUrl: "" });
    await flush();
    announceReady?.();

    const first = bitmap("first");
    const stale = bitmap("stale");
    const newest = bitmap("newest");
    worker.postMessage({ type: "frame", frame: first, timestamp: 100 }, [first]);
    worker.postMessage({ type: "frame", frame: stale, timestamp: 110 }, [stale]);
    worker.postMessage({ type: "frame", frame: newest, timestamp: 120 }, [newest]);

    expect(stale.close).toHaveBeenCalledOnce();
    now = 5;
    resolveFirst(new Blob(["first"], { type: "image/webp" }));
    await flush();

    expect(encodeFrame).toHaveBeenNthCalledWith(
      1,
      first,
      expect.objectContaining({ maxBytes: 131_072, maxWidth: 640, maxHeight: 480 }),
    );
    expect(first.close).toHaveBeenCalledOnce();
    expect(enqueueFrame).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ type: "image/webp" }),
      100,
    );
    expect(encodeFrame).toHaveBeenCalledTimes(1);
    expect(newest.close).not.toHaveBeenCalled();

    const landmarks = Array.from({ length: 21 }, (_, index) => ({
      x: index / 40,
      y: index / 40,
      z: 0,
      visibility: 0.95,
    }));
    now = 100;
    onResult?.(
      {
        type: "result",
        protocol: PRIVATE_HAND_RELAY_PROTOCOL,
        frameId: 1,
        capturedAtMs: 100,
        processedAtMs: 124,
        hands: [
          {
            confidence: 0.97,
            handedness: "right",
            handednessConfidence: 0.96,
            predicted: true,
            landmarks,
          },
        ],
      },
      { relayRoundTripMs: 35, droppedBeforeSend: 0 },
    );
    await flush();
    expect(messages).toContainEqual({
      type: "result",
      timestamp: 100,
      hands: [
        {
          confidence: 0.97,
          handedness: "right",
          handednessConfidence: 0.96,
          predicted: true,
          landmarks,
        },
      ],
      processingLatencyMs: 24,
      relayMetrics: {
        encodeLatencyMs: 5,
        relayRoundTripMs: 35,
        droppedBeforeEncode: 1,
        droppedBeforeSend: 0,
      },
    });
    expect(encodeFrame).toHaveBeenNthCalledWith(
      2,
      newest,
      expect.objectContaining({ maxBytes: 131_072, maxWidth: 640, maxHeight: 480 }),
    );
    expect(newest.close).toHaveBeenCalledOnce();
    expect(enqueueFrame).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ type: "image/webp" }),
      120,
    );
  });

  it("waits for the negotiated frame cadence before encoding the newest raw bitmap", async () => {
    let now = 0;
    let scheduled: (() => void) | null = null;
    let scheduledDelay = 0;
    let onResult:
      | ((
          result: PrivateHandRelayResult,
          metrics: PrivateHandRelayTransportMetrics,
        ) => void)
      | undefined;
    let announceReady: (() => void) | undefined;
    const encodeFrame = vi.fn(async () =>
      new Blob(["encoded"], { type: "image/webp" }),
    );
    const worker = createPrivateHandRelayWorker({
      roomId: ROOM_ID,
      getAccessToken: async () => "access-token",
      cameraUploadConsent: () => true,
      requestSession: async () => ({ ok: true, relay: session() }),
      createTransport: (input) => {
        announceReady = input.onReady;
        onResult = input.onResult as typeof onResult;
        return { enqueueFrame: vi.fn(() => true), stop: vi.fn() };
      },
      encodeFrame,
      now: () => now,
      setTimeout(callback, delayMs) {
        scheduled = callback;
        scheduledDelay = delayMs;
        return 7;
      },
      clearTimeout: vi.fn(),
    });
    worker.postMessage({ type: "initialize", wasmBaseUrl: "", modelAssetUrl: "" });
    await flush();
    announceReady?.();

    const first = bitmap("first");
    worker.postMessage({ type: "frame", frame: first, timestamp: 100 });
    await flush();
    const newest = bitmap("newest");
    worker.postMessage({ type: "frame", frame: newest, timestamp: 110 });
    now = 10;
    onResult?.(
      {
        type: "result",
        protocol: PRIVATE_HAND_RELAY_PROTOCOL,
        frameId: 1,
        capturedAtMs: 100,
        processedAtMs: 105,
        hands: [],
      },
      { relayRoundTripMs: 10, droppedBeforeSend: 0 },
    );

    expect(encodeFrame).toHaveBeenCalledTimes(1);
    expect(scheduledDelay).toBe(57);
    now = 67;
    (scheduled as (() => void) | null)?.();
    await flush();
    expect(encodeFrame).toHaveBeenCalledTimes(2);
    expect(newest.close).toHaveBeenCalledOnce();
  });

  it("rejects an encoder result above the bounded source-frame byte limit", async () => {
    let announceReady: (() => void) | undefined;
    const enqueueFrame = vi.fn(() => true);
    const worker = createPrivateHandRelayWorker({
      roomId: ROOM_ID,
      getAccessToken: async () => "access-token",
      cameraUploadConsent: () => true,
      requestSession: async () => ({ ok: true, relay: session() }),
      createTransport: (input) => {
        announceReady = input.onReady;
        return { enqueueFrame, stop: vi.fn() };
      },
      encodeFrame: vi.fn(async () =>
        new Blob([new Uint8Array(131_073)], { type: "image/webp" }),
      ),
    });
    const messages: unknown[] = [];
    worker.onmessage = (event) => messages.push(event.data);
    worker.postMessage({ type: "initialize", wasmBaseUrl: "", modelAssetUrl: "" });
    await flush();
    announceReady?.();

    const frame = bitmap("oversized");
    worker.postMessage({ type: "frame", frame, timestamp: 100 });
    await flush();

    expect(enqueueFrame).not.toHaveBeenCalled();
    expect(frame.close).toHaveBeenCalledOnce();
    expect(messages).toContainEqual({
      type: "error",
      message: "Private GPU relay rejected the encoded camera frame.",
    });
  });

  it("closes queued bitmaps and the relay when stopped or consent is revoked", async () => {
    let consent = true;
    let announceReady: (() => void) | undefined;
    const stop = vi.fn();
    const worker = createPrivateHandRelayWorker({
      roomId: ROOM_ID,
      getAccessToken: async () => "access-token",
      cameraUploadConsent: () => consent,
      requestSession: async () => ({ ok: true, relay: session() }),
      createTransport: (input) => {
        announceReady = input.onReady;
        return { enqueueFrame: vi.fn(() => true), stop };
      },
      encodeFrame: vi.fn(async () => new Blob(["frame"], { type: "image/webp" })),
    });
    const messages: unknown[] = [];
    worker.onmessage = (event) => messages.push(event.data);
    worker.postMessage({ type: "initialize", wasmBaseUrl: "", modelAssetUrl: "" });
    await flush();
    announceReady?.();

    consent = false;
    const revoked = bitmap("revoked");
    worker.postMessage({ type: "frame", frame: revoked, timestamp: 100 });
    await flush();

    expect(revoked.close).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledOnce();
    expect(messages).toContainEqual({
      type: "error",
      message: "Private GPU camera upload consent was revoked.",
    });
  });

  it("preserves aspect ratio, adapts quality through 480/JPEG, and reuses the successful profile", async () => {
    const originalOffscreenCanvas = globalThis.OffscreenCanvas;
    const attempts: Array<{
      width: number;
      height: number;
      type: string;
      quality: number;
    }> = [];
    let conversions = 0;
    class FakeOffscreenCanvas {
      constructor(
        readonly width: number,
        readonly height: number,
      ) {}

      getContext() {
        return { drawImage: vi.fn() };
      }

      async convertToBlob(options: { type: string; quality: number }) {
        attempts.push({ width: this.width, height: this.height, ...options });
        conversions += 1;
        const accepted = conversions === 5 || conversions === 6;
        return new Blob(
          [new Uint8Array(accepted ? 100_000 : 140_000)],
          { type: options.type },
        );
      }
    }
    Object.defineProperty(globalThis, "OffscreenCanvas", {
      configurable: true,
      value: FakeOffscreenCanvas,
    });
    try {
      const encoder = createAdaptivePrivateHandRelayFrameEncoder();
      const frame = bitmap("source");
      const limits = { maxBytes: 131_072, maxWidth: 640, maxHeight: 480 };

      const first = await encoder(frame, limits);
      expect(first.type).toBe("image/jpeg");
      expect(attempts.slice(0, 5)).toEqual([
        { width: 640, height: 360, type: "image/webp", quality: 0.78 },
        { width: 640, height: 360, type: "image/webp", quality: 0.62 },
        { width: 640, height: 360, type: "image/webp", quality: 0.48 },
        { width: 480, height: 270, type: "image/webp", quality: 0.52 },
        { width: 480, height: 270, type: "image/jpeg", quality: 0.58 },
      ]);

      await encoder(frame, limits);
      expect(attempts[5]).toEqual({
        width: 480,
        height: 270,
        type: "image/jpeg",
        quality: 0.58,
      });
    } finally {
      Object.defineProperty(globalThis, "OffscreenCanvas", {
        configurable: true,
        value: originalOffscreenCanvas,
      });
    }
  });
});
