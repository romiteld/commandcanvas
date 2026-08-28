// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { createMeetingService } from "@/lib/supabase/meeting-service";

const ACTOR_ID = "22222222-2222-4222-8222-222222222222";
const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const INVITATION_ID = "33333333-3333-4333-8333-333333333333";

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
    });

    const result = await service.createMeeting(ACTOR_ID, {
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

  it("creates an email-bound participant invitation with 256-bit opaque entropy", async () => {
    const results = [
      {
        data: {
          outcome: "created",
          invitationId: INVITATION_ID,
          roomId: ROOM_ID,
          expiresAt: "2026-08-29T12:00:00.000Z",
        },
        error: null,
      },
    ];
    const client = clientWith(results);
    const service = createMeetingService(client, {
      createUuid: () => INVITATION_ID,
      randomBytes: (size) => Buffer.alloc(size, 9),
      now: () => new Date("2026-08-28T12:00:00.000Z"),
    });

    const result = await service.createInvitation(ACTOR_ID, ROOM_ID, {
      email: " Sarah@Example.com ",
      displayName: "Sarah",
      color: "#a855f7",
      expiresInHours: 24,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.email).toBe("sarah@example.com");
    expect(result.value.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(client.rpc).toHaveBeenCalledExactlyOnceWith(
      "create_room_email_invitation",
      expect.objectContaining({
        p_invitation_id: INVITATION_ID,
        p_room_id: ROOM_ID,
        p_actor_user_id: ACTOR_ID,
        p_invited_email: "sarah@example.com",
        p_requested_role: "participant",
      }),
    );
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
    });
    const invitation = await service.createInvitation(ACTOR_ID, ROOM_ID, {
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
});
