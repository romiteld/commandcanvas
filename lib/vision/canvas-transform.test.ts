import { describe, expect, it } from "vitest";

import { createCanvasStore } from "@/lib/canvas/canvas-store";
import type {
  CanvasCommand,
  CanvasCommandSource,
} from "@/lib/canvas/command-engine";
import type { SketchPayload } from "@/lib/canvas/object-model";
import type { BrowserSketchTransformResult } from "@/lib/vision/browser-api";
import { createCanvasSketchTransformer } from "@/lib/vision/canvas-transform";

const PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9JkU8AAAAASUVORK5CYII=";

const sketchPayload: SketchPayload = {
  strokes: [
    {
      id: "stroke-1",
      color: "#0ea5e9",
      width: 4,
      points: [
        { x: 12, y: 16, pressure: 0.5 },
        { x: 88, y: 72, pressure: 0.8 },
      ],
    },
  ],
};

const diagramPayload = {
  kind: "architecture" as const,
  sourceSketchId: "sketch-source",
  interpretationSummary: "A client calls the API service.",
  nodes: [
    {
      id: "node-client",
      label: "Client",
      kind: "client" as const,
      x: 36,
      y: 48,
      width: 160,
      height: 72,
    },
    {
      id: "node-api",
      label: "API",
      kind: "service" as const,
      x: 272,
      y: 48,
      width: 160,
      height: 72,
    },
  ],
  edges: [
    { id: "edge-client-api", from: "node-client", to: "node-api", label: "request" },
  ],
};

function createHarness(options: {
  transform?: () => Promise<BrowserSketchTransformResult>;
  afterSubmit?: () => void;
} = {}) {
  let id = 0;
  const store = createCanvasStore("room-demo", {
    actor: { id: "participant-host", displayName: "Danny", type: "human" },
    createId: (prefix) => `${prefix}-${++id}`,
    now: () => "2026-08-27T16:00:00.000Z",
  });
  store.getState().dispatch(
    {
      type: "object.create",
      object: {
        id: "note-highest",
        type: "note",
        title: "Existing context",
        x: 20,
        y: 40,
        width: 280,
        height: 190,
        zIndex: 12,
        payload: { text: "The generated diagram must be on top.", tone: "sky" },
      },
    },
    "typed",
  );
  store.getState().dispatch(
    {
      type: "object.create",
      object: {
        id: "sketch-source",
        type: "sketch",
        title: "Architecture sketch",
        x: 120,
        y: 240,
        width: 400,
        height: 260,
        zIndex: 3,
        payload: sketchPayload,
      },
    },
    "stylus",
  );

  const rasterized: SketchPayload[] = [];
  const transforms: Array<{ input: unknown; signal: AbortSignal | undefined }> = [];
  const submissions: Array<{
    command: unknown;
    source: CanvasCommandSource;
    signal: AbortSignal | undefined;
  }> = [];
  const session = {
    transformSketch: async (input: unknown, signal?: AbortSignal) => {
      transforms.push({ input, signal });
      return options.transform?.() ?? {
        ok: true as const,
        value: {
          provider: "openai" as const,
          model: "gpt-5.6-terra" as const,
          responseId: "resp_123",
          sourceSketchId: "sketch-source",
          payload: diagramPayload,
        },
      };
    },
    submitCommand: async (
      command: CanvasCommand,
      source: CanvasCommandSource,
      signal?: AbortSignal,
    ) => {
      submissions.push({ command, source, signal });
      const result = store.getState().dispatch(command, source);
      if (!result.ok)
        return { ok: false as const, code: result.error.code, message: result.error.message };
      options.afterSubmit?.();
      return { ok: true as const, state: result.state };
    },
  };
  const transformer = createCanvasSketchTransformer({
    store,
    session,
    createId: () => "diagram-generated",
    rasterize: async (payload) => {
      rasterized.push(payload);
      return { mimeType: "image/png", width: 400, height: 260, dataUrl: PNG_DATA_URL };
    },
  });

  return { store, transformer, rasterized, transforms, submissions };
}

describe("canvas sketch transformer", () => {
  it("preserves an active sketch and submits one canonical diagram creation after an authoritative transform", async () => {
    const { store, transformer, rasterized, transforms, submissions } = createHarness();
    const controller = new AbortController();

    const result = await transformer.transform({
      sketchObjectId: "sketch-source",
      instruction: "Turn this into the service architecture.",
      outputKind: "architecture",
      source: "typed",
      signal: controller.signal,
    });

    expect(result).toEqual({
      ok: true,
      diagramObjectId: "diagram-generated",
      receiptId: "receipt-6",
      revision: 3,
      provider: "openai",
      model: "gpt-5.6-terra",
    });
    expect(rasterized).toEqual([sketchPayload]);
    expect(transforms).toEqual([
      {
        input: {
          sketchObjectId: "sketch-source",
          sourceVersion: 1,
          instruction: "Turn this into the service architecture.",
          outputKind: "architecture",
          imageDataUrl: PNG_DATA_URL,
        },
        signal: controller.signal,
      },
    ]);
    expect(submissions).toEqual([
      {
        command: {
          type: "object.create",
          object: {
            id: "diagram-generated",
            type: "diagram",
            title: "Structured architecture",
            x: 584,
            y: 240,
            width: 620,
            height: 360,
            zIndex: 13,
            payload: diagramPayload,
          },
        },
        source: "typed",
        signal: controller.signal,
      },
    ]);
    expect(store.getState().canvas.objects["sketch-source"]).toMatchObject({
      type: "sketch",
      deletedAt: null,
      version: 1,
      payload: sketchPayload,
    });
  });

  it("refuses a provider result when the source sketch changed during interpretation without submitting a command", async () => {
    const storeForProvider: { current?: ReturnType<typeof createCanvasStore> } = {};
    const harness = createHarness({
      transform: async () => {
        storeForProvider.current!.getState().dispatch(
          {
            type: "object.transform",
            objectId: "sketch-source",
            transform: { x: 160 },
          },
          "collaborator",
        );
        return {
          ok: true,
          value: {
            provider: "openai",
            model: "gpt-5.6-terra",
            responseId: "resp_changed",
            sourceSketchId: "sketch-source",
            payload: diagramPayload,
          },
        };
      },
    });
    storeForProvider.current = harness.store;

    await expect(
      harness.transformer.transform({
        sketchObjectId: "sketch-source",
        instruction: "Turn this into the service architecture.",
        outputKind: "architecture",
        source: "typed",
      }),
    ).resolves.toEqual({
      ok: false,
      code: "source_version_changed",
      message: "The sketch changed while it was being interpreted.",
    });
    expect(harness.submissions).toEqual([]);
    expect(harness.store.getState().canvas.objects["diagram-generated"]).toBeUndefined();
  });

  it("does not turn cancellation after the provider response into a canvas mutation", async () => {
    const controller = new AbortController();
    const harness = createHarness({
      transform: async () => {
        controller.abort();
        return {
          ok: true,
          value: {
            provider: "openai",
            model: "gpt-5.6-terra",
            responseId: "resp_cancelled",
            sourceSketchId: "sketch-source",
            payload: diagramPayload,
          },
        };
      },
    });

    await expect(
      harness.transformer.transform({
        sketchObjectId: "sketch-source",
        instruction: "Turn this into the service architecture.",
        outputKind: "architecture",
        source: "typed",
        signal: controller.signal,
      }),
    ).resolves.toEqual({
      ok: false,
      code: "request_cancelled",
      message: "Sketch interpretation was cancelled.",
    });
    expect(harness.rasterized).toEqual([sketchPayload]);
    expect(harness.transforms).toEqual([
      {
        input: {
          sketchObjectId: "sketch-source",
          sourceVersion: 1,
          instruction: "Turn this into the service architecture.",
          outputKind: "architecture",
          imageDataUrl: PNG_DATA_URL,
        },
        signal: controller.signal,
      },
    ]);
    expect(harness.submissions).toEqual([]);
  });

  it("reports the authoritative result when cancellation arrives after the mutation committed", async () => {
    const controller = new AbortController();
    const harness = createHarness({
      afterSubmit: () => controller.abort(),
    });

    await expect(
      harness.transformer.transform({
        sketchObjectId: "sketch-source",
        instruction: "Turn this into the service architecture.",
        outputKind: "architecture",
        source: "webmcp",
        signal: controller.signal,
      }),
    ).resolves.toEqual({
      ok: true,
      diagramObjectId: "diagram-generated",
      receiptId: "receipt-6",
      revision: 3,
      provider: "openai",
      model: "gpt-5.6-terra",
    });
    expect(harness.store.getState().canvas.objects["diagram-generated"]).toMatchObject({
      type: "diagram",
      deletedAt: null,
    });
    expect(harness.store.getState().canvas.receipts.at(-1)?.source).toBe("webmcp");
  });

  it("refuses an invalid provider payload before submitting a canvas mutation", async () => {
    const harness = createHarness({
      transform: async () =>
        ({
          ok: true,
          value: {
            provider: "openai",
            model: "gpt-5.6-terra",
            responseId: "resp_invalid",
            sourceSketchId: "sketch-source",
            payload: { ...diagramPayload, sourceSketchId: "other-sketch" },
          },
        }) as BrowserSketchTransformResult,
    });

    await expect(
      harness.transformer.transform({
        sketchObjectId: "sketch-source",
        instruction: "Turn this into the service architecture.",
        outputKind: "architecture",
        source: "typed",
      }),
    ).resolves.toEqual({
      ok: false,
      code: "invalid_provider_payload",
      message: "Sketch interpretation returned an invalid diagram.",
    });
    expect(harness.submissions).toEqual([]);
  });
});
