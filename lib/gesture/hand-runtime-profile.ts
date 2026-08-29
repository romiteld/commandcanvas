export type HandRuntimeDropKind =
  | "superseded"
  | "late-capture"
  | "stale"
  | "before-encode"
  | "before-send";

export interface HandRuntimePercentiles {
  readonly p50: number;
  readonly p95: number;
}

export interface HandRuntimeMetricsSnapshot {
  readonly sampleCount: number;
  readonly deliveredRateHz: number | null;
  readonly captureLatencyMs: HandRuntimePercentiles | null;
  readonly processingLatencyMs: HandRuntimePercentiles | null;
  readonly encodeLatencyMs: HandRuntimePercentiles | null;
  readonly relayLatencyMs: HandRuntimePercentiles | null;
  readonly captureToReceiveMs: HandRuntimePercentiles | null;
  readonly captureToRenderMs: HandRuntimePercentiles | null;
  readonly droppedSuperseded: number;
  readonly droppedLateCapture: number;
  readonly droppedStale: number;
  readonly droppedBeforeEncode: number;
  readonly droppedBeforeSend: number;
}

export interface HandRuntimeResultSample {
  readonly capturedAtMs: number;
  readonly receivedAtMs: number;
  readonly captureLatencyMs?: number;
  readonly processingLatencyMs?: number;
  readonly encodeLatencyMs?: number;
  readonly relayLatencyMs?: number;
}

export type HandRuntimePreferenceChoice =
  | "retain-yolo"
  | "fallback-mediapipe";

export interface HandRuntimePreferenceIdentity {
  readonly engineId: string;
  readonly modelVersion: string;
  readonly deviceClass: "high-performance-gpu" | "gpu" | "cpu-or-unknown";
}

export interface HandRuntimePreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type HandRuntimeStartupDecision =
  | { readonly state: "pending"; readonly measuredSamples: number }
  | {
      readonly state: HandRuntimePreferenceChoice;
      readonly measuredSamples: number;
      readonly deliveredRateHz: number | null;
      readonly captureToReceiveP95Ms: number | null;
      readonly reason:
        | "startup-thresholds-met"
        | "startup-thresholds-missed"
        | "startup-insufficient-samples";
    };

export interface HandRuntimeProfile {
  recordResult(sample: HandRuntimeResultSample): boolean;
  recordDrop(kind: HandRuntimeDropKind, count?: number): boolean;
  acknowledgeRendered(capturedAtMs: number, renderedAtMs: number): boolean;
  snapshot(): HandRuntimeMetricsSnapshot;
  startupDecision(nowMs: number): HandRuntimeStartupDecision;
  shouldPublish(nowMs: number): boolean;
  savePreference(choice: HandRuntimePreferenceChoice): void;
  loadPreference(): HandRuntimePreferenceChoice | null;
}

export interface HandRuntimeProfileOptions {
  readonly startedAtMs: number;
  readonly maxSamples?: number;
  readonly publishIntervalMs?: number;
  readonly preferenceStorage?: HandRuntimePreferenceStorage;
  readonly preferenceIdentity?: HandRuntimePreferenceIdentity;
}

const WARMUP_RESULTS = 2;
const STARTUP_TARGET_SAMPLES = 12;
const STARTUP_MINIMUM_SAMPLES = 6;
const STARTUP_DEADLINE_MS = 1_200;
const MINIMUM_DELIVERED_RATE_HZ = 18;
const MAXIMUM_CAPTURE_TO_RECEIVE_P95_MS = 100;
const PREFERENCE_VERSION = 1;

export function createHandRuntimeProfile(
  options: HandRuntimeProfileOptions,
): HandRuntimeProfile {
  const maxSamples = positiveInteger(options.maxSamples, 60);
  const publishIntervalMs = finiteNonNegative(options.publishIntervalMs)
    ? options.publishIntervalMs!
    : 250;
  const results: RuntimeSample[] = [];
  const startupSamples: RuntimeSample[] = [];
  const renderSamples: number[] = [];
  const resultByCapture = new Map<number, RuntimeSample>();
  const drops = {
    superseded: 0,
    "late-capture": 0,
    stale: 0,
    "before-encode": 0,
    "before-send": 0,
  } satisfies Record<HandRuntimeDropKind, number>;
  let acceptedResults = 0;
  let lastPublishedAtMs = Number.NEGATIVE_INFINITY;

  return {
    recordResult(sample) {
      const normalized = normalizeSample(sample);
      if (!normalized) return false;
      acceptedResults += 1;
      pushBounded(results, normalized, maxSamples);
      resultByCapture.set(normalized.capturedAtMs, normalized);
      while (resultByCapture.size > maxSamples) {
        const oldest = resultByCapture.keys().next().value as number | undefined;
        if (oldest === undefined) break;
        resultByCapture.delete(oldest);
      }
      if (acceptedResults > WARMUP_RESULTS)
        pushBounded(startupSamples, normalized, STARTUP_TARGET_SAMPLES);
      return true;
    },
    recordDrop(kind, count = 1) {
      if (!Number.isSafeInteger(count) || count <= 0) return false;
      drops[kind] += count;
      return true;
    },
    acknowledgeRendered(capturedAtMs, renderedAtMs) {
      if (!finiteNonNegative(capturedAtMs) || !finiteNonNegative(renderedAtMs))
        return false;
      const source = resultByCapture.get(rounded(capturedAtMs));
      if (!source || renderedAtMs < source.capturedAtMs) return false;
      pushBounded(
        renderSamples,
        rounded(renderedAtMs - source.capturedAtMs),
        maxSamples,
      );
      return true;
    },
    snapshot() {
      return {
        sampleCount: results.length,
        deliveredRateHz: deliveredRate(results),
        captureLatencyMs: percentiles(
          results.flatMap((sample) => optionalNumber(sample.captureLatencyMs)),
        ),
        processingLatencyMs: percentiles(
          results.flatMap((sample) => optionalNumber(sample.processingLatencyMs)),
        ),
        encodeLatencyMs: percentiles(
          results.flatMap((sample) => optionalNumber(sample.encodeLatencyMs)),
        ),
        relayLatencyMs: percentiles(
          results.flatMap((sample) => optionalNumber(sample.relayLatencyMs)),
        ),
        captureToReceiveMs: percentiles(
          results.map((sample) => sample.captureToReceiveMs),
        ),
        captureToRenderMs: percentiles(renderSamples),
        droppedSuperseded: drops.superseded,
        droppedLateCapture: drops["late-capture"],
        droppedStale: drops.stale,
        droppedBeforeEncode: drops["before-encode"],
        droppedBeforeSend: drops["before-send"],
      };
    },
    startupDecision(nowMs) {
      const measuredSamples = startupSamples.length;
      const deadlineReached =
        finiteNonNegative(nowMs) && nowMs - options.startedAtMs >= STARTUP_DEADLINE_MS;
      if (measuredSamples < STARTUP_TARGET_SAMPLES && !deadlineReached)
        return { state: "pending", measuredSamples };
      const rate = deliveredRate(startupSamples);
      const tail = percentiles(
        startupSamples.map((sample) => sample.captureToReceiveMs),
      )?.p95 ?? null;
      if (measuredSamples < STARTUP_MINIMUM_SAMPLES)
        return {
          state: "fallback-mediapipe",
          measuredSamples,
          deliveredRateHz: rate,
          captureToReceiveP95Ms: tail,
          reason: "startup-insufficient-samples",
        };
      const retain =
        rate !== null &&
        rate >= MINIMUM_DELIVERED_RATE_HZ &&
        tail !== null &&
        tail <= MAXIMUM_CAPTURE_TO_RECEIVE_P95_MS;
      return {
        state: retain ? "retain-yolo" : "fallback-mediapipe",
        measuredSamples,
        deliveredRateHz: rate,
        captureToReceiveP95Ms: tail,
        reason: retain
          ? "startup-thresholds-met"
          : "startup-thresholds-missed",
      };
    },
    shouldPublish(nowMs) {
      if (!finiteNonNegative(nowMs)) return false;
      if (nowMs - lastPublishedAtMs < publishIntervalMs) return false;
      lastPublishedAtMs = nowMs;
      return true;
    },
    savePreference(choice) {
      const identity = options.preferenceIdentity;
      const storage = options.preferenceStorage;
      if (!identity || !storage || !validIdentity(identity)) return;
      try {
        storage.setItem(
          preferenceKey(identity),
          JSON.stringify({
            version: PREFERENCE_VERSION,
            engineId: identity.engineId,
            modelVersion: identity.modelVersion,
            deviceClass: identity.deviceClass,
            choice,
          }),
        );
      } catch {
        // A disabled or full session store must never interrupt camera input.
      }
    },
    loadPreference() {
      const identity = options.preferenceIdentity;
      const storage = options.preferenceStorage;
      if (!identity || !storage || !validIdentity(identity)) return null;
      let serialized: string | null;
      try {
        serialized = storage.getItem(preferenceKey(identity));
      } catch {
        return null;
      }
      if (!serialized) return null;
      try {
        const parsed = JSON.parse(serialized) as Record<string, unknown>;
        if (
          parsed.version !== PREFERENCE_VERSION ||
          parsed.engineId !== identity.engineId ||
          parsed.modelVersion !== identity.modelVersion ||
          parsed.deviceClass !== identity.deviceClass ||
          (parsed.choice !== "retain-yolo" &&
            parsed.choice !== "fallback-mediapipe")
        )
          return null;
        return parsed.choice;
      } catch {
        return null;
      }
    },
  };
}

interface RuntimeSample extends HandRuntimeResultSample {
  readonly captureToReceiveMs: number;
}

function normalizeSample(sample: HandRuntimeResultSample): RuntimeSample | null {
  if (
    !finiteNonNegative(sample.capturedAtMs) ||
    !finiteNonNegative(sample.receivedAtMs) ||
    sample.receivedAtMs < sample.capturedAtMs
  )
    return null;
  for (const value of [
    sample.captureLatencyMs,
    sample.processingLatencyMs,
    sample.encodeLatencyMs,
    sample.relayLatencyMs,
  ]) {
    if (value !== undefined && !finiteNonNegative(value)) return null;
  }
  return {
    ...sample,
    capturedAtMs: rounded(sample.capturedAtMs),
    receivedAtMs: rounded(sample.receivedAtMs),
    captureToReceiveMs: rounded(sample.receivedAtMs - sample.capturedAtMs),
  };
}

function deliveredRate(samples: readonly RuntimeSample[]) {
  if (samples.length < 2) return null;
  const first = samples[0]!.receivedAtMs;
  const last = samples.at(-1)!.receivedAtMs;
  const elapsed = last - first;
  if (elapsed <= 0) return null;
  return rounded(((samples.length - 1) * 1_000) / elapsed);
}

function percentiles(values: readonly number[]): HandRuntimePercentiles | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return {
    p50: nearestRank(sorted, 0.5),
    p95: nearestRank(sorted, 0.95),
  };
}

function nearestRank(sorted: readonly number[], percentile: number) {
  const index = Math.max(0, Math.ceil(percentile * sorted.length) - 1);
  return rounded(sorted[index]!);
}

function optionalNumber(value: number | undefined) {
  return value === undefined ? [] : [value];
}

function pushBounded<T>(target: T[], value: T, limit: number) {
  target.push(value);
  if (target.length > limit) target.splice(0, target.length - limit);
}

function finiteNonNegative(value: number | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function positiveInteger(value: number | undefined, fallback: number) {
  return Number.isSafeInteger(value) && value! > 0 ? value! : fallback;
}

function rounded(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function validIdentity(identity: HandRuntimePreferenceIdentity) {
  return (
    /^[a-z0-9._-]{1,96}$/i.test(identity.engineId) &&
    /^[a-z0-9._-]{1,96}$/i.test(identity.modelVersion)
  );
}

function preferenceKey(identity: HandRuntimePreferenceIdentity) {
  return [
    "commandcanvas.hand-runtime",
    `v${PREFERENCE_VERSION}`,
    identity.engineId,
    identity.modelVersion,
    identity.deviceClass,
  ].join(":");
}
