import type { CanvasCommand } from "@/lib/canvas/command-engine";
import type { CanvasPoint, CanvasViewport } from "@/lib/canvas/coordinates";

export interface SpatialGestureScene {
  bounds: { left: number; top: number; width: number; height: number };
  viewport: CanvasViewport;
  selectedObjectId?: string | null;
  objects: readonly {
    id: string;
    x: number;
    y: number;
    width: number;
    height: number;
    zIndex: number;
    pinned: boolean;
    minimized: boolean;
  }[];
}

export interface SpatialGestureState {
  phase:
    | "idle"
    | "drawing"
    | "grabbing"
    | "dwelling"
    | "resizing"
    | "awaiting_neutral";
  stroke: readonly CanvasPoint[];
  grab: {
    objectId: string;
    offsetX: number;
    offsetY: number;
    initialX: number;
    initialY: number;
    currentX: number;
    currentY: number;
    startPointerX: number;
    startPointerY: number;
    currentPointerX: number;
    currentPointerY: number;
    startedAt: number | null;
    currentAt: number | null;
  } | null;
  palm: {
    objectId: string;
    anchorX: number;
    anchorY: number;
    startedAt: number;
  } | null;
  resize: {
    objectId: string;
    initialSpan: number;
    initialWidth: number;
    initialHeight: number;
    currentWidth: number;
    currentHeight: number;
  } | null;
}

export interface SpatialGesturePolicy {
  drawingEnabled: boolean;
  manipulationEnabled: boolean;
}

export type SpatialGestureInput =
  | { mode: "idle"; timestamp?: number }
  | {
      mode: "point";
      pointer: { x: number; y: number };
      timestamp?: number;
    }
  | {
      mode: "pinch";
      pointer: { x: number; y: number };
      timestamp?: number;
    }
  | {
      mode: "open_palm";
      pointer: { x: number; y: number };
      timestamp?: number;
    }
  | {
      mode: "bimanual_pinch";
      pointers: readonly [CanvasPoint, CanvasPoint];
      span: number;
      timestamp?: number;
    };

export type SpatialGestureEffect =
  | { type: "stroke.preview"; points: readonly CanvasPoint[] }
  | { type: "stroke.commit"; points: readonly CanvasPoint[] }
  | { type: "object.select"; objectId: string }
  | { type: "object.target"; objectId: string | null }
  | {
      type: "object.preview_move";
      objectId: string;
      x: number;
      y: number;
    }
  | {
      type: "object.commit_move";
      objectId: string;
      x: number;
      y: number;
    }
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
  | {
      type: "palm.progress";
      objectId: string;
      progress: number;
    }
  | { type: "preview.clear" };

const PALM_DWELL_MS = 650;
const PALM_MAX_DRIFT = 0.04;
const SWIPE_MIN_DURATION_MS = 80;
const SWIPE_MAX_DURATION_MS = 450;
const DISCARD_EDGE_THRESHOLD = 0.06;
const MINIMIZE_DOCK_THRESHOLD = 0.92;
const SWIPE_MIN_DISTANCE = 0.2;
const SWIPE_MIN_SPEED_PER_SECOND = 0.65;
const MIN_BIMANUAL_SPAN = 0.08;
const OBJECT_TARGET_SLOP_SCREEN_PX = 42;

const DEFAULT_SPATIAL_GESTURE_POLICY: SpatialGesturePolicy = Object.freeze({
  drawingEnabled: true,
  manipulationEnabled: true,
});

export function createInitialSpatialGestureState(): SpatialGestureState {
  return { phase: "idle", stroke: [], grab: null, palm: null, resize: null };
}

export function reduceSpatialGesture(
  state: SpatialGestureState,
  input: SpatialGestureInput,
  scene: SpatialGestureScene,
  policy: SpatialGesturePolicy = DEFAULT_SPATIAL_GESTURE_POLICY,
): { state: SpatialGestureState; effects: readonly SpatialGestureEffect[] } {
  if (input.mode === "idle") return finishActiveGesture(state, "idle");
  if (state.phase === "awaiting_neutral")
    return { state, effects: [] };

  if (input.mode === "bimanual_pinch") {
    if (!policy.manipulationEnabled)
      return state.phase === "drawing"
        ? finishActiveGesture(state, "idle")
        : { state: createInitialSpatialGestureState(), effects: [] };
    return reduceBimanualPinch(state, input, scene);
  }

  if (input.mode === "open_palm") {
    if (!policy.manipulationEnabled)
      return state.phase === "drawing"
        ? finishActiveGesture(state, "idle")
        : { state: createInitialSpatialGestureState(), effects: [] };
    if (
      state.phase === "drawing" ||
      state.phase === "grabbing" ||
      state.phase === "resizing"
    )
      return finishActiveGesture(state, "awaiting_neutral");
    return reducePalmDwell(state, input, scene);
  }

  const point = normalizedToWorld(input.pointer, scene);
  if (input.mode === "point") {
    if (state.phase === "grabbing" || state.phase === "resizing")
      return finishActiveGesture(state, "awaiting_neutral");
    if (!policy.drawingEnabled) {
      if (state.phase === "drawing") return finishActiveGesture(state, "idle");
      const target = hitTest(
        point,
        scene.objects,
        OBJECT_TARGET_SLOP_SCREEN_PX / scene.viewport.scale,
      );
      return {
        state: createInitialSpatialGestureState(),
        effects: [{ type: "object.target", objectId: target?.id ?? null }],
      };
    }

    const points =
      state.phase === "drawing"
        ? appendDistinctPoint(state.stroke, point)
        : [point];
    return {
      state: {
        phase: "drawing",
        stroke: points,
        grab: null,
        palm: null,
        resize: null,
      },
      effects: [{ type: "stroke.preview", points }],
    };
  }

  if (state.phase === "drawing") return finishActiveGesture(state, "idle");
  if (!policy.manipulationEnabled)
    return { state: createInitialSpatialGestureState(), effects: [] };
  if (state.phase === "grabbing" && state.grab) {
    const x = point.x - state.grab.offsetX;
    const y = point.y - state.grab.offsetY;
    const grab = {
      ...state.grab,
      currentX: x,
      currentY: y,
      currentPointerX: input.pointer.x,
      currentPointerY: input.pointer.y,
      currentAt: validTimestamp(input.timestamp),
    };
    return {
      state: {
        phase: "grabbing",
        stroke: [],
        grab,
        palm: null,
        resize: null,
      },
      effects: [
        { type: "object.preview_move", objectId: grab.objectId, x, y },
      ],
    };
  }

  const hit = hitTest(
    point,
    scene.objects,
    OBJECT_TARGET_SLOP_SCREEN_PX / scene.viewport.scale,
  );
  if (!hit) return { state: createInitialSpatialGestureState(), effects: [] };
  if (hit.pinned)
    return {
      state: createInitialSpatialGestureState(),
      effects: [{ type: "object.select", objectId: hit.id }],
    };

  const grab = {
    objectId: hit.id,
    offsetX: point.x - hit.x,
    offsetY: point.y - hit.y,
    initialX: hit.x,
    initialY: hit.y,
    currentX: hit.x,
    currentY: hit.y,
    startPointerX: input.pointer.x,
    startPointerY: input.pointer.y,
    currentPointerX: input.pointer.x,
    currentPointerY: input.pointer.y,
    startedAt: validTimestamp(input.timestamp),
    currentAt: validTimestamp(input.timestamp),
  };
  return {
    state: {
      phase: "grabbing",
      stroke: [],
      grab,
      palm: null,
      resize: null,
    },
    effects: [
      { type: "object.select", objectId: hit.id },
      {
        type: "object.preview_move",
        objectId: hit.id,
        x: hit.x,
        y: hit.y,
      },
    ],
  };
}

function reducePalmDwell(
  state: SpatialGestureState,
  input: Extract<SpatialGestureInput, { mode: "open_palm" }>,
  scene: SpatialGestureScene,
): { state: SpatialGestureState; effects: readonly SpatialGestureEffect[] } {
  const timestamp = validTimestamp(input.timestamp);
  const point = normalizedToWorld(input.pointer, scene);
  const hit = hitTest(point, scene.objects);
  if (!hit || timestamp === null)
    return { state: createInitialSpatialGestureState(), effects: [] };

  const continuing =
    state.phase === "dwelling" &&
    state.palm?.objectId === hit.id &&
    Math.hypot(
      input.pointer.x - state.palm.anchorX,
      input.pointer.y - state.palm.anchorY,
    ) <= PALM_MAX_DRIFT;
  if (!continuing || !state.palm) {
    return {
      state: {
        phase: "dwelling",
        stroke: [],
        grab: null,
        resize: null,
        palm: {
          objectId: hit.id,
          anchorX: input.pointer.x,
          anchorY: input.pointer.y,
          startedAt: timestamp,
        },
      },
      effects: [
        { type: "object.select", objectId: hit.id },
        { type: "palm.progress", objectId: hit.id, progress: 0 },
      ],
    };
  }

  const elapsed = Math.max(0, timestamp - state.palm.startedAt);
  if (elapsed < PALM_DWELL_MS)
    return {
      state,
      effects: [
        {
          type: "palm.progress",
          objectId: hit.id,
          progress: rounded(elapsed / PALM_DWELL_MS),
        },
      ],
    };

  return {
    state: {
      phase: "awaiting_neutral",
      stroke: [],
      grab: null,
      palm: null,
      resize: null,
    },
    effects: [
      {
        type: hit.minimized ? "object.restore" : "object.focus",
        objectId: hit.id,
      },
    ],
  };
}

function reduceBimanualPinch(
  state: SpatialGestureState,
  input: Extract<SpatialGestureInput, { mode: "bimanual_pinch" }>,
  scene: SpatialGestureScene,
): { state: SpatialGestureState; effects: readonly SpatialGestureEffect[] } {
  if (!Number.isFinite(input.span) || input.span < MIN_BIMANUAL_SPAN)
    return { state: createInitialSpatialGestureState(), effects: [] };

  if (state.phase === "resizing" && state.resize) {
    const scale = input.span / state.resize.initialSpan;
    const width = rounded(
      clamp(state.resize.initialWidth * scale, 160, 2_000),
    );
    const height = rounded(
      clamp(state.resize.initialHeight * scale, 80, 1_400),
    );
    const resize = {
      ...state.resize,
      currentWidth: width,
      currentHeight: height,
    };
    return {
      state: {
        phase: "resizing",
        stroke: [],
        grab: null,
        palm: null,
        resize,
      },
      effects: [
        {
          type: "object.preview_resize",
          objectId: resize.objectId,
          width,
          height,
        },
      ],
    };
  }

  if (state.phase === "drawing" || state.phase === "dwelling")
    return finishActiveGesture(state, "awaiting_neutral");

  const center = {
    x: (input.pointers[0].x + input.pointers[1].x) / 2,
    y: (input.pointers[0].y + input.pointers[1].y) / 2,
  };
  const selected = scene.selectedObjectId
    ? scene.objects.find((object) => object.id === scene.selectedObjectId)
    : undefined;
  const held =
    state.phase === "grabbing" && state.grab
      ? scene.objects.find((object) => object.id === state.grab?.objectId)
      : undefined;
  const target = held ?? selected ?? hitTest(normalizedToWorld(center, scene), scene.objects);
  if (!target || target.pinned || target.minimized)
    return { state: createInitialSpatialGestureState(), effects: [] };

  const resize = {
    objectId: target.id,
    initialSpan: input.span,
    initialWidth: target.width,
    initialHeight: target.height,
    currentWidth: target.width,
    currentHeight: target.height,
  };
  return {
    state: {
      phase: "resizing",
      stroke: [],
      grab: null,
      palm: null,
      resize,
    },
    effects: [
      ...(held ? ([{ type: "preview.clear" }] as const) : []),
      { type: "object.select", objectId: target.id },
      {
        type: "object.preview_resize",
        objectId: target.id,
        width: target.width,
        height: target.height,
      },
    ],
  };
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
            id: options.strokeIds[index],
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

function finishActiveGesture(
  state: SpatialGestureState,
  nextPhase: "idle" | "awaiting_neutral",
): {
  state: SpatialGestureState;
  effects: readonly SpatialGestureEffect[];
} {
  if (state.phase === "drawing")
    return {
      state: createInitialSpatialGestureState(),
      effects: [
        ...(state.stroke.length >= 2
          ? ([{ type: "stroke.commit", points: state.stroke }] as const)
          : []),
        { type: "preview.clear" },
      ],
    };
  if (state.phase === "grabbing" && state.grab) {
    const exitAction = detectExitAction(state.grab);
    return {
      state:
        nextPhase === "idle"
          ? createInitialSpatialGestureState()
          : awaitingNeutralState(),
      effects: [
        ...(exitAction
          ? ([
              {
                type: "object.stage_action",
                objectId: state.grab.objectId,
                action: exitAction.action,
                edge: exitAction.edge,
              },
            ] as const)
          : state.grab.currentX !== state.grab.initialX ||
              state.grab.currentY !== state.grab.initialY
            ? ([
                {
                  type: "object.commit_move",
                  objectId: state.grab.objectId,
                  x: state.grab.currentX,
                  y: state.grab.currentY,
                },
              ] as const)
            : []),
        { type: "preview.clear" },
      ],
    };
  }
  if (state.phase === "resizing" && state.resize)
    return {
      state:
        nextPhase === "idle"
          ? createInitialSpatialGestureState()
          : awaitingNeutralState(),
      effects: [
        ...(state.resize.currentWidth !== state.resize.initialWidth ||
        state.resize.currentHeight !== state.resize.initialHeight
          ? ([
              {
                type: "object.commit_resize",
                objectId: state.resize.objectId,
                width: state.resize.currentWidth,
                height: state.resize.currentHeight,
              },
            ] as const)
          : []),
        { type: "preview.clear" },
      ],
    };
  return { state: createInitialSpatialGestureState(), effects: [] };
}

function awaitingNeutralState(): SpatialGestureState {
  return {
    phase: "awaiting_neutral",
    stroke: [],
    grab: null,
    palm: null,
    resize: null,
  };
}

function detectExitAction(
  grab: NonNullable<SpatialGestureState["grab"]>,
): {
  action: "minimize" | "discard";
  edge: "left" | "right" | "bottom";
} | null {
  if (grab.startedAt === null || grab.currentAt === null) return null;
  const duration = grab.currentAt - grab.startedAt;
  if (duration < SWIPE_MIN_DURATION_MS || duration > SWIPE_MAX_DURATION_MS)
    return null;
  const deltaX = grab.currentPointerX - grab.startPointerX;
  const deltaY = grab.currentPointerY - grab.startPointerY;
  const horizontalSpeed = (Math.abs(deltaX) / duration) * 1_000;
  const verticalSpeed = (Math.abs(deltaY) / duration) * 1_000;
  const crossedDiscardEdge =
    grab.currentPointerX <= DISCARD_EDGE_THRESHOLD ||
    grab.currentPointerX >= 1 - DISCARD_EDGE_THRESHOLD;
  if (
    crossedDiscardEdge &&
    Math.abs(deltaX) >= SWIPE_MIN_DISTANCE &&
    Math.abs(deltaX) >= Math.abs(deltaY) * 1.3 &&
    horizontalSpeed >= SWIPE_MIN_SPEED_PER_SECOND
  )
    return {
      action: "discard",
      edge: grab.currentPointerX < 0.5 ? "left" : "right",
    };
  if (
    grab.currentPointerY >= MINIMIZE_DOCK_THRESHOLD &&
    deltaY >= SWIPE_MIN_DISTANCE &&
    deltaY >= Math.abs(deltaX) * 1.3 &&
    verticalSpeed >= SWIPE_MIN_SPEED_PER_SECOND
  )
    return { action: "minimize", edge: "bottom" };
  return null;
}

function normalizedToWorld(
  pointer: { x: number; y: number },
  scene: SpatialGestureScene,
): CanvasPoint {
  return {
    x: (pointer.x * scene.bounds.width - scene.viewport.x) / scene.viewport.scale,
    y: (pointer.y * scene.bounds.height - scene.viewport.y) / scene.viewport.scale,
  };
}

function appendDistinctPoint(
  points: readonly CanvasPoint[],
  point: CanvasPoint,
): readonly CanvasPoint[] {
  const previous = points.at(-1);
  if (previous && Math.hypot(point.x - previous.x, point.y - previous.y) < 2)
    return points;
  return [...points, point];
}

function hitTest(
  point: CanvasPoint,
  objects: SpatialGestureScene["objects"],
  slop = 0,
) {
  return [...objects]
    .sort((left, right) => right.zIndex - left.zIndex)
    .find(
      (object) =>
        point.x >= object.x - slop &&
        point.x <= object.x + object.width + slop &&
        point.y >= object.y - slop &&
        point.y <=
          object.y + (object.minimized ? 62 : object.height) + slop,
    );
}

function validTimestamp(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function rounded(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}
