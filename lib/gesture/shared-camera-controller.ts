import {
  createHandTrackingController,
  type HandTrackingController,
  type HandTrackingControllerDependencies,
  type PrivateHandRelayControllerOptions,
  type SharedHandMediaLease,
} from "@/lib/gesture/hand-tracking-controller";

export interface SharedCameraHandControllerOptions {
  getMeetingStream: () => MediaStream | null;
  acquireHandMedia?: () => Promise<SharedHandMediaLease>;
  privateHandRelay?: PrivateHandRelayControllerOptions;
  createController?: (
    dependencies: HandTrackingControllerDependencies,
  ) => HandTrackingController;
}

export function createSharedCameraHandController({
  getMeetingStream,
  acquireHandMedia,
  privateHandRelay,
  createController = createHandTrackingController,
}: SharedCameraHandControllerOptions): HandTrackingController {
  return createController({
    getSharedMediaStream: () =>
      acquireHandMedia ? acquireHandMedia() : getMeetingStream(),
    ...(privateHandRelay ? { privateHandRelay } : {}),
  });
}
