import { describe, expect, it, vi } from "vitest";

import { CANVAS_CAPABILITY_INPUT_SCHEMAS } from "@/lib/canvas/capability-catalog";
import { createCanvasStore } from "@/lib/canvas/canvas-store";
import type { CanvasCommand } from "@/lib/canvas/command-engine";
import { createCanvasWebMcpAdapters } from "@/lib/webmcp/canvas-adapters";
import type { WebMcpExecutionContext } from "@/lib/webmcp/phase-guards";
import type { WebMcpToolResult } from "@/lib/webmcp/tool-catalog";

const context: WebMcpExecutionContext = {
  phase: {
    roomActive: true,
    hasContent: true,
    selection: "object",
    collaboratorCount: 1,
    packet: "none",
  },
  actor: { participantId: "participant-host", role: "host" },
  canMutateCanvas: true,
};

function fixture() {
  let sequence = 0;
  const store = createCanvasStore("room-demo", {
    actor: { id: "participant-host", displayName: "Danny", type: "human" },
    createId: (prefix) => `${prefix}-${++sequence}`,
    now: () => `2026-09-03T20:00:${String(sequence).padStart(2, "0")}.000Z`,
  });
  return { store, adapters: createCanvasWebMcpAdapters({ store }) };
}

function createNote(
  store: ReturnType<typeof createCanvasStore>,
  id: string,
  x = 100,
) {
  const result = store.getState().dispatch(
    {
      type: "object.create",
      object: {
        id,
        type: "note",
        title: id,
        x,
        y: 100,
        width: 260,
        height: 180,
        zIndex: 2,
        payload: { text: "", tone: "sand" },
      },
    },
    "pointer",
  );
  expect(result.ok).toBe(true);
}

describe("canonical canvas optimistic object versions", () => {
  it.each([
    [
      "transform_object",
      { objectId: "note-1", expectedVersion: 4, transform: { x: 240 } },
    ],
    [
      "set_object_state",
      { objectId: "note-1", expectedVersion: 4, state: { pinned: true } },
    ],
    ["discard_object", { objectId: "note-1", expectedVersion: 4 }],
    [
      "organize_objects",
      {
        action: "group",
        objectIds: ["note-1", "note-2"],
        expectedVersions: [
          { objectId: "note-1", expectedVersion: 4 },
          { objectId: "note-2", expectedVersion: 2 },
        ],
        frame: {
          id: "frame-1",
          title: "Frame 1",
          x: 40,
          y: 40,
          width: 800,
          height: 400,
          zIndex: 1,
          tone: "violet",
        },
      },
    ],
    [
      "organize_objects",
      { action: "ungroup", frameId: "frame-1", expectedVersion: 3 },
    ],
  ] as const)("requires expected object versions for %s", (capability, input) => {
    expect(
      CANVAS_CAPABILITY_INPUT_SCHEMAS[capability].safeParse(input).success,
    ).toBe(true);
  });

  it.each([
    ["transform_object", { objectId: "note-1", transform: { x: 240 } }],
    ["set_object_state", { objectId: "note-1", state: { pinned: true } }],
    ["discard_object", { objectId: "note-1" }],
    [
      "organize_objects",
      {
        action: "group",
        objectIds: ["note-1", "note-2"],
        frame: {
          id: "frame-1",
          title: "Frame 1",
          x: 40,
          y: 40,
          width: 800,
          height: 400,
          zIndex: 1,
          tone: "violet",
        },
      },
    ],
    ["organize_objects", { action: "ungroup", frameId: "frame-1" }],
  ] as const)("refuses unversioned %s input", (capability, input) => {
    expect(
      CANVAS_CAPABILITY_INPUT_SCHEMAS[capability].safeParse(input).success,
    ).toBe(false);
  });

  it.each([
    [
      "transform_object",
      { objectId: "note-target", expectedVersion: 1, transform: { x: 640 } },
    ],
    [
      "set_object_state",
      {
        objectId: "note-target",
        expectedVersion: 1,
        state: { minimized: true },
      },
    ],
    ["discard_object", { objectId: "note-target", expectedVersion: 1 }],
  ] as const)(
    "refuses stale %s with no mutation or receipt",
    async (toolName, input) => {
      const { store, adapters } = fixture();
      createNote(store, "note-target");
      store.getState().dispatch(
        { type: "object.transform", objectId: "note-target", transform: { x: 180 } },
        "pointer",
      );
      const before = store.getState().canvas;

      const result = await adapters.executeTool({
        toolName,
        input,
        source: "voice",
        signal: new AbortController().signal,
        context,
      } as never);

      expect(result).toMatchObject({ ok: false });
      expect(store.getState().canvas.revision).toBe(before.revision);
      expect(store.getState().canvas.receipts).toHaveLength(
        before.receipts.length,
      );
      expect(store.getState().canvas.objects["note-target"]?.version).toBe(2);
    },
  );

  it("refuses grouping when any selected object version is stale", async () => {
    const { store, adapters } = fixture();
    createNote(store, "note-a", 100);
    createNote(store, "note-b", 420);
    store.getState().dispatch(
      { type: "object.transform", objectId: "note-b", transform: { y: 140 } },
      "pointer",
    );
    const before = store.getState().canvas;

    const result = await adapters.executeTool({
      toolName: "organize_objects",
      input: {
        action: "group",
        objectIds: ["note-a", "note-b"],
        expectedVersions: [
          { objectId: "note-a", expectedVersion: 1 },
          { objectId: "note-b", expectedVersion: 1 },
        ],
        frame: {
          id: "frame-stale",
          title: "Stale frame",
          x: 40,
          y: 40,
          width: 760,
          height: 400,
          zIndex: 1,
          tone: "violet",
        },
      },
      source: "voice",
      signal: new AbortController().signal,
      context,
    } as never);

    expect(result).toMatchObject({ ok: false });
    expect(store.getState().canvas.revision).toBe(before.revision);
    expect(store.getState().canvas.receipts).toHaveLength(before.receipts.length);
    expect(store.getState().canvas.objects["frame-stale"]).toBeUndefined();
  });

  it("refuses ungrouping when the frame version is stale", async () => {
    const { store, adapters } = fixture();
    createNote(store, "note-a", 100);
    createNote(store, "note-b", 420);
    const grouped = store.getState().dispatch(
      {
        type: "objects.group",
        objectIds: ["note-a", "note-b"],
        frame: {
          id: "frame-1",
          type: "frame",
          title: "Frame 1",
          x: 40,
          y: 40,
          width: 760,
          height: 400,
          zIndex: 1,
          payload: { tone: "violet" },
        },
      },
      "pointer",
    );
    expect(grouped.ok).toBe(true);
    store.getState().dispatch(
      {
        type: "object.set_flags",
        objectId: "frame-1",
        flags: { minimized: true },
      },
      "pointer",
    );
    const before = store.getState().canvas;

    const result = await adapters.executeTool({
      toolName: "organize_objects",
      input: { action: "ungroup", frameId: "frame-1", expectedVersion: 1 },
      source: "voice",
      signal: new AbortController().signal,
      context,
    } as never);

    expect(result).toMatchObject({ ok: false });
    expect(store.getState().canvas.revision).toBe(before.revision);
    expect(store.getState().canvas.receipts).toHaveLength(before.receipts.length);
    expect(store.getState().canvas.objects["frame-1"]?.deletedAt).toBeNull();
  });
});

describe("agent-created object selection integrity", () => {
  it("refuses a successful mutation result that does not identify the exact generated ID", async () => {
    const { store } = fixture();
    createNote(store, "note-human");
    store.getState().selectObject("note-human");
    const adapters = createCanvasWebMcpAdapters({
      store,
      dispatchMutation: vi.fn(async (): Promise<WebMcpToolResult> => ({
        ok: true,
        status: "completed",
        message: "Wrong object reported.",
        data: { affectedObjectIds: ["note-human"] },
      })),
    });

    const result = await adapters.executeTool({
      toolName: "create_object",
      input: { type: "note", title: "Agent note" },
      source: "voice",
      signal: new AbortController().signal,
      context,
    });

    expect(result).toEqual({
      ok: false,
      code: "execution_failed",
      message: "The canvas did not confirm the exact created object.",
    });
    expect(store.getState().selectedObjectId).toBe("note-human");
  });

  it("does not overwrite a newer human selection after an asynchronous create", async () => {
    const { store } = fixture();
    createNote(store, "note-before");
    createNote(store, "note-human");
    store.getState().selectObject("note-before");
    let resolveMutation!: (value: {
      ok: true;
      status: "completed";
      message: string;
      data: { affectedObjectIds: string[] };
    }) => void;
    const mutation = new Promise<{
      ok: true;
      status: "completed";
      message: string;
      data: { affectedObjectIds: string[] };
    }>((resolve) => {
      resolveMutation = resolve;
    });
    let generatedId = "";
    const adapters = createCanvasWebMcpAdapters({
      store,
      dispatchMutation: vi.fn(async (command: CanvasCommand) => {
        if (command.type !== "object.create") throw new Error("unexpected command");
        generatedId = command.object.id;
        const localResult = store.getState().dispatch(command, "voice");
        expect(localResult.ok).toBe(true);
        return mutation;
      }),
    });

    const pending = adapters.executeTool({
      toolName: "create_object",
      input: { type: "note", title: "Agent note" },
      source: "voice",
      signal: new AbortController().signal,
      context,
    });
    await vi.waitFor(() => expect(generatedId).not.toBe(""));
    store.getState().selectObject("note-human");
    resolveMutation({
      ok: true,
      status: "completed",
      message: "Created.",
      data: { affectedObjectIds: [generatedId] },
    });

    await expect(pending).resolves.toMatchObject({ ok: true });
    expect(store.getState().selectedObjectId).toBe("note-human");
  });
});
