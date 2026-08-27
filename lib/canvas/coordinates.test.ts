import { describe, expect, it } from "vitest";

import {
  screenToWorld,
  worldToScreen,
  zoomViewportAt,
  type CanvasPoint,
  type CanvasViewport,
} from "@/lib/canvas/coordinates";

const viewport: CanvasViewport = { x: 140, y: 80, scale: 1.5 };

describe("canvas coordinates", () => {
  it("round-trips a world point through a translated and scaled viewport", () => {
    const world: CanvasPoint = { x: 320, y: 180 };

    const screen = worldToScreen(world, viewport);

    expect(screen).toEqual({ x: 620, y: 350 });
    expect(screenToWorld(screen, viewport)).toEqual(world);
  });

  it("accounts for the canvas element offset when converting a client point", () => {
    expect(
      screenToWorld(
        { x: 770, y: 470 },
        viewport,
        { left: 150, top: 120 },
      ),
    ).toEqual({ x: 320, y: 180 });
  });

  it("zooms around the pointer without moving the world point beneath it", () => {
    const pointer = { x: 620, y: 350 };
    const before = screenToWorld(pointer, viewport);

    const zoomed = zoomViewportAt(viewport, pointer, 2);

    expect(zoomed).toEqual({ x: -20, y: -10, scale: 2 });
    expect(screenToWorld(pointer, zoomed)).toEqual(before);
  });

  it("clamps zoom to the supported range while preserving the pointer anchor", () => {
    const pointer = { x: 300, y: 200 };
    const before = screenToWorld(pointer, viewport);

    const zoomed = zoomViewportAt(viewport, pointer, 9);

    expect(zoomed.scale).toBe(2.5);
    expect(screenToWorld(pointer, zoomed)).toEqual(before);
  });
});
