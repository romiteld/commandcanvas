import { describe, expect, it, vi } from "vitest";

import { createSharedCameraHandController } from "@/lib/gesture/shared-camera-controller";
import type {
  HandTrackingController,
  HandTrackingControllerDependencies,
} from "@/lib/gesture/hand-tracking-controller";

describe("createSharedCameraHandController", () => {
  it("provides the current authorized meeting stream to hand tracking", async () => {
    const stream = {} as MediaStream;
    const getMeetingStream = vi.fn(() => stream);
    const controller = {} as HandTrackingController;
    const createController = vi.fn<
      (dependencies: HandTrackingControllerDependencies) => HandTrackingController
    >(() => controller);

    const result = createSharedCameraHandController({
      getMeetingStream,
      createController,
    });

    expect(result).toBe(controller);
    const dependencies = createController.mock.calls[0]?.[0];
    expect(await dependencies?.getSharedMediaStream?.()).toBe(stream);
    expect(getMeetingStream).toHaveBeenCalledOnce();
  });

  it("passes the exact room access-token provider and live upload-consent getter to the relay engine", () => {
    const controller = {} as HandTrackingController;
    const createController = vi.fn<
      (dependencies: HandTrackingControllerDependencies) => HandTrackingController
    >(() => controller);
    let consent = false;
    const getAccessToken = vi.fn(async () => "room-access-token");

    createSharedCameraHandController({
      getMeetingStream: () => null,
      privateHandRelay: {
        roomId: "11111111-1111-4111-8111-111111111111",
        getAccessToken,
        cameraUploadConsent: () => consent,
      },
      createController,
    });

    const relay = createController.mock.calls[0]?.[0].privateHandRelay;
    expect(relay?.roomId).toBe("11111111-1111-4111-8111-111111111111");
    expect(relay?.getAccessToken).toBe(getAccessToken);
    expect(relay?.cameraUploadConsent()).toBe(false);
    consent = true;
    expect(relay?.cameraUploadConsent()).toBe(true);
  });
});
