import { describe, expect, it } from "vitest";

import {
  createInitialPinchVoteState,
  voteCalibratedPinch,
  type CalibratedPinchThresholds,
  type PinchVoteState,
} from "@/lib/gesture/hand-calibration";
import {
  createInitialHandIntentState,
  interpretHandFrame,
  type HandFrame,
  type HandIntentState,
  type HandLandmark,
  type HandLandmarks,
  type HandPhysicalMeasurements,
} from "@/lib/gesture/hand-intent";

type PhysicalPinchPose = "closed" | "gap" | "open";

const PHYSICAL_THRESHOLDS: CalibratedPinchThresholds = {
  engage: 0.38,
  release: 0.52,
};

const RAW_INTERPRETER_THRESHOLDS = {
  pinchEngageRatio: PHYSICAL_THRESHOLDS.engage,
  pinchReleaseRatio: PHYSICAL_THRESHOLDS.release,
} as const;

const CADENCES = [
  {
    fps: 8,
    intervalsMs: [137, 119, 132, 123, 141, 116, 128],
    maxAcquireMs: 137,
    maxReleaseMs: 264,
  },
  {
    fps: 12,
    intervalsMs: [94, 76, 89, 80, 91, 77, 86],
    maxAcquireMs: 94,
    maxReleaseMs: 169,
  },
  {
    fps: 15,
    intervalsMs: [78, 59, 73, 62, 75, 60, 70],
    maxAcquireMs: 78,
    maxReleaseMs: 137,
  },
  {
    fps: 24,
    intervalsMs: [52, 35, 47, 38, 49, 36, 44],
    maxAcquireMs: 52,
    maxReleaseMs: 85,
  },
  {
    fps: 30,
    intervalsMs: [43, 28, 39, 30, 41, 29, 36],
    maxAcquireMs: 43,
    maxReleaseMs: 69,
  },
] as const;

function physicalFrame(
  timestamp: number,
  pose: PhysicalPinchPose,
  horizontalJitter = 0,
): HandFrame {
  const landmarks = Array.from({ length: 21 }, () => ({
    x: 0.5,
    y: 0.7,
    z: 0,
    visibility: 0.95,
  })) as HandLandmark[];
  landmarks[0] = { x: 0.5, y: 0.9, z: 0, visibility: 0.95 };
  landmarks[5] = { x: 0.5, y: 0.68, z: 0, visibility: 0.95 };
  landmarks[6] = { x: 0.5, y: 0.64, z: 0, visibility: 0.95 };
  landmarks[7] = { x: 0.5, y: 0.57, z: 0, visibility: 0.95 };
  landmarks[8] = {
    x: 0.5 + horizontalJitter,
    y: 0.5,
    z: 0,
    visibility: 0.95,
  };
  for (const [mcp, pip, dip, tip, x] of [
    [9, 10, 11, 12, 0.58],
    [13, 14, 15, 16, 0.65],
    [17, 18, 19, 20, 0.72],
  ] as const) {
    landmarks[mcp] = { x, y: 0.67, z: 0, visibility: 0.95 };
    landmarks[pip] = { x, y: 0.55, z: 0, visibility: 0.95 };
    landmarks[dip] = { x, y: 0.64, z: 0, visibility: 0.95 };
    landmarks[tip] = { x, y: 0.72, z: 0, visibility: 0.95 };
  }
  const physicalDistance =
    pose === "closed" ? 0.06 : pose === "gap" ? 0.1 : 0.15;
  landmarks[4] = {
    x: 0.5 + horizontalJitter - physicalDistance,
    y: 0.5,
    z: 0,
    visibility: 0.95,
  };
  return {
    landmarks: landmarks as unknown as HandLandmarks,
    confidence: 0.96,
    timestamp,
  };
}

function interpretPhysicalPose(
  state: HandIntentState,
  timestamp: number,
  pose: PhysicalPinchPose,
  horizontalJitter = 0,
) {
  return interpretHandFrame(
    state,
    physicalFrame(timestamp, pose, horizontalJitter),
    timestamp,
    RAW_INTERPRETER_THRESHOLDS,
  );
}

function votePhysicalMeasurement(
  state: PinchVoteState,
  timestamp: number,
  measurements: HandPhysicalMeasurements,
) {
  return voteCalibratedPinch(
    state,
    {
      timestamp,
      confidence: measurements.confidence,
      indexTipConfidence: measurements.indexTipConfidence,
      thumbTipConfidence: measurements.thumbTipConfidence,
      predicted: false,
      pinchRatio: measurements.pinchRatio,
    },
    PHYSICAL_THRESHOLDS,
  );
}

function requireMeasurements(
  transition: ReturnType<typeof interpretPhysicalPose>,
) {
  if (!transition.measurements)
    throw new Error("Expected a measured physical hand frame.");
  return transition.measurements;
}

describe("physical pinch cadence", () => {
  it.each(CADENCES)(
    "keeps raw physical hysteresis cadence-independent near $fps FPS",
    ({ intervalsMs }) => {
      let raw = createInitialHandIntentState();
      let timestamp = 10_000;

      const closed = interpretPhysicalPose(raw, timestamp, "closed");
      raw = closed.state;
      expect(closed.output).toMatchObject({ accepted: true, mode: "pinch" });
      expect(requireMeasurements(closed)).toMatchObject({ pinchDistance: 0.06 });
      expect(requireMeasurements(closed).pinchRatio).toBeLessThanOrEqual(
        PHYSICAL_THRESHOLDS.engage,
      );

      timestamp += intervalsMs[0];
      const gap = interpretPhysicalPose(raw, timestamp, "gap", 0.002);
      raw = gap.state;
      expect(gap.output).toMatchObject({ accepted: true, mode: "pinch" });
      expect(requireMeasurements(gap)).toMatchObject({ pinchDistance: 0.1 });
      expect(requireMeasurements(gap).pinchRatio).toBeGreaterThan(
        PHYSICAL_THRESHOLDS.engage,
      );
      expect(requireMeasurements(gap).pinchRatio).toBeLessThan(
        PHYSICAL_THRESHOLDS.release,
      );

      timestamp += intervalsMs[1];
      const opened = interpretPhysicalPose(raw, timestamp, "open", -0.002);
      raw = opened.state;
      expect(opened.output).toMatchObject({ accepted: true, mode: "point" });
      expect(requireMeasurements(opened)).toMatchObject({ pinchDistance: 0.15 });
      expect(requireMeasurements(opened).pinchRatio).toBeGreaterThanOrEqual(
        PHYSICAL_THRESHOLDS.release,
      );

      timestamp += intervalsMs[2];
      const unlatchedGap = interpretPhysicalPose(raw, timestamp, "gap");
      expect(unlatchedGap.output).toMatchObject({ accepted: true, mode: "point" });
    },
  );

  it.each(CADENCES)(
    "acquires and releases two-of-three physical evidence within a bounded $fps FPS cadence",
    ({ intervalsMs, maxAcquireMs, maxReleaseMs }) => {
      let raw = createInitialHandIntentState();
      let vote = createInitialPinchVoteState();
      let timestamp = 20_000;
      const acquireStartedAt = timestamp;

      const firstClosed = interpretPhysicalPose(raw, timestamp, "closed", 0.001);
      raw = firstClosed.state;
      let semantic = votePhysicalMeasurement(
        vote,
        timestamp,
        requireMeasurements(firstClosed),
      );
      vote = semantic.state;
      expect(semantic.snapshot).toMatchObject({
        pinched: false,
        candidate: "engage",
        transition: null,
      });

      timestamp += intervalsMs[0];
      const secondClosed = interpretPhysicalPose(raw, timestamp, "closed", -0.001);
      raw = secondClosed.state;
      semantic = votePhysicalMeasurement(
        vote,
        timestamp,
        requireMeasurements(secondClosed),
      );
      vote = semantic.state;
      expect(semantic.snapshot).toMatchObject({
        pinched: true,
        transition: "engaged",
      });
      expect(timestamp - acquireStartedAt).toBeLessThanOrEqual(maxAcquireMs);

      timestamp += intervalsMs[1];
      const firstOpen = interpretPhysicalPose(raw, timestamp, "open", 0.002);
      raw = firstOpen.state;
      const releaseStartedAt = timestamp;
      semantic = votePhysicalMeasurement(
        vote,
        timestamp,
        requireMeasurements(firstOpen),
      );
      vote = semantic.state;
      expect(semantic.snapshot).toMatchObject({
        pinched: true,
        candidate: "release",
      });

      timestamp += intervalsMs[2];
      const closedJitter = interpretPhysicalPose(raw, timestamp, "closed", -0.002);
      raw = closedJitter.state;
      semantic = votePhysicalMeasurement(
        vote,
        timestamp,
        requireMeasurements(closedJitter),
      );
      vote = semantic.state;
      expect(semantic.snapshot).toMatchObject({ pinched: true, transition: null });

      timestamp += intervalsMs[3];
      const secondOpen = interpretPhysicalPose(raw, timestamp, "open", 0.001);
      raw = secondOpen.state;
      semantic = votePhysicalMeasurement(
        vote,
        timestamp,
        requireMeasurements(secondOpen),
      );
      vote = semantic.state;
      expect(semantic.snapshot).toMatchObject({
        pinched: false,
        transition: "released",
      });
      expect(timestamp - releaseStartedAt).toBeLessThanOrEqual(maxReleaseMs);

      timestamp += intervalsMs[4];
      const firstFreshClose = interpretPhysicalPose(raw, timestamp, "closed", -0.001);
      raw = firstFreshClose.state;
      semantic = votePhysicalMeasurement(
        vote,
        timestamp,
        requireMeasurements(firstFreshClose),
      );
      vote = semantic.state;
      expect(semantic.snapshot).toMatchObject({
        pinched: false,
        candidate: "engage",
        transition: null,
      });

      timestamp += intervalsMs[5];
      const secondFreshClose = interpretPhysicalPose(raw, timestamp, "closed", 0.001);
      semantic = votePhysicalMeasurement(
        vote,
        timestamp,
        requireMeasurements(secondFreshClose),
      );
      expect(semantic.snapshot).toMatchObject({
        pinched: true,
        transition: "engaged",
      });
    },
  );

  it("expires a physically stale vote instead of pairing it with a later 8 FPS session", () => {
    let raw = createInitialHandIntentState();
    const first = interpretPhysicalPose(raw, 30_000, "closed");
    raw = first.state;
    const firstVote = votePhysicalMeasurement(
      createInitialPinchVoteState(),
      30_000,
      requireMeasurements(first),
    );

    const afterPause = interpretPhysicalPose(raw, 30_401, "closed");
    raw = afterPause.state;
    const afterPauseVote = votePhysicalMeasurement(
      firstVote.state,
      30_401,
      requireMeasurements(afterPause),
    );
    expect(afterPauseVote.snapshot).toMatchObject({
      pinched: false,
      candidate: "engage",
      transition: null,
    });

    const nextEightFpsFrame = interpretPhysicalPose(raw, 30_530, "closed");
    const reacquired = votePhysicalMeasurement(
      afterPauseVote.state,
      30_530,
      requireMeasurements(nextEightFpsFrame),
    );
    expect(reacquired.snapshot).toMatchObject({
      pinched: true,
      transition: "engaged",
    });
  });
});
