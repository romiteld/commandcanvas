import { z } from "zod";

import {
  NOTE_APPEND_TEXT_MAX_LENGTH,
  newCanvasObjectSchema,
} from "@/lib/canvas/object-model";
import { semanticCanvasObjectInputSchema } from "@/lib/canvas/semantic-object";
import {
  MAX_DIAGRAM_TRANSFORM_NARRATION_CHARS,
  sketchTransformOutputKindSchema,
} from "@/lib/vision/diagram-transform";

export const CANVAS_CAPABILITY_NAMES = [
  "get_canvas_state",
  "create_object",
  "update_object_content",
  "transform_object",
  "set_object_state",
  "discard_object",
  "organize_objects",
  "history_action",
  "transform_sketch",
  "prepare_meeting_packet",
  "request_packet_send",
  "control_workspace",
] as const;

export type CanvasCapabilityName = (typeof CANVAS_CAPABILITY_NAMES)[number];

const objectIdSchema = z
  .string()
  .min(2)
  .max(96)
  .regex(/^[a-z][a-z0-9-]*$/);
const coordinateSchema = z.number().finite().min(-1_000_000).max(1_000_000);
const rotationSchema = z.number().finite().min(-180).max(180);
const titleSchema = z.string().trim().min(1).max(120);
const zIndexSchema = z.number().int().min(0).max(100_000);
const objectVersionSchema = z.number().int().min(1).max(1_000_000_000);
const compactKeySchema = z
  .string()
  .min(2)
  .max(96)
  .regex(/^[a-z][a-z0-9-]*$/);

const spatialTransformSchema = z
  .object({
    x: coordinateSchema.optional(),
    y: coordinateSchema.optional(),
    width: z.number().finite().min(160).max(2_000).optional(),
    height: z.number().finite().min(80).max(1_400).optional(),
    rotation: rotationSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0);

const objectStateSchema = z
  .object({ minimized: z.boolean().optional(), pinned: z.boolean().optional() })
  .strict()
  .refine((value) => Object.keys(value).length > 0);

const workspaceActionSchema = z
  .object({
    action: z.enum([
      "start_drawing",
      "finish_drawing",
      "cancel_drawing",
      "zoom_in",
      "zoom_out",
      "set_zoom",
      "fit_all",
      "fit_selected",
      "focus_selected",
      "restore_view",
    ]),
    scale: z.number().finite().min(0.15).max(4).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.action === "set_zoom" && value.scale === undefined)
      context.addIssue({
        code: "custom",
        path: ["scale"],
        message: "set_zoom requires a scale.",
      });
    if (value.action !== "set_zoom" && value.scale !== undefined)
      context.addIssue({
        code: "custom",
        path: ["scale"],
        message: "scale is only valid with set_zoom.",
      });
  });

export const CANVAS_CAPABILITY_INPUT_SCHEMAS = {
  get_canvas_state: z
    .object({
      scope: z.enum(["all", "selected"]).optional(),
      includeReceipts: z.boolean().optional(),
    })
    .strict(),
  create_object: semanticCanvasObjectInputSchema,
  update_object_content: z
    .object({
      objectId: objectIdSchema.optional(),
      text: z.string().trim().min(1).max(NOTE_APPEND_TEXT_MAX_LENGTH),
    })
    .strict(),
  transform_object: z
    .object({
      objectId: objectIdSchema,
      expectedVersion: objectVersionSchema,
      transform: spatialTransformSchema,
    })
    .strict(),
  set_object_state: z
    .object({
      objectId: objectIdSchema,
      expectedVersion: objectVersionSchema,
      state: objectStateSchema,
    })
    .strict(),
  discard_object: z
    .object({ objectId: objectIdSchema, expectedVersion: objectVersionSchema })
    .strict(),
  organize_objects: z.discriminatedUnion("action", [
    z
      .object({
        action: z.literal("group"),
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
          ),
        frame: z
          .object({
            id: objectIdSchema,
            title: titleSchema,
            x: coordinateSchema,
            y: coordinateSchema,
            width: z.number().finite().min(160).max(2_000),
            height: z.number().finite().min(80).max(1_400),
            zIndex: zIndexSchema,
            tone: z.enum(["coral", "sky", "sand", "violet"]),
          })
          .strict(),
      })
      .strict()
      .superRefine((value, context) => {
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
        action: z.literal("ungroup"),
        frameId: objectIdSchema,
        expectedVersion: objectVersionSchema,
      })
      .strict(),
  ]),
  history_action: z.object({ action: z.enum(["undo", "redo"]) }).strict(),
  transform_sketch: z
    .object({
      sketchId: objectIdSchema,
      instruction: z.string().trim().min(1).max(500),
      narration: z
        .string()
        .trim()
        .min(1)
        .max(MAX_DIAGRAM_TRANSFORM_NARRATION_CHARS)
        .optional(),
      outputKind: sketchTransformOutputKindSchema.optional(),
    })
    .strict(),
  prepare_meeting_packet: z
    .object({
      title: z.string().trim().min(1).max(120).optional(),
      objectIds: z
        .array(objectIdSchema)
        .min(1)
        .max(50)
        .refine((ids) => new Set(ids).size === ids.length)
        .optional(),
    })
    .strict(),
  request_packet_send: z.object({ packetId: objectIdSchema }).strict(),
  control_workspace: workspaceActionSchema,
} as const satisfies Record<CanvasCapabilityName, z.ZodType>;

export const CANVAS_CAPABILITY_RUNTIME_INPUT_SCHEMAS = {
  ...CANVAS_CAPABILITY_INPUT_SCHEMAS,
  create_object: z.union([
    CANVAS_CAPABILITY_INPUT_SCHEMAS.create_object,
    z.object({ object: newCanvasObjectSchema }).strict(),
  ]),
} as const satisfies Record<CanvasCapabilityName, z.ZodType>;

export type CanvasCapabilityInputMap = {
  [Name in CanvasCapabilityName]: z.infer<
    (typeof CANVAS_CAPABILITY_INPUT_SCHEMAS)[Name]
  >;
};

export type CanvasCapabilityInput<Name extends CanvasCapabilityName> =
  CanvasCapabilityInputMap[Name];

export type CanvasCapabilityPhase =
  | "no_room"
  | "room_active"
  | "content_exists"
  | "selection_active"
  | "collaboration_active"
  | "packet_prepared"
  | "packet_approved";

export interface CanvasCapabilityPhaseState {
  roomActive: boolean;
  hasContent: boolean;
  selection: "none" | "object" | "sketch";
  collaboratorCount: number;
  packet: "none" | "prepared" | "approved";
}

export interface CanvasCapabilityExecutionContext {
  phase: CanvasCapabilityPhaseState;
  actor: {
    participantId: string;
    role: "host" | "participant";
  } | null;
  canMutateCanvas: boolean;
}

export type CanvasCapabilityGuardResult =
  | { ok: true }
  | {
      ok: false;
      code: "not_available" | "unauthorized" | "forbidden";
      message: string;
    };

export interface CanvasCapabilityDefinition {
  description: string;
  inputSchema: z.ZodType;
  annotations: {
    readOnlyHint: boolean;
    untrustedContentHint: boolean;
  };
  humanApproval: "not_required" | "required_after_staging";
  requiredPhase: CanvasCapabilityPhase;
  permission: "read" | "mutate" | "host";
}

const annotations = {
  readUntrusted: Object.freeze({
    readOnlyHint: true,
    untrustedContentHint: true,
  }),
  mutateUntrusted: Object.freeze({
    readOnlyHint: false,
    untrustedContentHint: true,
  }),
  localControl: Object.freeze({
    readOnlyHint: false,
    untrustedContentHint: false,
  }),
} as const;

export const CANVAS_CAPABILITY_CATALOG = {
  get_canvas_state: {
    description:
      "Read a compact semantic projection of the live canvas, current selection, and recent activity receipts without changing the room. Call this with scope selected before acting when the user says this, that, or the selected object; use the returned stable object ID in the next tool call.",
    inputSchema: CANVAS_CAPABILITY_INPUT_SCHEMAS.get_canvas_state,
    annotations: annotations.readUntrusted,
    humanApproval: "not_required",
    requiredPhase: "room_active",
    permission: "read",
  },
  create_object: {
    description:
      "Create one note, task board, schedule, diagram, chart, data table, reference card, decision, action item, summary, risk, or open-question card from compact semantic content. CommandCanvas assigns safe IDs, geometry, z-order, and nested IDs, so use this directly for ordinary creation requests without reading the canvas first. To create a visual from the user's spoken explanation of a selected sketch without image inference, first read the selected state, pass its ID as sourceSketchId, and CommandCanvas will preserve the sketch and place the linked visual beside it.",
    inputSchema: CANVAS_CAPABILITY_INPUT_SCHEMAS.create_object,
    annotations: annotations.mutateUntrusted,
    humanApproval: "not_required",
    requiredPhase: "room_active",
    permission: "mutate",
  },
  update_object_content: {
    description:
      "Append bounded text to one active note or thought through the versioned mutation pipeline. Provide a stable objectId, or omit it only after get_canvas_state with scope selected confirms the intended note; this cannot replace content or apply arbitrary JSON patches.",
    inputSchema: CANVAS_CAPABILITY_INPUT_SCHEMAS.update_object_content,
    annotations: annotations.mutateUntrusted,
    humanApproval: "not_required",
    requiredPhase: "content_exists",
    permission: "mutate",
  },
  transform_object: {
    description:
      "Move, resize, or rotate one existing, unpinned canvas object through the canonical mutation pipeline. When the user says this or that, first read the selected canvas state and then use that stable object ID.",
    inputSchema: CANVAS_CAPABILITY_INPUT_SCHEMAS.transform_object,
    annotations: annotations.mutateUntrusted,
    humanApproval: "not_required",
    requiredPhase: "content_exists",
    permission: "mutate",
  },
  set_object_state: {
    description:
      "Pin, unpin, minimize, or restore one existing canvas object and record the resulting receipt. Resolve this, that, or selected through get_canvas_state before using its stable object ID.",
    inputSchema: CANVAS_CAPABILITY_INPUT_SCHEMAS.set_object_state,
    annotations: annotations.mutateUntrusted,
    humanApproval: "not_required",
    requiredPhase: "content_exists",
    permission: "mutate",
  },
  discard_object: {
    description:
      "Move one explicit canvas object to recoverable trash; this never performs permanent deletion. Resolve this, that, or selected through get_canvas_state before using its stable object ID.",
    inputSchema: CANVAS_CAPABILITY_INPUT_SCHEMAS.discard_object,
    annotations: annotations.mutateUntrusted,
    humanApproval: "not_required",
    requiredPhase: "content_exists",
    permission: "mutate",
  },
  organize_objects: {
    description:
      "Group explicit canvas objects inside a semantic frame, or ungroup an existing frame, through one reversible mutation.",
    inputSchema: CANVAS_CAPABILITY_INPUT_SCHEMAS.organize_objects,
    annotations: annotations.mutateUntrusted,
    humanApproval: "not_required",
    requiredPhase: "content_exists",
    permission: "mutate",
  },
  history_action: {
    description:
      "Undo or redo the latest reversible shared canvas mutation and record an attributable history receipt.",
    inputSchema: CANVAS_CAPABILITY_INPUT_SCHEMAS.history_action,
    annotations: annotations.mutateUntrusted,
    humanApproval: "not_required",
    requiredPhase: "room_active",
    permission: "mutate",
  },
  transform_sketch: {
    description:
      "Interpret a selected sketch into a new structured diagram or chart beside it while preserving the source sketch. Omit outputKind or use auto when the image, narration, and instruction should determine the concrete visual family.",
    inputSchema: CANVAS_CAPABILITY_INPUT_SCHEMAS.transform_sketch,
    annotations: annotations.mutateUntrusted,
    humanApproval: "not_required",
    requiredPhase: "selection_active",
    permission: "mutate",
  },
  prepare_meeting_packet: {
    description:
      "Create or refresh a reviewable meeting-packet draft from current semantic canvas objects; this does not approve or send it.",
    inputSchema: CANVAS_CAPABILITY_INPUT_SCHEMAS.prepare_meeting_packet,
    annotations: annotations.mutateUntrusted,
    humanApproval: "not_required",
    requiredPhase: "content_exists",
    permission: "host",
  },
  request_packet_send: {
    description:
      "Stage an approved meeting packet for explicit host confirmation. This tool never sends email by itself and cannot override the approved recipient snapshot.",
    inputSchema: CANVAS_CAPABILITY_INPUT_SCHEMAS.request_packet_send,
    annotations: annotations.localControl,
    humanApproval: "required_after_staging",
    requiredPhase: "packet_approved",
    permission: "host",
  },
  control_workspace: {
    description:
      "Control the current participant's local canvas view or drawing session. Start, finish, or cancel drawing; zoom, fit, focus, or restore the viewport. These local controls never discard objects, approve packets, send email, or fabricate a shared mutation receipt.",
    inputSchema: CANVAS_CAPABILITY_INPUT_SCHEMAS.control_workspace,
    annotations: annotations.localControl,
    humanApproval: "not_required",
    requiredPhase: "room_active",
    permission: "mutate",
  },
} as const satisfies Record<CanvasCapabilityName, CanvasCapabilityDefinition>;

export function evaluateCanvasCapabilityGuard(
  capability: CanvasCapabilityName,
  context: CanvasCapabilityExecutionContext,
): CanvasCapabilityGuardResult {
  const definition = CANVAS_CAPABILITY_CATALOG[capability];
  const phase = context.phase;
  if (!phase.roomActive)
    return {
      ok: false,
      code: "not_available",
      message: "not available yet: create or join a room first",
    };
  if (definition.requiredPhase === "content_exists" && !phase.hasContent)
    return {
      ok: false,
      code: "not_available",
      message: "not available yet: add canvas content first",
    };
  if (definition.requiredPhase === "selection_active") {
    if (!phase.hasContent)
      return {
        ok: false,
        code: "not_available",
        message: "not available yet: add canvas content first",
      };
    if (phase.selection !== "sketch")
      return {
        ok: false,
        code: "not_available",
        message: "not available yet: select a sketch first",
      };
  }
  if (
    definition.requiredPhase === "packet_approved" &&
    phase.packet !== "approved"
  )
    return {
      ok: false,
      code: "not_available",
      message:
        "not available yet: approve the meeting packet before requesting a send",
    };
  if (!context.actor)
    return {
      ok: false,
      code: "unauthorized",
      message:
        "authorization required: join the room before using canvas tools",
    };
  if (definition.permission === "mutate" && !context.canMutateCanvas)
    return {
      ok: false,
      code: "forbidden",
      message:
        "mutation not authorized: this participant can only view the room",
    };
  if (definition.permission === "host" && context.actor.role !== "host")
    return {
      ok: false,
      code: "forbidden",
      message:
        capability === "prepare_meeting_packet"
          ? "host authorization required: only the host can prepare a meeting packet"
          : "host authorization required: only the host can request packet delivery",
    };
  return { ok: true };
}

export function evaluateCanvasCapabilityPhaseGuard(
  capability: CanvasCapabilityName,
  phase: CanvasCapabilityPhaseState,
): CanvasCapabilityGuardResult {
  return evaluateCanvasCapabilityGuard(capability, {
    phase,
    actor: { participantId: "phase-projection", role: "host" },
    canMutateCanvas: true,
  });
}

export function projectWebMcpCapabilityCatalog() {
  return Object.fromEntries(
    CANVAS_CAPABILITY_NAMES.map((name) => [
      name,
      {
        description: CANVAS_CAPABILITY_CATALOG[name].description,
        inputSchema: CANVAS_CAPABILITY_CATALOG[name].inputSchema,
        annotations: CANVAS_CAPABILITY_CATALOG[name].annotations,
        humanApproval: CANVAS_CAPABILITY_CATALOG[name].humanApproval,
      },
    ]),
  ) as {
    [Name in CanvasCapabilityName]: Pick<
      (typeof CANVAS_CAPABILITY_CATALOG)[Name],
      "description" | "inputSchema" | "annotations" | "humanApproval"
    >;
  };
}

const emptySchema = z.object({}).strict();
const compactCreateNoteSchema = z
  .object({
    title: titleSchema.optional(),
    text: z.string().trim().min(1).max(4_000).optional(),
  })
  .strict();
const compactBoardTaskSchema = z
  .object({
    title: z.string().trim().min(1).max(180),
    owner: z.string().trim().min(1).max(80).optional(),
    dueDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .optional(),
    priority: z.enum(["low", "medium", "high"]).optional(),
  })
  .strict();
const compactBoardSchema = z
  .object({
    title: titleSchema.optional(),
    columns: z
      .array(
        z
          .object({
            title: z.string().trim().min(1).max(60),
            tasks: z.array(compactBoardTaskSchema).max(24),
          })
          .strict(),
      )
      .min(1)
      .max(5)
      .optional(),
  })
  .strict();
const compactScheduleSchema = z
  .object({
    title: titleSchema,
    timezone: z.string().trim().min(1).max(80),
    days: z
      .array(
        z
          .object({
            date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
            label: z.string().trim().min(1).max(30),
            entries: z
              .array(
                z
                  .object({
                    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
                    title: z.string().trim().min(1).max(180),
                    owner: z.string().trim().min(1).max(80).optional(),
                  })
                  .strict(),
              )
              .max(16),
          })
          .strict(),
      )
      .min(1)
      .max(14),
  })
  .strict();
const compactDiagramSchema = z
  .object({
    title: titleSchema,
    kind: z.enum(["architecture", "flowchart", "diagram"]),
    summary: z.string().trim().min(1).max(600),
    nodes: z
      .array(
        z
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
          .strict(),
      )
      .min(1)
      .max(30),
    edges: z
      .array(
        z
          .object({
            from: compactKeySchema,
            to: compactKeySchema,
            label: z.string().trim().min(1).max(100).optional(),
          })
          .strict(),
      )
      .max(60)
      .default([]),
  })
  .strict()
  .superRefine((value, context) => {
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
  });
const chartPointSchema = z
  .object({
    label: z.string().trim().min(1).max(80),
    value: z.number().finite().min(-1_000_000_000_000).max(1_000_000_000_000),
  })
  .strict();
const compactChartSchema = z
  .object({
    title: titleSchema,
    kind: z.enum(["pie_chart", "bar_chart", "line_chart"]),
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
  })
  .strict();
const tableCellSchema = z.union([
  z.string().max(500),
  z.number().finite().min(-1_000_000_000_000).max(1_000_000_000_000),
  z.boolean(),
  z.null(),
]);
const compactTableSchema = z
  .object({
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
  });
const compactReferenceSchema = z
  .object({
    title: titleSchema,
    kind: z.enum(["article", "document", "image", "link"]),
    sourceUrl: z.url().max(2_048).nullable().optional(),
    summary: z.string().trim().min(1).max(1_200),
    excerpt: z.string().trim().min(1).max(1_200).nullable().optional(),
  })
  .strict();
const compactMeetingCardSchema = z
  .object({
    title: titleSchema,
    kind: z.enum([
      "decision",
      "action_item",
      "summary",
      "risk",
      "open_question",
    ]),
    body: z.string().trim().min(1).max(4_000),
    bullets: z.array(z.string().trim().min(1).max(300)).max(20).default([]),
    owner: z.string().trim().min(1).max(80).nullable().optional(),
    dueDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
    status: z
      .enum(["proposed", "confirmed", "open", "in_progress", "done", "blocked"])
      .optional(),
  })
  .strict();
const appendSelectedSchema = z
  .object({
    objectId: objectIdSchema.optional(),
    target: titleSchema.optional(),
    text: z.string().trim().min(1).max(NOTE_APPEND_TEXT_MAX_LENGTH),
  })
  .strict()
  .refine((value) => !(value.objectId && value.target), {
    message: "Use either objectId or target, not both.",
  });
const transformSelectedSketchSchema = z
  .object({
    instruction: z.string().trim().min(1).max(500).optional(),
    outputKind: sketchTransformOutputKindSchema.optional(),
  })
  .strict();
const realtimeObjectTargetFields = {
  objectId: objectIdSchema.optional(),
  target: titleSchema.optional(),
};
const realtimeObjectTargetSchema = z
  .object(realtimeObjectTargetFields)
  .strict()
  .refine((value) => !(value.objectId && value.target), {
    message: "Use either objectId or target, not both.",
  });
const rotateSchema = z
  .object({
    ...realtimeObjectTargetFields,
    direction: z.enum(["clockwise", "counterclockwise"]),
  })
  .strict()
  .refine((value) => !(value.objectId && value.target), {
    message: "Use either objectId or target, not both.",
  });
const moveSelectedSchema = z
  .object({
    ...realtimeObjectTargetFields,
    x: coordinateSchema.optional(),
    y: coordinateSchema.optional(),
  })
  .strict()
  .refine((value) => !(value.objectId && value.target), {
    message: "Use either objectId or target, not both.",
  })
  .refine((value) => value.x !== undefined || value.y !== undefined);
const resizeSelectedSchema = z
  .object({
    ...realtimeObjectTargetFields,
    width: z.number().finite().min(160).max(2_000).optional(),
    height: z.number().finite().min(80).max(1_400).optional(),
  })
  .strict()
  .refine((value) => !(value.objectId && value.target), {
    message: "Use either objectId or target, not both.",
  })
  .refine((value) => value.width !== undefined || value.height !== undefined);

export interface RealtimeCapabilityAlias {
  name: string;
  capability: CanvasCapabilityName;
  description: string;
  inputSchema: z.ZodType;
  normalize: (input: unknown) => unknown;
  localSession?: "start_thought" | "finish_thought";
}

function alias(
  name: string,
  capability: CanvasCapabilityName,
  description: string,
  inputSchema: z.ZodType,
  normalize: (input: unknown) => unknown = (input) => input,
  localSession?: RealtimeCapabilityAlias["localSession"],
): RealtimeCapabilityAlias {
  return {
    name,
    capability,
    description,
    inputSchema,
    normalize,
    ...(localSession ? { localSession } : {}),
  };
}

export const REALTIME_CAPABILITY_ALIASES = [
  alias(
    "inspect_canvas",
    "get_canvas_state",
    "Read the bounded semantic canvas selection or object list. Use once when resolving this or that, or when the user asks what is on the canvas.",
    z
      .object({
        scope: z.enum(["selected", "all"]).default("selected"),
        includeReceipts: z.boolean().default(false),
      })
      .strict(),
  ),
  alias(
    "create_semantic_object",
    "create_object",
    "Advanced compatibility tool for a caller that already has one fully specified semantic canvas object, including spatial geometry. Prefer the compact type-specific creation tools for ordinary spoken requests.",
    z.object({ object: newCanvasObjectSchema }).strict(),
    (input) => input,
  ),
  alias(
    "create_note",
    "create_object",
    "Create one note card with its requested title and initial text in the same mutation. Use for a standalone note or static thought, never as a substitute for a requested chart or diagram. Use start_thought instead when the user wants continuing speech-to-text inside the new card.",
    compactCreateNoteSchema,
    (input) => {
      const note = input as { title?: string; text?: string };
      return {
        type: "note",
        ...(note.title ? { title: note.title } : {}),
        ...(note.text ? { text: note.text } : {}),
      };
    },
  ),
  alias(
    "create_board",
    "create_object",
    "Create a project or task board in the current canvas viewport. If the user does not specify a title or columns, call this tool with an empty object; CommandCanvas creates an empty Project board with Next, In progress, and Done columns. Preserve every title, column, task, owner, date, and priority the user does provide.",
    compactBoardSchema,
    (input) => {
      const board = input as z.infer<typeof compactBoardSchema>;
      return {
        type: "task_board",
        title: board.title ?? "Project board",
        columns: board.columns ?? [
          { title: "Next", tasks: [] },
          { title: "In progress", tasks: [] },
          { title: "Done", tasks: [] },
        ],
      };
    },
  ),
  alias(
    "create_schedule",
    "create_object",
    "Create a schedule or calendar in the current canvas viewport. Preserve the requested title, timezone, dates, commitments, times, and owners.",
    compactScheduleSchema,
    (input) => ({ type: "schedule", ...(input as object) }),
  ),
  alias(
    "create_diagram",
    "create_object",
    "Create a structured architecture diagram, flowchart, or general node diagram only when the user asks for that family. Supply semantic nodes and edges; CommandCanvas assigns spatial geometry. Never use this as a generic fallback for another requested object family.",
    compactDiagramSchema,
    (input) => ({ type: "diagram", ...(input as object) }),
  ),
  alias(
    "create_chart",
    "create_object",
    "Create a pie, bar, or line chart only when the user asks for a chart or numeric graph. CommandCanvas assigns spatial geometry and internal IDs. Never use this as a generic fallback for another requested object family.",
    compactChartSchema,
    (input) => ({ type: "chart", ...(input as object) }),
  ),
  alias(
    "create_data_table",
    "create_object",
    "Create a structured data table from labeled columns and row values. CommandCanvas assigns spatial geometry and internal IDs.",
    compactTableSchema,
    (input) => ({ type: "data_table", ...(input as object) }),
  ),
  alias(
    "create_reference_card",
    "create_object",
    "Create an article, document, image, or link reference card from information already present in the conversation. An image or document reference is metadata and supplied context, not generated media or a fetched document. This tool does not browse or retrieve a URL.",
    compactReferenceSchema,
    (input) => ({ type: "reference_card", ...(input as object) }),
  ),
  alias(
    "create_meeting_card",
    "create_object",
    "Create a decision, action item, summary, risk, or open-question card from the user's spoken content.",
    compactMeetingCardSchema,
    (input) => ({ type: "meeting_card", ...(input as object) }),
  ),
  alias(
    "append_selected_note",
    "update_object_content",
    "Append the user's dictated text to a note or thought card. For the note just created, use its objectId from the creation result or omit the target while it remains selected. For a named note, provide its exact title as target; CommandCanvas refuses ambiguous titles instead of guessing. Inspect the selected object first only when the user says this or that.",
    appendSelectedSchema,
  ),
  alias(
    "start_thought",
    "create_object",
    "Create and select one thought card, then start automatic speech-to-text capture inside that card.",
    emptySchema,
    () => ({ type: "note", title: "New thought", tone: "coral" }),
    "start_thought",
  ),
  alias(
    "finish_thought",
    "get_canvas_state",
    "Stop automatic speech-to-text capture for the active thought card.",
    emptySchema,
    () => ({ scope: "selected" }),
    "finish_thought",
  ),
  alias(
    "open_sketch",
    "control_workspace",
    "Start a tracked-hand drawing when hand input is ready, otherwise open the pointer, touch, and stylus drawing surface.",
    emptySchema,
    () => ({ action: "start_drawing" }),
  ),
  alias(
    "finish_sketch",
    "control_workspace",
    "Finish the current tracked-hand sketch and preserve it as one selectable canvas object.",
    emptySchema,
    () => ({ action: "finish_drawing" }),
  ),
  alias(
    "cancel_sketch",
    "control_workspace",
    "Cancel the current unfinished drawing without creating a canvas object.",
    emptySchema,
    () => ({ action: "cancel_drawing" }),
  ),
  alias(
    "transform_selected_sketch",
    "transform_sketch",
    "Turn the currently selected sketch into a clean supported structured visual while preserving the original. Preserve an explicitly requested architecture, flowchart, diagram, pie-chart, bar-chart, or line-chart outputKind; omit it only when the user leaves the family open.",
    transformSelectedSketchSchema,
    (input) => {
      const transform = input as z.infer<typeof transformSelectedSketchSchema>;
      return {
        instruction: transform.instruction ?? "Make that usable.",
        ...(transform.outputKind ? { outputKind: transform.outputKind } : {}),
      };
    },
  ),
  alias(
    "pin_selected",
    "set_object_state",
    "Pin an object by stable ID, exact title, or current selection.",
    realtimeObjectTargetSchema,
    (input) => ({ ...(input as object), state: { pinned: true } }),
  ),
  alias(
    "unpin_selected",
    "set_object_state",
    "Unpin an object by stable ID, exact title, or current selection.",
    realtimeObjectTargetSchema,
    (input) => ({ ...(input as object), state: { pinned: false } }),
  ),
  alias(
    "minimize_selected",
    "set_object_state",
    "Minimize an object by stable ID, exact title, or current selection into its compact chip.",
    realtimeObjectTargetSchema,
    (input) => ({ ...(input as object), state: { minimized: true } }),
  ),
  alias(
    "restore_selected",
    "set_object_state",
    "Restore a minimized object by stable ID, exact title, or current selection.",
    realtimeObjectTargetSchema,
    (input) => ({ ...(input as object), state: { minimized: false } }),
  ),
  alias(
    "discard_selected",
    "discard_object",
    "Move an object identified by stable ID, exact title, or current selection to recoverable trash. The mutation is receipted and can be undone.",
    realtimeObjectTargetSchema,
  ),
  alias(
    "undo",
    "history_action",
    "Undo the latest reversible canvas mutation.",
    emptySchema,
    () => ({ action: "undo" }),
  ),
  alias(
    "redo",
    "history_action",
    "Redo the latest canvas mutation that was undone.",
    emptySchema,
    () => ({ action: "redo" }),
  ),
  alias(
    "focus_selected",
    "control_workspace",
    "Maximize the selected object in the local viewport without changing shared object state.",
    emptySchema,
    () => ({ action: "focus_selected" }),
  ),
  alias(
    "group_selected",
    "organize_objects",
    "Group the currently multi-selected objects into one semantic frame.",
    emptySchema,
    () => ({ action: "group_selected" }),
  ),
  alias(
    "ungroup_selected",
    "organize_objects",
    "Ungroup the selected semantic frame and keep its child objects.",
    emptySchema,
    () => ({ action: "ungroup_selected" }),
  ),
  alias(
    "rotate_selected",
    "transform_object",
    "Rotate an object identified by stable ID, exact title, or current selection by 15 degrees clockwise or counterclockwise.",
    rotateSchema,
    (input) => {
      const { direction, ...target } = input as z.infer<typeof rotateSchema>;
      return { ...target, rotateDirection: direction };
    },
  ),
  alias(
    "move_selected_object",
    "transform_object",
    "Move an object identified by stable ID, exact title, or current selection to bounded world coordinates.",
    moveSelectedSchema,
    (input) => {
      const { objectId, target, ...transform } = input as z.infer<
        typeof moveSelectedSchema
      >;
      return {
        ...(objectId ? { objectId } : {}),
        ...(target ? { target } : {}),
        transform,
      };
    },
  ),
  alias(
    "resize_selected_object",
    "transform_object",
    "Resize an object identified by stable ID, exact title, or current selection to bounded world dimensions.",
    resizeSelectedSchema,
    (input) => {
      const { objectId, target, ...transform } = input as z.infer<
        typeof resizeSelectedSchema
      >;
      return {
        ...(objectId ? { objectId } : {}),
        ...(target ? { target } : {}),
        transform,
      };
    },
  ),
  alias(
    "prepare_meeting_packet",
    "prepare_meeting_packet",
    CANVAS_CAPABILITY_CATALOG.prepare_meeting_packet.description,
    CANVAS_CAPABILITY_INPUT_SCHEMAS.prepare_meeting_packet,
  ),
  alias(
    "request_packet_send",
    "request_packet_send",
    CANVAS_CAPABILITY_CATALOG.request_packet_send.description,
    CANVAS_CAPABILITY_INPUT_SCHEMAS.request_packet_send,
  ),
  alias(
    "control_workspace",
    "control_workspace",
    CANVAS_CAPABILITY_CATALOG.control_workspace.description,
    CANVAS_CAPABILITY_INPUT_SCHEMAS.control_workspace,
  ),
] as const satisfies readonly RealtimeCapabilityAlias[];

export function projectRealtimeCapabilityTools() {
  return REALTIME_CAPABILITY_ALIASES.map((definition) => {
    const generated = z.toJSONSchema(definition.inputSchema) as {
      type: "object";
      properties: Record<string, unknown>;
      required?: readonly string[];
      additionalProperties: false;
    };
    return {
      type: "function" as const,
      name: definition.name,
      description: definition.description,
      parameters: {
        ...generated,
        required: generated.required ?? [],
      },
    };
  });
}
