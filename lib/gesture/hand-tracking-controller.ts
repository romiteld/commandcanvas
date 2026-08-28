import {
  createInitialHandIntentState,
  interpretHandFrame,
  type HandIntentState,
  type HandLandmarks,
} from "@/lib/gesture/hand-intent";
import type {
  HandDetector,
  HandDetectorLoadOptions,
  HandTrackingWorkerInboundMessage,
  HandTrackingWorkerOutboundMessage,
  TrackedHandedness,
} from "@/lib/gesture/hand-tracking-worker-core";
import { createHandTrackingWorkerRuntime } from "@/lib/gesture/hand-tracking-worker-core";
import {
  createDefaultSpatialVisionEnginePlan,
  type SpatialVisionEngine,
  type SpatialVisionEngineDescriptor,
  type SpatialVisionEnginePlan,
} from "@/lib/gesture/spatial-vision-engine";

export type HandTrackingStatus =
  | { state: "off" | "starting" | "ready" }
  | { state: "refused" | "unavailable"; message: string };

export type HandTrackingObservation =
  | {
      mode: "point" | "pinch" | "open_palm";
      pointer: { x: number; y: number };
      confidence: number;
      handedness?: TrackedHandedness;
      landmarks?: HandLandmarks;
      pinchDistance?: number;
      trackingState?: "tracked" | "grace";
      timestamp: number;
    }
  | {
      mode: "bimanual_pinch";
      hands: readonly [HandTrackingPointer, HandTrackingPointer];
      center: { x: number; y: number };
      span: number;
      timestamp: number;
    }
  | { mode: "idle"; timestamp: number; trackingState?: "lost" };

export interface HandTrackingPointer {
  handedness: TrackedHandedness;
  pointer: { x: number; y: number };
  confidence: number;
  landmarks?: HandLandmarks;
  pinchDistance?: number;
}

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
  getEngineStatus?(): HandTrackingEngineStatus | null;
  subscribeEngineStatus?(
    listener: (engine: HandTrackingEngineStatus | null) => void,
  ): () => void;
  start(video: HTMLVideoElement): Promise<void>;
  stop(): void;
}

export interface HandTrackingEngineStatus {
  id: string;
  displayName: string;
  runtime: string;
  fallback: boolean;
}

export interface HandTrackingControllerDependencies {
  getSharedMediaStream?: () =>
    | MediaStream
    | null
    | Promise<MediaStream | null>;
  getUserMedia?: (
    constraints: MediaStreamConstraints,
  ) => Promise<MediaStream>;
  createWorker?: () => HandTrackingWorkerLike;
  createWorkerForEngine?: (
    engine: SpatialVisionEngineDescriptor,
  ) => HandTrackingWorkerLike;
  loadDetector?: (options: HandDetectorLoadOptions) => Promise<HandDetector>;
  visionEnginePlan?: SpatialVisionEnginePlan;
  supportsWorkerCanvas?: boolean;
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
const PINCH_TRACKING_GRACE_MS = 180;

export function createHandTrackingController(
  provided: HandTrackingControllerDependencies = {},
): HandTrackingController {
  const dependencies = resolveDependencies(provided);
  const statusListeners = new Set<(status: HandTrackingStatus) => void>();
  const observationListeners = new Set<
    (observation: HandTrackingObservation) => void
  >();
  const engineListeners = new Set<
    (engine: HandTrackingEngineStatus | null) => void
  >();
  let status: HandTrackingStatus = { state: "off" };
  let engineStatus: HandTrackingEngineStatus | null = null;
  let nextRunId = 0;
  let activeRun: HandTrackingRun | null = null;

  function setStatus(next: HandTrackingStatus) {
    status = next;
    statusListeners.forEach((listener) => listener(next));
  }

  function emit(observation: HandTrackingObservation) {
    observationListeners.forEach((listener) => listener(observation));
  }

  function setEngineStatus(engine: SpatialVisionEngine | null, fallback = false) {
    engineStatus = engine
      ? {
          id: engine.descriptor.id,
          displayName: engine.descriptor.displayName,
          runtime: engine.descriptor.runtime,
          fallback,
        }
      : null;
    engineListeners.forEach((listener) => listener(engineStatus));
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
    if (run.ownsStream)
      for (const track of run.stream?.getTracks() ?? []) track.stop();
    if (run.video.srcObject === run.stream) run.video.srcObject = null;
    run.stream = null;
    run.ownsStream = false;
    run.intentStates.clear();
    run.lastSingleObservation = null;
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

  function startEngineWorker(run: HandTrackingRun, engineIndex: number) {
    const engine = dependencies.visionEngines[engineIndex];
    const createWorkerForEngine = dependencies.createWorkerForEngine;
    if (!engine || !createWorkerForEngine) throw new Error(UNAVAILABLE_MESSAGE);
    const worker = createWorkerForEngine(engine);
    run.engineIndex = engineIndex;
    run.worker = worker;
    setEngineStatus(engine, engineIndex > 0);
    worker.onmessage = (event) =>
      handleWorkerMessage(run, worker, event.data);
    worker.onerror = (event) => {
      if (activeRun !== run || run.cancelled || run.worker !== worker) return;
      handleEngineFailure(
        run,
        worker,
        event.message || `${engine.descriptor.displayName} worker failed.`,
      );
    };
    run.readyTimeout = dependencies.setTimeout(() => {
      handleEngineFailure(
        run,
        worker,
        `${engine.descriptor.displayName} did not become ready in time.`,
      );
    }, dependencies.workerReadyTimeoutMs);
    worker.postMessage({
      type: "initialize",
      wasmBaseUrl: engine.detectorLoadOptions.wasmBaseUrl,
      modelAssetUrl: engine.detectorLoadOptions.modelAssetUrl,
    });
  }

  function handleEngineFailure(
    run: HandTrackingRun,
    worker: HandTrackingWorkerLike,
    message: string,
  ) {
    if (
      activeRun !== run ||
      run.cancelled ||
      run.worker !== worker
    )
      return;
    run.frameInFlight = false;
    if (run.readyTimeout !== null) {
      dependencies.clearTimeout(run.readyTimeout);
      run.readyTimeout = null;
    }
    const nextEngineIndex = run.engineIndex + 1;
    if (nextEngineIndex >= dependencies.visionEngines.length) {
      failUnavailable(run, message);
      return;
    }

    if (run.animationFrame !== null && dependencies.cancelAnimationFrame)
      dependencies.cancelAnimationFrame(run.animationFrame);
    run.animationFrame = null;
    try {
      worker.postMessage({ type: "dispose" });
    } catch {
      // Termination below is definitive.
    }
    worker.terminate();
    run.worker = null;
    run.intentStates.clear();
    run.lastSingleObservation = null;
    emit({ mode: "idle", timestamp: dependencies.now(), trackingState: "lost" });
    setStatus({ state: "starting" });
    try {
      startEngineWorker(run, nextEngineIndex);
    } catch (fallbackError) {
      failUnavailable(
        run,
        fallbackError instanceof Error && fallbackError.message.trim()
          ? fallbackError.message
          : message,
      );
    }
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
    worker: HandTrackingWorkerLike,
    message: HandTrackingWorkerOutboundMessage,
  ) {
    if (activeRun !== run || run.cancelled || run.worker !== worker) return;
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
      handleEngineFailure(
        run,
        worker,
        message.message || "Local hand inference failed.",
      );
      return;
    }

    run.frameInFlight = false;
    if (message.hands.length === 0) {
      emitLossOrGrace(run, message.timestamp);
      return;
    }
    const activeKeys = new Set<string>();
    const interpreted = message.hands.map((hand, index) => {
      const key = handStateKey(hand.handedness, index);
      activeKeys.add(key);
      const transition = interpretHandFrame(
        run.intentStates.get(key) ?? createInitialHandIntentState(),
        {
          landmarks: hand.landmarks as HandLandmarks,
          confidence: hand.confidence,
          timestamp: message.timestamp,
        },
        dependencies.now(),
        { mirrorX: true },
      );
      if (transition.output.accepted)
        run.intentStates.set(key, transition.state);
      return { hand, transition };
    });
    for (const key of run.intentStates.keys()) {
      if (!activeKeys.has(key)) run.intentStates.delete(key);
    }
    const accepted = interpreted.filter(
      (entry) => entry.transition.output.accepted,
    );
    const pinches = accepted.flatMap((entry) => {
      const output = entry.transition.output;
      return output.accepted && output.mode === "pinch"
        ? [{ hand: entry.hand, output }]
        : [];
    });
    if (pinches.length >= 2) {
      const hands = pinches.slice(0, 2).map(({ hand, output }) => ({
        handedness: hand.handedness,
        pointer: output.pointer,
        confidence: output.confidence,
        landmarks: hand.landmarks,
        pinchDistance: output.pinchDistance,
      })) as unknown as [HandTrackingPointer, HandTrackingPointer];
      const [first, second] = hands;
      emit({
        mode: "bimanual_pinch",
        hands,
        center: {
          x: rounded((first.pointer.x + second.pointer.x) / 2),
          y: rounded((first.pointer.y + second.pointer.y) / 2),
        },
        span: rounded(
          Math.hypot(
            first.pointer.x - second.pointer.x,
            first.pointer.y - second.pointer.y,
          ),
        ),
        timestamp: message.timestamp,
      });
      run.lastSingleObservation = null;
      return;
    }
    const primary = accepted.sort(
      (left, right) =>
        handModePriority(right.transition.output.mode) -
        handModePriority(left.transition.output.mode),
    )[0];
    if (!primary || !primary.transition.output.accepted) {
      emitLossOrGrace(run, message.timestamp);
      return;
    }
    const output = primary.transition.output;
    const observation: Extract<
      HandTrackingObservation,
      { mode: "point" | "pinch" | "open_palm" }
    > = {
      mode: output.mode,
      pointer: output.pointer,
      confidence: output.confidence,
      handedness: primary.hand.handedness,
      landmarks: primary.hand.landmarks,
      pinchDistance: output.pinchDistance,
      trackingState: "tracked",
      timestamp: output.timestamp,
    };
    run.lastSingleObservation = observation;
    emit(observation);
  }

  function emitLossOrGrace(run: HandTrackingRun, timestamp: number) {
    const previous = run.lastSingleObservation;
    if (
      previous?.mode === "pinch" &&
      timestamp >= previous.timestamp &&
      timestamp - previous.timestamp <= PINCH_TRACKING_GRACE_MS
    ) {
      emit({
        ...previous,
        confidence: rounded(previous.confidence * 0.85),
        timestamp,
        trackingState: "grace",
      });
      return;
    }
    run.lastSingleObservation = null;
    run.intentStates.clear();
    emit({ mode: "idle", timestamp, trackingState: "lost" });
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
    getEngineStatus: () => engineStatus,
    subscribeEngineStatus(listener) {
      engineListeners.add(listener);
      return () => engineListeners.delete(listener);
    },
    async start(targetVideo) {
      if (status.state === "starting" || status.state === "ready") return;
      if (
        (!dependencies.getSharedMediaStream && !dependencies.getUserMedia) ||
        !dependencies.createWorkerForEngine ||
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
        const mediaOperation = acquireMediaStream(dependencies);
        const mediaResult = await waitForRunOrStop(run, mediaOperation);
        if (mediaResult.stopped) {
          void mediaOperation.then(releaseAcquiredStream, () => undefined);
          return;
        }
        run.stream = mediaResult.value.stream;
        run.ownsStream = mediaResult.value.owned;
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
        const ready = new Promise<void>((resolve, reject) => {
          run.resolveReady = resolve;
          run.rejectReady = reject;
        });
        startEngineWorker(run, 0);
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
      setEngineStatus(null);
      setStatus({ state: "off" });
      emit({ mode: "idle", timestamp: dependencies.now() });
    },
  };
}

interface HandTrackingRun {
  readonly id: number;
  readonly video: HTMLVideoElement;
  stream: MediaStream | null;
  ownsStream: boolean;
  worker: HandTrackingWorkerLike | null;
  engineIndex: number;
  animationFrame: number | null;
  frameInFlight: boolean;
  intentStates: Map<string, HandIntentState>;
  lastSingleObservation: Extract<
    HandTrackingObservation,
    { mode: "point" | "pinch" | "open_palm" }
  > | null;
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
    ownsStream: false,
    worker: null,
    engineIndex: 0,
    animationFrame: null,
    frameInFlight: false,
    intentStates: new Map(),
    lastSingleObservation: null,
    cancelled: false,
    stopped,
    resolveStop,
    resolveReady: null,
    rejectReady: null,
    readyTimeout: null,
  };
}

function handStateKey(handedness: TrackedHandedness, index: number) {
  return handedness === "unknown" ? `unknown-${index}` : handedness;
}

function handModePriority(mode: string) {
  switch (mode) {
    case "pinch":
      return 3;
    case "open_palm":
      return 2;
    case "point":
      return 1;
    default:
      return 0;
  }
}

function rounded(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
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

async function acquireMediaStream(
  dependencies: ResolvedHandTrackingControllerDependencies,
): Promise<{ stream: MediaStream; owned: boolean }> {
  const shared = await dependencies.getSharedMediaStream?.();
  if (shared) return { stream: shared, owned: false };
  if (!dependencies.getUserMedia) throw new Error(UNAVAILABLE_MESSAGE);
  const stream = await dependencies.getUserMedia({
    audio: false,
    video: {
      facingMode: "user",
      width: { ideal: 640 },
      height: { ideal: 480 },
      frameRate: { ideal: 30, max: 30 },
    },
  });
  return { stream, owned: true };
}

function releaseAcquiredStream(acquired: {
  stream: MediaStream;
  owned: boolean;
}) {
  if (acquired.owned) stopStream(acquired.stream);
}

function resolveDependencies(
  provided: HandTrackingControllerDependencies,
): ResolvedHandTrackingControllerDependencies {
  const plan = provided.visionEnginePlan ?? createDefaultSpatialVisionEnginePlan();
  const useFallback = Boolean(
    provided.visionEnginePlan ||
      provided.createWorkerForEngine ||
      (!provided.createWorker && !provided.loadDetector),
  );
  const visionEngines = useFallback
    ? [plan.primary, plan.fallback]
    : [plan.primary];
  const supportsWorkerCanvas =
    provided.supportsWorkerCanvas ??
    (provided.createWorker || provided.createWorkerForEngine
      ? true
      : typeof globalThis.OffscreenCanvas === "function");
  const canCreateBrowserWorker = typeof Worker !== "undefined";
  const canCreateInPageEndpoint = typeof document !== "undefined";
  const createWorkerForEngine = provided.createWorkerForEngine
    ? (engine: SpatialVisionEngine) =>
        provided.createWorkerForEngine!(engine.descriptor)
    : provided.createWorker && supportsWorkerCanvas
      ? () => provided.createWorker!()
      : canCreateBrowserWorker || canCreateInPageEndpoint
        ? (engine: SpatialVisionEngine) => {
            if (supportsWorkerCanvas && engine.worker && canCreateBrowserWorker)
              return new Worker(engine.worker.scriptUrl, {
                type: "module",
                name: engine.worker.name,
              }) as unknown as HandTrackingWorkerLike;
            if (canCreateInPageEndpoint)
              return createInPageHandTrackingWorker(
                provided.loadDetector ?? engine.loadDetector,
              );
            throw new Error(UNAVAILABLE_MESSAGE);
          }
        : undefined;
  return {
    visionEngines,
    getSharedMediaStream: provided.getSharedMediaStream,
    getUserMedia:
      provided.getUserMedia ??
      (typeof navigator !== "undefined" && navigator.mediaDevices?.getUserMedia
        ? navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
        : undefined),
    createWorkerForEngine,
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
    workerReadyTimeoutMs: provided.workerReadyTimeoutMs ?? 45_000,
    now: provided.now ?? (() => performance.now()),
  };
}

function createInPageHandTrackingWorker(
  loadDetector: (options: HandDetectorLoadOptions) => Promise<HandDetector>,
): HandTrackingWorkerLike {
  let terminated = false;
  let operation = Promise.resolve();
  const endpoint: HandTrackingWorkerLike = {
    onmessage: null,
    onerror: null,
    postMessage(message) {
      if (terminated) {
        if (message.type === "frame") message.frame.close();
        return;
      }
      operation = operation
        .then(() => runtime.handleMessage(message))
        .catch((error: unknown) => {
          if (terminated) return;
          endpoint.onmessage?.({
            data: {
              type: "error",
              message:
                error instanceof Error && error.message.trim()
                  ? error.message
                  : "Local hand tracking could not start.",
            },
          } as MessageEvent<HandTrackingWorkerOutboundMessage>);
        });
    },
    terminate() {
      if (terminated) return;
      terminated = true;
      operation = operation.then(() => runtime.handleMessage({ type: "dispose" }));
    },
  };
  const runtime = createHandTrackingWorkerRuntime({
    loadDetector,
    postMessage(message) {
      if (!terminated)
        endpoint.onmessage?.({ data: message } as MessageEvent<HandTrackingWorkerOutboundMessage>);
    },
  });
  return endpoint;
}

interface ResolvedHandTrackingControllerDependencies {
  visionEngines: readonly SpatialVisionEngine[];
  getSharedMediaStream?: HandTrackingControllerDependencies["getSharedMediaStream"];
  getUserMedia?: HandTrackingControllerDependencies["getUserMedia"];
  createWorkerForEngine?: (engine: SpatialVisionEngine) => HandTrackingWorkerLike;
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
