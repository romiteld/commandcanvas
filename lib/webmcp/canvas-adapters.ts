import type { StoreApi } from "zustand";

import type { CanvasStoreState } from "@/lib/canvas/canvas-store";
import type { NewCanvasObject } from "@/lib/canvas/object-model";
import type { SemanticCanvasObjectInput } from "@/lib/canvas/semantic-object";
import type {
  CanvasCommand,
  CanvasCommandSource,
  CommandError,
} from "@/lib/canvas/command-engine";
import { buildSemanticCanvasObject } from "@/lib/canvas/semantic-object";
import type { CanvasSketchTransformer } from "@/lib/vision/canvas-transform";
import { projectCanvasState } from "@/lib/webmcp/canvas-state-projection";
import type {
  WebMcpAwaitingApprovalResult,
  WebMcpToolFailure,
  WebMcpToolResult,
} from "@/lib/webmcp/tool-catalog";
import type {
  WebMcpPacketSendStageRequest,
  WebMcpToolAdapters,
  WebMcpAdapterRequest,
} from "@/lib/webmcp/registry";

// WebMCP exposes a page capability surface, not an authenticated host identity.
// Keep local receipts host-neutral unless a trusted server boundary can bind a
// stronger actor. Standard rooms bind WebMCP mutations to the authenticated
// room member and retain `webmcp` as the interaction source.
const WEBMCP_AGENT = {
  id: "agent-site-tools",
  displayName: "Site Tools agent",
  type: "agent" as const,
};

export interface CanvasWebMcpAdapterOptions {
  store: StoreApi<CanvasStoreState>;
  dispatchMutation?: (
    command: CanvasCommand,
    signal: AbortSignal,
    source: "webmcp" | "voice",
  ) => Promise<WebMcpToolResult>;
  transformSketch?: CanvasSketchTransformer["transform"];
  prepareMeetingPacket?: (
    request: Extract<
      WebMcpAdapterRequest,
      { toolName: "prepare_meeting_packet" }
    >,
  ) => Promise<WebMcpToolResult>;
  stagePacketSendRequest?: (
    request: WebMcpPacketSendStageRequest,
  ) => Promise<WebMcpAwaitingApprovalResult | WebMcpToolFailure>;
  controlWorkspace?: (
    request: Extract<WebMcpAdapterRequest, { toolName: "control_workspace" }>,
  ) => Promise<WebMcpToolResult> | WebMcpToolResult;
}

export function createCanvasWebMcpAdapters(
  options: CanvasWebMcpAdapterOptions,
): WebMcpToolAdapters {
  return {
    async executeTool(request) {
      request.signal.throwIfAborted();

      switch (request.toolName) {
        case "get_canvas_state":
          return readCanvasState(options.store, request.input);
        case "create_object":
          return createSemanticObject(options, request);
        case "update_object_content":
          return appendObjectContent(options, request);
        case "transform_object":
          return executeMutation(
            options,
            {
              type: "object.transform",
              objectId: request.input.objectId,
              transform: request.input.transform,
            },
            request.signal,
            capabilitySource(request),
          );
        case "set_object_state":
          return executeMutation(
            options,
            {
              type: "object.set_flags",
              objectId: request.input.objectId,
              flags: request.input.state,
            },
            request.signal,
            capabilitySource(request),
          );
        case "discard_object":
          return executeMutation(
            options,
            {
              type: "object.discard",
              objectId: request.input.objectId,
            },
            request.signal,
            capabilitySource(request),
          );
        case "organize_objects":
          return request.input.action === "group"
            ? executeMutation(
                options,
                {
                  type: "objects.group",
                  objectIds: request.input.objectIds,
                  frame: {
                    id: request.input.frame.id,
                    type: "frame",
                    title: request.input.frame.title,
                    x: request.input.frame.x,
                    y: request.input.frame.y,
                    width: request.input.frame.width,
                    height: request.input.frame.height,
                    zIndex: request.input.frame.zIndex,
                    payload: { tone: request.input.frame.tone },
                  },
                },
                request.signal,
                capabilitySource(request),
              )
            : executeMutation(
                options,
                {
                  type: "objects.ungroup",
                  frameId: request.input.frameId,
                },
                request.signal,
                capabilitySource(request),
              );
        case "history_action":
          return executeMutation(
            options,
            {
              type:
                request.input.action === "undo"
                  ? "history.undo"
                  : "history.redo",
            },
            request.signal,
            capabilitySource(request),
          );
        case "transform_sketch":
          return transformSelectedSketch(options, request);
        case "prepare_meeting_packet":
          return options.prepareMeetingPacket
            ? options.prepareMeetingPacket(request)
            : unavailable("meeting packet preparation is not ready");
        case "control_workspace":
          return options.controlWorkspace
            ? options.controlWorkspace(request)
            : unavailable("workspace control is not ready");
      }
    },
    async stagePacketSendRequest(request) {
      request.signal.throwIfAborted();
      return options.stagePacketSendRequest
        ? options.stagePacketSendRequest(request)
        : unavailable("meeting packet delivery staging is not ready");
    },
  };
}

function createSemanticObject(
  options: CanvasWebMcpAdapterOptions,
  request: Extract<WebMcpAdapterRequest, { toolName: "create_object" }>,
): Promise<WebMcpToolResult> | WebMcpToolResult {
  const state = options.store.getState();
  const input = request.input as
    | SemanticCanvasObjectInput
    | { object: NewCanvasObject };
  if ("object" in input)
    return executeMutation(
      options,
      { type: "object.create", object: input.object },
      request.signal,
      capabilitySource(request),
    );
  const sourceSketchId =
    input.type === "diagram" || input.type === "chart"
      ? input.sourceSketchId
      : undefined;
  if (sourceSketchId) {
    const source = state.canvas.objects[sourceSketchId];
    if (!source || source.deletedAt || source.type !== "sketch")
      return {
        ok: false,
        code: "invalid_input",
        message: "sourceSketchId must reference an active sketch in this room.",
      };
    if (state.selectedObjectId !== sourceSketchId)
      return {
        ok: false,
        code: "invalid_input",
        message: "Select the source sketch before creating a linked visual.",
      };
  }
  if (input.placement === "right_of_selection") {
    const selected = state.selectedObjectId
      ? state.canvas.objects[state.selectedObjectId]
      : undefined;
    if (!selected || selected.deletedAt)
      return {
        ok: false,
        code: "invalid_input",
        message:
          "Select an active canvas object before placing new content beside it.",
      };
  }

  return executeMutation(
    options,
    {
      type: "object.create",
      object: buildSemanticCanvasObject(input, {
        viewport: state.viewport,
        objects: state.canvas.objects,
        selectedObjectId: state.selectedObjectId,
      }),
    },
    request.signal,
    capabilitySource(request),
  );
}

function appendObjectContent(
  options: CanvasWebMcpAdapterOptions,
  request: Extract<WebMcpAdapterRequest, { toolName: "update_object_content" }>,
): Promise<WebMcpToolResult> | WebMcpToolResult {
  const state = options.store.getState();
  const objectId = request.input.objectId ?? state.selectedObjectId;
  const object = objectId ? state.canvas.objects[objectId] : undefined;
  if (!object || object.deletedAt || object.type !== "note")
    return {
      ok: false,
      code: "invalid_input",
      message:
        "Select a note or thought, or provide its stable object ID before adding text.",
    };

  return executeMutation(
    options,
    {
      type: "object.append_note_text",
      objectId: object.id,
      expectedVersion: object.version,
      text: request.input.text,
    },
    request.signal,
    capabilitySource(request),
  );
}

async function transformSelectedSketch(
  options: CanvasWebMcpAdapterOptions,
  request: Extract<WebMcpAdapterRequest, { toolName: "transform_sketch" }>,
): Promise<WebMcpToolResult> {
  const state = options.store.getState();
  if (request.input.sketchId !== state.selectedObjectId)
    return {
      ok: false,
      code: "invalid_input",
      message: "Transform request must target the currently selected sketch.",
    };

  const selected = state.canvas.objects[state.selectedObjectId];
  if (!selected || selected.deletedAt || selected.type !== "sketch")
    return {
      ok: false,
      code: "invalid_input",
      message: "Select an active sketch before requesting a transformation.",
    };
  if (!options.transformSketch)
    return unavailable("sketch transformation service is not ready");

  try {
    const outputKind = request.input.outputKind ?? "auto";
    const result = await options.transformSketch({
      sketchObjectId: request.input.sketchId,
      instruction: request.input.instruction,
      outputKind,
      source: capabilitySource(request),
      signal: request.signal,
    });
    if (!result.ok)
      return {
        ok: false,
        code: "execution_failed",
        message: result.message,
      };

    return {
      ok: true,
      status: "completed",
      message:
        outputKind === "auto"
          ? "Sketch interpreted as a structured visual."
          : `Sketch interpreted as ${structuredVisualArticle(outputKind)}.`,
      receiptId: result.receiptId,
      data: {
        revision: result.revision,
        diagramObjectId: result.diagramObjectId,
        provider: result.provider,
        model: result.model,
      },
    };
  } catch {
    return {
      ok: false,
      code: "execution_failed",
      message: request.signal.aborted
        ? "Sketch interpretation was cancelled."
        : "Sketch interpretation is temporarily unavailable.",
    };
  }
}

function structuredVisualArticle(
  kind:
    | "architecture"
    | "flowchart"
    | "diagram"
    | "pie_chart"
    | "bar_chart"
    | "line_chart",
) {
  switch (kind) {
    case "architecture":
      return "an architecture diagram";
    case "flowchart":
      return "a flowchart";
    case "diagram":
      return "a structured diagram";
    case "pie_chart":
      return "a pie chart";
    case "bar_chart":
      return "a bar chart";
    case "line_chart":
      return "a line chart";
  }
}

function executeMutation(
  options: CanvasWebMcpAdapterOptions,
  command: CanvasCommand,
  signal: AbortSignal,
  source: "webmcp" | "voice",
) {
  return options.dispatchMutation
    ? options.dispatchMutation(command, signal, source)
    : dispatchLocalMutation(options.store, command, source);
}

function readCanvasState(
  store: StoreApi<CanvasStoreState>,
  input: { scope?: "all" | "selected"; includeReceipts?: boolean },
): WebMcpToolResult {
  const state = store.getState();

  return {
    ok: true,
    status: "completed",
    message: `Canvas state read at revision ${state.canvas.revision}.`,
    data: toJsonValue(
      projectCanvasState(state.canvas, state.selectedObjectId, input),
    ),
  };
}

function dispatchLocalMutation(
  store: StoreApi<CanvasStoreState>,
  command: CanvasCommand,
  source: "webmcp" | "voice",
): WebMcpToolResult {
  const result = store
    .getState()
    .dispatch(command, source, localAgentForSource(source));
  if (!result.ok) return commandFailure(result.error);

  return {
    ok: true,
    status: "completed",
    message: result.receipt.description,
    receiptId: result.receipt.id,
    data: {
      revision: result.receipt.revision,
      affectedObjectIds: result.receipt.affectedObjectIds,
    },
  };
}

function localAgentForSource(source: CanvasCommandSource) {
  return source === "voice"
    ? {
        id: "agent-live-voice",
        displayName: "Live voice",
        type: "agent" as const,
      }
    : WEBMCP_AGENT;
}

function capabilitySource(request: { source?: "webmcp" | "voice" }) {
  return request.source ?? "webmcp";
}

function commandFailure(error: CommandError): WebMcpToolFailure {
  const code =
    error.code === "NOTHING_TO_UNDO" || error.code === "NOTHING_TO_REDO"
      ? "not_available"
      : error.code === "INVALID_COMMAND"
      ? "invalid_input"
      : error.code === "OBJECT_PINNED"
        ? "forbidden"
        : "execution_failed";
  return { ok: false, code, message: error.message };
}

function unavailable(detail: string): WebMcpToolFailure {
  return {
    ok: false,
    code: "not_available",
    message: `not available yet: ${detail}`,
  };
}

function toJsonValue(value: unknown) {
  return JSON.parse(JSON.stringify(value));
}
