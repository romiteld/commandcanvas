import { describe, expect, it, vi } from "vitest";

import {
  REALTIME_VOICE_TOOL_DEFINITIONS,
  executeRealtimeVoiceTool,
} from "@/lib/realtime-voice/tools";

describe("Realtime voice tools", () => {
  it("exposes only the approved reversible canvas vocabulary", () => {
    expect(
      REALTIME_VOICE_TOOL_DEFINITIONS.map((tool) => tool.name),
    ).toEqual([
      "create_note",
      "create_board",
      "create_schedule",
      "open_sketch",
      "transform_selected_sketch",
      "pin_selected",
      "unpin_selected",
      "minimize_selected",
      "restore_selected",
      "undo",
      "redo",
      "focus_selected",
      "group_selected",
      "ungroup_selected",
      "rotate_selected",
    ]);
    expect(
      JSON.stringify(REALTIME_VOICE_TOOL_DEFINITIONS),
    ).not.toMatch(/discard|delete|packet|email|room/i);
  });

  it("maps restored spatial commands to bounded canonical intents", async () => {
    const onIntent = vi.fn(() => ({
      ok: true as const,
      message: "Submitted.",
    }));

    const focused = await executeRealtimeVoiceTool(
      { name: "focus_selected", arguments: "{}" },
      onIntent,
    );
    await executeRealtimeVoiceTool(
      { name: "group_selected", arguments: "{}" },
      onIntent,
    );
    await executeRealtimeVoiceTool(
      {
        name: "rotate_selected",
        arguments: '{"direction":"counterclockwise"}',
      },
      onIntent,
    );

    expect(onIntent).toHaveBeenNthCalledWith(
      1,
      { type: "focus_selected" },
      "voice",
    );
    expect(focused).toMatchObject({
      ok: true,
      outcome: "submitted",
      message: "Local canvas focus applied; shared state did not change.",
    });
    expect(onIntent).toHaveBeenNthCalledWith(
      2,
      { type: "group_selected" },
      "voice",
    );
    expect(onIntent).toHaveBeenNthCalledWith(
      3,
      { type: "rotate_selected", direction: "counterclockwise" },
      "voice",
    );
  });

  it("schema-validates arguments before sending one voice intent", async () => {
    const onIntent = vi.fn(() => ({
      ok: true as const,
      message: "The note was created and saved.",
    }));

    await expect(
      executeRealtimeVoiceTool(
        { name: "create_note", arguments: '{"text":"Capture the launch risk"}' },
        onIntent,
      ),
    ).resolves.toEqual({
      ok: true,
      outcome: "submitted",
      action: "create_note",
      message:
        "Canvas action submitted; check the canvas receipt for the result.",
    });
    expect(onIntent).toHaveBeenCalledWith(
      { type: "create_note", text: "Capture the launch risk" },
      "voice",
    );
  });

  it.each([
    ["create_note", '{"text":""}'],
    ["create_board", '{"unexpected":true}'],
    ["undo", "not-json"],
    ["rotate_selected", '{"direction":"around"}'],
    ["send_meeting_packet", "{}"],
  ])("refuses invalid or unsupported %s arguments without mutation", async (name, args) => {
    const onIntent = vi.fn();

    const result = await executeRealtimeVoiceTool(
      { name, arguments: args },
      onIntent,
    );

    expect(result.ok).toBe(false);
    expect(result.outcome).toBe("refused");
    expect(result.message).not.toContain(args);
    expect(onIntent).not.toHaveBeenCalled();
  });

  it("returns the canonical refusal truthfully", async () => {
    const result = await executeRealtimeVoiceTool(
      { name: "transform_selected_sketch", arguments: "{}" },
      () => ({ ok: false, message: "Select an active sketch first." }),
    );

    expect(result).toEqual({
      ok: false,
      outcome: "refused",
      action: "transform_selected_sketch",
      message: "Select an active sketch first.",
    });
  });
});
