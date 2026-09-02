import { describe, expect, it } from "vitest";

import {
  deriveActivePhases,
  evaluateToolGuard,
  getPhaseAvailableToolNames,
  type WebMcpExecutionContext,
  type WebMcpPhaseState,
} from "@/lib/webmcp/phase-guards";

const noRoom: WebMcpPhaseState = {
  roomActive: false,
  hasContent: false,
  selection: "none",
  collaboratorCount: 0,
  packet: "none",
};

const activeRoom: WebMcpPhaseState = {
  roomActive: true,
  hasContent: false,
  selection: "none",
  collaboratorCount: 1,
  packet: "none",
};

function context(
  phase: WebMcpPhaseState,
  overrides: Partial<WebMcpExecutionContext> = {},
): WebMcpExecutionContext {
  return {
    phase,
    actor: { participantId: "participant-host", role: "host" },
    canMutateCanvas: true,
    ...overrides,
  };
}

describe("WebMCP phase availability", () => {
  it("keeps every room tool unavailable until a room is active", () => {
    expect(deriveActivePhases(noRoom)).toEqual(["no_room"]);
    expect(getPhaseAvailableToolNames(noRoom)).toEqual([]);
  });

  it("registers only read and creation tools for an empty active room", () => {
    expect(deriveActivePhases(activeRoom)).toEqual(["room_active"]);
    expect(getPhaseAvailableToolNames(activeRoom)).toEqual([
      "get_canvas_state",
      "create_object",
      "history_action",
      "control_workspace",
    ]);
  });

  it("unlocks content, selected-sketch, collaboration, and approved-packet phases cumulatively", () => {
    const phase: WebMcpPhaseState = {
      roomActive: true,
      hasContent: true,
      selection: "sketch",
      collaboratorCount: 2,
      packet: "approved",
    };

    expect(deriveActivePhases(phase)).toEqual([
      "room_active",
      "content_exists",
      "selection_active",
      "collaboration_active",
      "packet_prepared",
      "packet_approved",
    ]);
    expect(getPhaseAvailableToolNames(phase)).toEqual([
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
    ]);
  });
});

describe("evaluateToolGuard", () => {
  it("returns the room prerequisite before authorization details", () => {
    expect(
      evaluateToolGuard("create_object", context(noRoom, { actor: null })),
    ).toEqual({
      ok: false,
      code: "not_available",
      message: "not available yet: create or join a room first",
    });
  });

  it("requires an authenticated room participant for live canvas reads", () => {
    expect(
      evaluateToolGuard(
        "get_canvas_state",
        context(activeRoom, { actor: null, canMutateCanvas: false }),
      ),
    ).toEqual({
      ok: false,
      code: "unauthorized",
      message: "authorization required: join the room before using canvas tools",
    });
  });

  it("allows a room participant with mutation permission to create objects", () => {
    expect(
      evaluateToolGuard(
        "create_object",
        context(activeRoom, {
          actor: { participantId: "participant-2", role: "participant" },
        }),
      ),
    ).toEqual({ ok: true });
  });

  it("keeps packet preparation host-only even when a participant may mutate the canvas", () => {
    const contentRoom: WebMcpPhaseState = {
      ...activeRoom,
      hasContent: true,
    };

    expect(
      evaluateToolGuard(
        "prepare_meeting_packet",
        context(contentRoom, {
          actor: { participantId: "participant-2", role: "participant" },
          canMutateCanvas: true,
        }),
      ),
    ).toEqual({
      ok: false,
      code: "forbidden",
      message:
        "host authorization required: only the host can prepare a meeting packet",
    });
  });

  it("keeps object and sketch operations behind their exact content prerequisites", () => {
    const contentWithoutSketch: WebMcpPhaseState = {
      ...activeRoom,
      hasContent: true,
      selection: "object",
    };

    expect(evaluateToolGuard("transform_object", context(activeRoom))).toEqual({
      ok: false,
      code: "not_available",
      message: "not available yet: add canvas content first",
    });
    expect(
      evaluateToolGuard("transform_sketch", context(contentWithoutSketch)),
    ).toEqual({
      ok: false,
      code: "not_available",
      message: "not available yet: select a sketch first",
    });
    expect(evaluateToolGuard("organize_objects", context(activeRoom))).toEqual({
      ok: false,
      code: "not_available",
      message: "not available yet: add canvas content first",
    });
    expect(evaluateToolGuard("history_action", context(activeRoom))).toEqual({
      ok: true,
    });
  });

  it("rejects mutation tools for participants without mutation permission", () => {
    expect(
      evaluateToolGuard(
        "create_object",
        context(activeRoom, { canMutateCanvas: false }),
      ),
    ).toEqual({
      ok: false,
      code: "forbidden",
      message: "mutation not authorized: this participant can only view the room",
    });
  });

  it("requires both an approved packet and host authorization before staging a send", () => {
    const prepared: WebMcpPhaseState = {
      ...activeRoom,
      hasContent: true,
      packet: "prepared",
    };
    const approved: WebMcpPhaseState = { ...prepared, packet: "approved" };

    expect(evaluateToolGuard("request_packet_send", context(prepared))).toEqual({
      ok: false,
      code: "not_available",
      message:
        "not available yet: approve the meeting packet before requesting a send",
    });
    expect(
      evaluateToolGuard(
        "request_packet_send",
        context(approved, {
          actor: { participantId: "participant-2", role: "participant" },
        }),
      ),
    ).toEqual({
      ok: false,
      code: "forbidden",
      message:
        "host authorization required: only the host can request packet delivery",
    });
  });
});
