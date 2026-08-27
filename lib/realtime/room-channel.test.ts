import { describe, expect, it, vi } from "vitest";

import { createRoomRealtime } from "@/lib/realtime/room-channel";

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

describe("room realtime channel", () => {
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
        seq: 2,
        x: 50,
        y: 60,
        sentAt: 1_034,
      },
    });

    await realtime.dispose();
    expect(harness.channel.untrack).toHaveBeenCalledOnce();
    expect(harness.client.removeChannel).toHaveBeenCalledWith(harness.channel);
  });
});
