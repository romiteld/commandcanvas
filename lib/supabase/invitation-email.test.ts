// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { deliverMeetingInvitation } from "@/lib/supabase/invitation-email";

const TOKEN = "a".repeat(43);
const input = {
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

  it("does not call Resend for a recipient outside the exact allowlist", async () => {
    const fetcher = vi.fn();
    const result = await deliverMeetingInvitation(
      input,
      {
        RESEND_API_KEY: "secret",
        RESEND_FROM: "CommandCanvas <invite@example.com>",
        COMMANDCANVAS_INVITE_EMAIL_ALLOWLIST: "danny@example.com",
      },
      fetcher,
    );

    expect(result.status).toBe("preview_only");
    expect(result.message).toContain("not allowlisted");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("claims submitted only after Resend accepts the request", async () => {
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
        COMMANDCANVAS_INVITE_EMAIL_ALLOWLIST: "sarah@example.com",
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
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse(fetcher.mock.calls[0]![1]!.body as string);
    expect(body.to).toEqual(["sarah@example.com"]);
    expect(body.html).toContain(
      `https://commandcanvas.example/meet#invite=${TOKEN}`,
    );
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
        COMMANDCANVAS_INVITE_EMAIL_ALLOWLIST: "sarah@example.com",
      },
      fetcher,
    );

    expect(result).toEqual({
      status: "failed",
      message: "Invite created, but its email preview could not be prepared.",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("reports provider rejection without claiming delivery or leaking provider details", async () => {
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) => {
        void _input;
        void _init;
        return new Response("upstream secret failure", { status: 500 });
      },
    );
    const result = await deliverMeetingInvitation(
      input,
      {
        RESEND_API_KEY: "secret",
        RESEND_FROM: "CommandCanvas <invite@example.com>",
        COMMANDCANVAS_INVITE_EMAIL_ALLOWLIST: "sarah@example.com",
      },
      fetcher,
    );
    expect(result).toEqual({
      status: "failed",
      message: "Invite created, but email delivery failed. Copy the link instead.",
    });
    expect(JSON.stringify(result)).not.toContain("upstream");
  });
});
