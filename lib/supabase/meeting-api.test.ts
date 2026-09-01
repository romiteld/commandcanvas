import { describe, expect, it, vi } from "vitest";

import {
  clearBrowserMeetingRequestState,
  createBrowserMeetingApi,
} from "@/lib/supabase/meeting-api";

const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJob3N0In0.signature";
const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const ACTOR_A = "22222222-2222-4222-8222-222222222222";
const ACTOR_B = "33333333-3333-4333-8333-333333333333";

describe("browser meeting API", () => {
  it("authenticates and validates standard meeting responses", async () => {
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
          ok: true,
          meeting: { roomId: ROOM_ID, role: "host", joined: true },
        }),
        { status: 201, headers: { "content-type": "application/json" } },
      ),
    );
    const api = createBrowserMeetingApi({ accessToken: JWT, fetcher });

    const result = await api.createMeeting({
      name: "Product review",
      displayName: "Danny",
      color: "#0ea5e9",
    });

    expect(result.ok).toBe(true);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/meetings",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ authorization: `Bearer ${JWT}` }),
      }),
    );
  });

  it("recovers a lost room-creation response with one persisted non-PII request id", async () => {
    const persisted = new Map<string, string>();
    const requestStorage = {
      getItem: vi.fn((key: string) => persisted.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => persisted.set(key, value)),
      removeItem: vi.fn((key: string) => persisted.delete(key)),
    };
    const draft = {
      name: "Project review",
      displayName: "Daniel",
      color: "#0ea5e9",
    };
    const firstFetch = vi.fn<typeof fetch>(
      async (): Promise<Response> => {
        throw new TypeError("lost response");
      },
    );
    const firstApi = createBrowserMeetingApi({
      accessToken: JWT,
      actorUserId: ACTOR_A,
      fetcher: firstFetch,
      createRequestId: () => "55555555-5555-4555-8555-555555555555",
      meetingRequestStorage: requestStorage,
    });

    await expect(firstApi.createMeeting(draft)).resolves.toMatchObject({
      ok: false,
      error: { code: "request_failed" },
    });
    const firstBody = JSON.parse(String(firstFetch.mock.calls[0]?.[1]?.body));
    expect(firstBody.requestId).toBe("55555555-5555-4555-8555-555555555555");
    expect(JSON.stringify([...persisted.entries()])).not.toContain("Daniel");
    expect(JSON.stringify([...persisted.entries()])).not.toContain("Project review");

    const secondFetch = vi.fn<typeof fetch>(async () =>
      Response.json({
        ok: true,
        meeting: { roomId: firstBody.requestId, role: "host", joined: true },
      }),
    );
    const createAnotherId = vi.fn(
      () => "66666666-6666-4666-8666-666666666666",
    );
    const recreated = createBrowserMeetingApi({
      accessToken: JWT,
      actorUserId: ACTOR_A,
      fetcher: secondFetch,
      createRequestId: createAnotherId,
      meetingRequestStorage: requestStorage,
    });

    await expect(recreated.createMeeting(draft)).resolves.toEqual({
      ok: true,
      value: { roomId: firstBody.requestId, role: "host", joined: true },
    });
    const retryBody = JSON.parse(String(secondFetch.mock.calls[0]?.[1]?.body));
    expect(retryBody.requestId).toBe(firstBody.requestId);
    expect(createAnotherId).not.toHaveBeenCalled();
    expect(persisted.size).toBe(0);
  });

  it("isolates lost-response room request IDs by actor and clears only the actor who signs out", async () => {
    const persisted = new Map<string, string>();
    const requestStorage = {
      getItem: vi.fn((key: string) => persisted.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => persisted.set(key, value)),
      removeItem: vi.fn((key: string) => persisted.delete(key)),
    };
    const draft = {
      name: "Shared default room",
      displayName: "Same visible name",
      color: "#0ea5e9",
    };
    const actorAFetch = vi.fn<typeof fetch>(async () => {
      throw new TypeError("lost actor A response");
    });
    const actorBFetch = vi.fn<typeof fetch>(async () => {
      throw new TypeError("lost actor B response");
    });
    const actorA = createBrowserMeetingApi({
      accessToken: JWT,
      actorUserId: ACTOR_A,
      fetcher: actorAFetch,
      createRequestId: () => "44444444-4444-4444-8444-444444444444",
      meetingRequestStorage: requestStorage,
    });
    const actorB = createBrowserMeetingApi({
      accessToken: JWT,
      actorUserId: ACTOR_B,
      fetcher: actorBFetch,
      createRequestId: () => "55555555-5555-4555-8555-555555555555",
      meetingRequestStorage: requestStorage,
    });

    await actorA.createMeeting(draft);
    await actorB.createMeeting(draft);
    const actorARequest = JSON.parse(
      String(actorAFetch.mock.calls[0]?.[1]?.body),
    );
    const actorBRequest = JSON.parse(
      String(actorBFetch.mock.calls[0]?.[1]?.body),
    );
    expect(actorARequest.requestId).not.toBe(actorBRequest.requestId);
    expect(JSON.stringify([...persisted.entries()])).not.toContain(
      "Shared default room",
    );
    expect(JSON.stringify([...persisted.entries()])).not.toContain(
      "Same visible name",
    );

    const createReplacementId = vi.fn(
      () => "66666666-6666-4666-8666-666666666666",
    );
    const actorARecreatedFetch = vi.fn<typeof fetch>(async () =>
      Response.json({
        ok: true,
        meeting: {
          roomId: actorARequest.requestId,
          role: "host",
          joined: true,
        },
      }),
    );
    const actorARecreated = createBrowserMeetingApi({
      accessToken: JWT,
      actorUserId: ACTOR_A,
      fetcher: actorARecreatedFetch,
      createRequestId: createReplacementId,
      meetingRequestStorage: requestStorage,
    });
    await actorARecreated.createMeeting(draft);
    expect(
      JSON.parse(String(actorARecreatedFetch.mock.calls[0]?.[1]?.body))
        .requestId,
    ).toBe(actorARequest.requestId);
    expect(createReplacementId).not.toHaveBeenCalled();

    await clearBrowserMeetingRequestState({
      actorUserId: ACTOR_B,
      meetingRequestStorage: requestStorage,
      invitationRequestStorage: requestStorage,
    });
    const actorBAfterSignOutFetch = vi.fn<typeof fetch>(async () => {
      throw new TypeError("lost replacement response");
    });
    const actorBAfterSignOut = createBrowserMeetingApi({
      accessToken: JWT,
      actorUserId: ACTOR_B,
      fetcher: actorBAfterSignOutFetch,
      createRequestId: () => "77777777-7777-4777-8777-777777777777",
      meetingRequestStorage: requestStorage,
    });
    await actorBAfterSignOut.createMeeting(draft);
    expect(
      JSON.parse(String(actorBAfterSignOutFetch.mock.calls[0]?.[1]?.body))
        .requestId,
    ).toBe("77777777-7777-4777-8777-777777777777");
  });

  it("retains one invitation request UUID across a lost response retry", async () => {
    const invitation = {
      invitationId: "33333333-3333-4333-8333-333333333333",
      roomId: ROOM_ID,
      expiresAt: "2026-08-30T12:00:00.000Z",
      joinUrl: `https://commandcanvas.example/meet#invite=${"a".repeat(43)}`,
      delivery: {
        status: "reconciling",
        message: "Invitation submission is being reconciled; copy the link if needed.",
      },
    };
    const fetcher = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("lost response"))
      .mockResolvedValueOnce(Response.json({ ok: true, invitation }))
      .mockResolvedValueOnce(
        Response.json({
          ok: true,
          invitation: {
            ...invitation,
            delivery: {
              status: "submitted",
              message: "Invitation was submitted to the email provider; delivery is pending.",
              providerId: "email_accepted_123",
            },
          },
        }),
      );
    const createRequestId = vi
      .fn()
      .mockReturnValueOnce("44444444-4444-4444-8444-444444444444")
      .mockReturnValueOnce("55555555-5555-4555-8555-555555555555");
    const api = createBrowserMeetingApi({
      accessToken: JWT,
      actorUserId: ACTOR_A,
      fetcher,
      createRequestId,
    });
    const input = {
      email: "Sarah@Example.com",
      displayName: "Sarah",
      color: "#a855f7",
      expiresInHours: 24,
    };
    await expect(api.createInvitation(ROOM_ID, input)).resolves.toMatchObject({
      ok: false,
      error: { code: "request_failed" },
    });
    await expect(api.createInvitation(ROOM_ID, input)).resolves.toEqual({
      ok: true,
      value: invitation,
    });
    await expect(api.createInvitation(ROOM_ID, input)).resolves.toMatchObject({
      ok: true,
      value: { delivery: { status: "submitted" } },
    });
    const first = JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
    const second = JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body));
    const third = JSON.parse(String(fetcher.mock.calls[2]?.[1]?.body));
    expect(first.requestId).toBe("44444444-4444-4444-8444-444444444444");
    expect(second.requestId).toBe(first.requestId);
    expect(third.requestId).toBe(first.requestId);
    expect(createRequestId).toHaveBeenCalledOnce();
  });

  it("recovers a lost invitation response after the browser API is recreated without storing PII", async () => {
    const persisted = new Map<string, string>();
    const invitationRequestStorage = {
      getItem: vi.fn((key: string) => persisted.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => {
        persisted.set(key, value);
      }),
      removeItem: vi.fn((key: string) => {
        persisted.delete(key);
      }),
    };
    const invitation = {
      invitationId: "33333333-3333-4333-8333-333333333333",
      roomId: ROOM_ID,
      expiresAt: "2026-08-30T12:00:00.000Z",
      joinUrl: `https://commandcanvas.example/meet#invite=${"a".repeat(43)}`,
      delivery: {
        status: "submitted" as const,
        message: "Invitation was submitted to the email provider; delivery is pending.",
        providerId: "email_accepted_123",
      },
    };
    const firstFetch = vi.fn().mockRejectedValueOnce(new TypeError("lost response"));
    const firstApi = createBrowserMeetingApi({
      accessToken: JWT,
      actorUserId: ACTOR_A,
      fetcher: firstFetch,
      createRequestId: () => "44444444-4444-4444-8444-444444444444",
      invitationRequestStorage,
    });
    const input = {
      email: "Sarah@Example.com",
      displayName: "Sarah Person",
      color: "#a855f7",
      expiresInHours: 24,
    };

    await expect(firstApi.createInvitation(ROOM_ID, input)).resolves.toMatchObject({
      ok: false,
      error: { code: "request_failed" },
    });
    // One hashed request key plus one hashed actor manifest; neither stores PII.
    expect(persisted.size).toBe(2);
    const persistedText = JSON.stringify([...persisted.entries()]);
    expect(persistedText).not.toContain("sarah@example.com");
    expect(persistedText).not.toContain("Sarah Person");
    expect(persistedText).not.toContain(JWT);

    const secondFetch = vi.fn(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        void input;
        void init;
        return Response.json({ ok: true, invitation });
      },
    );
    const secondCreateRequestId = vi.fn(
      () => "55555555-5555-4555-8555-555555555555",
    );
    const recreatedApi = createBrowserMeetingApi({
      accessToken: JWT,
      actorUserId: ACTOR_A,
      fetcher: secondFetch,
      createRequestId: secondCreateRequestId,
      invitationRequestStorage,
    });

    await expect(
      recreatedApi.createInvitation(ROOM_ID, input),
    ).resolves.toEqual({ ok: true, value: invitation });
    const firstBody = JSON.parse(String(firstFetch.mock.calls[0]?.[1]?.body));
    const retriedBody = JSON.parse(String(secondFetch.mock.calls[0]?.[1]?.body));
    expect(retriedBody.requestId).toBe(firstBody.requestId);
    expect(secondCreateRequestId).not.toHaveBeenCalled();
    expect(persisted.size).toBe(0);
  });

  it("does not share persisted invitation request IDs between actors", async () => {
    const persisted = new Map<string, string>();
    const requestStorage = {
      getItem: vi.fn((key: string) => persisted.get(key) ?? null),
      setItem: vi.fn((key: string, value: string) => persisted.set(key, value)),
      removeItem: vi.fn((key: string) => persisted.delete(key)),
    };
    const firstFetch = vi.fn<typeof fetch>(async () => {
      throw new TypeError("lost actor A response");
    });
    const secondFetch = vi.fn<typeof fetch>(async () => {
      throw new TypeError("lost actor B response");
    });
    const input = {
      email: "sarah@example.com",
      displayName: "Sarah",
      color: "#a855f7",
      expiresInHours: 24,
    };
    const first = createBrowserMeetingApi({
      accessToken: JWT,
      actorUserId: ACTOR_A,
      fetcher: firstFetch,
      createRequestId: () => "44444444-4444-4444-8444-444444444444",
      invitationRequestStorage: requestStorage,
    });
    const second = createBrowserMeetingApi({
      accessToken: JWT,
      actorUserId: ACTOR_B,
      fetcher: secondFetch,
      createRequestId: () => "55555555-5555-4555-8555-555555555555",
      invitationRequestStorage: requestStorage,
    });

    await first.createInvitation(ROOM_ID, input);
    await second.createInvitation(ROOM_ID, input);

    const firstBody = JSON.parse(String(firstFetch.mock.calls[0]?.[1]?.body));
    const secondBody = JSON.parse(String(secondFetch.mock.calls[0]?.[1]?.body));
    expect(firstBody.requestId).not.toBe(secondBody.requestId);
    expect(JSON.stringify([...persisted.entries()])).not.toContain(
      "sarah@example.com",
    );
    expect(JSON.stringify([...persisted.entries()])).not.toContain("Sarah");
  });

  it("does not trust malformed success envelopes", async () => {
    const api = createBrowserMeetingApi({
      accessToken: JWT,
      fetcher: vi.fn(async () =>
        new Response(JSON.stringify({ ok: true, meeting: { role: "host" } }), {
          status: 201,
        }),
      ),
    });
    expect(
      await api.createMeeting({
        name: "Product review",
        displayName: "Danny",
        color: "#0ea5e9",
      }),
    ).toMatchObject({ ok: false, error: { code: "invalid_response" } });
  });

  it("loads durable invitation delivery truth without treating submitted as delivered", async () => {
    const invitationId = "33333333-3333-4333-8333-333333333333";
    const fetcher = vi.fn(async () =>
      Response.json({
        ok: true,
        invitation: {
          invitationId,
          roomId: ROOM_ID,
          delivery: {
            status: "submitted",
            message: "Invitation was submitted to the email provider; delivery is pending.",
            providerId: "email_accepted_123",
          },
        },
      }),
    );
    const api = createBrowserMeetingApi({ accessToken: JWT, fetcher });

    await expect(
      api.loadInvitationDelivery(ROOM_ID, invitationId),
    ).resolves.toMatchObject({
      ok: true,
      value: { delivery: { status: "submitted" } },
    });
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(
      `/api/meetings/${ROOM_ID}/invitations?invitationId=${invitationId}`,
      expect.objectContaining({ method: "GET", cache: "no-store" }),
    );
  });
});
