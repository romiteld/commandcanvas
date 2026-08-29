import { describe, expect, it, vi } from "vitest";

import { loadMediaPipeHandDetector } from "@/lib/gesture/mediapipe-hand-detector";

describe("MediaPipe hand detector adapter", () => {
  it("loads the classic WASM fileset for the in-page recovery endpoint", async () => {
    const fileset = {
      wasmLoaderPath: "/module-loader.js",
      wasmBinaryPath: "/module-binary.wasm",
    };
    const detector = { detectForVideo: vi.fn(), close: vi.fn() };
    const resolveVisionTasks = vi.fn(async () => fileset);
    const createDetector = vi.fn(async () => detector);

    const result = await loadMediaPipeHandDetector(
      {
        wasmBaseUrl: "/mediapipe/wasm",
        modelAssetUrl: "/mediapipe/hand_landmarker.task",
        runningMode: "VIDEO",
        numHands: 2,
      },
      { resolveVisionTasks, createDetector },
    );

    expect(resolveVisionTasks).toHaveBeenCalledWith("/mediapipe/wasm", false);
    expect(createDetector).toHaveBeenCalledWith(fileset, {
      baseOptions: {
        modelAssetPath: "/mediapipe/hand_landmarker.task",
      },
      runningMode: "VIDEO",
      numHands: 2,
      minHandDetectionConfidence: 0.75,
      minHandPresenceConfidence: 0.75,
      minTrackingConfidence: 0.7,
    });
    expect(result).toBe(detector);
  });

  it("loads the module-compatible WASM fileset when explicitly running in a module worker", async () => {
    const fileset = {
      wasmLoaderPath: "/module-loader.js",
      wasmBinaryPath: "/module-binary.wasm",
    };
    const detector = { detectForVideo: vi.fn(), close: vi.fn() };
    const resolveVisionTasks = vi.fn(async () => fileset);
    const createDetector = vi.fn(async () => detector);

    await loadMediaPipeHandDetector(
      {
        wasmBaseUrl: "/mediapipe/wasm",
        modelAssetUrl: "/mediapipe/hand_landmarker.task",
        runningMode: "VIDEO",
        numHands: 2,
      },
      { resolveVisionTasks, createDetector },
      { useModule: true },
    );

    expect(resolveVisionTasks).toHaveBeenCalledWith("/mediapipe/wasm", true);
  });
});
