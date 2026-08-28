import { describe, expect, it, vi } from "vitest";

import { createBrowserSketchTransformApi } from "@/lib/vision/browser-api";

const ROOM_ID = "d32af6a9-31dd-4dfc-98d5-fcf439b9b106";
const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.signature";
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
        },
      });
      expect(JSON.parse(String(init?.body))).toEqual(input);
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
    const api = createBrowserSketchTransformApi({ accessToken: JWT, fetcher });

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
    const api = createBrowserSketchTransformApi({ accessToken: JWT, fetcher });

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
    const api = createBrowserSketchTransformApi({ accessToken: JWT, fetcher });

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
