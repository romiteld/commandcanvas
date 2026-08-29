// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { deliverMeetingInvitation } from "@/lib/supabase/invitation-email";

const TOKEN = "a".repeat(43);
const input = {
  idempotencyKey:
    "commandcanvas:invite:33333333-3333-4333-8333-333333333333",
  recipientEmail: "sarah@example.com",
  recipientName: "Sarah",
  roomName: "Product review",
  joinUrl: `https://commandcanvas.example/meet#invite=${TOKEN}`,
  expiresAt: "2026-08-29T12:00:00.000Z",
};

describe("meeting invitation delivery", () => {
  it("returns an honest preview without calling a provider when configuration is absent", async () => {
    const fetcher = vi.fn();
    const result = await deliverMeetingInvitation(input, {}, fetcher);

    expect(result).toEqual({
      status: "preview_only",
      message: "Invite created. Email delivery is not configured; copy the link instead.",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("sends a standard-room invitation directly with its stable provider key", async () => {
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => {
        void _input;
        void _init;
        return new Response(JSON.stringify({ id: "email_123" }), {
          status: 200,
        });
      },
    );
    const result = await deliverMeetingInvitation(
      input,
      {
        RESEND_API_KEY: "secret",
        RESEND_FROM: "CommandCanvas <invite@example.com>",
      },
      fetcher,
    );

    expect(result).toEqual({
      status: "submitted",
      message: "Invitation accepted by the email provider.",
      providerId: "email_123",
    });
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "idempotency-key": input.idempotencyKey,
        }),
      }),
    );
    const body = JSON.parse(fetcher.mock.calls[0]![1]!.body as string);
    expect(body.to).toEqual(["sarah@example.com"]);
    expect(body.html).toContain(
      `https://commandcanvas.example/meet#invite=${TOKEN}`,
    );
    expect(body.subject).toBe("Join Product review in CommandCanvas");
  });

  it("refuses a query-string invitation capability before provider work", async () => {
    const fetcher = vi.fn();
    const result = await deliverMeetingInvitation(
      {
        ...input,
        joinUrl: `https://commandcanvas.example/meet?invite=${TOKEN}`,
      },
      {
        RESEND_API_KEY: "secret",
        RESEND_FROM: "CommandCanvas <invite@example.com>",
      },
      fetcher,
    );

    expect(result).toEqual({
      status: "failed",
      message: "Invite created, but its email preview could not be prepared.",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("refuses a room-title header injection before provider work", async () => {
    const fetcher = vi.fn();
    const result = await deliverMeetingInvitation(
      { ...input, roomName: "Product review\r\nBcc: attacker@example.com" },
      {
        RESEND_API_KEY: "secret",
        RESEND_FROM: "CommandCanvas <invite@example.com>",
      },
      fetcher,
    );

    expect(result.status).toBe("failed");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([429, 500, 503])(
    "records HTTP %s as ambiguous instead of claiming deterministic failure",
    async (status) => {
      const fetcher = vi.fn(async () =>
        new Response("provider secret diagnostic", { status }),
      );
      const result = await deliverMeetingInvitation(
        input,
        {
          RESEND_API_KEY: "secret",
          RESEND_FROM: "CommandCanvas <invite@example.com>",
        },
        fetcher,
      );
      expect(result).toEqual({
        status: "reconciling",
        message:
          "Invitation submission is being reconciled; copy the link if needed.",
        errorCode: "resend_ambiguous",
      });
      expect(JSON.stringify(result)).not.toContain("diagnostic");
    },
  );

  it("records a network exception as ambiguous because provider acceptance is unknown", async () => {
    const result = await deliverMeetingInvitation(
      input,
      {
        RESEND_API_KEY: "secret",
        RESEND_FROM: "CommandCanvas <invite@example.com>",
      },
      vi.fn(async () => {
        throw new Error("lost response after acceptance");
      }),
    );
    expect(result.status).toBe("reconciling");
  });

  it("reports deterministic provider rejection without leaking provider details", async () => {
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => {
        void _input;
        void _init;
        return new Response("upstream secret failure", { status: 422 });
      },
    );
    const result = await deliverMeetingInvitation(
      input,
      {
        RESEND_API_KEY: "secret",
        RESEND_FROM: "CommandCanvas <invite@example.com>",
      },
      fetcher,
    );
    expect(result).toEqual({
      status: "failed",
      message: "Invite created, but email delivery failed. Copy the link instead.",
    });
    expect(JSON.stringify(result)).not.toContain("upstream");
  });

  it("escapes the real room title and participant name in rendered HTML", async () => {
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => {
        void _input;
        void _init;
        return Response.json({ id: "email_escaped_1" });
      },
    );
    await deliverMeetingInvitation(
      {
        ...input,
        recipientName: "Sarah <script>",
        roomName: "Launch <img src=x>",
      },
      {
        RESEND_API_KEY: "secret",
        RESEND_FROM: "CommandCanvas <invite@example.com>",
      },
      fetcher,
    );
    const body = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    expect(body.html).toContain("Launch &lt;img src=x&gt;");
    expect(body.html).not.toContain("<script>");
  });
});
