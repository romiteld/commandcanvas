import { describe, expect, it, vi } from "vitest";

import { createBrowserSketchTransformApi } from "@/lib/vision/browser-api";

const ROOM_ID = "d32af6a9-31dd-4dfc-98d5-fcf439b9b106";
const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.signature";
const OPENAI_API_KEY = `sk-session-${"a".repeat(40)}`;
const PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const payload = {
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
    {
      id: "node-api",
      label: "API",
      kind: "service" as const,
      x: 240,
      y: 40,
      width: 140,
      height: 64,
    },
  ],
  edges: [{ id: "edge-browser-api", from: "node-browser", to: "node-api" }],
};
const lineChartPayload = {
  kind: "line_chart" as const,
  sourceSketchId: "sketch-source",
  interpretationSummary: "A rising trend over three weeks.",
  chart: {
    title: "Weekly signups",
    xAxisLabel: "Week",
    yAxisLabel: "Signups",
    series: [
      {
        id: "series-signups",
        label: "Signups",
        points: [
          { label: "W1", value: 8 },
          { label: "W2", value: 13 },
          { label: "W3", value: 21 },
        ],
      },
    ],
  },
};

const input = {
  roomId: ROOM_ID,
  sketchObjectId: "sketch-source",
  sourceVersion: 1,
  instruction: "Make that usable",
  outputKind: "architecture" as const,
  imageDataUrl: PNG_DATA_URL,
};

describe("browser sketch transform API", () => {
  it("posts the strict request with exact bearer auth and cancellation", async () => {
    const signal = new AbortController().signal;
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toBe(`/api/rooms/${ROOM_ID}/transform-sketch`);
      expect(init).toMatchObject({
        method: "POST",
        cache: "no-store",
        signal,
        headers: {
          authorization: `Bearer ${JWT}`,
          "content-type": "application/json",
          "x-commandcanvas-openai-key": OPENAI_API_KEY,
        },
      });
      expect(JSON.parse(String(init?.body))).toEqual(input);
      expect(String(url)).not.toContain(OPENAI_API_KEY);
      expect(String(init?.body)).not.toContain(OPENAI_API_KEY);
      return new Response(
        JSON.stringify({
          ok: true,
          transform: {
            provider: "openai",
            model: "gpt-5.6-terra",
            responseId: "resp-diagram-1",
            sourceSketchId: "sketch-source",
            payload,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    const api = createBrowserSketchTransformApi({
      accessToken: JWT,
      getOpenAiApiKey: () => `  ${OPENAI_API_KEY}  `,
      fetcher,
    });

    await expect(api.transform(input, signal)).resolves.toEqual({
      ok: true,
      value: {
        provider: "openai",
        model: "gpt-5.6-terra",
        responseId: "resp-diagram-1",
        sourceSketchId: "sketch-source",
        payload,
      },
    });
  });

  it("requests an account-saved credential without exposing a raw key", async () => {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({
        authorization: `Bearer ${JWT}`,
        "content-type": "application/json",
        "x-commandcanvas-openai-credential": "saved",
      });
      expect(init?.headers).not.toHaveProperty("x-commandcanvas-openai-key");
      return new Response(
        JSON.stringify({
          ok: true,
          transform: {
            provider: "openai",
            model: "gpt-5.6-terra",
            responseId: "resp-saved",
            sourceSketchId: "sketch-source",
            payload,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    const api = createBrowserSketchTransformApi({
      accessToken: JWT,
      getUseSavedOpenAiCredential: () => true,
      fetcher,
    });

    await expect(api.transform(input)).resolves.toMatchObject({ ok: true });
  });

  it("refuses ambiguous saved and temporary credentials before a request", async () => {
    const fetcher = vi.fn();
    const api = createBrowserSketchTransformApi({
      accessToken: JWT,
      getOpenAiApiKey: () => OPENAI_API_KEY,
      getUseSavedOpenAiCredential: () => true,
      fetcher,
    });

    await expect(api.transform(input)).resolves.toMatchObject({
      ok: false,
      error: { code: "ambiguous_openai_credential" },
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", undefined, "openai_key_required"],
    ["blank", () => "   ", "openai_key_required"],
    ["malformed", () => "sk-short key", "invalid_openai_key"],
    ["wrong-prefix", () => `not-openai-${"a".repeat(40)}`, "invalid_openai_key"],
    ["overlong", () => "a".repeat(513), "invalid_openai_key"],
  ])("refuses a %s session key before making a request", async (_name, getKey, code) => {
    const fetcher = vi.fn();
    const api = createBrowserSketchTransformApi({
      accessToken: JWT,
      ...(getKey ? { getOpenAiApiKey: getKey } : {}),
      fetcher,
    });

    await expect(api.transform(input)).resolves.toMatchObject({
      ok: false,
      error: {
        code,
      },
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("accepts a concrete chart response when the browser requested auto", async () => {
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
          ok: true,
          transform: {
            provider: "openai",
            model: "gpt-5.6-terra",
            responseId: "resp-line-chart",
            sourceSketchId: "sketch-source",
            payload: lineChartPayload,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const api = createBrowserSketchTransformApi({
      accessToken: JWT,
      getOpenAiApiKey: () => OPENAI_API_KEY,
      fetcher,
    });

    await expect(
      api.transform({ ...input, outputKind: "auto" }),
    ).resolves.toMatchObject({
      ok: true,
      value: { payload: lineChartPayload },
    });
  });

  it("rejects a response that disconnects the diagram from its source", async () => {
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
          ok: true,
          transform: {
            provider: "openai",
            model: "gpt-5.6-terra",
            responseId: "resp-diagram-1",
            sourceSketchId: "sketch-other",
            payload,
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const api = createBrowserSketchTransformApi({
      accessToken: JWT,
      getOpenAiApiKey: () => OPENAI_API_KEY,
      fetcher,
    });

    await expect(api.transform(input)).resolves.toEqual({
      ok: false,
      error: {
        code: "invalid_response",
        message: "Sketch interpretation returned an invalid response.",
      },
    });
  });

  it("refuses malformed bearer tokens before making a request", async () => {
    const fetcher = vi.fn();
    const api = createBrowserSketchTransformApi({
      accessToken: "bad token\r\ninjected: value",
      getOpenAiApiKey: () => OPENAI_API_KEY,
      fetcher,
    });

    await expect(api.transform(input)).resolves.toEqual({
      ok: false,
      error: {
        code: "authentication_unavailable",
        message: "Sketch interpretation authentication is unavailable.",
      },
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("keeps network and cancellation failures compact", async () => {
    const network = createBrowserSketchTransformApi({
      accessToken: JWT,
      getOpenAiApiKey: () => OPENAI_API_KEY,
      fetcher: async () => {
        throw new Error("transport and token details");
      },
    });
    await expect(network.transform(input)).resolves.toEqual({
      ok: false,
      error: {
        code: "service_unavailable",
        message: "Sketch interpretation is temporarily unavailable.",
      },
    });

    const controller = new AbortController();
    controller.abort();
    const cancelled = createBrowserSketchTransformApi({
      accessToken: JWT,
      getOpenAiApiKey: () => OPENAI_API_KEY,
      fetcher: vi.fn(),
    });
    await expect(cancelled.transform(input, controller.signal)).resolves.toEqual({
      ok: false,
      error: {
        code: "request_cancelled",
        message: "Sketch interpretation was cancelled.",
      },
    });
  });
});
