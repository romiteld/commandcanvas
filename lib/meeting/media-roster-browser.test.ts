import { describe, expect, it, vi } from "vitest";

import { requestAuthoritativeMeetingRoster } from "@/lib/meeting/media-roster-browser";

const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const ACTOR_ID = "22222222-2222-4222-8222-222222222222";

describe("authoritative meeting roster browser client", () => {
  it("loads a bounded server-verified member id set with bearer auth", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({ ok: true, status: "eligible", participantIds: [ACTOR_ID] }),
    );

    await expect(
      requestAuthoritativeMeetingRoster({
        roomId: ROOM_ID,
        accessToken: "header.payload.signature",
        fetch: fetcher,
      }),
    ).resolves.toEqual({
      status: "eligible",
      participantIds: new Set([ACTOR_ID]),
    });
    expect(fetcher).toHaveBeenCalledWith(
      `/api/rooms/${ROOM_ID}/media/roster`,
      expect.objectContaining({
        method: "GET",
        cache: "no-store",
        headers: { authorization: "Bearer header.payload.signature" },
      }),
    );
  });

  it("returns an over-capacity decision without accepting or exposing member ids", async () => {
    await expect(
      requestAuthoritativeMeetingRoster({
        roomId: ROOM_ID,
        accessToken: "header.payload.signature",
        fetch: vi.fn(async () =>
          Response.json({ ok: true, status: "over_capacity" }),
        ),
      }),
    ).resolves.toEqual({ status: "over_capacity" });

    await expect(
      requestAuthoritativeMeetingRoster({
        roomId: ROOM_ID,
        accessToken: "header.payload.signature",
        fetch: vi.fn(async () =>
          Response.json({
            ok: true,
            status: "over_capacity",
            participantIds: [ACTOR_ID],
          }),
        ),
      }),
    ).resolves.toEqual({ status: "unavailable" });
  });

  it("fails closed to unavailable for missing auth, refusal, or malformed ids", async () => {
    await expect(
      requestAuthoritativeMeetingRoster({ roomId: ROOM_ID, accessToken: null }),
    ).resolves.toEqual({ status: "unavailable" });
    await expect(
      requestAuthoritativeMeetingRoster({
        roomId: ROOM_ID,
        accessToken: "header.payload.signature",
        fetch: vi.fn(async () => new Response("no", { status: 403 })),
      }),
    ).resolves.toEqual({ status: "unavailable" });
    await expect(
      requestAuthoritativeMeetingRoster({
        roomId: ROOM_ID,
        accessToken: "header.payload.signature",
        fetch: vi.fn(async () =>
          Response.json({
            ok: true,
            status: "eligible",
            participantIds: ["forged"],
          }),
        ),
      }),
    ).resolves.toEqual({ status: "unavailable" });
  });
});
