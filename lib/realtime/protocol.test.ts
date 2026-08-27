import { describe, expect, it } from "vitest";

import {
  applyCursorMessage,
  cursorMessageSchema,
  parsePresenceState,
  revisionMessageSchema,
  shouldBroadcastCursor,
  type RemoteCursorState,
} from "@/lib/realtime/protocol";

describe("realtime cursor protocol", () => {
  it("accepts compact world-coordinate cursor messages without durable authority fields", () => {
    const result = cursorMessageSchema.safeParse({
      participantId: "participant-sarah",
      seq: 14,
      x: 482.5,
      y: -91.25,
      sentAt: 1787823600000,
    });

    expect(result.success).toBe(true);
    expect(
      cursorMessageSchema.safeParse({
        participantId: "participant-sarah",
        seq: 15,
        x: 100,
        y: 100,
        sentAt: 1787823600034,
        role: "host",
        displayName: "Forged host",
      }).success,
    ).toBe(false);
  });

  it("drops stale and duplicate cursor sequences", () => {
    const initial: RemoteCursorState = {};
    const first = applyCursorMessage(initial, {
      participantId: "participant-sarah",
      seq: 7,
      x: 120,
      y: 240,
      sentAt: 1787823600000,
    });
    const stale = applyCursorMessage(first, {
      participantId: "participant-sarah",
      seq: 6,
      x: 999,
      y: 999,
      sentAt: 1787823600040,
    });
    const duplicate = applyCursorMessage(first, {
      participantId: "participant-sarah",
      seq: 7,
      x: 800,
      y: 800,
      sentAt: 1787823600080,
    });

    expect(first["participant-sarah"]).toMatchObject({ seq: 7, x: 120, y: 240 });
    expect(stale).toBe(first);
    expect(duplicate).toBe(first);
  });

  it("limits cursor Broadcast traffic to at most 30 updates per second", () => {
    expect(shouldBroadcastCursor(null, 1_000)).toBe(true);
    expect(shouldBroadcastCursor(1_000, 1_032)).toBe(false);
    expect(shouldBroadcastCursor(1_000, 1_034)).toBe(true);
  });
});

describe("realtime presence protocol", () => {
  it("accepts only compact participant display state and flattens Supabase presence entries", () => {
    expect(
      parsePresenceState({
        "8ddf3cce-8e92-4b04-bbde-765061563d3e": [
          {
            presence_ref: "connection-1",
            participantId: "8ddf3cce-8e92-4b04-bbde-765061563d3e",
            displayName: "Sarah",
            role: "participant",
            color: "#7558cf",
            onlineAt: "2026-08-27T14:00:00.000Z",
          },
        ],
      }),
    ).toEqual([
      {
        participantId: "8ddf3cce-8e92-4b04-bbde-765061563d3e",
        displayName: "Sarah",
        role: "participant",
        color: "#7558cf",
        onlineAt: "2026-08-27T14:00:00.000Z",
      },
    ]);
  });

  it("drops malformed or forged extra presence fields and deduplicates multiple tabs", () => {
    expect(
      parsePresenceState({
        "8ddf3cce-8e92-4b04-bbde-765061563d3e": [
          {
            participantId: "8ddf3cce-8e92-4b04-bbde-765061563d3e",
            displayName: "Sarah",
            role: "participant",
            color: "#7558cf",
            onlineAt: "2026-08-27T14:00:00.000Z",
          },
          {
            participantId: "8ddf3cce-8e92-4b04-bbde-765061563d3e",
            displayName: "Sarah other tab",
            role: "participant",
            color: "#7558cf",
            onlineAt: "2026-08-27T14:01:00.000Z",
          },
        ],
        forged: [
          {
            participantId: "forged",
            displayName: "Forged",
            role: "host",
            color: "#000000",
            onlineAt: "2026-08-27T14:02:00.000Z",
            canSendEmail: true,
          },
        ],
      }),
    ).toEqual([
      {
        participantId: "8ddf3cce-8e92-4b04-bbde-765061563d3e",
        displayName: "Sarah other tab",
        role: "participant",
        color: "#7558cf",
        onlineAt: "2026-08-27T14:01:00.000Z",
      },
    ]);
  });

  it("accepts only compact committed-revision signals", () => {
    expect(
      revisionMessageSchema.safeParse({
        id: "62ecab1a-3d62-4e85-9926-dc0f1925e956",
        roomId: "19895c17-7365-4c03-a1cc-c15b85179ee4",
        revision: 12,
        receiptId: "ca11ab1e-a7ea-4ad6-a97f-449a38c119ee",
      }).success,
    ).toBe(true);
    expect(
      revisionMessageSchema.safeParse({
        id: "62ecab1a-3d62-4e85-9926-dc0f1925e956",
        roomId: "19895c17-7365-4c03-a1cc-c15b85179ee4",
        revision: 12,
        receiptId: "ca11ab1e-a7ea-4ad6-a97f-449a38c119ee",
        resultingState: { secret: true },
      }).success,
    ).toBe(false);
  });
});
