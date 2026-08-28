import { describe, expect, it } from "vitest";

import { newCanvasObjectSchema } from "@/lib/canvas/object-model";

const geometry = {
  x: 120,
  y: 80,
  width: 560,
  height: 340,
  zIndex: 2,
};

describe("newCanvasObjectSchema", () => {
  it("accepts the task-board payload used by the project-planning demo", () => {
    const input = {
      id: "board-launch",
      type: "task_board",
      title: "Launch board",
      ...geometry,
      payload: {
        columns: [
          {
            id: "column-now",
            title: "Now",
            tasks: [
              {
                id: "task-demo",
                title: "Record the two-browser demo",
                owner: "Danny",
                priority: "high",
              },
            ],
          },
          { id: "column-next", title: "Next", tasks: [] },
          { id: "column-done", title: "Done", tasks: [] },
        ],
      },
    };

    const result = newCanvasObjectSchema.safeParse(input);

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("expected task board to parse");
    expect(result.data).toEqual(input);
  });

  it("accepts a schedule with explicit dates instead of inventing calendar state", () => {
    const result = newCanvasObjectSchema.safeParse({
      id: "schedule-next-week",
      type: "schedule",
      title: "Next week",
      ...geometry,
      payload: {
        timezone: "America/New_York",
        days: [
          {
            date: "2026-08-31",
            label: "Monday",
            entries: [
              {
                id: "schedule-entry-demo",
                time: "10:00",
                title: "Demo rehearsal",
                owner: "Danny",
              },
            ],
          },
        ],
      },
    });

    expect(result.success).toBe(true);
  });

  it("accepts preserved sketch strokes and a diagram that references their source", () => {
    const sketch = newCanvasObjectSchema.safeParse({
      id: "sketch-rough-system",
      type: "sketch",
      title: "Rough system",
      ...geometry,
      payload: {
        strokes: [
          {
            id: "stroke-1",
            color: "#12233d",
            width: 4,
            points: [
              { x: 12, y: 18, pressure: 0.5 },
              { x: 48, y: 36, pressure: 0.7 },
            ],
          },
        ],
      },
    });
    const diagram = newCanvasObjectSchema.safeParse({
      id: "diagram-clean-system",
      type: "diagram",
      title: "Clean system",
      ...geometry,
      payload: {
        kind: "architecture",
        sourceSketchId: "sketch-rough-system",
        interpretationSummary: "Browser commands flow through one mutation service.",
        nodes: [
          {
            id: "node-browser",
            label: "Browser",
            kind: "client",
            x: 30,
            y: 30,
            width: 150,
            height: 70,
          },
          {
            id: "node-database",
            label: "Supabase",
            kind: "database",
            x: 280,
            y: 30,
            width: 150,
            height: 70,
          },
        ],
        edges: [
          {
            id: "edge-browser-database",
            from: "node-browser",
            to: "node-database",
            label: "validated command",
          },
        ],
      },
    });

    expect(sketch.success).toBe(true);
    expect(diagram.success).toBe(true);
    if (!diagram.success) throw new Error("expected diagram to parse");
    expect(diagram.data.payload).toMatchObject({
      sourceSketchId: "sketch-rough-system",
    });
  });

  it("rejects unsafe geometry and unknown fields at the external boundary", () => {
    const result = newCanvasObjectSchema.safeParse({
      id: "note-invalid",
      type: "note",
      title: "Invalid",
      ...geometry,
      width: -40,
      payload: {
        text: "This must not enter state.",
        tone: "coral",
        unexpected: "agent supplied",
      },
    });

    expect(result.success).toBe(false);
  });

  it("accepts a bounded rotatable frame and rejects unsafe rotation", () => {
    const frame = {
      id: "frame-planning",
      type: "frame",
      title: "Planning cluster",
      ...geometry,
      rotation: 15,
      payload: { tone: "sky" },
    };

    expect(newCanvasObjectSchema.safeParse(frame).success).toBe(true);
    expect(
      newCanvasObjectSchema.safeParse({ ...frame, rotation: 181 }).success,
    ).toBe(false);
  });
});
