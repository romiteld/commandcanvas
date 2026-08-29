import { describe, expect, it } from "vitest";

import {
  cancelPacketSendRequestSchema,
  packetContentSchema,
  preparePacketRequestSchema,
  updatePacketRequestSchema,
} from "@/lib/packets/contracts";

const ROOM_ID = "11111111-1111-4111-8111-111111111111";

describe("meeting packet request contracts", () => {
  it("accepts the complete packet-safe semantic object vocabulary", () => {
    const result = packetContentSchema.safeParse({
      schemaVersion: 1,
      roomName: "Launch meeting",
      sourceRevision: 12,
      objects: [
        {
          objectId: "table-metrics",
          objectType: "data_table",
          title: "Launch metrics",
          payload: { columns: [], rows: [] },
        },
        {
          objectId: "reference-research",
          objectType: "reference_card",
          title: "Research",
          payload: { kind: "article" },
        },
        {
          objectId: "meeting-decision",
          objectType: "meeting_card",
          title: "Decision",
          payload: { kind: "decision" },
        },
      ],
    });

    expect(result.success).toBe(true);
  });

  it.each(["sketch", "frame"])(
    "continues to omit the working-only %s type from final packet snapshots",
    (objectType) => {
      expect(
        packetContentSchema.safeParse({
          schemaVersion: 1,
          roomName: "Launch meeting",
          sourceRevision: 12,
          objects: [
            {
              objectId: "working-object",
              objectType,
              title: "Working object",
              payload: {},
            },
          ],
        }).success,
      ).toBe(false);
    },
  );

  it("rejects duplicate selected object IDs before packet preparation", () => {
    const result = preparePacketRequestSchema.safeParse({
      roomId: ROOM_ID,
      packetId: "packet-launch",
      actorType: "agent",
      selectedObjectIds: ["note-launch", "note-launch"],
    });

    expect(result.success).toBe(false);
  });

  it("rejects control characters in recipient display names and packet titles", () => {
    const recipientInjection = updatePacketRequestSchema.safeParse({
      roomId: ROOM_ID,
      packetId: "packet-launch",
      title: "Launch packet",
      recipients: [
        {
          name: "Danny\r\nBcc: attacker@example.com",
          email: "danny@example.com",
        },
      ],
    });
    const titleInjection = preparePacketRequestSchema.safeParse({
      roomId: ROOM_ID,
      packetId: "packet-launch",
      actorType: "agent",
      title: "Launch packet\r\nBcc: attacker@example.com",
    });

    expect(recipientInjection.success).toBe(false);
    expect(titleInjection.success).toBe(false);
  });

  it("rejects angle brackets in recipient display names", () => {
    const result = updatePacketRequestSchema.safeParse({
      roomId: ROOM_ID,
      packetId: "packet-launch",
      title: "Launch packet",
      recipients: [
        {
          name: "Danny <attacker@example.com>",
          email: "danny@example.com",
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it("requires an explicit host cancellation acknowledgement", () => {
    const accepted = cancelPacketSendRequestSchema.safeParse({
      roomId: ROOM_ID,
      sendRequestId: "22222222-2222-4222-8222-222222222222",
      explicitHostCancellation: true,
    });
    const rejected = cancelPacketSendRequestSchema.safeParse({
      roomId: ROOM_ID,
      sendRequestId: "22222222-2222-4222-8222-222222222222",
      explicitHostCancellation: false,
    });

    expect(accepted.success).toBe(true);
    expect(rejected.success).toBe(false);
  });
});
