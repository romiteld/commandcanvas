import { describe, expect, it } from "vitest";

import {
  SpatialVisionBenchmarkRunSchema,
  compareSpatialVisionBenchmarkRuns,
  createSpatialVisionBenchmarkRecorder,
  summarizeSpatialVisionBenchmarkRun,
  type SpatialVisionBenchmarkFrame,
} from "@/lib/gesture/spatial-vision-benchmark";

const baseRun = {
  schemaVersion: 1 as const,
  id: "iphone-run-mediapipe",
  recordedAt: "2026-08-27T17:00:00.000Z",
  evidenceLevel: "recorded-target-device" as const,
  protocolId: "commandcanvas-hand-v1",
  engine: {
    id: "mediapipe-hand-landmarker-v1",
    displayName: "MediaPipe Hand Landmarker",
    role: "default" as const,
    runtime: "mediapipe-tasks-vision",
    output: "hand-pose-keypoints" as const,
    keypointCount: 21 as const,
    modelVersion: "float16-1",
    licenseReview: "verified-current-default" as const,
  },
  source: {
    kind: "recorded" as const,
    recordingSha256: "a".repeat(64),
    device: {
      family: "iPhone",
      model: "iPhone 15 Pro",
      os: "iOS 20.0",
      browser: "Chrome",
      browserVersion: "153",
    },
    capture: {
      width: 1280,
      height: 720,
      orientation: "landscape" as const,
      camera: "front" as const,
    },
  },
  startupMs: 420,
  modelBytes: 7_500_000,
  peakMemoryMb: 118,
  memoryNotes: "Measured with the browser process telemetry available on device.",
  heatingNotes: "Warm after five minutes; no thermal warning.",
  frames: [] as SpatialVisionBenchmarkFrame[],
  notes: "Controlled lighting and the same scripted gesture sequence.",
};

function frame(
  frameIndex: number,
  truth: SpatialVisionBenchmarkFrame["truth"],
  prediction: SpatialVisionBenchmarkFrame["prediction"],
): SpatialVisionBenchmarkFrame {
  const captureTimestampMs = frameIndex * 100;
  return {
    frameIndex,
    captureTimestampMs,
    inferenceStartedAtMs: captureTimestampMs + 2,
    inferenceCompletedAtMs: captureTimestampMs + 22,
    truth,
    prediction,
  };
}

describe("spatial vision target-device benchmark", () => {
  it("computes interaction evidence without collapsing it into an unsupported winner score", () => {
    const frames = [
      frame(
        0,
        { expectedHandCount: 0, pinching: false },
        { handCount: 0, pinching: false },
      ),
      frame(
        1,
        {
          expectedHandCount: 1,
          pinching: false,
          primaryPointer: { x: 0.5, y: 0.5 },
          stationary: true,
        },
        {
          handCount: 1,
          pinching: false,
          primaryPointer: { x: 0.51, y: 0.5 },
        },
      ),
      frame(
        2,
        {
          expectedHandCount: 1,
          pinching: true,
          primaryPointer: { x: 0.5, y: 0.5 },
          stationary: true,
        },
        {
          handCount: 1,
          pinching: false,
          primaryPointer: { x: 0.49, y: 0.5 },
        },
      ),
      frame(
        3,
        {
          expectedHandCount: 1,
          pinching: true,
          primaryPointer: { x: 0.5, y: 0.5 },
          stationary: true,
        },
        {
          handCount: 1,
          pinching: true,
          primaryPointer: { x: 0.5, y: 0.51 },
        },
      ),
      frame(
        4,
        { expectedHandCount: 2, pinching: true },
        { handCount: 2, pinching: true },
      ),
      frame(
        5,
        { expectedHandCount: 2, pinching: true },
        { handCount: 1, pinching: false },
      ),
    ];
    const run = SpatialVisionBenchmarkRunSchema.parse({ ...baseRun, frames });

    const metrics = summarizeSpatialVisionBenchmarkRun(run);

    expect(metrics).toMatchObject({
      expectedHandFrames: 5,
      acquiredHandFrames: 5,
      acquisitionRate: 1,
      trackingContinuityRate: 1,
      twoHandExpectedFrames: 2,
      twoHandTrackedFrames: 1,
      twoHandContinuityRate: 0.5,
      pinchLatencyMsMedian: 100,
      missedPinches: 0,
      falseGrabs: 0,
      falseReleases: 1,
      frameRateFps: 10,
      inferenceLatencyMsP50: 20,
      startupMs: 420,
      modelBytes: 7_500_000,
      peakMemoryMb: 118,
    });
    expect(metrics.pointerJitterRmseNormalized).toBeCloseTo(0.0094, 3);
    expect(metrics).not.toHaveProperty("winner");
    expect(metrics).not.toHaveProperty("score");
  });

  it("records an auditable run with device, source, resource, and thermal evidence", () => {
    let now = 1_000;
    const recorder = createSpatialVisionBenchmarkRecorder({
      ...baseRun,
      id: "live-iphone-run",
      evidenceLevel: "live-target-device",
      source: {
        kind: "live",
        device: baseRun.source.device,
        capture: baseRun.source.capture,
      },
      frames: undefined,
      now: () => now,
    });
    now = 1_045;
    recorder.recordFrame({
      truth: { expectedHandCount: 1, pinching: false },
      prediction: { handCount: 1, pinching: false },
      captureTimestampMs: 1_020,
      inferenceStartedAtMs: 1_025,
      inferenceCompletedAtMs: 1_040,
    });

    const run = recorder.complete({
      peakMemoryMb: 126,
      memoryNotes: "Browser process peak observed during the scripted run.",
      heatingNotes: "No perceptible heating during the two-minute run.",
      notes: "Operator completed point, pinch, release, and two-hand phases.",
    });

    expect(run.startupMs).toBe(45);
    expect(run.frames).toHaveLength(1);
    expect(run.frames[0]?.frameIndex).toBe(0);
    expect(SpatialVisionBenchmarkRunSchema.parse(run)).toEqual(run);
  });

  it("only compares real target-device runs from the same protocol and recorded input", () => {
    const mediaPipe = SpatialVisionBenchmarkRunSchema.parse({
      ...baseRun,
      frames: [
        frame(
          0,
          { expectedHandCount: 1, pinching: false },
          { handCount: 1, pinching: false },
        ),
      ],
    });
    const yolo = SpatialVisionBenchmarkRunSchema.parse({
      ...baseRun,
      id: "iphone-run-yolo",
      engine: {
        ...baseRun.engine,
        id: "candidate-yolo-hand-pose",
        displayName: "Candidate YOLO hand pose",
        role: "candidate",
        runtime: "onnx-runtime-web",
        licenseReview: "unverified-do-not-ship",
      },
      frames: mediaPipe.frames,
    });

    const comparison = compareSpatialVisionBenchmarkRuns(mediaPipe, yolo);

    expect(comparison.comparable).toBe(true);
    expect(comparison).not.toHaveProperty("winner");
    expect(comparison).toHaveProperty("metricDeltas");

    const fixture = { ...yolo, evidenceLevel: "fixture" as const };
    expect(compareSpatialVisionBenchmarkRuns(mediaPipe, fixture)).toEqual({
      comparable: false,
      reasons: ["fixture runs cannot support an engine replacement claim"],
    });

    const differentRecording = {
      ...yolo,
      source: { ...yolo.source, recordingSha256: "b".repeat(64) },
    };
    expect(
      compareSpatialVisionBenchmarkRuns(mediaPipe, differentRecording),
    ).toEqual({
      comparable: false,
      reasons: ["recorded comparisons require the same source recording hash"],
    });
  });

  it("rejects a bounding-box-only engine result and incomplete target evidence", () => {
    expect(() =>
      SpatialVisionBenchmarkRunSchema.parse({
        ...baseRun,
        engine: {
          ...baseRun.engine,
          output: "bounding-boxes",
          keypointCount: 0,
        },
      }),
    ).toThrow();
    expect(() =>
      SpatialVisionBenchmarkRunSchema.parse({
        ...baseRun,
        heatingNotes: "",
      }),
    ).toThrow();
  });
});
