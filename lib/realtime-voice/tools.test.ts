import { describe, expect, it, vi } from "vitest";

import {
  REALTIME_VOICE_INSTRUCTIONS,
  REALTIME_VOICE_TOOL_DEFINITIONS,
  executeRealtimeVoiceTool,
  type RealtimeVoiceIntentHandler,
} from "@/lib/realtime-voice/tools";

describe("Realtime voice tools", () => {
  it("requires direct object requests to mutate before any confirmation", () => {
    expect(REALTIME_VOICE_INSTRUCTIONS).toContain(
      "For a direct creation request, call create_semantic_object without inspecting the canvas first.",
    );
    expect(REALTIME_VOICE_INSTRUCTIONS).toContain(
      "If you already inspected for a creation request, continue in the same response by calling create_semantic_object before confirming anything to the user.",
    );
  });

  it("exposes only the approved reversible canvas vocabulary", () => {
    expect(
      REALTIME_VOICE_TOOL_DEFINITIONS.map((tool) => tool.name),
    ).toEqual([
      "inspect_canvas",
      "create_semantic_object",
      "start_thought",
      "finish_thought",
      "open_sketch",
      "finish_sketch",
      "cancel_sketch",
      "transform_selected_sketch",
      "pin_selected",
      "unpin_selected",
      "minimize_selected",
      "restore_selected",
      "discard_selected",
      "undo",
      "redo",
      "focus_selected",
      "group_selected",
      "ungroup_selected",
      "rotate_selected",
    ]);
    expect(
      JSON.stringify(REALTIME_VOICE_TOOL_DEFINITIONS),
    ).not.toMatch(/packet|email|room/i);
    expect(
      JSON.stringify(REALTIME_VOICE_TOOL_DEFINITIONS),
    ).toMatch(/recoverable trash/i);
  });

  it("maps every supported standalone semantic object family through one canonical intent", async () => {
    const onIntent = vi.fn<RealtimeVoiceIntentHandler>(() => ({
      ok: true as const,
      message: "Object command accepted.",
    }));
    const objects = [
      {
        id: "note-voice",
        type: "note",
        title: "Launch thought",
        x: 80,
        y: 120,
        width: 320,
        height: 220,
        zIndex: 8,
        payload: { text: "Confirm the launch date.", tone: "sky" },
      },
      {
        id: "board-voice",
        type: "task_board",
        title: "Launch board",
        x: 440,
        y: 120,
        width: 620,
        height: 440,
        zIndex: 9,
        payload: {
          columns: [
            {
              id: "todo",
              title: "To do",
              tasks: [{ id: "task-one", title: "Verify launch date" }],
            },
          ],
        },
      },
      {
        id: "schedule-voice",
        type: "schedule",
        title: "Next week",
        x: 1_100,
        y: 120,
        width: 560,
        height: 420,
        zIndex: 10,
        payload: {
          timezone: "America/New_York",
          days: [
            {
              date: "2026-08-31",
              label: "Monday",
              entries: [
                { id: "launch-review", time: "10:30", title: "Launch review" },
              ],
            },
          ],
        },
      },
      {
        id: "diagram-voice",
        type: "diagram",
        title: "Service flow",
        x: 80,
        y: 620,
        width: 700,
        height: 460,
        zIndex: 11,
        payload: {
          kind: "flowchart",
          interpretationSummary: "A request moves from intake to review.",
          nodes: [
            {
              id: "intake",
              label: "Intake",
              kind: "process",
              x: 80,
              y: 80,
              width: 180,
              height: 80,
            },
            {
              id: "review",
              label: "Review",
              kind: "decision",
              x: 360,
              y: 80,
              width: 180,
              height: 80,
            },
          ],
          edges: [{ id: "intake-review", from: "intake", to: "review" }],
        },
      },
      {
        id: "chart-voice",
        type: "diagram",
        title: "Channel mix",
        x: 820,
        y: 620,
        width: 560,
        height: 420,
        zIndex: 12,
        payload: {
          kind: "pie_chart",
          interpretationSummary: "Share by acquisition channel.",
          chart: {
            title: "Channel mix",
            xAxisLabel: null,
            yAxisLabel: null,
            series: [
              {
                id: "channel-share",
                label: "Share",
                points: [
                  { label: "Organic", value: 65 },
                  { label: "Paid", value: 35 },
                ],
              },
            ],
          },
        },
      },
      {
        id: "table-voice",
        type: "data_table",
        title: "Quarterly results",
        x: 1_420,
        y: 620,
        width: 620,
        height: 400,
        zIndex: 13,
        payload: {
          columns: [
            { id: "quarter", label: "Quarter", kind: "text" },
            { id: "revenue", label: "Revenue", kind: "currency" },
          ],
          rows: [{ id: "q-one", cells: ["Q1", 125_000] }],
        },
      },
      {
        id: "reference-voice",
        type: "reference_card",
        title: "Launch research",
        x: 80,
        y: 1_140,
        width: 420,
        height: 300,
        zIndex: 14,
        payload: {
          kind: "article",
          sourceUrl: "https://example.com/research",
          summary: "Evidence relevant to the launch decision.",
          excerpt: null,
        },
      },
      {
        id: "risk-voice",
        type: "meeting_card",
        title: "Launch risk",
        x: 540,
        y: 1_140,
        width: 360,
        height: 260,
        zIndex: 15,
        payload: {
          kind: "risk",
          body: "Supplier lead time may move the launch date.",
          bullets: ["Confirm inventory by Friday"],
          owner: "Danny",
          dueDate: "2026-09-04",
          status: "open",
        },
      },
    ] as const;

    for (const object of objects) {
      await expect(
        executeRealtimeVoiceTool(
          {
            name: "create_semantic_object",
            arguments: JSON.stringify({ object }),
          },
          onIntent,
        ),
      ).resolves.toMatchObject({
        ok: true,
        outcome: "submitted",
        action: "create_semantic_object",
      });
    }

    expect(onIntent.mock.calls.map(([intent]) => intent)).toEqual(
      objects.map((object) => ({ type: "create_semantic_object", object })),
    );
  });

  it("strictly rejects semantic objects with caller-controlled persistence identity", async () => {
    const onIntent = vi.fn();
    const object = {
      id: "note-private",
      type: "note",
      title: "Private",
      x: 80,
      y: 120,
      width: 320,
      height: 220,
      zIndex: 8,
      payload: { text: "Do not create this.", tone: "sky" },
      roomId: "other-room",
      actor: { id: "forged-agent" },
      version: 99,
    };

    const result = await executeRealtimeVoiceTool(
      {
        name: "create_semantic_object",
        arguments: JSON.stringify({ object }),
      },
      onIntent,
    );

    expect(result).toMatchObject({ ok: false, outcome: "refused" });
    expect(result.message).not.toContain("other-room");
    expect(onIntent).not.toHaveBeenCalled();
  });

  it("accepts a schema-bounded semantic table larger than the small action argument cap", async () => {
    const onIntent = vi.fn<RealtimeVoiceIntentHandler>(() => ({
      ok: true as const,
      message: "Table command accepted.",
    }));
    const object = {
      id: "table-detailed",
      type: "data_table",
      title: "Detailed comparison",
      x: 160,
      y: 240,
      width: 900,
      height: 680,
      zIndex: 20,
      payload: {
        columns: Array.from({ length: 4 }, (_, index) => ({
          id: `column-${index + 1}`,
          label: `Column ${index + 1}`,
          kind: "text" as const,
        })),
        rows: Array.from({ length: 24 }, (_, rowIndex) => ({
          id: `row-${rowIndex + 1}`,
          cells: Array.from(
            { length: 4 },
            (_, columnIndex) =>
              `Row ${rowIndex + 1} column ${columnIndex + 1}: ${"evidence ".repeat(13)}`,
          ),
        })),
      },
    };
    const args = JSON.stringify({ object });
    expect(args.length).toBeGreaterThan(8_192);

    await expect(
      executeRealtimeVoiceTool(
        { name: "create_semantic_object", arguments: args },
        onIntent,
      ),
    ).resolves.toMatchObject({ ok: true, outcome: "submitted" });
    expect(onIntent).toHaveBeenCalledOnce();
  });

  it("observes bounded semantic canvas context without submitting a mutation", async () => {
    const onIntent = vi.fn(() => ({
      ok: true as const,
      message: "Must not run.",
    }));
    const signal = new AbortController().signal;
    const inspectCanvas = vi.fn(() => ({
      roomId: "room-live",
      revision: 17,
      selectedObjectId: "sketch-1",
      objects: [
        {
          id: "sketch-1",
          type: "sketch",
          payload: { strokeCount: 3, coordinateDetail: "omitted" },
        },
      ],
      receipts: [],
    }));

    const result = await executeRealtimeVoiceTool(
      {
        name: "inspect_canvas",
        arguments: '{"scope":"selected","includeReceipts":true}',
      },
      onIntent,
      { signal, inspectCanvas },
    );

    expect(result).toEqual({
      ok: true,
      outcome: "observed",
      action: "inspect_canvas",
      message: "Current semantic canvas context observed.",
      data: {
        roomId: "room-live",
        revision: 17,
        selectedObjectId: "sketch-1",
        objects: [
          {
            id: "sketch-1",
            type: "sketch",
            payload: { strokeCount: 3, coordinateDetail: "omitted" },
          },
        ],
        receipts: [],
      },
    });
    expect(inspectCanvas).toHaveBeenCalledWith(
      { scope: "selected", includeReceipts: true },
      signal,
    );
    expect(onIntent).not.toHaveBeenCalled();
  });

  it("returns a cancellation outcome when the canonical intent aborts before commit", async () => {
    const signal = new AbortController().signal;
    const reason = new DOMException("Voice stopped", "AbortError");
    const onIntent = vi.fn(async () => {
      throw reason;
    });

    await expect(
      executeRealtimeVoiceTool(
        { name: "undo", arguments: "{}" },
        onIntent,
        { signal },
      ),
    ).resolves.toEqual({
      ok: false,
      outcome: "cancelled",
      action: "undo",
      message: "Voice action cancelled before the canvas confirmed it.",
    });
  });

  it("maps explicit thought capture boundaries without exposing transcript append as a model tool", async () => {
    const onIntent = vi.fn(() => ({
      ok: true as const,
      message: "Submitted.",
    }));

    await executeRealtimeVoiceTool(
      { name: "start_thought", arguments: "{}" },
      onIntent,
    );
    await executeRealtimeVoiceTool(
      { name: "finish_thought", arguments: "{}" },
      onIntent,
    );

    expect(onIntent).toHaveBeenNthCalledWith(
      1,
      { type: "start_thought" },
      "voice",
    );
    expect(onIntent).toHaveBeenNthCalledWith(
      2,
      { type: "finish_thought" },
      "voice",
    );
    expect(
      REALTIME_VOICE_TOOL_DEFINITIONS.map((tool) => tool.name),
    ).not.toContain("append_thought");
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
      { name: "finish_sketch", arguments: "{}" },
      onIntent,
    );
    await executeRealtimeVoiceTool(
      { name: "discard_selected", arguments: "{}" },
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
      { type: "finish_sketch" },
      "voice",
    );
    expect(onIntent).toHaveBeenNthCalledWith(
      4,
      { type: "discard_selected" },
      "voice",
    );
    expect(onIntent).toHaveBeenNthCalledWith(
      5,
      { type: "rotate_selected", direction: "counterclockwise" },
      "voice",
    );
  });

  it.each([
    ["create_semantic_object", '{"object":{"type":"note"}}'],
    ["open_sketch", '{"unexpected":true}'],
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
