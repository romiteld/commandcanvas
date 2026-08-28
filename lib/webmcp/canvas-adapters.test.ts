import { describe, expect, it, vi } from "vitest";

import { createCanvasStore } from "@/lib/canvas/canvas-store";
import type {
  ActivityReceipt,
  CanvasState,
} from "@/lib/canvas/command-engine";
import type { CanvasObject, NewCanvasObject } from "@/lib/canvas/object-model";
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

function seedSelectedSketch(store: ReturnType<typeof createCanvasStore>) {
  store.getState().dispatch(
    {
      type: "object.create",
      object: {
        id: "sketch-source",
        type: "sketch",
        title: "Rough architecture",
        x: 20,
        y: 30,
        width: 360,
        height: 220,
        zIndex: 1,
        payload: {
          strokes: [
            {
              id: "stroke-source",
              color: "#12233d",
              width: 5,
              points: [
                { x: 12, y: 20 },
                { x: 100, y: 30 },
              ],
            },
          ],
        },
      },
    },
    "system",
  );
  store.getState().selectObject("sketch-source");
}

function persistObject(object: NewCanvasObject): CanvasObject {
  return {
    ...object,
    roomId: "room-demo",
    minimized: false,
    pinned: false,
    createdBy: "participant-host",
    createdAt: "2026-08-27T16:00:00.000Z",
    updatedAt: "2026-08-27T16:00:00.000Z",
    deletedAt: null,
    version: 1,
    metadata: {},
  };
}

function hydrate(
  store: ReturnType<typeof createCanvasStore>,
  objects: CanvasObject[],
  receipts: ActivityReceipt[] = [],
) {
  const canvas: CanvasState = {
    roomId: "room-demo",
    revision: receipts.length,
    objects: Object.fromEntries(objects.map((object) => [object.id, object])),
    receipts,
    undoneReceiptIds: [],
  };
  expect(store.getState().hydrateCanvas(canvas)).toBe(true);
}

function receiptFixture(
  index: number,
  objectId: string,
  after: CanvasObject | null = null,
): ActivityReceipt {
  return {
    id: `receipt-${index}`,
    roomId: "room-demo",
    commandId: `command-${index}`,
    revision: index + 1,
    occurredAt: "2026-08-27T16:00:00.000Z",
    actor: {
      id: "participant-host",
      displayName: "Danny",
      type: "human",
    },
    source: "pointer",
    action: index === 0 ? "create" : "transform",
    affectedObjectIds: [objectId],
    before: { objects: { [objectId]: null } },
    after: { objects: { [objectId]: after } },
    description: `Danny changed object at revision ${index + 1}.`,
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
        truncation: {
          resultByteBudget: 32_768,
          objects: {
            total: 0,
            returned: 0,
            omitted: 0,
            limit: 50,
            reasons: [],
          },
          receipts: {
            requested: true,
            total: 0,
            returned: 0,
            omitted: 0,
            limit: 20,
            reasons: [],
          },
        },
      },
    });
    expect(store.getState().canvas.revision).toBe(0);
  });

  it("projects every object type into a bounded semantic summary", async () => {
    const { store, adapters } = fixture();
    const note = persistObject({
      id: "note-max",
      type: "note",
      title: "Long decision",
      x: 10,
      y: 20,
      width: 280,
      height: 190,
      zIndex: 1,
      payload: { text: "n".repeat(4_000), tone: "sky" },
    });
    const taskBoard = persistObject({
      id: "board-max",
      type: "task_board",
      title: "Delivery board",
      x: 320,
      y: 20,
      width: 900,
      height: 620,
      zIndex: 2,
      payload: {
        columns: Array.from({ length: 5 }, (_, columnIndex) => ({
          id: `column-${columnIndex}`,
          title: `Column ${columnIndex}`,
          tasks: Array.from({ length: 24 }, (_, taskIndex) => ({
            id: `task-${columnIndex}-${taskIndex}`,
            title: `Task ${columnIndex}-${taskIndex}`,
            owner: "Owner",
            dueDate: "2026-09-01",
            priority: "high" as const,
          })),
        })),
      },
    });
    const schedule = persistObject({
      id: "schedule-max",
      type: "schedule",
      title: "Launch schedule",
      x: 20,
      y: 700,
      width: 900,
      height: 620,
      zIndex: 3,
      payload: {
        timezone: "America/New_York",
        days: Array.from({ length: 14 }, (_, dayIndex) => ({
          date: `2026-09-${String(dayIndex + 1).padStart(2, "0")}`,
          label: `Day ${dayIndex + 1}`,
          entries: Array.from({ length: 16 }, (_, entryIndex) => ({
            id: `entry-${dayIndex}-${entryIndex}`,
            time: `${String(entryIndex).padStart(2, "0")}:00`,
            title: `Schedule entry ${dayIndex}-${entryIndex}`,
            owner: "Owner",
          })),
        })),
      },
    });
    const sketch = persistObject({
      id: "sketch-max",
      type: "sketch",
      title: "Maximum sketch",
      x: 950,
      y: 700,
      width: 1_000,
      height: 700,
      zIndex: 4,
      payload: {
        strokes: Array.from({ length: 128 }, (_, strokeIndex) => ({
          id: `stroke-${strokeIndex}`,
          color: strokeIndex % 2 === 0 ? "#12233d" : "#ff5e62",
          width: 5,
          points: Array.from({ length: 2_000 }, (_, pointIndex) => ({
            x: pointIndex,
            y: strokeIndex,
          })),
        })),
      },
    });
    const diagram = persistObject({
      id: "diagram-max",
      type: "diagram",
      title: "Architecture",
      x: 2_000,
      y: 20,
      width: 1_200,
      height: 800,
      zIndex: 5,
      payload: {
        kind: "architecture",
        sourceSketchId: sketch.id,
        interpretationSummary: "A structured architecture diagram.",
        nodes: Array.from({ length: 30 }, (_, nodeIndex) => ({
          id: `node-${nodeIndex}`,
          label: `Node ${nodeIndex}`,
          kind: "service" as const,
          x: nodeIndex * 100,
          y: nodeIndex * 50,
          width: 180,
          height: 80,
        })),
        edges: Array.from({ length: 60 }, (_, edgeIndex) => ({
          id: `edge-${edgeIndex}`,
          from: `node-${edgeIndex % 30}`,
          to: `node-${(edgeIndex + 1) % 30}`,
          label: `Edge ${edgeIndex}`,
        })),
      },
    });
    const chart = persistObject({
      id: "chart-budget",
      type: "diagram",
      title: "Budget chart",
      x: 2_000,
      y: 900,
      width: 900,
      height: 520,
      zIndex: 6,
      payload: {
        kind: "pie_chart",
        sourceSketchId: sketch.id,
        interpretationSummary: "A budget split.",
        chart: {
          title: "Budget split",
          xAxisLabel: null,
          yAxisLabel: null,
          series: [
            {
              id: "series-budget",
              label: "Budget",
              points: [
                { label: "Product", value: 55 },
                { label: "Sales", value: 30 },
                { label: "Operations", value: 15 },
              ],
            },
          ],
        },
      },
    });
    const frame = {
      ...persistObject({
        id: "frame-planning",
        type: "frame",
        title: "Planning frame",
        x: 40,
        y: 40,
        width: 1_200,
        height: 900,
        zIndex: 0,
        rotation: 15,
        payload: { tone: "violet" },
      }),
      parentId: null,
    };
    hydrate(store, [note, taskBoard, schedule, sketch, diagram, chart, frame]);

    const result = await adapters.executeTool({
      toolName: "get_canvas_state",
      input: {},
      signal: new AbortController().signal,
      context,
    });
    const data = JSON.parse(JSON.stringify(result)).data;
    const summaries = Object.fromEntries(
      data.objects.map((object: { id: string }) => [object.id, object]),
    );

    expect(summaries["note-max"].payload).toMatchObject({
      originalCharacterCount: 4_000,
      returnedCharacterCount: 800,
      omittedCharacterCount: 3_200,
    });
    expect(summaries["board-max"].payload).toMatchObject({
      columnCount: 5,
      taskCount: 120,
      returnedTaskCount: 15,
      omittedTaskCount: 105,
    });
    expect(summaries["schedule-max"].payload).toMatchObject({
      dayCount: 14,
      returnedDayCount: 7,
      omittedDayCount: 7,
      entryCount: 224,
      returnedEntryCount: 14,
      omittedEntryCount: 210,
    });
    expect(summaries["sketch-max"].payload).toEqual({
      strokeCount: 128,
      pointCount: 256_000,
      colors: ["#12233d", "#ff5e62"],
      coordinateDetail: "omitted",
    });
    expect(summaries["diagram-max"].payload).toMatchObject({
      nodeCount: 30,
      returnedNodeCount: 12,
      omittedNodeCount: 18,
      edgeCount: 60,
      returnedEdgeCount: 16,
      omittedEdgeCount: 44,
    });
    expect(summaries["chart-budget"].payload).toEqual({
      kind: "pie_chart",
      sourceSketchId: "sketch-max",
      interpretationSummary: "A budget split.",
      chart: {
        title: "Budget split",
        xAxisLabel: null,
        yAxisLabel: null,
        seriesCount: 1,
        returnedSeriesCount: 1,
        omittedSeriesCount: 0,
        pointCount: 3,
        returnedPointCount: 3,
        omittedPointCount: 0,
        series: [
          {
            id: "series-budget",
            label: "Budget",
            pointCount: 3,
            points: [
              { label: "Product", value: 55 },
              { label: "Sales", value: 30 },
              { label: "Operations", value: 15 },
            ],
          },
        ],
      },
    });
    expect(summaries["frame-planning"]).toMatchObject({
      spatial: { rotation: 15 },
      state: { parentId: null },
      payload: { tone: "violet", container: true },
    });
  });

  it("keeps a maximum legal sketch and 20 receipts within a 32 KiB result without coordinate or snapshot leakage", async () => {
    const { store, adapters } = fixture();
    const sharedPoints = Array.from({ length: 2_000 }, (_, pointIndex) => ({
      x: pointIndex,
      y: pointIndex % 600,
      pressure: 0.5,
    }));
    const sketch = persistObject({
      id: "sketch-max",
      type: "sketch",
      title: "Maximum legal sketch",
      x: 100,
      y: 120,
      width: 1_200,
      height: 800,
      zIndex: 1,
      payload: {
        strokes: Array.from({ length: 128 }, (_, strokeIndex) => ({
          id: `stroke-${strokeIndex}`,
          color: "#12233d",
          width: 5,
          points: sharedPoints,
        })),
      },
    });
    const receipts = Array.from({ length: 20 }, (_, receiptIndex) =>
      receiptFixture(receiptIndex, sketch.id, receiptIndex === 0 ? sketch : null),
    );
    receipts[0] = { ...receipts[0], description: "d".repeat(300) };
    hydrate(store, [sketch], receipts);
    store.getState().selectObject(sketch.id);

    const result = await adapters.executeTool({
      toolName: "get_canvas_state",
      input: { includeReceipts: true },
      signal: new AbortController().signal,
      context,
    });
    const serialized = JSON.stringify(result);
    const parsed = JSON.parse(serialized);

    expect(new TextEncoder().encode(serialized).byteLength).toBeLessThanOrEqual(
      32_768,
    );
    expect(serialized).not.toContain('"points"');
    expect(serialized).not.toContain('"before"');
    expect(serialized).not.toContain('"after"');
    expect(parsed.data.objects[0].payload).toEqual({
      strokeCount: 128,
      pointCount: 256_000,
      colors: ["#12233d"],
      coordinateDetail: "omitted",
    });
    expect(parsed.data.receipts).toHaveLength(20);
    expect(parsed.data.receipts[0]).toMatchObject({
      id: "receipt-0",
      revision: 1,
      actor: { displayName: "Danny", type: "human" },
      affectedObjectIds: ["sketch-max"],
      affectedObjectCount: 1,
      description: "d".repeat(240),
      originalDescriptionCharacterCount: 300,
      omittedDescriptionCharacterCount: 60,
    });
  });

  it("reports when the live room contains more objects than the compact projection can return", async () => {
    const { store, adapters } = fixture();
    const notes = Array.from({ length: 51 }, (_, noteIndex) =>
      persistObject({
        id: `note-${noteIndex}`,
        type: "note",
        title: `Note ${noteIndex}`,
        x: noteIndex * 10,
        y: noteIndex * 10,
        width: 280,
        height: 190,
        zIndex: noteIndex,
        payload: { text: "Short context.", tone: "sand" },
      }),
    );
    hydrate(store, notes);

    const result = await adapters.executeTool({
      toolName: "get_canvas_state",
      input: {},
      signal: new AbortController().signal,
      context,
    });

    expect(result).toMatchObject({
      ok: true,
      data: {
        truncation: {
          objects: {
            total: 51,
            returned: 50,
            omitted: 1,
            limit: 50,
            reasons: ["object_limit"],
          },
        },
      },
    });
  });

  it("keeps the active selection in a limited all-canvas projection", async () => {
    const { store, adapters } = fixture();
    const notes = Array.from({ length: 51 }, (_, noteIndex) =>
      persistObject({
        id: `note-${noteIndex}`,
        type: "note",
        title: `Note ${noteIndex}`,
        x: noteIndex * 10,
        y: noteIndex * 10,
        width: 280,
        height: 190,
        zIndex: noteIndex,
        payload: { text: "Short context.", tone: "sand" },
      }),
    );
    hydrate(store, notes);
    store.getState().selectObject("note-50");

    const result = await adapters.executeTool({
      toolName: "get_canvas_state",
      input: { scope: "all" },
      signal: new AbortController().signal,
      context,
    });
    const parsed = JSON.parse(JSON.stringify(result));

    expect(parsed.data.objects[0].id).toBe("note-50");
    expect(parsed.data.objects).toHaveLength(50);
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

  it("rotates through the canonical mutation and receipt pipeline", async () => {
    const { store, adapters } = fixture();
    store.getState().dispatch(
      {
        type: "object.create",
        object: {
          id: "note-rotate",
          type: "note",
          title: "Rotate me",
          x: 100,
          y: 100,
          width: 280,
          height: 190,
          zIndex: 1,
          payload: { text: "Spatial note", tone: "sky" },
        },
      },
      "pointer",
    );

    const result = await adapters.executeTool({
      toolName: "transform_object",
      input: { objectId: "note-rotate", transform: { rotation: -45 } },
      signal: new AbortController().signal,
      context: {
        ...context,
        phase: { ...context.phase, hasContent: true },
      },
    });

    expect(result).toMatchObject({
      ok: true,
      status: "completed",
      message: "ChatGPT transformed “Rotate me” spatially.",
    });
    expect(store.getState().canvas.objects["note-rotate"]).toMatchObject({
      rotation: -45,
      version: 2,
    });
    expect(store.getState().canvas.receipts.at(-1)).toMatchObject({
      source: "webmcp",
      action: "transform",
      affectedObjectIds: ["note-rotate"],
    });
  });

  it("groups and ungroups explicit objects through canonical frame mutations", async () => {
    const { store, adapters } = fixture();
    for (const [id, x] of [
      ["note-one", 100],
      ["note-two", 420],
    ] as const)
      store.getState().dispatch(
        {
          type: "object.create",
          object: {
            id,
            type: "note",
            title: id === "note-one" ? "First note" : "Second note",
            x,
            y: 120,
            width: 280,
            height: 190,
            zIndex: 2,
            payload: { text: "Group this", tone: "sand" },
          },
        },
        "pointer",
      );

    const grouped = await adapters.executeTool({
      toolName: "organize_objects",
      input: {
        action: "group",
        objectIds: ["note-one", "note-two"],
        frame: {
          id: "frame-notes",
          title: "Launch notes",
          x: 60,
          y: 80,
          width: 700,
          height: 300,
          zIndex: 1,
          tone: "violet",
        },
      },
      signal: new AbortController().signal,
      context: {
        ...context,
        phase: { ...context.phase, hasContent: true },
      },
    });

    expect(grouped).toMatchObject({
      ok: true,
      status: "completed",
      message: "ChatGPT grouped 2 objects in “Launch notes”.",
    });
    expect(store.getState().canvas.objects["frame-notes"]).toMatchObject({
      type: "frame",
      title: "Launch notes",
      rotation: 0,
      payload: { tone: "violet" },
    });
    expect(store.getState().canvas.objects["note-one"].parentId).toBe(
      "frame-notes",
    );
    expect(store.getState().canvas.objects["note-two"].parentId).toBe(
      "frame-notes",
    );

    const ungrouped = await adapters.executeTool({
      toolName: "organize_objects",
      input: { action: "ungroup", frameId: "frame-notes" },
      signal: new AbortController().signal,
      context: {
        ...context,
        phase: { ...context.phase, hasContent: true },
      },
    });

    expect(ungrouped).toMatchObject({
      ok: true,
      status: "completed",
      message: "ChatGPT ungrouped “Launch notes”.",
    });
    expect(store.getState().canvas.objects["frame-notes"].deletedAt).not.toBeNull();
    expect(store.getState().canvas.objects["note-one"].parentId).toBeNull();
    expect(store.getState().canvas.receipts.slice(-2).map(({ action }) => action)).toEqual([
      "group",
      "ungroup",
    ]);
  });

  it("undoes and redoes the latest mutation through the shared history", async () => {
    const { store, adapters } = fixture();
    store.getState().dispatch(
      {
        type: "object.create",
        object: {
          id: "note-history",
          type: "note",
          title: "History note",
          x: 100,
          y: 100,
          width: 280,
          height: 190,
          zIndex: 1,
          payload: { text: "Undo this", tone: "coral" },
        },
      },
      "pointer",
    );

    const undone = await adapters.executeTool({
      toolName: "history_action",
      input: { action: "undo" },
      signal: new AbortController().signal,
      context,
    });
    expect(undone).toMatchObject({
      ok: true,
      status: "completed",
      message: "ChatGPT undid: Danny created “History note”.",
    });
    expect(store.getState().canvas.objects["note-history"]).toBeUndefined();

    const redone = await adapters.executeTool({
      toolName: "history_action",
      input: { action: "redo" },
      signal: new AbortController().signal,
      context,
    });
    expect(redone).toMatchObject({
      ok: true,
      status: "completed",
      message: "ChatGPT redid: Danny created “History note”.",
    });
    expect(store.getState().canvas.objects["note-history"]).toMatchObject({
      title: "History note",
    });
    expect(store.getState().canvas.receipts.slice(-2).map(({ action }) => action)).toEqual([
      "undo",
      "redo",
    ]);
  });

  it("returns a truthful availability failure when shared history is empty", async () => {
    const { adapters } = fixture();

    const result = await adapters.executeTool({
      toolName: "history_action",
      input: { action: "undo" },
      signal: new AbortController().signal,
      context,
    });

    expect(result).toEqual({
      ok: false,
      code: "not_available",
      message: "There is nothing left to undo.",
    });
  });

  it("delegates stable mutations to an injected durable room dispatcher", async () => {
    const { store } = fixture();
    const signal = new AbortController().signal;
    const dispatchMutation = vi.fn().mockResolvedValue({
      ok: true,
      status: "completed",
      message: "CommandCanvas agent created “Durable proposal”.",
      receiptId: "ccf31a6b-48cb-4edc-90a4-889d45ec74aa",
      data: { revision: 7, affectedObjectIds: ["note-durable"] },
    });
    const adapters = createCanvasWebMcpAdapters({ store, dispatchMutation });

    const result = await adapters.executeTool({
      toolName: "create_object",
      input: {
        object: {
          id: "note-durable",
          type: "note",
          title: "Durable proposal",
          x: 420,
          y: 220,
          width: 280,
          height: 190,
          zIndex: 7,
          payload: { text: "Persist this through the room API.", tone: "sky" },
        },
      },
      signal,
      context,
    });

    expect(dispatchMutation).toHaveBeenCalledWith(
      {
        type: "object.create",
        object: expect.objectContaining({ id: "note-durable" }),
      },
      signal,
    );
    expect(result).toMatchObject({
      ok: true,
      status: "completed",
      receiptId: "ccf31a6b-48cb-4edc-90a4-889d45ec74aa",
    });
    expect(store.getState().canvas.revision).toBe(0);
  });

  it("refuses sketch transformation unless the exact active sketch is selected", async () => {
    const { store } = fixture();
    seedSelectedSketch(store);
    const transformSketch = vi.fn();
    const adapters = createCanvasWebMcpAdapters({ store, transformSketch });

    const result = await adapters.executeTool({
      toolName: "transform_sketch",
      input: {
        sketchId: "sketch-other",
        instruction: "Clean this up.",
      },
      signal: new AbortController().signal,
      context: {
        ...context,
        phase: { ...context.phase, hasContent: true, selection: "sketch" },
      },
    });

    expect(result).toEqual({
      ok: false,
      code: "invalid_input",
      message: "Transform request must target the currently selected sketch.",
    });
    expect(transformSketch).not.toHaveBeenCalled();
  });

  it("passes the exact WebMCP signal to the shared transformer and maps its verified receipt", async () => {
    const { store } = fixture();
    seedSelectedSketch(store);
    const signal = new AbortController().signal;
    const transformSketch = vi.fn().mockResolvedValue({
      ok: true,
      diagramObjectId: "diagram-result",
      receiptId: "receipt-transform",
      revision: 7,
      provider: "openai",
      model: "gpt-5.6-sol",
    });
    const adapters = createCanvasWebMcpAdapters({ store, transformSketch });

    const result = await adapters.executeTool({
      toolName: "transform_sketch",
      input: {
        sketchId: "sketch-source",
        instruction: "Separate the browser and API responsibilities.",
      },
      signal,
      context: {
        ...context,
        phase: { ...context.phase, hasContent: true, selection: "sketch" },
      },
    });

    expect(transformSketch).toHaveBeenCalledExactlyOnceWith({
      sketchObjectId: "sketch-source",
      instruction: "Separate the browser and API responsibilities.",
      outputKind: "auto",
      source: "webmcp",
      signal,
    });
    expect(result).toEqual({
      ok: true,
      status: "completed",
      message: "Sketch interpreted as a structured visual.",
      receiptId: "receipt-transform",
      data: {
        revision: 7,
        diagramObjectId: "diagram-result",
        provider: "openai",
        model: "gpt-5.6-sol",
      },
    });
  });

  it("maps shared transformer failures without returning a fake completion", async () => {
    const { store } = fixture();
    seedSelectedSketch(store);
    const adapters = createCanvasWebMcpAdapters({
      store,
      transformSketch: vi.fn().mockResolvedValue({
        ok: false,
        code: "provider_unavailable",
        message: "Sketch interpretation is temporarily unavailable.",
      }),
    });

    const result = await adapters.executeTool({
      toolName: "transform_sketch",
      input: {
        sketchId: "sketch-source",
        instruction: "Clean this up.",
        outputKind: "flowchart",
      },
      signal: new AbortController().signal,
      context: {
        ...context,
        phase: { ...context.phase, hasContent: true, selection: "sketch" },
      },
    });

    expect(result).toEqual({
      ok: false,
      code: "execution_failed",
      message: "Sketch interpretation is temporarily unavailable.",
    });
  });
});
