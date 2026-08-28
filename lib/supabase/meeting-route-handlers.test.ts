// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
  handleAcceptMeetingInvitationRequest,
  handleCreateMeetingInvitationRequest,
  handleCreateMeetingRequest,
  type MeetingRouteDependencies,
} from "@/lib/supabase/meeting-route-handlers";
import type { MeetingService } from "@/lib/supabase/meeting-service";

const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJob3N0In0.signature";
const ACTOR_ID = "22222222-2222-4222-8222-222222222222";
const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const INVITATION_ID = "33333333-3333-4333-8333-333333333333";
const TOKEN = Buffer.alloc(32, 6).toString("base64url");

function request(path: string, body: unknown) {
  return new Request(`https://commandcanvas.test${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${JWT}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function dependencies(input?: {
  user?: { id: string; [key: string]: unknown };
  createMeeting?: MeetingService["createMeeting"];
  createInvitation?: MeetingService["createInvitation"];
  acceptInvitation?: MeetingService["acceptInvitation"];
}) {
  const verifier = {
    auth: {
      getUser: vi.fn(async () => ({
        data: {
          user: input?.user ?? {
            id: ACTOR_ID,
            email: "danny@example.com",
            email_confirmed_at: "2026-08-28T12:00:00.000Z",
            is_anonymous: false,
          },
        },
        error: null,
      })),
    },
  };
  const service: MeetingService = {
    createMeeting:
      input?.createMeeting ??
      vi.fn(async () => ({
        ok: true as const,
        value: { roomId: ROOM_ID, role: "host" as const, joined: true as const },
      })),
    createInvitation:
      input?.createInvitation ??
      vi.fn(async () => ({
        ok: true as const,
        value: {
          invitationId: INVITATION_ID,
          roomId: ROOM_ID,
          email: "sarah@example.com",
          displayName: "Sarah",
          token: TOKEN,
          expiresAt: "2026-08-29T12:00:00.000Z",
        },
      })),
    acceptInvitation:
      input?.acceptInvitation ??
      vi.fn(async () => ({
        ok: true as const,
        value: { roomId: ROOM_ID, role: "participant" as const, joined: true },
      })),
  };
  const deliverInvitation = vi.fn(async () => ({
    status: "preview_only" as const,
    message: "Invite created. Copy the link.",
  }));
  return {
    verifier,
    service,
    deliverInvitation,
    dependencies: {
      verifier,
      service,
      deliverInvitation,
      publicBaseUrl: "https://commandcanvas.example",
    } satisfies MeetingRouteDependencies,
  };
}

describe("meeting route security", () => {
  it("refuses anonymous auth before standard room provider work", async () => {
    const values = dependencies({
      user: { id: ACTOR_ID, is_anonymous: true },
    });
    const response = await handleCreateMeetingRequest(
      request("/api/meetings", {
        name: "Product review",
        displayName: "Danny",
        color: "#0ea5e9",
      }),
      values.dependencies,
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: { code: "permanent_email_auth_required" },
    });
    expect(values.service.createMeeting).not.toHaveBeenCalled();
  });

  it("bounds strict JSON bodies before meeting work", async () => {
    const values = dependencies();
    const response = await handleCreateMeetingRequest(
      request("/api/meetings", {
        name: "Product review",
        displayName: "Danny",
        color: "#0ea5e9",
        padding: "x".repeat(20_000),
      }),
      values.dependencies,
    );
    expect(response.status).toBe(413);
    expect(values.service.createMeeting).not.toHaveBeenCalled();
  });

  it("creates a standard room without exposing its internal quick-join capability", async () => {
    const values = dependencies();
    const response = await handleCreateMeetingRequest(
      request("/api/meetings", {
        name: "Product review",
        displayName: "Danny",
        color: "#0ea5e9",
      }),
      values.dependencies,
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toEqual({
      ok: true,
      meeting: { roomId: ROOM_ID, role: "host", joined: true },
    });
    expect(JSON.stringify(body)).not.toContain("joinToken");
  });

  it("creates an email-bound invitation and returns one honest copy link", async () => {
    const values = dependencies();
    const response = await handleCreateMeetingInvitationRequest(
      request(`/api/meetings/${ROOM_ID}/invitations`, {
        email: "sarah@example.com",
        displayName: "Sarah",
        color: "#a855f7",
        expiresInHours: 24,
      }),
      ROOM_ID,
      values.dependencies,
    );
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.invitation.joinUrl).toBe(
      `https://commandcanvas.example/meet#invite=${TOKEN}`,
    );
    expect(body.invitation.joinUrl).not.toContain("?invite=");
    expect(body.invitation.delivery.status).toBe("preview_only");
    expect(values.deliverInvitation).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientEmail: "sarah@example.com",
        joinUrl: `https://commandcanvas.example/meet#invite=${TOKEN}`,
      }),
    );
  });

  it("accepts using only the verified actor and token, then omits the token", async () => {
    const values = dependencies();
    const response = await handleAcceptMeetingInvitationRequest(
      request("/api/meeting-invitations/accept", { token: TOKEN }),
      values.dependencies,
    );
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      ok: true,
      meeting: { roomId: ROOM_ID, role: "participant", joined: true },
    });
    expect(values.service.acceptInvitation).toHaveBeenCalledExactlyOnceWith(
      ACTOR_ID,
      { token: TOKEN },
    );
    expect(JSON.stringify(body)).not.toContain(TOKEN);
  });
});
