import type { HandLandmarks } from "@/lib/gesture/hand-intent";

export interface HandDetectorResult {
  landmarks: readonly (readonly { x: number; y: number; z?: number }[])[];
  handedness: readonly (readonly { score?: number }[])[];
}

export interface HandDetector {
  detectForVideo(frame: ImageBitmap, timestamp: number): HandDetectorResult;
  close(): void;
}

export interface HandDetectorLoadOptions {
  wasmBaseUrl: string;
  modelAssetUrl: string;
  runningMode: "VIDEO";
  numHands: 1;
}

export type HandTrackingWorkerInboundMessage =
  | {
      type: "initialize";
      wasmBaseUrl: string;
      modelAssetUrl: string;
    }
  | { type: "frame"; frame: ImageBitmap; timestamp: number }
  | { type: "dispose" };

export type HandTrackingWorkerOutboundMessage =
  | { type: "ready" }
  | {
      type: "result";
      timestamp: number;
      confidence: number | null;
      landmarks: HandLandmarks | null;
    }
  | { type: "error"; message: string };

export interface HandTrackingWorkerRuntime {
  handleMessage(message: HandTrackingWorkerInboundMessage): Promise<void>;
}

export function createHandTrackingWorkerRuntime(dependencies: {
  loadDetector: (options: HandDetectorLoadOptions) => Promise<HandDetector>;
  postMessage: (message: HandTrackingWorkerOutboundMessage) => void;
}): HandTrackingWorkerRuntime {
  let detector: HandDetector | null = null;
  return {
    async handleMessage(message) {
      if (message.type === "initialize") {
        detector?.close();
        detector = await dependencies.loadDetector({
          wasmBaseUrl: message.wasmBaseUrl,
          modelAssetUrl: message.modelAssetUrl,
          runningMode: "VIDEO",
          numHands: 1,
        });
        dependencies.postMessage({ type: "ready" });
        return;
      }
      if (message.type === "dispose") {
        detector?.close();
        detector = null;
        return;
      }

      try {
        if (!detector) throw new Error("Hand detector is not ready.");
        const result = detector.detectForVideo(message.frame, message.timestamp);
        const firstHand = result.landmarks[0];
        const valid = parseLandmarks(firstHand);
        dependencies.postMessage({
          type: "result",
          timestamp: message.timestamp,
          confidence: valid ? normalizeConfidence(result.handedness[0]?.[0]?.score) : null,
          landmarks: valid,
        });
      } catch (error) {
        dependencies.postMessage({
          type: "error",
          message:
            error instanceof Error && error.message.trim()
              ? error.message
              : "Local hand inference failed.",
        });
      } finally {
        message.frame.close();
      }
    },
  };
}

function parseLandmarks(
  points: readonly { x: number; y: number; z?: number }[] | undefined,
): HandLandmarks | null {
  if (
    !points ||
    points.length !== 21 ||
    !points.every(
      (point) =>
        Number.isFinite(point.x) &&
        Number.isFinite(point.y) &&
        point.x >= 0 &&
        point.x <= 1 &&
        point.y >= 0 &&
        point.y <= 1 &&
        (point.z === undefined || Number.isFinite(point.z)),
    )
  )
    return null;
  return points as HandLandmarks;
}

function normalizeConfidence(score: number | undefined) {
  return typeof score === "number" && Number.isFinite(score)
    ? Math.min(1, Math.max(0, score))
    : 1;
}
