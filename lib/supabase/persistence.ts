import { z } from "zod";

import {
  applyCanvasCommand,
  type ActivityReceipt,
  type CanvasCommandEnvelope,
  type CanvasCommandSource,
  type CanvasState,
  type CommandErrorCode,
  type ReceiptAction,
  type ReceiptObjectState,
} from "@/lib/canvas/command-engine";
import {
  newCanvasObjectSchema,
  type CanvasObject,
} from "@/lib/canvas/object-model";

const objectIdSchema = z
  .string()
  .min(2)
  .max(96)
  .regex(/^[a-z][a-z0-9-]*$/);
const revisionSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const objectRevisionSchema = revisionSchema.min(1);
const timestampSchema = z.iso.datetime({ offset: true });
const metadataSchema = z.record(z.string(), z.json());
const payloadSchema = z.record(z.string(), z.json());
const sourceSchema = z.enum([
  "pointer",
  "touch",
  "stylus",
  "gesture",
  "voice",
  "typed",
  "collaborator",
  "webmcp",
  "system",
]);
const receiptActionSchema = z.enum([
  "create",
  "update",
  "transform",
  "pin",
  "unpin",
  "minimize",
  "restore",
  "discard",
  "group",
  "ungroup",
  "undo",
  "redo",
]);

export const roomDataRowSchema = z
  .object({
    id: z.uuid(),
    slug: z.string().min(12).max(96).regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/),
    name: z.string().min(1).max(120),
    mode: z.enum(["standard", "demo"]),
    revision: revisionSchema,
    created_by: z.uuid(),
    created_at: timestampSchema,
    updated_at: timestampSchema,
    demo_hard_expires_at: timestampSchema.nullable().optional(),
  })
  .strict();

export const canvasObjectDataRowSchema = z
  .object({
    id: objectIdSchema,
    room_id: z.uuid(),
    object_type: z.enum([
      "note",
      "task_board",
      "schedule",
      "sketch",
      "diagram",
      "frame",
      "data_table",
      "reference_card",
      "meeting_card",
    ]),
    title: z.string().trim().min(1).max(120),
    x: z.number().finite().min(-1_000_000).max(1_000_000),
    y: z.number().finite().min(-1_000_000).max(1_000_000),
    width: z.number().finite().min(160).max(2_000),
    height: z.number().finite().min(80).max(1_400),
    z_index: z.number().int().min(0).max(100_000),
    rotation: z.number().finite().min(-180).max(180).optional(),
    parent_id: objectIdSchema.nullable().optional(),
    minimized: z.boolean(),
    pinned: z.boolean(),
    created_by: z.uuid(),
    created_at: timestampSchema,
    updated_at: timestampSchema,
    deleted_at: timestampSchema.nullable(),
    version: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    revision: objectRevisionSchema,
    metadata: metadataSchema,
    payload: payloadSchema,
  })
  .strict();

const persistedSnapshotSchema = z
  .object({
    id: objectIdSchema,
    roomId: z.uuid(),
    type: z.enum([
      "note",
      "task_board",
      "schedule",
      "sketch",
      "diagram",
      "frame",
      "data_table",
      "reference_card",
      "meeting_card",
    ]),
    title: z.string().trim().min(1).max(120),
    x: z.number().finite().min(-1_000_000).max(1_000_000),
    y: z.number().finite().min(-1_000_000).max(1_000_000),
    width: z.number().finite().min(160).max(2_000),
    height: z.number().finite().min(80).max(1_400),
    zIndex: z.number().int().min(0).max(100_000),
    rotation: z.number().finite().min(-180).max(180).optional(),
    parentId: objectIdSchema.nullable().optional(),
    minimized: z.boolean(),
    pinned: z.boolean(),
    createdBy: z.uuid(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    deletedAt: timestampSchema.nullable(),
    version: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
    revision: objectRevisionSchema,
    metadata: metadataSchema,
    payload: payloadSchema,
  })
  .strict();

const receiptStateEntrySchema = z
  .object({
    objectId: objectIdSchema,
    state: persistedSnapshotSchema.nullable(),
  })
  .strict();

export const receiptDataRowSchema = z
  .object({
    id: z.uuid(),
    room_id: z.uuid(),
    revision: objectRevisionSchema,
    occurred_at: timestampSchema,
    actor_user_id: z.uuid(),
    actor_type: z.enum(["human", "participant", "agent"]),
    source: sourceSchema,
    actor_display_name: z.string().trim().min(1).max(80),
    action: receiptActionSchema,
    affected_object_ids: z.array(objectIdSchema).min(1).max(50),
    previous_state: z.array(receiptStateEntrySchema).min(1).max(50),
    resulting_state: z.array(receiptStateEntrySchema).min(1).max(50),
    inverse_command: z.json().nullable(),
    reversible: z.boolean(),
    undoes_receipt_id: z.uuid().nullable(),
    description: z.string().trim().min(1).max(280),
  })
  .strict();

export type RoomDataRow = z.infer<typeof roomDataRowSchema>;
export type CanvasObjectDataRow = z.infer<typeof canvasObjectDataRowSchema>;
export type ReceiptDataRow = z.infer<typeof receiptDataRowSchema>;

export type PersistenceParseErrorCode =
  | "INVALID_INPUT"
  | "INVALID_ROW"
  | "ROOM_MISMATCH"
  | "REVISION_ORDER"
  | "INVALID_RECEIPT_STATE"
  | "STALE_RECEIPT_STATE";

export interface PersistenceParseError {
  code: PersistenceParseErrorCode;
  entity: "input" | "room" | "object" | "receipt";
  index?: number;
  message: string;
}

export type PersistenceParseResult =
  | { ok: true; state: CanvasState }
  | { ok: false; error: PersistenceParseError };

export interface PersistenceRowsInput {
  room: unknown;
  objects: unknown;
  receipts: unknown;
}

interface SnapshotWithRevision {
  object: CanvasObject;
  revision: number;
}

interface MappedReceipt {
  receipt: ActivityReceipt;
  row: ReceiptDataRow;
  after: Record<string, SnapshotWithRevision | null>;
}

class PersistenceMappingFailure extends Error {
  constructor(readonly detail: PersistenceParseError) {
    super(detail.message);
  }
}

export function parseCanvasPersistenceRows(
  input: PersistenceRowsInput,
): PersistenceParseResult {
  try {
    const roomResult = roomDataRowSchema.safeParse(input.room);
    if (!roomResult.success)
      fail({
        code: "INVALID_ROW",
        entity: "room",
        message: "Persisted room row is invalid.",
      });
    const room = roomResult.data;

    if (!Array.isArray(input.objects) || !Array.isArray(input.receipts))
      fail({
        code: "INVALID_INPUT",
        entity: "input",
        message: "Persisted objects and receipts must be arrays.",
      });

    const objectRows: CanvasObjectDataRow[] = [];
    const objects: Record<string, CanvasObject> = {};
    input.objects.forEach((value, index) => {
      const parsed = canvasObjectDataRowSchema.safeParse(value);
      if (!parsed.success)
        fail({
          code: "INVALID_ROW",
          entity: "object",
          index,
          message: `Persisted object row ${index} is invalid.`,
        });
      const row = parsed.data;
      if (row.room_id !== room.id)
        fail({
          code: "ROOM_MISMATCH",
          entity: "object",
          index,
          message: `Persisted object row ${index} belongs to a different room.`,
        });
      if (row.revision > room.revision)
        fail({
          code: "STALE_RECEIPT_STATE",
          entity: "object",
          index,
          message: `Persisted object row ${index} is ahead of its room revision.`,
        });
      if (objects[row.id])
        fail({
          code: "INVALID_ROW",
          entity: "object",
          index,
          message: `Persisted object row ${index} duplicates an object ID.`,
        });

      const object = mapObjectRow(row);
      if (!object)
        fail({
          code: "INVALID_ROW",
          entity: "object",
          index,
          message: `Persisted object row ${index} is invalid.`,
        });
      objectRows.push(row);
      objects[row.id] = object;
    });

    const mappedReceipts: MappedReceipt[] = [];
    let priorRevision = 0;
    input.receipts.forEach((value, index) => {
      const parsed = receiptDataRowSchema.safeParse(value);
      if (!parsed.success)
        fail({
          code: "INVALID_ROW",
          entity: "receipt",
          index,
          message: `Persisted receipt row ${index} is invalid.`,
        });
      const row = parsed.data;
      if (row.room_id !== room.id)
        fail({
          code: "ROOM_MISMATCH",
          entity: "receipt",
          index,
          message: `Persisted receipt row ${index} belongs to a different room.`,
        });
      if (row.revision <= priorRevision)
        fail({
          code: "REVISION_ORDER",
          entity: "receipt",
          index,
          message: "Persisted receipts must have unique increasing revisions.",
        });
      if (row.revision > room.revision)
        fail({
          code: "STALE_RECEIPT_STATE",
          entity: "receipt",
          index,
          message: `Persisted receipt row ${index} is ahead of its room revision.`,
        });
      priorRevision = row.revision;

      mappedReceipts.push(mapReceiptRow(row, room.id, index));
    });

    validateLatestObjectStates(objectRows, objects, mappedReceipts);

    const receipts = mappedReceipts.map(({ receipt }) => receipt);
    const { undoneReceiptIds, redoReceiptIds } =
      reconstructHistory(mappedReceipts);

    return {
      ok: true,
      state: {
        roomId: room.id,
        revision: room.revision,
        objects,
        receipts,
        undoneReceiptIds,
        redoReceiptIds,
      },
    };
  } catch (error) {
    if (error instanceof PersistenceMappingFailure)
      return { ok: false, error: error.detail };
    return {
      ok: false,
      error: {
        code: "INVALID_INPUT",
        entity: "input",
        message: "Persisted canvas input could not be parsed.",
      },
    };
  }
}

function mapObjectRow(row: CanvasObjectDataRow): CanvasObject | null {
  return mapCanvasObject({
    id: row.id,
    roomId: row.room_id,
    type: row.object_type,
    title: row.title,
    x: row.x,
    y: row.y,
    width: row.width,
    height: row.height,
    zIndex: row.z_index,
    rotation: row.rotation,
    parentId: row.parent_id,
    minimized: row.minimized,
    pinned: row.pinned,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
    version: row.version,
    metadata: row.metadata,
    payload: row.payload,
  });
}

function mapSnapshot(
  value: z.infer<typeof persistedSnapshotSchema>,
): SnapshotWithRevision | null {
  const object = mapCanvasObject({
    id: value.id,
    roomId: value.roomId,
    type: value.type,
    title: value.title,
    x: value.x,
    y: value.y,
    width: value.width,
    height: value.height,
    zIndex: value.zIndex,
    rotation: value.rotation,
    parentId: value.parentId,
    minimized: value.minimized,
    pinned: value.pinned,
    createdBy: value.createdBy,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    deletedAt: value.deletedAt,
    version: value.version,
    metadata: value.metadata,
    payload: value.payload,
  });
  return object ? { object, revision: value.revision } : null;
}

function mapCanvasObject(
  input: Omit<CanvasObject, "payload"> & { payload: unknown },
): CanvasObject | null {
  const newObject = newCanvasObjectSchema.safeParse({
    id: input.id,
    type: input.type,
    title: input.title,
    x: input.x,
    y: input.y,
    width: input.width,
    height: input.height,
    zIndex: input.zIndex,
    ...(input.rotation !== undefined ? { rotation: input.rotation } : {}),
    payload: input.payload,
  });
  if (!newObject.success) return null;

  return {
    ...newObject.data,
    roomId: input.roomId,
    minimized: input.minimized,
    pinned: input.pinned,
    createdBy: input.createdBy,
    createdAt: input.createdAt,
    updatedAt: input.updatedAt,
    deletedAt: input.deletedAt,
    version: input.version,
    metadata: input.metadata,
    ...(input.rotation !== undefined ? { rotation: input.rotation } : {}),
    ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
  };
}

function mapReceiptRow(
  row: ReceiptDataRow,
  roomId: string,
  index: number,
): MappedReceipt {
  validateReceiptShape(row, index);
  const before = mapReceiptState(
    row.previous_state,
    roomId,
    row,
    index,
    "before",
  );
  const after = mapReceiptState(
    row.resulting_state,
    roomId,
    row,
    index,
    "after",
  );
  validateReceiptTransition(row, before, after, index);

  const receipt: ActivityReceipt = {
    id: row.id,
    roomId,
    commandId: row.id,
    revision: row.revision,
    occurredAt: row.occurred_at,
    actor: {
      id: row.actor_user_id,
      displayName: row.actor_display_name,
      type: row.actor_type,
    },
    source: resolveReceiptSource(row.actor_type, row.source, index),
    action: row.action,
    affectedObjectIds: [...row.affected_object_ids],
    before: toReceiptObjectState(before),
    after: toReceiptObjectState(after),
    description: row.description,
    ...(row.undoes_receipt_id
      ? { undoOfReceiptId: row.undoes_receipt_id }
      : {}),
  };
  return { receipt, row, after };
}

function validateReceiptShape(row: ReceiptDataRow, index: number) {
  if (new Set(row.affected_object_ids).size !== row.affected_object_ids.length)
    invalidReceipt(index, "A receipt cannot affect the same object twice.");

  const beforeIds = row.previous_state.map(({ objectId }) => objectId);
  const afterIds = row.resulting_state.map(({ objectId }) => objectId);
  if (
    !sameStringArray(beforeIds, row.affected_object_ids) ||
    !sameStringArray(afterIds, row.affected_object_ids)
  )
    invalidReceipt(index, "Receipt snapshots must match affected object IDs.");

  if (row.action === "undo") {
    if (row.reversible || !row.undoes_receipt_id)
      invalidReceipt(index, "Undo receipt invariants are invalid.");
  } else if (row.action === "redo") {
    if (!row.reversible || !row.undoes_receipt_id || row.inverse_command === null)
      invalidReceipt(index, "Redo receipt invariants are invalid.");
  } else if (
    !row.reversible ||
    row.undoes_receipt_id !== null ||
    row.inverse_command === null
  ) {
    invalidReceipt(index, "Reversible receipt invariants are invalid.");
  }
}

function mapReceiptState(
  entries: ReceiptDataRow["previous_state"],
  roomId: string,
  receipt: ReceiptDataRow,
  index: number,
  side: "before" | "after",
): Record<string, SnapshotWithRevision | null> {
  const mapped: Record<string, SnapshotWithRevision | null> = {};
  for (const entry of entries) {
    if (entry.state === null) {
      mapped[entry.objectId] = null;
      continue;
    }
    if (entry.state.id !== entry.objectId || entry.state.roomId !== roomId)
      invalidReceipt(index, "Receipt snapshot identity is invalid.");
    if (
      (side === "after" && entry.state.revision !== receipt.revision) ||
      (side === "before" && entry.state.revision >= receipt.revision)
    )
      invalidReceipt(index, "Receipt snapshot revision is invalid.");

    const snapshot = mapSnapshot(entry.state);
    if (!snapshot)
      invalidReceipt(index, "Receipt snapshot object payload is invalid.");
    mapped[entry.objectId] = snapshot;
  }
  return mapped;
}

function validateReceiptTransition(
  row: ReceiptDataRow,
  before: Record<string, SnapshotWithRevision | null>,
  after: Record<string, SnapshotWithRevision | null>,
  index: number,
) {
  for (const objectId of row.affected_object_ids) {
    const previous = before[objectId];
    const resulting = after[objectId];
    if (!resulting)
      invalidReceipt(index, "Receipt resulting state must contain every object.");
    if (previous === null) {
      if (resulting.object.version !== 1)
        invalidReceipt(index, "Created object receipt must begin at version 1.");
    } else if (!previous || resulting.object.version !== previous.object.version + 1) {
      invalidReceipt(index, "Receipt object versions are not consecutive.");
    }
  }
}

function toReceiptObjectState(
  snapshots: Record<string, SnapshotWithRevision | null>,
): ReceiptObjectState {
  return {
    objects: Object.fromEntries(
      Object.entries(snapshots).map(([id, value]) => [id, value?.object ?? null]),
    ),
  };
}

function resolveReceiptSource(
  actorType: ReceiptDataRow["actor_type"],
  explicit: CanvasCommandSource,
  index: number,
): CanvasCommandSource {
  const allowed =
    actorType === "participant"
      ? new Set<CanvasCommandSource>(["collaborator", "webmcp", "system"])
      : actorType === "agent"
        ? new Set<CanvasCommandSource>(["webmcp", "system"])
        : new Set<CanvasCommandSource>([
            "pointer",
            "touch",
            "stylus",
            "gesture",
            "voice",
            "typed",
            "webmcp",
            "system",
          ]);
  if (!allowed.has(explicit))
    invalidReceipt(index, "Receipt source is inconsistent with its actor type.");
  return explicit;
}

function validateLatestObjectStates(
  rows: CanvasObjectDataRow[],
  objects: Record<string, CanvasObject>,
  receipts: MappedReceipt[],
) {
  const latest = new Map<
    string,
    { snapshot: SnapshotWithRevision | null; receiptIndex: number }
  >();
  receipts.forEach((mapped, receiptIndex) => {
    for (const objectId of mapped.row.affected_object_ids)
      latest.set(objectId, {
        snapshot: mapped.after[objectId] ?? null,
        receiptIndex,
      });
  });

  rows.forEach((row) => {
    const latestState = latest.get(row.id);
    if (!latestState) return;
    if (
      latestState.snapshot?.revision !== row.revision ||
      !jsonEqual(latestState.snapshot.object, objects[row.id])
    )
      fail({
        code: "STALE_RECEIPT_STATE",
        entity: "receipt",
        index: latestState.receiptIndex,
        message: `Latest receipt state does not match object “${row.id}”.`,
      });
  });

  for (const [objectId, latestState] of latest)
    if (latestState.snapshot && !objects[objectId])
      fail({
        code: "STALE_RECEIPT_STATE",
        entity: "receipt",
        index: latestState.receiptIndex,
        message: `Latest receipt state does not match object “${objectId}”.`,
      });
}

function invalidReceipt(index: number, message: string): never {
  fail({
    code: "INVALID_RECEIPT_STATE",
    entity: "receipt",
    index,
    message,
  });
}

function sameStringArray(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, i) => value === right[i]);
}

function jsonEqual(left: unknown, right: unknown) {
  return JSON.stringify(canonicalJson(left)) === JSON.stringify(canonicalJson(right));
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonicalJson(item)]),
    );
  return value;
}

function fail(detail: PersistenceParseError): never {
  throw new PersistenceMappingFailure(detail);
}

export interface RpcMutableCanvasObject {
  type: CanvasObject["type"];
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  rotation: number;
  parentId: string | null;
  minimized: boolean;
  pinned: boolean;
  deletedAt: string | null;
  metadata: Record<string, unknown>;
  payload: CanvasObject["payload"];
}

export interface CanvasMutationRpcChange {
  objectId: string;
  expectedVersion: number | null;
  after: RpcMutableCanvasObject;
}

export interface CanvasMutationRpcPlan {
  action: ReceiptAction;
  description: string;
  changes: CanvasMutationRpcChange[];
  reversible: boolean;
  undoesReceiptId: string | null;
}

export type CanvasMutationPlanErrorCode = CommandErrorCode | "INVALID_STATE";

export type CanvasMutationPlanResult =
  | { ok: true; plan: CanvasMutationRpcPlan }
  | {
      ok: false;
      error: { code: CanvasMutationPlanErrorCode; message: string };
    };

export function buildCanvasMutationPlan(
  state: CanvasState,
  envelope: CanvasCommandEnvelope,
): CanvasMutationPlanResult {
  if (!validateCanonicalCanvasState(state))
    return {
      ok: false,
      error: {
        code: "INVALID_STATE",
        message: "Current canvas state is invalid.",
      },
    };

  const result = applyCanvasCommand(state, envelope, {
    createId: () => "rpc-plan-receipt",
  });
  if (!result.ok) return { ok: false, error: result.error };

  if (
    result.receipt.action === "undo" ||
    result.receipt.action === "redo"
  )
    return {
      ok: true,
      plan: {
        action: result.receipt.action,
        description: result.receipt.description,
        changes: [],
        reversible: result.receipt.action === "redo",
        undoesReceiptId: result.receipt.undoOfReceiptId ?? null,
      },
    };

  const changes = result.receipt.affectedObjectIds.map((objectId) => {
    const after = result.receipt.after.objects[objectId];
    if (!after) throw new Error("Canonical mutation did not produce after state.");
    return {
      objectId,
      expectedVersion: state.objects[objectId]?.version ?? null,
      after: toRpcMutableObject(after),
    };
  });

  return {
    ok: true,
    plan: {
      action: result.receipt.action,
      description: result.receipt.description,
      changes,
      reversible: true,
      undoesReceiptId: null,
    },
  };
}

function toRpcMutableObject(object: CanvasObject): RpcMutableCanvasObject {
  return {
    type: object.type,
    title: object.title,
    x: object.x,
    y: object.y,
    width: object.width,
    height: object.height,
    zIndex: object.zIndex,
    rotation: object.rotation ?? 0,
    parentId: object.parentId ?? null,
    minimized: object.minimized,
    pinned: object.pinned,
    deletedAt: object.deletedAt,
    metadata: object.metadata,
    payload: object.payload,
  };
}

function validateCanonicalCanvasState(state: CanvasState): boolean {
  if (
    !z.uuid().safeParse(state.roomId).success ||
    !revisionSchema.safeParse(state.revision).success ||
    !Array.isArray(state.receipts) ||
    !Array.isArray(state.undoneReceiptIds) ||
    (state.redoReceiptIds !== undefined &&
      !Array.isArray(state.redoReceiptIds)) ||
    !state.objects ||
    typeof state.objects !== "object" ||
    Array.isArray(state.objects)
  )
    return false;

  for (const [objectId, value] of Object.entries(state.objects)) {
    if (objectId !== value.id || value.roomId !== state.roomId) return false;
    if (!validateCanonicalObject(value)) return false;
  }

  let previousRevision = 0;
  const receiptIds = new Set<string>();
  for (const receipt of state.receipts) {
    if (
      receipt.roomId !== state.roomId ||
      receipt.revision <= previousRevision ||
      receipt.revision > state.revision ||
      !receiptActionSchema.safeParse(receipt.action).success ||
      !sourceSchema.safeParse(receipt.source).success ||
      receiptIds.has(receipt.id)
    )
      return false;
    previousRevision = receipt.revision;
    receiptIds.add(receipt.id);
    for (const object of [
      ...Object.values(receipt.before.objects),
      ...Object.values(receipt.after.objects),
    ])
      if (object && !validateCanonicalObject(object)) return false;
  }

  return (
    new Set(state.undoneReceiptIds).size === state.undoneReceiptIds.length &&
    state.undoneReceiptIds.every((id) => receiptIds.has(id)) &&
    new Set(state.redoReceiptIds ?? []).size ===
      (state.redoReceiptIds ?? []).length &&
    (state.redoReceiptIds ?? []).every((id) => receiptIds.has(id)) &&
    validateHierarchy(state.objects)
  );
}

function validateCanonicalObject(object: CanvasObject): boolean {
  const parsedNewObject = newCanvasObjectSchema.safeParse({
    id: object.id,
    type: object.type,
    title: object.title,
    x: object.x,
    y: object.y,
    width: object.width,
    height: object.height,
    zIndex: object.zIndex,
    ...(object.rotation !== undefined ? { rotation: object.rotation } : {}),
    payload: object.payload,
  });
  return (
    parsedNewObject.success &&
    z.uuid().safeParse(object.roomId).success &&
    z.string().min(1).max(96).safeParse(object.createdBy).success &&
    timestampSchema.safeParse(object.createdAt).success &&
    timestampSchema.safeParse(object.updatedAt).success &&
    timestampSchema.nullable().safeParse(object.deletedAt).success &&
    z.number().int().min(1).safeParse(object.version).success &&
    metadataSchema.safeParse(object.metadata).success &&
    typeof object.minimized === "boolean" &&
    typeof object.pinned === "boolean" &&
    (object.rotation === undefined ||
      z.number().finite().min(-180).max(180).safeParse(object.rotation)
        .success) &&
    (object.parentId === undefined ||
      object.parentId === null ||
      objectIdSchema.safeParse(object.parentId).success)
  );
}

function reconstructHistory(mappedReceipts: MappedReceipt[]) {
  const receiptById = new Map<string, ActivityReceipt>();
  const undone = new Set<string>();
  const redoReceiptIds: string[] = [];
  for (const [index, { receipt, row }] of mappedReceipts.entries()) {
    receiptById.set(receipt.id, receipt);
    if (receipt.action === "undo" && receipt.undoOfReceiptId) {
      const target = receiptById.get(receipt.undoOfReceiptId);
      if (!target || target.action === "undo")
        invalidReceipt(index, "Undo receipt target is invalid.");
      for (const targetId of historyEffectReceiptIds(target, receiptById))
        undone.add(targetId);
      if (row.inverse_command !== null) redoReceiptIds.push(receipt.id);
      continue;
    }
    if (receipt.action === "redo" && receipt.undoOfReceiptId) {
      const undo = receiptById.get(receipt.undoOfReceiptId);
      if (undo?.action !== "undo" || !undo.undoOfReceiptId)
        invalidReceipt(index, "Redo receipt target is invalid.");
      const restored = receiptById.get(undo.undoOfReceiptId);
      if (!restored) invalidReceipt(index, "Redo receipt history is incomplete.");
      for (const restoredId of historyEffectReceiptIds(restored, receiptById))
        undone.delete(restoredId);
      const targetIndex = redoReceiptIds.lastIndexOf(receipt.undoOfReceiptId);
      if (targetIndex < 0)
        invalidReceipt(index, "Redo receipt is not available in history.");
      redoReceiptIds.splice(targetIndex, 1);
      continue;
    }
    redoReceiptIds.length = 0;
  }
  return { undoneReceiptIds: [...undone], redoReceiptIds };
}

function historyEffectReceiptIds(
  receipt: ActivityReceipt,
  receiptById: Map<string, ActivityReceipt>,
  visited = new Set<string>(),
): string[] {
  if (visited.has(receipt.id)) return [];
  visited.add(receipt.id);
  if (receipt.action !== "redo" || !receipt.undoOfReceiptId)
    return [receipt.id];
  const targetUndo = receiptById.get(receipt.undoOfReceiptId);
  const restored = targetUndo?.undoOfReceiptId
    ? receiptById.get(targetUndo.undoOfReceiptId)
    : undefined;
  return restored
    ? [receipt.id, ...historyEffectReceiptIds(restored, receiptById, visited)]
    : [receipt.id];
}

function validateHierarchy(objects: Record<string, CanvasObject>) {
  for (const object of Object.values(objects)) {
    if (object.deletedAt || !object.parentId) continue;
    const parent = objects[object.parentId];
    if (!parent || parent.deletedAt || parent.type !== "frame") return false;
    const visited = new Set([object.id]);
    let cursor: CanvasObject | undefined = parent;
    while (cursor?.parentId) {
      if (visited.has(cursor.id)) return false;
      visited.add(cursor.id);
      cursor = objects[cursor.parentId];
      if (!cursor || cursor.deletedAt || cursor.type !== "frame") return false;
    }
  }
  return true;
}
