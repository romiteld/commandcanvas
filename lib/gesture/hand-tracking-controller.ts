import {
  createInitialHandIntentState,
  interpretHandFrame,
  type HandIntentState,
  type HandLandmarks,
} from "@/lib/gesture/hand-intent";
import type {
  HandDetector,
  HandDetectorLoadOptions,
  HandDetectorDiagnostics,
  HandTrackingWorkerInboundMessage,
  HandTrackingWorkerOutboundMessage,
  HandTrackingRelayMetrics,
  TrackedHandLandmarks,
  TrackedHandedness,
} from "@/lib/gesture/hand-tracking-worker-core";
import { createHandTrackingWorkerRuntime } from "@/lib/gesture/hand-tracking-worker-core";
import {
  createDefaultSpatialVisionEnginePlan,
  type SpatialVisionEngine,
  type SpatialVisionEngineDescriptor,
  type SpatialVisionEnginePlan,
} from "@/lib/gesture/spatial-vision-engine";
import {
  createPrivateHandRelaySpatialVisionEngine,
  createPrivateHandRelayWorker,
  PRIVATE_HAND_RELAY_ENGINE_ID,
  type PrivateHandRelayWorkerLike,
  type PrivateHandRelayWorkerOptions,
} from "@/lib/gesture/private-hand-relay-worker";

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
      pinchRatio?: number;
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
  pinchRatio?: number;
}

export interface HandTrackingWorkerLike {
  readonly frameQueueMode?: "newest-only";
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
  executionProvider?: HandDetectorDiagnostics["executionProvider"];
  highPerformanceGpuRequested?: boolean;
  processingLocation?: HandDetectorDiagnostics["processingLocation"];
  adapter?: HandDetectorDiagnostics["adapter"];
  fallbackReason?: string;
  fallbackKind?: "private-relay" | "engine" | "webgpu";
  /** Median detector-worker round trip after a captured bitmap is posted. */
  detectorRoundTripMs?: number;
  /** Fresh landmark results per second over the latest local samples. */
  resultRateFps?: number;
  runtimeSamples?: number;
  /** Server-reported model processing time, excluding browser/network transit. */
  processingLatencyMs?: number;
  encodeLatencyMs?: number;
  relayRoundTripMs?: number;
  droppedBeforeEncode?: number;
  droppedBeforeSend?: number;
}

export interface PrivateHandRelayControllerOptions
  extends PrivateHandRelayWorkerOptions {
  createWorker?: () => PrivateHandRelayWorkerLike;
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
  privateHandRelay?: PrivateHandRelayControllerOptions;
}

const UNAVAILABLE_MESSAGE =
  "Local hand tracking is unavailable in this browser.";
const SHARED_CAMERA_STOPPED_MESSAGE =
  "The shared camera stopped. Enable hand input again to reconnect.";
const PINCH_TRACKING_GRACE_MS = 180;
const POINT_TRACKING_GRACE_MS = 220;
const UNKNOWN_HAND_TRACK_TTL_MS = 360;
const UNKNOWN_HAND_TRACK_MAX_DISTANCE = 0.35;

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

  function setEngineStatus(
    engine: SpatialVisionEngine | null,
    fallback = false,
    fallbackReason?: string,
    fallbackKind?: HandTrackingEngineStatus["fallbackKind"],
  ) {
    engineStatus = engine
      ? {
          id: engine.descriptor.id,
          displayName: engine.descriptor.displayName,
          runtime: engine.descriptor.runtime,
          fallback,
          ...(fallbackReason ? { fallbackReason } : {}),
          ...(fallbackKind ? { fallbackKind } : {}),
        }
      : null;
    engineListeners.forEach((listener) => listener(engineStatus));
  }

  function recordRuntimeResult(
    run: HandTrackingRun,
    frameTimestamp: number,
    processingLatencyMs?: number,
    relayMetrics?: HandTrackingRelayMetrics,
  ) {
    if (!engineStatus || !Number.isFinite(frameTimestamp)) return;
    const completedAt = dependencies.now();
    if (!Number.isFinite(completedAt) || completedAt < frameTimestamp) return;
    run.roundTripSamples.push(completedAt - frameTimestamp);
    run.resultCompletionTimes.push(completedAt);
    if (run.roundTripSamples.length > 30) run.roundTripSamples.shift();
    if (run.resultCompletionTimes.length > 30) run.resultCompletionTimes.shift();
    const sorted = [...run.roundTripSamples].sort((left, right) => left - right);
    const midpoint = Math.floor(sorted.length / 2);
    const median = sorted.length % 2
      ? sorted[midpoint]!
      : (sorted[midpoint - 1]! + sorted[midpoint]!) / 2;
    const first = run.resultCompletionTimes[0]!;
    const last = run.resultCompletionTimes.at(-1)!;
    const elapsed = last - first;
    const resultRateFps =
      run.resultCompletionTimes.length >= 2 && elapsed > 0
        ? ((run.resultCompletionTimes.length - 1) * 1_000) / elapsed
        : undefined;
    engineStatus = {
      ...engineStatus,
      detectorRoundTripMs: rounded(median),
      ...(resultRateFps === undefined
        ? {}
        : { resultRateFps: rounded(resultRateFps) }),
      runtimeSamples: run.roundTripSamples.length,
      ...(processingLatencyMs === undefined
        ? {}
        : { processingLatencyMs: rounded(processingLatencyMs) }),
      ...(relayMetrics
        ? {
            encodeLatencyMs: rounded(relayMetrics.encodeLatencyMs),
            relayRoundTripMs: rounded(relayMetrics.relayRoundTripMs),
            droppedBeforeEncode: relayMetrics.droppedBeforeEncode,
            droppedBeforeSend: relayMetrics.droppedBeforeSend,
          }
        : {}),
    };
    engineListeners.forEach((listener) => listener(engineStatus));
  }

  function clearRunResources(run: HandTrackingRun) {
    if (run.sharedVideoTrack && run.sharedVideoTrackEndedListener)
      run.sharedVideoTrack.removeEventListener(
        "ended",
        run.sharedVideoTrackEndedListener,
      );
    run.sharedVideoTrack = null;
    run.sharedVideoTrackEndedListener = null;
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
    run.unknownHandTracks.clear();
    run.lastSingleObservation = null;
    run.roundTripSamples = [];
    run.resultCompletionTimes = [];
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
    const engine = run.visionEngines[engineIndex];
    const createWorkerForEngine = dependencies.createWorkerForEngine;
    if (!engine || !createWorkerForEngine) throw new Error(UNAVAILABLE_MESSAGE);
    const worker = createWorkerForEngine(engine);
    run.engineIndex = engineIndex;
    run.worker = worker;
    setEngineStatus(
      engine,
      engineIndex > 0,
      run.pendingFallbackReason,
      run.pendingFallbackKind,
    );
    run.pendingFallbackReason = undefined;
    run.pendingFallbackKind = undefined;
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
    if (nextEngineIndex >= run.visionEngines.length) {
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
    run.roundTripSamples = [];
    run.resultCompletionTimes = [];
    run.intentStates.clear();
    run.lastSingleObservation = null;
    const failedEngine = run.visionEngines[run.engineIndex];
    run.pendingFallbackReason = message;
    run.pendingFallbackKind =
      failedEngine?.descriptor.id === PRIVATE_HAND_RELAY_ENGINE_ID
        ? "private-relay"
        : "engine";
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
      if (run.sharedVideoTrack?.readyState === "ended") {
        handleSharedCameraStopped(run);
        return;
      }
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
      if (run.worker.frameQueueMode === "newest-only") run.frameInFlight = false;
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
      if (message.diagnostics) applyDetectorDiagnostics(message.diagnostics);
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
    if (message.type === "diagnostics") {
      applyDetectorDiagnostics(message.diagnostics);
      return;
    }

    run.frameInFlight = false;
    recordRuntimeResult(
      run,
      message.timestamp,
      message.processingLatencyMs,
      message.relayMetrics,
    );
    if (message.hands.length === 0) {
      emitLossOrGrace(run, message.timestamp);
      return;
    }
    const stateKeys = assignHandStateKeys(run, message.hands, message.timestamp);
    const activeKeys = new Set<string>();
    const interpreted = message.hands.map((hand, index) => {
      const key = stateKeys[index]!;
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
      if (!activeKeys.has(key) && !run.unknownHandTracks.has(key))
        run.intentStates.delete(key);
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
        pinchRatio: output.pinchRatio,
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
      pinchRatio: output.pinchRatio,
      trackingState: "tracked",
      timestamp: output.timestamp,
    };
    run.lastSingleObservation = observation;
    emit(observation);
  }

  function applyDetectorDiagnostics(diagnostics: HandDetectorDiagnostics) {
    if (!engineStatus) return;
    engineStatus = {
      ...engineStatus,
      executionProvider: diagnostics.executionProvider,
      highPerformanceGpuRequested:
        diagnostics.highPerformanceGpuRequested,
      ...(diagnostics.processingLocation
        ? { processingLocation: diagnostics.processingLocation }
        : {}),
      ...(diagnostics.adapter ? { adapter: diagnostics.adapter } : {}),
      ...(diagnostics.fallbackReason
        ? { fallbackReason: diagnostics.fallbackReason }
        : {}),
    };
    engineListeners.forEach((listener) => listener(engineStatus));
  }

  function emitLossOrGrace(run: HandTrackingRun, timestamp: number) {
    const previous = run.lastSingleObservation;
    const graceMs =
      previous?.mode === "pinch"
        ? PINCH_TRACKING_GRACE_MS
        : previous?.mode === "point"
          ? POINT_TRACKING_GRACE_MS
          : 0;
    if (
      previous &&
      graceMs > 0 &&
      timestamp >= previous.timestamp &&
      timestamp - previous.timestamp <= graceMs
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

  function watchSharedCamera(run: HandTrackingRun) {
    if (run.ownsStream || !run.stream) return;
    const track =
      run.stream.getVideoTracks?.()[0] ??
      run.stream.getTracks().find((candidate) => candidate.kind === "video") ??
      run.stream.getTracks()[0];
    if (
      !track ||
      typeof track.addEventListener !== "function" ||
      typeof track.removeEventListener !== "function"
    )
      return;
    const onEnded = () => handleSharedCameraStopped(run);
    run.sharedVideoTrack = track;
    run.sharedVideoTrackEndedListener = onEnded;
    track.addEventListener("ended", onEnded, { once: true });
    if (track.readyState === "ended") handleSharedCameraStopped(run);
  }

  function handleSharedCameraStopped(run: HandTrackingRun) {
    if (activeRun !== run || run.cancelled) return;
    emit({ mode: "idle", timestamp: dependencies.now(), trackingState: "lost" });
    setEngineStatus(null);
    failUnavailable(run, SHARED_CAMERA_STOPPED_MESSAGE);
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

      const run = createRun(
        ++nextRunId,
        targetVideo,
        dependencies.visionEnginesForStart(),
      );
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
        watchSharedCamera(run);
        if (activeRun === run && !run.cancelled) startEngineWorker(run, 0);
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
  readonly visionEngines: readonly SpatialVisionEngine[];
  engineIndex: number;
  pendingFallbackReason?: string;
  pendingFallbackKind?: HandTrackingEngineStatus["fallbackKind"];
  animationFrame: number | null;
  frameInFlight: boolean;
  intentStates: Map<string, HandIntentState>;
  unknownHandTracks: Map<string, UnknownHandTrack>;
  nextUnknownHandTrackId: number;
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
  sharedVideoTrack: MediaStreamTrack | null;
  sharedVideoTrackEndedListener: EventListener | null;
  roundTripSamples: number[];
  resultCompletionTimes: number[];
}

function createRun(
  id: number,
  video: HTMLVideoElement,
  visionEngines: readonly SpatialVisionEngine[],
): HandTrackingRun {
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
    visionEngines,
    engineIndex: 0,
    animationFrame: null,
    frameInFlight: false,
    intentStates: new Map(),
    unknownHandTracks: new Map(),
    nextUnknownHandTrackId: 0,
    lastSingleObservation: null,
    cancelled: false,
    stopped,
    resolveStop,
    resolveReady: null,
    rejectReady: null,
    readyTimeout: null,
    sharedVideoTrack: null,
    sharedVideoTrackEndedListener: null,
    roundTripSamples: [],
    resultCompletionTimes: [],
  };
}

interface UnknownHandTrack {
  key: string;
  center: { x: number; y: number };
  lastSeenAt: number;
}

function assignHandStateKeys(
  run: HandTrackingRun,
  hands: readonly TrackedHandLandmarks[],
  timestamp: number,
) {
  pruneUnknownHandTracks(run, timestamp);
  const keys = new Array<string>(hands.length);
  const unknownHands = hands.flatMap((hand, index) => {
    if (hand.handedness !== "unknown") {
      keys[index] = hand.handedness;
      return [];
    }
    return [{ index, center: palmCenter(hand.landmarks) }];
  });
  const tracks = [...run.unknownHandTracks.values()];
  const assignments = matchUnknownHands(unknownHands, tracks);
  const reservedKeys = new Set(assignments.map(({ track }) => track.key));

  for (const { hand, track } of assignments) {
    track.center = hand.center;
    track.lastSeenAt = timestamp;
    keys[hand.index] = track.key;
  }
  for (const hand of unknownHands) {
    if (keys[hand.index]) continue;
    while (run.unknownHandTracks.size >= 2) {
      const evicted = [...run.unknownHandTracks.values()]
        .filter((track) => !reservedKeys.has(track.key))
        .sort((left, right) => left.lastSeenAt - right.lastSeenAt)[0];
      if (!evicted) break;
      run.unknownHandTracks.delete(evicted.key);
      run.intentStates.delete(evicted.key);
    }
    const key = `unknown-track-${++run.nextUnknownHandTrackId}`;
    run.unknownHandTracks.set(key, {
      key,
      center: hand.center,
      lastSeenAt: timestamp,
    });
    reservedKeys.add(key);
    keys[hand.index] = key;
  }
  return keys;
}

function matchUnknownHands(
  hands: readonly { index: number; center: { x: number; y: number } }[],
  tracks: readonly UnknownHandTrack[],
) {
  if (hands.length === 2 && tracks.length === 2) {
    const straight = [
      { hand: hands[0]!, track: tracks[0]! },
      { hand: hands[1]!, track: tracks[1]! },
    ];
    const crossed = [
      { hand: hands[0]!, track: tracks[1]! },
      { hand: hands[1]!, track: tracks[0]! },
    ];
    const candidates = [straight, crossed]
      .filter((pairs) =>
        pairs.every(
          ({ hand, track }) =>
            pointDistance(hand.center, track.center) <=
            UNKNOWN_HAND_TRACK_MAX_DISTANCE,
        ),
      )
      .sort(
        (left, right) =>
          assignmentDistance(left) - assignmentDistance(right),
      );
    if (candidates[0]) return candidates[0];
  }

  const matchedHands = new Set<number>();
  const matchedTracks = new Set<string>();
  return hands
    .flatMap((hand) =>
      tracks.map((track) => ({
        hand,
        track,
        distance: pointDistance(hand.center, track.center),
      })),
    )
    .filter(({ distance }) => distance <= UNKNOWN_HAND_TRACK_MAX_DISTANCE)
    .sort((left, right) => left.distance - right.distance)
    .flatMap(({ hand, track }) => {
      if (matchedHands.has(hand.index) || matchedTracks.has(track.key)) return [];
      matchedHands.add(hand.index);
      matchedTracks.add(track.key);
      return [{ hand, track }];
    });
}

function pruneUnknownHandTracks(run: HandTrackingRun, timestamp: number) {
  for (const track of run.unknownHandTracks.values()) {
    if (timestamp - track.lastSeenAt <= UNKNOWN_HAND_TRACK_TTL_MS) continue;
    run.unknownHandTracks.delete(track.key);
    run.intentStates.delete(track.key);
  }
}

function palmCenter(landmarks: HandLandmarks) {
  const indices = [0, 5, 9, 13, 17] as const;
  const points = indices.map((index) => landmarks[index]);
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  };
}

function assignmentDistance(
  pairs: readonly {
    hand: { center: { x: number; y: number } };
    track: UnknownHandTrack;
  }[],
) {
  return pairs.reduce(
    (sum, { hand, track }) => sum + pointDistance(hand.center, track.center),
    0,
  );
}

function pointDistance(
  left: { x: number; y: number },
  right: { x: number; y: number },
) {
  return Math.hypot(left.x - right.x, left.y - right.y);
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
  const localVisionEngines = useFallback
    ? [plan.primary, plan.fallback]
    : [plan.primary];
  const relayEngine = provided.privateHandRelay
    ? createPrivateHandRelaySpatialVisionEngine()
    : null;
  const supportsWorkerCanvas =
    provided.supportsWorkerCanvas ??
    (provided.createWorker || provided.createWorkerForEngine
      ? true
      : typeof globalThis.OffscreenCanvas === "function");
  const canCreateBrowserWorker = typeof Worker !== "undefined";
  const canCreateInPageEndpoint = typeof document !== "undefined";
  const createLocalWorkerForEngine = provided.createWorkerForEngine
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
  const createWorkerForEngine = (
    createLocalWorkerForEngine || provided.privateHandRelay
  )
    ? (engine: SpatialVisionEngine) => {
        if (
          engine.descriptor.id === PRIVATE_HAND_RELAY_ENGINE_ID &&
          provided.privateHandRelay
        ) {
          if (provided.privateHandRelay.createWorker)
            return provided.privateHandRelay.createWorker();
          return createPrivateHandRelayWorker({
            roomId: provided.privateHandRelay.roomId,
            getAccessToken: provided.privateHandRelay.getAccessToken,
            cameraUploadConsent:
              provided.privateHandRelay.cameraUploadConsent,
            requestSession: provided.privateHandRelay.requestSession,
            createTransport: provided.privateHandRelay.createTransport,
            encodeFrame: provided.privateHandRelay.encodeFrame,
            now: provided.privateHandRelay.now,
            setTimeout: provided.privateHandRelay.setTimeout,
            clearTimeout: provided.privateHandRelay.clearTimeout,
          });
        }
        if (createLocalWorkerForEngine)
          return createLocalWorkerForEngine(engine);
        throw new Error(UNAVAILABLE_MESSAGE);
      }
    : undefined;
  return {
    visionEnginesForStart: () =>
      relayEngine && provided.privateHandRelay?.cameraUploadConsent()
        ? [relayEngine, ...localVisionEngines]
        : localVisionEngines,
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
  visionEnginesForStart: () => readonly SpatialVisionEngine[];
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
