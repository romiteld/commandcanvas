// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
  handleRealtimeSessionRequest,
  type RealtimeSessionRouteDependencies,
} from "@/lib/realtime-voice/route-handler";
import { createTestOpenAiApiKey } from "@/lib/testing/openai-key-fixture";

const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const ACTOR_ID = "22222222-2222-4222-8222-222222222222";
const AUTHORIZATION = "Bearer header.payload.signature";
const SESSION_OPENAI_API_KEY = createTestOpenAiApiKey(
  "test-session-only-commandcanvas-key",
);

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
    resolveSavedOpenAiApiKey: vi.fn(async () => null),
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
  openAiApiKey?: string | null;
  savedCredential?: boolean;
}) {
  const headers = new Headers();
  if (overrides?.authorization !== null)
    headers.set("authorization", overrides?.authorization ?? AUTHORIZATION);
  if (overrides?.roomId !== null)
    headers.set("x-commandcanvas-room-id", overrides?.roomId ?? ROOM_ID);
  headers.set("content-type", overrides?.contentType ?? "application/sdp");
  if (overrides?.openAiApiKey !== null)
    headers.set(
      "x-commandcanvas-openai-key",
      overrides?.openAiApiKey ?? SESSION_OPENAI_API_KEY,
    );
  if (overrides?.savedCredential)
    headers.set("x-commandcanvas-openai-credential", "saved");
  return new Request("https://commandcanvas.example/api/realtime/session", {
    method: "POST",
    headers,
    body: overrides?.body ?? "v=0\no=browser-offer",
  });
}

function requestWithUnboundedChunkedSdp() {
  let pullCount = 0;
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        pullCount += 1;
        if (pullCount === 1) {
          controller.enqueue(new Uint8Array(256 * 1_024));
          return;
        }
        if (pullCount === 2) {
          controller.enqueue(new Uint8Array([0x20]));
          return;
        }
        throw new Error("The handler read past its byte limit.");
      },
      cancel() {
        cancelled = true;
      },
    },
    { highWaterMark: 0 },
  );
  const headers = new Headers({
    authorization: AUTHORIZATION,
    "content-type": "application/sdp",
    "x-commandcanvas-room-id": ROOM_ID,
    "x-commandcanvas-openai-key": SESSION_OPENAI_API_KEY,
  });
  const chunkedRequest = new Request(
    "https://commandcanvas.example/api/realtime/session",
    {
      method: "POST",
      headers,
      body,
      duplex: "half",
    } as RequestInit & { duplex: "half" },
  );
  return {
    request: chunkedRequest,
    observation: () => ({ pullCount, cancelled }),
  };
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

  it("requires a bounded plausible session-only OpenAI key before admission", async () => {
    const missing = dependencies();
    const missingResponse = await handleRealtimeSessionRequest(
      request({ openAiApiKey: null }),
      missing,
    );
    expect(missingResponse.status).toBe(400);
    await expect(missingResponse.json()).resolves.toEqual({
      ok: false,
      error: {
        code: "invalid_openai_api_key",
        message: "Enter a valid OpenAI API key for this live voice session.",
      },
    });
    expect(missing.admitSession).not.toHaveBeenCalled();
    expect(missing.createCall).not.toHaveBeenCalled();

    const malformed = dependencies();
    const malformedResponse = await handleRealtimeSessionRequest(
      request({ openAiApiKey: "not-a-provider-key" }),
      malformed,
    );
    expect(malformedResponse.status).toBe(400);
    expect(malformed.admitSession).not.toHaveBeenCalled();
    expect(malformed.createCall).not.toHaveBeenCalled();
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

  it("resolves a verified member's saved key only on the server before provider work", async () => {
    const savedKey = `sk-saved-${"b".repeat(40)}`;
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
      resolveSavedOpenAiApiKey: vi.fn(async () => savedKey),
    });

    const response = await handleRealtimeSessionRequest(
      request({ openAiApiKey: null, savedCredential: true }),
      deps,
    );

    expect(response.status).toBe(200);
    expect(deps.resolveSavedOpenAiApiKey).toHaveBeenCalledWith(ACTOR_ID);
    expect(deps.createCall).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: savedKey }),
    );
    expect(await response.text()).not.toContain(savedKey);
  });

  it("refuses missing or ambiguous saved credentials before admission", async () => {
    const permanentVerifier = {
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
    };
    const missing = dependencies({
      verifier: permanentVerifier,
      verifyMembership: vi.fn(async () => ({
        ok: true as const,
        roomMode: "standard" as const,
      })),
    });
    const missingResponse = await handleRealtimeSessionRequest(
      request({ openAiApiKey: null, savedCredential: true }),
      missing,
    );
    expect(missingResponse.status).toBe(409);
    await expect(missingResponse.json()).resolves.toMatchObject({
      error: { code: "openai_credential_not_configured" },
    });
    expect(missing.admitSession).not.toHaveBeenCalled();
    expect(missing.createCall).not.toHaveBeenCalled();

    const ambiguous = dependencies({
      verifier: permanentVerifier,
      verifyMembership: vi.fn(async () => ({
        ok: true as const,
        roomMode: "standard" as const,
      })),
      resolveSavedOpenAiApiKey: vi.fn(async () => SESSION_OPENAI_API_KEY),
    });
    const ambiguousResponse = await handleRealtimeSessionRequest(
      request({ savedCredential: true }),
      ambiguous,
    );
    expect(ambiguousResponse.status).toBe(400);
    await expect(ambiguousResponse.json()).resolves.toMatchObject({
      error: { code: "ambiguous_openai_credential" },
    });
    expect(ambiguous.resolveSavedOpenAiApiKey).not.toHaveBeenCalled();
    expect(ambiguous.admitSession).not.toHaveBeenCalled();
  });

  it("distinguishes saved-credential storage failure from an unconfigured account", async () => {
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
      resolveSavedOpenAiApiKey: vi.fn(async () => {
        throw new Error("Vault unavailable");
      }),
    });

    const response = await handleRealtimeSessionRequest(
      request({ openAiApiKey: null, savedCredential: true }),
      deps,
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "openai_credential_unavailable" },
    });
    expect(deps.admitSession).not.toHaveBeenCalled();
    expect(deps.createCall).not.toHaveBeenCalled();
  });

  it("does not allow an account-saved credential in a no-signup demo room", async () => {
    const deps = dependencies({
      resolveSavedOpenAiApiKey: vi.fn(async () => SESSION_OPENAI_API_KEY),
    });

    const response = await handleRealtimeSessionRequest(
      request({ openAiApiKey: null, savedCredential: true }),
      deps,
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "saved_credential_unavailable" },
    });
    expect(deps.resolveSavedOpenAiApiKey).not.toHaveBeenCalled();
    expect(deps.admitSession).not.toHaveBeenCalled();
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
      apiKey: SESSION_OPENAI_API_KEY,
      sdp: "v=0\no=browser-offer",
      safetyIdentifier: "cc_voice_0123456789abcdef",
      signal: expect.any(AbortSignal),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/sdp");
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.text()).resolves.toBe("v=0\no=openai-answer");
  });

  it("never includes the submitted OpenAI key in provider failure responses", async () => {
    const deps = dependencies({
      createCall: vi.fn(async () => ({ ok: false as const })),
    });
    const response = await handleRealtimeSessionRequest(request(), deps);
    const serialized = await response.text();

    expect(response.status).toBe(503);
    expect(serialized).not.toContain(SESSION_OPENAI_API_KEY);
    expect(serialized).toBe(
      JSON.stringify({
        ok: false,
        error: {
          code: "realtime_unavailable",
          message: "Live voice is temporarily unavailable.",
        },
      }),
    );
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

  it("stops reading a chunked SDP body as soon as the actual byte cap is crossed", async () => {
    const deps = dependencies();
    const chunked = requestWithUnboundedChunkedSdp();

    const response = await handleRealtimeSessionRequest(chunked.request, deps);

    expect(response.status).toBe(413);
    expect(chunked.observation()).toEqual({ pullCount: 2, cancelled: true });
    expect(deps.admitSession).not.toHaveBeenCalled();
    expect(deps.createCall).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "request_too_large" },
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
