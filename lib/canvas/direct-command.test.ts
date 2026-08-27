import { describe, expect, it } from "vitest";

import { parseDirectCanvasCommand } from "@/lib/canvas/direct-command";

describe("parseDirectCanvasCommand", () => {
  it.each([
    ["Bring in our project board", { type: "create_board" }],
    ["Put next week's schedule over here", { type: "create_schedule" }],
    ["start a rough sketch", { type: "open_sketch" }],
    ["make that usable", { type: "transform_selected_sketch" }],
    ["make this rough sketch usable", { type: "transform_selected_sketch" }],
    ["make this sketch professional", { type: "transform_selected_sketch" }],
    ["pin this", { type: "pin_selected" }],
    ["unpin that object", { type: "unpin_selected" }],
    ["minimize it", { type: "minimize_selected" }],
    ["restore that", { type: "restore_selected" }],
    ["get rid of that", { type: "discard_selected" }],
    ["undo that", { type: "undo" }],
  ] as const)("parses %s into one bounded intent", (transcript, expected) => {
    expect(parseDirectCanvasCommand(transcript)).toEqual({
      ok: true,
      intent: expected,
    });
  });

  it("preserves bounded note content without treating it as authority", () => {
    expect(
      parseDirectCanvasCommand(
        "Make a note: Confirm the launch date with Sarah on Friday",
      ),
    ).toEqual({
      ok: true,
      intent: {
        type: "create_note",
        text: "Confirm the launch date with Sarah on Friday",
      },
    });
  });

  it("refuses empty, oversized, ambiguous, and unsupported language", () => {
    expect(parseDirectCanvasCommand("   ")).toEqual({
      ok: false,
      code: "empty_command",
      message: "Enter a command first.",
    });
    expect(parseDirectCanvasCommand("x".repeat(281))).toEqual({
      ok: false,
      code: "command_too_long",
      message: "Keep direct commands to 280 characters or fewer.",
    });
    expect(parseDirectCanvasCommand("pin this and trash it")).toEqual({
      ok: false,
      code: "ambiguous_command",
      message: "Ask for one direct canvas action at a time.",
    });
    expect(parseDirectCanvasCommand("email everyone now")).toEqual({
      ok: false,
      code: "unsupported_command",
      message:
        "That direct command is not available. Agent and packet actions remain behind WebMCP and explicit site approval.",
    });
  });
});
