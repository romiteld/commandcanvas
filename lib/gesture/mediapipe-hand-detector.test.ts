import { describe, expect, it, vi } from "vitest";

import { loadMediaPipeHandDetector } from "@/lib/gesture/mediapipe-hand-detector";

describe("MediaPipe hand detector adapter", () => {
  it("loads the module-compatible WASM fileset for a module worker", async () => {
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
        numHands: 1,
      },
      { resolveVisionTasks, createDetector },
    );

    expect(resolveVisionTasks).toHaveBeenCalledWith("/mediapipe/wasm", true);
    expect(createDetector).toHaveBeenCalledWith(fileset, {
      baseOptions: {
        modelAssetPath: "/mediapipe/hand_landmarker.task",
      },
      runningMode: "VIDEO",
      numHands: 1,
      minHandDetectionConfidence: 0.75,
      minHandPresenceConfidence: 0.75,
      minTrackingConfidence: 0.7,
    });
    expect(result).toBe(detector);
  });
});
