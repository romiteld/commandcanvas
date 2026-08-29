import { describe, expect, it } from "vitest";

import type { HandTrackingObservation } from "@/lib/gesture/hand-tracking-controller";
import {
  createInitialStrokeSampleState,
  sampleTrackedStrokePoint,
  spatialInputFromHandObservation,
} from "@/lib/gesture/spatial-room-input";

describe("spatial room input adapter", () => {
  it("uses landmark 8 for targeting and palm geometry only for held motion", () => {
    const observation: HandTrackingObservation = {
      mode: "pinch",
      pointer: { x: 0.9, y: 0.8 },
      confidence: 0.97,
      trackId: "track-a",
      prediction: { predicted: false },
      trackingState: "tracked",
      measurements: {
        indexTip: { x: 0.21, y: 0.31 },
        thumbTip: { x: 0.24, y: 0.34 },
        pinchMidpoint: { x: 0.225, y: 0.325 },
        palmMcpCentroid: { x: 0.42, y: 0.52 },
        pinchDistance: 0.04,
        palmScale: 0.2,
        pinchRatio: 0.2,
        confidence: 0.97,
        indexTipConfidence: 0.96,
        thumbTipConfidence: 0.95,
      },
      timestamp: 1_000,
    };

    expect(spatialInputFromHandObservation(observation, true)).toEqual({
      mode: "pinch",
      pointer: { x: 0.21, y: 0.31 },
      motionPointer: { x: 0.42, y: 0.52 },
      timestamp: 1_000,
      reliability: {
        trackId: "track-a",
        confidence: 0.95,
        real: true,
        predicted: false,
        trackingState: "tracked",
      },
      edgePreviewVisible: true,
    });
  });

  it("keeps an open palm as pen-up and carries loss provenance", () => {
    const open: HandTrackingObservation = {
      mode: "open_palm",
      pointer: { x: 0.4, y: 0.5 },
      confidence: 0.93,
      trackId: "track-open",
      prediction: { predicted: false },
      trackingState: "tracked",
      timestamp: 2_000,
    };
    expect(spatialInputFromHandObservation(open, false)).toMatchObject({
      mode: "open_palm",
      pointer: { x: 0.4, y: 0.5 },
      reliability: { trackId: "track-open", real: true },
    });
    expect(
      spatialInputFromHandObservation(
        { mode: "idle", timestamp: 2_016, trackingState: "lost" },
        false,
      ),
    ).toEqual({ mode: "idle", reason: "loss", timestamp: 2_016 });
  });

  it("maps two independent tracked hands without collapsing their identities", () => {
    const observation: HandTrackingObservation = {
      mode: "bimanual_pinch",
      hands: [
        {
          handedness: "left",
          pointer: { x: 0.2, y: 0.4 },
          confidence: 0.92,
          trackId: "track-1",
          prediction: { predicted: false },
          trackingState: "tracked",
        },
        {
          handedness: "right",
          pointer: { x: 0.8, y: 0.4 },
          confidence: 0.94,
          trackId: "track-2",
          prediction: { predicted: false },
          trackingState: "tracked",
        },
      ],
      center: { x: 0.5, y: 0.4 },
      span: 0.6,
      timestamp: 3_000,
    };

    expect(spatialInputFromHandObservation(observation, false)).toMatchObject({
      mode: "bimanual_pinch",
      hands: [
        { trackId: "track-1", pointer: { x: 0.2, y: 0.4 } },
        { trackId: "track-2", pointer: { x: 0.8, y: 0.4 } },
      ],
    });
  });

  it("samples ink at 1.75 CSS pixels or 12 ms and rejects duplicate jitter", () => {
    const initial = createInitialStrokeSampleState();
    const first = sampleTrackedStrokePoint(initial, {
      pointer: { x: 0.2, y: 0.3 },
      timestamp: 1_000,
      canvasSize: { width: 1_000, height: 500 },
    });
    expect(first.accepted).toBe(true);

    const jitter = sampleTrackedStrokePoint(first.state, {
      pointer: { x: 0.2005, y: 0.3005 },
      timestamp: 1_006,
      canvasSize: { width: 1_000, height: 500 },
    });
    expect(jitter.accepted).toBe(false);

    const distance = sampleTrackedStrokePoint(jitter.state, {
      pointer: { x: 0.202, y: 0.3 },
      timestamp: 1_007,
      canvasSize: { width: 1_000, height: 500 },
    });
    expect(distance.accepted).toBe(true);

    const elapsed = sampleTrackedStrokePoint(distance.state, {
      pointer: { x: 0.2022, y: 0.3002 },
      timestamp: 1_019,
      canvasSize: { width: 1_000, height: 500 },
    });
    expect(elapsed.accepted).toBe(true);
  });
});
