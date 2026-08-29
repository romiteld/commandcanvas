import {
  createInitialHandIntentState,
  interpretHandFrame,
  type HandEngineSource,
  type HandIntentState,
  type HandLandmarks,
  type HandPhysicalMeasurements,
  type HandPredictionMarker,
  type HandReceiveTimestamp,
  type HandTrackId,
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
import {
  createHandRuntimeProfile,
  type HandRuntimeDropKind,
  type HandRuntimeMetricsSnapshot,
  type HandRuntimePreferenceIdentity,
  type HandRuntimePreferenceStorage,
  type HandRuntimeProfile,
} from "@/lib/gesture/hand-runtime-profile";

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
      /** Optional additive physical data; existing consumers can keep using pointer/mode. */
      measurements?: HandPhysicalMeasurements;
      source?: HandEngineSource;
      capturedAt?: number;
      receivedAt?: HandReceiveTimestamp;
      trackId?: HandTrackId;
      prediction?: HandPredictionMarker;
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
  acknowledgeRendered?(capturedAtMs: number, renderedAtMs?: number): boolean;
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
  runtimeMetrics?: HandRuntimeMetricsSnapshot;
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
  requestVideoFrameCallback?: (
    video: HTMLVideoElement,
    callback: VideoFrameRequestCallback,
  ) => number;
  cancelVideoFrameCallback?: (
    video: HTMLVideoElement,
    handle: number,
  ) => void;
  setTimeout?: (callback: () => void, delayMs: number) => number;
  clearTimeout?: (handle: number) => void;
  workerReadyTimeoutMs?: number;
  now?: () => number;
  preferenceStorage?: HandRuntimePreferenceStorage;
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
const MAX_SEMANTIC_RESULT_AGE_MS = 120;

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
    completedAt: number,
    processingLatencyMs?: number,
    relayMetrics?: HandTrackingRelayMetrics,
  ) {
    if (!engineStatus || !Number.isFinite(frameTimestamp)) return false;
    const captureLatencyMs = run.captureLatencies.get(frameTimestamp);
    run.captureLatencies.delete(frameTimestamp);
    const accepted = run.runtimeProfile.recordResult({
      capturedAtMs: frameTimestamp,
      receivedAtMs: completedAt,
      ...(captureLatencyMs === undefined ? {} : { captureLatencyMs }),
      ...(processingLatencyMs === undefined ? {} : { processingLatencyMs }),
      ...(relayMetrics
        ? {
            encodeLatencyMs: relayMetrics.encodeLatencyMs,
            relayLatencyMs: relayMetrics.relayRoundTripMs,
          }
        : {}),
    });
    if (!accepted) return false;
    if (relayMetrics) {
      recordCumulativeRelayDrop(
        run,
        "before-encode",
        relayMetrics.droppedBeforeEncode,
      );
      recordCumulativeRelayDrop(
        run,
        "before-send",
        relayMetrics.droppedBeforeSend,
      );
    }
    updateRuntimeMetrics(run);
    return true;
  }

  function updateRuntimeMetrics(run: HandTrackingRun, forcePublish = false) {
    if (!engineStatus) return;
    const snapshot = run.runtimeProfile.snapshot();
    engineStatus = {
      ...engineStatus,
      runtimeMetrics: snapshot,
      ...(snapshot.captureToReceiveMs === null
        ? {}
        : { detectorRoundTripMs: snapshot.captureToReceiveMs.p50 }),
      ...(snapshot.deliveredRateHz === null
        ? {}
        : { resultRateFps: snapshot.deliveredRateHz }),
      runtimeSamples: snapshot.sampleCount,
      ...(snapshot.processingLatencyMs === null
        ? {}
        : { processingLatencyMs: snapshot.processingLatencyMs.p50 }),
      ...(snapshot.encodeLatencyMs === null
        ? {}
        : { encodeLatencyMs: snapshot.encodeLatencyMs.p50 }),
      ...(snapshot.relayLatencyMs === null
        ? {}
        : { relayRoundTripMs: snapshot.relayLatencyMs.p50 }),
      droppedBeforeEncode: snapshot.droppedBeforeEncode,
      droppedBeforeSend: snapshot.droppedBeforeSend,
    };
    if (forcePublish || run.runtimeProfile.shouldPublish(dependencies.now()))
      engineListeners.forEach((listener) => listener(engineStatus));
  }

  function recordDrop(
    run: HandTrackingRun,
    kind: HandRuntimeDropKind,
    count = 1,
  ) {
    if (!run.runtimeProfile.recordDrop(kind, count)) return;
    run.cumulativeDrops[kind] += count;
    updateRuntimeMetrics(run);
  }

  function recordCumulativeRelayDrop(
    run: HandTrackingRun,
    kind: "before-encode" | "before-send",
    nextValue: number,
  ) {
    if (!Number.isSafeInteger(nextValue) || nextValue < 0) return;
    const previous = run.lastRelayDrops[kind];
    if (nextValue > previous) recordDrop(run, kind, nextValue - previous);
    run.lastRelayDrops[kind] = Math.max(previous, nextValue);
  }

  function clearRunResources(run: HandTrackingRun) {
    if (run.sharedVideoTrack && run.sharedVideoTrackEndedListener)
      run.sharedVideoTrack.removeEventListener(
        "ended",
        run.sharedVideoTrackEndedListener,
      );
    run.sharedVideoTrack = null;
    run.sharedVideoTrackEndedListener = null;
    removeVideoEndedListener(run);
    cancelScheduledFrame(run);
    run.engineEpoch += 1;
    run.captureRequested = false;
    run.captureInFlight = false;
    run.workerFrameInFlight = false;
    closePendingBitmap(run);
    if (run.readyTimeout !== null) {
      dependencies.clearTimeout(run.readyTimeout);
      run.readyTimeout = null;
    }
    if (run.startupTimeout !== null) {
      dependencies.clearTimeout(run.startupTimeout);
      run.startupTimeout = null;
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
    run.captureLatencies.clear();
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
    run.engineEpoch += 1;
    run.captureRequested = false;
    run.workerFrameInFlight = false;
    closePendingBitmap(run);
    run.engineIndex = engineIndex;
    run.worker = worker;
    resetRuntimeProfile(run, engine);
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
    run.engineEpoch += 1;
    run.workerFrameInFlight = false;
    run.captureRequested = false;
    closePendingBitmap(run);
    if (run.readyTimeout !== null) {
      dependencies.clearTimeout(run.readyTimeout);
      run.readyTimeout = null;
    }
    const nextEngineIndex = run.engineIndex + 1;
    if (nextEngineIndex >= run.visionEngines.length) {
      failUnavailable(run, message);
      return;
    }

    cancelScheduledFrame(run);
    if (run.startupTimeout !== null) {
      dependencies.clearTimeout(run.startupTimeout);
      run.startupTimeout = null;
    }
    try {
      worker.postMessage({ type: "dispose" });
    } catch {
      // Termination below is definitive.
    }
    worker.terminate();
    run.worker = null;
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
    if (
      dependencies.requestVideoFrameCallback &&
      dependencies.cancelVideoFrameCallback
    ) {
      const handle = dependencies.requestVideoFrameCallback(
        run.video,
        () => handleScheduledVideoFrame(run, null),
      );
      run.scheduledFrame = { kind: "video", handle };
      return;
    }
    if (!dependencies.requestAnimationFrame) return;
    const handle = dependencies.requestAnimationFrame(() => {
      const currentTime = run.video.currentTime;
      handleScheduledVideoFrame(
        run,
        Number.isFinite(currentTime) ? currentTime : null,
      );
    });
    run.scheduledFrame = { kind: "animation", handle };
  }

  function handleScheduledVideoFrame(
    run: HandTrackingRun,
    mediaTime: number | null,
  ) {
    run.scheduledFrame = null;
    if (activeRun !== run || run.cancelled || status.state !== "ready") return;
    if (run.sharedVideoTrack?.readyState === "ended") {
      handleSharedCameraStopped(run);
      return;
    }
    scheduleFrame(run);
    if (run.video.readyState < 2) return;
    if (mediaTime !== null) {
      if (run.lastVideoCurrentTime === mediaTime) return;
      run.lastVideoCurrentTime = mediaTime;
    }
    requestCapture(run);
  }

  function requestCapture(run: HandTrackingRun) {
    if (!dependencies.createImageBitmap || !run.worker) return;
    if (run.captureInFlight) {
      run.captureRequested = true;
      return;
    }
    void captureFrame(run);
  }

  async function captureFrame(run: HandTrackingRun) {
    if (!dependencies.createImageBitmap || !run.worker) return;
    run.captureInFlight = true;
    run.captureRequested = false;
    const epoch = run.engineEpoch;
    const worker = run.worker;
    const capturedAtMs = dependencies.now();
    let bitmap: ImageBitmap | null = null;
    try {
      bitmap = await dependencies.createImageBitmap(run.video);
      const captureFinishedAtMs = dependencies.now();
      run.captureInFlight = false;
      if (
        activeRun !== run ||
        run.cancelled ||
        run.worker !== worker ||
        run.engineEpoch !== epoch ||
        status.state !== "ready"
      ) {
        bitmap.close();
        recordDrop(run, "late-capture");
        return;
      }
      const captured: PendingCapturedBitmap = {
        bitmap,
        timestamp: capturedAtMs,
        captureLatencyMs: Math.max(0, captureFinishedAtMs - capturedAtMs),
        epoch,
        worker,
      };
      bitmap = null;
      enqueueCapturedBitmap(run, captured);
    } catch (error) {
      run.captureInFlight = false;
      bitmap?.close();
      if (activeRun !== run || run.cancelled) return;
      failUnavailable(
        run,
        error instanceof Error && error.message.trim()
          ? error.message
          : "The local camera frame could not be processed.",
      );
    } finally {
      if (
        run.captureRequested &&
        activeRun === run &&
        !run.cancelled &&
        status.state === "ready"
      )
        requestCapture(run);
    }
  }

  function enqueueCapturedBitmap(
    run: HandTrackingRun,
    captured: PendingCapturedBitmap,
  ) {
    if (run.workerFrameInFlight) {
      if (run.pendingBitmap) {
        run.pendingBitmap.bitmap.close();
        recordDrop(run, "superseded");
      }
      run.pendingBitmap = captured;
      return;
    }
    sendCapturedBitmap(run, captured);
  }

  function sendCapturedBitmap(
    run: HandTrackingRun,
    captured: PendingCapturedBitmap,
  ) {
    if (
      activeRun !== run ||
      run.cancelled ||
      run.engineEpoch !== captured.epoch ||
      run.worker !== captured.worker ||
      status.state !== "ready"
    ) {
      captured.bitmap.close();
      recordDrop(run, "late-capture");
      return;
    }
    run.workerFrameInFlight = true;
    run.captureLatencies.set(captured.timestamp, captured.captureLatencyMs);
    while (run.captureLatencies.size > 60) {
      const oldest = run.captureLatencies.keys().next().value as
        | number
        | undefined;
      if (oldest === undefined) break;
      run.captureLatencies.delete(oldest);
    }
    captured.worker.postMessage(
      { type: "frame", frame: captured.bitmap, timestamp: captured.timestamp },
      [captured.bitmap],
    );
  }

  function sendPendingBitmap(run: HandTrackingRun) {
    const pending = run.pendingBitmap;
    run.pendingBitmap = null;
    if (pending) sendCapturedBitmap(run, pending);
  }

  function handleWorkerMessage(
    run: HandTrackingRun,
    worker: HandTrackingWorkerLike,
    message: HandTrackingWorkerOutboundMessage,
  ) {
    if (activeRun !== run || run.cancelled || run.worker !== worker) return;
    if (message.type === "ready") {
      if (message.diagnostics) applyDetectorDiagnostics(message.diagnostics);
      configureRuntimePreference(run, message.diagnostics);
      if (run.readyTimeout !== null) {
        dependencies.clearTimeout(run.readyTimeout);
        run.readyTimeout = null;
      }
      if (shouldUseRememberedFallback(run, worker)) return;
      setStatus({ state: "ready" });
      run.resolveReady?.();
      run.resolveReady = null;
      run.rejectReady = null;
      scheduleFrame(run);
      scheduleStartupDecision(run, worker);
      return;
    }
    if (message.type === "error") {
      run.workerFrameInFlight = false;
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

    run.workerFrameInFlight = false;
    const receivedAt = dependencies.now();
    recordRuntimeResult(
      run,
      message.timestamp,
      receivedAt,
      message.processingLatencyMs,
      message.relayMetrics,
    );
    if (evaluateStartupDecision(run, worker, receivedAt)) return;
    sendPendingBitmap(run);
    if (receivedAt - message.timestamp > MAX_SEMANTIC_RESULT_AGE_MS) {
      recordDrop(run, "stale");
      emitLossOrGrace(run, receivedAt);
      return;
    }
    if (message.hands.length === 0) {
      emitLossOrGrace(run, message.timestamp);
      return;
    }
    const stateKeys = assignHandStateKeys(run, message.hands, message.timestamp);
    const source = run.visionEngines[run.engineIndex]?.descriptor.id ?? "unknown";
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
          source,
          receivedAt,
          trackId: key,
          handedness: hand.handedness,
        },
        dependencies.now(),
        { mirrorX: true },
      );
      if (transition.output.accepted)
        run.intentStates.set(key, transition.state);
      return { hand, trackId: key, transition };
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
      measurements: primary.transition.measurements ?? undefined,
      source,
      capturedAt: output.timestamp,
      receivedAt,
      trackId: primary.trackId,
      prediction: primary.transition.prediction,
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

  function resetRuntimeProfile(
    run: HandTrackingRun,
    engine: SpatialVisionEngine,
    identity: HandRuntimePreferenceIdentity | null = null,
  ) {
    run.runtimePreferenceIdentity = identity;
    run.runtimeProfile = createHandRuntimeProfile({
      startedAtMs: dependencies.now(),
      preferenceStorage: dependencies.preferenceStorage,
      ...(identity ? { preferenceIdentity: identity } : {}),
    });
    for (const [kind, count] of Object.entries(run.cumulativeDrops) as Array<
      [HandRuntimeDropKind, number]
    >) {
      if (count > 0) run.runtimeProfile.recordDrop(kind, count);
    }
    run.startupDecisionMade = engine.descriptor.role !== "default";
    run.lastRelayDrops = { "before-encode": 0, "before-send": 0 };
    updateRuntimeMetrics(run, true);
  }

  function configureRuntimePreference(
    run: HandTrackingRun,
    diagnostics?: HandDetectorDiagnostics,
  ) {
    const engine = run.visionEngines[run.engineIndex];
    if (!engine || engine.descriptor.role !== "default") return;
    const provider = diagnostics?.executionProvider;
    const deviceClass: HandRuntimePreferenceIdentity["deviceClass"] =
      provider === "webgpu" && diagnostics?.highPerformanceGpuRequested
        ? "high-performance-gpu"
        : provider === "webgpu" || provider === "cuda" || provider === "tensorrt"
          ? "gpu"
          : "cpu-or-unknown";
    resetRuntimeProfile(run, engine, {
      engineId: engine.descriptor.id,
      modelVersion: engine.descriptor.modelVersion,
      deviceClass,
    });
  }

  function shouldUseRememberedFallback(
    run: HandTrackingRun,
    worker: HandTrackingWorkerLike,
  ) {
    const engine = run.visionEngines[run.engineIndex];
    if (!engine || engine.descriptor.role !== "default") return false;
    const preference = run.runtimeProfile.loadPreference();
    if (preference === "retain-yolo") {
      run.startupDecisionMade = true;
      return false;
    }
    if (preference !== "fallback-mediapipe") return false;
    run.startupDecisionMade = true;
    handleEngineFailure(
      run,
      worker,
      "YOLO startup preference selected the measured MediaPipe fallback for this session and model.",
    );
    return true;
  }

  function scheduleStartupDecision(
    run: HandTrackingRun,
    worker: HandTrackingWorkerLike,
  ) {
    const engine = run.visionEngines[run.engineIndex];
    if (
      run.startupDecisionMade ||
      !engine ||
      engine.descriptor.role !== "default"
    )
      return;
    run.startupTimeout = dependencies.setTimeout(() => {
      run.startupTimeout = null;
      evaluateStartupDecision(run, worker, dependencies.now());
    }, 1_200);
  }

  function evaluateStartupDecision(
    run: HandTrackingRun,
    worker: HandTrackingWorkerLike,
    nowMs: number,
  ) {
    const engine = run.visionEngines[run.engineIndex];
    if (
      run.startupDecisionMade ||
      activeRun !== run ||
      run.cancelled ||
      run.worker !== worker ||
      !engine ||
      engine.descriptor.role !== "default"
    )
      return false;
    const decision = run.runtimeProfile.startupDecision(nowMs);
    if (decision.state === "pending") return false;
    run.startupDecisionMade = true;
    if (run.startupTimeout !== null) {
      dependencies.clearTimeout(run.startupTimeout);
      run.startupTimeout = null;
    }
    run.runtimeProfile.savePreference(decision.state);
    if (decision.state === "retain-yolo") return false;
    const rate = decision.deliveredRateHz?.toFixed(1) ?? "unmeasured";
    const tail = decision.captureToReceiveP95Ms?.toFixed(1) ?? "unmeasured";
    handleEngineFailure(
      run,
      worker,
      `YOLO startup performance missed the local 18 Hz / 100 ms thresholds (${rate} Hz, p95 ${tail} ms).`,
    );
    return true;
  }

  function closePendingBitmap(run: HandTrackingRun) {
    run.pendingBitmap?.bitmap.close();
    run.pendingBitmap = null;
  }

  function cancelScheduledFrame(run: HandTrackingRun) {
    const scheduled = run.scheduledFrame;
    run.scheduledFrame = null;
    if (!scheduled) return;
    if (scheduled.kind === "video") {
      dependencies.cancelVideoFrameCallback?.(run.video, scheduled.handle);
      return;
    }
    dependencies.cancelAnimationFrame?.(scheduled.handle);
  }

  function watchVideoEnded(run: HandTrackingRun) {
    if (typeof run.video.addEventListener !== "function") return;
    const onEnded = () => handleSharedCameraStopped(run);
    run.videoEndedListener = onEnded;
    run.video.addEventListener("ended", onEnded, { once: true });
  }

  function removeVideoEndedListener(run: HandTrackingRun) {
    if (
      run.videoEndedListener &&
      typeof run.video.removeEventListener === "function"
    )
      run.video.removeEventListener("ended", run.videoEndedListener);
    run.videoEndedListener = null;
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
    acknowledgeRendered(capturedAtMs, renderedAtMs = dependencies.now()) {
      const run = activeRun;
      if (!run) return false;
      const accepted = run.runtimeProfile.acknowledgeRendered(
        capturedAtMs,
        renderedAtMs,
      );
      if (accepted) updateRuntimeMetrics(run);
      return accepted;
    },
    async start(targetVideo) {
      if (status.state === "starting" || status.state === "ready") return;
      if (
        (!dependencies.getSharedMediaStream && !dependencies.getUserMedia) ||
        !dependencies.createWorkerForEngine ||
        !dependencies.createImageBitmap ||
        !(
          (dependencies.requestVideoFrameCallback &&
            dependencies.cancelVideoFrameCallback) ||
          (dependencies.requestAnimationFrame &&
            dependencies.cancelAnimationFrame)
        )
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
        watchVideoEnded(run);
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
  engineEpoch: number;
  pendingFallbackReason?: string;
  pendingFallbackKind?: HandTrackingEngineStatus["fallbackKind"];
  scheduledFrame: ScheduledFrame | null;
  captureInFlight: boolean;
  captureRequested: boolean;
  workerFrameInFlight: boolean;
  pendingBitmap: PendingCapturedBitmap | null;
  lastVideoCurrentTime: number | null;
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
  startupTimeout: number | null;
  startupDecisionMade: boolean;
  sharedVideoTrack: MediaStreamTrack | null;
  sharedVideoTrackEndedListener: EventListener | null;
  videoEndedListener: EventListener | null;
  runtimeProfile: HandRuntimeProfile;
  runtimePreferenceIdentity: HandRuntimePreferenceIdentity | null;
  captureLatencies: Map<number, number>;
  cumulativeDrops: Record<HandRuntimeDropKind, number>;
  lastRelayDrops: Record<"before-encode" | "before-send", number>;
}

interface PendingCapturedBitmap {
  readonly bitmap: ImageBitmap;
  readonly timestamp: number;
  readonly captureLatencyMs: number;
  readonly epoch: number;
  readonly worker: HandTrackingWorkerLike;
}

type ScheduledFrame =
  | { readonly kind: "video"; readonly handle: number }
  | { readonly kind: "animation"; readonly handle: number };

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
    engineEpoch: 0,
    scheduledFrame: null,
    captureInFlight: false,
    captureRequested: false,
    workerFrameInFlight: false,
    pendingBitmap: null,
    lastVideoCurrentTime: null,
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
    startupTimeout: null,
    startupDecisionMade: false,
    sharedVideoTrack: null,
    sharedVideoTrackEndedListener: null,
    videoEndedListener: null,
    runtimeProfile: createHandRuntimeProfile({ startedAtMs: 0 }),
    runtimePreferenceIdentity: null,
    captureLatencies: new Map(),
    cumulativeDrops: {
      superseded: 0,
      "late-capture": 0,
      stale: 0,
      "before-encode": 0,
      "before-send": 0,
    },
    lastRelayDrops: { "before-encode": 0, "before-send": 0 },
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
    requestVideoFrameCallback:
      provided.requestVideoFrameCallback ??
      (typeof HTMLVideoElement !== "undefined" &&
      typeof HTMLVideoElement.prototype.requestVideoFrameCallback === "function"
        ? (video, callback) => video.requestVideoFrameCallback(callback)
        : undefined),
    cancelVideoFrameCallback:
      provided.cancelVideoFrameCallback ??
      (typeof HTMLVideoElement !== "undefined" &&
      typeof HTMLVideoElement.prototype.cancelVideoFrameCallback === "function"
        ? (video, handle) => video.cancelVideoFrameCallback(handle)
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
    preferenceStorage:
      provided.preferenceStorage ?? safeSessionPreferenceStorage(),
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
  requestVideoFrameCallback?: HandTrackingControllerDependencies["requestVideoFrameCallback"];
  cancelVideoFrameCallback?: HandTrackingControllerDependencies["cancelVideoFrameCallback"];
  setTimeout: NonNullable<HandTrackingControllerDependencies["setTimeout"]>;
  clearTimeout: NonNullable<HandTrackingControllerDependencies["clearTimeout"]>;
  workerReadyTimeoutMs: number;
  now: NonNullable<HandTrackingControllerDependencies["now"]>;
  preferenceStorage?: HandRuntimePreferenceStorage;
}

function safeSessionPreferenceStorage(): HandRuntimePreferenceStorage | undefined {
  try {
    return typeof sessionStorage === "undefined" ? undefined : sessionStorage;
  } catch {
    return undefined;
  }
}

function isPermissionRefusal(error: unknown) {
  return (
    error instanceof DOMException &&
    (error.name === "NotAllowedError" || error.name === "SecurityError")
  );
}
