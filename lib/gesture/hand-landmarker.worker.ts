/// <reference lib="webworker" />

import {
  createHandTrackingWorkerRuntime,
  type HandTrackingWorkerInboundMessage,
  type HandTrackingWorkerOutboundMessage,
} from "@/lib/gesture/hand-tracking-worker-core";
import { loadMediaPipeHandDetector } from "@/lib/gesture/mediapipe-hand-detector";

const workerScope = self as DedicatedWorkerGlobalScope;

const runtime = createHandTrackingWorkerRuntime({
  loadDetector: loadMediaPipeHandDetector,
  postMessage(message: HandTrackingWorkerOutboundMessage) {
    workerScope.postMessage(message);
  },
});

workerScope.onmessage = (event: MessageEvent<HandTrackingWorkerInboundMessage>) => {
  void runtime.handleMessage(event.data).catch((error: unknown) => {
    workerScope.postMessage({
      type: "error",
      message:
        error instanceof Error && error.message.trim()
          ? error.message
          : "Local hand tracking could not start.",
    } satisfies HandTrackingWorkerOutboundMessage);
  });
};
