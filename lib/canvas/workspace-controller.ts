import type {
  CanvasCapabilityInput,
} from "@/lib/canvas/capability-catalog";
import type { CanvasCapabilitySource } from "@/lib/canvas/capability-executor";
import type { WebMcpToolResult } from "@/lib/webmcp/tool-catalog";

export type CanvasWorkspaceControlInput =
  CanvasCapabilityInput<"control_workspace">;

export type CanvasWorkspaceControlHandler = (
  input: CanvasWorkspaceControlInput,
  signal: AbortSignal,
  source: CanvasCapabilitySource,
) => Promise<WebMcpToolResult> | WebMcpToolResult;

export interface CanvasWorkspaceController {
  attach(handler: CanvasWorkspaceControlHandler): () => void;
  execute(
    input: CanvasWorkspaceControlInput,
    signal: AbortSignal,
    source: CanvasCapabilitySource,
  ): Promise<WebMcpToolResult>;
}

export function createCanvasWorkspaceController(): CanvasWorkspaceController {
  let current: CanvasWorkspaceControlHandler | null = null;
  return {
    attach(handler) {
      current = handler;
      return () => {
        if (current === handler) current = null;
      };
    },
    async execute(input, signal, source) {
      signal.throwIfAborted();
      if (!current)
        return {
          ok: false,
          code: "not_available",
          message: "not available yet: workspace control is not mounted",
        };
      return current(input, signal, source);
    },
  };
}
