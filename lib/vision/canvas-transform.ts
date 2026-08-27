import type { StoreApi } from "zustand";

import type { CanvasStoreState } from "@/lib/canvas/canvas-store";
import type { CanvasCommandSource } from "@/lib/canvas/command-engine";
import {
  diagramPayloadSchema,
  newCanvasObjectSchema,
  type DiagramPayload,
  type SketchPayload,
} from "@/lib/canvas/object-model";
import type { DemoRoomSession } from "@/lib/demo/room-session";
import {
  rasterizeSketchInBrowser,
  type BrowserRasterizedSketchPng,
} from "@/lib/sketch/browser-rasterize";

export interface CanvasSketchTransformerSession {
  transformSketch: DemoRoomSession["transformSketch"];
  submitCommand: DemoRoomSession["submitCommand"];
}

export interface CanvasSketchTransformerOptions {
  store: StoreApi<CanvasStoreState>;
  session: CanvasSketchTransformerSession;
  rasterize?: (payload: SketchPayload) => Promise<BrowserRasterizedSketchPng>;
  createId?: (prefix: string) => string;
}

export interface CanvasSketchTransformInput {
  sketchObjectId: string;
  instruction: string;
  outputKind: DiagramPayload["kind"];
  source: CanvasCommandSource;
  signal?: AbortSignal;
}

export type CanvasSketchTransformFailureCode =
  | "request_cancelled"
  | "source_unavailable"
  | "source_type_changed"
  | "source_version_changed"
  | "rasterization_failed"
  | "provider_unavailable"
  | "invalid_provider_payload"
  | "invalid_generated_object"
  | "command_unavailable"
  | "invalid_authoritative_result"
  | string;

export type CanvasSketchTransformResult =
  | {
      ok: true;
      diagramObjectId: string;
      receiptId: string;
      revision: number;
      provider: "openai";
      model: "gpt-5.6-terra" | "gpt-5.6-sol";
    }
  | {
      ok: false;
      code: CanvasSketchTransformFailureCode;
      message: string;
    };

export interface CanvasSketchTransformer {
  transform: (
    input: CanvasSketchTransformInput,
  ) => Promise<CanvasSketchTransformResult>;
}

/**
 * Translates one preserved, active sketch into a separate canonical diagram.
 * The durable room session remains the only mutation authority.
 */
export function createCanvasSketchTransformer(
  options: CanvasSketchTransformerOptions,
): CanvasSketchTransformer {
  const rasterize = options.rasterize ?? rasterizeSketchInBrowser;
  const createId = options.createId ?? defaultDiagramId;

  return {
    async transform(input) {
      if (input.signal?.aborted) return cancelled();

      const source = activeSketch(options.store, input.sketchObjectId);
      if (!source) return unavailableSource(options.store, input.sketchObjectId);
      const sourceVersion = source.version;

      let rasterized: BrowserRasterizedSketchPng;
      try {
        rasterized = await rasterize(source.payload);
      } catch {
        return input.signal?.aborted
          ? cancelled()
          : failure(
              "rasterization_failed",
              "The sketch could not be rasterized for interpretation.",
            );
      }
      if (input.signal?.aborted) return cancelled();

      let transformed;
      try {
        transformed = await options.session.transformSketch(
          {
            sketchObjectId: source.id,
            sourceVersion,
            instruction: input.instruction,
            outputKind: input.outputKind,
            imageDataUrl: rasterized.dataUrl,
          },
          input.signal,
        );
      } catch {
        return input.signal?.aborted
          ? cancelled()
          : failure(
              "provider_unavailable",
              "Sketch interpretation is temporarily unavailable.",
            );
      }
      if (input.signal?.aborted) return cancelled();
      if (!transformed.ok) {
        if (transformed.error.code === "request_cancelled") return cancelled();
        return failure(transformed.error.code, transformed.error.message);
      }

      const payload = diagramPayloadSchema.safeParse(transformed.value.payload);
      if (
        !payload.success ||
        transformed.value.sourceSketchId !== source.id ||
        payload.data.sourceSketchId !== source.id ||
        payload.data.kind !== input.outputKind
      )
        return failure(
          "invalid_provider_payload",
          "Sketch interpretation returned an invalid diagram.",
        );

      const currentSource = activeSketch(options.store, source.id);
      if (!currentSource) return unavailableSource(options.store, source.id);
      if (currentSource.version !== sourceVersion)
        return failure(
          "source_version_changed",
          "The sketch changed while it was being interpreted.",
        );
      if (input.signal?.aborted) return cancelled();

      const diagramId = createId("diagram");
      const diagram = newCanvasObjectSchema.safeParse({
        id: diagramId,
        type: "diagram",
        title:
          input.outputKind === "architecture"
            ? "Structured architecture"
            : "Structured flowchart",
        x: source.x + source.width + 64,
        y: source.y,
        width: 620,
        height: 360,
        zIndex: highestActiveZIndex(options.store) + 1,
        payload: payload.data,
      });
      if (!diagram.success)
        return failure(
          "invalid_generated_object",
          "The generated diagram could not be prepared for the canvas.",
        );
      if (input.signal?.aborted) return cancelled();

      let submitted;
      try {
        submitted = await options.session.submitCommand(
          { type: "object.create", object: diagram.data },
          input.source,
          input.signal,
        );
      } catch {
        return input.signal?.aborted
          ? cancelled()
          : failure(
              "command_unavailable",
              "The generated diagram could not be saved to the canvas.",
            );
      }
      if (!submitted.ok) return failure(submitted.code, submitted.message);

      const authoritativeDiagram = submitted.state.objects[diagram.data.id];
      const receipt = [...submitted.state.receipts]
        .reverse()
        .find((candidate) => candidate.affectedObjectIds.includes(diagram.data.id));
      if (
        !authoritativeDiagram ||
        authoritativeDiagram.deletedAt ||
        authoritativeDiagram.type !== "diagram" ||
        !receipt ||
        receipt.source !== input.source ||
        receipt.revision !== submitted.state.revision
      )
        return failure(
          "invalid_authoritative_result",
          "The saved diagram could not be verified from the authoritative canvas.",
        );

      return {
        ok: true,
        diagramObjectId: diagram.data.id,
        receiptId: receipt.id,
        revision: receipt.revision,
        provider: transformed.value.provider,
        model: transformed.value.model,
      };
    },
  };
}

function activeSketch(
  store: StoreApi<CanvasStoreState>,
  objectId: string,
) {
  const object = store.getState().canvas.objects[objectId];
  if (!object || object.deletedAt || object.type !== "sketch") return null;
  return object;
}

function unavailableSource(
  store: StoreApi<CanvasStoreState>,
  objectId: string,
): CanvasSketchTransformResult {
  const object = store.getState().canvas.objects[objectId];
  if (object && !object.deletedAt && object.type !== "sketch")
    return failure(
      "source_type_changed",
      "The selected object is no longer a sketch.",
    );
  return failure("source_unavailable", "The selected sketch is no longer available.");
}

function highestActiveZIndex(store: StoreApi<CanvasStoreState>) {
  return Object.values(store.getState().canvas.objects).reduce(
    (highest, object) => (!object.deletedAt ? Math.max(highest, object.zIndex) : highest),
    0,
  );
}

function defaultDiagramId(prefix: string) {
  return `${prefix}-${globalThis.crypto.randomUUID()}`;
}

function cancelled(): CanvasSketchTransformResult {
  return failure("request_cancelled", "Sketch interpretation was cancelled.");
}

function failure(
  code: CanvasSketchTransformFailureCode,
  message: string,
): CanvasSketchTransformResult {
  return { ok: false, code, message };
}
