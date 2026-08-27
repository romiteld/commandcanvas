"use client";

import { useEffect, useRef, useState } from "react";

import type {
  HandTrackingController,
  HandTrackingObservation,
  HandTrackingStatus,
} from "@/lib/gesture/hand-tracking-controller";
import { createHandTrackingController } from "@/lib/gesture/hand-tracking-controller";

export interface SpatialCameraControlProps {
  createController?: () => HandTrackingController;
  onObservation?: (observation: HandTrackingObservation) => void;
  onStatusChange?: (status: HandTrackingStatus) => void;
}

export function SpatialCameraControl({
  createController = createHandTrackingController,
  onObservation,
  onStatusChange,
}: SpatialCameraControlProps) {
  const [controller] = useState(createController);
  const [status, setStatus] = useState<HandTrackingStatus>(() =>
    controller.getStatus(),
  );
  const [detectedMode, setDetectedMode] = useState<"point" | "pinch" | null>(
    null,
  );
  const [selfCheck, setSelfCheck] = useState<{
    pointConfidence?: number;
    pinchConfidence?: number;
  }>({});
  const videoRef = useRef<HTMLVideoElement>(null);
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
        setDetectedMode(observation.mode === "idle" ? null : observation.mode);
        if (observation.mode !== "idle")
          setSelfCheck((current) => ({
            ...current,
            ...(observation.mode === "point"
              ? { pointConfidence: observation.confidence }
              : { pinchConfidence: observation.confidence }),
          }));
        observationHandlerRef.current?.(observation);
      },
    );
    return () => {
      unsubscribeStatus();
      unsubscribeObservations();
      controller.stop();
    };
  }, [controller]);

  const active = status.state === "starting" || status.state === "ready";

  return (
    <section className="spatial-camera-control" aria-label="Hand input">
      <div className="spatial-camera-heading">
        <div>
          <strong>Hand input</strong>
          <span role="status" aria-live="polite">
            {statusLabel(status)}
          </span>
        </div>
        <button
          type="button"
          aria-label={active ? "Disable hand input" : "Enable hand input"}
          onClick={() => {
            if (active) {
              controller.stop();
              return;
            }
            const video = videoRef.current;
            if (video) void controller.start(video).catch(() => undefined);
          }}
        >
          {active ? "Disable" : "Enable"}
        </button>
      </div>
      <div className={`camera-preview camera-${status.state}`}>
        <video
          ref={videoRef}
          muted
          playsInline
          aria-label="Local hand tracking preview"
        />
        <span className="camera-preview-label">
          {detectedMode === "pinch"
            ? "Hand detected · pinch to move"
            : detectedMode === "point"
              ? "Hand detected · index finger drawing"
              : status.state === "ready"
                ? "Show one hand to begin"
                : "Preview appears after permission"}
        </span>
      </div>
      <p>
        Camera frames stay in this browser. When hand input is enabled, the
        detector model downloads from Google. Only semantic canvas commands are
        shared.
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
