import { describe, expect, it, vi } from "vitest";

import {
  applyCanvasCommand,
  createEmptyCanvasState,
  type CanvasState,
} from "@/lib/canvas/command-engine";
import {
  handleSketchTransformRequest,
  type SketchTransformRouteDependencies,
} from "@/lib/vision/route-handler";

const ROOM_ID = "d32af6a9-31dd-4dfc-98d5-fcf439b9b106";
const ACTOR_ID = "96ceecfe-ab18-4fda-9591-9945a73fe709";
const AUTHORIZATION = "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.signature";
const OPENAI_API_KEY = `sk-session-${"a".repeat(40)}`;
const PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const REQUEST_KEY =
  "vision_v1_62579e5ed2652441fce99b9d3ac018c5c4b1e779ba535c729d49eeeddb3057a5";
const LEASE_TOKEN = "33333333-3333-4333-8333-333333333333";

const diagramPayload = {
  kind: "architecture" as const,
  sourceSketchId: "sketch-source",
  interpretationSummary: "Browser, API, and database.",
  nodes: [
    {
      id: "node-browser",
      label: "Browser",
      kind: "client" as const,
      x: 20,
      y: 80,
      width: 140,
      height: 64,
    },
    {
      id: "node-api",
      label: "API",
      kind: "service" as const,
      x: 240,
      y: 80,
      width: 140,
      height: 64,
    },
  ],
  edges: [{ id: "edge-browser-api", from: "node-browser", to: "node-api" }],
};
const barChartPayload = {
  kind: "bar_chart" as const,
  sourceSketchId: "sketch-source",
  interpretationSummary: "Two values transcribed from the sketch.",
  chart: {
    title: "Participants",
    xAxisLabel: "Team",
    yAxisLabel: "People",
    series: [
      {
        id: "series-people",
        label: "People",
        points: [
          { label: "Design", value: 3 },
          { label: "Engineering", value: 8 },
        ],
      },
    ],
  },
};

function canvasWithSketch(): CanvasState {
  const initial = createEmptyCanvasState(ROOM_ID);
  const result = applyCanvasCommand(
    initial,
    {
      id: "command-create-sketch",
      roomId: ROOM_ID,
      baseRevision: 0,
      issuedAt: "2026-08-27T14:00:00.000Z",
      actor: { id: ACTOR_ID, displayName: "Daniel", type: "human" },
      source: "pointer",
      command: {
        type: "object.create",
        object: {
          id: "sketch-source",
          type: "sketch",
          title: "Rough architecture",
          x: 100,
          y: 120,
          width: 420,
          height: 280,
          zIndex: 4,
          payload: {
            strokes: [
              {
                id: "stroke-source",
                color: "#12233d",
                width: 5,
                points: [
                  { x: 20, y: 40 },
                  { x: 180, y: 40 },
                  { x: 300, y: 140 },
                ],
              },
            ],
          },
        },
      },
    },
    { createId: () => "receipt-create-sketch" },
  );
  if (!result.ok) throw new Error("fixture failed");
  return result.state;
}

function dependencies(
  overrides: Partial<SketchTransformRouteDependencies> = {},
): SketchTransformRouteDependencies {
  return {
    verifier: {
      auth: {
        getUser: vi.fn(async () => ({
          data: { user: { id: ACTOR_ID } },
          error: null,
        })),
      },
    },
    verifyMembership: vi.fn(async () => ({ ok: true as const, role: "host" as const })),
    loadCanvas: vi.fn(async () => ({ ok: true, state: canvasWithSketch() })),
    admitTransform: vi.fn(async () => ({
      ok: true as const,
      outcome: "admitted" as const,
      requestKey: REQUEST_KEY,
      leaseToken: LEASE_TOKEN,
      leaseExpiresAt: "2026-08-27T14:02:00.000Z",
    })),
    completeTransform: vi.fn(async () => ({ ok: true as const })),
    releaseTransform: vi.fn(async () => ({ ok: true as const })),
    resolveSavedOpenAiApiKey: vi.fn(async () => null),
    safetyIdentifier: vi.fn(() => "cc_0123456789abcdef"),
    transform: vi.fn(async () => ({
      ok: true as const,
      payload: diagramPayload,
      responseId: "resp-diagram-1",
      model: "gpt-5.6-terra" as const,
    })),
    ...overrides,
  } as SketchTransformRouteDependencies;
}

function request(
  body: Record<string, unknown>,
  openAiApiKey: string | null = OPENAI_API_KEY,
  savedCredential = false,
) {
  const headers = new Headers({
    authorization: AUTHORIZATION,
    "content-type": "application/json",
  });
  if (openAiApiKey !== null)
    headers.set("x-commandcanvas-openai-key", openAiApiKey);
  if (savedCredential)
    headers.set("x-commandcanvas-openai-credential", "saved");
  return new Request(`https://commandcanvas.example/api/rooms/${ROOM_ID}/transform-sketch`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

function validBody() {
  return {
    roomId: ROOM_ID,
    sketchObjectId: "sketch-source",
    sourceVersion: 1,
    instruction: "Make that usable",
    outputKind: "architecture",
    imageDataUrl: PNG_DATA_URL,
  };
}

describe("sketch transform route", () => {
  it("requires a session OpenAI key before quota admission or provider execution", async () => {
    const deps = dependencies();

    const response = await handleSketchTransformRequest(
      request(validBody(), null),
      ROOM_ID,
      deps,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: {
        code: "openai_key_required",
        message: "Enter an OpenAI API key for this browser session.",
      },
    });
    expect(deps.admitTransform).not.toHaveBeenCalled();
    expect(deps.transform).not.toHaveBeenCalled();
  });

  it("resolves a verified standard-room member's saved key on the server", async () => {
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
        role: "host" as const,
        roomMode: "standard" as const,
      })),
      resolveSavedOpenAiApiKey: vi.fn(async () => savedKey),
    });

    const response = await handleSketchTransformRequest(
      request(validBody(), null, true),
      ROOM_ID,
      deps,
    );

    expect(response.status).toBe(200);
    expect(deps.resolveSavedOpenAiApiKey).toHaveBeenCalledWith(ACTOR_ID);
    expect(deps.transform).toHaveBeenCalledWith(expect.any(Object), savedKey);
    expect(await response.text()).not.toContain(savedKey);
  });

  it("resolves the same verified permanent demo-room member's saved key on the server", async () => {
    const savedKey = `sk-saved-${"c".repeat(40)}`;
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
        role: "host" as const,
        roomMode: "demo" as const,
      })),
      resolveSavedOpenAiApiKey: vi.fn(async () => savedKey),
    });

    const response = await handleSketchTransformRequest(
      request(validBody(), null, true),
      ROOM_ID,
      deps,
    );

    expect(response.status).toBe(200);
    expect(deps.resolveSavedOpenAiApiKey).toHaveBeenCalledWith(ACTOR_ID);
    expect(deps.transform).toHaveBeenCalledWith(expect.any(Object), savedKey);
    expect(await response.text()).not.toContain(savedKey);
  });

  it("refuses an anonymous demo member's saved selector before Vault, admission, or provider work", async () => {
    const deps = dependencies({
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
        role: "host" as const,
        roomMode: "demo" as const,
      })),
      resolveSavedOpenAiApiKey: vi.fn(async () => OPENAI_API_KEY),
    });

    const response = await handleSketchTransformRequest(
      request(validBody(), null, true),
      ROOM_ID,
      deps,
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: {
        code: "permanent_email_auth_required",
        message: "Verify your email before using a saved OpenAI credential.",
      },
    });
    expect(deps.resolveSavedOpenAiApiKey).not.toHaveBeenCalled();
    expect(deps.admitTransform).not.toHaveBeenCalled();
    expect(deps.transform).not.toHaveBeenCalled();
  });

  it("refuses a saved selector when demo actor verification changes identity", async () => {
    const otherActorId = "36fc0d14-a2c2-4240-b0c2-d21cdf2765c4";
    const getUser = vi
      .fn()
      .mockResolvedValueOnce({
        data: {
          user: {
            id: ACTOR_ID,
            email: "danny@example.com",
            email_confirmed_at: "2026-08-28T12:00:00.000Z",
            is_anonymous: false,
          },
        },
        error: null,
      })
      .mockResolvedValueOnce({
        data: {
          user: {
            id: otherActorId,
            email: "other@example.com",
            email_confirmed_at: "2026-08-28T12:00:00.000Z",
            is_anonymous: false,
          },
        },
        error: null,
      });
    const deps = dependencies({
      verifier: { auth: { getUser } },
      verifyMembership: vi.fn(async () => ({
        ok: true as const,
        role: "host" as const,
        roomMode: "demo" as const,
      })),
      resolveSavedOpenAiApiKey: vi.fn(async () => OPENAI_API_KEY),
    });

    const response = await handleSketchTransformRequest(
      request(validBody(), null, true),
      ROOM_ID,
      deps,
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "permanent_email_auth_required" },
    });
    expect(getUser).toHaveBeenCalledTimes(2);
    expect(deps.resolveSavedOpenAiApiKey).not.toHaveBeenCalled();
    expect(deps.admitTransform).not.toHaveBeenCalled();
    expect(deps.transform).not.toHaveBeenCalled();
  });

  it("refuses a missing standard-room saved credential before admission", async () => {
    const missing = dependencies({
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
        role: "host" as const,
        roomMode: "standard" as const,
      })),
    });
    const missingResponse = await handleSketchTransformRequest(
      request(validBody(), null, true),
      ROOM_ID,
      missing,
    );
    expect(missingResponse.status).toBe(409);
    await expect(missingResponse.json()).resolves.toMatchObject({
      error: { code: "openai_credential_not_configured" },
    });
    expect(missing.admitTransform).not.toHaveBeenCalled();
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
        role: "host" as const,
        roomMode: "standard" as const,
      })),
      resolveSavedOpenAiApiKey: vi.fn(async () => {
        throw new Error("Vault unavailable");
      }),
    });

    const response = await handleSketchTransformRequest(
      request(validBody(), null, true),
      ROOM_ID,
      deps,
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "openai_credential_unavailable" },
    });
    expect(deps.admitTransform).not.toHaveBeenCalled();
    expect(deps.transform).not.toHaveBeenCalled();
  });

  it.each([
    ["whitespace", "sk-short invalid"],
    ["wrong-prefix", `not-openai-${"a".repeat(40)}`],
    ["overlong", "a".repeat(513)],
  ])("rejects an implausible %s session OpenAI key without echoing it", async (_name, invalidKey) => {
    const deps = dependencies();

    const response = await handleSketchTransformRequest(
      request(validBody(), invalidKey),
      ROOM_ID,
      deps,
    );
    const responseText = await response.text();

    expect(response.status).toBe(400);
    expect(JSON.parse(responseText)).toEqual({
      ok: false,
      error: {
        code: "invalid_openai_key",
        message: "The OpenAI API key for this browser session is invalid.",
      },
    });
    expect(responseText).not.toContain(invalidKey);
    expect(deps.admitTransform).not.toHaveBeenCalled();
    expect(deps.transform).not.toHaveBeenCalled();
  });

  it("refuses a declared request above the Vercel-safe four-megabyte application limit", async () => {
    const deps = dependencies();
    const oversized = request(validBody());
    oversized.headers.set("content-length", String(4 * 1_024 * 1_024 + 1));

    const response = await handleSketchTransformRequest(
      oversized,
      ROOM_ID,
      deps,
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: {
        code: "request_too_large",
        message: "Request body is too large.",
      },
    });
    expect(deps.admitTransform).not.toHaveBeenCalled();
    expect(deps.transform).not.toHaveBeenCalled();
  });

  it("admits deterministic work before vision and durably completes it", async () => {
    const deps = dependencies();
    const response = await handleSketchTransformRequest(
      request(validBody()),
      ROOM_ID,
      deps,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(deps.verifyMembership).toHaveBeenCalledWith(ROOM_ID, ACTOR_ID);
    expect(deps.admitTransform).toHaveBeenCalledWith({
      roomId: ROOM_ID,
      actorUserId: ACTOR_ID,
      sketchObjectId: "sketch-source",
      sourceVersion: 1,
      outputKind: "architecture",
      normalizedInstructionSha256:
        "626aae5cc9ce79b1328a0a7f662fcca20e1ced0175814d9711171152588bc764",
      normalizedNarrationSha256: null,
      pngSha256:
        "431ced6916a2a21a156e38701afe55bbd7f88969fbbfc56d7fe099d47f265460",
      requestKey: REQUEST_KEY,
    });
    expect(deps.transform).toHaveBeenCalledWith(
      expect.objectContaining({
        imageDataUrl: PNG_DATA_URL,
        instruction: "Make that usable",
        sketchObjectId: "sketch-source",
        outputKind: "architecture",
        safetyIdentifier: "cc_0123456789abcdef",
        sketch: expect.objectContaining({ strokes: expect.any(Array) }),
      }),
      OPENAI_API_KEY,
    );
    expect(deps.completeTransform).toHaveBeenCalledWith({
      requestKey: REQUEST_KEY,
      leaseToken: LEASE_TOKEN,
      model: "gpt-5.6-terra",
      responseId: "resp-diagram-1",
      payload: diagramPayload,
    });
    expect(deps.releaseTransform).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      ok: true,
      transform: {
        provider: "openai",
        model: "gpt-5.6-terra",
        responseId: "resp-diagram-1",
        sourceSketchId: "sketch-source",
        payload: diagramPayload,
      },
    });
    expect(canvasWithSketch().objects["sketch-source"]?.deletedAt).toBeNull();
  });

  it("admits spoken sketch context with its own normalized durable identity", async () => {
    const deps = dependencies({
      admitTransform: vi.fn(async (input) => ({
        ok: true as const,
        outcome: "admitted" as const,
        requestKey: input.requestKey,
        leaseToken: LEASE_TOKEN,
        leaseExpiresAt: "2026-08-27T14:02:00.000Z",
      })),
    });
    const response = await handleSketchTransformRequest(
      request({
        ...validBody(),
        narration: "  The API writes\tcommands to PostgreSQL.  ",
      }),
      ROOM_ID,
      deps,
    );

    expect(response.status).toBe(200);
    expect(deps.admitTransform).toHaveBeenCalledWith(
      expect.objectContaining({
        normalizedNarrationSha256:
          "380bdd86287e31230de1a2ab214de6ead3665f689a327bbf06105fdd84919775",
      }),
    );
    expect(deps.transform).toHaveBeenCalledWith(
      expect.objectContaining({
        narration: "The API writes commands to PostgreSQL.",
      }),
      OPENAI_API_KEY,
    );
  });

  it("admits auto and returns the concrete chart chosen by vision", async () => {
    const deps = dependencies({
      admitTransform: vi.fn(async (input) => ({
        ok: true as const,
        outcome: "admitted" as const,
        requestKey: input.requestKey,
        leaseToken: LEASE_TOKEN,
        leaseExpiresAt: "2026-08-27T14:02:00.000Z",
      })),
      transform: vi.fn(async () => ({
        ok: true as const,
        payload: barChartPayload,
        responseId: "resp-bar-chart",
        model: "gpt-5.6-terra" as const,
      })),
    });
    const response = await handleSketchTransformRequest(
      request({ ...validBody(), outputKind: "auto" }),
      ROOM_ID,
      deps,
    );

    expect(response.status).toBe(200);
    expect(deps.admitTransform).toHaveBeenCalledWith(
      expect.objectContaining({ outputKind: "auto" }),
    );
    expect(deps.completeTransform).toHaveBeenCalledWith(
      expect.objectContaining({ payload: barChartPayload }),
    );
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      transform: { payload: barChartPayload },
    });
  });

  it("normalizes Unicode and internal whitespace before deriving admission identity", async () => {
    const deps = dependencies();
    const response = await handleSketchTransformRequest(
      request({
        ...validBody(),
        instruction: "  Make\tthat\nusable  ",
      }),
      ROOM_ID,
      deps,
    );

    expect(response.status).toBe(200);
    expect(deps.admitTransform).toHaveBeenCalledWith(
      expect.objectContaining({
        normalizedInstructionSha256:
          "626aae5cc9ce79b1328a0a7f662fcca20e1ced0175814d9711171152588bc764",
        requestKey: REQUEST_KEY,
      }),
    );
    expect(deps.transform).toHaveBeenCalledWith(
      expect.objectContaining({ instruction: "Make that usable" }),
      OPENAI_API_KEY,
    );
  });

  it("returns a durable cached transform without calling the paid provider", async () => {
    const transform = vi.fn();
    const completeTransform = vi.fn();
    const releaseTransform = vi.fn();
    const response = await handleSketchTransformRequest(
      request(validBody()),
      ROOM_ID,
      dependencies({
        admitTransform: async () => ({
          ok: true,
          outcome: "cached",
          requestKey: REQUEST_KEY,
          transform: {
            model: "gpt-5.6-terra",
            responseId: "resp-diagram-1",
            payload: diagramPayload,
          },
        }),
        transform,
        completeTransform,
        releaseTransform,
      }),
    );

    expect(response.status).toBe(200);
    expect(transform).not.toHaveBeenCalled();
    expect(completeTransform).not.toHaveBeenCalled();
    expect(releaseTransform).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      transform: {
        responseId: "resp-diagram-1",
        sourceSketchId: "sketch-source",
        payload: diagramPayload,
      },
    });
  });

  it.each([
    "transform_rate_limited",
    "room_transform_busy",
    "demo_transform_limit",
    "demo_actor_daily_limit",
    "demo_global_daily_limit",
    "daily_transform_limit",
    "transform_in_progress",
  ] as const)("returns compact 429 %s before provider execution", async (code) => {
    const transform = vi.fn();
    const response = await handleSketchTransformRequest(
      request(validBody()),
      ROOM_ID,
      dependencies({
        admitTransform: async () => ({
          ok: false,
          code,
          retryAfterSeconds: 37,
        }),
        transform,
      }),
    );

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("37");
    expect(transform).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code },
    });
  });

  it("fails closed before provider execution when admission storage is unavailable", async () => {
    const transform = vi.fn();
    const response = await handleSketchTransformRequest(
      request(validBody()),
      ROOM_ID,
      dependencies({
        admitTransform: async () => ({
          ok: false,
          code: "admission_unavailable",
        }),
        transform,
      }),
    );

    expect(response.status).toBe(503);
    expect(transform).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "admission_unavailable" },
    });
  });

  it("refuses a non-member before model execution", async () => {
    const transform = vi.fn();
    const response = await handleSketchTransformRequest(
      request(validBody()),
      ROOM_ID,
      dependencies({
        verifyMembership: async () => ({ ok: false }),
        transform,
      }),
    );

    expect(response.status).toBe(403);
    expect(transform).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: {
        code: "member_required",
        message: "Join this room before interpreting its sketch.",
      },
    });
  });

  it("refuses stale or non-sketch source objects before model execution", async () => {
    const transform = vi.fn();
    const stale = await handleSketchTransformRequest(
      request({ ...validBody(), sourceVersion: 2 }),
      ROOM_ID,
      dependencies({ transform }),
    );
    expect(stale.status).toBe(409);
    expect(transform).not.toHaveBeenCalled();
    await expect(stale.json()).resolves.toMatchObject({
      error: { code: "source_changed" },
    });

    const state = canvasWithSketch();
    state.objects["sketch-source"] = {
      ...state.objects["sketch-source"],
      type: "note",
      payload: { text: "not a sketch", tone: "coral" },
    };
    const wrongType = await handleSketchTransformRequest(
      request(validBody()),
      ROOM_ID,
      dependencies({
        loadCanvas: async () => ({ ok: true, state }),
        transform,
      }),
    );
    expect(wrongType.status).toBe(404);
    expect(transform).not.toHaveBeenCalled();
    await expect(wrongType.json()).resolves.toMatchObject({
      error: { code: "sketch_unavailable" },
    });
  });

  it("keeps missing configuration and provider failure explicit", async () => {
    const releaseTransform = vi.fn(async () => ({ ok: true as const }));
    const response = await handleSketchTransformRequest(
      request(validBody()),
      ROOM_ID,
      dependencies({
        releaseTransform,
        transform: async () => ({
          ok: false,
          code: "vision_unconfigured",
          message: "Sketch interpretation is not configured.",
        }),
      }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: {
        code: "vision_unconfigured",
        message: "Sketch interpretation is not configured.",
      },
    });
    expect(releaseTransform).toHaveBeenCalledWith({
      requestKey: REQUEST_KEY,
      leaseToken: LEASE_TOKEN,
      errorCode: "vision_unconfigured",
    });
  });

  it("does not return paid output until durable completion is acknowledged", async () => {
    const releaseTransform = vi.fn();
    const response = await handleSketchTransformRequest(
      request(validBody()),
      ROOM_ID,
      dependencies({
        completeTransform: async () => ({
          ok: false,
          code: "admission_unavailable",
        }),
        releaseTransform,
      }),
    );

    expect(response.status).toBe(503);
    expect(releaseTransform).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: {
        code: "admission_unavailable",
        message: "Sketch interpretation could not be recorded.",
      },
    });
  });
});
