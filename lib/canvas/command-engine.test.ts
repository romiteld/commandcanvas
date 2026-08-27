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
});
