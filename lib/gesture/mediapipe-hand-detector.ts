import { FilesetResolver, HandLandmarker } from "@mediapipe/tasks-vision";

import type {
  HandDetector,
  HandDetectorLoadOptions,
} from "@/lib/gesture/hand-tracking-worker-core";

type VisionFileset = Awaited<
  ReturnType<typeof FilesetResolver.forVisionTasks>
>;
type DetectorOptions = Parameters<typeof HandLandmarker.createFromOptions>[1];

export interface MediaPipeHandDetectorDependencies {
  resolveVisionTasks(
    basePath: string,
    useModule: boolean,
  ): Promise<VisionFileset>;
  createDetector(
    fileset: VisionFileset,
    options: DetectorOptions,
  ): Promise<HandDetector>;
}

const defaultDependencies: MediaPipeHandDetectorDependencies = {
  resolveVisionTasks: (basePath, useModule) =>
    FilesetResolver.forVisionTasks(basePath, useModule),
  createDetector: (fileset, options) =>
    HandLandmarker.createFromOptions(fileset, options),
};

export async function loadMediaPipeHandDetector(
  options: HandDetectorLoadOptions,
  dependencies: MediaPipeHandDetectorDependencies = defaultDependencies,
): Promise<HandDetector> {
  const fileset = await dependencies.resolveVisionTasks(
    options.wasmBaseUrl,
    true,
  );
  return dependencies.createDetector(fileset, {
    baseOptions: { modelAssetPath: options.modelAssetUrl },
    runningMode: options.runningMode,
    numHands: options.numHands,
    minHandDetectionConfidence: 0.75,
    minHandPresenceConfidence: 0.75,
    minTrackingConfidence: 0.7,
  });
}
