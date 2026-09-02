import { z } from "zod";

import {
  type CanvasCapabilitySource,
} from "@/lib/canvas/capability-executor";
import {
  createCanvasCapabilityRuntime,
  type CanvasCapabilityRuntime,
} from "@/lib/canvas/capability-runtime";
import {
  evaluateToolGuard,
  getPhaseAvailableToolNames,
  WEBMCP_TOOL_NAMES,
  type WebMcpExecutionContext,
  type WebMcpToolName,
} from "@/lib/webmcp/phase-guards";
import {
  WEBMCP_TOOL_CATALOG,
  type WebMcpAwaitingApprovalResult,
  type WebMcpToolFailure,
  type WebMcpToolInput,
  type WebMcpToolResult,
} from "@/lib/webmcp/tool-catalog";

export interface RegisteredWebMcpTool {
  name: WebMcpToolName;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: {
    readOnlyHint: boolean;
    untrustedContentHint: boolean;
  };
  execute(
    input: unknown,
    options: { signal: AbortSignal },
  ): Promise<WebMcpToolResult>;
}

export interface WebMcpRegistrationTarget {
  registerTool(
    tool: RegisteredWebMcpTool,
    options: { signal: AbortSignal },
  ): Promise<void>;
}

type NonSendToolName = Exclude<WebMcpToolName, "request_packet_send">;

export type WebMcpAdapterRequest = {
  [Name in NonSendToolName]: {
    toolName: Name;
    input: WebMcpToolInput<Name>;
    source?: CanvasCapabilitySource;
    signal: AbortSignal;
    context: WebMcpExecutionContext;
  };
}[NonSendToolName];

export interface WebMcpPacketSendStageRequest {
  input: WebMcpToolInput<"request_packet_send">;
  source?: CanvasCapabilitySource;
  signal: AbortSignal;
  context: WebMcpExecutionContext;
}

export interface WebMcpToolAdapters {
  executeTool(request: WebMcpAdapterRequest): Promise<WebMcpToolResult>;
  stagePacketSendRequest(
    request: WebMcpPacketSendStageRequest,
  ): Promise<WebMcpAwaitingApprovalResult | WebMcpToolFailure>;
}

export interface WebMcpRegistryOptions {
  mode: "static" | "dynamic";
  target: WebMcpRegistrationTarget;
  getContext: () => WebMcpExecutionContext;
  adapters: WebMcpToolAdapters;
  runtime?: CanvasCapabilityRuntime;
  onExecutionEvent?: (event: WebMcpExecutionEvent) => void;
}

export type WebMcpExecutionStatus =
  | "running"
  | "completed"
  | "awaiting_human_approval"
  | "refused"
  | "cancelled";

export interface WebMcpExecutionEvent {
  invocationId: string;
  toolName: WebMcpToolName;
  status: WebMcpExecutionStatus;
  message: string;
  receiptId?: string;
}

interface ActiveRegistration {
  controller: AbortController;
}

let registryExecutionScopeSequence = 0;

export class WebMcpRegistry {
  readonly #mode: "static" | "dynamic";
  readonly #target: WebMcpRegistrationTarget;
  readonly #getContext: () => WebMcpExecutionContext;
  readonly #adapters: WebMcpToolAdapters;
  readonly #runtime: CanvasCapabilityRuntime;
  readonly #onExecutionEvent?: (event: WebMcpExecutionEvent) => void;
  readonly #descriptors: Record<WebMcpToolName, RegisteredWebMcpTool>;
  readonly #registrations = new Map<WebMcpToolName, ActiveRegistration>();
  readonly #executionScope = ++registryExecutionScopeSequence;
  #invocationSequence = 0;
  #disposed = false;

  constructor(options: WebMcpRegistryOptions) {
    this.#mode = options.mode;
    this.#target = options.target;
    this.#getContext = options.getContext;
    this.#adapters = options.adapters;
    this.#runtime =
      options.runtime ??
      createWebMcpCapabilityRuntime({
        getContext: this.#getContext,
        adapters: this.#adapters,
      });
    this.#onExecutionEvent = options.onExecutionEvent;
    this.#descriptors = Object.fromEntries(
      WEBMCP_TOOL_NAMES.map((toolName) => [
        toolName,
        this.#createDescriptor(toolName),
      ]),
    ) as Record<WebMcpToolName, RegisteredWebMcpTool>;
  }

  async sync(): Promise<void> {
    if (this.#disposed) return;

    const context = this.#getContext();
    const desiredNames =
      this.#mode === "static"
        ? [...WEBMCP_TOOL_NAMES]
        : getPhaseAvailableToolNames(context.phase).filter(
            (toolName) => evaluateToolGuard(toolName, context).ok,
          );
    const desired = new Set(desiredNames);

    for (const [toolName, registration] of this.#registrations) {
      if (desired.has(toolName)) continue;
      registration.controller.abort();
      this.#registrations.delete(toolName);
    }

    for (const toolName of desiredNames) {
      if (this.#disposed) return;
      if (this.#registrations.has(toolName)) continue;

      const controller = new AbortController();
      this.#registrations.set(toolName, { controller });
      try {
        await this.#target.registerTool(this.#descriptors[toolName], {
          signal: controller.signal,
        });
      } catch (error) {
        if (this.#registrations.get(toolName)?.controller === controller)
          this.#registrations.delete(toolName);
        controller.abort();
        throw error;
      }
    }
  }

  registeredToolNames(): WebMcpToolName[] {
    return WEBMCP_TOOL_NAMES.filter((toolName) =>
      this.#registrations.has(toolName),
    );
  }

  dispose(): void {
    this.#disposed = true;
    for (const registration of this.#registrations.values())
      registration.controller.abort();
    this.#registrations.clear();
  }

  invokeCapability(
    toolName: WebMcpToolName,
    input: unknown,
    signal: AbortSignal,
    source: CanvasCapabilitySource = "voice",
  ): Promise<WebMcpToolResult> {
    return this.#runtime.invokeCapability(toolName, input, signal, source);
  }

  #createDescriptor(toolName: WebMcpToolName): RegisteredWebMcpTool {
    const definition = WEBMCP_TOOL_CATALOG[toolName];
    return Object.freeze({
      name: toolName,
      description: definition.description,
      inputSchema: z.toJSONSchema(definition.inputSchema) as Record<
        string,
        unknown
      >,
      annotations: Object.freeze({ ...definition.annotations }),
      execute: (input: unknown, options: { signal: AbortSignal }) =>
        this.#execute(toolName, input, options.signal),
    });
  }

  async #execute(
    toolName: WebMcpToolName,
    input: unknown,
    signal: AbortSignal,
  ): Promise<WebMcpToolResult> {
    const invocationId = `registry-${this.#executionScope}-${toolName}-${++this.#invocationSequence}`;
    if (signal.aborted) {
      this.#emitExecution({
        invocationId,
        toolName,
        status: "cancelled",
        message: "Invocation cancelled.",
      });
      signal.throwIfAborted();
    }

    this.#emitExecution({
      invocationId,
      toolName,
      status: "running",
      message: `${toolName.replaceAll("_", " ")} is running.`,
    });

    try {
      const result = await this.invokeCapability(
        toolName,
        input,
        signal,
        "webmcp",
      );
      this.#emitTerminalExecution(invocationId, toolName, result);
      return result;
    } catch (error) {
      if (signal.aborted || isAbortError(error)) {
        this.#emitExecution({
          invocationId,
          toolName,
          status: "cancelled",
          message: "Invocation cancelled.",
        });
        if (signal.aborted) signal.throwIfAborted();
        throw error;
      }
      const failure = executionFailure();
      this.#emitTerminalExecution(invocationId, toolName, failure);
      return failure;
    }
  }

  #emitTerminalExecution(
    invocationId: string,
    toolName: WebMcpToolName,
    result: WebMcpToolResult,
  ) {
    this.#emitExecution({
      invocationId,
      toolName,
      status: result.ok ? result.status : "refused",
      message: executionObserverMessage(toolName, result),
      ...(result.ok && result.receiptId ? { receiptId: result.receiptId } : {}),
    });
  }

  #emitExecution(event: WebMcpExecutionEvent) {
    try {
      this.#onExecutionEvent?.(event);
    } catch {
      // The page observer is diagnostics only and cannot alter tool execution.
    }
  }
}

export function createWebMcpCapabilityRuntime(options: {
  getContext: () => WebMcpExecutionContext;
  adapters: WebMcpToolAdapters;
}): CanvasCapabilityRuntime {
  return createCanvasCapabilityRuntime({
    getContext: options.getContext,
    adapter: async (request) => {
      if (request.capability === "request_packet_send")
        return options.adapters.stagePacketSendRequest({
          input: request.input,
          source: request.source,
          signal: request.signal,
          context: request.context,
        });
      return options.adapters.executeTool({
        toolName: request.capability,
        input: request.input,
        source: request.source,
        signal: request.signal,
        context: request.context,
      } as WebMcpAdapterRequest);
    },
  });
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  );
}

function executionObserverMessage(
  toolName: WebMcpToolName,
  result: WebMcpToolResult,
) {
  const label = toolName.replaceAll("_", " ");
  if (!result.ok) return `${label} was refused.`;
  return result.status === "awaiting_human_approval"
    ? `${label} is awaiting human approval.`
    : `${label} completed.`;
}

function executionFailure(): WebMcpToolFailure {
  return {
    ok: false,
    code: "execution_failed",
    message: "tool execution failed: the canvas made no confirmed change",
  };
}
