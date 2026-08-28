export interface HandLandmark {
  readonly x: number;
  readonly y: number;
  readonly z?: number;
  /** Detector confidence for this keypoint. Missing means the detector has no per-keypoint score. */
  readonly visibility?: number;
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

export type HandIntentMode = "idle" | "point" | "pinch" | "open_palm";

export type HandFrameRefusal =
  | "malformed_frame"
  | "malformed_landmarks"
  | "low_confidence"
  | "stale_frame"
  | "future_frame"
  | "out_of_order_frame"
  | "low_keypoint_confidence"
  | "no_deliberate_gesture";

export type HandIntentOutput =
  | {
      readonly accepted: true;
      readonly mode: "point" | "pinch" | "open_palm";
      readonly pointer: NormalizedHandPointer;
      readonly confidence: number;
      readonly timestamp: number;
      readonly pinchDistance: number;
      /** Thumb-to-index distance divided by palm width. */
      readonly pinchRatio: number;
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
  readonly filteredPalmCenter: NormalizedHandPointer | null;
  readonly rawIndexTip: NormalizedHandPointer | null;
  readonly rawThumbTip: NormalizedHandPointer | null;
  readonly rawPalmCenter: NormalizedHandPointer | null;
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
  /** Current-sample weight once motion crosses the fast-motion threshold. */
  readonly fastMotionSmoothingAlpha: number;
  /** Normalized screen widths per second at which the filter stops adding lag. */
  readonly fastMotionThresholdPerSecond: number;
  /** A previously open hand engages pinch at or below this hand-scale ratio. */
  readonly pinchEngageRatio: number;
  /** A latched pinch releases at or above this larger hand-scale ratio. */
  readonly pinchReleaseRatio: number;
  /** Minimum confidence for a keypoint to initiate a pointer or pinch intent. */
  readonly minKeypointVisibility: number;
  readonly minConfidence: number;
  readonly maxFrameAgeMs: number;
  readonly maxFutureSkewMs: number;
  readonly mirrorX: boolean;
}

export const DEFAULT_HAND_INTENT_CONFIG: HandIntentConfig = Object.freeze({
  smoothingAlpha: 0.35,
  fastMotionSmoothingAlpha: 0.9,
  fastMotionThresholdPerSecond: 4,
  pinchEngageRatio: 0.28,
  pinchReleaseRatio: 0.5,
  minKeypointVisibility: 0.5,
  minConfidence: 0.5,
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
const PALM_CENTER_INDICES = [0, 5, 9, 13, 17] as const;

export function createInitialHandIntentState(): HandIntentState {
  return {
    filteredIndexTip: null,
    filteredThumbTip: null,
    filteredPalmCenter: null,
    rawIndexTip: null,
    rawThumbTip: null,
    rawPalmCenter: null,
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
  const rawPalmCenter = palmCenter(frame.landmarks, config.mirrorX);
  const elapsedSeconds = state.lastAcceptedTimestamp === null
    ? null
    : Math.max(0.001, (frame.timestamp - state.lastAcceptedTimestamp) / 1_000);
  const filteredIndexTip = smoothPoint(
    state.filteredIndexTip,
    state.rawIndexTip,
    rawIndexTip,
    elapsedSeconds,
    config,
  );
  const filteredThumbTip = smoothPoint(
    state.filteredThumbTip,
    state.rawThumbTip,
    rawThumbTip,
    elapsedSeconds,
    config,
  );
  const filteredPalmCenter = smoothPoint(
    state.filteredPalmCenter,
    state.rawPalmCenter,
    rawPalmCenter,
    elapsedSeconds,
    config,
  );
  const pinchDistance = rounded(
    Math.hypot(
      rawIndexTip.x - rawThumbTip.x,
      rawIndexTip.y - rawThumbTip.y,
    ),
  );
  const palmScale = estimatePalmScale(frame.landmarks);
  const pinchRatio = rounded(pinchDistance / palmScale);
  const thumbReliable =
    landmarkVisibility(frame.landmarks[THUMB_TIP_INDEX]) >=
    config.minKeypointVisibility;
  const indexReliable =
    landmarkVisibility(frame.landmarks[INDEX_TIP_INDEX]) >=
    config.minKeypointVisibility;
  const pinchKeypointsReliable = thumbReliable && indexReliable;
  const pinchLatched =
    pinchKeypointsReliable &&
    (state.pinchLatched
      ? pinchRatio < config.pinchReleaseRatio
      : pinchRatio <= config.pinchEngageRatio);
  const deliberatePoint =
    indexReliable && isDeliberateIndexPoint(frame.landmarks);
  const openPalm = indexReliable && isOpenPalm(frame.landmarks);
  if (!pinchLatched && !deliberatePoint && !openPalm)
    return refuse(
      !indexReliable ? "low_keypoint_confidence" : "no_deliberate_gesture",
      now,
      frame.timestamp,
      frame.confidence,
    );
  const activePointer = openPalm && !pinchLatched
    ? filteredPalmCenter
    : filteredIndexTip;
  const pointer = {
    x: rounded(activePointer.x),
    y: rounded(activePointer.y),
  };

  return {
    state: {
      filteredIndexTip: roundedPoint(filteredIndexTip),
      filteredThumbTip: {
        x: rounded(filteredThumbTip.x),
        y: rounded(filteredThumbTip.y),
      },
      filteredPalmCenter: {
        x: rounded(filteredPalmCenter.x),
        y: rounded(filteredPalmCenter.y),
      },
      rawIndexTip: roundedPoint(rawIndexTip),
      rawThumbTip: roundedPoint(rawThumbTip),
      rawPalmCenter: roundedPoint(rawPalmCenter),
      pinchLatched,
      lastAcceptedTimestamp: frame.timestamp,
    },
    output: {
      accepted: true,
      mode: pinchLatched ? "pinch" : openPalm ? "open_palm" : "point",
      pointer,
      confidence: frame.confidence,
      timestamp: frame.timestamp,
      pinchDistance,
      pinchRatio,
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

function isOpenPalm(landmarks: HandLandmarks) {
  const wrist = landmarks[WRIST_INDEX];
  const palmWidth = distance(landmarks[5], landmarks[17]);
  if (palmWidth < 0.02) return false;
  return [
    { pip: INDEX_PIP_INDEX, tip: INDEX_TIP_INDEX },
    ...OTHER_FINGER_JOINTS,
  ].every(
    ({ pip, tip }) => {
      const pipDistance = distance(wrist, landmarks[pip]);
      return distance(wrist, landmarks[tip]) >= pipDistance * 1.15;
    },
  );
}

function palmCenter(landmarks: HandLandmarks, mirrorX: boolean) {
  const total = PALM_CENTER_INDICES.reduce(
    (sum, index) => {
      const point = transformPoint(landmarks[index], mirrorX);
      return { x: sum.x + point.x, y: sum.y + point.y };
    },
    { x: 0, y: 0 },
  );
  return {
    x: total.x / PALM_CENTER_INDICES.length,
    y: total.y / PALM_CENTER_INDICES.length,
  };
}

function distance(left: HandLandmark, right: HandLandmark) {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function estimatePalmScale(landmarks: HandLandmarks) {
  // Palm width is intuitive but collapses when the hand turns side-on. Blend
  // it with wrist-to-MCP lengths so pinch remains stable across common camera
  // angles while still scaling with distance from the lens.
  const candidates = [
    distance(landmarks[5], landmarks[17]),
    distance(landmarks[0], landmarks[9]) * 0.9,
    distance(landmarks[0], landmarks[5]),
    distance(landmarks[0], landmarks[17]) * 0.7,
  ]
    .filter((value) => Number.isFinite(value) && value > 0.005)
    .sort((left, right) => left - right);
  if (candidates.length === 0) return 0.000_001;
  const midpoint = Math.floor(candidates.length / 2);
  return candidates.length % 2
    ? candidates[midpoint]!
    : (candidates[midpoint - 1]! + candidates[midpoint]!) / 2;
}

function resolveConfig(overrides: Partial<HandIntentConfig>): HandIntentConfig {
  const config = { ...DEFAULT_HAND_INTENT_CONFIG, ...overrides };
  if (
    !inRange(config.smoothingAlpha, Number.MIN_VALUE, 1) ||
    !inRange(config.fastMotionSmoothingAlpha, Number.MIN_VALUE, 1) ||
    !Number.isFinite(config.fastMotionThresholdPerSecond) ||
    config.fastMotionThresholdPerSecond <= 0 ||
    !inRange(config.pinchEngageRatio, Number.MIN_VALUE, 2) ||
    !inRange(config.pinchReleaseRatio, Number.MIN_VALUE, 3) ||
    config.pinchReleaseRatio <= config.pinchEngageRatio ||
    !inRange(config.minKeypointVisibility, 0, 1) ||
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
    (value.z === undefined || Number.isFinite(value.z)) &&
    (value.visibility === undefined || inRange(value.visibility, 0, 1))
  );
}

function landmarkVisibility(landmark: HandLandmark) {
  return landmark.visibility ?? 1;
}

function transformPoint(
  point: HandLandmark,
  mirrorX: boolean,
): NormalizedHandPointer {
  return { x: mirrorX ? 1 - point.x : point.x, y: point.y };
}

function smoothPoint(
  previous: NormalizedHandPointer | null,
  previousRaw: NormalizedHandPointer | null,
  current: NormalizedHandPointer,
  elapsedSeconds: number | null,
  config: HandIntentConfig,
): NormalizedHandPointer {
  if (previous === null) return current;
  const speed =
    previousRaw && elapsedSeconds
      ? Math.hypot(current.x - previousRaw.x, current.y - previousRaw.y) /
        elapsedSeconds
      : 0;
  const speedMix = Math.min(
    1,
    Math.max(0, speed / config.fastMotionThresholdPerSecond - 1),
  );
  const alpha =
    config.smoothingAlpha +
    speedMix *
      (Math.max(config.smoothingAlpha, config.fastMotionSmoothingAlpha) -
        config.smoothingAlpha);
  return {
    x: previous.x + alpha * (current.x - previous.x),
    y: previous.y + alpha * (current.y - previous.y),
  };
}

function roundedPoint(point: NormalizedHandPointer): NormalizedHandPointer {
  return { x: rounded(point.x), y: rounded(point.y) };
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
