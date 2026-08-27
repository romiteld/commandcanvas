import type { SketchPayload } from "@/lib/canvas/object-model";

interface SketchPreviewProps {
  title: string;
  width: number;
  height: number;
  payload: SketchPayload;
}

export function SketchPreview({
  title,
  width,
  height,
  payload,
}: SketchPreviewProps) {
  return (
    <svg
      className="preserved-sketch"
      role="img"
      aria-label={`Original rough sketch: ${title}`}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="xMidYMid meet"
    >
      {payload.strokes.map((stroke) => (
        <path
          key={stroke.id}
          d={strokePath(stroke.points)}
          fill="none"
          stroke={stroke.color}
          strokeWidth={stroke.width}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}

function strokePath(points: SketchPayload["strokes"][number]["points"]) {
  return points
    .map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`)
    .join(" ");
}
