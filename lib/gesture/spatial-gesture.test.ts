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

  it("keeps pointing non-mutating while hand manipulation mode is active", () => {
    const transition = reduceSpatialGesture(
      createInitialSpatialGestureState(),
      { mode: "point", pointer: { x: 0.2, y: 0.3 } },
      scene,
      { drawingEnabled: false, manipulationEnabled: true },
    );

    expect(transition.state).toEqual(createInitialSpatialGestureState());
    expect(transition.effects).toEqual([
      { type: "object.target", objectId: null },
    ]);
  });

  it("clears the magnetic target when the pointing hand moves away", () => {
    const transition = reduceSpatialGesture(
      createInitialSpatialGestureState(),
      { mode: "point", pointer: { x: 0.95, y: 0.95 } },
      {
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
      },
      { drawingEnabled: false, manipulationEnabled: true },
    );

    expect(transition.effects).toEqual([
      { type: "object.target", objectId: null },
    ]);
  });

  it("magnetically marks a nearby object as the hand target before pinch", () => {
    const transition = reduceSpatialGesture(
      createInitialSpatialGestureState(),
      { mode: "point", pointer: { x: 0.19, y: 0.4 } },
      {
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
      },
      { drawingEnabled: false, manipulationEnabled: true },
    );

    expect(transition.effects).toEqual([
      { type: "object.target", objectId: "note-front" },
    ]);
    expect(transition.effects).not.toContainEqual(
      expect.objectContaining({ type: "object.select" }),
    );
  });

  it("keeps pinch and palm actions non-mutating while hand drawing mode is active", () => {
    const transition = reduceSpatialGesture(
      createInitialSpatialGestureState(),
      { mode: "pinch", pointer: { x: 0.25, y: 0.4 } },
      {
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
      },
      { drawingEnabled: true, manipulationEnabled: false },
    );

    expect(transition.state).toEqual(createInitialSpatialGestureState());
    expect(transition.effects).toEqual([]);
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

  it("magnetically acquires a movable object when a pinch lands just outside its edge", () => {
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
      { mode: "pinch", pointer: { x: 0.19, y: 0.4 } },
      objectScene,
    );

    expect(grabbed.effects).toContainEqual({
      type: "object.select",
      objectId: "note-front",
    });
    expect(grabbed.state).toMatchObject({
      phase: "grabbing",
      grab: { objectId: "note-front" },
    });
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

  it.each([
    ["discard", "left", { x: 0.04, y: 0.4 }],
    ["discard", "right", { x: 0.96, y: 0.4 }],
    ["minimize", "bottom", { x: 0.25, y: 0.96 }],
  ] as const)(
    "emits one deliberate held-object edge action as %s without also committing a move",
    (action, exitEdge, pointer) => {
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
        { mode: "pinch", pointer: { x: 0.25, y: 0.4 }, timestamp: 1_000 },
        objectScene,
      );
      const swiped = reduceSpatialGesture(
        grabbed.state,
        { mode: "pinch", pointer, timestamp: 1_200 },
        objectScene,
      );
      const released = reduceSpatialGesture(
        swiped.state,
        { mode: "idle", timestamp: 1_216 },
        objectScene,
      );

      expect(released.effects).toEqual([
        {
          type: "object.stage_action",
          objectId: "note-front",
          action,
          edge: exitEdge,
        },
        { type: "preview.clear" },
      ]);
      expect(released.effects).not.toContainEqual(
        expect.objectContaining({ type: "object.commit_move" }),
      );
    },
  );

  it("treats a slow edge drag as an ordinary move instead of a swipe action", () => {
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
      { mode: "pinch", pointer: { x: 0.25, y: 0.4 }, timestamp: 1_000 },
      objectScene,
    );
    const moved = reduceSpatialGesture(
      grabbed.state,
      { mode: "pinch", pointer: { x: 0.04, y: 0.4 }, timestamp: 2_000 },
      objectScene,
    );
    const released = reduceSpatialGesture(
      moved.state,
      { mode: "idle", timestamp: 2_016 },
      objectScene,
    );

    expect(released.effects).toContainEqual({
      type: "object.commit_move",
      objectId: "note-front",
      x: -10,
      y: 150,
    });
    expect(released.effects).not.toContainEqual(
      expect.objectContaining({ type: "object.stage_action" }),
    );
  });

  it("requires a stable open-palm dwell before focusing or restoring an object", () => {
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
    const started = reduceSpatialGesture(
      createInitialSpatialGestureState(),
      { mode: "open_palm", pointer: { x: 0.25, y: 0.4 }, timestamp: 1_000 },
      objectScene,
    );
    expect(started.effects).toEqual([
      { type: "object.select", objectId: "note-front" },
      { type: "palm.progress", objectId: "note-front", progress: 0 },
    ]);
    const held = reduceSpatialGesture(
      started.state,
      { mode: "open_palm", pointer: { x: 0.26, y: 0.4 }, timestamp: 1_660 },
      objectScene,
    );
    expect(held.effects).toEqual([
      { type: "object.focus", objectId: "note-front" },
    ]);
    expect(held.state).toMatchObject({ phase: "awaiting_neutral" });
  });

  it("restores a minimized object after a stable open-palm dwell", () => {
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
          minimized: true,
        },
      ],
    };
    const started = reduceSpatialGesture(
      createInitialSpatialGestureState(),
      { mode: "open_palm", pointer: { x: 0.25, y: 0.35 }, timestamp: 1_000 },
      objectScene,
    );
    const held = reduceSpatialGesture(
      started.state,
      { mode: "open_palm", pointer: { x: 0.25, y: 0.35 }, timestamp: 1_660 },
      objectScene,
    );

    expect(held.effects).toEqual([
      { type: "object.restore", objectId: "note-front" },
    ]);
  });

  it("previews and commits bimanual span resize for a selected movable object", () => {
    const objectScene: SpatialGestureScene = {
      ...scene,
      selectedObjectId: "note-front",
      objects: [
        {
          id: "note-front",
          x: 200,
          y: 150,
          width: 300,
          height: 200,
          zIndex: 9,
          pinned: false,
          minimized: false,
        },
      ],
    };
    const started = reduceSpatialGesture(
      createInitialSpatialGestureState(),
      {
        mode: "bimanual_pinch",
        pointers: [
          { x: 0.35, y: 0.4 },
          { x: 0.65, y: 0.4 },
        ],
        span: 0.3,
        timestamp: 1_000,
      },
      objectScene,
    );
    expect(started.effects).toEqual([
      { type: "object.select", objectId: "note-front" },
      {
        type: "object.preview_resize",
        objectId: "note-front",
        width: 300,
        height: 200,
      },
    ]);
    const spread = reduceSpatialGesture(
      started.state,
      {
        mode: "bimanual_pinch",
        pointers: [
          { x: 0.25, y: 0.4 },
          { x: 0.75, y: 0.4 },
        ],
        span: 0.5,
        timestamp: 1_100,
      },
      objectScene,
    );
    expect(spread.effects).toEqual([
      {
        type: "object.preview_resize",
        objectId: "note-front",
        width: 500,
        height: 333.333333,
      },
    ]);
    const released = reduceSpatialGesture(
      spread.state,
      { mode: "idle", timestamp: 1_116 },
      objectScene,
    );
    expect(released.effects).toEqual([
      {
        type: "object.commit_resize",
        objectId: "note-front",
        width: 500,
        height: 333.333333,
      },
      { type: "preview.clear" },
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
