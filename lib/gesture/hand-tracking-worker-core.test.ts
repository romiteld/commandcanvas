import { describe, expect, it, vi } from "vitest";

import { createHandTrackingWorkerRuntime } from "@/lib/gesture/hand-tracking-worker-core";

function landmarks() {
  return Array.from({ length: 21 }, (_, index) => ({
    x: index / 25,
    y: index / 30,
    z: 0,
  }));
}

describe("hand tracking worker runtime", () => {
  it("initializes one-hand VIDEO detection from same-origin asset paths", async () => {
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
      numHands: 1,
    });
    expect(postMessage).toHaveBeenCalledWith({ type: "ready" });
  });

  it("closes each transferred frame and returns only semantic landmarks", async () => {
    const close = vi.fn();
    const frame = { close } as unknown as ImageBitmap;
    const hand = landmarks();
    const detector = {
      detectForVideo: vi.fn(() => ({
        landmarks: [hand],
        handedness: [[{ score: 0.93 }]],
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
      confidence: 0.93,
      landmarks: hand,
    });
    expect(postMessage.mock.lastCall?.[0]).not.toHaveProperty("frame");
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
      confidence: null,
      landmarks: null,
    });
  });
});
