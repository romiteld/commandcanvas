import { describe, expect, it, vi } from "vitest";

import { createHandTrackingWorkerRuntime } from "@/lib/gesture/hand-tracking-worker-core";

function landmarks(): Array<{
  x: number;
  y: number;
  z: number;
  visibility?: number;
}> {
  return Array.from({ length: 21 }, (_, index) => ({
    x: index / 25,
    y: index / 30,
    z: 0,
  }));
}

describe("hand tracking worker runtime", () => {
  it("initializes two-hand VIDEO detection from same-origin asset paths", async () => {
    const detectForVideo = vi.fn();
    const loadDetector = vi.fn(async () => ({ detectForVideo, close: vi.fn() }));
    const postMessage = vi.fn();
    const runtime = createHandTrackingWorkerRuntime({ loadDetector, postMessage });

    await runtime.handleMessage({
      type: "initialize",
      wasmBaseUrl: "/mediapipe/wasm",
      modelAssetUrl: "/mediapipe/hand_landmarker.task",
    });

    expect(loadDetector).toHaveBeenCalledWith({
      wasmBaseUrl: "/mediapipe/wasm",
      modelAssetUrl: "/mediapipe/hand_landmarker.task",
      runningMode: "VIDEO",
      numHands: 2,
    });
    expect(postMessage).toHaveBeenCalledWith({ type: "ready" });
  });

  it("reports the actual detector provider no later than engine readiness", async () => {
    const postMessage = vi.fn();
    const runtime = createHandTrackingWorkerRuntime({
      loadDetector: async () => ({
        detectForVideo: vi.fn(),
        getDiagnostics: () => ({
          executionProvider: "webgpu" as const,
          highPerformanceGpuRequested: true,
          adapter: { architecture: "ampere", description: "NVIDIA GPU" },
        }),
        close: vi.fn(),
      }),
      postMessage,
    });

    await runtime.handleMessage({
      type: "initialize",
      wasmBaseUrl: "/onnxruntime/",
      modelAssetUrl: "/models/hand.onnx",
    });

    const diagnostics = {
      executionProvider: "webgpu",
      highPerformanceGpuRequested: true,
      adapter: { architecture: "ampere", description: "NVIDIA GPU" },
    } as const;
    expect(postMessage).toHaveBeenNthCalledWith(1, {
      type: "ready",
      diagnostics,
    });
    expect(postMessage).toHaveBeenNthCalledWith(2, {
      type: "diagnostics",
      diagnostics,
    });
  });

  it("closes each frame and transports two tagged landmark sets", async () => {
    const close = vi.fn();
    const frame = { close } as unknown as ImageBitmap;
    const leftHand = landmarks();
    const rightHand = landmarks().map((point) => ({
      ...point,
      x: Math.min(1, point.x + 0.05),
    }));
    const detector = {
      detectForVideo: vi.fn(() => ({
        landmarks: [leftHand, rightHand],
        handedness: [
          [{ score: 0.93, categoryName: "Left" }],
          [{ score: 0.91, displayName: "Right" }],
        ],
      })),
      close: vi.fn(),
    };
    const postMessage = vi.fn();
    const runtime = createHandTrackingWorkerRuntime({
      loadDetector: async () => detector,
      postMessage,
    });
    await runtime.handleMessage({
      type: "initialize",
      wasmBaseUrl: "/mediapipe/wasm",
      modelAssetUrl: "/mediapipe/hand_landmarker.task",
    });

    await runtime.handleMessage({ type: "frame", frame, timestamp: 42 });

    expect(detector.detectForVideo).toHaveBeenCalledWith(frame, 42);
    expect(close).toHaveBeenCalledOnce();
    expect(postMessage).toHaveBeenLastCalledWith({
      type: "result",
      timestamp: 42,
      processingLatencyMs: expect.any(Number),
      hands: [
        { handedness: "left", confidence: 0.93, landmarks: leftHand },
        { handedness: "right", confidence: 0.91, landmarks: rightHand },
      ],
    });
    expect(postMessage.mock.lastCall?.[0]).not.toHaveProperty("frame");
  });

  it("preserves a detected hand when MediaPipe places a landmark just beyond the frame edge", async () => {
    const close = vi.fn();
    const frame = { close } as unknown as ImageBitmap;
    const detected = landmarks();
    detected[0] = { ...detected[0], y: 1.030_235_767_364_502 };
    const postMessage = vi.fn();
    const runtime = createHandTrackingWorkerRuntime({
      loadDetector: async () => ({
        detectForVideo: () => ({
          landmarks: [detected],
          handedness: [[{ score: 0.903_369_545_936_584_5, categoryName: "Left" }]],
        }),
        close: vi.fn(),
      }),
      postMessage,
    });
    await runtime.handleMessage({
      type: "initialize",
      wasmBaseUrl: "/mediapipe/wasm",
      modelAssetUrl: "/mediapipe/hand_landmarker.task",
    });

    await runtime.handleMessage({ type: "frame", frame, timestamp: 48 });

    expect(close).toHaveBeenCalledOnce();
    expect(postMessage).toHaveBeenLastCalledWith({
      type: "result",
      timestamp: 48,
      processingLatencyMs: expect.any(Number),
      hands: [
        {
          handedness: "left",
          confidence: 0.903_369_545_936_584_5,
          landmarks: detected.map((point, index) =>
            index === 0 ? { ...point, y: 1 } : point,
          ),
        },
      ],
    });
  });

  it("rejects an out-of-contract keypoint confidence from confidence-aware detectors", async () => {
    const frame = { close: vi.fn() } as unknown as ImageBitmap;
    const detected = landmarks();
    detected[8] = { ...detected[8], visibility: 1.5 };
    const postMessage = vi.fn();
    const runtime = createHandTrackingWorkerRuntime({
      loadDetector: async () => ({
        detectForVideo: () => ({
          landmarks: [detected],
          handedness: [[{ score: 0.9, categoryName: "Left" }]],
        }),
        close: vi.fn(),
      }),
      postMessage,
    });
    await runtime.handleMessage({
      type: "initialize",
      wasmBaseUrl: "/models",
      modelAssetUrl: "/models/confidence-aware-hand.onnx",
    });

    await runtime.handleMessage({ type: "frame", frame, timestamp: 52 });

    expect(postMessage).toHaveBeenLastCalledWith({
      type: "result",
      timestamp: 52,
      processingLatencyMs: expect.any(Number),
      hands: [],
    });
  });

  it("reports exact detector-call wall time from the injected monotonic clock", async () => {
    const times = [10, 34];
    const frame = { close: vi.fn() } as unknown as ImageBitmap;
    const postMessage = vi.fn();
    const runtime = createHandTrackingWorkerRuntime({
      loadDetector: async () => ({
        detectForVideo: async () => ({ landmarks: [], handedness: [] }),
        close: vi.fn(),
      }),
      postMessage,
      now: () => times.shift()!,
    });
    await runtime.handleMessage({
      type: "initialize",
      wasmBaseUrl: "/onnxruntime/",
      modelAssetUrl: "/models/hand.onnx",
    });

    await runtime.handleMessage({ type: "frame", frame, timestamp: 100 });

    expect(postMessage).toHaveBeenLastCalledWith({
      type: "result",
      timestamp: 100,
      hands: [],
      processingLatencyMs: 24,
    });
  });

  it("reports no hand without inventing a recognition result", async () => {
    const frame = { close: vi.fn() } as unknown as ImageBitmap;
    const postMessage = vi.fn();
    const runtime = createHandTrackingWorkerRuntime({
      loadDetector: async () => ({
        detectForVideo: () => ({ landmarks: [], handedness: [] }),
        close: vi.fn(),
      }),
      postMessage,
    });
    await runtime.handleMessage({
      type: "initialize",
      wasmBaseUrl: "/mediapipe/wasm",
      modelAssetUrl: "/mediapipe/hand_landmarker.task",
    });

    await runtime.handleMessage({ type: "frame", frame, timestamp: 84 });

    expect(postMessage).toHaveBeenLastCalledWith({
      type: "result",
      timestamp: 84,
      processingLatencyMs: expect.any(Number),
      hands: [],
    });
  });
});
