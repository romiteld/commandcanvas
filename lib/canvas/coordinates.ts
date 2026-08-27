export interface CanvasPoint {
  x: number;
  y: number;
}

export interface CanvasViewport extends CanvasPoint {
  scale: number;
}

export interface CanvasOffset {
  left: number;
  top: number;
}

export const MIN_CANVAS_SCALE = 0.35;
export const MAX_CANVAS_SCALE = 2.5;

export function screenToWorld(
  point: CanvasPoint,
  viewport: CanvasViewport,
  offset: CanvasOffset = { left: 0, top: 0 },
): CanvasPoint {
  return {
    x: (point.x - offset.left - viewport.x) / viewport.scale,
    y: (point.y - offset.top - viewport.y) / viewport.scale,
  };
}

export function worldToScreen(
  point: CanvasPoint,
  viewport: CanvasViewport,
): CanvasPoint {
  return {
    x: point.x * viewport.scale + viewport.x,
    y: point.y * viewport.scale + viewport.y,
  };
}

export function zoomViewportAt(
  viewport: CanvasViewport,
  screenPoint: CanvasPoint,
  nextScale: number,
): CanvasViewport {
  const scale = Math.min(
    MAX_CANVAS_SCALE,
    Math.max(MIN_CANVAS_SCALE, nextScale),
  );
  const anchor = screenToWorld(screenPoint, viewport);

  return {
    x: screenPoint.x - anchor.x * scale,
    y: screenPoint.y - anchor.y * scale,
    scale,
  };
}
