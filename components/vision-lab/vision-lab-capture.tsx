"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  VISION_LAB_CAPTURE_TYPES,
  createVisionLabManifest,
  isPermanentVisionLabUser,
  mediaSettingsFromTrack,
  selectSupportedWebmMime,
  stopVisionLabTracks,
  type VisionLabCaptureType,
  type VisionLabManifest,
  type VisionLabMediaSettings,
  type VisionLabUser,
} from "@/lib/vision-lab/capture-contract";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser-client";

interface VisionLabRecorder {
  state: "inactive" | "recording" | "paused";
  mimeType: string;
  start: (timeslice?: number) => void;
  stop: () => void;
  ondataavailable: ((event: { data: Blob }) => void) | null;
  onstop: (() => void) | null;
  onerror: (() => void) | null;
}

export interface VisionLabEnvironment {
  loadUser: () => Promise<VisionLabUser | null>;
  subscribeUser: (listener: (user: VisionLabUser | null) => void) => () => void;
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  selectWebmMime: () => string | null;
  createRecorder: (stream: MediaStream, mimeType: string) => VisionLabRecorder;
  now: () => Date;
  createSessionId: () => string;
  sha256: (blob: Blob) => Promise<string | null>;
  download: (name: string, blob: Blob) => void;
}

interface ActiveCapture {
  sessionId: string;
  captureType: VisionLabCaptureType;
  startedAt: string;
  stoppedAt?: string;
  media: VisionLabMediaSettings;
  chunks: Blob[];
  cancelled: boolean;
  exportRequested: boolean;
  video?: Blob;
  manifest?: VisionLabManifest;
  videoDownloaded: boolean;
  manifestDownloaded: boolean;
}

type CaptureState =
  | "checking"
  | "refused"
  | "ready"
  | "acquiring"
  | "recording"
  | "exporting"
  | "download-error"
  | "error";

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
  const [captureType, setCaptureType] = useState<VisionLabCaptureType>("acquisition");
  const [state, setState] = useState<CaptureState>("checking");
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<VisionLabRecorder | null>(null);
  const activeCaptureRef = useRef<ActiveCapture | null>(null);
  const mountedRef = useRef(false);

  const releasePhysicalCapture = useCallback(() => {
    const stream = streamRef.current;
    streamRef.current = null;
    recorderRef.current = null;
    if (videoRef.current?.srcObject === stream) videoRef.current.srcObject = null;
    if (stream) stopVisionLabTracks(stream);
  }, []);

  const downloadCapture = useCallback(
    async (capture: ActiveCapture) => {
      if (!capture.video)
        capture.video = new Blob(capture.chunks, { type: capture.media.mimeType });
      if (!capture.manifest) {
        let videoSha256: string | null = null;
        try {
          videoSha256 = await environment.sha256(capture.video);
        } catch {
          // Hashing is optional; a completed local WebM must still be downloadable.
        }
        capture.manifest = createVisionLabManifest({
          sessionId: capture.sessionId,
          captureType: capture.captureType,
          startedAt: capture.startedAt,
          stoppedAt: capture.stoppedAt ?? capture.startedAt,
          media: capture.media,
          mirrorDisplay: true,
          ...(videoSha256 ? { videoSha256 } : {}),
        });
      }
      try {
        if (!capture.videoDownloaded) {
          environment.download(`${capture.sessionId}.webm`, capture.video);
          capture.videoDownloaded = true;
        }
        if (!capture.manifestDownloaded) {
          environment.download(
            `${capture.sessionId}.json`,
            new Blob([`${JSON.stringify(capture.manifest, null, 2)}\n`], {
              type: "application/json",
            }),
          );
          capture.manifestDownloaded = true;
        }
        if (activeCaptureRef.current === capture) activeCaptureRef.current = null;
        if (mountedRef.current) setState("ready");
      } catch {
        if (mountedRef.current) {
          setError("The completed local recording is ready to retry downloading.");
          setState("download-error");
        }
      }
    },
    [environment],
  );

  const stopCapture = useCallback(
    (download: boolean) => {
      const capture = activeCaptureRef.current;
      const recorder = recorderRef.current;
      if (capture) {
        capture.cancelled = !download;
        capture.exportRequested = download;
        if (download) capture.stoppedAt = environment.now().toISOString();
      }
      releasePhysicalCapture();
      if (download && mountedRef.current) setState("exporting");
      try {
        if (recorder && recorder.state !== "inactive") recorder.stop();
      } catch {
        if (mountedRef.current) {
          setError("The camera recording could not be stopped safely.");
          setState("error");
        }
      }
    },
    [environment, releasePhysicalCapture],
  );

  useEffect(() => {
    mountedRef.current = true;
    let active = true;
    const applyUser = (user: VisionLabUser | null) => {
      if (!active) return;
      if (!isPermanentVisionLabUser(user)) {
        stopCapture(false);
        setState("refused");
        return;
      }
      if (!activeCaptureRef.current) setState("ready");
    };
    void environment.loadUser().then(applyUser, () => applyUser(null));
    const unsubscribe = environment.subscribeUser(applyUser);
    const handlePageHide = () => stopCapture(false);
    window.addEventListener("pagehide", handlePageHide);
    return () => {
      active = false;
      mountedRef.current = false;
      unsubscribe();
      window.removeEventListener("pagehide", handlePageHide);
      stopCapture(false);
    };
  }, [environment, stopCapture]);

  const startCapture = useCallback(async () => {
    if (state !== "ready") return;
    setError(null);
    setState("acquiring");
    const user = await environment.loadUser().catch(() => null);
    if (!mountedRef.current || !isPermanentVisionLabUser(user)) {
      if (mountedRef.current) setState("refused");
      return;
    }
    const mimeType = environment.selectWebmMime();
    if (!mimeType) {
      setError("This browser cannot create a WebM recording for Vision Lab.");
      setState("error");
      return;
    }
    let stream: MediaStream | null = null;
    try {
      stream = await environment.getUserMedia(CAMERA_CONSTRAINTS);
      if (!mountedRef.current) {
        stopVisionLabTracks(stream);
        return;
      }
      const recorder = environment.createRecorder(stream, mimeType);
      const capture: ActiveCapture = {
        sessionId: environment.createSessionId(),
        captureType,
        startedAt: environment.now().toISOString(),
        media: mediaSettingsFromTrack(stream.getVideoTracks()[0], mimeType),
        chunks: [],
        cancelled: false,
        exportRequested: false,
        videoDownloaded: false,
        manifestDownloaded: false,
      };
      streamRef.current = stream;
      recorderRef.current = recorder;
      activeCaptureRef.current = capture;
      if (videoRef.current) videoRef.current.srcObject = stream;
      recorder.ondataavailable = ({ data }) => {
        if (!capture.cancelled && data.size > 0) capture.chunks.push(data);
      };
      recorder.onstop = () => {
        if (!capture.exportRequested || capture.cancelled || !mountedRef.current) return;
        void downloadCapture(capture);
      };
      recorder.onerror = () => {
        capture.cancelled = true;
        releasePhysicalCapture();
        if (mountedRef.current) {
          setError("The local camera recorder failed and was stopped.");
          setState("error");
        }
      };
      recorder.start(1_000);
      setState("recording");
    } catch {
      if (streamRef.current === stream) releasePhysicalCapture();
      else if (stream) stopVisionLabTracks(stream);
      if (mountedRef.current) {
        setError("Camera access was not available. Nothing was recorded or uploaded.");
        setState("error");
      }
    }
  }, [captureType, downloadCapture, environment, releasePhysicalCapture, state]);

  const retryDownload = useCallback(() => {
    const capture = activeCaptureRef.current;
    if (!capture?.video || !capture.manifest) return;
    setError(null);
    setState("exporting");
    void downloadCapture(capture);
  }, [downloadCapture]);

  if (state === "checking") return <p>Checking verified account access…</p>;
  if (state === "refused")
    return (
      <section className="vision-lab-card" aria-labelledby="vision-lab-title">
        <h1 id="vision-lab-title">Vision Lab</h1>
        <p role="alert">Vision Lab is available only to a verified CommandCanvas account.</p>
      </section>
    );

  return (
    <section className="vision-lab-card" aria-labelledby="vision-lab-title">
      <p className="eyebrow">Private local capture</p>
      <h1 id="vision-lab-title">Vision Lab</h1>
      <p>Record clean camera footage locally for hand-pose evaluation. The camera feed is never uploaded; stopping creates only a WebM and matching JSON manifest download on this device.</p>
      <p><strong>Bound:</strong> keep each session to 60 seconds or 250 MB maximum.</p>
      <label htmlFor="vision-lab-capture-type">Session guide</label>
      <select
        id="vision-lab-capture-type"
        value={captureType}
        disabled={state !== "ready"}
        onChange={(event) => setCaptureType(event.target.value as VisionLabCaptureType)}
      >
        {VISION_LAB_CAPTURE_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
      </select>
      <ul aria-label="Capture protocol guidance">
        {VISION_LAB_CAPTURE_TYPES.map((type) => <li key={type.value}><strong>{type.label}:</strong> {type.guidance}</li>)}
      </ul>
      <p>Keep the same framing and complete the selected actions. Avoid overlays, filters, other people, and identifiable documents.</p>
      <div className="vision-lab-preview" aria-label="Camera preview with separate feedback">
        <video ref={videoRef} autoPlay muted playsInline aria-label="Local raw camera preview" />
        <p aria-live="polite">
          {state === "recording"
            ? `Recording ${VISION_LAB_CAPTURE_TYPES.find((type) => type.value === captureType)?.label} locally`
            : "Choose a named session, then deliberately start the camera."}
        </p>
      </div>
      {state === "ready" || state === "error" ? <button type="button" onClick={() => void startCapture()}>Start capture</button> : null}
      {state === "recording" ? <button type="button" onClick={() => stopCapture(true)}>Stop and download</button> : null}
      {state === "download-error" ? <button type="button" onClick={retryDownload}>Retry download</button> : null}
      {state === "acquiring" || state === "exporting" ? <p>Working locally…</p> : null}
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}

function toVisionLabUser(user: {
  id: string;
  email?: string;
  email_confirmed_at?: string;
  is_anonymous?: boolean;
} | null | undefined): VisionLabUser | null {
  return user
    ? { id: user.id, email: user.email, emailConfirmedAt: user.email_confirmed_at, isAnonymous: user.is_anonymous }
    : null;
}

const browserEnvironment: VisionLabEnvironment = {
  async loadUser() {
    const clientResult = createBrowserSupabaseClient({
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    });
    if (!clientResult.ok) return null;
    const { data, error } = await clientResult.client.auth.getSession();
    return error ? null : toVisionLabUser(data.session?.user);
  },
  subscribeUser(listener) {
    const clientResult = createBrowserSupabaseClient({
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    });
    if (!clientResult.ok) {
      listener(null);
      return () => undefined;
    }
    const { data } = clientResult.client.auth.onAuthStateChange((_event, session) => listener(toVisionLabUser(session?.user)));
    return () => data.subscription.unsubscribe();
  },
  getUserMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints),
  selectWebmMime: () => typeof MediaRecorder === "undefined" ? null : selectSupportedWebmMime(MediaRecorder.isTypeSupported.bind(MediaRecorder)),
  createRecorder: (stream, mimeType) => new MediaRecorder(stream, { mimeType }) as unknown as VisionLabRecorder,
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
