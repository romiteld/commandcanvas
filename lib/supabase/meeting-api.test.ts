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
