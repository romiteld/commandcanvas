import { describe, expect, it, vi } from "vitest";

import {
  REALTIME_VOICE_INSTRUCTIONS,
  REALTIME_VOICE_TOOL_DEFINITIONS,
  createRealtimeVoiceSessionConfig,
  executeRealtimeVoiceTool,
  type RealtimeVoiceCapabilityInvoker,
} from "@/lib/realtime-voice/tools";

function successfulCapabilityInvoker() {
  return vi.fn<RealtimeVoiceCapabilityInvoker>(async () => ({
    ok: true,
    status: "completed",
    message: "Applied.",
  }));
}

describe("Realtime voice tools", () => {
  it("defaults to the full Realtime model and permits mini only as an explicit preference", () => {
    expect(createRealtimeVoiceSessionConfig().model).toBe("gpt-realtime-2.1");
    expect(createRealtimeVoiceSessionConfig("gpt-realtime-mini").model).toBe(
      "gpt-realtime-mini",
    );
    expect(() =>
      createRealtimeVoiceSessionConfig("not-a-realtime-model" as never),
    ).toThrow(/realtime model/i);
  });

  it("requires direct object requests to mutate before any confirmation", () => {
    expect(REALTIME_VOICE_INSTRUCTIONS).toContain(
      "Call that creation tool immediately without inspecting first",
    );
    expect(REALTIME_VOICE_INSTRUCTIONS).toContain(
      "If you already inspected for a creation request, continue in the same response by calling the matching creation tool before confirming anything to the user.",
    );
    expect(REALTIME_VOICE_INSTRUCTIONS).toContain(
      "For an unspecified project board, call create_board with {}",
    );
  });

  it("routes explicit object families without treating diagrams or charts as a generic fallback", () => {
    expect(REALTIME_VOICE_INSTRUCTIONS).toContain(
      "A note or static thought uses create_note",
    );
    expect(REALTIME_VOICE_INSTRUCTIONS).toContain(
      "A chart or numeric graph uses create_chart only when the user asks for one",
    );
    expect(REALTIME_VOICE_INSTRUCTIONS).toContain(
      "Never substitute a diagram or chart for another requested family",
    );
    expect(REALTIME_VOICE_INSTRUCTIONS).toContain(
      "An image or document reference is not generated media",
    );
  });

  it("creates and populates a titled note in one canonical capability call", async () => {
    const invokeCapability = vi.fn(async () => ({
      ok: true as const,
      status: "completed" as const,
      message: "Created.",
      data: { objectId: "note-research" },
    }));

    const result = await executeRealtimeVoiceTool(
      {
        name: "create_note",
        arguments: JSON.stringify({
          title: "Research questions",
          text: "Compare local inference with the private GPU relay.",
        }),
      },
      vi.fn(),
      { invokeCapability },
    );

    expect(result).toMatchObject({
      ok: true,
      outcome: "submitted",
      data: { objectId: "note-research" },
    });
    expect(invokeCapability).toHaveBeenCalledWith(
      "create_object",
      {
        type: "note",
        title: "Research questions",
        text: "Compare local inference with the private GPU relay.",
      },
      expect.any(AbortSignal),
    );
  });

  it("fails closed instead of using the retired direct-intent fallback", async () => {
    const onIntent = vi.fn();

    const result = await executeRealtimeVoiceTool(
      {
        name: "create_note",
        arguments: JSON.stringify({
          title: "Research questions",
          text: "Compare both inference paths.",
        }),
      },
      onIntent,
    );

    expect(result).toEqual({
      ok: false,
      outcome: "refused",
      action: "create_note",
      message: "Canonical canvas capabilities are unavailable in this voice session.",
    });
    expect(onIntent).not.toHaveBeenCalled();
  });

  it("creates a safe empty project board when the spoken request omits structure", async () => {
    const definition = REALTIME_VOICE_TOOL_DEFINITIONS.find(
      (tool) => tool.name === "create_board",
    );
    expect(definition?.parameters.required).toEqual([]);

    const invokeCapability = vi.fn(async () => ({
      ok: true as const,
      status: "completed" as const,
      message: "Created.",
    }));

    const result = await executeRealtimeVoiceTool(
      { name: "create_board", arguments: "{}" },
      vi.fn(),
      { invokeCapability },
    );

    expect(invokeCapability).toHaveBeenCalledWith(
      "create_object",
      {
        type: "task_board",
        title: "Project board",
        columns: [
          { title: "Next", tasks: [] },
          { title: "In progress", tasks: [] },
          { title: "Done", tasks: [] },
        ],
      },
      expect.any(AbortSignal),
    );
    expect(result).toMatchObject({ ok: true, outcome: "submitted" });

    await executeRealtimeVoiceTool(
      {
        name: "create_board",
        arguments: JSON.stringify({
          title: "Release readiness",
          columns: [
            {
              title: "Today",
              tasks: [
                {
                  title: "Record the demo",
                  owner: "Danny",
                  dueDate: "2026-09-03",
                  priority: "high",
                },
              ],
            },
          ],
        }),
      },
      vi.fn(),
      { invokeCapability },
    );
    expect(invokeCapability).toHaveBeenNthCalledWith(
      2,
      "create_object",
      {
        type: "task_board",
        title: "Release readiness",
        columns: [
          {
            title: "Today",
            tasks: [
              {
                title: "Record the demo",
                owner: "Danny",
                dueDate: "2026-09-03",
                priority: "high",
              },
            ],
          },
        ],
      },
      expect.any(AbortSignal),
    );
  });

  it("tells the voice model that spoken drawing explanation belongs to the sketch transform", () => {
    expect(REALTIME_VOICE_INSTRUCTIONS).toContain(
      "Treat descriptive speech during a drawing as sketch narration",
    );
    expect(REALTIME_VOICE_INSTRUCTIONS).toContain(
      "CommandCanvas attaches the bounded completed narration",
    );
  });

  it("exposes only the approved reversible canvas vocabulary", () => {
    expect(REALTIME_VOICE_TOOL_DEFINITIONS.map((tool) => tool.name)).toEqual([
      "inspect_canvas",
      "create_semantic_object",
      "create_note",
      "create_board",
      "create_schedule",
      "create_diagram",
      "create_chart",
      "create_data_table",
      "create_reference_card",
      "create_meeting_card",
      "append_selected_note",
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
      "move_selected_object",
      "resize_selected_object",
      "prepare_meeting_packet",
      "request_packet_send",
      "control_workspace",
    ]);
    expect(
      REALTIME_VOICE_TOOL_DEFINITIONS.map((tool) => tool.name),
    ).not.toEqual(expect.arrayContaining(["approve_packet", "send_email"]));
    expect(JSON.stringify(REALTIME_VOICE_TOOL_DEFINITIONS)).toMatch(
      /recoverable trash/i,
    );
  });

  it("normalizes selected movement and workspace control through the canonical capability invoker", async () => {
    const invokeCapability = vi.fn(async () => ({
      ok: true as const,
      status: "completed" as const,
      message: "Applied.",
    }));
    const inspectCanvas = vi.fn(async () => ({
      scope: "all",
      roomId: "room-1",
      revision: 9,
      selectedObjectId: "note-1",
      objects: [
        {
          id: "note-1",
          type: "note",
          title: "Move me",
          version: 4,
          spatial: {
            x: 100,
            y: 120,
            width: 300,
            height: 180,
            zIndex: 4,
            rotation: 0,
          },
          state: { minimized: false, pinned: false, parentId: null },
        },
      ],
      receipts: [],
      truncation: {
        objects: { total: 1, returned: 1, omitted: 0 },
      },
    }));

    await executeRealtimeVoiceTool(
      {
        name: "move_selected_object",
        arguments: JSON.stringify({ x: 420, y: 180 }),
      },
      vi.fn(),
      { invokeCapability, inspectCanvas },
    );
    await executeRealtimeVoiceTool(
      {
        name: "control_workspace",
        arguments: JSON.stringify({ action: "fit_all" }),
      },
      vi.fn(),
      { invokeCapability, inspectCanvas },
    );

    expect(invokeCapability).toHaveBeenNthCalledWith(
      1,
      "transform_object",
      {
        objectId: "note-1",
        expectedVersion: 4,
        transform: { x: 420, y: 180 },
      },
      expect.any(AbortSignal),
    );
    expect(invokeCapability).toHaveBeenNthCalledWith(
      2,
      "control_workspace",
      { action: "fit_all" },
      expect.any(AbortSignal),
    );
  });

  it("resolves an unambiguous named note before appending through the canonical capability", async () => {
    const invokeCapability = vi.fn(async () => ({
      ok: true as const,
      status: "completed" as const,
      message: "Updated.",
    }));
    const inspectCanvas = vi.fn(async () => ({
      scope: "all",
      roomId: "room-1",
      revision: 12,
      selectedObjectId: "diagram-selected",
      objects: [
        {
          id: "diagram-selected",
          type: "diagram",
          title: "Metrics",
          version: 2,
        },
        {
          id: "note-demo",
          type: "note",
          title: "Demo narration",
          version: 5,
        },
      ],
      receipts: [],
      truncation: {
        objects: { total: 2, returned: 2, omitted: 0 },
      },
    }));

    const result = await executeRealtimeVoiceTool(
      {
        name: "append_selected_note",
        arguments: JSON.stringify({
          target: "Demo narration",
          text: "Explain the live collaboration flow.",
        }),
      },
      vi.fn(),
      { invokeCapability, inspectCanvas },
    );

    expect(result).toMatchObject({ ok: true, outcome: "submitted" });
    expect(inspectCanvas).toHaveBeenCalledWith(
      { scope: "all", includeReceipts: false },
      expect.any(AbortSignal),
    );
    expect(invokeCapability).toHaveBeenCalledWith(
      "update_object_content",
      {
        objectId: "note-demo",
        text: "Explain the live collaboration flow.",
      },
      expect.any(AbortSignal),
    );
  });

  it("uses a creation result's stable object ID without depending on UI selection", async () => {
    const invokeCapability = vi.fn(async () => ({
      ok: true as const,
      status: "completed" as const,
      message: "Updated.",
    }));
    const inspectCanvas = vi.fn();

    const result = await executeRealtimeVoiceTool(
      {
        name: "append_selected_note",
        arguments: JSON.stringify({
          objectId: "note-created-by-voice",
          text: "This follows the object that voice just created.",
        }),
      },
      vi.fn(),
      { invokeCapability, inspectCanvas },
    );

    expect(result).toMatchObject({ ok: true, outcome: "submitted" });
    expect(inspectCanvas).not.toHaveBeenCalled();
    expect(invokeCapability).toHaveBeenCalledWith(
      "update_object_content",
      {
        objectId: "note-created-by-voice",
        text: "This follows the object that voice just created.",
      },
      expect.any(AbortSignal),
    );
  });

  it("refuses conflicting stable-ID and title targets before canvas inspection or mutation", async () => {
    const invokeCapability = vi.fn();
    const inspectCanvas = vi.fn();

    const result = await executeRealtimeVoiceTool(
      {
        name: "append_selected_note",
        arguments: JSON.stringify({
          objectId: "note-created-by-voice",
          target: "A different note",
          text: "Do not choose between conflicting targets.",
        }),
      },
      vi.fn(),
      { invokeCapability, inspectCanvas },
    );

    expect(result).toEqual({
      ok: false,
      outcome: "refused",
      action: "append_selected_note",
      message: "Voice action arguments were invalid.",
    });
    expect(inspectCanvas).not.toHaveBeenCalled();
    expect(invokeCapability).not.toHaveBeenCalled();
  });

  it("refuses an ambiguous named note rather than choosing one arbitrarily", async () => {
    const invokeCapability = vi.fn();
    const result = await executeRealtimeVoiceTool(
      {
        name: "append_selected_note",
        arguments: JSON.stringify({
          target: "Demo narration",
          text: "Do not guess which one.",
        }),
      },
      vi.fn(),
      {
        invokeCapability,
        inspectCanvas: async () => ({
          scope: "all",
          roomId: "room-1",
          revision: 12,
          selectedObjectId: null,
          objects: [
            {
              id: "note-demo-a",
              type: "note",
              title: "Demo narration",
              version: 1,
            },
            {
              id: "note-demo-b",
              type: "note",
              title: "demo narration",
              version: 1,
            },
          ],
          receipts: [],
          truncation: {
            objects: { total: 2, returned: 2, omitted: 0 },
          },
        }),
      },
    );

    expect(result).toEqual({
      ok: false,
      outcome: "refused",
      action: "append_selected_note",
      message:
        'More than one active note or thought is named "Demo narration". Select one or use its stable object ID.',
    });
    expect(invokeCapability).not.toHaveBeenCalled();
  });

  it("refuses title resolution when the bounded object projection cannot prove uniqueness", async () => {
    const invokeCapability = vi.fn();
    const result = await executeRealtimeVoiceTool(
      {
        name: "append_selected_note",
        arguments: JSON.stringify({
          target: "Demo narration",
          text: "Do not guess across omitted objects.",
        }),
      },
      vi.fn(),
      {
        invokeCapability,
        inspectCanvas: async () => ({
          scope: "all",
          roomId: "room-1",
          revision: 12,
          selectedObjectId: null,
          objects: [
            {
              id: "note-demo-a",
              type: "note",
              title: "Demo narration",
              version: 1,
            },
          ],
          receipts: [],
          truncation: {
            objects: { total: 51, returned: 50, omitted: 1 },
          },
        }),
      },
    );

    expect(result).toEqual({
      ok: false,
      outcome: "refused",
      action: "append_selected_note",
      message:
        "Canvas projection metadata cannot prove the object list is complete.",
    });
    expect(invokeCapability).not.toHaveBeenCalled();
  });

  it("resolves a deictic note update to the inspected active selection", async () => {
    const invokeCapability = vi.fn(async () => ({
      ok: true as const,
      status: "completed" as const,
      message: "Updated.",
    }));

    await executeRealtimeVoiceTool(
      {
        name: "append_selected_note",
        arguments: JSON.stringify({ text: "Add this to the selected note." }),
      },
      vi.fn(),
      {
        invokeCapability,
        inspectCanvas: async () => ({
          roomId: "room-1",
          revision: 12,
          selectedObjectId: "note-selected",
          objects: [
            { id: "note-selected", type: "note", title: "Selected thought" },
          ],
          receipts: [],
          truncation: {},
        }),
      },
    );

    expect(invokeCapability).toHaveBeenCalledWith(
      "update_object_content",
      {
        objectId: "note-selected",
        text: "Add this to the selected note.",
      },
      expect.any(AbortSignal),
    );
  });

  it("refuses a selected non-note before invoking the note mutation", async () => {
    const invokeCapability = vi.fn();
    const result = await executeRealtimeVoiceTool(
      {
        name: "append_selected_note",
        arguments: JSON.stringify({ text: "This cannot go into a graph." }),
      },
      vi.fn(),
      {
        invokeCapability,
        inspectCanvas: async () => ({
          roomId: "room-1",
          revision: 12,
          selectedObjectId: "diagram-selected",
          objects: [
            { id: "diagram-selected", type: "diagram", title: "Metrics" },
          ],
          receipts: [],
          truncation: {},
        }),
      },
    );

    expect(result).toEqual({
      ok: false,
      outcome: "refused",
      action: "append_selected_note",
      message: "Select an active note or thought first.",
    });
    expect(invokeCapability).not.toHaveBeenCalled();
  });

  it("runs thought session boundaries through the canonical capability invoker before local capture", async () => {
    const invokeCapability = vi.fn(async (capability: string) => {
      if (capability === "create_object")
        return {
          ok: true as const,
          status: "completed" as const,
          message: "Thought card created.",
          data: { affectedObjectIds: ["note-thought-1"] },
        };
      return {
        ok: true as const,
        status: "completed" as const,
        message: "Thought capture may stop.",
      };
    });
    const onIntent = vi.fn(async () => ({
      ok: true as const,
      message: "Local thought session updated.",
    }));

    await executeRealtimeVoiceTool(
      { name: "start_thought", arguments: "{}" },
      onIntent,
      { invokeCapability },
    );
    await executeRealtimeVoiceTool(
      { name: "finish_thought", arguments: "{}" },
      onIntent,
      { invokeCapability },
    );

    expect(invokeCapability).toHaveBeenNthCalledWith(
      1,
      "create_object",
      { type: "note", title: "New thought", tone: "coral" },
      expect.any(AbortSignal),
    );
    expect(invokeCapability).toHaveBeenNthCalledWith(
      2,
      "get_canvas_state",
      { scope: "selected" },
      expect.any(AbortSignal),
    );
    expect(onIntent).toHaveBeenNthCalledWith(
      1,
      { type: "start_thought", objectId: "note-thought-1" },
      "voice",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(onIntent).toHaveBeenNthCalledWith(
      2,
      { type: "finish_thought" },
      "voice",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it.each([
    ["open_sketch", "control_workspace", { action: "start_drawing" }],
    ["finish_sketch", "control_workspace", { action: "finish_drawing" }],
    ["cancel_sketch", "control_workspace", { action: "cancel_drawing" }],
  ] as const)(
    "routes %s through its canonical workspace capability without direct intent fallback",
    async (name, capability, input) => {
      const invokeCapability = vi.fn(async () => ({
        ok: true as const,
        status: "completed" as const,
        message: "Workspace updated.",
      }));
      const onIntent = vi.fn();

      await executeRealtimeVoiceTool({ name, arguments: "{}" }, onIntent, {
        invokeCapability,
      });

      expect(invokeCapability).toHaveBeenCalledWith(
        capability,
        input,
        expect.any(AbortSignal),
      );
      expect(onIntent).not.toHaveBeenCalled();
    },
  );

  it("does not start local thought capture when the shared capability guard refuses it", async () => {
    const onIntent = vi.fn();
    const result = await executeRealtimeVoiceTool(
      { name: "start_thought", arguments: "{}" },
      onIntent,
      {
        invokeCapability: async () => ({
          ok: false as const,
          code: "forbidden" as const,
          message:
            "mutation not authorized: this participant can only view the room",
        }),
      },
    );

    expect(result).toMatchObject({ ok: false, outcome: "refused" });
    expect(onIntent).not.toHaveBeenCalled();
  });

  it("routes selected sketch transformation through the canonical capability invoker", async () => {
    const invokeCapability = vi.fn(async () => ({
      ok: true as const,
      status: "completed" as const,
      message: "Transformed.",
    }));
    const inspectCanvas = vi.fn(async () => ({
      scope: "all",
      roomId: "room-1",
      revision: 9,
      selectedObjectId: "sketch-1",
      objects: [{ id: "sketch-1", type: "sketch" }],
      receipts: [],
      truncation: {},
    }));

    await executeRealtimeVoiceTool(
      { name: "transform_selected_sketch", arguments: "{}" },
      vi.fn(),
      { invokeCapability, inspectCanvas },
    );

    expect(invokeCapability).toHaveBeenCalledWith(
      "transform_sketch",
      {
        sketchId: "sketch-1",
        instruction: "Make that usable.",
      },
      expect.any(AbortSignal),
    );
  });

  it("preserves an explicitly requested sketch output family instead of defaulting to architecture", async () => {
    const invokeCapability = vi.fn(async () => ({
      ok: true as const,
      status: "completed" as const,
      message: "Transformed.",
    }));
    const inspectCanvas = vi.fn(async () => ({
      roomId: "room-1",
      revision: 9,
      selectedObjectId: "sketch-1",
      objects: [{ id: "sketch-1", type: "sketch" }],
      receipts: [],
      truncation: {},
    }));

    const result = await executeRealtimeVoiceTool(
      {
        name: "transform_selected_sketch",
        arguments: JSON.stringify({
          instruction: "Turn this drawing into a pie chart.",
          outputKind: "pie_chart",
        }),
      },
      vi.fn(),
      { invokeCapability, inspectCanvas },
    );

    expect(result).toMatchObject({ ok: true, outcome: "submitted" });
    expect(invokeCapability).toHaveBeenCalledWith(
      "transform_sketch",
      {
        sketchId: "sketch-1",
        instruction: "Turn this drawing into a pie chart.",
        outputKind: "pie_chart",
      },
      expect.any(AbortSignal),
    );
  });

  it("adds buffered spoken drawing context to the canonical sketch transform exactly once", async () => {
    const invokeCapability = vi.fn(async () => ({
      ok: true as const,
      status: "completed" as const,
      message: "Transformed.",
    }));
    const inspectCanvas = vi.fn(async () => ({
      roomId: "room-1",
      revision: 9,
      selectedObjectId: "sketch-1",
      objects: [{ id: "sketch-1", type: "sketch" }],
      receipts: [],
      truncation: {},
    }));
    const consumeSketchNarration = vi
      .fn<() => string | undefined>()
      .mockReturnValueOnce(
        "The circle is inventory and the arrow means daily replenishment.",
      )
      .mockReturnValueOnce(undefined);

    await executeRealtimeVoiceTool(
      { name: "transform_selected_sketch", arguments: "{}" },
      vi.fn(),
      { invokeCapability, inspectCanvas, consumeSketchNarration },
    );
    await executeRealtimeVoiceTool(
      { name: "transform_selected_sketch", arguments: "{}" },
      vi.fn(),
      { invokeCapability, inspectCanvas, consumeSketchNarration },
    );

    expect(invokeCapability).toHaveBeenNthCalledWith(
      1,
      "transform_sketch",
      {
        sketchId: "sketch-1",
        instruction: "Make that usable.",
        narration:
          "The circle is inventory and the arrow means daily replenishment.",
      },
      expect.any(AbortSignal),
    );
    expect(invokeCapability).toHaveBeenNthCalledWith(
      2,
      "transform_sketch",
      {
        sketchId: "sketch-1",
        instruction: "Make that usable.",
      },
      expect.any(AbortSignal),
    );
    expect(consumeSketchNarration).toHaveBeenCalledTimes(2);
  });

  it("returns a specific selection refusal before canonical selected-object invocation", async () => {
    const invokeCapability = vi.fn();
    const result = await executeRealtimeVoiceTool(
      { name: "move_selected_object", arguments: JSON.stringify({ x: 300 }) },
      vi.fn(),
      {
        invokeCapability,
        inspectCanvas: async () => ({
          roomId: "room-1",
          revision: 1,
          selectedObjectId: null,
          objects: [],
          receipts: [],
          truncation: {},
        }),
      },
    );

    expect(result).toEqual({
      ok: false,
      outcome: "refused",
      action: "move_selected_object",
      message: "Select an active object first.",
    });
    expect(invokeCapability).not.toHaveBeenCalled();
  });

  it("normalizes rotate, group, and ungroup aliases into canonical shared mutations", async () => {
    const invokeCapability = vi.fn(async () => ({
      ok: true as const,
      status: "completed" as const,
      message: "Applied.",
    }));
    const inspectCanvas = vi.fn(async () => ({
      roomId: "room-1",
      revision: 9,
      selectedObjectId: "note-2",
      selectedObjectIds: ["note-1", "note-2"],
      objects: [
        {
          id: "note-1",
          type: "note",
          version: 3,
          spatial: {
            x: 100,
            y: 120,
            width: 300,
            height: 180,
            zIndex: 4,
            rotation: 0,
          },
          state: { minimized: false, pinned: false, parentId: null },
        },
        {
          id: "note-2",
          type: "note",
          version: 6,
          spatial: {
            x: 460,
            y: 160,
            width: 280,
            height: 200,
            zIndex: 6,
            rotation: 175,
          },
          state: { minimized: false, pinned: false, parentId: null },
        },
      ],
      receipts: [],
      truncation: {
        objects: { total: 2, returned: 2, omitted: 0 },
      },
    }));

    await executeRealtimeVoiceTool(
      {
        name: "rotate_selected",
        arguments: JSON.stringify({ direction: "clockwise" }),
      },
      vi.fn(),
      { invokeCapability, inspectCanvas },
    );
    await executeRealtimeVoiceTool(
      { name: "group_selected", arguments: "{}" },
      vi.fn(),
      { invokeCapability, inspectCanvas },
    );
    await executeRealtimeVoiceTool(
      { name: "ungroup_selected", arguments: "{}" },
      vi.fn(),
      { invokeCapability, inspectCanvas },
    );

    expect(invokeCapability).toHaveBeenNthCalledWith(
      1,
      "transform_object",
      {
        objectId: "note-2",
        expectedVersion: 6,
        transform: { rotation: -170 },
      },
      expect.any(AbortSignal),
    );
    expect(invokeCapability).toHaveBeenNthCalledWith(
      2,
      "organize_objects",
      expect.objectContaining({
        action: "group",
        objectIds: ["note-1", "note-2"],
        expectedVersions: [
          { objectId: "note-1", expectedVersion: 3 },
          { objectId: "note-2", expectedVersion: 6 },
        ],
        frame: expect.objectContaining({
          id: expect.stringMatching(/^frame-/),
          x: 56,
          y: 76,
          width: 728,
          height: 328,
          zIndex: 3,
        }),
      }),
      expect.any(AbortSignal),
    );
    expect(invokeCapability).toHaveBeenNthCalledWith(
      3,
      "organize_objects",
      { action: "ungroup", frameId: "note-2", expectedVersion: 6 },
      expect.any(AbortSignal),
    );
  });

  it("keeps full-geometry semantic creation compatible behind the shared capability guard", async () => {
    const object = {
      id: "note-voice",
      type: "note" as const,
      title: "Spatial note",
      x: 480,
      y: 260,
      width: 360,
      height: 240,
      zIndex: 8,
      payload: { text: "Keep this geometry.", tone: "sky" as const },
    };
    const invokeCapability = vi.fn(async () => ({
      ok: true as const,
      status: "completed" as const,
      message: "Applied.",
    }));

    await executeRealtimeVoiceTool(
      {
        name: "create_semantic_object",
        arguments: JSON.stringify({ object }),
      },
      vi.fn(),
      { invokeCapability },
    );

    expect(invokeCapability).toHaveBeenCalledWith(
      "create_object",
      { object },
      expect.any(AbortSignal),
    );
  });

  it("prepares and stages packets but never approves or sends them", async () => {
    const invokeCapability = vi.fn(async (capability: string) =>
      capability === "request_packet_send"
        ? {
            ok: true as const,
            status: "awaiting_human_approval" as const,
            message: "Staged.",
          }
        : {
            ok: true as const,
            status: "completed" as const,
            message: "Draft prepared.",
          },
    );

    await executeRealtimeVoiceTool(
      {
        name: "prepare_meeting_packet",
        arguments: JSON.stringify({ title: "Project review" }),
      },
      vi.fn(),
      { invokeCapability },
    );
    const staged = await executeRealtimeVoiceTool(
      {
        name: "request_packet_send",
        arguments: JSON.stringify({ packetId: "packet-1" }),
      },
      vi.fn(),
      { invokeCapability },
    );

    expect(invokeCapability).toHaveBeenNthCalledWith(
      1,
      "prepare_meeting_packet",
      { title: "Project review" },
      expect.any(AbortSignal),
    );
    expect(invokeCapability).toHaveBeenNthCalledWith(
      2,
      "request_packet_send",
      { packetId: "packet-1" },
      expect.any(AbortSignal),
    );
    expect(staged).toMatchObject({
      ok: true,
      outcome: "submitted",
      message: expect.stringContaining("explicit host SEND"),
    });
  });

  it("maps compact everyday creation tools without requiring model-generated spatial geometry", async () => {
    const invokeCapability = successfulCapabilityInvoker();

    await executeRealtimeVoiceTool(
      {
        name: "create_note",
        arguments: '{"text":"Confirm the launch date."}',
      },
      vi.fn(),
      { invokeCapability },
    );
    await executeRealtimeVoiceTool(
      {
        name: "create_board",
        arguments: JSON.stringify({
          title: "Release readiness",
          columns: [
            {
              title: "Next",
              tasks: [
                {
                  title: "Verify mobile hand input",
                  owner: "Danny",
                  priority: "high",
                },
              ],
            },
          ],
        }),
      },
      vi.fn(),
      { invokeCapability },
    );
    await executeRealtimeVoiceTool(
      {
        name: "create_schedule",
        arguments: JSON.stringify({
          title: "Submission week",
          timezone: "America/New_York",
          days: [
            {
              date: "2026-09-02",
              label: "Wed, Sep 2",
              entries: [
                {
                  time: "14:00",
                  title: "Record final demo",
                  owner: "Danny",
                },
              ],
            },
          ],
        }),
      },
      vi.fn(),
      { invokeCapability },
    );

    expect(invokeCapability).toHaveBeenNthCalledWith(
      1,
      "create_object",
      { type: "note", text: "Confirm the launch date." },
      expect.any(AbortSignal),
    );
    expect(invokeCapability).toHaveBeenNthCalledWith(
      2,
      "create_object",
      {
        type: "task_board",
        title: "Release readiness",
        columns: [
          {
            title: "Next",
            tasks: [
              {
                title: "Verify mobile hand input",
                owner: "Danny",
                priority: "high",
              },
            ],
          },
        ],
      },
      expect.any(AbortSignal),
    );
    expect(invokeCapability).toHaveBeenNthCalledWith(
      3,
      "create_object",
      {
        type: "schedule",
        title: "Submission week",
        timezone: "America/New_York",
        days: [
          {
            date: "2026-09-02",
            label: "Wed, Sep 2",
            entries: [
              {
                time: "14:00",
                title: "Record final demo",
                owner: "Danny",
              },
            ],
          },
        ],
      },
      expect.any(AbortSignal),
    );
  });

  it("builds compact diagrams, charts, tables, references, and meeting cards into canonical semantic-object intents", async () => {
    const invokeCapability = successfulCapabilityInvoker();

    const calls = [
      {
        name: "create_diagram",
        arguments: JSON.stringify({
          title: "Approval flow",
          kind: "flowchart",
          summary: "A request moves through review before approval.",
          nodes: [
            { key: "request", label: "Request", kind: "process" },
            { key: "approve", label: "Approve?", kind: "decision" },
          ],
          edges: [{ from: "request", to: "approve", label: "review" }],
        }),
      },
      {
        name: "create_chart",
        arguments: JSON.stringify({
          title: "Channel mix",
          kind: "pie_chart",
          series: [
            {
              label: "Share",
              points: [
                { label: "Organic", value: 65 },
                { label: "Paid", value: 35 },
              ],
            },
          ],
        }),
      },
      {
        name: "create_data_table",
        arguments: JSON.stringify({
          title: "Quarterly results",
          columns: [
            { label: "Quarter", kind: "text" },
            { label: "Revenue", kind: "currency" },
          ],
          rows: [["Q1", 125000]],
        }),
      },
      {
        name: "create_reference_card",
        arguments: JSON.stringify({
          title: "Launch research",
          kind: "article",
          sourceUrl: "https://example.com/research",
          summary: "Evidence relevant to the launch decision.",
        }),
      },
      {
        name: "create_meeting_card",
        arguments: JSON.stringify({
          title: "Launch risk",
          kind: "risk",
          body: "Supplier lead time may move the launch date.",
          bullets: ["Confirm inventory by Friday"],
          owner: "Danny",
          status: "open",
        }),
      },
    ];

    for (const call of calls)
      await expect(
        executeRealtimeVoiceTool(call, vi.fn(), { invokeCapability }),
      ).resolves.toMatchObject({ ok: true, outcome: "submitted" });

    expect(invokeCapability).toHaveBeenCalledTimes(5);
    expect(invokeCapability.mock.calls.map(([capability]) => capability)).toEqual(
      Array(5).fill("create_object"),
    );
    const inputs = invokeCapability.mock.calls.map(([, input]) => input);
    expect(inputs[0]).toMatchObject({
        type: "diagram",
        title: "Approval flow",
        kind: "flowchart",
        summary: "A request moves through review before approval.",
        nodes: [
          { key: "request", label: "Request", kind: "process" },
          { key: "approve", label: "Approve?", kind: "decision" },
        ],
        edges: [{ from: "request", to: "approve", label: "review" }],
    });
    expect(inputs[1]).toMatchObject({
        type: "chart",
        title: "Channel mix",
        kind: "pie_chart",
        series: [
          {
            label: "Share",
            points: [
              { label: "Organic", value: 65 },
              { label: "Paid", value: 35 },
            ],
          },
        ],
    });
    expect(inputs[2]).toMatchObject({
        type: "data_table",
        title: "Quarterly results",
        columns: [
          { label: "Quarter", kind: "text" },
          { label: "Revenue", kind: "currency" },
        ],
        rows: [["Q1", 125000]],
    });
    expect(inputs[3]).toMatchObject({
        type: "reference_card",
        title: "Launch research",
        kind: "article",
        sourceUrl: "https://example.com/research",
        summary: "Evidence relevant to the launch decision.",
    });
    expect(inputs[4]).toMatchObject({
        type: "meeting_card",
        title: "Launch risk",
        kind: "risk",
        body: "Supplier lead time may move the launch date.",
        bullets: ["Confirm inventory by Friday"],
        owner: "Danny",
        status: "open",
    });
  });

  it("maps selected-note fill requests to a bounded canonical intent", async () => {
    const invokeCapability = successfulCapabilityInvoker();
    const inspectCanvas = vi.fn(async () => ({
      scope: "selected",
      roomId: "room-1",
      revision: 8,
      selectedObjectId: "note-selected",
      objects: [
        {
          id: "note-selected",
          type: "note",
          title: "Launch checklist",
          version: 3,
        },
      ],
      receipts: [],
      truncation: {
        objects: { total: 1, returned: 1, omitted: 0 },
      },
    }));

    const result = await executeRealtimeVoiceTool(
      {
        name: "append_selected_note",
        arguments: '{"text":"Sarah owns the launch checklist."}',
      },
      vi.fn(),
      { invokeCapability, inspectCanvas },
    );

    expect(result).toMatchObject({
      ok: true,
      outcome: "submitted",
      action: "append_selected_note",
    });
    expect(invokeCapability).toHaveBeenCalledWith(
      "update_object_content",
      {
        objectId: "note-selected",
        text: "Sarah owns the launch checklist.",
      },
      expect.any(AbortSignal),
    );
  });

  it("maps every supported standalone semantic object family through one canonical intent", async () => {
    const invokeCapability = successfulCapabilityInvoker();
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
          vi.fn(),
          { invokeCapability },
        ),
      ).resolves.toMatchObject({
        ok: true,
        outcome: "submitted",
        action: "create_semantic_object",
      });
    }

    expect(invokeCapability.mock.calls.map(([capability, input]) => ({
      capability,
      input,
    }))).toEqual(
      objects.map((object) => ({
        capability: "create_object",
        input: { object },
      })),
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
    const invokeCapability = successfulCapabilityInvoker();
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
        vi.fn(),
        { invokeCapability },
      ),
    ).resolves.toMatchObject({ ok: true, outcome: "submitted" });
    expect(invokeCapability).toHaveBeenCalledWith(
      "create_object",
      { object },
      expect.any(AbortSignal),
    );
  });

  it("observes bounded semantic canvas context without submitting a mutation", async () => {
    const onIntent = vi.fn(() => ({
      ok: true as const,
      message: "Must not run.",
    }));
    const signal = new AbortController().signal;
    const data = {
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
    };
    const invokeCapability = vi.fn(async () => ({
      ok: true as const,
      status: "completed" as const,
      message: "Canvas state read.",
      data,
    }));

    const result = await executeRealtimeVoiceTool(
      {
        name: "inspect_canvas",
        arguments: '{"scope":"selected","includeReceipts":true}',
      },
      onIntent,
      { signal, invokeCapability },
    );

    expect(result).toEqual({
      ok: true,
      outcome: "observed",
      action: "inspect_canvas",
      message: "Current semantic canvas context observed.",
      data,
    });
    expect(invokeCapability).toHaveBeenCalledWith(
      "get_canvas_state",
      { scope: "selected", includeReceipts: true },
      signal,
    );
    expect(onIntent).not.toHaveBeenCalled();
  });

  it("returns a cancellation outcome when the canonical intent aborts before commit", async () => {
    const signal = new AbortController().signal;
    const reason = new DOMException("Voice stopped", "AbortError");
    const invokeCapability = vi.fn(async () => {
      throw reason;
    });

    await expect(
      executeRealtimeVoiceTool({ name: "undo", arguments: "{}" }, vi.fn(), {
        signal,
        invokeCapability,
      }),
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

    const invokeCapability = vi
      .fn<RealtimeVoiceCapabilityInvoker>()
      .mockResolvedValueOnce({
        ok: true,
        status: "completed",
        message: "Thought created.",
        data: { affectedObjectIds: ["note-thought"] },
      })
      .mockResolvedValueOnce({
        ok: true,
        status: "completed",
        message: "Canvas observed.",
      });

    await executeRealtimeVoiceTool(
      { name: "start_thought", arguments: "{}" },
      onIntent,
      { invokeCapability },
    );
    await executeRealtimeVoiceTool(
      { name: "finish_thought", arguments: "{}" },
      onIntent,
      { invokeCapability },
    );

    expect(onIntent).toHaveBeenNthCalledWith(
      1,
      { type: "start_thought", objectId: "note-thought" },
      "voice",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(onIntent).toHaveBeenNthCalledWith(
      2,
      { type: "finish_thought" },
      "voice",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(
      REALTIME_VOICE_TOOL_DEFINITIONS.map((tool) => tool.name),
    ).not.toContain("append_thought");
  });

  it("maps restored spatial commands to bounded canonical intents", async () => {
    const invokeCapability = successfulCapabilityInvoker();
    const inspectCanvas = vi.fn(async () => ({
      scope: "all",
      roomId: "room-1",
      revision: 4,
      selectedObjectId: "note-selected",
      selectedObjectIds: ["note-selected", "note-second"],
      objects: [
        {
          id: "note-selected",
          type: "note",
          version: 3,
          spatial: {
            x: 100,
            y: 100,
            width: 280,
            height: 190,
            zIndex: 2,
            rotation: 0,
          },
          state: { minimized: false, pinned: false, parentId: null },
        },
        {
          id: "note-second",
          type: "note",
          version: 2,
          spatial: {
            x: 420,
            y: 100,
            width: 280,
            height: 190,
            zIndex: 3,
            rotation: 0,
          },
          state: { minimized: false, pinned: false, parentId: null },
        },
      ],
      receipts: [],
      truncation: { objects: { total: 2, returned: 2, omitted: 0 } },
    }));
    const options = { invokeCapability, inspectCanvas };

    const focused = await executeRealtimeVoiceTool(
      { name: "focus_selected", arguments: "{}" },
      vi.fn(),
      options,
    );
    await executeRealtimeVoiceTool(
      { name: "group_selected", arguments: "{}" },
      vi.fn(),
      options,
    );
    await executeRealtimeVoiceTool(
      { name: "finish_sketch", arguments: "{}" },
      vi.fn(),
      options,
    );
    await executeRealtimeVoiceTool(
      { name: "discard_selected", arguments: "{}" },
      vi.fn(),
      options,
    );
    await executeRealtimeVoiceTool(
      {
        name: "rotate_selected",
        arguments: '{"direction":"counterclockwise"}',
      },
      vi.fn(),
      options,
    );

    expect(invokeCapability).toHaveBeenNthCalledWith(
      1,
      "control_workspace",
      { action: "focus_selected" },
      expect.any(AbortSignal),
    );
    expect(focused).toMatchObject({
      ok: true,
      outcome: "submitted",
      message: "Applied.",
    });
    expect(invokeCapability).toHaveBeenNthCalledWith(
      2,
      "organize_objects",
      expect.objectContaining({
        action: "group",
        objectIds: ["note-selected", "note-second"],
      }),
      expect.any(AbortSignal),
    );
    expect(invokeCapability).toHaveBeenNthCalledWith(
      3,
      "control_workspace",
      { action: "finish_drawing" },
      expect.any(AbortSignal),
    );
    expect(invokeCapability).toHaveBeenNthCalledWith(
      4,
      "discard_object",
      { objectId: "note-selected", expectedVersion: 3 },
      expect.any(AbortSignal),
    );
    expect(invokeCapability).toHaveBeenNthCalledWith(
      5,
      "transform_object",
      {
        objectId: "note-selected",
        expectedVersion: 3,
        transform: { rotation: -15 },
      },
      expect.any(AbortSignal),
    );
  });

  it.each([
    ["create_semantic_object", '{"object":{"type":"note"}}'],
    ["open_sketch", '{"unexpected":true}'],
    ["undo", "not-json"],
    ["rotate_selected", '{"direction":"around"}'],
    ["send_meeting_packet", "{}"],
  ])(
    "refuses invalid or unsupported %s arguments without mutation",
    async (name, args) => {
      const onIntent = vi.fn();

      const result = await executeRealtimeVoiceTool(
        { name, arguments: args },
        onIntent,
      );

      expect(result.ok).toBe(false);
      expect(result.outcome).toBe("refused");
      expect(result.message).not.toContain(args);
      expect(onIntent).not.toHaveBeenCalled();
    },
  );

  it("returns the canonical refusal truthfully", async () => {
    const result = await executeRealtimeVoiceTool(
      { name: "transform_selected_sketch", arguments: "{}" },
      vi.fn(),
      {
        inspectCanvas: async () => ({
          scope: "selected",
          roomId: "room-1",
          revision: 1,
          selectedObjectId: "sketch-1",
          objects: [{ id: "sketch-1", type: "sketch", version: 1 }],
          receipts: [],
          truncation: {
            objects: { total: 1, returned: 1, omitted: 0 },
          },
        }),
        invokeCapability: async () => ({
          ok: false,
          code: "invalid_input",
          message: "Select an active sketch first.",
        }),
      },
    );

    expect(result).toEqual({
      ok: false,
      outcome: "refused",
      action: "transform_selected_sketch",
      message: "Select an active sketch first.",
    });
  });
});
