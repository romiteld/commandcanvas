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
});
