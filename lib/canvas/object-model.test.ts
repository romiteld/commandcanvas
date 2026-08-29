import { describe, expect, it } from "vitest";

import {
  canvasCommandSchema,
  diagramPayloadSchema,
  newCanvasObjectSchema,
} from "@/lib/canvas/object-model";

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

  it("accepts a generic node-and-edge diagram without treating it as architecture", () => {
    const result = diagramPayloadSchema.safeParse({
      kind: "diagram",
      sourceSketchId: "sketch-concept-map",
      interpretationSummary: "Three ideas connected by two relationships.",
      nodes: [
        {
          id: "node-question",
          label: "Question",
          kind: "concept",
          x: 40,
          y: 80,
          width: 160,
          height: 72,
        },
        {
          id: "node-evidence",
          label: "Evidence",
          kind: "process",
          x: 280,
          y: 80,
          width: 160,
          height: 72,
        },
      ],
      edges: [
        {
          id: "edge-supports",
          from: "node-evidence",
          to: "node-question",
          label: "supports",
        },
      ],
    });

    expect(result.success).toBe(true);
  });

  it("accepts a standalone diagram created from spoken intent without inventing a sketch source", () => {
    const result = diagramPayloadSchema.safeParse({
      kind: "flowchart",
      interpretationSummary: "A reviewable approval path created from the spoken request.",
      nodes: [
        {
          id: "node-draft",
          label: "Draft",
          kind: "process",
          x: 40,
          y: 80,
          width: 160,
          height: 72,
        },
        {
          id: "node-approve",
          label: "Approve",
          kind: "decision",
          x: 280,
          y: 80,
          width: 160,
          height: 72,
        },
      ],
      edges: [
        {
          id: "edge-review",
          from: "node-draft",
          to: "node-approve",
          label: "review",
        },
      ],
    });

    expect(result.success).toBe(true);
  });

  it("accepts a bounded semantic data table with typed columns", () => {
    const result = newCanvasObjectSchema.safeParse({
      id: "table-launch-metrics",
      type: "data_table",
      title: "Launch metrics",
      ...geometry,
      payload: {
        columns: [
          { id: "column-metric", label: "Metric", kind: "text" },
          { id: "column-target", label: "Target", kind: "number" },
        ],
        rows: [
          {
            id: "row-signups",
            cells: ["Signups", 250],
          },
          {
            id: "row-conversion",
            cells: ["Conversion", 12.5],
          },
        ],
      },
    });

    expect(result.success).toBe(true);
  });

  it("rejects a table row whose cells do not match the declared columns", () => {
    const result = newCanvasObjectSchema.safeParse({
      id: "table-invalid",
      type: "data_table",
      title: "Invalid table",
      ...geometry,
      payload: {
        columns: [
          { id: "column-name", label: "Name", kind: "text" },
          { id: "column-owner", label: "Owner", kind: "text" },
        ],
        rows: [{ id: "row-one", cells: ["Launch"] }],
      },
    });

    expect(result.success).toBe(false);
  });

  it.each([
    {
      id: "reference-article",
      kind: "article" as const,
      title: "Browser hand interaction research",
      sourceUrl: "https://example.com/research/hand-interaction",
      summary: "A cited research reference brought into the live workspace.",
    },
    {
      id: "reference-image",
      kind: "image" as const,
      title: "Launch concept",
      sourceUrl: "https://example.com/assets/launch-concept.png",
      summary: "An image reference that remains a semantic canvas object.",
    },
    {
      id: "reference-document",
      kind: "document" as const,
      title: "Requirements brief",
      sourceUrl: null,
      summary: "A document summary supplied directly by a participant.",
    },
  ])("accepts a bounded $kind reference card", (reference) => {
    expect(
      newCanvasObjectSchema.safeParse({
        id: reference.id,
        type: "reference_card",
        title: reference.title,
        ...geometry,
        payload: {
          kind: reference.kind,
          sourceUrl: reference.sourceUrl,
          summary: reference.summary,
          excerpt: null,
        },
      }).success,
    ).toBe(true);
  });

  it("refuses active-content and credential-bearing reference URLs", () => {
    for (const sourceUrl of [
      "javascript:alert(1)",
      "https://user:password@example.com/private",
      "data:text/html,<script>alert(1)</script>",
    ]) {
      expect(
        newCanvasObjectSchema.safeParse({
          id: "reference-unsafe",
          type: "reference_card",
          title: "Unsafe reference",
          ...geometry,
          payload: {
            kind: "link",
            sourceUrl,
            summary: "This URL must not enter canonical canvas state.",
            excerpt: null,
          },
        }).success,
      ).toBe(false);
    }
  });

  it.each([
    "decision",
    "action_item",
    "summary",
    "risk",
    "open_question",
  ] as const)("accepts a bounded %s meeting card", (kind) => {
    expect(
      newCanvasObjectSchema.safeParse({
        id: `meeting-${kind.replace("_", "-")}`,
        type: "meeting_card",
        title: kind.replace("_", " "),
        ...geometry,
        payload: {
          kind,
          body: "A structured outcome created from the live meeting.",
          bullets: ["Visible", "Attributed", "Reviewable"],
          owner: kind === "action_item" ? "Danny" : null,
          dueDate: kind === "action_item" ? "2026-09-03" : null,
          status: kind === "action_item" ? "open" : "confirmed",
        },
      }).success,
    ).toBe(true);
  });

  it.each([
    {
      kind: "pie_chart" as const,
      title: "Quarterly revenue mix",
      xAxisLabel: null,
      yAxisLabel: null,
      series: [
        {
          id: "series-revenue",
          label: "Revenue",
          points: [
            { label: "Services", value: 60 },
            { label: "Products", value: 30 },
            { label: "Other", value: 10 },
          ],
        },
      ],
    },
    {
      kind: "bar_chart" as const,
      title: "Tickets by team",
      xAxisLabel: "Team",
      yAxisLabel: "Tickets",
      series: [
        {
          id: "series-tickets",
          label: "Tickets",
          points: [
            { label: "Design", value: 8 },
            { label: "Engineering", value: 15 },
          ],
        },
      ],
    },
    {
      kind: "line_chart" as const,
      title: "Weekly signups",
      xAxisLabel: "Week",
      yAxisLabel: "Signups",
      series: [
        {
          id: "series-signups",
          label: "Signups",
          points: [
            { label: "W1", value: 12 },
            { label: "W2", value: 18 },
            { label: "W3", value: 27 },
          ],
        },
      ],
    },
  ])("accepts a validated $kind semantic chart payload", (chart) => {
    const result = diagramPayloadSchema.safeParse({
      kind: chart.kind,
      sourceSketchId: "sketch-chart",
      interpretationSummary: "Values transcribed from the preserved drawing.",
      chart: {
        title: chart.title,
        xAxisLabel: chart.xAxisLabel,
        yAxisLabel: chart.yAxisLabel,
        series: chart.series,
      },
    });

    expect(result.success).toBe(true);
  });

  it("rejects Cartesian chart series with different ordered category labels", () => {
    const result = diagramPayloadSchema.safeParse({
      kind: "line_chart",
      sourceSketchId: "sketch-chart",
      interpretationSummary:
        "Two incompatible category axes must not be rendered as one timeline.",
      chart: {
        title: "Incompatible categories",
        xAxisLabel: "Period",
        yAxisLabel: "Value",
        series: [
          {
            id: "series-a",
            label: "A",
            points: [
              { label: "Jan", value: 2 },
              { label: "Feb", value: 4 },
            ],
          },
          {
            id: "series-b",
            label: "B",
            points: [
              { label: "Q1", value: 5 },
              { label: "Q2", value: 6 },
              { label: "Q3", value: 7 },
            ],
          },
        ],
      },
    });

    expect(result.success).toBe(false);
  });

  it("rejects a pie chart with negative slices or multiple series", () => {
    const result = diagramPayloadSchema.safeParse({
      kind: "pie_chart",
      sourceSketchId: "sketch-chart",
      interpretationSummary: "Invalid pie values.",
      chart: {
        title: "Invalid",
        xAxisLabel: null,
        yAxisLabel: null,
        series: [
          {
            id: "series-a",
            label: "A",
            points: [{ label: "Loss", value: -1 }],
          },
          {
            id: "series-b",
            label: "B",
            points: [{ label: "Gain", value: 2 }],
          },
        ],
      },
    });

    expect(result.success).toBe(false);
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

describe("canvasCommandSchema note transcription", () => {
  it("accepts one bounded version-checked note append command", () => {
    expect(
      canvasCommandSchema.safeParse({
        type: "object.append_note_text",
        objectId: "note-thought",
        expectedVersion: 3,
        text: "The launch risk is supplier lead time.",
      }),
    ).toMatchObject({ success: true });
  });

  it.each([
    {
      type: "object.append_note_text",
      objectId: "note-thought",
      text: "Missing version",
    },
    {
      type: "object.append_note_text",
      objectId: "note-thought",
      expectedVersion: 1,
      text: "   ",
    },
    {
      type: "object.append_note_text",
      objectId: "note-thought",
      expectedVersion: 1,
      text: "x".repeat(1_001),
    },
    {
      type: "object.append_note_text",
      objectId: "note-thought",
      expectedVersion: 1,
      text: "Valid text",
      untrustedExtra: true,
    },
  ])("rejects malformed or oversized note append input", (input) => {
    expect(canvasCommandSchema.safeParse(input).success).toBe(false);
  });
});
