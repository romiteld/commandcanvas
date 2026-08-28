import type {
  HandDetector,
  HandDetectorLoadOptions,
} from "@/lib/gesture/hand-tracking-worker-core";
import { YOLO_HAND_POSE_MODEL_URL } from "@/lib/gesture/yolo-hand-pose-detector";

export const MEDIA_PIPE_FALLBACK_SPATIAL_VISION_ENGINE_ID =
  "mediapipe-hand-landmarker-v1" as const;
export const PREFERRED_SPATIAL_VISION_ENGINE_ID =
  "yolo26-hand-pose-2abb91" as const;
export const DEFAULT_SPATIAL_VISION_ENGINE_ID =
  PREFERRED_SPATIAL_VISION_ENGINE_ID;

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

export interface YoloSpatialVisionEngineDependencies {
  loadDetector?: (
    options: HandDetectorLoadOptions,
  ) => Promise<HandDetector>;
}

const MEDIA_PIPE_DETECTOR_OPTIONS: HandDetectorLoadOptions = {
  wasmBaseUrl: "/mediapipe/wasm",
  modelAssetUrl:
    "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
  runningMode: "VIDEO",
  numHands: 2,
};

/**
 * Explicit recovery engine. CommandCanvas starts YOLO first and reaches this
 * adapter only after a reported YOLO initialization or runtime failure.
 */
export function createMediaPipeSpatialVisionEngine(
  dependencies: MediaPipeSpatialVisionEngineDependencies = {},
): SpatialVisionEngine {
  const loadDetector =
    dependencies.loadDetector ??
    (async (options: HandDetectorLoadOptions) => {
      const detectorModule = await import(
        "@/lib/gesture/mediapipe-hand-detector"
      );
      return detectorModule.loadMediaPipeHandDetector(options);
    });
  return {
    descriptor: {
      id: MEDIA_PIPE_FALLBACK_SPATIAL_VISION_ENGINE_ID,
      displayName: "MediaPipe Hand Landmarker",
      role: "fallback",
      runtime: "mediapipe-tasks-vision",
      output: "hand-pose-keypoints",
      keypointCount: 21,
      modelVersion: "float16-1",
      evidence: {
        targetDeviceBenchmark: "required-for-replacement",
        licenseReview: "verified-candidate",
      },
    },
    detectorLoadOptions: { ...MEDIA_PIPE_DETECTOR_OPTIONS },
    worker: {
      scriptUrl: "/workers/hand-landmarker.js",
      name: "commandcanvas-hand-tracker",
    },
    loadDetector,
  };
}

export function createDefaultSpatialVisionEngine(): SpatialVisionEngine {
  return createYoloSpatialVisionEngine();
}

/**
 * Primary browser YOLO hand-pose engine. Its real browser worker/model smoke
 * test is covered separately; physical target-device performance remains a
 * distinct evidence boundary.
 */
export function createYoloSpatialVisionEngine(
  dependencies: YoloSpatialVisionEngineDependencies = {},
): SpatialVisionEngine {
  const loadDetector =
    dependencies.loadDetector ??
    (async (options: HandDetectorLoadOptions) => {
      const detectorModule = await import(
        "@/lib/gesture/yolo-hand-pose-detector"
      );
      return detectorModule.loadYoloHandPoseDetector(options);
    });
  return {
    descriptor: {
      id: PREFERRED_SPATIAL_VISION_ENGINE_ID,
      displayName: "YOLO26 Hand Pose",
      role: "default",
      runtime: "onnx-runtime-web",
      output: "hand-pose-keypoints",
      keypointCount: 21,
      modelVersion:
        "2abb91a7030e1aa5231ec900ccb2c07ab3f03460-320-fp16",
      evidence: {
        targetDeviceBenchmark: "required-for-replacement",
        licenseReview: "agpl-3.0-source-release",
      },
    },
    detectorLoadOptions: {
      wasmBaseUrl: "/onnxruntime/",
      modelAssetUrl: YOLO_HAND_POSE_MODEL_URL,
      runningMode: "VIDEO",
      numHands: 2,
    },
    worker: {
      scriptUrl: "/workers/yolo-hand-pose.js",
      name: "commandcanvas-yolo-hand-pose",
    },
    loadDetector,
  };
}

export interface SpatialVisionEnginePlan {
  primary: SpatialVisionEngine;
  fallback: SpatialVisionEngine;
  fallbackOn: readonly ["initialization-error", "runtime-error"];
}

export function createDefaultSpatialVisionEnginePlan(): SpatialVisionEnginePlan {
  return {
    primary: createYoloSpatialVisionEngine(),
    fallback: createMediaPipeSpatialVisionEngine(),
    fallbackOn: ["initialization-error", "runtime-error"],
  };
}
