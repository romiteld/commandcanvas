import type { HandLandmarks } from "@/lib/gesture/hand-intent";

export interface HandDetectorResult {
  landmarks: readonly (readonly { x: number; y: number; z?: number }[])[];
  handedness: readonly (readonly {
    score?: number;
    categoryName?: string;
    displayName?: string;
  }[])[];
}

export interface HandDetector {
  detectForVideo(
    frame: ImageBitmap,
    timestamp: number,
  ): HandDetectorResult | Promise<HandDetectorResult>;
  close(): void | Promise<void>;
}

export interface HandDetectorLoadOptions {
  wasmBaseUrl: string;
  modelAssetUrl: string;
  runningMode: "VIDEO";
  numHands: 2;
}

export type TrackedHandedness = "left" | "right" | "unknown";

export interface TrackedHandLandmarks {
  handedness: TrackedHandedness;
  confidence: number;
  landmarks: HandLandmarks;
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
      hands: readonly TrackedHandLandmarks[];
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
        await detector?.close();
        detector = await dependencies.loadDetector({
          wasmBaseUrl: message.wasmBaseUrl,
          modelAssetUrl: message.modelAssetUrl,
          runningMode: "VIDEO",
          numHands: 2,
        });
        dependencies.postMessage({ type: "ready" });
        return;
      }
      if (message.type === "dispose") {
        await detector?.close();
        detector = null;
        return;
      }

      try {
        if (!detector) throw new Error("Hand detector is not ready.");
        const result = await detector.detectForVideo(
          message.frame,
          message.timestamp,
        );
        const hands = result.landmarks.slice(0, 2).flatMap((points, index) => {
          const landmarks = parseLandmarks(points);
          if (!landmarks) return [];
          const category = result.handedness[index]?.[0];
          return [
            {
              handedness: normalizeHandedness(
                category?.categoryName ?? category?.displayName,
              ),
              confidence: normalizeConfidence(category?.score),
              landmarks,
            } satisfies TrackedHandLandmarks,
          ];
        });
        dependencies.postMessage({
          type: "result",
          timestamp: message.timestamp,
          hands,
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

function normalizeHandedness(value: string | undefined): TrackedHandedness {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "left" || normalized === "right") return normalized;
  return "unknown";
}
