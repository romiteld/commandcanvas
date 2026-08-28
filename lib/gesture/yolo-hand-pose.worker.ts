/// <reference lib="webworker" />

import {
  createHandTrackingWorkerRuntime,
  type HandTrackingWorkerInboundMessage,
  type HandTrackingWorkerOutboundMessage,
} from "@/lib/gesture/hand-tracking-worker-core";
import { loadYoloHandPoseDetector } from "@/lib/gesture/yolo-hand-pose-detector";

const workerScope = self as DedicatedWorkerGlobalScope;

const runtime = createHandTrackingWorkerRuntime({
  loadDetector: async (options) => {
    if (typeof OffscreenCanvas === "undefined")
      throw new Error(
        "YOLO hand pose needs the browser's in-page fallback because OffscreenCanvas is unavailable.",
      );
    return loadYoloHandPoseDetector(options);
  },
  postMessage(message: HandTrackingWorkerOutboundMessage) {
    workerScope.postMessage(message);
  },
});

workerScope.onmessage = (
  event: MessageEvent<HandTrackingWorkerInboundMessage>,
) => {
  void runtime.handleMessage(event.data).catch((error: unknown) => {
    workerScope.postMessage({
      type: "error",
      message:
        error instanceof Error && error.message.trim()
          ? error.message
          : "Local YOLO hand pose could not start.",
    } satisfies HandTrackingWorkerOutboundMessage);
  });
};
