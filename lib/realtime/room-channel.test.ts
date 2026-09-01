import { describe, expect, it, vi } from "vitest";

import { createRoomRealtime } from "@/lib/realtime/room-channel";
import { applyCursorMessage } from "@/lib/realtime/protocol";

const ROOM_ID = "19895c17-7365-4c03-a1cc-c15b85179ee4";
const USER_ID = "8ddf3cce-8e92-4b04-bbde-765061563d3e";

function createHarness() {
  const handlers = new Map<string, (payload?: unknown) => void>();
  let subscribeHandler: ((status: string) => void) | undefined;
  const channel = {
    on: vi.fn(
      (type: string, filter: { event: string }, callback: (payload?: unknown) => void) => {
        handlers.set(`${type}:${filter.event}`, callback);
        return channel;
      },
    ),
    subscribe: vi.fn((callback: (status: string) => void) => {
      subscribeHandler = callback;
      return channel;
    }),
    track: vi.fn().mockResolvedValue("ok"),
    untrack: vi.fn().mockResolvedValue("ok"),
    send: vi.fn().mockResolvedValue("ok"),
    presenceState: vi.fn().mockReturnValue({}),
  };
  const client = {
    realtime: { setAuth: vi.fn().mockResolvedValue(undefined) },
    channel: vi.fn().mockReturnValue(channel),
    removeChannel: vi.fn().mockResolvedValue("ok"),
  };

  return {
    client,
    channel,
    handlers,
    subscribed(status: string) {
      subscribeHandler?.(status);
    },
  };
}

function createRecoveryHarness(initialStatus?: string) {
  type EventType = "offline" | "online";
  const listeners = new Map<EventType, Set<() => void>>();
  const channels: Array<ReturnType<typeof createChannel>> = [];

  function createChannel() {
    const handlers = new Map<string, (payload?: unknown) => void>();
    let subscribeHandler: ((status: string) => void) | undefined;
    const channel = {
      on: vi.fn(
        (
          type: string,
          filter: { event: string },
          callback: (payload?: unknown) => void,
        ) => {
          handlers.set(`${type}:${filter.event}`, callback);
          return channel;
        },
      ),
      subscribe: vi.fn((callback: (status: string) => void) => {
        subscribeHandler = callback;
        if (initialStatus) callback(initialStatus);
        return channel;
      }),
      track: vi.fn().mockResolvedValue("ok"),
      untrack: vi.fn().mockResolvedValue("ok"),
      send: vi.fn().mockResolvedValue("ok"),
      presenceState: vi.fn().mockReturnValue({}),
      emitStatus(status: string) {
        subscribeHandler?.(status);
      },
      emit(type: "presence" | "broadcast", event: string, payload?: unknown) {
        handlers.get(`${type}:${event}`)?.(payload);
      },
    };
    return channel;
  }

  const client = {
    realtime: { setAuth: vi.fn().mockResolvedValue(undefined) },
    channel: vi.fn(() => {
      const channel = createChannel();
      channels.push(channel);
      return channel;
    }),
    removeChannel: vi.fn().mockResolvedValue("ok"),
  };
  const connectivityEvents = {
    addEventListener: vi.fn((type: EventType, listener: () => void) => {
      const registered = listeners.get(type) ?? new Set<() => void>();
      registered.add(listener);
      listeners.set(type, registered);
    }),
    removeEventListener: vi.fn((type: EventType, listener: () => void) => {
      listeners.get(type)?.delete(listener);
    }),
    dispatch(type: EventType) {
      for (const listener of listeners.get(type) ?? []) listener();
    },
  };

  return { channels, client, connectivityEvents };
}

function deferred<T = unknown>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function createRetryHarness(maxAttempts = 3) {
  let sequence = 0;
  const scheduled = new Map<number, { callback: () => void; delayMs: number }>();
  const delays: number[] = [];
  const cancelled: number[] = [];

  return {
    options: {
      maxAttempts,
      baseDelayMs: 100,
      maxDelayMs: 400,
      jitterRatio: 0,
      random: () => 0.5,
      schedule(callback: () => void, delayMs: number) {
        const handle = ++sequence;
        scheduled.set(handle, { callback, delayMs });
        delays.push(delayMs);
        return handle;
      },
      cancel(handle: unknown) {
        const timer = Number(handle);
        scheduled.delete(timer);
        cancelled.push(timer);
      },
    },
    cancelled,
    delays,
    pendingCount: () => scheduled.size,
    runNext() {
      const next = scheduled.entries().next().value as
        | [number, { callback: () => void; delayMs: number }]
        | undefined;
      if (!next) throw new Error("No retry is scheduled.");
      scheduled.delete(next[0]);
      next[1].callback();
    },
  };
}

function createHardExpiryTimerHarness() {
  let sequence = 0;
  const scheduled = new Map<number, { callback: () => void; delayMs: number }>();
  const cancelled: number[] = [];

  return {
    timer: {
      schedule(callback: () => void, delayMs: number) {
        const handle = ++sequence;
        scheduled.set(handle, { callback, delayMs });
        return handle;
      },
      cancel(handle: unknown) {
        const timer = Number(handle);
        scheduled.delete(timer);
        cancelled.push(timer);
      },
    },
    cancelled,
    pendingCount: () => scheduled.size,
    onlyDelay: () => [...scheduled.values()][0]?.delayMs,
    fire() {
      const next = scheduled.entries().next().value as
        | [number, { callback: () => void; delayMs: number }]
        | undefined;
      if (!next) throw new Error("No hard-expiry timer is scheduled.");
      scheduled.delete(next[0]);
      next[1].callback();
    },
  };
}

describe("room realtime channel", () => {
  it("cooperatively untracks and removes the private channel at the room hard expiry", async () => {
    const harness = createHarness();
    const expiry = createHardExpiryTimerHarness();
    const statuses: string[] = [];
    let now = 1_000;
    const realtime = createRoomRealtime({
      client: harness.client,
      roomId: ROOM_ID,
      accessToken: "verified-access-token",
      participant: {
        participantId: USER_ID,
        displayName: "Sarah",
        role: "participant",
        color: "#7558cf",
        onlineAt: "2026-08-27T14:00:00.000Z",
      },
      getCurrentRevision: () => 3,
      onPresence: vi.fn(),
      onCursor: vi.fn(),
      onRevision: vi.fn(),
      onStatus: (status) => statuses.push(status),
      now: () => now,
      hardExpiresAtEpochMs: 2_000,
      hardExpiryTimer: expiry.timer,
    });

    await realtime.connect();
    harness.subscribed("SUBSCRIBED");
    await Promise.resolve();
    expect(expiry.onlyDelay()).toBe(1_000);

    now = 2_000;
    expiry.fire();
    await vi.waitFor(() =>
      expect(harness.client.removeChannel).toHaveBeenCalledWith(harness.channel),
    );
    expect(harness.channel.untrack).toHaveBeenCalledOnce();
    expect(statuses.at(-1)).toBe("closed");
    await expect(realtime.publishCursor({ x: 20, y: 40 })).resolves.toBe(false);
  });

  it("cancels the hard-expiry timer when the room channel is disposed early", async () => {
    const harness = createHarness();
    const expiry = createHardExpiryTimerHarness();
    const realtime = createRoomRealtime({
      client: harness.client,
      roomId: ROOM_ID,
      accessToken: "verified-access-token",
      participant: {
        participantId: USER_ID,
        displayName: "Sarah",
        role: "participant",
        color: "#7558cf",
        onlineAt: "2026-08-27T14:00:00.000Z",
      },
      getCurrentRevision: () => 3,
      onPresence: vi.fn(),
      onCursor: vi.fn(),
      onRevision: vi.fn(),
      onStatus: vi.fn(),
      now: () => 1_000,
      hardExpiresAtEpochMs: 2_000,
      hardExpiryTimer: expiry.timer,
    });

    await realtime.connect();
    expect(expiry.pendingCount()).toBe(1);
    await realtime.dispose();
    expect(expiry.pendingCount()).toBe(0);
    expect(expiry.cancelled).toEqual([1]);
    expect(harness.client.removeChannel).toHaveBeenCalledOnce();
  });

  it("keeps the hard-expiry deadline armed while the browser is offline", async () => {
    const harness = createRecoveryHarness();
    const expiry = createHardExpiryTimerHarness();
    let now = 1_000;
    const realtime = createRoomRealtime({
      client: harness.client,
      roomId: ROOM_ID,
      accessToken: "verified-access-token",
      participant: {
        participantId: USER_ID,
        displayName: "Sarah",
        role: "participant",
        color: "#7558cf",
        onlineAt: "2026-08-27T14:00:00.000Z",
      },
      getCurrentRevision: () => 3,
      onPresence: vi.fn(),
      onCursor: vi.fn(),
      onRevision: vi.fn(),
      onStatus: vi.fn(),
      connectivityEvents: harness.connectivityEvents,
      now: () => now,
      hardExpiresAtEpochMs: 2_000,
      hardExpiryTimer: expiry.timer,
    });

    await realtime.connect();
    harness.connectivityEvents.dispatch("offline");
    expect(expiry.pendingCount()).toBe(1);

    now = 2_000;
    expiry.fire();
    await vi.waitFor(() =>
      expect(harness.client.removeChannel).toHaveBeenCalledWith(
        harness.channels[0],
      ),
    );
  });

  it("does not subscribe when the room is already hard-expired", async () => {
    const harness = createHarness();
    const statuses: string[] = [];
    const realtime = createRoomRealtime({
      client: harness.client,
      roomId: ROOM_ID,
      accessToken: "verified-access-token",
      participant: {
        participantId: USER_ID,
        displayName: "Sarah",
        role: "participant",
        color: "#7558cf",
        onlineAt: "2026-08-27T14:00:00.000Z",
      },
      getCurrentRevision: () => 3,
      onPresence: vi.fn(),
      onCursor: vi.fn(),
      onRevision: vi.fn(),
      onStatus: (status) => statuses.push(status),
      now: () => 2_000,
      hardExpiresAtEpochMs: 2_000,
    });

    await realtime.connect();
    expect(harness.client.channel).not.toHaveBeenCalled();
    expect(statuses).toEqual(["closed"]);
  });

  it("joins the exact private room topic and tracks actual connected presence", async () => {
    const harness = createHarness();
    const onStatus = vi.fn();
    const realtime = createRoomRealtime({
      client: harness.client,
      roomId: ROOM_ID,
      accessToken: "verified-access-token",
      participant: {
        participantId: USER_ID,
        displayName: "Sarah",
        role: "participant",
        color: "#7558cf",
        onlineAt: "2026-08-27T14:00:00.000Z",
      },
      getCurrentRevision: () => 3,
      onPresence: vi.fn(),
      onCursor: vi.fn(),
      onRevision: vi.fn(),
      onStatus,
      now: () => 1_000,
    });

    await realtime.connect();
    expect(harness.client.realtime.setAuth).toHaveBeenCalledWith(
      "verified-access-token",
    );
    expect(harness.client.channel).toHaveBeenCalledWith(`room:${ROOM_ID}`, {
      config: {
        private: true,
        presence: { key: USER_ID },
        broadcast: { ack: false, self: false },
      },
    });

    harness.subscribed("SUBSCRIBED");
    await Promise.resolve();
    expect(harness.channel.track).toHaveBeenCalledWith({
      participantId: USER_ID,
      displayName: "Sarah",
      role: "participant",
      color: "#7558cf",
      onlineAt: "2026-08-27T14:00:00.000Z",
    });
    expect(onStatus).toHaveBeenLastCalledWith("connected");
  });

  it("validates Presence, cursor, and committed-revision messages before callbacks", async () => {
    const harness = createHarness();
    const onPresence = vi.fn();
    const onCursor = vi.fn();
    const onRevision = vi.fn();
    const realtime = createRoomRealtime({
      client: harness.client,
      roomId: ROOM_ID,
      accessToken: "verified-access-token",
      participant: {
        participantId: USER_ID,
        displayName: "Sarah",
        role: "participant",
        color: "#7558cf",
        onlineAt: "2026-08-27T14:00:00.000Z",
      },
      getCurrentRevision: () => 3,
      onPresence,
      onCursor,
      onRevision,
      onStatus: vi.fn(),
      now: () => 1_000,
    });
    await realtime.connect();

    harness.channel.presenceState.mockReturnValue({
      [USER_ID]: [
        {
          participantId: USER_ID,
          displayName: "Sarah",
          role: "participant",
          color: "#7558cf",
          onlineAt: "2026-08-27T14:00:00.000Z",
        },
      ],
    });
    harness.handlers.get("presence:sync")?.();
    expect(onPresence).toHaveBeenCalledWith([
      expect.objectContaining({ participantId: USER_ID, displayName: "Sarah" }),
    ]);

    harness.handlers.get("broadcast:cursor")?.({
      payload: { participantId: USER_ID, seq: 2, x: 40, y: 80, sentAt: 1_000 },
    });
    harness.handlers.get("broadcast:cursor")?.({
      payload: { participantId: USER_ID, seq: 1, x: 999, y: 999, sentAt: 1_001 },
    });
    expect(onCursor).toHaveBeenCalledOnce();
    expect(onCursor).toHaveBeenCalledWith(
      expect.objectContaining({ participantId: USER_ID, seq: 2, x: 40 }),
    );

    harness.handlers.get("broadcast:revision")?.({
      payload: {
        roomId: ROOM_ID,
        revision: 4,
        receiptId: "ca11ab1e-a7ea-4ad6-a97f-449a38c119ee",
      },
    });
    harness.handlers.get("broadcast:revision")?.({
      payload: {
        roomId: ROOM_ID,
        revision: 2,
        receiptId: "ca11ab1e-a7ea-4ad6-a97f-449a38c119ee",
      },
    });
    expect(onRevision).toHaveBeenCalledOnce();
    expect(onRevision).toHaveBeenCalledWith(4);
  });

  it("throttles cursor Broadcast and removes the channel on disposal", async () => {
    const harness = createHarness();
    let now = 1_000;
    const realtime = createRoomRealtime({
      client: harness.client,
      roomId: ROOM_ID,
      accessToken: "verified-access-token",
      participant: {
        participantId: USER_ID,
        displayName: "Sarah",
        role: "participant",
        color: "#7558cf",
        onlineAt: "2026-08-27T14:00:00.000Z",
      },
      getCurrentRevision: () => 3,
      onPresence: vi.fn(),
      onCursor: vi.fn(),
      onRevision: vi.fn(),
      onStatus: vi.fn(),
      now: () => now,
    });
    await realtime.connect();

    expect(await realtime.publishCursor({ x: 10, y: 20 })).toBe(true);
    now = 1_010;
    expect(await realtime.publishCursor({ x: 30, y: 40 })).toBe(false);
    now = 1_034;
    expect(await realtime.publishCursor({ x: 50, y: 60 })).toBe(true);
    expect(harness.channel.send).toHaveBeenCalledTimes(2);
    expect(harness.channel.send).toHaveBeenLastCalledWith({
      type: "broadcast",
      event: "cursor",
      payload: {
        participantId: USER_ID,
        seq: 1_000_002,
        x: 50,
        y: 60,
        sentAt: 1_034,
      },
    });

    await realtime.dispose();
    expect(harness.channel.untrack).toHaveBeenCalledOnce();
    expect(harness.client.removeChannel).toHaveBeenCalledWith(harness.channel);
  });

  it("keeps cursor ordering monotonic when the same participant reloads", async () => {
    const firstHarness = createHarness();
    const firstController = createRoomRealtime({
      client: firstHarness.client,
      roomId: ROOM_ID,
      accessToken: "verified-access-token",
      participant: {
        participantId: USER_ID,
        displayName: "Sarah",
        role: "participant",
        color: "#7558cf",
        onlineAt: "2026-08-27T14:00:00.000Z",
      },
      getCurrentRevision: () => 3,
      onPresence: vi.fn(),
      onCursor: vi.fn(),
      onRevision: vi.fn(),
      onStatus: vi.fn(),
      now: () => 1_000,
    });
    await firstController.connect();
    await firstController.publishCursor({ x: 10, y: 20 });
    const beforeReload = firstHarness.channel.send.mock.calls[0]![0].payload;

    const secondHarness = createHarness();
    const secondController = createRoomRealtime({
      client: secondHarness.client,
      roomId: ROOM_ID,
      accessToken: "verified-access-token",
      participant: {
        participantId: USER_ID,
        displayName: "Sarah",
        role: "participant",
        color: "#7558cf",
        onlineAt: "2026-08-27T14:00:01.000Z",
      },
      getCurrentRevision: () => 3,
      onPresence: vi.fn(),
      onCursor: vi.fn(),
      onRevision: vi.fn(),
      onStatus: vi.fn(),
      now: () => 2_000,
    });
    await secondController.connect();
    await secondController.publishCursor({ x: 90, y: 80 });
    const afterReload = secondHarness.channel.send.mock.calls[0]![0].payload;

    const firstState = applyCursorMessage({}, beforeReload);
    const reloadedState = applyCursorMessage(firstState, afterReload);
    expect(reloadedState[USER_ID]).toMatchObject({ x: 90, y: 80 });
    expect(reloadedState).not.toBe(firstState);

    await firstController.dispose();
    await secondController.dispose();
  });

  it("replaces a failed private channel after offline-to-online recovery", async () => {
    const harness = createRecoveryHarness();
    const statuses: string[] = [];
    const onCursor = vi.fn();
    const onPresence = vi.fn();
    const onRevision = vi.fn();
    const realtime = createRoomRealtime({
      client: harness.client,
      roomId: ROOM_ID,
      accessToken: "verified-access-token",
      participant: {
        participantId: USER_ID,
        displayName: "Sarah",
        role: "participant",
        color: "#7558cf",
        onlineAt: "2026-08-27T14:00:00.000Z",
      },
      getCurrentRevision: () => 3,
      onPresence,
      onCursor,
      onRevision,
      onStatus: (status) => statuses.push(status),
      connectivityEvents: harness.connectivityEvents,
      now: () => 1_000,
    });

    await realtime.connect();
    harness.channels[0]?.emitStatus("SUBSCRIBED");
    await vi.waitFor(() => expect(statuses.at(-1)).toBe("connected"));

    harness.connectivityEvents.dispatch("offline");
    expect(statuses.at(-1)).toBe("channel_error");

    harness.connectivityEvents.dispatch("online");
    await vi.waitFor(() => expect(harness.channels).toHaveLength(2));
    expect(harness.client.removeChannel).toHaveBeenCalledWith(
      harness.channels[0],
    );
    expect(harness.client.realtime.setAuth).toHaveBeenCalledTimes(2);

    harness.channels[1]?.emitStatus("SUBSCRIBED");
    await vi.waitFor(() => expect(statuses.at(-1)).toBe("connected"));
    expect(harness.channels[1]?.track).toHaveBeenCalledOnce();

    harness.channels[0]?.emit("presence", "sync");
    harness.channels[0]?.emit("broadcast", "cursor", {
      payload: {
        participantId: USER_ID,
        seq: 1,
        x: 40,
        y: 80,
        sentAt: 1_000,
      },
    });
    harness.channels[0]?.emit("broadcast", "revision", {
      payload: {
        roomId: ROOM_ID,
        revision: 4,
        receiptId: "ca11ab1e-a7ea-4ad6-a97f-449a38c119ee",
      },
    });
    expect(onPresence).not.toHaveBeenCalled();
    expect(onCursor).not.toHaveBeenCalled();
    expect(onRevision).not.toHaveBeenCalled();

    await realtime.dispose();
    expect(harness.connectivityEvents.removeEventListener).toHaveBeenCalledWith(
      "offline",
      expect.any(Function),
    );
    expect(harness.connectivityEvents.removeEventListener).toHaveBeenCalledWith(
      "online",
      expect.any(Function),
    );
  });

  it("coalesces repeated online events until the replacement channel settles", async () => {
    const harness = createRecoveryHarness();
    const retry = createRetryHarness();
    const realtime = createRoomRealtime({
      client: harness.client,
      roomId: ROOM_ID,
      accessToken: "verified-access-token",
      participant: {
        participantId: USER_ID,
        displayName: "Sarah",
        role: "participant",
        color: "#7558cf",
        onlineAt: "2026-08-27T14:00:00.000Z",
      },
      getCurrentRevision: () => 3,
      onPresence: vi.fn(),
      onCursor: vi.fn(),
      onRevision: vi.fn(),
      onStatus: vi.fn(),
      connectivityEvents: harness.connectivityEvents,
      retry: retry.options,
    });

    await realtime.connect();
    harness.channels[0]!.emitStatus("SUBSCRIBED");
    await Promise.resolve();
    harness.connectivityEvents.dispatch("offline");
    harness.connectivityEvents.dispatch("online");
    await vi.waitFor(() => expect(harness.channels).toHaveLength(2));

    harness.connectivityEvents.dispatch("online");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(harness.channels).toHaveLength(2);
    expect(harness.client.removeChannel).toHaveBeenCalledOnce();

    harness.channels[1]!.emitStatus("SUBSCRIBED");
    await realtime.dispose();
  });

  it("ignores a pending track resolution from a channel that has been replaced", async () => {
    const harness = createRecoveryHarness();
    const retry = createRetryHarness();
    const firstTrack = deferred();
    const statuses: string[] = [];
    const realtime = createRoomRealtime({
      client: harness.client,
      roomId: ROOM_ID,
      accessToken: "verified-access-token",
      participant: {
        participantId: USER_ID,
        displayName: "Sarah",
        role: "participant",
        color: "#7558cf",
        onlineAt: "2026-08-27T14:00:00.000Z",
      },
      getCurrentRevision: () => 3,
      onPresence: vi.fn(),
      onCursor: vi.fn(),
      onRevision: vi.fn(),
      onStatus: (status) => statuses.push(status),
      connectivityEvents: harness.connectivityEvents,
      retry: retry.options,
    });

    await realtime.connect();
    harness.channels[0]!.track.mockReturnValueOnce(firstTrack.promise);
    harness.channels[0]!.emitStatus("SUBSCRIBED");
    harness.channels[0]!.emitStatus("CHANNEL_ERROR");
    expect(retry.pendingCount()).toBe(1);

    retry.runNext();
    await vi.waitFor(() => expect(harness.channels).toHaveLength(2));
    firstTrack.resolve("ok");
    await Promise.resolve();

    expect(statuses.at(-1)).toBe("connecting");
    expect(statuses).not.toContain("connected");
    await realtime.dispose();
  });

  it("ignores a pending track rejection after disposal", async () => {
    const harness = createRecoveryHarness();
    const retry = createRetryHarness();
    const firstTrack = deferred();
    const statuses: string[] = [];
    const realtime = createRoomRealtime({
      client: harness.client,
      roomId: ROOM_ID,
      accessToken: "verified-access-token",
      participant: {
        participantId: USER_ID,
        displayName: "Sarah",
        role: "participant",
        color: "#7558cf",
        onlineAt: "2026-08-27T14:00:00.000Z",
      },
      getCurrentRevision: () => 3,
      onPresence: vi.fn(),
      onCursor: vi.fn(),
      onRevision: vi.fn(),
      onStatus: (status) => statuses.push(status),
      connectivityEvents: harness.connectivityEvents,
      retry: retry.options,
    });

    await realtime.connect();
    harness.channels[0]!.track.mockReturnValueOnce(firstTrack.promise);
    harness.channels[0]!.emitStatus("SUBSCRIBED");
    await realtime.dispose();
    const statusCountAtDisposal = statuses.length;

    firstTrack.reject(new Error("track completed after disposal"));
    await Promise.resolve();
    await Promise.resolve();

    expect(statuses).toHaveLength(statusCountAtDisposal);
    expect(retry.pendingCount()).toBe(0);
  });

  it("does not let a pending track resolution erase an offline recovery", async () => {
    const harness = createRecoveryHarness();
    const retry = createRetryHarness();
    const firstTrack = deferred();
    const statuses: string[] = [];
    const realtime = createRoomRealtime({
      client: harness.client,
      roomId: ROOM_ID,
      accessToken: "verified-access-token",
      participant: {
        participantId: USER_ID,
        displayName: "Sarah",
        role: "participant",
        color: "#7558cf",
        onlineAt: "2026-08-27T14:00:00.000Z",
      },
      getCurrentRevision: () => 3,
      onPresence: vi.fn(),
      onCursor: vi.fn(),
      onRevision: vi.fn(),
      onStatus: (status) => statuses.push(status),
      connectivityEvents: harness.connectivityEvents,
      retry: retry.options,
    });

    await realtime.connect();
    harness.channels[0]!.track.mockReturnValueOnce(firstTrack.promise);
    harness.channels[0]!.emitStatus("SUBSCRIBED");
    harness.connectivityEvents.dispatch("offline");
    firstTrack.resolve("ok");
    await Promise.resolve();
    expect(statuses.at(-1)).toBe("channel_error");

    harness.connectivityEvents.dispatch("online");
    await vi.waitFor(() => expect(harness.channels).toHaveLength(2));
    await realtime.dispose();
  });

  it("retries an initial authentication failure with bounded exponential delays", async () => {
    const harness = createRecoveryHarness();
    const retry = createRetryHarness(2);
    const statuses: string[] = [];
    harness.client.realtime.setAuth.mockRejectedValue(
      new Error("realtime auth unavailable"),
    );
    const realtime = createRoomRealtime({
      client: harness.client,
      roomId: ROOM_ID,
      accessToken: "verified-access-token",
      participant: {
        participantId: USER_ID,
        displayName: "Sarah",
        role: "participant",
        color: "#7558cf",
        onlineAt: "2026-08-27T14:00:00.000Z",
      },
      getCurrentRevision: () => 3,
      onPresence: vi.fn(),
      onCursor: vi.fn(),
      onRevision: vi.fn(),
      onStatus: (status) => statuses.push(status),
      connectivityEvents: harness.connectivityEvents,
      retry: retry.options,
    });

    await expect(realtime.connect()).rejects.toThrow(
      "realtime auth unavailable",
    );
    expect(retry.delays).toEqual([100]);

    retry.runNext();
    await vi.waitFor(() =>
      expect(harness.client.realtime.setAuth).toHaveBeenCalledTimes(2),
    );
    await vi.waitFor(() => expect(retry.delays).toEqual([100, 200]));
    retry.runNext();
    await vi.waitFor(() =>
      expect(harness.client.realtime.setAuth).toHaveBeenCalledTimes(3),
    );
    await vi.waitFor(() => expect(statuses.at(-1)).toBe("channel_error"));

    expect(retry.pendingCount()).toBe(0);
    await realtime.dispose();
  });

  it("applies injectable jitter without exceeding the retry delay bound", async () => {
    const harness = createRecoveryHarness();
    const retry = createRetryHarness(3);
    retry.options.maxDelayMs = 300;
    retry.options.jitterRatio = 0.25;
    retry.options.random = () => 1;
    harness.client.realtime.setAuth.mockRejectedValue(
      new Error("realtime auth unavailable"),
    );
    const realtime = createRoomRealtime({
      client: harness.client,
      roomId: ROOM_ID,
      accessToken: "verified-access-token",
      participant: {
        participantId: USER_ID,
        displayName: "Sarah",
        role: "participant",
        color: "#7558cf",
        onlineAt: "2026-08-27T14:00:00.000Z",
      },
      getCurrentRevision: () => 3,
      onPresence: vi.fn(),
      onCursor: vi.fn(),
      onRevision: vi.fn(),
      onStatus: vi.fn(),
      connectivityEvents: harness.connectivityEvents,
      retry: retry.options,
    });

    await expect(realtime.connect()).rejects.toThrow();
    retry.runNext();
    await vi.waitFor(() => expect(retry.delays).toHaveLength(2));
    retry.runNext();
    await vi.waitFor(() => expect(retry.delays).toHaveLength(3));

    expect(retry.delays).toEqual([125, 250, 300]);
    await realtime.dispose();
  });

  it.each(["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"])(
    "automatically replaces an online channel after %s",
    async (terminalStatus) => {
      const harness = createRecoveryHarness();
      const retry = createRetryHarness();
      const realtime = createRoomRealtime({
        client: harness.client,
        roomId: ROOM_ID,
        accessToken: "verified-access-token",
        participant: {
          participantId: USER_ID,
          displayName: "Sarah",
          role: "participant",
          color: "#7558cf",
          onlineAt: "2026-08-27T14:00:00.000Z",
        },
        getCurrentRevision: () => 3,
        onPresence: vi.fn(),
        onCursor: vi.fn(),
        onRevision: vi.fn(),
        onStatus: vi.fn(),
        connectivityEvents: harness.connectivityEvents,
        retry: retry.options,
      });

      await realtime.connect();
      harness.channels[0]!.emitStatus(terminalStatus);
      expect(retry.delays).toEqual([100]);
      retry.runNext();
      await vi.waitFor(() => expect(harness.channels).toHaveLength(2));

      expect(harness.client.removeChannel).toHaveBeenCalledWith(
        harness.channels[0],
      );
      await realtime.dispose();
    },
  );

  it("does not lose a terminal status emitted during initial subscription", async () => {
    const harness = createRecoveryHarness("CHANNEL_ERROR");
    const retry = createRetryHarness();
    const realtime = createRoomRealtime({
      client: harness.client,
      roomId: ROOM_ID,
      accessToken: "verified-access-token",
      participant: {
        participantId: USER_ID,
        displayName: "Sarah",
        role: "participant",
        color: "#7558cf",
        onlineAt: "2026-08-27T14:00:00.000Z",
      },
      getCurrentRevision: () => 3,
      onPresence: vi.fn(),
      onCursor: vi.fn(),
      onRevision: vi.fn(),
      onStatus: vi.fn(),
      connectivityEvents: harness.connectivityEvents,
      retry: retry.options,
    });

    await realtime.connect();
    await vi.waitFor(() => expect(retry.pendingCount()).toBe(1));
    retry.runNext();
    await vi.waitFor(() => expect(harness.channels).toHaveLength(2));
    await realtime.dispose();
  });

  it("retries a failed channel replacement without losing the failed channel", async () => {
    const harness = createRecoveryHarness();
    const retry = createRetryHarness();
    harness.client.removeChannel
      .mockRejectedValueOnce(new Error("remove failed"))
      .mockResolvedValue("ok");
    const realtime = createRoomRealtime({
      client: harness.client,
      roomId: ROOM_ID,
      accessToken: "verified-access-token",
      participant: {
        participantId: USER_ID,
        displayName: "Sarah",
        role: "participant",
        color: "#7558cf",
        onlineAt: "2026-08-27T14:00:00.000Z",
      },
      getCurrentRevision: () => 3,
      onPresence: vi.fn(),
      onCursor: vi.fn(),
      onRevision: vi.fn(),
      onStatus: vi.fn(),
      connectivityEvents: harness.connectivityEvents,
      retry: retry.options,
    });

    await realtime.connect();
    harness.channels[0]!.emitStatus("CHANNEL_ERROR");
    retry.runNext();
    await vi.waitFor(() => expect(retry.delays).toEqual([100, 200]));

    retry.runNext();
    await vi.waitFor(() => expect(harness.channels).toHaveLength(2));
    expect(harness.client.removeChannel).toHaveBeenCalledTimes(2);
    expect(harness.client.removeChannel).toHaveBeenNthCalledWith(
      2,
      harness.channels[0],
    );
    await realtime.dispose();
  });

  it("cancels delayed recovery and waits for in-flight replacement during disposal", async () => {
    const harness = createRecoveryHarness();
    const retry = createRetryHarness();
    const removal = deferred();
    const statuses: string[] = [];
    const realtime = createRoomRealtime({
      client: harness.client,
      roomId: ROOM_ID,
      accessToken: "verified-access-token",
      participant: {
        participantId: USER_ID,
        displayName: "Sarah",
        role: "participant",
        color: "#7558cf",
        onlineAt: "2026-08-27T14:00:00.000Z",
      },
      getCurrentRevision: () => 3,
      onPresence: vi.fn(),
      onCursor: vi.fn(),
      onRevision: vi.fn(),
      onStatus: (status) => statuses.push(status),
      connectivityEvents: harness.connectivityEvents,
      retry: retry.options,
    });

    await realtime.connect();
    harness.channels[0]!.emitStatus("CHANNEL_ERROR");
    expect(retry.pendingCount()).toBe(1);
    harness.connectivityEvents.dispatch("offline");
    expect(retry.pendingCount()).toBe(0);
    expect(retry.cancelled).toHaveLength(1);

    harness.client.removeChannel.mockReturnValueOnce(removal.promise);
    harness.connectivityEvents.dispatch("online");
    harness.connectivityEvents.dispatch("online");
    await vi.waitFor(() =>
      expect(harness.client.removeChannel).toHaveBeenCalledOnce(),
    );
    let disposalSettled = false;
    const disposal = realtime.dispose().then(() => {
      disposalSettled = true;
    });
    await Promise.resolve();
    expect(disposalSettled).toBe(false);
    const statusCountAtDisposal = statuses.length;

    removal.resolve("ok");
    await disposal;
    expect(disposalSettled).toBe(true);
    expect(statuses).toHaveLength(statusCountAtDisposal);
    expect(harness.channels).toHaveLength(1);
  });
});
