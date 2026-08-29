// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
  createPacketService,
  type PacketServiceClient,
  type PacketServiceQueryResult,
} from "@/lib/packets/server-service";

const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const HOST_ID = "22222222-2222-4222-8222-222222222222";
const SEND_REQUEST_ID = "33333333-3333-4333-8333-333333333333";
const CANCELLATION_RECEIPT_ID = "44444444-4444-4444-8444-444444444444";
const PACKET_ID = "packet-launch";
const IDEMPOTENCY_KEY = `commandcanvas:packet-send:${SEND_REQUEST_ID}`;

const recipients = [
  { name: "Danny", email: "danny@example.com" },
  { name: "Sarah", email: "sarah@example.com" },
];

const approvedContentSnapshot = {
  title: "Launch meeting packet",
  content: {
    schemaVersion: 1,
    roomName: "Launch room",
    sourceRevision: 9,
    objects: [
      {
        objectId: "decision-launch",
        objectType: "note",
        title: "Launch decision",
        payload: { text: "Ship the verified spatial workflow." },
      },
    ],
  },
};

type RpcResponder = (
  functionName: string,
  args: Record<string, unknown>,
) => PacketServiceQueryResult | Promise<PacketServiceQueryResult>;

function createQueryBuilder(result: PacketServiceQueryResult) {
  const promise = Promise.resolve(result);
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    maybeSingle: vi.fn(() => promise),
    then: promise.then.bind(promise),
  };
  return builder;
}

function createReadQueryBuilder(result: PacketServiceQueryResult) {
  const promise = Promise.resolve(result);
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    maybeSingle: vi.fn(() => promise),
    then: promise.then.bind(promise),
  };
  return builder;
}

function createClient(input?: {
  stagedRow?: unknown;
  stagedError?: unknown;
  rpc?: RpcResponder;
  admissionResult?: unknown;
  roomMode?: "demo" | "standard";
}) {
  const queryBuilder = createQueryBuilder({
    data:
      input?.stagedRow ??
      ({
        status: "awaiting_human_approval",
        recipient_snapshot: recipients,
      } satisfies Record<string, unknown>),
    error: input?.stagedError ?? null,
  });
  const rpc = vi.fn(async (functionName: string, args: Record<string, unknown>) => {
    if (functionName === "reserve_packet_resend_admission")
      return {
        data: input?.admissionResult ?? {
          allowed: true,
          reason: "admitted",
          changed: true,
        },
        error: null,
      };
    return input?.rpc
      ? input.rpc(functionName, args)
      : { data: null, error: { message: "unexpected_rpc" } };
  });
  const roomQueryBuilder = createQueryBuilder({
    data: { mode: input?.roomMode ?? "standard" },
    error: null,
  });
  const client = {
    from: vi.fn((table: string) =>
      table === "rooms" ? roomQueryBuilder : queryBuilder,
    ),
    rpc,
  } satisfies PacketServiceClient;
  return { client, rpc, queryBuilder, roomQueryBuilder };
}

function authorizeResult(
  provider: "preview" | "resend",
  status: "preview_only" | "sending" | "reconciling" | "submitted" | "failed" =
    provider === "preview" ? "preview_only" : "sending",
  providerMessageId: string | null = null,
) {
  return {
    sendRequestId: SEND_REQUEST_ID,
    outboundShareId: SEND_REQUEST_ID,
    provider,
    status,
    subject: approvedContentSnapshot.title,
    contentSnapshot: approvedContentSnapshot,
    recipientSnapshot: recipients,
    idempotencyKey: IDEMPOTENCY_KEY,
    providerMessageId,
    changed: true,
  };
}

describe("meeting packet RPC service", () => {
  it("prepares a draft with the authenticated host and selected semantic objects", async () => {
    const { client, rpc } = createClient({
      rpc: (functionName) => ({
        data:
          functionName === "prepare_meeting_packet_draft"
            ? {
                packetId: PACKET_ID,
                packetVersion: 2,
                sourceRevision: 9,
                status: "draft",
                title: "Launch packet",
                objectCount: 3,
                contentSnapshot: {
                  ...approvedContentSnapshot,
                  title: "Launch packet",
                },
              }
            : null,
        error: null,
      }),
    });
    const service = createPacketService(client);

    const result = await service.prepareDraft(HOST_ID, {
      roomId: ROOM_ID,
      packetId: PACKET_ID,
      actorType: "agent",
      title: "Launch packet",
      selectedObjectIds: ["note-launch", "diagram-system"],
    });

    expect(result).toEqual({
      ok: true,
      value: {
        packetId: PACKET_ID,
        packetVersion: 2,
        sourceRevision: 9,
        status: "draft",
        title: "Launch packet",
        objectCount: 3,
        contentSnapshot: {
          ...approvedContentSnapshot,
          title: "Launch packet",
        },
      },
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      "prepare_meeting_packet_draft",
      {
        p_room_id: ROOM_ID,
        p_host_user_id: HOST_ID,
        p_packet_id: PACKET_ID,
        p_actor_type: "agent",
        p_title: "Launch packet",
        p_selected_object_ids: ["note-launch", "diagram-system"],
      },
    );
  });

  it("propagates the database host guard without exposing provider details", async () => {
    const { client } = createClient({
      rpc: () => ({
        data: null,
        error: {
          message:
            "packet_host_required database-url=postgres://hidden:secret@example.test",
        },
      }),
    });
    const service = createPacketService(client);

    const result = await service.approve(HOST_ID, {
      roomId: ROOM_ID,
      packetId: PACKET_ID,
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "host_required",
        message: "Only the room host can manage meeting packets.",
      },
    });
    expect(JSON.stringify(result)).not.toContain("postgres://");
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("updates recipients through the draft RPC so the database invalidates prior approval", async () => {
    const normalizedRecipients = [
      { name: "Danny", email: "danny@example.com" },
    ];
    const { client, rpc } = createClient({
      rpc: () => ({
        data: {
          packetId: PACKET_ID,
          status: "draft",
          recipientCount: 1,
          changed: true,
        },
        error: null,
      }),
    });
    const service = createPacketService(client);

    const result = await service.updateDraft(HOST_ID, {
      roomId: ROOM_ID,
      packetId: PACKET_ID,
      title: "Launch packet v2",
      recipients: normalizedRecipients,
    });

    expect(result).toEqual({
      ok: true,
      value: {
        packetId: PACKET_ID,
        status: "draft",
        recipientCount: 1,
        changed: true,
      },
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      "update_meeting_packet_draft",
      {
        p_room_id: ROOM_ID,
        p_packet_id: PACKET_ID,
        p_host_user_id: HOST_ID,
        p_title: "Launch packet v2",
        p_recipient_draft: normalizedRecipients,
      },
    );
  });

  it("stages an approved send request without authorizing an external side effect", async () => {
    const { client, rpc } = createClient({
      rpc: () => ({
        data: {
          sendRequestId: SEND_REQUEST_ID,
          packetId: PACKET_ID,
          status: "awaiting_human_approval",
          idempotencyKey: IDEMPOTENCY_KEY,
          packetVersion: 2,
          contentHash: "a".repeat(64),
          recipientHash: "b".repeat(64),
          recipientSnapshot: recipients,
          recipientCount: 2,
          staged: true,
          changed: true,
        },
        error: null,
      }),
    });
    const service = createPacketService(client, {
      createUuid: () => SEND_REQUEST_ID,
    });

    const result = await service.stageSend(HOST_ID, {
      roomId: ROOM_ID,
      packetId: PACKET_ID,
      requestedByActorType: "agent",
    });

    expect(result).toEqual({
      ok: true,
      value: {
        sendRequestId: SEND_REQUEST_ID,
        packetId: PACKET_ID,
        status: "awaiting_human_approval",
        packetVersion: 2,
        contentHash: "a".repeat(64),
        recipientHash: "b".repeat(64),
        recipientSnapshot: recipients,
        recipientCount: 2,
        staged: true,
        changed: true,
      },
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      "stage_meeting_packet_send",
      {
        p_room_id: ROOM_ID,
        p_packet_id: PACKET_ID,
        p_host_user_id: HOST_ID,
        p_requested_by_actor_type: "agent",
        p_send_request_id: SEND_REQUEST_ID,
      },
    );
    expect(rpc).not.toHaveBeenCalledWith(
      "authorize_meeting_packet_send",
      expect.anything(),
    );
  });

  it("keeps the same durable active send request idempotent when staging is repeated", async () => {
    const generatedRequestId = "55555555-5555-4555-8555-555555555555";
    const { client, rpc } = createClient({
      rpc: () => ({
        data: {
          sendRequestId: SEND_REQUEST_ID,
          packetId: PACKET_ID,
          status: "awaiting_human_approval",
          idempotencyKey: IDEMPOTENCY_KEY,
          packetVersion: 2,
          contentHash: "a".repeat(64),
          recipientHash: "b".repeat(64),
          recipientSnapshot: recipients,
          recipientCount: 2,
          staged: true,
          changed: false,
        },
        error: null,
      }),
    });
    const service = createPacketService(client, {
      createUuid: () => generatedRequestId,
    });

    await expect(
      service.stageSend(HOST_ID, {
        roomId: ROOM_ID,
        packetId: PACKET_ID,
        requestedByActorType: "agent",
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        sendRequestId: SEND_REQUEST_ID,
        status: "awaiting_human_approval",
        changed: false,
      },
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      "stage_meeting_packet_send",
      expect.objectContaining({ p_send_request_id: generatedRequestId }),
    );
  });

  it("requires a new approval after the durable snapshot was submitted", async () => {
    const { client } = createClient({
      rpc: () => ({
        data: null,
        error: { message: "packet_send_new_approval_required" },
      }),
    });
    const service = createPacketService(client);

    await expect(
      service.stageSend(HOST_ID, {
        roomId: ROOM_ID,
        packetId: PACKET_ID,
        requestedByActorType: "agent",
      }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: "approval_required",
        message: "Prepare and approve a new packet version before sending again.",
      },
    });
  });

  it("returns the exact database approval snapshot and its hashes", async () => {
    const { client } = createClient({
      rpc: () => ({
        data: {
          packetId: PACKET_ID,
          packetVersion: 2,
          status: "approved",
          contentHash: "a".repeat(64),
          recipientHash: "b".repeat(64),
          recipientCount: 2,
          contentSnapshot: approvedContentSnapshot,
          recipientSnapshot: recipients,
          changed: true,
        },
        error: null,
      }),
    });
    const service = createPacketService(client);

    await expect(
      service.approve(HOST_ID, { roomId: ROOM_ID, packetId: PACKET_ID }),
    ).resolves.toEqual({
      ok: true,
      value: {
        packetId: PACKET_ID,
        packetVersion: 2,
        status: "approved",
        contentHash: "a".repeat(64),
        recipientHash: "b".repeat(64),
        recipientCount: 2,
        contentSnapshot: approvedContentSnapshot,
        recipientSnapshot: recipients,
        changed: true,
      },
    });
  });

  it("durably cancels only the staged request selected by the host", async () => {
    const { client, rpc } = createClient({
      rpc: () => ({
        data: {
          sendRequestId: SEND_REQUEST_ID,
          packetId: PACKET_ID,
          status: "cancelled",
          receiptId: CANCELLATION_RECEIPT_ID,
          changed: true,
        },
        error: null,
      }),
    });
    const service = createPacketService(client);

    await expect(
      service.cancelSend(HOST_ID, {
        roomId: ROOM_ID,
        sendRequestId: SEND_REQUEST_ID,
        explicitHostCancellation: true,
      }),
    ).resolves.toEqual({
      ok: true,
      value: {
        sendRequestId: SEND_REQUEST_ID,
        packetId: PACKET_ID,
        status: "cancelled",
        receiptId: CANCELLATION_RECEIPT_ID,
        changed: true,
      },
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      "cancel_meeting_packet_send",
      {
        p_room_id: ROOM_ID,
        p_send_request_id: SEND_REQUEST_ID,
        p_host_user_id: HOST_ID,
      },
    );
  });

  it("refuses execution after the staged request has been cancelled", async () => {
    const { client, rpc } = createClient({
      stagedRow: {
        status: "cancelled",
        recipient_snapshot: recipients,
      },
    });
    const service = createPacketService(client);

    await expect(
      service.executeSend(HOST_ID, {
        roomId: ROOM_ID,
        sendRequestId: SEND_REQUEST_ID,
        explicitHostAuthorization: true,
      }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: "send_request_unavailable",
        message: "The staged packet send is no longer available.",
      },
    });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("persisted meeting packet readback", () => {
  it("loads the latest packet, latest send, and bounded immutable activity only after verifying the host", async () => {
    const membership = createReadQueryBuilder({
      data: { role: "host" },
      error: null,
    });
    const packet = createReadQueryBuilder({
      data: {
        id: PACKET_ID,
        packet_version: 2,
        source_revision: 9,
        status: "approved",
        title: approvedContentSnapshot.title,
        content: approvedContentSnapshot.content,
        recipient_draft: recipients,
        recipient_snapshot: recipients,
        recipient_snapshot_hash: "b".repeat(64),
        approved_content_snapshot: approvedContentSnapshot,
        approved_content_hash: "a".repeat(64),
      },
      error: null,
    });
    const send = createReadQueryBuilder({
      data: {
        id: SEND_REQUEST_ID,
        packet_id: PACKET_ID,
        packet_version: 2,
        packet_content_hash: "a".repeat(64),
        recipient_snapshot_hash: "b".repeat(64),
        recipient_snapshot: recipients,
        status: "submitted",
      },
      error: null,
    });
    const outbound = createReadQueryBuilder({
      data: {
        provider_message_id: "email_accepted_123",
        status: "delivered",
      },
      error: null,
    });
    const activity = createReadQueryBuilder({
      data: [
        {
          id: CANCELLATION_RECEIPT_ID,
          activity_revision: 4,
          occurred_at: "2026-08-27T16:04:00.000Z",
          actor_type: "system",
          actor_display_name: "Resend",
          action: "packet_email_delivered",
          packet_id: PACKET_ID,
          send_request_id: SEND_REQUEST_ID,
          description: "Resend confirmed packet delivery.",
        },
        {
          id: "55555555-5555-4555-8555-555555555555",
          activity_revision: 3,
          occurred_at: "2026-08-27T16:03:00.000Z",
          actor_type: "agent",
          actor_display_name: "ChatGPT via WebMCP",
          action: "packet_send_staged",
          packet_id: PACKET_ID,
          send_request_id: SEND_REQUEST_ID,
          description: "ChatGPT requested approval to send the packet.",
        },
      ],
      error: null,
    });
    const byTable = {
      room_members: membership,
      meeting_packets: packet,
      packet_send_requests: send,
      outbound_shares: outbound,
      packet_activity_receipts: activity,
    };
    const client = {
      from: vi.fn((table: string) => byTable[table as keyof typeof byTable]),
      rpc: vi.fn(),
    } as unknown as PacketServiceClient;
    const service = createPacketService(client);

    await expect(service.loadLatest(HOST_ID, ROOM_ID)).resolves.toEqual({
      ok: true,
      value: {
        packet: {
          packetId: PACKET_ID,
          packetVersion: 2,
          sourceRevision: 9,
          status: "approved",
          title: approvedContentSnapshot.title,
          contentSnapshot: approvedContentSnapshot,
          recipients,
          approvedSnapshot: {
            packetVersion: 2,
            contentHash: "a".repeat(64),
            recipientHash: "b".repeat(64),
            contentSnapshot: approvedContentSnapshot,
            recipients,
          },
        },
        latestSend: {
          sendRequestId: SEND_REQUEST_ID,
          packetId: PACKET_ID,
          packetVersion: 2,
          contentHash: "a".repeat(64),
          recipientHash: "b".repeat(64),
          recipients,
          status: "submitted",
          providerMessageId: "email_accepted_123",
          deliveryStatus: "delivered",
        },
        activity: [
          {
            receiptId: CANCELLATION_RECEIPT_ID,
            revision: 4,
            occurredAt: "2026-08-27T16:04:00.000Z",
            actorType: "system",
            actorDisplayName: "Resend",
            action: "packet_email_delivered",
            packetId: PACKET_ID,
            sendRequestId: SEND_REQUEST_ID,
            description: "Resend confirmed packet delivery.",
          },
          {
            receiptId: "55555555-5555-4555-8555-555555555555",
            revision: 3,
            occurredAt: "2026-08-27T16:03:00.000Z",
            actorType: "agent",
            actorDisplayName: "ChatGPT via WebMCP",
            action: "packet_send_staged",
            packetId: PACKET_ID,
            sendRequestId: SEND_REQUEST_ID,
            description: "ChatGPT requested approval to send the packet.",
          },
        ],
      },
    });

    expect(membership.eq).toHaveBeenNthCalledWith(1, "room_id", ROOM_ID);
    expect(membership.eq).toHaveBeenNthCalledWith(2, "user_id", HOST_ID);
    expect(packet.order).toHaveBeenCalledWith("packet_version", {
      ascending: false,
    });
    expect(packet.limit).toHaveBeenCalledWith(1);
    expect(send.eq).toHaveBeenCalledWith("packet_id", PACKET_ID);
    expect(outbound.eq).toHaveBeenCalledWith("send_request_id", SEND_REQUEST_ID);
    expect(activity.order).toHaveBeenCalledWith("activity_revision", {
      ascending: false,
    });
    expect(activity.eq).toHaveBeenNthCalledWith(2, "packet_id", PACKET_ID);
    expect(activity.limit).toHaveBeenCalledWith(12);
  });

  it("refuses a participant before reading packet snapshots or activity", async () => {
    const membership = createReadQueryBuilder({
      data: { role: "participant" },
      error: null,
    });
    const from = vi.fn(() => membership);
    const client = { from, rpc: vi.fn() } as unknown as PacketServiceClient;
    const service = createPacketService(client);

    await expect(service.loadLatest(HOST_ID, ROOM_ID)).resolves.toEqual({
      ok: false,
      error: {
        code: "host_required",
        message: "Only the room host can manage meeting packets.",
      },
    });
    expect(from).toHaveBeenCalledExactlyOnceWith("room_members");
  });
});

describe("explicit packet send execution", () => {
  it("forces an unconfigured public demo room to its explicit preview policy", async () => {
    const { client, rpc } = createClient({
      roomMode: "demo",
      rpc: (functionName) => {
        if (functionName === "authorize_meeting_packet_send")
          return { data: authorizeResult("preview"), error: null };
        return { data: null, error: { message: "unexpected_rpc" } };
      },
    });
    const submitResendEmail = vi.fn();
    const service = createPacketService(client, {
      environment: {},
      submitResendEmail,
    });

    await expect(
      service.executeSend(HOST_ID, {
        roomId: ROOM_ID,
        sendRequestId: SEND_REQUEST_ID,
        explicitHostAuthorization: true,
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        mode: "preview_only",
        reason: "demo_room_preview_only",
      },
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      "authorize_meeting_packet_send",
      expect.objectContaining({ p_delivery_mode: "preview" }),
    );
    expect(submitResendEmail).not.toHaveBeenCalled();
  });

  it("forces a configured public demo room to preview before any Resend provider call", async () => {
    const { client, rpc } = createClient({
      roomMode: "demo",
      rpc: (functionName) => {
        if (functionName === "authorize_meeting_packet_send")
          return { data: authorizeResult("preview"), error: null };
        return { data: null, error: { message: "unexpected_rpc" } };
      },
    });
    const submitResendEmail = vi.fn();
    const service = createPacketService(client, {
      environment: {
        RESEND_API_KEY: "re_test_secret",
        RESEND_FROM: "CommandCanvas <canvas@example.com>",
        COMMANDCANVAS_EMAIL_ALLOWLIST:
          "danny@example.com,sarah@example.com",
      },
      submitResendEmail,
    });

    await expect(
      service.executeSend(HOST_ID, {
        roomId: ROOM_ID,
        sendRequestId: SEND_REQUEST_ID,
        explicitHostAuthorization: true,
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        mode: "preview_only",
        reason: "demo_room_preview_only",
      },
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      "authorize_meeting_packet_send",
      expect.objectContaining({ p_delivery_mode: "preview" }),
    );
    expect(submitResendEmail).not.toHaveBeenCalled();
  });

  it("refuses a capped Resend admission before authorization or provider work", async () => {
    const { client, rpc } = createClient({
      admissionResult: {
        allowed: false,
        reason: "packet_resend_rate_limited",
        changed: false,
      },
    });
    const submitResendEmail = vi.fn();
    const service = createPacketService(client, {
      environment: {
        RESEND_API_KEY: "re_test_secret",
        RESEND_FROM: "CommandCanvas <canvas@example.com>",
        COMMANDCANVAS_EMAIL_ALLOWLIST:
          "danny@example.com,sarah@example.com",
      },
      submitResendEmail,
    });

    await expect(
      service.executeSend(HOST_ID, {
        roomId: ROOM_ID,
        sendRequestId: SEND_REQUEST_ID,
        explicitHostAuthorization: true,
      }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: "email_rate_limited",
        message: "Packet email capacity is temporarily unavailable.",
      },
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      "reserve_packet_resend_admission",
      {
        p_room_id: ROOM_ID,
        p_send_request_id: SEND_REQUEST_ID,
        p_host_user_id: HOST_ID,
      },
    );
    expect(submitResendEmail).not.toHaveBeenCalled();
  });

  it("reserves one durable standard-room admission before authorization and provider work", async () => {
    const completion = {
      sendRequestId: SEND_REQUEST_ID,
      outboundShareId: SEND_REQUEST_ID,
      status: "submitted",
      provider: "resend",
      providerMessageId: "email_accepted_123",
      changed: true,
    };
    const { client, rpc } = createClient({
      rpc: (functionName) => {
        if (functionName === "authorize_meeting_packet_send")
          return { data: authorizeResult("resend"), error: null };
        if (functionName === "complete_meeting_packet_send")
          return { data: completion, error: null };
        return { data: null, error: { message: "unexpected_rpc" } };
      },
    });
    const submitResendEmail = vi.fn(async () => ({
      ok: true as const,
      providerMessageId: "email_accepted_123",
    }));
    const service = createPacketService(client, {
      environment: {
        RESEND_API_KEY: "re_test_secret",
        RESEND_FROM: "CommandCanvas <canvas@example.com>",
        COMMANDCANVAS_EMAIL_ALLOWLIST:
          "danny@example.com,sarah@example.com",
      },
      submitResendEmail,
    });

    await expect(
      service.executeSend(HOST_ID, {
        roomId: ROOM_ID,
        sendRequestId: SEND_REQUEST_ID,
        explicitHostAuthorization: true,
      }),
    ).resolves.toMatchObject({ ok: true, value: { status: "submitted" } });
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "reserve_packet_resend_admission",
      "authorize_meeting_packet_send",
      "complete_meeting_packet_send",
    ]);
    expect(submitResendEmail).toHaveBeenCalledOnce();
  });

  it("authorizes preview-only and returns the exact approved snapshot when email is unconfigured", async () => {
    const { client, rpc } = createClient({
      rpc: (functionName) => ({
        data:
          functionName === "authorize_meeting_packet_send"
            ? authorizeResult("preview")
            : null,
        error: null,
      }),
    });
    const submitResendEmail = vi.fn();
    const service = createPacketService(client, {
      environment: {},
      submitResendEmail,
    });

    const result = await service.executeSend(HOST_ID, {
      roomId: ROOM_ID,
      sendRequestId: SEND_REQUEST_ID,
      explicitHostAuthorization: true,
    });

    expect(result).toEqual({
      ok: true,
      value: {
        mode: "preview_only",
        status: "preview_only",
        sendRequestId: SEND_REQUEST_ID,
        outboundShareId: SEND_REQUEST_ID,
        reason: "resend_unconfigured",
        message: "Preview only: no email was sent.",
        preview: {
          subject: approvedContentSnapshot.title,
          recipients,
          contentSnapshot: approvedContentSnapshot,
        },
      },
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      "authorize_meeting_packet_send",
      {
        p_room_id: ROOM_ID,
        p_send_request_id: SEND_REQUEST_ID,
        p_host_user_id: HOST_ID,
        p_delivery_mode: "preview",
        p_outbound_share_id: SEND_REQUEST_ID,
      },
    );
    expect(submitResendEmail).not.toHaveBeenCalled();
  });

  it("uses preview-only when any exact approved recipient is outside the allowlist", async () => {
    const { client, rpc } = createClient({
      rpc: () => ({ data: authorizeResult("preview"), error: null }),
    });
    const submitResendEmail = vi.fn();
    const service = createPacketService(client, {
      environment: {
        RESEND_API_KEY: "re_test_secret",
        RESEND_FROM: "CommandCanvas <canvas@example.com>",
        COMMANDCANVAS_EMAIL_ALLOWLIST: "danny@example.com",
      },
      submitResendEmail,
    });

    const result = await service.executeSend(HOST_ID, {
      roomId: ROOM_ID,
      sendRequestId: SEND_REQUEST_ID,
      explicitHostAuthorization: true,
    });

    expect(result.ok && result.value.mode).toBe("preview_only");
    expect(result.ok && result.value.mode === "preview_only"
      ? result.value.reason
      : null).toBe("recipient_not_allowed");
    expect(rpc).toHaveBeenCalledWith(
      "authorize_meeting_packet_send",
      expect.objectContaining({ p_delivery_mode: "preview" }),
    );
    expect(submitResendEmail).not.toHaveBeenCalled();
  });

  it("submits only the authorization RPC's exact approved snapshots and records provider acceptance", async () => {
    const completion = {
      sendRequestId: SEND_REQUEST_ID,
      outboundShareId: SEND_REQUEST_ID,
      status: "submitted",
      provider: "resend",
      providerMessageId: "email_accepted_123",
      changed: true,
    };
    const { client, rpc } = createClient({
      rpc: (functionName) => ({
        data:
          functionName === "authorize_meeting_packet_send"
            ? authorizeResult("resend")
            : completion,
        error: null,
      }),
    });
    const submitResendEmail = vi.fn(async () => ({
      ok: true as const,
      providerMessageId: "email_accepted_123",
    }));
    const service = createPacketService(client, {
      environment: {
        RESEND_API_KEY: "re_test_secret",
        RESEND_FROM: "CommandCanvas <canvas@example.com>",
        COMMANDCANVAS_EMAIL_ALLOWLIST:
          "sarah@example.com, danny@example.com",
      },
      submitResendEmail,
    });

    const result = await service.executeSend(HOST_ID, {
      roomId: ROOM_ID,
      sendRequestId: SEND_REQUEST_ID,
      explicitHostAuthorization: true,
    });

    expect(submitResendEmail).toHaveBeenCalledExactlyOnceWith({
      apiKey: "re_test_secret",
      from: "CommandCanvas <canvas@example.com>",
      recipients,
      subject: approvedContentSnapshot.title,
      contentSnapshot: approvedContentSnapshot,
      idempotencyKey: IDEMPOTENCY_KEY,
      signal: undefined,
    });
    expect(rpc).toHaveBeenNthCalledWith(3, "complete_meeting_packet_send", {
      p_room_id: ROOM_ID,
      p_send_request_id: SEND_REQUEST_ID,
      p_host_user_id: HOST_ID,
      p_outcome: "submitted",
      p_provider_message_id: "email_accepted_123",
      p_error_code: null,
    });
    expect(result).toEqual({
      ok: true,
      value: {
        mode: "resend",
        status: "submitted",
        sendRequestId: SEND_REQUEST_ID,
        outboundShareId: SEND_REQUEST_ID,
        providerMessageId: "email_accepted_123",
        recipientCount: 2,
        subject: approvedContentSnapshot.title,
        message: "Submitted to Resend; delivery is pending.",
      },
    });
  });

  it("persists an ambiguous provider result as reconciling instead of failed", async () => {
    const { client, rpc } = createClient({
      rpc: (functionName) => ({
        data:
          functionName === "authorize_meeting_packet_send"
            ? authorizeResult("resend")
            : {
                sendRequestId: SEND_REQUEST_ID,
                outboundShareId: SEND_REQUEST_ID,
                status: "reconciling",
                provider: "resend",
                providerMessageId: null,
                changed: true,
              },
        error: null,
      }),
    });
    const service = createPacketService(client, {
      environment: {
        RESEND_API_KEY: "re_test_secret",
        RESEND_FROM: "CommandCanvas <canvas@example.com>",
        COMMANDCANVAS_EMAIL_ALLOWLIST:
          "danny@example.com,sarah@example.com",
      },
      submitResendEmail: vi.fn(async () => ({
        ok: false as const,
        errorCode: "resend_ambiguous" as const,
        reconciling: true as const,
      })),
    });
    await expect(
      service.executeSend(HOST_ID, {
        roomId: ROOM_ID,
        sendRequestId: SEND_REQUEST_ID,
        explicitHostAuthorization: true,
      }),
    ).resolves.toEqual({
      ok: true,
      value: {
        mode: "resend",
        status: "reconciling",
        sendRequestId: SEND_REQUEST_ID,
        outboundShareId: SEND_REQUEST_ID,
        providerMessageId: null,
        recipientCount: 2,
        subject: approvedContentSnapshot.title,
        message: "Submission is being reconciled; delivery is not confirmed.",
      },
    });
    expect(rpc).toHaveBeenNthCalledWith(3, "complete_meeting_packet_send", {
      p_room_id: ROOM_ID,
      p_send_request_id: SEND_REQUEST_ID,
      p_host_user_id: HOST_ID,
      p_outcome: "reconciling",
      p_provider_message_id: null,
      p_error_code: "resend_ambiguous",
    });
  });

  it("recovers durable acceptance when the completion response and reconciliation response are both lost", async () => {
    let authorizationCalls = 0;
    const { client, rpc } = createClient({
      rpc: (functionName) => {
        if (functionName === "authorize_meeting_packet_send") {
          authorizationCalls += 1;
          return {
            data:
              authorizationCalls === 1
                ? authorizeResult("resend")
                : authorizeResult(
                    "resend",
                    "submitted",
                    "email_accepted_123",
                  ),
            error: null,
          };
        }
        return {
          data: null,
          error: { message: "packet_send_completion_conflict" },
        };
      },
    });
    const submitResendEmail = vi.fn(async () => ({
      ok: true as const,
      providerMessageId: "email_accepted_123",
    }));
    const service = createPacketService(client, {
      environment: {
        RESEND_API_KEY: "re_test_secret",
        RESEND_FROM: "CommandCanvas <canvas@example.com>",
        COMMANDCANVAS_EMAIL_ALLOWLIST:
          "danny@example.com,sarah@example.com",
      },
      submitResendEmail,
    });

    await expect(
      service.executeSend(HOST_ID, {
        roomId: ROOM_ID,
        sendRequestId: SEND_REQUEST_ID,
        explicitHostAuthorization: true,
      }),
    ).resolves.toEqual({
      ok: true,
      value: {
        mode: "resend",
        status: "submitted",
        sendRequestId: SEND_REQUEST_ID,
        outboundShareId: SEND_REQUEST_ID,
        providerMessageId: "email_accepted_123",
        recipientCount: 2,
        subject: approvedContentSnapshot.title,
        message: "This packet was already submitted to Resend.",
      },
    });
    expect(submitResendEmail).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledTimes(5);
  });

  it("preserves the durable provider message ID when an already-submitted request is replayed", async () => {
    const { client } = createClient({
      stagedRow: { status: "submitted", recipient_snapshot: recipients },
      rpc: () => ({
        data: authorizeResult("resend", "submitted", "email_existing_123"),
        error: null,
      }),
    });
    const submitResendEmail = vi.fn();
    const service = createPacketService(client, {
      environment: {
        RESEND_API_KEY: "re_test_secret",
        RESEND_FROM: "CommandCanvas <canvas@example.com>",
        COMMANDCANVAS_EMAIL_ALLOWLIST:
          "danny@example.com,sarah@example.com",
      },
      submitResendEmail,
    });
    await expect(
      service.executeSend(HOST_ID, {
        roomId: ROOM_ID,
        sendRequestId: SEND_REQUEST_ID,
        explicitHostAuthorization: true,
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        status: "submitted",
        providerMessageId: "email_existing_123",
      },
    });
    expect(submitResendEmail).not.toHaveBeenCalled();
  });

  it("completes the durable request as failed when Resend does not accept it", async () => {
    const { client, rpc } = createClient({
      rpc: (functionName) => ({
        data:
          functionName === "authorize_meeting_packet_send"
            ? authorizeResult("resend")
            : {
                sendRequestId: SEND_REQUEST_ID,
                outboundShareId: SEND_REQUEST_ID,
                status: "failed",
                provider: "resend",
                providerMessageId: null,
                changed: true,
              },
        error: null,
      }),
    });
    const submitResendEmail = vi.fn(async () => ({
      ok: false as const,
      errorCode: "resend_rejected" as const,
    }));
    const service = createPacketService(client, {
      environment: {
        RESEND_API_KEY: "re_test_secret",
        RESEND_FROM: "CommandCanvas <canvas@example.com>",
        COMMANDCANVAS_EMAIL_ALLOWLIST:
          "danny@example.com,sarah@example.com",
      },
      submitResendEmail,
    });

    const result = await service.executeSend(HOST_ID, {
      roomId: ROOM_ID,
      sendRequestId: SEND_REQUEST_ID,
      explicitHostAuthorization: true,
    });

    expect(rpc).toHaveBeenNthCalledWith(3, "complete_meeting_packet_send", {
      p_room_id: ROOM_ID,
      p_send_request_id: SEND_REQUEST_ID,
      p_host_user_id: HOST_ID,
      p_outcome: "failed",
      p_provider_message_id: null,
      p_error_code: "resend_rejected",
    });
    expect(result).toEqual({
      ok: false,
      error: {
        code: "email_submission_failed",
        message: "Resend did not accept the packet.",
      },
    });
  });

  it("refuses an approved snapshot with email subject control characters", async () => {
    const unsafe = authorizeResult("resend");
    unsafe.subject = "Launch\r\nBcc: attacker@example.com";
    unsafe.contentSnapshot = {
      ...approvedContentSnapshot,
      title: "Launch\r\nBcc: attacker@example.com",
    };
    const { client } = createClient({
      rpc: () => ({ data: unsafe, error: null }),
    });
    const submitResendEmail = vi.fn();
    const service = createPacketService(client, {
      environment: {
        RESEND_API_KEY: "re_test_secret",
        RESEND_FROM: "CommandCanvas <canvas@example.com>",
        COMMANDCANVAS_EMAIL_ALLOWLIST:
          "danny@example.com,sarah@example.com",
      },
      submitResendEmail,
    });

    const result = await service.executeSend(HOST_ID, {
      roomId: ROOM_ID,
      sendRequestId: SEND_REQUEST_ID,
      explicitHostAuthorization: true,
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "packet_unavailable",
        message: "Meeting packet service is temporarily unavailable.",
      },
    });
    expect(submitResendEmail).not.toHaveBeenCalled();
  });
});
