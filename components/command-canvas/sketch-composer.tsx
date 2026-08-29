"use client";

import {
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

import {
  sketchPayloadSchema,
  type SketchPayload,
} from "@/lib/canvas/object-model";

export interface SketchComposerProps {
  width: number;
  height: number;
  onDone: (payload: SketchPayload, source: SketchInputSource) => void;
  onCancel: () => void;
}

export type SketchInputSource = "pointer" | "touch" | "stylus";

type SketchStroke = SketchPayload["strokes"][number];
type SketchPoint = SketchStroke["points"][number];
type ComposerMode = "draw" | "erase";

interface ActivePointer {
  pointerId: number;
  mode: ComposerMode;
  strokeId?: string;
}

const STROKE_COLOR = "#12233d";
const STROKE_WIDTH = 4;
const ERASER_RADIUS = 18;
const MAX_STROKES = 128;
const MAX_POINTS_PER_STROKE = 2_000;
let fallbackStrokeSequence = 0;

export function SketchComposer({
  width,
  height,
  onDone,
  onCancel,
}: SketchComposerProps) {
  const [mode, setMode] = useState<ComposerMode>("draw");
  const [strokes, setStrokes] = useState<SketchStroke[]>([]);
  const [isPointerActive, setIsPointerActive] = useState(false);
  const [lastInputSource, setLastInputSource] =
    useState<SketchInputSource>("pointer");
  const activePointer = useRef<ActivePointer | null>(null);
  const canFinish =
    !isPointerActive &&
    strokes.length > 0 &&
    strokes.every((stroke) => stroke.points.length >= 2);

  function beginPointer(event: ReactPointerEvent<SVGSVGElement>) {
    if (activePointer.current) return;
    event.preventDefault();
    const point = localPoint(event, width, height);
    setLastInputSource(pointerSource(event.pointerType));

    if (mode === "draw") {
      if (strokes.length >= MAX_STROKES) return;
      const strokeId = createStrokeId();
      setStrokes((current) => [
        ...current,
        {
          id: strokeId,
          color: STROKE_COLOR,
          width: STROKE_WIDTH,
          points: [point],
        },
      ]);
      activePointer.current = {
        pointerId: event.pointerId,
        mode,
        strokeId,
      };
    } else {
      eraseAt(point);
      activePointer.current = { pointerId: event.pointerId, mode };
    }

    setIsPointerActive(true);
    if (typeof event.currentTarget.setPointerCapture === "function")
      event.currentTarget.setPointerCapture(event.pointerId);
  }

  function movePointer(event: ReactPointerEvent<SVGSVGElement>) {
    const active = activePointer.current;
    if (!active || active.pointerId !== event.pointerId) return;
    event.preventDefault();
    const points = localPointerSamples(event, width, height);
    if (active.mode === "erase") {
      for (const point of points) eraseAt(point);
      return;
    }
    if (active.strokeId) appendPoints(active.strokeId, points);
  }

  function endPointer(event: ReactPointerEvent<SVGSVGElement>) {
    const active = activePointer.current;
    if (!active || active.pointerId !== event.pointerId) return;
    event.preventDefault();
    const point = localPoint(event, width, height);
    if (active.mode === "erase") eraseAt(point);
    else if (active.strokeId) finishStroke(active.strokeId, point);
    releasePointer(event, active.pointerId);
    activePointer.current = null;
    setIsPointerActive(false);
  }

  function cancelPointer(event: ReactPointerEvent<SVGSVGElement>) {
    const active = activePointer.current;
    if (!active || active.pointerId !== event.pointerId) return;
    event.preventDefault();
    if (active.strokeId)
      setStrokes((current) =>
        current.filter(
          (stroke) =>
            stroke.id !== active.strokeId || stroke.points.length >= 2,
        ),
      );
    releasePointer(event, active.pointerId);
    activePointer.current = null;
    setIsPointerActive(false);
  }

  function appendPoints(strokeId: string, points: readonly SketchPoint[]) {
    setStrokes((current) =>
      current.map((stroke) =>
        stroke.id === strokeId
          ? {
              ...stroke,
              points: points.reduce(
                (next, point) => appendDistinctPoint(next, point),
                stroke.points,
              ),
            }
          : stroke,
      ),
    );
  }

  function finishStroke(strokeId: string, point: SketchPoint) {
    setStrokes((current) =>
      current.flatMap((stroke) => {
        if (stroke.id !== strokeId) return [stroke];
        const points = appendDistinctPoint(stroke.points, point);
        return points.length >= 2 ? [{ ...stroke, points }] : [];
      }),
    );
  }

  function eraseAt(point: SketchPoint) {
    setStrokes((current) =>
      current.filter(
        (stroke) => !strokeIntersectsEraser(stroke, point, ERASER_RADIUS),
      ),
    );
  }

  function finishSketch() {
    if (!canFinish) return;
    const parsed = sketchPayloadSchema.safeParse({ strokes });
    if (!parsed.success || parsed.data.strokes.length === 0) return;
    onDone(parsed.data, lastInputSource);
  }

  return (
    <section
      className="sketch-composer"
      aria-label="Sketch composer"
      style={{
        display: "grid",
        gap: 12,
        width: "100%",
        maxWidth: width,
      }}
    >
      <div
        className="sketch-composer-toolbar"
        role="toolbar"
        aria-label="Sketch tools"
        style={{ display: "flex", flexWrap: "wrap", gap: 8 }}
      >
        <button
          type="button"
          aria-label="Draw mode"
          aria-pressed={mode === "draw"}
          disabled={isPointerActive}
          onClick={() => setMode("draw")}
        >
          Draw
        </button>
        <button
          type="button"
          aria-label="Erase mode"
          aria-pressed={mode === "erase"}
          disabled={isPointerActive}
          onClick={() => setMode("erase")}
        >
          Erase
        </button>
        <button
          type="button"
          aria-label="Clear sketch"
          disabled={isPointerActive || strokes.length === 0}
          onClick={() => setStrokes([])}
        >
          Clear
        </button>
        <button type="button" aria-label="Cancel sketch" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          aria-label="Finish sketch"
          disabled={!canFinish}
          onClick={finishSketch}
        >
          Done
        </button>
      </div>

      <svg
        className="sketch-composer-surface"
        role="img"
        aria-label="Sketch draft surface"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        tabIndex={0}
        onPointerDown={beginPointer}
        onPointerMove={movePointer}
        onPointerUp={endPointer}
        onPointerCancel={cancelPointer}
        style={{
          display: "block",
          width: "100%",
          height: "auto",
          aspectRatio: `${width} / ${height}`,
          border: "1px solid rgba(155, 231, 255, 0.35)",
          borderRadius: 18,
          background: "rgba(5, 15, 24, 0.9)",
          cursor: mode === "erase" ? "cell" : "crosshair",
          touchAction: "none",
        }}
      >
        <rect width={width} height={height} fill="transparent" />
        {strokes.map((stroke) => (
          <polyline
            key={stroke.id}
            data-draft-stroke={stroke.id}
            points={stroke.points.map((point) => `${point.x},${point.y}`).join(" ")}
            fill="none"
            stroke={stroke.color}
            strokeWidth={stroke.width}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
      </svg>

      <p role="status" aria-live="polite" style={{ margin: 0 }}>
        {strokes.length} draft {strokes.length === 1 ? "stroke" : "strokes"}
      </p>
    </section>
  );
}

function localPoint(
  event: ReactPointerEvent<SVGSVGElement>,
  width: number,
  height: number,
): SketchPoint {
  const bounds = event.currentTarget.getBoundingClientRect();
  return localPointFromClient(event, bounds, width, height);
}

function localPointerSamples(
  event: ReactPointerEvent<SVGSVGElement>,
  width: number,
  height: number,
): SketchPoint[] {
  const bounds = event.currentTarget.getBoundingClientRect();
  const native = event.nativeEvent as PointerEvent;
  const coalesced = native.getCoalescedEvents?.() ?? [];
  const samples = coalesced.length > 0 ? coalesced : [native];
  return samples.map((sample) =>
    localPointFromClient(sample, bounds, width, height),
  );
}

function localPointFromClient(
  event: Pick<PointerEvent, "clientX" | "clientY" | "pressure">,
  bounds: Pick<DOMRect, "left" | "top" | "width" | "height">,
  width: number,
  height: number,
): SketchPoint {
  const localX =
    bounds.width > 0
      ? ((event.clientX - bounds.left) / bounds.width) * width
      : 0;
  const localY =
    bounds.height > 0
      ? ((event.clientY - bounds.top) / bounds.height) * height
      : 0;
  const point = {
    x: round(clamp(localX, 0, width)),
    y: round(clamp(localY, 0, height)),
  };
  const pressure = event.pressure;
  return Number.isFinite(pressure) && pressure > 0
    ? { ...point, pressure: round(clamp(pressure, 0, 1)) }
    : point;
}

function appendDistinctPoint(
  points: SketchPoint[],
  point: SketchPoint,
): SketchPoint[] {
  if (points.length >= MAX_POINTS_PER_STROKE) return points;
  const last = points.at(-1);
  if (last?.x === point.x && last.y === point.y) return points;
  return [...points, point];
}

function strokeIntersectsEraser(
  stroke: SketchStroke,
  point: SketchPoint,
  radius: number,
) {
  const hitRadius = radius + stroke.width / 2;
  if (stroke.points.length === 1)
    return squaredDistance(stroke.points[0], point) <= hitRadius * hitRadius;

  for (let index = 1; index < stroke.points.length; index += 1) {
    if (
      squaredDistanceToSegment(
        point,
        stroke.points[index - 1],
        stroke.points[index],
      ) <=
      hitRadius * hitRadius
    )
      return true;
  }
  return false;
}

function squaredDistanceToSegment(
  point: SketchPoint,
  start: SketchPoint,
  end: SketchPoint,
) {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;
  if (lengthSquared === 0) return squaredDistance(point, start);
  const projection = clamp(
    ((point.x - start.x) * deltaX + (point.y - start.y) * deltaY) /
      lengthSquared,
    0,
    1,
  );
  return squaredDistance(point, {
    x: start.x + projection * deltaX,
    y: start.y + projection * deltaY,
  });
}

function squaredDistance(left: SketchPoint, right: SketchPoint) {
  const deltaX = left.x - right.x;
  const deltaY = left.y - right.y;
  return deltaX * deltaX + deltaY * deltaY;
}

function releasePointer(
  event: ReactPointerEvent<SVGSVGElement>,
  pointerId: number,
) {
  if (
    typeof event.currentTarget.hasPointerCapture === "function" &&
    event.currentTarget.hasPointerCapture(pointerId)
  )
    event.currentTarget.releasePointerCapture(pointerId);
}

function createStrokeId() {
  const suffix =
    globalThis.crypto?.randomUUID?.() ??
    `${Date.now().toString(36)}-${++fallbackStrokeSequence}`;
  return `stroke-${suffix.toLowerCase()}`;
}

function pointerSource(pointerType: string): SketchInputSource {
  if (pointerType === "touch") return "touch";
  if (pointerType === "pen" || pointerType === "stylus") return "stylus";
  return "pointer";
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value: number) {
  return Math.round(value * 1_000) / 1_000;
}
