import { describe, expect, it } from "vitest";

import {
  createInitialHandIntentState,
  interpretHandFrame,
  type HandLandmarks,
} from "@/lib/gesture/hand-intent";
import {
  createInitialSpatialGestureState,
  reduceSpatialGesture,
  type SpatialBimanualHand,
  type SpatialGestureInput,
  type SpatialGestureScene,
} from "@/lib/gesture/spatial-gesture";
import { rawHandLandmarks } from "@/lib/testing/hand-landmark-fixtures";

const manipulation = { drawingEnabled: false, manipulationEnabled: true };

function rawPinchedHand(
  trackId: string,
  timestamp: number,
  options: { readonly offsetX: number; readonly offsetY?: number },
): SpatialBimanualHand {
  const landmarks = rawHandLandmarks({
    pose: "pinch",
    offsetX: options.offsetX,
    offsetY: options.offsetY,
  });
  const transition = interpretHandFrame(
    createInitialHandIntentState(),
    rawFrame(landmarks, timestamp),
    timestamp,
    { pinchEngageRatio: 0.4, pinchReleaseRatio: 0.6 },
  );
  if (!transition.output.accepted || transition.output.mode !== "pinch")
    throw new Error("The raw fixture must first qualify as a pinch.");
  return {
    trackId,
    pointer: transition.output.pointer,
    motionPointer: transition.output.motionPointer,
    confidence: transition.output.confidence,
    real: true,
    predicted: false,
    trackingState: "tracked",
  };
}

function rawOpenPalmInput(
  trackId: string,
  timestamp: number,
): Extract<SpatialGestureInput, { mode: "open_palm" }> {
  const transition = interpretHandFrame(
    createInitialHandIntentState(),
    rawFrame(rawHandLandmarks({ pose: "open_palm" }), timestamp),
    timestamp,
  );
  if (!transition.output.accepted || transition.output.mode !== "open_palm")
    throw new Error("The raw fixture must first qualify as an open palm.");
  return {
    mode: "open_palm",
    pointer: transition.output.pointer,
    motionPointer: transition.output.motionPointer,
    timestamp,
    reliability: {
      trackId,
      confidence: transition.output.confidence,
      real: true,
      predicted: false,
      trackingState: "tracked",
    },
  };
}

function rawBimanualInput(
  timestamp: number,
  leftOffset: number,
  rightOffset: number,
  confidence = 0.98,
): Extract<SpatialGestureInput, { mode: "bimanual_pinch" }> {
  const rawHands = [
    rawPinchedHand("left-track", timestamp, { offsetX: leftOffset }),
    rawPinchedHand("right-track", timestamp, { offsetX: rightOffset }),
  ] as const;
  const hands = rawHands.map((hand) => ({ ...hand, confidence })) as [
    SpatialBimanualHand,
    SpatialBimanualHand,
  ];
  return {
    mode: "bimanual_pinch",
    pointers: [hands[0].pointer, hands[1].pointer],
    span: Math.hypot(
      hands[1].pointer.x - hands[0].pointer.x,
      hands[1].pointer.y - hands[0].pointer.y,
    ),
    timestamp,
    hands,
  };
}

function rawFrame(landmarks: HandLandmarks, timestamp: number) {
  return { landmarks, confidence: 0.98, timestamp };
}

function rawSingleInput(
  mode: "pinch" | "point",
  trackId: string,
  timestamp: number,
  pointer: { readonly x: number; readonly y: number },
  edgePreviewVisible = false,
  confidence = 0.98,
): Extract<SpatialGestureInput, { mode: "pinch" | "point" }> {
  const transition = interpretHandFrame(
    createInitialHandIntentState(),
    rawFrame(
      rawHandLandmarks({
        pose: mode === "pinch" ? "pinch" : "relaxed_index",
        indexTip: pointer,
        ...(mode === "pinch"
          ? { thumbTip: { x: pointer.x + 0.018, y: pointer.y + 0.004 } }
          : {}),
      }),
      timestamp,
    ),
    timestamp,
    { pinchEngageRatio: 0.4, pinchReleaseRatio: 0.6 },
  );
  if (!transition.output.accepted || transition.output.mode !== mode)
    throw new Error(`The raw fixture must first qualify as ${mode}.`);
  return {
    mode,
    pointer: transition.output.pointer,
    motionPointer: transition.output.pointer,
    timestamp,
    reliability: {
      trackId,
      confidence,
      real: true,
      predicted: false,
      trackingState: "tracked",
    },
    edgePreviewVisible,
  };
}

describe("raw-landmark spatial recovery", () => {
  it("accepts valid 0.60-confidence index ink but rejects 0.49", () => {
    const scene: SpatialGestureScene = {
      bounds: { left: 0, top: 0, width: 1_000, height: 600 },
      viewport: { x: 0, y: 0, scale: 1 },
      selectedObjectId: null,
      objects: [],
    };
    const drawing = { drawingEnabled: true, manipulationEnabled: false };
    const accepted = reduceSpatialGesture(
      createInitialSpatialGestureState(),
      rawSingleInput("point", "draw-track", 500, { x: 0.4, y: 0.4 }, false, 0.6),
      scene,
      drawing,
    );
    const rejected = reduceSpatialGesture(
      createInitialSpatialGestureState(),
      rawSingleInput("point", "draw-track", 500, { x: 0.4, y: 0.4 }, false, 0.49),
      scene,
      drawing,
    );

    expect(accepted.state.phase).toBe("drawing");
    expect(accepted.effects).toContainEqual(
      expect.objectContaining({ type: "stroke.preview" }),
    );
    expect(rejected.state.phase).toBe("idle");
    expect(rejected.effects).toEqual([]);
  });

  it("lets a valid 0.60-confidence pinch acquire and move an object", () => {
    const scene: SpatialGestureScene = {
      bounds: { left: 0, top: 0, width: 1_000, height: 600 },
      viewport: { x: 0, y: 0, scale: 1 },
      selectedObjectId: null,
      objects: [
        {
          id: "confidence-card",
          x: 300,
          y: 180,
          width: 260,
          height: 180,
          zIndex: 1,
          pinned: false,
          minimized: false,
        },
      ],
    };
    const pending = reduceSpatialGesture(
      createInitialSpatialGestureState(),
      rawSingleInput("pinch", "move-track", 600, { x: 0.4, y: 0.4 }, false, 0.6),
      scene,
      manipulation,
    );
    const held = reduceSpatialGesture(
      pending.state,
      rawSingleInput("pinch", "move-track", 648, { x: 0.4, y: 0.4 }, false, 0.6),
      scene,
      manipulation,
    );
    const moved = reduceSpatialGesture(
      held.state,
      rawSingleInput("pinch", "move-track", 664, { x: 0.46, y: 0.4 }, false, 0.6),
      scene,
      manipulation,
    );

    expect(held.state).toMatchObject({
      phase: "held_one",
      held: { objectId: "confidence-card" },
    });
    expect(moved.state.held?.currentTransform.x).toBeGreaterThan(300);
  });

  it("allows two valid 0.60-confidence hands to transform objects and blank canvas", () => {
    const selectedObject = {
      id: "two-hand-confidence-card",
      x: 300,
      y: 260,
      width: 400,
      height: 220,
      zIndex: 1,
      pinned: false,
      minimized: false,
    };
    const objectScene: SpatialGestureScene = {
      bounds: { left: 0, top: 0, width: 1_000, height: 600 },
      viewport: { x: 0, y: 0, scale: 1 },
      selectedObjectId: selectedObject.id,
      objects: [selectedObject],
    };
    const objectTransform = reduceSpatialGesture(
      createInitialSpatialGestureState(),
      rawBimanualInput(700, -0.2, 0.2, 0.6),
      objectScene,
      manipulation,
    );
    const canvasZoom = reduceSpatialGesture(
      createInitialSpatialGestureState(),
      rawBimanualInput(700, -0.2, 0.2, 0.6),
      { ...objectScene, selectedObjectId: null, objects: [] },
      manipulation,
    );

    expect(objectTransform.state.phase).toBe("transforming_two");
    expect(canvasZoom.state.phase).toBe("panning");
  });
  it.each([0.35, 2.5])(
    "keeps direct two-hand acquisition in CSS pixels at viewport scale %s",
    (scale) => {
      const object = {
        id: "selected-card",
        x: 300,
        y: 260,
        width: 400,
        height: 220,
        rotation: 0,
        zIndex: 5,
        pinned: false,
        minimized: false,
      };
      const scene: SpatialGestureScene = {
        bounds: { left: 0, top: 0, width: 1_000, height: 600 },
        viewport: {
          x: 532 - (object.x + object.width / 2) * scale,
          y: 440.4 - (object.y + object.height / 2) * scale,
          scale,
        },
        selectedObjectId: object.id,
        objects: [object],
      };

      const wideEnough = reduceSpatialGesture(
        createInitialSpatialGestureState(),
        rawBimanualInput(900, -0.006, 0.006),
        scene,
        manipulation,
      );
      expect(wideEnough.state.phase).toBe("transforming_two");
      expect(wideEnough.state.held?.objectId).toBe(object.id);
      expect(
        wideEnough.effects.some(
          (effect) => effect.type === "object.preview_transform",
        ),
      ).toBe(true);

      const tooNarrow = reduceSpatialGesture(
        createInitialSpatialGestureState(),
        rawBimanualInput(916, -0.002, 0.002),
        scene,
        manipulation,
      );
      expect(tooNarrow.state.phase).not.toBe("transforming_two");
      expect(
        tooNarrow.effects.some(
          (effect) => effect.type === "object.preview_transform",
        ),
      ).toBe(false);
    },
  );

  it.each([0.35, 2.5])(
    "keeps held-object two-hand upgrade in CSS pixels at viewport scale %s",
    (scale) => {
      const object = {
        id: "held-card",
        x: 300,
        y: 260,
        width: 400,
        height: 220,
        rotation: 0,
        zIndex: 5,
        pinned: false,
        minimized: false,
      };
      const scene: SpatialGestureScene = {
        bounds: { left: 0, top: 0, width: 1_000, height: 600 },
        viewport: {
          x: 532 - (object.x + object.width / 2) * scale,
          y: 440.4 - (object.y + object.height / 2) * scale,
          scale,
        },
        selectedObjectId: object.id,
        objects: [object],
      };
      const acquireHeld = (timestamp: number) => {
        const pending = reduceSpatialGesture(
          createInitialSpatialGestureState(),
          rawSingleInput("pinch", "left-track", timestamp, {
            x: 0.526,
            y: 0.734,
          }),
          scene,
          manipulation,
        );
        const held = reduceSpatialGesture(
          pending.state,
          rawSingleInput("pinch", "left-track", timestamp + 48, {
            x: 0.526,
            y: 0.734,
          }),
          scene,
          manipulation,
        );
        expect(held.state.phase).toBe("held_one");
        return held.state;
      };
      const upgrade = (
        heldState: ReturnType<typeof acquireHeld>,
        timestamp: number,
        offset: number,
      ) => {
        const pending = reduceSpatialGesture(
          heldState,
          rawBimanualInput(timestamp, -offset, offset),
          scene,
          manipulation,
        );
        expect(pending.state.phase).toBe("two_hand_pending");
        return reduceSpatialGesture(
          pending.state,
          rawBimanualInput(timestamp + 100, -offset, offset),
          scene,
          manipulation,
        );
      };

      const wideEnough = upgrade(acquireHeld(1_100), 1_200, 0.006);
      expect(wideEnough.state.phase).toBe("transforming_two");
      expect(
        wideEnough.effects.some(
          (effect) => effect.type === "object.preview_transform",
        ),
      ).toBe(true);

      const tooNarrow = upgrade(acquireHeld(2_100), 2_200, 0.002);
      expect(tooNarrow.state.phase).toBe("two_hand_pending");
      expect(
        tooNarrow.effects.some(
          (effect) => effect.type === "object.complete_transform",
        ),
      ).toBe(false);
    },
  );

  it("directly acquires the selected object with two trusted pinches and commits once", () => {
    const scene: SpatialGestureScene = {
      bounds: { left: 0, top: 0, width: 1_000, height: 600 },
      viewport: { x: 0, y: 0, scale: 1 },
      selectedObjectId: "selected-card",
      objects: [
        {
          id: "selected-card",
          x: 300,
          y: 260,
          width: 400,
          height: 220,
          rotation: 0,
          zIndex: 5,
          pinned: false,
          minimized: false,
        },
      ],
    };
    const acquired = reduceSpatialGesture(
      createInitialSpatialGestureState(),
      rawBimanualInput(1_000, -0.2, 0.2),
      scene,
      manipulation,
    );
    expect(acquired.state).toMatchObject({
      phase: "transforming_two",
      held: { objectId: "selected-card" },
      transform: {
        ownerTrackId: "left-track",
        secondTrackId: "right-track",
      },
    });
    expect(acquired.effects).toEqual([
      { type: "object.select", objectId: "selected-card" },
      expect.objectContaining({
        type: "object.preview_transform",
        objectId: "selected-card",
      }),
    ]);

    const resized = reduceSpatialGesture(
      acquired.state,
      rawBimanualInput(1_016, -0.28, 0.28),
      scene,
      manipulation,
    );
    expect(resized.state.held?.currentTransform.width).toBeGreaterThan(400);
    expect(
      resized.effects.filter((effect) => effect.type === "object.preview_transform"),
    ).toHaveLength(1);

    const released = reduceSpatialGesture(
      resized.state,
      rawOpenPalmInput("left-track", 1_032),
      scene,
      manipulation,
    );
    expect(
      released.effects.filter((effect) => effect.type === "object.complete_transform"),
    ).toHaveLength(1);
  });

  it("derives blank-canvas zoom and translation from one captured world anchor", () => {
    const scene: SpatialGestureScene = {
      bounds: { left: 0, top: 0, width: 1_000, height: 600 },
      viewport: { x: 40, y: -20, scale: 2 },
      selectedObjectId: null,
      objects: [],
    };
    const initialInput = rawBimanualInput(2_000, -0.2, 0.1);
    const started = reduceSpatialGesture(
      createInitialSpatialGestureState(),
      initialInput,
      scene,
      manipulation,
    );
    expect(started.effects).toEqual([
      { type: "viewport.set", viewport: scene.viewport },
    ]);

    const movedInput = rawBimanualInput(2_016, -0.15, 0.25);
    const moved = reduceSpatialGesture(started.state, movedInput, scene, manipulation);
    const initialCenter = midpointScreen(initialInput, scene);
    const currentCenter = midpointScreen(movedInput, scene);
    const worldAnchor = {
      x: (initialCenter.x - scene.viewport.x) / scene.viewport.scale,
      y: (initialCenter.y - scene.viewport.y) / scene.viewport.scale,
    };
    const nextScale = 2.5;
    expect(moved.effects).toEqual([
      {
        type: "viewport.set",
        viewport: {
          x: expect.closeTo(currentCenter.x - worldAnchor.x * nextScale, 4),
          y: expect.closeTo(currentCenter.y - worldAnchor.y * nextScale, 4),
          scale: nextScale,
        },
      },
    ]);
    expect(
      moved.effects.some((effect) => effect.type.startsWith("object.complete")),
    ).toBe(false);

    const movedViewport = moved.effects.find(
      (effect) => effect.type === "viewport.set",
    )?.viewport;
    if (!movedViewport) throw new Error("Expected the spread to preview a viewport.");
    const stationary = reduceSpatialGesture(
      moved.state,
      movedInput,
      { ...scene, viewport: movedViewport },
      manipulation,
    );
    expect(stationary.effects).toEqual([
      { type: "viewport.set", viewport: movedViewport },
    ]);
    expect(
      stationary.effects.some((effect) => effect.type.startsWith("object.complete")),
    ).toBe(false);
  });

  it("keeps the raw-frame side throw staged until a trusted release", () => {
    const scene: SpatialGestureScene = {
      bounds: { left: 0, top: 0, width: 1_000, height: 600 },
      viewport: { x: 0, y: 0, scale: 1 },
      objects: [
        {
          id: "throw-card",
          x: 200,
          y: 150,
          width: 200,
          height: 120,
          zIndex: 1,
          pinned: false,
          minimized: false,
        },
      ],
    };
    const pending = reduceSpatialGesture(
      createInitialSpatialGestureState(),
      rawSingleInput("pinch", "throw-track", 3_000, { x: 0.25, y: 0.35 }),
      scene,
      manipulation,
    );
    const acquired = reduceSpatialGesture(
      pending.state,
      rawSingleInput("pinch", "throw-track", 3_048, { x: 0.25, y: 0.35 }),
      scene,
      manipulation,
    );
    const first = reduceSpatialGesture(
      acquired.state,
      rawSingleInput("pinch", "throw-track", 3_200, { x: 0.25, y: 0.4 }),
      scene,
      manipulation,
    );
    const middle = reduceSpatialGesture(
      first.state,
      rawSingleInput("pinch", "throw-track", 3_250, { x: 0.16, y: 0.4 }),
      scene,
      manipulation,
    );
    const staged = reduceSpatialGesture(
      middle.state,
      rawSingleInput("pinch", "throw-track", 3_300, { x: 0.05, y: 0.4 }),
      scene,
      manipulation,
    );
    expect(staged.effects).not.toContainEqual(
      expect.objectContaining({ type: "object.complete_edge_action" }),
    );
    const visible = reduceSpatialGesture(
      staged.state,
      rawSingleInput(
        "pinch",
        "throw-track",
        3_310,
        { x: 0.04, y: 0.4 },
        true,
      ),
      scene,
      manipulation,
    );
    const released = reduceSpatialGesture(
      visible.state,
      rawSingleInput("point", "throw-track", 3_320, { x: 0.04, y: 0.4 }),
      scene,
      manipulation,
    );
    expect(released.effects).toContainEqual({
      type: "object.complete_edge_action",
      objectId: "throw-card",
      action: "discard",
      edge: "left",
    });
  });
});

function midpointScreen(
  input: Extract<SpatialGestureInput, { mode: "bimanual_pinch" }>,
  scene: SpatialGestureScene,
) {
  const [left, right] = input.hands!;
  const first = left.motionPointer ?? left.pointer;
  const second = right.motionPointer ?? right.pointer;
  return {
    x: ((first.x + second.x) / 2) * scene.bounds.width,
    y: ((first.y + second.y) / 2) * scene.bounds.height,
  };
}
