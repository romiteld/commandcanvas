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

function request(body: Record<string, unknown>) {
  return new Request(`https://commandcanvas.example/api/rooms/${ROOM_ID}/transform-sketch`, {
    method: "POST",
    headers: {
      authorization: AUTHORIZATION,
      "content-type": "application/json",
    },
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
