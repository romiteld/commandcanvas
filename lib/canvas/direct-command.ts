export const DIRECT_COMMAND_MAX_LENGTH = 280;

export type DirectCanvasIntent =
  | { type: "create_note"; text?: string }
  | { type: "create_board" }
  | { type: "create_schedule" }
  | { type: "open_sketch" }
  | { type: "transform_selected_sketch" }
  | { type: "pin_selected" }
  | { type: "unpin_selected" }
  | { type: "minimize_selected" }
  | { type: "restore_selected" }
  | { type: "discard_selected" }
  | { type: "undo" };

export type DirectCanvasCommandParseResult =
  | { ok: true; intent: DirectCanvasIntent }
  | {
      ok: false;
      code:
        | "empty_command"
        | "command_too_long"
        | "ambiguous_command"
        | "unsupported_command";
      message: string;
    };

interface IntentCandidate {
  intent: DirectCanvasIntent;
  matches: boolean;
}

export function parseDirectCanvasCommand(
  input: string,
): DirectCanvasCommandParseResult {
  const transcript = input.replace(/\s+/g, " ").trim();
  if (!transcript)
    return {
      ok: false,
      code: "empty_command",
      message: "Enter a command first.",
    };
  if (transcript.length > DIRECT_COMMAND_MAX_LENGTH)
    return {
      ok: false,
      code: "command_too_long",
      message: "Keep direct commands to 280 characters or fewer.",
    };

  const normalized = transcript
    .toLocaleLowerCase("en-US")
    .replace(/[’]/g, "'")
    .replace(/[^a-z0-9'\s:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const note = noteIntent(transcript, normalized);
  const candidates: IntentCandidate[] = [
    { intent: note, matches: isNoteCommand(normalized) },
    {
      intent: { type: "create_board" },
      matches:
        hasCreationVerb(normalized) &&
        /\b(?:project|task)?\s*board\b/.test(normalized),
    },
    {
      intent: { type: "create_schedule" },
      matches:
        (hasCreationVerb(normalized) || /\bput\b/.test(normalized)) &&
        /\b(?:schedule|calendar)\b/.test(normalized),
    },
    {
      intent: { type: "open_sketch" },
      matches:
        /\b(?:start|create|draw|open|make)\b/.test(normalized) &&
        /\b(?:rough\s+)?(?:sketch|drawing)\b/.test(normalized) &&
        !/\b(?:usable|professional|diagram|flowchart)\b/.test(normalized),
    },
    {
      intent: { type: "transform_selected_sketch" },
      matches:
        /\bmake (?:that|this|it) usable\b/.test(normalized) ||
        /\bmake (?:that |this |the )?(?:rough )?(?:sketch|drawing) (?:usable|professional)\b/.test(
          normalized,
        ) ||
        /\b(?:turn|convert|transform)\b.*\b(?:sketch|drawing)\b.*\b(?:diagram|flowchart|usable|professional)\b/.test(
          normalized,
        ),
    },
    {
      intent: { type: "unpin_selected" },
      matches: /\bunpin\b/.test(normalized),
    },
    {
      intent: { type: "pin_selected" },
      matches: /\bpin\b/.test(normalized) && !/\bunpin\b/.test(normalized),
    },
    {
      intent: { type: "minimize_selected" },
      matches: /\b(?:minimize|collapse)\b/.test(normalized),
    },
    {
      intent: { type: "restore_selected" },
      matches: /\b(?:restore|expand|reopen)\b/.test(normalized),
    },
    {
      intent: { type: "discard_selected" },
      matches:
        /\b(?:discard|trash|remove)\b/.test(normalized) ||
        /\bget rid of\b/.test(normalized),
    },
    {
      intent: { type: "undo" },
      matches: /\bundo\b/.test(normalized),
    },
  ];

  const matches = candidates.filter((candidate) => candidate.matches);
  if (matches.length > 1)
    return {
      ok: false,
      code: "ambiguous_command",
      message: "Ask for one direct canvas action at a time.",
    };
  if (matches.length === 1)
    return { ok: true, intent: matches[0]!.intent };
  return {
    ok: false,
    code: "unsupported_command",
    message:
      "That direct command is not available. Agent and packet actions remain behind WebMCP and explicit site approval.",
  };
}

function hasCreationVerb(input: string) {
  return /\b(?:bring|create|add|show|give|make|put)\b/.test(input);
}

function isNoteCommand(input: string) {
  return (
    /\b(?:make|create|add|write)(?: me)? (?:a )?note\b/.test(input) ||
    /\bnote\s*:/.test(input)
  );
}

function noteIntent(
  original: string,
  normalized: string,
): Extract<DirectCanvasIntent, { type: "create_note" }> {
  if (!isNoteCommand(normalized)) return { type: "create_note" };
  const content = original
    .replace(
      /^.*?\bnote\b(?:\s+(?:that|saying|about))?\s*:?[\s-]*/i,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();
  return content ? { type: "create_note", text: content } : { type: "create_note" };
}
