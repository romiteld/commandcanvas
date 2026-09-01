import {
  measureHandLandmarks,
  type HandEngineSource,
  type HandLandmark,
  type HandLandmarkSample,
  type HandLandmarks,
  type HandPhysicalMeasurements,
  type HandPredictionMarker,
  type HandReceiveTimestamp,
  type HandRoi,
  type HandTrackId,
  type Handedness,
  type NormalizedHandPoint,
} from "@/lib/gesture/hand-landmark-contract";
import {
  filterOneEuroPoint,
  type OneEuroPointState,
} from "@/lib/gesture/one-euro-filter";

export type {
  HandEngineSource,
  HandLandmark,
  HandLandmarkSample,
  HandLandmarks,
  HandPhysicalMeasurements,
  HandPredictionMarker,
  HandReceiveTimestamp,
  HandRoi,
  HandTrackId,
  Handedness,
};

export interface HandFrame {
  readonly landmarks: HandLandmarks;
  readonly confidence: number;
  /** Capture timestamp from the source clock, in milliseconds. */
  readonly timestamp: number;
  readonly source?: HandEngineSource;
  readonly receivedAt?: HandReceiveTimestamp;
  readonly trackId?: HandTrackId;
  readonly handedness?: Handedness;
  readonly roi?: HandRoi | null;
  readonly predicted?: boolean;
}

export type NormalizedHandPointer = NormalizedHandPoint;

export type HandIntentMode = "idle" | "point" | "pinch" | "open_palm";

export type HandFrameRefusal =
  | "malformed_frame"
  | "malformed_landmarks"
  | "low_confidence"
  | "stale_frame"
  | "future_frame"
  | "out_of_order_frame"
  | "low_keypoint_confidence"
  | "predicted_sample"
  | "no_deliberate_gesture";

export type HandIntentOutput =
  | {
      readonly accepted: true;
      readonly mode: "point" | "pinch" | "open_palm";
      readonly pointer: NormalizedHandPointer;
      /** Filtered palm center used for stable held-object motion. */
      readonly motionPointer: NormalizedHandPointer;
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
  readonly indexTipFilter: OneEuroPointState | null;
  readonly thumbTipFilter: OneEuroPointState | null;
  readonly palmCenterFilter: OneEuroPointState | null;
  readonly pinchLatched: boolean;
  readonly lastAcceptedTimestamp: number | null;
}

export interface HandIntentTransition {
  readonly state: HandIntentState;
  readonly output: HandIntentOutput;
  /** Physical geometry, intentionally independent of the semantic mode. */
  readonly measurements: HandPhysicalMeasurements | null;
  readonly prediction: HandPredictionMarker;
}

export interface HandIntentConfig {
  /** @deprecated Position smoothing is now timestamp-aware One Euro filtering. */
  readonly smoothingAlpha: number;
  /** @deprecated Position smoothing is now timestamp-aware One Euro filtering. */
  readonly fastMotionSmoothingAlpha: number;
  /** @deprecated Position smoothing is now timestamp-aware One Euro filtering. */
  readonly fastMotionThresholdPerSecond: number;
  readonly oneEuroMinCutoff: number;
  readonly oneEuroBeta: number;
  readonly oneEuroDCutoff: number;
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
  oneEuroMinCutoff: 1.0,
  // Normalized image coordinates need materially more speed adaptation than
  // the scalar reference default: fine jitter stays damped while a deliberate
  // cross-canvas sweep catches up within the next frame.
  oneEuroBeta: 4,
  oneEuroDCutoff: 1.0,
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
const INDEX_MCP_INDEX = 5;
const INDEX_PIP_INDEX = 6;
const INDEX_DIP_INDEX = 7;
const INDEX_FINGER_JOINTS = [
  INDEX_MCP_INDEX,
  INDEX_PIP_INDEX,
  INDEX_DIP_INDEX,
  INDEX_TIP_INDEX,
] as const;
const OTHER_FINGER_JOINTS = [
  { pip: 10, tip: 12 },
  { pip: 14, tip: 16 },
  { pip: 18, tip: 20 },
] as const;
const DELIBERATE_POINT_LANDMARK_INDICES = [
  WRIST_INDEX,
  ...INDEX_FINGER_JOINTS,
  10,
  12,
  14,
  16,
  18,
  20,
] as const;
const OPEN_PALM_LANDMARK_INDICES = [
  WRIST_INDEX,
  5,
  INDEX_PIP_INDEX,
  INDEX_TIP_INDEX,
  10,
  12,
  14,
  16,
  17,
  18,
  20,
] as const;

export function createInitialHandIntentState(): HandIntentState {
  return {
    filteredIndexTip: null,
    filteredThumbTip: null,
    filteredPalmCenter: null,
    rawIndexTip: null,
    rawThumbTip: null,
    rawPalmCenter: null,
    indexTipFilter: null,
    thumbTipFilter: null,
    palmCenterFilter: null,
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

  if (frame.predicted)
    return refuse(
      "predicted_sample",
      now,
      frame.timestamp,
      frame.confidence,
      { predicted: true },
      state,
    );

  const physical = measureHandLandmarks(
    frame.landmarks,
    frame.confidence,
    config.mirrorX,
  );
  const rawIndexTip = physical.indexTip;
  const rawThumbTip = physical.thumbTip;
  const rawPalmCenter = physical.palmMcpCentroid;
  const filterConfig = {
    minCutoff: config.oneEuroMinCutoff,
    beta: config.oneEuroBeta,
    dCutoff: config.oneEuroDCutoff,
  } as const;
  const indexFilter = filterOneEuroPoint(
    state.indexTipFilter,
    rawIndexTip,
    frame.timestamp,
    filterConfig,
  );
  const thumbFilter = filterOneEuroPoint(
    state.thumbTipFilter,
    rawThumbTip,
    frame.timestamp,
    filterConfig,
  );
  const palmCenterFilter = filterOneEuroPoint(
    state.palmCenterFilter,
    rawPalmCenter,
    frame.timestamp,
    filterConfig,
  );
  const filteredIndexTip = indexFilter.value;
  const filteredThumbTip = thumbFilter.value;
  const filteredPalmCenter = palmCenterFilter.value;
  const pinchDistance = rounded(physical.pinchDistance);
  const pinchRatio = rounded(pinchDistance / physical.palmScale);
  const thumbReliable =
    landmarkVisibility(frame.landmarks[THUMB_TIP_INDEX]) >=
    config.minKeypointVisibility;
  const indexReliable =
    landmarkVisibility(frame.landmarks[INDEX_TIP_INDEX]) >=
    config.minKeypointVisibility;
  const pinchKeypointsReliable = thumbReliable && indexReliable;
  const pinchLatched =
    pinchKeypointsReliable
      ? state.pinchLatched
        ? pinchRatio < config.pinchReleaseRatio
        : pinchRatio <= config.pinchEngageRatio
      : state.pinchLatched;
  const openPalm =
    indexReliable &&
    hasReliableOpenPalmLandmarks(
      frame.landmarks,
      config.minKeypointVisibility,
    ) &&
    isOpenPalm(frame.landmarks);
  if (!indexReliable)
    return refuse(
      "low_keypoint_confidence",
      now,
      frame.timestamp,
      frame.confidence,
    );
  const pointer = {
    x: rounded(filteredIndexTip.x),
    y: rounded(filteredIndexTip.y),
  };
  const motionPointer = roundedPoint(filteredPalmCenter);
  const nextState: HandIntentState = {
    filteredIndexTip: roundedPoint(filteredIndexTip),
    filteredThumbTip: roundedPoint(filteredThumbTip),
    filteredPalmCenter: motionPointer,
    rawIndexTip: roundedPoint(rawIndexTip),
    rawThumbTip: roundedPoint(rawThumbTip),
    rawPalmCenter: roundedPoint(rawPalmCenter),
    indexTipFilter: indexFilter.state,
    thumbTipFilter: thumbFilter.state,
    palmCenterFilter: palmCenterFilter.state,
    pinchLatched,
    lastAcceptedTimestamp: frame.timestamp,
  };
  const deliberatePoint =
    hasReliableDeliberatePointLandmarks(
      frame.landmarks,
      config.minKeypointVisibility,
    ) &&
    isIndexExtended(frame.landmarks) &&
    areOtherFingersRelaxedForPoint(frame.landmarks);
  if (!pinchLatched && !openPalm && !deliberatePoint)
    return refuse(
      "no_deliberate_gesture",
      now,
      frame.timestamp,
      frame.confidence,
      { predicted: false },
      nextState,
      roundedMeasurements(physical),
    );

  return {
    state: nextState,
    output: {
      accepted: true,
      mode: pinchLatched ? "pinch" : openPalm ? "open_palm" : "point",
      pointer,
      motionPointer,
      confidence: frame.confidence,
      timestamp: frame.timestamp,
      pinchDistance,
      pinchRatio,
    },
    measurements: roundedMeasurements(physical),
    prediction: { predicted: false },
  };
}

function isIndexExtended(landmarks: HandLandmarks) {
  const wrist = landmarks[WRIST_INDEX];
  const pipDistance = distance(wrist, landmarks[INDEX_PIP_INDEX]);
  const indexPathLength =
    distance(landmarks[INDEX_MCP_INDEX], landmarks[INDEX_PIP_INDEX]) +
    distance(landmarks[INDEX_PIP_INDEX], landmarks[INDEX_DIP_INDEX]) +
    distance(landmarks[INDEX_DIP_INDEX], landmarks[INDEX_TIP_INDEX]);
  const indexReach = distance(
    landmarks[INDEX_MCP_INDEX],
    landmarks[INDEX_TIP_INDEX],
  );
  return (
    pipDistance >= 0.02 &&
    distance(wrist, landmarks[INDEX_TIP_INDEX]) >= pipDistance * 1.15 &&
    indexReach >= indexPathLength * 0.86
  );
}

function hasReliableDeliberatePointLandmarks(
  landmarks: HandLandmarks,
  minimumVisibility: number,
) {
  return DELIBERATE_POINT_LANDMARK_INDICES.every(
    (index) => landmarkVisibility(landmarks[index]) >= minimumVisibility,
  );
}

function areOtherFingersRelaxedForPoint(landmarks: HandLandmarks) {
  const wrist = landmarks[WRIST_INDEX];
  // A drawing hand rarely makes a tight pointing fist. Support fingers may be
  // partially curled, but each must remain short of the extension ratio that
  // defines an open palm. This preserves index-led ink without palm ink.
  return OTHER_FINGER_JOINTS.every(
    ({ pip, tip }) =>
      distance(wrist, landmarks[tip]) < distance(wrist, landmarks[pip]) * 1.15,
  );
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

/** Strict calibration pose: every landmark must be present/reliable and all fingers open. */
export function isOpenPalmCalibrationPose(
  landmarks: HandLandmarks,
  minimumVisibility = DEFAULT_HAND_INTENT_CONFIG.minKeypointVisibility,
) {
  return (
    Array.isArray(landmarks) &&
    landmarks.length === 21 &&
    Number.isFinite(minimumVisibility) &&
    minimumVisibility >= 0 &&
    minimumVisibility <= 1 &&
    landmarks.every(
      (landmark) => landmarkVisibility(landmark) >= minimumVisibility,
    ) &&
    isOpenPalm(landmarks)
  );
}

function hasReliableOpenPalmLandmarks(
  landmarks: HandLandmarks,
  minimumVisibility: number,
) {
  return OPEN_PALM_LANDMARK_INDICES.every(
    (index) => landmarkVisibility(landmarks[index]) >= minimumVisibility,
  );
}

function distance(left: HandLandmark, right: HandLandmark) {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function resolveConfig(overrides: Partial<HandIntentConfig>): HandIntentConfig {
  const config = { ...DEFAULT_HAND_INTENT_CONFIG, ...overrides };
  if (
    !inRange(config.smoothingAlpha, Number.MIN_VALUE, 1) ||
    !inRange(config.fastMotionSmoothingAlpha, Number.MIN_VALUE, 1) ||
    !Number.isFinite(config.fastMotionThresholdPerSecond) ||
    config.fastMotionThresholdPerSecond <= 0 ||
    !Number.isFinite(config.oneEuroMinCutoff) ||
    config.oneEuroMinCutoff <= 0 ||
    !Number.isFinite(config.oneEuroBeta) ||
    config.oneEuroBeta < 0 ||
    !Number.isFinite(config.oneEuroDCutoff) ||
    config.oneEuroDCutoff <= 0 ||
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
      ...(rawFrame.source === undefined || typeof rawFrame.source === "string"
        ? { source: rawFrame.source }
        : {}),
      ...(finiteNonnegative(rawFrame.receivedAt)
        ? { receivedAt: rawFrame.receivedAt }
        : {}),
      ...(typeof rawFrame.trackId === "string" ? { trackId: rawFrame.trackId } : {}),
      ...(rawFrame.handedness === "left" ||
      rawFrame.handedness === "right" ||
      rawFrame.handedness === "unknown"
        ? { handedness: rawFrame.handedness }
        : {}),
      ...(isRoi(rawFrame.roi) || rawFrame.roi === null ? { roi: rawFrame.roi } : {}),
      ...(rawFrame.predicted === true ? { predicted: true } : {}),
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

function roundedPoint(point: NormalizedHandPointer): NormalizedHandPointer {
  return { x: rounded(point.x), y: rounded(point.y) };
}

function refuse(
  reason: HandFrameRefusal,
  now: number,
  timestamp: number | null,
  confidence: number | null,
  prediction: HandPredictionMarker = { predicted: false },
  state: HandIntentState = createInitialHandIntentState(),
  measurements: HandPhysicalMeasurements | null = null,
): HandIntentTransition {
  return {
    state,
    output: {
      accepted: false,
      mode: "idle",
      pointer: null,
      confidence,
      timestamp: timestamp ?? now,
      reason,
    },
    measurements,
    prediction,
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

function isRoi(value: unknown): value is HandRoi {
  if (!isRecord(value)) return false;
  return (
    inRange(value.x, 0, 1) &&
    inRange(value.y, 0, 1) &&
    inRange(value.width, 0, 1) &&
    inRange(value.height, 0, 1)
  );
}

function roundedMeasurements(
  measurements: HandPhysicalMeasurements,
): HandPhysicalMeasurements {
  return {
    ...measurements,
    indexTip: roundedPoint(measurements.indexTip),
    thumbTip: roundedPoint(measurements.thumbTip),
    pinchMidpoint: roundedPoint(measurements.pinchMidpoint),
    palmMcpCentroid: roundedPoint(measurements.palmMcpCentroid),
    pinchDistance: rounded(measurements.pinchDistance),
    palmScale: rounded(measurements.palmScale),
    pinchRatio: rounded(rounded(measurements.pinchDistance) / measurements.palmScale),
    confidence: rounded(measurements.confidence),
    indexTipConfidence: rounded(measurements.indexTipConfidence),
    thumbTipConfidence: rounded(measurements.thumbTipConfidence),
  };
}

function rounded(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}
