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

// Keep acquisition at MediaPipe's documented defaults. Gesture safety does
// not depend on these detector gates: keypoint confidence, physical geometry,
// calibrated temporal votes, target presence, and the canonical state machine
// still decide whether an observation may become an intent. Raising these
// values discarded moving, edge, and partially visible hands before those
// downstream refusal gates could evaluate them.
const MEDIA_PIPE_ACQUISITION_CONFIDENCE = 0.5;

export async function loadMediaPipeHandDetector(
  options: HandDetectorLoadOptions,
  dependencies: MediaPipeHandDetectorDependencies = defaultDependencies,
  loader: { useModule: boolean } = { useModule: false },
): Promise<HandDetector> {
  const fileset = await dependencies.resolveVisionTasks(
    options.wasmBaseUrl,
    loader.useModule,
  );
  const detector = await dependencies.createDetector(fileset, {
    baseOptions: { modelAssetPath: options.modelAssetUrl },
    runningMode: options.runningMode,
    numHands: options.numHands,
    minHandDetectionConfidence: MEDIA_PIPE_ACQUISITION_CONFIDENCE,
    minHandPresenceConfidence: MEDIA_PIPE_ACQUISITION_CONFIDENCE,
    minTrackingConfidence: MEDIA_PIPE_ACQUISITION_CONFIDENCE,
  });
  return {
    async detectForVideo(frame, timestamp) {
      const result = await detector.detectForVideo(frame, timestamp);
      return {
        ...result,
        landmarks: result.landmarks.map((landmarks) =>
          landmarks.map((landmark) => ({
            x: landmark.x,
            y: landmark.y,
            ...(landmark.z === undefined ? {} : { z: landmark.z }),
          })),
        ),
      };
    },
    close: () => detector.close(),
    ...(detector.getDiagnostics
      ? { getDiagnostics: () => detector.getDiagnostics!() }
      : {}),
  };
}
