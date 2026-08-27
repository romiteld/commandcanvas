// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { createBrowserPacketApi } from "@/lib/packets/browser-api";

const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJob3N0In0.signature";
const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const SEND_ID = "22222222-2222-4222-8222-222222222222";
const RECEIPT_ID = "33333333-3333-4333-8333-333333333333";
const recipients = [{ name: "Danny", email: "danny@example.com" }];
const contentSnapshot = {
  title: "Launch meeting packet",
  content: {
    schemaVersion: 1,
    roomName: "Launch room",
    sourceRevision: 9,
    objects: [
      {
        objectId: "note-launch",
        objectType: "note",
        title: "Launch decision",
        payload: { text: "Ship the verified path." },
      },
    ],
  },
};

describe("browser meeting packet API", () => {
  it("loads the strict compact persisted workflow through an authenticated GET", async () => {
    const signal = new AbortController().signal;
    const workflow = {
      packet: {
        packetId: "packet-launch",
        packetVersion: 2,
        sourceRevision: 9,
        status: "approved",
        title: contentSnapshot.title,
        contentSnapshot,
        recipients,
        approvedSnapshot: {
          packetVersion: 2,
          contentHash: "a".repeat(64),
          recipientHash: "b".repeat(64),
          contentSnapshot,
          recipients,
        },
      },
      latestSend: {
        sendRequestId: SEND_ID,
        packetId: "packet-launch",
        packetVersion: 2,
        contentHash: "a".repeat(64),
        recipientHash: "b".repeat(64),
        recipients,
        status: "cancelled",
      },
      activity: [
        {
          receiptId: RECEIPT_ID,
          revision: 4,
          occurredAt: "2026-08-27T16:04:00.000Z",
          actorType: "human",
          actorDisplayName: "Danny",
          action: "packet_send_cancelled",
          packetId: "packet-launch",
          sendRequestId: SEND_ID,
          description: "Danny cancelled the staged packet send.",
        },
      ],
    };
    const fetcher = vi.fn(async () =>
      Response.json({ ok: true, workflow }),
    );
    const api = createBrowserPacketApi({ accessToken: JWT, fetcher });

    await expect(api.loadLatest(ROOM_ID, signal)).resolves.toEqual({
      ok: true,
      value: workflow,
    });
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(
      `/api/rooms/${ROOM_ID}/packets/latest`,
      {
        method: "GET",
        headers: { authorization: `Bearer ${JWT}` },
        cache: "no-store",
        signal,
      },
    );
  });

  it("rejects a readback response that leaks unapproved send fields", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        ok: true,
        workflow: {
          packet: null,
          latestSend: {
            sendRequestId: SEND_ID,
            packetId: "packet-launch",
            packetVersion: 2,
            contentHash: "a".repeat(64),
            recipientHash: "b".repeat(64),
            recipients,
            status: "cancelled",
            idempotencyKey: "must-not-cross-the-browser-boundary",
          },
          activity: [],
        },
      }),
    );
    const api = createBrowserPacketApi({ accessToken: JWT, fetcher });

    await expect(api.loadLatest(ROOM_ID)).resolves.toEqual({
      ok: false,
      error: {
        code: "invalid_response",
        message: "Meeting packet service returned an invalid response.",
        status: 200,
      },
    });
  });

  it("prepares a packet through the authenticated no-store boundary", async () => {
    const signal = new AbortController().signal;
    const input = {
      roomId: ROOM_ID,
      packetId: "packet-launch",
      actorType: "agent" as const,
      title: "Launch meeting packet",
      selectedObjectIds: ["note-launch", "diagram-system"],
    };
    const fetcher = vi.fn(async () =>
      Response.json(
        {
          ok: true,
          packet: {
            packetId: "packet-launch",
            packetVersion: 2,
            sourceRevision: 9,
            status: "draft",
            title: "Launch meeting packet",
            objectCount: 2,
            contentSnapshot,
          },
        },
        { status: 201 },
      ),
    );
    const api = createBrowserPacketApi({ accessToken: JWT, fetcher });

    await expect(api.prepare(input, signal)).resolves.toEqual({
      ok: true,
      value: {
        packetId: "packet-launch",
        packetVersion: 2,
        sourceRevision: 9,
        status: "draft",
        title: "Launch meeting packet",
        objectCount: 2,
        contentSnapshot,
      },
    });
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(
      `/api/rooms/${ROOM_ID}/packets/prepare`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${JWT}`,
          "content-type": "application/json",
        },
        cache: "no-store",
        body: JSON.stringify(input),
        signal,
      },
    );
  });

  it("stages without sending and executes only with literal host authorization", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          ok: true,
          send: {
            sendRequestId: SEND_ID,
            packetId: "packet-launch",
            status: "awaiting_human_approval",
            packetVersion: 2,
            contentHash: "a".repeat(64),
            recipientHash: "b".repeat(64),
            recipientSnapshot: recipients,
            recipientCount: 1,
            staged: true,
            changed: true,
          },
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          ok: true,
          send: {
            mode: "preview_only",
            status: "preview_only",
            sendRequestId: SEND_ID,
            outboundShareId: SEND_ID,
            reason: "resend_unconfigured",
            message: "Preview only: no email was sent.",
            preview: {
              subject: "Launch meeting packet",
              recipients,
              contentSnapshot,
            },
          },
        }),
      );
    const api = createBrowserPacketApi({ accessToken: JWT, fetcher });

    await expect(
      api.stageSend({
        roomId: ROOM_ID,
        packetId: "packet-launch",
        requestedByActorType: "agent",
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: { status: "awaiting_human_approval", staged: true },
    });
    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      `/api/rooms/${ROOM_ID}/packets/packet-launch/stage-send`,
      expect.objectContaining({ method: "POST" }),
    );

    await expect(
      api.executeSend({
        roomId: ROOM_ID,
        sendRequestId: SEND_ID,
        explicitHostAuthorization: true,
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: { mode: "preview_only", status: "preview_only" },
    });
    expect(fetcher).toHaveBeenNthCalledWith(
      2,
      `/api/rooms/${ROOM_ID}/packet-send-requests/${SEND_ID}/execute`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          roomId: ROOM_ID,
          sendRequestId: SEND_ID,
          explicitHostAuthorization: true,
        }),
      }),
    );
  });

  it("durably cancels a staged send through the explicit host endpoint", async () => {
    const input = {
      roomId: ROOM_ID,
      sendRequestId: SEND_ID,
      explicitHostCancellation: true as const,
    };
    const fetcher = vi.fn(async () =>
      Response.json({
        ok: true,
        send: {
          sendRequestId: SEND_ID,
          packetId: "packet-launch",
          status: "cancelled",
          receiptId: RECEIPT_ID,
          changed: true,
        },
      }),
    );
    const api = createBrowserPacketApi({ accessToken: JWT, fetcher });

    await expect(api.cancelSend(input)).resolves.toEqual({
      ok: true,
      value: {
        sendRequestId: SEND_ID,
        packetId: "packet-launch",
        status: "cancelled",
        receiptId: RECEIPT_ID,
        changed: true,
      },
    });
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(
      `/api/rooms/${ROOM_ID}/packet-send-requests/${SEND_ID}/cancel`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify(input),
      }),
    );
  });

  it("refuses malformed authorization and already-cancelled requests before fetch", async () => {
    const fetcher = vi.fn();
    const malformed = createBrowserPacketApi({
      accessToken: `${JWT}\r\nx-injected: yes`,
      fetcher,
    });
    await expect(
      malformed.approve({ roomId: ROOM_ID, packetId: "packet-launch" }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "authorization_invalid" },
    });

    const controller = new AbortController();
    controller.abort();
    const cancelled = createBrowserPacketApi({ accessToken: JWT, fetcher });
    await expect(
      cancelled.update(
        {
          roomId: ROOM_ID,
          packetId: "packet-launch",
          title: "Launch meeting packet",
          recipients: [],
        },
        controller.signal,
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "request_cancelled" },
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects unbounded or malformed responses and keeps failures compact", async () => {
    const fetcher = vi.fn(async () =>
      new Response("provider secret and database diagnostics", {
        status: 500,
        headers: { "content-type": "text/plain" },
      }),
    );
    const api = createBrowserPacketApi({ accessToken: JWT, fetcher });

    const result = await api.approve({
      roomId: ROOM_ID,
      packetId: "packet-launch",
    });
    expect(result).toEqual({
      ok: false,
      error: {
        code: "invalid_response",
        message: "Meeting packet service returned an invalid response.",
        status: 500,
      },
    });
    expect(JSON.stringify(result)).not.toContain("provider secret");
  });

  it("rejects a success response whose entity identity does not match the request", async () => {
    const fetcher = vi.fn(async () =>
      Response.json({
        ok: true,
        send: {
          sendRequestId: "33333333-3333-4333-8333-333333333333",
          packetId: "packet-other",
          status: "awaiting_human_approval",
          packetVersion: 2,
          contentHash: "a".repeat(64),
          recipientHash: "b".repeat(64),
          recipientSnapshot: recipients,
          recipientCount: 1,
          staged: true,
          changed: true,
        },
      }),
    );
    const api = createBrowserPacketApi({ accessToken: JWT, fetcher });

    await expect(
      api.stageSend({
        roomId: ROOM_ID,
        packetId: "packet-launch",
        requestedByActorType: "agent",
      }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: "invalid_response",
        message: "Meeting packet service returned an invalid response.",
        status: 200,
      },
    });
  });
});
