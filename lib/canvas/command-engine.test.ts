import { describe, expect, it } from "vitest";

import {
  applyCanvasCommand,
  createEmptyCanvasState,
  type CanvasCommandEnvelope,
  type CommandRuntime,
} from "@/lib/canvas/command-engine";

const host = {
  id: "participant-host",
  displayName: "Danny",
  type: "human" as const,
};

const runtime: CommandRuntime = {
  createId: (() => {
    let counter = 0;
    return (prefix) => `${prefix}-${++counter}`;
  })(),
};

function command(
  revision: number,
  payload: CanvasCommandEnvelope["command"],
): CanvasCommandEnvelope {
  return {
    id: `command-${revision + 1}`,
    roomId: "room-demo",
    baseRevision: revision,
    issuedAt: `2026-08-27T12:00:0${revision}.000Z`,
    actor: host,
    source: "pointer",
    command: payload,
  };
}

function createNoteCommand(revision = 0): CanvasCommandEnvelope {
  return command(revision, {
    type: "object.create",
    object: {
      id: "note-1",
      type: "note",
      title: "Launch question",
      x: 120,
      y: 80,
      width: 280,
      height: 190,
      zIndex: 1,
      payload: {
        text: "Which customer workflow proves the thesis?",
        tone: "coral",
      },
    },
  });
}

describe("applyCanvasCommand", () => {
  it("creates a typed object and an attributable revision receipt", () => {
    const initial = createEmptyCanvasState("room-demo");

    const result = applyCanvasCommand(initial, createNoteCommand(), runtime);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected command to succeed");

    expect(result.state.revision).toBe(1);
    expect(result.state.objects["note-1"]).toMatchObject({
      id: "note-1",
      roomId: "room-demo",
      type: "note",
      title: "Launch question",
      x: 120,
      y: 80,
      width: 280,
      height: 190,
      pinned: false,
      minimized: false,
      version: 1,
      deletedAt: null,
      createdBy: "participant-host",
    });
    expect(result.receipt).toMatchObject({
      revision: 1,
      actor: host,
      action: "create",
      affectedObjectIds: ["note-1"],
      description: "Danny created “Launch question”.",
    });
    expect(result.receipt.before.objects["note-1"]).toBeNull();
    expect(result.receipt.after.objects["note-1"]?.version).toBe(1);
  });

  it("moves and resizes through one transform command without mutating prior state", () => {
    const created = applyCanvasCommand(
      createEmptyCanvasState("room-demo"),
      createNoteCommand(),
      runtime,
    );
    if (!created.ok) throw new Error("fixture creation failed");

    const result = applyCanvasCommand(
      created.state,
      command(1, {
        type: "object.transform",
        objectId: "note-1",
        transform: { x: 420, y: 260, width: 340, height: 220 },
      }),
      runtime,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected command to succeed");
    expect(created.state.objects["note-1"]).toMatchObject({
      x: 120,
      y: 80,
      width: 280,
      height: 190,
      version: 1,
    });
    expect(result.state.objects["note-1"]).toMatchObject({
      x: 420,
      y: 260,
      width: 340,
      height: 220,
      version: 2,
    });
    expect(result.receipt.action).toBe("transform");
  });

  it("rejects spatial transforms while an object is pinned", () => {
    const created = applyCanvasCommand(
      createEmptyCanvasState("room-demo"),
      createNoteCommand(),
      runtime,
    );
    if (!created.ok) throw new Error("fixture creation failed");
    const pinned = applyCanvasCommand(
      created.state,
      command(1, {
        type: "object.set_flags",
        objectId: "note-1",
        flags: { pinned: true },
      }),
      runtime,
    );
    if (!pinned.ok) throw new Error("fixture pin failed");

    const result = applyCanvasCommand(
      pinned.state,
      command(2, {
        type: "object.transform",
        objectId: "note-1",
        transform: { x: 999, y: 999 },
      }),
      runtime,
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "OBJECT_PINNED",
        message: "Unpin “Launch question” before moving or resizing it.",
      },
    });
    expect(result.state).toBe(pinned.state);
  });

  it("soft-discards an object so the mutation remains reversible", () => {
    const created = applyCanvasCommand(
      createEmptyCanvasState("room-demo"),
      createNoteCommand(),
      runtime,
    );
    if (!created.ok) throw new Error("fixture creation failed");

    const result = applyCanvasCommand(
      created.state,
      command(1, { type: "object.discard", objectId: "note-1" }),
      runtime,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected command to succeed");
    expect(result.state.objects["note-1"]?.deletedAt).toBe(
      "2026-08-27T12:00:01.000Z",
    );
    expect(result.receipt.action).toBe("discard");
    expect(result.receipt.description).toBe(
      "Danny moved “Launch question” to recoverable trash.",
    );
  });

  it("undoes the latest reversible command and records who performed the undo", () => {
    const created = applyCanvasCommand(
      createEmptyCanvasState("room-demo"),
      createNoteCommand(),
      runtime,
    );
    if (!created.ok) throw new Error("fixture creation failed");
    const moved = applyCanvasCommand(
      created.state,
      command(1, {
        type: "object.transform",
        objectId: "note-1",
        transform: { x: 540, y: 315 },
      }),
      runtime,
    );
    if (!moved.ok) throw new Error("fixture transform failed");

    const result = applyCanvasCommand(
      moved.state,
      command(2, { type: "history.undo" }),
      runtime,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected command to succeed");
    expect(result.state.objects["note-1"]).toEqual(
      created.state.objects["note-1"],
    );
    expect(result.state.revision).toBe(3);
    expect(result.receipt).toMatchObject({
      action: "undo",
      undoOfReceiptId: moved.receipt.id,
      actor: host,
      affectedObjectIds: ["note-1"],
      description: "Danny undid: Danny transformed “Launch question” spatially.",
    });
    expect(result.state.undoneReceiptIds).toEqual([moved.receipt.id]);
  });

  it("rejects a command based on a stale revision", () => {
    const created = applyCanvasCommand(
      createEmptyCanvasState("room-demo"),
      createNoteCommand(),
      runtime,
    );
    if (!created.ok) throw new Error("fixture creation failed");

    const result = applyCanvasCommand(
      created.state,
      command(0, {
        type: "object.set_flags",
        objectId: "note-1",
        flags: { minimized: true },
      }),
      runtime,
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "STALE_REVISION",
        message: "Canvas changed. Refresh the command and try again.",
      },
    });
    expect(result.state).toBe(created.state);
  });

  it("rejects malformed external command input before any mutation occurs", () => {
    const initial = createEmptyCanvasState("room-demo");
    const malformed = command(0, {
      type: "object.create",
      object: {
        id: "note-malformed",
        type: "note",
        title: "Malformed",
        x: 0,
        y: 0,
        width: -1,
        height: 180,
        zIndex: 1,
        payload: {
          text: "Do not create this.",
          tone: "coral",
          unknownAgentField: true,
        },
      },
    } as unknown as CanvasCommandEnvelope["command"]);

    const result = applyCanvasCommand(initial, malformed, runtime);

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "INVALID_COMMAND",
        message: "Command input did not match the canvas schema.",
      },
    });
    expect(result.state).toBe(initial);
    expect(result.state.objects).toEqual({});
    expect(result.state.receipts).toEqual([]);
  });

  it("rotates an object through the same transform receipt and undo path", () => {
    const created = applyCanvasCommand(
      createEmptyCanvasState("room-demo"),
      createNoteCommand(),
      runtime,
    );
    if (!created.ok) throw new Error("fixture creation failed");

    const rotated = applyCanvasCommand(
      created.state,
      command(1, {
        type: "object.transform",
        objectId: "note-1",
        transform: { rotation: 15 },
      }),
      runtime,
    );
    if (!rotated.ok) throw new Error("expected rotation to succeed");

    expect(rotated.state.objects["note-1"]).toMatchObject({
      rotation: 15,
      version: 2,
    });
    expect(rotated.receipt).toMatchObject({
      action: "transform",
      affectedObjectIds: ["note-1"],
    });
    const undone = applyCanvasCommand(
      rotated.state,
      command(2, { type: "history.undo" }),
      runtime,
    );
    expect(undone.ok && undone.state.objects["note-1"]?.rotation).toBe(0);
  });

  it("groups multiple objects into an attributable frame and undoes atomically", () => {
    const first = applyCanvasCommand(
      createEmptyCanvasState("room-demo"),
      createNoteCommand(),
      runtime,
    );
    if (!first.ok) throw new Error("fixture creation failed");
    const second = applyCanvasCommand(
      first.state,
      command(1, {
        type: "object.create",
        object: {
          id: "note-2",
          type: "note",
          title: "Delivery risk",
          x: 460,
          y: 120,
          width: 280,
          height: 190,
          zIndex: 2,
          payload: { text: "Keep the fallback honest.", tone: "sky" },
        },
      }),
      runtime,
    );
    if (!second.ok) throw new Error("fixture creation failed");

    const grouped = applyCanvasCommand(
      second.state,
      command(2, {
        type: "objects.group",
        objectIds: ["note-1", "note-2"],
        frame: {
          id: "frame-planning",
          type: "frame",
          title: "Planning cluster",
          x: 80,
          y: 40,
          width: 700,
          height: 310,
          zIndex: 0,
          payload: { tone: "sky" },
        },
      }),
      runtime,
    );
    if (!grouped.ok) throw new Error("expected grouping to succeed");

    expect(grouped.state.objects["frame-planning"]).toMatchObject({
      type: "frame",
      parentId: null,
      rotation: 0,
      version: 1,
    });
    expect(grouped.state.objects["note-1"]).toMatchObject({
      parentId: "frame-planning",
      version: 2,
    });
    expect(grouped.state.objects["note-2"]).toMatchObject({
      parentId: "frame-planning",
      version: 2,
    });
    expect(grouped.receipt).toMatchObject({
      action: "group",
      affectedObjectIds: ["frame-planning", "note-1", "note-2"],
      description: "Danny grouped 2 objects in “Planning cluster”.",
    });

    const undone = applyCanvasCommand(
      grouped.state,
      command(3, { type: "history.undo" }),
      runtime,
    );
    if (!undone.ok) throw new Error("expected group undo to succeed");
    expect(undone.state.objects["frame-planning"]).toBeUndefined();
    expect(undone.state.objects["note-1"]?.parentId).toBeNull();
    expect(undone.state.objects["note-2"]?.parentId).toBeNull();
  });

  it("moves a frame and its descendants in one canonical transform receipt", () => {
    let state = createEmptyCanvasState("room-demo");
    for (const envelope of [
      createNoteCommand(),
      command(1, {
        type: "object.create",
        object: {
          id: "frame-planning",
          type: "frame",
          title: "Planning cluster",
          x: 80,
          y: 40,
          width: 500,
          height: 300,
          zIndex: 0,
          payload: { tone: "violet" },
        },
      }),
    ]) {
      const result = applyCanvasCommand(state, envelope, runtime);
      if (!result.ok) throw new Error("fixture creation failed");
      state = result.state;
    }
    const grouped = applyCanvasCommand(
      state,
      command(2, {
        type: "objects.group",
        objectIds: ["note-1", "frame-planning"],
        frame: {
          id: "frame-outer",
          type: "frame",
          title: "Outer frame",
          x: 40,
          y: 20,
          width: 600,
          height: 380,
          zIndex: 0,
          payload: { tone: "sand" },
        },
      }),
      runtime,
    );
    if (!grouped.ok) throw new Error("fixture grouping failed");

    const moved = applyCanvasCommand(
      grouped.state,
      command(3, {
        type: "object.transform",
        objectId: "frame-outer",
        transform: { x: 140, y: 70 },
      }),
      runtime,
    );
    if (!moved.ok) throw new Error("expected frame move to succeed");

    expect(moved.state.objects["frame-outer"]).toMatchObject({ x: 140, y: 70 });
    expect(moved.state.objects["note-1"]).toMatchObject({ x: 220, y: 130 });
    expect(moved.state.objects["frame-planning"]).toMatchObject({ x: 180, y: 90 });
    expect(moved.receipt.affectedObjectIds).toEqual([
      "frame-outer",
      "note-1",
      "frame-planning",
    ]);
  });

  it("ungroups a frame by promoting its direct children and preserving the frame for undo", () => {
    const first = applyCanvasCommand(
      createEmptyCanvasState("room-demo"),
      createNoteCommand(),
      runtime,
    );
    if (!first.ok) throw new Error("fixture creation failed");
    const grouped = applyCanvasCommand(
      first.state,
      command(1, {
        type: "objects.group",
        objectIds: ["note-1"],
        frame: {
          id: "frame-planning",
          type: "frame",
          title: "Planning cluster",
          x: 80,
          y: 40,
          width: 400,
          height: 280,
          zIndex: 0,
          payload: { tone: "coral" },
        },
      }),
      runtime,
    );
    if (!grouped.ok) throw new Error("fixture grouping failed");

    const ungrouped = applyCanvasCommand(
      grouped.state,
      command(2, { type: "objects.ungroup", frameId: "frame-planning" }),
      runtime,
    );
    if (!ungrouped.ok) throw new Error("expected ungroup to succeed");

    expect(ungrouped.state.objects["note-1"]?.parentId).toBeNull();
    expect(ungrouped.state.objects["frame-planning"]?.deletedAt).toBe(
      "2026-08-27T12:00:02.000Z",
    );
    expect(ungrouped.receipt).toMatchObject({
      action: "ungroup",
      affectedObjectIds: ["frame-planning", "note-1"],
    });
  });

  it("redoes the latest undo and clears redo history after a new mutation", () => {
    const created = applyCanvasCommand(
      createEmptyCanvasState("room-demo"),
      createNoteCommand(),
      runtime,
    );
    if (!created.ok) throw new Error("fixture creation failed");
    const moved = applyCanvasCommand(
      created.state,
      command(1, {
        type: "object.transform",
        objectId: "note-1",
        transform: { x: 540 },
      }),
      runtime,
    );
    if (!moved.ok) throw new Error("fixture transform failed");
    const undone = applyCanvasCommand(
      moved.state,
      command(2, { type: "history.undo" }),
      runtime,
    );
    if (!undone.ok) throw new Error("fixture undo failed");

    const redone = applyCanvasCommand(
      undone.state,
      command(3, { type: "history.redo" }),
      runtime,
    );
    if (!redone.ok) throw new Error("expected redo to succeed");
    expect(redone.state.objects["note-1"]?.x).toBe(540);
    expect(redone.receipt).toMatchObject({
      action: "redo",
      undoOfReceiptId: undone.receipt.id,
      affectedObjectIds: ["note-1"],
    });
    expect(redone.state.undoneReceiptIds).toEqual([]);
    expect(redone.state.redoReceiptIds).toEqual([]);

    const undoAgain = applyCanvasCommand(
      redone.state,
      command(4, { type: "history.undo" }),
      runtime,
    );
    if (!undoAgain.ok) throw new Error("expected undo after redo to succeed");
    expect(undoAgain.receipt.undoOfReceiptId).toBe(redone.receipt.id);
    expect(undoAgain.state.objects["note-1"]?.x).toBe(120);
    const undoPrior = applyCanvasCommand(
      undoAgain.state,
      command(5, { type: "history.undo" }),
      runtime,
    );
    if (!undoPrior.ok) throw new Error("expected prior undo to succeed");
    expect(undoPrior.receipt.undoOfReceiptId).toBe(created.receipt.id);
    expect(undoPrior.state.objects["note-1"]).toBeUndefined();
    const branched = applyCanvasCommand(
      undoAgain.state,
      command(5, {
        type: "object.set_flags",
        objectId: "note-1",
        flags: { minimized: true },
      }),
      runtime,
    );
    if (!branched.ok) throw new Error("expected branch mutation to succeed");
    expect(branched.state.redoReceiptIds).toEqual([]);
    const refusedRedo = applyCanvasCommand(
      branched.state,
      command(6, { type: "history.redo" }),
      runtime,
    );
    expect(refusedRedo).toMatchObject({
      ok: false,
      error: { code: "NOTHING_TO_REDO" },
    });
  });
});
