import {
  createInitialHandIntentState,
  interpretHandFrame,
  type HandIntentState,
  type HandLandmarks,
} from "@/lib/gesture/hand-intent";
import type {
  HandTrackingWorkerInboundMessage,
  HandTrackingWorkerOutboundMessage,
} from "@/lib/gesture/hand-tracking-worker-core";

export type HandTrackingStatus =
  | { state: "off" | "starting" | "ready" }
  | { state: "refused" | "unavailable"; message: string };

export type HandTrackingObservation =
  | {
      mode: "point" | "pinch";
      pointer: { x: number; y: number };
      confidence: number;
      timestamp: number;
    }
  | { mode: "idle"; timestamp: number };

export interface HandTrackingWorkerLike {
  onmessage: ((event: MessageEvent<HandTrackingWorkerOutboundMessage>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  postMessage(message: HandTrackingWorkerInboundMessage, transfer?: Transferable[]): void;
  terminate(): void;
}

export interface HandTrackingController {
  getStatus(): HandTrackingStatus;
  subscribeStatus(listener: (status: HandTrackingStatus) => void): () => void;
  subscribeObservations(
    listener: (observation: HandTrackingObservation) => void,
  ): () => void;
  start(video: HTMLVideoElement): Promise<void>;
  stop(): void;
}

export interface HandTrackingControllerDependencies {
  getUserMedia?: (
    constraints: MediaStreamConstraints,
  ) => Promise<MediaStream>;
  createWorker?: () => HandTrackingWorkerLike;
  createImageBitmap?: (source: CanvasImageSource) => Promise<ImageBitmap>;
  requestAnimationFrame?: (callback: FrameRequestCallback) => number;
  cancelAnimationFrame?: (handle: number) => void;
  setTimeout?: (callback: () => void, delayMs: number) => number;
  clearTimeout?: (handle: number) => void;
  workerReadyTimeoutMs?: number;
  now?: () => number;
}

const UNAVAILABLE_MESSAGE =
  "Local hand tracking is unavailable in this browser.";

export function createHandTrackingController(
  provided: HandTrackingControllerDependencies = {},
): HandTrackingController {
  const dependencies = resolveDependencies(provided);
  const statusListeners = new Set<(status: HandTrackingStatus) => void>();
  const observationListeners = new Set<
    (observation: HandTrackingObservation) => void
  >();
  let status: HandTrackingStatus = { state: "off" };
  let nextRunId = 0;
  let activeRun: HandTrackingRun | null = null;

  function setStatus(next: HandTrackingStatus) {
    status = next;
    statusListeners.forEach((listener) => listener(next));
  }

  function emit(observation: HandTrackingObservation) {
    observationListeners.forEach((listener) => listener(observation));
  }

  function clearRunResources(run: HandTrackingRun) {
    if (run.animationFrame !== null && dependencies.cancelAnimationFrame)
      dependencies.cancelAnimationFrame(run.animationFrame);
    run.animationFrame = null;
    run.frameInFlight = false;
    if (run.readyTimeout !== null) {
      dependencies.clearTimeout(run.readyTimeout);
      run.readyTimeout = null;
    }
    if (run.worker) {
      try {
        run.worker.postMessage({ type: "dispose" });
      } catch {
        // The worker may already have stopped; termination below is definitive.
      }
      run.worker.terminate();
    }
    run.worker = null;
    for (const track of run.stream?.getTracks() ?? []) track.stop();
    if (run.video.srcObject === run.stream) run.video.srcObject = null;
    run.stream = null;
    run.intentState = createInitialHandIntentState();
  }

  function failUnavailable(
    run: HandTrackingRun,
    message = UNAVAILABLE_MESSAGE,
  ) {
    if (activeRun !== run || run.cancelled) return;
    const error = new Error(message);
    run.rejectReady?.(error);
    run.resolveReady = null;
    run.rejectReady = null;
    clearRunResources(run);
    activeRun = null;
    setStatus({ state: "unavailable", message });
  }

  function scheduleFrame(run: HandTrackingRun) {
    if (!dependencies.requestAnimationFrame) return;
    run.animationFrame = dependencies.requestAnimationFrame(() => {
      if (activeRun !== run || run.cancelled || status.state !== "ready") return;
      scheduleFrame(run);
      if (!run.frameInFlight && run.video.readyState >= 2)
        void captureFrame(run);
    });
  }

  async function captureFrame(run: HandTrackingRun) {
    if (!dependencies.createImageBitmap || !run.worker) return;
    run.frameInFlight = true;
    let bitmap: ImageBitmap | null = null;
    try {
      bitmap = await dependencies.createImageBitmap(run.video);
      if (
        activeRun !== run ||
        run.cancelled ||
        !run.worker ||
        status.state !== "ready"
      ) {
        bitmap.close();
        return;
      }
      const timestamp = dependencies.now();
      run.worker.postMessage(
        { type: "frame", frame: bitmap, timestamp },
        [bitmap],
      );
      bitmap = null;
    } catch (error) {
      bitmap?.close();
      if (activeRun !== run || run.cancelled) return;
      failUnavailable(
        run,
        error instanceof Error && error.message.trim()
          ? error.message
          : "The local camera frame could not be processed.",
      );
    }
  }

  function handleWorkerMessage(
    run: HandTrackingRun,
    message: HandTrackingWorkerOutboundMessage,
  ) {
    if (activeRun !== run || run.cancelled) return;
    if (message.type === "ready") {
      if (run.readyTimeout !== null) {
        dependencies.clearTimeout(run.readyTimeout);
        run.readyTimeout = null;
      }
      setStatus({ state: "ready" });
      run.resolveReady?.();
      run.resolveReady = null;
      run.rejectReady = null;
      scheduleFrame(run);
      return;
    }
    if (message.type === "error") {
      run.frameInFlight = false;
      failUnavailable(run, message.message || "Local hand inference failed.");
      return;
    }

    run.frameInFlight = false;
    if (!message.landmarks || message.confidence === null) {
      run.intentState = createInitialHandIntentState();
      emit({ mode: "idle", timestamp: message.timestamp });
      return;
    }
    const transition = interpretHandFrame(
      run.intentState,
      {
        landmarks: message.landmarks as HandLandmarks,
        confidence: message.confidence,
        timestamp: message.timestamp,
      },
      dependencies.now(),
      { mirrorX: true },
    );
    run.intentState = transition.state;
    if (!transition.output.accepted) {
      emit({ mode: "idle", timestamp: message.timestamp });
      return;
    }
    emit({
      mode: transition.output.mode,
      pointer: transition.output.pointer,
      confidence: transition.output.confidence,
      timestamp: transition.output.timestamp,
    });
  }

  return {
    getStatus: () => status,
    subscribeStatus(listener) {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    },
    subscribeObservations(listener) {
      observationListeners.add(listener);
      return () => observationListeners.delete(listener);
    },
    async start(targetVideo) {
      if (status.state === "starting" || status.state === "ready") return;
      if (
        !dependencies.getUserMedia ||
        !dependencies.createWorker ||
        !dependencies.createImageBitmap ||
        !dependencies.requestAnimationFrame ||
        !dependencies.cancelAnimationFrame
      ) {
        const error = new Error(UNAVAILABLE_MESSAGE);
        setStatus({ state: "unavailable", message: error.message });
        throw error;
      }

      const run = createRun(++nextRunId, targetVideo);
      activeRun = run;
      setStatus({ state: "starting" });
      try {
        const mediaOperation = dependencies.getUserMedia({
          audio: false,
          video: {
            facingMode: "user",
            width: { ideal: 640 },
            height: { ideal: 480 },
            frameRate: { ideal: 30, max: 30 },
          },
        });
        const mediaResult = await waitForRunOrStop(run, mediaOperation);
        if (mediaResult.stopped) {
          void mediaOperation.then(stopStream, () => undefined);
          return;
        }
        run.stream = mediaResult.value;
        if (activeRun !== run || run.cancelled) {
          clearRunResources(run);
          return;
        }
        run.video.srcObject = run.stream;
        const playResult = await waitForRunOrStop(
          run,
          Promise.resolve(run.video.play()),
        );
        if (playResult.stopped || activeRun !== run || run.cancelled) {
          clearRunResources(run);
          return;
        }
        run.worker = dependencies.createWorker();

        const ready = new Promise<void>((resolve, reject) => {
          run.resolveReady = resolve;
          run.rejectReady = reject;
        });
        run.worker.onmessage = (event) =>
          handleWorkerMessage(run, event.data);
        run.worker.onerror = (event) => {
          if (activeRun !== run || run.cancelled) return;
          failUnavailable(run, event.message || "The local hand worker failed.");
        };
        run.readyTimeout = dependencies.setTimeout(() => {
          failUnavailable(
            run,
            "Local hand tracking did not become ready in time.",
          );
        }, dependencies.workerReadyTimeoutMs);
        run.worker.postMessage({
          type: "initialize",
          wasmBaseUrl: "/mediapipe/wasm",
          modelAssetUrl:
            "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
        });
        const readyResult = await waitForRunOrStop(run, ready);
        if (readyResult.stopped) return;
      } catch (error) {
        if (run.cancelled || activeRun !== run) {
          clearRunResources(run);
          if (status.state === "unavailable") throw error;
          return;
        }
        clearRunResources(run);
        activeRun = null;
        if (isPermissionRefusal(error))
          setStatus({
            state: "refused",
            message: "Camera permission was not granted.",
          });
        else
          setStatus({
            state: "unavailable",
            message:
              error instanceof Error && error.message.trim()
                ? error.message
                : UNAVAILABLE_MESSAGE,
          });
        throw error;
      }
    },
    stop() {
      const run = activeRun;
      activeRun = null;
      if (run) {
        run.cancelled = true;
        run.resolveStop();
        clearRunResources(run);
      }
      setStatus({ state: "off" });
      emit({ mode: "idle", timestamp: dependencies.now() });
    },
  };
}

interface HandTrackingRun {
  readonly id: number;
  readonly video: HTMLVideoElement;
  stream: MediaStream | null;
  worker: HandTrackingWorkerLike | null;
  animationFrame: number | null;
  frameInFlight: boolean;
  intentState: HandIntentState;
  cancelled: boolean;
  readonly stopped: Promise<void>;
  readonly resolveStop: () => void;
  resolveReady: (() => void) | null;
  rejectReady: ((error: Error) => void) | null;
  readyTimeout: number | null;
}

function createRun(id: number, video: HTMLVideoElement): HandTrackingRun {
  let resolveStop!: () => void;
  const stopped = new Promise<void>((resolve) => {
    resolveStop = resolve;
  });
  return {
    id,
    video,
    stream: null,
    worker: null,
    animationFrame: null,
    frameInFlight: false,
    intentState: createInitialHandIntentState(),
    cancelled: false,
    stopped,
    resolveStop,
    resolveReady: null,
    rejectReady: null,
    readyTimeout: null,
  };
}

async function waitForRunOrStop<T>(
  run: HandTrackingRun,
  operation: Promise<T>,
): Promise<{ stopped: true } | { stopped: false; value: T }> {
  return Promise.race([
    operation.then((value) => ({ stopped: false as const, value })),
    run.stopped.then(() => ({ stopped: true as const })),
  ]);
}

function stopStream(stream: MediaStream) {
  for (const track of stream.getTracks()) track.stop();
}

function resolveDependencies(
  provided: HandTrackingControllerDependencies,
): ResolvedHandTrackingControllerDependencies {
  return {
    getUserMedia:
      provided.getUserMedia ??
      (typeof navigator !== "undefined" && navigator.mediaDevices?.getUserMedia
        ? navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
        : undefined),
    createWorker:
      provided.createWorker ??
      (typeof Worker !== "undefined"
        ? () =>
            new Worker("/workers/hand-landmarker.js", {
              type: "module",
              name: "commandcanvas-hand-tracker",
            }) as unknown as HandTrackingWorkerLike
        : undefined),
    createImageBitmap:
      provided.createImageBitmap ??
      (typeof globalThis.createImageBitmap === "function"
        ? globalThis.createImageBitmap.bind(globalThis)
        : undefined),
    requestAnimationFrame:
      provided.requestAnimationFrame ??
      (typeof globalThis.requestAnimationFrame === "function"
        ? globalThis.requestAnimationFrame.bind(globalThis)
        : undefined),
    cancelAnimationFrame:
      provided.cancelAnimationFrame ??
      (typeof globalThis.cancelAnimationFrame === "function"
        ? globalThis.cancelAnimationFrame.bind(globalThis)
        : undefined),
    setTimeout:
      provided.setTimeout ??
      ((callback, delayMs) =>
        globalThis.setTimeout(callback, delayMs) as unknown as number),
    clearTimeout:
      provided.clearTimeout ??
      ((handle) => globalThis.clearTimeout(handle)),
    workerReadyTimeoutMs: provided.workerReadyTimeoutMs ?? 15_000,
    now: provided.now ?? (() => performance.now()),
  };
}

interface ResolvedHandTrackingControllerDependencies {
  getUserMedia?: HandTrackingControllerDependencies["getUserMedia"];
  createWorker?: HandTrackingControllerDependencies["createWorker"];
  createImageBitmap?: HandTrackingControllerDependencies["createImageBitmap"];
  requestAnimationFrame?: HandTrackingControllerDependencies["requestAnimationFrame"];
  cancelAnimationFrame?: HandTrackingControllerDependencies["cancelAnimationFrame"];
  setTimeout: NonNullable<HandTrackingControllerDependencies["setTimeout"]>;
  clearTimeout: NonNullable<HandTrackingControllerDependencies["clearTimeout"]>;
  workerReadyTimeoutMs: number;
  now: NonNullable<HandTrackingControllerDependencies["now"]>;
}

function isPermissionRefusal(error: unknown) {
  return (
    error instanceof DOMException &&
    (error.name === "NotAllowedError" || error.name === "SecurityError")
  );
}
