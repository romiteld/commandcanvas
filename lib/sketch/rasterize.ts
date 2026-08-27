import { sketchPayloadSchema } from "@/lib/canvas/object-model";

const DEFAULT_MAX_DIMENSION = 1_024;
const DEFAULT_PADDING = 24;
const MIN_PRESSURE_FACTOR = 0.05;

export interface SketchRasterPoint {
  x: number;
  y: number;
}

export interface SketchRasterBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface SketchRasterSegment {
  strokeId: string;
  color: string;
  width: number;
  from: SketchRasterPoint;
  to: SketchRasterPoint;
}

export interface SketchRasterPlan {
  width: number;
  height: number;
  maxDimension: number;
  padding: number;
  scale: number;
  background: "#ffffff";
  lineCap: "round";
  lineJoin: "round";
  bounds: SketchRasterBounds;
  paddedBounds: SketchRasterBounds;
  segments: SketchRasterSegment[];
}

export interface SketchRasterContext {
  fillStyle: string | CanvasGradient | CanvasPattern;
  strokeStyle: string | CanvasGradient | CanvasPattern;
  lineWidth: number;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
  fillRect: (x: number, y: number, width: number, height: number) => void;
  beginPath: () => void;
  moveTo: (x: number, y: number) => void;
  lineTo: (x: number, y: number) => void;
  stroke: () => void;
}

export interface SketchRasterCanvas {
  width: number;
  height: number;
  getContext: (type: "2d") => SketchRasterContext | null;
  toBlob?: (callback: (blob: Blob | null) => void, type: "image/png") => void;
  toDataURL?: (type: "image/png") => string;
}

export type SketchRasterCanvasFactory = (
  width: number,
  height: number,
) => SketchRasterCanvas;

export type RasterizedSketchPng =
  | {
      kind: "blob";
      mimeType: "image/png";
      width: number;
      height: number;
      blob: Blob;
    }
  | {
      kind: "data-url";
      mimeType: "image/png";
      width: number;
      height: number;
      dataUrl: string;
    };

function segmentPressureFactor(
  fromPressure: number | undefined,
  toPressure: number | undefined,
): number {
  const pressures = [fromPressure, toPressure].filter(
    (pressure): pressure is number => pressure !== undefined,
  );
  if (pressures.length === 0) return 1;
  const average = pressures.reduce((sum, pressure) => sum + pressure, 0) / pressures.length;
  return Math.max(MIN_PRESSURE_FACTOR, average);
}

export function buildSketchRasterPlan(input: unknown): SketchRasterPlan {
  const payload = sketchPayloadSchema.parse(input);
  if (payload.strokes.length === 0) throw new Error("Cannot rasterize an empty sketch.");

  const bounds: SketchRasterBounds = {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY,
  };
  for (const stroke of payload.strokes) {
    for (const point of stroke.points) {
      bounds.minX = Math.min(bounds.minX, point.x);
      bounds.minY = Math.min(bounds.minY, point.y);
      bounds.maxX = Math.max(bounds.maxX, point.x);
      bounds.maxY = Math.max(bounds.maxY, point.y);
    }
  }
  const maxStrokeRadius = Math.max(...payload.strokes.map((stroke) => stroke.width)) / 2;
  const paddedBounds: SketchRasterBounds = {
    minX: bounds.minX - maxStrokeRadius,
    minY: bounds.minY - maxStrokeRadius,
    maxX: bounds.maxX + maxStrokeRadius,
    maxY: bounds.maxY + maxStrokeRadius,
  };
  const sourceWidth = paddedBounds.maxX - paddedBounds.minX;
  const sourceHeight = paddedBounds.maxY - paddedBounds.minY;
  const available = DEFAULT_MAX_DIMENSION - DEFAULT_PADDING * 2;
  const scale = Math.min(available / sourceWidth, available / sourceHeight);
  const width = Math.ceil(sourceWidth * scale + DEFAULT_PADDING * 2);
  const height = Math.ceil(sourceHeight * scale + DEFAULT_PADDING * 2);
  const toRasterPoint = (point: { x: number; y: number }): SketchRasterPoint => ({
    x: DEFAULT_PADDING + (point.x - paddedBounds.minX) * scale,
    y: DEFAULT_PADDING + (point.y - paddedBounds.minY) * scale,
  });
  const segments = payload.strokes.flatMap((stroke) =>
    stroke.points.slice(1).map((point, index) => {
      const previousPoint = stroke.points[index];
      return {
        strokeId: stroke.id,
        color: stroke.color,
        width:
          stroke.width *
          scale *
          segmentPressureFactor(previousPoint.pressure, point.pressure),
        from: toRasterPoint(previousPoint),
        to: toRasterPoint(point),
      };
    }),
  );

  return {
    width,
    height,
    maxDimension: DEFAULT_MAX_DIMENSION,
    padding: DEFAULT_PADDING,
    scale,
    background: "#ffffff",
    lineCap: "round",
    lineJoin: "round",
    bounds,
    paddedBounds,
    segments,
  };
}

export async function rasterizeSketchToPng(
  input: unknown,
  createCanvas: SketchRasterCanvasFactory,
): Promise<RasterizedSketchPng> {
  const plan = buildSketchRasterPlan(input);
  const canvas = createCanvas(plan.width, plan.height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("A 2D canvas context is required to rasterize a sketch.");

  context.fillStyle = plan.background;
  context.fillRect(0, 0, plan.width, plan.height);
  context.lineCap = plan.lineCap;
  context.lineJoin = plan.lineJoin;
  for (const segment of plan.segments) {
    context.strokeStyle = segment.color;
    context.lineWidth = segment.width;
    context.beginPath();
    context.moveTo(segment.from.x, segment.from.y);
    context.lineTo(segment.to.x, segment.to.y);
    context.stroke();
  }

  if (canvas.toBlob) {
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob?.(resolve, "image/png"),
    );
    if (!blob) throw new Error("The canvas could not encode the sketch as PNG.");
    if (blob.type !== "image/png") throw new Error("The canvas returned a non-PNG blob.");
    return {
      kind: "blob",
      mimeType: "image/png",
      width: plan.width,
      height: plan.height,
      blob,
    };
  }

  if (canvas.toDataURL) {
    const dataUrl = canvas.toDataURL("image/png");
    if (!/^data:image\/png(?:;[^,]*)?,/i.test(dataUrl))
      throw new Error("The canvas returned a non-PNG data URL.");
    return {
      kind: "data-url",
      mimeType: "image/png",
      width: plan.width,
      height: plan.height,
      dataUrl,
    };
  }

  throw new Error("The canvas does not provide a PNG encoder.");
}
