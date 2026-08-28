import {
  PRIVATE_HAND_RELAY_PROTOCOL,
  privateHandRelayReadyMessageSchema,
  privateHandRelayResultSchema,
  privateHandRelaySessionResponseSchema,
  type PrivateHandRelayResult,
  type PrivateHandRelaySession,
} from "@/lib/gesture/private-hand-relay-contract";

export type PrivateHandRelaySessionRequestResult =
  | ReturnType<typeof privateHandRelaySessionResponseSchema.parse>
  | {
      ok: false;
      code:
        | "camera_upload_consent_required"
        | "relay_unavailable"
        | "invalid_relay_response";
      fallback: "local";
    };

export async function requestPrivateHandRelaySession(input: {
  roomId: string;
  accessToken: string;
  cameraUploadConsent: boolean;
  fetch?: typeof fetch;
  signal?: AbortSignal;
}): Promise<PrivateHandRelaySessionRequestResult> {
  if (!input.cameraUploadConsent)
    return {
      ok: false,
      code: "camera_upload_consent_required",
      fallback: "local",
    };
  const fetcher = input.fetch ?? fetch;
  let response: Response;
  try {
    response = await fetcher(
      `/api/rooms/${encodeURIComponent(input.roomId)}/hand-relay/session`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${input.accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ cameraUploadConsent: true }),
        cache: "no-store",
        signal: input.signal,
      },
    );
  } catch {
    return { ok: false, code: "relay_unavailable", fallback: "local" };
  }
  if (!response.ok)
    return { ok: false, code: "relay_unavailable", fallback: "local" };

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return { ok: false, code: "invalid_relay_response", fallback: "local" };
  }
  const parsed = privateHandRelaySessionResponseSchema.safeParse(payload);
  if (!parsed.success || parsed.data.relay.roomId !== input.roomId)
    return { ok: false, code: "invalid_relay_response", fallback: "local" };
  return parsed.data;
}

export interface PrivateHandRelayWebSocketLike {
  readyState: number;
  bufferedAmount: number;
  binaryType: string;
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onerror: ((event: Event) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  send(value: string | ArrayBufferLike | Blob | ArrayBufferView): void;
  close(code?: number, reason?: string): void;
}

export interface PrivateHandRelayTransport {
  enqueueFrame(frame: Blob, capturedAtMs: number): boolean;
  stop(): void;
}

interface QueuedFrame {
  frameId: number;
  capturedAtMs: number;
  frame: Blob;
}

export function createPrivateHandRelayTransport(input: {
  session: PrivateHandRelaySession;
  cameraUploadConsent: boolean;
  createWebSocket?: (url: string) => PrivateHandRelayWebSocketLike;
  onResult: (result: PrivateHandRelayResult) => void;
  onFallback: (
    reason:
      | "consent_required"
      | "connection_failed"
      | "invalid_relay_message"
      | "relay_timeout",
  ) => void;
  frameTimeoutMs?: number;
  handshakeTimeoutMs?: number;
  now?: () => number;
  setTimeout?: typeof setTimeout;
  clearTimeout?: typeof clearTimeout;
}): PrivateHandRelayTransport {
  let stopped = false;
  let fallbackReported = false;
  let serverReady = false;
  let nextFrameId = 0;
  let inFlight: QueuedFrame | null = null;
  let pending: QueuedFrame | null = null;
  let drainTimer: ReturnType<typeof setTimeout> | null = null;
  let frameTimer: ReturnType<typeof setTimeout> | null = null;
  let handshakeTimer: ReturnType<typeof setTimeout> | null = null;
  let lastFrameSentAtMs: number | null = null;
  const setTimer = input.setTimeout ?? setTimeout;
  const clearTimer = input.clearTimeout ?? clearTimeout;
  const now = input.now ?? Date.now;
  const frameTimeoutMs = input.frameTimeoutMs ?? 2_000;
  const handshakeTimeoutMs = input.handshakeTimeoutMs ?? 2_000;
  const minimumFrameIntervalMs = Math.ceil(
    1_000 / input.session.capability.limits.maxFps,
  );

  const inert: PrivateHandRelayTransport = {
    enqueueFrame: () => false,
    stop: () => undefined,
  };
  if (!input.cameraUploadConsent) {
    input.onFallback("consent_required");
    return inert;
  }

  const createSocket =
    input.createWebSocket ??
    ((url: string) => new WebSocket(url) as PrivateHandRelayWebSocketLike);
  let socket: PrivateHandRelayWebSocketLike;
  try {
    socket = createSocket(input.session.websocketUrl);
  } catch {
    input.onFallback("connection_failed");
    return inert;
  }
  socket.binaryType = "arraybuffer";

  function clearTimers() {
    if (drainTimer !== null) clearTimer(drainTimer);
    if (frameTimer !== null) clearTimer(frameTimer);
    if (handshakeTimer !== null) clearTimer(handshakeTimer);
    drainTimer = null;
    frameTimer = null;
    handshakeTimer = null;
  }

  function fallBack(
    reason:
      | "consent_required"
      | "connection_failed"
      | "invalid_relay_message"
      | "relay_timeout",
  ) {
    if (fallbackReported || stopped) return;
    fallbackReported = true;
    stopped = true;
    clearTimers();
    pending = null;
    inFlight = null;
    try {
      socket.close(1000, "local fallback");
    } catch {
      // A failed close does not prevent the local engine from taking over.
    }
    input.onFallback(reason);
  }

  function flush() {
    if (
      stopped ||
      !serverReady ||
      inFlight !== null ||
      pending === null ||
      socket.readyState !== 1
    )
      return;
    if (socket.bufferedAmount > input.session.capability.limits.maxFrameBytes) {
      if (drainTimer === null)
        drainTimer = setTimer(() => {
          drainTimer = null;
          flush();
        }, 25);
      return;
    }
    if (lastFrameSentAtMs !== null) {
      const waitMs =
        lastFrameSentAtMs + minimumFrameIntervalMs - now();
      if (waitMs > 0) {
        if (drainTimer === null)
          drainTimer = setTimer(() => {
            drainTimer = null;
            flush();
          }, waitMs);
        return;
      }
    }
    const frame = pending;
    pending = null;
    inFlight = frame;
    try {
      socket.send(
        JSON.stringify({
          type: "frame",
          protocol: PRIVATE_HAND_RELAY_PROTOCOL,
          frameId: frame.frameId,
          capturedAtMs: frame.capturedAtMs,
          mimeType: frame.frame.type,
          byteLength: frame.frame.size,
        }),
      );
      socket.send(frame.frame);
    } catch {
      fallBack("connection_failed");
      return;
    }
    lastFrameSentAtMs = now();
    frameTimer = setTimer(() => fallBack("relay_timeout"), frameTimeoutMs);
  }

  // A socket can remain CONNECTING forever without firing open/error/close.
  // Start the local-fallback deadline as soon as construction succeeds.
  handshakeTimer = setTimer(
    () => fallBack("relay_timeout"),
    handshakeTimeoutMs,
  );

  socket.onopen = () => {
    if (stopped) return;
    try {
      socket.send(
        JSON.stringify({
          type: "hello",
          protocol: PRIVATE_HAND_RELAY_PROTOCOL,
          token: input.session.token,
        }),
      );
    } catch {
      fallBack("connection_failed");
      return;
    }
    if (handshakeTimer !== null) clearTimer(handshakeTimer);
    handshakeTimer = setTimer(
      () => fallBack("relay_timeout"),
      handshakeTimeoutMs,
    );
  };
  socket.onmessage = (event) => {
    if (stopped || typeof event.data !== "string") {
      if (!stopped) fallBack("invalid_relay_message");
      return;
    }
    let value: unknown;
    try {
      value = JSON.parse(event.data);
    } catch {
      fallBack("invalid_relay_message");
      return;
    }
    const ready = privateHandRelayReadyMessageSchema.safeParse(value);
    if (ready.success) {
      if (handshakeTimer !== null) clearTimer(handshakeTimer);
      handshakeTimer = null;
      serverReady = true;
      flush();
      return;
    }
    const result = privateHandRelayResultSchema.safeParse(value);
    if (!result.success || result.data.frameId !== inFlight?.frameId) {
      fallBack("invalid_relay_message");
      return;
    }
    if (frameTimer !== null) clearTimer(frameTimer);
    frameTimer = null;
    inFlight = null;
    input.onResult(result.data);
    flush();
  };
  socket.onerror = () => fallBack("connection_failed");
  socket.onclose = () => {
    if (!stopped) fallBack("connection_failed");
  };

  return {
    enqueueFrame(frame, capturedAtMs) {
      if (
        stopped ||
        !Number.isFinite(capturedAtMs) ||
        capturedAtMs < 0 ||
        frame.size <= 0 ||
        frame.size > input.session.capability.limits.maxFrameBytes ||
        !["image/webp", "image/jpeg"].includes(frame.type)
      )
        return false;
      nextFrameId += 1;
      pending = { frameId: nextFrameId, capturedAtMs, frame };
      flush();
      return true;
    },
    stop() {
      if (stopped) return;
      stopped = true;
      clearTimers();
      pending = null;
      inFlight = null;
      socket.close(1000, "stopped");
    },
  };
}
