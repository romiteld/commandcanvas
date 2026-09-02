"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  VISION_LAB_CAPTURE_TYPES,
  createVisionLabManifest,
  isPermanentVisionLabUser,
  mediaSettingsFromTrack,
  stopVisionLabTracks,
  type VisionLabCaptureType,
  type VisionLabMediaSettings,
  type VisionLabUser,
} from "@/lib/vision-lab/capture-contract";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser-client";

interface VisionLabRecorder {
  state: "inactive" | "recording" | "paused";
  mimeType: string;
  start: () => void;
  stop: () => void;
  ondataavailable: ((event: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  onerror: (() => void) | null;
}

export interface VisionLabEnvironment {
  loadUser: () => Promise<VisionLabUser | null>;
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  createRecorder: (stream: MediaStream) => VisionLabRecorder;
  now: () => Date;
  createSessionId: () => string;
  sha256: (blob: Blob) => Promise<string | null>;
  download: (name: string, blob: Blob) => void;
}

interface ActiveCapture {
  sessionId: string;
  captureType: VisionLabCaptureType;
  startedAt: string;
  media: VisionLabMediaSettings;
  chunks: Blob[];
}

type CaptureState = "checking" | "refused" | "ready" | "acquiring" | "recording" | "exporting" | "error";

const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: {
    facingMode: "user",
    width: { ideal: 1280 },
    height: { ideal: 720 },
  },
};

export function VisionLabCapture({
  environment = browserEnvironment,
}: {
  environment?: VisionLabEnvironment;
}) {
  const [captureType, setCaptureType] =
    useState<VisionLabCaptureType>("acquisition");
  const [state, setState] = useState<CaptureState>("checking");
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<VisionLabRecorder | null>(null);
  const downloadOnStopRef = useRef(false);
  const mountedRef = useRef(false);

  const releaseCapture = useCallback(() => {
    const stream = streamRef.current;
    streamRef.current = null;
    recorderRef.current = null;
    if (videoRef.current?.srcObject === stream) videoRef.current.srcObject = null;
    if (stream) stopVisionLabTracks(stream);
  }, []);

  const exportCapture = useCallback(
    async (capture: ActiveCapture) => {
      const video = new Blob(capture.chunks, { type: capture.media.mimeType });
      const videoSha256 = await environment.sha256(video);
      const stoppedAt = environment.now().toISOString();
      const manifest = createVisionLabManifest({
        sessionId: capture.sessionId,
        captureType: capture.captureType,
        startedAt: capture.startedAt,
        stoppedAt,
        media: capture.media,
        mirrorDisplay: true,
        ...(videoSha256 ? { videoSha256 } : {}),
      });
      environment.download(`${capture.sessionId}.webm`, video);
      environment.download(
        `${capture.sessionId}.json`,
        new Blob([`${JSON.stringify(manifest, null, 2)}\n`], {
          type: "application/json",
        }),
      );
    },
    [environment],
  );

  const stopCapture = useCallback(
    (download: boolean) => {
      const recorder = recorderRef.current;
      if (!recorder) {
        releaseCapture();
        return;
      }
      downloadOnStopRef.current = download;
      if (download && mountedRef.current) setState("exporting");
      try {
        if (recorder.state !== "inactive") recorder.stop();
        else releaseCapture();
      } catch {
        releaseCapture();
        if (mountedRef.current) {
          setError("The camera recording could not be stopped safely.");
          setState("error");
        }
      }
    },
    [releaseCapture],
  );

  useEffect(() => {
    mountedRef.current = true;
    let active = true;
    void environment.loadUser().then(
      (user) => {
        if (!active) return;
        setState(isPermanentVisionLabUser(user) ? "ready" : "refused");
      },
      () => {
        if (!active) return;
        setState("refused");
      },
    );
    const handlePageHide = () => stopCapture(false);
    window.addEventListener("pagehide", handlePageHide);
    return () => {
      active = false;
      mountedRef.current = false;
      window.removeEventListener("pagehide", handlePageHide);
      stopCapture(false);
    };
  }, [environment, stopCapture]);

  const startCapture = useCallback(async () => {
    if (state !== "ready" && state !== "error") return;
    setError(null);
    setState("acquiring");
    let stream: MediaStream | null = null;
    try {
      stream = await environment.getUserMedia(CAMERA_CONSTRAINTS);
      if (!mountedRef.current) {
        stopVisionLabTracks(stream);
        return;
      }
      const recorder = environment.createRecorder(stream);
      const capture: ActiveCapture = {
        sessionId: environment.createSessionId(),
        captureType,
        startedAt: environment.now().toISOString(),
        media: mediaSettingsFromTrack(stream.getVideoTracks()[0], recorder.mimeType),
        chunks: [],
      };
      streamRef.current = stream;
      recorderRef.current = recorder;
      if (videoRef.current) videoRef.current.srcObject = stream;
      recorder.ondataavailable = ({ data }) => {
        if (data.size > 0) capture.chunks.push(data);
      };
      recorder.onstop = () => {
        const shouldDownload = downloadOnStopRef.current;
        downloadOnStopRef.current = false;
        releaseCapture();
        if (!shouldDownload || !mountedRef.current) return;
        void exportCapture(capture).then(
          () => {
            if (mountedRef.current) setState("ready");
          },
          () => {
            if (mountedRef.current) {
              setError("The local recording could not be prepared for download.");
              setState("error");
            }
          },
        );
      };
      recorder.onerror = () => {
        downloadOnStopRef.current = false;
        releaseCapture();
        if (mountedRef.current) {
          setError("The local camera recorder failed and was stopped.");
          setState("error");
        }
      };
      recorder.start();
      setState("recording");
    } catch {
      if (streamRef.current === stream) releaseCapture();
      else if (stream) stopVisionLabTracks(stream);
      if (mountedRef.current) {
        setError("Camera access was not available. Nothing was recorded or uploaded.");
        setState("error");
      }
    }
  }, [captureType, environment, releaseCapture, state]);

  if (state === "checking") return <p>Checking verified account access…</p>;
  if (state === "refused")
    return (
      <section className="vision-lab-card" aria-labelledby="vision-lab-title">
        <h1 id="vision-lab-title">Vision Lab</h1>
        <p role="alert">
          Vision Lab is available only to a verified CommandCanvas account.
        </p>
      </section>
    );

  return (
    <section className="vision-lab-card" aria-labelledby="vision-lab-title">
      <p className="eyebrow">Private local capture</p>
      <h1 id="vision-lab-title">Vision Lab</h1>
      <p>
        Record clean camera footage locally for hand-pose evaluation. The camera
        feed is never uploaded; stopping creates only a WebM and matching JSON
        manifest download on this device.
      </p>
      <label htmlFor="vision-lab-capture-type">Session guide</label>
      <select
        id="vision-lab-capture-type"
        value={captureType}
        disabled={state !== "ready"}
        onChange={(event) => setCaptureType(event.target.value as VisionLabCaptureType)}
      >
        {VISION_LAB_CAPTURE_TYPES.map((type) => (
          <option key={type.value} value={type.value}>
            {type.label}
          </option>
        ))}
      </select>
      <div className="vision-lab-preview" aria-label="Camera preview with separate feedback">
        <video ref={videoRef} autoPlay muted playsInline aria-label="Local raw camera preview" />
        <p aria-live="polite">
          {state === "recording"
            ? `Recording ${VISION_LAB_CAPTURE_TYPES.find((type) => type.value === captureType)?.label} locally`
            : "Choose a named session, then deliberately start the camera."}
        </p>
      </div>
      {state === "ready" || state === "error" ? (
        <button type="button" onClick={() => void startCapture()}>
          Start capture
        </button>
      ) : null}
      {state === "recording" ? (
        <button type="button" onClick={() => stopCapture(true)}>
          Stop and download
        </button>
      ) : null}
      {state === "acquiring" || state === "exporting" ? <p>Working locally…</p> : null}
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}

const browserEnvironment: VisionLabEnvironment = {
  async loadUser() {
    const clientResult = createBrowserSupabaseClient({
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    });
    if (!clientResult.ok) return null;
    const { data, error } = await clientResult.client.auth.getSession();
    const user = data.session?.user;
    if (error || !user) return null;
    return {
      id: user.id,
      email: user.email,
      emailConfirmedAt: user.email_confirmed_at,
      isAnonymous: user.is_anonymous,
    };
  },
  getUserMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints),
  createRecorder: (stream) => new MediaRecorder(stream) as unknown as VisionLabRecorder,
  now: () => new Date(),
  createSessionId: () => `vision-lab-${globalThis.crypto.randomUUID()}`,
  async sha256(blob) {
    if (!globalThis.crypto?.subtle) return null;
    const digest = await globalThis.crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  },
  download(name, blob) {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    anchor.click();
    queueMicrotask(() => URL.revokeObjectURL(url));
  },
};
