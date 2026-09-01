import { z } from "zod";

import { NOTE_APPEND_TEXT_MAX_LENGTH } from "@/lib/canvas/object-model";
import { semanticCanvasObjectInputSchema } from "@/lib/canvas/semantic-object";
import { sketchTransformOutputKindSchema } from "@/lib/vision/diagram-transform";
import type { WebMcpToolName } from "@/lib/webmcp/phase-guards";

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface WebMcpCompletedResult {
  ok: true;
  status: "completed";
  message: string;
  data?: JsonValue;
  receiptId?: string;
}

export interface WebMcpAwaitingApprovalResult {
  ok: true;
  status: "awaiting_human_approval";
  message: string;
  data?: JsonValue;
  receiptId?: string;
}

export interface WebMcpToolFailure {
  ok: false;
  code:
    | "not_available"
    | "unauthorized"
    | "forbidden"
    | "invalid_input"
    | "execution_failed";
  message: string;
}

export type WebMcpToolResult =
  | WebMcpCompletedResult
  | WebMcpAwaitingApprovalResult
  | WebMcpToolFailure;

const objectIdSchema = z
  .string()
  .min(2)
  .max(96)
  .regex(/^[a-z][a-z0-9-]*$/);

const coordinateSchema = z.number().finite().min(-1_000_000).max(1_000_000);
const rotationSchema = z.number().finite().min(-180).max(180);
const titleSchema = z.string().trim().min(1).max(120);
const zIndexSchema = z.number().int().min(0).max(100_000);

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
  .object({
    minimized: z.boolean().optional(),
    pinned: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0);

export const WEBMCP_TOOL_INPUT_SCHEMAS = {
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
      transform: spatialTransformSchema,
    })
    .strict(),
  set_object_state: z
    .object({
      objectId: objectIdSchema,
      state: objectStateSchema,
    })
    .strict(),
  discard_object: z.object({ objectId: objectIdSchema }).strict(),
  organize_objects: z.discriminatedUnion("action", [
    z
      .object({
        action: z.literal("group"),
        objectIds: z
          .array(objectIdSchema)
          .min(1)
          .max(20)
          .refine((ids) => new Set(ids).size === ids.length),
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
      .strict(),
    z
      .object({
        action: z.literal("ungroup"),
        frameId: objectIdSchema,
      })
      .strict(),
  ]),
  history_action: z
    .object({ action: z.enum(["undo", "redo"]) })
    .strict(),
  transform_sketch: z
    .object({
      sketchId: objectIdSchema,
      instruction: z.string().trim().min(1).max(500),
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
} as const satisfies Record<WebMcpToolName, z.ZodType>;

export type WebMcpToolInputMap = {
  [Name in WebMcpToolName]: z.infer<
    (typeof WEBMCP_TOOL_INPUT_SCHEMAS)[Name]
  >;
};

export type WebMcpToolInput<Name extends WebMcpToolName> =
  WebMcpToolInputMap[Name];

export interface WebMcpToolCatalogEntry {
  description: string;
  inputSchema: z.ZodType;
  annotations: {
    readOnlyHint: boolean;
    untrustedContentHint: boolean;
  };
  humanApproval: "not_required" | "required_after_staging";
}

export const WEBMCP_TOOL_CATALOG = {
  get_canvas_state: {
    description:
      "Read a compact semantic projection of the live canvas, current selection, and recent activity receipts without changing the room. Call this with scope selected before acting when the user says this, that, or the selected object; use the returned stable object ID in the next tool call.",
    inputSchema: WEBMCP_TOOL_INPUT_SCHEMAS.get_canvas_state,
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    humanApproval: "not_required",
  },
  create_object: {
    description:
      "Create one note, task board, schedule, diagram, chart, data table, reference card, decision, action item, summary, risk, or open-question card from compact semantic content. CommandCanvas assigns safe IDs, geometry, z-order, and nested IDs, so use this directly for ordinary creation requests without reading the canvas first. To create a visual from the user's spoken explanation of a selected sketch without image inference, first read the selected state, pass its ID as sourceSketchId, and CommandCanvas will preserve the sketch and place the linked visual beside it.",
    inputSchema: WEBMCP_TOOL_INPUT_SCHEMAS.create_object,
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    humanApproval: "not_required",
  },
  update_object_content: {
    description:
      "Append bounded text to one active note or thought through the versioned mutation pipeline. Provide a stable objectId, or omit it only after get_canvas_state with scope selected confirms the intended note; this cannot replace content or apply arbitrary JSON patches.",
    inputSchema: WEBMCP_TOOL_INPUT_SCHEMAS.update_object_content,
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    humanApproval: "not_required",
  },
  transform_object: {
    description:
      "Move, resize, or rotate one existing, unpinned canvas object through the canonical mutation pipeline. When the user says this or that, first read the selected canvas state and then use that stable object ID.",
    inputSchema: WEBMCP_TOOL_INPUT_SCHEMAS.transform_object,
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    humanApproval: "not_required",
  },
  set_object_state: {
    description:
      "Pin, unpin, minimize, or restore one existing canvas object and record the resulting receipt. Resolve this, that, or selected through get_canvas_state before using its stable object ID.",
    inputSchema: WEBMCP_TOOL_INPUT_SCHEMAS.set_object_state,
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    humanApproval: "not_required",
  },
  discard_object: {
    description:
      "Move one explicit canvas object to recoverable trash; this never performs permanent deletion. Resolve this, that, or selected through get_canvas_state before using its stable object ID.",
    inputSchema: WEBMCP_TOOL_INPUT_SCHEMAS.discard_object,
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    humanApproval: "not_required",
  },
  organize_objects: {
    description:
      "Group explicit canvas objects inside a semantic frame, or ungroup an existing frame, through one reversible mutation.",
    inputSchema: WEBMCP_TOOL_INPUT_SCHEMAS.organize_objects,
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    humanApproval: "not_required",
  },
  history_action: {
    description:
      "Undo or redo the latest reversible shared canvas mutation and record an attributable history receipt.",
    inputSchema: WEBMCP_TOOL_INPUT_SCHEMAS.history_action,
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    humanApproval: "not_required",
  },
  transform_sketch: {
    description:
      "Interpret a selected sketch into a new structured diagram or chart beside it while preserving the source sketch. Omit outputKind or use auto when the image, narration, and instruction should determine the concrete visual family.",
    inputSchema: WEBMCP_TOOL_INPUT_SCHEMAS.transform_sketch,
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    humanApproval: "not_required",
  },
  prepare_meeting_packet: {
    description:
      "Create or refresh a reviewable meeting-packet draft from current semantic canvas objects; this does not approve or send it.",
    inputSchema: WEBMCP_TOOL_INPUT_SCHEMAS.prepare_meeting_packet,
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    humanApproval: "not_required",
  },
  request_packet_send: {
    description:
      "Stage an approved meeting packet for explicit host confirmation. This tool never sends email by itself and cannot override the approved recipient snapshot.",
    inputSchema: WEBMCP_TOOL_INPUT_SCHEMAS.request_packet_send,
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    humanApproval: "required_after_staging",
  },
} as const satisfies Record<WebMcpToolName, WebMcpToolCatalogEntry>;
