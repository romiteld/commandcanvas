import { describe, expect, it } from "vitest";

import {
  applyCanvasCommand,
  type CanvasCommandEnvelope,
  type CanvasState,
  type CommandRuntime,
} from "@/lib/canvas/command-engine";
import {
  createInitialSpatialGestureState,
  reduceSpatialGesture,
  spatialGestureCompletionToCommand,
  type SpatialGestureCompletionEffect,
  type SpatialGestureInput,
  type SpatialGestureScene,
  type SpatialGestureState,
} from "@/lib/gesture/spatial-gesture";

const manipulation = {
  drawingEnabled: false,
  manipulationEnabled: true,
};
const drawing = {
  drawingEnabled: true,
  manipulationEnabled: false,
};
const scene: SpatialGestureScene = {
  bounds: { left: 0, top: 0, width: 1_000, height: 600 },
  viewport: { x: 0, y: 0, scale: 1 },
  objects: [
    {
      id: "note-a",
      x: 200,
      y: 150,
      width: 200,
      height: 120,
      rotation: 10,
      zIndex: 4,
      pinned: false,
      minimized: false,
    },
    {
      id: "note-b",
      x: 90,
      y: 150,
      width: 80,
      height: 120,
      zIndex: 3,
      pinned: false,
      minimized: false,
    },
  ],
};

function reliability(
  trackId = "hand-a",
  overrides: Partial<{
    confidence: number;
    real: boolean;
    predicted: boolean;
    trackingState: "tracked" | "uncertain" | "reacquire" | "released";
  }> = {},
) {
  return {
    trackId,
    confidence: 0.95,
    real: true,
    predicted: false,
    trackingState: "tracked" as const,
    ...overrides,
  };
}

function point(
  x: number,
  y: number,
  timestamp: number,
  overrides: Partial<Extract<SpatialGestureInput, { mode: "point" }>> = {},
): Extract<SpatialGestureInput, { mode: "point" }> {
  return {
    mode: "point",
    pointer: { x, y },
    motionPointer: { x, y },
    timestamp,
    reliability: reliability(),
    ...overrides,
  };
}

function pinch(
  x: number,
  y: number,
  timestamp: number,
  overrides: Partial<Extract<SpatialGestureInput, { mode: "pinch" }>> = {},
): Extract<SpatialGestureInput, { mode: "pinch" }> {
  return {
    mode: "pinch",
    pointer: { x, y },
    motionPointer: { x, y },
    timestamp,
    reliability: reliability(),
    ...overrides,
  };
}

function palm(
  x: number,
  y: number,
  timestamp: number,
): Extract<SpatialGestureInput, { mode: "open_palm" }> {
  return {
    mode: "open_palm",
    pointer: { x, y },
    motionPointer: { x, y },
    timestamp,
    reliability: reliability(),
  };
}

function step(
  state: SpatialGestureState,
  input: SpatialGestureInput,
  spatialScene = scene,
  policy = manipulation,
) {
  return reduceSpatialGesture(state, input, spatialScene, policy);
}

function hoverStable(
  spatialScene = scene,
  x = 0.25,
  y = 0.35,
  startAt = 1_000,
) {
  const entered = step(
    createInitialSpatialGestureState(),
    point(x, y, startAt),
    spatialScene,
  );
  return step(entered.state, point(x, y, startAt + 100), spatialScene);
}

function held(
  spatialScene = scene,
  x = 0.25,
  y = 0.35,
  startAt = 1_000,
) {
  const stable = hoverStable(spatialScene, x, y, startAt);
  return step(stable.state, pinch(x, y, startAt + 110), spatialScene);
}

function bimanual(
  first: { x: number; y: number },
  second: { x: number; y: number },
  timestamp: number,
  overrides: Partial<Extract<SpatialGestureInput, { mode: "bimanual_pinch" }>> = {},
): Extract<SpatialGestureInput, { mode: "bimanual_pinch" }> {
  return {
    mode: "bimanual_pinch",
    pointers: [first, second],
    span: Math.hypot(first.x - second.x, first.y - second.y),
    timestamp,
    hands: [
      {
        pointer: first,
        motionPointer: first,
        ...reliability("hand-a"),
      },
      {
        pointer: second,
        motionPointer: second,
        ...reliability("hand-b"),
      },
    ],
    ...overrides,
  };
}

function transforming(spatialScene = scene) {
  const acquired = held(spatialScene);
  const pending = step(
    acquired.state,
    bimanual({ x: 0.25, y: 0.35 }, { x: 0.4, y: 0.35 }, 1_200),
    spatialScene,
  );
  return step(
    pending.state,
    bimanual({ x: 0.25, y: 0.35 }, { x: 0.4, y: 0.35 }, 1_300),
    spatialScene,
  );
}

function beginLeftThrow(
  options: {
    zoneX?: number;
    firstSampleAt?: number;
    finalAt?: number;
    firstX?: number;
    firstY?: number;
    middleConfidence?: number;
    finalY?: number;
  } = {},
) {
  const acquired = held();
  const firstAt = options.firstSampleAt ?? 1_200;
  const finalAt = options.finalAt ?? 1_300;
  const first = step(
    acquired.state,
    pinch(options.firstX ?? 0.25, options.firstY ?? 0.4, firstAt),
  );
  const middle = step(
    first.state,
    pinch(0.16, 0.4, firstAt + Math.max(1, Math.floor((finalAt - firstAt) / 2)), {
      reliability: reliability("hand-a", {
        confidence: options.middleConfidence ?? 0.95,
      }),
    }),
  );
  return step(
    middle.state,
    pinch(options.zoneX ?? 0.05, options.finalY ?? 0.4, finalAt),
  );
}

function beginLeftThrowAtFrameRate(framesPerSecond: number) {
  const frameInterval = 1_000 / framesPerSecond;
  const firstAt = 1_200;
  const acquired = held();
  const first = step(acquired.state, pinch(0.25, 0.4, firstAt));
  const middle = step(
    first.state,
    pinch(0.16, 0.4, firstAt + frameInterval),
  );
  const finalAt = firstAt + frameInterval * 2;
  const final = step(middle.state, pinch(0.05, 0.4, finalAt));
  return { final, finalAt };
}

function acknowledgeEdge(
  state: SpatialGestureState,
  timestamp = 1_310,
  overrides: Partial<Extract<SpatialGestureInput, { mode: "pinch" }>> = {},
) {
  return step(
    state,
    pinch(0.04, 0.4, timestamp, {
      edgePreviewVisible: true,
      ...overrides,
    }),
  );
}

function applyGestureCompletion(
  completion: SpatialGestureCompletionEffect,
  spatialScene: SpatialGestureScene,
) {
  const source = spatialScene.objects.find(({ id }) => id === completion.objectId);
  if (!source) throw new Error("completion fixture needs its source object");
  const canvas: CanvasState = {
    roomId: "room-command-boundary",
    revision: 1,
    objects: {
      [source.id]: {
        id: source.id,
        roomId: "room-command-boundary",
        type: "note",
        title: "Gesture command boundary",
        x: source.x,
        y: source.y,
        width: source.width,
        height: source.height,
        zIndex: source.zIndex,
        payload: { text: "Canonical transform", tone: "coral" },
        minimized: source.minimized,
        pinned: source.pinned,
        createdBy: "participant-host",
        createdAt: "2026-08-29T12:00:00.000Z",
        updatedAt: "2026-08-29T12:00:00.000Z",
        deletedAt: null,
        version: 1,
        metadata: {},
        rotation: source.rotation ?? 0,
        parentId: null,
      },
    },
    receipts: [],
    undoneReceiptIds: [],
    redoReceiptIds: [],
  };
  return applyCanvasCommand(
    canvas,
    {
      id: `command-${completion.type}-${completion.objectId}`,
      roomId: canvas.roomId,
      baseRevision: canvas.revision,
      issuedAt: "2026-08-29T12:00:01.000Z",
      actor: { id: "participant-host", displayName: "Danny", type: "human" },
      source: "gesture",
      command: spatialGestureCompletionToCommand(completion),
    },
    { createId: (prefix) => `${prefix}-canonical` },
  );
}

describe("authoritative spatial gesture reducer", () => {
  it("uses the clamped magnetic radius, 100 ms dwell, and an 80 ms 12px contender threshold", () => {
    const unrotatedA = { ...scene.objects[0], rotation: 0 };
    const outside = step(
      createInitialSpatialGestureState(),
      point(0.171, 0.35, 1_000),
      { ...scene, objects: [unrotatedA] },
    );
    expect(outside.state.candidate).toBeNull();

    const entered = step(
      outside.state,
      point(0.172, 0.35, 1_010),
      { ...scene, objects: [unrotatedA] },
    );
    expect(entered.state).toMatchObject({
      phase: "hover",
      candidate: { objectId: "note-a", stable: false },
    });
    const pinchedBeforeDwell = step(
      entered.state,
      pinch(0.172, 0.35, 1_050),
      { ...scene, objects: [unrotatedA] },
    );
    expect(pinchedBeforeDwell.state).toMatchObject({
      phase: "pinch_pending",
      pinchPending: { objectId: "note-a", ownerTrackId: "hand-a" },
    });
    expect(pinchedBeforeDwell.effects).not.toContainEqual(
      expect.objectContaining({ type: "object.select" }),
    );
    const beforeDwell = step(
      entered.state,
      point(0.172, 0.35, 1_109),
      { ...scene, objects: [unrotatedA] },
    );
    expect(beforeDwell.state.candidate?.stable).toBe(false);
    const dwelled = step(
      beforeDwell.state,
      point(0.172, 0.35, 1_110),
      { ...scene, objects: [unrotatedA] },
    );
    expect(dwelled.state.candidate?.stable).toBe(true);

    const middleRadiusScene = {
      ...scene,
      bounds: { ...scene.bounds, width: 1_000, height: 1_000 },
      objects: [unrotatedA],
    };
    expect(
      step(
        createInitialSpatialGestureState(),
        point(0.159, 0.21, 1_000),
        middleRadiusScene,
      ).state.candidate,
    ).toBeNull();
    expect(
      step(
        createInitialSpatialGestureState(),
        point(0.16, 0.21, 1_000),
        middleRadiusScene,
      ).state.candidate?.objectId,
    ).toBe("note-a");

    const maximumRadiusScene = {
      ...scene,
      bounds: { ...scene.bounds, width: 2_000, height: 2_000 },
      objects: [unrotatedA],
    };
    expect(
      step(
        createInitialSpatialGestureState(),
        point(0.0715, 0.105, 1_000),
        maximumRadiusScene,
      ).state.candidate,
    ).toBeNull();
    expect(
      step(
        createInitialSpatialGestureState(),
        point(0.072, 0.105, 1_000),
        maximumRadiusScene,
      ).state.candidate?.objectId,
    ).toBe("note-a");

    const stableA = hoverStable(scene, 0.22, 0.35, 2_000);
    const contender = step(stableA.state, point(0.176, 0.35, 2_110));
    expect(contender.state.candidate?.objectId).toBe("note-a");
    expect(contender.state.candidate?.contender?.objectId).toBe("note-b");
    const tooSoon = step(contender.state, point(0.176, 0.35, 2_189));
    expect(tooSoon.state.candidate?.objectId).toBe("note-a");
    const replaced = step(tooSoon.state, point(0.176, 0.35, 2_190));
    expect(replaced.state.candidate?.objectId).toBe("note-b");
  });

  it("latches the stable candidate at pinch and never retargets while held", () => {
    const stable = hoverStable();
    const acquired = step(stable.state, pinch(0.25, 0.35, 1_110));
    expect(acquired.state).toMatchObject({
      phase: "held_one",
      held: { objectId: "note-a", ownerTrackId: "hand-a" },
    });

    const overOther = step(acquired.state, pinch(0.12, 0.35, 1_160));
    expect(overOther.state).toMatchObject({
      phase: "held_one",
      held: { objectId: "note-a", ownerTrackId: "hand-a" },
    });
    expect(overOther.effects).not.toContainEqual(
      expect.objectContaining({ type: "object.select", objectId: "note-b" }),
    );
  });

  it("does not let another track complete the owner's pinch-pending acquisition", () => {
    const entered = step(
      createInitialSpatialGestureState(),
      point(0.25, 0.35, 1_000),
    );
    const pending = step(
      entered.state,
      pinch(0.25, 0.35, 1_050, { reliability: reliability("hand-a") }),
    );
    const wrongTrack = step(
      pending.state,
      pinch(0.25, 0.35, 1_150, { reliability: reliability("hand-b") }),
    );

    expect(wrongTrack.state).toMatchObject({
      phase: "pinch_pending",
      pinchPending: { objectId: "note-a", ownerTrackId: "hand-a" },
      held: null,
    });
    expect(wrongTrack.effects).toEqual([]);
  });

  it("ignores a non-owner track instead of moving the held object", () => {
    const acquired = held();
    const wrongTrack = step(
      acquired.state,
      pinch(0.5, 0.5, 1_200, { reliability: reliability("hand-b") }),
    );

    expect(wrongTrack.state).toMatchObject({
      phase: "held_one",
      held: {
        ownerTrackId: "hand-a",
        currentTransform: { x: 200, y: 150, width: 200, height: 120, rotation: 10 },
      },
    });
    expect(wrongTrack.effects).toEqual([]);
  });

  it("ignores a non-owner point release and preserves held ownership", () => {
    const acquired = held();
    const wrongTrack = step(
      acquired.state,
      point(0.3, 0.4, 1_200, { reliability: reliability("hand-b") }),
    );

    expect(wrongTrack.state).toMatchObject({
      phase: "held_one",
      held: { objectId: "note-a", ownerTrackId: "hand-a" },
    });
    expect(wrongTrack.effects).toEqual([]);
  });

  it("does not let a non-owner track finalize the owner's lost-grace transform", () => {
    const acquired = held();
    const moved = step(acquired.state, pinch(0.3, 0.4, 1_150));
    const lost = step(moved.state, {
      mode: "idle",
      timestamp: 1_180,
      reason: "loss",
    });
    const wrongTrack = step(
      lost.state,
      point(0.3, 0.4, 1_220, { reliability: reliability("hand-b") }),
    );

    expect(wrongTrack.state).toMatchObject({
      phase: "lost_grace",
      held: { ownerTrackId: "hand-a" },
    });
    expect(wrongTrack.effects).not.toContainEqual(
      expect.objectContaining({ type: "object.complete_transform" }),
    );
  });

  it("does not let a non-owner track build or arm side-throw evidence", () => {
    const acquired = held();
    const first = step(
      acquired.state,
      pinch(0.25, 0.4, 1_200, { reliability: reliability("hand-b") }),
    );
    const middle = step(
      first.state,
      pinch(0.16, 0.4, 1_250, { reliability: reliability("hand-b") }),
    );
    const edge = step(
      middle.state,
      pinch(0.05, 0.4, 1_300, {
        reliability: reliability("hand-b"),
        edgePreviewVisible: true,
      }),
    );

    expect(edge.state).toMatchObject({
      phase: "held_one",
      held: { objectId: "note-a", ownerTrackId: "hand-a" },
      edgeAction: null,
    });
    expect(edge.state.motionHistory).toHaveLength(1);
    expect(edge.effects).toEqual([]);
  });

  it("moves from the stable motion point so pinch closure does not jump the object", () => {
    const entered = step(
      createInitialSpatialGestureState(),
      point(0.25, 0.35, 1_000, { motionPointer: { x: 0.26, y: 0.4 } }),
    );
    const stable = step(
      entered.state,
      point(0.25, 0.35, 1_100, { motionPointer: { x: 0.26, y: 0.4 } }),
    );
    const acquired = step(
      stable.state,
      pinch(0.22, 0.37, 1_110, { motionPointer: { x: 0.26, y: 0.4 } }),
    );

    expect(acquired.effects).toContainEqual({
      type: "object.preview_transform",
      objectId: "note-a",
      transform: { x: 200, y: 150, width: 200, height: 120, rotation: 10 },
    });
    const moved = step(
      acquired.state,
      pinch(0.23, 0.38, 1_130, { motionPointer: { x: 0.3, y: 0.42 } }),
    );
    expect(moved.effects).toContainEqual({
      type: "object.preview_transform",
      objectId: "note-a",
      transform: { x: 240, y: 162, width: 200, height: 120, rotation: 10 },
    });
  });

  it("canonicalizes a stale object's transform before emitting an acquisition preview", () => {
    const staleScene: SpatialGestureScene = {
      ...scene,
      objects: [
        {
          ...scene.objects[0]!,
          width: 80,
          height: 40,
          rotation: 540,
        },
      ],
    };
    const stable = hoverStable(staleScene);
    const acquired = step(
      stable.state,
      pinch(0.25, 0.35, 1_110),
      staleScene,
    );

    expect(acquired.effects).toContainEqual({
      type: "object.preview_transform",
      objectId: "note-a",
      transform: { x: 200, y: 150, width: 160, height: 80, rotation: 180 },
    });
  });

  it("re-arms directly from a tracked release without an invisible neutral pose", () => {
    const acquired = held();
    const moved = step(acquired.state, pinch(0.3, 0.4, 1_150));
    const released = step(moved.state, point(0.5, 0.5, 1_180));

    expect(released.state.phase).not.toBe("awaiting_neutral");
    expect(released.effects.filter((effect) => effect.type === "object.complete_transform"))
      .toHaveLength(1);
    const nextHover = step(released.state, point(0.12, 0.35, 1_200));
    expect(nextHover.state.phase).toBe("hover");
  });

  it("commits a held transform on visible neutral before a new pinch reacquires within loss grace", () => {
    const acquired = held();
    const moved = step(acquired.state, pinch(0.3, 0.4, 1_150));
    const neutral = step(moved.state, {
      mode: "idle",
      timestamp: 1_160,
      reason: "release",
    });

    expect(neutral.state.phase).toBe("idle");
    expect(neutral.effects).toContainEqual({
      type: "object.complete_transform",
      objectId: "note-a",
      transform: { x: 250, y: 180, width: 200, height: 120, rotation: 10 },
    });
    expect(neutral.state.phase).not.toBe("lost_grace");

    const entered = step(neutral.state, point(0.3, 0.4, 1_165));
    const stable = step(entered.state, point(0.3, 0.4, 1_265));
    const reacquired = step(stable.state, pinch(0.3, 0.4, 1_270));

    expect(reacquired.state).toMatchObject({
      phase: "held_one",
      held: { objectId: "note-a", ownerTrackId: "hand-a" },
    });
    expect(reacquired.effects).not.toContainEqual(
      expect.objectContaining({ type: "object.complete_transform" }),
    );
    expect(1_270 - 1_160).toBeLessThan(180);
  });

  it("gives drawing precedence and treats open palm as pen-up without palm ink or pan", () => {
    const started = step(
      createInitialSpatialGestureState(),
      point(0.2, 0.3, 1_000),
      scene,
      drawing,
    );
    const continued = step(started.state, point(0.22, 0.32, 1_020), scene, drawing);
    const penUp = step(continued.state, palm(0.8, 0.8, 1_040), scene, drawing);

    expect(penUp.effects).toEqual([
      {
        type: "stroke.commit",
        points: [
          { x: 200, y: 180 },
          { x: 220, y: 192 },
        ],
      },
      { type: "preview.clear" },
    ]);
    expect(penUp.effects).not.toContainEqual(
      expect.objectContaining({ type: "viewport.pan_by" }),
    );
    expect(penUp.state.phase).toBe("idle");
  });

  it("upgrades only after the same second hand pinches near the held object for 100 ms", () => {
    const acquired = held();
    const far = step(
      acquired.state,
      bimanual({ x: 0.25, y: 0.35 }, { x: 0.9, y: 0.8 }, 1_180),
    );
    expect(far.state.phase).toBe("held_one");

    const pending = step(
      far.state,
      bimanual({ x: 0.25, y: 0.35 }, { x: 0.4, y: 0.35 }, 1_200),
    );
    expect(pending.state).toMatchObject({
      phase: "two_hand_pending",
      held: { objectId: "note-a", ownerTrackId: "hand-a" },
      secondHand: { trackId: "hand-b" },
    });
    const tooSoon = step(
      pending.state,
      bimanual({ x: 0.25, y: 0.35 }, { x: 0.4, y: 0.35 }, 1_299),
    );
    expect(tooSoon.state.phase).toBe("two_hand_pending");
    const upgraded = step(
      tooSoon.state,
      bimanual({ x: 0.25, y: 0.35 }, { x: 0.4, y: 0.35 }, 1_300),
    );
    expect(upgraded.state).toMatchObject({
      phase: "transforming_two",
      held: { objectId: "note-a", ownerTrackId: "hand-a" },
      transform: { secondTrackId: "hand-b" },
    });
  });

  it("canonicalizes two-hand geometry by stored track IDs when detector order reverses", () => {
    const upgraded = transforming();
    const ownerPoint = { x: 0.3, y: 0.4 };
    const secondPoint = { x: 0.62, y: 0.48 };
    const ordered = step(
      upgraded.state,
      bimanual(ownerPoint, secondPoint, 1_340),
    );
    const reversed = step(
      upgraded.state,
      bimanual(secondPoint, ownerPoint, 1_340, {
        hands: [
          {
            pointer: secondPoint,
            motionPointer: secondPoint,
            ...reliability("hand-b"),
          },
          {
            pointer: ownerPoint,
            motionPointer: ownerPoint,
            ...reliability("hand-a"),
          },
        ],
      }),
    );

    expect(reversed.state.phase).toBe("transforming_two");
    expect(
      reversed.effects.find((effect) => effect.type === "object.preview_transform"),
    ).toEqual(
      ordered.effects.find((effect) => effect.type === "object.preview_transform"),
    );
  });

  it("enters loss grace when another track replaces the stored second hand", () => {
    const upgraded = transforming();
    const ownerPoint = { x: 0.3, y: 0.4 };
    const replacementPoint = { x: 0.62, y: 0.48 };
    const replaced = step(
      upgraded.state,
      bimanual(ownerPoint, replacementPoint, 1_340, {
        hands: [
          {
            pointer: ownerPoint,
            motionPointer: ownerPoint,
            ...reliability("hand-a"),
          },
          {
            pointer: replacementPoint,
            motionPointer: replacementPoint,
            ...reliability("hand-c"),
          },
        ],
      }),
    );

    expect(replaced.state).toMatchObject({
      phase: "lost_grace",
      held: { ownerTrackId: "hand-a" },
      transform: { ownerTrackId: "hand-a", secondTrackId: "hand-b" },
    });
    expect(replaced.effects).not.toContainEqual(
      expect.objectContaining({ type: "object.preview_transform" }),
    );
  });

  it("previews centroid translation, clamped scale, and deadbanded rotation", () => {
    const upgraded = transforming();
    const smallRotation = step(
      upgraded.state,
      bimanual({ x: 0.25, y: 0.3435 }, { x: 0.4, y: 0.3565 }, 1_320),
    );
    const deadbandPreview = smallRotation.effects.find(
      (effect) => effect.type === "object.preview_transform",
    );
    expect(deadbandPreview).toMatchObject({ transform: { rotation: 10 } });

    const transformed = step(
      smallRotation.state,
      bimanual({ x: 0.3, y: 0.4 }, { x: 0.7, y: 0.5 }, 1_340),
    );
    const preview = transformed.effects.find(
      (effect) => effect.type === "object.preview_transform",
    );
    expect(preview).toMatchObject({
      type: "object.preview_transform",
      objectId: "note-a",
      transform: {
        rotation: expect.closeTo(18.53, 1),
      },
    });
    if (!preview || preview.type !== "object.preview_transform")
      throw new Error("expected transform preview");
    expect(preview.transform.x).toBeGreaterThan(200);
    expect(preview.transform.y).not.toBe(150);
    expect(preview.transform.width).toBeGreaterThan(200);

    const huge = step(
      upgraded.state,
      bimanual({ x: 0, y: 0 }, { x: 1, y: 1 }, 1_340),
    );
    const hugePreview = huge.effects.find(
      (effect) => effect.type === "object.preview_transform",
    );
    if (!hugePreview || hugePreview.type !== "object.preview_transform")
      throw new Error("expected huge transform preview");
    expect(hugePreview.transform.width / 200).toBe(4);

    const tiny = step(
      upgraded.state,
      bimanual({ x: 0.324, y: 0.35 }, { x: 0.326, y: 0.35 }, 1_340),
    );
    const tinyPreview = tiny.effects.find(
      (effect) => effect.type === "object.preview_transform",
    );
    if (!tinyPreview || tinyPreview.type !== "object.preview_transform")
      throw new Error("expected tiny transform preview");
    expect(tinyPreview.transform).toMatchObject({ width: 160, height: 96 });
  });

  it("emits only canonical transforms and applies min, max, rotate, minimize, and maximize through the command engine", () => {
    const minimumBase = transforming();
    const minimumPreview = step(
      minimumBase.state,
      bimanual({ x: 0.324, y: 0.35 }, { x: 0.326, y: 0.35 }, 1_340),
    );
    const minimumRelease = step(minimumPreview.state, point(0.324, 0.35, 1_360));
    const minimumCompletion = minimumRelease.effects.find(
      (effect) => effect.type === "object.complete_transform",
    );
    if (!minimumCompletion || minimumCompletion.type !== "object.complete_transform")
      throw new Error("expected minimum transform completion");
    expect(minimumCompletion.transform).toMatchObject({ width: 160, height: 96 });
    const minimumApplied = applyGestureCompletion(minimumCompletion, scene);
    expect(minimumApplied.ok).toBe(true);

    const maximumScene: SpatialGestureScene = {
      ...scene,
      objects: [
        {
          ...scene.objects[0]!,
          width: 1_000,
          height: 800,
          rotation: 0,
        },
      ],
    };
    const maximumBase = transforming(maximumScene);
    const maximumPreview = step(
      maximumBase.state,
      bimanual({ x: 0, y: 0 }, { x: 1, y: 1 }, 1_340),
      maximumScene,
    );
    const maximumRelease = step(
      maximumPreview.state,
      point(0.3, 0.4, 1_360),
      maximumScene,
    );
    const maximumCompletion = maximumRelease.effects.find(
      (effect) => effect.type === "object.complete_transform",
    );
    if (!maximumCompletion || maximumCompletion.type !== "object.complete_transform")
      throw new Error("expected maximum transform completion");
    expect(maximumCompletion.transform).toMatchObject({ width: 1_750, height: 1_400 });
    const maximumApplied = applyGestureCompletion(maximumCompletion, maximumScene);
    expect(maximumApplied.ok).toBe(true);

    const rotatedScene: SpatialGestureScene = {
      ...scene,
      objects: [{ ...scene.objects[0]!, rotation: 170 }],
    };
    const rotatedBase = transforming(rotatedScene);
    const rotatedPreview = step(
      rotatedBase.state,
      bimanual({ x: 0.3, y: 0.3 }, { x: 0.6, y: 0.5 }, 1_340),
      rotatedScene,
    );
    const rotatedRelease = step(
      rotatedPreview.state,
      point(0.3, 0.3, 1_360),
      rotatedScene,
    );
    const rotatedCompletion = rotatedRelease.effects.find(
      (effect) => effect.type === "object.complete_transform",
    );
    if (!rotatedCompletion || rotatedCompletion.type !== "object.complete_transform")
      throw new Error("expected rotated transform completion");
    expect(rotatedCompletion.transform.rotation).toBeCloseTo(-168.2, 1);
    const rotatedApplied = applyGestureCompletion(rotatedCompletion, rotatedScene);
    expect(rotatedApplied.ok).toBe(true);

    const bottomHeld = held(scene, 0.25, 0.35, 2_000);
    const bottomEntered = step(bottomHeld.state, pinch(0.25, 0.94, 2_200));
    const bottomDwelled = step(bottomEntered.state, pinch(0.25, 0.94, 2_320));
    const bottomVisible = step(
      bottomDwelled.state,
      pinch(0.25, 0.94, 2_330, { edgePreviewVisible: true }),
    );
    const bottomRelease = step(bottomVisible.state, point(0.25, 0.94, 2_340));
    const minimizeCompletion = bottomRelease.effects.find(
      (effect) =>
        effect.type === "object.complete_edge_action" &&
        effect.action === "minimize",
    );
    if (!minimizeCompletion || minimizeCompletion.type !== "object.complete_edge_action")
      throw new Error("expected minimize completion");
    const minimizeApplied = applyGestureCompletion(minimizeCompletion, scene);
    expect(minimizeApplied.ok).toBe(true);

    const maximizeScene: SpatialGestureScene = {
      ...scene,
      bounds: { left: 0, top: 0, width: 3_000, height: 2_000 },
      viewport: { x: 250, y: -100, scale: 0.5 },
      objects: [{ ...scene.objects[0]!, x: 900, y: 1_500 }],
    };
    const topHeld = held(maximizeScene);
    const topEntered = step(
      topHeld.state,
      pinch(0.25, 0.02, 3_200),
      maximizeScene,
    );
    const topDwelled = step(
      topEntered.state,
      pinch(0.25, 0.02, 3_320),
      maximizeScene,
    );
    const topVisible = step(
      topDwelled.state,
      pinch(0.25, 0.02, 3_330, { edgePreviewVisible: true }),
      maximizeScene,
    );
    const topRelease = step(
      topVisible.state,
      point(0.25, 0.02, 3_340),
      maximizeScene,
    );
    const maximizeCompletion = topRelease.effects.find(
      (effect) =>
        effect.type === "object.complete_edge_action" &&
        effect.action === "maximize",
    );
    if (!maximizeCompletion || maximizeCompletion.type !== "object.complete_edge_action")
      throw new Error("expected maximize completion");
    expect(maximizeCompletion.transform).toEqual({
      x: -500,
      y: 200,
      width: 2_000,
      height: 1_400,
      rotation: 0,
    });
    const maximizeApplied = applyGestureCompletion(maximizeCompletion, maximizeScene);
    expect(maximizeApplied.ok).toBe(true);
  });

  it("keeps a two-hand transform in asymmetric loss grace and commits exactly once on intentional release", () => {
    const upgraded = transforming();
    const transformed = step(
      upgraded.state,
      bimanual({ x: 0.3, y: 0.4 }, { x: 0.7, y: 0.5 }, 1_340),
    );
    const dropout = step(
      transformed.state,
      pinch(0.3, 0.4, 1_390),
    );
    expect(dropout.state.phase).toBe("lost_grace");
    expect(dropout.effects).not.toContainEqual(
      expect.objectContaining({ type: "object.complete_transform" }),
    );

    const resumed = step(
      dropout.state,
      bimanual({ x: 0.3, y: 0.4 }, { x: 0.7, y: 0.5 }, 1_450),
    );
    expect(resumed.state.phase).toBe("transforming_two");
    expect(resumed.effects).not.toContainEqual(
      expect.objectContaining({ type: "object.complete_transform" }),
    );

    const released = step(resumed.state, point(0.3, 0.4, 1_480));
    expect(released.effects.filter((effect) => effect.type === "object.complete_transform"))
      .toHaveLength(1);
    const after = step(released.state, point(0.31, 0.41, 1_500));
    expect(after.effects).not.toContainEqual(
      expect.objectContaining({ type: "object.complete_transform" }),
    );
  });

  it("commits the last trusted moved transform once on Task 2 terminal safe release", () => {
    const acquired = held();
    const moved = step(acquired.state, pinch(0.3, 0.4, 1_150));
    const lost = step(moved.state, {
      mode: "idle",
      timestamp: 1_180,
      reason: "loss",
    });
    const terminalRelease = step(lost.state, {
      mode: "idle",
      timestamp: 1_400,
      reason: "release",
    });

    expect(terminalRelease.effects).toContainEqual({
      type: "object.complete_transform",
      objectId: "note-a",
      transform: { x: 250, y: 180, width: 200, height: 120, rotation: 10 },
    });
    expect(terminalRelease.effects).not.toContainEqual(
      expect.objectContaining({ type: "object.complete_edge_action" }),
    );
    expect(terminalRelease.state.phase).toBe("idle");

    const duplicate = step(terminalRelease.state, {
      mode: "idle",
      timestamp: 1_420,
      reason: "release",
    });
    expect(duplicate.effects).not.toContainEqual(
      expect.objectContaining({ type: "object.complete_transform" }),
    );
  });

  it("commits the last trusted moved transform once when loss grace expires", () => {
    const acquired = held();
    const moved = step(acquired.state, pinch(0.3, 0.4, 1_150));
    const lost = step(moved.state, {
      mode: "idle",
      timestamp: 1_180,
      reason: "loss",
    });
    const expired = step(lost.state, {
      mode: "idle",
      timestamp: 1_481,
      reason: "loss",
    });

    expect(expired.effects).toContainEqual({
      type: "object.complete_transform",
      objectId: "note-a",
      transform: { x: 250, y: 180, width: 200, height: 120, rotation: 10 },
    });
    expect(expired.effects).not.toContainEqual(
      expect.objectContaining({ type: "object.complete_edge_action" }),
    );
    expect(expired.state.phase).toBe("idle");

    const duplicate = step(expired.state, {
      mode: "idle",
      timestamp: 1_500,
      reason: "release",
    });
    expect(duplicate.effects).not.toContainEqual(
      expect.objectContaining({ type: "object.complete_transform" }),
    );
  });

  it("separates slow top maximize, slow bottom minimize, and fast side discard", () => {
    const topHeld = held();
    const topEntered = step(topHeld.state, pinch(0.25, 0.08, 1_200));
    const topDwelled = step(topEntered.state, pinch(0.25, 0.08, 1_320));
    const topVisible = step(
      topDwelled.state,
      pinch(0.25, 0.08, 1_330, { edgePreviewVisible: true }),
    );
    const topRelease = step(topVisible.state, point(0.25, 0.08, 1_340));
    expect(topRelease.effects).toContainEqual(
      expect.objectContaining({
        type: "object.complete_edge_action",
        action: "maximize",
        edge: "top",
      }),
    );

    const bottomHeld = held(scene, 0.25, 0.35, 2_000);
    const bottomEntered = step(bottomHeld.state, pinch(0.25, 0.94, 2_200));
    const bottomDwelled = step(bottomEntered.state, pinch(0.25, 0.94, 2_320));
    const bottomVisible = step(
      bottomDwelled.state,
      pinch(0.25, 0.94, 2_330, { edgePreviewVisible: true }),
    );
    const bottomRelease = step(bottomVisible.state, point(0.25, 0.94, 2_340));
    expect(bottomRelease.effects).toContainEqual({
      type: "object.complete_edge_action",
      objectId: "note-a",
      action: "minimize",
      edge: "bottom",
    });

    const sideArmed = beginLeftThrow();
    const sideVisible = acknowledgeEdge(sideArmed.state);
    const sideRelease = step(sideVisible.state, point(0.04, 0.4, 1_320));
    expect(sideRelease.effects).toContainEqual({
      type: "object.complete_edge_action",
      objectId: "note-a",
      action: "discard",
      edge: "left",
    });
  });

  it.each([
    ["zone", () => beginLeftThrow({ zoneX: 0.065 })],
    ["velocity", () => beginLeftThrow({ firstX: 0.13 })],
    ["minimum time window", () => beginLeftThrow({ firstSampleAt: 1_241, finalAt: 1_300 })],
    ["maximum time window", () => beginLeftThrow({ firstSampleAt: 937, finalAt: 1_300 })],
    ["direction cosine", () => beginLeftThrow({ firstX: 0.15, firstY: 0.1, finalY: 0.5 })],
    ["confidence history", () => beginLeftThrow({ middleConfidence: 0.79 })],
  ])("refuses a side throw when its %s gate fails", (_gate, run) => {
    const valid = beginLeftThrow();
    expect(valid.effects).toContainEqual(
      expect.objectContaining({ type: "object.preview_edge_action", armed: true }),
    );
    const result = run();
    expect(result.effects).not.toContainEqual(
      expect.objectContaining({ type: "object.preview_edge_action", armed: true }),
    );
    const released = step(result.state, point(0.04, 0.4, 1_320));
    expect(released.effects).not.toContainEqual(
      expect.objectContaining({
        type: "object.complete_edge_action",
        action: "discard",
      }),
    );
  });

  it.each([12, 15, 18, 24, 30])(
    "recognizes a safe outward throw at an irregular %i fps detector cadence",
    (framesPerSecond) => {
      const { final, finalAt } = beginLeftThrowAtFrameRate(framesPerSecond);
      expect(final.effects).toContainEqual(
        expect.objectContaining({
          type: "object.preview_edge_action",
          action: "discard",
          edge: "left",
          armed: true,
        }),
      );
      const visible = acknowledgeEdge(final.state, finalAt + 10);
      const released = step(visible.state, point(0.04, 0.4, finalAt + 20));
      expect(released.effects).toContainEqual({
        type: "object.complete_edge_action",
        objectId: "note-a",
        action: "discard",
        edge: "left",
      });
    },
  );

  it("requires visible preview, release within 120 ms, and a tracked release", () => {
    expect(beginLeftThrow({ middleConfidence: 0.8 }).effects).toContainEqual(
      expect.objectContaining({
        type: "object.preview_edge_action",
        action: "discard",
        armed: true,
      }),
    );
    expect(
      beginLeftThrow({ firstX: 0.15, firstY: 0.2968, finalY: 0.4 }).effects,
    ).toContainEqual(
      expect.objectContaining({
        type: "object.preview_edge_action",
        action: "discard",
        armed: true,
      }),
    );
    const validVisible = acknowledgeEdge(beginLeftThrow().state);
    const validRelease = step(validVisible.state, point(0.04, 0.4, 1_320));
    expect(validRelease.effects).toContainEqual(
      expect.objectContaining({
        type: "object.complete_edge_action",
        action: "discard",
      }),
    );

    const armed = beginLeftThrow();
    const withoutPreview = step(armed.state, point(0.04, 0.4, 1_320));
    expect(withoutPreview.effects).not.toContainEqual(
      expect.objectContaining({ type: "object.complete_edge_action" }),
    );

    const visible = acknowledgeEdge(beginLeftThrow().state);
    const late = step(visible.state, point(0.04, 0.4, 1_431));
    expect(late.effects).not.toContainEqual(
      expect.objectContaining({ type: "object.complete_edge_action" }),
    );

    const visibleAgain = acknowledgeEdge(beginLeftThrow().state);
    const lost = step(
      visibleAgain.state,
      { mode: "idle", timestamp: 1_320, reason: "loss" },
    );
    expect(lost.effects).not.toContainEqual(
      expect.objectContaining({ type: "object.complete_edge_action" }),
    );
  });

  it.each([
    [
      "predicted",
      pinch(0.04, 0.4, 1_315, {
        reliability: reliability("hand-a", { real: false, predicted: true }),
      }),
    ],
    [
      "low confidence",
      pinch(0.04, 0.4, 1_315, {
        reliability: reliability("hand-a", { confidence: 0.79 }),
      }),
    ],
    ["loss", { mode: "idle", timestamp: 1_315, reason: "loss" } as const],
  ])("cancels an armed edge action on %s evidence", (_kind, unsafeInput) => {
    const visible = acknowledgeEdge(beginLeftThrow().state);
    const cancelled = step(visible.state, unsafeInput);
    expect(cancelled.state.phase).toBe("lost_grace");
    expect(cancelled.effects).not.toContainEqual(
      expect.objectContaining({ type: "object.complete_edge_action" }),
    );
    const released = step(cancelled.state, point(0.04, 0.4, 1_330));
    expect(released.effects).not.toContainEqual(
      expect.objectContaining({ type: "object.complete_edge_action" }),
    );
  });

  it("lets open palm pan only on blank canvas with no drawing, held object, transform, or edge owner", () => {
    const blank = { ...scene, objects: [] };
    const panned = step(
      createInitialSpatialGestureState(),
      palm(0.8, 0.7, 1_000),
      blank,
    );
    expect(panned.state.phase).toBe("panning");
    expect(panned.effects).toContainEqual({
      type: "viewport.pan_by",
      deltaX: 0,
      deltaY: 0,
    });

    const drawingStarted = step(
      createInitialSpatialGestureState(),
      point(0.8, 0.7, 1_000),
      blank,
      drawing,
    );
    const drawingPalm = step(drawingStarted.state, palm(0.8, 0.7, 1_020), blank, drawing);
    expect(drawingPalm.effects).not.toContainEqual(
      expect.objectContaining({ type: "viewport.pan_by" }),
    );

    const heldPalm = step(held().state, palm(0.8, 0.7, 1_200));
    expect(heldPalm.effects).not.toContainEqual(
      expect.objectContaining({ type: "viewport.pan_by" }),
    );
    const transformPalm = step(transforming().state, palm(0.8, 0.7, 1_350));
    expect(transformPalm.effects).not.toContainEqual(
      expect.objectContaining({ type: "viewport.pan_by" }),
    );
    const edgePalm = step(
      acknowledgeEdge(beginLeftThrow().state).state,
      palm(0.04, 0.4, 1_320),
    );
    expect(edgePalm.effects).not.toContainEqual(
      expect.objectContaining({ type: "viewport.pan_by" }),
    );
  });

  it("maps a validated discard to the canonical soft-discard command and Undo restores exact state", () => {
    const visible = acknowledgeEdge(beginLeftThrow().state);
    const released = step(visible.state, point(0.04, 0.4, 1_320));
    const completion = released.effects.find(
      (effect) =>
        effect.type === "object.complete_edge_action" &&
        effect.action === "discard",
    );
    if (!completion || completion.type !== "object.complete_edge_action")
      throw new Error("expected validated discard completion");
    expect(spatialGestureCompletionToCommand(completion)).toEqual({
      type: "object.discard",
      objectId: "note-a",
    });

    const original = {
      id: "note-a",
      roomId: "room-demo",
      type: "note" as const,
      title: "Nested thought",
      x: 200,
      y: 150,
      width: 200,
      height: 120,
      zIndex: 17,
      payload: { text: "Keep this", tone: "coral" as const },
      minimized: false,
      pinned: false,
      createdBy: "participant-host",
      createdAt: "2026-08-29T12:00:00.000Z",
      updatedAt: "2026-08-29T12:00:00.000Z",
      deletedAt: null,
      version: 7,
      metadata: { provenance: "test" },
      rotation: 10,
      parentId: "frame-1",
    };
    const canvas: CanvasState = {
      roomId: "room-demo",
      revision: 7,
      objects: { "note-a": original },
      receipts: [],
      undoneReceiptIds: [],
      redoReceiptIds: [],
    };
    const runtime: CommandRuntime = { createId: (prefix) => `${prefix}-fixed` };
    const envelope = (
      revision: number,
      command: CanvasCommandEnvelope["command"],
    ): CanvasCommandEnvelope => ({
      id: `command-${revision}`,
      roomId: "room-demo",
      baseRevision: revision,
      issuedAt: `2026-08-29T12:00:0${revision - 7}.000Z`,
      actor: { id: "participant-host", displayName: "Danny", type: "human" },
      source: "gesture",
      command,
    });

    const discarded = applyCanvasCommand(
      canvas,
      envelope(7, spatialGestureCompletionToCommand(completion)),
      runtime,
    );
    expect(discarded.ok).toBe(true);
    if (!discarded.ok) throw new Error("discard should succeed");
    expect(discarded.receipt.action).toBe("discard");
    expect(discarded.state.objects["note-a"]?.deletedAt).not.toBeNull();

    const undone = applyCanvasCommand(
      discarded.state,
      envelope(8, { type: "history.undo" }),
      runtime,
    );
    expect(undone.ok).toBe(true);
    if (!undone.ok) throw new Error("undo should succeed");
    expect(undone.state.objects["note-a"]).toEqual(original);
    expect(undone.state.objects["note-a"]).toMatchObject({
      x: 200,
      y: 150,
      zIndex: 17,
      parentId: "frame-1",
      deletedAt: null,
      version: 7,
    });
    expect(undone.state.receipts.map((receipt) => receipt.action)).toEqual([
      "discard",
      "undo",
    ]);
  });
});
