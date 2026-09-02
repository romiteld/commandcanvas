import { describe, expect, it } from "vitest";

import {
  commandRequestSchema,
  createRoomRequestSchema,
  joinRoomRequestSchema,
} from "@/lib/supabase/room-contracts";

describe("room API contracts", () => {
  it("normalizes no-signup host input without accepting an actor ID", () => {
    expect(
      createRoomRequestSchema.parse({
        mode: "demo",
        name: "  Launch room  ",
        displayName: "  Danny  ",
        color: "#275ed7",
      }),
    ).toEqual({
      mode: "demo",
      name: "Launch room",
      displayName: "Danny",
      color: "#275ed7",
    });
    expect(
      createRoomRequestSchema.safeParse({
        mode: "demo",
        name: "Launch room",
        displayName: "Danny",
        color: "#275ed7",
        actorUserId: "spoofed",
      }).success,
    ).toBe(false);
  });

  it("reserves the legacy room creation contract for no-signup demo rooms", () => {
    expect(
      createRoomRequestSchema.safeParse({
        mode: "standard",
        name: "Standard meeting",
        displayName: "Danny",
        color: "#275ed7",
      }).success,
    ).toBe(false);
  });

  it("requires a bounded high-entropy join capability", () => {
    const input = {
      slug: "launch-room-4k29x",
      joinToken: `test-join-token-${"a".repeat(27)}`,
      displayName: "Sarah",
      color: "#7558cf",
    };
    expect(joinRoomRequestSchema.parse(input)).toEqual(input);
    expect(
      joinRoomRequestSchema.safeParse({ ...input, joinToken: "guessable" })
        .success,
    ).toBe(false);
    expect(
      joinRoomRequestSchema.safeParse({ ...input, role: "host" }).success,
    ).toBe(false);
  });

  it("accepts canonical commands and refuses client-supplied actor authority", () => {
    const input = {
      commandId: "ca11ab1e-a7ea-4ad6-a97f-449a38c119ee",
      roomId: "19895c17-7365-4c03-a1cc-c15b85179ee4",
      baseRevision: 3,
      source: "webmcp",
      command: {
        type: "object.transform",
        objectId: "note-1",
        transform: { x: 240, y: 180 },
      },
    };
    expect(commandRequestSchema.parse(input)).toEqual(input);
    expect(
      commandRequestSchema.safeParse({
        ...input,
        actorUserId: "spoofed-user",
        actorType: "agent",
      }).success,
    ).toBe(false);
  });
});
