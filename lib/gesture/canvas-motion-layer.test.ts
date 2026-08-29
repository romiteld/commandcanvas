import { describe, expect, it, vi } from "vitest";

import { createCanvasMotionLayer } from "@/lib/gesture/canvas-motion-layer";

describe("canvas motion layer", () => {
  it("coalesces cursor and transform samples into one animation-frame write", () => {
    const root = document.createElement("div");
    const object = document.createElement("article");
    object.dataset.canvasObject = "note-1";
    root.append(object);
    const callbacks: FrameRequestCallback[] = [];
    const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    const layer = createCanvasMotionLayer({
      root: () => root,
      requestAnimationFrame,
      cancelAnimationFrame: vi.fn(),
    });

    layer.previewCursor({ x: 0.2, y: 0.3 });
    layer.previewCursor({ x: 0.4, y: 0.5 });
    layer.previewObject("note-1", {
      x: 120,
      y: 80,
      width: 300,
      height: 180,
      rotation: 12,
    });

    expect(requestAnimationFrame).toHaveBeenCalledOnce();
    callbacks[0]?.(16);
    expect(root.style.getPropertyValue("--hand-cursor-x")).toBe("40%");
    expect(root.style.getPropertyValue("--hand-cursor-y")).toBe("50%");
    expect(object.style.getPropertyValue("--gesture-x")).toBe("120px");
    expect(object.style.getPropertyValue("--gesture-rotation")).toBe("12deg");
    expect(object).toHaveAttribute("data-gesture-preview", "true");
  });

  it("clears an ephemeral preview without invoking durable mutation code", () => {
    const root = document.createElement("div");
    const object = document.createElement("article");
    object.dataset.canvasObject = "note-1";
    root.append(object);
    let callback: FrameRequestCallback | undefined;
    const durableMutation = vi.fn();
    const layer = createCanvasMotionLayer({
      root: () => root,
      requestAnimationFrame(next) {
        callback = next;
        return 1;
      },
      cancelAnimationFrame: vi.fn(),
    });

    layer.previewObject("note-1", {
      x: 10,
      y: 20,
      width: 30,
      height: 40,
      rotation: 0,
    });
    callback?.(16);
    layer.clearObject("note-1");
    callback?.(32);

    expect(object).not.toHaveAttribute("data-gesture-preview");
    expect(object.style.getPropertyValue("--gesture-x")).toBe("");
    expect(durableMutation).not.toHaveBeenCalled();
  });
});
