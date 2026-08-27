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
  now?: () => number;
}

export interface RoomRealtimeController {
  connect: () => Promise<void>;
  publishCursor: (point: { x: number; y: number }) => Promise<boolean>;
  dispose: () => Promise<void>;
}

const roomIdSchema = z.string().uuid();

export function createRoomRealtime(
  rawOptions: RoomRealtimeOptions,
): RoomRealtimeController {
  const roomId = roomIdSchema.parse(rawOptions.roomId);
  const participant = presenceParticipantSchema.parse(rawOptions.participant);
  const now = rawOptions.now ?? Date.now;
  let channel: RoomChannel | null = null;
  let disposed = false;
  let cursorSequence = 0;
  let lastCursorSentAt: number | null = null;
  let remoteCursors: RemoteCursorState = {};

  async function connect() {
    if (disposed || channel) return;
    rawOptions.onStatus("connecting");
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

    nextChannel
      .on("presence", { event: "sync" }, () => {
        if (!disposed)
          rawOptions.onPresence(parsePresenceState(nextChannel.presenceState()));
      })
      .on("broadcast", { event: "cursor" }, (message) => {
        if (disposed) return;
        const payload = extractPayload(message);
        const parsed = cursorMessageSchema.safeParse(payload);
        if (!parsed.success) return;
        const next = applyCursorMessage(remoteCursors, parsed.data);
        if (next === remoteCursors) return;
        remoteCursors = next;
        rawOptions.onCursor(parsed.data);
      })
      .on("broadcast", { event: "revision" }, (message) => {
        if (disposed) return;
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
        if (disposed) return;
        if (status === "SUBSCRIBED") {
          void nextChannel
            .track(participant)
            .then(() => rawOptions.onStatus("connected"))
            .catch(() => rawOptions.onStatus("channel_error"));
        } else if (status === "CHANNEL_ERROR") {
          rawOptions.onStatus("channel_error");
        } else if (status === "TIMED_OUT") {
          rawOptions.onStatus("timed_out");
        } else if (status === "CLOSED") {
          rawOptions.onStatus("closed");
        }
      });
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
    if (disposed) return;
    disposed = true;
    const activeChannel = channel;
    channel = null;
    if (!activeChannel) return;
    await activeChannel.untrack().catch(() => undefined);
    await rawOptions.client.removeChannel(activeChannel);
  }

  return { connect, publishCursor, dispose };
}

function extractPayload(message: unknown) {
  if (!message || typeof message !== "object" || Array.isArray(message))
    return undefined;
  return (message as { payload?: unknown }).payload;
}
