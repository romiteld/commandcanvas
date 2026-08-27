import type { StoreApi } from "zustand";

import type { CanvasStoreState } from "@/lib/canvas/canvas-store";
import type { CanvasCommand, CommandError } from "@/lib/canvas/command-engine";
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
  transformSketch?: (
    request: Extract<WebMcpAdapterRequest, { toolName: "transform_sketch" }>,
  ) => Promise<WebMcpToolResult>;
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
          return dispatchMutation(options.store, {
            type: "object.create",
            object: request.input.object,
          });
        case "transform_object":
          return dispatchMutation(options.store, {
            type: "object.transform",
            objectId: request.input.objectId,
            transform: request.input.transform,
          });
        case "set_object_state":
          return dispatchMutation(options.store, {
            type: "object.set_flags",
            objectId: request.input.objectId,
            flags: request.input.state,
          });
        case "discard_object":
          return dispatchMutation(options.store, {
            type: "object.discard",
            objectId: request.input.objectId,
          });
        case "transform_sketch":
          return options.transformSketch
            ? options.transformSketch(request)
            : unavailable("sketch transformation service is not ready");
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

function readCanvasState(
  store: StoreApi<CanvasStoreState>,
  input: { scope?: "all" | "selected"; includeReceipts?: boolean },
): WebMcpToolResult {
  const state = store.getState();
  const allObjects = Object.values(state.canvas.objects).filter(
    (object) => !object.deletedAt,
  );
  const objects =
    input.scope === "selected"
      ? allObjects.filter((object) => object.id === state.selectedObjectId)
      : allObjects;

  return {
    ok: true,
    status: "completed",
    message: `Canvas state read at revision ${state.canvas.revision}.`,
    data: toJsonValue({
      roomId: state.canvas.roomId,
      revision: state.canvas.revision,
      selectedObjectId: state.selectedObjectId,
      objects,
      receipts: input.includeReceipts ? state.canvas.receipts.slice(-20) : [],
    }),
  };
}

function dispatchMutation(
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
    error.code === "INVALID_COMMAND"
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
