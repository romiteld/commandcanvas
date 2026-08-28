// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
  handleRealtimeSessionRequest,
  type RealtimeSessionRouteDependencies,
} from "@/lib/realtime-voice/route-handler";

const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const ACTOR_ID = "22222222-2222-4222-8222-222222222222";
const AUTHORIZATION = "Bearer header.payload.signature";

function dependencies(
  overrides: Partial<RealtimeSessionRouteDependencies> = {},
): RealtimeSessionRouteDependencies {
  return {
    verifier: {
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: { id: ACTOR_ID, is_anonymous: true } },
          error: null,
        })),
      },
    },
    verifyMembership: vi.fn(async () => ({
      ok: true as const,
      roomMode: "demo" as const,
    })),
    admitSession: vi.fn(async () => ({ ok: true as const })),
    createCall: vi.fn(async () => ({
      ok: true as const,
      sdp: "v=0\no=openai-answer",
    })),
    safetyIdentifier: vi.fn(() => "cc_voice_0123456789abcdef"),
    ...overrides,
  };
}

function request(overrides?: {
  authorization?: string | null;
  roomId?: string | null;
  contentType?: string;
  body?: string;
}) {
  const headers = new Headers();
  if (overrides?.authorization !== null)
    headers.set("authorization", overrides?.authorization ?? AUTHORIZATION);
  if (overrides?.roomId !== null)
    headers.set("x-commandcanvas-room-id", overrides?.roomId ?? ROOM_ID);
  headers.set("content-type", overrides?.contentType ?? "application/sdp");
  return new Request("https://commandcanvas.example/api/realtime/session", {
    method: "POST",
    headers,
    body: overrides?.body ?? "v=0\no=browser-offer",
  });
}

describe("Realtime session route", () => {
  it("refuses unauthenticated SDP before provider work", async () => {
    const deps = dependencies();
    const response = await handleRealtimeSessionRequest(
      request({ authorization: null }),
      deps,
    );

    expect(response.status).toBe(401);
    expect(deps.verifyMembership).not.toHaveBeenCalled();
    expect(deps.createCall).not.toHaveBeenCalled();
  });

  it("requires application/sdp and a valid room membership", async () => {
    const wrongType = dependencies();
    const wrongTypeResponse = await handleRealtimeSessionRequest(
      request({ contentType: "application/json" }),
      wrongType,
    );
    expect(wrongTypeResponse.status).toBe(415);
    expect(wrongType.createCall).not.toHaveBeenCalled();

    const notMember = dependencies({
      verifyMembership: vi.fn(async () => ({ ok: false as const })),
    });
    const notMemberResponse = await handleRealtimeSessionRequest(
      request(),
      notMember,
    );
    expect(notMemberResponse.status).toBe(403);
    expect(notMember.createCall).not.toHaveBeenCalled();
  });

  it("admits a verified permanent member of a standard room through the same provider path", async () => {
    const deps = dependencies({
      verifier: {
        auth: {
          getUser: vi.fn(async () => ({
            data: {
              user: {
                id: ACTOR_ID,
                email: "danny@example.com",
                email_confirmed_at: "2026-08-28T12:00:00.000Z",
                is_anonymous: false,
              },
            },
            error: null,
          })),
        },
      },
      verifyMembership: vi.fn(async () => ({
        ok: true as const,
        roomMode: "standard" as const,
      })),
    });

    const response = await handleRealtimeSessionRequest(request(), deps);

    expect(response.status).toBe(200);
    expect(deps.admitSession).toHaveBeenCalledWith(ROOM_ID, ACTOR_ID);
    expect(deps.createCall).toHaveBeenCalledOnce();
  });

  it("refuses an anonymous identity in a standard room before admission or paid provider work", async () => {
    const deps = dependencies({
      verifyMembership: vi.fn(async () => ({
        ok: true as const,
        roomMode: "standard" as const,
      })),
    });

    const response = await handleRealtimeSessionRequest(request(), deps);

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: {
        code: "permanent_email_auth_required",
        message: "Verify your email before using live voice in a meeting room.",
      },
    });
    expect(deps.admitSession).not.toHaveBeenCalled();
    expect(deps.createCall).not.toHaveBeenCalled();
  });

  it("passes bounded SDP and a backend-derived safety identifier to the provider", async () => {
    const deps = dependencies();
    const response = await handleRealtimeSessionRequest(request(), deps);

    expect(deps.verifyMembership).toHaveBeenCalledWith(ROOM_ID, ACTOR_ID);
    expect(deps.safetyIdentifier).toHaveBeenCalledWith(ACTOR_ID);
    expect(deps.admitSession).toHaveBeenCalledWith(ROOM_ID, ACTOR_ID);
    expect(deps.createCall).toHaveBeenCalledWith({
      sdp: "v=0\no=browser-offer",
      safetyIdentifier: "cc_voice_0123456789abcdef",
      signal: expect.any(AbortSignal),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/sdp");
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.text()).resolves.toBe("v=0\no=openai-answer");
  });

  it("rejects oversized SDP and sanitizes provider failures", async () => {
    const oversized = dependencies();
    const largeRequest = request();
    largeRequest.headers.set("content-length", String(256 * 1024 + 1));
    const largeResponse = await handleRealtimeSessionRequest(
      largeRequest,
      oversized,
    );
    expect(largeResponse.status).toBe(413);
    expect(oversized.createCall).not.toHaveBeenCalled();

    const failed = dependencies({
      createCall: vi.fn(async () => ({ ok: false as const })),
    });
    const failedResponse = await handleRealtimeSessionRequest(request(), failed);
    expect(failedResponse.status).toBe(503);
    await expect(failedResponse.json()).resolves.toEqual({
      ok: false,
      error: {
        code: "realtime_unavailable",
        message: "Live voice is temporarily unavailable.",
      },
    });
  });

  it("durably rate-limits before creating a paid provider call", async () => {
    const deps = dependencies({
      admitSession: vi.fn(async () => ({
        ok: false as const,
        code: "rate_limited" as const,
        retryAfterSeconds: 73,
      })),
    });

    const response = await handleRealtimeSessionRequest(request(), deps);

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("73");
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: {
        code: "voice_rate_limited",
        message: "Live voice has reached its usage limit. Try again later.",
      },
    });
    expect(deps.createCall).not.toHaveBeenCalled();
  });

  it("fails closed when durable session admission is unavailable", async () => {
    const deps = dependencies({
      admitSession: vi.fn(async () => ({
        ok: false as const,
        code: "admission_unavailable" as const,
      })),
    });

    const response = await handleRealtimeSessionRequest(request(), deps);

    expect(response.status).toBe(503);
    expect(deps.createCall).not.toHaveBeenCalled();
  });
});
