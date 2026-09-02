// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { createServerMeetingRosterDependencies } from "@/lib/meeting/media-roster-server";

const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const ACTOR_ID = "22222222-2222-4222-8222-222222222222";
const REMOTE_ID = "33333333-3333-4333-8333-333333333333";

function environment() {
  return {
    NEXT_PUBLIC_SUPABASE_URL: "https://supabase.example.test",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-key",
    SUPABASE_SECRET_KEY: "service-secret",
  };
}

function client(rows: unknown) {
  const query = Object.assign(Promise.resolve({ data: rows, error: null }), {
    select: vi.fn(),
    eq: vi.fn(),
  });
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  return {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: ACTOR_ID } },
        error: null,
      })),
    },
    from: vi.fn(() => query),
    query,
  };
}

function row(userId: string, expiresAt = "2099-09-02T00:00:00.000Z") {
  return {
    user_id: userId,
    rooms: {
      mode: "demo",
      created_at: "2026-09-01T00:00:00.000Z",
      demo_hard_expires_at: expiresAt,
    },
  };
}

describe("authoritative meeting roster server", () => {
  it("returns only bounded persisted members when the requester is one of them", async () => {
    const fakeClient = client([row(ACTOR_ID), row(REMOTE_ID)]);
    const built = createServerMeetingRosterDependencies({
      environment: environment(),
      createClient: () => fakeClient,
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    await expect(built.dependencies.loadRoster(ROOM_ID, ACTOR_ID)).resolves.toEqual({
      ok: true,
      status: "eligible",
      participantIds: [ACTOR_ID, REMOTE_ID],
    });
    expect(fakeClient.query.select).toHaveBeenCalledWith(
      "user_id, rooms!inner(mode,created_at,demo_hard_expires_at)",
    );
    expect(fakeClient.query.eq).toHaveBeenCalledWith("room_id", ROOM_ID);
  });

  it("returns only an over-capacity decision when the persisted roster exceeds four", async () => {
    const fakeClient = client([
      row(ACTOR_ID),
      row(REMOTE_ID),
      row("44444444-4444-4444-8444-444444444444"),
      row("55555555-5555-4555-8555-555555555555"),
      row("66666666-6666-4666-8666-666666666666"),
    ]);
    const built = createServerMeetingRosterDependencies({
      environment: environment(),
      createClient: () => fakeClient,
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;

    const result = await built.dependencies.loadRoster(ROOM_ID, ACTOR_ID);
    expect(result).toEqual({ ok: true, status: "over_capacity" });
    expect(result).not.toHaveProperty("participantIds");
  });

  it("refuses an outsider, expired room data, duplicate ids, or malformed rows", async () => {
    for (const rows of [
      [row(REMOTE_ID)],
      [row(ACTOR_ID, "2026-08-31T00:00:00.000Z")],
      [row(ACTOR_ID), row(ACTOR_ID)],
      [{ user_id: "forged", rooms: row(ACTOR_ID).rooms }],
    ]) {
      const fakeClient = client(rows);
      const built = createServerMeetingRosterDependencies({
        environment: environment(),
        createClient: () => fakeClient,
      });
      expect(built.ok).toBe(true);
      if (!built.ok) continue;
      await expect(
        built.dependencies.loadRoster(ROOM_ID, ACTOR_ID),
      ).resolves.toEqual({ ok: false });
    }
  });
});
