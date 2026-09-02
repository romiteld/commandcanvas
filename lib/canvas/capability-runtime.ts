import {
  executeCanvasCapability,
  type CanvasCapabilityAdapter,
  type CanvasCapabilitySource,
} from "@/lib/canvas/capability-executor";
import type {
  CanvasCapabilityExecutionContext,
  CanvasCapabilityName,
} from "@/lib/canvas/capability-catalog";
import type { WebMcpToolResult } from "@/lib/webmcp/tool-catalog";

export interface CanvasCapabilityRuntime {
  invokeCapability(
    capability: CanvasCapabilityName,
    input: unknown,
    signal: AbortSignal,
    source: CanvasCapabilitySource,
  ): Promise<WebMcpToolResult>;
}

export interface CanvasCapabilityRuntimeOptions {
  getContext: () => CanvasCapabilityExecutionContext;
  adapter: CanvasCapabilityAdapter;
}

export function createCanvasCapabilityRuntime(
  options: CanvasCapabilityRuntimeOptions,
): CanvasCapabilityRuntime {
  return {
    invokeCapability(capability, input, signal, source) {
      return executeCanvasCapability({
        capability,
        input,
        source,
        signal,
        getContext: options.getContext,
        adapter: options.adapter,
      });
    },
  };
}
