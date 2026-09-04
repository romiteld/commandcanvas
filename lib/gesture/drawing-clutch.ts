import {
  assessPinchCalibrationEnvelope,
  type HandCalibrationProfile,
  type HandDrawingClutchCalibration,
} from "@/lib/gesture/hand-calibration";

/**
 * Deterministic virtual-pen clutch.
 *
 * The index fingertip remains the stylus position. Thumb-to-middle-tip geometry
 * only answers whether durable ink is allowed. These provisional thresholds
 * must be calibrated against reviewed target-domain captures before promotion.
 */
export interface DrawingClutchPolicy {
  readonly engageThreshold: number;
  readonly releaseThreshold: number;
  readonly confirmationSamples: number;
  readonly minimumConfidence: number;
}

export interface DrawingClutchCalibrationIdentity {
  readonly trackId: string;
  readonly handedness: "left" | "right" | "unknown";
  readonly handednessReliable: boolean;
}

export interface ResolvedDrawingClutchPolicy {
  readonly policy: DrawingClutchPolicy;
  readonly source: "track" | "handedness" | "provisional";
  readonly calibrated: boolean;
}

export const PROVISIONAL_DRAWING_CLUTCH_POLICY: DrawingClutchPolicy =
  Object.freeze({
    engageThreshold: 0.32,
    releaseThreshold: 0.52,
    confirmationSamples: 2,
    minimumConfidence: 0.55,
  });

const HANDEDNESS_REUSE_CONFIDENCE_FLOOR = 0.8;

export function resolveDrawingClutchPolicy(
  profile: Pick<HandCalibrationProfile, "drawingClutchCalibrations"> | null,
  identity: DrawingClutchCalibrationIdentity,
): ResolvedDrawingClutchPolicy {
  const calibrations = profile?.drawingClutchCalibrations ?? [];
  const exact = calibrations.find(
    (calibration) =>
      calibration.trackId === identity.trackId &&
      (!identity.handednessReliable ||
        identity.handedness === "unknown" ||
        calibration.handedness === "unknown" ||
        calibration.handedness === identity.handedness),
  );
  const handedness =
    exact ??
    (identity.handednessReliable && identity.handedness !== "unknown"
      ? calibrations.find(
          (calibration) =>
            calibration.handedness === identity.handedness &&
            calibration.handedness !== "unknown" &&
            typeof calibration.handednessConfidence === "number" &&
            Number.isFinite(calibration.handednessConfidence) &&
            calibration.handednessConfidence >=
              HANDEDNESS_REUSE_CONFIDENCE_FLOOR,
        )
      : undefined);
  const policy = handedness ? calibratedPolicy(handedness) : null;
  if (!policy)
    return {
      policy: PROVISIONAL_DRAWING_CLUTCH_POLICY,
      source: "provisional",
      calibrated: false,
    };
  return {
    policy,
    source: exact ? "track" : "handedness",
    calibrated: true,
  };
}

export function applyDrawingClutchPolicyAtSafeBoundary(
  state: DrawingClutchState,
  policy: DrawingClutchPolicy,
): DrawingClutchState {
  validatePolicy(policy);
  if (state.phase !== "pen_up" || samePolicy(state.policy, policy)) return state;
  return { ...state, policy };
}

const MINIMUM_CONFIRMATION_MS = 8;
const MAXIMUM_CONFIRMATION_MS = 120;

export type DrawingClutchPhase =
  "pen_up" | "engage_pending" | "pen_down" | "release_pending";

export interface DrawingClutchState {
  readonly phase: DrawingClutchPhase;
  readonly activeTrackId: string | null;
  readonly candidateSamples: number;
  readonly candidateStartedAt: number | null;
  readonly lastObservationAt: number | null;
  readonly policy: DrawingClutchPolicy;
}

export interface DrawingClutchObservation {
  readonly trackId: string;
  readonly timestamp: number;
  /** distance(thumb tip 4, middle tip 12) / established palm scale */
  readonly normalizedDistance: number;
  readonly confidence: number;
  readonly predicted: boolean;
  readonly trackingState: "tracked" | "grace" | "uncertain" | "reacquire";
}

export interface DrawingClutchEvidence {
  readonly trackId: string | null;
  readonly penDown: boolean;
  readonly transition: "none" | "engaged" | "released";
  readonly normalizedDistance: number | null;
  readonly confidence: number;
  readonly predicted: boolean;
  readonly sampleKind: "measured" | "predicted";
  readonly rejectedBecause?:
    | "active-hand-mismatch"
    | "predicted"
    | "low-confidence"
    | "tracking-uncertain"
    | "invalid-geometry"
    | "invalid-timestamp"
    | "non-monotonic-timestamp";
}

export interface DrawingClutchTransition {
  readonly state: DrawingClutchState;
  readonly evidence: DrawingClutchEvidence;
}

export function createInitialDrawingClutchState(
  policy: DrawingClutchPolicy = PROVISIONAL_DRAWING_CLUTCH_POLICY,
): DrawingClutchState {
  validatePolicy(policy);
  return {
    phase: "pen_up",
    activeTrackId: null,
    candidateSamples: 0,
    candidateStartedAt: null,
    lastObservationAt: null,
    policy,
  };
}

export function reduceDrawingClutch(
  state: DrawingClutchState,
  observation: DrawingClutchObservation | null,
): DrawingClutchTransition {
  validatePolicy(state.policy);
  if (!observation) {
    const wasDown = isDown(state.phase);
    return {
      state: createInitialDrawingClutchState(state.policy),
      evidence: {
        trackId: state.activeTrackId,
        penDown: false,
        transition: wasDown ? "released" : "none",
        normalizedDistance: null,
        confidence: 0,
        predicted: false,
        sampleKind: "measured",
      },
    };
  }

  const baseEvidence = {
    trackId: observation.trackId,
    normalizedDistance: Number.isFinite(observation.normalizedDistance)
      ? observation.normalizedDistance
      : null,
    confidence: observation.confidence,
    predicted: observation.predicted,
    sampleKind: observation.predicted
      ? ("predicted" as const)
      : ("measured" as const),
  };
  const timestampRejection = rejectedTimestamp(state, observation);
  const observedState = timestampRejection
    ? state
    : { ...state, lastObservationAt: observation.timestamp };
  const rejection = timestampRejection ?? rejectedBecause(state, observation);
  if (rejection) {
    return {
      state: observedState,
      evidence: {
        ...baseEvidence,
        penDown:
          rejection === "active-hand-mismatch" ? false : isDown(state.phase),
        transition: "none",
        rejectedBecause: rejection,
      },
    };
  }

  if (isDown(observedState.phase))
    return reduceWhileDown(observedState, observation, baseEvidence);
  return reduceWhileUp(observedState, observation, baseEvidence);
}

function reduceWhileUp(
  state: DrawingClutchState,
  observation: DrawingClutchObservation,
  baseEvidence: Omit<DrawingClutchEvidence, "penDown" | "transition">,
): DrawingClutchTransition {
  if (observation.normalizedDistance > state.policy.engageThreshold) {
    return {
      state: resetAfterObservation(state),
      evidence: { ...baseEvidence, penDown: false, transition: "none" },
    };
  }
  const candidateAge =
    state.candidateStartedAt === null
      ? 0
      : observation.timestamp - state.candidateStartedAt;
  const sameCandidate =
    state.phase === "engage_pending" &&
    state.activeTrackId === observation.trackId &&
    candidateAge <= MAXIMUM_CONFIRMATION_MS;
  const candidateSamples = sameCandidate ? state.candidateSamples + 1 : 1;
  const candidateStartedAt = sameCandidate
    ? state.candidateStartedAt
    : observation.timestamp;
  const confirmationAge =
    observation.timestamp - (candidateStartedAt ?? observation.timestamp);
  if (
    candidateSamples < state.policy.confirmationSamples ||
    confirmationAge < MINIMUM_CONFIRMATION_MS
  ) {
    return {
      state: {
        ...state,
        phase: "engage_pending",
        activeTrackId: observation.trackId,
        candidateSamples,
        candidateStartedAt,
      },
      evidence: { ...baseEvidence, penDown: false, transition: "none" },
    };
  }
  return {
    state: {
      ...state,
      phase: "pen_down",
      activeTrackId: observation.trackId,
      candidateSamples: 0,
      candidateStartedAt: null,
    },
    evidence: { ...baseEvidence, penDown: true, transition: "engaged" },
  };
}

function reduceWhileDown(
  state: DrawingClutchState,
  observation: DrawingClutchObservation,
  baseEvidence: Omit<DrawingClutchEvidence, "penDown" | "transition">,
): DrawingClutchTransition {
  if (observation.normalizedDistance < state.policy.releaseThreshold) {
    return {
      state: {
        ...state,
        phase: "pen_down",
        candidateSamples: 0,
        candidateStartedAt: null,
      },
      evidence: { ...baseEvidence, penDown: true, transition: "none" },
    };
  }
  const candidateAge =
    state.candidateStartedAt === null
      ? 0
      : observation.timestamp - state.candidateStartedAt;
  const sameCandidate =
    state.phase === "release_pending" &&
    candidateAge <= MAXIMUM_CONFIRMATION_MS;
  const candidateSamples = sameCandidate ? state.candidateSamples + 1 : 1;
  const candidateStartedAt = sameCandidate
    ? state.candidateStartedAt
    : observation.timestamp;
  const confirmationAge =
    observation.timestamp - (candidateStartedAt ?? observation.timestamp);
  if (
    candidateSamples < state.policy.confirmationSamples ||
    confirmationAge < MINIMUM_CONFIRMATION_MS
  ) {
    return {
      state: {
        ...state,
        phase: "release_pending",
        candidateSamples,
        candidateStartedAt,
      },
      evidence: { ...baseEvidence, penDown: true, transition: "none" },
    };
  }
  return {
    state: resetAfterObservation(state),
    evidence: { ...baseEvidence, penDown: false, transition: "released" },
  };
}

function rejectedTimestamp(
  state: DrawingClutchState,
  observation: DrawingClutchObservation,
): DrawingClutchEvidence["rejectedBecause"] | undefined {
  if (!Number.isFinite(observation.timestamp) || observation.timestamp < 0)
    return "invalid-timestamp";
  if (
    state.lastObservationAt !== null &&
    observation.timestamp <= state.lastObservationAt
  )
    return "non-monotonic-timestamp";
  return undefined;
}

function rejectedBecause(
  state: DrawingClutchState,
  observation: DrawingClutchObservation,
): DrawingClutchEvidence["rejectedBecause"] | undefined {
  if (
    state.activeTrackId &&
    state.activeTrackId !== observation.trackId &&
    state.phase !== "pen_up"
  )
    return "active-hand-mismatch";
  if (
    !Number.isFinite(observation.normalizedDistance) ||
    observation.normalizedDistance < 0
  )
    return "invalid-geometry";
  if (observation.predicted) return "predicted";
  if (
    !Number.isFinite(observation.confidence) ||
    observation.confidence < state.policy.minimumConfidence
  )
    return "low-confidence";
  if (observation.trackingState !== "tracked") return "tracking-uncertain";
  return undefined;
}

function isDown(phase: DrawingClutchPhase) {
  return phase === "pen_down" || phase === "release_pending";
}

function resetAfterObservation(state: DrawingClutchState): DrawingClutchState {
  return {
    ...createInitialDrawingClutchState(state.policy),
    lastObservationAt: state.lastObservationAt,
  };
}

function validatePolicy(policy: DrawingClutchPolicy) {
  if (
    !Number.isFinite(policy.engageThreshold) ||
    !Number.isFinite(policy.releaseThreshold) ||
    policy.engageThreshold <= 0 ||
    policy.releaseThreshold <= policy.engageThreshold ||
    !Number.isInteger(policy.confirmationSamples) ||
    policy.confirmationSamples < 2 ||
    !Number.isFinite(policy.minimumConfidence) ||
    policy.minimumConfidence < 0 ||
    policy.minimumConfidence > 1
  )
    throw new RangeError("Drawing clutch policy is invalid.");
}

function calibratedPolicy(
  calibration: HandDrawingClutchCalibration,
): DrawingClutchPolicy | null {
  if (
    !Number.isInteger(calibration.openSampleCount) ||
    calibration.openSampleCount < 1 ||
    !Number.isInteger(calibration.closedSampleCount) ||
    calibration.closedSampleCount < 1 ||
    !Number.isFinite(calibration.capturedAt) ||
    calibration.capturedAt < 0
  )
    return null;
  const envelope = assessPinchCalibrationEnvelope(
    [calibration.closedRatio],
    [calibration.openRatio],
  );
  if (
    !envelope.accepted ||
    envelope.closedUpper === null ||
    envelope.openLower === null
  )
    return null;
  const difference = envelope.openLower - envelope.closedUpper;
  return {
    engageThreshold: rounded(envelope.closedUpper + difference * 0.25),
    releaseThreshold: rounded(envelope.closedUpper + difference * 0.6),
    confirmationSamples: PROVISIONAL_DRAWING_CLUTCH_POLICY.confirmationSamples,
    minimumConfidence: PROVISIONAL_DRAWING_CLUTCH_POLICY.minimumConfidence,
  };
}

function samePolicy(left: DrawingClutchPolicy, right: DrawingClutchPolicy) {
  return (
    left.engageThreshold === right.engageThreshold &&
    left.releaseThreshold === right.releaseThreshold &&
    left.confirmationSamples === right.confirmationSamples &&
    left.minimumConfidence === right.minimumConfidence
  );
}

function rounded(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}
