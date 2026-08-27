import type { CanvasCommand } from "@/lib/canvas/command-engine";
import type { CanvasPoint, CanvasViewport } from "@/lib/canvas/coordinates";

export interface SpatialGestureScene {
  bounds: { left: number; top: number; width: number; height: number };
  viewport: CanvasViewport;
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
  phase: "idle" | "drawing" | "grabbing" | "awaiting_neutral";
  stroke: readonly CanvasPoint[];
  grab: {
    objectId: string;
    offsetX: number;
    offsetY: number;
    initialX: number;
    initialY: number;
    currentX: number;
    currentY: number;
  } | null;
}

export type SpatialGestureInput =
  | { mode: "idle" }
  | { mode: "point" | "pinch"; pointer: { x: number; y: number } };

export type SpatialGestureEffect =
  | { type: "stroke.preview"; points: readonly CanvasPoint[] }
  | { type: "stroke.commit"; points: readonly CanvasPoint[] }
  | { type: "object.select"; objectId: string }
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
  | { type: "preview.clear" };

export function createInitialSpatialGestureState(): SpatialGestureState {
  return { phase: "idle", stroke: [], grab: null };
}

export function reduceSpatialGesture(
  state: SpatialGestureState,
  input: SpatialGestureInput,
  scene: SpatialGestureScene,
): { state: SpatialGestureState; effects: readonly SpatialGestureEffect[] } {
  if (input.mode === "idle") return finishActiveGesture(state, "idle");
  if (state.phase === "awaiting_neutral")
    return { state, effects: [] };

  const point = normalizedToWorld(input.pointer, scene);
  if (input.mode === "point") {
    if (state.phase === "grabbing")
      return finishActiveGesture(state, "awaiting_neutral");

    const points =
      state.phase === "drawing"
        ? appendDistinctPoint(state.stroke, point)
        : [point];
    return {
      state: { phase: "drawing", stroke: points, grab: null },
      effects: [{ type: "stroke.preview", points }],
    };
  }

  if (state.phase === "drawing") return finishActiveGesture(state, "idle");
  if (state.phase === "grabbing" && state.grab) {
    const x = point.x - state.grab.offsetX;
    const y = point.y - state.grab.offsetY;
    const grab = { ...state.grab, currentX: x, currentY: y };
    return {
      state: { phase: "grabbing", stroke: [], grab },
      effects: [
        { type: "object.preview_move", objectId: grab.objectId, x, y },
      ],
    };
  }

  const hit = hitTest(point, scene.objects);
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
  };
  return {
    state: { phase: "grabbing", stroke: [], grab },
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

export function createGestureSketchCommand(
  points: readonly CanvasPoint[],
  options: { objectId: string; strokeId: string; zIndex: number },
): CanvasCommand {
  if (points.length < 2)
    throw new RangeError("A finger sketch needs at least two points.");
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
        strokes: [
          {
            id: options.strokeId,
            color: "#f6b44c",
            width: 5,
            points: points.map((point) => ({
              x: point.x - x,
              y: point.y - y,
            })),
          },
        ],
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
  if (state.phase === "grabbing" && state.grab)
    return {
      state:
        nextPhase === "idle"
          ? createInitialSpatialGestureState()
          : { phase: "awaiting_neutral", stroke: [], grab: null },
      effects: [
        ...(state.grab.currentX !== state.grab.initialX ||
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
  return { state: createInitialSpatialGestureState(), effects: [] };
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
) {
  return [...objects]
    .sort((left, right) => right.zIndex - left.zIndex)
    .find(
      (object) =>
        point.x >= object.x &&
        point.x <= object.x + object.width &&
        point.y >= object.y &&
        point.y <= object.y + (object.minimized ? 62 : object.height),
    );
}
