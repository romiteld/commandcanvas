import { describe, expect, it, vi } from "vitest";

import {
  CANVAS_CAPABILITY_CATALOG,
  CANVAS_CAPABILITY_NAMES,
  REALTIME_CAPABILITY_ALIASES,
  projectRealtimeCapabilityTools,
  projectWebMcpCapabilityCatalog,
} from "@/lib/canvas/capability-catalog";
import {
  executeCanvasCapability,
  type CanvasCapabilityAdapter,
} from "@/lib/canvas/capability-executor";

const hostContext = {
  phase: {
    roomActive: true,
    hasContent: true,
    selection: "object" as const,
    collaboratorCount: 1,
    packet: "approved" as const,
  },
  actor: { participantId: "host-1", role: "host" as const },
  canMutateCanvas: true,
};

describe("CanvasCapabilityCatalog transport projections", () => {
  it("keeps the eleven public Site Tools stable and appends workspace control", () => {
    expect(CANVAS_CAPABILITY_NAMES).toEqual([
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
  });

  it("projects every WebMCP descriptor from the canonical definition without cloning its contract", () => {
    const projected = projectWebMcpCapabilityCatalog();

    expect(Object.keys(projected)).toEqual(CANVAS_CAPABILITY_NAMES);
    for (const name of CANVAS_CAPABILITY_NAMES) {
      expect(projected[name].description).toBe(
        CANVAS_CAPABILITY_CATALOG[name].description,
      );
      expect(projected[name].inputSchema).toBe(
        CANVAS_CAPABILITY_CATALOG[name].inputSchema,
      );
      expect(projected[name].annotations).toBe(
        CANVAS_CAPABILITY_CATALOG[name].annotations,
      );
      expect(projected[name].humanApproval).toBe(
        CANVAS_CAPABILITY_CATALOG[name].humanApproval,
      );
    }
  });

  it("derives every Realtime function schema and normalizer from a named capability", () => {
    const projected = projectRealtimeCapabilityTools();

    expect(projected.map(({ name }) => name)).toEqual(
      REALTIME_CAPABILITY_ALIASES.map(({ name }) => name),
    );
    for (const alias of REALTIME_CAPABILITY_ALIASES) {
      expect(CANVAS_CAPABILITY_NAMES).toContain(alias.capability);
      expect(projected.find(({ name }) => name === alias.name)?.parameters).toEqual(
        expect.objectContaining({ type: "object", additionalProperties: false }),
      );
    }
  });

  it("normalizes equivalent canvas reads and note updates into identical canonical inputs", () => {
    const inspect = REALTIME_CAPABILITY_ALIASES.find(
      ({ name }) => name === "inspect_canvas",
    );
    const append = REALTIME_CAPABILITY_ALIASES.find(
      ({ name }) => name === "append_selected_note",
    );

    expect(inspect?.normalize({ scope: "all", includeReceipts: true })).toEqual({
      scope: "all",
      includeReceipts: true,
    });
    expect(append?.normalize({ text: "Owner: Sarah" })).toEqual({
      text: "Owner: Sarah",
    });
  });

  it("exposes the full bounded workspace-control grammar", () => {
    const schema = CANVAS_CAPABILITY_CATALOG.control_workspace.inputSchema;
    for (const action of [
      "start_drawing",
      "finish_drawing",
      "cancel_drawing",
      "zoom_in",
      "zoom_out",
      "fit_all",
      "fit_selected",
      "focus_selected",
      "restore_view",
    ] as const)
      expect(schema.safeParse({ action }).success, action).toBe(true);

    expect(schema.safeParse({ action: "set_zoom", scale: 2 }).success).toBe(
      true,
    );
    expect(schema.safeParse({ action: "set_zoom" }).success).toBe(false);
    expect(schema.safeParse({ action: "set_zoom", scale: 12 }).success).toBe(
      false,
    );
    expect(schema.safeParse({ action: "delete_everything" }).success).toBe(
      false,
    );
  });
});

describe("shared capability execution boundary", () => {
  it("applies the same invocation-time role guard before either transport adapter", async () => {
    const adapter = vi.fn<CanvasCapabilityAdapter>();
    const participantContext = {
      ...hostContext,
      actor: { participantId: "participant-2", role: "participant" as const },
    };

    const webmcp = await executeCanvasCapability({
      capability: "prepare_meeting_packet",
      input: {},
      source: "webmcp",
      signal: new AbortController().signal,
      getContext: () => participantContext,
      adapter,
    });
    const voice = await executeCanvasCapability({
      capability: "prepare_meeting_packet",
      input: {},
      source: "voice",
      signal: new AbortController().signal,
      getContext: () => participantContext,
      adapter,
    });

    expect(webmcp).toEqual(voice);
    expect(webmcp).toMatchObject({ ok: false, code: "forbidden" });
    expect(adapter).not.toHaveBeenCalled();
  });

  it("applies one strict validator before dispatch and never passes rejected data", async () => {
    const adapter = vi.fn<CanvasCapabilityAdapter>();

    const result = await executeCanvasCapability({
      capability: "transform_object",
      input: {
        objectId: "note-1",
        transform: { x: 320 },
        unexpected: "private",
      },
      source: "voice",
      signal: new AbortController().signal,
      getContext: () => hostContext,
      adapter,
    });

    expect(result).toEqual({
      ok: false,
      code: "invalid_input",
      message: "invalid tool input: check the documented schema",
    });
    expect(adapter).not.toHaveBeenCalled();
  });

  it("preserves source provenance while producing the same parsed command payload", async () => {
    const calls: unknown[] = [];
    const adapter: CanvasCapabilityAdapter = async (request) => {
      calls.push(request);
      return { ok: true, status: "completed", message: "Applied." };
    };
    const input = { action: "zoom_in" as const };

    await executeCanvasCapability({
      capability: "control_workspace",
      input,
      source: "webmcp",
      signal: new AbortController().signal,
      getContext: () => hostContext,
      adapter,
    });
    await executeCanvasCapability({
      capability: "control_workspace",
      input,
      source: "voice",
      signal: new AbortController().signal,
      getContext: () => hostContext,
      adapter,
    });

    expect(calls).toEqual([
      expect.objectContaining({
        capability: "control_workspace",
        input,
        source: "webmcp",
      }),
      expect.objectContaining({
        capability: "control_workspace",
        input,
        source: "voice",
      }),
    ]);
  });

  it("cancels before guard, validation, or adapter work", async () => {
    const adapter = vi.fn<CanvasCapabilityAdapter>();
    const controller = new AbortController();
    controller.abort();

    await expect(
      executeCanvasCapability({
        capability: "get_canvas_state",
        input: {},
        source: "voice",
        signal: controller.signal,
        getContext: () => hostContext,
        adapter,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(adapter).not.toHaveBeenCalled();
  });

  it("refuses any packet-stage adapter that claims it sent or completed delivery", async () => {
    const result = await executeCanvasCapability({
      capability: "request_packet_send",
      input: { packetId: "packet-1" },
      source: "voice",
      signal: new AbortController().signal,
      getContext: () => hostContext,
      adapter: async () => ({
        ok: true,
        status: "completed",
        message: "Sent.",
      }),
    });

    expect(result).toEqual({
      ok: false,
      code: "execution_failed",
      message: "tool execution failed: the canvas made no confirmed change",
    });
  });
});
