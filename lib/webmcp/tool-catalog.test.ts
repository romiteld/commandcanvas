import { describe, expect, it } from "vitest";

import {
  WEBMCP_TOOL_CATALOG,
  WEBMCP_TOOL_INPUT_SCHEMAS,
} from "@/lib/webmcp/tool-catalog";

describe("WebMCP live canvas state contract", () => {
  it("describes only state that the read adapter actually returns", () => {
    expect(WEBMCP_TOOL_CATALOG.get_canvas_state.description).toContain(
      "this, that, or the selected object",
    );
  });

  it("accepts compact semantic creation input and rejects persistence-shaped objects", () => {
    expect(
      WEBMCP_TOOL_INPUT_SCHEMAS.create_object.safeParse({
        type: "note",
        title: "Launch thought",
        text: "Confirm the launch date.",
      }).success,
    ).toBe(true);
    expect(
      WEBMCP_TOOL_INPUT_SCHEMAS.create_object.safeParse({
        object: {
          id: "note-agent",
          type: "note",
          title: "Agent note",
          x: 40,
          y: 80,
          width: 260,
          height: 180,
          zIndex: 4,
          payload: { text: "Internal shape", tone: "sky" },
        },
      }).success,
    ).toBe(false);
  });

  it("accepts bounded append-only note updates by stable ID or current selection", () => {
    expect(
      WEBMCP_TOOL_INPUT_SCHEMAS.update_object_content.safeParse({
        objectId: "note-launch",
        text: "Owner: Sarah",
      }).success,
    ).toBe(true);
    expect(
      WEBMCP_TOOL_INPUT_SCHEMAS.update_object_content.safeParse({
        text: "Append this to the selected thought.",
      }).success,
    ).toBe(true);
    expect(
      WEBMCP_TOOL_INPUT_SCHEMAS.update_object_content.safeParse({
        text: "x".repeat(1_001),
      }).success,
    ).toBe(false);
    expect(
      WEBMCP_TOOL_INPUT_SCHEMAS.update_object_content.safeParse({
        objectId: "note-launch",
        text: "Replace everything",
        operation: "replace",
      }).success,
    ).toBe(false);
  });

  it("marks every tool that can echo a human-controlled object title as untrusted", () => {
    for (const toolName of [
      "create_object",
      "update_object_content",
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

  it.each([
    "auto",
    "architecture",
    "flowchart",
    "diagram",
    "pie_chart",
    "bar_chart",
    "line_chart",
  ] as const)("accepts %s as a bounded sketch transformation kind", (outputKind) => {
    expect(
      WEBMCP_TOOL_INPUT_SCHEMAS.transform_sketch.safeParse({
        sketchId: "sketch-rough",
        instruction: "Make that professional.",
        outputKind,
      }).success,
    ).toBe(true);
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
