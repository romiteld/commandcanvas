import {
  createHandTrackingController,
  type HandTrackingController,
  type HandTrackingControllerDependencies,
  type PrivateHandRelayControllerOptions,
} from "@/lib/gesture/hand-tracking-controller";

export interface SharedCameraHandControllerOptions {
  getMeetingStream: () => MediaStream | null;
  privateHandRelay?: PrivateHandRelayControllerOptions;
  createController?: (
    dependencies: HandTrackingControllerDependencies,
  ) => HandTrackingController;
}

export function createSharedCameraHandController({
  getMeetingStream,
  privateHandRelay,
  createController = createHandTrackingController,
}: SharedCameraHandControllerOptions): HandTrackingController {
  return createController({
    getSharedMediaStream: () => getMeetingStream(),
    ...(privateHandRelay ? { privateHandRelay } : {}),
  });
}
