import {
  canvasCommandSchema,
  NOTE_TEXT_MAX_LENGTH,
  type CanvasCommand,
  type CanvasObject,
} from "@/lib/canvas/object-model";

export type {
  CanvasCommand,
  CanvasObject,
  NewCanvasObject,
  NewNoteObject,
  NotePayload,
} from "@/lib/canvas/object-model";

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
  | "update"
  | "transform"
  | "pin"
  | "unpin"
  | "minimize"
  | "restore"
  | "discard"
  | "group"
  | "ungroup"
  | "undo"
  | "redo";

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
  redoReceiptIds?: string[];
}

export interface CommandRuntime {
  createId: (prefix: string) => string;
}

export type CommandErrorCode =
  | "INVALID_COMMAND"
  | "ROOM_MISMATCH"
  | "STALE_REVISION"
  | "OBJECT_EXISTS"
  | "OBJECT_NOT_FOUND"
  | "OBJECT_PINNED"
  | "INVALID_HIERARCHY"
  | "FRAME_NOT_EMPTY"
  | "OBJECT_NOT_EDITABLE"
  | "STALE_OBJECT_VERSION"
  | "NOTE_TEXT_LIMIT"
  | "NOTHING_TO_UNDO"
  | "NOTHING_TO_REDO";

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
    redoReceiptIds: [],
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

  const parsedCommand = canvasCommandSchema.safeParse(envelope.command);
  if (!parsedCommand.success)
    return reject(
      state,
      "INVALID_COMMAND",
      "Command input did not match the canvas schema.",
    );

  const command = parsedCommand.data;
  switch (command.type) {
    case "object.create":
      return createObject(state, envelope, command, runtime);
    case "object.append_note_text":
      return appendNoteText(state, envelope, command, runtime);
    case "object.transform":
      return transformObject(state, envelope, command, runtime);
    case "object.set_flags":
      return setObjectFlags(state, envelope, command, runtime);
    case "object.discard":
      return discardObject(state, envelope, command, runtime);
    case "objects.group":
      return groupObjects(state, envelope, command, runtime);
    case "objects.ungroup":
      return ungroupObjects(state, envelope, command, runtime);
    case "history.undo":
      return undoLatest(state, envelope, runtime);
    case "history.redo":
      return redoLatest(state, envelope, runtime);
  }
}

function appendNoteText(
  state: CanvasState,
  envelope: CanvasCommandEnvelope,
  command: Extract<CanvasCommand, { type: "object.append_note_text" }>,
  runtime: CommandRuntime,
): CommandResult {
  const current = activeObject(state, command.objectId);
  if (!current)
    return reject(state, "OBJECT_NOT_FOUND", "That object is no longer available.");
  if (current.type !== "note")
    return reject(
      state,
      "OBJECT_NOT_EDITABLE",
      "Only an active note can receive dictated text.",
    );
  if (current.version !== command.expectedVersion)
    return reject(
      state,
      "STALE_OBJECT_VERSION",
      "That thought card changed. Continue from its latest text.",
    );

  const nextText = current.payload.text
    ? `${current.payload.text}\n${command.text}`
    : command.text;
  if (nextText.length > NOTE_TEXT_MAX_LENGTH)
    return reject(
      state,
      "NOTE_TEXT_LIMIT",
      "That thought card reached its 4,000-character limit. Finish it and start another thought.",
    );

  const object: CanvasObject = {
    ...current,
    payload: { ...current.payload, text: nextText },
    updatedAt: envelope.issuedAt,
    version: current.version + 1,
  };
  const verb =
    envelope.source === "voice" ? "added dictated text to" : "added text to";
  return commitMutation({
    state,
    envelope,
    runtime,
    action: "update",
    before: { [current.id]: current },
    after: { [object.id]: object },
    description: `${envelope.actor.displayName} ${verb} “${object.title}”.`,
  });
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
    rotation: input.rotation ?? 0,
    parentId: null,
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
  if (isStaleObjectVersion(current, command.expectedVersion))
    return reject(
      state,
      "STALE_OBJECT_VERSION",
      "That object changed. Inspect its latest version and try again.",
    );
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

  if (current.type === "frame" && movesFrameContents(command.transform))
    return transformFrameWithDescendants(
      state,
      envelope,
      current,
      object,
      runtime,
    );

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
  if (isStaleObjectVersion(current, command.expectedVersion))
    return reject(
      state,
      "STALE_OBJECT_VERSION",
      "That object changed. Inspect its latest version and try again.",
    );

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
  if (isStaleObjectVersion(current, command.expectedVersion))
    return reject(
      state,
      "STALE_OBJECT_VERSION",
      "That object changed. Inspect its latest version and try again.",
    );
  if (
    current.type === "frame" &&
    Object.values(state.objects).some(
      (object) => !object.deletedAt && object.parentId === current.id,
    )
  )
    return reject(
      state,
      "FRAME_NOT_EMPTY",
      `Ungroup “${current.title}” before moving it to trash.`,
    );

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

function groupObjects(
  state: CanvasState,
  envelope: CanvasCommandEnvelope,
  command: Extract<CanvasCommand, { type: "objects.group" }>,
  runtime: CommandRuntime,
): CommandResult {
  if (state.objects[command.frame.id])
    return reject(
      state,
      "OBJECT_EXISTS",
      `An object with ID “${command.frame.id}” already exists.`,
    );
  const selected: CanvasObject[] = [];
  const expectedVersions = command.expectedVersions
    ? new Map(
        command.expectedVersions.map((entry) => [
          entry.objectId,
          entry.expectedVersion,
        ]),
      )
    : null;
  for (const objectId of command.objectIds) {
    const object = activeObject(state, objectId);
    if (!object)
      return reject(
        state,
        "OBJECT_NOT_FOUND",
        "One of those objects is no longer available.",
      );
    if (isStaleObjectVersion(object, expectedVersions?.get(objectId)))
      return reject(
        state,
        "STALE_OBJECT_VERSION",
        "One of those objects changed. Inspect the latest group selection and try again.",
      );
    if (object.pinned)
      return reject(
        state,
        "OBJECT_PINNED",
        `Unpin “${object.title}” before grouping it.`,
      );
    if (object.parentId)
      return reject(
        state,
        "INVALID_HIERARCHY",
        `Ungroup “${object.title}” before placing it in another frame.`,
      );
    selected.push(object);
  }
  if ((command.frame.rotation ?? 0) !== 0)
    return reject(
      state,
      "INVALID_HIERARCHY",
      "Create the frame before rotating the grouped result.",
    );
  if (selected.some((object) => !frameContains(command.frame, object)))
    return reject(
      state,
      "INVALID_HIERARCHY",
      "The frame must contain every selected object.",
    );

  const frame: CanvasObject = {
    ...command.frame,
    roomId: state.roomId,
    minimized: false,
    pinned: false,
    createdBy: envelope.actor.id,
    createdAt: envelope.issuedAt,
    updatedAt: envelope.issuedAt,
    deletedAt: null,
    version: 1,
    metadata: {},
    rotation: 0,
    parentId: null,
  };
  const before: Record<string, CanvasObject | null> = { [frame.id]: null };
  const after: Record<string, CanvasObject | null> = { [frame.id]: frame };
  for (const current of selected) {
    before[current.id] = current;
    after[current.id] = {
      ...current,
      parentId: frame.id,
      zIndex: Math.max(current.zIndex, frame.zIndex + 1),
      updatedAt: envelope.issuedAt,
      version: current.version + 1,
    };
  }

  return commitMutation({
    state,
    envelope,
    runtime,
    action: "group",
    before,
    after,
    description: `${envelope.actor.displayName} grouped ${selected.length} ${selected.length === 1 ? "object" : "objects"} in “${frame.title}”.`,
  });
}

function ungroupObjects(
  state: CanvasState,
  envelope: CanvasCommandEnvelope,
  command: Extract<CanvasCommand, { type: "objects.ungroup" }>,
  runtime: CommandRuntime,
): CommandResult {
  const frame = activeObject(state, command.frameId);
  if (!frame)
    return reject(state, "OBJECT_NOT_FOUND", "That frame is no longer available.");
  if (isStaleObjectVersion(frame, command.expectedVersion))
    return reject(
      state,
      "STALE_OBJECT_VERSION",
      "That frame changed. Inspect its latest version and try again.",
    );
  if (frame.type !== "frame")
    return reject(
      state,
      "INVALID_HIERARCHY",
      `“${frame.title}” is not a frame.`,
    );

  const directChildren = Object.values(state.objects).filter(
    (object) => !object.deletedAt && object.parentId === frame.id,
  );
  const before: Record<string, CanvasObject | null> = { [frame.id]: frame };
  const discardedFrame: CanvasObject = {
    ...frame,
    deletedAt: envelope.issuedAt,
    updatedAt: envelope.issuedAt,
    version: frame.version + 1,
  };
  const after: Record<string, CanvasObject | null> = {
    [frame.id]: discardedFrame,
  };
  for (const current of directChildren) {
    before[current.id] = current;
    after[current.id] = {
      ...current,
      parentId: frame.parentId,
      updatedAt: envelope.issuedAt,
      version: current.version + 1,
    };
  }

  return commitMutation({
    state,
    envelope,
    runtime,
    action: "ungroup",
    before,
    after,
    description: `${envelope.actor.displayName} ungrouped “${frame.title}”.`,
  });
}

function isStaleObjectVersion(
  object: CanvasObject,
  expectedVersion: number | undefined,
) {
  return expectedVersion !== undefined && object.version !== expectedVersion;
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
      undoneReceiptIds: [
        ...new Set([
          ...state.undoneReceiptIds,
          ...historyEffectReceiptIds(state, target),
        ]),
      ],
      redoReceiptIds: [...(state.redoReceiptIds ?? []), receipt.id],
    },
    receipt,
  };
}

function redoLatest(
  state: CanvasState,
  envelope: CanvasCommandEnvelope,
  runtime: CommandRuntime,
): CommandResult {
  const redoReceiptIds = state.redoReceiptIds ?? [];
  const undoReceiptId = redoReceiptIds.at(-1);
  const target = undoReceiptId
    ? state.receipts.find(
        (receipt) => receipt.id === undoReceiptId && receipt.action === "undo",
      )
    : undefined;
  if (!target?.undoOfReceiptId)
    return reject(state, "NOTHING_TO_REDO", "There is nothing left to redo.");

  const objects = { ...state.objects };
  for (const objectId of target.affectedObjectIds) {
    const restored = target.before.objects[objectId];
    if (restored) objects[objectId] = restored;
    else delete objects[objectId];
  }
  const original = state.receipts.find(
    (receipt) => receipt.id === target.undoOfReceiptId,
  );
  const restoredEffectIds = original
    ? new Set(historyEffectReceiptIds(state, original))
    : new Set<string>();
  const receipt: ActivityReceipt = {
    id: runtime.createId("receipt"),
    roomId: state.roomId,
    commandId: envelope.id,
    revision: state.revision + 1,
    occurredAt: envelope.issuedAt,
    actor: envelope.actor,
    source: envelope.source,
    action: "redo",
    affectedObjectIds: [...target.affectedObjectIds],
    before: target.after,
    after: target.before,
    description: `${envelope.actor.displayName} redid: ${original?.description ?? target.description}`,
    undoOfReceiptId: target.id,
  };

  return {
    ok: true,
    state: {
      ...state,
      revision: receipt.revision,
      objects,
      receipts: [...state.receipts, receipt],
      undoneReceiptIds: state.undoneReceiptIds.filter(
        (receiptId) => !restoredEffectIds.has(receiptId),
      ),
      redoReceiptIds: redoReceiptIds.slice(0, -1),
    },
    receipt,
  };
}

function historyEffectReceiptIds(
  state: CanvasState,
  receipt: ActivityReceipt,
  visited = new Set<string>(),
): string[] {
  if (visited.has(receipt.id)) return [];
  visited.add(receipt.id);
  if (receipt.action !== "redo" || !receipt.undoOfReceiptId)
    return [receipt.id];
  const targetUndo = state.receipts.find(
    (candidate) =>
      candidate.id === receipt.undoOfReceiptId && candidate.action === "undo",
  );
  const restored = targetUndo?.undoOfReceiptId
    ? state.receipts.find((candidate) => candidate.id === targetUndo.undoOfReceiptId)
    : undefined;
  return restored
    ? [receipt.id, ...historyEffectReceiptIds(state, restored, visited)]
    : [receipt.id];
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
      redoReceiptIds: [],
    },
    receipt,
  };
}

function transformFrameWithDescendants(
  state: CanvasState,
  envelope: CanvasCommandEnvelope,
  current: Extract<CanvasObject, { type: "frame" }>,
  frame: CanvasObject,
  runtime: CommandRuntime,
): CommandResult {
  const descendants = frameDescendants(state, current.id);
  const pinned = descendants.find((object) => object.pinned);
  if (pinned)
    return reject(
      state,
      "OBJECT_PINNED",
      `Unpin “${pinned.title}” before moving its frame.`,
    );

  const before: Record<string, CanvasObject | null> = { [current.id]: current };
  const after: Record<string, CanvasObject | null> = { [frame.id]: frame };
  const deltaX = frame.x - current.x;
  const deltaY = frame.y - current.y;
  const deltaRotation = (frame.rotation ?? 0) - (current.rotation ?? 0);
  const center = {
    x: current.x + current.width / 2,
    y: current.y + current.height / 2,
  };
  for (const child of descendants) {
    before[child.id] = child;
    const childCenter = {
      x: child.x + child.width / 2,
      y: child.y + child.height / 2,
    };
    const rotatedCenter = rotatePoint(childCenter, center, deltaRotation);
    after[child.id] = {
      ...child,
      x: rotatedCenter.x - child.width / 2 + deltaX,
      y: rotatedCenter.y - child.height / 2 + deltaY,
      rotation: normalizeRotation((child.rotation ?? 0) + deltaRotation),
      updatedAt: envelope.issuedAt,
      version: child.version + 1,
    };
  }

  return commitMutation({
    state,
    envelope,
    runtime,
    action: "transform",
    before,
    after,
    description: `${envelope.actor.displayName} transformed “${frame.title}” and its contents spatially.`,
  });
}

function frameDescendants(state: CanvasState, frameId: string) {
  const descendants: CanvasObject[] = [];
  const pending = [frameId];
  while (pending.length > 0) {
    const parentId = pending.shift();
    for (const object of Object.values(state.objects)) {
      if (object.deletedAt || object.parentId !== parentId) continue;
      descendants.push(object);
      if (object.type === "frame") pending.push(object.id);
    }
  }
  return descendants;
}

function movesFrameContents(transform: {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
}) {
  return (
    transform.x !== undefined ||
    transform.y !== undefined ||
    transform.rotation !== undefined
  );
}

function frameContains(
  frame: { x: number; y: number; width: number; height: number },
  object: CanvasObject,
) {
  return (
    object.x >= frame.x &&
    object.y >= frame.y &&
    object.x + object.width <= frame.x + frame.width &&
    object.y + object.height <= frame.y + frame.height
  );
}

function rotatePoint(
  point: { x: number; y: number },
  center: { x: number; y: number },
  degrees: number,
) {
  if (degrees === 0) return point;
  const radians = (degrees * Math.PI) / 180;
  const cosine = Math.cos(radians);
  const sine = Math.sin(radians);
  const x = point.x - center.x;
  const y = point.y - center.y;
  return {
    x: center.x + x * cosine - y * sine,
    y: center.y + x * sine + y * cosine,
  };
}

function normalizeRotation(rotation: number) {
  const normalized = ((rotation + 180) % 360 + 360) % 360 - 180;
  return normalized === -180 ? 180 : normalized;
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
