// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { createMeetingService } from "@/lib/supabase/meeting-service";

const ACTOR_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_ACTOR_ID = "66666666-6666-4666-8666-666666666666";
const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const INVITATION_ID = "33333333-3333-4333-8333-333333333333";
const RETRY_CANDIDATE_ID = "77777777-7777-4777-8777-777777777777";
const REQUEST_ID = "44444444-4444-4444-8444-444444444444";
const INVITE_SECRET = "test-only-invite-secret-with-at-least-32-bytes";

function clientWith(results: readonly { data: unknown; error: unknown }[]) {
  const queue = [...results];
  return { rpc: vi.fn().mockImplementation(async () => queue.shift()) };
}

describe("meeting service", () => {
  it("creates only a standard meeting through the permanent-auth RPC and keeps join capability private", async () => {
    const results = [
      {
        data: { roomId: ROOM_ID, slug: "room-" + "1".repeat(32), role: "host", joined: true },
        error: null,
      },
    ];
    const client = clientWith(results);
    const service = createMeetingService(client, {
      createUuid: () => ROOM_ID,
      randomBytes: (size) => Buffer.alloc(size, 7),
      now: () => new Date("2026-08-28T12:00:00.000Z"),
      inviteTokenSecret: INVITE_SECRET,
    });

    const result = await service.createMeeting(ACTOR_ID, {
      requestId: ROOM_ID,
      name: "Product review",
      displayName: "Danny",
      color: "#0ea5e9",
    });

    expect(result).toEqual({
      ok: true,
      value: { roomId: ROOM_ID, role: "host", joined: true },
    });
    expect(client.rpc).toHaveBeenCalledWith(
      "create_standard_meeting_with_host",
      expect.objectContaining({
        p_room_id: ROOM_ID,
        p_host_user_id: ACTOR_ID,
      }),
    );
    expect(JSON.stringify(result)).not.toContain("joinToken");
  });

  it("keeps each actor bound to that actor's exact room request ID at the service boundary", async () => {
    const otherRoomId = "88888888-8888-4888-8888-888888888888";
    const client = clientWith([
      {
        data: {
          roomId: ROOM_ID,
          slug: `room-${"1".repeat(32)}`,
          role: "host",
          joined: true,
        },
        error: null,
      },
      {
        data: {
          roomId: otherRoomId,
          slug: `room-${"2".repeat(32)}`,
          role: "host",
          joined: true,
        },
        error: null,
      },
    ]);
    const service = createMeetingService(client, {
      createUuid: () => "99999999-9999-4999-8999-999999999999",
      randomBytes: (size) => Buffer.alloc(size, 3),
      now: () => new Date("2026-09-01T20:00:00.000Z"),
      inviteTokenSecret: INVITE_SECRET,
    });

    await service.createMeeting(ACTOR_ID, {
      requestId: ROOM_ID,
      name: "Same draft",
      displayName: "Daniel",
      color: "#0ea5e9",
    });
    await service.createMeeting(OTHER_ACTOR_ID, {
      requestId: otherRoomId,
      name: "Same draft",
      displayName: "Daniel",
      color: "#0ea5e9",
    });

    expect(client.rpc).toHaveBeenNthCalledWith(
      1,
      "create_standard_meeting_with_host",
      expect.objectContaining({
        p_room_id: ROOM_ID,
        p_host_user_id: ACTOR_ID,
      }),
    );
    expect(client.rpc).toHaveBeenNthCalledWith(
      2,
      "create_standard_meeting_with_host",
      expect.objectContaining({
        p_room_id: otherRoomId,
        p_host_user_id: OTHER_ACTOR_ID,
      }),
    );
  });

  it("loads durable invitation delivery only for the host, room, and invitation tuple", async () => {
    const client = clientWith([
      {
        data: {
          invitationId: INVITATION_ID,
          deliveryStatus: "submitted",
          providerMessageId: "email_accepted_123",
          changed: false,
        },
        error: null,
      },
    ]);
    const service = createMeetingService(client, {
      createUuid: () => INVITATION_ID,
      randomBytes: (size) => Buffer.alloc(size, 1),
      now: () => new Date("2026-08-28T12:00:00.000Z"),
      inviteTokenSecret: INVITE_SECRET,
    });

    await expect(
      service.loadInvitationDelivery(ACTOR_ID, ROOM_ID, INVITATION_ID),
    ).resolves.toEqual({
      ok: true,
      value: {
        invitationId: INVITATION_ID,
        deliveryStatus: "submitted",
        providerMessageId: "email_accepted_123",
        changed: false,
      },
    });
    expect(client.rpc).toHaveBeenCalledExactlyOnceWith(
      "load_room_invitation_delivery",
      {
        p_host_user_id: ACTOR_ID,
        p_room_id: ROOM_ID,
        p_invitation_id: INVITATION_ID,
      },
    );
  });

  it("creates an idempotent email-bound invitation with a stable 256-bit HMAC token", async () => {
    const results = [
      {
        data: {
          outcome: "created",
          invitationId: INVITATION_ID,
          roomId: ROOM_ID,
          expiresAt: "2026-08-29T12:00:00.000Z",
          roomName: "Product review",
          idempotencyKey: `commandcanvas:invite:${INVITATION_ID}`,
          deliveryStatus: "created",
          providerMessageId: null,
        },
        error: null,
      },
    ];
    const client = clientWith(results);
    const service = createMeetingService(client, {
      createUuid: () => INVITATION_ID,
      randomBytes: (size) => Buffer.alloc(size, 9),
      now: () => new Date("2026-08-28T12:00:00.000Z"),
      inviteTokenSecret: INVITE_SECRET,
    });

    const result = await service.createInvitation(ACTOR_ID, ROOM_ID, {
      requestId: REQUEST_ID,
      email: " Sarah@Example.com ",
      displayName: "Sarah",
      color: "#a855f7",
      expiresInHours: 24,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.email).toBe("sarah@example.com");
    expect(result.value.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(result.value.roomName).toBe("Product review");
    expect(result.value.idempotencyKey).toBe(
      `commandcanvas:invite:${INVITATION_ID}`,
    );
    expect(client.rpc).toHaveBeenCalledExactlyOnceWith(
      "create_room_email_invitation",
      expect.objectContaining({
        p_invitation_id: INVITATION_ID,
        p_request_id: REQUEST_ID,
        p_room_id: ROOM_ID,
        p_actor_user_id: ACTOR_ID,
        p_recipient_email: "sarah@example.com",
        p_expires_in_hours: 24,
        p_requested_role: "participant",
      }),
    );
  });

  it("derives the same bearer token and accepts the existing reservation on retry", async () => {
    const response = {
      data: {
        outcome: "existing",
        invitationId: INVITATION_ID,
        roomId: ROOM_ID,
        expiresAt: "2026-08-29T12:00:00.000Z",
        roomName: "Product review",
        idempotencyKey: `commandcanvas:invite:${INVITATION_ID}`,
        deliveryStatus: "reconciling",
        providerMessageId: null,
      },
      error: null,
    };
    const client = clientWith([response, response]);
    const service = createMeetingService(client, {
      createUuid: () => RETRY_CANDIDATE_ID,
      randomBytes: (size) => Buffer.alloc(size, 1),
      now: () => new Date("2026-08-28T12:00:00.000Z"),
      inviteTokenSecret: INVITE_SECRET,
    });
    const input = {
      requestId: REQUEST_ID,
      email: "sarah@example.com",
      displayName: "Sarah",
      color: "#a855f7",
      expiresInHours: 24,
    };
    const first = await service.createInvitation(ACTOR_ID, ROOM_ID, input);
    const second = await service.createInvitation(ACTOR_ID, ROOM_ID, input);
    expect(first.ok && first.value.token).toBe(second.ok && second.value.token);
    expect(first.ok && first.value.invitationId).toBe(INVITATION_ID);
    expect(second.ok && second.value.invitationId).toBe(INVITATION_ID);
    expect(client.rpc).toHaveBeenNthCalledWith(
      2,
      "create_room_email_invitation",
      expect.objectContaining({
        p_invitation_id: RETRY_CANDIDATE_ID,
        p_request_id: REQUEST_ID,
      }),
    );
  });

  it("refuses a created invitation whose durable identity differs from the requested identity", async () => {
    const service = createMeetingService(
      clientWith([
        {
          data: {
            outcome: "created",
            invitationId: INVITATION_ID,
            roomId: ROOM_ID,
            expiresAt: "2026-08-29T12:00:00.000Z",
            roomName: "Product review",
            idempotencyKey: `commandcanvas:invite:${INVITATION_ID}`,
            deliveryStatus: "created",
            providerMessageId: null,
          },
          error: null,
        },
      ]),
      {
        createUuid: () => RETRY_CANDIDATE_ID,
        randomBytes: (size) => Buffer.alloc(size, 1),
        now: () => new Date("2026-08-28T12:00:00.000Z"),
        inviteTokenSecret: INVITE_SECRET,
      },
    );

    const result = await service.createInvitation(ACTOR_ID, ROOM_ID, {
      requestId: REQUEST_ID,
      email: "sarah@example.com",
      displayName: "Sarah",
      color: "#a855f7",
      expiresInHours: 24,
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: "service_unavailable" },
    });
  });

  it("accepts by actor plus opaque token only and returns a participant room", async () => {
    const token = Buffer.alloc(32, 4).toString("base64url");
    const client = clientWith([
      {
        data: {
          outcome: "joined",
          roomId: ROOM_ID,
          role: "participant",
          joined: true,
        },
        error: null,
      },
    ]);
    const service = createMeetingService(client);

    const result = await service.acceptInvitation(ACTOR_ID, { token });

    expect(result).toEqual({
      ok: true,
      value: { roomId: ROOM_ID, role: "participant", joined: true },
    });
    expect(client.rpc).toHaveBeenCalledExactlyOnceWith(
      "accept_room_email_invitation",
      { p_actor_user_id: ACTOR_ID, p_token: token },
    );
  });

  it("maps a durably recorded unavailable acceptance to one compact non-enumerating error", async () => {
    const token = Buffer.alloc(32, 8).toString("base64url");
    const client = clientWith([
      { data: { outcome: "unavailable" }, error: null },
    ]);
    const service = createMeetingService(client);

    const result = await service.acceptInvitation(ACTOR_ID, { token });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "invitation_unavailable",
        message:
          "This invitation is invalid, expired, used, or belongs to another email.",
      },
    });
    expect(JSON.stringify(result)).not.toContain(token);
    expect(JSON.stringify(result)).not.toContain("sarah@example.com");
  });

  it("maps rate, host, and mismatch failures to compact non-secret errors", async () => {
    const client = clientWith([
      { data: null, error: { message: "meeting_invite_actor_rate_limit secret" } },
      { data: null, error: { message: "meeting_invitation_unavailable token" } },
    ]);
    const service = createMeetingService(client, {
      createUuid: () => INVITATION_ID,
      randomBytes: (size) => Buffer.alloc(size, 2),
      now: () => new Date("2026-08-28T12:00:00.000Z"),
      inviteTokenSecret: INVITE_SECRET,
    });
    const invitation = await service.createInvitation(ACTOR_ID, ROOM_ID, {
      requestId: REQUEST_ID,
      email: "sarah@example.com",
      displayName: "Sarah",
      color: "#a855f7",
      expiresInHours: 24,
    });
    const accepted = await service.acceptInvitation(ACTOR_ID, {
      token: Buffer.alloc(32, 1).toString("base64url"),
    });

    expect(invitation).toMatchObject({ ok: false, error: { code: "rate_limited" } });
    expect(accepted).toMatchObject({
      ok: false,
      error: { code: "invitation_unavailable" },
    });
    expect(JSON.stringify([invitation, accepted])).not.toContain("secret");
  });

  it("maps a request UUID payload conflict without exposing database details", async () => {
    const service = createMeetingService(
      clientWith([
        {
          data: null,
          error: { message: "meeting_invitation_request_conflict secret" },
        },
      ]),
      {
        createUuid: () => INVITATION_ID,
        randomBytes: (size) => Buffer.alloc(size, 1),
        now: () => new Date("2026-08-28T12:00:00.000Z"),
        inviteTokenSecret: INVITE_SECRET,
      },
    );
    const result = await service.createInvitation(ACTOR_ID, ROOM_ID, {
      requestId: REQUEST_ID,
      email: "sarah@example.com",
      displayName: "Sarah",
      color: "#a855f7",
      expiresInHours: 24,
    });
    expect(result).toEqual({
      ok: false,
      error: {
        code: "invitation_conflict",
        message: "This invitation request ID was already used with different details.",
      },
    });
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("rejects an unsafe delivery error code before the service-role RPC", async () => {
    const client = clientWith([]);
    const service = createMeetingService(client, {
      createUuid: () => INVITATION_ID,
      randomBytes: (size) => Buffer.alloc(size, 1),
      now: () => new Date("2026-08-28T12:00:00.000Z"),
      inviteTokenSecret: INVITE_SECRET,
    });

    await expect(
      service.completeInvitationDelivery(ACTOR_ID, ROOM_ID, INVITATION_ID, {
        status: "failed",
        errorCode: "Provider Error: secret",
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: "invalid_request" } });
    expect(client.rpc).not.toHaveBeenCalled();
  });
});
