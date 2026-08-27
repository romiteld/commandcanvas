import { describe, expect, it } from "vitest";

import {
  createGestureSketchCommand,
  createInitialSpatialGestureState,
  reduceSpatialGesture,
  type SpatialGestureScene,
} from "@/lib/gesture/spatial-gesture";

const scene: SpatialGestureScene = {
  bounds: { left: 0, top: 0, width: 1_000, height: 500 },
  viewport: { x: 0, y: 0, scale: 1 },
  objects: [],
};

describe("spatial gesture reducer", () => {
  it("commits an index-finger point trace only after tracking ends", () => {
    const started = reduceSpatialGesture(
      createInitialSpatialGestureState(),
      { mode: "point", pointer: { x: 0.2, y: 0.3 } },
      scene,
    );
    expect(started.effects).toEqual([
      { type: "stroke.preview", points: [{ x: 200, y: 150 }] },
    ]);

    const continued = reduceSpatialGesture(
      started.state,
      { mode: "point", pointer: { x: 0.26, y: 0.36 } },
      scene,
    );
    expect(continued.effects).toEqual([
      {
        type: "stroke.preview",
        points: [
          { x: 200, y: 150 },
          { x: 260, y: 180 },
        ],
      },
    ]);

    const ended = reduceSpatialGesture(
      continued.state,
      { mode: "idle" },
      scene,
    );
    expect(ended.effects).toEqual([
      {
        type: "stroke.commit",
        points: [
          { x: 200, y: 150 },
          { x: 260, y: 180 },
        ],
      },
      { type: "preview.clear" },
    ]);
    expect(ended.state).toEqual(createInitialSpatialGestureState());
  });

  it("pinch-grabs the topmost movable object and commits one move on release", () => {
    const objectScene: SpatialGestureScene = {
      ...scene,
      objects: [
        {
          id: "note-behind",
          x: 180,
          y: 130,
          width: 160,
          height: 120,
          zIndex: 2,
          pinned: false,
          minimized: false,
        },
        {
          id: "note-front",
          x: 200,
          y: 150,
          width: 180,
          height: 140,
          zIndex: 9,
          pinned: false,
          minimized: false,
        },
      ],
    };
    const grabbed = reduceSpatialGesture(
      createInitialSpatialGestureState(),
      { mode: "pinch", pointer: { x: 0.25, y: 0.4 } },
      objectScene,
    );
    expect(grabbed.effects).toEqual([
      { type: "object.select", objectId: "note-front" },
      {
        type: "object.preview_move",
        objectId: "note-front",
        x: 200,
        y: 150,
      },
    ]);

    const moved = reduceSpatialGesture(
      grabbed.state,
      { mode: "pinch", pointer: { x: 0.35, y: 0.5 } },
      objectScene,
    );
    expect(moved.effects).toEqual([
      {
        type: "object.preview_move",
        objectId: "note-front",
        x: 300,
        y: 200,
      },
    ]);

    const released = reduceSpatialGesture(
      moved.state,
      { mode: "point", pointer: { x: 0.36, y: 0.51 } },
      objectScene,
    );
    expect(released.effects).toEqual([
      {
        type: "object.commit_move",
        objectId: "note-front",
        x: 300,
        y: 200,
      },
      { type: "preview.clear" },
    ]);
    expect(released.state).toMatchObject({ phase: "awaiting_neutral" });
  });

  it("requires a neutral observation after pinch release before drawing", () => {
    const objectScene: SpatialGestureScene = {
      ...scene,
      objects: [
        {
          id: "note-front",
          x: 200,
          y: 150,
          width: 180,
          height: 140,
          zIndex: 9,
          pinned: false,
          minimized: false,
        },
      ],
    };
    const grabbed = reduceSpatialGesture(
      createInitialSpatialGestureState(),
      { mode: "pinch", pointer: { x: 0.25, y: 0.4 } },
      objectScene,
    );
    const moved = reduceSpatialGesture(
      grabbed.state,
      { mode: "pinch", pointer: { x: 0.35, y: 0.5 } },
      objectScene,
    );
    const releasedIntoPoint = reduceSpatialGesture(
      moved.state,
      { mode: "point", pointer: { x: 0.36, y: 0.51 } },
      objectScene,
    );
    const stillPointing = reduceSpatialGesture(
      releasedIntoPoint.state,
      { mode: "point", pointer: { x: 0.38, y: 0.53 } },
      objectScene,
    );

    expect(releasedIntoPoint.effects).toContainEqual({
      type: "object.commit_move",
      objectId: "note-front",
      x: 300,
      y: 200,
    });
    expect(stillPointing.effects).toEqual([]);

    const neutral = reduceSpatialGesture(
      stillPointing.state,
      { mode: "idle" },
      objectScene,
    );
    const deliberatePoint = reduceSpatialGesture(
      neutral.state,
      { mode: "point", pointer: { x: 0.4, y: 0.55 } },
      objectScene,
    );
    expect(deliberatePoint.effects).toEqual([
      { type: "stroke.preview", points: [{ x: 400, y: 275 }] },
    ]);
  });

  it("does not turn a pinned-object pinch into a mutation", () => {
    const result = reduceSpatialGesture(
      createInitialSpatialGestureState(),
      { mode: "pinch", pointer: { x: 0.25, y: 0.4 } },
      {
        ...scene,
        objects: [
          {
            id: "note-pinned",
            x: 200,
            y: 150,
            width: 180,
            height: 140,
            zIndex: 9,
            pinned: true,
            minimized: false,
          },
        ],
      },
    );

    expect(result.effects).toEqual([
      { type: "object.select", objectId: "note-pinned" },
    ]);
    expect(result.state).toEqual(createInitialSpatialGestureState());
  });

  it("converts a world-space trace into a bounded semantic sketch command", () => {
    expect(
      createGestureSketchCommand(
        [
          { x: 90, y: 120 },
          { x: 150, y: 150 },
        ],
        {
          objectId: "sketch-hand-1",
          strokeId: "stroke-hand-1",
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
        height: 80,
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
          ],
        },
      },
    });
  });
});
