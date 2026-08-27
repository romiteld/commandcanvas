import { describe, expect, it } from "vitest";

import {
  createCanvasStore,
  type CanvasStoreDependencies,
} from "@/lib/canvas/canvas-store";

const actor = {
  id: "participant-host",
  displayName: "Danny",
  type: "human" as const,
};

function dependencies(): CanvasStoreDependencies {
  let id = 0;
  let second = 0;
  return {
    actor,
    createId: (prefix) => `${prefix}-${++id}`,
    now: () => `2026-08-27T13:00:${String(second++).padStart(2, "0")}.000Z`,
  };
}

const newNote = {
  type: "object.create" as const,
  object: {
    id: "note-1",
    type: "note" as const,
    title: "Decision",
    x: 200,
    y: 160,
    width: 280,
    height: 190,
    zIndex: 1,
    payload: { text: "Ship the smallest complete story.", tone: "coral" as const },
  },
};

describe("canvas store", () => {
  it("routes UI intent through the canonical command engine", () => {
    const store = createCanvasStore("room-demo", dependencies());

    const result = store.getState().dispatch(newNote, "typed");

    expect(result.ok).toBe(true);
    expect(store.getState().canvas.revision).toBe(1);
    expect(store.getState().canvas.objects["note-1"]?.payload.text).toBe(
      "Ship the smallest complete story.",
    );
    expect(store.getState().canvas.receipts[0]?.source).toBe("typed");
  });

  it("surfaces a command refusal without changing canonical canvas state", () => {
    const store = createCanvasStore("room-demo", dependencies());
    store.getState().dispatch(newNote, "pointer");
    store.getState().dispatch(
      {
        type: "object.set_flags",
        objectId: "note-1",
        flags: { pinned: true },
      },
      "pointer",
    );
    const before = store.getState().canvas;

    const result = store.getState().dispatch(
      {
        type: "object.transform",
        objectId: "note-1",
        transform: { x: 900 },
      },
      "gesture",
    );

    expect(result.ok).toBe(false);
    expect(store.getState().canvas).toBe(before);
    expect(store.getState().lastError).toEqual({
      code: "OBJECT_PINNED",
      message: "Unpin “Decision” before moving or resizing it.",
    });
  });

  it("keeps selection and viewport ephemeral while undo changes canonical state", () => {
    const store = createCanvasStore("room-demo", dependencies());
    store.getState().dispatch(newNote, "pointer");
    store.getState().selectObject("note-1");
    store.getState().setViewport({ x: 72, y: 44, scale: 1.25 });
    store.getState().dispatch(
      {
        type: "object.transform",
        objectId: "note-1",
        transform: { x: 600, y: 340 },
      },
      "pointer",
    );

    store.getState().dispatch({ type: "history.undo" }, "typed");

    expect(store.getState().canvas.objects["note-1"]).toMatchObject({
      x: 200,
      y: 160,
    });
    expect(store.getState().selectedObjectId).toBe("note-1");
    expect(store.getState().viewport).toEqual({ x: 72, y: 44, scale: 1.25 });
  });
});
