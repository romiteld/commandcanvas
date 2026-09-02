import { z } from "zod";

import {
  REALTIME_CAPABILITY_ALIASES,
  projectRealtimeCapabilityTools,
  type CanvasCapabilityName,
} from "@/lib/canvas/capability-catalog";
import type { DirectCanvasIntent } from "@/lib/canvas/direct-command";
import {
  newCanvasObjectSchema,
  type NewCanvasObject,
} from "@/lib/canvas/object-model";
import type { JsonValue } from "@/lib/webmcp/tool-catalog";
import type { WebMcpToolResult } from "@/lib/webmcp/tool-catalog";

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
  invokeCapability?: RealtimeVoiceCapabilityInvoker;
}

export type RealtimeVoiceCapabilityInvoker = (
  capability: CanvasCapabilityName,
  input: unknown,
  signal: AbortSignal,
) => Promise<WebMcpToolResult>;

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
const compactTitleSchema = z.string().trim().min(1).max(120);
const compactKeySchema = z
  .string()
  .min(2)
  .max(96)
  .regex(/^[a-z][a-z0-9-]*$/);
const compactCreateNoteArgumentsSchema = z
  .object({ text: z.string().trim().min(1).max(4_000).optional() })
  .strict();
const compactBoardTaskSchema = z
  .object({
    title: z.string().trim().min(1).max(180),
    owner: z.string().trim().min(1).max(80).optional(),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    priority: z.enum(["low", "medium", "high"]).optional(),
  })
  .strict();
const compactCreateBoardArgumentsSchema = z
  .object({
    title: compactTitleSchema,
    columns: z
      .array(
        z
          .object({
            title: z.string().trim().min(1).max(60),
            tasks: z.array(compactBoardTaskSchema).max(24),
          })
          .strict(),
      )
      .min(1)
      .max(5),
  })
  .strict();
const compactScheduleEntrySchema = z
  .object({
    time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    title: z.string().trim().min(1).max(180),
    owner: z.string().trim().min(1).max(80).optional(),
  })
  .strict();
const compactCreateScheduleArgumentsSchema = z
  .object({
    title: compactTitleSchema,
    timezone: z.string().trim().min(1).max(80),
    days: z
      .array(
        z
          .object({
            date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
            label: z.string().trim().min(1).max(30),
            entries: z.array(compactScheduleEntrySchema).max(16),
          })
          .strict(),
      )
      .min(1)
      .max(14),
  })
  .strict();
const appendSelectedNoteArgumentsSchema = z
  .object({ text: z.string().trim().min(1).max(1_000) })
  .strict();
const compactDiagramArgumentsSchema = z
  .object({
    title: compactTitleSchema,
    kind: z.enum(["architecture", "flowchart", "diagram"]),
    summary: z.string().trim().min(1).max(600),
    nodes: z
      .array(
        z
          .object({
            key: compactKeySchema,
            label: z.string().trim().min(1).max(120),
            kind: z.enum([
              "client",
              "service",
              "database",
              "queue",
              "external",
              "concept",
              "process",
              "decision",
            ]),
          })
          .strict(),
      )
      .min(1)
      .max(30),
    edges: z
      .array(
        z
          .object({
            from: compactKeySchema,
            to: compactKeySchema,
            label: z.string().trim().min(1).max(100).optional(),
          })
          .strict(),
      )
      .max(60)
      .default([]),
  })
  .strict()
  .superRefine((value, context) => {
    const keys = new Set(value.nodes.map((node) => node.key));
    if (keys.size !== value.nodes.length)
      context.addIssue({
        code: "custom",
        path: ["nodes"],
        message: "Node keys must be unique.",
      });
    value.edges.forEach((edge, index) => {
      if (!keys.has(edge.from) || !keys.has(edge.to))
        context.addIssue({
          code: "custom",
          path: ["edges", index],
          message: "Edges must reference node keys from this diagram.",
        });
    });
  });
const compactChartPointSchema = z
  .object({
    label: z.string().trim().min(1).max(80),
    value: z.number().finite().min(-1_000_000_000_000).max(1_000_000_000_000),
  })
  .strict();
const compactChartArgumentsSchema = z
  .object({
    title: compactTitleSchema,
    kind: z.enum(["pie_chart", "bar_chart", "line_chart"]),
    summary: z.string().trim().min(1).max(600).optional(),
    xAxisLabel: z.string().trim().min(1).max(80).nullable().optional(),
    yAxisLabel: z.string().trim().min(1).max(80).nullable().optional(),
    series: z
      .array(
        z
          .object({
            label: z.string().trim().min(1).max(80),
            points: z.array(compactChartPointSchema).min(1).max(24),
          })
          .strict(),
      )
      .min(1)
      .max(6),
  })
  .strict();
const compactTableCellSchema = z.union([
  z.string().max(500),
  z.number().finite().min(-1_000_000_000_000).max(1_000_000_000_000),
  z.boolean(),
  z.null(),
]);
const compactDataTableArgumentsSchema = z
  .object({
    title: compactTitleSchema,
    columns: z
      .array(
        z
          .object({
            label: z.string().trim().min(1).max(80),
            kind: z.enum(["text", "number", "currency", "percentage", "date"]),
          })
          .strict(),
      )
      .min(1)
      .max(12),
    rows: z.array(z.array(compactTableCellSchema).max(12)).max(50),
  })
  .strict()
  .superRefine((value, context) => {
    value.rows.forEach((row, index) => {
      if (row.length !== value.columns.length)
        context.addIssue({
          code: "custom",
          path: ["rows", index],
          message: "Every row needs one cell per column.",
        });
    });
  });
const compactReferenceArgumentsSchema = z
  .object({
    title: compactTitleSchema,
    kind: z.enum(["article", "document", "image", "link"]),
    sourceUrl: z.url().max(2_048).nullable().optional(),
    summary: z.string().trim().min(1).max(1_200),
    excerpt: z.string().trim().min(1).max(1_200).nullable().optional(),
  })
  .strict();
const compactMeetingCardArgumentsSchema = z
  .object({
    title: compactTitleSchema,
    kind: z.enum(["decision", "action_item", "summary", "risk", "open_question"]),
    body: z.string().trim().min(1).max(4_000),
    bullets: z.array(z.string().trim().min(1).max(300)).max(20).default([]),
    owner: z.string().trim().min(1).max(80).nullable().optional(),
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    status: z
      .enum(["proposed", "confirmed", "open", "in_progress", "done", "blocked"])
      .optional(),
  })
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

const toolSpecifications = [
  {
    name: "create_semantic_object",
    description:
      "Advanced compatibility tool for a caller that already has one fully specified semantic canvas object, including spatial geometry. Prefer the compact type-specific creation tools for ordinary spoken requests.",
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
    name: "create_note",
    description:
      "Create one note card. Use for a standalone note with optional initial text. Use start_thought instead when the user wants continuing speech-to-text inside the new card.",
    schema: compactCreateNoteArgumentsSchema,
    parameters: z.toJSONSchema(
      compactCreateNoteArgumentsSchema,
    ) as RealtimeVoiceToolDefinition["parameters"],
    intent: (args: z.infer<typeof compactCreateNoteArgumentsSchema>): DirectCanvasIntent =>
      args.text
        ? { type: "create_note", text: args.text }
        : { type: "create_note" },
  },
  {
    name: "create_board",
    description:
      "Create a project or task board in the current canvas viewport. Preserve the user's title, columns, tasks, owners, dates, and priorities instead of inventing canned launch content.",
    schema: compactCreateBoardArgumentsSchema,
    parameters: z.toJSONSchema(
      compactCreateBoardArgumentsSchema,
    ) as RealtimeVoiceToolDefinition["parameters"],
    intent: compactBoardIntent,
  },
  {
    name: "create_schedule",
    description:
      "Create a schedule or calendar in the current canvas viewport. Preserve the requested title, timezone, dates, commitments, times, and owners.",
    schema: compactCreateScheduleArgumentsSchema,
    parameters: z.toJSONSchema(
      compactCreateScheduleArgumentsSchema,
    ) as RealtimeVoiceToolDefinition["parameters"],
    intent: compactScheduleIntent,
  },
  {
    name: "create_diagram",
    description:
      "Create a structured architecture diagram, flowchart, or general node diagram. Supply semantic nodes and edges; CommandCanvas assigns spatial geometry.",
    schema: compactDiagramArgumentsSchema,
    parameters: z.toJSONSchema(
      compactDiagramArgumentsSchema,
    ) as RealtimeVoiceToolDefinition["parameters"],
    intent: compactDiagramIntent,
  },
  {
    name: "create_chart",
    description:
      "Create a pie, bar, or line chart from labeled numeric values. CommandCanvas assigns spatial geometry and internal IDs.",
    schema: compactChartArgumentsSchema,
    parameters: z.toJSONSchema(
      compactChartArgumentsSchema,
    ) as RealtimeVoiceToolDefinition["parameters"],
    intent: compactChartIntent,
  },
  {
    name: "create_data_table",
    description:
      "Create a structured data table from labeled columns and row values. CommandCanvas assigns spatial geometry and internal IDs.",
    schema: compactDataTableArgumentsSchema,
    parameters: z.toJSONSchema(
      compactDataTableArgumentsSchema,
    ) as RealtimeVoiceToolDefinition["parameters"],
    intent: compactDataTableIntent,
  },
  {
    name: "create_reference_card",
    description:
      "Create an article, document, image, or link reference card from information already present in the conversation. This tool does not browse or retrieve a URL.",
    schema: compactReferenceArgumentsSchema,
    parameters: z.toJSONSchema(
      compactReferenceArgumentsSchema,
    ) as RealtimeVoiceToolDefinition["parameters"],
    intent: compactReferenceIntent,
  },
  {
    name: "create_meeting_card",
    description:
      "Create a decision, action item, summary, risk, or open-question card from the user's spoken content.",
    schema: compactMeetingCardArgumentsSchema,
    parameters: z.toJSONSchema(
      compactMeetingCardArgumentsSchema,
    ) as RealtimeVoiceToolDefinition["parameters"],
    intent: compactMeetingCardIntent,
  },
  {
    name: "append_selected_note",
    description:
      "Append the user's dictated text to the currently selected note or thought card. Inspect the selected object first when the user says this or that.",
    schema: appendSelectedNoteArgumentsSchema,
    parameters: z.toJSONSchema(
      appendSelectedNoteArgumentsSchema,
    ) as RealtimeVoiceToolDefinition["parameters"],
    intent: (args: z.infer<typeof appendSelectedNoteArgumentsSchema>): DirectCanvasIntent => ({
      type: "append_selected_note",
      text: args.text,
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
  projectRealtimeCapabilityTools();

export const REALTIME_VOICE_INSTRUCTIONS =
  "You are CommandCanvas live voice. Be brief. Use only the provided bounded canvas tools. Inspect the canvas once when resolving this or that or when asked what is on the canvas. Do not browse the web. For ordinary creation requests, use the matching compact tool: create_note, create_board, create_schedule, create_diagram, create_chart, create_data_table, create_reference_card, or create_meeting_card. Call that creation tool immediately without inspecting first; the compact tool assigns initial canvas geometry. Use create_semantic_object only as an advanced compatibility path when you already have a complete spatial object. If you already inspected for a creation request, continue in the same response by calling the matching creation tool before confirming anything to the user. Do not force requests into an architecture diagram: create the diagram, chart, table, reference, note, board, schedule, decision, action item, summary, risk, or open question the user actually requested. For fill, add, append, or update language about this note or thought, inspect the selected object and then call append_selected_note with only the content to add. When the user explicitly says start a thought or new thought, call start_thought once. After it is submitted, CommandCanvas automatically places later completed user speech inside that selected thought card; do not create another object for each sentence. While thought capture is active, treat all user speech as dictated thought content and do not call any other canvas tool. When the user explicitly says finish thought, call finish_thought once; only then resume normal canvas tools. You may prepare a packet draft and request that an already approved packet be staged for delivery, but you can never approve a packet or execute email; the host must review the exact recipients and press SEND in the CommandCanvas UI. Never operate rooms. Use discard_selected only when the user explicitly asks to discard, delete, trash, throw away, or get rid of the selected object; it goes to recoverable trash and remains undoable. Except for local viewport controls, a tool result with outcome submitted means the action entered CommandCanvas's canonical mutation pipeline; it is not proof that the change persisted. Say submitted, not created, saved, persisted, or completed. Ask the user to select a target when a selected-object tool is refused.";

export const REALTIME_VOICE_MODELS = [
  "gpt-realtime-2.1",
  "gpt-realtime-mini",
] as const;

export type RealtimeVoiceModel = (typeof REALTIME_VOICE_MODELS)[number];

const realtimeVoiceModelSchema = z.enum(REALTIME_VOICE_MODELS);

export function createRealtimeVoiceSessionConfig(
  modelPreference: unknown = "gpt-realtime-2.1",
) {
  const model = realtimeVoiceModelSchema.safeParse(modelPreference);
  if (!model.success)
    throw new Error(
      "Unsupported Realtime model preference. Choose gpt-realtime-2.1 or gpt-realtime-mini explicitly.",
    );
  return {
    type: "realtime",
    model: model.data,
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
  const capabilityAlias = REALTIME_CAPABILITY_ALIASES.find(
    (candidate) => candidate.name === call.name,
  );
  if (capabilityAlias && !capabilityAlias.localIntent && options.invokeCapability)
    return executeCanonicalRealtimeCapability(
      capabilityAlias,
      call,
      options,
      action,
    );
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

  let intent: DirectCanvasIntent;
  try {
    // The specification's schema and intent factory are kept together above.
    intent = specification.intent(parsed.data as never);
  } catch {
    return invalidArguments(action);
  }

  try {
    const result = await onIntent(
      intent,
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

async function executeCanonicalRealtimeCapability(
  alias: (typeof REALTIME_CAPABILITY_ALIASES)[number],
  call: RealtimeVoiceToolCall,
  options: RealtimeVoiceToolExecutionOptions,
  action: string,
): Promise<RealtimeVoiceToolResult> {
  const limit =
    call.name === "create_semantic_object"
      ? MAX_SEMANTIC_OBJECT_ARGUMENT_CHARS
      : MAX_STANDARD_TOOL_ARGUMENT_CHARS;
  if (call.arguments.length > limit) return invalidArguments(action);
  let rawArguments: unknown;
  try {
    rawArguments = JSON.parse(call.arguments);
  } catch {
    return invalidArguments(action);
  }
  const parsed = alias.inputSchema.safeParse(rawArguments);
  if (!parsed.success) return invalidArguments(action);
  const signal = options.signal ?? new AbortController().signal;
  try {
    let input = alias.normalize(parsed.data);
    input = await resolveSelectedCapabilityInput(
      alias.capability,
      input,
      options.inspectCanvas,
      signal,
    );
    const result = await options.invokeCapability!(
      alias.capability,
      input,
      signal,
    );
    if (!result.ok)
      return {
        ok: false,
        outcome: "refused",
        action,
        message: result.message,
      };
    return {
      ok: true,
      outcome:
        alias.capability === "get_canvas_state" ? "observed" : "submitted",
      action,
      message:
        result.status === "awaiting_human_approval"
          ? "Packet send request staged for explicit host SEND confirmation."
          : alias.capability === "control_workspace"
            ? result.message
            : alias.capability === "get_canvas_state"
              ? "Current semantic canvas context observed."
              : "Canvas action submitted; check the canvas receipt for the result.",
      ...(result.data ? { data: result.data } : {}),
    };
  } catch (error) {
    if (error instanceof RealtimeCapabilityRefusal)
      return {
        ok: false,
        outcome: "refused",
        action,
        message: error.message,
      };
    return signal.aborted || isAbortError(error)
      ? cancelled(action)
      : {
          ok: false,
          outcome: "refused",
          action,
          message: "The canvas action could not be submitted.",
        };
  }
}

async function resolveSelectedCapabilityInput(
  capability: CanvasCapabilityName,
  rawInput: unknown,
  inspectCanvas: RealtimeVoiceCanvasInspector | undefined,
  signal: AbortSignal,
): Promise<unknown> {
  if (
    capability !== "transform_object" &&
    capability !== "set_object_state" &&
    capability !== "discard_object" &&
    capability !== "transform_sketch" &&
    capability !== "organize_objects"
  )
    return rawInput;
  const input = rawInput as Record<string, unknown>;
  if (
    capability === "organize_objects" &&
    (input.action === "group" || input.action === "ungroup")
  )
    return input;
  const targetKey = capability === "transform_sketch" ? "sketchId" : "objectId";
  if (capability !== "organize_objects" && typeof input[targetKey] === "string")
    return input;
  if (!inspectCanvas)
    throw new RealtimeCapabilityRefusal(
      "Canvas selection inspection is unavailable.",
    );
  const projection = await inspectCanvas(
    {
      scope:
        capability === "organize_objects" && input.action === "group_selected"
          ? "all"
          : "selected",
      includeReceipts: false,
    },
    signal,
  );
  const projectionRecord = jsonRecord(projection);
  const selectedObjectId =
    typeof projectionRecord?.selectedObjectId === "string"
      ? projectionRecord.selectedObjectId
      : null;
  if (!selectedObjectId)
    throw new RealtimeCapabilityRefusal("Select an active object first.");

  if (capability === "organize_objects") {
    if (input.action === "ungroup_selected")
      return { action: "ungroup", frameId: selectedObjectId };
    if (input.action !== "group_selected") return input;
    return createSelectedGroupInput(projectionRecord);
  }

  if (
    capability === "transform_object" &&
    (input.rotateDirection === "clockwise" ||
      input.rotateDirection === "counterclockwise")
  ) {
    const selected = selectedObjectSummary(projectionRecord, selectedObjectId);
    if (!selected)
      throw new RealtimeCapabilityRefusal("Select an active object first.");
    const currentRotation = numberField(selected.spatial, "rotation") ?? 0;
    const delta = input.rotateDirection === "clockwise" ? 15 : -15;
    return {
      objectId: selectedObjectId,
      transform: { rotation: wrapRotation(currentRotation + delta) },
    };
  }
  return { ...input, [targetKey]: selectedObjectId };
}

function createSelectedGroupInput(
  projection: Record<string, JsonValue> | null,
): unknown {
  const selectedObjectIds = Array.isArray(projection?.selectedObjectIds)
    ? projection.selectedObjectIds.filter(
        (value): value is string => typeof value === "string",
      )
    : [];
  const summaries = selectedObjectIds.flatMap((objectId) => {
    const object = selectedObjectSummary(projection, objectId);
    return object ? [object] : [];
  });
  const groupable = summaries.filter(
    (object) =>
      object.state?.pinned === false && object.state?.parentId === null,
  );
  if (groupable.length < 2 || groupable.length !== selectedObjectIds.length)
    throw new RealtimeCapabilityRefusal(
      "Select at least two unpinned top-level objects first.",
    );

  const left = Math.min(...groupable.map((object) => numberField(object.spatial, "x")!));
  const top = Math.min(...groupable.map((object) => numberField(object.spatial, "y")!));
  const right = Math.max(
    ...groupable.map(
      (object) =>
        numberField(object.spatial, "x")! +
        numberField(object.spatial, "width")!,
    ),
  );
  const bottom = Math.max(
    ...groupable.map(
      (object) =>
        numberField(object.spatial, "y")! +
        numberField(object.spatial, "height")!,
    ),
  );
  const zIndex = Math.min(
    ...groupable.map((object) => numberField(object.spatial, "zIndex")!),
  );
  const padding = 44;
  return {
    action: "group",
    objectIds: selectedObjectIds,
    frame: {
      id: createRealtimeObjectId("frame"),
      title: `Frame ${(numberField(projection, "revision") ?? 0) + 1}`,
      x: left - padding,
      y: top - padding,
      width: right - left + padding * 2,
      height: bottom - top + padding * 2,
      zIndex: Math.max(0, zIndex - 1),
      tone: "violet",
    },
  };
}

function selectedObjectSummary(
  projection: Record<string, JsonValue> | null,
  objectId: string,
) {
  if (!Array.isArray(projection?.objects)) return null;
  for (const value of projection.objects) {
    const object = jsonRecord(value);
    if (object?.id !== objectId) continue;
    const spatial = jsonRecord(object.spatial);
    const state = jsonRecord(object.state);
    if (
      !spatial ||
      !state ||
      numberField(spatial, "x") === null ||
      numberField(spatial, "y") === null ||
      numberField(spatial, "width") === null ||
      numberField(spatial, "height") === null ||
      numberField(spatial, "zIndex") === null
    )
      return null;
    return { spatial, state };
  }
  return null;
}

function jsonRecord(value: JsonValue | undefined) {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : null;
}

function numberField(
  value: Record<string, JsonValue> | null,
  key: string,
) {
  const field = value?.[key];
  return typeof field === "number" && Number.isFinite(field) ? field : null;
}

function wrapRotation(rotation: number) {
  if (rotation > 180) return rotation - 360;
  if (rotation < -180) return rotation + 360;
  return rotation;
}

function createRealtimeObjectId(prefix: string) {
  const suffix = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`;
  return `${prefix}-${suffix}`;
}

class RealtimeCapabilityRefusal extends Error {}

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

function compactDiagramIntent(
  args: z.infer<typeof compactDiagramArgumentsSchema>,
): DirectCanvasIntent {
  const rows = Math.ceil(args.nodes.length / 3);
  return semanticObjectIntent({
    ...compactSpatialFields("diagram", args.title, 720, Math.max(420, rows * 130 + 100)),
    type: "diagram",
    payload: {
      kind: args.kind,
      interpretationSummary: args.summary,
      nodes: args.nodes.map((node, index) => ({
        id: node.key,
        label: node.label,
        kind: node.kind,
        x: 60 + (index % 3) * 220,
        y: 60 + Math.floor(index / 3) * 130,
        width: 170,
        height: 72,
      })),
      edges: args.edges.map((edge) => ({
        id: createVoiceObjectId("edge"),
        from: edge.from,
        to: edge.to,
        ...(edge.label ? { label: edge.label } : {}),
      })),
    },
  });
}

function compactBoardIntent(
  args: z.infer<typeof compactCreateBoardArgumentsSchema>,
): DirectCanvasIntent {
  return semanticObjectIntent({
    ...compactSpatialFields("board", args.title, 560, 320),
    type: "task_board",
    payload: {
      columns: args.columns.map((column) => ({
        id: createVoiceObjectId("column"),
        title: column.title,
        tasks: column.tasks.map((task) => ({
          id: createVoiceObjectId("task"),
          title: task.title,
          ...(task.owner ? { owner: task.owner } : {}),
          ...(task.dueDate ? { dueDate: task.dueDate } : {}),
          ...(task.priority ? { priority: task.priority } : {}),
        })),
      })),
    },
  });
}

function compactScheduleIntent(
  args: z.infer<typeof compactCreateScheduleArgumentsSchema>,
): DirectCanvasIntent {
  return semanticObjectIntent({
    ...compactSpatialFields("schedule", args.title, 460, 310),
    type: "schedule",
    payload: {
      timezone: args.timezone,
      days: args.days.map((day) => ({
        date: day.date,
        label: day.label,
        entries: day.entries.map((entry) => ({
          id: createVoiceObjectId("schedule-entry"),
          time: entry.time,
          title: entry.title,
          ...(entry.owner ? { owner: entry.owner } : {}),
        })),
      })),
    },
  });
}

function compactChartIntent(
  args: z.infer<typeof compactChartArgumentsSchema>,
): DirectCanvasIntent {
  return semanticObjectIntent({
    ...compactSpatialFields("chart", args.title, 620, 420),
    type: "diagram",
    payload: {
      kind: args.kind,
      interpretationSummary:
        args.summary ?? `${args.title} created from the spoken values.`,
      chart: {
        title: args.title,
        xAxisLabel: args.xAxisLabel ?? null,
        yAxisLabel: args.yAxisLabel ?? null,
        series: args.series.map((series) => ({
          id: createVoiceObjectId("series"),
          label: series.label,
          points: series.points,
        })),
      },
    },
  });
}

function compactDataTableIntent(
  args: z.infer<typeof compactDataTableArgumentsSchema>,
): DirectCanvasIntent {
  return semanticObjectIntent({
    ...compactSpatialFields(
      "table",
      args.title,
      Math.min(1_200, Math.max(520, args.columns.length * 150)),
      Math.min(1_000, Math.max(260, args.rows.length * 44 + 160)),
    ),
    type: "data_table",
    payload: {
      columns: args.columns.map((column) => ({
        id: createVoiceObjectId("column"),
        label: column.label,
        kind: column.kind,
      })),
      rows: args.rows.map((cells) => ({
        id: createVoiceObjectId("row"),
        cells,
      })),
    },
  });
}

function compactReferenceIntent(
  args: z.infer<typeof compactReferenceArgumentsSchema>,
): DirectCanvasIntent {
  return semanticObjectIntent({
    ...compactSpatialFields("reference", args.title, 440, 300),
    type: "reference_card",
    payload: {
      kind: args.kind,
      sourceUrl: args.sourceUrl ?? null,
      summary: args.summary,
      excerpt: args.excerpt ?? null,
    },
  });
}

function compactMeetingCardIntent(
  args: z.infer<typeof compactMeetingCardArgumentsSchema>,
): DirectCanvasIntent {
  return semanticObjectIntent({
    ...compactSpatialFields("meeting", args.title, 380, 280),
    type: "meeting_card",
    payload: {
      kind: args.kind,
      body: args.body,
      bullets: args.bullets,
      owner: args.owner ?? null,
      dueDate: args.dueDate ?? null,
      status: args.status ?? defaultMeetingCardStatus(args.kind),
    },
  });
}

function semanticObjectIntent(object: unknown): DirectCanvasIntent {
  return {
    type: "create_semantic_object",
    object: newCanvasObjectSchema.parse(object),
    placement: "current_viewport",
  };
}

function compactSpatialFields(
  prefix: string,
  title: string,
  width: number,
  height: number,
) {
  return {
    id: createVoiceObjectId(prefix),
    title,
    x: 160,
    y: 160,
    width,
    height,
    zIndex: 1,
  };
}

function createVoiceObjectId(prefix: string) {
  const suffix = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`;
  return `${prefix}-${suffix}`;
}

function defaultMeetingCardStatus(
  kind: z.infer<typeof compactMeetingCardArgumentsSchema>["kind"],
) {
  if (kind === "decision") return "proposed" as const;
  if (kind === "summary") return "confirmed" as const;
  return "open" as const;
}
