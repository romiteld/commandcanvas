import { describe, expect, it } from "vitest";

import {
  applyDrawingClutchPolicyAtSafeBoundary,
  createInitialDrawingClutchState,
  reduceDrawingClutch,
  resolveDrawingClutchPolicy,
  type DrawingClutchObservation,
} from "@/lib/gesture/drawing-clutch";
import type { HandCalibrationProfile } from "@/lib/gesture/hand-calibration";

function observed(
  timestamp: number,
  normalizedDistance: number,
  overrides: Partial<DrawingClutchObservation> = {},
): DrawingClutchObservation {
  return {
    trackId: "hand-a",
    timestamp,
    normalizedDistance,
    confidence: 0.96,
    predicted: false,
    trackingState: "tracked",
    ...overrides,
  };
}

describe("deterministic thumb-middle drawing clutch", () => {
  it("resolves exact-track calibration before reliable handedness", () => {
    const resolved = resolveDrawingClutchPolicy(
      calibrationProfile({
        drawingClutchCalibrations: [
          drawingCalibration("track-a", "right", 0.2, 0.8),
          drawingCalibration("expired-track", "right", 0.4, 0.8),
        ],
      }),
      {
        trackId: "track-a",
        handedness: "right",
        handednessReliable: true,
      },
    );

    expect(resolved).toEqual({
      calibrated: true,
      source: "track",
      policy: {
        engageThreshold: 0.35,
        releaseThreshold: 0.56,
        confirmationSamples: 2,
        minimumConfidence: 0.55,
      },
    });
  });

  it("refuses an exact-track calibration when reliable handedness is incompatible", () => {
    const resolved = resolveDrawingClutchPolicy(
      calibrationProfile({
        drawingClutchCalibrations: [
          drawingCalibration("recycled-track", "left", 0.2, 0.8),
          drawingCalibration("right-track", "right", 0.4, 0.8),
        ],
      }),
      {
        trackId: "recycled-track",
        handedness: "right",
        handednessReliable: true,
      },
    );

    expect(resolved).toMatchObject({
      calibrated: true,
      source: "handedness",
      policy: { engageThreshold: 0.5, releaseThreshold: 0.64 },
    });
  });

  it("reuses calibration by handedness only when handedness is reliable", () => {
    const profile = calibrationProfile({
      drawingClutchCalibrations: [
        drawingCalibration("expired-track", "right", 0.2, 0.8),
      ],
    });

    expect(
      resolveDrawingClutchPolicy(profile, {
        trackId: "new-track",
        handedness: "right",
        handednessReliable: true,
      }),
    ).toMatchObject({ calibrated: true, source: "handedness" });
    expect(
      resolveDrawingClutchPolicy(profile, {
        trackId: "new-track",
        handedness: "right",
        handednessReliable: false,
      }),
    ).toMatchObject({
      calibrated: false,
      source: "provisional",
      policy: { engageThreshold: 0.32, releaseThreshold: 0.52 },
    });

    expect(
      resolveDrawingClutchPolicy(
        calibrationProfile({
          drawingClutchCalibrations: [
            {
              ...drawingCalibration("expired-track", "right", 0.2, 0.8),
              handednessConfidence: 0.42,
            },
          ],
        }),
        {
          trackId: "new-track",
          handedness: "right",
          handednessReliable: true,
        },
      ),
    ).toMatchObject({ calibrated: false, source: "provisional" });
  });

  it("refuses malformed calibration evidence instead of calling it calibrated", () => {
    expect(
      resolveDrawingClutchPolicy(
        calibrationProfile({
          drawingClutchCalibrations: [
            drawingCalibration("track-a", "right", 0.62, 0.64),
          ],
        }),
        {
          trackId: "track-a",
          handedness: "right",
          handednessReliable: true,
        },
      ),
    ).toMatchObject({
      calibrated: false,
      source: "provisional",
      policy: { engageThreshold: 0.32, releaseThreshold: 0.52 },
    });
  });

  it("changes policy only at a safe pen-up boundary", () => {
    const personalized = {
      engageThreshold: 0.4,
      releaseThreshold: 0.64,
      confirmationSamples: 2,
      minimumConfidence: 0.55,
    };
    const ready = applyDrawingClutchPolicyAtSafeBoundary(state(), personalized);
    expect(ready.policy).toEqual(personalized);

    const pending = reduceDrawingClutch(ready, observed(1_000, 0.2));
    expect(
      applyDrawingClutchPolicyAtSafeBoundary(pending.state, {
        ...personalized,
        engageThreshold: 0.25,
      }).policy,
    ).toEqual(personalized);
  });

  it("requires separate engage and release thresholds", () => {
    const state = createInitialDrawingClutchState();
    expect(state.policy.releaseThreshold).toBeGreaterThan(
      state.policy.engageThreshold,
    );
  });

  it("requires multiple reliable samples before engaging", () => {
    const first = reduceDrawingClutch(state(), observed(1_000, 0.2));
    expect(first.evidence).toMatchObject({
      penDown: false,
      transition: "none",
    });
    expect(first.state.phase).toBe("engage_pending");

    const second = reduceDrawingClutch(first.state, observed(1_016, 0.2));
    expect(second.evidence).toMatchObject({
      penDown: true,
      transition: "engaged",
    });
    expect(second.state.phase).toBe("pen_down");
  });

  it("does not let duplicate or older timestamps advance engagement", () => {
    const first = reduceDrawingClutch(state(), observed(1_000, 0.2));
    const duplicate = reduceDrawingClutch(first.state, observed(1_000, 0.2));
    const older = reduceDrawingClutch(duplicate.state, observed(999, 0.2));

    expect(duplicate.state).toMatchObject({
      phase: "engage_pending",
      candidateSamples: 1,
      candidateStartedAt: 1_000,
    });
    expect(duplicate.evidence).toMatchObject({
      penDown: false,
      transition: "none",
      rejectedBecause: "non-monotonic-timestamp",
    });
    expect(older.state).toEqual(duplicate.state);

    const engaged = reduceDrawingClutch(older.state, observed(1_016, 0.2));
    expect(engaged.evidence).toMatchObject({
      penDown: true,
      transition: "engaged",
    });
  });

  it("requires confirmation to span more than a single noisy instant", () => {
    const first = reduceDrawingClutch(state(), observed(1_000, 0.2));
    const tooSoon = reduceDrawingClutch(first.state, observed(1_001, 0.2));

    expect(tooSoon.state.phase).toBe("engage_pending");
    expect(tooSoon.evidence).toMatchObject({
      penDown: false,
      transition: "none",
    });

    const engaged = reduceDrawingClutch(tooSoon.state, observed(1_016, 0.2));
    expect(engaged.evidence).toMatchObject({
      penDown: true,
      transition: "engaged",
    });
  });

  it("restarts engagement when candidate evidence is too far apart", () => {
    const first = reduceDrawingClutch(state(), observed(1_000, 0.2));
    const tooLate = reduceDrawingClutch(first.state, observed(1_200, 0.2));

    expect(tooLate.state).toMatchObject({
      phase: "engage_pending",
      candidateSamples: 1,
      candidateStartedAt: 1_200,
    });
    expect(tooLate.evidence).toMatchObject({
      penDown: false,
      transition: "none",
    });
  });

  it("uses hysteresis so threshold chatter neither releases nor re-engages", () => {
    const first = reduceDrawingClutch(state(), observed(1_000, 0.2));
    const engaged = reduceDrawingClutch(first.state, observed(1_016, 0.2));
    const chatter = reduceDrawingClutch(engaged.state, observed(1_032, 0.42));

    expect(chatter.evidence).toMatchObject({
      penDown: true,
      transition: "none",
    });
    expect(chatter.state.phase).toBe("pen_down");
  });

  it("requires confirmed release and rejects predicted semantic transitions", () => {
    const pending = reduceDrawingClutch(state(), observed(1_000, 0.2));
    const engaged = reduceDrawingClutch(pending.state, observed(1_016, 0.2));
    const predicted = reduceDrawingClutch(
      engaged.state,
      observed(1_032, 0.8, { predicted: true }),
    );
    expect(predicted.evidence).toMatchObject({
      penDown: true,
      transition: "none",
    });

    const releasePending = reduceDrawingClutch(
      predicted.state,
      observed(1_048, 0.8),
    );
    expect(releasePending.evidence.penDown).toBe(true);
    const released = reduceDrawingClutch(
      releasePending.state,
      observed(1_064, 0.8),
    );
    expect(released.evidence).toMatchObject({
      penDown: false,
      transition: "released",
    });
  });

  it("does not let duplicate or older timestamps advance release", () => {
    const first = reduceDrawingClutch(state(), observed(1_000, 0.2));
    const engaged = reduceDrawingClutch(first.state, observed(1_016, 0.2));
    const releasePending = reduceDrawingClutch(
      engaged.state,
      observed(1_032, 0.8),
    );
    const duplicate = reduceDrawingClutch(
      releasePending.state,
      observed(1_032, 0.8),
    );
    const older = reduceDrawingClutch(duplicate.state, observed(1_024, 0.8));

    expect(duplicate.state).toMatchObject({
      phase: "release_pending",
      candidateSamples: 1,
      candidateStartedAt: 1_032,
    });
    expect(duplicate.evidence).toMatchObject({
      penDown: true,
      transition: "none",
      rejectedBecause: "non-monotonic-timestamp",
    });
    expect(older.state).toEqual(duplicate.state);

    const released = reduceDrawingClutch(older.state, observed(1_048, 0.8));
    expect(released.evidence).toMatchObject({
      penDown: false,
      transition: "released",
    });
  });

  it("does not let a second hand inherit an engaged clutch", () => {
    const pending = reduceDrawingClutch(state(), observed(1_000, 0.2));
    const engaged = reduceDrawingClutch(pending.state, observed(1_016, 0.2));
    const other = reduceDrawingClutch(
      engaged.state,
      observed(1_032, 0.2, { trackId: "hand-b" }),
    );

    expect(other.evidence).toMatchObject({
      trackId: "hand-b",
      penDown: false,
      transition: "none",
      rejectedBecause: "active-hand-mismatch",
    });
    expect(other.state.activeTrackId).toBe("hand-a");
  });

  it("resets safely when Draw mode exits", () => {
    const pending = reduceDrawingClutch(state(), observed(1_000, 0.2));
    const engaged = reduceDrawingClutch(pending.state, observed(1_016, 0.2));
    const reset = reduceDrawingClutch(engaged.state, null);

    expect(reset.state.phase).toBe("pen_up");
    expect(reset.state.activeTrackId).toBeNull();
    expect(reset.evidence).toMatchObject({
      penDown: false,
      transition: "released",
    });
  });
});

function state() {
  return createInitialDrawingClutchState();
}

function calibrationProfile(
  overrides: Partial<HandCalibrationProfile> & {
    drawingClutchCalibrations?: HandCalibrationProfile["drawingClutchCalibrations"];
  },
): HandCalibrationProfile {
  return {
    deviceKey: "camera-a",
    cameraBounds: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
    safeCanvasInsetPx: 24,
    pinchClosedRatio: 0.2,
    pinchOpenRatio: 0.8,
    mirrorX: true,
    createdAt: 1,
    ...overrides,
  };
}

function drawingCalibration(
  trackId: string,
  handedness: "left" | "right" | "unknown",
  closedRatio: number,
  openRatio: number,
) {
  return {
    trackId,
    handedness,
    handednessConfidence: 0.97,
    closedRatio,
    openRatio,
    openSampleCount: 8,
    closedSampleCount: 8,
    capturedAt: 1_000,
  } as const;
}
