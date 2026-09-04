import { describe, expect, it } from "vitest";

import {
  createInitialSpatialGestureState,
  reduceSpatialGesture,
  type SpatialGestureInput,
  type SpatialGestureScene,
  type SpatialGestureState,
} from "@/lib/gesture/spatial-gesture";

const scene: SpatialGestureScene = {
  bounds: { left: 0, top: 0, width: 1_000, height: 600 },
  viewport: { x: 0, y: 0, scale: 1 },
  objects: [],
};
const drawing = { drawingEnabled: true, manipulationEnabled: false };

function drawInput(
  timestamp: number,
  penDown: boolean,
  transition: "none" | "engaged" | "released" = "none",
  trackId = "hand-a",
  x = timestamp / 10_000,
): SpatialGestureInput {
  return {
    mode: "point",
    pointer: { x, y: 0.4 },
    timestamp,
    reliability: {
      trackId,
      confidence: 0.96,
      real: true,
      predicted: false,
      trackingState: "tracked",
    },
    drawing: {
      trackId,
      penDown,
      transition,
      normalizedDistance: penDown ? 0.2 : 0.8,
      confidence: 0.96,
      predicted: false,
      sampleKind: "measured",
      rawIndexTip: {
        x: Number(Math.min(1, x + 0.01).toFixed(6)),
        y: 0.41,
      },
      filteredIndexTip: { x, y: 0.4 },
    },
  };
}

function step(state: SpatialGestureState, input: SpatialGestureInput) {
  return reduceSpatialGesture(state, input, scene, drawing);
}

describe("spatial drawing state and stroke ownership", () => {
  it("keeps Draw mode in HOVER with zero ink until the clutch engages", () => {
    const hover = step(
      createInitialSpatialGestureState(),
      drawInput(1_000, false),
    );

    expect(hover.state.phase).toBe("hover");
    expect(hover.state.stroke).toEqual([]);
    expect(hover.effects).toEqual([]);
  });

  it("allocates a new immutable stroke ID on each confirmed pen-down", () => {
    const first = step(
      createInitialSpatialGestureState(),
      drawInput(1_000, true, "engaged"),
    );
    const continued = step(
      first.state,
      drawInput(1_016, true, "none", "hand-a", 0.2),
    );
    const released = step(continued.state, drawInput(1_032, false, "released"));
    const hover = step(released.state, drawInput(1_048, false));
    const second = step(
      hover.state,
      drawInput(1_064, true, "engaged", "hand-a", 0.8),
    );

    expect(first.state.drawing?.strokeId).toMatch(/^gesture-stroke-/);
    expect(first.state.drawing?.activeDrawingHandId).toBe("hand-a");
    expect(released.effects).toContainEqual(
      expect.objectContaining({
        type: "stroke.commit",
        strokeId: first.state.drawing?.strokeId,
        terminationReason: "gesture-release",
      }),
    );
    expect(second.state.drawing?.strokeId).not.toBe(
      first.state.drawing?.strokeId,
    );
  });

  it("commits one aligned measured provenance sample per durable point", () => {
    const first = step(
      createInitialSpatialGestureState(),
      drawInput(1_000, true, "engaged", "hand-a", 0.1),
    );
    const continued = step(
      first.state,
      drawInput(1_016, true, "none", "hand-a", 0.2),
    );
    const released = step(
      continued.state,
      drawInput(1_032, false, "released", "hand-a", 0.2),
    );
    const commit = released.effects.find(
      (effect) => effect.type === "stroke.commit",
    );

    expect(first.state.drawing?.samples).toHaveLength(1);
    expect(continued.state.drawing?.samples).toHaveLength(2);
    expect(commit).toMatchObject({
      sampleProvenanceVersion: 1,
      pointCount: 2,
      measuredPointCount: 2,
      predictedPointCount: 0,
      interpolatedPointCount: 0,
      samples: [
        {
          handTrackId: "hand-a",
          timestampMs: 1_000,
          sampleKind: "measured",
          rawIndexTip: { x: 0.11, y: 0.41 },
          filteredIndexTip: { x: 0.1, y: 0.4 },
          renderedPoint: { x: 100, y: 240 },
          confidence: 0.96,
        },
        {
          handTrackId: "hand-a",
          timestampMs: 1_016,
          sampleKind: "measured",
          rawIndexTip: { x: 0.21, y: 0.41 },
          filteredIndexTip: { x: 0.2, y: 0.4 },
          renderedPoint: { x: 200, y: 240 },
          confidence: 0.96,
        },
      ],
    });
    if (!commit || commit.type !== "stroke.commit")
      throw new Error("expected a committed stroke");
    expect(commit.samples?.map((sample) => sample.renderedPoint)).toEqual(
      commit.points,
    );
    expect(commit.samples?.every((sample) => sample.sampleKind === "measured"))
      .toBe(true);
  });

  it("creates no bridge while the tracked finger repositions with pen up", () => {
    const first = step(
      createInitialSpatialGestureState(),
      drawInput(1_000, true, "engaged", "hand-a", 0.1),
    );
    const line = step(
      first.state,
      drawInput(1_016, true, "none", "hand-a", 0.2),
    );
    const released = step(
      line.state,
      drawInput(1_032, false, "released", "hand-a", 0.2),
    );
    const repositioned = step(
      released.state,
      drawInput(1_048, false, "none", "hand-a", 0.8),
    );
    const second = step(
      repositioned.state,
      drawInput(1_064, true, "engaged", "hand-a", 0.8),
    );

    expect(repositioned.effects).toEqual([]);
    expect(second.state.stroke).toHaveLength(1);
    expect(second.state.stroke[0]?.x).toBe(800);
  });

  it("terminates an active stroke when a second hand creates identity ambiguity", () => {
    const first = step(
      createInitialSpatialGestureState(),
      drawInput(1_000, true, "engaged", "hand-a", 0.1),
    );
    const line = step(
      first.state,
      drawInput(1_016, true, "none", "hand-a", 0.2),
    );
    const other = step(
      line.state,
      drawInput(1_032, true, "none", "hand-b", 0.8),
    );

    expect(other.state.drawing).toBeNull();
    expect(other.state.stroke).toEqual([]);
    expect(other.effects).toContainEqual(
      expect.objectContaining({
        type: "stroke.commit",
        handTrackId: "hand-a",
        terminationReason: "identity-loss",
        longGapBridgeCount: 0,
      }),
    );
  });

  it("does not append rejected clutch evidence to durable ink", () => {
    const first = step(
      createInitialSpatialGestureState(),
      drawInput(1_000, true, "engaged", "hand-a", 0.1),
    );
    const line = step(
      first.state,
      drawInput(1_016, true, "none", "hand-a", 0.2),
    );
    const rejected = drawInput(1_032, true, "none", "hand-a", 0.8);
    if (rejected.mode === "idle" || rejected.mode === "bimanual_pinch")
      throw new Error("fixture must be a single-hand input");

    const result = step(line.state, {
      ...rejected,
      drawing: {
        ...rejected.drawing!,
        confidence: 0.4,
        rejectedBecause: "low-confidence",
      },
    });

    expect(result.state.phase).toBe("temporary_loss");
    expect(result.state.stroke).toEqual(line.state.stroke);
    expect(result.effects).toEqual([]);
  });

  it("terminates a long tracking gap and never connects to reacquisition", () => {
    const first = step(
      createInitialSpatialGestureState(),
      drawInput(1_000, true, "engaged", "hand-a", 0.1),
    );
    const line = step(
      first.state,
      drawInput(1_016, true, "none", "hand-a", 0.2),
    );
    const loss = step(line.state, {
      mode: "idle",
      timestamp: 1_032,
      reason: "loss",
    });
    expect(loss.state.phase).toBe("temporary_loss");

    const reacquired = step(
      loss.state,
      drawInput(1_200, true, "none", "hand-a", 0.8),
    );
    expect(reacquired.effects).toContainEqual(
      expect.objectContaining({
        type: "stroke.commit",
        terminationReason: "tracking-timeout",
        longGapBridgeCount: 0,
      }),
    );
    expect(reacquired.state.phase).toBe("hover");
    expect(reacquired.state.stroke).toEqual([]);
    expect(line.state.stroke).toHaveLength(2);
  });

  it("terminates a long frame gap even when no idle observation arrived", () => {
    const first = step(
      createInitialSpatialGestureState(),
      drawInput(1_000, true, "engaged", "hand-a", 0.1),
    );
    const line = step(
      first.state,
      drawInput(1_016, true, "none", "hand-a", 0.2),
    );
    const delayed = step(
      line.state,
      drawInput(1_200, true, "none", "hand-a", 0.8),
    );

    expect(delayed.effects).toContainEqual(
      expect.objectContaining({
        type: "stroke.commit",
        terminationReason: "tracking-timeout",
        longGapBridgeCount: 0,
      }),
    );
    expect(delayed.state.drawing).toBeNull();
    expect(delayed.state.stroke).toEqual([]);
  });

  it("ignores duplicate and stale measured continuation timestamps", () => {
    const first = step(
      createInitialSpatialGestureState(),
      drawInput(1_000, true, "engaged", "hand-a", 0.1),
    );
    const line = step(
      first.state,
      drawInput(1_016, true, "none", "hand-a", 0.2),
    );
    const duplicate = step(
      line.state,
      drawInput(1_016, true, "none", "hand-a", 0.7),
    );
    const stale = step(
      duplicate.state,
      drawInput(1_008, true, "none", "hand-a", 0.8),
    );

    expect(duplicate.state).toEqual(line.state);
    expect(duplicate.effects).toEqual([]);
    expect(stale.state).toEqual(line.state);
    expect(stale.effects).toEqual([]);
  });

  it("ignores a stale release and emits one commit on the next ordered release", () => {
    const first = step(
      createInitialSpatialGestureState(),
      drawInput(1_000, true, "engaged", "hand-a", 0.1),
    );
    const line = step(
      first.state,
      drawInput(1_016, true, "none", "hand-a", 0.2),
    );
    const staleRelease = step(line.state, {
      mode: "open_palm",
      pointer: { x: 0.2, y: 0.4 },
      timestamp: 1_008,
    });
    const orderedRelease = step(staleRelease.state, {
      mode: "open_palm",
      pointer: { x: 0.2, y: 0.4 },
      timestamp: 1_032,
    });
    const repeatedRelease = step(orderedRelease.state, {
      mode: "open_palm",
      pointer: { x: 0.2, y: 0.4 },
      timestamp: 1_048,
    });

    expect(staleRelease.state).toEqual(line.state);
    expect(staleRelease.effects).toEqual([]);
    expect(
      orderedRelease.effects.filter(
        (effect) => effect.type === "stroke.commit",
      ),
    ).toHaveLength(1);
    expect(repeatedRelease.effects).not.toContainEqual(
      expect.objectContaining({ type: "stroke.commit" }),
    );
  });

  it("terminates rather than bridging an implausible short-gap jump", () => {
    const first = step(
      createInitialSpatialGestureState(),
      drawInput(1_000, true, "engaged", "hand-a", 0.1),
    );
    const line = step(
      first.state,
      drawInput(1_016, true, "none", "hand-a", 0.2),
    );
    const loss = step(line.state, {
      mode: "idle",
      timestamp: 1_032,
      reason: "loss",
    });
    const jumped = step(
      loss.state,
      drawInput(1_064, true, "none", "hand-a", 0.9),
    );

    expect(jumped.effects).toContainEqual(
      expect.objectContaining({
        type: "stroke.commit",
        terminationReason: "tracking-timeout",
        longGapBridgeCount: 0,
      }),
    );
    expect(jumped.state.drawing).toBeNull();
    expect(jumped.state.stroke).toEqual([]);
  });

  it("preserves a fast but bounded measured segment at high camera frame rates", () => {
    const first = step(
      createInitialSpatialGestureState(),
      drawInput(1_000, true, "engaged", "hand-a", 0.1),
    );
    const continued = step(
      first.state,
      drawInput(1_008, true, "none", "hand-a", 0.185),
    );

    expect(continued.effects).not.toContainEqual(
      expect.objectContaining({ type: "stroke.commit" }),
    );
    expect(continued.state.phase).toBe("drawing");
    expect(continued.state.stroke).toHaveLength(2);
  });

  it("terminates a long loss while frames remain missing", () => {
    const first = step(
      createInitialSpatialGestureState(),
      drawInput(1_000, true, "engaged", "hand-a", 0.1),
    );
    const line = step(
      first.state,
      drawInput(1_016, true, "none", "hand-a", 0.2),
    );
    const loss = step(line.state, {
      mode: "idle",
      timestamp: 1_032,
      reason: "loss",
    });
    const timedOut = step(loss.state, {
      mode: "idle",
      timestamp: 1_120,
      reason: "loss",
    });

    expect(timedOut.effects).toContainEqual(
      expect.objectContaining({
        type: "stroke.commit",
        terminationReason: "tracking-timeout",
        longGapBridgeCount: 0,
      }),
    );
    expect(timedOut.state.phase).toBe("hover");
    expect(timedOut.state.stroke).toEqual([]);
  });

  it("continues the same owned stroke after a short loss", () => {
    const first = step(
      createInitialSpatialGestureState(),
      drawInput(1_000, true, "engaged", "hand-a", 0.1),
    );
    const line = step(
      first.state,
      drawInput(1_016, true, "none", "hand-a", 0.2),
    );
    const loss = step(line.state, {
      mode: "idle",
      timestamp: 1_032,
      reason: "loss",
    });
    const resumed = step(
      loss.state,
      drawInput(1_064, true, "none", "hand-a", 0.3),
    );

    expect(resumed.effects).not.toContainEqual(
      expect.objectContaining({ type: "stroke.commit" }),
    );
    expect(resumed.state.drawing?.strokeId).toBe(line.state.drawing?.strokeId);
    expect(resumed.state.phase).toBe("drawing");
    expect(resumed.state.stroke).toHaveLength(3);
  });

  it("predicted observations cannot engage drawing", () => {
    const unsafe = drawInput(1_000, true, "engaged");
    if (unsafe.mode === "idle" || unsafe.mode === "bimanual_pinch")
      throw new Error("fixture must be a single-hand input");
    const result = step(createInitialSpatialGestureState(), {
      ...unsafe,
      drawing: { ...unsafe.drawing!, predicted: true, sampleKind: "predicted" },
    });

    expect(result.state.phase).toBe("hover");
    expect(result.effects).toEqual([]);
  });

  it("never appends predicted evidence to an active durable stroke", () => {
    const first = step(
      createInitialSpatialGestureState(),
      drawInput(1_000, true, "engaged", "hand-a", 0.1),
    );
    const line = step(
      first.state,
      drawInput(1_016, true, "none", "hand-a", 0.2),
    );
    const predicted = drawInput(1_032, true, "none", "hand-a", 0.3);
    if (predicted.mode === "idle" || predicted.mode === "bimanual_pinch")
      throw new Error("fixture must be a single-hand input");
    const loss = step(line.state, {
      ...predicted,
      drawing: {
        ...predicted.drawing!,
        predicted: true,
        sampleKind: "predicted",
      },
    });
    const released = step(loss.state, {
      mode: "open_palm",
      pointer: { x: 0.3, y: 0.4 },
      timestamp: 1_048,
    });
    const commit = released.effects.find(
      (effect) => effect.type === "stroke.commit",
    );

    expect(loss.state.stroke).toEqual(line.state.stroke);
    expect(loss.state.drawing?.samples).toEqual(line.state.drawing?.samples);
    expect(commit).toMatchObject({
      pointCount: 2,
      measuredPointCount: 2,
      predictedPointCount: 0,
      samples: [
        { sampleKind: "measured" },
        { sampleKind: "measured" },
      ],
    });
  });

  it("allocates collision-resistant IDs for independent strokes at one timestamp", () => {
    const first = step(
      createInitialSpatialGestureState(),
      drawInput(1_000, true, "engaged", "hand-a", 0.1),
    );
    const second = step(
      createInitialSpatialGestureState(),
      drawInput(1_000, true, "engaged", "hand-a", 0.1),
    );

    expect(first.state.drawing?.strokeId).not.toBe(
      second.state.drawing?.strokeId,
    );
  });
});
