import type { CanvasPoint } from "@/lib/canvas/coordinates";
import {
  createInitialHandReliabilityState,
  mapCalibratedPointer,
  reduceHandReliability,
  resolveHandCameraBounds,
  resolvePinchThresholds,
  type CanvasBounds,
  type HandCalibrationProfile,
  type HandControlGainState,
  type HandReliabilityHandSnapshot,
  type HandReliabilityHandInput,
  type HandReliabilityState,
} from "@/lib/gesture/hand-calibration";
import {
  isReliableTrackedHandedness,
  type HandTrackingObservation,
  type HandTrackingPointer,
} from "@/lib/gesture/hand-tracking-controller";
import type {
  SpatialBimanualHand,
  SpatialGestureInput,
  SpatialReliabilityEvidence,
} from "@/lib/gesture/spatial-gesture";
import {
  applyDrawingClutchPolicyAtSafeBoundary,
  createInitialDrawingClutchState,
  reduceDrawingClutch,
  resolveDrawingClutchPolicy,
  type DrawingClutchState,
} from "@/lib/gesture/drawing-clutch";

const STROKE_DISTANCE_PX = 1.75;
const STROKE_SAMPLE_INTERVAL_MS = 12;

export interface SpatialRoomInputState {
  readonly reliability: HandReliabilityState;
  readonly drawingClutch: DrawingClutchState;
}

export interface SpatialRoomInputOptions {
  readonly calibration: HandCalibrationProfile;
  readonly canvas: CanvasBounds;
  readonly gainState: HandControlGainState;
  readonly edgePreviewVisible: boolean;
  /** Draw tool availability is distinct from the clutch's pen-down state. */
  readonly drawingEnabled?: boolean;
}

export interface SpatialRoomInputTransition {
  readonly state: SpatialRoomInputState;
  readonly input: SpatialGestureInput;
}

interface MappedBimanualInput {
  readonly original: HandTrackingPointer;
  readonly pointer: CanvasPoint;
  readonly motionPointer: CanvasPoint;
  readonly reliabilityInput: HandReliabilityHandInput;
}

export function createInitialSpatialRoomInputState(): SpatialRoomInputState {
  return {
    reliability: createInitialHandReliabilityState(),
    drawingClutch: createInitialDrawingClutchState(),
  };
}

/**
 * Production Task 2 -> Task 3 boundary. Camera geometry is calibrated before
 * it becomes normalized full-canvas input, and Task 2 owns temporal pinch
 * voting/reliability. Legacy observations without physical measurements keep
 * their detector semantic mode so older pointer-only adapters remain usable.
 */
export function reduceSpatialRoomObservation(
  state: SpatialRoomInputState,
  observation: HandTrackingObservation,
  options: SpatialRoomInputOptions,
): SpatialRoomInputTransition {
  const thresholds = resolvePinchThresholds(options.calibration);
  if (observation.mode === "idle") {
    const reliability = reduceHandReliability(
      state.reliability,
      { timestamp: observation.timestamp, hands: [] },
      thresholds,
    );
    // A detector dropout is uncertainty, not a deliberate pen release. Keep
    // the confirmed clutch state so the gesture reducer can apply its bounded
    // short-gap policy. Session end and Draw-mode exit still reset explicitly.
    const drawingClutch =
      options.drawingEnabled && observation.trackingState === "lost"
        ? state.drawingClutch
        : reduceDrawingClutch(state.drawingClutch, null).state;
    return {
      state: {
        reliability: reliability.state,
        drawingClutch,
      },
      input: {
        mode: "idle",
        timestamp: observation.timestamp,
        reason: observation.trackingState === "lost" ? "loss" : "release",
      },
    };
  }

  if (observation.mode === "bimanual_pinch") {
    const mappedHands = observation.hands.map((hand, index) => {
      const mappedPointer = mapPointer(
        options.calibration,
        hand.pointer,
        options.canvas,
        "two_hand",
        hand,
      );
      const mappedMotion = mapPointer(
        options.calibration,
        hand.motionPointer ?? hand.pointer,
        options.canvas,
        "two_hand",
        hand,
      );
      return {
        original: hand,
        pointer: mappedPointer,
        motionPointer: mappedMotion,
        reliabilityInput: reliabilityHandInput(hand, index, mappedPointer, 0),
      };
    }) as [MappedBimanualInput, MappedBimanualInput];
    const reliability = reduceHandReliability(
      state.reliability,
      {
        timestamp: observation.timestamp,
        hands: mappedHands.map((hand) => hand.reliabilityInput),
      },
      thresholds,
    );
    const hands = mappedHands.map((hand, index) => {
      const snapshot = reliability.snapshot.hands.find(
        (candidate) => candidate.trackId === hand.reliabilityInput.trackId,
      );
      return {
        pointer: hand.pointer,
        motionPointer: hand.motionPointer,
        ...(snapshot
          ? reliabilityFromSnapshot(snapshot)
          : reliabilityFromPointer(hand.original, index)),
      };
    }) as [SpatialBimanualHand, SpatialBimanualHand];
    const clutch = reduceDrawingClutch(state.drawingClutch, null);
    return {
      state: {
        reliability: reliability.state,
        drawingClutch: clutch.state,
      },
      input: {
        mode: "bimanual_pinch",
        pointers: [hands[0].pointer, hands[1].pointer],
        span: Math.hypot(
          hands[1].pointer.x - hands[0].pointer.x,
          hands[1].pointer.y - hands[0].pointer.y,
        ),
        timestamp: observation.timestamp,
        hands,
        edgePreviewVisible: options.edgePreviewVisible,
      },
    };
  }

  const pointer = mapPointer(
    options.calibration,
    observation.pointer,
    options.canvas,
    options.gainState,
    observation,
  );
  const motionPointer = mapPointer(
    options.calibration,
    observation.motionPointer ?? observation.pointer,
    options.canvas,
    options.gainState,
    observation,
  );
  const reliabilityInput = reliabilityHandInput(
    observation,
    0,
    pointer,
    observation.pinchRatio ?? observation.measurements?.pinchRatio ?? 0,
  );
  const reliability = reduceHandReliability(
    state.reliability,
    { timestamp: observation.timestamp, hands: [reliabilityInput] },
    thresholds,
  );
  const snapshot = reliability.snapshot.activeHand;
  const hasPhysicalPinchEvidence =
    observation.measurements !== undefined ||
    observation.pinchRatio !== undefined;
  const mode =
    observation.mode === "open_palm"
      ? "open_palm"
      : hasPhysicalPinchEvidence
        ? reliability.snapshot.pinch.pinched
          ? "pinch"
          : "point"
        : observation.mode;
  const clutchObservation = drawingClutchObservation(observation);
  const drawingTrackId = observation.trackId ?? "legacy-primary";
  const drawingStateAtTrackBoundary =
    state.drawingClutch.phase !== "pen_up" &&
    state.drawingClutch.activeTrackId !== null &&
    state.drawingClutch.activeTrackId !== drawingTrackId
      ? reduceDrawingClutch(state.drawingClutch, null).state
      : state.drawingClutch;
  const resolvedDrawingPolicy = resolveDrawingClutchPolicy(options.calibration, {
    trackId: drawingTrackId,
    handedness: observation.handedness ?? "unknown",
    handednessReliable: isReliableTrackedHandedness(
      observation.handedness ?? "unknown",
      observation.handednessConfidence,
    ),
  });
  const calibratedDrawingState = applyDrawingClutchPolicyAtSafeBoundary(
    drawingStateAtTrackBoundary,
    resolvedDrawingPolicy.policy,
  );
  const clutch = options.drawingEnabled
    ? reduceDrawingClutch(calibratedDrawingState, clutchObservation)
    : reduceDrawingClutch(state.drawingClutch, null);
  const drawingEvidence =
    options.drawingEnabled &&
    observation.mode !== "open_palm" &&
    clutch.evidence.trackId
      ? { ...clutch.evidence, trackId: clutch.evidence.trackId }
      : undefined;
  const commonInput = {
    pointer,
    motionPointer,
    timestamp: observation.timestamp,
    reliability: snapshot
      ? reliabilityFromSnapshot(snapshot)
      : reliabilityFromPointer(observation, 0),
    ...(drawingEvidence ? { drawing: drawingEvidence } : {}),
    edgePreviewVisible: options.edgePreviewVisible,
  };
  const input: SpatialGestureInput =
    mode === "point"
      ? { mode: "point", ...commonInput }
      : mode === "pinch"
        ? { mode: "pinch", ...commonInput }
        : { mode: "open_palm", ...commonInput };
  return {
    state: {
      reliability: reliability.state,
      drawingClutch: clutch.state,
    },
    input,
  };
}

function drawingClutchObservation(
  observation: Exclude<
    HandTrackingObservation,
    { mode: "idle" | "bimanual_pinch" }
  >,
) {
  const measurements = observation.measurements;
  const normalizedDistance = measurements?.drawingClutchRatio;
  if (
    !measurements ||
    typeof normalizedDistance !== "number" ||
    !Number.isFinite(normalizedDistance)
  )
    return null;
  return {
    trackId: observation.trackId ?? "legacy-primary",
    timestamp: observation.timestamp,
    normalizedDistance,
    confidence: Math.min(
      observation.confidence,
      measurements.confidence,
      measurements.thumbTipConfidence,
      measurements.middleTipConfidence ?? 0,
    ),
    predicted: observation.prediction?.predicted ?? false,
    trackingState:
      observation.trackingState === "tracked"
        ? ("tracked" as const)
        : ("grace" as const),
  };
}

function mapPointer(
  calibration: HandCalibrationProfile,
  cameraPoint: CanvasPoint,
  canvas: CanvasBounds,
  gainState: HandControlGainState,
  identity?: Partial<
    Pick<
      HandTrackingPointer,
      "trackId" | "handedness" | "handednessConfidence"
    >
  >,
): CanvasPoint {
  const cameraBounds = identity
    ? resolveHandCameraBounds(calibration, {
        trackId: identity.trackId ?? "legacy-primary",
        handedness: identity.handedness ?? "unknown",
        handednessReliable: isReliableTrackedHandedness(
          identity.handedness ?? "unknown",
          identity.handednessConfidence,
        ),
      })
    : calibration.cameraBounds;
  const mapped = mapCalibratedPointer(
    { ...calibration, cameraBounds },
    cameraPoint,
    canvas,
    gainState,
  );
  return {
    x: (mapped.point.x - canvas.left) / canvas.width,
    y: (mapped.point.y - canvas.top) / canvas.height,
  };
}

function reliabilityHandInput(
  hand: Pick<
    HandTrackingPointer,
    "confidence" | "trackId" | "prediction" | "trackingState" | "measurements"
  > & { readonly handedness?: "left" | "right" | "unknown" },
  fallbackIndex: number,
  pointer: CanvasPoint,
  fallbackPinchRatio: number,
): HandReliabilityHandInput {
  const measurements = hand.measurements;
  return {
    trackId: hand.trackId ?? `legacy-hand-${fallbackIndex}`,
    handedness: hand.handedness ?? "unknown",
    pointer,
    confidence: hand.confidence,
    indexTipConfidence: measurements?.indexTipConfidence ?? hand.confidence,
    thumbTipConfidence: measurements?.thumbTipConfidence ?? hand.confidence,
    predicted: hand.prediction?.predicted ?? false,
    pinchRatio: measurements?.pinchRatio ?? fallbackPinchRatio,
  };
}

function reliabilityFromSnapshot(
  snapshot: HandReliabilityHandSnapshot,
): SpatialReliabilityEvidence {
  return {
    trackId: snapshot.trackId,
    confidence: Math.min(
      snapshot.confidence,
      snapshot.indexTipConfidence,
      snapshot.thumbTipConfidence,
    ),
    real: snapshot.real,
    predicted: snapshot.predicted,
    trackingState: snapshot.trackingState,
  };
}

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
    pointer: observation.pointer,
    motionPointer: observation.motionPointer ?? observation.pointer,
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
    pointer: hand.pointer,
    motionPointer: hand.motionPointer ?? hand.pointer,
    ...reliabilityFromPointer(hand, index),
  };
}

function reliabilityFromPointer(
  hand: Pick<
    HandTrackingPointer,
    "confidence" | "trackId" | "prediction" | "trackingState" | "measurements"
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
    trackingState: hand.trackingState === "grace" ? "uncertain" : "tracked",
  };
}
