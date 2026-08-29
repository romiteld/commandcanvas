import type {
  HandTrackingWorkerInboundMessage,
  HandTrackingWorkerOutboundMessage,
} from "@/lib/gesture/hand-tracking-worker-core";
import type { HandLandmarks } from "@/lib/gesture/hand-intent";
import type { HandTrackingWorkerLike } from "@/lib/gesture/hand-tracking-controller";
import type { SpatialVisionEngine } from "@/lib/gesture/spatial-vision-engine";
import {
  createPrivateHandRelayTransport,
  requestPrivateHandRelaySession,
  type PrivateHandRelayTransport,
  type PrivateHandRelayTransportMetrics,
} from "@/lib/gesture/private-hand-relay-client";
import type { PrivateHandRelayCapability } from "@/lib/gesture/private-hand-relay-contract";

export interface PrivateHandRelayEncodingLimits {
  maxBytes: number;
  maxWidth: number;
  maxHeight: number;
}

export type PrivateHandRelayFrameEncoder = (
  frame: ImageBitmap,
  limits: PrivateHandRelayEncodingLimits,
) => Promise<Blob>;

export interface PrivateHandRelayWorkerOptions {
  roomId: string;
  getAccessToken: () => string | null | Promise<string | null>;
  cameraUploadConsent: () => boolean;
  requestSession?: typeof requestPrivateHandRelaySession;
  createTransport?: typeof createPrivateHandRelayTransport;
  encodeFrame?: PrivateHandRelayFrameEncoder;
  now?: () => number;
  setTimeout?: (callback: () => void, delayMs: number) => number;
  clearTimeout?: (handle: number) => void;
}

export interface PrivateHandRelayWorkerLike extends HandTrackingWorkerLike {
  readonly frameQueueMode: "newest-only";
}

export const PRIVATE_HAND_RELAY_ENGINE_ID = "private-gpu-hand-relay-v1";
const PRIVATE_HAND_RELAY_USEFUL_WIDTH = 640;
const PRIVATE_HAND_RELAY_USEFUL_HEIGHT = 480;
const PRIVATE_HAND_RELAY_TARGET_BYTES = 131_072;

export function createPrivateHandRelaySpatialVisionEngine(): SpatialVisionEngine {
  return {
    descriptor: {
      id: PRIVATE_HAND_RELAY_ENGINE_ID,
      displayName: "Private GPU Hand Relay",
      role: "candidate",
      runtime: "private-hand-relay",
      output: "hand-pose-keypoints",
      keypointCount: 21,
      modelVersion: "session-reported",
      evidence: {
        targetDeviceBenchmark: "live-target-device",
        licenseReview: "agpl-3.0-source-release",
      },
    },
    detectorLoadOptions: {
      wasmBaseUrl: "private-relay",
      modelAssetUrl: "private-relay",
      runningMode: "VIDEO",
      numHands: 2,
    },
    worker: null,
    async loadDetector() {
      throw new Error("Private relay inference is not an in-page detector.");
    },
  };
}

/**
 * Main-thread Worker-compatible endpoint for the private relay. The controller
 * therefore receives the same ready/result/error protocol as every local hand
 * engine and keeps all gesture interpretation in one canonical path.
 */
export function createPrivateHandRelayWorker(
  options: PrivateHandRelayWorkerOptions,
): PrivateHandRelayWorkerLike {
  const requestSession = options.requestSession ?? requestPrivateHandRelaySession;
  const createTransport = options.createTransport ?? createPrivateHandRelayTransport;
  const encodeFrame =
    options.encodeFrame ?? createAdaptivePrivateHandRelayFrameEncoder();
  const now = options.now ?? (() => performance.now());
  const setTimer =
    options.setTimeout ??
    ((callback: () => void, delayMs: number) =>
      globalThis.setTimeout(callback, delayMs) as unknown as number);
  const clearTimer =
    options.clearTimeout ?? ((handle: number) => globalThis.clearTimeout(handle));
  let terminated = false;
  let initialization = 0;
  let sessionAbort: AbortController | null = null;
  let transport: PrivateHandRelayTransport | null = null;
  let capability: PrivateHandRelayCapability | null = null;
  let encoding = false;
  let relayBusy = false;
  let pending: PendingRelayFrame | null = null;
  let pumpTimer: number | null = null;
  let nextEncodeAtMs = 0;
  let minimumFrameIntervalMs = 0;
  let droppedBeforeEncode = 0;
  let inFlightEncodeLatencyMs: number | null = null;
  let consentFailureReported = false;

  const worker: PrivateHandRelayWorkerLike = {
    frameQueueMode: "newest-only",
    onmessage: null,
    onerror: null,
    postMessage(message) {
      if (terminated) {
        closeInboundFrame(message);
        return;
      }
      if (message.type === "initialize") {
        void initialize();
        return;
      }
      if (message.type === "dispose") {
        stop();
        return;
      }
      enqueueBitmap(message.frame, message.timestamp);
    },
    terminate: stop,
  };

  function emit(message: HandTrackingWorkerOutboundMessage) {
    if (!terminated)
      worker.onmessage?.({ data: message } as MessageEvent<HandTrackingWorkerOutboundMessage>);
  }

  async function initialize() {
    const operation = ++initialization;
    sessionAbort?.abort();
    sessionAbort = new AbortController();
    transport?.stop();
    transport = null;
    capability = null;
    relayBusy = false;
    nextEncodeAtMs = 0;
    minimumFrameIntervalMs = 0;
    droppedBeforeEncode = 0;
    inFlightEncodeLatencyMs = null;
    clearPumpTimer();
    consentFailureReported = false;
    closePending();

    if (!options.cameraUploadConsent()) {
      emit({
        type: "error",
        message: "Private GPU camera upload consent is not active.",
      });
      return;
    }

    let accessToken: string | null;
    try {
      accessToken = await options.getAccessToken();
    } catch {
      emit({
        type: "error",
        message: "Private GPU relay authorization is unavailable.",
      });
      return;
    }
    if (!accessToken?.trim()) {
      emit({
        type: "error",
        message: "Private GPU relay authorization is unavailable.",
      });
      return;
    }
    if (terminated || operation !== initialization) return;
    if (!options.cameraUploadConsent()) {
      emitConsentRevoked();
      return;
    }

    const sessionResult = await requestSession({
      roomId: options.roomId,
      accessToken,
      cameraUploadConsent: true,
      signal: sessionAbort.signal,
    });
    if (terminated || operation !== initialization) return;
    if (!sessionResult.ok) {
      emit({
        type: "error",
        message: relaySessionFailureMessage(sessionResult.code),
      });
      return;
    }
    if (!options.cameraUploadConsent()) {
      emitConsentRevoked();
      return;
    }

    capability = sessionResult.relay.capability;
    minimumFrameIntervalMs = Math.ceil(
      1_000 / sessionResult.relay.capability.limits.maxFps,
    );
    transport = createTransport({
      session: sessionResult.relay,
      cameraUploadConsent: true,
      onReady() {
        if (terminated || operation !== initialization) return;
        const activeCapability = capability;
        if (!activeCapability) return;
        emit({
          type: "ready",
          diagnostics: {
            executionProvider: activeCapability.runtime.provider,
            highPerformanceGpuRequested: false,
            processingLocation: "private-relay",
            adapter: { description: activeCapability.runtime.device },
          },
        });
      },
      onResult(
        result,
        transportMetrics: PrivateHandRelayTransportMetrics,
      ) {
        if (terminated || operation !== initialization) return;
        relayBusy = false;
        const encodeLatencyMs = inFlightEncodeLatencyMs ?? 0;
        inFlightEncodeLatencyMs = null;
        emit({
          type: "result",
          timestamp: result.capturedAtMs,
          hands: result.hands.map((hand) => ({
            ...hand,
            landmarks: hand.landmarks as unknown as HandLandmarks,
          })),
          processingLatencyMs: Math.max(
            0,
            result.processedAtMs - result.capturedAtMs,
          ),
          relayMetrics: {
            encodeLatencyMs,
            relayRoundTripMs: transportMetrics.relayRoundTripMs,
            droppedBeforeEncode,
            droppedBeforeSend: transportMetrics.droppedBeforeSend,
          },
        });
        void pumpFrames();
      },
      onFallback(reason) {
        if (terminated || operation !== initialization) return;
        emit({ type: "error", message: relayTransportFailureMessage(reason) });
      },
    });
  }

  function enqueueBitmap(frame: ImageBitmap, timestamp: number) {
    if (!options.cameraUploadConsent()) {
      frame.close();
      emitConsentRevoked();
      return;
    }
    if (!transport || !capability || !Number.isFinite(timestamp) || timestamp < 0) {
      frame.close();
      emit({ type: "error", message: "Private GPU relay is not ready." });
      return;
    }
    if (pending) {
      pending.frame.close();
      droppedBeforeEncode += 1;
    }
    pending = { frame, timestamp };
    void pumpFrames();
  }

  async function pumpFrames() {
    if (encoding || relayBusy || terminated || pumpTimer !== null) return;
    const next = pending;
    if (!next) return;
    const waitMs = nextEncodeAtMs - now();
    if (waitMs > 0) {
      pumpTimer = setTimer(() => {
        pumpTimer = null;
        void pumpFrames();
      }, Math.ceil(waitMs));
      return;
    }
    pending = null;
    encoding = true;
    const encodeStartedAtMs = now();
    try {
      const activeCapability = capability;
      if (!activeCapability) throw new Error("Private GPU relay is not ready.");
      const encodingLimits: PrivateHandRelayEncodingLimits = {
        maxBytes: Math.min(
          activeCapability.limits.maxFrameBytes,
          PRIVATE_HAND_RELAY_TARGET_BYTES,
        ),
        maxWidth: Math.min(
          activeCapability.limits.maxWidth,
          PRIVATE_HAND_RELAY_USEFUL_WIDTH,
        ),
        maxHeight: Math.min(
          activeCapability.limits.maxHeight,
          PRIVATE_HAND_RELAY_USEFUL_HEIGHT,
        ),
      };
      const encoded = await encodeFrame(next.frame, encodingLimits);
      if (terminated) return;
      if (!options.cameraUploadConsent()) {
        emitConsentRevoked();
        return;
      }
      const encodeFinishedAtMs = now();
      relayBusy = true;
      inFlightEncodeLatencyMs = Math.max(
        0,
        encodeFinishedAtMs - encodeStartedAtMs,
      );
      nextEncodeAtMs = encodeStartedAtMs + minimumFrameIntervalMs;
      if (
        encoded.size <= 0 ||
        encoded.size > encodingLimits.maxBytes ||
        (encoded.type !== "image/webp" && encoded.type !== "image/jpeg") ||
        !transport?.enqueueFrame(encoded, next.timestamp)
      ) {
        relayBusy = false;
        inFlightEncodeLatencyMs = null;
        throw new Error("Private GPU relay rejected the encoded camera frame.");
      }
    } catch (error) {
      relayBusy = false;
      inFlightEncodeLatencyMs = null;
      if (!terminated)
        emit({
          type: "error",
          message:
            error instanceof Error && error.message.trim()
              ? error.message
              : "Private GPU camera frame encoding failed.",
        });
    } finally {
      next.frame.close();
      encoding = false;
      if (!terminated && !relayBusy && pending) void pumpFrames();
    }
  }

  function emitConsentRevoked() {
    transport?.stop();
    transport = null;
    capability = null;
    relayBusy = false;
    inFlightEncodeLatencyMs = null;
    clearPumpTimer();
    closePending();
    if (consentFailureReported) return;
    consentFailureReported = true;
    emit({
      type: "error",
      message: "Private GPU camera upload consent was revoked.",
    });
  }

  function closePending() {
    pending?.frame.close();
    pending = null;
  }

  function clearPumpTimer() {
    if (pumpTimer !== null) clearTimer(pumpTimer);
    pumpTimer = null;
  }

  function stop() {
    if (terminated) return;
    terminated = true;
    initialization += 1;
    sessionAbort?.abort();
    sessionAbort = null;
    closePending();
    clearPumpTimer();
    transport?.stop();
    transport = null;
    capability = null;
  }

  return worker;
}

interface PendingRelayFrame {
  frame: ImageBitmap;
  timestamp: number;
}

function closeInboundFrame(message: HandTrackingWorkerInboundMessage) {
  if (message.type === "frame") message.frame.close();
}

function relaySessionFailureMessage(
  code:
    | "camera_upload_consent_required"
    | "relay_unavailable"
    | "invalid_relay_response",
) {
  switch (code) {
    case "camera_upload_consent_required":
      return "Private GPU camera upload consent is not active.";
    case "invalid_relay_response":
      return "Private GPU relay returned an invalid session response.";
    default:
      return "Private GPU relay is unavailable; switching to local hand tracking.";
  }
}

function relayTransportFailureMessage(
  reason:
    | "consent_required"
    | "connection_failed"
    | "invalid_relay_message"
    | "relay_timeout",
) {
  switch (reason) {
    case "consent_required":
      return "Private GPU camera upload consent was revoked.";
    case "invalid_relay_message":
      return "Private GPU relay returned an invalid hand-pose result.";
    case "relay_timeout":
      return "Private GPU relay timed out; switching to local hand tracking.";
    default:
      return "Private GPU relay connection failed; switching to local hand tracking.";
  }
}

/**
 * Encodes a bounded derivative of the current camera bitmap. No encoded or raw
 * frame is retained by this endpoint after it is handed to the transport.
 */
export async function encodePrivateHandRelayFrame(
  frame: ImageBitmap,
  limits: PrivateHandRelayEncodingLimits,
): Promise<Blob> {
  return createAdaptivePrivateHandRelayFrameEncoder()(frame, limits);
}

/**
 * Creates a run-scoped adaptive encoder. A successful bounded profile is tried
 * first for later frames, avoiding repeated oversized encodes without retaining
 * any camera pixels or blobs.
 */
export function createAdaptivePrivateHandRelayFrameEncoder(): PrivateHandRelayFrameEncoder {
  let successfulAttemptIndex: number | null = null;
  return async (frame, limits) => {
  if (typeof OffscreenCanvas !== "function")
    throw new Error("Private GPU frame encoding is unavailable in this browser.");
  const sourceWidth = Math.max(1, frame.width);
  const sourceHeight = Math.max(1, frame.height);
  const initialScale = Math.min(
    1,
    limits.maxWidth / sourceWidth,
    limits.maxHeight / sourceHeight,
  );
  const fallbackScale = Math.min(
    initialScale,
    480 / Math.max(sourceWidth, sourceHeight),
  );
  const profiles = [
    { scale: initialScale, type: "image/webp", quality: 0.78 },
    { scale: initialScale, type: "image/webp", quality: 0.62 },
    { scale: initialScale, type: "image/webp", quality: 0.48 },
    { scale: fallbackScale, type: "image/webp", quality: 0.52 },
    { scale: fallbackScale, type: "image/jpeg", quality: 0.58 },
    { scale: fallbackScale, type: "image/jpeg", quality: 0.42 },
  ] as const;
  const attemptIndices = successfulAttemptIndex === null
    ? profiles.map((_, index) => index)
    : [
        successfulAttemptIndex,
        ...profiles
          .map((_, index) => index)
          .filter((index) => index !== successfulAttemptIndex),
      ];

  for (const attemptIndex of attemptIndices) {
    const attempt = profiles[attemptIndex]!;
    const width = Math.max(1, Math.floor(sourceWidth * attempt.scale));
    const height = Math.max(1, Math.floor(sourceHeight * attempt.scale));
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d", { alpha: false });
    if (!context)
      throw new Error("Private GPU frame encoding could not create a canvas.");
    context.drawImage(frame, 0, 0, width, height);
    let encoded: Blob;
    try {
      encoded = await canvas.convertToBlob({
        type: attempt.type,
        quality: attempt.quality,
      });
    } catch {
      continue;
    }
    if (
      encoded.size > 0 &&
      encoded.size <= limits.maxBytes &&
      (encoded.type === "image/webp" || encoded.type === "image/jpeg")
    ) {
      successfulAttemptIndex = attemptIndex;
      return encoded;
    }
  }
  throw new Error("Camera frame exceeds the private GPU relay size limit.");
  };
}
