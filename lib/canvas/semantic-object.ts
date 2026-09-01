import { z } from "zod";

import type { CanvasViewport } from "@/lib/canvas/coordinates";
import {
  newCanvasObjectSchema,
  type CanvasObject,
  type NewCanvasObject,
} from "@/lib/canvas/object-model";

const titleSchema = z.string().trim().min(1).max(120);
const compactKeySchema = z
  .string()
  .min(2)
  .max(96)
  .regex(/^[a-z][a-z0-9-]*$/);
const placementSchema = z
  .enum(["current_viewport", "right_of_selection"])
  .optional();
const taskSchema = z
  .object({
    title: z.string().trim().min(1).max(180),
    owner: z.string().trim().min(1).max(80).optional(),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    priority: z.enum(["low", "medium", "high"]).optional(),
  })
  .strict();
const scheduleEntrySchema = z
  .object({
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    title: z.string().trim().min(1).max(180),
    owner: z.string().trim().min(1).max(80).optional(),
  })
  .strict();
const diagramNodeSchema = z
  .object({
    key: compactKeySchema,
    label: z.string().trim().min(1).max(120),
    kind: z.enum([
      "client",
      "service",
      "database",
      "queue",
      "external",
      "concept",
      "process",
      "decision",
    ]),
  })
  .strict();
const diagramEdgeSchema = z
  .object({
    from: compactKeySchema,
    to: compactKeySchema,
    label: z.string().trim().min(1).max(100).optional(),
  })
  .strict();
const chartPointSchema = z
  .object({
    label: z.string().trim().min(1).max(80),
    value: z.number().finite().min(-1_000_000_000_000).max(1_000_000_000_000),
  })
  .strict();
interface ChartRefinementValue {
  kind: "pie_chart" | "bar_chart" | "line_chart";
  series: Array<{
    label: string;
    points: Array<{ label: string; value: number }>;
  }>;
}
const tableCellSchema = z.union([
  z.string().max(500),
  z.number().finite().min(-1_000_000_000_000).max(1_000_000_000_000),
  z.boolean(),
  z.null(),
]);
const safeHttpUrlSchema = z
  .url()
  .max(2_048)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        (url.protocol === "https:" || url.protocol === "http:") &&
        !url.username &&
        !url.password
      );
    } catch {
      return false;
    }
  }, "Reference URLs must use HTTP(S) without embedded credentials.");

export const semanticCanvasObjectInputSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("note"),
      title: titleSchema.optional(),
      text: z.string().trim().max(4_000).optional(),
      tone: z.enum(["coral", "sky", "sand", "violet"]).optional(),
      placement: placementSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("task_board"),
      title: titleSchema,
      columns: z
        .array(
          z
            .object({
              title: z.string().trim().min(1).max(60),
              tasks: z.array(taskSchema).max(24),
            })
            .strict(),
        )
        .min(1)
        .max(5),
      placement: placementSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("schedule"),
      title: titleSchema,
      timezone: z.string().trim().min(1).max(80),
      days: z
        .array(
          z
            .object({
              date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
              label: z.string().trim().min(1).max(30),
              entries: z.array(scheduleEntrySchema).max(16),
            })
            .strict(),
        )
        .min(1)
        .max(14),
      placement: placementSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("diagram"),
      title: titleSchema,
      kind: z.enum(["architecture", "flowchart", "diagram"]),
      sourceSketchId: compactKeySchema.optional(),
      summary: z.string().trim().min(1).max(600).optional(),
      nodes: z.array(diagramNodeSchema).min(1).max(30),
      edges: z.array(diagramEdgeSchema).max(60).default([]),
      placement: placementSchema,
    })
    .strict()
    .superRefine(validateDiagramReferences),
  z
    .object({
      type: z.literal("chart"),
      title: titleSchema,
      kind: z.enum(["pie_chart", "bar_chart", "line_chart"]),
      sourceSketchId: compactKeySchema.optional(),
      summary: z.string().trim().min(1).max(600).optional(),
      xAxisLabel: z.string().trim().min(1).max(80).nullable().optional(),
      yAxisLabel: z.string().trim().min(1).max(80).nullable().optional(),
      series: z
        .array(
          z
            .object({
              label: z.string().trim().min(1).max(80),
              points: z.array(chartPointSchema).min(1).max(24),
            })
            .strict(),
        )
        .min(1)
        .max(6),
      placement: placementSchema,
    })
    .strict()
    .superRefine(validateChart),
  z
    .object({
      type: z.literal("data_table"),
      title: titleSchema,
      columns: z
        .array(
          z
            .object({
              label: z.string().trim().min(1).max(80),
              kind: z.enum(["text", "number", "currency", "percentage", "date"]),
            })
            .strict(),
        )
        .min(1)
        .max(12),
      rows: z.array(z.array(tableCellSchema).max(12)).max(50),
      placement: placementSchema,
    })
    .strict()
    .superRefine((value, context) => {
      value.rows.forEach((row, index) => {
        if (row.length !== value.columns.length)
          context.addIssue({
            code: "custom",
            path: ["rows", index],
            message: "Every row needs one cell per column.",
          });
      });
    }),
  z
    .object({
      type: z.literal("reference_card"),
      title: titleSchema,
      kind: z.enum(["article", "document", "image", "link"]),
      sourceUrl: safeHttpUrlSchema.nullable().optional(),
      summary: z.string().trim().min(1).max(1_200),
      excerpt: z.string().trim().min(1).max(1_200).nullable().optional(),
      placement: placementSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("meeting_card"),
      title: titleSchema,
      kind: z.enum(["decision", "action_item", "summary", "risk", "open_question"]),
      body: z.string().trim().min(1).max(4_000),
      bullets: z.array(z.string().trim().min(1).max(300)).max(20).default([]),
      owner: z.string().trim().min(1).max(80).nullable().optional(),
      dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      status: z
        .enum(["proposed", "confirmed", "open", "in_progress", "done", "blocked"])
        .optional(),
      placement: placementSchema,
    })
    .strict(),
]);

export type SemanticCanvasObjectInput = z.infer<
  typeof semanticCanvasObjectInputSchema
>;

export interface SemanticCanvasObjectBuildContext {
  viewport: CanvasViewport;
  objects: Record<string, CanvasObject>;
  selectedObjectId: string | null;
}

export function buildSemanticCanvasObject(
  input: SemanticCanvasObjectInput,
  context: SemanticCanvasObjectBuildContext,
): NewCanvasObject {
  const spatial = spatialFields(input, context);

  switch (input.type) {
    case "note":
      return parseObject({
        ...spatial,
        type: "note",
        title: input.title ?? "Note",
        payload: {
          text: input.text ?? "",
          tone: input.tone ?? "sand",
        },
      });
    case "task_board":
      return parseObject({
        ...spatial,
        type: "task_board",
        title: input.title,
        payload: {
          columns: input.columns.map((column) => ({
            id: createSemanticId("column"),
            title: column.title,
            tasks: column.tasks.map((task) => ({
              id: createSemanticId("task"),
              title: task.title,
              ...(task.owner ? { owner: task.owner } : {}),
              ...(task.dueDate ? { dueDate: task.dueDate } : {}),
              ...(task.priority ? { priority: task.priority } : {}),
            })),
          })),
        },
      });
    case "schedule":
      return parseObject({
        ...spatial,
        type: "schedule",
        title: input.title,
        payload: {
          timezone: input.timezone,
          days: input.days.map((day) => ({
            ...day,
            entries: day.entries.map((entry) => ({
              id: createSemanticId("schedule-entry"),
              ...entry,
            })),
          })),
        },
      });
    case "diagram": {
      const rows = Math.ceil(input.nodes.length / 3);
      return parseObject({
        ...spatial,
        width: 720,
        height: Math.max(420, rows * 130 + 100),
        type: "diagram",
        title: input.title,
        payload: {
          kind: input.kind,
          ...(input.sourceSketchId
            ? { sourceSketchId: input.sourceSketchId }
            : {}),
          interpretationSummary:
            input.summary ?? "Structured from supplied semantic content.",
          nodes: input.nodes.map((node, index) => ({
            id: node.key,
            label: node.label,
            kind: node.kind,
            x: 60 + (index % 3) * 220,
            y: 60 + Math.floor(index / 3) * 130,
            width: 170,
            height: 72,
          })),
          edges: input.edges.map((edge) => ({
            id: createSemanticId("edge"),
            ...edge,
          })),
        },
      });
    }
    case "chart":
      return parseObject({
        ...spatial,
        width: 620,
        height: 420,
        type: "diagram",
        title: input.title,
        payload: {
          kind: input.kind,
          ...(input.sourceSketchId
            ? { sourceSketchId: input.sourceSketchId }
            : {}),
          interpretationSummary: input.summary ?? `${input.title} created from the supplied values.`,
          chart: {
            title: input.title,
            xAxisLabel: input.xAxisLabel ?? null,
            yAxisLabel: input.yAxisLabel ?? null,
            series: input.series.map((series) => ({
              id: createSemanticId("series"),
              ...series,
            })),
          },
        },
      });
    case "data_table":
      return parseObject({
        ...spatial,
        width: Math.min(1_200, Math.max(520, input.columns.length * 150)),
        height: Math.min(1_000, Math.max(260, input.rows.length * 44 + 160)),
        type: "data_table",
        title: input.title,
        payload: {
          columns: input.columns.map((column) => ({
            id: createSemanticId("column"),
            ...column,
          })),
          rows: input.rows.map((cells) => ({
            id: createSemanticId("row"),
            cells,
          })),
        },
      });
    case "reference_card":
      return parseObject({
        ...spatial,
        type: "reference_card",
        title: input.title,
        payload: {
          kind: input.kind,
          sourceUrl: input.sourceUrl ?? null,
          summary: input.summary,
          excerpt: input.excerpt ?? null,
        },
      });
    case "meeting_card":
      return parseObject({
        ...spatial,
        type: "meeting_card",
        title: input.title,
        payload: {
          kind: input.kind,
          body: input.body,
          bullets: input.bullets,
          owner: input.owner ?? null,
          dueDate: input.dueDate ?? null,
          status: input.status ?? defaultMeetingCardStatus(input.kind),
        },
      });
  }
}

function validateDiagramReferences(
  value: {
    nodes: Array<{ key: string }>;
    edges: Array<{ from: string; to: string }>;
  },
  context: z.RefinementCtx,
) {
  const keys = new Set(value.nodes.map((node) => node.key));
  if (keys.size !== value.nodes.length)
    context.addIssue({
      code: "custom",
      path: ["nodes"],
      message: "Node keys must be unique.",
    });
  value.edges.forEach((edge, index) => {
    if (!keys.has(edge.from) || !keys.has(edge.to))
      context.addIssue({
        code: "custom",
        path: ["edges", index],
        message: "Edges must reference node keys from this diagram.",
      });
  });
}

function validateChart(
  value: ChartRefinementValue,
  context: z.RefinementCtx,
) {
  value.series.forEach((series, index) => {
    const labels = new Set(series.points.map((point) => point.label));
    if (labels.size !== series.points.length)
      context.addIssue({
        code: "custom",
        path: ["series", index, "points"],
        message: "Chart point labels must be unique within a series.",
      });
  });

  if (value.kind === "pie_chart") {
    if (value.series.length !== 1)
      context.addIssue({
        code: "custom",
        path: ["series"],
        message: "Pie charts must contain exactly one series.",
      });
    const points = value.series[0]?.points ?? [];
    if (points.some((point) => point.value < 0))
      context.addIssue({
        code: "custom",
        path: ["series", 0, "points"],
        message: "Pie chart values cannot be negative.",
      });
    if (points.every((point) => point.value === 0))
      context.addIssue({
        code: "custom",
        path: ["series", 0, "points"],
        message: "Pie charts require at least one positive value.",
      });
  }

  if (value.kind !== "pie_chart" && value.series.length > 1) {
    const expected = value.series[0]?.points.map((point) => point.label);
    value.series.slice(1).forEach((series, offset) => {
      const labels = series.points.map((point) => point.label);
      if (
        labels.length !== expected?.length ||
        labels.some((label, index) => label !== expected[index])
      )
        context.addIssue({
          code: "custom",
          path: ["series", offset + 1, "points"],
          message:
            "Bar- and line-chart series must use the same ordered category labels.",
        });
    });
  }

  if (
    value.kind === "line_chart" &&
    value.series.some((series) => series.points.length < 2)
  )
    context.addIssue({
      code: "custom",
      path: ["series"],
      message: "Line-chart series require at least two points.",
    });
}

function spatialFields(
  input: SemanticCanvasObjectInput,
  context: SemanticCanvasObjectBuildContext,
) {
  const objects = Object.values(context.objects).filter((object) => !object.deletedAt);
  const zIndex = Math.min(
    100_000,
    objects.reduce((highest, object) => Math.max(highest, object.zIndex), 0) + 1,
  );
  const selected = context.selectedObjectId
    ? context.objects[context.selectedObjectId]
    : undefined;
  const sourceSketch =
    (input.type === "diagram" || input.type === "chart") &&
    input.sourceSketchId
      ? context.objects[input.sourceSketchId]
      : undefined;
  const beside =
    sourceSketch && !sourceSketch.deletedAt
      ? sourceSketch
      : input.placement === "right_of_selection" && selected && !selected.deletedAt
        ? selected
        : undefined;
  const cascade = (objects.length % 6) * 28;
  const scale = context.viewport.scale || 1;
  const x = beside
    ? beside.x + beside.width + 64
    : (120 - context.viewport.x) / scale + cascade;
  const y = beside
    ? beside.y
    : (120 - context.viewport.y) / scale + cascade;

  return {
    id: createSemanticId(input.type),
    x,
    y,
    width: defaultSize(input.type).width,
    height: defaultSize(input.type).height,
    zIndex,
  };
}

function defaultSize(type: SemanticCanvasObjectInput["type"]) {
  switch (type) {
    case "note":
      return { width: 320, height: 220 };
    case "task_board":
      return { width: 560, height: 320 };
    case "schedule":
      return { width: 460, height: 310 };
    case "diagram":
    case "chart":
      return { width: 620, height: 420 };
    case "data_table":
      return { width: 620, height: 320 };
    case "reference_card":
      return { width: 440, height: 300 };
    case "meeting_card":
      return { width: 380, height: 280 };
  }
}

function createSemanticId(prefix: string) {
  const suffix = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix.replaceAll("_", "-")}-${suffix}`;
}

function defaultMeetingCardStatus(
  kind: Extract<SemanticCanvasObjectInput, { type: "meeting_card" }>["kind"],
) {
  if (kind === "decision") return "proposed" as const;
  if (kind === "summary") return "confirmed" as const;
  return "open" as const;
}

function parseObject(object: unknown) {
  return newCanvasObjectSchema.parse(object);
}
