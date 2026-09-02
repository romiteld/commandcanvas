import { describe, expect, it, vi } from "vitest";

import { requestMeetingIceServers } from "@/lib/meeting/turn-browser";

const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const ACCESS_TOKEN = "header.payload.signature";
const REQUEST_ID = "33333333-3333-4333-8333-333333333333";

describe("meeting TURN browser client", () => {
  it("loads bounded short-lived TURN credentials for the current member", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        ok: true,
        expiresAt: "2026-08-29T10:50:00.000Z",
        iceServers: [
          { urls: ["stun:stun.l.google.com:19302"] },
          {
            urls: ["turn:turn.commandcanvas.example:3478?transport=udp"],
            username: "1788000600:11111111-1111-4111-8111-111111111111",
            credential: "ephemeral-credential",
          },
        ],
      }),
    );

    await expect(
      requestMeetingIceServers({
        roomId: ROOM_ID,
        accessToken: ACCESS_TOKEN,
        fetch: fetcher,
        createRequestId: () => REQUEST_ID,
      }),
    ).resolves.toEqual({
      mode: "turn",
      expiresAt: "2026-08-29T10:50:00.000Z",
      iceServers: [
        { urls: ["stun:stun.l.google.com:19302"] },
        {
          urls: ["turn:turn.commandcanvas.example:3478?transport=udp"],
          username: "1788000600:11111111-1111-4111-8111-111111111111",
          credential: "ephemeral-credential",
        },
      ],
    });
    expect(fetcher).toHaveBeenCalledWith(
      `/api/rooms/${ROOM_ID}/media/turn`,
      expect.objectContaining({
        method: "POST",
        cache: "no-store",
        headers: {
          authorization: `Bearer ${ACCESS_TOKEN}`,
          "idempotency-key": REQUEST_ID,
        },
      }),
    );
  });

  it("fails closed without making a request when a bounded idempotency key cannot be created", async () => {
    const fetcher = vi.fn();
    await expect(
      requestMeetingIceServers({
        roomId: ROOM_ID,
        accessToken: ACCESS_TOKEN,
        fetch: fetcher,
        createRequestId: () => "not-a-uuid",
      }),
    ).resolves.toEqual({
      mode: "direct",
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("falls back honestly to direct STUN for missing auth, provider refusal, or malformed success", async () => {
    const direct = {
      mode: "direct",
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    };
    await expect(
      requestMeetingIceServers({ roomId: ROOM_ID, accessToken: null }),
    ).resolves.toEqual(direct);
    await expect(
      requestMeetingIceServers({
        roomId: ROOM_ID,
        accessToken: ACCESS_TOKEN,
        fetch: vi.fn(async () => new Response("unavailable", { status: 503 })),
      }),
    ).resolves.toEqual(direct);
    await expect(
      requestMeetingIceServers({
        roomId: ROOM_ID,
        accessToken: ACCESS_TOKEN,
        fetch: vi.fn(async () => Response.json({ ok: true, iceServers: [] })),
      }),
    ).resolves.toEqual(direct);
  });
});
