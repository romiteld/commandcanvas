export interface OneEuroFilterConfig {
  /** Lowest cutoff used while the signal is stationary, in hertz. */
  readonly minCutoff: number;
  /** Cutoff increase per filtered unit of speed. */
  readonly beta: number;
  /** Cutoff for the filtered derivative, in hertz. */
  readonly dCutoff: number;
}

export const DEFAULT_ONE_EURO_FILTER_CONFIG: OneEuroFilterConfig = Object.freeze({
  minCutoff: 1.0,
  beta: 0.007,
  dCutoff: 1.0,
});

export interface OneEuroScalarState {
  readonly value: number;
  readonly derivative: number;
  readonly timestamp: number;
}

export interface OneEuroPoint {
  readonly x: number;
  readonly y: number;
}

export interface OneEuroPointState {
  readonly x: OneEuroScalarState;
  readonly y: OneEuroScalarState;
}

export interface OneEuroScalarTransition {
  readonly state: OneEuroScalarState;
  readonly value: number;
}

export interface OneEuroPointTransition {
  readonly state: OneEuroPointState;
  readonly value: OneEuroPoint;
}

/**
 * Timestamp-aware One Euro low-pass filter. The state is data rather than a
 * mutable instance so the hand reducer stays replayable and deterministic.
 */
export function filterOneEuroScalar(
  previous: OneEuroScalarState | null,
  value: number,
  timestamp: number,
  overrides: Partial<OneEuroFilterConfig> = {},
): OneEuroScalarTransition {
  const config = resolveConfig(overrides);
  assertFinite(value, "One Euro sample");
  assertFiniteNonnegative(timestamp, "One Euro timestamp");
  if (!previous)
    return {
      state: { value, derivative: 0, timestamp },
      value,
    };

  const elapsedSeconds = Math.max(0.001, (timestamp - previous.timestamp) / 1_000);
  const rawDerivative = (value - previous.value) / elapsedSeconds;
  const derivative = lowPass(
    rawDerivative,
    previous.derivative,
    smoothingFactor(elapsedSeconds, config.dCutoff),
  );
  const filtered = lowPass(
    value,
    previous.value,
    smoothingFactor(
      elapsedSeconds,
      config.minCutoff + config.beta * Math.abs(derivative),
    ),
  );
  return {
    state: { value: filtered, derivative, timestamp },
    value: filtered,
  };
}

export function filterOneEuroPoint(
  previous: OneEuroPointState | null,
  value: OneEuroPoint,
  timestamp: number,
  overrides: Partial<OneEuroFilterConfig> = {},
): OneEuroPointTransition {
  const x = filterOneEuroScalar(previous?.x ?? null, value.x, timestamp, overrides);
  const y = filterOneEuroScalar(previous?.y ?? null, value.y, timestamp, overrides);
  return {
    state: { x: x.state, y: y.state },
    value: { x: x.value, y: y.value },
  };
}

function resolveConfig(overrides: Partial<OneEuroFilterConfig>): OneEuroFilterConfig {
  const config = { ...DEFAULT_ONE_EURO_FILTER_CONFIG, ...overrides };
  if (
    !Number.isFinite(config.minCutoff) ||
    config.minCutoff <= 0 ||
    !Number.isFinite(config.beta) ||
    config.beta < 0 ||
    !Number.isFinite(config.dCutoff) ||
    config.dCutoff <= 0
  )
    throw new RangeError("One Euro filter configuration is invalid.");
  return config;
}

function smoothingFactor(elapsedSeconds: number, cutoff: number) {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / elapsedSeconds);
}

function lowPass(value: number, previous: number, alpha: number) {
  return alpha * value + (1 - alpha) * previous;
}

function assertFinite(value: number, name: string) {
  if (!Number.isFinite(value)) throw new RangeError(`${name} must be finite.`);
}

function assertFiniteNonnegative(value: number, name: string) {
  if (!Number.isFinite(value) || value < 0)
    throw new RangeError(`${name} must be finite and non-negative.`);
}
