import { z } from "zod";

import type { DirectCanvasIntent } from "@/lib/canvas/direct-command";
import {
  newCanvasObjectSchema,
  type NewCanvasObject,
} from "@/lib/canvas/object-model";
import type { JsonValue } from "@/lib/webmcp/tool-catalog";

export type RealtimeVoiceIntentResult =
  | { ok: true; message: string }
  | {
      ok: false;
      message: string;
      thoughtCapture?: "aborted";
    };

export type RealtimeVoiceIntentHandler = (
  intent: DirectCanvasIntent,
  source: "voice",
  context?: RealtimeVoiceIntentContext,
) => RealtimeVoiceIntentResult | Promise<RealtimeVoiceIntentResult>;

export interface RealtimeVoiceIntentContext {
  signal: AbortSignal;
}

export interface RealtimeVoiceInspectInput {
  scope: "selected" | "all";
  includeReceipts: boolean;
}

export type RealtimeVoiceCanvasInspector = (
  input: RealtimeVoiceInspectInput,
  signal: AbortSignal,
) => JsonValue | Promise<JsonValue>;

export interface RealtimeVoiceToolExecutionOptions {
  signal?: AbortSignal;
  inspectCanvas?: RealtimeVoiceCanvasInspector;
}

export interface RealtimeVoiceToolCall {
  name: string;
  arguments: string;
}

export interface RealtimeVoiceToolResult {
  ok: boolean;
  outcome: "observed" | "submitted" | "refused" | "cancelled";
  action: string;
  message: string;
  data?: JsonValue;
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

const MAX_STANDARD_TOOL_ARGUMENT_CHARS = 8_192;
const MAX_SEMANTIC_OBJECT_ARGUMENT_CHARS = 32_768;

const emptyArgumentsSchema = z.object({}).strict();
const semanticObjectArgumentsSchema = z
  .object({ object: newCanvasObjectSchema })
  .strict();
const rotationArgumentsSchema = z
  .object({ direction: z.enum(["clockwise", "counterclockwise"]) })
  .strict();
const inspectArgumentsSchema = z
  .object({
    scope: z.enum(["selected", "all"]).default("selected"),
    includeReceipts: z.boolean().default(false),
  })
  .strict();

const inspectToolDefinition: RealtimeVoiceToolDefinition = {
  type: "function",
  name: "inspect_canvas",
  description:
    "Read the bounded semantic canvas selection or object list. Use once when resolving this or that, or when the user asks what is on the canvas.",
  parameters: {
    type: "object",
    properties: {
      scope: { type: "string", enum: ["selected", "all"] },
      includeReceipts: { type: "boolean" },
    },
    required: [],
    additionalProperties: false,
  },
};

const toolSpecifications = [
  {
    name: "create_semantic_object",
    description:
      "Create one fully specified semantic canvas object: note, task board, schedule, diagram, chart, data table, reference card, or meeting card. Use explicit world coordinates and inspect first when placement context is needed.",
    schema: semanticObjectArgumentsSchema,
    parameters: z.toJSONSchema(
      semanticObjectArgumentsSchema,
    ) as RealtimeVoiceToolDefinition["parameters"],
    intent: (args: { object: NewCanvasObject }): DirectCanvasIntent => ({
      type: "create_semantic_object",
      object: args.object,
    }),
  },
  {
    name: "start_thought",
    description:
      "Create and select one thought card, then start automatic speech-to-text capture inside that card. Use only when the user explicitly asks to start or create a new thought.",
    schema: emptyArgumentsSchema,
    parameters: emptyJsonSchema(),
    intent: (): DirectCanvasIntent => ({ type: "start_thought" }),
  },
  {
    name: "finish_thought",
    description:
      "Stop automatic speech-to-text capture for the active thought card. Use only when the user explicitly asks to finish, end, or stop the thought.",
    schema: emptyArgumentsSchema,
    parameters: emptyJsonSchema(),
    intent: (): DirectCanvasIntent => ({ type: "finish_thought" }),
  },
  {
    name: "open_sketch",
    description: "Start a tracked-hand drawing when hand input is ready, otherwise open the pointer, touch, and stylus drawing surface.",
    schema: emptyArgumentsSchema,
    parameters: emptyJsonSchema(),
    intent: (): DirectCanvasIntent => ({ type: "open_sketch" }),
  },
  {
    name: "finish_sketch",
    description: "Finish the current tracked-hand sketch and preserve it as one selectable canvas object.",
    schema: emptyArgumentsSchema,
    parameters: emptyJsonSchema(),
    intent: (): DirectCanvasIntent => ({ type: "finish_sketch" }),
  },
  {
    name: "cancel_sketch",
    description: "Cancel the current unfinished drawing without creating a canvas object.",
    schema: emptyArgumentsSchema,
    parameters: emptyJsonSchema(),
    intent: (): DirectCanvasIntent => ({ type: "cancel_sketch" }),
  },
  {
    name: "transform_selected_sketch",
    description: "Turn the currently selected sketch into the appropriate clean structured visual while preserving the original.",
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
    name: "discard_selected",
    description: "Move the selected object to recoverable trash. The mutation is receipted and can be undone.",
    schema: emptyArgumentsSchema,
    parameters: emptyJsonSchema(),
    intent: (): DirectCanvasIntent => ({ type: "discard_selected" }),
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
  [
    inspectToolDefinition,
    ...toolSpecifications.map(({ name, description, parameters }) => ({
      type: "function" as const,
      name,
      description,
      parameters,
    })),
  ];

export const REALTIME_VOICE_INSTRUCTIONS =
  "You are CommandCanvas live voice. Be brief. Use only the provided bounded canvas tools. Inspect the canvas once when resolving this or that, when asked what is on the canvas, or before choosing open world coordinates. Do not browse the web. Use create_semantic_object for every standalone note, task board, schedule, diagram, chart, data table, reference card, decision, action item, summary, risk, or open-question card. For a direct creation request, call create_semantic_object without inspecting the canvas first. If you already inspected for a creation request, continue in the same response by calling create_semantic_object before confirming anything to the user. Do not force requests into an architecture diagram. When the user explicitly says start a thought or new thought, call start_thought once. After it is submitted, CommandCanvas automatically places later completed user speech inside that selected thought card; do not create another object for each sentence. While thought capture is active, treat all user speech as dictated thought content and do not call any other canvas tool. When the user explicitly says finish thought, call finish_thought once; only then resume normal canvas tools. Never operate rooms, approve packets, or send email. Use discard_selected only when the user explicitly asks to discard, delete, trash, throw away, or get rid of the selected object; it goes to recoverable trash and remains undoable. Except for local viewport focus, a tool result with outcome submitted means the action entered CommandCanvas's canonical mutation pipeline; it is not proof that the change persisted. Say submitted, not created, saved, persisted, or completed. Ask the user to select a target when a selected-object tool is refused.";

export function createRealtimeVoiceSessionConfig() {
  return {
    type: "realtime",
    model: "gpt-realtime-2.1",
    // The Realtime contract permits audio or text output, not both. Audio
    // output includes an assistant transcript event for the command rail.
    output_modalities: ["audio"],
    instructions: REALTIME_VOICE_INSTRUCTIONS,
    max_output_tokens: 4_096,
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
  options: RealtimeVoiceToolExecutionOptions = {},
): Promise<RealtimeVoiceToolResult> {
  const action = safeActionName(call.name);
  if (options.signal?.aborted) return cancelled(action);
  if (call.name === "inspect_canvas") {
    if (call.arguments.length > MAX_STANDARD_TOOL_ARGUMENT_CHARS)
      return invalidArguments(action);
    let rawArguments: unknown;
    try {
      rawArguments = JSON.parse(call.arguments);
    } catch {
      return invalidArguments(action);
    }
    const parsed = inspectArgumentsSchema.safeParse(rawArguments);
    if (!parsed.success) return invalidArguments(action);
    if (!options.inspectCanvas)
      return {
        ok: false,
        outcome: "refused",
        action,
        message: "Canvas inspection is unavailable in this voice session.",
      };
    const signal = options.signal ?? new AbortController().signal;
    try {
      const data = await options.inspectCanvas(parsed.data, signal);
      return {
        ok: true,
        outcome: "observed",
        action,
        message: "Current semantic canvas context observed.",
        data,
      };
    } catch (error) {
      return signal.aborted || isAbortError(error)
        ? cancelled(action)
        : {
            ok: false,
            outcome: "refused",
            action,
            message: "Canvas inspection is unavailable in this voice session.",
          };
    }
  }
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
  const argumentLimit =
    call.name === "create_semantic_object"
      ? MAX_SEMANTIC_OBJECT_ARGUMENT_CHARS
      : MAX_STANDARD_TOOL_ARGUMENT_CHARS;
  if (call.arguments.length > argumentLimit)
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
      ...(options.signal ? [{ signal: options.signal }] : []),
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
  } catch (error) {
    if (options.signal?.aborted || isAbortError(error)) return cancelled(action);
    return {
      ok: false,
      outcome: "refused",
      action,
      message: "The canvas action could not be submitted.",
    };
  }
}

function cancelled(action: string): RealtimeVoiceToolResult {
  return {
    ok: false,
    outcome: "cancelled",
    action,
    message: "Voice action cancelled before the canvas confirmed it.",
  };
}

function isAbortError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  );
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
