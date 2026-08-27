import { z } from "zod";

import { newCanvasObjectSchema } from "@/lib/canvas/object-model";
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

const spatialTransformSchema = z
  .object({
    x: coordinateSchema.optional(),
    y: coordinateSchema.optional(),
    width: z.number().finite().min(160).max(2_000).optional(),
    height: z.number().finite().min(80).max(1_400).optional(),
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
  create_object: z.object({ object: newCanvasObjectSchema }).strict(),
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
  transform_sketch: z
    .object({
      sketchId: objectIdSchema,
      instruction: z.string().trim().min(1).max(500),
      outputKind: z.enum(["architecture", "flowchart"]).optional(),
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
      "Read a compact semantic projection of the live canvas, selection, and recent activity receipts without changing the room.",
    inputSchema: WEBMCP_TOOL_INPUT_SCHEMAS.get_canvas_state,
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    humanApproval: "not_required",
  },
  create_object: {
    description:
      "Create one validated semantic canvas object at explicit world coordinates and record an attributable receipt.",
    inputSchema: WEBMCP_TOOL_INPUT_SCHEMAS.create_object,
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    humanApproval: "not_required",
  },
  transform_object: {
    description:
      "Move or resize one existing, unpinned canvas object through the canonical mutation pipeline.",
    inputSchema: WEBMCP_TOOL_INPUT_SCHEMAS.transform_object,
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    humanApproval: "not_required",
  },
  set_object_state: {
    description:
      "Pin, unpin, minimize, or restore one existing canvas object and record the resulting receipt.",
    inputSchema: WEBMCP_TOOL_INPUT_SCHEMAS.set_object_state,
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    humanApproval: "not_required",
  },
  discard_object: {
    description:
      "Move one canvas object to recoverable trash; this never performs permanent deletion.",
    inputSchema: WEBMCP_TOOL_INPUT_SCHEMAS.discard_object,
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    humanApproval: "not_required",
  },
  transform_sketch: {
    description:
      "Interpret a selected sketch into a new structured diagram beside it while preserving the source sketch.",
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
