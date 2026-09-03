import { describe, expect, it } from "vitest";

import {
  assessPinchCalibrationEnvelope,
  assessOpenPalmCalibrationBaseline,
  assessHandCalibrationReach,
  buildHandCalibration,
  createInitialHandReliabilityState,
  createInitialPinchVoteState,
  mapCalibratedPointer,
  normalizePinchDistance,
  reduceHandReliability,
  resolvePinchThresholds,
  voteCalibratedPinch,
} from "@/lib/gesture/hand-calibration";

function pinchSample(
  timestamp: number,
  pinchRatio: number,
  overrides: Partial<{
    confidence: number;
    indexTipConfidence: number;
    thumbTipConfidence: number;
    predicted: boolean;
  }> = {},
) {
  return {
    timestamp,
    pinchRatio,
    confidence: 0.9,
    indexTipConfidence: 0.9,
    thumbTipConfidence: 0.9,
    predicted: false,
    ...overrides,
  };
}

describe("hand calibration", () => {
  it("establishes an open-palm baseline before using hand-scale-normalized pinch evidence", () => {
    const baseline = assessOpenPalmCalibrationBaseline([
      {
        center: { x: 0.49, y: 0.51 },
        palmScale: 0.2,
        pinchDistance: 0.14,
        orientationRadians: -1.5,
        confidence: 0.96,
      },
      {
        center: { x: 0.5, y: 0.5 },
        palmScale: 0.21,
        pinchDistance: 0.147,
        orientationRadians: -1.5,
        confidence: 0.94,
      },
      {
        center: { x: 0.51, y: 0.49 },
        palmScale: 0.19,
        pinchDistance: 0.133,
        orientationRadians: -1.5,
        confidence: 0.95,
      },
      {
        center: { x: 0.5, y: 0.5 },
        palmScale: 0.2,
        pinchDistance: 0.14,
        orientationRadians: -1.5,
        confidence: 0.97,
      },
    ]);

    expect(baseline).toMatchObject({
      accepted: true,
      baseline: {
        center: { x: 0.5, y: 0.5 },
        palmScale: 0.2,
        openPinchRatio: 0.7,
        orientationRadians: -1.5,
        sampleCount: 4,
      },
    });
    if (!baseline.accepted) throw new Error("Open-palm baseline was refused.");

    expect(
      normalizePinchDistance(0.05, 0.2, baseline.baseline),
    ).toBe(0.25);
    expect(
      normalizePinchDistance(0.1, 0.4, {
        ...baseline.baseline,
        palmScale: 0.4,
      }),
    ).toBe(0.25);
  });

  it("refuses an open-palm window whose center or 2D scale is not stable", () => {
    expect(
      assessOpenPalmCalibrationBaseline([
        { center: { x: 0.2, y: 0.2 }, palmScale: 0.1, pinchDistance: 0.07, orientationRadians: -1.5, confidence: 0.95 },
        { center: { x: 0.8, y: 0.2 }, palmScale: 0.3, pinchDistance: 0.21, orientationRadians: -1.5, confidence: 0.95 },
        { center: { x: 0.2, y: 0.8 }, palmScale: 0.1, pinchDistance: 0.07, orientationRadians: -1.5, confidence: 0.95 },
        { center: { x: 0.8, y: 0.8 }, palmScale: 0.3, pinchDistance: 0.21, orientationRadians: -1.5, confidence: 0.95 },
      ]),
    ).toEqual({ accepted: false, reason: "open_palm_not_established" });
  });

  it("refuses an open-palm window that rotates instead of holding one orientation", () => {
    expect(
      assessOpenPalmCalibrationBaseline(
        [-1.5, -0.5, 0.5, 1.5].map((orientationRadians) => ({
          center: { x: 0.5, y: 0.5 },
          palmScale: 0.2,
          pinchDistance: 0.14,
          orientationRadians,
          confidence: 0.95,
        })),
      ),
    ).toEqual({ accepted: false, reason: "open_palm_not_established" });
  });

  it("preflights reach without requiring pinch evidence", () => {
    expect(
      assessHandCalibrationReach([
        { x: 0.49, y: 0.49 },
        { x: 0.5, y: 0.5 },
        { x: 0.51, y: 0.51 },
      ]),
    ).toEqual({ accepted: false, reason: "reach_too_small" });
    expect(
      assessHandCalibrationReach([
        { x: 0.36, y: 0.34 },
        { x: 0.64, y: 0.34 },
        { x: 0.36, y: 0.66 },
        { x: 0.64, y: 0.66 },
      ]),
    ).toMatchObject({ accepted: true, cameraBounds: expect.any(Object) });
  });

  it("maps a compact comfortable reach to the full canvas without demanding camera-frame edges", () => {
    const result = buildHandCalibration({
      deviceKey: "compact-comfortable-reach",
      mirrorX: true,
      createdAt: 900,
      reachSamples: [
        { x: 0.36, y: 0.34 },
        { x: 0.36, y: 0.34 },
        { x: 0.64, y: 0.34 },
        { x: 0.64, y: 0.34 },
        { x: 0.36, y: 0.66 },
        { x: 0.36, y: 0.66 },
        { x: 0.64, y: 0.66 },
        { x: 0.64, y: 0.66 },
      ],
      closedPinchRatios: [0.31, 0.32, 0.33],
      openPinchRatios: [0.67, 0.69, 0.71],
    });

    expect(result).toMatchObject({
      accepted: true,
      profile: {
        cameraBounds: {
          x: expect.any(Number),
          y: expect.any(Number),
          width: expect.any(Number),
          height: expect.any(Number),
        },
        pinchClosedRatio: 0.329,
        pinchOpenRatio: 0.672,
      },
    });
  });

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

  it("refuses overlapping open and closed pinch evidence instead of claiming fallback calibration", () => {
    const result = buildHandCalibration({
      deviceKey: "overlapping-pinch",
      mirrorX: true,
      createdAt: 2_500,
      reachSamples: [
        { x: 0.35, y: 0.35 },
        { x: 0.35, y: 0.35 },
        { x: 0.65, y: 0.35 },
        { x: 0.65, y: 0.35 },
        { x: 0.35, y: 0.65 },
        { x: 0.35, y: 0.65 },
        { x: 0.65, y: 0.65 },
        { x: 0.65, y: 0.65 },
      ],
      closedPinchRatios: [0.48, 0.51, 0.54],
      openPinchRatios: [0.49, 0.52, 0.55],
    });

    expect(result).toMatchObject({
      accepted: false,
      reason: "pinch_not_separated",
    });
  });

  it("uses one robust separation envelope for closed-pinch admission and the final profile", () => {
    expect(
      assessPinchCalibrationEnvelope(
        [],
        [0.53, 0.7, 0.7, 0.7, 0.7, 0.7],
      ),
    ).toEqual({
      accepted: false,
      closedUpper: null,
      openLower: 0.5725,
      minimumSeparation: 0.05,
      maximumClosed: 0.5225,
    });

    const result = buildHandCalibration({
      deviceKey: "pinch-margin",
      mirrorX: true,
      createdAt: 2_550,
      reachSamples: [
        { x: 0.35, y: 0.35 },
        { x: 0.65, y: 0.35 },
        { x: 0.35, y: 0.65 },
        { x: 0.65, y: 0.65 },
      ],
      closedPinchRatios: [0.56, 0.56, 0.56, 0.56, 0.56, 0.56],
      openPinchRatios: [0.6, 0.6, 0.6, 0.6, 0.6, 0.6],
    });
    expect(result).toMatchObject({
      accepted: false,
      reason: "pinch_not_separated",
    });
  });

  it("refuses out-of-domain pinch evidence and resolves unsafe profiles to defaults", () => {
    const result = buildHandCalibration({
      deviceKey: "invalid-pinch-domain",
      mirrorX: true,
      createdAt: 2_600,
      reachSamples: [
        { x: 0.35, y: 0.35 },
        { x: 0.65, y: 0.35 },
        { x: 0.35, y: 0.65 },
        { x: 0.65, y: 0.65 },
      ],
      closedPinchRatios: [1.8, 1.85, 1.9],
      openPinchRatios: [2.2, 2.3, 2.4],
    });

    expect(result).toMatchObject({
      accepted: false,
      reason: "pinch_not_separated",
    });
    expect(
      resolvePinchThresholds({
        pinchClosedRatio: 1.8,
        pinchOpenRatio: 2.4,
      }),
    ).toEqual({ engage: 0.38, release: 0.52 });
  });

  it.each([
    ["top-left", { x: 0.17, y: 0.17 }, { x: 12, y: 12 }],
    ["top", { x: 0.5, y: 0.17 }, { x: 500, y: 12 }],
    ["top-right", { x: 0.83, y: 0.17 }, { x: 988, y: 12 }],
    ["left", { x: 0.17, y: 0.5 }, { x: 12, y: 250 }],
    ["center", { x: 0.5, y: 0.5 }, { x: 500, y: 250 }],
    ["right", { x: 0.83, y: 0.5 }, { x: 988, y: 250 }],
    ["bottom-left", { x: 0.17, y: 0.83 }, { x: 12, y: 488 }],
    ["bottom", { x: 0.5, y: 0.83 }, { x: 500, y: 488 }],
    ["bottom-right", { x: 0.83, y: 0.83 }, { x: 988, y: 488 }],
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
    ).toMatchObject({ point: expected, gain: 1.1 });
  });

  it("keeps the calibrated interior linear and extrapolates beyond it to the true viewport edge", () => {
    const calibration = {
      deviceKey: "spatial-field-camera",
      cameraBounds: { x: 0.2, y: 0.2, width: 0.6, height: 0.6 },
      safeCanvasInsetPx: 24,
      pinchClosedRatio: 0.25,
      pinchOpenRatio: 0.7,
      mirrorX: true,
      createdAt: 1,
    } as const;
    const canvas = { left: 40, top: 20, width: 1_000, height: 500 };

    const quarter = mapCalibratedPointer(
      calibration,
      { x: 0.35, y: 0.35 },
      canvas,
      "two_hand",
    );
    const outsideComfortableReach = mapCalibratedPointer(
      calibration,
      { x: 0.14, y: 0.14 },
      canvas,
      "two_hand",
    );

    expect(quarter).toMatchObject({
      point: { x: 278.2, y: 145.7 },
      normalized: { x: 0.2382, y: 0.2514 },
    });
    expect(outsideComfortableReach).toMatchObject({
      point: { x: 40, y: 20 },
      normalized: { x: 0, y: 0 },
    });
  });

  it("keeps the same calibrated point through every interaction state", () => {
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
      1.1, 1.1, 1.1, 1.1, 1.1,
    ]);
    expect([target.point, held.point, draw.point, twoHand.point]).toEqual([
      hover.point,
      hover.point,
      hover.point,
      hover.point,
    ]);
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
      pinchSample(1_000, 0.3),
      thresholds,
    );
    expect(first.snapshot).toMatchObject({ pinched: false, candidate: "engage" });

    const engaged = voteCalibratedPinch(
      first.state,
      pinchSample(1_040, 0.31),
      thresholds,
    );
    expect(engaged.snapshot).toEqual({
      pinched: true,
      candidate: null,
      transition: "engaged",
      ignored: false,
    });

    const releaseCandidate = voteCalibratedPinch(
      engaged.state,
      pinchSample(1_070, 0.55),
      thresholds,
    );
    const released = voteCalibratedPinch(
      releaseCandidate.state,
      pinchSample(1_095, 0.56),
      thresholds,
    );
    expect(released.snapshot).toEqual({
      pinched: false,
      candidate: null,
      transition: "released",
      ignored: false,
    });
  });

  it("keeps the pinch latch through a short uncertain interval without voting it as release", () => {
    const thresholds = { engage: 0.38, release: 0.52 };
    const engaged = voteCalibratedPinch(
      voteCalibratedPinch(
        createInitialPinchVoteState(),
        pinchSample(1_000, 0.3),
        thresholds,
      ).state,
      pinchSample(1_040, 0.3),
      thresholds,
    );

    const uncertain = voteCalibratedPinch(
      engaged.state,
      pinchSample(1_100, 0.8, { confidence: 0.2 }),
      thresholds,
    );

    expect(uncertain.snapshot).toEqual({
      pinched: true,
      candidate: null,
      transition: null,
      ignored: false,
    });
    expect(uncertain.state.lastConfidentAt).toBe(1_040);
  });

  it("requires real index and thumb confidence before either pinch transition", () => {
    const thresholds = { engage: 0.38, release: 0.52 };

    for (const uncertain of [
      pinchSample(1_040, 0.3, { thumbTipConfidence: 0.2 }),
      pinchSample(1_040, 0.3, { indexTipConfidence: 0.2 }),
      pinchSample(1_040, 0.3, { predicted: true }),
    ]) {
      const candidate = voteCalibratedPinch(
        voteCalibratedPinch(
          createInitialPinchVoteState(),
          pinchSample(1_000, 0.3),
          thresholds,
        ).state,
        uncertain,
        thresholds,
      );
      expect(candidate.snapshot).toMatchObject({
        pinched: false,
        transition: null,
      });
    }

    const held = voteCalibratedPinch(
      voteCalibratedPinch(
        createInitialPinchVoteState(),
        pinchSample(1_000, 0.3),
        thresholds,
      ).state,
      pinchSample(1_040, 0.3),
      thresholds,
    );
    expect(held.snapshot).toMatchObject({ pinched: true });

    let state = held.state;
    for (const uncertain of [
      pinchSample(1_070, 0.7, { thumbTipConfidence: 0.2 }),
      pinchSample(1_085, 0.7, { indexTipConfidence: 0.2 }),
      pinchSample(1_100, 0.7, { predicted: true }),
    ]) {
      const transition = voteCalibratedPinch(state, uncertain, thresholds);
      expect(transition.snapshot).toMatchObject({
        pinched: true,
        transition: null,
      });
      state = transition.state;
    }
  });

  it("ignores duplicate and older confidence evidence for engage and release", () => {
    const thresholds = { engage: 0.38, release: 0.52 };
    const first = voteCalibratedPinch(
      createInitialPinchVoteState(),
      pinchSample(1_000, 0.3),
      thresholds,
    );
    const duplicateEngage = voteCalibratedPinch(
      first.state,
      pinchSample(1_000, 0.3),
      thresholds,
    );
    const olderEngage = voteCalibratedPinch(
      duplicateEngage.state,
      pinchSample(999, 0.3),
      thresholds,
    );
    expect(duplicateEngage.snapshot).toMatchObject({
      pinched: false,
      transition: null,
      ignored: true,
    });
    expect(olderEngage.state).toEqual(first.state);

    const held = voteCalibratedPinch(
      olderEngage.state,
      pinchSample(1_040, 0.3),
      thresholds,
    );
    expect(held.snapshot).toMatchObject({ pinched: true, transition: "engaged" });

    const releaseCandidate = voteCalibratedPinch(
      held.state,
      pinchSample(1_070, 0.7),
      thresholds,
    );
    const duplicateRelease = voteCalibratedPinch(
      releaseCandidate.state,
      pinchSample(1_070, 0.7),
      thresholds,
    );
    const olderRelease = voteCalibratedPinch(
      duplicateRelease.state,
      pinchSample(1_060, 0.7),
      thresholds,
    );
    expect(duplicateRelease.snapshot).toMatchObject({
      pinched: true,
      transition: null,
      ignored: true,
    });
    expect(olderRelease.state).toEqual(releaseCandidate.state);

    const released = voteCalibratedPinch(
      olderRelease.state,
      pinchSample(1_095, 0.7),
      thresholds,
    );
    expect(released.snapshot).toMatchObject({
      pinched: false,
      transition: "released",
    });
  });

  it("refuses a confident sample that arrives behind newer uncertain evidence", () => {
    const thresholds = { engage: 0.38, release: 0.52 };
    const first = voteCalibratedPinch(
      createInitialPinchVoteState(),
      pinchSample(1_000, 0.3),
      thresholds,
    );
    const uncertain = voteCalibratedPinch(
      first.state,
      pinchSample(1_050, 0.3, { thumbTipConfidence: 0.2 }),
      thresholds,
    );
    const outOfOrder = voteCalibratedPinch(
      uncertain.state,
      pinchSample(1_040, 0.3),
      thresholds,
    );

    expect(outOfOrder.state).toEqual(uncertain.state);
    expect(outOfOrder.snapshot).toMatchObject({
      pinched: false,
      transition: null,
      ignored: true,
    });
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
            indexTipConfidence: 0.91,
            thumbTipConfidence: 0.91,
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
            indexTipConfidence: 0.93,
            thumbTipConfidence: 0.93,
            predicted: false,
            pinchRatio: 0.7,
          },
          {
            trackId: "track-primary",
            handedness: "right",
            pointer: { x: 760, y: 140 },
            confidence: 0.91,
            indexTipConfidence: 0.91,
            thumbTipConfidence: 0.91,
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
      indexTipConfidence: 0.91,
      thumbTipConfidence: 0.91,
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
        indexTipConfidence: 0.93,
        thumbTipConfidence: 0.93,
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
        indexTipConfidence: 0.91,
        thumbTipConfidence: 0.91,
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
            indexTipConfidence: 0.9,
            thumbTipConfidence: 0.9,
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
            indexTipConfidence: 0.9,
            thumbTipConfidence: 0.9,
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
            indexTipConfidence: 0.9,
            thumbTipConfidence: 0.9,
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
            indexTipConfidence: 0.9,
            thumbTipConfidence: 0.9,
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
            indexTipConfidence: 0.9,
            thumbTipConfidence: 0.9,
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
            indexTipConfidence: 0.9,
            thumbTipConfidence: 0.9,
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

  it("does not let duplicate or older loss evidence rewind grace timing", () => {
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
            indexTipConfidence: 0.9,
            thumbTipConfidence: 0.9,
            predicted: false,
            pinchRatio: 0.3,
          },
        ],
      },
      thresholds,
    );
    const reacquire = reduceHandReliability(
      tracked.state,
      { timestamp: 1_150, hands: [] },
      thresholds,
    );
    const duplicate = reduceHandReliability(
      reacquire.state,
      { timestamp: 1_150, hands: [] },
      thresholds,
    );
    const older = reduceHandReliability(
      duplicate.state,
      { timestamp: 1_120, hands: [] },
      thresholds,
    );

    expect(reacquire.snapshot).toMatchObject({ trackingState: "reacquire" });
    expect(duplicate.snapshot).toMatchObject({
      trackingState: "reacquire",
      ignored: true,
    });
    expect(older.state).toEqual(reacquire.state);
  });
});
