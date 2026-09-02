// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
  handleMeetingRosterRequest,
  type MeetingRosterRouteDependencies,
} from "@/lib/meeting/media-roster-route";

const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const ACTOR_ID = "22222222-2222-4222-8222-222222222222";
const REMOTE_ID = "33333333-3333-4333-8333-333333333333";

function dependencies(
  overrides: Partial<MeetingRosterRouteDependencies> = {},
): MeetingRosterRouteDependencies {
  return {
    verifier: {
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: { id: ACTOR_ID, is_anonymous: true } },
          error: null,
        })),
      },
    },
    loadRoster: vi.fn(async () => ({
      ok: true as const,
      status: "eligible" as const,
      participantIds: [ACTOR_ID, REMOTE_ID],
    })),
    ...overrides,
  };
}

function request(authorization = "Bearer header.payload.signature") {
  return new Request(
    `https://commandcanvas.example/api/rooms/${ROOM_ID}/media/roster`,
    { headers: { authorization } },
  );
}

describe("authoritative meeting roster route", () => {
  it("binds the roster lookup to the authenticated room actor", async () => {
    const deps = dependencies();
    const response = await handleMeetingRosterRequest(request(), ROOM_ID, deps);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(deps.loadRoster).toHaveBeenCalledWith(ROOM_ID, ACTOR_ID);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      status: "eligible",
      participantIds: [ACTOR_ID, REMOTE_ID],
    });
  });

  it("returns over-capacity without disclosing any room member ids", async () => {
    const deps = dependencies({
      loadRoster: vi.fn(async () => ({
        ok: true as const,
        status: "over_capacity" as const,
      })),
    });
    const response = await handleMeetingRosterRequest(request(), ROOM_ID, deps);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      ok: true,
      status: "over_capacity",
    });
    expect(JSON.stringify(body)).not.toContain(ACTOR_ID);
    expect(JSON.stringify(body)).not.toContain(REMOTE_ID);
  });

  it("fails closed before returning ids when auth or active membership is unavailable", async () => {
    const unauthenticated = dependencies();
    const authResponse = await handleMeetingRosterRequest(
      new Request(`https://commandcanvas.example/api/rooms/${ROOM_ID}/media/roster`),
      ROOM_ID,
      unauthenticated,
    );
    expect(authResponse.status).toBe(401);
    expect(unauthenticated.loadRoster).not.toHaveBeenCalled();

    const outsider = dependencies({
      loadRoster: vi.fn(async () => ({ ok: false as const })),
    });
    const outsiderResponse = await handleMeetingRosterRequest(
      request(),
      ROOM_ID,
      outsider,
    );
    expect(outsiderResponse.status).toBe(403);
    await expect(outsiderResponse.json()).resolves.toMatchObject({
      ok: false,
      error: { code: "member_required" },
    });
  });
});
