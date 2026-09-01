import { describe, expect, it } from "vitest";

import {
  loadBrowserCanvas,
  loadOwnRoomMembership,
  type BrowserRoomQueryResult,
} from "@/lib/supabase/browser-room";

const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const NOW = "2026-08-27T16:00:00.000Z";

const room = {
  id: ROOM_ID,
  slug: "commandcanvas-demo-room",
  name: "CommandCanvas demo",
  mode: "demo",
  revision: 0,
  created_by: USER_ID,
  created_at: NOW,
  updated_at: NOW,
  demo_hard_expires_at: "2026-08-28T16:00:00.000Z",
};

function fakeClient(responses: Record<string, BrowserRoomQueryResult[]>) {
  const calls: Array<{ table: string; operation: string }> = [];
  return {
    calls,
    client: {
      from(table: string) {
        const resolve = (operation: string) => {
          calls.push({ table, operation });
          const response = responses[table]?.shift();
          if (!response) throw new Error(`No response for ${table}`);
          return Promise.resolve(response);
        };
        const builder = {
          select: () => builder,
          eq: () => builder,
          order: () => builder,
          maybeSingle: () => resolve("maybeSingle"),
          then<TResult1 = BrowserRoomQueryResult, TResult2 = never>(
            onfulfilled?:
              | ((value: BrowserRoomQueryResult) => TResult1 | PromiseLike<TResult1>)
              | null,
            onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
          ) {
            return resolve("query").then(onfulfilled, onrejected);
          },
        };
        return builder;
      },
    },
  };
}

describe("browser room state loader", () => {
  it("accepts a stable RLS-visible room snapshot", async () => {
    const harness = fakeClient({
      rooms: [
        { data: room, error: null },
        { data: room, error: null },
      ],
      canvas_objects: [{ data: [], error: null }],
      receipts: [{ data: [], error: null }],
    });

    const result = await loadBrowserCanvas(harness.client, ROOM_ID);

    expect(result).toEqual({
      ok: true,
      hardExpiresAtEpochMs: Date.parse("2026-08-28T16:00:00.000Z"),
      state: {
        roomId: ROOM_ID,
        revision: 0,
        objects: {},
        receipts: [],
        undoneReceiptIds: [],
        redoReceiptIds: [],
      },
    });
    expect(harness.calls.filter((call) => call.table === "rooms")).toHaveLength(2);
  });

  it("derives the legacy 24-hour deadline when a demo predates the fixed-expiry column", async () => {
    const legacyRoom = { ...room, demo_hard_expires_at: null };
    const harness = fakeClient({
      rooms: [
        { data: legacyRoom, error: null },
        { data: legacyRoom, error: null },
      ],
      canvas_objects: [{ data: [], error: null }],
      receipts: [{ data: [], error: null }],
    });

    await expect(loadBrowserCanvas(harness.client, ROOM_ID)).resolves.toMatchObject({
      ok: true,
      hardExpiresAtEpochMs: Date.parse(NOW) + 24 * 60 * 60 * 1_000,
    });
  });

  it("retries once when a revision changes across the multi-query read", async () => {
    const revisionOne = { ...room, revision: 1, updated_at: NOW };
    const harness = fakeClient({
      rooms: [
        { data: room, error: null },
        { data: revisionOne, error: null },
        { data: revisionOne, error: null },
        { data: revisionOne, error: null },
      ],
      canvas_objects: [
        { data: [], error: null },
        { data: [], error: null },
      ],
      receipts: [
        { data: [], error: null },
        { data: [], error: null },
      ],
    });

    const result = await loadBrowserCanvas(harness.client, ROOM_ID);

    expect(result).toEqual({
      ok: true,
      hardExpiresAtEpochMs: Date.parse("2026-08-28T16:00:00.000Z"),
      state: expect.objectContaining({ roomId: ROOM_ID, revision: 1 }),
    });
    expect(harness.calls.filter((call) => call.table === "rooms")).toHaveLength(4);
  });

  it("returns a compact unavailable result for an RLS-hidden room", async () => {
    const harness = fakeClient({
      rooms: [{ data: null, error: null }],
    });

    expect(await loadBrowserCanvas(harness.client, ROOM_ID)).toEqual({
      ok: false,
      code: "room_unavailable",
      message: "Room is unavailable.",
    });
  });

  it("refuses malformed persisted rows without returning parser detail", async () => {
    const harness = fakeClient({
      rooms: [
        { data: room, error: null },
        { data: room, error: null },
      ],
      canvas_objects: [{ data: [{ id: "forged" }], error: null }],
      receipts: [{ data: [], error: null }],
    });

    expect(await loadBrowserCanvas(harness.client, ROOM_ID)).toEqual({
      ok: false,
      code: "invalid_persisted_state",
      message: "Canvas state could not be verified.",
    });
  });
});

describe("browser membership loader", () => {
  it("returns only the caller's strict self-visible membership", async () => {
    const harness = fakeClient({
      room_members: [
        {
          data: {
            room_id: ROOM_ID,
            user_id: USER_ID,
            role: "host",
            display_name: "Danny",
            color: "#275ED7",
            joined_at: NOW,
          },
          error: null,
        },
      ],
    });

    expect(
      await loadOwnRoomMembership(harness.client, ROOM_ID, USER_ID),
    ).toEqual({
      ok: true,
      membership: {
        roomId: ROOM_ID,
        userId: USER_ID,
        role: "host",
        displayName: "Danny",
        color: "#275ED7",
        joinedAt: NOW,
      },
    });
  });

  it("does not admit another user's row even if a client is misconfigured", async () => {
    const harness = fakeClient({
      room_members: [
        {
          data: {
            room_id: ROOM_ID,
            user_id: "33333333-3333-4333-8333-333333333333",
            role: "host",
            display_name: "Forged",
            color: "#000000",
            joined_at: NOW,
          },
          error: null,
        },
      ],
    });

    expect(
      await loadOwnRoomMembership(harness.client, ROOM_ID, USER_ID),
    ).toEqual({
      ok: false,
      code: "membership_unavailable",
      message: "Room membership is unavailable.",
    });
  });
});
