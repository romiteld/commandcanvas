import type { z } from "zod";

import {
  CANVAS_CAPABILITY_INPUT_SCHEMAS,
  projectWebMcpCapabilityCatalog,
  type CanvasCapabilityInput,
  type CanvasCapabilityInputMap,
} from "@/lib/canvas/capability-catalog";
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

export const WEBMCP_TOOL_INPUT_SCHEMAS = CANVAS_CAPABILITY_INPUT_SCHEMAS;

export type WebMcpToolInputMap = CanvasCapabilityInputMap;
export type WebMcpToolInput<Name extends WebMcpToolName> =
  CanvasCapabilityInput<Name>;

export interface WebMcpToolCatalogEntry {
  description: string;
  inputSchema: z.ZodType;
  annotations: {
    readOnlyHint: boolean;
    untrustedContentHint: boolean;
  };
  humanApproval: "not_required" | "required_after_staging";
}

export const WEBMCP_TOOL_CATALOG = projectWebMcpCapabilityCatalog();
