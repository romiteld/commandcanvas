import { describe, expect, it } from "vitest";

import * as mediaProtocol from "@/lib/meeting/media-protocol";

const { meetingMediaSignalSchema } = mediaProtocol;

const participantA = "11111111-1111-4111-8111-111111111111";
const participantB = "22222222-2222-4222-8222-222222222222";

describe("meeting media signaling protocol", () => {
  it("derives the only sender-bound topic accepted by Realtime RLS", () => {
    const meetingMediaTopic = (
      mediaProtocol as typeof mediaProtocol & {
        meetingMediaTopic?: (roomId: string, participantId: string) => string;
      }
    ).meetingMediaTopic;

    expect(meetingMediaTopic).toBeTypeOf("function");
    expect(meetingMediaTopic?.("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", participantA))
      .toBe(
        "room-media:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa:" + participantA,
      );
    expect(() => meetingMediaTopic?.("not-a-room", participantA)).toThrow();
  });

  it("accepts targeted ready, SDP, ICE, and leave messages", () => {
    expect(
      meetingMediaSignalSchema.parse({
        version: 1,
        kind: "ready",
        senderId: participantA,
      }),
    ).toMatchObject({ kind: "ready", senderId: participantA });

    expect(
      meetingMediaSignalSchema.parse({
        version: 1,
        kind: "description",
        senderId: participantA,
        targetId: participantB,
        description: { type: "offer", sdp: "v=0\r\n" },
      }),
    ).toMatchObject({ description: { type: "offer" } });

    expect(
      meetingMediaSignalSchema.parse({
        version: 1,
        kind: "ice",
        senderId: participantB,
        targetId: participantA,
        candidate: {
          candidate: "candidate:1 1 UDP 1 127.0.0.1 9999 typ host",
          sdpMid: "0",
          sdpMLineIndex: 0,
        },
      }),
    ).toMatchObject({ kind: "ice", targetId: participantA });

    expect(
      meetingMediaSignalSchema.parse({
        version: 1,
        kind: "left",
        senderId: participantB,
      }),
    ).toMatchObject({ kind: "left", senderId: participantB });
  });

  it("rejects broadcast SDP, forged extra fields, and oversized candidates", () => {
    expect(
      meetingMediaSignalSchema.safeParse({
        version: 1,
        kind: "description",
        senderId: participantA,
        description: { type: "offer", sdp: "v=0" },
      }).success,
    ).toBe(false);

    expect(
      meetingMediaSignalSchema.safeParse({
        version: 1,
        kind: "ready",
        senderId: participantA,
        accessToken: "must-not-travel-over-broadcast",
      }).success,
    ).toBe(false);

    expect(
      meetingMediaSignalSchema.safeParse({
        version: 1,
        kind: "ice",
        senderId: participantA,
        targetId: participantB,
        candidate: { candidate: "x".repeat(4_097) },
      }).success,
    ).toBe(false);
  });
});
