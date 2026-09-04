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
        type: "viewport.set",
        viewport: { x: 0, y: 0, scale: 1 },
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
        type: "viewport.set",
        viewport: { x: -400, y: -100, scale: 1.5 },
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
          strokeReceipts: [
            {
              strokeId: "stroke-hand-1",
              handTrackId: "hand-a",
              penDownAt: 1000,
              penUpAt: 1100,
              pointCount: 2,
              measuredPointCount: 2,
              predictedPointCount: 0,
              interpolatedPointCount: 0,
              longGapBridgeCount: 0,
              terminationReason: "gesture-release",
            },
            {
              strokeId: "stroke-hand-2",
              handTrackId: "hand-a",
              penDownAt: 1200,
              penUpAt: 1300,
              pointCount: 2,
              measuredPointCount: 2,
              predictedPointCount: 0,
              interpolatedPointCount: 0,
              longGapBridgeCount: 0,
              terminationReason: "draw-mode-exit",
            },
          ],
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
          strokeReceipts: [
            {
              strokeId: "stroke-hand-1",
              handTrackId: "hand-a",
              penDownAt: 1000,
              penUpAt: 1100,
              pointCount: 2,
              measuredPointCount: 2,
              predictedPointCount: 0,
              interpolatedPointCount: 0,
              longGapBridgeCount: 0,
              terminationReason: "gesture-release",
            },
            {
              strokeId: "stroke-hand-2",
              handTrackId: "hand-a",
              penDownAt: 1200,
              penUpAt: 1300,
              pointCount: 2,
              measuredPointCount: 2,
              predictedPointCount: 0,
              interpolatedPointCount: 0,
              longGapBridgeCount: 0,
              terminationReason: "draw-mode-exit",
            },
          ],
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

  it("converts world-space sample provenance to the aligned local stroke points", () => {
    const command = createGestureSketchCommand(
      [
        [
          { x: 90, y: 120 },
          { x: 150, y: 150 },
        ],
      ],
      {
        objectId: "sketch-provenance",
        strokeIds: ["stroke-provenance"],
        strokeReceipts: [
          {
            strokeId: "stroke-provenance",
            handTrackId: "hand-a",
            penDownAt: 1_000,
            penUpAt: 1_032,
            pointCount: 2,
            measuredPointCount: 2,
            predictedPointCount: 0,
            interpolatedPointCount: 0,
            longGapBridgeCount: 0,
            terminationReason: "gesture-release",
            sampleProvenanceVersion: 1,
            samples: [
              {
                strokeId: "stroke-provenance",
                handTrackId: "hand-a",
                timestampMs: 1_000,
                sampleKind: "measured",
                rawIndexTip: { x: 0.2, y: 0.3 },
                filteredIndexTip: { x: 0.21, y: 0.31 },
                renderedPoint: { x: 90, y: 120 },
                confidence: 0.97,
              },
              {
                strokeId: "stroke-provenance",
                handTrackId: "hand-a",
                timestampMs: 1_016,
                sampleKind: "measured",
                rawIndexTip: { x: 0.3, y: 0.4 },
                filteredIndexTip: { x: 0.31, y: 0.41 },
                renderedPoint: { x: 150, y: 150 },
                confidence: 0.96,
              },
            ],
          },
        ],
        zIndex: 7,
      },
    );

    expect(command).toMatchObject({
      type: "object.create",
      object: {
        payload: {
          strokeReceipts: [
            {
              sampleProvenanceVersion: 1,
              samples: [
                { renderedPoint: { x: 16, y: 16 } },
                { renderedPoint: { x: 76, y: 46 } },
              ],
            },
          ],
          strokes: [
            {
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

  it("refuses versioned sample provenance that is not aligned to its world stroke", () => {
    expect(() =>
      createGestureSketchCommand(
        [
          [
            { x: 90, y: 120 },
            { x: 150, y: 150 },
          ],
        ],
        {
          objectId: "sketch-misaligned",
          strokeIds: ["stroke-misaligned"],
          strokeReceipts: [
            {
              strokeId: "stroke-misaligned",
              handTrackId: "hand-a",
              penDownAt: 1_000,
              penUpAt: 1_032,
              pointCount: 2,
              measuredPointCount: 2,
              predictedPointCount: 0,
              interpolatedPointCount: 0,
              longGapBridgeCount: 0,
              terminationReason: "gesture-release",
              sampleProvenanceVersion: 1,
              samples: [
                {
                  strokeId: "stroke-misaligned",
                  handTrackId: "hand-a",
                  timestampMs: 1_000,
                  sampleKind: "measured",
                  rawIndexTip: { x: 0.2, y: 0.3 },
                  filteredIndexTip: { x: 0.21, y: 0.31 },
                  renderedPoint: { x: 90, y: 120 },
                  confidence: 0.97,
                },
                {
                  strokeId: "stroke-misaligned",
                  handTrackId: "hand-a",
                  timestampMs: 1_016,
                  sampleKind: "measured",
                  rawIndexTip: { x: 0.3, y: 0.4 },
                  filteredIndexTip: { x: 0.31, y: 0.41 },
                  renderedPoint: { x: 149, y: 150 },
                  confidence: 0.96,
                },
              ],
            },
          ],
          zIndex: 7,
        },
      ),
    ).toThrow(RangeError);
  });
});
