import {
  createHandTrackingController,
  type HandTrackingController,
  type HandTrackingControllerDependencies,
} from "@/lib/gesture/hand-tracking-controller";

export interface SharedCameraHandControllerOptions {
  getMeetingStream: () => MediaStream | null;
  createController?: (
    dependencies: HandTrackingControllerDependencies,
  ) => HandTrackingController;
}

export function createSharedCameraHandController({
  getMeetingStream,
  createController = createHandTrackingController,
}: SharedCameraHandControllerOptions): HandTrackingController {
  return createController({
    getSharedMediaStream: () => getMeetingStream(),
  });
}
