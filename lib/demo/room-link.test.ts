import { describe, expect, it } from "vitest";

import {
  createDemoInviteUrl,
  parseDemoJoinLink,
  readStoredDemoRoom,
  storeDemoRoom,
} from "@/lib/demo/room-link";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  };
}

describe("demo room links", () => {
  it("creates and parses one capability-bearing invite URL", () => {
    const token = "v".repeat(43);
    const url = createDemoInviteUrl(
      "https://commandcanvas.example",
      "room-0123456789abcdef0123456789abcdef",
      token,
    );

    expect(url).toBe(
      `https://commandcanvas.example/demo?room=room-0123456789abcdef0123456789abcdef&join=${token}`,
    );
    expect(parseDemoJoinLink(new URL(url).searchParams)).toEqual({
      slug: "room-0123456789abcdef0123456789abcdef",
      joinToken: token,
    });
  });

  it("rejects partial or malformed join parameters", () => {
    expect(parseDemoJoinLink(new URLSearchParams("room=room-validlooking"))).toBeNull();
    expect(parseDemoJoinLink(new URLSearchParams("join=abc"))).toBeNull();
    expect(
      parseDemoJoinLink(
        new URLSearchParams({
          room: "room-0123456789abcdef0123456789abcdef",
          join: "not valid because spaces".repeat(3),
        }),
      ),
    ).toBeNull();
  });

  it("stores only a validated per-tab room descriptor", () => {
    const storage = memoryStorage();
    const descriptor = {
      roomId: "d32af6a9-31dd-4dfc-98d5-fcf439b9b106",
      slug: "room-0123456789abcdef0123456789abcdef",
      role: "host" as const,
      displayName: "Daniel",
      color: "#f26a5b",
      joinToken: "z".repeat(43),
    };

    expect(storeDemoRoom(storage, descriptor)).toBe(true);
    expect(readStoredDemoRoom(storage)).toEqual(descriptor);

    storage.setItem("commandcanvas.demo.room.v1", "{not json");
    expect(readStoredDemoRoom(storage)).toBeNull();
  });

  it("does not allow a participant descriptor to retain the host join token", () => {
    const storage = memoryStorage();
    expect(
      storeDemoRoom(storage, {
        roomId: "d32af6a9-31dd-4dfc-98d5-fcf439b9b106",
        slug: "room-0123456789abcdef0123456789abcdef",
        role: "participant",
        displayName: "Sarah",
        color: "#38bdf8",
        joinToken: "z".repeat(43),
      }),
    ).toBe(false);
    expect(readStoredDemoRoom(storage)).toBeNull();
  });
});
