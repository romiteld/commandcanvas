export interface NormalizedPoint {
  readonly x: number;
  readonly y: number;
}

export interface NormalizedRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Session/device-specific input calibration. It deliberately contains no canvas state. */
export interface HandCalibrationProfile {
  readonly deviceKey: string;
  readonly cameraBounds: NormalizedRect;
  readonly safeCanvasInsetPx: number;
  readonly pinchClosedRatio: number;
  readonly pinchOpenRatio: number;
  readonly mirrorX: boolean;
  readonly createdAt: number;
  /** Robust 2D open-hand reference. This is geometry, not depth or mass. */
  readonly openPalmBaseline?: OpenPalmCalibrationBaseline;
}

export interface OpenPalmCalibrationSample {
  readonly center: NormalizedPoint;
  /** Observed palm width in normalized camera coordinates. */
  readonly palmScale: number;
  readonly pinchDistance: number;
  /** Wrist-to-middle-MCP axis in image-space radians. */
  readonly orientationRadians: number;
  readonly confidence: number;
}

export interface OpenPalmCalibrationBaseline {
  readonly center: NormalizedPoint;
  readonly palmScale: number;
  readonly openPinchRatio: number;
  readonly orientationRadians: number;
  readonly confidence: number;
  readonly sampleCount: number;
  readonly envelope: NormalizedRect;
}

export type OpenPalmCalibrationResult =
  | { readonly accepted: true; readonly baseline: OpenPalmCalibrationBaseline }
  | { readonly accepted: false; readonly reason: "open_palm_not_established" };

export interface HandCalibrationSamples {
  readonly deviceKey: string;
  readonly mirrorX: boolean;
  readonly createdAt: number;
  readonly reachSamples: readonly NormalizedPoint[];
  readonly closedPinchRatios: readonly number[];
  readonly openPinchRatios: readonly number[];
  /** Present for the deliberate open-palm-first calibration flow. */
  readonly openPalmSamples?: readonly OpenPalmCalibrationSample[];
}

export type HandCalibrationResult =
  | { readonly accepted: true; readonly profile: HandCalibrationProfile }
  | {
      readonly accepted: false;
      readonly reason:
        | "insufficient_reach"
        | "reach_too_small"
        | "reach_too_large"
        | "pinch_not_separated"
        | "open_palm_not_established";
      readonly profile: HandCalibrationProfile;
    };

export type HandCalibrationReachResult =
  | {
      readonly accepted: true;
      readonly cameraBounds: NormalizedRect;
    }
  | {
      readonly accepted: false;
      readonly reason: "insufficient_reach" | "reach_too_small" | "reach_too_large";
    };

export type HandControlGainState =
  | "hover"
  | "target"
  | "held"
  | "draw"
  | "two_hand";

export interface CanvasBounds {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface MappedHandPointer {
  readonly point: { readonly x: number; readonly y: number };
  readonly normalized: NormalizedPoint;
  readonly gain: number;
}

export interface CalibratedPinchThresholds {
  readonly engage: number;
  readonly release: number;
}

export interface PinchVoteInput {
  readonly timestamp: number;
  readonly confidence: number;
  readonly indexTipConfidence: number;
  readonly thumbTipConfidence: number;
  readonly predicted: boolean;
  readonly pinchRatio: number;
}

export interface PinchVoteState {
  readonly pinched: boolean;
  readonly recentConfidentRatios: readonly {
    readonly timestamp: number;
    readonly pinchRatio: number;
  }[];
  readonly lastConfidentAt: number | null;
  /** Latest observed pinch sample, including uncertainty that did not vote. */
  readonly lastEvidenceTimestamp: number | null;
}

export interface PinchVoteSnapshot {
  readonly pinched: boolean;
  readonly candidate: "engage" | "release" | null;
  readonly transition: "engaged" | "released" | null;
  /** Non-strictly-newer evidence was refused without advancing temporal state. */
  readonly ignored: boolean;
}

export interface PinchVoteTransition {
  readonly state: PinchVoteState;
  readonly snapshot: PinchVoteSnapshot;
}

export interface HandReliabilityHandInput {
  readonly trackId: string;
  readonly handedness: "left" | "right" | "unknown";
  /** Canvas-space CSS pixels, used only to enforce safe reacquisition. */
  readonly pointer: { readonly x: number; readonly y: number };
  readonly confidence: number;
  /** Task 1 provenance: pointer validity is independent of aggregate confidence. */
  readonly indexTipConfidence: number;
  /** Task 1 provenance: pinch requires real thumb evidence as well as index evidence. */
  readonly thumbTipConfidence: number;
  readonly predicted: boolean;
  readonly pinchRatio: number;
}

export interface HandReliabilityFrame {
  readonly timestamp: number;
  readonly hands: readonly HandReliabilityHandInput[];
}

export type HandReliabilityTrackingState =
  | "tracked"
  | "uncertain"
  | "reacquire"
  | "released";

export interface HandReliabilityState {
  readonly activeHandId: string | null;
  readonly lastValid: {
    readonly trackId: string;
    readonly pointer: { readonly x: number; readonly y: number };
    readonly timestamp: number;
  } | null;
  readonly lossStartedAt: number | null;
  /** Latest frame accepted by this reducer; duplicate/older frames cannot rewind it. */
  readonly lastEvidenceTimestamp: number | null;
  readonly pinchVote: PinchVoteState;
  /** Per-track timestamps are additive provenance for one- and two-hand consumers. */
  readonly handLastValidAt: Readonly<Record<string, number>>;
}

export interface HandReliabilityHandSnapshot {
  readonly trackId: string;
  readonly handedness: "left" | "right" | "unknown";
  readonly confidence: number;
  readonly indexTipConfidence: number;
  readonly thumbTipConfidence: number;
  readonly predicted: boolean;
  readonly real: boolean;
  readonly trackingState: HandReliabilityTrackingState;
  readonly isActive: boolean;
  readonly observedAt: number;
  readonly lastValidAt: number | null;
  readonly lossStartedAt: number | null;
}

export interface HandReliabilitySnapshot {
  readonly activeHandId: string | null;
  readonly activeHand: HandReliabilityHandSnapshot | null;
  readonly hands: readonly HandReliabilityHandSnapshot[];
  readonly trackingState: HandReliabilityTrackingState;
  readonly pinch: PinchVoteSnapshot;
  readonly lastValidAt: number | null;
  readonly lossStartedAt: number | null;
  readonly release: {
    readonly point: { readonly x: number; readonly y: number };
    readonly lastValidAt: number;
    readonly releasedAt: number;
  } | null;
  readonly ignored: boolean;
  /** Task 2 never promotes loss to an edge operation; Task 3 owns edge gates. */
  readonly edgeAction: null;
}

export interface HandReliabilityTransition {
  readonly state: HandReliabilityState;
  readonly snapshot: HandReliabilitySnapshot;
}

const SAFE_CANVAS_INSET_PX = 24;
const FALLBACK_CAMERA_BOUNDS: NormalizedRect = Object.freeze({
  x: 0.15,
  y: 0.12,
  width: 0.7,
  height: 0.76,
});
const FALLBACK_CLOSED_PINCH_RATIO = 0.28;
const FALLBACK_OPEN_PINCH_RATIO = 0.68;
const CAMERA_BOUND_EXPANSION = 0.05;
const DEFAULT_EDGE_EXTRAPOLATION_FRACTION = 0.1;
// A comfortable central reach should map to the whole canvas. Requiring nearly
// half of the camera frame forced users to leave the ergonomic interaction zone.
const MIN_CAMERA_SPAN = 0.18;
const MAX_CAMERA_HORIZONTAL_SPAN = 0.8;
const MAX_CAMERA_VERTICAL_SPAN = 0.85;
const PINCH_MIN_CONFIDENCE = 0.5;
const PINCH_VOTE_MIN_WINDOW_MS = 100;
const PINCH_VOTE_MAX_WINDOW_MS = 360;
const PINCH_VOTE_CADENCE_MULTIPLIER = 2.5;
const PINCH_VOTE_COUNT = 2;
const PINCH_HISTORY_SIZE = 3;
const REACQUIRE_FREEZE_MS = 120;
const REACQUIRE_VISIBLE_MS = 150;
const REACQUIRE_TIMEOUT_MS = 300;
const REACQUIRE_MAX_DISTANCE_PX = 120;

/**
 * Produces a reach profile from the robust central ninety percent of samples.
 * Refusal is non-fatal: consumers receive the documented ergonomic fallback.
 */
export function buildHandCalibration(
  samples: HandCalibrationSamples,
): HandCalibrationResult {
  const fallback = createFallbackHandCalibration(samples);
  const openPalm =
    samples.openPalmSamples === undefined
      ? null
      : assessOpenPalmCalibrationBaseline(samples.openPalmSamples);
  if (openPalm && !openPalm.accepted)
    return { accepted: false, reason: openPalm.reason, profile: fallback };
  const reach = assessHandCalibrationReach(samples.reachSamples);
  if (!reach.accepted)
    return { accepted: false, reason: reach.reason, profile: fallback };
  const pinch = calibratedPinchRatios(
    samples.closedPinchRatios,
    samples.openPinchRatios,
  );
  if (!pinch)
    return { accepted: false, reason: "pinch_not_separated", profile: fallback };
  return {
    accepted: true,
    profile: {
      deviceKey: samples.deviceKey,
      cameraBounds: reach.cameraBounds,
      safeCanvasInsetPx: SAFE_CANVAS_INSET_PX,
      pinchClosedRatio: pinch.closed,
      pinchOpenRatio: pinch.open,
      mirrorX: samples.mirrorX,
      createdAt: samples.createdAt,
      ...(openPalm?.accepted
        ? { openPalmBaseline: openPalm.baseline }
        : {}),
    },
  };
}

/**
 * Establishes a robust 2D scale and center before pointing or pinching. A
 * monocular camera cannot infer physical mass or reliable metric depth, so the
 * baseline deliberately contains only normalized image geometry/confidence.
 */
export function assessOpenPalmCalibrationBaseline(
  samples: readonly OpenPalmCalibrationSample[],
): OpenPalmCalibrationResult {
  const valid = samples.filter(isValidOpenPalmSample);
  if (valid.length < 4)
    return { accepted: false, reason: "open_palm_not_established" };
  const center = {
    x: rounded(percentile(valid.map((sample) => sample.center.x), 0.5)),
    y: rounded(percentile(valid.map((sample) => sample.center.y), 0.5)),
  };
  const palmScale = rounded(
    percentile(valid.map((sample) => sample.palmScale), 0.5),
  );
  const centerSpanX =
    percentile(valid.map((sample) => sample.center.x), 0.9) -
    percentile(valid.map((sample) => sample.center.x), 0.1);
  const centerSpanY =
    percentile(valid.map((sample) => sample.center.y), 0.9) -
    percentile(valid.map((sample) => sample.center.y), 0.1);
  const minimumScale = percentile(
    valid.map((sample) => sample.palmScale),
    0.1,
  );
  const maximumScale = percentile(
    valid.map((sample) => sample.palmScale),
    0.9,
  );
  const orientationRadians = circularMean(
    valid.map((sample) => sample.orientationRadians),
  );
  const orientationSpread = percentile(
    valid.map((sample) =>
      Math.abs(shortestAngle(sample.orientationRadians - orientationRadians)),
    ),
    0.9,
  );
  const maximumCenterSpan = Math.max(0.08, palmScale * 0.6);
  if (
    centerSpanX > maximumCenterSpan ||
    centerSpanY > maximumCenterSpan ||
    minimumScale < palmScale * 0.72 ||
    maximumScale > palmScale * 1.28 ||
    orientationSpread > Math.PI / 8
  )
    return { accepted: false, reason: "open_palm_not_established" };
  const openPinchRatio = rounded(
    percentile(
      valid.map((sample) => sample.pinchDistance / sample.palmScale),
      0.5,
    ),
  );
  const radius = clamp(palmScale * 1.25, 0.04, 0.45);
  const left = clamp(center.x - radius, 0, 1);
  const right = clamp(center.x + radius, 0, 1);
  const top = clamp(center.y - radius, 0, 1);
  const bottom = clamp(center.y + radius, 0, 1);
  return {
    accepted: true,
    baseline: {
      center,
      palmScale,
      openPinchRatio,
      orientationRadians: rounded(orientationRadians),
      confidence: rounded(
        percentile(valid.map((sample) => sample.confidence), 0.1),
      ),
      sampleCount: valid.length,
      envelope: {
        x: rounded(left),
        y: rounded(top),
        width: rounded(right - left),
        height: rounded(bottom - top),
      },
    },
  };
}

/** Normalizes thumb/index distance by observed 2D palm width. */
export function normalizePinchDistance(
  pinchDistance: number,
  observedPalmScale: number,
  baseline?: Pick<OpenPalmCalibrationBaseline, "palmScale"> | null,
) {
  if (!Number.isFinite(pinchDistance) || pinchDistance < 0)
    throw new RangeError("Pinch distance must be finite and non-negative.");
  const baselineScale = baseline?.palmScale;
  const observedScaleIsPlausible =
    Number.isFinite(observedPalmScale) &&
    observedPalmScale > 0 &&
    (!baselineScale ||
      (observedPalmScale >= baselineScale * 0.45 &&
        observedPalmScale <= baselineScale * 2.2));
  const scale = observedScaleIsPlausible ? observedPalmScale : baselineScale;
  if (!scale || !Number.isFinite(scale) || scale <= 0)
    throw new RangeError("Observed palm scale must be finite and positive.");
  return rounded(pinchDistance / scale);
}

export function assessHandCalibrationReach(
  reachSamples: readonly NormalizedPoint[],
): HandCalibrationReachResult {
  if (!validSamples(reachSamples))
    return { accepted: false, reason: "insufficient_reach" };
  const left = percentile(reachSamples.map((point) => point.x), 0.05);
  const right = percentile(reachSamples.map((point) => point.x), 0.95);
  const top = percentile(reachSamples.map((point) => point.y), 0.05);
  const bottom = percentile(reachSamples.map((point) => point.y), 0.95);
  const horizontalSpan = right - left;
  const verticalSpan = bottom - top;
  if (horizontalSpan < MIN_CAMERA_SPAN || verticalSpan < MIN_CAMERA_SPAN)
    return { accepted: false, reason: "reach_too_small" };
  if (
    horizontalSpan > MAX_CAMERA_HORIZONTAL_SPAN ||
    verticalSpan > MAX_CAMERA_VERTICAL_SPAN
  )
    return { accepted: false, reason: "reach_too_large" };
  return {
    accepted: true,
    cameraBounds: expandCameraBounds({ left, right, top, bottom }),
  };
}

/** Creates the same reach/pinch defaults used when calibration is skipped or refused. */
export function createFallbackHandCalibration(input: {
  readonly deviceKey: string;
  readonly mirrorX: boolean;
  readonly createdAt: number;
}): HandCalibrationProfile {
  return {
    deviceKey: input.deviceKey,
    cameraBounds: FALLBACK_CAMERA_BOUNDS,
    safeCanvasInsetPx: SAFE_CANVAS_INSET_PX,
    pinchClosedRatio: FALLBACK_CLOSED_PINCH_RATIO,
    pinchOpenRatio: FALLBACK_OPEN_PINCH_RATIO,
    mirrorX: input.mirrorX,
    createdAt: input.createdAt,
  };
}

export function resolvePinchThresholds(
  calibration: Pick<HandCalibrationProfile, "pinchClosedRatio" | "pinchOpenRatio"> | null,
): CalibratedPinchThresholds {
  if (
    !calibration ||
    !Number.isFinite(calibration.pinchClosedRatio) ||
    !Number.isFinite(calibration.pinchOpenRatio) ||
    calibration.pinchClosedRatio < 0 ||
    calibration.pinchClosedRatio > 2 ||
    calibration.pinchOpenRatio > 2 ||
    calibration.pinchOpenRatio <= calibration.pinchClosedRatio
  )
    return { engage: 0.38, release: 0.52 };
  const difference = calibration.pinchOpenRatio - calibration.pinchClosedRatio;
  return {
    engage: rounded(calibration.pinchClosedRatio + difference * 0.25),
    release: rounded(calibration.pinchClosedRatio + difference * 0.6),
  };
}

export function createInitialPinchVoteState(): PinchVoteState {
  return {
    pinched: false,
    recentConfidentRatios: [],
    lastConfidentAt: null,
    lastEvidenceTimestamp: null,
  };
}

export function createInitialHandReliabilityState(): HandReliabilityState {
  return {
    activeHandId: null,
    lastValid: null,
    lossStartedAt: null,
    lastEvidenceTimestamp: null,
    pinchVote: createInitialPinchVoteState(),
    handLastValidAt: {},
  };
}

/**
 * Makes active-hand selection and loss observable without acquiring a canvas
 * object or dispatching a mutation. Track IDs, rather than handedness labels,
 * preserve ownership when detector order or labels change.
 */
export function reduceHandReliability(
  state: HandReliabilityState,
  frame: HandReliabilityFrame,
  thresholds: CalibratedPinchThresholds,
): HandReliabilityTransition {
  assertFiniteTimestamp(frame.timestamp);
  if (
    state.lastEvidenceTimestamp !== null &&
    frame.timestamp <= state.lastEvidenceTimestamp
  )
    return ignoredReliabilityTransition(state, frame);
  const handLastValidAt = recordValidHands(state.handLastValidAt, frame);
  const active = state.activeHandId
    ? frame.hands.find((hand) => hand.trackId === state.activeHandId) ?? null
    : selectInitialActiveHand(frame.hands);

  if (!state.activeHandId && active && isPointerReliable(active)) {
    const pinch = voteCalibratedPinch(
      state.pinchVote,
      { ...active, timestamp: frame.timestamp },
      thresholds,
    );
    const next: HandReliabilityState = {
      activeHandId: active.trackId,
      lastValid: {
        trackId: active.trackId,
        pointer: active.pointer,
        timestamp: frame.timestamp,
      },
      lossStartedAt: null,
      lastEvidenceTimestamp: frame.timestamp,
      pinchVote: pinch.state,
      handLastValidAt,
    };
    return trackedReliabilityTransition(next, frame, pinch.snapshot);
  }

  if (active && isPointerReliable(active)) {
    const reacquireViolation =
      state.lossStartedAt !== null &&
      (!state.lastValid ||
        frame.timestamp - state.lastValid.timestamp > REACQUIRE_TIMEOUT_MS ||
        pointDistance(active.pointer, state.lastValid.pointer) > REACQUIRE_MAX_DISTANCE_PX);
    if (reacquireViolation)
      return safelyRelease(state, frame, handLastValidAt);
    const pinch = voteCalibratedPinch(
      state.pinchVote,
      { ...active, timestamp: frame.timestamp },
      thresholds,
    );
    const next: HandReliabilityState = {
      activeHandId: active.trackId,
      lastValid: {
        trackId: active.trackId,
        pointer: active.pointer,
        timestamp: frame.timestamp,
      },
      lossStartedAt: null,
      lastEvidenceTimestamp: frame.timestamp,
      pinchVote: pinch.state,
      handLastValidAt,
    };
    return trackedReliabilityTransition(next, frame, pinch.snapshot);
  }

  return applyLoss(state, frame, handLastValidAt);
}

/**
 * Applies the two-of-three temporal vote without treating uncertain samples as
 * a release. Loss handling remains separate so a missing hand is never a
 * semantic edge action.
 */
export function voteCalibratedPinch(
  state: PinchVoteState,
  input: PinchVoteInput,
  thresholds: CalibratedPinchThresholds,
): PinchVoteTransition {
  if (
    state.lastEvidenceTimestamp !== null &&
    input.timestamp <= state.lastEvidenceTimestamp
  )
    return {
      state,
      snapshot: {
        pinched: state.pinched,
        candidate: null,
        transition: null,
        ignored: true,
      },
    };
  if (!isConfidentPinchSample(input))
    return {
      state: { ...state, lastEvidenceTimestamp: input.timestamp },
      snapshot: {
        pinched: state.pinched,
        candidate: null,
        transition: null,
        ignored: false,
      },
    };
  const voteWindowMs = calibratedPinchVoteWindowMs(state, input.timestamp);
  const recentConfidentRatios = [
    ...state.recentConfidentRatios,
    { timestamp: input.timestamp, pinchRatio: input.pinchRatio },
  ]
    .filter(({ timestamp }) => timestamp >= input.timestamp - voteWindowMs)
    .slice(-PINCH_HISTORY_SIZE);
  const votes = state.pinched
    ? recentConfidentRatios.filter(
        ({ pinchRatio }) => pinchRatio >= thresholds.release,
      ).length
    : recentConfidentRatios.filter(
        ({ pinchRatio }) => pinchRatio <= thresholds.engage,
      ).length;
  const transition =
    votes >= PINCH_VOTE_COUNT
      ? state.pinched
        ? "released"
        : "engaged"
      : null;
  const pinched =
    transition === "engaged" ? true : transition === "released" ? false : state.pinched;
  return {
    state: {
      pinched,
      recentConfidentRatios: transition ? [] : recentConfidentRatios,
      lastConfidentAt: input.timestamp,
      lastEvidenceTimestamp: input.timestamp,
    },
    snapshot: {
      pinched,
      candidate:
        transition
          ? null
          : votes > 0
            ? state.pinched
              ? "release"
              : "engage"
            : null,
      transition,
      ignored: false,
    },
  };
}

function calibratedPinchVoteWindowMs(
  state: PinchVoteState,
  timestamp: number,
) {
  const observedTimestamps = [
    ...(state.recentConfidentRatios.length > 0
      ? state.recentConfidentRatios.map((sample) => sample.timestamp)
      : state.lastConfidentAt === null
        ? []
        : [state.lastConfidentAt]),
    timestamp,
  ];
  const recentIntervals = observedTimestamps
    .slice(1)
    .map((sampleTimestamp, index) =>
      sampleTimestamp - observedTimestamps[index]!,
    )
    .filter((interval) => Number.isFinite(interval) && interval > 0)
    .slice(-(PINCH_HISTORY_SIZE - 1));
  const observedCadenceMs =
    recentIntervals.length > 0 ? Math.max(...recentIntervals) : 0;
  return Math.min(
    PINCH_VOTE_MAX_WINDOW_MS,
    Math.max(
      PINCH_VOTE_MIN_WINDOW_MS,
      observedCadenceMs * PINCH_VOTE_CADENCE_MULTIPLIER,
    ),
  );
}

/**
 * Maps comfortable camera reach linearly to a safe interior, then extrapolates
 * a short calibrated margin to the literal viewport edge. The camera preview
 * dimensions never participate in this mapping.
 */
export function mapCalibratedPointer(
  calibration: HandCalibrationProfile,
  cameraPoint: NormalizedPoint,
  canvas: CanvasBounds,
  state: HandControlGainState = "hover",
): MappedHandPointer {
  assertFiniteCanvas(canvas);
  const gain = gainFor(state);
  const insetX = Math.min(calibration.safeCanvasInsetPx, canvas.width / 2);
  const insetY = Math.min(calibration.safeCanvasInsetPx, canvas.height / 2);
  const extrapolationFraction = edgeExtrapolationFraction(calibration);
  const normalized = {
    x: mapSpatialFieldAxis(
      ((cameraPoint.x - calibration.cameraBounds.x) /
        calibration.cameraBounds.width -
        0.5) *
        gain +
        0.5,
      insetX / canvas.width,
      extrapolationFraction,
    ),
    y: mapSpatialFieldAxis(
      ((cameraPoint.y - calibration.cameraBounds.y) /
        calibration.cameraBounds.height -
        0.5) *
        gain +
        0.5,
      insetY / canvas.height,
      extrapolationFraction,
    ),
  };
  return {
    point: {
      x: rounded(canvas.left + normalized.x * canvas.width),
      y: rounded(canvas.top + normalized.y * canvas.height),
    },
    normalized,
    gain,
  };
}

function isValidOpenPalmSample(sample: OpenPalmCalibrationSample) {
  return (
    Number.isFinite(sample.center.x) &&
    sample.center.x >= 0 &&
    sample.center.x <= 1 &&
    Number.isFinite(sample.center.y) &&
    sample.center.y >= 0 &&
    sample.center.y <= 1 &&
    Number.isFinite(sample.palmScale) &&
    sample.palmScale >= 0.02 &&
    sample.palmScale <= 0.6 &&
    Number.isFinite(sample.pinchDistance) &&
    sample.pinchDistance >= 0 &&
    sample.pinchDistance <= 1 &&
    Number.isFinite(sample.orientationRadians) &&
    sample.orientationRadians >= -Math.PI &&
    sample.orientationRadians <= Math.PI &&
    Number.isFinite(sample.confidence) &&
    sample.confidence >= 0.5 &&
    sample.confidence <= 1
  );
}

function circularMean(angles: readonly number[]) {
  const sine = angles.reduce((sum, angle) => sum + Math.sin(angle), 0);
  const cosine = angles.reduce((sum, angle) => sum + Math.cos(angle), 0);
  return Math.atan2(sine, cosine);
}

function shortestAngle(angle: number) {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function edgeExtrapolationFraction(calibration: HandCalibrationProfile) {
  const baseline = calibration.openPalmBaseline;
  if (!baseline) return DEFAULT_EDGE_EXTRAPOLATION_FRACTION;
  const shortestReach = Math.min(
    calibration.cameraBounds.width,
    calibration.cameraBounds.height,
  );
  return clamp((baseline.palmScale / shortestReach) * 0.35, 0.06, 0.18);
}

function mapSpatialFieldAxis(
  comfortable: number,
  safeInset: number,
  extrapolationFraction: number,
) {
  if (comfortable < 0)
    return rounded(
      safeInset *
        (1 - clamp(-comfortable / extrapolationFraction, 0, 1)),
    );
  if (comfortable > 1)
    return rounded(
      1 -
        safeInset *
          (1 - clamp((comfortable - 1) / extrapolationFraction, 0, 1)),
    );
  return rounded(safeInset + comfortable * (1 - safeInset * 2));
}

function calibratedPinchRatios(
  closedSamples: readonly number[],
  openSamples: readonly number[],
) {
  if (!validRatios(closedSamples) || !validRatios(openSamples))
    return null;
  const closed = percentile(closedSamples, 0.95);
  const open = percentile(openSamples, 0.05);
  return closed < open ? { closed, open } : null;
}

function expandCameraBounds(bounds: {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}): NormalizedRect {
  const horizontalSpan = bounds.right - bounds.left;
  const verticalSpan = bounds.bottom - bounds.top;
  const left = clamp(bounds.left - horizontalSpan * CAMERA_BOUND_EXPANSION, 0, 1);
  const right = clamp(bounds.right + horizontalSpan * CAMERA_BOUND_EXPANSION, 0, 1);
  const top = clamp(bounds.top - verticalSpan * CAMERA_BOUND_EXPANSION, 0, 1);
  const bottom = clamp(bounds.bottom + verticalSpan * CAMERA_BOUND_EXPANSION, 0, 1);
  return {
    x: rounded(left),
    y: rounded(top),
    width: rounded(right - left),
    height: rounded(bottom - top),
  };
}

function validSamples(samples: readonly NormalizedPoint[]) {
  return (
    samples.length > 0 &&
    samples.every(
      (point) =>
        Number.isFinite(point.x) &&
        Number.isFinite(point.y) &&
        point.x >= 0 &&
        point.x <= 1 &&
        point.y >= 0 &&
        point.y <= 1,
    )
  );
}

function validRatios(ratios: readonly number[]) {
  return (
    ratios.length > 0 &&
    ratios.every(
      (ratio) => Number.isFinite(ratio) && ratio >= 0 && ratio <= 2,
    )
  );
}

function isConfidentPinchSample(input: PinchVoteInput) {
  return (
    Number.isFinite(input.timestamp) &&
    Number.isFinite(input.confidence) &&
    input.confidence >= PINCH_MIN_CONFIDENCE &&
    Number.isFinite(input.indexTipConfidence) &&
    input.indexTipConfidence >= PINCH_MIN_CONFIDENCE &&
    Number.isFinite(input.thumbTipConfidence) &&
    input.thumbTipConfidence >= PINCH_MIN_CONFIDENCE &&
    !input.predicted &&
    Number.isFinite(input.pinchRatio) &&
    input.pinchRatio >= 0 &&
    input.pinchRatio <= 2
  );
}

function trackedReliabilityTransition(
  state: HandReliabilityState,
  frame: HandReliabilityFrame,
  pinch: PinchVoteSnapshot,
): HandReliabilityTransition {
  return {
    state,
    snapshot: createReliabilitySnapshot(state, frame, "tracked", pinch, null),
  };
}

function applyLoss(
  state: HandReliabilityState,
  frame: HandReliabilityFrame,
  handLastValidAt: Readonly<Record<string, number>>,
): HandReliabilityTransition {
  if (!state.lastValid) {
    const next = { ...state, handLastValidAt, lastEvidenceTimestamp: frame.timestamp };
    return {
      state: next,
      snapshot: createReliabilitySnapshot(
        next,
        frame,
        "released",
        unchangedPinchSnapshot(state.pinchVote),
        null,
      ),
    };
  }
  const elapsedMs = frame.timestamp - state.lastValid.timestamp;
  if (elapsedMs > REACQUIRE_TIMEOUT_MS)
    return safelyRelease(state, frame, handLastValidAt);
  const trackingState =
    elapsedMs <= REACQUIRE_FREEZE_MS
      ? "uncertain"
      : elapsedMs >= REACQUIRE_VISIBLE_MS
        ? "reacquire"
        : "uncertain";
  const next: HandReliabilityState = {
    ...state,
    lossStartedAt: state.lossStartedAt ?? state.lastValid.timestamp,
    lastEvidenceTimestamp: frame.timestamp,
    handLastValidAt,
  };
  return {
    state: next,
    snapshot: createReliabilitySnapshot(
      next,
      frame,
      trackingState,
      unchangedPinchSnapshot(next.pinchVote),
      null,
    ),
  };
}

function safelyRelease(
  state: HandReliabilityState,
  frame: HandReliabilityFrame,
  handLastValidAt: Readonly<Record<string, number>>,
): HandReliabilityTransition {
  const release = state.lastValid
    ? {
        point: state.lastValid.pointer,
        lastValidAt: state.lastValid.timestamp,
        releasedAt: frame.timestamp,
      }
    : null;
  const next: HandReliabilityState = {
    activeHandId: null,
    lastValid: null,
    lossStartedAt: null,
    lastEvidenceTimestamp: frame.timestamp,
    pinchVote: createInitialPinchVoteState(),
    handLastValidAt,
  };
  return {
    state: next,
    snapshot: createReliabilitySnapshot(
      next,
      frame,
      "released",
      unchangedPinchSnapshot(next.pinchVote),
      release,
    ),
  };
}

function createReliabilitySnapshot(
  state: HandReliabilityState,
  frame: HandReliabilityFrame,
  trackingState: HandReliabilityTrackingState,
  pinch: PinchVoteSnapshot,
  release: HandReliabilitySnapshot["release"],
  ignored = false,
): HandReliabilitySnapshot {
  const hands = frame.hands.map((hand) =>
    snapshotHand(
      hand,
      frame.timestamp,
      hand.trackId === state.activeHandId,
      handLastValidAt(state, hand.trackId),
      hand.trackId === state.activeHandId ? state.lossStartedAt : null,
      hand.trackId === state.activeHandId ? trackingState : handTrackingState(hand),
    ),
  );
  const activeHand = hands.find((hand) => hand.isActive) ?? null;
  return {
    activeHandId: state.activeHandId,
    activeHand,
    hands,
    trackingState,
    pinch,
    lastValidAt: state.lastValid?.timestamp ?? release?.lastValidAt ?? null,
    lossStartedAt: state.lossStartedAt,
    release,
    ignored,
    edgeAction: null,
  };
}

function snapshotHand(
  hand: HandReliabilityHandInput,
  observedAt: number,
  isActive: boolean,
  lastValidAt: number | null,
  lossStartedAt: number | null,
  trackingState: HandReliabilityTrackingState,
): HandReliabilityHandSnapshot {
  return {
    trackId: hand.trackId,
    handedness: hand.handedness,
    confidence: hand.confidence,
    indexTipConfidence: hand.indexTipConfidence,
    thumbTipConfidence: hand.thumbTipConfidence,
    predicted: hand.predicted,
    real: !hand.predicted,
    trackingState,
    isActive,
    observedAt,
    lastValidAt,
    lossStartedAt,
  };
}

function selectInitialActiveHand(hands: readonly HandReliabilityHandInput[]) {
  return hands
    .filter(isPointerReliable)
    .sort((left, right) => right.confidence - left.confidence)[0] ?? null;
}

function isPointerReliable(hand: HandReliabilityHandInput) {
  return (
    hand.trackId.length > 0 &&
    !hand.predicted &&
    Number.isFinite(hand.confidence) &&
    hand.confidence >= PINCH_MIN_CONFIDENCE &&
    Number.isFinite(hand.indexTipConfidence) &&
    hand.indexTipConfidence >= PINCH_MIN_CONFIDENCE &&
    Number.isFinite(hand.pointer.x) &&
    Number.isFinite(hand.pointer.y) &&
    Number.isFinite(hand.pinchRatio) &&
    hand.pinchRatio >= 0
  );
}

function recordValidHands(
  previous: Readonly<Record<string, number>>,
  frame: HandReliabilityFrame,
) {
  const next = { ...previous };
  for (const hand of frame.hands) {
    if (isPointerReliable(hand)) next[hand.trackId] = frame.timestamp;
  }
  return next;
}

function handLastValidAt(state: HandReliabilityState, trackId: string) {
  return state.handLastValidAt[trackId] ?? null;
}

function handTrackingState(hand: HandReliabilityHandInput): HandReliabilityTrackingState {
  return isPointerReliable(hand) ? "tracked" : "uncertain";
}

function unchangedPinchSnapshot(
  state: PinchVoteState,
  ignored = false,
): PinchVoteSnapshot {
  return { pinched: state.pinched, candidate: null, transition: null, ignored };
}

function ignoredReliabilityTransition(
  state: HandReliabilityState,
  frame: HandReliabilityFrame,
): HandReliabilityTransition {
  return {
    state,
    snapshot: createReliabilitySnapshot(
      state,
      frame,
      currentReliabilityTrackingState(state),
      unchangedPinchSnapshot(state.pinchVote, true),
      null,
      true,
    ),
  };
}

function currentReliabilityTrackingState(
  state: HandReliabilityState,
): HandReliabilityTrackingState {
  if (!state.activeHandId) return "released";
  if (!state.lossStartedAt || !state.lastValid) return "tracked";
  return trackingStateForLoss(
    (state.lastEvidenceTimestamp ?? state.lastValid.timestamp) -
      state.lastValid.timestamp,
  );
}

function trackingStateForLoss(elapsedMs: number): HandReliabilityTrackingState {
  return elapsedMs >= REACQUIRE_VISIBLE_MS ? "reacquire" : "uncertain";
}

function assertFiniteTimestamp(timestamp: number) {
  if (!Number.isFinite(timestamp) || timestamp < 0)
    throw new RangeError("Hand reliability timestamps must be finite and non-negative.");
}

function pointDistance(
  left: { readonly x: number; readonly y: number },
  right: { readonly x: number; readonly y: number },
) {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function percentile(values: readonly number[], percentileRank: number) {
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * percentileRank;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const fraction = position - lower;
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * fraction;
}

function gainFor(state: HandControlGainState) {
  switch (state) {
    case "hover":
      return 1.5;
    case "target":
      return 1.25;
    case "held":
    case "draw":
      return 1.1;
    case "two_hand":
      return 1;
  }
}

function assertFiniteCanvas(canvas: CanvasBounds) {
  if (
    !Number.isFinite(canvas.left) ||
    !Number.isFinite(canvas.top) ||
    !Number.isFinite(canvas.width) ||
    !Number.isFinite(canvas.height) ||
    canvas.width <= 0 ||
    canvas.height <= 0
  )
    throw new RangeError("Canvas bounds must be finite with a positive size.");
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function rounded(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}
