import type { CanvasCommand } from "@/lib/canvas/command-engine";
import type { CanvasPoint, CanvasViewport } from "@/lib/canvas/coordinates";
import type { HandReliabilityTrackingState } from "@/lib/gesture/hand-calibration";

export interface HandActiveZone {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

export interface SpatialGestureScene {
  bounds: { left: number; top: number; width: number; height: number };
  viewport: CanvasViewport;
  handActiveZone?: HandActiveZone;
  selectedObjectId?: string | null;
  targetedObjectId?: string | null;
  objects: readonly {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    zIndex: number;
    rotation?: number;
    pinned: boolean;
    minimized: boolean;
  }[];
}

export type SpatialGesturePhase =
  | "idle"
  | "hover"
  | "pen_down"
  | "pen_up"
  | "temporary_loss"
  | "cancelled"
  | "pinch_pending"
  | "held_one"
  | "two_hand_pending"
  | "transforming_two"
  | "drawing"
  | "panning"
  | "edge_action_armed"
  | "lost_grace"
  /** Transitional compatibility for the Task 4 room adapter. Never emitted. */
  | "grabbing"
  | "dwelling"
  | "resizing"
  | "zooming"
  | "awaiting_neutral";

export interface SpatialTransform {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rotation: number;
}

export interface SpatialCandidate {
  readonly objectId: string;
  readonly distancePx: number;
  readonly enteredAt: number;
  readonly stable: boolean;
  readonly contender: {
    readonly objectId: string;
    readonly distancePx: number;
    readonly enteredAt: number;
  } | null;
}

export interface SpatialExitAction {
  readonly action: "maximize" | "minimize" | "discard";
  readonly edge: "left" | "right" | "top" | "bottom";
}

interface SpatialHeldExitAction {
  readonly action: "minimize" | "discard";
  readonly edge: "left" | "right" | "bottom";
}

export interface SpatialHeldState {
  readonly objectId: string;
  readonly ownerTrackId: string;
  readonly initialTransform: SpatialTransform;
  readonly currentTransform: SpatialTransform;
  readonly baselineMotionPoint: CanvasPoint;
  readonly lastMotionPoint: CanvasPoint;
  readonly startedAt: number;
  readonly initialX: number;
  readonly initialY: number;
  readonly currentX: number;
  readonly currentY: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly startPointerX: number;
  readonly startPointerY: number;
  readonly currentPointerX: number;
  readonly currentPointerY: number;
  readonly currentAt: number;
  readonly stagedExitAction: SpatialHeldExitAction | null;
}

interface SpatialMotionSample {
  readonly timestamp: number;
  readonly screenPoint: CanvasPoint;
  readonly confidence: number;
  readonly real: boolean;
  readonly predicted: boolean;
  readonly trackingState: HandReliabilityTrackingState;
}

export interface SpatialTwoHandTransform {
  readonly ownerTrackId: string;
  readonly secondTrackId: string;
  readonly baselineCentroid: CanvasPoint;
  readonly baselineSpan: number;
  readonly baselineAngle: number;
  readonly baselineObject: SpatialTransform;
  readonly currentTransform: SpatialTransform;
  readonly smoothedLogScale: number;
}

export interface SpatialArmedEdgeAction extends SpatialExitAction {
  readonly enteredAt: number;
  readonly qualifiedAt: number | null;
  readonly lastQualifiedAt: number | null;
  readonly previewVisible: boolean;
  readonly maximizeTransform?: SpatialTransform;
}

export interface SpatialGestureState {
  phase: SpatialGesturePhase;
  stroke: readonly CanvasPoint[];
  drawing: SpatialDrawingState | null;
  candidate: SpatialCandidate | null;
  pinchPending: {
    readonly objectId: string | null;
    readonly ownerTrackId: string;
    readonly startedAt: number;
    readonly direct: boolean;
  } | null;
  held: SpatialHeldState | null;
  /** Task 4 migration projection. It is the same object as `held`. */
  grab: SpatialHeldState | null;
  secondHand: { readonly trackId: string; readonly startedAt: number } | null;
  transform: SpatialTwoHandTransform | null;
  edgeAction: SpatialArmedEdgeAction | null;
  loss: {
    readonly startedAt: number;
    readonly priorPhase:
      | "held_one"
      | "two_hand_pending"
      | "transforming_two"
      | "edge_action_armed";
    readonly edgeCancelled: boolean;
  } | null;
  motionHistory: readonly SpatialMotionSample[];
  pan: {
    readonly previousPointerX: number;
    readonly previousPointerY: number;
  } | null;
  zoom: {
    readonly initialScreenSpan: number;
    readonly initialScale: number;
    readonly worldAnchor: CanvasPoint;
  } | null;
  palm: null;
  resize: null;
}

export interface SpatialDrawingState {
  readonly strokeId: string;
  readonly activeDrawingHandId: string;
  readonly penDownAt: number;
  readonly lastMeasuredAt: number;
  readonly lastObservationAt: number;
  readonly lossStartedAt: number | null;
  readonly measuredPointCount: number;
  readonly predictedPointCount: number;
  readonly interpolatedPointCount: number;
  readonly longGapBridgeCount: number;
  /** Full-length only. Null means the upstream adapter lacked raw evidence. */
  readonly samples: readonly GestureStrokeSample[] | null;
}

export interface GestureStrokeSample {
  readonly strokeId: string;
  readonly handTrackId: string;
  readonly timestampMs: number;
  readonly sampleKind: "measured" | "short-gap predicted" | "interpolated";
  readonly rawIndexTip: CanvasPoint;
  readonly filteredIndexTip: CanvasPoint;
  /** World-space until createGestureSketchCommand localizes the sketch. */
  readonly renderedPoint: CanvasPoint;
  readonly confidence: number;
}

export interface GestureStrokeReceipt {
  readonly strokeId: string;
  readonly handTrackId: string;
  readonly penDownAt: number;
  readonly penUpAt: number;
  readonly pointCount: number;
  readonly measuredPointCount: number;
  readonly predictedPointCount: number;
  readonly interpolatedPointCount: number;
  readonly longGapBridgeCount: 0;
  readonly terminationReason:
    | "gesture-release"
    | "draw-mode-exit"
    | "tracking-timeout"
    | "identity-loss"
    | "explicit-cancel"
    | "session-end";
  readonly sampleProvenanceVersion?: 1;
  readonly samples?: GestureStrokeSample[];
}

export interface SpatialGesturePolicy {
  drawingEnabled: boolean;
  manipulationEnabled: boolean;
}

export interface SpatialGestureTransition {
  readonly state: SpatialGestureState;
  readonly effects: readonly SpatialGestureEffect[];
}

export interface SpatialReliabilityEvidence {
  readonly trackId: string;
  readonly confidence: number;
  readonly real: boolean;
  readonly predicted: boolean;
  readonly trackingState: HandReliabilityTrackingState;
}

interface SpatialPointerInput {
  readonly pointer: CanvasPoint;
  readonly motionPointer?: CanvasPoint;
  readonly timestamp?: number;
  readonly reliability?: SpatialReliabilityEvidence;
  readonly edgePreviewVisible?: boolean;
  /** Explicit virtual-pen evidence. Position alone never grants durable ink. */
  readonly drawing?: {
    readonly trackId: string;
    readonly penDown: boolean;
    readonly transition: "none" | "engaged" | "released";
    readonly normalizedDistance: number | null;
    readonly confidence: number;
    readonly predicted: boolean;
    readonly sampleKind: "measured" | "predicted" | "interpolated";
    /** Raw landmark-8 coordinate before temporal filtering. */
    readonly rawIndexTip?: CanvasPoint;
    /** Controller pointer after temporal filtering, before canvas calibration. */
    readonly filteredIndexTip?: CanvasPoint;
    readonly rejectedBecause?: string;
  };
}

export interface SpatialBimanualHand extends SpatialReliabilityEvidence {
  readonly pointer: CanvasPoint;
  readonly motionPointer?: CanvasPoint;
}

export type SpatialGestureInput =
  | { mode: "idle"; timestamp?: number; reason?: "release" | "loss" }
  | ({ mode: "point" } & SpatialPointerInput)
  | ({ mode: "pinch" } & SpatialPointerInput)
  | ({ mode: "open_palm" } & SpatialPointerInput)
  | {
      mode: "bimanual_pinch";
      pointers: readonly [CanvasPoint, CanvasPoint];
      span: number;
      timestamp?: number;
      hands?: readonly [SpatialBimanualHand, SpatialBimanualHand];
      edgePreviewVisible?: boolean;
    };

export type SpatialGestureCompletionEffect =
  | {
      readonly type: "object.complete_transform";
      readonly objectId: string;
      readonly transform: SpatialTransform;
    }
  | {
      readonly type: "object.complete_edge_action";
      readonly objectId: string;
      readonly action: "maximize";
      readonly edge: "top";
      readonly transform: SpatialTransform;
    }
  | {
      readonly type: "object.complete_edge_action";
      readonly objectId: string;
      readonly action: "minimize";
      readonly edge: "bottom";
    }
  | {
      readonly type: "object.complete_edge_action";
      readonly objectId: string;
      readonly action: "discard";
      readonly edge: "left" | "right";
    };

export type SpatialGestureEffect =
  | {
      type: "stroke.preview";
      points: readonly CanvasPoint[];
      strokeId?: string;
      handTrackId?: string;
    }
  | {
      type: "stroke.commit";
      points: readonly CanvasPoint[];
      strokeId?: string;
      handTrackId?: string;
      penDownAt?: number;
      penUpAt?: number;
      pointCount?: number;
      measuredPointCount?: number;
      predictedPointCount?: number;
      interpolatedPointCount?: number;
      longGapBridgeCount?: number;
      sampleProvenanceVersion?: 1;
      samples?: readonly GestureStrokeSample[];
      terminationReason?:
        | "gesture-release"
        | "draw-mode-exit"
        | "tracking-timeout"
        | "identity-loss"
        | "explicit-cancel"
        | "session-end";
    }
  | { type: "object.select"; objectId: string }
  | { type: "object.target"; objectId: string | null }
  | {
      type: "object.preview_transform";
      objectId: string;
      transform: SpatialTransform;
    }
  | {
      type: "object.preview_edge_action";
      objectId: string;
      action: "maximize" | "minimize" | "discard";
      edge: "left" | "right" | "top" | "bottom";
      armed: boolean;
    }
  | SpatialGestureCompletionEffect
  | { type: "viewport.pan_by"; deltaX: number; deltaY: number }
  | { type: "viewport.zoom_at"; scale: number; screenPoint: CanvasPoint }
  | { type: "viewport.set"; viewport: CanvasViewport }
  | { type: "preview.clear" }
  /** Task 4 migration variants. The authoritative reducer never emits them. */
  | { type: "object.preview_move"; objectId: string; x: number; y: number }
  | { type: "object.commit_move"; objectId: string; x: number; y: number }
  | {
      type: "object.preview_resize" | "object.commit_resize";
      objectId: string;
      width: number;
      height: number;
    }
  | {
      type: "object.stage_action";
      objectId: string;
      action: "minimize" | "discard";
      edge: "left" | "right" | "bottom";
    }
  | { type: "object.focus" | "object.restore"; objectId: string }
  | { type: "palm.progress"; objectId: string; progress: number };

const TARGET_DWELL_MS = 100;
const DIRECT_PINCH_DWELL_MS = 48;
const CONTENDER_DWELL_MS = 80;
const CONTENDER_DISTANCE_ADVANTAGE_PX = 12;
const TARGET_EXIT_HYSTERESIS_PX = 12;
const PINCH_SHAPE_CHANGE_TOLERANCE_PX = 24;
const SECOND_HAND_DWELL_MS = 100;
const SECOND_HAND_NEAR_OBJECT_PX = 72;
const TWO_HAND_LOSS_GRACE_MS = 300;
const ROTATION_DEADBAND_DEGREES = 4.5;
const MIN_TRANSFORM_SCALE = 0.25;
const MAX_TRANSFORM_SCALE = 4;
const MIN_OBJECT_WIDTH = 160;
const MIN_OBJECT_HEIGHT = 80;
const MAX_OBJECT_WIDTH = 2_000;
const MAX_OBJECT_HEIGHT = 1_400;
const LOG_SCALE_ALPHA = 0.65;
const EDGE_ZONE_PX = 64;
const EDGE_DWELL_MS = 100;
const SLOW_EDGE_MAX_SPEED_PX_PER_SECOND = 400;
const THROW_MIN_SPEED_PX_PER_SECOND = 800;
const THROW_MIN_WINDOW_MS = 60;
const THROW_MAX_WINDOW_MS = 180;
const THROW_MIN_DIRECTION_COSINE = 0.85;
const EDGE_RELEASE_WINDOW_MS = 120;
const INTERACTION_CONFIDENCE = 0.5;
const EDGE_CONFIDENCE = 0.8;
const MIN_BIMANUAL_SPAN_PX = 8;
const DRAWING_LOSS_GRACE_MS = 80;
const DRAWING_BASE_DISPLACEMENT_PX = 44;
const DRAWING_MAX_SPEED_PX_PER_SECOND = 6_000;
const DRAWING_MAX_DISPLACEMENT_PX = 160;
const DRAWING_MAX_VIEWPORT_FRACTION = 0.25;
let drawingStrokeFallbackSequence = 0;

const IDENTITY_HAND_ACTIVE_ZONE = Object.freeze(
  validateHandActiveZone({ left: 0, right: 1, top: 0, bottom: 1 }),
);

export const DEFAULT_HAND_ACTIVE_ZONE = Object.freeze(
  validateHandActiveZone({ left: 0.16, right: 0.84, top: 0.12, bottom: 0.88 }),
);

const DEFAULT_SPATIAL_GESTURE_POLICY: SpatialGesturePolicy = Object.freeze({
  drawingEnabled: true,
  manipulationEnabled: true,
});

export function createInitialSpatialGestureState(): SpatialGestureState {
  return {
    phase: "idle",
    stroke: [],
    drawing: null,
    candidate: null,
    pinchPending: null,
    held: null,
    grab: null,
    secondHand: null,
    transform: null,
    edgeAction: null,
    loss: null,
    motionHistory: [],
    pan: null,
    zoom: null,
    palm: null,
    resize: null,
  };
}

export function mapHandPointerToActiveZone(
  pointer: CanvasPoint,
  activeZone: HandActiveZone = DEFAULT_HAND_ACTIVE_ZONE,
): CanvasPoint {
  const zone = validateHandActiveZone(activeZone);
  if (!Number.isFinite(pointer.x) || !Number.isFinite(pointer.y))
    throw new RangeError("A hand pointer needs finite normalized coordinates.");
  return {
    x: rounded(clamp((pointer.x - zone.left) / (zone.right - zone.left), 0, 1)),
    y: rounded(clamp((pointer.y - zone.top) / (zone.bottom - zone.top), 0, 1)),
  };
}

export function reduceSpatialGesture(
  state: SpatialGestureState,
  input: SpatialGestureInput,
  scene: SpatialGestureScene,
  policy: SpatialGesturePolicy = DEFAULT_SPATIAL_GESTURE_POLICY,
): SpatialGestureTransition {
  const current = normalizeLegacyState(state);
  const mapped = mapSpatialGestureInput(
    input,
    scene.handActiveZone ?? IDENTITY_HAND_ACTIVE_ZONE,
  );
  if (policy.drawingEnabled && !policy.manipulationEnabled)
    return reduceDrawing(current, mapped, scene);
  if (!policy.manipulationEnabled)
    return current.drawing
      ? endStroke(current, "draw-mode-exit", timestampOf(mapped))
      : { state: createInitialSpatialGestureState(), effects: [] };
  if (current.drawing)
    return endStroke(current, "draw-mode-exit", timestampOf(mapped));
  if (current.phase === "lost_grace")
    return reduceLostGrace(current, mapped, scene, policy);
  if (ownsObject(current))
    return reduceOwnedObject(current, mapped, scene, policy);
  if (mapped.mode === "idle") return empty();
  if (mapped.mode === "bimanual_pinch")
    return reduceBlankBimanual(current, mapped, scene);
  if (mapped.mode === "open_palm")
    return reduceBlankPalm(current, mapped, scene);
  if (mapped.mode === "point") return reduceHover(current, mapped, scene);
  return reducePinchPendingOrAcquire(current, mapped, scene);
}

/**
 * Finalizes an owned virtual-pen stroke through the same reducer receipt path
 * used by a gesture release. This remains valid during bounded tracking loss,
 * when the last measured stroke is intentionally preserved for Finish.
 */
export function finishSpatialDrawing(
  state: SpatialGestureState,
  timestamp: number,
): SpatialGestureTransition {
  const current = normalizeLegacyState(state);
  return current.drawing
    ? endStroke(current, "draw-mode-exit", timestamp)
    : { state: current, effects: [] };
}

function reduceDrawing(
  state: SpatialGestureState,
  input: SpatialGestureInput,
  scene: SpatialGestureScene,
): SpatialGestureTransition {
  const timestamp = timestampOf(input);
  if (state.drawing && timestamp <= state.drawing.lastObservationAt)
    return { state, effects: [] };
  if (input.mode === "idle") {
    if (!state.drawing) return drawingHover();
    if (input.reason !== "loss")
      return endStroke(state, "session-end", timestamp);
    return enterDrawingLoss(state, timestamp);
  }
  if (input.mode !== "point")
    return state.drawing
      ? endStroke(state, "gesture-release", timestamp)
      : drawingHover();

  const evidence = input.drawing;
  if (
    state.drawing &&
    evidence &&
    evidence.trackId !== state.drawing.activeDrawingHandId
  )
    return endStroke(state, "identity-loss", timestamp);
  const unsafe =
    inputIsUnsafe(input) ||
    !evidence ||
    evidence.predicted ||
    evidence.sampleKind !== "measured" ||
    Boolean(evidence.rejectedBecause);
  if (unsafe) {
    if (!state.drawing) return drawingHover();
    return enterDrawingLoss(state, timestamp);
  }

  if (!evidence.penDown) {
    if (state.drawing) return endStroke(state, "gesture-release", timestamp);
    return drawingHover();
  }

  if (!state.drawing) {
    if (evidence.transition !== "engaged") return drawingHover();
    const point = normalizedToWorld(input.pointer, scene);
    const strokeId = drawingStrokeId(evidence.trackId, timestamp);
    const sample = createGestureStrokeSample(
      evidence,
      strokeId,
      timestamp,
      point,
    );
    const drawing: SpatialDrawingState = {
      strokeId,
      activeDrawingHandId: evidence.trackId,
      penDownAt: timestamp,
      lastMeasuredAt: timestamp,
      lastObservationAt: timestamp,
      lossStartedAt: null,
      measuredPointCount: 1,
      predictedPointCount: 0,
      interpolatedPointCount: 0,
      longGapBridgeCount: 0,
      samples: sample ? [sample] : null,
    };
    return {
      state: {
        ...createInitialSpatialGestureState(),
        phase: "pen_down",
        stroke: [point],
        drawing,
      },
      effects: [
        {
          type: "stroke.preview",
          points: [point],
          strokeId,
          handTrackId: evidence.trackId,
        },
      ],
    };
  }

  const worldPoint = normalizedToWorld(input.pointer, scene);
  const elapsedSinceMeasurement = timestamp - state.drawing.lastMeasuredAt;
  if (
    elapsedSinceMeasurement > DRAWING_LOSS_GRACE_MS ||
    !drawingContinuationIsPlausible(
      state.stroke,
      worldPoint,
      elapsedSinceMeasurement,
      scene,
    )
  )
    return endStroke(state, "tracking-timeout", timestamp);
  const points = appendDistinctPoint(state.stroke, worldPoint);
  const added = points.length > state.stroke.length ? 1 : 0;
  const sample = added
    ? createGestureStrokeSample(
        evidence,
        state.drawing.strokeId,
        timestamp,
        worldPoint,
      )
    : null;
  const samples = added
    ? state.drawing.samples && sample
      ? [...state.drawing.samples, sample]
      : null
    : state.drawing.samples;
  const drawing: SpatialDrawingState = {
    ...state.drawing,
    lastMeasuredAt: timestamp,
    lastObservationAt: timestamp,
    lossStartedAt: null,
    measuredPointCount: state.drawing.measuredPointCount + added,
    samples,
  };
  return {
    state: { ...state, phase: "drawing", stroke: points, drawing },
    effects: [
      {
        type: "stroke.preview",
        points,
        strokeId: drawing.strokeId,
        handTrackId: drawing.activeDrawingHandId,
      },
    ],
  };
}

function enterDrawingLoss(
  state: SpatialGestureState,
  timestamp: number,
): SpatialGestureTransition {
  const drawing = state.drawing;
  if (!drawing) return drawingHover();
  const lossStartedAt = drawing.lossStartedAt ?? timestamp;
  if (
    timestamp - lossStartedAt > DRAWING_LOSS_GRACE_MS ||
    timestamp - drawing.lastMeasuredAt > DRAWING_LOSS_GRACE_MS
  )
    return endStroke(state, "tracking-timeout", timestamp);
  return {
    state: {
      ...state,
      phase: "temporary_loss",
      drawing: {
        ...drawing,
        lastObservationAt: timestamp,
        lossStartedAt,
      },
    },
    effects: [],
  };
}

function drawingContinuationIsPlausible(
  stroke: readonly CanvasPoint[],
  worldPoint: CanvasPoint,
  elapsedMs: number,
  scene: SpatialGestureScene,
) {
  const previous = stroke.at(-1);
  if (!previous || elapsedMs <= 0) return false;
  const screenDistance = Math.hypot(
    (worldPoint.x - previous.x) * scene.viewport.scale,
    (worldPoint.y - previous.y) * scene.viewport.scale,
  );
  const maximumDistance = Math.min(
    DRAWING_MAX_DISPLACEMENT_PX,
    Math.min(scene.bounds.width, scene.bounds.height) *
      DRAWING_MAX_VIEWPORT_FRACTION,
    DRAWING_BASE_DISPLACEMENT_PX +
      (elapsedMs / 1_000) * DRAWING_MAX_SPEED_PX_PER_SECOND,
  );
  return screenDistance <= maximumDistance;
}

function createGestureStrokeSample(
  evidence: NonNullable<
    Extract<SpatialGestureInput, { mode: "point" }>["drawing"]
  >,
  strokeId: string,
  timestampMs: number,
  renderedPoint: CanvasPoint,
): GestureStrokeSample | null {
  if (!evidence.rawIndexTip || !evidence.filteredIndexTip) return null;
  return {
    strokeId,
    handTrackId: evidence.trackId,
    timestampMs,
    sampleKind:
      evidence.sampleKind === "predicted"
        ? "short-gap predicted"
        : evidence.sampleKind,
    rawIndexTip: { ...evidence.rawIndexTip },
    filteredIndexTip: { ...evidence.filteredIndexTip },
    renderedPoint: { ...renderedPoint },
    confidence: evidence.confidence,
  };
}

function endStroke(
  state: SpatialGestureState,
  terminationReason: NonNullable<
    Extract<
      SpatialGestureEffect,
      { type: "stroke.commit" }
    >["terminationReason"]
  >,
  penUpAt: number,
): SpatialGestureTransition {
  const drawing = state.drawing;
  const samples =
    drawing?.samples?.length === state.stroke.length ? drawing.samples : null;
  return {
    state: {
      ...createInitialSpatialGestureState(),
      phase: "hover",
    },
    effects: [
      ...(drawing && state.stroke.length >= 2
        ? ([
            {
              type: "stroke.commit",
              points: state.stroke,
              strokeId: drawing.strokeId,
              handTrackId: drawing.activeDrawingHandId,
              penDownAt: drawing.penDownAt,
              penUpAt,
              pointCount: state.stroke.length,
              measuredPointCount: drawing.measuredPointCount,
              predictedPointCount: drawing.predictedPointCount,
              interpolatedPointCount: drawing.interpolatedPointCount,
              longGapBridgeCount: drawing.longGapBridgeCount,
              terminationReason,
              ...(samples
                ? {
                    sampleProvenanceVersion: 1 as const,
                    samples,
                  }
                : {}),
            },
          ] as const)
        : []),
      { type: "preview.clear" as const },
    ],
  };
}

function drawingHover(phase: "hover" | "pen_up" = "hover") {
  return {
    state: { ...createInitialSpatialGestureState(), phase },
    effects: [] as const,
  };
}

function drawingStrokeId(trackId: string, timestamp: number) {
  const safeTrack =
    trackId.replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 48) || "hand";
  return `gesture-stroke-${safeTrack}-${Math.max(0, Math.round(timestamp)).toString(36)}-${drawingStrokeNonce()}`;
}

function drawingStrokeNonce() {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === "function")
    return cryptoApi.randomUUID();
  if (typeof cryptoApi?.getRandomValues === "function") {
    const words = new Uint32Array(4);
    cryptoApi.getRandomValues(words);
    return [...words].map((word) => word.toString(36)).join("-");
  }
  drawingStrokeFallbackSequence += 1;
  return `fallback-${drawingStrokeFallbackSequence.toString(36)}`;
}

function reduceHover(
  state: SpatialGestureState,
  input: Extract<SpatialGestureInput, { mode: "point" }>,
  scene: SpatialGestureScene,
): SpatialGestureTransition {
  if (inputIsUnsafe(input)) return empty();
  const nextCandidate = updateCandidate(
    state.candidate,
    normalizedToWorld(input.pointer, scene),
    requiredTimestamp(input.timestamp),
    scene,
  );
  const changed = nextCandidate?.objectId !== state.candidate?.objectId;
  return {
    state: {
      ...createInitialSpatialGestureState(),
      phase: nextCandidate ? ("hover" as const) : ("idle" as const),
      candidate: nextCandidate,
    },
    effects: changed
      ? ([
          { type: "object.target", objectId: nextCandidate?.objectId ?? null },
        ] as const)
      : [],
  };
}

function reducePinchPendingOrAcquire(
  state: SpatialGestureState,
  input: Extract<SpatialGestureInput, { mode: "pinch" }>,
  scene: SpatialGestureScene,
): SpatialGestureTransition {
  if (inputIsUnsafe(input)) return empty();
  const timestamp = requiredTimestamp(input.timestamp);
  const ownerTrackId = input.reliability?.trackId ?? "legacy-primary";
  if (state.pinchPending && state.pinchPending.ownerTrackId !== ownerTrackId)
    return { state, effects: [] };
  const stableHoverCandidate =
    !state.pinchPending && state.candidate?.stable ? state.candidate : null;
  const freshCandidate = updateCandidate(
    stableHoverCandidate,
    normalizedToWorld(input.pointer, scene),
    timestamp,
    scene,
    directPinchMagneticRadiusPx(scene) +
      (stableHoverCandidate ? PINCH_SHAPE_CHANGE_TOLERANCE_PX : 0),
  );
  const objectId = freshCandidate?.objectId ?? null;
  const continuingPending =
    state.pinchPending?.objectId === objectId &&
    state.pinchPending.ownerTrackId === ownerTrackId;
  const continuingHover =
    !state.pinchPending && state.candidate?.objectId === objectId;
  const startedAt = continuingPending
    ? state.pinchPending!.startedAt
    : timestamp;
  const direct = continuingPending
    ? state.pinchPending!.direct
    : !continuingHover;
  const dwellMs = direct ? DIRECT_PINCH_DWELL_MS : TARGET_DWELL_MS;
  const stable =
    objectId !== null &&
    ((continuingHover && Boolean(state.candidate?.stable)) ||
      timestamp - startedAt >= dwellMs);
  if (!stable || !objectId)
    return {
      state: {
        ...createInitialSpatialGestureState(),
        phase: "pinch_pending",
        candidate: freshCandidate
          ? {
              ...freshCandidate,
              enteredAt: startedAt,
              stable: false,
            }
          : null,
        pinchPending: { objectId, ownerTrackId, startedAt, direct },
      },
      effects:
        freshCandidate?.objectId !== state.candidate?.objectId
          ? [
              {
                type: "object.target",
                objectId: freshCandidate?.objectId ?? null,
              },
            ]
          : [],
    };
  const object = scene.objects.find(({ id }) => id === objectId);
  if (!object) return empty();
  if (object.pinned)
    return {
      state: createInitialSpatialGestureState(),
      effects: [{ type: "object.select" as const, objectId }],
    };
  return acquireHeldObject(input, object, scene);
}

function acquireHeldObject(
  input: Extract<SpatialGestureInput, { mode: "pinch" }>,
  object: SpatialGestureScene["objects"][number],
  scene: SpatialGestureScene,
): SpatialGestureTransition {
  const timestamp = requiredTimestamp(input.timestamp);
  const pointerWorld = normalizedToWorld(input.pointer, scene);
  const motionWorld = normalizedToWorld(
    input.motionPointer ?? input.pointer,
    scene,
  );
  const transform = objectTransform(object);
  const held: SpatialHeldState = {
    objectId: object.id,
    ownerTrackId: input.reliability?.trackId ?? "legacy-primary",
    initialTransform: transform,
    currentTransform: transform,
    baselineMotionPoint: motionWorld,
    lastMotionPoint: motionWorld,
    startedAt: timestamp,
    initialX: transform.x,
    initialY: transform.y,
    currentX: transform.x,
    currentY: transform.y,
    offsetX: pointerWorld.x - object.x,
    offsetY: pointerWorld.y - object.y,
    startPointerX: input.pointer.x,
    startPointerY: input.pointer.y,
    currentPointerX: input.pointer.x,
    currentPointerY: input.pointer.y,
    currentAt: timestamp,
    stagedExitAction: null,
  };
  return {
    state: {
      ...createInitialSpatialGestureState(),
      phase: "held_one" as const,
      held,
      grab: held,
      motionHistory: recordMotionSample([], input, scene),
    },
    effects: [
      { type: "object.select" as const, objectId: object.id },
      previewTransformEffect(held),
    ],
  };
}

function reduceOwnedObject(
  state: SpatialGestureState,
  input: SpatialGestureInput,
  scene: SpatialGestureScene,
  policy: SpatialGesturePolicy,
): SpatialGestureTransition {
  if (!state.held) return empty();
  if (input.mode === "idle")
    return input.reason === "loss"
      ? enterLostGrace(state, timestampOf(input), true)
      : releaseOwnedObject(state, input, scene, policy);
  if (input.mode === "bimanual_pinch")
    return reduceOwnedBimanual(state, input, scene);
  const inputTrackId = input.reliability?.trackId ?? "legacy-primary";
  if (inputTrackId !== state.held.ownerTrackId) return { state, effects: [] };
  if (state.edgeAction && !isEdgeTrusted(input.reliability))
    return enterLostGrace(state, timestampOf(input), true);
  if (inputIsUnsafe(input))
    return enterLostGrace(state, timestampOf(input), true);
  if (state.phase === "transforming_two" && input.mode === "pinch")
    return enterLostGrace(state, timestampOf(input), false);
  if (state.phase === "two_hand_pending" && input.mode === "pinch")
    return updateOneHandHeld(
      { ...state, phase: "held_one", secondHand: null },
      input,
      scene,
    );
  if (input.mode === "point" || input.mode === "open_palm")
    return releaseOwnedObject(state, input, scene, policy);
  return updateOneHandHeld(state, input, scene);
}

function updateOneHandHeld(
  state: SpatialGestureState,
  input: Extract<SpatialGestureInput, { mode: "pinch" }>,
  scene: SpatialGestureScene,
): SpatialGestureTransition {
  if (!state.held) return empty();
  const timestamp = requiredTimestamp(input.timestamp);
  const motionWorld = normalizedToWorld(
    input.motionPointer ?? input.pointer,
    scene,
  );
  const transform: SpatialTransform = {
    ...state.held.initialTransform,
    x: rounded(
      state.held.initialTransform.x +
        motionWorld.x -
        state.held.baselineMotionPoint.x,
    ),
    y: rounded(
      state.held.initialTransform.y +
        motionWorld.y -
        state.held.baselineMotionPoint.y,
    ),
  };
  let held: SpatialHeldState = {
    ...state.held,
    currentTransform: transform,
    lastMotionPoint: motionWorld,
    currentX: transform.x,
    currentY: transform.y,
    currentPointerX: input.pointer.x,
    currentPointerY: input.pointer.y,
    currentAt: timestamp,
    stagedExitAction: null,
  };
  const history = recordMotionSample(state.motionHistory, input, scene);
  const edge = updateEdgeAction(state.edgeAction, held, history, input, scene);
  held = {
    ...held,
    stagedExitAction:
      edge.action &&
      edge.action.qualifiedAt !== null &&
      edge.action.action !== "maximize"
        ? {
            action: edge.action.action,
            edge:
              edge.action.edge === "bottom"
                ? "bottom"
                : edge.action.edge === "right"
                  ? "right"
                  : "left",
          }
        : null,
  };
  return {
    state: {
      ...state,
      phase:
        edge.action && edge.action.qualifiedAt !== null
          ? "edge_action_armed"
          : "held_one",
      held,
      grab: held,
      secondHand: null,
      edgeAction: edge.action,
      motionHistory: history,
    },
    effects: [previewTransformEffect(held), ...edge.effects],
  };
}

function reduceOwnedBimanual(
  state: SpatialGestureState,
  input: Extract<SpatialGestureInput, { mode: "bimanual_pinch" }>,
  scene: SpatialGestureScene,
): SpatialGestureTransition {
  if (!state.held) return empty();
  if (!input.hands || input.hands.some((hand) => !isTrusted(hand)))
    return enterLostGrace(state, timestampOf(input), true);
  const owner = input.hands.find(
    ({ trackId }) => trackId === state.held?.ownerTrackId,
  );
  if (!owner) return enterLostGrace(state, timestampOf(input), true);
  const timestamp = requiredTimestamp(input.timestamp);
  if (state.phase === "transforming_two" && state.transform) {
    const storedSecond = input.hands.find(
      ({ trackId }) => trackId === state.transform?.secondTrackId,
    );
    if (!storedSecond) return enterLostGrace(state, timestamp, true);
    return updateTwoHandTransform(state, input, scene);
  }
  const second = input.hands.find(
    ({ trackId }) => trackId !== state.held?.ownerTrackId,
  );
  if (!second) return enterLostGrace(state, timestamp, true);
  const secondWorld = normalizedToWorld(
    second.motionPointer ?? second.pointer,
    scene,
  );
  if (
    distanceToObjectRectangle(secondWorld, heldRectangle(state.held)) *
      scene.viewport.scale >
    SECOND_HAND_NEAR_OBJECT_PX
  )
    return {
      state: {
        ...state,
        phase: "held_one",
        secondHand: null,
        edgeAction: null,
      },
      effects: [],
    };
  const continuing = state.secondHand?.trackId === second.trackId;
  const secondHand = continuing
    ? state.secondHand!
    : { trackId: second.trackId, startedAt: timestamp };
  if (timestamp - secondHand.startedAt < SECOND_HAND_DWELL_MS)
    return {
      state: {
        ...state,
        phase: "two_hand_pending",
        secondHand,
        edgeAction: null,
      },
      effects: [],
    };
  const geometry = bimanualGeometryForTracks(
    input,
    scene,
    owner.trackId,
    second.trackId,
  );
  if (!geometry) return enterLostGrace(state, timestamp, true);
  if (geometry.span * scene.viewport.scale < MIN_BIMANUAL_SPAN_PX)
    return {
      state: { ...state, phase: "two_hand_pending", secondHand },
      effects: [],
    };
  const transform: SpatialTwoHandTransform = {
    ownerTrackId: owner.trackId,
    secondTrackId: second.trackId,
    baselineCentroid: geometry.centroid,
    baselineSpan: geometry.span,
    baselineAngle: geometry.angle,
    baselineObject: state.held.currentTransform,
    currentTransform: state.held.currentTransform,
    smoothedLogScale: 0,
  };
  return {
    state: {
      ...state,
      phase: "transforming_two",
      secondHand,
      transform,
      edgeAction: null,
      loss: null,
    },
    effects: [previewTransformEffect(state.held)],
  };
}

function updateTwoHandTransform(
  state: SpatialGestureState,
  input: Extract<SpatialGestureInput, { mode: "bimanual_pinch" }>,
  scene: SpatialGestureScene,
): SpatialGestureTransition {
  if (!state.held || !state.transform) return empty();
  const geometry = bimanualGeometryForTracks(
    input,
    scene,
    state.transform.ownerTrackId,
    state.transform.secondTrackId,
  );
  if (!geometry) return enterLostGrace(state, timestampOf(input), true);
  if (!Number.isFinite(geometry.span) || geometry.span <= 0)
    return enterLostGrace(state, timestampOf(input), true);
  const baseline = state.transform.baselineObject;
  const minimumScale = Math.max(
    MIN_TRANSFORM_SCALE,
    MIN_OBJECT_WIDTH / baseline.width,
    MIN_OBJECT_HEIGHT / baseline.height,
  );
  const maximumScale = Math.min(
    MAX_TRANSFORM_SCALE,
    MAX_OBJECT_WIDTH / baseline.width,
    MAX_OBJECT_HEIGHT / baseline.height,
  );
  const boundedScale = clamp(
    geometry.span / state.transform.baselineSpan,
    minimumScale,
    maximumScale,
  );
  const targetLogScale = Math.log(boundedScale);
  const smoothedLogScale =
    boundedScale === minimumScale || boundedScale === maximumScale
      ? targetLogScale
      : state.transform.smoothedLogScale +
        (targetLogScale - state.transform.smoothedLogScale) * LOG_SCALE_ALPHA;
  const scale = rounded(
    clamp(Math.exp(smoothedLogScale), MIN_TRANSFORM_SCALE, MAX_TRANSFORM_SCALE),
  );
  const rotationDelta = normalizeAngle(
    geometry.angle - state.transform.baselineAngle,
  );
  const appliedRotation =
    Math.abs(rotationDelta) < ROTATION_DEADBAND_DEGREES ? 0 : rotationDelta;
  const width = rounded(baseline.width * scale);
  const height = rounded(baseline.height * scale);
  const currentTransform: SpatialTransform = {
    x: rounded(
      baseline.x +
        geometry.centroid.x -
        state.transform.baselineCentroid.x -
        (width - baseline.width) / 2,
    ),
    y: rounded(
      baseline.y +
        geometry.centroid.y -
        state.transform.baselineCentroid.y -
        (height - baseline.height) / 2,
    ),
    width,
    height,
    rotation: rounded(normalizeAngle(baseline.rotation + appliedRotation)),
  };
  const held: SpatialHeldState = {
    ...state.held,
    currentTransform,
    currentX: currentTransform.x,
    currentY: currentTransform.y,
    currentAt: requiredTimestamp(input.timestamp),
    stagedExitAction: null,
  };
  return {
    state: {
      ...state,
      phase: "transforming_two",
      held,
      grab: held,
      transform: {
        ...state.transform,
        currentTransform,
        smoothedLogScale,
      },
      loss: null,
      edgeAction: null,
    },
    effects: [previewTransformEffect(held)],
  };
}

function releaseOwnedObject(
  state: SpatialGestureState,
  input: SpatialGestureInput,
  scene: SpatialGestureScene,
  policy: SpatialGesturePolicy,
): SpatialGestureTransition {
  if (!state.held) return empty();
  const timestamp = timestampOf(input);
  const edgeTrustedRelease =
    input.mode !== "idle" &&
    input.mode !== "bimanual_pinch" &&
    isEdgeTrusted(input.reliability);
  const edge = state.edgeAction;
  const edgeEligible = Boolean(
    edgeTrustedRelease &&
    edge &&
    edge.qualifiedAt !== null &&
    edge.lastQualifiedAt !== null &&
    edge.previewVisible &&
    timestamp - edge.lastQualifiedAt <= EDGE_RELEASE_WINDOW_MS,
  );
  const effects: SpatialGestureEffect[] = [];
  if (edgeEligible && edge)
    effects.push(completeEdgeEffect(state.held.objectId, edge));
  else if (
    transformChanged(state.held.initialTransform, state.held.currentTransform)
  )
    effects.push({
      type: "object.complete_transform",
      objectId: state.held.objectId,
      transform: state.held.currentTransform,
    });
  effects.push({ type: "preview.clear" });
  if (input.mode === "point" && policy.manipulationEnabled) {
    const hovered = reduceHover(
      createInitialSpatialGestureState(),
      input,
      scene,
    );
    return { state: hovered.state, effects: [...effects, ...hovered.effects] };
  }
  return { state: createInitialSpatialGestureState(), effects };
}

function enterLostGrace(
  state: SpatialGestureState,
  timestamp: number,
  edgeCancelled: boolean,
): SpatialGestureTransition {
  if (!state.held) return empty();
  const held: SpatialHeldState = { ...state.held, stagedExitAction: null };
  return {
    state: {
      ...state,
      phase: "lost_grace" as const,
      held,
      grab: held,
      edgeAction: null,
      motionHistory: edgeCancelled ? [] : state.motionHistory,
      loss: {
        startedAt: state.loss?.startedAt ?? timestamp,
        priorPhase: authoritativeOwnedPhase(state.phase),
        edgeCancelled: Boolean(state.loss?.edgeCancelled || edgeCancelled),
      },
    },
    effects: state.edgeAction
      ? ([
          {
            type: "object.preview_edge_action",
            objectId: state.held.objectId,
            action: state.edgeAction.action,
            edge: state.edgeAction.edge,
            armed: false,
          },
          { type: "preview.clear" },
        ] as const)
      : [],
  };
}

function reduceLostGrace(
  state: SpatialGestureState,
  input: SpatialGestureInput,
  scene: SpatialGestureScene,
  policy: SpatialGesturePolicy,
): SpatialGestureTransition {
  if (!state.held || !state.loss) return empty();
  const timestamp = timestampOf(input);
  if (timestamp - state.loss.startedAt > TWO_HAND_LOSS_GRACE_MS)
    return finalizeLostGrace(state, input, scene, policy);
  if (input.mode === "idle" && input.reason === "release")
    return finalizeLostGrace(state, input, scene, policy);
  if (
    input.mode !== "idle" &&
    input.mode !== "bimanual_pinch" &&
    (input.reliability?.trackId ?? "legacy-primary") !== state.held.ownerTrackId
  )
    return { state, effects: [] };
  if (input.mode === "idle" || inputIsUnsafe(input))
    return { state, effects: [] };
  if (input.mode === "bimanual_pinch" && state.transform) {
    if (!input.hands || input.hands.some((hand) => !isTrusted(hand)))
      return { state, effects: [] };
    const ids = new Set(input.hands.map(({ trackId }) => trackId));
    if (
      !ids.has(state.transform.ownerTrackId) ||
      !ids.has(state.transform.secondTrackId)
    )
      return { state, effects: [] };
    return updateTwoHandTransform(
      { ...state, phase: "transforming_two", loss: null },
      input,
      scene,
    );
  }
  if (
    input.mode === "pinch" &&
    input.reliability?.trackId === state.held.ownerTrackId
  )
    return updateOneHandHeld(
      { ...state, phase: "held_one", loss: null, edgeAction: null },
      input,
      scene,
    );
  if (input.mode === "point" || input.mode === "open_palm")
    return releaseOwnedObject(
      { ...state, phase: "held_one", loss: null, edgeAction: null },
      input,
      scene,
      policy,
    );
  return { state, effects: [] };
}

function finalizeLostGrace(
  state: SpatialGestureState,
  input: SpatialGestureInput,
  scene: SpatialGestureScene,
  policy: SpatialGesturePolicy,
) {
  return releaseOwnedObject(
    {
      ...state,
      phase: "held_one",
      loss: null,
      edgeAction: null,
      motionHistory: [],
    },
    input,
    scene,
    policy,
  );
}

function reduceBlankPalm(
  state: SpatialGestureState,
  input: Extract<SpatialGestureInput, { mode: "open_palm" }>,
  scene: SpatialGestureScene,
): SpatialGestureTransition {
  if (inputIsUnsafe(input)) return empty();
  const worldPoint = normalizedToWorld(input.pointer, scene);
  if (nearestMagneticObject(worldPoint, scene, 0))
    return { state: createInitialSpatialGestureState(), effects: [] };
  const previous = state.phase === "panning" ? state.pan : null;
  const deltaX = previous
    ? rounded(
        (input.pointer.x - previous.previousPointerX) * scene.bounds.width,
      )
    : 0;
  const deltaY = previous
    ? rounded(
        (input.pointer.y - previous.previousPointerY) * scene.bounds.height,
      )
    : 0;
  return {
    state: {
      ...createInitialSpatialGestureState(),
      phase: "panning",
      pan: {
        previousPointerX: input.pointer.x,
        previousPointerY: input.pointer.y,
      },
    },
    effects: [{ type: "viewport.pan_by" as const, deltaX, deltaY }],
  };
}

function reduceBlankBimanual(
  state: SpatialGestureState,
  input: Extract<SpatialGestureInput, { mode: "bimanual_pinch" }>,
  scene: SpatialGestureScene,
): SpatialGestureTransition {
  if (input.hands && input.hands.some((hand) => !isTrusted(hand)))
    return empty();
  if (state.phase !== "panning") {
    const selected = acquireSelectedBimanual(input, scene);
    if (selected) return selected;
  }
  const screenGeometry = bimanualScreenGeometry(input, scene);
  if (screenGeometry.span < MIN_BIMANUAL_SPAN_PX) return empty();
  if (state.phase === "panning" && state.zoom) {
    const scale = rounded(
      clamp(
        state.zoom.initialScale *
          (screenGeometry.span / state.zoom.initialScreenSpan),
        0.35,
        2.5,
      ),
    );
    const viewport = {
      x: rounded(screenGeometry.centroid.x - state.zoom.worldAnchor.x * scale),
      y: rounded(screenGeometry.centroid.y - state.zoom.worldAnchor.y * scale),
      scale,
    };
    return {
      state,
      effects: [{ type: "viewport.set" as const, viewport }],
    };
  }
  return {
    state: {
      ...createInitialSpatialGestureState(),
      phase: "panning",
      zoom: {
        initialScreenSpan: screenGeometry.span,
        initialScale: scene.viewport.scale,
        worldAnchor: {
          x: rounded(
            (screenGeometry.centroid.x - scene.viewport.x) /
              scene.viewport.scale,
          ),
          y: rounded(
            (screenGeometry.centroid.y - scene.viewport.y) /
              scene.viewport.scale,
          ),
        },
      },
    },
    effects: [{ type: "viewport.set" as const, viewport: scene.viewport }],
  };
}

function acquireSelectedBimanual(
  input: Extract<SpatialGestureInput, { mode: "bimanual_pinch" }>,
  scene: SpatialGestureScene,
): SpatialGestureTransition | null {
  if (!input.hands || !scene.selectedObjectId) return null;
  const object = scene.objects.find(({ id }) => id === scene.selectedObjectId);
  if (!object || object.pinned || object.minimized) return null;
  const first = input.hands[0];
  const second = input.hands[1];
  if (
    !isTrusted(first) ||
    !isTrusted(second) ||
    first.trackId === second.trackId
  )
    return null;
  const firstIndexWorld = normalizedToWorld(first.pointer, scene);
  const secondIndexWorld = normalizedToWorld(second.pointer, scene);
  const acquisitionGeometry = geometryFromPoints(
    firstIndexWorld,
    secondIndexWorld,
  );
  if (acquisitionGeometry.span * scene.viewport.scale < MIN_BIMANUAL_SPAN_PX)
    return null;
  if (distanceToObjectRectangle(acquisitionGeometry.centroid, object) > 0)
    return null;
  if (
    [firstIndexWorld, secondIndexWorld].some(
      (point) =>
        distanceToObjectRectangle(point, object) * scene.viewport.scale >
        SECOND_HAND_NEAR_OBJECT_PX,
    )
  )
    return null;
  const motionGeometry = geometryFromPoints(
    normalizedToWorld(first.motionPointer ?? first.pointer, scene),
    normalizedToWorld(second.motionPointer ?? second.pointer, scene),
  );
  if (motionGeometry.span * scene.viewport.scale < MIN_BIMANUAL_SPAN_PX)
    return null;
  const timestamp = requiredTimestamp(input.timestamp);
  const baseline = objectTransform(object);
  const held: SpatialHeldState = {
    objectId: object.id,
    ownerTrackId: first.trackId,
    initialTransform: baseline,
    currentTransform: baseline,
    baselineMotionPoint: motionGeometry.centroid,
    lastMotionPoint: motionGeometry.centroid,
    startedAt: timestamp,
    initialX: baseline.x,
    initialY: baseline.y,
    currentX: baseline.x,
    currentY: baseline.y,
    offsetX: acquisitionGeometry.centroid.x - baseline.x,
    offsetY: acquisitionGeometry.centroid.y - baseline.y,
    startPointerX: first.pointer.x,
    startPointerY: first.pointer.y,
    currentPointerX: first.pointer.x,
    currentPointerY: first.pointer.y,
    currentAt: timestamp,
    stagedExitAction: null,
  };
  const transform: SpatialTwoHandTransform = {
    ownerTrackId: first.trackId,
    secondTrackId: second.trackId,
    baselineCentroid: motionGeometry.centroid,
    baselineSpan: motionGeometry.span,
    baselineAngle: motionGeometry.angle,
    baselineObject: baseline,
    currentTransform: baseline,
    smoothedLogScale: 0,
  };
  return {
    state: {
      ...createInitialSpatialGestureState(),
      phase: "transforming_two",
      held,
      grab: held,
      secondHand: { trackId: second.trackId, startedAt: timestamp },
      transform,
    },
    effects: [
      { type: "object.select", objectId: object.id },
      previewTransformEffect(held),
    ],
  };
}

function bimanualScreenGeometry(
  input: Extract<SpatialGestureInput, { mode: "bimanual_pinch" }>,
  scene: SpatialGestureScene,
) {
  const points = input.hands
    ? input.hands.map((hand) => hand.motionPointer ?? hand.pointer)
    : input.pointers;
  return geometryFromPoints(
    {
      x: rounded(points[0]!.x * scene.bounds.width),
      y: rounded(points[0]!.y * scene.bounds.height),
    },
    {
      x: rounded(points[1]!.x * scene.bounds.width),
      y: rounded(points[1]!.y * scene.bounds.height),
    },
  );
}

function updateEdgeAction(
  previous: SpatialArmedEdgeAction | null,
  held: SpatialHeldState,
  history: readonly SpatialMotionSample[],
  input: Extract<SpatialGestureInput, { mode: "pinch" }>,
  scene: SpatialGestureScene,
): {
  action: SpatialArmedEdgeAction | null;
  effects: readonly SpatialGestureEffect[];
} {
  if (!isEdgeTrusted(input.reliability))
    return clearEdgeAction(previous, held.objectId);
  const timestamp = requiredTimestamp(input.timestamp);
  const zone = edgeZone(normalizedToScreen(input.pointer, scene), scene);
  if (!zone) return clearEdgeAction(previous, held.objectId);
  const sameZone =
    previous?.edge === zone.edge && previous.action === zone.action;
  const enteredAt = sameZone ? previous.enteredAt : timestamp;
  let qualified = false;
  if (zone.action === "discard") qualified = qualifiesThrow(history, zone.edge);
  else {
    const speed = recentSpeed(history, THROW_MAX_WINDOW_MS);
    qualified =
      timestamp - enteredAt >= EDGE_DWELL_MS &&
      speed !== null &&
      speed <= SLOW_EDGE_MAX_SPEED_PX_PER_SECOND;
  }
  const qualifiedAt = qualified
    ? (previous?.qualifiedAt ?? timestamp)
    : sameZone
      ? (previous?.qualifiedAt ?? null)
      : null;
  const lastQualifiedAt = qualified
    ? timestamp
    : sameZone
      ? (previous?.lastQualifiedAt ?? null)
      : null;
  const action: SpatialArmedEdgeAction = {
    action: zone.action,
    edge: zone.edge,
    enteredAt,
    qualifiedAt,
    lastQualifiedAt,
    previewVisible:
      Boolean(input.edgePreviewVisible) &&
      (qualified || Boolean(previous?.qualifiedAt)),
    ...(zone.action === "maximize"
      ? { maximizeTransform: maximizeTransform(scene) }
      : {}),
  };
  const changed =
    !sameZone ||
    Boolean(previous?.qualifiedAt) !== Boolean(action.qualifiedAt) ||
    previous?.previewVisible !== action.previewVisible;
  return {
    action,
    effects: changed
      ? ([
          {
            type: "object.preview_edge_action",
            objectId: held.objectId,
            action: action.action,
            edge: action.edge,
            armed: action.qualifiedAt !== null,
          },
        ] as const)
      : [],
  };
}

function clearEdgeAction(
  previous: SpatialArmedEdgeAction | null,
  objectId: string,
) {
  return {
    action: null,
    effects: previous
      ? ([
          {
            type: "object.preview_edge_action",
            objectId,
            action: previous.action,
            edge: previous.edge,
            armed: false,
          },
        ] as const)
      : [],
  };
}

function edgeZone(
  point: CanvasPoint,
  scene: SpatialGestureScene,
): SpatialExitAction | null {
  const x = point.x - scene.bounds.left;
  const y = point.y - scene.bounds.top;
  if (y <= EDGE_ZONE_PX) return { action: "maximize", edge: "top" };
  if (y >= scene.bounds.height - EDGE_ZONE_PX)
    return { action: "minimize", edge: "bottom" };
  if (x <= EDGE_ZONE_PX) return { action: "discard", edge: "left" };
  if (x >= scene.bounds.width - EDGE_ZONE_PX)
    return { action: "discard", edge: "right" };
  return null;
}

function qualifiesThrow(
  history: readonly SpatialMotionSample[],
  edge: "left" | "right" | "top" | "bottom",
) {
  if (edge !== "left" && edge !== "right") return false;
  const latest = history.at(-1);
  if (!latest) return false;
  const lastThree = history.slice(-3);
  if (
    lastThree.length !== 3 ||
    lastThree.some(
      (sample) =>
        !sample.real ||
        sample.predicted ||
        sample.confidence < EDGE_CONFIDENCE ||
        sample.trackingState !== "tracked",
    )
  )
    return false;
  const baseline = [...history]
    .reverse()
    .find(
      (sample) =>
        latest.timestamp - sample.timestamp >= THROW_MIN_WINDOW_MS &&
        latest.timestamp - sample.timestamp <= THROW_MAX_WINDOW_MS,
    );
  if (!baseline) return false;
  const seconds = (latest.timestamp - baseline.timestamp) / 1_000;
  const deltaX = latest.screenPoint.x - baseline.screenPoint.x;
  const deltaY = latest.screenPoint.y - baseline.screenPoint.y;
  const distance = Math.hypot(deltaX, deltaY);
  if (distance === 0) return false;
  const outward = edge === "left" ? -deltaX : deltaX;
  return (
    distance / seconds > THROW_MIN_SPEED_PX_PER_SECOND &&
    outward / distance >= THROW_MIN_DIRECTION_COSINE
  );
}

function recentSpeed(
  history: readonly SpatialMotionSample[],
  maximumWindowMs: number,
) {
  const latest = history.at(-1);
  if (!latest) return null;
  const baseline = history.find(
    (sample) =>
      sample.timestamp < latest.timestamp &&
      latest.timestamp - sample.timestamp <= maximumWindowMs,
  );
  if (!baseline) return null;
  const seconds = (latest.timestamp - baseline.timestamp) / 1_000;
  return seconds > 0
    ? pointDistance(latest.screenPoint, baseline.screenPoint) / seconds
    : null;
}

function recordMotionSample(
  history: readonly SpatialMotionSample[],
  input: Extract<SpatialGestureInput, { mode: "pinch" }>,
  scene: SpatialGestureScene,
) {
  const evidence = input.reliability;
  if (!evidence) return history;
  const timestamp = requiredTimestamp(input.timestamp);
  return [
    ...history.filter((sample) => sample.timestamp >= timestamp - 240),
    {
      timestamp,
      screenPoint: normalizedToScreen(
        input.motionPointer ?? input.pointer,
        scene,
      ),
      confidence: evidence.confidence,
      real: evidence.real,
      predicted: evidence.predicted,
      trackingState: evidence.trackingState,
    },
  ].slice(-8);
}

function updateCandidate(
  current: SpatialCandidate | null,
  point: CanvasPoint,
  timestamp: number,
  scene: SpatialGestureScene,
  radius = magneticRadiusPx(scene),
): SpatialCandidate | null {
  const nearest = nearestMagneticObject(point, scene, radius);
  if (!current) return nearest ? newCandidate(nearest, timestamp) : null;
  const currentObject = scene.objects.find(({ id }) => id === current.objectId);
  if (!currentObject) return nearest ? newCandidate(nearest, timestamp) : null;
  const currentDistancePx =
    distanceToObjectRectangle(point, currentObject) * scene.viewport.scale;
  const currentRadius = objectMagneticRadiusPx(scene, currentObject, radius);
  if (currentDistancePx > currentRadius + TARGET_EXIT_HYSTERESIS_PX && !nearest)
    return null;
  const stable =
    current.stable || timestamp - current.enteredAt >= TARGET_DWELL_MS;
  if (
    !nearest ||
    nearest.object.id === current.objectId ||
    currentDistancePx - nearest.distancePx < CONTENDER_DISTANCE_ADVANTAGE_PX
  )
    return {
      ...current,
      distancePx: rounded(currentDistancePx),
      stable,
      contender: null,
    };
  const contender =
    current.contender?.objectId === nearest.object.id
      ? { ...current.contender, distancePx: nearest.distancePx }
      : {
          objectId: nearest.object.id,
          distancePx: nearest.distancePx,
          enteredAt: timestamp,
        };
  if (timestamp - contender.enteredAt >= CONTENDER_DWELL_MS)
    return {
      objectId: contender.objectId,
      distancePx: contender.distancePx,
      enteredAt: contender.enteredAt,
      stable: true,
      contender: null,
    };
  return {
    ...current,
    distancePx: rounded(currentDistancePx),
    stable,
    contender,
  };
}

function newCandidate(
  nearest: NonNullable<ReturnType<typeof nearestMagneticObject>>,
  timestamp: number,
): SpatialCandidate {
  return {
    objectId: nearest.object.id,
    distancePx: nearest.distancePx,
    enteredAt: timestamp,
    stable: false,
    contender: null,
  };
}

function nearestMagneticObject(
  point: CanvasPoint,
  scene: SpatialGestureScene,
  radiusPx: number,
) {
  return (
    scene.objects
      .filter((object) => !object.minimized)
      .map((object) => ({
        object,
        distancePx: rounded(
          distanceToObjectRectangle(point, object) * scene.viewport.scale,
        ),
        radiusPx: objectMagneticRadiusPx(scene, object, radiusPx),
      }))
      .filter(
        ({ distancePx, radiusPx: objectRadiusPx }) =>
          distancePx <= objectRadiusPx,
      )
      .sort(
        (left, right) =>
          left.distancePx - right.distancePx ||
          right.object.zIndex - left.object.zIndex,
      )[0] ?? null
  );
}

function distanceToObjectRectangle(
  point: CanvasPoint,
  object: Pick<
    SpatialGestureScene["objects"][number],
    "x" | "y" | "width" | "height" | "rotation" | "minimized"
  >,
) {
  const height = object.minimized ? 62 : object.height;
  const centerX = object.x + object.width / 2;
  const centerY = object.y + height / 2;
  const radians = (-Number(object.rotation ?? 0) * Math.PI) / 180;
  const deltaX = point.x - centerX;
  const deltaY = point.y - centerY;
  const localX = deltaX * Math.cos(radians) - deltaY * Math.sin(radians);
  const localY = deltaX * Math.sin(radians) + deltaY * Math.cos(radians);
  const outsideX = Math.max(Math.abs(localX) - object.width / 2, 0);
  const outsideY = Math.max(Math.abs(localY) - height / 2, 0);
  return Math.hypot(outsideX, outsideY);
}

function heldRectangle(held: SpatialHeldState) {
  return { ...held.currentTransform, minimized: false };
}

function bimanualGeometryForTracks(
  input: Extract<SpatialGestureInput, { mode: "bimanual_pinch" }>,
  scene: SpatialGestureScene,
  ownerTrackId: string,
  secondTrackId: string,
) {
  const owner = input.hands?.find(({ trackId }) => trackId === ownerTrackId);
  const second = input.hands?.find(({ trackId }) => trackId === secondTrackId);
  if (!owner || !second) return null;
  return geometryFromPoints(
    normalizedToWorld(owner.motionPointer ?? owner.pointer, scene),
    normalizedToWorld(second.motionPointer ?? second.pointer, scene),
  );
}

function geometryFromPoints(first: CanvasPoint, second: CanvasPoint) {
  return {
    centroid: {
      x: rounded((first.x + second.x) / 2),
      y: rounded((first.y + second.y) / 2),
    },
    span: pointDistance(first, second),
    angle: (Math.atan2(second.y - first.y, second.x - first.x) * 180) / Math.PI,
  };
}

function completeEdgeEffect(
  objectId: string,
  action: SpatialArmedEdgeAction,
): SpatialGestureCompletionEffect {
  if (action.action === "maximize") {
    if (!action.maximizeTransform)
      throw new Error("A maximize action requires a captured transform.");
    return {
      type: "object.complete_edge_action",
      objectId,
      action: "maximize",
      edge: "top",
      transform: action.maximizeTransform,
    };
  }
  if (action.action === "minimize")
    return {
      type: "object.complete_edge_action",
      objectId,
      action: "minimize",
      edge: "bottom",
    };
  return {
    type: "object.complete_edge_action",
    objectId,
    action: "discard",
    edge: action.edge === "right" ? "right" : "left",
  };
}

export function spatialGestureCompletionToCommand(
  effect: SpatialGestureCompletionEffect,
): CanvasCommand {
  if (effect.type === "object.complete_transform")
    return {
      type: "object.transform",
      objectId: effect.objectId,
      transform: effect.transform,
    };
  if (effect.action === "maximize")
    return {
      type: "object.transform",
      objectId: effect.objectId,
      transform: effect.transform,
    };
  if (effect.action === "minimize")
    return {
      type: "object.set_flags",
      objectId: effect.objectId,
      flags: { minimized: true },
    };
  return { type: "object.discard", objectId: effect.objectId };
}

export function createGestureSketchCommand(
  strokes: readonly (readonly CanvasPoint[])[],
  options: {
    objectId: string;
    strokeIds: readonly string[];
    strokeReceipts?: readonly GestureStrokeReceipt[];
    zIndex: number;
  },
): CanvasCommand {
  if (
    strokes.length === 0 ||
    strokes.some((points) => points.length < 2) ||
    strokes.length !== options.strokeIds.length ||
    (options.strokeReceipts !== undefined &&
      (options.strokeReceipts.length !== strokes.length ||
        options.strokeReceipts.some(
          (receipt, index) =>
            !gestureStrokeReceiptMatchesWorldStroke(
              receipt,
              strokes[index]!,
              options.strokeIds[index]!,
            ),
        )))
  )
    throw new RangeError(
      "A finger sketch needs one ID and at least two points per stroke.",
    );
  const points = strokes.flat();
  const padding = 16;
  const minimumX = Math.min(...points.map((point) => point.x));
  const minimumY = Math.min(...points.map((point) => point.y));
  const maximumX = Math.max(...points.map((point) => point.x));
  const maximumY = Math.max(...points.map((point) => point.y));
  const x = minimumX - padding;
  const y = minimumY - padding;
  return {
    type: "object.create",
    object: {
      id: options.objectId,
      type: "sketch",
      title: "Finger sketch",
      x,
      y,
      width: Math.max(160, maximumX - minimumX + padding * 2),
      height: Math.max(80, maximumY - minimumY + padding * 2),
      zIndex: options.zIndex,
      payload: {
        ...(options.strokeReceipts
          ? {
              strokeReceipts: options.strokeReceipts.map((receipt) =>
                localizeGestureStrokeReceipt(receipt, x, y),
              ),
            }
          : {}),
        strokes: strokes.map((stroke, index) => ({
          id: options.strokeIds[index]!,
          color: "#f6b44c",
          width: 5,
          points: stroke.map((point) => ({
            x: point.x - x,
            y: point.y - y,
          })),
        })),
      },
    },
  };
}

function gestureStrokeReceiptMatchesWorldStroke(
  receipt: GestureStrokeReceipt,
  stroke: readonly CanvasPoint[],
  strokeId: string,
) {
  if (receipt.strokeId !== strokeId) return false;
  const hasVersion = receipt.sampleProvenanceVersion !== undefined;
  const hasSamples = receipt.samples !== undefined;
  if (hasVersion !== hasSamples) return false;
  if (!receipt.samples) return true;
  if (
    receipt.pointCount !== stroke.length ||
    receipt.samples.length !== stroke.length
  )
    return false;
  const counts = {
    measured: 0,
    "short-gap predicted": 0,
    interpolated: 0,
  };
  for (const [index, sample] of receipt.samples.entries()) {
    counts[sample.sampleKind] += 1;
    const point = stroke[index];
    if (
      !point ||
      sample.strokeId !== receipt.strokeId ||
      sample.handTrackId !== receipt.handTrackId ||
      sample.timestampMs < receipt.penDownAt ||
      sample.timestampMs > receipt.penUpAt ||
      (index > 0 &&
        sample.timestampMs <= receipt.samples[index - 1]!.timestampMs) ||
      sample.renderedPoint.x !== point.x ||
      sample.renderedPoint.y !== point.y
    )
      return false;
  }
  return (
    counts.measured === receipt.measuredPointCount &&
    counts["short-gap predicted"] === receipt.predictedPointCount &&
    counts.interpolated === receipt.interpolatedPointCount
  );
}

function localizeGestureStrokeReceipt(
  receipt: GestureStrokeReceipt,
  objectX: number,
  objectY: number,
): GestureStrokeReceipt {
  if (!receipt.samples) return { ...receipt };
  return {
    ...receipt,
    sampleProvenanceVersion: 1,
    samples: receipt.samples.map((sample) => ({
      ...sample,
      rawIndexTip: { ...sample.rawIndexTip },
      filteredIndexTip: { ...sample.filteredIndexTip },
      renderedPoint: {
        x: sample.renderedPoint.x - objectX,
        y: sample.renderedPoint.y - objectY,
      },
    })),
  };
}

function mapSpatialGestureInput(
  input: SpatialGestureInput,
  activeZone: HandActiveZone,
): SpatialGestureInput {
  if (input.mode === "idle") return input;
  if (input.mode !== "bimanual_pinch")
    return {
      ...input,
      pointer: mapHandPointerToActiveZone(input.pointer, activeZone),
      ...(input.motionPointer
        ? {
            motionPointer: mapHandPointerToActiveZone(
              input.motionPointer,
              activeZone,
            ),
          }
        : {}),
    };
  const pointers = [
    mapHandPointerToActiveZone(input.pointers[0], activeZone),
    mapHandPointerToActiveZone(input.pointers[1], activeZone),
  ] as const;
  return {
    ...input,
    pointers,
    span: Math.hypot(
      pointers[0].x - pointers[1].x,
      pointers[0].y - pointers[1].y,
    ),
    ...(input.hands
      ? {
          hands: input.hands.map((hand) => ({
            ...hand,
            pointer: mapHandPointerToActiveZone(hand.pointer, activeZone),
            ...(hand.motionPointer
              ? {
                  motionPointer: mapHandPointerToActiveZone(
                    hand.motionPointer,
                    activeZone,
                  ),
                }
              : {}),
          })) as [SpatialBimanualHand, SpatialBimanualHand],
        }
      : {}),
  };
}

function normalizeLegacyState(state: SpatialGestureState) {
  if (
    state.phase !== "grabbing" &&
    state.phase !== "resizing" &&
    state.phase !== "dwelling" &&
    state.phase !== "zooming" &&
    state.phase !== "awaiting_neutral"
  )
    return state;
  if (state.phase === "zooming") return { ...state, phase: "panning" as const };
  if (state.phase === "grabbing" && state.held)
    return { ...state, phase: "held_one" as const };
  return createInitialSpatialGestureState();
}

function objectTransform(
  object: SpatialGestureScene["objects"][number],
): SpatialTransform {
  return {
    x: object.x,
    y: object.y,
    width: rounded(clamp(object.width, MIN_OBJECT_WIDTH, MAX_OBJECT_WIDTH)),
    height: rounded(
      clamp(
        object.minimized ? 62 : object.height,
        MIN_OBJECT_HEIGHT,
        MAX_OBJECT_HEIGHT,
      ),
    ),
    rotation: rounded(normalizeAngle(object.rotation ?? 0)),
  };
}

function previewTransformEffect(held: SpatialHeldState) {
  return {
    type: "object.preview_transform" as const,
    objectId: held.objectId,
    transform: held.currentTransform,
  };
}

function maximizeTransform(scene: SpatialGestureScene): SpatialTransform {
  return {
    x: rounded(-scene.viewport.x / scene.viewport.scale),
    y: rounded(-scene.viewport.y / scene.viewport.scale),
    width: rounded(
      clamp(
        scene.bounds.width / scene.viewport.scale,
        MIN_OBJECT_WIDTH,
        MAX_OBJECT_WIDTH,
      ),
    ),
    height: rounded(
      clamp(
        scene.bounds.height / scene.viewport.scale,
        MIN_OBJECT_HEIGHT,
        MAX_OBJECT_HEIGHT,
      ),
    ),
    rotation: 0,
  };
}

function ownsObject(state: SpatialGestureState) {
  return Boolean(
    state.held &&
    (state.phase === "held_one" ||
      state.phase === "two_hand_pending" ||
      state.phase === "transforming_two" ||
      state.phase === "edge_action_armed"),
  );
}

function authoritativeOwnedPhase(
  phase: SpatialGesturePhase,
): "held_one" | "two_hand_pending" | "transforming_two" | "edge_action_armed" {
  if (
    phase === "two_hand_pending" ||
    phase === "transforming_two" ||
    phase === "edge_action_armed"
  )
    return phase;
  return "held_one";
}

function inputIsUnsafe(input: SpatialGestureInput) {
  if (input.mode === "idle") return input.reason === "loss";
  if (input.mode === "bimanual_pinch")
    return Boolean(input.hands?.some((hand) => !isTrusted(hand)));
  return Boolean(input.reliability && !isTrusted(input.reliability));
}

function isTrusted(evidence: SpatialReliabilityEvidence | undefined) {
  return Boolean(
    evidence &&
    evidence.real &&
    !evidence.predicted &&
    evidence.confidence >= INTERACTION_CONFIDENCE &&
    evidence.trackingState === "tracked",
  );
}

function isEdgeTrusted(evidence: SpatialReliabilityEvidence | undefined) {
  return Boolean(
    isTrusted(evidence) && evidence!.confidence >= EDGE_CONFIDENCE,
  );
}

function transformChanged(before: SpatialTransform, after: SpatialTransform) {
  return (
    before.x !== after.x ||
    before.y !== after.y ||
    before.width !== after.width ||
    before.height !== after.height ||
    before.rotation !== after.rotation
  );
}

function normalizedToWorld(pointer: CanvasPoint, scene: SpatialGestureScene) {
  return {
    x: rounded(
      (pointer.x * scene.bounds.width - scene.viewport.x) /
        scene.viewport.scale,
    ),
    y: rounded(
      (pointer.y * scene.bounds.height - scene.viewport.y) /
        scene.viewport.scale,
    ),
  };
}

function normalizedToScreen(pointer: CanvasPoint, scene: SpatialGestureScene) {
  return {
    x: rounded(scene.bounds.left + pointer.x * scene.bounds.width),
    y: rounded(scene.bounds.top + pointer.y * scene.bounds.height),
  };
}

function magneticRadiusPx(scene: SpatialGestureScene) {
  return clamp(
    Math.min(scene.bounds.width, scene.bounds.height) * 0.04,
    28,
    56,
  );
}

function directPinchMagneticRadiusPx(scene: SpatialGestureScene) {
  return clamp(
    Math.min(scene.bounds.width, scene.bounds.height) * 0.08,
    48,
    72,
  );
}

function objectMagneticRadiusPx(
  scene: SpatialGestureScene,
  object: SpatialGestureScene["objects"][number],
  baseRadiusPx: number,
) {
  if (baseRadiusPx <= 0) return 0;
  const screenArea =
    object.width *
    scene.viewport.scale *
    (object.minimized ? 62 : object.height) *
    scene.viewport.scale;
  const characteristicSize = Math.sqrt(Math.max(0, screenArea));
  const sizeBonus = clamp((characteristicSize - 240) * 0.2, 0, 36);
  return rounded(baseRadiusPx + sizeBonus);
}

function normalizeAngle(angle: number) {
  let normalized = angle % 360;
  if (normalized > 180) normalized -= 360;
  if (normalized < -180) normalized += 360;
  return normalized;
}

function timestampOf(input: SpatialGestureInput) {
  return requiredTimestamp(input.timestamp);
}

function requiredTimestamp(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : 0;
}

function empty() {
  return { state: createInitialSpatialGestureState(), effects: [] as const };
}

function validateHandActiveZone(activeZone: HandActiveZone): HandActiveZone {
  if (
    !activeZone ||
    !Number.isFinite(activeZone.left) ||
    !Number.isFinite(activeZone.right) ||
    !Number.isFinite(activeZone.top) ||
    !Number.isFinite(activeZone.bottom) ||
    activeZone.left < 0 ||
    activeZone.right > 1 ||
    activeZone.top < 0 ||
    activeZone.bottom > 1 ||
    activeZone.left >= activeZone.right ||
    activeZone.top >= activeZone.bottom
  )
    throw new RangeError(
      "A hand active zone needs finite, ordered bounds within zero and one.",
    );
  return activeZone;
}

function appendDistinctPoint(
  points: readonly CanvasPoint[],
  point: CanvasPoint,
) {
  const previous = points.at(-1);
  if (previous && pointDistance(previous, point) < 2) return points;
  return [...points, point];
}

function pointDistance(left: CanvasPoint, right: CanvasPoint) {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function rounded(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}
