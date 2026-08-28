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
    text: z.string().max(4_000),
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

export const sketchPayloadSchema = z
  .object({
    strokes: z.array(sketchStrokeSchema).max(128),
  })
  .strict();

const diagramNodeSchema = z
  .object({
    id: objectIdSchema,
    label: z.string().trim().min(1).max(120),
    kind: z.enum(["client", "service", "database", "queue", "external"]),
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

export const diagramPayloadSchema = z
  .object({
    kind: z.enum(["architecture", "flowchart"]),
    sourceSketchId: objectIdSchema,
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

export const framePayloadSchema = z
  .object({
    tone: z.enum(["coral", "sky", "sand", "violet"]),
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

export const newCanvasObjectSchema = z.discriminatedUnion("type", [
  newNoteObjectSchema,
  newTaskBoardObjectSchema,
  newScheduleObjectSchema,
  newSketchObjectSchema,
  newDiagramObjectSchema,
  newFrameObjectSchema,
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
      type: z.literal("object.transform"),
      objectId: objectIdSchema,
      transform: transformSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("object.set_flags"),
      objectId: objectIdSchema,
      flags: flagsSchema,
    })
    .strict(),
  z
    .object({ type: z.literal("object.discard"), objectId: objectIdSchema })
    .strict(),
  z
    .object({
      type: z.literal("objects.group"),
      objectIds: z
        .array(objectIdSchema)
        .min(1)
        .max(20)
        .refine((ids) => new Set(ids).size === ids.length),
      frame: newFrameObjectSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("objects.ungroup"),
      frameId: objectIdSchema,
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
export type FramePayload = z.infer<typeof framePayloadSchema>;
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
