import { describe, expect, it, vi } from "vitest";

import {
  createOpenAiDiagramTransformer,
  readOpenAiDiagramConfig,
} from "@/lib/vision/openai-diagram";

const PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
const ROOM_ID = "d32af6a9-31dd-4dfc-98d5-fcf439b9b106";
const sketchPayload = {
  strokes: [
    {
      id: "stroke-source",
      color: "#12233d",
      width: 5,
      points: [
        { x: 10, y: 20 },
        { x: 120, y: 80 },
      ],
    },
  ],
};

const diagramPayload = {
  kind: "architecture" as const,
  sourceSketchId: "sketch-source",
  interpretationSummary: "A client sends work to an API backed by a database.",
  nodes: [
    {
      id: "node-client",
      label: "Browser",
      kind: "client" as const,
      x: 24,
      y: 96,
      width: 150,
      height: 70,
    },
    {
      id: "node-api",
      label: "API",
      kind: "service" as const,
      x: 240,
      y: 96,
      width: 150,
      height: 70,
    },
    {
      id: "node-db",
      label: "Database",
      kind: "database" as const,
      x: 456,
      y: 96,
      width: 150,
      height: 70,
    },
  ],
  edges: [
    { id: "edge-client-api", from: "node-client", to: "node-api" },
    { id: "edge-api-db", from: "node-api", to: "node-db" },
  ],
};

describe("OpenAI diagram transformer", () => {
  it("sends one bounded image request and validates the structured diagram", async () => {
    const signal = new AbortController().signal;
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.signal).toBe(signal);
      expect(init?.headers).toEqual({
        authorization: "Bearer test-openai-key-not-real",
        "content-type": "application/json",
      });
      const body = JSON.parse(String(init?.body));
      expect(body).toMatchObject({
        model: "gpt-5.6-terra",
        store: false,
        reasoning: { effort: "low" },
        safety_identifier: "cc_0123456789abcdef",
        text: {
          format: {
            type: "json_schema",
            name: "commandcanvas_diagram",
            strict: true,
          },
        },
      });
      expect(body.text.format.schema.additionalProperties).toBe(false);
      expect(body.input[1].content).toContainEqual({
        type: "input_image",
        image_url: PNG_DATA_URL,
        detail: "high",
      });
      expect(JSON.stringify(body)).toContain("Make that usable");
      return new Response(
        JSON.stringify({
          id: "resp-diagram-1",
          output: [
            {
              type: "message",
              role: "assistant",
              content: [
                { type: "output_text", text: JSON.stringify(diagramPayload) },
              ],
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    });
    const transformer = createOpenAiDiagramTransformer({
      apiKey: "test-openai-key-not-real",
      model: "gpt-5.6-terra",
      fetcher,
    });

    const result = await transformer.transform({
      roomId: ROOM_ID,
      imageDataUrl: PNG_DATA_URL,
      instruction: "Make that usable",
      sketchObjectId: "sketch-source",
      sourceVersion: 1,
      outputKind: "architecture",
      safetyIdentifier: "cc_0123456789abcdef",
      sketch: sketchPayload,
      signal,
    });

    expect(fetcher).toHaveBeenCalledWith(
      "https://api.openai.com/v1/responses",
      expect.objectContaining({ method: "POST" }),
    );
    expect(result).toEqual({
      ok: true,
      payload: diagramPayload,
      responseId: "resp-diagram-1",
      model: "gpt-5.6-terra",
    });
  });

  it("rejects valid JSON whose source sketch does not match the request", async () => {
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
          id: "resp-wrong-source",
          output: [
            {
              type: "message",
              role: "assistant",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({
                    ...diagramPayload,
                    sourceSketchId: "sketch-other",
                  }),
                },
              ],
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    const transformer = createOpenAiDiagramTransformer({
      apiKey: "test-openai-key-not-real",
      fetcher,
    });

    await expect(
      transformer.transform({
        roomId: ROOM_ID,
        imageDataUrl: PNG_DATA_URL,
        instruction: "Convert this to architecture",
        sketchObjectId: "sketch-source",
        sourceVersion: 1,
        outputKind: "architecture",
        safetyIdentifier: "cc_0123456789abcdef",
        sketch: sketchPayload,
      }),
    ).resolves.toEqual({
      ok: false,
      code: "invalid_provider_response",
      message: "The model returned an invalid diagram.",
    });
  });

  it("returns compact provider errors without reflecting provider bodies", async () => {
    const fetcher = vi.fn(async () =>
      new Response("provider secret detail that must not escape", {
        status: 429,
        headers: { "content-type": "text/plain" },
      }),
    );
    const transformer = createOpenAiDiagramTransformer({
      apiKey: "test-openai-key-not-real",
      fetcher,
    });

    const result = await transformer.transform({
      roomId: ROOM_ID,
      imageDataUrl: PNG_DATA_URL,
      instruction: "Make that usable",
      sketchObjectId: "sketch-source",
      sourceVersion: 1,
      outputKind: "architecture",
      safetyIdentifier: "cc_0123456789abcdef",
      sketch: sketchPayload,
    });

    expect(result).toEqual({
      ok: false,
      code: "provider_unavailable",
      message: "Sketch interpretation is temporarily unavailable.",
    });
    expect(JSON.stringify(result)).not.toContain("secret detail");
  });

  it("reports cancellation distinctly and forwards no internal error text", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn(async () => {
      controller.abort();
      throw new DOMException("provider transport details", "AbortError");
    });
    const transformer = createOpenAiDiagramTransformer({
      apiKey: "test-openai-key-not-real",
      fetcher,
    });

    await expect(
      transformer.transform({
        roomId: ROOM_ID,
        imageDataUrl: PNG_DATA_URL,
        instruction: "Make that usable",
        sketchObjectId: "sketch-source",
        sourceVersion: 1,
        outputKind: "architecture",
        safetyIdentifier: "cc_0123456789abcdef",
        sketch: sketchPayload,
        signal: controller.signal,
      }),
    ).resolves.toEqual({
      ok: false,
      code: "request_cancelled",
      message: "Sketch interpretation was cancelled.",
    });
  });
});

describe("OpenAI diagram configuration", () => {
  it("defaults to Terra and accepts Sol explicitly", () => {
    expect(
      readOpenAiDiagramConfig({
        OPENAI_API_KEY: "test-openai-key-not-real",
      }),
    ).toMatchObject({ ok: true, model: "gpt-5.6-terra" });
    expect(
      readOpenAiDiagramConfig({
        OPENAI_API_KEY: "test-openai-key-not-real",
        OPENAI_VISION_MODEL: "gpt-5.6-sol",
      }),
    ).toMatchObject({ ok: true, model: "gpt-5.6-sol" });
  });

  it("fails closed for a missing key or unapproved model", () => {
    expect(readOpenAiDiagramConfig({})).toEqual({
      ok: false,
      code: "vision_unconfigured",
      message: "Sketch interpretation is not configured.",
    });
    expect(
      readOpenAiDiagramConfig({
        OPENAI_API_KEY: "test-openai-key-not-real",
        OPENAI_VISION_MODEL: "gpt-unknown",
      }),
    ).toEqual({
      ok: false,
      code: "vision_unconfigured",
      message: "Sketch interpretation is not configured.",
    });
  });
});
