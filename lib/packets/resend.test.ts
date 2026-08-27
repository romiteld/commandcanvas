// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
  submitResendPacketEmail,
  type ResendFetch,
} from "@/lib/packets/resend";

describe("Resend packet transport", () => {
  it("sends the exact approved snapshot with the durable database idempotency key", async () => {
    const fetcher = vi.fn<ResendFetch>().mockResolvedValue(
      new Response(JSON.stringify({ id: "email_accepted_123" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const contentSnapshot = {
      title: "Launch packet",
      content: {
        schemaVersion: 1 as const,
        roomName: "Launch room",
        sourceRevision: 8,
        objects: [],
      },
    };

    const result = await submitResendPacketEmail(
      {
        apiKey: "re_test_secret",
        from: "CommandCanvas <canvas@example.com>",
        recipients: [
          { name: "Danny", email: "danny@example.com" },
          { name: "Sarah", email: "sarah@example.com" },
        ],
        subject: "Launch packet",
        contentSnapshot,
        idempotencyKey: `commandcanvas:${"a".repeat(64)}`,
      },
      fetcher,
    );

    expect(result).toEqual({
      ok: true,
      providerMessageId: "email_accepted_123",
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init).toMatchObject({ method: "POST" });
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe("Bearer re_test_secret");
    expect(headers.get("idempotency-key")).toBe(
      `commandcanvas:${"a".repeat(64)}`,
    );
    expect(headers.get("content-type")).toBe("application/json");
    const body = JSON.parse(String(init?.body));
    expect(body).toMatchObject({
      from: "CommandCanvas <canvas@example.com>",
      to: [
        "Danny <danny@example.com>",
        "Sarah <sarah@example.com>",
      ],
      subject: "Launch packet",
    });
    expect(body.text).toContain("Launch room");
    expect(body.html).toContain("Launch packet");
  });

  it("returns a compact error without reflecting provider response content", async () => {
    const fetcher = vi
      .fn<ResendFetch>()
      .mockResolvedValue(
        new Response("provider secret diagnostic", { status: 422 }),
      );

    const result = await submitResendPacketEmail(
      {
        apiKey: "re_test_secret",
        from: "canvas@example.com",
        recipients: [{ name: "Danny", email: "danny@example.com" }],
        subject: "Launch packet",
        contentSnapshot: {
          title: "Launch packet",
          content: {
            schemaVersion: 1,
            roomName: "Launch room",
            sourceRevision: 8,
            objects: [],
          },
        },
        idempotencyKey: `commandcanvas:${"a".repeat(64)}`,
      },
      fetcher,
    );

    expect(result).toEqual({ ok: false, errorCode: "resend_rejected" });
    expect(JSON.stringify(result)).not.toContain("diagnostic");
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("escapes untrusted packet strings in HTML while preserving literal plain text", async () => {
    const fetcher = vi.fn<ResendFetch>().mockResolvedValue(
      new Response(JSON.stringify({ id: "email_accepted_456" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    await submitResendPacketEmail(
      {
        apiKey: "re_test_secret",
        from: "canvas@example.com",
        recipients: [{ name: "Danny", email: "danny@example.com" }],
        subject: '<img src=x onerror="alert(1)">',
        contentSnapshot: {
          title: '<img src=x onerror="alert(1)">',
          content: {
            schemaVersion: 1,
            roomName: "Launch room",
            sourceRevision: 8,
            objects: [
              {
                objectId: "note-launch",
                objectType: "note",
                title: "Untrusted note",
                payload: { note: "<script>alert('canvas')</script>" },
              },
            ],
          },
        },
        idempotencyKey: `commandcanvas:${"b".repeat(64)}`,
      },
      fetcher,
    );

    const [, init] = fetcher.mock.calls[0];
    const providerBody = JSON.parse(String(init?.body));
    expect(providerBody.html).not.toContain("<script>");
    expect(providerBody.html).not.toContain("<img");
    expect(providerBody.html).not.toContain('onerror="');
    expect(providerBody.html).toContain("&lt;script&gt;");
    expect(providerBody.html).toContain("&lt;img src=x onerror=&quot;");
    expect(providerBody.text).toContain("<script>alert('canvas')</script>");
  });
});
