import { describe, expect, it, vi } from "vitest";

import type { CommandRequest } from "@/lib/supabase/room-contracts";
import {
  createRoomService,
  type RoomServiceClient,
  type RoomServiceDependencies,
} from "@/lib/supabase/room-service";

const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const HOST_ID = "22222222-2222-4222-8222-222222222222";
const PARTICIPANT_ID = "33333333-3333-4333-8333-333333333333";
const OUTSIDER_ID = "44444444-4444-4444-8444-444444444444";
const COMMAND_ID = "55555555-5555-4555-8555-555555555555";
const CREATED_AT = "2026-08-27T16:00:00.000Z";
const SLUG = "room-2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a";
const JOIN_TOKEN =
  "q6urq6urq6urq6urq6urq6urq6urq6urq6urq6urq6s";

type QueryResult = { data: unknown; error: unknown };

interface QueryTrace {
  table: string;
  select?: string;
  filters: Array<[string, unknown]>;
  orders: Array<[string, { ascending: boolean }]>;
  cardinality?: "maybeSingle";
}

function createClient(input?: {
  tableResults?: Partial<Record<string, QueryResult[]>>;
  rpcResults?: QueryResult[];
}) {
  const queues = new Map(
    Object.entries(input?.tableResults ?? {}).map(([table, values]) => [
      table,
      [...(values ?? [])],
    ]),
  );
  const traces: QueryTrace[] = [];
  const rpcResults = [...(input?.rpcResults ?? [])];

  function take(table: string): QueryResult {
    return queues.get(table)?.shift() ?? { data: null, error: null };
  }

  const client = {
    from: vi.fn((table: string) => {
      const trace: QueryTrace = { table, filters: [], orders: [] };
      traces.push(trace);
      const builder = {
        select(columns: string) {
          trace.select = columns;
          return builder;
        },
        eq(column: string, value: unknown) {
          trace.filters.push([column, value]);
          return builder;
        },
        order(column: string, options: { ascending: boolean }) {
          trace.orders.push([column, options]);
          return builder;
        },
        maybeSingle() {
          trace.cardinality = "maybeSingle";
          return Promise.resolve(take(table));
        },
        then<TResult1 = QueryResult, TResult2 = never>(
          onfulfilled?:
            | ((value: QueryResult) => TResult1 | PromiseLike<TResult1>)
            | null,
          onrejected?:
            | ((reason: unknown) => TResult2 | PromiseLike<TResult2>)
            | null,
        ) {
          return Promise.resolve(take(table)).then(onfulfilled, onrejected);
        },
      };
      return builder;
    }),
    rpc: vi.fn(async () =>
      rpcResults.shift() ?? { data: null, error: null },
    ),
  };

  return {
    client: client as unknown as RoomServiceClient,
    rawClient: client,
    traces,
  };
}

const dependencies: RoomServiceDependencies = {
  createUuid: () => ROOM_ID,
  randomBytes: (size) => {
    if (size === 16) return new Uint8Array(16).fill(0x2a);
    if (size === 32) return new Uint8Array(32).fill(0xab);
    throw new Error(`Unexpected random byte count: ${size}`);
  },
  now: () => new Date(CREATED_AT),
};

const emptyRoomRow = {
  id: ROOM_ID,
  slug: SLUG,
  name: "Launch room",
  mode: "demo",
  revision: 0,
  created_by: HOST_ID,
  created_at: CREATED_AT,
  updated_at: CREATED_AT,
};

function memberRow(
  role: "host" | "participant",
  displayName = role === "host" ? "Danny" : "Sarah",
) {
  return { role, display_name: displayName };
}

function createNoteRequest(
  source: CommandRequest["source"] = "typed",
): CommandRequest {
  return {
    commandId: COMMAND_ID,
    roomId: ROOM_ID,
    baseRevision: 0,
    source,
    command: {
      type: "object.create",
      object: {
        id: "note-launch",
        type: "note",
        title: "Launch decision",
        x: 120,
        y: 80,
        width: 280,
        height: 190,
        zIndex: 1,
        payload: {
          text: "Prove the shared spatial workflow.",
          tone: "sky",
        },
      },
    },
  };
}

function createdObjectRow(actorUserId: string) {
  return {
    id: "note-launch",
    room_id: ROOM_ID,
    object_type: "note",
    title: "Launch decision",
    x: 120,
    y: 80,
    width: 280,
    height: 190,
    z_index: 1,
    rotation: 0,
    parent_id: null,
    minimized: false,
    pinned: false,
    created_by: actorUserId,
    created_at: CREATED_AT,
    updated_at: CREATED_AT,
    deleted_at: null,
    version: 1,
    revision: 1,
    metadata: {},
    payload: {
      text: "Prove the shared spatial workflow.",
      tone: "sky",
    },
  };
}

function createdSnapshot(actorUserId: string) {
  return {
    id: "note-launch",
    roomId: ROOM_ID,
    type: "note",
    title: "Launch decision",
    x: 120,
    y: 80,
    width: 280,
            height: 190,
            zIndex: 1,
            rotation: 0,
            parentId: null,
            minimized: false,
    pinned: false,
    createdBy: actorUserId,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    deletedAt: null,
    version: 1,
    revision: 1,
    metadata: {},
    payload: {
      text: "Prove the shared spatial workflow.",
      tone: "sky",
    },
  };
}

function createdReceiptRow(input: {
  actorUserId: string;
  actorType: "human" | "participant" | "agent";
  actorDisplayName: string;
  source?: "typed" | "collaborator" | "webmcp";
}) {
  return {
    id: COMMAND_ID,
    room_id: ROOM_ID,
    revision: 1,
    occurred_at: CREATED_AT,
    actor_user_id: input.actorUserId,
    actor_type: input.actorType,
    source:
      input.source ??
      (input.actorType === "participant"
        ? "collaborator"
        : input.actorType === "agent"
          ? "webmcp"
          : "typed"),
    actor_display_name: input.actorDisplayName,
    action: "create",
    affected_object_ids: ["note-launch"],
    previous_state: [{ objectId: "note-launch", state: null }],
    resulting_state: [
      { objectId: "note-launch", state: createdSnapshot(input.actorUserId) },
    ],
    inverse_command: { schemaVersion: 1, changes: [] },
    reversible: true,
    undoes_receipt_id: null,
    description: `${input.actorDisplayName} created “Launch decision”.`,
  };
}

function successfulCommitClient(input: {
  member: ReturnType<typeof memberRow>;
  actorUserId: string;
  actorType: "human" | "participant" | "agent";
  actorDisplayName: string;
  source?: "typed" | "collaborator" | "webmcp";
}) {
  return createClient({
    tableResults: {
      room_members: [{ data: input.member, error: null }],
      rooms: [
        { data: emptyRoomRow, error: null },
        { data: emptyRoomRow, error: null },
        {
          data: {
            ...emptyRoomRow,
            revision: 1,
            updated_at: CREATED_AT,
          },
          error: null,
        },
        {
          data: {
            ...emptyRoomRow,
            revision: 1,
            updated_at: CREATED_AT,
          },
          error: null,
        },
      ],
      canvas_objects: [
        { data: [], error: null },
        { data: [createdObjectRow(input.actorUserId)], error: null },
      ],
      receipts: [
        { data: [], error: null },
        {
          data: [
            createdReceiptRow({
              actorUserId: input.actorUserId,
              actorType: input.actorType,
              actorDisplayName: input.actorDisplayName,
              source: input.source,
            }),
          ],
          error: null,
        },
      ],
    },
    rpcResults: [
      {
        data: {
          receiptId: COMMAND_ID,
          revision: 1,
          action: "create",
          affectedObjectIds: ["note-launch"],
        },
        error: null,
      },
    ],
  });
}

describe("CommandCanvas room service", () => {
  it("creates a room with a 128-bit slug and exactly 32 random token bytes", async () => {
    const harness = createClient({
      rpcResults: [
        {
          data: {
            roomId: ROOM_ID,
            slug: SLUG,
            role: "host",
            joined: true,
            resumed: false,
          },
          error: null,
        },
      ],
    });
    const service = createRoomService(harness.client, dependencies);

    const result = await service.createRoom(HOST_ID, {
      mode: "demo",
      name: "Launch room",
      displayName: "Danny",
      color: "#275ed7",
    });

    expect(result).toEqual({
      ok: true,
      value: {
        roomId: ROOM_ID,
        slug: SLUG,
        joinToken: JOIN_TOKEN,
        role: "host",
        joined: true,
      },
    });
    expect(JOIN_TOKEN).toHaveLength(43);
    expect(harness.rawClient.rpc).toHaveBeenCalledWith(
      "open_demo_room_with_host",
      {
        p_room_id: ROOM_ID,
        p_slug: SLUG,
        p_name: "Launch room",
        p_host_user_id: HOST_ID,
        p_display_name: "Danny",
        p_color: "#275ed7",
        p_join_token: JOIN_TOKEN,
      },
    );
  });

  it("accepts a verified resumed room and returns only its newly rotated capability", async () => {
    const resumedRoomId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const resumedSlug = "room-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const harness = createClient({
      rpcResults: [
        {
          data: {
            roomId: resumedRoomId,
            slug: resumedSlug,
            role: "host",
            joined: true,
            resumed: true,
          },
          error: null,
        },
      ],
    });

    const result = await createRoomService(
      harness.client,
      dependencies,
    ).createRoom(HOST_ID, {
      mode: "demo",
      name: "Launch room",
      displayName: "Danny",
      color: "#275ed7",
    });

    expect(result).toEqual({
      ok: true,
      value: {
        roomId: resumedRoomId,
        slug: resumedSlug,
        joinToken: JOIN_TOKEN,
        role: "host",
        joined: true,
      },
    });
    expect(JSON.stringify(result)).not.toContain(ROOM_ID);
    expect(harness.rawClient.rpc).toHaveBeenCalledExactlyOnceWith(
      "open_demo_room_with_host",
      expect.objectContaining({ p_join_token: JOIN_TOKEN }),
    );
  });

  it("refuses standard rooms before the legacy create capability is called", async () => {
    const harness = createClient();

    const result = await createRoomService(
      harness.client,
      dependencies,
    ).createRoom(
      HOST_ID,
      {
        mode: "standard",
        name: "Standard meeting",
        displayName: "Danny",
        color: "#275ed7",
      } as never,
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: "create_unavailable",
        message: "Room could not be created.",
      },
    });
    expect(harness.rawClient.rpc).not.toHaveBeenCalled();
  });

  it("never returns the raw join token when room creation fails", async () => {
    const harness = createClient({
      rpcResults: [
        {
          data: null,
          error: {
            code: "P0001",
            message: `room_create_conflict:${JOIN_TOKEN}`,
          },
        },
      ],
    });
    const service = createRoomService(harness.client, dependencies);

    const result = await service.createRoom(HOST_ID, {
      mode: "demo",
      name: "Launch room",
      displayName: "Danny",
      color: "#275ed7",
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "create_unavailable",
        message: "Room could not be created.",
      },
    });
    expect(JSON.stringify(result)).not.toContain(JOIN_TOKEN);
  });

  it("surfaces the serialized demo-room cap without provider details", async () => {
    const harness = createClient({
      rpcResults: [
        {
          data: null,
          error: {
            code: "P0001",
            message: "demo_room_limit_reached",
            details: "provider-only detail",
          },
        },
      ],
    });

    const result = await createRoomService(
      harness.client,
      dependencies,
    ).createRoom(HOST_ID, {
      mode: "demo",
      name: "Fourth demo room",
      displayName: "Danny",
      color: "#275ed7",
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "demo_room_limit_reached",
        message: "Reset one of your demo rooms before creating another.",
      },
    });
    expect(JSON.stringify(result)).not.toContain("provider-only");
  });

  it.each([
    "demo_room_global_capacity_reached",
    "demo_room_daily_limit_reached",
  ])("maps the bounded public-preview refusal %s to one actionable response", async (providerMessage) => {
    const harness = createClient({
      rpcResults: [
        {
          data: null,
          error: {
            code: "P0001",
            message: providerMessage,
            details: "private provider capacity detail",
          },
        },
      ],
    });

    const result = await createRoomService(
      harness.client,
      dependencies,
    ).createRoom(HOST_ID, {
      mode: "demo",
      name: "No-signup judge preview",
      displayName: "Danny",
      color: "#275ed7",
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "demo_room_limit_reached",
        message:
          "The no-signup judge preview is at capacity. Sign in to start a workspace or try again later.",
      },
    });
    expect(JSON.stringify(result)).not.toContain("provider");
  });

  it("deletes one exact demo room through the host-checked RPC", async () => {
    const harness = createClient({
      rpcResults: [
        {
          data: { roomId: ROOM_ID, deleted: true },
          error: null,
        },
      ],
    });
    const service = createRoomService(harness.client, dependencies);

    const result = await service.deleteDemoRoom(HOST_ID, ROOM_ID);

    expect(result).toEqual({
      ok: true,
      value: { roomId: ROOM_ID, deleted: true },
    });
    expect(harness.rawClient.rpc).toHaveBeenCalledExactlyOnceWith(
      "delete_demo_room_as_host",
      {
        p_room_id: ROOM_ID,
        p_actor_user_id: HOST_ID,
      },
    );
  });

  it("does not let a participant or missing room escape the same compact delete refusal", async () => {
    const harness = createClient({
      rpcResults: [
        {
          data: null,
          error: { code: "P0001", message: "demo_room_delete_forbidden" },
        },
      ],
    });

    const result = await createRoomService(
      harness.client,
      dependencies,
    ).deleteDemoRoom(PARTICIPANT_ID, ROOM_ID);

    expect(result).toEqual({
      ok: false,
      error: {
        code: "host_required",
        message: "Only the demo room host can delete this room.",
      },
    });
  });

  it("collapses a missing slug and token mismatch into the same join error", async () => {
    const missingHarness = createClient({
      tableResults: {
        rooms: [{ data: null, error: null }],
      },
    });
    const mismatchHarness = createClient({
      tableResults: {
        rooms: [{ data: { id: ROOM_ID, mode: "demo" }, error: null }],
      },
      rpcResults: [
        {
          data: null,
          error: { code: "P0001", message: "room_join_token_mismatch" },
        },
      ],
    });
    const input = {
      slug: SLUG,
      joinToken: JOIN_TOKEN,
      displayName: "Sarah",
      color: "#7558cf",
    } as const;

    const missing = await createRoomService(
      missingHarness.client,
      dependencies,
    ).joinRoom(PARTICIPANT_ID, input);
    const mismatch = await createRoomService(
      mismatchHarness.client,
      dependencies,
    ).joinRoom(PARTICIPANT_ID, input);

    expect(missing).toEqual({
      ok: false,
      error: {
        code: "join_unavailable",
        message: "Room is unavailable or the join link is invalid.",
      },
    });
    expect(mismatch).toEqual(missing);
    expect(mismatchHarness.rawClient.rpc).toHaveBeenCalledWith(
      "join_room_as_participant",
      {
        p_room_id: ROOM_ID,
        p_user_id: PARTICIPANT_ID,
        p_display_name: "Sarah",
        p_color: "#7558cf",
        p_join_token: JOIN_TOKEN,
        p_requested_role: "participant",
      },
    );
  });

  it("joins only a demo room through the legacy join capability", async () => {
    const harness = createClient({
      tableResults: {
        rooms: [{ data: { id: ROOM_ID, mode: "demo" }, error: null }],
      },
      rpcResults: [
        {
          data: {
            roomId: ROOM_ID,
            role: "participant",
            joined: true,
          },
          error: null,
        },
      ],
    });

    const result = await createRoomService(
      harness.client,
      dependencies,
    ).joinRoom(PARTICIPANT_ID, {
      slug: SLUG,
      joinToken: JOIN_TOKEN,
      displayName: "Sarah",
      color: "#7558cf",
    });

    expect(result).toEqual({
      ok: true,
      value: {
        roomId: ROOM_ID,
        role: "participant",
        joined: true,
      },
    });
    expect(harness.traces[0]).toEqual({
      table: "rooms",
      select: "id, mode",
      filters: [["slug", SLUG]],
      orders: [],
      cardinality: "maybeSingle",
    });
  });

  it("collapses a standard room legacy join into the non-enumerating refusal", async () => {
    const harness = createClient({
      tableResults: {
        rooms: [{ data: { id: ROOM_ID, mode: "standard" }, error: null }],
      },
    });

    const result = await createRoomService(
      harness.client,
      dependencies,
    ).joinRoom(PARTICIPANT_ID, {
      slug: SLUG,
      joinToken: JOIN_TOKEN,
      displayName: "Sarah",
      color: "#7558cf",
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "join_unavailable",
        message: "Room is unavailable or the join link is invalid.",
      },
    });
    expect(harness.traces[0]).toEqual({
      table: "rooms",
      select: "id, mode",
      filters: [["slug", SLUG]],
      orders: [],
      cardinality: "maybeSingle",
    });
    expect(harness.rawClient.rpc).not.toHaveBeenCalled();
  });

  it("loads one exact room, all objects, and receipts in ascending revision order", async () => {
    const harness = createClient({
      tableResults: {
        rooms: [
          { data: emptyRoomRow, error: null },
          { data: emptyRoomRow, error: null },
        ],
        canvas_objects: [{ data: [], error: null }],
        receipts: [{ data: [], error: null }],
      },
    });
    const service = createRoomService(harness.client, dependencies);

    const result = await service.loadCanvas(ROOM_ID);

    expect(result).toEqual({
      ok: true,
      value: {
        roomId: ROOM_ID,
        revision: 0,
        objects: {},
        receipts: [],
        undoneReceiptIds: [],
        redoReceiptIds: [],
      },
    });
    expect(harness.traces).toEqual([
      {
        table: "rooms",
        select: "*",
        filters: [["id", ROOM_ID]],
        orders: [],
        cardinality: "maybeSingle",
      },
      {
        table: "canvas_objects",
        select: "*",
        filters: [["room_id", ROOM_ID]],
        orders: [["id", { ascending: true }]],
      },
      {
        table: "receipts",
        select: "*",
        filters: [["room_id", ROOM_ID]],
        orders: [["revision", { ascending: true }]],
      },
      {
        table: "rooms",
        select: "*",
        filters: [["id", ROOM_ID]],
        orders: [],
        cardinality: "maybeSingle",
      },
    ]);
  });

  it("refuses a valid room row that does not match the requested room ID", async () => {
    const wrongRoom = { ...emptyRoomRow, id: OUTSIDER_ID };
    const harness = createClient({
      tableResults: {
        rooms: [
          { data: wrongRoom, error: null },
          { data: wrongRoom, error: null },
        ],
        canvas_objects: [{ data: [], error: null }],
        receipts: [{ data: [], error: null }],
      },
    });

    const result = await createRoomService(
      harness.client,
      dependencies,
    ).loadCanvas(ROOM_ID);

    expect(result).toEqual({
      ok: false,
      error: {
        code: "invalid_persisted_state",
        message: "Canvas state could not be verified.",
      },
    });
  });

  it("returns a compact failure instead of exposing a malformed persisted row", async () => {
    const harness = createClient({
      tableResults: {
        rooms: [
          { data: emptyRoomRow, error: null },
          { data: emptyRoomRow, error: null },
        ],
        canvas_objects: [
          {
            data: [{ id: "malformed", secret_column: "do-not-expose" }],
            error: null,
          },
        ],
        receipts: [{ data: [], error: null }],
      },
    });

    const result = await createRoomService(
      harness.client,
      dependencies,
    ).loadCanvas(ROOM_ID);

    expect(result).toEqual({
      ok: false,
      error: {
        code: "invalid_persisted_state",
        message: "Canvas state could not be verified.",
      },
    });
    expect(JSON.stringify(result)).not.toContain("secret_column");
  });

  it("retries one torn snapshot and returns the second stable room revision", async () => {
    const revisionOneRoom = {
      ...emptyRoomRow,
      revision: 1,
      updated_at: "2026-08-27T16:01:00.000Z",
    };
    const harness = createClient({
      tableResults: {
        rooms: [
          { data: emptyRoomRow, error: null },
          { data: revisionOneRoom, error: null },
          { data: revisionOneRoom, error: null },
          { data: revisionOneRoom, error: null },
        ],
        canvas_objects: [
          { data: [], error: null },
          { data: [], error: null },
        ],
        receipts: [
          { data: [], error: null },
          { data: [], error: null },
        ],
      },
    });

    const result = await createRoomService(
      harness.client,
      dependencies,
    ).loadCanvas(ROOM_ID);

    expect(result).toEqual({
      ok: true,
      value: {
        roomId: ROOM_ID,
        revision: 1,
        objects: {},
        receipts: [],
        undoneReceiptIds: [],
        redoReceiptIds: [],
      },
    });
    expect(harness.traces.filter(({ table }) => table === "rooms")).toHaveLength(
      4,
    );
    expect(
      harness.traces.filter(({ table }) => table === "canvas_objects"),
    ).toHaveLength(2);
    expect(
      harness.traces.filter(({ table }) => table === "receipts"),
    ).toHaveLength(2);
  });

  it("returns compact unavailable when the one snapshot retry is also torn", async () => {
    const harness = createClient({
      tableResults: {
        rooms: [
          { data: emptyRoomRow, error: null },
          { data: { ...emptyRoomRow, revision: 1 }, error: null },
          { data: { ...emptyRoomRow, revision: 1 }, error: null },
          { data: { ...emptyRoomRow, revision: 2 }, error: null },
        ],
        canvas_objects: [
          { data: [], error: null },
          { data: [], error: null },
        ],
        receipts: [
          { data: [], error: null },
          { data: [], error: null },
        ],
      },
    });

    const result = await createRoomService(
      harness.client,
      dependencies,
    ).loadCanvas(ROOM_ID);

    expect(result).toEqual({
      ok: false,
      error: {
        code: "room_unavailable",
        message: "Room is unavailable.",
      },
    });
    expect(harness.traces.filter(({ table }) => table === "rooms")).toHaveLength(
      4,
    );
  });

  it("refuses a nonmember before loading state or invoking the mutation RPC", async () => {
    const harness = createClient({
      tableResults: {
        room_members: [{ data: null, error: null }],
      },
    });

    const result = await createRoomService(
      harness.client,
      dependencies,
    ).commitCommand(OUTSIDER_ID, createNoteRequest());

    expect(result).toEqual({
      ok: false,
      error: {
        code: "member_required",
        message: "Join this room before changing its canvas.",
      },
    });
    expect(harness.rawClient.rpc).not.toHaveBeenCalled();
    expect(harness.rawClient.from).toHaveBeenCalledOnce();
  });

  it("binds a participant WebMCP mutation to the authenticated participant", async () => {
    const harness = successfulCommitClient({
      member: memberRow("participant", "Sarah"),
      actorUserId: PARTICIPANT_ID,
      actorType: "participant",
      actorDisplayName: "Sarah",
      source: "webmcp",
    });

    const result = await createRoomService(
      harness.client,
      dependencies,
    ).commitCommand(PARTICIPANT_ID, createNoteRequest("webmcp"));

    expect(result.ok).toBe(true);
    expect(harness.rawClient.rpc).toHaveBeenCalledWith(
      "commit_canvas_mutation_at_revision",
      expect.objectContaining({
        p_expected_room_revision: 0,
        p_actor_user_id: PARTICIPANT_ID,
        p_actor_type: "participant",
        p_source: "webmcp",
        p_description: "Sarah created “Launch decision”.",
      }),
    );
    if (!result.ok) throw new Error("Expected participant WebMCP commit.");
    expect(result.value.state.receipts.at(-1)).toEqual(
      expect.objectContaining({
        source: "webmcp",
        actor: {
          id: PARTICIPANT_ID,
          displayName: "Sarah",
          type: "participant",
        },
      }),
    );
  });

  it("requires the client base revision to equal authoritative room revision", async () => {
    const harness = createClient({
      tableResults: {
        room_members: [{ data: memberRow("host"), error: null }],
        rooms: [
          { data: { ...emptyRoomRow, revision: 3 }, error: null },
          { data: { ...emptyRoomRow, revision: 3 }, error: null },
        ],
        canvas_objects: [{ data: [], error: null }],
        receipts: [{ data: [], error: null }],
      },
    });

    const result = await createRoomService(
      harness.client,
      dependencies,
    ).commitCommand(HOST_ID, createNoteRequest());

    expect(result).toEqual({
      ok: false,
      error: {
        code: "stale_revision",
        message: "Canvas changed. Reload and try again.",
      },
    });
    expect(harness.rawClient.rpc).not.toHaveBeenCalled();
  });

  it("enforces the canonical pinned-object transform guard before RPC", async () => {
    const pinnedObject = {
      ...createdObjectRow(HOST_ID),
      pinned: true,
    };
    const pinnedSnapshot = {
      ...createdSnapshot(HOST_ID),
      pinned: true,
    };
    const harness = createClient({
      tableResults: {
        room_members: [{ data: memberRow("host"), error: null }],
        rooms: [
          {
            data: { ...emptyRoomRow, revision: 1 },
            error: null,
          },
          {
            data: { ...emptyRoomRow, revision: 1 },
            error: null,
          },
        ],
        canvas_objects: [{ data: [pinnedObject], error: null }],
        receipts: [
          {
            data: [
              {
                ...createdReceiptRow({
                  actorUserId: HOST_ID,
                  actorType: "human",
                  actorDisplayName: "Danny",
                }),
                resulting_state: [
                  { objectId: "note-launch", state: pinnedSnapshot },
                ],
              },
            ],
            error: null,
          },
        ],
      },
    });

    const result = await createRoomService(
      harness.client,
      dependencies,
    ).commitCommand(HOST_ID, {
      commandId: COMMAND_ID,
      roomId: ROOM_ID,
      baseRevision: 1,
      source: "pointer",
      command: {
        type: "object.transform",
        objectId: "note-launch",
        transform: { x: 400 },
      },
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "object_pinned",
        commandCode: "OBJECT_PINNED",
        message: "Unpin the object before moving or resizing it.",
      },
    });
    expect(harness.rawClient.rpc).not.toHaveBeenCalled();
  });

  it("returns the actionable stale thought-card refusal before RPC", async () => {
    const harness = createClient({
      tableResults: {
        room_members: [{ data: memberRow("host"), error: null }],
        rooms: [
          { data: { ...emptyRoomRow, revision: 1 }, error: null },
          { data: { ...emptyRoomRow, revision: 1 }, error: null },
        ],
        canvas_objects: [{ data: [createdObjectRow(HOST_ID)], error: null }],
        receipts: [
          {
            data: [
              createdReceiptRow({
                actorUserId: HOST_ID,
                actorType: "human",
                actorDisplayName: "Danny",
              }),
            ],
            error: null,
          },
        ],
      },
    });

    const result = await createRoomService(
      harness.client,
      dependencies,
    ).commitCommand(HOST_ID, {
      commandId: COMMAND_ID,
      roomId: ROOM_ID,
      baseRevision: 1,
      source: "voice",
      command: {
        type: "object.append_note_text",
        objectId: "note-launch",
        expectedVersion: 2,
        text: "This must not overwrite newer collaborator text.",
      },
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "command_conflict",
        commandCode: "STALE_OBJECT_VERSION",
        message: "That thought card changed. Continue from its latest text.",
      },
    });
    expect(harness.rawClient.rpc).not.toHaveBeenCalled();
  });

  it("round-trips a successful dictated thought append returned as an update", async () => {
    const initialReceipt = {
      ...createdReceiptRow({
        actorUserId: HOST_ID,
        actorType: "human",
        actorDisplayName: "Danny",
      }),
      id: "66666666-6666-4666-8666-666666666666",
    };
    const updatedText =
      "Prove the shared spatial workflow.\nSupplier lead time is the launch risk.";
    const updatedObjectRow = {
      ...createdObjectRow(HOST_ID),
      version: 2,
      revision: 2,
      payload: { text: updatedText, tone: "sky" },
    };
    const updatedSnapshot = {
      ...createdSnapshot(HOST_ID),
      version: 2,
      revision: 2,
      payload: { text: updatedText, tone: "sky" },
    };
    const updateReceipt = {
      id: COMMAND_ID,
      room_id: ROOM_ID,
      revision: 2,
      occurred_at: CREATED_AT,
      actor_user_id: HOST_ID,
      actor_type: "human",
      source: "voice",
      actor_display_name: "Danny",
      action: "update",
      affected_object_ids: ["note-launch"],
      previous_state: [
        { objectId: "note-launch", state: createdSnapshot(HOST_ID) },
      ],
      resulting_state: [{ objectId: "note-launch", state: updatedSnapshot }],
      inverse_command: { schemaVersion: 1, changes: [] },
      reversible: true,
      undoes_receipt_id: null,
      description: "Danny added dictated text to “Launch decision”.",
    };
    const harness = createClient({
      tableResults: {
        room_members: [{ data: memberRow("host"), error: null }],
        rooms: [
          { data: { ...emptyRoomRow, revision: 1 }, error: null },
          { data: { ...emptyRoomRow, revision: 1 }, error: null },
          { data: { ...emptyRoomRow, revision: 2 }, error: null },
          { data: { ...emptyRoomRow, revision: 2 }, error: null },
        ],
        canvas_objects: [
          { data: [createdObjectRow(HOST_ID)], error: null },
          { data: [updatedObjectRow], error: null },
        ],
        receipts: [
          { data: [initialReceipt], error: null },
          { data: [initialReceipt, updateReceipt], error: null },
        ],
      },
      rpcResults: [
        {
          data: {
            receiptId: COMMAND_ID,
            revision: 2,
            action: "update",
            affectedObjectIds: ["note-launch"],
          },
          error: null,
        },
      ],
    });

    const result = await createRoomService(
      harness.client,
      dependencies,
    ).commitCommand(HOST_ID, {
      commandId: COMMAND_ID,
      roomId: ROOM_ID,
      baseRevision: 1,
      source: "voice",
      command: {
        type: "object.append_note_text",
        objectId: "note-launch",
        expectedVersion: 1,
        text: "Supplier lead time is the launch risk.",
      },
    });

    if (!result.ok) throw new Error(JSON.stringify(result.error));
    expect(result.ok).toBe(true);
    expect(result.value.state.objects["note-launch"]).toMatchObject({
      version: 2,
      payload: { text: updatedText, tone: "sky" },
    });
    expect(result.value.state.receipts.at(-1)).toMatchObject({
      id: COMMAND_ID,
      action: "update",
      source: "voice",
    });
    expect(harness.rawClient.rpc).toHaveBeenCalledWith(
      "commit_canvas_mutation_at_revision",
      expect.objectContaining({
        p_room_id: ROOM_ID,
        p_expected_room_revision: 1,
        p_actor_user_id: HOST_ID,
        p_actor_type: "human",
        p_source: "voice",
        p_action: "update",
        p_description: "Danny added dictated text to “Launch decision”.",
        p_changes: [
          expect.objectContaining({
            objectId: "note-launch",
            expectedVersion: 1,
          }),
        ],
      }),
    );
  });

  it("returns the canonical nothing-to-redo refusal before the mutation RPC", async () => {
    const harness = createClient({
      tableResults: {
        room_members: [{ data: memberRow("host", "Danny"), error: null }],
        rooms: [
          { data: emptyRoomRow, error: null },
          { data: emptyRoomRow, error: null },
        ],
        canvas_objects: [{ data: [], error: null }],
        receipts: [{ data: [], error: null }],
      },
    });

    const result = await createRoomService(
      harness.client,
      dependencies,
    ).commitCommand(HOST_ID, {
      commandId: COMMAND_ID,
      roomId: ROOM_ID,
      baseRevision: 0,
      source: "typed",
      command: { type: "history.redo" },
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "nothing_to_redo",
        commandCode: "NOTHING_TO_REDO",
        message: "There is nothing left to redo.",
      },
    });
    expect(harness.rawClient.rpc).not.toHaveBeenCalled();
  });

  it("derives a host human actor and sends only the canonical mutation plan", async () => {
    const harness = successfulCommitClient({
      member: memberRow("host", "Danny"),
      actorUserId: HOST_ID,
      actorType: "human",
      actorDisplayName: "Danny",
    });

    const result = await createRoomService(
      harness.client,
      dependencies,
    ).commitCommand(HOST_ID, createNoteRequest("typed"));

    expect(harness.rawClient.rpc).toHaveBeenCalledWith(
      "commit_canvas_mutation_at_revision",
      {
        p_room_id: ROOM_ID,
        p_expected_room_revision: 0,
        p_actor_user_id: HOST_ID,
        p_actor_type: "human",
        p_source: "typed",
        p_action: "create",
        p_description: "Danny created “Launch decision”.",
        p_changes: [
          {
            objectId: "note-launch",
            expectedVersion: null,
            after: {
              type: "note",
              title: "Launch decision",
              x: 120,
              y: 80,
              width: 280,
              height: 190,
              zIndex: 1,
              rotation: 0,
              parentId: null,
              minimized: false,
              pinned: false,
              deletedAt: null,
              metadata: {},
              payload: {
                text: "Prove the shared spatial workflow.",
                tone: "sky",
              },
            },
          },
        ],
        p_inverse_command: null,
        p_reversible: true,
        p_undoes_receipt_id: null,
        p_receipt_id: COMMAND_ID,
      },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error.message);
    expect(result.value).toEqual({
      roomId: ROOM_ID,
      revision: 1,
      receiptId: COMMAND_ID,
      state: expect.objectContaining({
        roomId: ROOM_ID,
        revision: 1,
        objects: {
          "note-launch": expect.objectContaining({
            id: "note-launch",
            createdBy: HOST_ID,
          }),
        },
      }),
    });
    expect(result.value.state.receipts.at(-1)).toEqual(
      expect.objectContaining({
        id: COMMAND_ID,
        commandId: COMMAND_ID,
        source: "typed",
        actor: { id: HOST_ID, displayName: "Danny", type: "human" },
      }),
    );
  });

  it("derives accountable participant and host actors independently of the WebMCP channel", async () => {
    const participantHarness = successfulCommitClient({
      member: memberRow("participant", "Sarah"),
      actorUserId: PARTICIPANT_ID,
      actorType: "participant",
      actorDisplayName: "Sarah",
    });
    const hostWebMcpHarness = successfulCommitClient({
      member: memberRow("host", "Danny"),
      actorUserId: HOST_ID,
      actorType: "human",
      actorDisplayName: "Danny",
      source: "webmcp",
    });

    const participant = await createRoomService(
      participantHarness.client,
      dependencies,
    ).commitCommand(PARTICIPANT_ID, createNoteRequest("pointer"));
    const hostWebMcp = await createRoomService(
      hostWebMcpHarness.client,
      dependencies,
    ).commitCommand(HOST_ID, createNoteRequest("webmcp"));

    expect(participant.ok).toBe(true);
    expect(hostWebMcp.ok).toBe(true);
    expect(participantHarness.rawClient.rpc).toHaveBeenCalledWith(
      "commit_canvas_mutation_at_revision",
      expect.objectContaining({
        p_expected_room_revision: 0,
        p_actor_user_id: PARTICIPANT_ID,
        p_actor_type: "participant",
        p_source: "collaborator",
        p_description: "Sarah created “Launch decision”.",
      }),
    );
    expect(hostWebMcpHarness.rawClient.rpc).toHaveBeenCalledWith(
      "commit_canvas_mutation_at_revision",
      expect.objectContaining({
        p_expected_room_revision: 0,
        p_actor_user_id: HOST_ID,
        p_actor_type: "human",
        p_source: "webmcp",
        p_description: "Danny created “Launch decision”.",
      }),
    );
    if (!participant.ok || !hostWebMcp.ok)
      throw new Error("Expected both commits.");
    expect(participant.value.state.receipts.at(-1)?.source).toBe("collaborator");
    expect(hostWebMcp.value.state.receipts.at(-1)).toEqual(
      expect.objectContaining({
        source: "webmcp",
        actor: { id: HOST_ID, displayName: "Danny", type: "human" },
      }),
    );
  });

  it("maps database conflicts to a compact typed error without raw details", async () => {
    const harness = createClient({
      tableResults: {
        room_members: [{ data: memberRow("host"), error: null }],
        rooms: [
          { data: emptyRoomRow, error: null },
          { data: emptyRoomRow, error: null },
        ],
        canvas_objects: [{ data: [], error: null }],
        receipts: [{ data: [], error: null }],
      },
      rpcResults: [
        {
          data: null,
          error: {
            code: "P0001",
            message: "canvas_object_version_conflict:private-row-detail",
          },
        },
      ],
    });

    const result = await createRoomService(
      harness.client,
      dependencies,
    ).commitCommand(HOST_ID, createNoteRequest());

    expect(result).toEqual({
      ok: false,
      error: {
        code: "command_conflict",
        message: "Canvas changed before the command could be committed.",
      },
    });
    expect(JSON.stringify(result)).not.toContain("private-row-detail");
  });

  it("maps the exact demo storage-cap refusal to one compact recoverable error", async () => {
    const harness = createClient({
      tableResults: {
        room_members: [{ data: memberRow("host"), error: null }],
        rooms: [
          { data: emptyRoomRow, error: null },
          { data: emptyRoomRow, error: null },
        ],
        canvas_objects: [{ data: [], error: null }],
        receipts: [{ data: [], error: null }],
      },
      rpcResults: [
        {
          data: null,
          error: {
            code: "P0001",
            message: "demo_room_storage_limit_reached",
            details: "canvas_objects row private-object-17",
          },
        },
      ],
    });

    const result = await createRoomService(
      harness.client,
      dependencies,
    ).commitCommand(HOST_ID, createNoteRequest());

    expect(result).toEqual({
      ok: false,
      error: {
        code: "demo_room_storage_limit_reached",
        message: "This demo room reached its storage limit. Reset the demo to continue.",
      },
    });
    expect(JSON.stringify(result)).not.toContain("canvas_objects");
    expect(JSON.stringify(result)).not.toContain("private-object-17");
  });

  it("does not treat a similar provider message as the allowlisted storage refusal", async () => {
    const harness = createClient({
      tableResults: {
        room_members: [{ data: memberRow("host"), error: null }],
        rooms: [
          { data: emptyRoomRow, error: null },
          { data: emptyRoomRow, error: null },
        ],
        canvas_objects: [{ data: [], error: null }],
        receipts: [{ data: [], error: null }],
      },
      rpcResults: [
        {
          data: null,
          error: {
            code: "P0001",
            message: "demo_room_storage_limit_reached:private-row-detail",
          },
        },
      ],
    });

    const result = await createRoomService(
      harness.client,
      dependencies,
    ).commitCommand(HOST_ID, createNoteRequest());

    expect(result).toEqual({
      ok: false,
      error: {
        code: "mutation_unavailable",
        message: "Canvas mutation is unavailable.",
      },
    });
    expect(JSON.stringify(result)).not.toContain("private-row-detail");
  });
});
