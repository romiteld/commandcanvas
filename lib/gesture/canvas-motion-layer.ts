import type { CanvasPoint } from "@/lib/canvas/coordinates";
import type { SpatialTransform } from "@/lib/gesture/spatial-gesture";

export interface CanvasMotionLayer {
  previewCursor(point: CanvasPoint): void;
  hideCursor(): void;
  previewObject(objectId: string, transform: SpatialTransform): void;
  clearObject(objectId: string): void;
  clear(): void;
  dispose(): void;
}

interface CanvasMotionLayerOptions {
  readonly root: () => HTMLElement | null;
  readonly requestAnimationFrame?: (callback: FrameRequestCallback) => number;
  readonly cancelAnimationFrame?: (handle: number) => void;
}

type ObjectUpdate =
  | { readonly kind: "preview"; readonly transform: SpatialTransform }
  | { readonly kind: "clear" };

export function createCanvasMotionLayer(
  options: CanvasMotionLayerOptions,
): CanvasMotionLayer {
  const schedule =
    options.requestAnimationFrame ??
    ((callback: FrameRequestCallback) => window.requestAnimationFrame(callback));
  const cancel =
    options.cancelAnimationFrame ??
    ((handle: number) => window.cancelAnimationFrame(handle));
  const objectUpdates = new Map<string, ObjectUpdate>();
  let cursor: CanvasPoint | null | undefined;
  let frame: number | null = null;
  let disposed = false;

  function requestWrite() {
    if (disposed || frame !== null) return;
    frame = schedule(flush);
  }

  function flush() {
    frame = null;
    const root = options.root();
    if (!root || disposed) return;
    if (cursor === null) root.removeAttribute("data-hand-cursor-visible");
    else if (cursor) {
      root.style.setProperty("--hand-cursor-x", `${round(cursor.x * 100)}%`);
      root.style.setProperty("--hand-cursor-y", `${round(cursor.y * 100)}%`);
      root.setAttribute("data-hand-cursor-visible", "true");
    }
    cursor = undefined;
    for (const [objectId, update] of objectUpdates) {
      const object = root.querySelector<HTMLElement>(
        `[data-canvas-object="${cssEscape(objectId)}"]`,
      );
      if (!object) continue;
      if (update.kind === "clear") {
        object.removeAttribute("data-gesture-preview");
        for (const property of [
          "--gesture-x",
          "--gesture-y",
          "--gesture-width",
          "--gesture-height",
          "--gesture-rotation",
        ])
          object.style.removeProperty(property);
        continue;
      }
      const { transform } = update;
      object.style.setProperty("--gesture-x", `${transform.x}px`);
      object.style.setProperty("--gesture-y", `${transform.y}px`);
      object.style.setProperty("--gesture-width", `${transform.width}px`);
      object.style.setProperty("--gesture-height", `${transform.height}px`);
      object.style.setProperty(
        "--gesture-rotation",
        `${transform.rotation}deg`,
      );
      object.setAttribute("data-gesture-preview", "true");
    }
    objectUpdates.clear();
  }

  return {
    previewCursor(point) {
      cursor = point;
      requestWrite();
    },
    hideCursor() {
      cursor = null;
      requestWrite();
    },
    previewObject(objectId, transform) {
      objectUpdates.set(objectId, { kind: "preview", transform });
      requestWrite();
    },
    clearObject(objectId) {
      objectUpdates.set(objectId, { kind: "clear" });
      requestWrite();
    },
    clear() {
      cursor = null;
      const root = options.root();
      for (const object of root?.querySelectorAll<HTMLElement>(
        "[data-gesture-preview]",
      ) ?? [])
        objectUpdates.set(object.dataset.canvasObject ?? "", { kind: "clear" });
      requestWrite();
    },
    dispose() {
      disposed = true;
      if (frame !== null) cancel(frame);
      frame = null;
      objectUpdates.clear();
    },
  };
}

function cssEscape(value: string) {
  return typeof CSS !== "undefined" && typeof CSS.escape === "function"
    ? CSS.escape(value)
    : value.replaceAll('"', '\\"');
}

function round(value: number) {
  return Math.round(value * 1_000) / 1_000;
}
