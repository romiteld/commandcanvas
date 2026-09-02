import {
  CANVAS_CAPABILITY_NAMES,
  evaluateCanvasCapabilityGuard,
  evaluateCanvasCapabilityPhaseGuard,
  type CanvasCapabilityExecutionContext,
  type CanvasCapabilityGuardResult,
  type CanvasCapabilityName,
  type CanvasCapabilityPhase,
  type CanvasCapabilityPhaseState,
} from "@/lib/canvas/capability-catalog";

export const WEBMCP_TOOL_NAMES = CANVAS_CAPABILITY_NAMES;
export type WebMcpToolName = CanvasCapabilityName;
export type WebMcpPhase = CanvasCapabilityPhase;
export type WebMcpPhaseState = CanvasCapabilityPhaseState;
export type WebMcpExecutionContext = CanvasCapabilityExecutionContext;
export type WebMcpGuardResult = CanvasCapabilityGuardResult;

/**
 * Each row unlocks tools when that phase becomes active. Phases accumulate;
 * they are capabilities of one live room, not mutually exclusive screens.
 */
export const WEBMCP_PHASE_TOOL_MATRIX = {
  no_room: [],
  room_active: [
    "get_canvas_state",
    "create_object",
    "history_action",
    "control_workspace",
  ],
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
    (toolName) => evaluateCanvasCapabilityPhaseGuard(toolName, state).ok,
  );
}

export const evaluateToolGuard = evaluateCanvasCapabilityGuard;
export const evaluateToolPhaseGuard = evaluateCanvasCapabilityPhaseGuard;
