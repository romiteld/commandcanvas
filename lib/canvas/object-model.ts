import { z } from "zod";

const objectIdSchema = z
  .string()
  .min(2)
  .max(96)
  .regex(/^[a-z][a-z0-9-]*$/);
const titleSchema = z.string().trim().min(1).max(120);
const coordinateSchema = z.number().finite().min(-1_000_000).max(1_000_000);
const widthSchema = z.number().finite().min(160).max(2_000);
const heightSchema = z.number().finite().min(80).max(1_400);
const zIndexSchema = z.number().int().min(0).max(100_000);
const rotationSchema = z.number().finite().min(-180).max(180);
const objectVersionSchema = z.number().int().min(1).max(1_000_000_000);
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

export const NOTE_TEXT_MAX_LENGTH = 4_000;
export const NOTE_APPEND_TEXT_MAX_LENGTH = 1_000;

const spatialFields = {
  id: objectIdSchema,
  title: titleSchema,
  x: coordinateSchema,
  y: coordinateSchema,
  width: widthSchema,
  height: heightSchema,
  zIndex: zIndexSchema,
  rotation: rotationSchema.optional(),
};

export const notePayloadSchema = z
  .object({
    text: z.string().max(NOTE_TEXT_MAX_LENGTH),
    tone: z.enum(["coral", "sky", "sand", "violet"]),
  })
  .strict();

const taskSchema = z
  .object({
    id: objectIdSchema,
    title: z.string().trim().min(1).max(180),
    owner: z.string().trim().min(1).max(80).optional(),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    priority: z.enum(["low", "medium", "high"]).optional(),
  })
  .strict();

const taskColumnSchema = z
  .object({
    id: objectIdSchema,
    title: z.string().trim().min(1).max(60),
    tasks: z.array(taskSchema).max(24),
  })
  .strict();

export const taskBoardPayloadSchema = z
  .object({
    columns: z.array(taskColumnSchema).min(1).max(5),
  })
  .strict();

const scheduleEntrySchema = z
  .object({
    id: objectIdSchema,
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    title: z.string().trim().min(1).max(180),
    owner: z.string().trim().min(1).max(80).optional(),
  })
  .strict();

const scheduleDaySchema = z
  .object({
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    label: z.string().trim().min(1).max(30),
    entries: z.array(scheduleEntrySchema).max(16),
  })
  .strict();

export const schedulePayloadSchema = z
  .object({
    timezone: z.string().trim().min(1).max(80),
    days: z.array(scheduleDaySchema).min(1).max(14),
  })
  .strict();

const sketchPointSchema = z
  .object({
    x: coordinateSchema,
    y: coordinateSchema,
    pressure: z.number().finite().min(0).max(1).optional(),
  })
  .strict();

const sketchStrokeSchema = z
  .object({
    id: objectIdSchema,
    color: z.string().regex(/^#[0-9a-f]{6}$/i),
    width: z.number().finite().min(1).max(32),
    points: z.array(sketchPointSchema).min(2).max(2_000),
  })
  .strict();

const normalizedSketchPointSchema = z
  .object({
    x: z.number().finite().min(0).max(1),
    y: z.number().finite().min(0).max(1),
  })
  .strict();

const sketchStrokeSampleSchema = z
  .object({
    strokeId: objectIdSchema,
    handTrackId: z.string().trim().min(1).max(128),
    timestampMs: z.number().finite().nonnegative(),
    sampleKind: z.enum([
      "measured",
      "short-gap predicted",
      "interpolated",
    ]),
    rawIndexTip: normalizedSketchPointSchema,
    filteredIndexTip: normalizedSketchPointSchema,
    renderedPoint: sketchPointSchema,
    confidence: z.number().finite().min(0).max(1),
  })
  .strict();

const sketchStrokeReceiptSchema = z
  .object({
    strokeId: objectIdSchema,
    handTrackId: z.string().trim().min(1).max(128),
    penDownAt: z.number().finite().nonnegative(),
    penUpAt: z.number().finite().nonnegative(),
    pointCount: z.number().int().min(2).max(2_000),
    measuredPointCount: z.number().int().min(0).max(2_000),
    predictedPointCount: z.number().int().min(0).max(2_000),
    interpolatedPointCount: z.number().int().min(0).max(2_000),
    longGapBridgeCount: z.literal(0),
    terminationReason: z.enum([
      "gesture-release",
      "draw-mode-exit",
      "tracking-timeout",
      "identity-loss",
      "explicit-cancel",
      "session-end",
    ]),
    sampleProvenanceVersion: z.literal(1).optional(),
    samples: z.array(sketchStrokeSampleSchema).min(2).max(2_000).optional(),
  })
  .strict()
  .refine((receipt) => receipt.penUpAt >= receipt.penDownAt, {
    message: "A stroke receipt cannot end before pen-down.",
  })
  .refine(
    (receipt) =>
      receipt.measuredPointCount +
        receipt.predictedPointCount +
        receipt.interpolatedPointCount ===
      receipt.pointCount,
    { message: "Stroke receipt sample counts must equal pointCount." },
  )
  .superRefine((receipt, context) => {
    const hasVersion = receipt.sampleProvenanceVersion !== undefined;
    const hasSamples = receipt.samples !== undefined;
    if (hasVersion !== hasSamples) {
      context.addIssue({
        code: "custom",
        path: hasVersion ? ["samples"] : ["sampleProvenanceVersion"],
        message:
          "Stroke sample provenance version and samples must be stored together.",
      });
      return;
    }
    if (!receipt.samples) return;

    if (receipt.samples.length !== receipt.pointCount)
      context.addIssue({
        code: "custom",
        path: ["samples"],
        message: "Stroke sample provenance must cover every stored point.",
      });

    const sampleKindCounts = {
      measured: 0,
      "short-gap predicted": 0,
      interpolated: 0,
    };
    for (const [index, sample] of receipt.samples.entries()) {
      sampleKindCounts[sample.sampleKind] += 1;
      if (sample.strokeId !== receipt.strokeId)
        context.addIssue({
          code: "custom",
          path: ["samples", index, "strokeId"],
          message: "Every sample must bind to its receipt stroke ID.",
        });
      if (sample.handTrackId !== receipt.handTrackId)
        context.addIssue({
          code: "custom",
          path: ["samples", index, "handTrackId"],
          message: "Every sample must bind to its receipt hand track ID.",
        });
      if (
        sample.timestampMs < receipt.penDownAt ||
        sample.timestampMs > receipt.penUpAt
      )
        context.addIssue({
          code: "custom",
          path: ["samples", index, "timestampMs"],
          message: "Sample timestamps must fall within the stroke interval.",
        });
      if (
        index > 0 &&
        sample.timestampMs <= receipt.samples[index - 1]!.timestampMs
      )
        context.addIssue({
          code: "custom",
          path: ["samples", index, "timestampMs"],
          message: "Stroke sample timestamps must be strictly increasing.",
        });
    }

    if (
      sampleKindCounts.measured !== receipt.measuredPointCount ||
      sampleKindCounts["short-gap predicted"] !==
        receipt.predictedPointCount ||
      sampleKindCounts.interpolated !== receipt.interpolatedPointCount
    )
      context.addIssue({
        code: "custom",
        path: ["samples"],
        message: "Stroke sample kinds must match the receipt category counts.",
      });
  });

export const sketchPayloadSchema = z
  .object({
    strokes: z.array(sketchStrokeSchema).max(128),
    strokeReceipts: z.array(sketchStrokeReceiptSchema).max(128).optional(),
  })
  .strict()
  .refine(
    (payload) =>
      new Set(payload.strokes.map((stroke) => stroke.id)).size ===
      payload.strokes.length,
    { message: "Every stored stroke ID must be unique within the sketch." },
  )
  .refine(
    (payload) =>
      !payload.strokeReceipts ||
      (payload.strokeReceipts.length === payload.strokes.length &&
        payload.strokeReceipts.every(
          (receipt, index) => receipt.strokeId === payload.strokes[index]?.id,
        )),
    { message: "Stroke receipts must bind every stored stroke in order." },
  )
  .superRefine((payload, context) => {
    if (!payload.strokeReceipts) return;
    for (const [strokeIndex, receipt] of payload.strokeReceipts.entries()) {
      const stroke = payload.strokes[strokeIndex];
      if (!stroke || receipt.strokeId !== stroke.id) continue;
      if (!receipt.samples) continue;
      if (receipt.pointCount !== stroke.points.length)
        context.addIssue({
          code: "custom",
          path: ["strokeReceipts", strokeIndex, "pointCount"],
          message: "Stroke receipt pointCount must match the stored stroke.",
        });
      for (const [sampleIndex, sample] of receipt.samples.entries()) {
        const point = stroke.points[sampleIndex];
        if (!point) continue;
        if (
          sample.renderedPoint.x !== point.x ||
          sample.renderedPoint.y !== point.y
        )
          context.addIssue({
            code: "custom",
            path: [
              "strokeReceipts",
              strokeIndex,
              "samples",
              sampleIndex,
              "renderedPoint",
            ],
            message:
              "Sample renderedPoint must match its aligned stored stroke point.",
          });
      }
    }
  });

const diagramNodeSchema = z
  .object({
    id: objectIdSchema,
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
    x: coordinateSchema,
    y: coordinateSchema,
    width: z.number().finite().min(80).max(600),
    height: z.number().finite().min(48).max(300),
  })
  .strict();

const diagramEdgeSchema = z
  .object({
    id: objectIdSchema,
    from: objectIdSchema,
    to: objectIdSchema,
    label: z.string().trim().min(1).max(100).optional(),
  })
  .strict();

export const NODE_DIAGRAM_KINDS = [
  "architecture",
  "flowchart",
  "diagram",
] as const;
export const CHART_DIAGRAM_KINDS = [
  "pie_chart",
  "bar_chart",
  "line_chart",
] as const;
export const DIAGRAM_KINDS = [
  ...NODE_DIAGRAM_KINDS,
  ...CHART_DIAGRAM_KINDS,
] as const;
export const diagramKindSchema = z.enum(DIAGRAM_KINDS);

const nodeDiagramPayloadSchema = z
  .object({
    kind: z.enum(NODE_DIAGRAM_KINDS),
    sourceSketchId: objectIdSchema.optional(),
    interpretationSummary: z.string().trim().min(1).max(600),
    nodes: z.array(diagramNodeSchema).min(1).max(30),
    edges: z.array(diagramEdgeSchema).max(60),
  })
  .strict()
  .superRefine((payload, context) => {
    const nodeIds = new Set(payload.nodes.map((node) => node.id));
    if (nodeIds.size !== payload.nodes.length)
      context.addIssue({
        code: "custom",
        path: ["nodes"],
        message: "Diagram node IDs must be unique.",
      });
    for (const edge of payload.edges) {
      if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to))
        context.addIssue({
          code: "custom",
          path: ["edges"],
          message: "Diagram edges must reference existing nodes.",
        });
    }
  });

const chartPointSchema = z
  .object({
    label: z.string().trim().min(1).max(80),
    value: z.number().finite().min(-1_000_000_000_000).max(1_000_000_000_000),
  })
  .strict();

const chartSeriesSchema = z
  .object({
    id: objectIdSchema,
    label: z.string().trim().min(1).max(80),
    points: z.array(chartPointSchema).min(1).max(24),
  })
  .strict()
  .superRefine((series, context) => {
    const labels = new Set(series.points.map((point) => point.label));
    if (labels.size !== series.points.length)
      context.addIssue({
        code: "custom",
        path: ["points"],
        message: "Chart point labels must be unique within a series.",
      });
  });

const chartPayloadSchema = z
  .object({
    kind: z.enum(CHART_DIAGRAM_KINDS),
    sourceSketchId: objectIdSchema.optional(),
    interpretationSummary: z.string().trim().min(1).max(600),
    chart: z
      .object({
        title: z.string().trim().min(1).max(120),
        xAxisLabel: z.string().trim().min(1).max(80).nullable(),
        yAxisLabel: z.string().trim().min(1).max(80).nullable(),
        series: z.array(chartSeriesSchema).min(1).max(6),
      })
      .strict(),
  })
  .strict()
  .superRefine((payload, context) => {
    const seriesIds = new Set(payload.chart.series.map((series) => series.id));
    if (seriesIds.size !== payload.chart.series.length)
      context.addIssue({
        code: "custom",
        path: ["chart", "series"],
        message: "Chart series IDs must be unique.",
      });

    if (payload.kind === "pie_chart") {
      if (payload.chart.series.length !== 1)
        context.addIssue({
          code: "custom",
          path: ["chart", "series"],
          message: "Pie charts must contain exactly one series.",
        });
      const points = payload.chart.series[0]?.points ?? [];
      if (points.some((point) => point.value < 0))
        context.addIssue({
          code: "custom",
          path: ["chart", "series", 0, "points"],
          message: "Pie chart values cannot be negative.",
        });
      if (points.every((point) => point.value === 0))
        context.addIssue({
          code: "custom",
          path: ["chart", "series", 0, "points"],
          message: "Pie charts require at least one positive value.",
        });
    }

    if (payload.kind !== "pie_chart" && payload.chart.series.length > 1) {
      const expectedLabels = payload.chart.series[0]?.points.map(
        (point) => point.label,
      );
      payload.chart.series.slice(1).forEach((series, seriesOffset) => {
        const labels = series.points.map((point) => point.label);
        if (
          labels.length !== expectedLabels?.length ||
          labels.some((label, index) => label !== expectedLabels[index])
        )
          context.addIssue({
            code: "custom",
            path: ["chart", "series", seriesOffset + 1, "points"],
            message:
              "Bar- and line-chart series must use the same ordered category labels.",
          });
      });
    }

    if (
      payload.kind === "line_chart" &&
      payload.chart.series.some((series) => series.points.length < 2)
    )
      context.addIssue({
        code: "custom",
        path: ["chart", "series"],
        message: "Line-chart series require at least two points.",
      });
  });

export const diagramPayloadSchema = z.union([
  nodeDiagramPayloadSchema,
  chartPayloadSchema,
]);

export const framePayloadSchema = z
  .object({
    tone: z.enum(["coral", "sky", "sand", "violet"]),
  })
  .strict();

const dataTableColumnSchema = z
  .object({
    id: objectIdSchema,
    label: z.string().trim().min(1).max(80),
    kind: z.enum(["text", "number", "currency", "percentage", "date"]),
  })
  .strict();

const dataTableCellSchema = z.union([
  z.string().max(500),
  z.number().finite().min(-1_000_000_000_000).max(1_000_000_000_000),
  z.boolean(),
  z.null(),
]);

const dataTableRowSchema = z
  .object({
    id: objectIdSchema,
    cells: z.array(dataTableCellSchema).max(12),
  })
  .strict();

export const dataTablePayloadSchema = z
  .object({
    columns: z.array(dataTableColumnSchema).min(1).max(12),
    rows: z.array(dataTableRowSchema).max(50),
  })
  .strict()
  .superRefine((payload, context) => {
    const columnIds = new Set(payload.columns.map((column) => column.id));
    if (columnIds.size !== payload.columns.length)
      context.addIssue({
        code: "custom",
        path: ["columns"],
        message: "Table column IDs must be unique.",
      });

    const rowIds = new Set(payload.rows.map((row) => row.id));
    if (rowIds.size !== payload.rows.length)
      context.addIssue({
        code: "custom",
        path: ["rows"],
        message: "Table row IDs must be unique.",
      });

    payload.rows.forEach((row, index) => {
      if (row.cells.length !== payload.columns.length)
        context.addIssue({
          code: "custom",
          path: ["rows", index, "cells"],
          message: "Every table row must contain one cell per column.",
        });
    });
  });

export const referenceCardPayloadSchema = z
  .object({
    kind: z.enum(["article", "document", "image", "link"]),
    sourceUrl: safeHttpUrlSchema.nullable(),
    summary: z.string().trim().min(1).max(1_200),
    excerpt: z.string().trim().min(1).max(1_200).nullable(),
  })
  .strict();

export const meetingCardPayloadSchema = z
  .object({
    kind: z.enum([
      "decision",
      "action_item",
      "summary",
      "risk",
      "open_question",
    ]),
    body: z.string().trim().min(1).max(4_000),
    bullets: z.array(z.string().trim().min(1).max(300)).max(20),
    owner: z.string().trim().min(1).max(80).nullable(),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
    status: z.enum([
      "proposed",
      "confirmed",
      "open",
      "in_progress",
      "done",
      "blocked",
    ]),
  })
  .strict();

const newNoteObjectSchema = z
  .object({
    ...spatialFields,
    type: z.literal("note"),
    payload: notePayloadSchema,
  })
  .strict();

const newTaskBoardObjectSchema = z
  .object({
    ...spatialFields,
    type: z.literal("task_board"),
    payload: taskBoardPayloadSchema,
  })
  .strict();

const newScheduleObjectSchema = z
  .object({
    ...spatialFields,
    type: z.literal("schedule"),
    payload: schedulePayloadSchema,
  })
  .strict();

const newSketchObjectSchema = z
  .object({
    ...spatialFields,
    type: z.literal("sketch"),
    payload: sketchPayloadSchema,
  })
  .strict();

const newDiagramObjectSchema = z
  .object({
    ...spatialFields,
    type: z.literal("diagram"),
    payload: diagramPayloadSchema,
  })
  .strict();

const newFrameObjectSchema = z
  .object({
    ...spatialFields,
    type: z.literal("frame"),
    payload: framePayloadSchema,
  })
  .strict();

const newDataTableObjectSchema = z
  .object({
    ...spatialFields,
    type: z.literal("data_table"),
    payload: dataTablePayloadSchema,
  })
  .strict();

const newReferenceCardObjectSchema = z
  .object({
    ...spatialFields,
    type: z.literal("reference_card"),
    payload: referenceCardPayloadSchema,
  })
  .strict();

const newMeetingCardObjectSchema = z
  .object({
    ...spatialFields,
    type: z.literal("meeting_card"),
    payload: meetingCardPayloadSchema,
  })
  .strict();

export const newCanvasObjectSchema = z.discriminatedUnion("type", [
  newNoteObjectSchema,
  newTaskBoardObjectSchema,
  newScheduleObjectSchema,
  newSketchObjectSchema,
  newDiagramObjectSchema,
  newFrameObjectSchema,
  newDataTableObjectSchema,
  newReferenceCardObjectSchema,
  newMeetingCardObjectSchema,
]);

const transformSchema = z
  .object({
    x: coordinateSchema.optional(),
    y: coordinateSchema.optional(),
    width: widthSchema.optional(),
    height: heightSchema.optional(),
    rotation: rotationSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0);

const flagsSchema = z
  .object({
    minimized: z.boolean().optional(),
    pinned: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0);

export const canvasCommandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("object.create"), object: newCanvasObjectSchema }).strict(),
  z
    .object({
      type: z.literal("object.append_note_text"),
      objectId: objectIdSchema,
      expectedVersion: objectVersionSchema,
      text: z.string().trim().min(1).max(NOTE_APPEND_TEXT_MAX_LENGTH),
    })
    .strict(),
  z
    .object({
      type: z.literal("object.transform"),
      objectId: objectIdSchema,
      expectedVersion: objectVersionSchema.optional(),
      transform: transformSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("object.set_flags"),
      objectId: objectIdSchema,
      expectedVersion: objectVersionSchema.optional(),
      flags: flagsSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("object.discard"),
      objectId: objectIdSchema,
      expectedVersion: objectVersionSchema.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("objects.group"),
      objectIds: z
        .array(objectIdSchema)
        .min(1)
        .max(20)
        .refine((ids) => new Set(ids).size === ids.length),
      expectedVersions: z
        .array(
          z
            .object({
              objectId: objectIdSchema,
              expectedVersion: objectVersionSchema,
            })
            .strict(),
        )
        .min(1)
        .max(20)
        .refine(
          (versions) =>
            new Set(versions.map((version) => version.objectId)).size ===
            versions.length,
        )
        .optional(),
      frame: newFrameObjectSchema,
    })
    .strict()
    .superRefine((value, context) => {
      if (!value.expectedVersions) return;
      const expectedIds = new Set(
        value.expectedVersions.map((version) => version.objectId),
      );
      if (
        expectedIds.size !== value.objectIds.length ||
        value.objectIds.some((objectId) => !expectedIds.has(objectId))
      )
        context.addIssue({
          code: "custom",
          path: ["expectedVersions"],
          message: "Expected versions must cover exactly the grouped objects.",
        });
    }),
  z
    .object({
      type: z.literal("objects.ungroup"),
      frameId: objectIdSchema,
      expectedVersion: objectVersionSchema.optional(),
    })
    .strict(),
  z.object({ type: z.literal("history.undo") }).strict(),
  z.object({ type: z.literal("history.redo") }).strict(),
]);

export type NotePayload = z.infer<typeof notePayloadSchema>;
export type TaskBoardPayload = z.infer<typeof taskBoardPayloadSchema>;
export type SchedulePayload = z.infer<typeof schedulePayloadSchema>;
export type SketchPayload = z.infer<typeof sketchPayloadSchema>;
export type DiagramPayload = z.infer<typeof diagramPayloadSchema>;
export type DiagramKind = z.infer<typeof diagramKindSchema>;
export type FramePayload = z.infer<typeof framePayloadSchema>;
export type DataTablePayload = z.infer<typeof dataTablePayloadSchema>;
export type ReferenceCardPayload = z.infer<typeof referenceCardPayloadSchema>;
export type MeetingCardPayload = z.infer<typeof meetingCardPayloadSchema>;
export type NewCanvasObject = z.infer<typeof newCanvasObjectSchema>;
export type NewNoteObject = Extract<NewCanvasObject, { type: "note" }>;
export type NewFrameObject = Extract<NewCanvasObject, { type: "frame" }>;
export type CanvasCommand = z.infer<typeof canvasCommandSchema>;

export interface PersistedObjectFields {
  roomId: string;
  minimized: boolean;
  pinned: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  version: number;
  metadata: Record<string, unknown>;
  rotation?: number;
  parentId?: string | null;
}

export type CanvasObject = NewCanvasObject & PersistedObjectFields;
