import { z } from "zod";

import {
  applyCursorMessage,
  cursorMessageSchema,
  parsePresenceState,
  presenceParticipantSchema,
  revisionMessageSchema,
  shouldBroadcastCursor,
  type CursorMessage,
  type PresenceParticipant,
  type RemoteCursorState,
} from "@/lib/realtime/protocol";

type ChannelStatus =
  | "connecting"
  | "connected"
  | "channel_error"
  | "timed_out"
  | "closed";

interface RoomChannel {
  on: (
    type: "presence" | "broadcast",
    filter: { event: string },
    callback: (message?: unknown) => void,
  ) => RoomChannel;
  subscribe: (callback: (status: string) => void) => RoomChannel;
  track: (payload: PresenceParticipant) => Promise<unknown>;
  untrack: () => Promise<unknown>;
  send: (message: {
    type: "broadcast";
    event: "cursor";
    payload: CursorMessage;
  }) => Promise<unknown>;
  presenceState: () => unknown;
}

interface RoomRealtimeClient {
  realtime: { setAuth: (accessToken: string) => Promise<unknown> | unknown };
  channel: (
    topic: string,
    options: {
      config: {
        private: true;
        presence: { key: string };
        broadcast: { ack: false; self: false };
      };
    },
  ) => RoomChannel;
  removeChannel: (channel: RoomChannel) => Promise<unknown> | unknown;
}

interface ConnectivityEventSource {
  addEventListener: (
    type: "offline" | "online",
    listener: () => void,
  ) => unknown;
  removeEventListener: (
    type: "offline" | "online",
    listener: () => void,
  ) => unknown;
}

interface RealtimeRetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  jitterRatio?: number;
  random?: () => number;
  schedule?: (callback: () => void, delayMs: number) => unknown;
  cancel?: (handle: unknown) => void;
}

interface HardExpiryTimerOptions {
  schedule?: (callback: () => void, delayMs: number) => unknown;
  cancel?: (handle: unknown) => void;
}

interface RoomRealtimeOptions {
  client: RoomRealtimeClient;
  roomId: string;
  accessToken: string;
  participant: PresenceParticipant;
  getCurrentRevision: () => number;
  onPresence: (participants: PresenceParticipant[]) => void;
  onCursor: (cursor: CursorMessage) => void;
  onRevision: (revision: number) => void;
  onStatus: (status: ChannelStatus) => void;
  connectivityEvents?: ConnectivityEventSource | null;
  isOnline?: () => boolean;
  retry?: RealtimeRetryOptions;
  now?: () => number;
  hardExpiresAtEpochMs?: number;
  hardExpiryTimer?: HardExpiryTimerOptions;
}

export interface RoomRealtimeController {
  connect: () => Promise<void>;
  publishCursor: (point: { x: number; y: number }) => Promise<boolean>;
  dispose: () => Promise<void>;
}

const roomIdSchema = z.string().uuid();

type ConnectionAttempt =
  | { ok: true }
  | { ok: false; error: unknown };

const DEFAULT_RETRY_ATTEMPTS = 4;
const DEFAULT_RETRY_BASE_DELAY_MS = 500;
const DEFAULT_RETRY_MAX_DELAY_MS = 4_000;
const DEFAULT_RETRY_JITTER_RATIO = 0.2;
const CURSOR_SEQUENCE_TIME_SCALE = 1_000;

export function createRoomRealtime(
  rawOptions: RoomRealtimeOptions,
): RoomRealtimeController {
  const roomId = roomIdSchema.parse(rawOptions.roomId);
  const participant = presenceParticipantSchema.parse(rawOptions.participant);
  const now = rawOptions.now ?? Date.now;
  const connectivityEvents =
    rawOptions.connectivityEvents === undefined
      ? browserConnectivityEvents()
      : rawOptions.connectivityEvents;
  const retry = normalizeRetryOptions(rawOptions.retry);
  const hardExpiresAtEpochMs = z
    .number()
    .finite()
    .nonnegative()
    .optional()
    .parse(rawOptions.hardExpiresAtEpochMs);
  const hardExpiryTimer = normalizeHardExpiryTimer(rawOptions.hardExpiryTimer);
  const getOnline = rawOptions.isOnline ?? browserIsOnline;
  let channel: RoomChannel | null = null;
  let channelEpoch = 0;
  let pendingRemovalChannel: RoomChannel | null = null;
  let disposed = false;
  let disposalWork: Promise<void> | null = null;
  let connectivityListenersAttached = false;
  let recoveryNeeded = false;
  let recoveryAwaitingChannelOutcome = false;
  let online = getOnline();
  let retryAttempts = 0;
  let retryTimer: unknown = null;
  let retryAfterWork = false;
  let retryImmediatelyAfterWork = false;
  let reconnectWork: Promise<ConnectionAttempt> | null = null;
  let hardExpiryTimerHandle: unknown = null;
  let cursorSequence = cursorSequenceSeed(now());
  let lastCursorSentAt: number | null = null;
  let remoteCursors: RemoteCursorState = {};

  function emitStatus(status: ChannelStatus) {
    if (!disposed) rawOptions.onStatus(status);
  }

  async function connect() {
    if (disposed || channel) return;
    if (
      hardExpiresAtEpochMs !== undefined &&
      hardExpiresAtEpochMs <= now()
    ) {
      await expireRoomAccess();
      return;
    }
    scheduleHardExpiry();
    attachConnectivityListeners();
    const result = await startConnectionAttempt(false);
    if (!result.ok) throw result.error;
  }

  function scheduleHardExpiry() {
    if (
      disposed ||
      hardExpiresAtEpochMs === undefined ||
      hardExpiryTimerHandle !== null
    )
      return;
    const delayMs = hardExpiresAtEpochMs - now();
    if (delayMs <= 0) {
      void expireRoomAccess();
      return;
    }
    hardExpiryTimerHandle = hardExpiryTimer.schedule(() => {
      hardExpiryTimerHandle = null;
      void expireRoomAccess();
    }, delayMs);
  }

  async function expireRoomAccess() {
    if (disposed) return;
    emitStatus("closed");
    await dispose();
  }

  function cancelHardExpiryTimer() {
    if (hardExpiryTimerHandle === null) return;
    hardExpiryTimer.cancel(hardExpiryTimerHandle);
    hardExpiryTimerHandle = null;
  }

  async function establishChannel() {
    emitStatus("connecting");
    await rawOptions.client.realtime.setAuth(rawOptions.accessToken);
    if (disposed) return;
    const nextChannel = rawOptions.client.channel(`room:${roomId}`, {
      config: {
        private: true,
        presence: { key: participant.participantId },
        broadcast: { ack: false, self: false },
      },
    });
    channel = nextChannel;
    const nextChannelEpoch = ++channelEpoch;
    let terminal = false;
    let trackStarted = false;
    const isCurrentChannel = () =>
      !disposed &&
      channel === nextChannel &&
      channelEpoch === nextChannelEpoch;

    nextChannel
      .on("presence", { event: "sync" }, () => {
        if (!isCurrentChannel() || terminal) return;
        rawOptions.onPresence(parsePresenceState(nextChannel.presenceState()));
      })
      .on("broadcast", { event: "cursor" }, (message) => {
        if (!isCurrentChannel() || terminal) return;
        const payload = extractPayload(message);
        const parsed = cursorMessageSchema.safeParse(payload);
        if (!parsed.success) return;
        const next = applyCursorMessage(remoteCursors, parsed.data);
        if (next === remoteCursors) return;
        remoteCursors = next;
        rawOptions.onCursor(parsed.data);
      })
      .on("broadcast", { event: "revision" }, (message) => {
        if (!isCurrentChannel() || terminal) return;
        const parsed = revisionMessageSchema.safeParse(extractPayload(message));
        if (
          !parsed.success ||
          parsed.data.roomId !== roomId ||
          parsed.data.revision <= rawOptions.getCurrentRevision()
        )
          return;
        rawOptions.onRevision(parsed.data.revision);
      })
      .subscribe((status) => {
        if (!isCurrentChannel()) return;
        if (status === "SUBSCRIBED") {
          if (terminal || trackStarted) return;
          trackStarted = true;
          let trackWork: Promise<unknown>;
          try {
            trackWork = nextChannel.track(participant);
          } catch (error) {
            trackWork = Promise.reject(error);
          }
          void trackWork
            .then(() => {
              if (!isCurrentChannel() || terminal) return;
              recoveryNeeded = false;
              recoveryAwaitingChannelOutcome = false;
              retryAttempts = 0;
              cancelRetryTimer();
              emitStatus("connected");
            })
            .catch(() => {
              if (!isCurrentChannel() || terminal) return;
              terminal = true;
              requestRecovery("channel_error");
            });
        } else if (status === "CHANNEL_ERROR") {
          terminal = true;
          requestRecovery("channel_error");
        } else if (status === "TIMED_OUT") {
          terminal = true;
          requestRecovery("timed_out");
        } else if (status === "CLOSED") {
          terminal = true;
          requestRecovery("closed");
        }
      });
  }

  function startConnectionAttempt(replace: boolean) {
    if (reconnectWork) return reconnectWork;

    const work: Promise<ConnectionAttempt> = (
      replace ? replaceFailedChannel() : establishChannel()
    ).then(
      () => ({ ok: true as const }),
      (error: unknown) => ({ ok: false as const, error }),
    );
    reconnectWork = work;
    void work.then((result) => {
      if (reconnectWork === work) reconnectWork = null;
      if (disposed) return;
      if (!result.ok) {
        recoveryNeeded = true;
        recoveryAwaitingChannelOutcome = false;
        emitStatus("channel_error");
      }
      const shouldRetry = !result.ok || retryAfterWork;
      const retryImmediately = retryImmediatelyAfterWork;
      retryAfterWork = false;
      retryImmediatelyAfterWork = false;
      if (shouldRetry) scheduleRecovery(retryImmediately);
    });
    return work;
  }

  function attachConnectivityListeners() {
    if (!connectivityEvents || connectivityListenersAttached) return;
    connectivityEvents.addEventListener("offline", handleOffline);
    connectivityEvents.addEventListener("online", handleOnline);
    connectivityListenersAttached = true;
  }

  function handleOffline() {
    if (disposed) return;
    online = false;
    channelEpoch += 1;
    recoveryNeeded = true;
    recoveryAwaitingChannelOutcome = false;
    retryAfterWork = false;
    retryImmediatelyAfterWork = false;
    cancelRetryTimer();
    emitStatus("channel_error");
  }

  function handleOnline() {
    if (disposed || !recoveryNeeded) return;
    online = true;
    retryAttempts = 0;
    scheduleRecovery(true);
  }

  function requestRecovery(status: Exclude<ChannelStatus, "connecting" | "connected">) {
    if (disposed) return;
    recoveryNeeded = true;
    recoveryAwaitingChannelOutcome = false;
    emitStatus(status);
    scheduleRecovery(false);
  }

  function scheduleRecovery(immediate: boolean) {
    if (disposed || !recoveryNeeded || !online) return;
    if (recoveryAwaitingChannelOutcome) return;
    if (reconnectWork) {
      retryAfterWork = true;
      retryImmediatelyAfterWork ||= immediate;
      return;
    }
    if (retryTimer !== null) {
      if (!immediate) return;
      cancelRetryTimer();
    }
    if (retryAttempts >= retry.maxAttempts) return;

    if (immediate) {
      startRecoveryAttempt();
      return;
    }
    const delayMs = retryDelayMs(retryAttempts, retry);
    retryTimer = retry.schedule(() => {
      retryTimer = null;
      startRecoveryAttempt();
    }, delayMs);
  }

  function startRecoveryAttempt() {
    if (
      disposed ||
      !recoveryNeeded ||
      !online ||
      reconnectWork ||
      recoveryAwaitingChannelOutcome
    )
      return;
    recoveryAwaitingChannelOutcome = true;
    retryAttempts += 1;
    void startConnectionAttempt(true);
  }

  function cancelRetryTimer() {
    if (retryTimer === null) return;
    retry.cancel(retryTimer);
    retryTimer = null;
  }

  async function replaceFailedChannel() {
    const failedChannel = pendingRemovalChannel ?? channel;
    if (failedChannel) {
      if (channel === failedChannel) channel = null;
      pendingRemovalChannel = failedChannel;
      await failedChannel.untrack().catch(() => undefined);
      await rawOptions.client.removeChannel(failedChannel);
      if (pendingRemovalChannel === failedChannel)
        pendingRemovalChannel = null;
    }
    if (!disposed) await establishChannel();
  }

  async function publishCursor(point: { x: number; y: number }) {
    if (disposed || !channel) return false;
    const sentAt = now();
    if (!shouldBroadcastCursor(lastCursorSentAt, sentAt)) return false;

    const cursor = cursorMessageSchema.parse({
      participantId: participant.participantId,
      seq: ++cursorSequence,
      x: point.x,
      y: point.y,
      sentAt,
    });
    lastCursorSentAt = sentAt;
    await channel.send({ type: "broadcast", event: "cursor", payload: cursor });
    return true;
  }

  async function dispose() {
    if (disposalWork) return disposalWork;
    disposed = true;
    recoveryNeeded = false;
    recoveryAwaitingChannelOutcome = false;
    retryAfterWork = false;
    retryImmediatelyAfterWork = false;
    cancelRetryTimer();
    cancelHardExpiryTimer();
    if (connectivityEvents && connectivityListenersAttached) {
      connectivityEvents.removeEventListener("offline", handleOffline);
      connectivityEvents.removeEventListener("online", handleOnline);
      connectivityListenersAttached = false;
    }
    disposalWork = (async () => {
      const pendingConnection = reconnectWork;
      if (pendingConnection) await pendingConnection;

      const channels = new Set<RoomChannel>();
      if (channel) channels.add(channel);
      if (pendingRemovalChannel) channels.add(pendingRemovalChannel);
      channel = null;
      pendingRemovalChannel = null;
      for (const activeChannel of channels) {
        await activeChannel.untrack().catch(() => undefined);
        await Promise.resolve(rawOptions.client.removeChannel(activeChannel)).catch(
          () => undefined,
        );
      }
    })();
    return disposalWork;
  }

  return { connect, publishCursor, dispose };
}

interface NormalizedRetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitterRatio: number;
  random: () => number;
  schedule: (callback: () => void, delayMs: number) => unknown;
  cancel: (handle: unknown) => void;
}

interface NormalizedHardExpiryTimerOptions {
  schedule: (callback: () => void, delayMs: number) => unknown;
  cancel: (handle: unknown) => void;
}

function normalizeHardExpiryTimer(
  rawOptions: HardExpiryTimerOptions | undefined,
): NormalizedHardExpiryTimerOptions {
  return {
    schedule:
      rawOptions?.schedule ??
      ((callback, delayMs) => globalThis.setTimeout(callback, delayMs)),
    cancel:
      rawOptions?.cancel ??
      ((handle) =>
        globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>)),
  };
}

function normalizeRetryOptions(
  rawOptions: RealtimeRetryOptions | undefined,
): NormalizedRetryOptions {
  return {
    maxAttempts: nonNegativeInteger(
      rawOptions?.maxAttempts,
      DEFAULT_RETRY_ATTEMPTS,
    ),
    baseDelayMs: nonNegativeNumber(
      rawOptions?.baseDelayMs,
      DEFAULT_RETRY_BASE_DELAY_MS,
    ),
    maxDelayMs: nonNegativeNumber(
      rawOptions?.maxDelayMs,
      DEFAULT_RETRY_MAX_DELAY_MS,
    ),
    jitterRatio: Math.min(
      1,
      nonNegativeNumber(
        rawOptions?.jitterRatio,
        DEFAULT_RETRY_JITTER_RATIO,
      ),
    ),
    random: rawOptions?.random ?? Math.random,
    schedule:
      rawOptions?.schedule ??
      ((callback, delayMs) => globalThis.setTimeout(callback, delayMs)),
    cancel:
      rawOptions?.cancel ??
      ((handle) =>
        globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>)),
  };
}

function retryDelayMs(attemptsStarted: number, retry: NormalizedRetryOptions) {
  const baseDelay = Math.min(
    retry.maxDelayMs,
    retry.baseDelayMs * 2 ** attemptsStarted,
  );
  const jitter = (retry.random() * 2 - 1) * retry.jitterRatio;
  return Math.min(
    retry.maxDelayMs,
    Math.max(0, Math.round(baseDelay * (1 + jitter))),
  );
}

function nonNegativeInteger(value: number | undefined, fallback: number) {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(0, Math.floor(value));
}

function nonNegativeNumber(value: number | undefined, fallback: number) {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.max(0, value);
}

function browserIsOnline() {
  const navigatorCandidate = (
    globalThis as unknown as { navigator?: { onLine?: unknown } }
  ).navigator;
  return typeof navigatorCandidate?.onLine === "boolean"
    ? navigatorCandidate.onLine
    : true;
}

function cursorSequenceSeed(timestamp: number) {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return 0;
  return Math.min(
    Math.floor(timestamp) * CURSOR_SEQUENCE_TIME_SCALE,
    Number.MAX_SAFE_INTEGER - 1_000_000,
  );
}

function extractPayload(message: unknown) {
  if (!message || typeof message !== "object" || Array.isArray(message))
    return undefined;
  return (message as { payload?: unknown }).payload;
}

function browserConnectivityEvents(): ConnectivityEventSource | null {
  const candidate = globalThis as unknown as Partial<ConnectivityEventSource>;
  if (
    typeof candidate.addEventListener !== "function" ||
    typeof candidate.removeEventListener !== "function"
  )
    return null;
  return candidate as ConnectivityEventSource;
}
