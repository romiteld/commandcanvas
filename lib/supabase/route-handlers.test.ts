// @vitest-environment node

import { afterEach, describe, expect, it, vi } from "vitest";

import type { CommandRequest } from "@/lib/supabase/room-contracts";
import {
  handleCommandRequest,
  handleCreateRoomRequest,
  handleDeleteDemoRoomRequest,
  handleJoinRoomRequest,
  type RoomRouteDependencies,
} from "@/lib/supabase/route-handlers";
import type {
  CommandCanvasRoomService,
  CommitCommandValue,
  CreateRoomValue,
  DeleteDemoRoomValue,
  JoinRoomValue,
  RoomServiceResult,
} from "@/lib/supabase/room-service";

const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJob3N0In0.signature";
const ACTOR_ID = "22222222-2222-4222-8222-222222222222";
const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const COMMAND_ID = "55555555-5555-4555-8555-555555555555";
const JOIN_TOKEN =
  "q6urq6urq6urq6urq6urq6urq6urq6urq6urq6urq6s";

const createInput = {
  mode: "demo" as const,
  name: "Launch room",
  displayName: "Danny",
  color: "#0ea5e9",
};

const joinInput = {
  slug: "room-2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a",
  joinToken: JOIN_TOKEN,
  displayName: "Sarah",
  color: "#a855f7",
};

const commandInput: CommandRequest = {
  commandId: COMMAND_ID,
  roomId: ROOM_ID,
  baseRevision: 0,
  source: "typed",
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

const createdRoom: CreateRoomValue = {
  roomId: ROOM_ID,
  slug: joinInput.slug,
  joinToken: JOIN_TOKEN,
  role: "host",
  joined: true,
};

const joinedRoom: JoinRoomValue = {
  roomId: ROOM_ID,
  role: "participant",
  joined: true,
};

const committedCommand: CommitCommandValue = {
  roomId: ROOM_ID,
  revision: 1,
  receiptId: COMMAND_ID,
  state: {
    roomId: ROOM_ID,
    revision: 1,
    objects: {},
    receipts: [],
    undoneReceiptIds: [],
  },
};

function jsonRequest(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return new Request(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${JWT}`,
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function ok<T>(value: T): RoomServiceResult<T> {
  return { ok: true, value };
}

function createDependencies(input?: {
  createResult?: RoomServiceResult<CreateRoomValue>;
  joinResult?: RoomServiceResult<JoinRoomValue>;
  commandResult?: RoomServiceResult<CommitCommandValue>;
  deleteResult?: RoomServiceResult<DeleteDemoRoomValue>;
  getUserError?: unknown;
  getUserId?: string | null;
  serviceThrows?: Error;
}) {
  const getUser = vi.fn(async () => ({
    data: {
      user:
        input?.getUserId === null
          ? null
          : { id: input?.getUserId ?? ACTOR_ID },
    },
    error: input?.getUserError ?? null,
  }));
  const invoke = <T>(result: RoomServiceResult<T>) =>
    input?.serviceThrows
      ? vi.fn(async () => {
          throw input.serviceThrows;
        })
      : vi.fn(async () => result);
  const service: CommandCanvasRoomService = {
    createRoom: invoke(input?.createResult ?? ok(createdRoom)),
    joinRoom: invoke(input?.joinResult ?? ok(joinedRoom)),
    deleteDemoRoom: invoke(
      input?.deleteResult ?? ok({ roomId: ROOM_ID, deleted: true }),
    ),
    loadCanvas: vi.fn(),
    commitCommand: invoke(input?.commandResult ?? ok(committedCommand)),
  };
  return {
    dependencies: {
      verifier: { auth: { getUser } },
      service,
    } satisfies RoomRouteDependencies,
    getUser,
    service,
  };
}

async function expectJson(response: Response) {
  expect(response.headers.get("content-type")).toBe(
    "application/json; charset=utf-8",
  );
  expect(response.headers.get("cache-control")).toBe("no-store");
  return response.json();
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("room route authentication and request boundaries", () => {
  it("rejects a malformed JWT before reading or invoking a service action", async () => {
    const { dependencies, getUser, service } = createDependencies();
    const request = jsonRequest("https://commandcanvas.test/api/rooms", createInput, {
      authorization: "Bearer malformed",
      "content-type": "text/plain",
    });

    const response = await handleCreateRoomRequest(request, dependencies);

    expect(response.status).toBe(401);
    expect(await expectJson(response)).toEqual({
      ok: false,
      error: {
        code: "authorization_malformed",
        message: "Authorization must use Bearer followed by one JWT.",
      },
    });
    expect(getUser).not.toHaveBeenCalled();
    expect(service.createRoom).not.toHaveBeenCalled();
  });

  it("rejects a non-JSON room request after authentication", async () => {
    const { dependencies, service } = createDependencies();
    const request = jsonRequest("https://commandcanvas.test/api/rooms", createInput, {
      "content-type": "text/plain",
    });

    const response = await handleCreateRoomRequest(request, dependencies);

    expect(response.status).toBe(415);
    expect(await expectJson(response)).toEqual({
      ok: false,
      error: {
        code: "unsupported_media_type",
        message: "Content-Type must be application/json.",
      },
    });
    expect(service.createRoom).not.toHaveBeenCalled();
  });

  it("rejects a room body larger than 64 KiB without invoking the service", async () => {
    const { dependencies, service } = createDependencies();
    const request = jsonRequest("https://commandcanvas.test/api/rooms", {
      ...createInput,
      padding: "x".repeat(65_536),
    });

    const response = await handleCreateRoomRequest(request, dependencies);

    expect(response.status).toBe(413);
    expect(await expectJson(response)).toEqual({
      ok: false,
      error: {
        code: "request_too_large",
        message: "Request body is too large.",
      },
    });
    expect(service.createRoom).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON and strict-schema extras with the same compact error", async () => {
    const malformedDependencies = createDependencies();
    const malformed = new Request("https://commandcanvas.test/api/rooms", {
      method: "POST",
      headers: {
        authorization: `Bearer ${JWT}`,
        "content-type": "application/json",
      },
      body: "{not-json",
    });
    const extraDependencies = createDependencies();

    const malformedResponse = await handleCreateRoomRequest(
      malformed,
      malformedDependencies.dependencies,
    );
    const extraResponse = await handleCreateRoomRequest(
      jsonRequest("https://commandcanvas.test/api/rooms", {
        ...createInput,
        actorUserId: "spoofed",
      }),
      extraDependencies.dependencies,
    );

    for (const response of [malformedResponse, extraResponse]) {
      expect(response.status).toBe(400);
      expect(await expectJson(response)).toEqual({
        ok: false,
        error: {
          code: "invalid_request",
          message: "Request body is invalid.",
        },
      });
    }
    expect(malformedDependencies.service.createRoom).not.toHaveBeenCalled();
    expect(extraDependencies.service.createRoom).not.toHaveBeenCalled();
  });
});

describe("create room route", () => {
  it("uses only the authenticated actor and returns a one-time join token on success", async () => {
    const { dependencies, service } = createDependencies();

    const response = await handleCreateRoomRequest(
      jsonRequest("https://commandcanvas.test/api/rooms", createInput),
      dependencies,
    );

    expect(response.status).toBe(201);
    expect(await expectJson(response)).toEqual({ ok: true, room: createdRoom });
    expect(service.createRoom).toHaveBeenCalledExactlyOnceWith(
      ACTOR_ID,
      createInput,
    );
  });

  it("does not expose a join token or provider details when creation is unavailable", async () => {
    const { dependencies } = createDependencies({
      createResult: {
        ok: false,
        error: {
          code: "create_unavailable",
          message: `database secret leaked with ${JOIN_TOKEN}`,
        },
      },
    });

    const response = await handleCreateRoomRequest(
      jsonRequest("https://commandcanvas.test/api/rooms", createInput),
      dependencies,
    );
    const body = await expectJson(response);

    expect(response.status).toBe(503);
    expect(body).toEqual({
      ok: false,
      error: {
        code: "create_unavailable",
        message: "Room could not be created.",
      },
    });
    expect(JSON.stringify(body)).not.toContain(JOIN_TOKEN);
    expect(JSON.stringify(body)).not.toContain("database");
  });

  it("returns an explicit conflict when the authenticated actor reaches the demo-room cap", async () => {
    const { dependencies } = createDependencies({
      createResult: {
        ok: false,
        error: {
          code: "demo_room_limit_reached",
          message: "Reset one of your demo rooms before creating another.",
        },
      },
    });

    const response = await handleCreateRoomRequest(
      jsonRequest("https://commandcanvas.test/api/rooms", createInput),
      dependencies,
    );

    expect(response.status).toBe(409);
    expect(await expectJson(response)).toEqual({
      ok: false,
      error: {
        code: "demo_room_limit_reached",
        message: "Reset one of your demo rooms before creating another.",
      },
    });
  });
});

describe("delete demo room route", () => {
  it("deletes only the exact path room for the authenticated actor", async () => {
    const { dependencies, service } = createDependencies();
    const request = new Request(
      `https://commandcanvas.test/api/rooms/${ROOM_ID}`,
      {
        method: "DELETE",
        headers: { authorization: `Bearer ${JWT}` },
      },
    );

    const response = await handleDeleteDemoRoomRequest(
      request,
      ROOM_ID,
      dependencies,
    );

    expect(response.status).toBe(200);
    expect(await expectJson(response)).toEqual({
      ok: true,
      room: { roomId: ROOM_ID, deleted: true },
    });
    expect(service.deleteDemoRoom).toHaveBeenCalledExactlyOnceWith(
      ACTOR_ID,
      ROOM_ID,
    );
  });

  it("returns one non-enumerating refusal when the actor is not the demo host", async () => {
    const { dependencies } = createDependencies({
      deleteResult: {
        ok: false,
        error: {
          code: "host_required",
          message: "Only the demo room host can delete this room.",
        },
      },
    });
    const request = new Request(
      `https://commandcanvas.test/api/rooms/${ROOM_ID}`,
      {
        method: "DELETE",
        headers: { authorization: `Bearer ${JWT}` },
      },
    );

    const response = await handleDeleteDemoRoomRequest(
      request,
      ROOM_ID,
      dependencies,
    );

    expect(response.status).toBe(403);
    expect(await expectJson(response)).toEqual({
      ok: false,
      error: {
        code: "host_required",
        message: "Only the demo room host can delete this room.",
      },
    });
  });

  it("rejects a malformed path identifier before calling the service", async () => {
    const { dependencies, service } = createDependencies();
    const request = new Request(
      "https://commandcanvas.test/api/rooms/not-a-room",
      {
        method: "DELETE",
        headers: { authorization: `Bearer ${JWT}` },
      },
    );

    const response = await handleDeleteDemoRoomRequest(
      request,
      "not-a-room",
      dependencies,
    );

    expect(response.status).toBe(400);
    expect(await expectJson(response)).toEqual({
      ok: false,
      error: {
        code: "invalid_room_id",
        message: "Room ID is invalid.",
      },
    });
    expect(service.deleteDemoRoom).not.toHaveBeenCalled();
  });
});

describe("join room route", () => {
  it("returns the joined room without reflecting the join token", async () => {
    const { dependencies, service } = createDependencies();

    const response = await handleJoinRoomRequest(
      jsonRequest("https://commandcanvas.test/api/rooms/join", joinInput),
      dependencies,
    );
    const body = await expectJson(response);

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, room: joinedRoom });
    expect(JSON.stringify(body)).not.toContain(JOIN_TOKEN);
    expect(service.joinRoom).toHaveBeenCalledExactlyOnceWith(ACTOR_ID, joinInput);
  });

  it.each(["missing room", "invalid token", "database provider failure"])(
    "collapses %s into one non-enumerating response",
    async (providerMessage) => {
      const { dependencies } = createDependencies({
        joinResult: {
          ok: false,
          error: { code: "join_unavailable", message: providerMessage },
        },
      });

      const response = await handleJoinRoomRequest(
        jsonRequest("https://commandcanvas.test/api/rooms/join", joinInput),
        dependencies,
      );

      expect(response.status).toBe(404);
      expect(await expectJson(response)).toEqual({
        ok: false,
        error: {
          code: "join_unavailable",
          message: "Room is unavailable or the join link is invalid.",
        },
      });
    },
  );
});

describe("canvas command route", () => {
  it("rejects a path/body room mismatch before invoking the mutation service", async () => {
    const { dependencies, service } = createDependencies();

    const response = await handleCommandRequest(
      jsonRequest(
        `https://commandcanvas.test/api/rooms/${ROOM_ID}/commands`,
        commandInput,
      ),
      "99999999-9999-4999-8999-999999999999",
      dependencies,
    );

    expect(response.status).toBe(400);
    expect(await expectJson(response)).toEqual({
      ok: false,
      error: {
        code: "room_mismatch",
        message: "Room ID does not match the request path.",
      },
    });
    expect(service.commitCommand).not.toHaveBeenCalled();
  });

  it("uses the authenticated actor and returns the authoritative reloaded state", async () => {
    const { dependencies, service } = createDependencies();

    const response = await handleCommandRequest(
      jsonRequest(
        `https://commandcanvas.test/api/rooms/${ROOM_ID}/commands`,
        commandInput,
      ),
      ROOM_ID,
      dependencies,
    );

    expect(response.status).toBe(200);
    expect(await expectJson(response)).toEqual({
      ok: true,
      mutation: committedCommand,
    });
    expect(service.commitCommand).toHaveBeenCalledExactlyOnceWith(
      ACTOR_ID,
      commandInput,
    );
  });

  it("allows a command up to 2 MiB but rejects a larger command body", async () => {
    const { dependencies, service } = createDependencies();
    const request = jsonRequest(
      `https://commandcanvas.test/api/rooms/${ROOM_ID}/commands`,
      {
        ...commandInput,
        padding: "x".repeat(2 * 1_024 * 1_024),
      },
    );

    const response = await handleCommandRequest(
      request,
      ROOM_ID,
      dependencies,
    );

    expect(response.status).toBe(413);
    expect(await expectJson(response)).toMatchObject({
      ok: false,
      error: { code: "request_too_large" },
    });
    expect(service.commitCommand).not.toHaveBeenCalled();
  });

  it.each([
    ["member_required", 403],
    ["host_required", 403],
    ["permission_denied", 403],
    ["room_unavailable", 404],
    ["stale_revision", 409],
    ["object_pinned", 409],
    ["command_conflict", 409],
    ["demo_room_storage_limit_reached", 409],
    ["nothing_to_undo", 409],
    ["invalid_command", 400],
    ["invalid_persisted_state", 503],
    ["mutation_unavailable", 503],
  ] as const)("maps %s to HTTP %i", async (code, expectedStatus) => {
    const { dependencies } = createDependencies({
      commandResult: {
        ok: false,
        error: { code, message: "provider-specific internal detail" },
      },
    });

    const response = await handleCommandRequest(
      jsonRequest(
        `https://commandcanvas.test/api/rooms/${ROOM_ID}/commands`,
        commandInput,
      ),
      ROOM_ID,
      dependencies,
    );
    const body = await expectJson(response);

    expect(response.status).toBe(expectedStatus);
    expect(body).toMatchObject({ ok: false, error: { code } });
    expect(JSON.stringify(body)).not.toContain("provider-specific");
  });

  it("returns an honest reset path for a demo storage-cap refusal", async () => {
    const { dependencies } = createDependencies({
      commandResult: {
        ok: false,
        error: {
          code: "demo_room_storage_limit_reached",
          message: "provider-specific internal storage detail",
        },
      },
    });

    const response = await handleCommandRequest(
      jsonRequest(
        `https://commandcanvas.test/api/rooms/${ROOM_ID}/commands`,
        commandInput,
      ),
      ROOM_ID,
      dependencies,
    );

    expect(response.status).toBe(409);
    expect(await expectJson(response)).toEqual({
      ok: false,
      error: {
        code: "demo_room_storage_limit_reached",
        message: "This demo room reached its storage limit. Reset the demo to continue.",
      },
    });
  });

  it("suppresses a thrown service error and returns one honest 503", async () => {
    const { dependencies } = createDependencies({
      serviceThrows: new Error(
        `Supabase connection leaked secret and token ${JOIN_TOKEN}`,
      ),
    });

    const response = await handleCommandRequest(
      jsonRequest(
        `https://commandcanvas.test/api/rooms/${ROOM_ID}/commands`,
        commandInput,
      ),
      ROOM_ID,
      dependencies,
    );
    const body = await expectJson(response);

    expect(response.status).toBe(503);
    expect(body).toEqual({
      ok: false,
      error: {
        code: "service_unavailable",
        message: "CommandCanvas service is unavailable.",
      },
    });
    expect(JSON.stringify(body)).not.toContain("Supabase");
    expect(JSON.stringify(body)).not.toContain(JOIN_TOKEN);
  });
});

describe("thin Next room routes", () => {
  it("returns an honest no-store 503 from every route when server configuration is missing", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://configured.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "publishable-value");
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    const [{ POST: create }, { POST: join }, { POST: command }] =
      await Promise.all([
        import("@/app/api/rooms/route"),
        import("@/app/api/rooms/join/route"),
        import("@/app/api/rooms/[roomId]/commands/route"),
      ]);
    const requests = [
      create(jsonRequest("https://commandcanvas.test/api/rooms", createInput)),
      join(
        jsonRequest("https://commandcanvas.test/api/rooms/join", joinInput),
      ),
      command(
        jsonRequest(
          `https://commandcanvas.test/api/rooms/${ROOM_ID}/commands`,
          commandInput,
        ),
        { params: Promise.resolve({ roomId: ROOM_ID }) },
      ),
    ];

    for (const pendingResponse of requests) {
      const response = await pendingResponse;
      const body = await expectJson(response);
      expect(response.status).toBe(503);
      expect(body).toEqual({
        ok: false,
        error: {
          code: "service_unavailable",
          message: "CommandCanvas service is unavailable.",
        },
      });
      expect(JSON.stringify(body)).not.toContain("publishable-value");
      expect(JSON.stringify(body)).not.toContain("configured.supabase.co");
      expect(JSON.stringify(body)).not.toContain("SUPABASE_SECRET_KEY");
    }
  });
});
