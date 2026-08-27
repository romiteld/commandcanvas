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

export interface CanvasRectangle extends CanvasPoint {
  width: number;
  height: number;
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

export function fitViewportToWorldBounds(
  currentViewport: CanvasViewport,
  worldBounds: readonly CanvasRectangle[],
  screenRectangle: CanvasRectangle,
  padding = 48,
  minimumScale = MIN_CANVAS_SCALE,
): CanvasViewport | null {
  if (
    worldBounds.length < 2 ||
    !isFiniteViewport(currentViewport) ||
    !isFiniteRectangle(screenRectangle) ||
    !Number.isFinite(padding) ||
    padding < 0 ||
    !Number.isFinite(minimumScale) ||
    minimumScale <= 0 ||
    minimumScale > MAX_CANVAS_SCALE
  )
    return null;

  const availableWidth = screenRectangle.width - padding * 2;
  const availableHeight = screenRectangle.height - padding * 2;
  if (availableWidth <= 0 || availableHeight <= 0) return null;

  let left = Number.POSITIVE_INFINITY;
  let top = Number.POSITIVE_INFINITY;
  let right = Number.NEGATIVE_INFINITY;
  let bottom = Number.NEGATIVE_INFINITY;
  for (const bounds of worldBounds) {
    if (!isFiniteRectangle(bounds)) return null;
    left = Math.min(left, bounds.x);
    top = Math.min(top, bounds.y);
    right = Math.max(right, bounds.x + bounds.width);
    bottom = Math.max(bottom, bounds.y + bounds.height);
  }

  const worldWidth = right - left;
  const worldHeight = bottom - top;
  const boundsFitScale = Math.min(
    availableWidth / worldWidth,
    availableHeight / worldHeight,
  );
  const scale = Math.min(
    MAX_CANVAS_SCALE,
    currentViewport.scale,
    Math.max(minimumScale, boundsFitScale),
  );
  if (!Number.isFinite(scale)) return null;

  return {
    x:
      screenRectangle.x +
      padding +
      (availableWidth - worldWidth * scale) / 2 -
      left * scale,
    y:
      screenRectangle.y +
      padding +
      (availableHeight - worldHeight * scale) / 2 -
      top * scale,
    scale,
  };
}

function isFiniteViewport(viewport: CanvasViewport) {
  return (
    Number.isFinite(viewport.x) &&
    Number.isFinite(viewport.y) &&
    Number.isFinite(viewport.scale) &&
    viewport.scale > 0 &&
    viewport.scale <= MAX_CANVAS_SCALE
  );
}

function isFiniteRectangle(rectangle: CanvasRectangle) {
  return (
    Number.isFinite(rectangle.x) &&
    Number.isFinite(rectangle.y) &&
    Number.isFinite(rectangle.width) &&
    rectangle.width > 0 &&
    Number.isFinite(rectangle.height) &&
    rectangle.height > 0
  );
}
