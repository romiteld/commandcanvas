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

describe("spatial gesture reducer", () => {
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

  it("uses calibrated reach for targeting and edge actions instead of camera-frame extremes", () => {
    const calibratedScene: SpatialGestureScene = {
      ...scene,
      handActiveZone: DEFAULT_HAND_ACTIVE_ZONE,
      objects: [
        {
          id: "note-front",
          x: 0,
          y: 100,
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
      {
        mode: "pinch",
        pointer: { x: DEFAULT_HAND_ACTIVE_ZONE.left + 0.15, y: 0.4 },
        timestamp: 1_000,
      },
      calibratedScene,
    );
    expect(grabbed.state).toMatchObject({
      phase: "grabbing",
      grab: { objectId: "note-front" },
    });

    const flung = reduceSpatialGesture(
      grabbed.state,
      {
        mode: "pinch",
        pointer: { x: DEFAULT_HAND_ACTIVE_ZONE.left, y: 0.4 },
        timestamp: 1_180,
      },
      calibratedScene,
    );
    const released = reduceSpatialGesture(
      flung.state,
      { mode: "idle", timestamp: 1_196 },
      calibratedScene,
    );
    expect(released.effects).toContainEqual({
      type: "object.stage_action",
      objectId: "note-front",
      action: "discard",
      edge: "left",
    });
  });

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

  it("keeps the pointed object available while the hand shape settles into a pinch", () => {
    const targetedScene = {
      ...scene,
      targetedObjectId: "note-front",
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
      {
        mode: "pinch",
        // The fingertip shifts as thumb and index meet. This is outside the
        // ordinary hover slop but still close to the object just targeted.
        pointer: { x: 0.13, y: 0.4 },
        timestamp: 1_000,
      },
      targetedScene,
      { drawingEnabled: false, manipulationEnabled: true },
    );

    expect(grabbed.state).toMatchObject({
      phase: "grabbing",
      grab: { objectId: "note-front" },
    });
    expect(grabbed.effects).toContainEqual({
      type: "object.select",
      objectId: "note-front",
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

  it("stages a recoverable discard when a held object is deliberately released in an edge zone", () => {
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
      type: "object.stage_action",
      objectId: "note-front",
      action: "discard",
      edge: "left",
    });
    expect(released.effects).not.toContainEqual(
      expect.objectContaining({ type: "object.commit_move" }),
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

  it("pans the local viewport with an open palm over blank canvas", () => {
    const started = reduceSpatialGesture(
      createInitialSpatialGestureState(),
      { mode: "open_palm", pointer: { x: 0.7, y: 0.6 }, timestamp: 1_000 },
      scene,
    );
    expect(started.state).toMatchObject({ phase: "panning" });
    expect(started.effects).toEqual([
      { type: "viewport.pan_by", deltaX: 0, deltaY: 0 },
    ]);

    const moved = reduceSpatialGesture(
      started.state,
      { mode: "open_palm", pointer: { x: 0.6, y: 0.5 }, timestamp: 1_016 },
      scene,
    );
    expect(moved.state).toMatchObject({ phase: "panning" });
    expect(moved.effects).toEqual([
      { type: "viewport.pan_by", deltaX: -100, deltaY: -50 },
    ]);
    expect(moved.effects).not.toContainEqual(
      expect.objectContaining({ type: "object.commit_move" }),
    );
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
      { mode: "pinch", pointer: { x: 0.25, y: 0.4 }, timestamp: 1_116 },
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
    expect(released.state.phase).toBe("awaiting_neutral");
  });

  it("zooms the local viewport about the hand midpoint when two hands spread over blank canvas", () => {
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
    );
    expect(started.state).toMatchObject({ phase: "zooming" });
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
    );
    expect(spread.effects).toEqual([
      {
        type: "viewport.zoom_at",
        scale: 1.5,
        screenPoint: { x: 800, y: 200 },
      },
    ]);
    expect(spread.effects).not.toContainEqual(
      expect.objectContaining({ type: "object.preview_resize" }),
    );
  });

  it("hit-tests the visible rotated object footprint", () => {
    const result = reduceSpatialGesture(
      createInitialSpatialGestureState(),
      { mode: "pinch", pointer: { x: 0.35, y: 0.66 } },
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
            zIndex: 3,
            pinned: false,
            minimized: false,
          },
        ],
      },
    );

    expect(result.state).toMatchObject({
      phase: "grabbing",
      grab: { objectId: "wide-rotated-card" },
    });
  });

  it("uses the effective visual stacking order for overlapping hand targets", () => {
    const result = reduceSpatialGesture(
      createInitialSpatialGestureState(),
      { mode: "pinch", pointer: { x: 0.3, y: 0.4 } },
      {
        ...scene,
        objects: [
          {
            id: "visually-raised",
            x: 200,
            y: 150,
            width: 200,
            height: 140,
            zIndex: 1_000_000,
            pinned: false,
            minimized: false,
          },
          {
            id: "durably-higher",
            x: 200,
            y: 150,
            width: 200,
            height: 140,
            zIndex: 20,
            pinned: false,
            minimized: false,
          },
        ],
      },
    );

    expect(result.state).toMatchObject({
      grab: { objectId: "visually-raised" },
    });
  });

  it("exposes the exact staged edge action before release", () => {
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
    const merelyNearEdge = reduceSpatialGesture(
      grabbed.state,
      { mode: "pinch", pointer: { x: 0.055, y: 0.4 } },
      objectScene,
    );
    expect(merelyNearEdge.state.grab?.stagedExitAction).toEqual({
      action: "discard",
      edge: "left",
    });

    const grabbedAtEdge = reduceSpatialGesture(
      createInitialSpatialGestureState(),
      { mode: "pinch", pointer: { x: 0.055, y: 0.4 } },
      {
        ...objectScene,
        objects: [{ ...objectScene.objects[0], x: 0 }],
      },
    );
    expect(grabbedAtEdge.state.grab?.stagedExitAction).toBeNull();
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
