import { describe, expect, it, vi } from "vitest";

import {
  DEFAULT_SPATIAL_VISION_ENGINE_ID,
  MEDIA_PIPE_HAND_LANDMARKER_MODEL_URL,
  MEDIA_PIPE_IN_PAGE_RECOVERY_ENGINE_ID,
  MEDIA_PIPE_SPATIAL_VISION_ENGINE_ID,
  createDefaultSpatialVisionEngine,
  createDefaultSpatialVisionEnginePlan,
  createMediaPipeInPageRecoveryEngine,
  createMediaPipeSpatialVisionEngine,
} from "@/lib/gesture/spatial-vision-engine";

describe("spatial vision engine contract", () => {
  it("uses the permissively licensed MediaPipe 21-keypoint worker as the browser default", async () => {
    const detector = { detectForVideo: vi.fn(), close: vi.fn() };
    const loadDetector = vi.fn(async () => detector);
    const engine = createMediaPipeSpatialVisionEngine({ loadDetector });

    expect(DEFAULT_SPATIAL_VISION_ENGINE_ID).toBe(
      MEDIA_PIPE_SPATIAL_VISION_ENGINE_ID,
    );
    expect(engine.descriptor).toMatchObject({
      id: MEDIA_PIPE_SPATIAL_VISION_ENGINE_ID,
      role: "default",
      output: "hand-pose-keypoints",
      keypointCount: 21,
      runtime: "mediapipe-tasks-vision",
      evidence: { licenseReview: "verified-current-default" },
    });
    expect(engine.worker).toEqual({
      scriptUrl: "/workers/hand-landmarker.js",
      name: "commandcanvas-hand-tracker",
    });
    await expect(engine.loadDetector(engine.detectorLoadOptions)).resolves.toBe(
      detector,
    );
  });

  it("keeps an in-page MediaPipe recovery endpoint without another model/runtime", () => {
    const recovery = createMediaPipeInPageRecoveryEngine({
      loadDetector: vi.fn(),
    });

    expect(recovery.descriptor).toMatchObject({
      id: MEDIA_PIPE_IN_PAGE_RECOVERY_ENGINE_ID,
      role: "fallback",
      runtime: "mediapipe-tasks-vision",
      keypointCount: 21,
    });
    expect(recovery.worker).toBeNull();
    expect(recovery.detectorLoadOptions).toEqual(
      createMediaPipeSpatialVisionEngine({ loadDetector: vi.fn() })
        .detectorLoadOptions,
    );
  });

  it("selects MediaPipe worker then MediaPipe in-page recovery in the browser plan", () => {
    expect(createDefaultSpatialVisionEngine().descriptor.id).toBe(
      MEDIA_PIPE_SPATIAL_VISION_ENGINE_ID,
    );
    const plan = createDefaultSpatialVisionEnginePlan();
    expect(plan.primary.descriptor.id).toBe(MEDIA_PIPE_SPATIAL_VISION_ENGINE_ID);
    expect(plan.fallback.descriptor.id).toBe(
      MEDIA_PIPE_IN_PAGE_RECOVERY_ENGINE_ID,
    );
    expect(plan.fallbackOn).toEqual(["initialization-error", "runtime-error"]);
  });

  it("retrieves only the official MediaPipe model after hand input is enabled", () => {
    const engine = createMediaPipeSpatialVisionEngine({
      loadDetector: vi.fn(),
    });

    expect(engine.detectorLoadOptions).toEqual({
      wasmBaseUrl: "/mediapipe/wasm",
      modelAssetUrl: MEDIA_PIPE_HAND_LANDMARKER_MODEL_URL,
      runningMode: "VIDEO",
      numHands: 2,
    });
  });
});
