import type { CanvasPoint } from "@/lib/canvas/coordinates";
import type {
  HandTrackingObservation,
  HandTrackingPointer,
} from "@/lib/gesture/hand-tracking-controller";
import type {
  SpatialBimanualHand,
  SpatialGestureInput,
  SpatialReliabilityEvidence,
} from "@/lib/gesture/spatial-gesture";

const STROKE_DISTANCE_PX = 1.75;
const STROKE_SAMPLE_INTERVAL_MS = 12;

export interface StrokeSampleState {
  readonly pointer: CanvasPoint | null;
  readonly timestamp: number | null;
}

export function createInitialStrokeSampleState(): StrokeSampleState {
  return { pointer: null, timestamp: null };
}

export function sampleTrackedStrokePoint(
  state: StrokeSampleState,
  input: {
    readonly pointer: CanvasPoint;
    readonly timestamp: number;
    readonly canvasSize: { readonly width: number; readonly height: number };
  },
): { readonly accepted: boolean; readonly state: StrokeSampleState } {
  if (
    !Number.isFinite(input.pointer.x) ||
    !Number.isFinite(input.pointer.y) ||
    !Number.isFinite(input.timestamp) ||
    input.canvasSize.width <= 0 ||
    input.canvasSize.height <= 0
  )
    return { accepted: false, state };
  if (!state.pointer || state.timestamp === null)
    return {
      accepted: true,
      state: { pointer: input.pointer, timestamp: input.timestamp },
    };
  if (input.timestamp <= state.timestamp) return { accepted: false, state };
  const distance = Math.hypot(
    (input.pointer.x - state.pointer.x) * input.canvasSize.width,
    (input.pointer.y - state.pointer.y) * input.canvasSize.height,
  );
  if (
    distance < STROKE_DISTANCE_PX &&
    input.timestamp - state.timestamp < STROKE_SAMPLE_INTERVAL_MS
  )
    return { accepted: false, state };
  return {
    accepted: true,
    state: { pointer: input.pointer, timestamp: input.timestamp },
  };
}

export function spatialInputFromHandObservation(
  observation: HandTrackingObservation,
  edgePreviewVisible: boolean,
): SpatialGestureInput {
  if (observation.mode === "idle")
    return {
      mode: "idle",
      timestamp: observation.timestamp,
      reason: observation.trackingState === "lost" ? "loss" : "release",
    };
  if (observation.mode === "bimanual_pinch") {
    const hands = observation.hands.map((hand, index) =>
      spatialBimanualHand(hand, index),
    ) as [SpatialBimanualHand, SpatialBimanualHand];
    return {
      mode: "bimanual_pinch",
      pointers: [hands[0].pointer, hands[1].pointer],
      span: observation.span,
      timestamp: observation.timestamp,
      hands,
      edgePreviewVisible,
    };
  }
  return {
    mode: observation.mode,
    pointer: observation.measurements?.indexTip ?? observation.pointer,
    motionPointer:
      observation.measurements?.palmMcpCentroid ?? observation.pointer,
    timestamp: observation.timestamp,
    reliability: reliabilityFromPointer(observation, 0),
    edgePreviewVisible,
  };
}

function spatialBimanualHand(
  hand: HandTrackingPointer,
  index: number,
): SpatialBimanualHand {
  return {
    pointer: hand.measurements?.indexTip ?? hand.pointer,
    motionPointer: hand.measurements?.palmMcpCentroid ?? hand.pointer,
    ...reliabilityFromPointer(hand, index),
  };
}

function reliabilityFromPointer(
  hand: Pick<
    HandTrackingPointer,
    | "confidence"
    | "trackId"
    | "prediction"
    | "trackingState"
    | "measurements"
  >,
  fallbackIndex: number,
): SpatialReliabilityEvidence {
  const predicted = hand.prediction?.predicted ?? false;
  const measurements = hand.measurements;
  return {
    trackId: hand.trackId ?? `legacy-hand-${fallbackIndex}`,
    confidence: Math.min(
      hand.confidence,
      measurements?.indexTipConfidence ?? hand.confidence,
      measurements?.thumbTipConfidence ?? hand.confidence,
    ),
    real: !predicted && hand.trackingState !== "grace",
    predicted,
    trackingState:
      hand.trackingState === "grace" ? "uncertain" : "tracked",
  };
}
