import { z } from "zod";

import type { DirectCanvasIntent } from "@/lib/canvas/direct-command";

export type RealtimeVoiceIntentResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

export type RealtimeVoiceIntentHandler = (
  intent: DirectCanvasIntent,
  source: "voice",
) => RealtimeVoiceIntentResult | Promise<RealtimeVoiceIntentResult>;

export interface RealtimeVoiceToolCall {
  name: string;
  arguments: string;
}

export interface RealtimeVoiceToolResult {
  ok: boolean;
  outcome: "submitted" | "refused";
  action: string;
  message: string;
}

interface RealtimeVoiceToolDefinition {
  type: "function";
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required: readonly string[];
    additionalProperties: false;
  };
}

const emptyArgumentsSchema = z.object({}).strict();
const noteArgumentsSchema = z
  .object({ text: z.string().trim().min(1).max(4_000).optional() })
  .strict();
const rotationArgumentsSchema = z
  .object({ direction: z.enum(["clockwise", "counterclockwise"]) })
  .strict();

const toolSpecifications = [
  {
    name: "create_note",
    description: "Create one note on the live canvas. Use text only when the user supplied note content.",
    schema: noteArgumentsSchema,
    parameters: {
      type: "object" as const,
      properties: {
        text: {
          type: "string",
          minLength: 1,
          maxLength: 4_000,
          description: "Optional note text copied from the user's request.",
        },
      },
      required: [],
      additionalProperties: false as const,
    },
    intent: (args: { text?: string }): DirectCanvasIntent => ({
      type: "create_note",
      ...(args.text ? { text: args.text } : {}),
    }),
  },
  {
    name: "create_board",
    description: "Create the project task board in open canvas space.",
    schema: emptyArgumentsSchema,
    parameters: emptyJsonSchema(),
    intent: (): DirectCanvasIntent => ({ type: "create_board" }),
  },
  {
    name: "create_schedule",
    description: "Create the next-week schedule in open canvas space.",
    schema: emptyArgumentsSchema,
    parameters: emptyJsonSchema(),
    intent: (): DirectCanvasIntent => ({ type: "create_schedule" }),
  },
  {
    name: "open_sketch",
    description: "Open the drawing surface so the user can draw a rough sketch.",
    schema: emptyArgumentsSchema,
    parameters: emptyJsonSchema(),
    intent: (): DirectCanvasIntent => ({ type: "open_sketch" }),
  },
  {
    name: "transform_selected_sketch",
    description: "Turn the currently selected sketch into a structured diagram while preserving the original.",
    schema: emptyArgumentsSchema,
    parameters: emptyJsonSchema(),
    intent: (): DirectCanvasIntent => ({ type: "transform_selected_sketch" }),
  },
  {
    name: "pin_selected",
    description: "Pin the currently selected canvas object.",
    schema: emptyArgumentsSchema,
    parameters: emptyJsonSchema(),
    intent: (): DirectCanvasIntent => ({ type: "pin_selected" }),
  },
  {
    name: "unpin_selected",
    description: "Unpin the currently selected canvas object.",
    schema: emptyArgumentsSchema,
    parameters: emptyJsonSchema(),
    intent: (): DirectCanvasIntent => ({ type: "unpin_selected" }),
  },
  {
    name: "minimize_selected",
    description: "Minimize the currently selected canvas object into its compact chip.",
    schema: emptyArgumentsSchema,
    parameters: emptyJsonSchema(),
    intent: (): DirectCanvasIntent => ({ type: "minimize_selected" }),
  },
  {
    name: "restore_selected",
    description: "Restore the currently selected minimized canvas object.",
    schema: emptyArgumentsSchema,
    parameters: emptyJsonSchema(),
    intent: (): DirectCanvasIntent => ({ type: "restore_selected" }),
  },
  {
    name: "undo",
    description: "Undo the latest reversible canvas mutation.",
    schema: emptyArgumentsSchema,
    parameters: emptyJsonSchema(),
    intent: (): DirectCanvasIntent => ({ type: "undo" }),
  },
  {
    name: "redo",
    description: "Redo the latest canvas mutation that was undone.",
    schema: emptyArgumentsSchema,
    parameters: emptyJsonSchema(),
    intent: (): DirectCanvasIntent => ({ type: "redo" }),
  },
  {
    name: "focus_selected",
    description: "Maximize the selected object in the local viewport without changing shared object state.",
    schema: emptyArgumentsSchema,
    parameters: emptyJsonSchema(),
    intent: (): DirectCanvasIntent => ({ type: "focus_selected" }),
  },
  {
    name: "group_selected",
    description: "Group the currently multi-selected objects into one semantic frame.",
    schema: emptyArgumentsSchema,
    parameters: emptyJsonSchema(),
    intent: (): DirectCanvasIntent => ({ type: "group_selected" }),
  },
  {
    name: "ungroup_selected",
    description: "Ungroup the selected semantic frame and keep its child objects.",
    schema: emptyArgumentsSchema,
    parameters: emptyJsonSchema(),
    intent: (): DirectCanvasIntent => ({ type: "ungroup_selected" }),
  },
  {
    name: "rotate_selected",
    description: "Rotate the selected object by 15 degrees clockwise or counterclockwise.",
    schema: rotationArgumentsSchema,
    parameters: {
      type: "object" as const,
      properties: {
        direction: {
          type: "string",
          enum: ["clockwise", "counterclockwise"],
          description: "Direction of the 15 degree rotation.",
        },
      },
      required: ["direction"],
      additionalProperties: false as const,
    },
    intent: (args: {
      direction: "clockwise" | "counterclockwise";
    }): DirectCanvasIntent => ({
      type: "rotate_selected",
      direction: args.direction,
    }),
  },
] as const;

export const REALTIME_VOICE_TOOL_DEFINITIONS: readonly RealtimeVoiceToolDefinition[] =
  toolSpecifications.map(({ name, description, parameters }) => ({
    type: "function",
    name,
    description,
    parameters,
  }));

export const REALTIME_VOICE_INSTRUCTIONS =
  "You are CommandCanvas live voice. Be brief. Use only the provided bounded canvas tools. Never discard objects, operate rooms, approve packets, or send email. Except for local viewport focus, a tool result with outcome submitted means the action entered CommandCanvas's canonical mutation pipeline; it is not proof that the change persisted. Say submitted, not created, saved, persisted, or completed. Ask the user to select a target when a selected-object tool is refused.";

export function createRealtimeVoiceSessionConfig() {
  return {
    type: "realtime",
    model: "gpt-realtime-2.1",
    // The Realtime contract permits audio or text output, not both. Audio
    // output includes an assistant transcript event for the command rail.
    output_modalities: ["audio"],
    instructions: REALTIME_VOICE_INSTRUCTIONS,
    max_output_tokens: 256,
    parallel_tool_calls: false,
    audio: {
      input: {
        transcription: { model: "gpt-live-transcribe" },
        turn_detection: {
          type: "semantic_vad",
          eagerness: "auto",
          create_response: true,
          interrupt_response: true,
        },
      },
      output: { voice: "marin" },
    },
    tools: REALTIME_VOICE_TOOL_DEFINITIONS,
    tool_choice: "auto",
  } as const;
}

export async function executeRealtimeVoiceTool(
  call: RealtimeVoiceToolCall,
  onIntent: RealtimeVoiceIntentHandler,
): Promise<RealtimeVoiceToolResult> {
  const action = safeActionName(call.name);
  const specification = toolSpecifications.find(
    (candidate) => candidate.name === call.name,
  );
  if (!specification)
    return {
      ok: false,
      outcome: "refused",
      action,
      message: "That voice action is not available.",
    };
  if (call.arguments.length > 8_192)
    return invalidArguments(action);

  let rawArguments: unknown;
  try {
    rawArguments = JSON.parse(call.arguments);
  } catch {
    return invalidArguments(action);
  }
  const parsed = specification.schema.safeParse(rawArguments);
  if (!parsed.success) return invalidArguments(action);

  try {
    const result = await onIntent(
      // The specification's schema and intent factory are kept together above.
      specification.intent(parsed.data as never),
      "voice",
    );
    return {
      ok: result.ok,
      outcome: result.ok ? "submitted" : "refused",
      action,
      message: result.ok
        ? call.name === "focus_selected"
          ? "Local canvas focus applied; shared state did not change."
          : "Canvas action submitted; check the canvas receipt for the result."
        : result.message,
    };
  } catch {
    return {
      ok: false,
      outcome: "refused",
      action,
      message: "The canvas action could not be submitted.",
    };
  }
}

function emptyJsonSchema() {
  return {
    type: "object" as const,
    properties: {},
    required: [],
    additionalProperties: false as const,
  };
}

function invalidArguments(action: string): RealtimeVoiceToolResult {
  return {
    ok: false,
    outcome: "refused",
    action,
    message: "Voice action arguments were invalid.",
  };
}

function safeActionName(name: string) {
  return /^[a-z][a-z0-9_]{0,63}$/.test(name) ? name : "unknown_action";
}
