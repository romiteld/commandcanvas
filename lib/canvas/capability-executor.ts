import {
  CANVAS_CAPABILITY_CATALOG,
  CANVAS_CAPABILITY_RUNTIME_INPUT_SCHEMAS,
  evaluateCanvasCapabilityGuard,
  type CanvasCapabilityInput,
  type CanvasCapabilityName,
  type CanvasCapabilityExecutionContext,
} from "@/lib/canvas/capability-catalog";
import type { WebMcpToolFailure, WebMcpToolResult } from "@/lib/webmcp/tool-catalog";

export type CanvasCapabilitySource = "webmcp" | "voice";

export type CanvasCapabilityAdapterRequest = {
  [Name in CanvasCapabilityName]: {
    capability: Name;
    input: CanvasCapabilityInput<Name>;
    source: CanvasCapabilitySource;
    signal: AbortSignal;
    context: CanvasCapabilityExecutionContext;
  };
}[CanvasCapabilityName];

export type CanvasCapabilityAdapter = (
  request: CanvasCapabilityAdapterRequest,
) => Promise<WebMcpToolResult>;

export interface ExecuteCanvasCapabilityOptions {
  capability: CanvasCapabilityName;
  input: unknown;
  source: CanvasCapabilitySource;
  signal: AbortSignal;
  getContext: () => CanvasCapabilityExecutionContext;
  adapter: CanvasCapabilityAdapter;
}

export async function executeCanvasCapability(
  options: ExecuteCanvasCapabilityOptions,
): Promise<WebMcpToolResult> {
  options.signal.throwIfAborted();
  const context = options.getContext();
  const guard = evaluateCanvasCapabilityGuard(options.capability, context);
  if (!guard.ok) return guard;

  const parsed = (
    options.source === "voice"
      ? CANVAS_CAPABILITY_RUNTIME_INPUT_SCHEMAS[options.capability]
      : CANVAS_CAPABILITY_CATALOG[options.capability].inputSchema
  ).safeParse(options.input);
  if (!parsed.success) return invalidInput();
  options.signal.throwIfAborted();

  const result = await options.adapter({
    capability: options.capability,
    input: parsed.data,
    source: options.source,
    signal: options.signal,
    context,
  } as CanvasCapabilityAdapterRequest);
  if (
    options.capability === "request_packet_send" &&
    result.ok &&
    result.status !== "awaiting_human_approval"
  )
    return executionFailure();
  return result;
}

function invalidInput(): WebMcpToolFailure {
  return {
    ok: false,
    code: "invalid_input",
    message: "invalid tool input: check the documented schema",
  };
}

function executionFailure(): WebMcpToolFailure {
  return {
    ok: false,
    code: "execution_failed",
    message: "tool execution failed: the canvas made no confirmed change",
  };
}
