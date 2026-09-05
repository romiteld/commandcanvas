import { describe, expect, it } from "vitest";

import { createCanvasStore } from "@/lib/canvas/canvas-store";
import { createLocalPreviewState, LOCAL_PREVIEW_DIAGRAM_ID, LOCAL_PREVIEW_ROOM_ID, LOCAL_PREVIEW_SKETCH_ID } from "@/lib/canvas/local-preview";

describe("local preview baseline", () => {
  it("starts with linked sample objects and no fabricated visitor receipts", () => {
    const state = createLocalPreviewState();
    const source = state.objects[LOCAL_PREVIEW_SKETCH_ID];
    const diagram = state.objects[LOCAL_PREVIEW_DIAGRAM_ID];
    expect(Object.keys(state.objects)).toHaveLength(3);
    expect(source.type).toBe("sketch");
    expect(diagram.type === "diagram" && diagram.payload.sourceSketchId).toBe(source.id);
    expect(diagram.type === "diagram" && diagram.payload.interpretationSummary).toContain("No AI request has run");
    expect(state.receipts).toEqual([]);
    expect(state.revision).toBe(0);
    expect(createLocalPreviewState().objects[source.id]).not.toBe(source);
  });

  it("moves a sample through the real command engine and undoes it without changing its source", () => {
    let counter = 0;
    const store = createCanvasStore(LOCAL_PREVIEW_ROOM_ID, {
      actor: { id: "participant-local-host", displayName: "You", type: "human" },
      createId: prefix => `${prefix}-${++counter}`,
      now: () => "2026-09-05T01:00:00.000Z",
    });
    const baseline = createLocalPreviewState();
    store.getState().hydrateCanvas(baseline);
    const source = baseline.objects[LOCAL_PREVIEW_SKETCH_ID];
    const diagram = baseline.objects[LOCAL_PREVIEW_DIAGRAM_ID];
    const moved = store.getState().dispatch({ type: "object.transform", objectId: diagram.id, expectedVersion: diagram.version, transform: { x: diagram.x + 120 } }, "pointer");
    expect(moved.ok).toBe(true);
    expect(store.getState().canvas.receipts.at(-1)).toMatchObject({ actor: { displayName: "You", type: "human" }, source: "pointer", revision: 1 });
    expect(store.getState().canvas.objects[source.id]).toEqual(source);
    expect(store.getState().dispatch({ type: "history.undo" }, "typed").ok).toBe(true);
    expect(store.getState().canvas.objects[diagram.id].x).toBe(diagram.x);
    expect(store.getState().canvas.objects[source.id]).toEqual(source);
    expect(store.getState().canvas.receipts.at(-1)).toMatchObject({ actor: { displayName: "You" }, action: "undo", source: "typed", revision: 2 });
  });
});
