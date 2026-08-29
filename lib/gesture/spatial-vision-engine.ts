import type {
  HandDetector,
  HandDetectorLoadOptions,
} from "@/lib/gesture/hand-tracking-worker-core";

export const MEDIA_PIPE_SPATIAL_VISION_ENGINE_ID =
  "mediapipe-hand-landmarker-v1" as const;
export const MEDIA_PIPE_IN_PAGE_RECOVERY_ENGINE_ID =
  "mediapipe-hand-landmarker-in-page-v1" as const;
export const DEFAULT_SPATIAL_VISION_ENGINE_ID =
  MEDIA_PIPE_SPATIAL_VISION_ENGINE_ID;
export const MEDIA_PIPE_HAND_LANDMARKER_MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task" as const;

export interface SpatialVisionEngineDescriptor {
  id: string;
  displayName: string;
  role: "default" | "candidate" | "fallback";
  runtime: string;
  output: "hand-pose-keypoints";
  keypointCount: 21;
  modelVersion: string;
  evidence: {
    targetDeviceBenchmark:
      | "required-for-replacement"
      | "recorded-target-device"
      | "live-target-device";
    licenseReview:
      | "verified-current-default"
      | "unverified-do-not-ship"
      | "verified-candidate"
      | "agpl-3.0-source-release";
  };
}

export interface SpatialVisionEngine {
  readonly descriptor: SpatialVisionEngineDescriptor;
  readonly detectorLoadOptions: HandDetectorLoadOptions;
  /**
   * A compatible worker is optional. Engines without one run through the
   * controller's in-page detector endpoint while keeping frames local.
   */
  readonly worker: {
    scriptUrl: string;
    name: string;
  } | null;
  loadDetector(options: HandDetectorLoadOptions): Promise<HandDetector>;
}

export interface MediaPipeSpatialVisionEngineDependencies {
  loadDetector?: (
    options: HandDetectorLoadOptions,
  ) => Promise<HandDetector>;
}

const MEDIA_PIPE_DETECTOR_OPTIONS: HandDetectorLoadOptions = {
  wasmBaseUrl: "/mediapipe/wasm",
  modelAssetUrl: MEDIA_PIPE_HAND_LANDMARKER_MODEL_URL,
  runningMode: "VIDEO",
  numHands: 2,
};

/**
 * Permissively licensed browser default. Camera frames remain local; only the
 * model file and WASM runtime are fetched when the user enables hand input.
 */
export function createMediaPipeSpatialVisionEngine(
  dependencies: MediaPipeSpatialVisionEngineDependencies = {},
): SpatialVisionEngine {
  return createMediaPipeEngine({
    dependencies,
    id: MEDIA_PIPE_SPATIAL_VISION_ENGINE_ID,
    displayName: "MediaPipe Hand Landmarker",
    role: "default",
    worker: {
      scriptUrl: "/workers/hand-landmarker.js",
      name: "commandcanvas-hand-tracker",
    },
  });
}

/**
 * Same model and package, but without a Worker requirement. This is an honest
 * recovery path for browsers whose worker canvas/runtime path fails; it is not
 * represented as a second or higher-performance detector.
 */
export function createMediaPipeInPageRecoveryEngine(
  dependencies: MediaPipeSpatialVisionEngineDependencies = {},
): SpatialVisionEngine {
  return createMediaPipeEngine({
    dependencies,
    id: MEDIA_PIPE_IN_PAGE_RECOVERY_ENGINE_ID,
    displayName: "MediaPipe Hand Landmarker (in-page recovery)",
    role: "fallback",
    worker: null,
  });
}

export function createDefaultSpatialVisionEngine(): SpatialVisionEngine {
  return createMediaPipeSpatialVisionEngine();
}

export interface SpatialVisionEnginePlan {
  primary: SpatialVisionEngine;
  fallback: SpatialVisionEngine;
  fallbackOn: readonly ["initialization-error", "runtime-error"];
}

export function createDefaultSpatialVisionEnginePlan(): SpatialVisionEnginePlan {
  return {
    primary: createMediaPipeSpatialVisionEngine(),
    fallback: createMediaPipeInPageRecoveryEngine(),
    fallbackOn: ["initialization-error", "runtime-error"],
  };
}

function createMediaPipeEngine(options: {
  readonly dependencies: MediaPipeSpatialVisionEngineDependencies;
  readonly id: string;
  readonly displayName: string;
  readonly role: "default" | "fallback";
  readonly worker: SpatialVisionEngine["worker"];
}): SpatialVisionEngine {
  const loadDetector =
    options.dependencies.loadDetector ??
    (async (detectorOptions: HandDetectorLoadOptions) => {
      const detectorModule = await import(
        "@/lib/gesture/mediapipe-hand-detector"
      );
      return detectorModule.loadMediaPipeHandDetector(detectorOptions);
    });
  return {
    descriptor: {
      id: options.id,
      displayName: options.displayName,
      role: options.role,
      runtime: "mediapipe-tasks-vision",
      output: "hand-pose-keypoints",
      keypointCount: 21,
      modelVersion: "float16-1",
      evidence: {
        targetDeviceBenchmark: "required-for-replacement",
        licenseReview:
          options.role === "default"
            ? "verified-current-default"
            : "verified-candidate",
      },
    },
    detectorLoadOptions: { ...MEDIA_PIPE_DETECTOR_OPTIONS },
    worker: options.worker,
    loadDetector,
  };
}
