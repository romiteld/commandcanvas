export const WEBMCP_TOOL_NAMES = [
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
] as const;

export type WebMcpToolName = (typeof WEBMCP_TOOL_NAMES)[number];

export type WebMcpPhase =
  | "no_room"
  | "room_active"
  | "content_exists"
  | "selection_active"
  | "collaboration_active"
  | "packet_prepared"
  | "packet_approved";

export interface WebMcpPhaseState {
  roomActive: boolean;
  hasContent: boolean;
  selection: "none" | "object" | "sketch";
  collaboratorCount: number;
  packet: "none" | "prepared" | "approved";
}

export interface WebMcpExecutionContext {
  phase: WebMcpPhaseState;
  actor: {
    participantId: string;
    role: "host" | "participant";
  } | null;
  canMutateCanvas: boolean;
}

export type WebMcpGuardResult =
  | { ok: true }
  | {
      ok: false;
      code: "not_available" | "unauthorized" | "forbidden";
      message: string;
    };

/**
 * Each row unlocks tools when that phase becomes active. Phases accumulate;
 * they are capabilities of one live room, not mutually exclusive screens.
 */
export const WEBMCP_PHASE_TOOL_MATRIX = {
  no_room: [],
  room_active: ["get_canvas_state", "create_object", "history_action"],
  content_exists: [
    "update_object_content",
    "transform_object",
    "set_object_state",
    "discard_object",
    "organize_objects",
    "prepare_meeting_packet",
  ],
  selection_active: ["transform_sketch"],
  collaboration_active: [],
  packet_prepared: [],
  packet_approved: ["request_packet_send"],
} as const satisfies Record<WebMcpPhase, readonly WebMcpToolName[]>;

const PHASE_REQUIRED_BY_TOOL: Record<WebMcpToolName, WebMcpPhase> = {
  get_canvas_state: "room_active",
  create_object: "room_active",
  update_object_content: "content_exists",
  transform_object: "content_exists",
  set_object_state: "content_exists",
  discard_object: "content_exists",
  organize_objects: "content_exists",
  history_action: "room_active",
  transform_sketch: "selection_active",
  prepare_meeting_packet: "content_exists",
  request_packet_send: "packet_approved",
};

export function deriveActivePhases(state: WebMcpPhaseState): WebMcpPhase[] {
  if (!state.roomActive) return ["no_room"];

  const phases: WebMcpPhase[] = ["room_active"];
  if (state.hasContent) phases.push("content_exists");
  if (state.hasContent && state.selection !== "none")
    phases.push("selection_active");
  if (state.collaboratorCount > 1) phases.push("collaboration_active");
  if (state.packet !== "none") phases.push("packet_prepared");
  if (state.packet === "approved") phases.push("packet_approved");
  return phases;
}

export function getPhaseAvailableToolNames(
  state: WebMcpPhaseState,
): WebMcpToolName[] {
  return WEBMCP_TOOL_NAMES.filter(
    (toolName) => evaluateToolPhaseGuard(toolName, state).ok,
  );
}

export function evaluateToolGuard(
  toolName: WebMcpToolName,
  context: WebMcpExecutionContext,
): WebMcpGuardResult {
  const phaseGuard = evaluateToolPhaseGuard(toolName, context.phase);
  if (!phaseGuard.ok) return phaseGuard;

  if (!context.actor)
    return {
      ok: false,
      code: "unauthorized",
      message: "authorization required: join the room before using canvas tools",
    };

  if (
    toolName !== "get_canvas_state" &&
    toolName !== "prepare_meeting_packet" &&
    toolName !== "request_packet_send" &&
    !context.canMutateCanvas
  )
    return {
      ok: false,
      code: "forbidden",
      message: "mutation not authorized: this participant can only view the room",
    };

  if (
    toolName === "prepare_meeting_packet" &&
    context.actor.role !== "host"
  )
    return {
      ok: false,
      code: "forbidden",
      message:
        "host authorization required: only the host can prepare a meeting packet",
    };

  if (toolName === "request_packet_send" && context.actor.role !== "host")
    return {
      ok: false,
      code: "forbidden",
      message:
        "host authorization required: only the host can request packet delivery",
    };

  return { ok: true };
}

export function evaluateToolPhaseGuard(
  toolName: WebMcpToolName,
  state: WebMcpPhaseState,
): WebMcpGuardResult {
  if (!state.roomActive)
    return {
      ok: false,
      code: "not_available",
      message: "not available yet: create or join a room first",
    };

  const requiredPhase = PHASE_REQUIRED_BY_TOOL[toolName];
  if (requiredPhase === "content_exists" && !state.hasContent)
    return {
      ok: false,
      code: "not_available",
      message: "not available yet: add canvas content first",
    };

  if (requiredPhase === "selection_active") {
    if (!state.hasContent)
      return {
        ok: false,
        code: "not_available",
        message: "not available yet: add canvas content first",
      };
    if (state.selection !== "sketch")
      return {
        ok: false,
        code: "not_available",
        message: "not available yet: select a sketch first",
      };
  }

  if (requiredPhase === "packet_approved" && state.packet !== "approved")
    return {
      ok: false,
      code: "not_available",
      message:
        "not available yet: approve the meeting packet before requesting a send",
    };

  return { ok: true };
}
