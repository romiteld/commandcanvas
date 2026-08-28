import type { StoreApi } from "zustand";

import type { CanvasStoreState } from "@/lib/canvas/canvas-store";
import type { CanvasCommand, CommandError } from "@/lib/canvas/command-engine";
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

const WEBMCP_AGENT = {
  id: "agent-chatgpt",
  displayName: "ChatGPT",
  type: "agent" as const,
};

export interface CanvasWebMcpAdapterOptions {
  store: StoreApi<CanvasStoreState>;
  dispatchMutation?: (
    command: CanvasCommand,
    signal: AbortSignal,
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
          return executeMutation(
            options,
            {
              type: "object.create",
              object: request.input.object,
            },
            request.signal,
          );
        case "transform_object":
          return executeMutation(
            options,
            {
              type: "object.transform",
              objectId: request.input.objectId,
              transform: request.input.transform,
            },
            request.signal,
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
          );
        case "discard_object":
          return executeMutation(
            options,
            {
              type: "object.discard",
              objectId: request.input.objectId,
            },
            request.signal,
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
              )
            : executeMutation(
                options,
                {
                  type: "objects.ungroup",
                  frameId: request.input.frameId,
                },
                request.signal,
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
          );
        case "transform_sketch":
          return transformSelectedSketch(options, request);
        case "prepare_meeting_packet":
          return options.prepareMeetingPacket
            ? options.prepareMeetingPacket(request)
            : unavailable("meeting packet preparation is not ready");
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
    const result = await options.transformSketch({
      sketchObjectId: request.input.sketchId,
      instruction: request.input.instruction,
      outputKind: request.input.outputKind ?? "architecture",
      source: "webmcp",
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
      message: `Sketch interpreted as a structured ${request.input.outputKind ?? "architecture"} diagram.`,
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

function executeMutation(
  options: CanvasWebMcpAdapterOptions,
  command: CanvasCommand,
  signal: AbortSignal,
) {
  return options.dispatchMutation
    ? options.dispatchMutation(command, signal)
    : dispatchLocalMutation(options.store, command);
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
): WebMcpToolResult {
  const result = store.getState().dispatch(command, "webmcp", WEBMCP_AGENT);
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
