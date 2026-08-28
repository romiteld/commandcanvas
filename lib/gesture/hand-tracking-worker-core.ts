import type { HandLandmarks } from "@/lib/gesture/hand-intent";

export interface HandDetectorResult {
  landmarks: readonly (readonly {
    x: number;
    y: number;
    z?: number;
    visibility?: number;
  }[])[];
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
  getDiagnostics?(): HandDetectorDiagnostics;
  close(): void | Promise<void>;
}

export interface HandDetectorDiagnostics {
  readonly executionProvider:
    | "webgpu"
    | "wasm"
    | "mediapipe"
    | "cuda"
    | "tensorrt"
    | "unknown";
  readonly highPerformanceGpuRequested: boolean;
  readonly processingLocation?: "browser" | "private-relay";
  readonly adapter?: {
    readonly vendor?: string;
    readonly architecture?: string;
    readonly device?: string;
    readonly description?: string;
  };
  readonly fallbackReason?: string;
}

export interface HandDetectorLoadOptions {
  wasmBaseUrl: string;
  modelAssetUrl: string;
  runningMode: "VIDEO";
  numHands: 2;
}

export interface HandTrackingRelayMetrics {
  /** Browser time spent encoding the frame that produced this result. */
  readonly encodeLatencyMs: number;
  /** Send-to-validated-result time, including network and relay work. */
  readonly relayRoundTripMs: number;
  /** Cumulative raw camera bitmaps replaced before encoding in this run. */
  readonly droppedBeforeEncode: number;
  /** Cumulative encoded frames replaced before WebSocket send in this run. */
  readonly droppedBeforeSend: number;
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
  | { type: "ready"; diagnostics?: HandDetectorDiagnostics }
  | { type: "diagnostics"; diagnostics: HandDetectorDiagnostics }
  | {
      type: "result";
      timestamp: number;
      hands: readonly TrackedHandLandmarks[];
      processingLatencyMs?: number;
      relayMetrics?: HandTrackingRelayMetrics;
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
        const diagnostics = detector.getDiagnostics?.();
        dependencies.postMessage({
          type: "ready",
          ...(diagnostics ? { diagnostics } : {}),
        });
        if (diagnostics)
          dependencies.postMessage({ type: "diagnostics", diagnostics });
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
  points:
    | readonly { x: number; y: number; z?: number; visibility?: number }[]
    | undefined,
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
        (point.z === undefined || Number.isFinite(point.z)) &&
        (point.visibility === undefined ||
          (Number.isFinite(point.visibility) &&
            point.visibility >= 0 &&
            point.visibility <= 1)),
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
