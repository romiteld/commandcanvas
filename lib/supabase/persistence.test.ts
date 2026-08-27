import { describe, expect, it } from "vitest";

import type {
  CanvasCommandEnvelope,
  CanvasState,
} from "@/lib/canvas/command-engine";
import {
  buildCanvasMutationPlan,
  parseCanvasPersistenceRows,
} from "@/lib/supabase/persistence";

const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_ROOM_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const HOST_ID = "22222222-2222-4222-8222-222222222222";
const PARTICIPANT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const RECEIPT_CREATE_ID = "33333333-3333-4333-8333-333333333333";
const RECEIPT_MOVE_ID = "44444444-4444-4444-8444-444444444444";
const CREATED_AT = "2026-08-27T16:00:00.000Z";
const MOVED_AT = "2026-08-27T16:01:00.000Z";
const COMMAND_AT = "2026-08-27T16:02:00.000Z";

const roomRow = {
  id: ROOM_ID,
  slug: "commandcanvas-demo-room",
  name: "CommandCanvas demo",
  mode: "demo",
  revision: 2,
  created_by: HOST_ID,
  created_at: CREATED_AT,
  updated_at: MOVED_AT,
};

const payload = {
  text: "Decide which workflow proves the product thesis.",
  tone: "sky",
};

const createSnapshot = {
  id: "note-launch",
  roomId: ROOM_ID,
  type: "note",
  title: "Launch decision",
  x: 120,
  y: 80,
  width: 280,
  height: 190,
  zIndex: 1,
  minimized: false,
  pinned: false,
  createdBy: HOST_ID,
  createdAt: CREATED_AT,
  updatedAt: CREATED_AT,
  deletedAt: null,
  version: 1,
  revision: 1,
  metadata: {},
  payload,
};

const moveSnapshot = {
  ...createSnapshot,
  x: 420,
  updatedAt: MOVED_AT,
  version: 2,
  revision: 2,
};

const objectRow = {
  id: "note-launch",
  room_id: ROOM_ID,
  object_type: "note",
  title: "Launch decision",
  x: 420,
  y: 80,
  width: 280,
  height: 190,
  z_index: 1,
  minimized: false,
  pinned: false,
  created_by: HOST_ID,
  created_at: CREATED_AT,
  updated_at: MOVED_AT,
  deleted_at: null,
  version: 2,
  revision: 2,
  metadata: {},
  payload,
};

const createReceiptRow = {
  id: RECEIPT_CREATE_ID,
  room_id: ROOM_ID,
  revision: 1,
  occurred_at: CREATED_AT,
  actor_user_id: HOST_ID,
  actor_type: "human",
  source: "typed",
  actor_display_name: "Danny",
  action: "create",
  affected_object_ids: ["note-launch"],
  previous_state: [{ objectId: "note-launch", state: null }],
  resulting_state: [{ objectId: "note-launch", state: createSnapshot }],
  inverse_command: { schemaVersion: 1, changes: [] },
  reversible: true,
  undoes_receipt_id: null,
  description: "Danny created “Launch decision”.",
};

const moveReceiptRow = {
  id: RECEIPT_MOVE_ID,
  room_id: ROOM_ID,
  revision: 2,
  occurred_at: MOVED_AT,
  actor_user_id: PARTICIPANT_ID,
  actor_type: "participant",
  source: "collaborator",
  actor_display_name: "Sarah",
  action: "transform",
  affected_object_ids: ["note-launch"],
  previous_state: [{ objectId: "note-launch", state: createSnapshot }],
  resulting_state: [{ objectId: "note-launch", state: moveSnapshot }],
  inverse_command: { schemaVersion: 1, changes: [] },
  reversible: true,
  undoes_receipt_id: null,
  description: "Sarah transformed “Launch decision” spatially.",
};

function persistenceInput(overrides?: {
  room?: unknown;
  objects?: unknown[];
  receipts?: unknown[];
}) {
  return {
    room: overrides?.room ?? roomRow,
    objects: overrides?.objects ?? [objectRow],
    receipts: overrides?.receipts ?? [createReceiptRow, moveReceiptRow],
  };
}

function parseFixture(): CanvasState {
  const parsed = parseCanvasPersistenceRows(persistenceInput());
  if (!parsed.ok) throw new Error(parsed.error.message);
  return parsed.state;
}

function envelope(
  state: CanvasState,
  command: CanvasCommandEnvelope["command"],
): CanvasCommandEnvelope {
  return {
    id: "command-next",
    roomId: state.roomId,
    baseRevision: state.revision,
    issuedAt: COMMAND_AT,
    actor: { id: HOST_ID, displayName: "Danny", type: "human" },
    source: "pointer",
    command,
  };
}

describe("parseCanvasPersistenceRows", () => {
  it("maps strict deployed rows into the exact canonical canvas state", () => {
    const result = parseCanvasPersistenceRows(persistenceInput());

    expect(result).toEqual({
      ok: true,
      state: {
        roomId: ROOM_ID,
        revision: 2,
        objects: {
          "note-launch": {
            id: "note-launch",
            roomId: ROOM_ID,
            type: "note",
            title: "Launch decision",
            x: 420,
            y: 80,
            width: 280,
            height: 190,
            zIndex: 1,
            minimized: false,
            pinned: false,
            createdBy: HOST_ID,
            createdAt: CREATED_AT,
            updatedAt: MOVED_AT,
            deletedAt: null,
            version: 2,
            metadata: {},
            payload,
          },
        },
        receipts: [
          {
            id: RECEIPT_CREATE_ID,
            roomId: ROOM_ID,
            commandId: RECEIPT_CREATE_ID,
            revision: 1,
            occurredAt: CREATED_AT,
            actor: { id: HOST_ID, displayName: "Danny", type: "human" },
            source: "typed",
            action: "create",
            affectedObjectIds: ["note-launch"],
            before: { objects: { "note-launch": null } },
            after: {
              objects: {
                "note-launch": {
                  id: "note-launch",
                  roomId: ROOM_ID,
                  type: "note",
                  title: "Launch decision",
                  x: 120,
                  y: 80,
                  width: 280,
                  height: 190,
                  zIndex: 1,
                  minimized: false,
                  pinned: false,
                  createdBy: HOST_ID,
                  createdAt: CREATED_AT,
                  updatedAt: CREATED_AT,
                  deletedAt: null,
                  version: 1,
                  metadata: {},
                  payload,
                },
              },
            },
            description: "Danny created “Launch decision”.",
          },
          {
            id: RECEIPT_MOVE_ID,
            roomId: ROOM_ID,
            commandId: RECEIPT_MOVE_ID,
            revision: 2,
            occurredAt: MOVED_AT,
            actor: {
              id: PARTICIPANT_ID,
              displayName: "Sarah",
              type: "participant",
            },
            source: "collaborator",
            action: "transform",
            affectedObjectIds: ["note-launch"],
            before: {
              objects: {
                "note-launch": expect.objectContaining({ x: 120, version: 1 }),
              },
            },
            after: {
              objects: {
                "note-launch": expect.objectContaining({ x: 420, version: 2 }),
              },
            },
            description: "Sarah transformed “Launch decision” spatially.",
          },
        ],
        undoneReceiptIds: [],
      },
    });
  });

  it("reloads an agent WebMCP receipt source from the durable row without context", () => {
    const result = parseCanvasPersistenceRows(
      persistenceInput({
        room: { ...roomRow, revision: 1, updated_at: CREATED_AT },
        objects: [
          {
            ...objectRow,
            x: createSnapshot.x,
            updated_at: CREATED_AT,
            version: 1,
            revision: 1,
          },
        ],
        receipts: [
          {
            ...createReceiptRow,
            actor_type: "agent",
            source: "webmcp",
            actor_display_name: "CommandCanvas agent",
          },
        ],
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.state.receipts[0]).toMatchObject({
      commandId: RECEIPT_CREATE_ID,
      source: "webmcp",
      actor: {
        id: HOST_ID,
        displayName: "CommandCanvas agent",
        type: "agent",
      },
    });
  });

  it("refuses a durable receipt source that is inconsistent with its actor", () => {
    const result = parseCanvasPersistenceRows(
      persistenceInput({
        receipts: [
          { ...createReceiptRow, source: "collaborator" },
          moveReceiptRow,
        ],
      }),
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: "INVALID_RECEIPT_STATE",
        entity: "receipt",
        index: 0,
        message: "Receipt source is inconsistent with its actor type.",
      },
    });
  });

  it("returns a compact object-row failure for a malformed discriminated payload", () => {
    const result = parseCanvasPersistenceRows(
      persistenceInput({
        objects: [{ ...objectRow, payload: { ...payload, tone: "neon" } }],
      }),
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: "INVALID_ROW",
        entity: "object",
        index: 0,
        message: "Persisted object row 0 is invalid.",
      },
    });
  });

  it("refuses an object from another room instead of silently excluding it", () => {
    const result = parseCanvasPersistenceRows(
      persistenceInput({ objects: [{ ...objectRow, room_id: OTHER_ROOM_ID }] }),
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: "ROOM_MISMATCH",
        entity: "object",
        index: 0,
        message: "Persisted object row 0 belongs to a different room.",
      },
    });
  });

  it("refuses duplicate or non-increasing receipt revisions", () => {
    const result = parseCanvasPersistenceRows(
      persistenceInput({
        receipts: [
          createReceiptRow,
          { ...moveReceiptRow, revision: createReceiptRow.revision },
        ],
      }),
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: "REVISION_ORDER",
        entity: "receipt",
        index: 1,
        message: "Persisted receipts must have unique increasing revisions.",
      },
    });
  });

  it("refuses a current row that is stale relative to its latest receipt state", () => {
    const result = parseCanvasPersistenceRows(
      persistenceInput({ objects: [{ ...objectRow, x: 999 }] }),
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: "STALE_RECEIPT_STATE",
        entity: "receipt",
        index: 1,
        message: "Latest receipt state does not match object “note-launch”.",
      },
    });
  });

  it("refuses a current row whose database revision predates its latest receipt", () => {
    const result = parseCanvasPersistenceRows(
      persistenceInput({ objects: [{ ...objectRow, revision: 1 }] }),
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: "STALE_RECEIPT_STATE",
        entity: "receipt",
        index: 1,
        message: "Latest receipt state does not match object “note-launch”.",
      },
    });
  });

  it("refuses a receipt-created object that was silently omitted from current rows", () => {
    const result = parseCanvasPersistenceRows(
      persistenceInput({ objects: [] }),
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: "STALE_RECEIPT_STATE",
        entity: "receipt",
        index: 1,
        message: "Latest receipt state does not match object “note-launch”.",
      },
    });
  });

  it("preserves an explicitly soft-deleted object in canonical state", () => {
    const deletedAt = "2026-08-27T16:03:00.000Z";
    const deletedSnapshot = {
      ...moveSnapshot,
      deletedAt,
      updatedAt: deletedAt,
      version: 3,
      revision: 3,
    };
    const discardReceipt = {
      ...moveReceiptRow,
      id: "55555555-5555-4555-8555-555555555555",
      revision: 3,
      occurred_at: deletedAt,
      actor_user_id: HOST_ID,
      actor_type: "human",
      source: "pointer",
      actor_display_name: "Danny",
      action: "discard",
      previous_state: [{ objectId: "note-launch", state: moveSnapshot }],
      resulting_state: [{ objectId: "note-launch", state: deletedSnapshot }],
      description: "Danny moved “Launch decision” to recoverable trash.",
    };
    const result = parseCanvasPersistenceRows(
      persistenceInput({
        room: { ...roomRow, revision: 3, updated_at: deletedAt },
        objects: [
          {
            ...objectRow,
            deleted_at: deletedAt,
            updated_at: deletedAt,
            version: 3,
            revision: 3,
          },
        ],
        receipts: [createReceiptRow, moveReceiptRow, discardReceipt],
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.state.objects["note-launch"]?.deletedAt).toBe(deletedAt);
  });
});

describe("buildCanvasMutationPlan", () => {
  it("builds the server-owned mutable create state with a null expected version", () => {
    const empty: CanvasState = {
      roomId: ROOM_ID,
      revision: 0,
      objects: {},
      receipts: [],
      undoneReceiptIds: [],
    };
    const command = envelope(empty, {
      type: "object.create",
      object: {
        id: "note-created",
        type: "note",
        title: "Created through RPC",
        x: 200,
        y: 140,
        width: 280,
        height: 190,
        zIndex: 3,
        payload: { text: "One canonical mutation.", tone: "coral" },
      },
    });

    const result = buildCanvasMutationPlan(empty, command);

    expect(result).toEqual({
      ok: true,
      plan: {
        action: "create",
        description: "Danny created “Created through RPC”.",
        changes: [
          {
            objectId: "note-created",
            expectedVersion: null,
            after: {
              type: "note",
              title: "Created through RPC",
              x: 200,
              y: 140,
              width: 280,
              height: 190,
              zIndex: 3,
              minimized: false,
              pinned: false,
              deletedAt: null,
              metadata: {},
              payload: { text: "One canonical mutation.", tone: "coral" },
            },
          },
        ],
        reversible: true,
        undoesReceiptId: null,
      },
    });
  });

  it.each([
    {
      label: "transform",
      command: {
        type: "object.transform" as const,
        objectId: "note-launch",
        transform: { x: 600, width: 360 },
      },
      action: "transform",
      expectedAfter: { x: 600, width: 360, deletedAt: null },
    },
    {
      label: "flags",
      command: {
        type: "object.set_flags" as const,
        objectId: "note-launch",
        flags: { pinned: true },
      },
      action: "pin",
      expectedAfter: { pinned: true, deletedAt: null },
    },
    {
      label: "discard",
      command: {
        type: "object.discard" as const,
        objectId: "note-launch",
      },
      action: "discard",
      expectedAfter: { deletedAt: COMMAND_AT },
    },
  ])("builds $label against the persisted object version", (fixture) => {
    const state = parseFixture();

    const result = buildCanvasMutationPlan(
      state,
      envelope(state, fixture.command),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.plan).toMatchObject({
      action: fixture.action,
      changes: [
        {
          objectId: "note-launch",
          expectedVersion: 2,
          after: fixture.expectedAfter,
        },
      ],
      reversible: true,
      undoesReceiptId: null,
    });
  });

  it("maps undo to no client changes and the latest reversible receipt ID", () => {
    const state = parseFixture();

    const result = buildCanvasMutationPlan(
      state,
      envelope(state, { type: "history.undo" }),
    );

    expect(result).toEqual({
      ok: true,
      plan: {
        action: "undo",
        description:
          "Danny undid: Sarah transformed “Launch decision” spatially.",
        changes: [],
        reversible: false,
        undoesReceiptId: RECEIPT_MOVE_ID,
      },
    });
  });

  it("refuses a typed-looking current state whose object payload is malformed", () => {
    const state = parseFixture();
    const malformed = {
      ...state,
      objects: {
        ...state.objects,
        "note-launch": {
          ...state.objects["note-launch"],
          payload: { ...payload, tone: "neon" },
        },
      },
    } as unknown as CanvasState;

    const result = buildCanvasMutationPlan(
      malformed,
      envelope(malformed, {
        type: "object.transform",
        objectId: "note-launch",
        transform: { x: 700 },
      }),
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: "INVALID_STATE",
        message: "Current canvas state is invalid.",
      },
    });
  });
});
