import { memo } from "react";

/**
 * The live fingertip stroke is written directly by CanvasMotionLayer.
 * Keeping this leaf stable prevents camera-rate samples from entering React's
 * room render loop; durable strokes are still rendered by the room after a
 * stroke boundary or explicit sketch commit.
 */
export const HandInkPreview = memo(function HandInkPreview() {
  return <polyline data-hand-ink-preview points="" />;
});
