"use client";

import { useEffect, useId, useRef, useState } from "react";

import type {
  HandTrackingController,
  HandTrackingEngineStatus,
  HandTrackingObservation,
  HandTrackingStatus,
} from "@/lib/gesture/hand-tracking-controller";
import { createHandTrackingController } from "@/lib/gesture/hand-tracking-controller";

export interface SpatialCameraControlProps {
  calibrationOpen?: boolean;
  createController?: (
    preferences: SpatialCameraControllerPreferences,
  ) => HandTrackingController;
  privateGpuRelayAvailable?: boolean;
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
  createController = () => createHandTrackingController(),
  privateGpuRelayAvailable = false,
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
  const [videoAspectRatio, setVideoAspectRatio] = useState(4 / 3);
  const videoRef = useRef<HTMLVideoElement>(null);
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

  const previewExpanded = calibrationOpen ?? internalCalibrationOpen;

  useEffect(() => {
    calibrationOpenRef.current = previewExpanded;
  }, [previewExpanded]);

  function setPreviewExpanded(next: boolean) {
    calibrationOpenRef.current = next;
    setInternalCalibrationOpen(next);
    calibrationOpenHandlerRef.current?.(next);
  }

  function returnToCanvas() {
    setPreviewExpanded(false);
    if (status.state !== "ready") return;
    spatialModeStartedRef.current = true;
    spatialModeRequestedRef.current = false;
    spatialModeStartedHandlerRef.current?.();
  }

  useEffect(() => {
    observationHandlerRef.current = onObservation;
    statusHandlerRef.current = onStatusChange;
    spatialModeStartedHandlerRef.current = onSpatialModeStarted;
    calibrationOpenHandlerRef.current = onCalibrationOpenChange;
  }, [onCalibrationOpenChange, onObservation, onSpatialModeStarted, onStatusChange]);

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
        spatialModeStartedRef.current = true;
        spatialModeRequestedRef.current = false;
        setPreviewExpanded(false);
        spatialModeStartedHandlerRef.current?.();
      }
      if (next.state !== "ready") {
        setRuntimeDetailsOpen(false);
        setDetectedMode(null);
        setSelfCheck({});
        if (next.state === "refused" || next.state === "unavailable")
          spatialModeRequestedRef.current = false;
      }
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
      unsubscribeEngine?.();
      if (!lifecycleStopIssuedRef.current) {
        lifecycleStopIssuedRef.current = true;
        controller.stop();
      }
    };
  }, [controller]);

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
  }, [controller]);

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
  const trackedHands =
    lastObservation?.mode === "bimanual_pinch"
      ? lastObservation.hands
      : lastObservation && lastObservation.mode !== "idle"
        ? [lastObservation]
        : [];

  return (
    <section
      className={`spatial-camera-control${previewExpanded ? " is-expanded" : ""}`}
      aria-label="Hand input"
    >
      <div className="spatial-camera-heading">
        <div>
          <strong>Hand input</strong>
          <span role="status" aria-live="polite">
            {statusLabel(status, engineStatus, startingTarget)}
          </span>
        </div>
        <div className="spatial-camera-actions">
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
              setPreviewExpanded(true);
            }}
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
          style={{ aspectRatio: videoAspectRatio }}
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
            {detectedMode === "pinch"
              ? "PINCH · ready to hold"
              : detectedMode === "bimanual_pinch"
                ? "TWO HANDS · spread to resize"
                : detectedMode === "open_palm"
                  ? "OPEN · hold steady to focus"
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
        <div className="camera-calibration-actions">
          <button
            type="button"
            aria-label="Return to full canvas"
            disabled={status.state !== "ready"}
            onClick={returnToCanvas}
          >
            Return to canvas
          </button>
        </div>
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
      ? "Private YOLO"
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
