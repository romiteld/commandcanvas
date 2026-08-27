import { describe, expect, it } from "vitest";

import { createCanvasStore } from "@/lib/canvas/canvas-store";
import { createCanvasWebMcpAdapters } from "@/lib/webmcp/canvas-adapters";
import type { WebMcpExecutionContext } from "@/lib/webmcp/phase-guards";

const context: WebMcpExecutionContext = {
  phase: {
    roomActive: true,
    hasContent: false,
    selection: "none",
    collaboratorCount: 1,
    packet: "none",
  },
  actor: { participantId: "participant-host", role: "host" },
  canMutate: true,
};

function fixture() {
  let id = 0;
  const store = createCanvasStore("room-demo", {
    actor: {
      id: "participant-host",
      displayName: "Danny",
      type: "human",
    },
    createId: (prefix) => `${prefix}-${++id}`,
    now: () => "2026-08-27T16:00:00.000Z",
  });
  return {
    store,
    adapters: createCanvasWebMcpAdapters({ store }),
  };
}

describe("canvas WebMCP adapters", () => {
  it("returns a compact live-state result without mutating the room", async () => {
    const { store, adapters } = fixture();
    const signal = new AbortController().signal;

    const result = await adapters.executeTool({
      toolName: "get_canvas_state",
      input: { includeReceipts: true },
      signal,
      context,
    });

    expect(result).toEqual({
      ok: true,
      status: "completed",
      message: "Canvas state read at revision 0.",
      data: {
        roomId: "room-demo",
        revision: 0,
        selectedObjectId: null,
        objects: [],
        receipts: [],
      },
    });
    expect(store.getState().canvas.revision).toBe(0);
  });

  it("routes an agent-created object through the canonical mutation and receipt pipeline", async () => {
    const { store, adapters } = fixture();

    const result = await adapters.executeTool({
      toolName: "create_object",
      input: {
        object: {
          id: "note-agent-created",
          type: "note",
          title: "Agent proposal",
          x: 320,
          y: 180,
          width: 280,
          height: 190,
          zIndex: 1,
          payload: { text: "Review this proposed decision.", tone: "sky" },
        },
      },
      signal: new AbortController().signal,
      context,
    });

    expect(result).toMatchObject({
      ok: true,
      status: "completed",
      message: "ChatGPT created “Agent proposal”.",
    });
    expect(store.getState().canvas.receipts[0]).toMatchObject({
      source: "webmcp",
      actor: {
        id: "agent-chatgpt",
        displayName: "ChatGPT",
        type: "agent",
      },
    });
  });

  it("returns the canonical refusal when an agent attempts to move a pinned object", async () => {
    const { store, adapters } = fixture();
    store.getState().dispatch(
      {
        type: "object.create",
        object: {
          id: "note-pinned",
          type: "note",
          title: "Pinned context",
          x: 100,
          y: 100,
          width: 280,
          height: 190,
          zIndex: 1,
          payload: { text: "Keep this still.", tone: "sand" },
        },
      },
      "pointer",
    );
    store.getState().dispatch(
      {
        type: "object.set_flags",
        objectId: "note-pinned",
        flags: { pinned: true },
      },
      "pointer",
    );

    const result = await adapters.executeTool({
      toolName: "transform_object",
      input: { objectId: "note-pinned", transform: { x: 900 } },
      signal: new AbortController().signal,
      context: {
        ...context,
        phase: { ...context.phase, hasContent: true },
      },
    });

    expect(result).toEqual({
      ok: false,
      code: "forbidden",
      message: "Unpin “Pinned context” before moving or resizing it.",
    });
    expect(store.getState().canvas.revision).toBe(2);
  });
});
