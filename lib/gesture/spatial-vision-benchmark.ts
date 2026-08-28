import { z } from "zod";

const NormalizedPointSchema = z
  .object({
    x: z.number().min(0).max(1),
    y: z.number().min(0).max(1),
  })
  .strict();

const BenchmarkTruthSchema = z
  .object({
    expectedHandCount: z.union([z.literal(0), z.literal(1), z.literal(2)]),
    pinching: z.boolean(),
    primaryPointer: NormalizedPointSchema.optional(),
    stationary: z.boolean().optional(),
  })
  .strict();

const BenchmarkPredictionSchema = z
  .object({
    handCount: z.union([z.literal(0), z.literal(1), z.literal(2)]),
    pinching: z.boolean(),
    primaryPointer: NormalizedPointSchema.optional(),
  })
  .strict();

export const SpatialVisionBenchmarkFrameSchema = z
  .object({
    frameIndex: z.number().int().nonnegative(),
    captureTimestampMs: z.number().finite().nonnegative(),
    inferenceStartedAtMs: z.number().finite().nonnegative(),
    inferenceCompletedAtMs: z.number().finite().nonnegative(),
    truth: BenchmarkTruthSchema,
    prediction: BenchmarkPredictionSchema,
  })
  .strict()
  .superRefine((frame, context) => {
    if (frame.inferenceStartedAtMs < frame.captureTimestampMs)
      context.addIssue({
        code: "custom",
        path: ["inferenceStartedAtMs"],
        message: "inference cannot start before capture",
      });
    if (frame.inferenceCompletedAtMs < frame.inferenceStartedAtMs)
      context.addIssue({
        code: "custom",
        path: ["inferenceCompletedAtMs"],
        message: "inference cannot finish before it starts",
      });
  });

const BenchmarkEngineSchema = z
  .object({
    id: z.string().trim().min(1),
    displayName: z.string().trim().min(1),
    role: z.enum(["default", "candidate", "fallback"]),
    runtime: z.string().trim().min(1),
    output: z.literal("hand-pose-keypoints"),
    keypointCount: z.literal(21),
    modelVersion: z.string().trim().min(1),
    licenseReview: z.enum([
      "verified-current-default",
      "verified-candidate",
      "unverified-do-not-ship",
    ]),
  })
  .strict();

const DeviceSchema = z
  .object({
    family: z.string().trim().min(1),
    model: z.string().trim().min(1),
    os: z.string().trim().min(1),
    browser: z.string().trim().min(1),
    browserVersion: z.string().trim().min(1),
  })
  .strict();

const CaptureSchema = z
  .object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    orientation: z.enum(["portrait", "landscape"]),
    camera: z.enum(["front", "rear"]),
  })
  .strict();

const RecordedSourceSchema = z
  .object({
    kind: z.literal("recorded"),
    recordingSha256: z.string().regex(/^[a-f0-9]{64}$/),
    device: DeviceSchema,
    capture: CaptureSchema,
  })
  .strict();

const LiveSourceSchema = z
  .object({
    kind: z.literal("live"),
    device: DeviceSchema,
    capture: CaptureSchema,
  })
  .strict();

export const SpatialVisionBenchmarkRunSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().trim().min(1),
    recordedAt: z.iso.datetime(),
    evidenceLevel: z.enum([
      "fixture",
      "recorded-target-device",
      "live-target-device",
    ]),
    protocolId: z.string().trim().min(1),
    engine: BenchmarkEngineSchema,
    source: z.discriminatedUnion("kind", [
      RecordedSourceSchema,
      LiveSourceSchema,
    ]),
    startupMs: z.number().finite().nonnegative(),
    modelBytes: z.number().int().nonnegative(),
    peakMemoryMb: z.number().finite().positive().nullable(),
    memoryNotes: z.string().trim().min(1),
    heatingNotes: z.string().trim().min(1),
    frames: z.array(SpatialVisionBenchmarkFrameSchema).min(1),
    notes: z.string().trim().min(1),
  })
  .strict()
  .superRefine((run, context) => {
    if (
      run.evidenceLevel === "recorded-target-device" &&
      run.source.kind !== "recorded"
    )
      context.addIssue({
        code: "custom",
        path: ["source", "kind"],
        message: "recorded target-device evidence requires a recorded source",
      });
    if (
      run.evidenceLevel === "live-target-device" &&
      run.source.kind !== "live"
    )
      context.addIssue({
        code: "custom",
        path: ["source", "kind"],
        message: "live target-device evidence requires a live source",
      });
    for (let index = 1; index < run.frames.length; index += 1) {
      const previous = run.frames[index - 1]!;
      const current = run.frames[index]!;
      if (
        current.frameIndex <= previous.frameIndex ||
        current.captureTimestampMs < previous.captureTimestampMs
      )
        context.addIssue({
          code: "custom",
          path: ["frames", index],
          message: "benchmark frames must be strictly ordered",
        });
    }
  });

export type SpatialVisionBenchmarkFrame = z.infer<
  typeof SpatialVisionBenchmarkFrameSchema
>;
export type SpatialVisionBenchmarkRun = z.infer<
  typeof SpatialVisionBenchmarkRunSchema
>;

export interface SpatialVisionBenchmarkMetrics {
  expectedHandFrames: number;
  acquiredHandFrames: number;
  acquisitionRate: number;
  trackingContinuityRate: number;
  pointerJitterRmseNormalized: number | null;
  twoHandExpectedFrames: number;
  twoHandTrackedFrames: number;
  twoHandContinuityRate: number | null;
  pinchLatencyMsMedian: number | null;
  pinchLatencyMsP95: number | null;
  missedPinches: number;
  falseGrabs: number;
  falseReleases: number;
  frameRateFps: number;
  inferenceLatencyMsP50: number;
  inferenceLatencyMsP95: number;
  startupMs: number;
  modelBytes: number;
  peakMemoryMb: number | null;
  memoryNotes: string;
  heatingNotes: string;
}

export function summarizeSpatialVisionBenchmarkRun(
  runInput: SpatialVisionBenchmarkRun,
): SpatialVisionBenchmarkMetrics {
  const run = SpatialVisionBenchmarkRunSchema.parse(runInput);
  const expectedHandFrames = run.frames.filter(
    (frame) => frame.truth.expectedHandCount > 0,
  );
  const acquiredHandFrames = expectedHandFrames.filter(
    (frame) => frame.prediction.handCount > 0,
  );
  let longestExpectedStreak = 0;
  let currentExpectedStreak = 0;
  let longestTrackedStreak = 0;
  let currentTrackedStreak = 0;
  for (const frame of run.frames) {
    if (frame.truth.expectedHandCount > 0) {
      currentExpectedStreak += 1;
      longestExpectedStreak = Math.max(
        longestExpectedStreak,
        currentExpectedStreak,
      );
      if (frame.prediction.handCount > 0) {
        currentTrackedStreak += 1;
        longestTrackedStreak = Math.max(
          longestTrackedStreak,
          currentTrackedStreak,
        );
      } else currentTrackedStreak = 0;
    } else {
      currentExpectedStreak = 0;
      currentTrackedStreak = 0;
    }
  }

  const jitterErrors = run.frames.flatMap((frame) => {
    const truth = frame.truth.primaryPointer;
    const prediction = frame.prediction.primaryPointer;
    if (!frame.truth.stationary || !truth || !prediction) return [];
    return [{ x: prediction.x - truth.x, y: prediction.y - truth.y }];
  });
  const meanError = jitterErrors.reduce(
    (sum, error) => ({ x: sum.x + error.x, y: sum.y + error.y }),
    { x: 0, y: 0 },
  );
  if (jitterErrors.length) {
    meanError.x /= jitterErrors.length;
    meanError.y /= jitterErrors.length;
  }
  const pointerJitterRmseNormalized = jitterErrors.length
    ? Math.sqrt(
        jitterErrors.reduce(
          (sum, error) =>
            sum +
            (error.x - meanError.x) ** 2 +
            (error.y - meanError.y) ** 2,
          0,
        ) / jitterErrors.length,
      )
    : null;

  const pinchLatencies: number[] = [];
  let missedPinches = 0;
  let falseGrabs = 0;
  let falseReleases = 0;
  let priorTruthPinch = false;
  let priorPredictedPinch = false;
  for (let index = 0; index < run.frames.length; index += 1) {
    const frame = run.frames[index]!;
    if (frame.prediction.pinching && !priorPredictedPinch && !frame.truth.pinching)
      falseGrabs += 1;
    if (!frame.prediction.pinching && priorPredictedPinch && frame.truth.pinching)
      falseReleases += 1;
    if (frame.truth.pinching && !priorTruthPinch) {
      const detected = run.frames
        .slice(index)
        .find(
          (candidate) =>
            candidate.truth.pinching && candidate.prediction.pinching,
        );
      if (detected)
        pinchLatencies.push(
          Math.max(0, detected.captureTimestampMs - frame.captureTimestampMs),
        );
      else missedPinches += 1;
    }
    priorTruthPinch = frame.truth.pinching;
    priorPredictedPinch = frame.prediction.pinching;
  }

  const twoHandFrames = run.frames.filter(
    (frame) => frame.truth.expectedHandCount === 2,
  );
  const twoHandTrackedFrames = twoHandFrames.filter(
    (frame) => frame.prediction.handCount === 2,
  );
  const firstCapture = run.frames[0]!.captureTimestampMs;
  const lastCapture = run.frames.at(-1)!.captureTimestampMs;
  const captureDurationSeconds = (lastCapture - firstCapture) / 1_000;
  const inferenceLatencies = run.frames.map(
    (frame) => frame.inferenceCompletedAtMs - frame.inferenceStartedAtMs,
  );

  return {
    expectedHandFrames: expectedHandFrames.length,
    acquiredHandFrames: acquiredHandFrames.length,
    acquisitionRate: ratio(acquiredHandFrames.length, expectedHandFrames.length),
    trackingContinuityRate:
      longestExpectedStreak === 0
        ? 0
        : rounded(longestTrackedStreak / longestExpectedStreak),
    pointerJitterRmseNormalized:
      pointerJitterRmseNormalized === null
        ? null
        : rounded(pointerJitterRmseNormalized),
    twoHandExpectedFrames: twoHandFrames.length,
    twoHandTrackedFrames: twoHandTrackedFrames.length,
    twoHandContinuityRate: twoHandFrames.length
      ? ratio(twoHandTrackedFrames.length, twoHandFrames.length)
      : null,
    pinchLatencyMsMedian: percentile(pinchLatencies, 0.5),
    pinchLatencyMsP95: percentile(pinchLatencies, 0.95),
    missedPinches,
    falseGrabs,
    falseReleases,
    frameRateFps:
      captureDurationSeconds > 0
        ? rounded((run.frames.length - 1) / captureDurationSeconds)
        : 0,
    inferenceLatencyMsP50: percentile(inferenceLatencies, 0.5) ?? 0,
    inferenceLatencyMsP95: percentile(inferenceLatencies, 0.95) ?? 0,
    startupMs: run.startupMs,
    modelBytes: run.modelBytes,
    peakMemoryMb: run.peakMemoryMb,
    memoryNotes: run.memoryNotes,
    heatingNotes: run.heatingNotes,
  };
}

type RecorderBase = Omit<
  SpatialVisionBenchmarkRun,
  | "frames"
  | "startupMs"
  | "peakMemoryMb"
  | "memoryNotes"
  | "heatingNotes"
  | "notes"
>;

export function createSpatialVisionBenchmarkRecorder(
  options: RecorderBase & {
    frames?: undefined;
    startupMs?: number;
    peakMemoryMb?: number | null;
    memoryNotes?: string;
    heatingNotes?: string;
    notes?: string;
    now?: () => number;
  },
) {
  const now = options.now ?? (() => performance.now());
  const startedAt = now();
  const frames: SpatialVisionBenchmarkFrame[] = [];
  return {
    recordFrame(
      frame: Omit<SpatialVisionBenchmarkFrame, "frameIndex">,
    ): void {
      frames.push(
        SpatialVisionBenchmarkFrameSchema.parse({
          ...frame,
          frameIndex: frames.length,
        }),
      );
    },
    complete(evidence: {
      peakMemoryMb: number | null;
      memoryNotes: string;
      heatingNotes: string;
      notes: string;
    }): SpatialVisionBenchmarkRun {
      const base: RecorderBase = {
        schemaVersion: options.schemaVersion,
        id: options.id,
        recordedAt: options.recordedAt,
        evidenceLevel: options.evidenceLevel,
        protocolId: options.protocolId,
        engine: options.engine,
        source: options.source,
        modelBytes: options.modelBytes,
      };
      const source =
        base.source.kind === "live"
          ? {
              kind: "live" as const,
              device: base.source.device,
              capture: base.source.capture,
            }
          : base.source;
      return SpatialVisionBenchmarkRunSchema.parse({
        ...base,
        source,
        startupMs: Math.max(0, now() - startedAt),
        peakMemoryMb: evidence.peakMemoryMb,
        memoryNotes: evidence.memoryNotes,
        heatingNotes: evidence.heatingNotes,
        notes: evidence.notes,
        frames,
      });
    },
  };
}

export type SpatialVisionBenchmarkComparison =
  | { comparable: false; reasons: string[] }
  | {
      comparable: true;
      baselineEngineId: string;
      candidateEngineId: string;
      metricDeltas: Record<string, number | null>;
      note: string;
    };

export function compareSpatialVisionBenchmarkRuns(
  baselineInput: SpatialVisionBenchmarkRun,
  candidateInput: SpatialVisionBenchmarkRun,
): SpatialVisionBenchmarkComparison {
  const baseline = SpatialVisionBenchmarkRunSchema.parse(baselineInput);
  const candidate = SpatialVisionBenchmarkRunSchema.parse(candidateInput);
  if (
    baseline.evidenceLevel === "fixture" ||
    candidate.evidenceLevel === "fixture"
  )
    return {
      comparable: false,
      reasons: ["fixture runs cannot support an engine replacement claim"],
    };
  if (baseline.protocolId !== candidate.protocolId)
    return {
      comparable: false,
      reasons: ["comparisons require the same scripted benchmark protocol"],
    };
  if (
    baseline.source.kind !== candidate.source.kind ||
    JSON.stringify(baseline.source.device) !==
      JSON.stringify(candidate.source.device) ||
    JSON.stringify(baseline.source.capture) !==
      JSON.stringify(candidate.source.capture)
  )
    return {
      comparable: false,
      reasons: ["comparisons require the same device and capture profile"],
    };
  if (
    baseline.source.kind === "recorded" &&
    candidate.source.kind === "recorded" &&
    baseline.source.recordingSha256 !== candidate.source.recordingSha256
  )
    return {
      comparable: false,
      reasons: ["recorded comparisons require the same source recording hash"],
    };

  const baselineMetrics = summarizeSpatialVisionBenchmarkRun(baseline);
  const candidateMetrics = summarizeSpatialVisionBenchmarkRun(candidate);
  const metricNames = [
    "acquisitionRate",
    "trackingContinuityRate",
    "pointerJitterRmseNormalized",
    "twoHandContinuityRate",
    "pinchLatencyMsMedian",
    "pinchLatencyMsP95",
    "missedPinches",
    "falseGrabs",
    "falseReleases",
    "frameRateFps",
    "inferenceLatencyMsP50",
    "inferenceLatencyMsP95",
    "startupMs",
    "modelBytes",
    "peakMemoryMb",
  ] as const satisfies readonly (keyof SpatialVisionBenchmarkMetrics)[];
  const metricDeltas: Record<string, number | null> = {};
  for (const metric of metricNames) {
    const baselineValue = baselineMetrics[metric];
    const candidateValue = candidateMetrics[metric];
    metricDeltas[metric] =
      typeof baselineValue === "number" && typeof candidateValue === "number"
        ? rounded(candidateValue - baselineValue)
        : null;
  }
  return {
    comparable: true,
    baselineEngineId: baseline.engine.id,
    candidateEngineId: candidate.engine.id,
    metricDeltas,
    note:
      "Deltas are candidate minus baseline. No aggregate score or automatic winner is inferred.",
  };
}

function ratio(numerator: number, denominator: number) {
  return denominator ? rounded(numerator / denominator) : 0;
}

function percentile(values: readonly number[], fraction: number) {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(fraction * sorted.length) - 1),
  );
  return rounded(sorted[index]!);
}

function rounded(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}
