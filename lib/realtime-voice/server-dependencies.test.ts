// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
  createOpenAiRealtimeCall,
  createRealtimeSafetyIdentifier,
  createServerRealtimeSessionDependencies,
} from "@/lib/realtime-voice/server-dependencies";

const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const ACTOR_ID = "22222222-2222-4222-8222-222222222222";

const serverEnvironment = {
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "publishable-test-key",
  SUPABASE_SECRET_KEY: "server-secret-key-that-stays-private",
  REALTIME_VOICE_ENABLED: "true",
  OPENAI_REALTIME_API_KEY: "realtime-test-key-that-stays-server-side",
  OPENAI_API_KEY: "general-openai-key-must-not-enable-realtime",
};

describe("OpenAI Realtime unified-interface boundary", () => {
  it("fails closed without both server-side Supabase and OpenAI configuration", () => {
    expect(
      createServerRealtimeSessionDependencies({ environment: {} }),
    ).toEqual({ ok: false });
  });

  it("requires an explicit voice flag and dedicated Realtime key", () => {
    expect(
      createServerRealtimeSessionDependencies({
        environment: {
          ...serverEnvironment,
          REALTIME_VOICE_ENABLED: "false",
        },
      }),
    ).toEqual({ ok: false });
    expect(
      createServerRealtimeSessionDependencies({
        environment: {
          ...serverEnvironment,
          OPENAI_REALTIME_API_KEY: undefined,
        },
      }),
    ).toEqual({ ok: false });
  });

  it("uses a service-only durable admission RPC before paid session creation", async () => {
    const rpc = vi.fn(async () => ({
      data: { outcome: "admitted" },
      error: null,
    }));
    const membershipResult = {
      data: { role: "host", rooms: { mode: "demo" } },
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
    expect(query.select).toHaveBeenCalledWith("role, rooms!inner(mode)");

    await expect(
      result.dependencies.admitSession(ROOM_ID, ACTOR_ID),
    ).resolves.toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("admit_realtime_voice_session", {
      p_room_id: ROOM_ID,
      p_actor_user_id: ACTOR_ID,
    });
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
      max_output_tokens: 256,
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
        "create_note",
        "create_board",
        "transform_selected_sketch",
        "undo",
      ]),
    );
    expect(session.tools.map((tool: { name: string }) => tool.name)).not.toContain(
      "discard_object",
    );
    expect(session.instructions).toMatch(/submitted/i);
    expect(session.instructions).toMatch(/never discard/i);
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
