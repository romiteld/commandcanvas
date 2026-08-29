import { describe, expect, it } from "vitest";

import {
  buildHandCalibration,
  createInitialHandReliabilityState,
  createInitialPinchVoteState,
  mapCalibratedPointer,
  reduceHandReliability,
  resolvePinchThresholds,
  voteCalibratedPinch,
} from "@/lib/gesture/hand-calibration";

describe("hand calibration", () => {
  it("accepts percentile reach and records its expanded comfortable camera bounds", () => {
    const result = buildHandCalibration({
      deviceKey: "camera-a",
      mirrorX: true,
      createdAt: 1_000,
      reachSamples: [
        { x: 0.2, y: 0.2 },
        { x: 0.21, y: 0.22 },
        { x: 0.35, y: 0.35 },
        { x: 0.65, y: 0.65 },
        { x: 0.79, y: 0.78 },
        { x: 0.8, y: 0.8 },
      ],
      closedPinchRatios: [0.2, 0.22, 0.25],
      openPinchRatios: [0.6, 0.65, 0.7],
    });

    expect(result).toEqual({
      accepted: true,
      profile: {
        deviceKey: "camera-a",
        cameraBounds: { x: 0.17275, y: 0.1755, width: 0.6545, height: 0.649 },
        safeCanvasInsetPx: 24,
        pinchClosedRatio: 0.247,
        pinchOpenRatio: 0.605,
        mirrorX: true,
        createdAt: 1_000,
      },
    });
  });

  it("refuses implausible reach while returning the documented fallback region", () => {
    const result = buildHandCalibration({
      deviceKey: "camera-a",
      mirrorX: false,
      createdAt: 2_000,
      reachSamples: [
        { x: 0.45, y: 0.45 },
        { x: 0.47, y: 0.48 },
        { x: 0.5, y: 0.5 },
        { x: 0.52, y: 0.52 },
        { x: 0.55, y: 0.55 },
      ],
      closedPinchRatios: [],
      openPinchRatios: [],
    });

    expect(result).toEqual({
      accepted: false,
      reason: "reach_too_small",
      profile: {
        deviceKey: "camera-a",
        cameraBounds: { x: 0.15, y: 0.12, width: 0.7, height: 0.76 },
        safeCanvasInsetPx: 24,
        pinchClosedRatio: 0.28,
        pinchOpenRatio: 0.68,
        mirrorX: false,
        createdAt: 2_000,
      },
    });
  });

  it("refuses a reach wider than the accepted camera span", () => {
    const result = buildHandCalibration({
      deviceKey: "camera-a",
      mirrorX: false,
      createdAt: 2_000,
      reachSamples: [
        { x: 0.01, y: 0.1 },
        { x: 0.01, y: 0.1 },
        { x: 0.01, y: 0.1 },
        { x: 0.99, y: 0.9 },
        { x: 0.99, y: 0.9 },
        { x: 0.99, y: 0.9 },
      ],
      closedPinchRatios: [0.2],
      openPinchRatios: [0.7],
    });

    expect(result).toMatchObject({
      accepted: false,
      reason: "reach_too_large",
      profile: { cameraBounds: { x: 0.15, y: 0.12, width: 0.7, height: 0.76 } },
    });
  });

  it.each([
    ["top-left", { x: 0.17, y: 0.17 }, { x: 24, y: 24 }],
    ["top", { x: 0.5, y: 0.17 }, { x: 500, y: 24 }],
    ["top-right", { x: 0.83, y: 0.17 }, { x: 976, y: 24 }],
    ["left", { x: 0.17, y: 0.5 }, { x: 24, y: 250 }],
    ["center", { x: 0.5, y: 0.5 }, { x: 500, y: 250 }],
    ["right", { x: 0.83, y: 0.5 }, { x: 976, y: 250 }],
    ["bottom-left", { x: 0.17, y: 0.83 }, { x: 24, y: 476 }],
    ["bottom", { x: 0.5, y: 0.83 }, { x: 500, y: 476 }],
    ["bottom-right", { x: 0.83, y: 0.83 }, { x: 976, y: 476 }],
  ])("maps the %s of comfortable reach over the safe canvas", (_region, point, expected) => {
    const calibration = buildHandCalibration({
      deviceKey: "camera-a",
      mirrorX: false,
      createdAt: 1_000,
      reachSamples: [
        { x: 0.2, y: 0.2 },
        { x: 0.2, y: 0.2 },
        { x: 0.2, y: 0.2 },
        { x: 0.8, y: 0.8 },
        { x: 0.8, y: 0.8 },
        { x: 0.8, y: 0.8 },
      ],
      closedPinchRatios: [0.2],
      openPinchRatios: [0.7],
    }).profile;

    expect(
      mapCalibratedPointer(
        calibration,
        point,
        { left: 0, top: 0, width: 1_000, height: 500 },
        "two_hand",
      ),
    ).toMatchObject({ point: expected, gain: 1 });
  });

  it("uses coarse gain while hovering and lowers it for precise interaction states", () => {
    const calibration = buildHandCalibration({
      deviceKey: "camera-a",
      mirrorX: false,
      createdAt: 1_000,
      reachSamples: [
        { x: 0.2, y: 0.2 },
        { x: 0.2, y: 0.2 },
        { x: 0.2, y: 0.2 },
        { x: 0.8, y: 0.8 },
        { x: 0.8, y: 0.8 },
        { x: 0.8, y: 0.8 },
      ],
      closedPinchRatios: [0.2],
      openPinchRatios: [0.7],
    }).profile;
    const canvas = { left: 0, top: 0, width: 1_000, height: 500 };
    const hover = mapCalibratedPointer(calibration, { x: 0.65, y: 0.5 }, canvas, "hover");
    const target = mapCalibratedPointer(calibration, { x: 0.65, y: 0.5 }, canvas, "target");
    const held = mapCalibratedPointer(calibration, { x: 0.65, y: 0.5 }, canvas, "held");
    const draw = mapCalibratedPointer(calibration, { x: 0.65, y: 0.5 }, canvas, "draw");
    const twoHand = mapCalibratedPointer(calibration, { x: 0.65, y: 0.5 }, canvas, "two_hand");

    expect([hover.gain, target.gain, held.gain, draw.gain, twoHand.gain]).toEqual([
      1.5, 1.25, 1.1, 1.1, 1,
    ]);
    expect(hover.point.x).toBeGreaterThan(target.point.x);
    expect(target.point.x).toBeGreaterThan(held.point.x);
    expect(held.point.x).toBeGreaterThan(twoHand.point.x);
    expect(draw.point.x).toBe(held.point.x);
  });
});

describe("calibrated pinch voting", () => {
  it("requires two of three recent confident frames to engage and release", () => {
    const thresholds = resolvePinchThresholds({
      pinchClosedRatio: 0.2,
      pinchOpenRatio: 0.7,
    });
    expect(thresholds).toEqual({ engage: 0.325, release: 0.5 });
    expect(resolvePinchThresholds(null)).toEqual({ engage: 0.38, release: 0.52 });

    const first = voteCalibratedPinch(
      createInitialPinchVoteState(),
      { timestamp: 1_000, confidence: 0.9, pinchRatio: 0.3 },
      thresholds,
    );
    expect(first.snapshot).toMatchObject({ pinched: false, candidate: "engage" });

    const engaged = voteCalibratedPinch(
      first.state,
      { timestamp: 1_040, confidence: 0.9, pinchRatio: 0.31 },
      thresholds,
    );
    expect(engaged.snapshot).toEqual({
      pinched: true,
      candidate: null,
      transition: "engaged",
    });

    const releaseCandidate = voteCalibratedPinch(
      engaged.state,
      { timestamp: 1_070, confidence: 0.9, pinchRatio: 0.55 },
      thresholds,
    );
    const released = voteCalibratedPinch(
      releaseCandidate.state,
      { timestamp: 1_095, confidence: 0.9, pinchRatio: 0.56 },
      thresholds,
    );
    expect(released.snapshot).toEqual({
      pinched: false,
      candidate: null,
      transition: "released",
    });
  });

  it("keeps the pinch latch through a short uncertain interval without voting it as release", () => {
    const thresholds = { engage: 0.38, release: 0.52 };
    const engaged = voteCalibratedPinch(
      voteCalibratedPinch(
        createInitialPinchVoteState(),
        { timestamp: 1_000, confidence: 0.9, pinchRatio: 0.3 },
        thresholds,
      ).state,
      { timestamp: 1_040, confidence: 0.9, pinchRatio: 0.3 },
      thresholds,
    );

    const uncertain = voteCalibratedPinch(
      engaged.state,
      { timestamp: 1_100, confidence: 0.2, pinchRatio: 0.8 },
      thresholds,
    );

    expect(uncertain.snapshot).toEqual({
      pinched: true,
      candidate: null,
      transition: null,
    });
    expect(uncertain.state.lastConfidentAt).toBe(1_040);
  });
});

describe("hand identity and loss reliability", () => {
  const thresholds = { engage: 0.38, release: 0.52 };

  it("keeps the active physical track when labels flip and a second hand enters", () => {
    const first = reduceHandReliability(
      createInitialHandReliabilityState(),
      {
        timestamp: 1_000,
        hands: [
          {
            trackId: "track-primary",
            handedness: "left",
            pointer: { x: 100, y: 140 },
            confidence: 0.91,
            predicted: false,
            pinchRatio: 0.3,
          },
        ],
      },
      thresholds,
    );
    const next = reduceHandReliability(
      first.state,
      {
        timestamp: 1_016,
        hands: [
          {
            trackId: "track-second",
            handedness: "left",
            pointer: { x: 160, y: 140 },
            confidence: 0.93,
            predicted: false,
            pinchRatio: 0.7,
          },
          {
            trackId: "track-primary",
            handedness: "right",
            pointer: { x: 760, y: 140 },
            confidence: 0.91,
            predicted: false,
            pinchRatio: 0.3,
          },
        ],
      },
      thresholds,
    );

    expect(next.snapshot.activeHand).toEqual({
      trackId: "track-primary",
      handedness: "right",
      confidence: 0.91,
      predicted: false,
      real: true,
      trackingState: "tracked",
      isActive: true,
      observedAt: 1_016,
      lastValidAt: 1_016,
      lossStartedAt: null,
    });
    expect(next.snapshot.hands).toEqual([
      {
        trackId: "track-second",
        handedness: "left",
        confidence: 0.93,
        predicted: false,
        real: true,
        trackingState: "tracked",
        isActive: false,
        observedAt: 1_016,
        lastValidAt: 1_016,
        lossStartedAt: null,
      },
      {
        trackId: "track-primary",
        handedness: "right",
        confidence: 0.91,
        predicted: false,
        real: true,
        trackingState: "tracked",
        isActive: true,
        observedAt: 1_016,
        lastValidAt: 1_016,
        lossStartedAt: null,
      },
    ]);
  });

  it("holds through uncertainty, exposes reacquire, and resumes only at the expected point", () => {
    const first = reduceHandReliability(
      createInitialHandReliabilityState(),
      {
        timestamp: 1_000,
        hands: [
          {
            trackId: "track-primary",
            handedness: "unknown",
            pointer: { x: 100, y: 140 },
            confidence: 0.9,
            predicted: false,
            pinchRatio: 0.3,
          },
        ],
      },
      thresholds,
    );
    const held = reduceHandReliability(
      first.state,
      {
        timestamp: 1_030,
        hands: [
          {
            trackId: "track-primary",
            handedness: "unknown",
            pointer: { x: 100, y: 140 },
            confidence: 0.9,
            predicted: false,
            pinchRatio: 0.3,
          },
        ],
      },
      thresholds,
    );
    expect(held.snapshot.pinch).toMatchObject({ pinched: true });

    const uncertain = reduceHandReliability(
      held.state,
      { timestamp: 1_120, hands: [] },
      thresholds,
    );
    expect(uncertain.snapshot).toMatchObject({
      trackingState: "uncertain",
      activeHandId: "track-primary",
      pinch: { pinched: true },
      lossStartedAt: 1_030,
    });

    const reacquire = reduceHandReliability(
      uncertain.state,
      { timestamp: 1_180, hands: [] },
      thresholds,
    );
    expect(reacquire.snapshot).toMatchObject({
      trackingState: "reacquire",
      activeHandId: "track-primary",
      pinch: { pinched: true },
      lossStartedAt: 1_030,
    });

    const resumed = reduceHandReliability(
      reacquire.state,
      {
        timestamp: 1_250,
        hands: [
          {
            trackId: "track-primary",
            handedness: "unknown",
            pointer: { x: 220, y: 140 },
            confidence: 0.9,
            predicted: false,
            pinchRatio: 0.3,
          },
        ],
      },
      thresholds,
    );
    expect(resumed.snapshot).toMatchObject({
      trackingState: "tracked",
      activeHandId: "track-primary",
      release: null,
    });
  });

  it("safely releases at the last valid point after loss and never emits an edge action", () => {
    const tracked = reduceHandReliability(
      createInitialHandReliabilityState(),
      {
        timestamp: 1_000,
        hands: [
          {
            trackId: "track-primary",
            handedness: "unknown",
            pointer: { x: 5, y: 250 },
            confidence: 0.9,
            predicted: false,
            pinchRatio: 0.3,
          },
        ],
      },
      thresholds,
    );
    const released = reduceHandReliability(
      tracked.state,
      { timestamp: 1_301, hands: [] },
      thresholds,
    );

    expect(released.snapshot).toEqual(
      expect.objectContaining({
        trackingState: "released",
        activeHandId: null,
        release: {
          point: { x: 5, y: 250 },
          lastValidAt: 1_000,
          releasedAt: 1_301,
        },
        edgeAction: null,
      }),
    );
  });

  it("safely releases instead of handing control to a far reacquired track", () => {
    const tracked = reduceHandReliability(
      createInitialHandReliabilityState(),
      {
        timestamp: 1_000,
        hands: [
          {
            trackId: "track-primary",
            handedness: "unknown",
            pointer: { x: 100, y: 100 },
            confidence: 0.9,
            predicted: false,
            pinchRatio: 0.3,
          },
        ],
      },
      thresholds,
    );
    const missing = reduceHandReliability(
      tracked.state,
      { timestamp: 1_150, hands: [] },
      thresholds,
    );
    const released = reduceHandReliability(
      missing.state,
      {
        timestamp: 1_220,
        hands: [
          {
            trackId: "track-primary",
            handedness: "unknown",
            pointer: { x: 221, y: 100 },
            confidence: 0.9,
            predicted: false,
            pinchRatio: 0.3,
          },
        ],
      },
      thresholds,
    );

    expect(released.snapshot).toMatchObject({
      trackingState: "released",
      activeHandId: null,
      release: { point: { x: 100, y: 100 }, releasedAt: 1_220 },
      edgeAction: null,
    });
  });
});
