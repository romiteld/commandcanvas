import { describe, expect, it } from "vitest";

import {
  WEBMCP_TOOL_CATALOG,
  WEBMCP_TOOL_INPUT_SCHEMAS,
} from "@/lib/webmcp/tool-catalog";

describe("WebMCP live canvas state contract", () => {
  it("describes only state that the read adapter actually returns", () => {
    expect(WEBMCP_TOOL_CATALOG.get_canvas_state.description).toBe(
      "Read a compact semantic projection of the live canvas, selection, and recent activity receipts without changing the room.",
    );
  });

  it("marks every tool that can echo a human-controlled object title as untrusted", () => {
    for (const toolName of [
      "create_object",
      "transform_object",
      "set_object_state",
      "discard_object",
      "organize_objects",
      "history_action",
    ] as const) {
      expect(
        WEBMCP_TOOL_CATALOG[toolName].annotations.untrustedContentHint,
        `${toolName} can return a receipt containing an object title`,
      ).toBe(true);
    }
  });

  it("accepts a bounded rotation and rejects values outside the canonical canvas range", () => {
    expect(
      WEBMCP_TOOL_INPUT_SCHEMAS.transform_object.safeParse({
        objectId: "note-launch",
        transform: { rotation: 180 },
      }).success,
    ).toBe(true);
    expect(
      WEBMCP_TOOL_INPUT_SCHEMAS.transform_object.safeParse({
        objectId: "note-launch",
        transform: { rotation: 180.01 },
      }).success,
    ).toBe(false);
  });

  it("validates the two organization operations without accepting mixed branch fields", () => {
    const frame = {
      id: "frame-launch",
      title: "Launch plan",
      x: 20,
      y: 40,
      width: 900,
      height: 620,
      zIndex: 1,
      tone: "violet" as const,
    };

    expect(
      WEBMCP_TOOL_INPUT_SCHEMAS.organize_objects.safeParse({
        action: "group",
        objectIds: ["note-launch", "board-launch"],
        frame,
      }).success,
    ).toBe(true);
    expect(
      WEBMCP_TOOL_INPUT_SCHEMAS.organize_objects.safeParse({
        action: "ungroup",
        frameId: "frame-launch",
      }).success,
    ).toBe(true);
    expect(
      WEBMCP_TOOL_INPUT_SCHEMAS.organize_objects.safeParse({
        action: "ungroup",
        frameId: "frame-launch",
        objectIds: ["note-launch"],
      }).success,
    ).toBe(false);
  });

  it("limits history actions to canonical undo and redo operations", () => {
    expect(
      WEBMCP_TOOL_INPUT_SCHEMAS.history_action.safeParse({ action: "undo" })
        .success,
    ).toBe(true);
    expect(
      WEBMCP_TOOL_INPUT_SCHEMAS.history_action.safeParse({ action: "redo" })
        .success,
    ).toBe(true);
    expect(
      WEBMCP_TOOL_INPUT_SCHEMAS.history_action.safeParse({ action: "reset" })
        .success,
    ).toBe(false);
  });
});

describe("WebMCP packet preparation schema", () => {
  it("matches the durable 50-object limit", () => {
    const fifty = Array.from({ length: 50 }, (_, index) => `note-${index}`);
    const fiftyOne = [...fifty, "note-50"];

    expect(
      WEBMCP_TOOL_INPUT_SCHEMAS.prepare_meeting_packet.safeParse({
        objectIds: fifty,
      }).success,
    ).toBe(true);
    expect(
      WEBMCP_TOOL_INPUT_SCHEMAS.prepare_meeting_packet.safeParse({
        objectIds: fiftyOne,
      }).success,
    ).toBe(false);
  });

  it("rejects duplicate selected objects before invoking the database", () => {
    expect(
      WEBMCP_TOOL_INPUT_SCHEMAS.prepare_meeting_packet.safeParse({
        objectIds: ["note-launch", "note-launch"],
      }).success,
    ).toBe(false);
  });
});
