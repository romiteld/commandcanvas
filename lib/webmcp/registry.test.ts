import { describe, expect, it } from "vitest";

import {
  WEBMCP_TOOL_CATALOG,
  type WebMcpToolResult,
} from "@/lib/webmcp/tool-catalog";
import {
  WebMcpRegistry,
  type RegisteredWebMcpTool,
  type WebMcpExecutionEvent,
  type WebMcpRegistrationTarget,
  type WebMcpToolAdapters,
} from "@/lib/webmcp/registry";
import type {
  WebMcpExecutionContext,
  WebMcpPhaseState,
} from "@/lib/webmcp/phase-guards";

const emptyRoom: WebMcpPhaseState = {
  roomActive: true,
  hasContent: false,
  selection: "none",
  collaboratorCount: 1,
  packet: "none",
};

function hostContext(phase: WebMcpPhaseState = emptyRoom): WebMcpExecutionContext {
  return {
    phase,
    actor: { participantId: "participant-host", role: "host" },
    canMutateCanvas: true,
  };
}

class RecordingRegistrationTarget implements WebMcpRegistrationTarget {
  calls: Array<{ tool: RegisteredWebMcpTool; signal: AbortSignal }> = [];

  async registerTool(
    tool: RegisteredWebMcpTool,
    options: { signal: AbortSignal },
  ): Promise<void> {
    this.calls.push({ tool, signal: options.signal });
  }

  latest(name: RegisteredWebMcpTool["name"]): RegisteredWebMcpTool {
    const call = this.calls.findLast((candidate) => candidate.tool.name === name);
    if (!call) throw new Error(`tool ${name} was not registered`);
    return call.tool;
  }
}

function completed(message = "completed"): WebMcpToolResult {
  return { ok: true, status: "completed", message };
}

function adapters(
  overrides: Partial<WebMcpToolAdapters> = {},
): WebMcpToolAdapters {
  return {
    executeTool: async () => completed(),
    stagePacketSendRequest: async () => ({
      ok: true,
      status: "awaiting_human_approval",
      message: "Send request staged for host confirmation.",
    }),
    ...overrides,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("WebMcpRegistry registration", () => {
  it("registers the stable catalog once in static mode using only the current WebMCP descriptor fields", async () => {
    const target = new RecordingRegistrationTarget();
    const registry = new WebMcpRegistry({
      mode: "static",
      target,
      getContext: () => hostContext(),
      adapters: adapters(),
    });

    await registry.sync();
    await registry.sync();

    expect(target.calls.map((call) => call.tool.name)).toEqual([
      "get_canvas_state",
      "create_object",
      "update_object_content",
      "transform_object",
      "set_object_state",
      "discard_object",
      "organize_objects",
      "history_action",
      "transform_sketch",
      "prepare_meeting_packet",
      "request_packet_send",
      "control_workspace",
    ]);
    expect(Object.keys(target.latest("get_canvas_state")).sort()).toEqual([
      "annotations",
      "description",
      "execute",
      "inputSchema",
      "name",
    ]);
    expect(target.latest("get_canvas_state").annotations).toEqual({
      readOnlyHint: true,
      untrustedContentHint: true,
    });
  });

  it("adds and removes stable descriptors by phase in dynamic mode", async () => {
    const target = new RecordingRegistrationTarget();
    let context = hostContext();
    const registry = new WebMcpRegistry({
      mode: "dynamic",
      target,
      getContext: () => context,
      adapters: adapters(),
    });

    await registry.sync();
    const firstCreateDescriptor = target.latest("create_object");
    const firstCreateRegistration = target.calls.find(
      (call) => call.tool.name === "create_object",
    );
    expect(registry.registeredToolNames()).toEqual([
      "get_canvas_state",
      "create_object",
      "history_action",
      "control_workspace",
    ]);

    context = hostContext({
      ...emptyRoom,
      hasContent: true,
      selection: "sketch",
      collaboratorCount: 2,
    });
    await registry.sync();
    expect(registry.registeredToolNames()).toEqual([
      "get_canvas_state",
      "create_object",
      "update_object_content",
      "transform_object",
      "set_object_state",
      "discard_object",
      "organize_objects",
      "history_action",
      "transform_sketch",
      "prepare_meeting_packet",
      "control_workspace",
    ]);

    context = hostContext(emptyRoom);
    const removedTransformRegistration = target.calls.find(
      (call) => call.tool.name === "transform_object",
    );
    await registry.sync();
    expect(removedTransformRegistration?.signal.aborted).toBe(true);
    expect(firstCreateRegistration?.signal.aborted).toBe(false);

    context = hostContext({ ...emptyRoom, hasContent: true });
    await registry.sync();
    expect(target.latest("create_object")).toBe(firstCreateDescriptor);
  });

  it("keeps host-only packet tools out of a participant's dynamic registration while retaining ordinary canvas tools", async () => {
    const target = new RecordingRegistrationTarget();
    const participantContext: WebMcpExecutionContext = {
      phase: {
        ...emptyRoom,
        hasContent: true,
        selection: "sketch",
        packet: "approved",
      },
      actor: {
        participantId: "participant-sarah",
        role: "participant",
      },
      canMutateCanvas: true,
    };
    const registry = new WebMcpRegistry({
      mode: "dynamic",
      target,
      getContext: () => participantContext,
      adapters: adapters(),
    });

    await registry.sync();

    expect(registry.registeredToolNames()).toEqual([
      "get_canvas_state",
      "create_object",
      "update_object_content",
      "transform_object",
      "set_object_state",
      "discard_object",
      "organize_objects",
      "history_action",
      "transform_sketch",
      "control_workspace",
    ]);
  });

  it("aborts every active registration when disposed", async () => {
    const target = new RecordingRegistrationTarget();
    const registry = new WebMcpRegistry({
      mode: "static",
      target,
      getContext: () => hostContext(),
      adapters: adapters(),
    });
    await registry.sync();
    expect(target.calls).toHaveLength(12);

    registry.dispose();

    expect(target.calls.every((call) => call.signal.aborted)).toBe(true);
    expect(registry.registeredToolNames()).toEqual([]);
  });

  it("does not register more tools after disposal interrupts an in-flight sync", async () => {
    const firstRegistration = deferred<void>();
    const calls: Array<{
      tool: RegisteredWebMcpTool;
      signal: AbortSignal;
    }> = [];
    const target: WebMcpRegistrationTarget = {
      async registerTool(tool, options) {
        calls.push({ tool, signal: options.signal });
        if (calls.length === 1) await firstRegistration.promise;
      },
    };
    const registry = new WebMcpRegistry({
      mode: "static",
      target,
      getContext: () => hostContext(),
      adapters: adapters(),
    });

    const sync = registry.sync();
    await Promise.resolve();
    expect(calls.map(({ tool }) => tool.name)).toEqual(["get_canvas_state"]);

    registry.dispose();
    expect(calls[0]?.signal.aborted).toBe(true);
    firstRegistration.resolve();
    await sync;

    expect(calls.map(({ tool }) => tool.name)).toEqual(["get_canvas_state"]);
    expect(registry.registeredToolNames()).toEqual([]);
  });

  it("cleans up a registration controller when registration fails", async () => {
    let registrationSignal: AbortSignal | undefined;
    const target: WebMcpRegistrationTarget = {
      registerTool: async (_tool, options) => {
        registrationSignal = options.signal;
        throw new Error("registration unavailable");
      },
    };
    const registry = new WebMcpRegistry({
      mode: "static",
      target,
      getContext: () => hostContext(),
      adapters: adapters(),
    });

    await expect(registry.sync()).rejects.toThrow("registration unavailable");
    expect(registrationSignal?.aborted).toBe(true);
    expect(registry.registeredToolNames()).toEqual([]);
  });
});

describe("WebMcpRegistry execution boundary", () => {
  it("reports one privacy-minimal invocation lifecycle for a guard refusal", async () => {
    const target = new RecordingRegistrationTarget();
    const events: WebMcpExecutionEvent[] = [];
    let adapterCalls = 0;
    const registry = new WebMcpRegistry({
      mode: "static",
      target,
      getContext: () => hostContext(),
      adapters: adapters({
        executeTool: async () => {
          adapterCalls += 1;
          return completed("should not execute");
        },
      }),
      onExecutionEvent: (event) => events.push(event),
    });
    await registry.sync();

    const result = await target.latest("transform_object").execute(
      { objectId: "note-secret", transform: { x: 400 } },
      { signal: new AbortController().signal },
    );

    expect(result).toMatchObject({ ok: false, code: "not_available" });
    expect(adapterCalls).toBe(0);
    expect(events).toHaveLength(2);
    expect(events.map(({ invocationId, toolName, status }) => ({
      invocationId,
      toolName,
      status,
    }))).toEqual([
      {
        invocationId: events[0]?.invocationId,
        toolName: "transform_object",
        status: "running",
      },
      {
        invocationId: events[0]?.invocationId,
        toolName: "transform_object",
        status: "refused",
      },
    ]);
    expect(Object.keys(events[1] ?? {}).sort()).toEqual([
      "invocationId",
      "message",
      "status",
      "toolName",
    ]);
    expect(JSON.stringify(events)).not.toContain("note-secret");
  });

  it("reports schema refusal without exposing rejected input", async () => {
    const target = new RecordingRegistrationTarget();
    const events: WebMcpExecutionEvent[] = [];
    const registry = new WebMcpRegistry({
      mode: "static",
      target,
      getContext: () =>
        hostContext({ ...emptyRoom, hasContent: true, selection: "object" }),
      adapters: adapters(),
      onExecutionEvent: (event) => events.push(event),
    });
    await registry.sync();

    await target.latest("transform_object").execute(
      {
        objectId: "note-1",
        transform: { x: 400 },
        recipientEmail: "private@example.com",
      },
      { signal: new AbortController().signal },
    );

    expect(events.map((event) => event.status)).toEqual([
      "running",
      "refused",
    ]);
    expect(JSON.stringify(events)).not.toContain("private@example.com");
  });

  it("reports completed receipt and staged human approval outcomes", async () => {
    const target = new RecordingRegistrationTarget();
    const events: WebMcpExecutionEvent[] = [];
    const registry = new WebMcpRegistry({
      mode: "static",
      target,
      getContext: () =>
        hostContext({ ...emptyRoom, hasContent: true, packet: "approved" }),
      adapters: adapters({
        executeTool: async () => ({
          ok: true,
          status: "completed",
          message: "Canvas mutation completed.",
          receiptId: "receipt-42",
        }),
      }),
      onExecutionEvent: (event) => events.push(event),
    });
    await registry.sync();

    await target.latest("create_object").execute(
      {
        type: "note",
        title: "Agent note",
        text: "Validated first.",
        tone: "sky",
      },
      { signal: new AbortController().signal },
    );
    await target.latest("request_packet_send").execute(
      { packetId: "packet-v2" },
      { signal: new AbortController().signal },
    );

    expect(events.filter((event) => event.status !== "running")).toEqual([
      expect.objectContaining({
        toolName: "create_object",
        status: "completed",
        receiptId: "receipt-42",
      }),
      expect.objectContaining({
        toolName: "request_packet_send",
        status: "awaiting_human_approval",
      }),
    ]);
  });

  it("does not copy adapter result content into the page execution observer", async () => {
    const target = new RecordingRegistrationTarget();
    const events: WebMcpExecutionEvent[] = [];
    const registry = new WebMcpRegistry({
      mode: "static",
      target,
      getContext: () => hostContext(),
      adapters: adapters({
        executeTool: async () => ({
          ok: true,
          status: "completed",
          message:
            "Created private note for recipient@example.com with confidential text.",
          receiptId: "receipt-safe-reference",
          data: { private: "raw-result-content" },
        }),
      }),
      onExecutionEvent: (event) => events.push(event),
    });
    await registry.sync();

    await target.latest("get_canvas_state").execute(
      {},
      { signal: new AbortController().signal },
    );

    expect(events.at(-1)).toMatchObject({
      status: "completed",
      receiptId: "receipt-safe-reference",
    });
    expect(JSON.stringify(events)).not.toMatch(
      /recipient@example\.com|confidential text|raw-result-content/,
    );
  });

  it("reports pre-start and in-flight cancellation without changing AbortError identity", async () => {
    const target = new RecordingRegistrationTarget();
    const events: WebMcpExecutionEvent[] = [];
    const registry = new WebMcpRegistry({
      mode: "static",
      target,
      getContext: () => hostContext(),
      adapters: adapters({
        executeTool: async (request) =>
          await new Promise<WebMcpToolResult>((_resolve, reject) => {
            request.signal.addEventListener(
              "abort",
              () => reject(request.signal.reason),
              { once: true },
            );
          }),
      }),
      onExecutionEvent: (event) => events.push(event),
    });
    await registry.sync();

    const preAborted = new AbortController();
    const preReason = new DOMException("Already cancelled", "AbortError");
    preAborted.abort(preReason);
    await expect(
      target.latest("get_canvas_state").execute(
        {},
        { signal: preAborted.signal },
      ),
    ).rejects.toBe(preReason);

    const inFlight = new AbortController();
    const inFlightReason = new DOMException("Cancelled now", "AbortError");
    const execution = target.latest("get_canvas_state").execute(
      {},
      { signal: inFlight.signal },
    );
    await Promise.resolve();
    inFlight.abort(inFlightReason);
    await expect(execution).rejects.toBe(inFlightReason);

    const invocationIds = [...new Set(events.map((event) => event.invocationId))];
    expect(invocationIds).toHaveLength(2);
    expect(events.filter((event) => event.invocationId === invocationIds[0])).toEqual([
      expect.objectContaining({ status: "cancelled" }),
    ]);
    expect(
      events
        .filter((event) => event.invocationId === invocationIds[1])
        .map((event) => event.status),
    ).toEqual(["running", "cancelled"]);
  });

  it("does not let a failing observer alter the tool result", async () => {
    const target = new RecordingRegistrationTarget();
    const registry = new WebMcpRegistry({
      mode: "static",
      target,
      getContext: () => hostContext(),
      adapters: adapters({
        executeTool: async () => completed("Observer-independent result."),
      }),
      onExecutionEvent: () => {
        throw new Error("observer failed");
      },
    });
    await registry.sync();

    await expect(
      target.latest("get_canvas_state").execute(
        {},
        { signal: new AbortController().signal },
      ),
    ).resolves.toEqual(completed("Observer-independent result."));
  });

  it("keeps invocation IDs unique when a page replaces its registry lifecycle", async () => {
    const events: WebMcpExecutionEvent[] = [];
    const runOnce = async () => {
      const target = new RecordingRegistrationTarget();
      const registry = new WebMcpRegistry({
        mode: "static",
        target,
        getContext: () => hostContext(),
        adapters: adapters(),
        onExecutionEvent: (event) => events.push(event),
      });
      await registry.sync();
      await target.latest("get_canvas_state").execute(
        {},
        { signal: new AbortController().signal },
      );
      registry.dispose();
    };

    await runOnce();
    await runOnce();

    const runningIds = events
      .filter((event) => event.status === "running")
      .map((event) => event.invocationId);
    expect(runningIds).toHaveLength(2);
    expect(new Set(runningIds).size).toBe(2);
  });

  it("applies the authoritative phase guard even when static mode registered every tool", async () => {
    const target = new RecordingRegistrationTarget();
    let adapterCalls = 0;
    const registry = new WebMcpRegistry({
      mode: "static",
      target,
      getContext: () => hostContext(),
      adapters: adapters({
        executeTool: async () => {
          adapterCalls += 1;
          return completed("should not execute");
        },
      }),
    });
    await registry.sync();

    const result = await target.latest("transform_object").execute(
      { objectId: "note-1", transform: { x: 400 } },
      { signal: new AbortController().signal },
    );

    expect(result).toEqual({
      ok: false,
      code: "not_available",
      message: "not available yet: add canvas content first",
    });
    expect(adapterCalls).toBe(0);
  });

  it("applies the same authoritative content guard to organization in static mode", async () => {
    const target = new RecordingRegistrationTarget();
    let adapterCalls = 0;
    const registry = new WebMcpRegistry({
      mode: "static",
      target,
      getContext: () => hostContext(),
      adapters: adapters({
        executeTool: async () => {
          adapterCalls += 1;
          return completed("should not execute");
        },
      }),
    });
    await registry.sync();

    const result = await target.latest("organize_objects").execute(
      {
        action: "ungroup",
        frameId: "frame-launch",
      },
      { signal: new AbortController().signal },
    );

    expect(result).toEqual({
      ok: false,
      code: "not_available",
      message: "not available yet: add canvas content first",
    });
    expect(adapterCalls).toBe(0);
  });

  it("rejects unknown input fields before an adapter can observe them", async () => {
    const target = new RecordingRegistrationTarget();
    let adapterCalls = 0;
    const registry = new WebMcpRegistry({
      mode: "static",
      target,
      getContext: () =>
        hostContext({ ...emptyRoom, hasContent: true, selection: "object" }),
      adapters: adapters({
        executeTool: async () => {
          adapterCalls += 1;
          return completed("should not execute");
        },
      }),
    });
    await registry.sync();

    const result = await target.latest("transform_object").execute(
      {
        objectId: "note-1",
        transform: { x: 400 },
        agentInventedField: "unsafe",
      },
      { signal: new AbortController().signal },
    );

    expect(result).toEqual({
      ok: false,
      code: "invalid_input",
      message: "invalid tool input: check the documented schema",
    });
    expect(adapterCalls).toBe(0);
  });

  it("returns a compact failure instead of exposing an adapter exception", async () => {
    const target = new RecordingRegistrationTarget();
    const registry = new WebMcpRegistry({
      mode: "static",
      target,
      getContext: () => hostContext(),
      adapters: adapters({
        executeTool: async () => {
          throw new Error("private database detail");
        },
      }),
    });
    await registry.sync();

    const result = await target.latest("get_canvas_state").execute(
      {},
      { signal: new AbortController().signal },
    );

    expect(result).toEqual({
      ok: false,
      code: "execution_failed",
      message: "tool execution failed: the canvas made no confirmed change",
    });
  });

  it("passes the invocation cancellation signal through to the adapter", async () => {
    const target = new RecordingRegistrationTarget();
    let observedSignal: AbortSignal | undefined;
    const registry = new WebMcpRegistry({
      mode: "static",
      target,
      getContext: () => hostContext(),
      adapters: adapters({
        executeTool: async (request) => {
          observedSignal = request.signal;
          return await new Promise<WebMcpToolResult>((_resolve, reject) => {
            request.signal.addEventListener(
              "abort",
              () => reject(request.signal.reason),
              { once: true },
            );
          });
        },
      }),
    });
    await registry.sync();
    const invocation = new AbortController();
    const reason = new DOMException("Invocation cancelled", "AbortError");

    const execution = target.latest("create_object").execute(
      {
        type: "note",
        title: "Agent note",
        text: "Validated first.",
        tone: "sky",
      },
      { signal: invocation.signal },
    );
    invocation.abort(reason);

    await expect(execution).rejects.toBe(reason);
    expect(observedSignal).toBe(invocation.signal);
  });

  it("does not invoke an adapter when an invocation is already cancelled", async () => {
    const target = new RecordingRegistrationTarget();
    let adapterCalls = 0;
    const registry = new WebMcpRegistry({
      mode: "static",
      target,
      getContext: () => hostContext(),
      adapters: adapters({
        executeTool: async () => {
          adapterCalls += 1;
          return completed("should not execute");
        },
      }),
    });
    await registry.sync();
    const invocation = new AbortController();
    const reason = new DOMException("Already cancelled", "AbortError");
    invocation.abort(reason);

    const execution = target.latest("get_canvas_state").execute(
      {},
      { signal: invocation.signal },
    );

    await expect(execution).rejects.toBe(reason);
    expect(adapterCalls).toBe(0);
  });

  it("does not let registration removal cancel an in-flight execution", async () => {
    const target = new RecordingRegistrationTarget();
    let context = hostContext();
    const pending = deferred<WebMcpToolResult>();
    let invocationSignal: AbortSignal | undefined;
    const registry = new WebMcpRegistry({
      mode: "dynamic",
      target,
      getContext: () => context,
      adapters: adapters({
        executeTool: async (request) => {
          invocationSignal = request.signal;
          return await pending.promise;
        },
      }),
    });
    await registry.sync();
    const createRegistration = target.calls.find(
      (call) => call.tool.name === "create_object",
    );

    const execution = target.latest("create_object").execute(
      {
        type: "note",
        title: "In flight",
        text: "Complete independently.",
        tone: "sand",
      },
      { signal: new AbortController().signal },
    );
    await Promise.resolve();
    context = {
      phase: {
        roomActive: false,
        hasContent: false,
        selection: "none",
        collaboratorCount: 0,
        packet: "none",
      },
      actor: null,
      canMutateCanvas: false,
    };
    await registry.sync();

    expect(createRegistration?.signal.aborted).toBe(true);
    expect(invocationSignal?.aborted).toBe(false);
    pending.resolve(completed("in-flight command completed"));
    await expect(execution).resolves.toEqual(
      completed("in-flight command completed"),
    );
  });

  it("stages packet delivery using the approved recipient snapshot without accepting recipient overrides", async () => {
    const target = new RecordingRegistrationTarget();
    let stagedPacketId: string | undefined;
    const registry = new WebMcpRegistry({
      mode: "static",
      target,
      getContext: () =>
        hostContext({
          ...emptyRoom,
          hasContent: true,
          packet: "approved",
        }),
      adapters: adapters({
        stagePacketSendRequest: async (request) => {
          stagedPacketId = request.input.packetId;
          return {
            ok: true,
            status: "awaiting_human_approval",
            message: "Send request staged for host confirmation.",
          };
        },
      }),
    });
    await registry.sync();
    const tool = target.latest("request_packet_send");

    const overrideAttempt = await tool.execute(
      { packetId: "packet-v2", recipients: ["other@example.com"] },
      { signal: new AbortController().signal },
    );
    const result = await tool.execute(
      { packetId: "packet-v2" },
      { signal: new AbortController().signal },
    );

    expect(overrideAttempt).toMatchObject({ ok: false, code: "invalid_input" });
    expect(result).toEqual({
      ok: true,
      status: "awaiting_human_approval",
      message: "Send request staged for host confirmation.",
    });
    expect(stagedPacketId).toBe("packet-v2");
    expect(WEBMCP_TOOL_CATALOG.request_packet_send.humanApproval).toBe(
      "required_after_staging",
    );
  });
});
