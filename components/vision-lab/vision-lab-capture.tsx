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
  download: (name: string, blob: Blob) => void | Promise<void>;
}

interface VisionLabWritableFile {
  write(blob: Blob): Promise<void>;
  close(): Promise<void>;
}

interface VisionLabFileHandle {
  createWritable(): Promise<VisionLabWritableFile>;
}

interface VisionLabDownloadBrowser {
  showSaveFilePicker?: (options: {
    suggestedName: string;
    types: Array<{
      description: string;
      accept: Record<string, string[]>;
    }>;
  }) => Promise<VisionLabFileHandle>;
  createObjectURL?: (blob: Blob) => string;
  revokeObjectURL?: (url: string) => void;
  document?: Document;
  setTimeout?: typeof globalThis.setTimeout;
}

function downloadType(
  name: string,
): { description: string; accept: Record<string, string[]> } {
  if (name.toLowerCase().endsWith(".webm"))
    return {
      description: "Vision Lab WebM recording",
      accept: { "video/webm": [".webm"] },
    };
  return {
    description: "Vision Lab JSON manifest",
    accept: { "application/json": [".json"] },
  };
}

export async function downloadVisionLabBlob(
  name: string,
  blob: Blob,
  browser: VisionLabDownloadBrowser = {},
): Promise<void> {
  const picker =
    browser.showSaveFilePicker ??
    (globalThis as typeof globalThis & {
      showSaveFilePicker?: VisionLabDownloadBrowser["showSaveFilePicker"];
    }).showSaveFilePicker;
  if (picker) {
    try {
      const handle = await picker({ suggestedName: name, types: [downloadType(name)] });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") throw error;
      // Embedded browsers can expose the picker while refusing it. The
      // document-attached download remains the compatibility fallback.
    }
  }

  const currentDocument = browser.document ?? globalThis.document;
  const createObjectURL = browser.createObjectURL ?? URL.createObjectURL.bind(URL);
  const revokeObjectURL = browser.revokeObjectURL ?? URL.revokeObjectURL.bind(URL);
  const schedule = browser.setTimeout ?? globalThis.setTimeout.bind(globalThis);
  const url = createObjectURL(blob);
  const anchor = currentDocument.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  currentDocument.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  schedule(() => revokeObjectURL(url), 60_000);
}

interface ActiveCapture {
  generation: number;
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
  recorder?: VisionLabRecorder;
}

type CaptureState =
  | "checking"
  | "refused"
  | "ready"
  | "acquiring"
  | "recording"
  | "exporting"
  | "completed"
  | "unsupported"
  | "error";

const CAMERA_CONSTRAINTS: MediaStreamConstraints = {
  audio: false,
  video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 720 } },
};

export function VisionLabCapture({
  environment = browserEnvironment,
}: {
  environment?: VisionLabEnvironment;
}) {
  const [captureType, setCaptureType] = useState<VisionLabCaptureType>("acquisition");
  const [state, setState] = useState<CaptureState>("checking");
  const [error, setError] = useState<string | null>(null);
  const [failedDownload, setFailedDownload] = useState<"video" | "manifest" | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<VisionLabRecorder | null>(null);
  const activeCaptureRef = useRef<ActiveCapture | null>(null);
  const operationGenerationRef = useRef(0);
  const mountedRef = useRef(false);
  const eligibleRef = useRef(false);

  const isCurrent = useCallback(
    (generation: number, capture?: ActiveCapture) =>
      mountedRef.current &&
      eligibleRef.current &&
      operationGenerationRef.current === generation &&
      (!capture || activeCaptureRef.current === capture) &&
      !capture?.cancelled,
    [],
  );

  const releasePhysicalCapture = useCallback(() => {
    const stream = streamRef.current;
    streamRef.current = null;
    recorderRef.current = null;
    if (videoRef.current?.srcObject === stream) videoRef.current.srcObject = null;
    if (stream) stopVisionLabTracks(stream);
  }, []);

  const eraseCapture = useCallback((capture: ActiveCapture | null) => {
    if (!capture) return;
    capture.cancelled = true;
    capture.exportRequested = false;
    capture.chunks.length = 0;
    capture.video = undefined;
    capture.manifest = undefined;
    if (capture.recorder) {
      capture.recorder.ondataavailable = null;
      capture.recorder.onstop = null;
      capture.recorder.onerror = null;
      capture.recorder = undefined;
    }
  }, []);

  const cancelCapture = useCallback(() => {
    operationGenerationRef.current += 1;
    const recorder = recorderRef.current;
    const capture = activeCaptureRef.current;
    activeCaptureRef.current = null;
    setFailedDownload(null);
    eraseCapture(capture);
    if (recorder) {
      recorder.ondataavailable = null;
      recorder.onstop = null;
      recorder.onerror = null;
    }
    releasePhysicalCapture();
    try {
      if (recorder && recorder.state !== "inactive") recorder.stop();
    } catch {
      // Physical tracks were already released; no cancelled capture may resume.
    }
  }, [eraseCapture, releasePhysicalCapture]);

  const prepareCompletedCapture = useCallback(
    async (capture: ActiveCapture) => {
      const generation = capture.generation;
      if (!isCurrent(generation, capture)) return;
      const video = new Blob(capture.chunks, { type: capture.media.mimeType });
      capture.chunks.length = 0;
      capture.video = video;
      let videoSha256: string | null = null;
      try {
        videoSha256 = await environment.sha256(video);
      } catch {
        // Hashing is optional; retain the completed local video without a hash.
      }
      if (!isCurrent(generation, capture)) return;
      capture.manifest = createVisionLabManifest({
        sessionId: capture.sessionId,
        captureType: capture.captureType,
        startedAt: capture.startedAt,
        stoppedAt: capture.stoppedAt ?? capture.startedAt,
        media: capture.media,
        mirrorDisplay: true,
        ...(videoSha256 ? { videoSha256 } : {}),
      });
      if (!isCurrent(generation, capture)) return;
      setState("completed");
    },
    [environment, isCurrent],
  );

  const stopCapture = useCallback(
    (download: boolean) => {
      const capture = activeCaptureRef.current;
      const recorder = recorderRef.current;
      if (!download) {
        cancelCapture();
        return;
      }
      if (!capture || capture.cancelled) return;
      capture.exportRequested = true;
      capture.stoppedAt = environment.now().toISOString();
      releasePhysicalCapture();
      if (mountedRef.current) setState("exporting");
      try {
        if (recorder && recorder.state !== "inactive") recorder.stop();
      } catch {
        eraseCapture(capture);
        if (activeCaptureRef.current === capture) activeCaptureRef.current = null;
        operationGenerationRef.current += 1;
        if (mountedRef.current) {
          setError("The camera recording could not be stopped safely.");
          setState("error");
        }
      }
    },
    [cancelCapture, environment, eraseCapture, releasePhysicalCapture],
  );

  useEffect(() => {
    mountedRef.current = true;
    let active = true;
    const applyUser = (user: VisionLabUser | null) => {
      if (!active) return;
      const eligible = isPermanentVisionLabUser(user);
      eligibleRef.current = eligible;
      if (!eligible) {
        cancelCapture();
        setState("refused");
        return;
      }
      if (!activeCaptureRef.current) setState("ready");
    };
    const initialGeneration = operationGenerationRef.current;
    void environment.loadUser().then(
      (user) => {
        if (operationGenerationRef.current === initialGeneration) applyUser(user);
      },
      () => {
        if (operationGenerationRef.current === initialGeneration) applyUser(null);
      },
    );
    const unsubscribe = environment.subscribeUser(applyUser);
    const handlePageHide = () => cancelCapture();
    window.addEventListener("pagehide", handlePageHide);
    return () => {
      active = false;
      mountedRef.current = false;
      eligibleRef.current = false;
      unsubscribe();
      window.removeEventListener("pagehide", handlePageHide);
      cancelCapture();
    };
  }, [cancelCapture, environment]);

  const startCapture = useCallback(async () => {
    if (state !== "ready" && state !== "error") return;
    const generation = operationGenerationRef.current;
    setError(null);
    setState("acquiring");
    const user = await environment.loadUser().catch(() => null);
    if (!isCurrent(generation) || !isPermanentVisionLabUser(user)) {
      if (mountedRef.current && operationGenerationRef.current === generation) {
        eligibleRef.current = false;
        setState("refused");
      }
      return;
    }
    const mimeType = environment.selectWebmMime();
    if (!mimeType) {
      if (isCurrent(generation)) {
        setError("This browser cannot create a WebM recording for Vision Lab.");
        setState("unsupported");
      }
      return;
    }
    let stream: MediaStream | null = null;
    try {
      stream = await environment.getUserMedia(CAMERA_CONSTRAINTS);
      if (!isCurrent(generation)) {
        stopVisionLabTracks(stream);
        return;
      }
      if (!isCurrent(generation)) return;
      const recorder = environment.createRecorder(stream, mimeType);
      if (!isCurrent(generation)) {
        recorder.ondataavailable = null;
        recorder.onstop = null;
        recorder.onerror = null;
        stopVisionLabTracks(stream);
        return;
      }
      const capture: ActiveCapture = {
        generation,
        sessionId: environment.createSessionId(),
        captureType,
        startedAt: environment.now().toISOString(),
        media: mediaSettingsFromTrack(stream.getVideoTracks()[0], mimeType),
        chunks: [],
        cancelled: false,
        exportRequested: false,
        recorder,
      };
      streamRef.current = stream;
      recorderRef.current = recorder;
      activeCaptureRef.current = capture;
      if (videoRef.current) videoRef.current.srcObject = stream;
      recorder.ondataavailable = ({ data }) => {
        if (isCurrent(generation, capture) && data.size > 0) capture.chunks.push(data);
      };
      recorder.onstop = () => {
        if (!isCurrent(generation, capture) || !capture.exportRequested) return;
        void prepareCompletedCapture(capture);
      };
      recorder.onerror = () => {
        if (!isCurrent(generation, capture)) return;
        cancelCapture();
        if (mountedRef.current) {
          setError("The local camera recorder failed and was stopped.");
          setState("error");
        }
      };
      if (!isCurrent(generation, capture)) {
        cancelCapture();
        return;
      }
      recorder.start(1_000);
      if (isCurrent(generation, capture)) setState("recording");
    } catch {
      const failedAttemptWasCurrent = isCurrent(generation);
      if (streamRef.current) cancelCapture();
      else if (stream) stopVisionLabTracks(stream);
      if (failedAttemptWasCurrent && mountedRef.current && eligibleRef.current) {
        setError("Camera access was not available. Nothing was recorded or uploaded.");
        setState("error");
      }
    }
  }, [cancelCapture, captureType, environment, isCurrent, prepareCompletedCapture, state]);

  const downloadCompleted = useCallback(
    async (kind: "video" | "manifest") => {
      const capture = activeCaptureRef.current;
      if (!capture || !capture.video || !capture.manifest || !isCurrent(capture.generation, capture)) return;
      try {
        if (kind === "video") await environment.download(`${capture.sessionId}.webm`, capture.video);
        else await environment.download(
          `${capture.sessionId}.json`,
          new Blob([`${JSON.stringify(capture.manifest, null, 2)}\n`], { type: "application/json" }),
        );
        setFailedDownload(null);
        setError(null);
      } catch {
        setFailedDownload(kind);
        setError("The completed local recording is still available. Retry this download.");
      }
    },
    [environment, isCurrent],
  );

  const discardCompleted = useCallback(() => {
    const capture = activeCaptureRef.current;
    operationGenerationRef.current += 1;
    activeCaptureRef.current = null;
    setFailedDownload(null);
    eraseCapture(capture);
    setError(null);
    setState(eligibleRef.current ? "ready" : "refused");
  }, [eraseCapture]);

  if (state === "checking") return <p>Checking verified account access…</p>;
  if (state === "refused")
    return <section className="vision-lab-card" aria-labelledby="vision-lab-title"><h1 id="vision-lab-title">Vision Lab</h1><p role="alert">Vision Lab is available only to a verified CommandCanvas account.</p></section>;

  const completed = state === "completed";
  return (
    <section className="vision-lab-card" aria-labelledby="vision-lab-title">
      <p className="eyebrow">Private local capture</p>
      <h1 id="vision-lab-title">Vision Lab</h1>
      <p>Record clean camera footage locally for hand-pose evaluation. The camera feed is never uploaded; stopping prepares a WebM and matching JSON manifest for your explicit download.</p>
      <p><strong>Bound:</strong> keep each session to 60 seconds or 250 MB maximum.</p>
      <label htmlFor="vision-lab-capture-type">Session guide</label>
      <select id="vision-lab-capture-type" value={captureType} disabled={state !== "ready"} onChange={(event) => setCaptureType(event.target.value as VisionLabCaptureType)}>
        {VISION_LAB_CAPTURE_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
      </select>
      <ul aria-label="Capture protocol guidance">{VISION_LAB_CAPTURE_TYPES.map((type) => <li key={type.value}><strong>{type.label}:</strong> {type.guidance}</li>)}</ul>
      <p>Keep the same framing and complete the selected actions. Avoid overlays, filters, other people, and identifiable documents.</p>
      <div className="vision-lab-preview" aria-label="Camera preview with separate feedback"><video ref={videoRef} autoPlay muted playsInline aria-label="Local raw camera preview" /><p aria-live="polite">{state === "recording" ? `Recording ${VISION_LAB_CAPTURE_TYPES.find((type) => type.value === captureType)?.label} locally` : completed ? "Completed local recording. Download both files or discard them." : "Choose a named session, then deliberately start the camera."}</p></div>
      {state === "ready" || state === "error" ? <button type="button" onClick={() => void startCapture()}>Start capture</button> : null}
      {state === "recording" ? <button type="button" onClick={() => stopCapture(true)}>Stop capture</button> : null}
      {completed ? <><p role="status">Recording ready. Save both files before clearing this capture.</p><button type="button" onClick={() => void downloadCompleted("video")}>Save video</button><button type="button" onClick={() => void downloadCompleted("manifest")}>Save manifest</button><button type="button" onClick={discardCompleted}>Discard completed recording</button><button type="button" onClick={discardCompleted}>Finished saving — clear recording</button>{failedDownload ? <button type="button" onClick={() => void downloadCompleted(failedDownload)}>Retry save</button> : null}</> : null}
      {state === "acquiring" || state === "exporting" ? <p>Working locally…</p> : null}
      {error ? <p role="alert">{error}</p> : null}
    </section>
  );
}

function toVisionLabUser(user: { id: string; email?: string; email_confirmed_at?: string; is_anonymous?: boolean } | null | undefined): VisionLabUser | null {
  return user ? { id: user.id, email: user.email, emailConfirmedAt: user.email_confirmed_at, isAnonymous: user.is_anonymous } : null;
}

const browserEnvironment: VisionLabEnvironment = {
  async loadUser() {
    const clientResult = createBrowserSupabaseClient({ NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY });
    if (!clientResult.ok) return null;
    const { data, error } = await clientResult.client.auth.getSession();
    return error ? null : toVisionLabUser(data.session?.user);
  },
  subscribeUser(listener) {
    const clientResult = createBrowserSupabaseClient({ NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY });
    if (!clientResult.ok) { listener(null); return () => undefined; }
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
  download: downloadVisionLabBlob,
};
