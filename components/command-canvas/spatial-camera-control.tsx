"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";

import type {
  HandTrackingController,
  HandTrackingEngineStatus,
  HandTrackingObservation,
  HandTrackingSensorFrame,
  HandTrackingStatus,
} from "@/lib/gesture/hand-tracking-controller";
import { createHandTrackingController } from "@/lib/gesture/hand-tracking-controller";
import {
  assessPinchCalibrationEnvelope,
  assessOpenPalmCalibrationBaseline,
  assessHandCalibrationReach,
  buildHandCalibration,
  createFallbackHandCalibration,
  normalizePinchDistance,
  resolvePinchThresholds,
  type HandCalibrationProfile,
  type HandCalibrationResult,
  type HandCalibrationSamples,
  type OpenPalmCalibrationSample,
} from "@/lib/gesture/hand-calibration";
import {
  isOpenPalmCalibrationPose,
  type HandLandmarks,
} from "@/lib/gesture/hand-intent";

const MAX_CALIBRATION_REACH_SAMPLES = 240;
const MAX_CALIBRATION_PINCH_SAMPLES = 120;
const MAX_CLOSED_PINCH_CANDIDATE_SAMPLES = 12;
const MAX_CLOSED_PINCH_SAMPLE_GAP_MS = 250;
const MIN_CLOSED_PINCH_HOLD_MS = 75;
const OPEN_PALM_SCAN_FRAMES = 6;
const MIN_CALIBRATION_REACH_SAMPLES = 12;
const MIN_CALIBRATION_PINCH_SAMPLES = 6;

type CalibrationStage = "baseline" | "reach" | "open" | "closed" | "review";

interface ClosedPinchEvidence {
  readonly ratio: number;
  readonly capturedAt: number;
  readonly source: string;
  readonly trackId: string;
}

interface ClosedPinchCaptureState {
  readonly source: string | null;
  readonly trackId: string | null;
  readonly lastCapturedAt: number | null;
  readonly candidate: readonly ClosedPinchEvidence[];
  readonly stable: boolean;
  readonly replacementPending: boolean;
}

export type SpatialCalibrationResult =
  | HandCalibrationResult
  | {
      readonly accepted: false;
      readonly reason: "skipped";
      readonly profile: HandCalibrationProfile;
    };

export interface SpatialCameraControlProps {
  calibrationOpen?: boolean;
  calibrationDeviceKey?: string;
  calibrationKind?: "calibrated" | "skipped" | null;
  calibrationProfile?: HandCalibrationProfile | null;
  createController?: (
    preferences: SpatialCameraControllerPreferences,
  ) => HandTrackingController;
  privateGpuRelayAvailable?: boolean;
  onCalibrationResult?: (result: SpatialCalibrationResult) => void;
  onCalibrationOpenChange?: (open: boolean) => void;
  onObservation?: (observation: HandTrackingObservation) => void;
  onStatusChange?: (status: HandTrackingStatus) => void;
  onSpatialModeStarted?: () => void;
}

export interface SpatialCameraControllerPreferences {
  cameraUploadConsent: () => boolean;
}

export function SpatialCameraControl({
  calibrationOpen,
  calibrationDeviceKey = "default-camera-session",
  calibrationKind = null,
  calibrationProfile = null,
  createController = () => createHandTrackingController(),
  privateGpuRelayAvailable = false,
  onCalibrationResult,
  onCalibrationOpenChange,
  onObservation,
  onStatusChange,
  onSpatialModeStarted,
}: SpatialCameraControlProps) {
  const [uploadConsent] = useState(() => createMutableConsentState());
  const [privateGpuConsent, setPrivateGpuConsent] = useState(false);
  const [startingTarget, setStartingTarget] = useState<
    "private-relay" | "local" | null
  >(null);
  const [controller] = useState(() =>
    createController({
      cameraUploadConsent: uploadConsent.get,
    }),
  );
  const [status, setStatus] = useState<HandTrackingStatus>(() =>
    controller.getStatus(),
  );
  const [engineStatus, setEngineStatus] = useState<HandTrackingEngineStatus | null>(
    () => controller.getEngineStatus?.() ?? null,
  );
  const [detectedMode, setDetectedMode] = useState<
    "point" | "pinch" | "open_palm" | "bimanual_pinch" | null
  >(null);
  const [selfCheck, setSelfCheck] = useState<{
    pointConfidence?: number;
    pinchConfidence?: number;
  }>({});
  const [internalCalibrationOpen, setInternalCalibrationOpen] = useState(false);
  const [runtimeDetailsOpen, setRuntimeDetailsOpen] = useState(false);
  const [lastObservation, setLastObservation] =
    useState<HandTrackingObservation | null>(null);
  const [lastSensorFrame, setLastSensorFrame] =
    useState<HandTrackingSensorFrame | null>(null);
  const [videoAspectRatio, setVideoAspectRatio] = useState(4 / 3);
  const [sensorPreviewVisible, setSensorPreviewVisible] = useState(true);
  const [sensorPipOffset, setSensorPipOffset] = useState({ x: 0, y: 0 });
  const [capturedCalibration, setCapturedCalibration] =
    useState<HandCalibrationProfile | null>(null);
  const [capturedCalibrationKind, setCapturedCalibrationKind] = useState<
    "calibrated" | "skipped" | null
  >(null);
  const [calibrationCounts, setCalibrationCounts] = useState({
    baseline: 0,
    reach: 0,
    reachReady: false,
    open: 0,
    closed: 0,
    closedReady: false,
  });
  const [calibrationStage, setCalibrationStage] =
    useState<CalibrationStage>("baseline");
  const [calibrationError, setCalibrationError] = useState<string | null>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const sensorPipDragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    initialX: number;
    initialY: number;
    initialLeft: number;
    initialTop: number;
  } | null>(null);
  const calibrationSamplesRef = useRef<HandCalibrationSamples>(
    emptyCalibrationSamples(calibrationDeviceKey),
  );
  const calibrationStageRef = useRef<CalibrationStage>("baseline");
  const calibrationTrackIdRef = useRef<string | null>(null);
  const calibrationSourceRef = useRef<string | null>(null);
  const closedPinchCaptureRef = useRef<ClosedPinchCaptureState>(
    emptyClosedPinchCaptureState(),
  );
  const previousCalibrationOpenRef = useRef(false);
  const calibrationDeviceKeyRef = useRef(calibrationDeviceKey);
  const retainedCalibrationRef = useRef<HandCalibrationProfile | null>(
    calibrationProfile,
  );
  const spatialModeStartedRef = useRef(false);
  const spatialModeRequestedRef = useRef(false);
  const calibrationOpenRef = useRef(false);
  const lifecycleStopIssuedRef = useRef(false);
  const lastAcknowledgedCaptureRef = useRef<number | null>(null);
  const runtimeDetailsId = useId();
  const observationHandlerRef = useRef(onObservation);
  const statusHandlerRef = useRef(onStatusChange);
  const spatialModeStartedHandlerRef = useRef(onSpatialModeStarted);
  const calibrationOpenHandlerRef = useRef(onCalibrationOpenChange);
  const calibrationResultHandlerRef = useRef(onCalibrationResult);

  const previewExpanded = calibrationOpen ?? internalCalibrationOpen;
  const retainedCalibration = calibrationProfile ?? capturedCalibration;
  const retainedCalibrationKind = calibrationProfile
    ? calibrationKind ?? "calibrated"
    : capturedCalibration
      ? capturedCalibrationKind
      : null;

  useEffect(() => {
    calibrationOpenRef.current = previewExpanded;
  }, [previewExpanded]);

  useEffect(() => {
    if (previewExpanded) return;
    const clearId = window.setTimeout(() => setLastSensorFrame(null), 0);
    return () => window.clearTimeout(clearId);
  }, [previewExpanded]);

  useEffect(() => {
    calibrationDeviceKeyRef.current = calibrationDeviceKey;
    retainedCalibrationRef.current = retainedCalibration;
  }, [calibrationDeviceKey, retainedCalibration]);

  const setPreviewExpanded = useCallback((next: boolean) => {
    calibrationOpenRef.current = next;
    if (!next) setLastSensorFrame(null);
    setInternalCalibrationOpen(next);
    calibrationOpenHandlerRef.current?.(next);
  }, []);

  const startSpatialMode = useCallback(() => {
    spatialModeStartedRef.current = true;
    spatialModeRequestedRef.current = false;
    setLastSensorFrame(null);
    setPreviewExpanded(false);
    setSensorPreviewVisible(!prefersCollapsedSensorPreview());
    spatialModeStartedHandlerRef.current?.();
  }, [setPreviewExpanded]);

  const resetCalibrationCapture = useCallback(() => {
    calibrationSamplesRef.current = emptyCalibrationSamples(
      calibrationDeviceKeyRef.current,
    );
    calibrationStageRef.current = "baseline";
    calibrationTrackIdRef.current = null;
    calibrationSourceRef.current = null;
    closedPinchCaptureRef.current = emptyClosedPinchCaptureState();
    setLastSensorFrame(null);
    setCalibrationStage("baseline");
    setCalibrationError(null);
    setCalibrationCounts({
      baseline: 0,
      reach: 0,
      reachReady: false,
      open: 0,
      closed: 0,
      closedReady: false,
    });
  }, []);

  const beginCalibrationCapture = useCallback(() => {
    resetCalibrationCapture();
    setPreviewExpanded(true);
  }, [resetCalibrationCapture, setPreviewExpanded]);

  useEffect(() => {
    const wasOpen = previousCalibrationOpenRef.current;
    previousCalibrationOpenRef.current = previewExpanded;
    if (previewExpanded && !wasOpen) resetCalibrationCapture();
  }, [previewExpanded, resetCalibrationCapture]);

  const updateCalibrationCounts = useCallback(
    (samples: HandCalibrationSamples) => {
      setCalibrationCounts((counts) => {
        const next = {
          baseline: stableOpenPalmFrameCount(
            samples.openPalmSamples ?? [],
          ),
          reach: samples.reachSamples.length,
          reachReady:
            samples.reachSamples.length >= MIN_CALIBRATION_REACH_SAMPLES &&
            assessHandCalibrationReach(samples.reachSamples).accepted,
          open: samples.openPinchRatios.length,
          closed: samples.closedPinchRatios.length,
          closedReady:
            samples.closedPinchRatios.length >= MIN_CALIBRATION_PINCH_SAMPLES &&
            !closedPinchCaptureRef.current.replacementPending,
        };
        return counts.baseline === next.baseline &&
          counts.reach === next.reach &&
          counts.reachReady === next.reachReady &&
          counts.open === next.open &&
          counts.closed === next.closed &&
          counts.closedReady === next.closedReady
          ? counts
          : next;
      });
    },
    [],
  );

  const acceptCalibrationSource = useCallback(
    (source: string) => {
      const current = calibrationSourceRef.current;
      if (!current) {
        calibrationSourceRef.current = source;
        return true;
      }
      if (current === source) return true;
      resetCalibrationCapture();
      calibrationSourceRef.current = source;
      setCalibrationError(
        "Hand tracking switched engines. Recalibrating for the active detector.",
      );
      return false;
    },
    [resetCalibrationCapture],
  );

  const captureCalibrationSensorFrame = useCallback(
    (frame: HandTrackingSensorFrame) => {
      if (!calibrationOpenRef.current) return;
      if (!acceptCalibrationSource(frame.source)) return;
      const current = calibrationSamplesRef.current;
      const activeTrackId = calibrationTrackIdRef.current;
      const matchingHand = frame.hands.find(
        (candidate) => candidate.trackId === activeTrackId,
      );
      const hand =
        matchingHand ?? (frame.hands.length === 1 ? frame.hands[0] : undefined);
      if (
        !hand ||
        hand.prediction.predicted ||
        hand.confidence < 0.5 ||
        hand.measurements.indexTipConfidence < 0.5 ||
        hand.measurements.thumbTipConfidence < 0.5
      ) {
        if (calibrationStageRef.current === "closed") {
          closedPinchCaptureRef.current = interruptClosedPinchCapture(
            closedPinchCaptureRef.current,
          );
          updateCalibrationCounts(current);
        }
        return;
      }
      if (activeTrackId !== hand.trackId)
        calibrationTrackIdRef.current = hand.trackId;
      const pointer = hand.measurements.indexTip;
      const pinchRatio = normalizedCalibrationPinchRatio(
        hand.measurements.pinchDistance,
        hand.measurements.palmScale,
        current.openPalmSamples,
        hand.measurements.pinchRatio,
      );
      if (
        !Number.isFinite(pointer.x) ||
        !Number.isFinite(pointer.y) ||
        pointer.x < 0 ||
        pointer.x > 1 ||
        pointer.y < 0 ||
        pointer.y > 1
      ) {
        if (calibrationStageRef.current === "closed") {
          closedPinchCaptureRef.current = interruptClosedPinchCapture(
            closedPinchCaptureRef.current,
          );
          updateCalibrationCounts(current);
        }
        return;
      }
      let next = current;
      if (
        calibrationStageRef.current === "baseline" &&
        hand.measurements.confidence >= 0.5 &&
        hand.measurements.thumbTipConfidence >= 0.5 &&
        isOpenPalmCalibrationPose(hand.landmarks, 0.5)
      )
        next = {
          ...current,
          openPalmSamples: appendRecentCalibrationSample(
            current.openPalmSamples ?? [],
            {
              center: hand.measurements.palmMcpCentroid,
              palmScale: hand.measurements.palmScale,
              pinchDistance: hand.measurements.pinchDistance,
              orientationRadians: openPalmOrientationRadians(hand.landmarks),
              confidence: Math.min(
                hand.confidence,
                hand.measurements.confidence,
                hand.measurements.indexTipConfidence,
                hand.measurements.thumbTipConfidence,
              ),
            },
            OPEN_PALM_SCAN_FRAMES,
          ),
        };
      else if (calibrationStageRef.current === "reach")
        next = {
          ...current,
          reachSamples: appendRecentCalibrationSample(
            current.reachSamples,
            pointer,
            MAX_CALIBRATION_REACH_SAMPLES,
          ),
        };
      else if (
        calibrationStageRef.current === "open" &&
        Number.isFinite(pinchRatio) &&
        hand.measurements.thumbTipConfidence >= 0.5 &&
        isClearlyOpenPinch(pinchRatio, current.openPalmSamples)
      )
        next = {
          ...current,
          openPinchRatios: appendRecentCalibrationSample(
            current.openPinchRatios,
            pinchRatio,
            MAX_CALIBRATION_PINCH_SAMPLES,
          ),
        };
      else if (calibrationStageRef.current === "closed") {
        if (
          Number.isFinite(pinchRatio) &&
          isClearlyClosedPinch(pinchRatio, current.openPinchRatios)
        ) {
          const closed = appendStableClosedPinchSample(
            current.closedPinchRatios,
            closedPinchCaptureRef.current,
            {
              ratio: pinchRatio,
              capturedAt: frame.timestamp,
              source: frame.source,
              trackId: hand.trackId,
            },
          );
          closedPinchCaptureRef.current = closed.state;
          next = {
            ...current,
            closedPinchRatios: closed.samples,
          };
        } else {
          closedPinchCaptureRef.current = interruptClosedPinchCapture(
            closedPinchCaptureRef.current,
          );
          updateCalibrationCounts(current);
          return;
        }
      }
      if (next === current) return;
      calibrationSamplesRef.current = next;
      updateCalibrationCounts(next);
    },
    [acceptCalibrationSource, updateCalibrationCounts],
  );

  const captureCalibrationObservation = useCallback((
    observation: HandTrackingObservation,
  ) => {
    const current = calibrationSamplesRef.current;
    if (observation.mode === "idle" || observation.mode === "bimanual_pinch") {
      if (calibrationStageRef.current === "closed") {
        closedPinchCaptureRef.current = interruptClosedPinchCapture(
          closedPinchCaptureRef.current,
        );
        updateCalibrationCounts(current);
      }
      return;
    }
    const source = observation.source ?? "semantic-observation";
    if (!acceptCalibrationSource(source)) return;
    const pointer = observation.measurements?.indexTip ?? observation.pointer;
    const pinchRatio = observation.measurements
      ? normalizedCalibrationPinchRatio(
          observation.measurements.pinchDistance,
          observation.measurements.palmScale,
          current.openPalmSamples,
          observation.measurements.pinchRatio,
        )
      : observation.pinchRatio;
    if (
      !Number.isFinite(pointer.x) ||
      !Number.isFinite(pointer.y) ||
      pointer.x < 0 ||
      pointer.x > 1 ||
      pointer.y < 0 ||
      pointer.y > 1
    ) {
      if (calibrationStageRef.current === "closed") {
        closedPinchCaptureRef.current = interruptClosedPinchCapture(
          closedPinchCaptureRef.current,
        );
        updateCalibrationCounts(current);
      }
      return;
    }
    const openPalmSamples =
      calibrationStageRef.current === "baseline" &&
      observation.mode === "open_palm" &&
      observation.measurements &&
      observation.landmarks &&
      isOpenPalmCalibrationPose(observation.landmarks, 0.5)
        ? appendRecentCalibrationSample(
            current.openPalmSamples ?? [],
            {
              center: observation.measurements.palmMcpCentroid,
              palmScale: observation.measurements.palmScale,
              pinchDistance: observation.measurements.pinchDistance,
              orientationRadians: openPalmOrientationRadians(
                observation.landmarks,
              ),
              confidence: Math.min(
                observation.confidence,
                observation.measurements.confidence,
                observation.measurements.indexTipConfidence,
                observation.measurements.thumbTipConfidence,
              ),
            },
            OPEN_PALM_SCAN_FRAMES,
          )
        : current.openPalmSamples;
    const reachSamples =
      calibrationStageRef.current === "reach"
        ? appendRecentCalibrationSample(
            current.reachSamples,
            pointer,
            MAX_CALIBRATION_REACH_SAMPLES,
          )
        : current.reachSamples;
    const openPinchRatios =
      calibrationStageRef.current === "open" &&
      (observation.mode === "point" || observation.mode === "open_palm") &&
      Number.isFinite(pinchRatio) &&
      isClearlyOpenPinch(pinchRatio as number, current.openPalmSamples)
        ? appendRecentCalibrationSample(
            current.openPinchRatios,
            pinchRatio as number,
            MAX_CALIBRATION_PINCH_SAMPLES,
          )
        : current.openPinchRatios;
    let closedPinchRatios = current.closedPinchRatios;
    if (calibrationStageRef.current === "closed") {
      if (
        observation.mode === "pinch" &&
        Number.isFinite(pinchRatio) &&
        isClearlyClosedPinch(
          pinchRatio as number,
          current.openPinchRatios,
        )
      ) {
        const closed = appendStableClosedPinchSample(
          current.closedPinchRatios,
          closedPinchCaptureRef.current,
          {
            ratio: pinchRatio as number,
            capturedAt: observation.timestamp,
            source,
            trackId: observation.trackId ?? "semantic-hand",
          },
        );
        closedPinchCaptureRef.current = closed.state;
        closedPinchRatios = closed.samples;
      } else {
        closedPinchCaptureRef.current = interruptClosedPinchCapture(
          closedPinchCaptureRef.current,
        );
      }
    }
    calibrationSamplesRef.current = {
      ...current,
      openPalmSamples,
      reachSamples,
      openPinchRatios,
      closedPinchRatios,
    };
    updateCalibrationCounts(calibrationSamplesRef.current);
  }, [acceptCalibrationSource, updateCalibrationCounts]);

  function setCalibrationCaptureStage(stage: CalibrationStage) {
    if (stage === "closed") {
      closedPinchCaptureRef.current = emptyClosedPinchCaptureState();
    }
    calibrationStageRef.current = stage;
    setCalibrationStage(stage);
    setCalibrationError(null);
  }

  function continueFromOpenPalmBaseline() {
    const result = assessOpenPalmCalibrationBaseline(
      (calibrationSamplesRef.current.openPalmSamples ?? []).slice(
        -OPEN_PALM_SCAN_FRAMES,
      ),
    );
    if (!result.accepted) {
      setCalibrationError(calibrationRefusalMessage(result.reason));
      return;
    }
    setCalibrationCaptureStage("reach");
  }

  function continueFromReach() {
    const result = assessHandCalibrationReach(
      calibrationSamplesRef.current.reachSamples,
    );
    if (!result.accepted) {
      setCalibrationError(calibrationRefusalMessage(result.reason));
      return;
    }
    setCalibrationCaptureStage("open");
  }

  function useCapturedCalibration() {
    const result = buildHandCalibration(calibrationSamplesRef.current);
    if (!result.accepted) {
      setCalibrationError(calibrationRefusalMessage(result.reason));
      return;
    }
    retainedCalibrationRef.current = result.profile;
    setCapturedCalibration(result.profile);
    setCapturedCalibrationKind("calibrated");
    controller.setPinchThresholds?.(resolvePinchThresholds(result.profile));
    calibrationResultHandlerRef.current?.(result);
    startSpatialMode();
  }

  function skipCalibration() {
    const profile = createFallbackHandCalibration({
      deviceKey: calibrationDeviceKey,
      mirrorX: true,
      createdAt: Date.now(),
    });
    const result: SpatialCalibrationResult = {
      accepted: false,
      reason: "skipped",
      profile,
    };
    retainedCalibrationRef.current = profile;
    setCapturedCalibration(profile);
    setCapturedCalibrationKind("skipped");
    controller.setPinchThresholds?.(resolvePinchThresholds(profile));
    calibrationResultHandlerRef.current?.(result);
    startSpatialMode();
  }

  function returnToCanvas() {
    if (!retainedCalibration && onCalibrationResult) return;
    if (status.state === "ready") startSpatialMode();
    else setPreviewExpanded(false);
  }

  useEffect(() => {
    observationHandlerRef.current = onObservation;
    statusHandlerRef.current = onStatusChange;
    spatialModeStartedHandlerRef.current = onSpatialModeStarted;
    calibrationOpenHandlerRef.current = onCalibrationOpenChange;
    calibrationResultHandlerRef.current = onCalibrationResult;
  }, [
    onCalibrationOpenChange,
    onCalibrationResult,
    onObservation,
    onSpatialModeStarted,
    onStatusChange,
  ]);

  useEffect(() => {
    controller.setPinchThresholds?.(
      retainedCalibration ? resolvePinchThresholds(retainedCalibration) : null,
    );
  }, [controller, retainedCalibration]);

  useEffect(() => {
    const unsubscribeStatus = controller.subscribeStatus((next) => {
      setStatus(next);
      statusHandlerRef.current?.(next);
      if (next.state === "ready") setStartingTarget(null);
      if (
        next.state === "ready" &&
        spatialModeRequestedRef.current &&
        !spatialModeStartedRef.current
      ) {
        if (
          calibrationResultHandlerRef.current &&
          !retainedCalibrationRef.current
        ) {
          beginCalibrationCapture();
        } else {
          startSpatialMode();
        }
      }
      if (next.state !== "ready") {
        setRuntimeDetailsOpen(false);
        setDetectedMode(null);
        setSelfCheck({});
        if (next.state === "refused" || next.state === "unavailable")
          spatialModeRequestedRef.current = false;
      }
    });
    const sensorFramesAvailable = Boolean(controller.subscribeSensorFrames);
    const unsubscribeSensorFrames = controller.subscribeSensorFrames?.((frame) => {
      if (calibrationOpenRef.current) setLastSensorFrame(frame);
      captureCalibrationSensorFrame(frame);
    });
    const unsubscribeObservations = controller.subscribeObservations(
      (observation) => {
        setLastObservation(observation.mode === "idle" ? null : observation);
        setDetectedMode(observation.mode === "idle" ? null : observation.mode);
        if (observation.mode === "point" || observation.mode === "pinch")
          setSelfCheck((current) => ({
            ...current,
            [observation.mode === "point"
              ? "pointConfidence"
              : "pinchConfidence"]: observation.confidence,
          }));
        if (
          calibrationOpenRef.current &&
          !sensorFramesAvailable
        )
          captureCalibrationObservation(observation);
        if (spatialModeStartedRef.current && !calibrationOpenRef.current)
          observationHandlerRef.current?.(observation);
      },
    );
    const unsubscribeEngine = controller.subscribeEngineStatus?.((engine) =>
      setEngineStatus(engine),
    );
    return () => {
      unsubscribeStatus();
      unsubscribeObservations();
      unsubscribeSensorFrames?.();
      unsubscribeEngine?.();
      if (!lifecycleStopIssuedRef.current) {
        lifecycleStopIssuedRef.current = true;
        controller.stop();
      }
    };
  }, [
    beginCalibrationCapture,
    captureCalibrationObservation,
    captureCalibrationSensorFrame,
    controller,
    startSpatialMode,
  ]);

  useEffect(() => {
    if (!lastObservation || lastObservation.mode === "idle") return;
    const capturedAt =
      "capturedAt" in lastObservation
        ? lastObservation.capturedAt ?? lastObservation.timestamp
        : lastObservation.timestamp;
    if (
      !Number.isFinite(capturedAt) ||
      capturedAt < 0 ||
      lastAcknowledgedCaptureRef.current === capturedAt
    )
      return;
    lastAcknowledgedCaptureRef.current = capturedAt;
    controller.acknowledgeRendered?.(capturedAt);
  }, [controller, lastObservation]);

  useEffect(() => {
    if (!previewExpanded || !lastSensorFrame) return;
    const capturedAt = lastSensorFrame.timestamp;
    if (
      !Number.isFinite(capturedAt) ||
      capturedAt < 0 ||
      lastAcknowledgedCaptureRef.current === capturedAt
    )
      return;
    lastAcknowledgedCaptureRef.current = capturedAt;
    controller.acknowledgeRendered?.(capturedAt);
  }, [controller, lastSensorFrame, previewExpanded]);

  useEffect(() => {
    const stopForPageLifecycle = () => {
      if (lifecycleStopIssuedRef.current) return;
      const current = controller.getStatus();
      if (current.state !== "starting" && current.state !== "ready") return;
      lifecycleStopIssuedRef.current = true;
      controller.stop();
      setRuntimeDetailsOpen(false);
      setStartingTarget(null);
      spatialModeStartedRef.current = false;
      spatialModeRequestedRef.current = false;
      setLastSensorFrame(null);
      setPreviewExpanded(false);
    };
    const stopWhenHidden = () => {
      if (document.visibilityState === "hidden") stopForPageLifecycle();
    };
    document.addEventListener("visibilitychange", stopWhenHidden);
    window.addEventListener("pagehide", stopForPageLifecycle);
    return () => {
      document.removeEventListener("visibilitychange", stopWhenHidden);
      window.removeEventListener("pagehide", stopForPageLifecycle);
    };
  }, [controller, setPreviewExpanded]);

  function startTracking({
    preserveSpatialMode = false,
    target = uploadConsent.get() ? "private-relay" : "local",
  }: {
    preserveSpatialMode?: boolean;
    target?: "private-relay" | "local";
  } = {}) {
    const video = videoRef.current;
    if (!video) return;
    lifecycleStopIssuedRef.current = false;
    setStartingTarget(target);
    if (!preserveSpatialMode) {
      spatialModeStartedRef.current = false;
      spatialModeRequestedRef.current = true;
    }
    setPreviewExpanded(false);
    void controller.start(video).catch(() => undefined);
  }

  function stopTracking() {
    lifecycleStopIssuedRef.current = true;
    controller.stop();
    setRuntimeDetailsOpen(false);
    setStartingTarget(null);
    spatialModeStartedRef.current = false;
    spatialModeRequestedRef.current = false;
    setLastSensorFrame(null);
    setPreviewExpanded(false);
  }

  function restartTrackingForEnginePreference(
    target: "private-relay" | "local",
  ) {
    const current = controller.getStatus();
    if (current.state !== "starting" && current.state !== "ready") return;
    const preserveSpatialMode = spatialModeStartedRef.current;
    const resumeSpatialMode =
      preserveSpatialMode || spatialModeRequestedRef.current;
    controller.stop();
    spatialModeStartedRef.current = preserveSpatialMode;
    spatialModeRequestedRef.current = !preserveSpatialMode && resumeSpatialMode;
    startTracking({ preserveSpatialMode: true, target });
  }

  const active = status.state === "starting" || status.state === "ready";
  const sensorPip = status.state === "ready" && !previewExpanded;
  const compactControl =
    !previewExpanded &&
    !sensorPip &&
    (status.state === "off" || status.state === "starting");
  const calibrationTrackedHands = previewExpanded
    ? (lastSensorFrame?.hands.map((hand) => ({
        handedness: hand.handedness,
        pointer: hand.measurements.indexTip,
        motionPointer: hand.measurements.palmMcpCentroid,
        confidence: hand.confidence,
        landmarks: hand.landmarks,
        trackId: hand.trackId,
        prediction: hand.prediction,
        measurements: hand.measurements,
        pinchDistance: hand.measurements.pinchDistance,
        pinchRatio: hand.measurements.pinchRatio,
        trackingState: "tracked" as const,
      })) ?? [])
    : [];
  const trackedHands =
    previewExpanded && lastSensorFrame
      ? calibrationTrackedHands
      : lastObservation?.mode === "bimanual_pinch"
        ? lastObservation.hands
        : lastObservation && lastObservation.mode !== "idle"
          ? [lastObservation]
          : [];

  useEffect(() => {
    if (!sensorPip) return;
    const keepReachable = () => {
      setSensorPipOffset((current) => clampCurrentSensorPip(current));
    };
    window.addEventListener("resize", keepReachable);
    window.addEventListener("orientationchange", keepReachable);
    return () => {
      window.removeEventListener("resize", keepReachable);
      window.removeEventListener("orientationchange", keepReachable);
    };
  }, [sensorPip]);

  return (
    <section
      ref={sectionRef}
      className={`spatial-camera-control${
        previewExpanded
          ? " is-expanded is-calibrating-full-canvas"
          : sensorPip
            ? " is-sensor-pip"
            : ""
      }${compactControl ? " is-compact" : ""}${
        sensorPip && !sensorPreviewVisible ? " is-sensor-pip-hidden" : ""
      }`}
      aria-label="Hand input"
      style={
        {
          "--sensor-pip-x": `${sensorPipOffset.x}px`,
          "--sensor-pip-y": `${sensorPipOffset.y}px`,
        } as CSSProperties
      }
    >
      <div className="spatial-camera-heading">
        {sensorPip ? (
          <button
            type="button"
            className="sensor-pip-drag-handle"
            aria-label="Move hand sensor preview"
            onPointerDown={(event) => {
              event.preventDefault();
              const bounds = sectionRef.current?.getBoundingClientRect();
              if (!bounds) return;
              sensorPipDragRef.current = {
                pointerId: event.pointerId,
                startX: event.clientX,
                startY: event.clientY,
                initialX: sensorPipOffset.x,
                initialY: sensorPipOffset.y,
                initialLeft: bounds.left,
                initialTop: bounds.top,
              };
              event.currentTarget.setPointerCapture?.(event.pointerId);
            }}
            onPointerMove={moveSensorPip}
            onPointerUp={finishSensorPipDrag}
            onPointerCancel={finishSensorPipDrag}
          >
            <span aria-hidden="true">⠿</span>
          </button>
        ) : null}
        <div>
          <strong>Hand input</strong>
          <span role="status" aria-live="polite">
            {statusLabel(status, engineStatus, startingTarget)}
          </span>
        </div>
        <div className="spatial-camera-actions">
          {sensorPip ? (
            <button
              type="button"
              aria-label={
                sensorPreviewVisible
                  ? "Hide hand sensor preview"
                  : "Show hand sensor preview"
              }
              onClick={() => setSensorPreviewVisible((visible) => !visible)}
            >
              {sensorPreviewVisible ? "Hide" : "Show"}
            </button>
          ) : null}
          <button
            type="button"
            aria-label={
              previewExpanded
                ? "Close hand calibration"
                : "Open hand calibration"
            }
            aria-expanded={previewExpanded}
            onClick={() => {
              if (previewExpanded) {
                returnToCanvas();
                return;
              }
              beginCalibrationCapture();
            }}
            disabled={
              previewExpanded && !retainedCalibration && Boolean(onCalibrationResult)
            }
          >
            {previewExpanded ? "Done" : "Calibrate"}
          </button>
          <button
            type="button"
            aria-label={active ? "Disable hand input" : "Enable hand input"}
            onClick={() => {
              if (active) {
                stopTracking();
                return;
              }
              startTracking();
            }}
          >
            {active ? "Disable" : "Enable"}
          </button>
        </div>
      </div>
      {privateGpuRelayAvailable ? (
        <label className="private-gpu-consent">
          <input
            type="checkbox"
            aria-label="Use private GPU hand tracking"
            checked={privateGpuConsent}
            onChange={(event) => {
              const next = event.currentTarget.checked;
              uploadConsent.set(next);
              setPrivateGpuConsent(next);
              restartTrackingForEnginePreference(next ? "private-relay" : "local");
            }}
          />
          <span>
            <strong>Use private GPU hand tracking</strong>
            <small>Explicit camera-upload consent. Local tracking remains the fallback.</small>
          </span>
        </label>
      ) : null}
      <div className={`camera-preview camera-${status.state}`}>
        <div
          className="camera-media-frame"
          style={
            {
              aspectRatio: videoAspectRatio,
              "--camera-width-from-height": `${videoAspectRatio * 100}cqh`,
              "--camera-height-from-width": `${100 / videoAspectRatio}cqw`,
            } as CSSProperties
          }
        >
          <video
            ref={videoRef}
            muted
            playsInline
            aria-label="Local hand tracking preview"
            onLoadedMetadata={(event) => {
              const { videoWidth, videoHeight } = event.currentTarget;
              if (videoWidth > 0 && videoHeight > 0)
                setVideoAspectRatio(videoWidth / videoHeight);
            }}
          />
          <div className="camera-sensor-context">
            <strong>
              {previewExpanded ? "Calibration view only" : "Sensor preview only"}
            </strong>
            <span>
              {previewExpanded
                ? "Return to the canvas to move, draw, resize, or throw objects."
                : "Your whole canvas is the hand control surface."}
            </span>
          </div>
          <div className="camera-keypoint-overlay" aria-hidden="true">
            {trackedHands.flatMap((hand, handIndex) =>
              (hand.landmarks ?? []).map((landmark, index) => (
                <span
                  key={`${handIndex}-${index}`}
                  data-hand-keypoint
                  className={index === 8 ? "is-index-tip" : undefined}
                  style={{
                    left: `${(1 - landmark.x) * 100}%`,
                    top: `${landmark.y * 100}%`,
                  }}
                />
              )),
            )}
            {trackedHands.map((hand, handIndex) => {
              const landmarks = hand.landmarks;
              return landmarks ? (
                <svg
                  key={`skeleton-${handIndex}`}
                  className="camera-hand-skeleton"
                  data-hand-skeleton
                  viewBox="0 0 1 1"
                  preserveAspectRatio="none"
                >
                  {HAND_CONNECTIONS.map(([from, to]) => (
                    <line
                      key={`${from}-${to}`}
                      data-hand-connection
                      x1={1 - landmarks[from].x}
                      y1={landmarks[from].y}
                      x2={1 - landmarks[to].x}
                      y2={landmarks[to].y}
                      vectorEffect="non-scaling-stroke"
                    />
                  ))}
                </svg>
              ) : null;
            })}
            {trackedHands.map((hand, index) => (
              <span
                key={`pointer-${index}`}
                data-tracked-hand-pointer
                className="camera-tracked-pointer"
                style={{
                  left: `${hand.pointer.x * 100}%`,
                  top: `${hand.pointer.y * 100}%`,
                }}
              />
            ))}
          </div>
          <span className="camera-preview-label">
            {previewExpanded && lastSensorFrame?.hands.length === 0
              ? "READY · show one hand"
              : previewExpanded && calibrationTrackedHands.length > 0
                ? `TRACKED · ${calibrationStage === "baseline" ? "hold your whole hand open" : calibrationStage === "reach" ? "move fingertip around your comfortable area" : calibrationStage === "open" ? "hold fingers apart" : calibrationStage === "closed" ? "touch thumb and index" : "ready to apply"}`
              : detectedMode === "pinch"
                ? "PINCH · ready to hold"
                : detectedMode === "bimanual_pinch"
                  ? "TWO HANDS · resize object or zoom canvas"
                  : detectedMode === "open_palm"
                    ? "OPEN · pen up or pan blank canvas"
                    : detectedMode === "point"
                      ? "POINT · move over an object, then pinch"
                      : status.state === "ready"
                        ? "READY · show one hand"
                        : "Preview appears after permission"}
          </span>
        </div>
      </div>
      {status.state === "ready" ? (
        <div className="camera-runtime-summary">
          {runtimeChipLabel(engineStatus) ? (
            <output
              className="hand-runtime-chip"
              aria-label="Hand runtime diagnostics"
              data-hand-runtime-chip
            >
              {runtimeChipLabel(engineStatus)}
            </output>
          ) : null}
          <button
            type="button"
            className="camera-runtime-disclosure"
            aria-label={
              runtimeDetailsOpen
                ? "Hide hand tracking details"
                : "Show hand tracking details"
            }
            aria-expanded={runtimeDetailsOpen}
            aria-controls={runtimeDetailsId}
            onClick={() => setRuntimeDetailsOpen((open) => !open)}
          >
            Details
          </button>
          {runtimeDetailsOpen ? (
            <div
              id={runtimeDetailsId}
              className="camera-runtime-details"
            >
              <div
                className="camera-calibration-readout"
                aria-label="Hand calibration readout"
              >
                <strong>21-point hand landmarks</strong>
                {engineStatus ? (
                  <span data-vision-engine={engineStatus.id}>
                    {engineStatus.fallback ? "Fallback" : "Engine"}{" "}
                    {engineStatus.displayName}
                  </span>
                ) : (
                  <span>Engine starting</span>
                )}
                {engineStatus?.executionProvider ? (
                  <span data-execution-provider={engineStatus.executionProvider}>
                    Provider {executionProviderLabel(engineStatus.executionProvider)}
                    {adapterLabel(engineStatus.adapter)
                      ? ` · ${adapterLabel(engineStatus.adapter)}`
                      : ""}
                  </span>
                ) : null}
                {engineStatus?.highPerformanceGpuRequested ? (
                  <span data-high-performance-gpu-request>
                    High-performance WebGPU adapter requested
                  </span>
                ) : null}
                {engineStatus?.fallbackReason ? (
                  <span data-execution-provider-fallback>
                    {fallbackLabel(engineStatus.fallbackKind)} ·{" "}
                    {engineStatus.fallbackReason}
                  </span>
                ) : null}
                {engineStatus?.detectorRoundTripMs !== undefined ? (
                  <span data-hand-runtime-metrics>
                    {engineStatus.processingLocation === "private-relay" &&
                    engineStatus.processingLatencyMs !== undefined
                      ? `${Math.round(engineStatus.processingLatencyMs)} ms GPU processing · ${Math.round(engineStatus.detectorRoundTripMs)} ms capture/result round trip`
                      : `${Math.round(engineStatus.detectorRoundTripMs)} ms detector/worker round trip${
                          engineStatus.resultRateFps !== undefined
                            ? ` · ${engineStatus.resultRateFps.toFixed(1)} results/s`
                            : ""
                        }`}
                  </span>
                ) : null}
                {engineStatus?.processingLocation === "private-relay" &&
                engineStatus.encodeLatencyMs !== undefined &&
                engineStatus.relayRoundTripMs !== undefined &&
                engineStatus.droppedBeforeEncode !== undefined &&
                engineStatus.droppedBeforeSend !== undefined ? (
                  <span data-hand-relay-pipeline-metrics>
                    {Math.round(engineStatus.encodeLatencyMs)} ms encode ·{" "}
                    {Math.round(engineStatus.relayRoundTripMs)} ms relay round trip ·
                    dropped {engineStatus.droppedBeforeEncode} raw /{" "}
                    {engineStatus.droppedBeforeSend} encoded
                  </span>
                ) : null}
                <span>
                  {trackedHands.length > 0
                    ? `${trackedHands.length} hand${trackedHands.length === 1 ? "" : "s"}`
                    : "No hand"}
                </span>
                <span>
                  {trackedHands[0]?.pinchRatio !== undefined
                    ? `Pinch ${trackedHands[0].pinchRatio.toFixed(2)}× palm`
                    : trackedHands[0]?.pinchDistance !== undefined
                      ? `Pinch distance ${trackedHands[0].pinchDistance.toFixed(3)}`
                      : "Pinch -"}
                </span>
                <span>
                  {trackedHands[0]?.handedness
                    ? `${trackedHands[0].handedness} hand`
                    : "Handedness -"}
                </span>
                <span>
                  {trackedHands[0]?.confidence !== undefined
                    ? `Confidence ${confidencePercent(trackedHands[0].confidence)}%`
                    : "Confidence -"}
                </span>
                <span>
                  {detectedMode
                    ? `State ${detectedMode.replaceAll("_", " ")}`
                    : "State READY"}
                </span>
                <span>Keep both hands inside frame · use even front light</span>
              </div>
              <div className="gesture-self-check" aria-label="Gesture self-check">
                <strong>
                  Gesture self-check ·{" "}
                  {Number(selfCheck.pointConfidence !== undefined) +
                    Number(selfCheck.pinchConfidence !== undefined)}
                  /2
                </strong>
                <span>
                  {selfCheck.pointConfidence === undefined
                    ? "Point not seen"
                    : `Point seen · ${confidencePercent(selfCheck.pointConfidence)}% confidence`}
                </span>
                <span>
                  {selfCheck.pinchConfidence === undefined
                    ? "Pinch not seen"
                    : `Pinch seen · ${confidencePercent(selfCheck.pinchConfidence)}% confidence`}
                </span>
                {selfCheck.pointConfidence !== undefined &&
                selfCheck.pinchConfidence !== undefined ? (
                  <em role="status">
                    Point and pinch detected in this camera session. Self-check
                    complete.
                  </em>
                ) : (
                  <em>Show a clear point, then touch thumb and index finger.</em>
                )}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
      {previewExpanded ? (
        <div className="camera-calibration-actions" aria-label="Hand calibration samples">
          <div
            className="camera-calibration-progress"
            role="status"
            data-calibration-stage={calibrationStage}
            data-calibration-baseline-count={calibrationCounts.baseline}
          >
            <strong>
              {calibrationStage === "baseline"
                ? calibrationCounts.baseline >= MIN_CALIBRATION_PINCH_SAMPLES
                  ? `1 of 4 · Open-hand scan complete · ${calibrationCounts.baseline} stable frames`
                  : `1 of 4 · Scanning open hand — ${calibrationCounts.baseline}/${OPEN_PALM_SCAN_FRAMES} stable frames`
                : calibrationStage === "reach"
                ? `2 of 4 · Map comfortable reach · ${calibrationCounts.reach} samples`
                : calibrationStage === "open"
                  ? `3 of 4 · Open fingers · ${calibrationCounts.open} samples`
                  : calibrationStage === "closed"
                    ? `4 of 4 · Touch thumb and index · ${calibrationCounts.closed} samples`
                    : "Calibration ready to review"}
            </strong>
            <span>{calibrationCounts.baseline} baseline · {calibrationCounts.reach} reach · {calibrationCounts.open} open · {calibrationCounts.closed} closed</span>
            <small>
              {calibrationStage === "baseline"
                ? "Hold one whole open hand comfortably in frame. All 21 landmarks must remain visible and stable while CommandCanvas learns 2D hand scale, center, envelope, and confidence."
                : calibrationStage === "reach"
                ? calibrationCounts.reach >= MIN_CALIBRATION_REACH_SAMPLES &&
                  !calibrationCounts.reachReady
                  ? "Keep moving left, right, up, and down inside a comfortable area. The next step unlocks when the comfortable area is wide enough; you do not need to reach the camera edges."
                  : "Move your index fingertip around a small, comfortable rectangle. You do not need to reach the camera edges; this region maps to the entire canvas."
                : calibrationStage === "open"
                  ? "Hold one hand naturally open with thumb and index clearly apart. CommandCanvas compares this pose with the whole-hand scan before recording it."
                  : calibrationStage === "closed"
                    ? "Touch the pads of your thumb and index finger. Calibration learns your pinch before gesture classification."
                    : "Your reach is frozen, so open and closed samples cannot shrink the usable canvas area."}
            </small>
          </div>
          {calibrationStage === "baseline" ? (
            <button
              type="button"
              className="camera-calibration-primary"
              aria-label="Continue to reach mapping"
              disabled={
                status.state !== "ready" ||
                calibrationCounts.baseline < MIN_CALIBRATION_PINCH_SAMPLES
              }
              onClick={continueFromOpenPalmBaseline}
            >
              Next · map reach
            </button>
          ) : calibrationStage === "reach" ? (
            <button
              type="button"
              className="camera-calibration-primary"
              aria-label="Continue to open hand"
              disabled={
                status.state !== "ready" ||
                !calibrationCounts.reachReady
              }
              onClick={continueFromReach}
            >
              Next · open hand
            </button>
          ) : calibrationStage === "open" ? (
            <button
              type="button"
              className="camera-calibration-primary"
              aria-label="Continue to closed pinch"
              disabled={
                status.state !== "ready" ||
                calibrationCounts.open < MIN_CALIBRATION_PINCH_SAMPLES
              }
              onClick={() => setCalibrationCaptureStage("closed")}
            >
              Next · close pinch
            </button>
          ) : calibrationStage === "closed" ? (
            <button
              type="button"
              className="camera-calibration-primary"
              aria-label="Review hand calibration"
              disabled={
                status.state !== "ready" ||
                !calibrationCounts.closedReady
              }
              onClick={() => setCalibrationCaptureStage("review")}
            >
              Review calibration
            </button>
          ) : (
            <button
              type="button"
              className="camera-calibration-primary"
              aria-label="Use hand calibration"
              disabled={status.state !== "ready"}
              onClick={useCapturedCalibration}
            >
              Use calibration
            </button>
          )}
          {calibrationError ? (
            <p className="camera-error-detail" role="alert">
              {calibrationError}
            </p>
          ) : null}
          {calibrationStage === "review" ? (
            <button
              type="button"
              className="camera-calibration-restart"
              aria-label="Restart hand calibration"
              disabled={status.state !== "ready"}
              onClick={resetCalibrationCapture}
            >
              Start over
            </button>
          ) : null}
          <button
            type="button"
            className="camera-calibration-skip"
            aria-label="Skip hand calibration"
            disabled={status.state !== "ready"}
            onClick={skipCalibration}
          >
            Skip for now
          </button>
          {retainedCalibration || !onCalibrationResult ? (
            <button
              type="button"
              aria-label="Return to full canvas"
              disabled={status.state !== "ready"}
              onClick={returnToCanvas}
            >
              Return to canvas
            </button>
          ) : null}
        </div>
      ) : null}
      {retainedCalibration && retainedCalibrationKind && !previewExpanded ? (
        <span className="camera-calibration-retained" role="status">
          {retainedCalibrationKind === "skipped"
            ? "Default controls · calibration skipped"
            : "Calibrated for this camera session"}
        </span>
      ) : null}
      {engineStatus?.processingLocation === "private-relay" || privateGpuConsent ? (
        <p>
          Bounded camera frames are uploaded only while hand input is active and
          private GPU consent remains on. The relay reports semantic landmarks and
          does not retain raw frames. Disable consent to close it immediately.
        </p>
      ) : (
        <p>
          Camera frames stay in this browser. The active local hand-pose engine
          downloads its model in your browser. Only semantic canvas commands are shared.
        </p>
      )}
      {status.state === "refused" || status.state === "unavailable" ? (
        <p className="camera-error-detail">{status.message}</p>
      ) : null}
    </section>
  );

  function moveSensorPip(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = sensorPipDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    const control = sectionRef.current;
    const workspace = control?.parentElement;
    if (!control || !workspace) return;
    const workspaceBounds = workspace.getBoundingClientRect();
    const controlBounds = control.getBoundingClientRect();
    const dockBounds = workspace
      .querySelector<HTMLElement>(".tool-dock")
      ?.getBoundingClientRect();
    const safe = sensorPipSafeBounds(
      workspaceBounds,
      dockBounds,
      controlBounds.width,
      controlBounds.height,
    );
    const left = clamp(
      drag.initialLeft + event.clientX - drag.startX,
      safe.left,
      safe.right,
    );
    const top = clamp(
      drag.initialTop + event.clientY - drag.startY,
      safe.top,
      safe.bottom,
    );
    setSensorPipOffset({
      x: drag.initialX + left - drag.initialLeft,
      y: drag.initialY + top - drag.initialTop,
    });
  }

  function finishSensorPipDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    const drag = sensorPipDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    moveSensorPip(event);
    if (event.currentTarget.hasPointerCapture?.(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    sensorPipDragRef.current = null;
  }

  function clampCurrentSensorPip(current: { x: number; y: number }) {
    const control = sectionRef.current;
    const workspace = control?.parentElement;
    if (!control || !workspace) return current;
    const workspaceBounds = workspace.getBoundingClientRect();
    const controlBounds = control.getBoundingClientRect();
    const dockBounds = workspace
      .querySelector<HTMLElement>(".tool-dock")
      ?.getBoundingClientRect();
    if (
      workspaceBounds.width <= 0 ||
      workspaceBounds.height <= 0 ||
      controlBounds.width <= 0 ||
      controlBounds.height <= 0
    )
      return current;
    const safe = sensorPipSafeBounds(
      workspaceBounds,
      dockBounds,
      controlBounds.width,
      controlBounds.height,
    );
    return {
      x:
        current.x +
        clamp(controlBounds.left, safe.left, safe.right) -
        controlBounds.left,
      y:
        current.y +
        clamp(controlBounds.top, safe.top, safe.bottom) -
        controlBounds.top,
    };
  }
}

function prefersCollapsedSensorPreview() {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(max-width: 720px)").matches
  );
}

function sensorPipSafeBounds(
  workspace: DOMRect,
  dock: DOMRect | undefined,
  width: number,
  height: number,
) {
  const inset = 8;
  const maxBottom = Math.min(
    workspace.bottom - inset,
    dock && dock.top > workspace.top ? dock.top - inset : workspace.bottom - inset,
  );
  return {
    left: workspace.left + inset,
    right: Math.max(workspace.left + inset, workspace.right - inset - width),
    top: workspace.top + inset,
    bottom: Math.max(workspace.top + inset, maxBottom - height),
  };
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function emptyCalibrationSamples(deviceKey: string): HandCalibrationSamples {
  return {
    deviceKey,
    mirrorX: true,
    createdAt: Date.now(),
    openPalmSamples: [],
    reachSamples: [],
    closedPinchRatios: [],
    openPinchRatios: [],
  };
}

function stableOpenPalmFrameCount(
  samples: readonly OpenPalmCalibrationSample[],
) {
  const recent = samples.slice(-OPEN_PALM_SCAN_FRAMES);
  if (recent.length < OPEN_PALM_SCAN_FRAMES) return recent.length;
  if (assessOpenPalmCalibrationBaseline(recent).accepted)
    return OPEN_PALM_SCAN_FRAMES;
  // Keep the scan recoverable: discard the moving prefix conceptually and
  // report a stable suffix while the six-frame sliding window refills.
  for (let start = 1; start < recent.length; start += 1) {
    const suffix = recent.slice(start);
    if (assessOpenPalmCalibrationBaseline(suffix).accepted)
      return suffix.length;
  }
  return 0;
}

function openPalmOrientationRadians(landmarks: HandLandmarks) {
  const wrist = landmarks[0];
  const middleMcp = landmarks[9];
  return Math.atan2(middleMcp.y - wrist.y, middleMcp.x - wrist.x);
}

function normalizedCalibrationPinchRatio(
  pinchDistance: number,
  palmScale: number,
  openPalmSamples: readonly OpenPalmCalibrationSample[] | undefined,
  fallbackRatio: number,
) {
  const baseline = assessOpenPalmCalibrationBaseline(openPalmSamples ?? []);
  try {
    return normalizePinchDistance(
      pinchDistance,
      palmScale,
      baseline.accepted ? baseline.baseline : null,
    );
  } catch {
    return fallbackRatio;
  }
}

function appendRecentCalibrationSample<T>(
  samples: readonly T[],
  sample: T,
  limit: number,
) {
  return samples.length < limit
    ? [...samples, sample]
    : [...samples.slice(samples.length - limit + 1), sample];
}

function isClearlyClosedPinch(
  pinchRatio: number,
  openRatios: readonly number[],
) {
  if (!isValidCalibrationPinchRatio(pinchRatio)) return false;
  if (openRatios.length < MIN_CALIBRATION_PINCH_SAMPLES) return false;
  const envelope = assessPinchCalibrationEnvelope([], openRatios);
  return (
    envelope.maximumClosed !== null &&
    pinchRatio <= envelope.maximumClosed
  );
}

function isClearlyOpenPinch(
  pinchRatio: number,
  openPalmSamples: readonly OpenPalmCalibrationSample[] | undefined,
) {
  if (!isValidCalibrationPinchRatio(pinchRatio)) return false;
  const baseline = assessOpenPalmCalibrationBaseline(openPalmSamples ?? []);
  if (!baseline.accepted) return false;
  const openReference = baseline.baseline.openPinchRatio;
  const minimumOpenRatio = Math.max(0.05, openReference * 0.75);
  return pinchRatio >= minimumOpenRatio;
}

function isValidCalibrationPinchRatio(pinchRatio: number) {
  return Number.isFinite(pinchRatio) && pinchRatio >= 0 && pinchRatio <= 2;
}

function appendStableClosedPinchSample(
  samples: readonly number[],
  state: ClosedPinchCaptureState,
  evidence: ClosedPinchEvidence,
) {
  if (
    !Number.isFinite(evidence.capturedAt) ||
    evidence.capturedAt < 0 ||
    (state.lastCapturedAt !== null &&
      evidence.capturedAt <= state.lastCapturedAt)
  )
    return { samples, state: interruptClosedPinchCapture(state) };
  const continuityBroken =
    (state.source !== null && state.source !== evidence.source) ||
    (state.trackId !== null && state.trackId !== evidence.trackId) ||
    (state.lastCapturedAt !== null &&
      evidence.capturedAt - state.lastCapturedAt >
        MAX_CLOSED_PINCH_SAMPLE_GAP_MS);
  const previous = continuityBroken
    ? emptyClosedPinchCaptureState()
    : state;
  const candidate = appendRecentCalibrationSample(
    previous.candidate,
    evidence,
    MAX_CLOSED_PINCH_CANDIDATE_SAMPLES,
  );
  const acceptedMedian = samples.length > 0 ? medianRatio(samples) : null;
  const plateauDelta =
    acceptedMedian === null
      ? null
      : Math.max(0.05, acceptedMedian * 0.12);
  const replacementPending =
    previous.replacementPending ||
    (acceptedMedian !== null &&
      plateauDelta !== null &&
      evidence.ratio <= acceptedMedian - plateauDelta);
  const pendingState: ClosedPinchCaptureState = {
    source: evidence.source,
    trackId: evidence.trackId,
    lastCapturedAt: evidence.capturedAt,
    candidate,
    stable: false,
    replacementPending,
  };
  const heldForMs =
    evidence.capturedAt - candidate[0]!.capturedAt;
  if (
    candidate.length < MIN_CALIBRATION_PINCH_SAMPLES ||
    heldForMs < MIN_CLOSED_PINCH_HOLD_MS
  )
    return { samples, state: pendingState };
  const ratios = candidate.map((sample) => sample.ratio);
  const sorted = [...ratios].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? (sorted[middle - 1]! + sorted[middle]!) / 2
      : sorted[middle]!;
  const spread = sorted[sorted.length - 1]! - sorted[0]!;
  const netDrift = Math.abs(ratios[ratios.length - 1]! - ratios[0]!);
  const maximumSpread = Math.max(0.06, Math.min(0.14, median * 0.35));
  const maximumNetDrift = Math.max(0.04, Math.min(0.08, median * 0.2));
  const windowStable =
    spread <= maximumSpread && netDrift <= maximumNetDrift;
  if (!windowStable)
    return {
      samples,
      state: {
        ...pendingState,
        candidate: previous.stable ? [evidence] : candidate.slice(1),
      },
    };
  let nextSamples = samples;
  if (
    acceptedMedian === null ||
    (plateauDelta !== null && median <= acceptedMedian - plateauDelta)
  )
    nextSamples = ratios;
  else if (
    plateauDelta !== null &&
    Math.abs(median - acceptedMedian) <= plateauDelta
  ) {
    const accepted = previous.stable ? [evidence.ratio] : ratios;
    nextSamples = accepted.reduce<readonly number[]>(
      (current, sample) =>
        appendRecentCalibrationSample(
          current,
          sample,
          MAX_CALIBRATION_PINCH_SAMPLES,
        ),
      samples,
    );
  }
  return {
    samples: nextSamples,
    state: {
      ...pendingState,
      stable: true,
      replacementPending: false,
    },
  };
}

function emptyClosedPinchCaptureState(): ClosedPinchCaptureState {
  return {
    source: null,
    trackId: null,
    lastCapturedAt: null,
    candidate: [],
    stable: false,
    replacementPending: false,
  };
}

function interruptClosedPinchCapture(
  state: ClosedPinchCaptureState,
): ClosedPinchCaptureState {
  if (
    state.candidate.length === 0 &&
    state.source === null &&
    state.trackId === null &&
    state.lastCapturedAt === null &&
    !state.stable &&
    !state.replacementPending
  )
    return state;
  return emptyClosedPinchCaptureState();
}

function medianRatio(samples: readonly number[]) {
  const sorted = [...samples].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
}

function calibrationRefusalMessage(
  reason: Exclude<HandCalibrationResult, { accepted: true }>["reason"],
) {
  if (reason === "open_palm_not_established")
    return "Calibration needs one stable whole open hand first. Keep all fingers and the wrist visible and still for a moment.";
  if (reason === "insufficient_reach")
    return "Calibration needs more reach samples. Move your fingertip around a comfortable rectangle, then try again.";
  if (reason === "reach_too_large")
    return "The detected reach jumped too far. Keep one hand in frame and restart calibration.";
  if (reason === "pinch_not_separated")
    return "Open and closed pinch looked the same. Restart, hold your fingers clearly apart for step 2, then touch the pads together for step 3.";
  return "Move your fingertip farther left, right, up, and down inside a comfortable area, then restart calibration.";
}

const HAND_CONNECTIONS = [
  [0, 1], [1, 2], [2, 3], [3, 4],
  [0, 5], [5, 6], [6, 7], [7, 8],
  [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16],
  [13, 17], [17, 18], [18, 19], [19, 20], [0, 17],
] as const;

function confidencePercent(confidence: number) {
  return Math.round(Math.max(0, Math.min(1, confidence)) * 100);
}

function createMutableConsentState() {
  let current = false;
  return {
    get: () => current,
    set(next: boolean) {
      current = next;
    },
  };
}

function executionProviderLabel(
  provider: NonNullable<HandTrackingEngineStatus["executionProvider"]>,
) {
  switch (provider) {
    case "webgpu":
      return "WebGPU";
    case "wasm":
      return "WASM";
    case "mediapipe":
      return "MediaPipe";
    case "cuda":
      return "CUDA";
    case "tensorrt":
      return "TensorRT";
    default:
      return "Unknown";
  }
}

function adapterLabel(adapter: HandTrackingEngineStatus["adapter"]) {
  return (
    adapter?.description ??
    adapter?.device ??
    adapter?.architecture ??
    adapter?.vendor ??
    ""
  );
}

function fallbackLabel(kind: HandTrackingEngineStatus["fallbackKind"]) {
  if (kind === "private-relay") return "Private GPU fallback";
  if (kind === "engine") return "Engine fallback";
  return "WebGPU fallback";
}

function statusLabel(
  status: HandTrackingStatus,
  engineStatus: HandTrackingEngineStatus | null,
  startingTarget: "private-relay" | "local" | null,
) {
  switch (status.state) {
    case "off":
      return "Camera off · pointer active";
    case "starting":
      return startingTarget === "private-relay"
        ? "Connecting to private GPU…"
        : "Starting local hand tracking…";
    case "ready":
      if (engineStatus?.processingLocation === "private-relay")
        return "Hand input ready · private GPU relay";
      return engineStatus?.fallbackKind === "private-relay"
        ? "Hand input ready · local fallback"
        : "Hand input ready · local only";
    case "refused":
      return "Camera permission refused · pointer active";
    case "unavailable":
      return "Hand input unavailable · pointer active";
  }
}

function runtimeChipLabel(engineStatus: HandTrackingEngineStatus | null) {
  const metrics = engineStatus?.runtimeMetrics;
  if (!engineStatus || !metrics) return null;
  const engine = engineStatus.id.startsWith("yolo26")
    ? "YOLO26"
    : engineStatus.processingLocation === "private-relay"
      ? "Private GPU"
      : engineStatus.displayName;
  const provider = engineStatus.executionProvider
    ? executionProviderLabel(engineStatus.executionProvider)
    : engineStatus.runtime;
  const rate = metrics.deliveredRateHz?.toFixed(1) ?? "-";
  const tail = metrics.captureToReceiveMs?.p95;
  const dropped =
    metrics.droppedSuperseded +
    metrics.droppedLateCapture +
    metrics.droppedStale +
    metrics.droppedBeforeEncode +
    metrics.droppedBeforeSend;
  return `${engine} · ${provider} · ${rate} Hz · p95 ${
    tail === undefined ? "-" : Math.round(tail)
  } ms · dropped ${dropped}`;
}
