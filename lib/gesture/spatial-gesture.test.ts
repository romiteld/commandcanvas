import { describe, expect, it } from "vitest";

import {
  DEFAULT_HAND_ACTIVE_ZONE,
  createGestureSketchCommand,
  createInitialSpatialGestureState,
  mapHandPointerToActiveZone,
  reduceSpatialGesture,
  type SpatialGestureScene,
} from "@/lib/gesture/spatial-gesture";

const scene: SpatialGestureScene = {
  bounds: { left: 0, top: 0, width: 1_000, height: 500 },
  viewport: { x: 0, y: 0, scale: 1 },
  objects: [],
};

const manipulation = {
  drawingEnabled: false,
  manipulationEnabled: true,
};

describe("spatial gesture geometry and retained fallbacks", () => {
  it("maps a comfortable central camera zone across the full canvas reach", () => {
    expect(
      mapHandPointerToActiveZone(
        { x: DEFAULT_HAND_ACTIVE_ZONE.left, y: DEFAULT_HAND_ACTIVE_ZONE.top },
        DEFAULT_HAND_ACTIVE_ZONE,
      ),
    ).toEqual({ x: 0, y: 0 });
    expect(
      mapHandPointerToActiveZone(
        { x: DEFAULT_HAND_ACTIVE_ZONE.right, y: DEFAULT_HAND_ACTIVE_ZONE.bottom },
        DEFAULT_HAND_ACTIVE_ZONE,
      ),
    ).toEqual({ x: 1, y: 1 });
    expect(
      mapHandPointerToActiveZone({ x: 0.5, y: 0.5 }, DEFAULT_HAND_ACTIVE_ZONE),
    ).toEqual({ x: 0.5, y: 0.5 });
  });

  it("chooses the visually topmost rotated rectangle as the hover candidate", () => {
    const result = reduceSpatialGesture(
      createInitialSpatialGestureState(),
      { mode: "point", pointer: { x: 0.35, y: 0.66 }, timestamp: 1_000 },
      {
        ...scene,
        objects: [
          {
            id: "wide-rotated-card",
            x: 200,
            y: 150,
            width: 300,
            height: 100,
            rotation: 90,
            zIndex: 1_000_000,
            pinned: false,
            minimized: false,
          },
          {
            id: "behind",
            x: 300,
            y: 300,
            width: 100,
            height: 100,
            zIndex: 20,
            pinned: false,
            minimized: false,
          },
        ],
      },
      manipulation,
    );

    expect(result.state).toMatchObject({
      phase: "hover",
      candidate: { objectId: "wide-rotated-card" },
    });
  });

  it("keeps blank-canvas bimanual zoom as non-durable navigation", () => {
    const started = reduceSpatialGesture(
      createInitialSpatialGestureState(),
      {
        mode: "bimanual_pinch",
        pointers: [
          { x: 0.7, y: 0.4 },
          { x: 0.9, y: 0.4 },
        ],
        span: 0.2,
        timestamp: 1_000,
      },
      scene,
      manipulation,
    );
    expect(started.state.phase).toBe("panning");
    expect(started.effects).toEqual([
      {
        type: "viewport.zoom_at",
        scale: 1,
        screenPoint: { x: 800, y: 200 },
      },
    ]);

    const spread = reduceSpatialGesture(
      started.state,
      {
        mode: "bimanual_pinch",
        pointers: [
          { x: 0.65, y: 0.4 },
          { x: 0.95, y: 0.4 },
        ],
        span: 0.3,
        timestamp: 1_016,
      },
      scene,
      manipulation,
    );
    expect(spread.effects).toEqual([
      {
        type: "viewport.zoom_at",
        scale: 1.5,
        screenPoint: { x: 800, y: 200 },
      },
    ]);
  });

  it("converts a world-space trace into a bounded semantic sketch command", () => {
    expect(
      createGestureSketchCommand(
        [
          [
            { x: 90, y: 120 },
            { x: 150, y: 150 },
          ],
          [
            { x: 150, y: 150 },
            { x: 170, y: 210 },
          ],
        ],
        {
          objectId: "sketch-hand-1",
          strokeIds: ["stroke-hand-1", "stroke-hand-2"],
          zIndex: 7,
        },
      ),
    ).toEqual({
      type: "object.create",
      object: {
        id: "sketch-hand-1",
        type: "sketch",
        title: "Finger sketch",
        x: 74,
        y: 104,
        width: 160,
        height: 122,
        zIndex: 7,
        payload: {
          strokes: [
            {
              id: "stroke-hand-1",
              color: "#f6b44c",
              width: 5,
              points: [
                { x: 16, y: 16 },
                { x: 76, y: 46 },
              ],
            },
            {
              id: "stroke-hand-2",
              color: "#f6b44c",
              width: 5,
              points: [
                { x: 76, y: 46 },
                { x: 96, y: 106 },
              ],
            },
          ],
        },
      },
    });
  });
});
