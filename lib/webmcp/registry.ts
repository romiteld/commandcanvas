import { z } from "zod";

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
    signal: AbortSignal;
    context: WebMcpExecutionContext;
  };
}[NonSendToolName];

export interface WebMcpPacketSendStageRequest {
  input: WebMcpToolInput<"request_packet_send">;
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
}

interface ActiveRegistration {
  controller: AbortController;
}

export class WebMcpRegistry {
  readonly #mode: "static" | "dynamic";
  readonly #target: WebMcpRegistrationTarget;
  readonly #getContext: () => WebMcpExecutionContext;
  readonly #adapters: WebMcpToolAdapters;
  readonly #descriptors: Record<WebMcpToolName, RegisteredWebMcpTool>;
  readonly #registrations = new Map<WebMcpToolName, ActiveRegistration>();
  #disposed = false;

  constructor(options: WebMcpRegistryOptions) {
    this.#mode = options.mode;
    this.#target = options.target;
    this.#getContext = options.getContext;
    this.#adapters = options.adapters;
    this.#descriptors = Object.fromEntries(
      WEBMCP_TOOL_NAMES.map((toolName) => [
        toolName,
        this.#createDescriptor(toolName),
      ]),
    ) as Record<WebMcpToolName, RegisteredWebMcpTool>;
  }

  async sync(): Promise<void> {
    if (this.#disposed) return;

    const desiredNames =
      this.#mode === "static"
        ? [...WEBMCP_TOOL_NAMES]
        : getPhaseAvailableToolNames(this.#getContext().phase);
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
    signal.throwIfAborted();

    const context = this.#getContext();
    const guard = evaluateToolGuard(toolName, context);
    if (!guard.ok) return guard;

    const parsed = WEBMCP_TOOL_CATALOG[toolName].inputSchema.safeParse(input);
    if (!parsed.success)
      return {
        ok: false,
        code: "invalid_input",
        message: "invalid tool input: check the documented schema",
      };

    signal.throwIfAborted();

    try {
      if (toolName === "request_packet_send") {
        const result = await this.#adapters.stagePacketSendRequest({
          input: parsed.data as WebMcpToolInput<"request_packet_send">,
          signal,
          context,
        });
        if (result.ok && result.status !== "awaiting_human_approval")
          return executionFailure();
        return result;
      }

      return await this.#adapters.executeTool({
        toolName,
        input: parsed.data,
        signal,
        context,
      } as WebMcpAdapterRequest);
    } catch (error) {
      if (signal.aborted) signal.throwIfAborted();
      if (isAbortError(error)) throw error;
      return executionFailure();
    }
  }
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  );
}

function executionFailure(): WebMcpToolFailure {
  return {
    ok: false,
    code: "execution_failed",
    message: "tool execution failed: the canvas made no confirmed change",
  };
}
