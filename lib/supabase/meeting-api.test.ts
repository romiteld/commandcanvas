import { describe, expect, it, vi } from "vitest";

import { createBrowserMeetingApi } from "@/lib/supabase/meeting-api";

const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJob3N0In0.signature";
const ROOM_ID = "11111111-1111-4111-8111-111111111111";

describe("browser meeting API", () => {
  it("authenticates and validates standard meeting responses", async () => {
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
          ok: true,
          meeting: { roomId: ROOM_ID, role: "host", joined: true },
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      ),
    );
    const api = createBrowserMeetingApi({ accessToken: JWT, fetcher });

    const result = await api.createMeeting({
      name: "Product review",
      displayName: "Danny",
      color: "#0ea5e9",
    });

    expect(result.ok).toBe(true);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/meetings",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ authorization: `Bearer ${JWT}` }),
      }),
    );
  });

  it("retains one invitation request UUID across a lost response retry", async () => {
    const invitation = {
      invitationId: "33333333-3333-4333-8333-333333333333",
      roomId: ROOM_ID,
      expiresAt: "2026-08-30T12:00:00.000Z",
      joinUrl: `https://commandcanvas.example/meet#invite=${"a".repeat(43)}`,
      delivery: {
        status: "reconciling",
        message: "Invitation submission is being reconciled; copy the link if needed.",
      },
    };
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("lost response"))
      .mockResolvedValueOnce(Response.json({ ok: true, invitation }))
      .mockResolvedValueOnce(
        Response.json({
          ok: true,
          invitation: {
            ...invitation,
            delivery: {
              status: "submitted",
              message: "Invitation was submitted to the email provider; delivery is pending.",
              providerId: "email_accepted_123",
            },
          },
        }),
      );
    const createRequestId = vi
      .fn()
      .mockReturnValueOnce("44444444-4444-4444-8444-444444444444")
      .mockReturnValueOnce("55555555-5555-4555-8555-555555555555");
    const api = createBrowserMeetingApi({
      accessToken: JWT,
      fetcher,
      createRequestId,
    });
    const input = {
      email: "Sarah@Example.com",
      displayName: "Sarah",
      color: "#a855f7",
      expiresInHours: 24,
    };
    await expect(api.createInvitation(ROOM_ID, input)).resolves.toMatchObject({
      ok: false,
      error: { code: "request_failed" },
    });
    await expect(api.createInvitation(ROOM_ID, input)).resolves.toEqual({
      ok: true,
      value: invitation,
    });
    await expect(api.createInvitation(ROOM_ID, input)).resolves.toMatchObject({
      ok: true,
      value: { delivery: { status: "submitted" } },
    });
    const first = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    const second = JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body));
    const third = JSON.parse(String(fetcher.mock.calls[2]?.[1]?.body));
    expect(first.requestId).toBe("44444444-4444-4444-8444-444444444444");
    expect(second.requestId).toBe(first.requestId);
    expect(third.requestId).toBe(first.requestId);
    expect(createRequestId).toHaveBeenCalledOnce();
  });

  it("does not trust malformed success envelopes", async () => {
    const api = createBrowserMeetingApi({
      accessToken: JWT,
      fetcher: vi.fn(async () =>
        new Response(JSON.stringify({ ok: true, meeting: { role: "host" } }), {
          status: 201,
        }),
      ),
    });
    expect(
      await api.createMeeting({
        name: "Product review",
        displayName: "Danny",
        color: "#0ea5e9",
      }),
    ).toMatchObject({ ok: false, error: { code: "invalid_response" } });
  });
});
