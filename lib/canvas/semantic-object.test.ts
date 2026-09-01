import { describe, expect, it } from "vitest";

import {
  buildSemanticCanvasObject,
  semanticCanvasObjectInputSchema,
  type SemanticCanvasObjectInput,
} from "@/lib/canvas/semantic-object";

const context = {
  viewport: { x: 0, y: 0, scale: 1 },
  objects: {},
  selectedObjectId: null,
};

const examples: SemanticCanvasObjectInput[] = [
  { type: "note", title: "Thought", text: "Explore the launch plan." },
  {
    type: "task_board",
    title: "Launch board",
    columns: [{ title: "Todo", tasks: [{ title: "Confirm launch" }] }],
  },
  {
    type: "schedule",
    title: "Launch week",
    timezone: "America/New_York",
    days: [
      {
        date: "2026-09-03",
        label: "Thursday",
        entries: [{ time: "13:00", title: "Submit" }],
      },
    ],
  },
  {
    type: "diagram",
    title: "Request flow",
    kind: "flowchart",
    nodes: [
      { key: "client", label: "Client", kind: "client" },
      { key: "api", label: "API", kind: "service" },
    ],
    edges: [{ from: "client", to: "api" }],
  },
  {
    type: "chart",
    title: "Effort split",
    kind: "pie_chart",
    series: [
      {
        label: "Effort",
        points: [
          { label: "Build", value: 70 },
          { label: "Test", value: 30 },
        ],
      },
    ],
  },
  {
    type: "data_table",
    title: "Risks",
    columns: [{ label: "Risk", kind: "text" }],
    rows: [["Browser rollout"]],
  },
  {
    type: "reference_card",
    title: "WebMCP guide",
    kind: "article",
    sourceUrl: "https://example.com/guide",
    summary: "Reference material already supplied by the user.",
  },
  {
    type: "meeting_card",
    title: "Ship decision",
    kind: "decision",
    body: "Submit the canvas-first release.",
    bullets: [],
  },
];

describe("semantic canvas object builder", () => {
  it.each(examples.map((example) => [example.type, example] as const))(
    "builds a canonical %s object without caller-supplied persistence fields",
    (_type, input) => {
      const object = buildSemanticCanvasObject(input, context);

      expect(object.id).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(object.width).toBeGreaterThanOrEqual(160);
      expect(object.height).toBeGreaterThanOrEqual(80);
      expect(object.zIndex).toBe(1);
    },
  );

  it("rejects diagram edges that do not reference supplied semantic node keys", () => {
    expect(
      semanticCanvasObjectInputSchema.safeParse({
        type: "diagram",
        title: "Broken graph",
        kind: "diagram",
        nodes: [{ key: "known", label: "Known", kind: "concept" }],
        edges: [{ from: "known", to: "missing" }],
      }).success,
    ).toBe(false);
  });

  it("rejects compact chart content that the canonical diagram model cannot persist", () => {
    expect(
      semanticCanvasObjectInputSchema.safeParse({
        type: "chart",
        title: "Invalid pie",
        kind: "pie_chart",
        series: [
          { label: "First", points: [{ label: "A", value: 1 }] },
          { label: "Second", points: [{ label: "B", value: 2 }] },
        ],
      }).success,
    ).toBe(false);
    expect(
      semanticCanvasObjectInputSchema.safeParse({
        type: "chart",
        title: "Invalid line",
        kind: "line_chart",
        series: [{ label: "Only", points: [{ label: "A", value: 1 }] }],
      }).success,
    ).toBe(false);
  });

  it("rejects reference URLs containing embedded credentials", () => {
    expect(
      semanticCanvasObjectInputSchema.safeParse({
        type: "reference_card",
        title: "Unsafe reference",
        kind: "link",
        sourceUrl: "https://user:password@example.com/private",
        summary: "Do not preserve embedded URL credentials.",
      }).success,
    ).toBe(false);
  });

  it("places an object beside the selected object only when explicitly requested", () => {
    const selected = {
      ...buildSemanticCanvasObject(
        { type: "note", title: "Source" },
        context,
      ),
      roomId: "room-demo",
      minimized: false,
      pinned: false,
      createdBy: "participant-host",
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
      deletedAt: null,
      version: 1,
      metadata: {},
    };
    const object = buildSemanticCanvasObject(
      {
        type: "note",
        title: "Result",
        placement: "right_of_selection",
      },
      {
        ...context,
        objects: { [selected.id]: selected },
        selectedObjectId: selected.id,
      },
    );

    expect(object.x).toBe(selected.x + selected.width + 64);
    expect(object.y).toBe(selected.y);
  });

  it("preserves and links a selected source sketch while assigning diagram geometry", () => {
    const source = {
      id: "sketch-source",
      type: "sketch" as const,
      title: "Rough system",
      x: 80,
      y: 140,
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
              { x: 10, y: 10 },
              { x: 120, y: 90 },
            ],
          },
        ],
      },
      roomId: "room-demo",
      minimized: false,
      pinned: false,
      createdBy: "participant-host",
      createdAt: "2026-09-01T00:00:00.000Z",
      updatedAt: "2026-09-01T00:00:00.000Z",
      deletedAt: null,
      version: 1,
      metadata: {},
    };
    const object = buildSemanticCanvasObject(
      {
        type: "diagram",
        title: "Clean system",
        kind: "architecture",
        sourceSketchId: source.id,
        summary: "Structured from the selected sketch and spoken explanation.",
        nodes: [{ key: "api", label: "API", kind: "service" }],
        edges: [],
      },
      {
        ...context,
        objects: { [source.id]: source },
        selectedObjectId: source.id,
      },
    );

    expect(object.x).toBe(source.x + source.width + 64);
    expect(object.y).toBe(source.y);
    expect(object.payload).toMatchObject({ sourceSketchId: source.id });
  });

  it("does not attribute a diagram to an unverified agent host when summary is omitted", () => {
    const object = buildSemanticCanvasObject(
      {
        type: "diagram",
        title: "Request flow",
        kind: "flowchart",
        nodes: [{ key: "api", label: "API", kind: "service" }],
        edges: [],
      },
      context,
    );

    expect(object.payload).toMatchObject({
      interpretationSummary: "Structured from supplied semantic content.",
    });
  });
});
