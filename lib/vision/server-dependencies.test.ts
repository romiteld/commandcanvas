// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import { createServerSketchTransformDependencies } from "@/lib/vision/server-dependencies";
import type { OpenAiDiagramTransformer } from "@/lib/vision/openai-diagram";

const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const ACTOR_ID = "22222222-2222-4222-8222-222222222222";
const LEASE_TOKEN = "33333333-3333-4333-8333-333333333333";
const REQUEST_KEY = `vision_v1_${"a".repeat(64)}`;

const diagramPayload = {
  kind: "architecture" as const,
  sourceSketchId: "sketch-source",
  interpretationSummary: "Browser to API.",
  nodes: [
    {
      id: "node-browser",
      label: "Browser",
      kind: "client" as const,
      x: 20,
      y: 40,
      width: 140,
      height: 64,
    },
  ],
  edges: [],
};

const admissionInput = {
  roomId: ROOM_ID,
  actorUserId: ACTOR_ID,
  sketchObjectId: "sketch-source",
  sourceVersion: 1,
  outputKind: "architecture" as const,
  normalizedInstructionSha256: "b".repeat(64),
  pngSha256: "c".repeat(64),
  requestKey: REQUEST_KEY,
};

function options(
  rpcResponder: (
    functionName: string,
    args: Record<string, unknown>,
  ) => { data: unknown; error: unknown },
) {
  const rpc = vi.fn(async (functionName: string, args: Record<string, unknown>) =>
    rpcResponder(functionName, args),
  );
  const queryPromise = Promise.resolve({ data: null, error: null });
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    order: vi.fn(() => query),
    maybeSingle: vi.fn(() => queryPromise),
    then: queryPromise.then.bind(queryPromise),
  };
  const client = {
    auth: {
      getUser: vi.fn(async () => ({ data: { user: null }, error: null })),
    },
    from: vi.fn(() => query),
    rpc,
  };
  const transformer: OpenAiDiagramTransformer = {
    transform: vi.fn(async () => ({
      ok: false as const,
      code: "vision_unconfigured" as const,
      message: "Sketch interpretation is not configured." as const,
    })),
  };

  return {
    rpc,
    value: {
      environment: {
        NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
        SUPABASE_SECRET_KEY: "test-supabase-server-key",
        OPENAI_API_KEY: "test-openai-key-not-real",
      },
      createClient: vi.fn(() => client),
      createTransformer: vi.fn(() => transformer),
      createLeaseToken: vi.fn(() => LEASE_TOKEN),
    },
  };
}

describe("server sketch transform admission dependencies", () => {
  it("uses the service-only admission RPC with an unguessable lease token", async () => {
    const setup = options((functionName, args) => {
      expect(functionName).toBe("admit_sketch_transform");
      expect(args).toEqual({
        p_room_id: ROOM_ID,
        p_actor_user_id: ACTOR_ID,
        p_sketch_object_id: "sketch-source",
        p_source_version: 1,
        p_output_kind: "architecture",
        p_normalized_instruction_sha256: "b".repeat(64),
        p_png_sha256: "c".repeat(64),
        p_request_key: REQUEST_KEY,
        p_lease_token: LEASE_TOKEN,
      });
      return {
        data: {
          outcome: "admitted",
          requestKey: REQUEST_KEY,
          leaseToken: LEASE_TOKEN,
          leaseExpiresAt: "2026-08-27T16:02:00.000Z",
        },
        error: null,
      };
    });
    const result = createServerSketchTransformDependencies(setup.value);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    await expect(result.dependencies.admitTransform(admissionInput)).resolves.toEqual({
      ok: true,
      outcome: "admitted",
      requestKey: REQUEST_KEY,
      leaseToken: LEASE_TOKEN,
      leaseExpiresAt: "2026-08-27T16:02:00.000Z",
    });
    expect(setup.rpc).toHaveBeenCalledTimes(1);
  });

  it("returns only a source-bound cached result and rejects malformed RPC output", async () => {
    const cached = options(() => ({
      data: {
        outcome: "cached",
        requestKey: REQUEST_KEY,
        transform: {
          model: "gpt-5.6-terra",
          responseId: "resp-cached",
          payload: diagramPayload,
        },
      },
      error: null,
    }));
    const cachedResult = createServerSketchTransformDependencies(cached.value);
    expect(cachedResult.ok).toBe(true);
    if (!cachedResult.ok) return;
    await expect(
      cachedResult.dependencies.admitTransform(admissionInput),
    ).resolves.toMatchObject({
      ok: true,
      outcome: "cached",
      requestKey: REQUEST_KEY,
      transform: { responseId: "resp-cached", payload: diagramPayload },
    });

    const wrongSource = options(() => ({
      data: {
        outcome: "cached",
        requestKey: REQUEST_KEY,
        transform: {
          model: "gpt-5.6-terra",
          responseId: "resp-wrong",
          payload: { ...diagramPayload, sourceSketchId: "sketch-other" },
        },
      },
      error: null,
    }));
    const wrongResult = createServerSketchTransformDependencies(wrongSource.value);
    expect(wrongResult.ok).toBe(true);
    if (!wrongResult.ok) return;
    await expect(
      wrongResult.dependencies.admitTransform(admissionInput),
    ).resolves.toEqual({ ok: false, code: "admission_unavailable" });

    const malformedPayload = options(() => ({
      data: {
        outcome: "cached",
        requestKey: REQUEST_KEY,
        transform: {
          model: "gpt-5.6-terra",
          responseId: "resp-malformed",
          payload: {
            ...diagramPayload,
            nodes: [{ id: "node-browser", label: "missing geometry" }],
          },
        },
      },
      error: null,
    }));
    const malformedResult = createServerSketchTransformDependencies(
      malformedPayload.value,
    );
    expect(malformedResult.ok).toBe(true);
    if (!malformedResult.ok) return;
    await expect(
      malformedResult.dependencies.admitTransform(admissionInput),
    ).resolves.toEqual({ ok: false, code: "admission_unavailable" });
  });

  it("preserves compact admission denials without exposing database errors", async () => {
    const denied = options(() => ({
      data: {
        outcome: "denied",
        code: "room_transform_busy",
        retryAfterSeconds: 42,
      },
      error: null,
    }));
    const deniedResult = createServerSketchTransformDependencies(denied.value);
    expect(deniedResult.ok).toBe(true);
    if (!deniedResult.ok) return;
    await expect(
      deniedResult.dependencies.admitTransform(admissionInput),
    ).resolves.toEqual({
      ok: false,
      code: "room_transform_busy",
      retryAfterSeconds: 42,
    });

    const errored = options(() => ({
      data: { secret: "must not escape" },
      error: { message: "database detail must not escape" },
    }));
    const erroredResult = createServerSketchTransformDependencies(errored.value);
    expect(erroredResult.ok).toBe(true);
    if (!erroredResult.ok) return;
    const result = await erroredResult.dependencies.admitTransform(admissionInput);
    expect(result).toEqual({ ok: false, code: "admission_unavailable" });
    expect(JSON.stringify(result)).not.toContain("database detail");
  });

  it.each([
    "demo_actor_daily_limit",
    "demo_global_daily_limit",
  ] as const)(
    "maps the exact database circuit-breaker error %s to a compact denial",
    async (code) => {
      const denied = options(() => ({
        data: null,
        error: {
          code: "P0001",
          message: code,
          details: "private quota implementation detail",
          hint: "private quota hint",
        },
      }));
      const deniedResult = createServerSketchTransformDependencies(denied.value);
      expect(deniedResult.ok).toBe(true);
      if (!deniedResult.ok) return;

      const result = await deniedResult.dependencies.admitTransform(
        admissionInput,
      );

      expect(result).toEqual({
        ok: false,
        code,
        retryAfterSeconds: expect.any(Number),
      });
      if (result.ok || result.code === "admission_unavailable") return;
      expect(result.retryAfterSeconds).toBeGreaterThanOrEqual(1);
      expect(result.retryAfterSeconds).toBeLessThanOrEqual(86_400);
      expect(JSON.stringify(result)).not.toContain("private quota");
    },
  );

  it("completes and releases only through lease-bound RPCs", async () => {
    const setup = options((functionName, args) => {
      if (functionName === "complete_sketch_transform") {
        expect(args).toEqual({
          p_request_key: REQUEST_KEY,
          p_lease_token: LEASE_TOKEN,
          p_model: "gpt-5.6-terra",
          p_provider_response_id: "resp-diagram-1",
          p_payload: diagramPayload,
        });
        return { data: { completed: true }, error: null };
      }
      expect(functionName).toBe("release_sketch_transform");
      expect(args).toEqual({
        p_request_key: REQUEST_KEY,
        p_lease_token: LEASE_TOKEN,
        p_error_code: "provider_unavailable",
      });
      return { data: { released: true }, error: null };
    });
    const result = createServerSketchTransformDependencies(setup.value);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    await expect(
      result.dependencies.completeTransform({
        requestKey: REQUEST_KEY,
        leaseToken: LEASE_TOKEN,
        model: "gpt-5.6-terra",
        responseId: "resp-diagram-1",
        payload: diagramPayload,
      }),
    ).resolves.toEqual({ ok: true });
    await expect(
      result.dependencies.releaseTransform({
        requestKey: REQUEST_KEY,
        leaseToken: LEASE_TOKEN,
        errorCode: "provider_unavailable",
      }),
    ).resolves.toEqual({ ok: true });
  });
});
