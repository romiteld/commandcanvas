export interface CanvasActor {
  id: string;
  displayName: string;
  type: "human" | "participant" | "agent";
}

export type CanvasCommandSource =
  | "pointer"
  | "touch"
  | "stylus"
  | "gesture"
  | "voice"
  | "typed"
  | "collaborator"
  | "webmcp"
  | "system";

export interface NotePayload {
  text: string;
  tone: "coral" | "sky" | "sand" | "violet";
}

export interface NoteObject {
  id: string;
  roomId: string;
  type: "note";
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  minimized: boolean;
  pinned: boolean;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  version: number;
  metadata: Record<string, unknown>;
  payload: NotePayload;
}

export type CanvasObject = NoteObject;

export interface NewNoteObject {
  id: string;
  type: "note";
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  payload: NotePayload;
}

export type CanvasCommand =
  | { type: "object.create"; object: NewNoteObject }
  | {
      type: "object.transform";
      objectId: string;
      transform: Partial<Pick<CanvasObject, "x" | "y" | "width" | "height">>;
    }
  | {
      type: "object.set_flags";
      objectId: string;
      flags: Partial<Pick<CanvasObject, "minimized" | "pinned">>;
    }
  | { type: "object.discard"; objectId: string }
  | { type: "history.undo" };

export interface CanvasCommandEnvelope {
  id: string;
  roomId: string;
  baseRevision: number;
  issuedAt: string;
  actor: CanvasActor;
  source: CanvasCommandSource;
  command: CanvasCommand;
}

export interface ReceiptObjectState {
  objects: Record<string, CanvasObject | null>;
}

export type ReceiptAction =
  | "create"
  | "transform"
  | "pin"
  | "unpin"
  | "minimize"
  | "restore"
  | "discard"
  | "undo";

export interface ActivityReceipt {
  id: string;
  roomId: string;
  commandId: string;
  revision: number;
  occurredAt: string;
  actor: CanvasActor;
  source: CanvasCommandSource;
  action: ReceiptAction;
  affectedObjectIds: string[];
  before: ReceiptObjectState;
  after: ReceiptObjectState;
  description: string;
  undoOfReceiptId?: string;
}

export interface CanvasState {
  roomId: string;
  revision: number;
  objects: Record<string, CanvasObject>;
  receipts: ActivityReceipt[];
  undoneReceiptIds: string[];
}

export interface CommandRuntime {
  createId: (prefix: string) => string;
}

export type CommandErrorCode =
  | "ROOM_MISMATCH"
  | "STALE_REVISION"
  | "OBJECT_EXISTS"
  | "OBJECT_NOT_FOUND"
  | "OBJECT_PINNED"
  | "NOTHING_TO_UNDO";

export interface CommandError {
  code: CommandErrorCode;
  message: string;
}

export type CommandResult =
  | {
      ok: true;
      state: CanvasState;
      receipt: ActivityReceipt;
    }
  | {
      ok: false;
      state: CanvasState;
      error: CommandError;
    };

export function createEmptyCanvasState(_roomId: string): CanvasState {
  return {
    roomId: _roomId,
    revision: 0,
    objects: {},
    receipts: [],
    undoneReceiptIds: [],
  };
}

export function applyCanvasCommand(
  state: CanvasState,
  envelope: CanvasCommandEnvelope,
  runtime: CommandRuntime,
): CommandResult {
  if (envelope.roomId !== state.roomId)
    return reject(state, "ROOM_MISMATCH", "Command targets a different room.");

  if (envelope.baseRevision !== state.revision)
    return reject(
      state,
      "STALE_REVISION",
      "Canvas changed. Refresh the command and try again.",
    );

  const command = envelope.command;
  switch (command.type) {
    case "object.create":
      return createObject(state, envelope, command, runtime);
    case "object.transform":
      return transformObject(state, envelope, command, runtime);
    case "object.set_flags":
      return setObjectFlags(state, envelope, command, runtime);
    case "object.discard":
      return discardObject(state, envelope, command, runtime);
    case "history.undo":
      return undoLatest(state, envelope, runtime);
  }
}

function createObject(
  state: CanvasState,
  envelope: CanvasCommandEnvelope,
  command: Extract<CanvasCommand, { type: "object.create" }>,
  runtime: CommandRuntime,
): CommandResult {
  const input = command.object;
  if (state.objects[input.id])
    return reject(
      state,
      "OBJECT_EXISTS",
      `An object with ID “${input.id}” already exists.`,
    );

  const object: CanvasObject = {
    ...input,
    roomId: state.roomId,
    minimized: false,
    pinned: false,
    createdBy: envelope.actor.id,
    createdAt: envelope.issuedAt,
    updatedAt: envelope.issuedAt,
    deletedAt: null,
    version: 1,
    metadata: {},
  };

  return commitMutation({
    state,
    envelope,
    runtime,
    action: "create",
    before: { [object.id]: null },
    after: { [object.id]: object },
    description: `${envelope.actor.displayName} created “${object.title}”.`,
  });
}

function transformObject(
  state: CanvasState,
  envelope: CanvasCommandEnvelope,
  command: Extract<CanvasCommand, { type: "object.transform" }>,
  runtime: CommandRuntime,
): CommandResult {
  const current = activeObject(state, command.objectId);
  if (!current)
    return reject(state, "OBJECT_NOT_FOUND", "That object is no longer available.");
  if (current.pinned)
    return reject(
      state,
      "OBJECT_PINNED",
      `Unpin “${current.title}” before moving or resizing it.`,
    );

  const object: CanvasObject = {
    ...current,
    ...command.transform,
    updatedAt: envelope.issuedAt,
    version: current.version + 1,
  };

  return commitMutation({
    state,
    envelope,
    runtime,
    action: "transform",
    before: { [current.id]: current },
    after: { [object.id]: object },
    description: `${envelope.actor.displayName} transformed “${object.title}” spatially.`,
  });
}

function setObjectFlags(
  state: CanvasState,
  envelope: CanvasCommandEnvelope,
  command: Extract<CanvasCommand, { type: "object.set_flags" }>,
  runtime: CommandRuntime,
): CommandResult {
  const current = activeObject(state, command.objectId);
  if (!current)
    return reject(state, "OBJECT_NOT_FOUND", "That object is no longer available.");

  const object: CanvasObject = {
    ...current,
    ...command.flags,
    updatedAt: envelope.issuedAt,
    version: current.version + 1,
  };
  const { action, verb } = describeFlagChange(current, object);

  return commitMutation({
    state,
    envelope,
    runtime,
    action,
    before: { [current.id]: current },
    after: { [object.id]: object },
    description: `${envelope.actor.displayName} ${verb} “${object.title}”.`,
  });
}

function discardObject(
  state: CanvasState,
  envelope: CanvasCommandEnvelope,
  command: Extract<CanvasCommand, { type: "object.discard" }>,
  runtime: CommandRuntime,
): CommandResult {
  const current = activeObject(state, command.objectId);
  if (!current)
    return reject(state, "OBJECT_NOT_FOUND", "That object is no longer available.");

  const object: CanvasObject = {
    ...current,
    deletedAt: envelope.issuedAt,
    updatedAt: envelope.issuedAt,
    version: current.version + 1,
  };

  return commitMutation({
    state,
    envelope,
    runtime,
    action: "discard",
    before: { [current.id]: current },
    after: { [object.id]: object },
    description: `${envelope.actor.displayName} moved “${object.title}” to recoverable trash.`,
  });
}

function undoLatest(
  state: CanvasState,
  envelope: CanvasCommandEnvelope,
  runtime: CommandRuntime,
): CommandResult {
  const undone = new Set(state.undoneReceiptIds);
  const target = state.receipts.findLast(
    (receipt) => receipt.action !== "undo" && !undone.has(receipt.id),
  );
  if (!target)
    return reject(state, "NOTHING_TO_UNDO", "There is nothing left to undo.");

  const objects = { ...state.objects };
  for (const objectId of target.affectedObjectIds) {
    const previous = target.before.objects[objectId];
    if (previous) objects[objectId] = previous;
    else delete objects[objectId];
  }

  const receipt: ActivityReceipt = {
    id: runtime.createId("receipt"),
    roomId: state.roomId,
    commandId: envelope.id,
    revision: state.revision + 1,
    occurredAt: envelope.issuedAt,
    actor: envelope.actor,
    source: envelope.source,
    action: "undo",
    affectedObjectIds: [...target.affectedObjectIds],
    before: target.after,
    after: target.before,
    description: `${envelope.actor.displayName} undid: ${target.description}`,
    undoOfReceiptId: target.id,
  };

  return {
    ok: true,
    state: {
      ...state,
      revision: receipt.revision,
      objects,
      receipts: [...state.receipts, receipt],
      undoneReceiptIds: [...state.undoneReceiptIds, target.id],
    },
    receipt,
  };
}

interface MutationCommitInput {
  state: CanvasState;
  envelope: CanvasCommandEnvelope;
  runtime: CommandRuntime;
  action: ReceiptAction;
  before: Record<string, CanvasObject | null>;
  after: Record<string, CanvasObject | null>;
  description: string;
}

function commitMutation(input: MutationCommitInput): CommandResult {
  const affectedObjectIds = Object.keys(input.after);
  const objects = { ...input.state.objects };
  for (const objectId of affectedObjectIds) {
    const object = input.after[objectId];
    if (object) objects[objectId] = object;
    else delete objects[objectId];
  }

  const receipt: ActivityReceipt = {
    id: input.runtime.createId("receipt"),
    roomId: input.state.roomId,
    commandId: input.envelope.id,
    revision: input.state.revision + 1,
    occurredAt: input.envelope.issuedAt,
    actor: input.envelope.actor,
    source: input.envelope.source,
    action: input.action,
    affectedObjectIds,
    before: { objects: input.before },
    after: { objects: input.after },
    description: input.description,
  };

  return {
    ok: true,
    state: {
      ...input.state,
      revision: receipt.revision,
      objects,
      receipts: [...input.state.receipts, receipt],
    },
    receipt,
  };
}

function activeObject(state: CanvasState, objectId: string) {
  const object = state.objects[objectId];
  return object && !object.deletedAt ? object : undefined;
}

function describeFlagChange(
  before: CanvasObject,
  after: CanvasObject,
): { action: ReceiptAction; verb: string } {
  if (before.pinned !== after.pinned)
    return after.pinned
      ? { action: "pin", verb: "pinned" }
      : { action: "unpin", verb: "unpinned" };

  return after.minimized
    ? { action: "minimize", verb: "minimized" }
    : { action: "restore", verb: "restored" };
}

function reject(
  state: CanvasState,
  code: CommandErrorCode,
  message: string,
): CommandResult {
  return { ok: false, state, error: { code, message } };
}
