// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
  createOpenAiRealtimeCall,
  createRealtimeSafetyIdentifier,
  createServerRealtimeSessionDependencies,
} from "@/lib/realtime-voice/server-dependencies";
import { createTestOpenAiApiKey } from "@/lib/testing/openai-key-fixture";

const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const ACTOR_ID = "22222222-2222-4222-8222-222222222222";

const serverEnvironment = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-test-key",
  SUPABASE_SECRET_KEY: "server-secret-key-that-stays-private",
  REALTIME_VOICE_ENABLED: "true",
  OPENAI_REALTIME_API_KEY: createTestOpenAiApiKey(
    "server-key-must-never-be-used-for-public-voice",
  ),
  OPENAI_API_KEY: "general-openai-key-must-not-enable-realtime",
};

const SESSION_OPENAI_API_KEY = createTestOpenAiApiKey(
  "test-session-only-commandcanvas-key",
);

describe("OpenAI Realtime unified-interface boundary", () => {
  it("fails closed without server-side Supabase configuration", () => {
    expect(
      createServerRealtimeSessionDependencies({ environment: {} }),
    ).toEqual({ ok: false });
  });

  it("requires the voice kill switch but never a server-owned OpenAI key", () => {
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: vi.fn(),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    const createClient = () => ({
      auth: { getUser: vi.fn() },
      from: vi.fn(() => query),
      rpc: vi.fn(),
    });
    expect(
      createServerRealtimeSessionDependencies({
        environment: {
          ...serverEnvironment,
          REALTIME_VOICE_ENABLED: "false",
        },
        createClient,
      }),
    ).toEqual({ ok: false });

    const withoutServerOpenAiKey = createServerRealtimeSessionDependencies({
        environment: {
          ...serverEnvironment,
          OPENAI_REALTIME_API_KEY: undefined,
          OPENAI_API_KEY: undefined,
        },
        createClient,
      });
    expect(withoutServerOpenAiKey.ok).toBe(true);
  });

  it("uses only the session-supplied OpenAI key for provider authorization", async () => {
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: vi.fn(),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    const fetcher = vi.fn<typeof fetch>(async () =>
      new Response("v=0\no=openai-answer", { status: 200 }),
    );
    const result = createServerRealtimeSessionDependencies({
      environment: serverEnvironment,
      createClient: () => ({
        auth: { getUser: vi.fn() },
        from: vi.fn(() => query),
        rpc: vi.fn(),
      }),
      fetch: fetcher,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    await result.dependencies.createCall({
      apiKey: SESSION_OPENAI_API_KEY,
      sdp: "v=0\no=browser-offer",
      safetyIdentifier: "cc_voice_0123456789abcdef",
      signal: new AbortController().signal,
    });

    const [, init] = fetcher.mock.calls[0]!;
    expect(init?.headers).toEqual(
      expect.objectContaining({
        authorization: `Bearer ${SESSION_OPENAI_API_KEY}`,
      }),
    );
    expect(JSON.stringify(init)).not.toContain(
      serverEnvironment.OPENAI_REALTIME_API_KEY,
    );
    expect(JSON.stringify(init)).not.toContain(serverEnvironment.OPENAI_API_KEY);
  });

  it("uses a service-only durable admission RPC before paid session creation", async () => {
    const rpc = vi.fn(async () => ({
      data: { outcome: "admitted" },
      error: null,
    }));
    const membershipResult = {
      data: {
        role: "host",
        rooms: {
          mode: "demo",
          created_at: "2026-09-01T00:00:00.000Z",
          demo_hard_expires_at: "2099-09-02T00:00:00.000Z",
        },
      },
      error: null,
    };
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: vi.fn(async () => membershipResult),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    const client = {
      auth: { getUser: vi.fn() },
      from: vi.fn(() => query),
      rpc,
    };
    const result = createServerRealtimeSessionDependencies({
      environment: serverEnvironment,
      createClient: () => client,
      fetch: vi.fn(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    await expect(
      result.dependencies.verifyMembership(ROOM_ID, ACTOR_ID),
    ).resolves.toEqual({ ok: true, roomMode: "demo" });
    expect(query.select).toHaveBeenCalledWith(
      "role, rooms!inner(mode,created_at,demo_hard_expires_at)",
    );

    await expect(
      result.dependencies.admitSession(ROOM_ID, ACTOR_ID),
    ).resolves.toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("admit_realtime_voice_session", {
      p_room_id: ROOM_ID,
      p_actor_user_id: ACTOR_ID,
    });
  });

  it("fails service-role membership closed after demo hard expiry", async () => {
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: vi.fn(async () => ({
        data: {
          role: "host",
          rooms: {
            mode: "demo",
            created_at: "2026-08-30T00:00:00.000Z",
            demo_hard_expires_at: "2026-08-31T00:00:00.000Z",
          },
        },
        error: null,
      })),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    const result = createServerRealtimeSessionDependencies({
      environment: serverEnvironment,
      createClient: () => ({
        auth: { getUser: vi.fn() },
        from: vi.fn(() => query),
        rpc: vi.fn(),
      }),
      fetch: vi.fn(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    await expect(
      result.dependencies.verifyMembership(ROOM_ID, ACTOR_ID),
    ).resolves.toEqual({ ok: false });
  });

  it("wires the account-owned saved credential resolver without reading owner OpenAI environment keys", async () => {
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: vi.fn(),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    const resolveSavedOpenAiApiKey = vi.fn(async () => SESSION_OPENAI_API_KEY);
    const result = createServerRealtimeSessionDependencies({
      environment: serverEnvironment,
      createClient: () => ({
        auth: { getUser: vi.fn() },
        from: vi.fn(() => query),
        rpc: vi.fn(),
      }),
      resolveSavedOpenAiApiKey,
      fetch: vi.fn(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    await expect(
      result.dependencies.resolveSavedOpenAiApiKey(ACTOR_ID),
    ).resolves.toBe(SESSION_OPENAI_API_KEY);
    expect(resolveSavedOpenAiApiKey).toHaveBeenCalledWith(ACTOR_ID);
    expect(resolveSavedOpenAiApiKey).not.toHaveBeenCalledWith(
      serverEnvironment.OPENAI_API_KEY,
    );
  });

  it("preserves compact durable rate denials without leaking database errors", async () => {
    const rpc = vi.fn(async () => ({
      data: {
        outcome: "denied",
        code: "voice_actor_rate_limit",
        retryAfterSeconds: 91,
      },
      error: null,
    }));
    const query = {
      select: vi.fn(),
      eq: vi.fn(),
      maybeSingle: vi.fn(),
    };
    query.select.mockReturnValue(query);
    query.eq.mockReturnValue(query);
    const result = createServerRealtimeSessionDependencies({
      environment: serverEnvironment,
      createClient: () => ({
        auth: { getUser: vi.fn() },
        from: vi.fn(() => query),
        rpc,
      }),
      fetch: vi.fn(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    await expect(
      result.dependencies.admitSession(ROOM_ID, ACTOR_ID),
    ).resolves.toEqual({
      ok: false,
      code: "rate_limited",
      retryAfterSeconds: 91,
    });
  });

  it("uses a standard server key, multipart SDP/session fields, and privacy header", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      new Response("v=0\no=openai-answer", {
        status: 200,
        headers: { "content-type": "application/sdp" },
      }),
    );

    const result = await createOpenAiRealtimeCall(
      {
        apiKey: "test-openai-key-not-real",
        sdp: "v=0\no=browser-offer",
        safetyIdentifier: "cc_voice_0123456789abcdef",
        signal: new AbortController().signal,
      },
      fetcher,
    );

    expect(result).toEqual({ ok: true, sdp: "v=0\no=openai-answer" });
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe("https://api.openai.com/v1/realtime/calls");
    expect(init?.headers).toEqual({
      authorization: "Bearer test-openai-key-not-real",
      "openai-safety-identifier": "cc_voice_0123456789abcdef",
    });
    const body = init?.body as FormData;
    expect(body.get("sdp")).toBe("v=0\no=browser-offer");
    expect(JSON.parse(String(body.get("session")))).toMatchObject({
      type: "realtime",
      model: "gpt-realtime-2.1",
      output_modalities: ["audio"],
      max_output_tokens: 4_096,
      parallel_tool_calls: false,
      audio: {
        input: {
          transcription: { model: "gpt-live-transcribe" },
          turn_detection: {
            type: "semantic_vad",
            eagerness: "auto",
            create_response: true,
            interrupt_response: true,
          },
        },
        output: { voice: "marin" },
      },
      tool_choice: "auto",
    });
    const session = JSON.parse(String(body.get("session")));
    expect(session.tools.map((tool: { name: string }) => tool.name)).toEqual(
      expect.arrayContaining([
        "create_semantic_object",
        "transform_selected_sketch",
        "undo",
      ]),
    );
    expect(session.tools.map((tool: { name: string }) => tool.name)).toContain(
      "discard_selected",
    );
    expect(session.instructions).toMatch(/submitted/i);
    expect(session.instructions).toMatch(/explicitly asks to discard/i);
    expect(session.instructions).toMatch(/recoverable trash/i);
  });

  it("derives a stable privacy-preserving identifier without exposing the actor id", () => {
    const actorId = "22222222-2222-4222-8222-222222222222";
    const first = createRealtimeSafetyIdentifier(actorId, "server-secret");
    const second = createRealtimeSafetyIdentifier(actorId, "server-secret");

    expect(first).toBe(second);
    expect(first).toMatch(/^cc_voice_[0-9a-f]{24}$/);
    expect(first).not.toContain(actorId);
  });
});
