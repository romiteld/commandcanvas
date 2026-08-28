"use client";

import { useEffect, useRef, useState } from "react";

import type {
  HandTrackingController,
  HandTrackingEngineStatus,
  HandTrackingObservation,
  HandTrackingStatus,
} from "@/lib/gesture/hand-tracking-controller";
import { createHandTrackingController } from "@/lib/gesture/hand-tracking-controller";

export interface SpatialCameraControlProps {
  createController?: () => HandTrackingController;
  onObservation?: (observation: HandTrackingObservation) => void;
  onStatusChange?: (status: HandTrackingStatus) => void;
  onSpatialModeStarted?: () => void;
}

export function SpatialCameraControl({
  createController = createHandTrackingController,
  onObservation,
  onStatusChange,
  onSpatialModeStarted,
}: SpatialCameraControlProps) {
  const [controller] = useState(createController);
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
  const [previewExpanded, setPreviewExpanded] = useState(false);
  const [lastObservation, setLastObservation] =
    useState<HandTrackingObservation | null>(null);
  const [videoAspectRatio, setVideoAspectRatio] = useState(4 / 3);
  const videoRef = useRef<HTMLVideoElement>(null);
  const spatialModeStartedRef = useRef(false);
  const observationHandlerRef = useRef(onObservation);
  const statusHandlerRef = useRef(onStatusChange);

  useEffect(() => {
    observationHandlerRef.current = onObservation;
    statusHandlerRef.current = onStatusChange;
  }, [onObservation, onStatusChange]);

  useEffect(() => {
    const unsubscribeStatus = controller.subscribeStatus((next) => {
      setStatus(next);
      statusHandlerRef.current?.(next);
      if (next.state !== "ready") {
        setDetectedMode(null);
        setSelfCheck({});
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
        if (spatialModeStartedRef.current)
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
      controller.stop();
    };
  }, [controller]);

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
            {statusLabel(status)}
          </span>
        </div>
        <div className="spatial-camera-actions">
          <button
            type="button"
            aria-label={
              previewExpanded
                ? "Collapse hand tracking preview"
                : "Expand hand tracking preview"
            }
            aria-expanded={previewExpanded}
            onClick={() => setPreviewExpanded((current) => !current)}
          >
            {previewExpanded ? "Collapse" : "Expand"}
          </button>
          <button
            type="button"
            aria-label={active ? "Disable hand input" : "Enable hand input"}
            onClick={() => {
              if (active) {
                controller.stop();
                spatialModeStartedRef.current = false;
                setPreviewExpanded(false);
                return;
              }
              const video = videoRef.current;
              if (video) {
                spatialModeStartedRef.current = false;
                setPreviewExpanded(true);
                void controller.start(video).catch(() => undefined);
              }
            }}
          >
            {active ? "Disable" : "Enable"}
          </button>
        </div>
      </div>
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
          <div className="camera-interaction-boundary" aria-hidden="true" />
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
        <div className="camera-calibration-readout" aria-label="Hand calibration readout">
          <strong>21-point hand landmarks</strong>
          {engineStatus ? (
            <span data-vision-engine={engineStatus.id}>
              {engineStatus.fallback ? "Fallback" : "Engine"} {engineStatus.displayName}
            </span>
          ) : (
            <span>Engine starting</span>
          )}
          <span>{trackedHands.length > 0 ? `${trackedHands.length} hand${trackedHands.length === 1 ? "" : "s"}` : "No hand"}</span>
          <span>
            {trackedHands[0]?.pinchDistance !== undefined
              ? `Pinch ${trackedHands[0].pinchDistance.toFixed(3)}`
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
          <span>{detectedMode ? `State ${detectedMode.replaceAll("_", " ")}` : "State READY"}</span>
          <span>Keep both hands inside frame · use even front light</span>
        </div>
      ) : null}
      {previewExpanded ? (
        <div className="camera-calibration-actions">
          <button
            type="button"
            aria-label="Cancel spatial calibration"
            onClick={() => {
              controller.stop();
              spatialModeStartedRef.current = false;
              setPreviewExpanded(false);
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            aria-label="Start spatial mode"
            disabled={status.state !== "ready"}
            onClick={() => {
              spatialModeStartedRef.current = true;
              setPreviewExpanded(false);
              onSpatialModeStarted?.();
            }}
          >
            Start Spatial Mode
          </button>
        </div>
      ) : null}
      <p>
        Camera frames stay in this browser. The active local hand-pose engine
        downloads its model in your browser. Only semantic canvas commands are shared.
      </p>
      {status.state === "ready" ? (
        <div className="gesture-self-check" aria-label="Gesture self-check">
          <strong>
            Gesture self-check · {Number(selfCheck.pointConfidence !== undefined) +
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
              Point and pinch detected in this camera session. Self-check complete.
            </em>
          ) : (
            <em>Show a clear point, then touch thumb and index finger.</em>
          )}
        </div>
      ) : null}
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

function statusLabel(status: HandTrackingStatus) {
  switch (status.state) {
    case "off":
      return "Camera off · pointer active";
    case "starting":
      return "Starting camera locally…";
    case "ready":
      return "Hand input ready · local only";
    case "refused":
      return "Camera permission refused · pointer active";
    case "unavailable":
      return "Hand input unavailable · pointer active";
  }
}
