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
  candidate: SpatialCandidate | null;
  pinchPending: {
    readonly objectId: string | null;
    readonly ownerTrackId: string;
    readonly startedAt: number;
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
    readonly initialSpan: number;
    readonly initialScale: number;
    readonly screenPoint: CanvasPoint;
  } | null;
  palm: null;
  resize: null;
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
  | { type: "stroke.preview"; points: readonly CanvasPoint[] }
  | { type: "stroke.commit"; points: readonly CanvasPoint[] }
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
const CONTENDER_DWELL_MS = 80;
const CONTENDER_DISTANCE_ADVANTAGE_PX = 12;
const TARGET_EXIT_HYSTERESIS_PX = 12;
const SECOND_HAND_DWELL_MS = 100;
const SECOND_HAND_NEAR_OBJECT_PX = 72;
const TWO_HAND_LOSS_GRACE_MS = 300;
const ROTATION_DEADBAND_DEGREES = 4.5;
const MIN_TRANSFORM_SCALE = 0.25;
const MAX_TRANSFORM_SCALE = 4;
const LOG_SCALE_ALPHA = 0.65;
const EDGE_ZONE_PX = 64;
const EDGE_DWELL_MS = 100;
const SLOW_EDGE_MAX_SPEED_PX_PER_SECOND = 400;
const THROW_MIN_SPEED_PX_PER_SECOND = 800;
const THROW_MIN_WINDOW_MS = 80;
const THROW_MAX_WINDOW_MS = 120;
const THROW_MIN_DIRECTION_COSINE = 0.85;
const EDGE_RELEASE_WINDOW_MS = 120;
const EDGE_CONFIDENCE = 0.8;
const MIN_BIMANUAL_SPAN_PX = 8;

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
    return { state: createInitialSpatialGestureState(), effects: [] };
  if (current.phase === "drawing") return endStroke(current);
  if (current.phase === "lost_grace")
    return reduceLostGrace(current, mapped, scene, policy);
  if (ownsObject(current) && inputIsUnsafe(mapped))
    return enterLostGrace(current, timestampOf(mapped), true);
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

function reduceDrawing(
  state: SpatialGestureState,
  input: SpatialGestureInput,
  scene: SpatialGestureScene,
): SpatialGestureTransition {
  if (input.mode === "point") {
    if (inputIsUnsafe(input))
      return state.phase === "drawing" ? endStroke(state) : empty();
    const worldPoint = normalizedToWorld(input.pointer, scene);
    const points =
      state.phase === "drawing"
        ? appendDistinctPoint(state.stroke, worldPoint)
        : [worldPoint];
    return {
      state: {
        ...createInitialSpatialGestureState(),
        phase: "drawing" as const,
        stroke: points,
      },
      effects: [{ type: "stroke.preview" as const, points }],
    };
  }
  if (state.phase === "drawing") return endStroke(state);
  return empty();
}

function endStroke(state: SpatialGestureState): SpatialGestureTransition {
  return {
    state: createInitialSpatialGestureState(),
    effects: [
      ...(state.stroke.length >= 2
        ? ([{ type: "stroke.commit", points: state.stroke }] as const)
        : []),
      { type: "preview.clear" as const },
    ],
  };
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
      ? ([{ type: "object.target", objectId: nextCandidate?.objectId ?? null }] as const)
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
  const objectId = state.pinchPending?.objectId ?? state.candidate?.objectId ?? null;
  const startedAt = state.pinchPending?.startedAt ?? timestamp;
  const stable =
    objectId !== null &&
    ((state.candidate?.objectId === objectId && state.candidate.stable) ||
      timestamp - startedAt >= TARGET_DWELL_MS);
  if (!stable || !objectId)
    return {
      state: {
        ...createInitialSpatialGestureState(),
        phase: "pinch_pending",
        candidate: state.candidate,
        pinchPending: { objectId, ownerTrackId, startedAt },
      },
      effects: [],
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
  const motionWorld = normalizedToWorld(input.motionPointer ?? input.pointer, scene);
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
  const motionWorld = normalizedToWorld(input.motionPointer ?? input.pointer, scene);
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
  const owner = input.hands.find(({ trackId }) => trackId === state.held?.ownerTrackId);
  const second = input.hands.find(({ trackId }) => trackId !== state.held?.ownerTrackId);
  if (!owner || !second) return enterLostGrace(state, timestampOf(input), true);
  const timestamp = requiredTimestamp(input.timestamp);
  if (state.phase === "transforming_two" && state.transform)
    return updateTwoHandTransform(state, input, scene);
  const secondWorld = normalizedToWorld(second.pointer, scene);
  if (
    distanceToObjectRectangle(secondWorld, heldRectangle(state.held)) *
      scene.viewport.scale >
    SECOND_HAND_NEAR_OBJECT_PX
  )
    return {
      state: { ...state, phase: "held_one", secondHand: null, edgeAction: null },
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
  const geometry = bimanualGeometry(input, scene);
  if (geometry.span < MIN_BIMANUAL_SPAN_PX)
    return { state: { ...state, phase: "two_hand_pending", secondHand }, effects: [] };
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
  const geometry = bimanualGeometry(input, scene);
  if (!Number.isFinite(geometry.span) || geometry.span <= 0)
    return enterLostGrace(state, timestampOf(input), true);
  const boundedScale = clamp(
    geometry.span / state.transform.baselineSpan,
    MIN_TRANSFORM_SCALE,
    MAX_TRANSFORM_SCALE,
  );
  const targetLogScale = Math.log(boundedScale);
  const smoothedLogScale =
    boundedScale === MIN_TRANSFORM_SCALE || boundedScale === MAX_TRANSFORM_SCALE
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
  const baseline = state.transform.baselineObject;
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
    rotation: rounded(baseline.rotation + appliedRotation),
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
  const trustedRelease =
    input.mode !== "idle" &&
    input.mode !== "bimanual_pinch" &&
    isTrusted(input.reliability);
  const edge = state.edgeAction;
  const edgeEligible = Boolean(
    trustedRelease &&
      edge &&
      edge.qualifiedAt !== null &&
      edge.lastQualifiedAt !== null &&
      edge.previewVisible &&
      timestamp - edge.lastQualifiedAt <= EDGE_RELEASE_WINDOW_MS,
  );
  const effects: SpatialGestureEffect[] = [];
  if (edgeEligible && edge)
    effects.push(completeEdgeEffect(state.held.objectId, edge));
  else if (transformChanged(state.held.initialTransform, state.held.currentTransform))
    effects.push({
      type: "object.complete_transform",
      objectId: state.held.objectId,
      transform: state.held.currentTransform,
    });
  effects.push({ type: "preview.clear" });
  if (input.mode === "point" && policy.manipulationEnabled) {
    const hovered = reduceHover(createInitialSpatialGestureState(), input, scene);
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
    return {
      state: createInitialSpatialGestureState(),
      effects: [{ type: "preview.clear" as const }],
    };
  if (input.mode === "idle" || inputIsUnsafe(input)) return { state, effects: [] };
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
  if (input.mode === "pinch" && input.reliability?.trackId === state.held.ownerTrackId)
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
    ? rounded((input.pointer.x - previous.previousPointerX) * scene.bounds.width)
    : 0;
  const deltaY = previous
    ? rounded((input.pointer.y - previous.previousPointerY) * scene.bounds.height)
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
  if (input.hands && input.hands.some((hand) => !isTrusted(hand))) return empty();
  const geometry = bimanualGeometry(input, scene);
  if (geometry.span < MIN_BIMANUAL_SPAN_PX) return empty();
  if (state.phase === "panning" && state.zoom) {
    const scale = rounded(
      clamp(state.zoom.initialScale * (geometry.span / state.zoom.initialSpan), 0.35, 2.5),
    );
    return {
      state,
      effects: [
        { type: "viewport.zoom_at" as const, scale, screenPoint: state.zoom.screenPoint },
      ],
    };
  }
  const screenPoint = worldToScreen(geometry.centroid, scene);
  return {
    state: {
      ...createInitialSpatialGestureState(),
      phase: "panning",
      zoom: {
        initialSpan: geometry.span,
        initialScale: scene.viewport.scale,
        screenPoint,
      },
    },
    effects: [
      { type: "viewport.zoom_at" as const, scale: scene.viewport.scale, screenPoint },
    ],
  };
}

function updateEdgeAction(
  previous: SpatialArmedEdgeAction | null,
  held: SpatialHeldState,
  history: readonly SpatialMotionSample[],
  input: Extract<SpatialGestureInput, { mode: "pinch" }>,
  scene: SpatialGestureScene,
): { action: SpatialArmedEdgeAction | null; effects: readonly SpatialGestureEffect[] } {
  if (!isTrusted(input.reliability)) return { action: null, effects: [] };
  const timestamp = requiredTimestamp(input.timestamp);
  const zone = edgeZone(normalizedToScreen(input.pointer, scene), scene);
  if (!zone) return clearEdgeAction(previous, held.objectId);
  const sameZone = previous?.edge === zone.edge && previous.action === zone.action;
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
    ? previous?.qualifiedAt ?? timestamp
    : sameZone
      ? previous?.qualifiedAt ?? null
      : null;
  const lastQualifiedAt = qualified
    ? timestamp
    : sameZone
      ? previous?.lastQualifiedAt ?? null
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
      screenPoint: normalizedToScreen(input.motionPointer ?? input.pointer, scene),
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
): SpatialCandidate | null {
  const radius = magneticRadiusPx(scene);
  const nearest = nearestMagneticObject(point, scene, radius);
  if (!current) return nearest ? newCandidate(nearest, timestamp) : null;
  const currentObject = scene.objects.find(({ id }) => id === current.objectId);
  if (!currentObject) return nearest ? newCandidate(nearest, timestamp) : null;
  const currentDistancePx =
    distanceToObjectRectangle(point, currentObject) * scene.viewport.scale;
  if (currentDistancePx > radius + TARGET_EXIT_HYSTERESIS_PX && !nearest)
    return null;
  const stable = current.stable || timestamp - current.enteredAt >= TARGET_DWELL_MS;
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
      }))
      .filter(({ distancePx }) => distancePx <= radiusPx)
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

function bimanualGeometry(
  input: Extract<SpatialGestureInput, { mode: "bimanual_pinch" }>,
  scene: SpatialGestureScene,
) {
  const points = input.hands
    ? input.hands.map((hand) =>
        normalizedToWorld(hand.motionPointer ?? hand.pointer, scene),
      )
    : input.pointers.map((pointer) => normalizedToWorld(pointer, scene));
  const first = points[0]!;
  const second = points[1]!;
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
    zIndex: number;
  },
): CanvasCommand {
  if (
    strokes.length === 0 ||
    strokes.some((points) => points.length < 2) ||
    strokes.length !== options.strokeIds.length
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
        ? { motionPointer: mapHandPointerToActiveZone(input.motionPointer, activeZone) }
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
    width: object.width,
    height: object.minimized ? 62 : object.height,
    rotation: object.rotation ?? 0,
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
    width: rounded(scene.bounds.width / scene.viewport.scale),
    height: rounded(scene.bounds.height / scene.viewport.scale),
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
      evidence.confidence >= EDGE_CONFIDENCE &&
      evidence.trackingState === "tracked",
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
      (pointer.x * scene.bounds.width - scene.viewport.x) / scene.viewport.scale,
    ),
    y: rounded(
      (pointer.y * scene.bounds.height - scene.viewport.y) / scene.viewport.scale,
    ),
  };
}

function normalizedToScreen(pointer: CanvasPoint, scene: SpatialGestureScene) {
  return {
    x: rounded(scene.bounds.left + pointer.x * scene.bounds.width),
    y: rounded(scene.bounds.top + pointer.y * scene.bounds.height),
  };
}

function worldToScreen(point: CanvasPoint, scene: SpatialGestureScene) {
  return {
    x: rounded(point.x * scene.viewport.scale + scene.viewport.x),
    y: rounded(point.y * scene.viewport.scale + scene.viewport.y),
  };
}

function magneticRadiusPx(scene: SpatialGestureScene) {
  return clamp(Math.min(scene.bounds.width, scene.bounds.height) * 0.04, 28, 56);
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
