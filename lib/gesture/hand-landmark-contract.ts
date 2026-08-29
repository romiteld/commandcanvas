export interface HandLandmark {
  readonly x: number;
  readonly y: number;
  readonly z?: number;
  /** Detector confidence for this keypoint. Missing means no score was supplied. */
  readonly visibility?: number;
}

/** MediaPipe-compatible landmark order, fixed to exactly one 21-point hand. */
export type RawHandLandmarks = readonly [
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

/** Backwards-compatible name used by the detector adapters. */
export type HandLandmarks = RawHandLandmarks;

export type HandEngineSource = string;
export type HandCaptureTimestamp = number;
export type HandReceiveTimestamp = number;
export type HandTrackId = string;
export type Handedness = "left" | "right" | "unknown";

export interface HandRoi {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface HandPredictionMarker {
  /** A predicted sample may render only; it is never eligible for semantics. */
  readonly predicted: boolean;
}

export interface HandMeasurementConfidence {
  readonly hand: number;
  readonly indexTip: number;
  readonly thumbTip: number;
}

export interface HandLandmarkSample extends HandPredictionMarker {
  readonly source: HandEngineSource;
  readonly capturedAt: HandCaptureTimestamp;
  readonly receivedAt: HandReceiveTimestamp;
  readonly trackId: HandTrackId;
  readonly handedness: Handedness;
  readonly roi: HandRoi | null;
  readonly landmarks: RawHandLandmarks;
  readonly confidence: HandMeasurementConfidence;
}

export interface NormalizedHandPoint {
  readonly x: number;
  readonly y: number;
}

export interface HandPhysicalMeasurements {
  readonly indexTip: NormalizedHandPoint;
  readonly thumbTip: NormalizedHandPoint;
  readonly pinchMidpoint: NormalizedHandPoint;
  readonly palmMcpCentroid: NormalizedHandPoint;
  readonly pinchDistance: number;
  readonly palmScale: number;
  readonly pinchRatio: number;
  readonly confidence: number;
  readonly indexTipConfidence: number;
  readonly thumbTipConfidence: number;
}

const THUMB_TIP_INDEX = 4;
const INDEX_TIP_INDEX = 8;
const PALM_MCP_INDICES = [0, 5, 9, 13, 17] as const;

/**
 * Derives physical hand measurements without assigning a gesture or choosing
 * a mode-specific pointer. Camera mirroring is applied exactly once here.
 */
export function measureHandLandmarks(
  landmarks: RawHandLandmarks,
  handConfidence: number,
  mirrorX = false,
): HandPhysicalMeasurements {
  const indexTip = transformPoint(landmarks[INDEX_TIP_INDEX], mirrorX);
  const thumbTip = transformPoint(landmarks[THUMB_TIP_INDEX], mirrorX);
  const palmMcpCentroid = centroid(landmarks, mirrorX);
  const pinchDistance = Math.hypot(
    indexTip.x - thumbTip.x,
    indexTip.y - thumbTip.y,
  );
  const palmScale = estimatePalmScale(landmarks);
  return {
    indexTip,
    thumbTip,
    pinchMidpoint: {
      x: (indexTip.x + thumbTip.x) / 2,
      y: (indexTip.y + thumbTip.y) / 2,
    },
    palmMcpCentroid,
    pinchDistance,
    palmScale,
    pinchRatio: pinchDistance / palmScale,
    confidence: handConfidence,
    indexTipConfidence: landmarkConfidence(landmarks[INDEX_TIP_INDEX]),
    thumbTipConfidence: landmarkConfidence(landmarks[THUMB_TIP_INDEX]),
  };
}

function transformPoint(point: HandLandmark, mirrorX: boolean): NormalizedHandPoint {
  return { x: mirrorX ? 1 - point.x : point.x, y: point.y };
}

function centroid(landmarks: RawHandLandmarks, mirrorX: boolean): NormalizedHandPoint {
  const total = PALM_MCP_INDICES.reduce(
    (sum, index) => {
      const point = transformPoint(landmarks[index], mirrorX);
      return { x: sum.x + point.x, y: sum.y + point.y };
    },
    { x: 0, y: 0 },
  );
  return {
    x: total.x / PALM_MCP_INDICES.length,
    y: total.y / PALM_MCP_INDICES.length,
  };
}

function estimatePalmScale(landmarks: RawHandLandmarks) {
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

function landmarkConfidence(landmark: HandLandmark) {
  return landmark.visibility ?? 1;
}

function distance(left: HandLandmark, right: HandLandmark) {
  return Math.hypot(left.x - right.x, left.y - right.y);
}
