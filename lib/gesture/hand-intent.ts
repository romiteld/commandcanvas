export interface HandLandmark {
  readonly x: number;
  readonly y: number;
  readonly z?: number;
}

/** MediaPipe-compatible landmark order, fixed to exactly one 21-point hand. */
export type HandLandmarks = readonly [
  HandLandmark,
  HandLandmark,
  HandLandmark,
  HandLandmark,
  HandLandmark,
  HandLandmark,
  HandLandmark,
  HandLandmark,
  HandLandmark,
  HandLandmark,
  HandLandmark,
  HandLandmark,
  HandLandmark,
  HandLandmark,
  HandLandmark,
  HandLandmark,
  HandLandmark,
  HandLandmark,
  HandLandmark,
  HandLandmark,
  HandLandmark,
];

export interface HandFrame {
  readonly landmarks: HandLandmarks;
  readonly confidence: number;
  readonly timestamp: number;
}

export interface NormalizedHandPointer {
  readonly x: number;
  readonly y: number;
}

export type HandIntentMode = "idle" | "point" | "pinch";

export type HandFrameRefusal =
  | "malformed_frame"
  | "malformed_landmarks"
  | "low_confidence"
  | "stale_frame"
  | "future_frame"
  | "out_of_order_frame"
  | "no_deliberate_gesture";

export type HandIntentOutput =
  | {
      readonly accepted: true;
      readonly mode: "point" | "pinch";
      readonly pointer: NormalizedHandPointer;
      readonly confidence: number;
      readonly timestamp: number;
      readonly pinchDistance: number;
    }
  | {
      readonly accepted: false;
      readonly mode: "idle";
      readonly pointer: null;
      readonly confidence: number | null;
      readonly timestamp: number;
      readonly reason: HandFrameRefusal;
    };

export interface HandIntentState {
  readonly filteredIndexTip: NormalizedHandPointer | null;
  readonly filteredThumbTip: NormalizedHandPointer | null;
  readonly pinchLatched: boolean;
  readonly lastAcceptedTimestamp: number | null;
}

export interface HandIntentTransition {
  readonly state: HandIntentState;
  readonly output: HandIntentOutput;
}

export interface HandIntentConfig {
  /** Current-sample weight in the exponential moving average. */
  readonly smoothingAlpha: number;
  /** A previously open hand engages pinch at or below this distance. */
  readonly pinchEngageDistance: number;
  /** A latched pinch releases at or above this larger distance. */
  readonly pinchReleaseDistance: number;
  readonly minConfidence: number;
  readonly maxFrameAgeMs: number;
  readonly maxFutureSkewMs: number;
  readonly mirrorX: boolean;
}

export const DEFAULT_HAND_INTENT_CONFIG: HandIntentConfig = Object.freeze({
  smoothingAlpha: 0.35,
  pinchEngageDistance: 0.045,
  pinchReleaseDistance: 0.075,
  minConfidence: 0.75,
  maxFrameAgeMs: 160,
  maxFutureSkewMs: 50,
  mirrorX: false,
});

const THUMB_TIP_INDEX = 4;
const INDEX_TIP_INDEX = 8;
const WRIST_INDEX = 0;
const INDEX_PIP_INDEX = 6;
const OTHER_FINGER_JOINTS = [
  { pip: 10, tip: 12 },
  { pip: 14, tip: 16 },
  { pip: 18, tip: 20 },
] as const;

export function createInitialHandIntentState(): HandIntentState {
  return {
    filteredIndexTip: null,
    filteredThumbTip: null,
    pinchLatched: false,
    lastAcceptedTimestamp: null,
  };
}

/**
 * Pure frame reducer. The caller supplies both state and `now`, so identical
 * inputs always produce the same transition and no camera data leaves this
 * boundary.
 */
export function interpretHandFrame(
  state: HandIntentState,
  rawFrame: unknown,
  now: number,
  overrides: Partial<HandIntentConfig> = {},
): HandIntentTransition {
  const config = resolveConfig(overrides);
  const parsed = parseFrame(rawFrame);
  if (!parsed.ok)
    return refuse(parsed.reason, now, parsed.timestamp, parsed.confidence);

  const frame = parsed.frame;
  if (frame.confidence < config.minConfidence)
    return refuse(
      "low_confidence",
      now,
      frame.timestamp,
      frame.confidence,
    );
  if (now - frame.timestamp > config.maxFrameAgeMs)
    return refuse("stale_frame", now, frame.timestamp, frame.confidence);
  if (frame.timestamp - now > config.maxFutureSkewMs)
    return refuse("future_frame", now, frame.timestamp, frame.confidence);
  if (
    state.lastAcceptedTimestamp !== null &&
    frame.timestamp <= state.lastAcceptedTimestamp
  )
    return refuse(
      "out_of_order_frame",
      now,
      frame.timestamp,
      frame.confidence,
    );

  const rawIndexTip = transformPoint(
    frame.landmarks[INDEX_TIP_INDEX],
    config.mirrorX,
  );
  const rawThumbTip = transformPoint(
    frame.landmarks[THUMB_TIP_INDEX],
    config.mirrorX,
  );
  const filteredIndexTip = smoothPoint(
    state.filteredIndexTip,
    rawIndexTip,
    config.smoothingAlpha,
  );
  const filteredThumbTip = smoothPoint(
    state.filteredThumbTip,
    rawThumbTip,
    config.smoothingAlpha,
  );
  const pinchDistance = rounded(
    Math.hypot(
      filteredIndexTip.x - filteredThumbTip.x,
      filteredIndexTip.y - filteredThumbTip.y,
    ),
  );
  const pinchLatched = state.pinchLatched
    ? pinchDistance < config.pinchReleaseDistance
    : pinchDistance <= config.pinchEngageDistance;
  if (!pinchLatched && !isDeliberateIndexPoint(frame.landmarks))
    return refuse(
      "no_deliberate_gesture",
      now,
      frame.timestamp,
      frame.confidence,
    );
  const pointer = {
    x: rounded(filteredIndexTip.x),
    y: rounded(filteredIndexTip.y),
  };

  return {
    state: {
      filteredIndexTip: pointer,
      filteredThumbTip: {
        x: rounded(filteredThumbTip.x),
        y: rounded(filteredThumbTip.y),
      },
      pinchLatched,
      lastAcceptedTimestamp: frame.timestamp,
    },
    output: {
      accepted: true,
      mode: pinchLatched ? "pinch" : "point",
      pointer,
      confidence: frame.confidence,
      timestamp: frame.timestamp,
      pinchDistance,
    },
  };
}

function isDeliberateIndexPoint(landmarks: HandLandmarks) {
  const wrist = landmarks[WRIST_INDEX];
  const indexExtended =
    distance(wrist, landmarks[INDEX_TIP_INDEX]) >=
    distance(wrist, landmarks[INDEX_PIP_INDEX]) * 1.15;
  const foldedOtherFingers = OTHER_FINGER_JOINTS.filter(
    ({ pip, tip }) =>
      distance(wrist, landmarks[tip]) <=
      distance(wrist, landmarks[pip]) * 1.05,
  ).length;
  return indexExtended && foldedOtherFingers >= 2;
}

function distance(left: HandLandmark, right: HandLandmark) {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function resolveConfig(overrides: Partial<HandIntentConfig>): HandIntentConfig {
  const config = { ...DEFAULT_HAND_INTENT_CONFIG, ...overrides };
  if (
    !inRange(config.smoothingAlpha, Number.MIN_VALUE, 1) ||
    !inRange(config.pinchEngageDistance, Number.MIN_VALUE, Math.SQRT2) ||
    !inRange(config.pinchReleaseDistance, Number.MIN_VALUE, Math.SQRT2) ||
    config.pinchReleaseDistance <= config.pinchEngageDistance ||
    !inRange(config.minConfidence, 0, 1) ||
    !Number.isFinite(config.maxFrameAgeMs) ||
    config.maxFrameAgeMs < 0 ||
    !Number.isFinite(config.maxFutureSkewMs) ||
    config.maxFutureSkewMs < 0 ||
    typeof config.mirrorX !== "boolean"
  )
    throw new RangeError("Hand intent configuration is invalid.");
  return config;
}

type ParsedFrame =
  | { ok: true; frame: HandFrame }
  | {
      ok: false;
      reason: "malformed_frame" | "malformed_landmarks";
      timestamp: number | null;
      confidence: number | null;
    };

function parseFrame(rawFrame: unknown): ParsedFrame {
  if (!isRecord(rawFrame))
    return {
      ok: false,
      reason: "malformed_frame",
      timestamp: null,
      confidence: null,
    };
  const timestamp = finiteNonnegative(rawFrame.timestamp)
    ? rawFrame.timestamp
    : null;
  const confidence = inRange(rawFrame.confidence, 0, 1)
    ? rawFrame.confidence
    : null;
  if (timestamp === null || confidence === null)
    return {
      ok: false,
      reason: "malformed_frame",
      timestamp,
      confidence,
    };
  if (
    !Array.isArray(rawFrame.landmarks) ||
    rawFrame.landmarks.length !== 21 ||
    !rawFrame.landmarks.every(isLandmark)
  )
    return {
      ok: false,
      reason: "malformed_landmarks",
      timestamp,
      confidence,
    };

  return {
    ok: true,
    frame: {
      landmarks: rawFrame.landmarks as unknown as HandLandmarks,
      confidence,
      timestamp,
    },
  };
}

function isLandmark(value: unknown): value is HandLandmark {
  if (!isRecord(value)) return false;
  return (
    inRange(value.x, 0, 1) &&
    inRange(value.y, 0, 1) &&
    (value.z === undefined || Number.isFinite(value.z))
  );
}

function transformPoint(
  point: HandLandmark,
  mirrorX: boolean,
): NormalizedHandPointer {
  return { x: mirrorX ? 1 - point.x : point.x, y: point.y };
}

function smoothPoint(
  previous: NormalizedHandPointer | null,
  current: NormalizedHandPointer,
  alpha: number,
): NormalizedHandPointer {
  if (previous === null) return current;
  return {
    x: previous.x + alpha * (current.x - previous.x),
    y: previous.y + alpha * (current.y - previous.y),
  };
}

function refuse(
  reason: HandFrameRefusal,
  now: number,
  timestamp: number | null,
  confidence: number | null,
): HandIntentTransition {
  return {
    state: createInitialHandIntentState(),
    output: {
      accepted: false,
      mode: "idle",
      pointer: null,
      confidence,
      timestamp: timestamp ?? now,
      reason,
    },
  };
}

function finiteNonnegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function inRange(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function rounded(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}
