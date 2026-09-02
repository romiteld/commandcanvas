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
      minHandDetectionConfidence: 0.5,
      minHandPresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    expect(result).not.toBe(detector);
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

  it("treats MediaPipe's zero-filled landmark visibility as unavailable instead of invisible", async () => {
    const mediaPipeLandmarks = Array.from({ length: 21 }, (_, index) => ({
      x: 0.2 + index / 100,
      y: 0.3 + index / 100,
      z: 0,
      visibility: 0,
    }));
    const rawDetector = {
      detectForVideo: vi.fn(() => ({
        landmarks: [mediaPipeLandmarks],
        handedness: [[{ score: 0.91, categoryName: "Left" }]],
      })),
      close: vi.fn(),
    };
    const detector = await loadMediaPipeHandDetector(
      {
        wasmBaseUrl: "/mediapipe/wasm",
        modelAssetUrl: "/mediapipe/hand_landmarker.task",
        runningMode: "VIDEO",
        numHands: 2,
      },
      {
        resolveVisionTasks: vi.fn(async () => ({
          wasmLoaderPath: "/loader.js",
          wasmBinaryPath: "/binary.wasm",
        })),
        createDetector: vi.fn(async () => rawDetector),
      },
    );
    const frame = {} as ImageBitmap;

    const result = await detector.detectForVideo(frame, 42);

    expect(rawDetector.detectForVideo).toHaveBeenCalledWith(frame, 42);
    expect(result.landmarks[0]).toHaveLength(21);
    expect(result.landmarks[0]).toEqual(
      mediaPipeLandmarks.map((point) => ({
        x: point.x,
        y: point.y,
        z: point.z,
      })),
    );
    await detector.close();
    expect(rawDetector.close).toHaveBeenCalledOnce();
  });
});
