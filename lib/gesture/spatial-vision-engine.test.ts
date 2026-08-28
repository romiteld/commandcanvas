import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_SPATIAL_VISION_ENGINE_ID,
  MEDIA_PIPE_FALLBACK_SPATIAL_VISION_ENGINE_ID,
  PREFERRED_SPATIAL_VISION_ENGINE_ID,
  createDefaultSpatialVisionEngine,
  createDefaultSpatialVisionEnginePlan,
  createMediaPipeSpatialVisionEngine,
  createYoloSpatialVisionEngine,
} from "@/lib/gesture/spatial-vision-engine";

describe("spatial vision engine contract", () => {
  it("describes the legacy MediaPipe path as the labeled 21-keypoint fallback", async () => {
    const detector = {
      detectForVideo: vi.fn(),
      close: vi.fn(),
    };
    const loadDetector = vi.fn(async () => detector);
    const engine = createMediaPipeSpatialVisionEngine({ loadDetector });

    expect(engine.descriptor).toMatchObject({
      id: MEDIA_PIPE_FALLBACK_SPATIAL_VISION_ENGINE_ID,
      role: "fallback",
      output: "hand-pose-keypoints",
      keypointCount: 21,
      runtime: "mediapipe-tasks-vision",
    });
    expect(engine.worker).toEqual({
      scriptUrl: "/workers/hand-landmarker.js",
      name: "commandcanvas-hand-tracker",
    });

    await expect(
      engine.loadDetector(engine.detectorLoadOptions),
    ).resolves.toBe(detector);
    expect(loadDetector).toHaveBeenCalledWith(engine.detectorLoadOptions);
  });

  it("selects YOLO as primary and MediaPipe only for initialization/runtime fallback", () => {
    expect(DEFAULT_SPATIAL_VISION_ENGINE_ID).toBe(
      PREFERRED_SPATIAL_VISION_ENGINE_ID,
    );
    expect(createDefaultSpatialVisionEngine().descriptor.id).toBe(
      PREFERRED_SPATIAL_VISION_ENGINE_ID,
    );
    const plan = createDefaultSpatialVisionEnginePlan();
    expect(plan.primary.descriptor.id).toBe(PREFERRED_SPATIAL_VISION_ENGINE_ID);
    expect(plan.fallback.descriptor.id).toBe(
      MEDIA_PIPE_FALLBACK_SPATIAL_VISION_ENGINE_ID,
    );
    expect(plan.fallbackOn).toEqual(["initialization-error", "runtime-error"]);
  });

  it("provides the pinned YOLO 21-keypoint engine as the current default", async () => {
    const detector = {
      detectForVideo: vi.fn(),
      close: vi.fn(),
    };
    const loadDetector = vi.fn(async () => detector);
    const engine = createYoloSpatialVisionEngine({ loadDetector });

    expect(engine.descriptor).toMatchObject({
      id: PREFERRED_SPATIAL_VISION_ENGINE_ID,
      role: "default",
      output: "hand-pose-keypoints",
      keypointCount: 21,
      runtime: "onnx-runtime-web",
      evidence: {
        targetDeviceBenchmark: "required-for-replacement",
        licenseReview: "agpl-3.0-source-release",
      },
    });
    expect(engine.worker).toEqual({
      scriptUrl: "/workers/yolo-hand-pose.js",
      name: "commandcanvas-yolo-hand-pose",
    });
    await expect(
      engine.loadDetector(engine.detectorLoadOptions),
    ).resolves.toBe(detector);
  });

  it("keeps the exact current model and same-origin WASM initialization explicit", () => {
    const engine = createMediaPipeSpatialVisionEngine({
      loadDetector: vi.fn(),
    });

    expect(engine.detectorLoadOptions).toEqual({
      wasmBaseUrl: "/mediapipe/wasm",
      modelAssetUrl:
        "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
      runningMode: "VIDEO",
      numHands: 2,
    });
  });

  it("does not describe the MediaPipe recovery adapter as the current default", () => {
    const engine = createMediaPipeSpatialVisionEngine({
      loadDetector: vi.fn(),
    });

    expect(engine.descriptor.evidence).toMatchObject({
      targetDeviceBenchmark: "required-for-replacement",
      licenseReview: "verified-candidate",
    });
  });
});
