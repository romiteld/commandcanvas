/// <reference lib="webworker" />

import {
  createHandTrackingWorkerRuntime,
  type HandTrackingWorkerInboundMessage,
  type HandTrackingWorkerOutboundMessage,
} from "@/lib/gesture/hand-tracking-worker-core";
import { loadMediaPipeHandDetector } from "@/lib/gesture/mediapipe-hand-detector";

const workerScope = self as DedicatedWorkerGlobalScope;

// MediaPipe's module loader checks for `importScripts` before falling back to
// dynamic import. Safari module workers expose neither `importScripts` nor a
// DOM, so the upstream fallback otherwise attempts `document.createElement`.
// A TypeError is the signal MediaPipe already uses to select dynamic import.
if (typeof workerScope.importScripts !== "function") {
  Object.defineProperty(workerScope, "importScripts", {
    configurable: true,
    value: () => {
      throw new TypeError("importScripts is unavailable in a module worker.");
    },
  });
}

const runtime = createHandTrackingWorkerRuntime({
  loadDetector: async (options) => {
    if (typeof OffscreenCanvas === "undefined")
      throw new Error(
        "Local hand tracking needs the browser's in-page fallback because OffscreenCanvas is unavailable.",
      );
    return loadMediaPipeHandDetector(options);
  },
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
