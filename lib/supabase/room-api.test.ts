// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import type { CanvasState } from "@/lib/canvas/command-engine";
import {
  createBrowserRoomApi,
  type RoomApiFetch,
} from "@/lib/supabase/room-api";
import type { CommandRequest } from "@/lib/supabase/room-contracts";

const JWT = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJob3N0In0.signature";
const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const ACTOR_ID = "22222222-2222-4222-8222-222222222222";
const COMMAND_ID = "55555555-5555-4555-8555-555555555555";
const RECEIPT_ID = "66666666-6666-4666-8666-666666666666";
const JOIN_TOKEN =
  "q6urq6urq6urq6urq6urq6urq6urq6urq6urq6urq6s";
const ROOM_SLUG = "room-2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a";
const OCCURRED_AT = "2026-08-27T10:00:00.000Z";

const noteObject = {
  id: "note-launch",
  roomId: ROOM_ID,
  type: "note" as const,
  title: "Launch decision",
  x: 120,
  y: 80,
  width: 280,
  height: 190,
  zIndex: 1,
  minimized: false,
  pinned: false,
  createdBy: ACTOR_ID,
  createdAt: OCCURRED_AT,
  updatedAt: OCCURRED_AT,
  deletedAt: null,
  version: 1,
  metadata: {},
  payload: {
    text: "Prove the shared spatial workflow.",
    tone: "sky" as const,
  },
};

const authoritativeState: CanvasState = {
  roomId: ROOM_ID,
  revision: 1,
  objects: { [noteObject.id]: noteObject },
  receipts: [
    {
      id: RECEIPT_ID,
      roomId: ROOM_ID,
      commandId: COMMAND_ID,
      revision: 1,
      occurredAt: OCCURRED_AT,
      actor: {
        id: ACTOR_ID,
        displayName: "Danny",
        type: "human",
      },
      source: "typed",
      action: "create",
      affectedObjectIds: [noteObject.id],
      before: { objects: { [noteObject.id]: null } },
      after: { objects: { [noteObject.id]: noteObject } },
      description: "Danny created “Launch decision”.",
    },
  ],
  undoneReceiptIds: [],
  redoReceiptIds: [],
};

const commandInput: CommandRequest = {
  commandId: COMMAND_ID,
  roomId: ROOM_ID,
  baseRevision: 0,
  source: "typed",
  command: {
    type: "object.create",
    object: {
      id: noteObject.id,
      type: noteObject.type,
      title: noteObject.title,
      x: noteObject.x,
      y: noteObject.y,
      width: noteObject.width,
      height: noteObject.height,
      zIndex: noteObject.zIndex,
      payload: noteObject.payload,
    },
  },
};

describe("browser room API", () => {
  it("creates a room through the authenticated no-store JSON boundary", async () => {
    const fetcher = vi.fn<RoomApiFetch>(async () =>
      Response.json(
        {
          ok: true,
          room: {
            roomId: ROOM_ID,
            slug: ROOM_SLUG,
            joinToken: JOIN_TOKEN,
            role: "host",
            joined: true,
          },
        },
        { status: 201 },
      ),
    );
    const api = createBrowserRoomApi({ accessToken: JWT, fetcher });
    const input = {
      mode: "demo" as const,
      name: "Launch room",
      displayName: "Danny",
      color: "#0ea5e9",
    };

    const result = await api.createRoom(input);

    expect(result).toEqual({
      ok: true,
      value: {
        roomId: ROOM_ID,
        slug: ROOM_SLUG,
        joinToken: JOIN_TOKEN,
        role: "host",
        joined: true,
      },
    });
    expect(fetcher).toHaveBeenCalledExactlyOnceWith("/api/rooms", {
      method: "POST",
      headers: {
        authorization: `Bearer ${JWT}`,
        "content-type": "application/json",
      },
      cache: "no-store",
      body: JSON.stringify(input),
      signal: undefined,
    });
  });

  it("preserves the explicit demo-room cap response", async () => {
    const fetcher = vi.fn<RoomApiFetch>(async () =>
      Response.json(
        {
          ok: false,
          error: {
            code: "demo_room_limit_reached",
            message: "Reset one of your demo rooms before creating another.",
          },
        },
        { status: 409 },
      ),
    );
    const api = createBrowserRoomApi({ accessToken: JWT, fetcher });

    const result = await api.createRoom({
      mode: "demo",
      name: "Fourth demo room",
      displayName: "Danny",
      color: "#0ea5e9",
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "demo_room_limit_reached",
        message: "Reset one of your demo rooms before creating another.",
        status: 409,
      },
    });
  });

  it("deletes the exact hosted demo room without a request body", async () => {
    const fetcher = vi.fn<RoomApiFetch>(async () =>
      Response.json(
        { ok: true, room: { roomId: ROOM_ID, deleted: true } },
        { status: 200 },
      ),
    );
    const api = createBrowserRoomApi({ accessToken: JWT, fetcher });

    const result = await api.deleteDemoRoom(ROOM_ID);

    expect(result).toEqual({
      ok: true,
      value: { roomId: ROOM_ID, deleted: true },
    });
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(`/api/rooms/${ROOM_ID}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${JWT}` },
      cache: "no-store",
      signal: undefined,
    });
  });

  it("returns the host-only delete refusal without reflecting credentials", async () => {
    const fetcher = vi.fn<RoomApiFetch>(async () =>
      Response.json(
        {
          ok: false,
          error: {
            code: "host_required",
            message: "Only the demo room host can delete this room.",
          },
        },
        { status: 403 },
      ),
    );
    const api = createBrowserRoomApi({ accessToken: JWT, fetcher });

    const result = await api.deleteDemoRoom(ROOM_ID);

    expect(result).toEqual({
      ok: false,
      error: {
        code: "host_required",
        message: "Only the demo room host can delete this room.",
        status: 403,
      },
    });
    expect(JSON.stringify(result)).not.toContain(JWT);
  });

  it("joins a room without reflecting the capability token in its result", async () => {
    const fetcher = vi.fn<RoomApiFetch>(async () =>
      Response.json(
        {
          ok: true,
          room: {
            roomId: ROOM_ID,
            role: "participant",
            joined: true,
          },
        },
        { status: 200 },
      ),
    );
    const api = createBrowserRoomApi({ accessToken: JWT, fetcher });
    const input = {
      slug: ROOM_SLUG,
      joinToken: JOIN_TOKEN,
      displayName: "Sarah",
      color: "#a855f7",
    };

    const result = await api.joinRoom(input);

    expect(result).toEqual({
      ok: true,
      value: {
        roomId: ROOM_ID,
        role: "participant",
        joined: true,
      },
    });
    expect(JSON.stringify(result)).not.toContain(JOIN_TOKEN);
    expect(fetcher).toHaveBeenCalledExactlyOnceWith("/api/rooms/join", {
      method: "POST",
      headers: {
        authorization: `Bearer ${JWT}`,
        "content-type": "application/json",
      },
      cache: "no-store",
      body: JSON.stringify(input),
      signal: undefined,
    });
  });

  it("returns the authoritative validated canvas state from a command", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn<RoomApiFetch>(async () =>
      Response.json(
        {
          ok: true,
          mutation: {
            roomId: ROOM_ID,
            revision: 1,
            receiptId: RECEIPT_ID,
            state: authoritativeState,
          },
        },
        { status: 200 },
      ),
    );
    const api = createBrowserRoomApi({ accessToken: JWT, fetcher });

    const result = await api.commitCommand(commandInput, {
      signal: controller.signal,
    });

    expect(result).toEqual({
      ok: true,
      value: {
        roomId: ROOM_ID,
        revision: 1,
        receiptId: RECEIPT_ID,
        state: authoritativeState,
      },
    });
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(
      `/api/rooms/${ROOM_ID}/commands`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${JWT}`,
          "content-type": "application/json",
        },
        cache: "no-store",
        body: expect.any(String),
        signal: controller.signal,
      },
    );
    const requestBody = fetcher.mock.calls[0]?.[1]?.body;
    expect(typeof requestBody).toBe("string");
    expect(JSON.parse(requestBody as string)).toEqual(commandInput);
  });

  it.each([
    {
      id: "table-launch-metrics",
      type: "data_table",
      title: "Launch metrics",
      payload: {
        columns: [{ id: "column-metric", label: "Metric", kind: "text" }],
        rows: [{ id: "row-signups", cells: ["Signups"] }],
      },
    },
    {
      id: "reference-launch-brief",
      type: "reference_card",
      title: "Launch brief",
      payload: {
        kind: "article",
        sourceUrl: "https://example.com/launch-brief",
        summary: "A bounded source card created through the agent.",
        excerpt: null,
      },
    },
    {
      id: "decision-launch-date",
      type: "meeting_card",
      title: "Launch date",
      payload: {
        kind: "decision",
        body: "Ship the public demo on September 3.",
        bullets: [],
        owner: "Danny",
        dueDate: "2026-09-03",
        status: "confirmed",
      },
    },
  ])("accepts an authoritative $type object", async (semantic) => {
    const object = {
      ...noteObject,
      ...semantic,
    };
    const state = {
      ...authoritativeState,
      objects: { [object.id]: object },
      receipts: [
        {
          ...authoritativeState.receipts[0],
          affectedObjectIds: [object.id],
          before: { objects: { [object.id]: null } },
          after: { objects: { [object.id]: object } },
        },
      ],
    };
    const fetcher = vi.fn<RoomApiFetch>(async () =>
      Response.json({
        ok: true,
        mutation: {
          roomId: ROOM_ID,
          revision: 1,
          receiptId: RECEIPT_ID,
          state,
        },
      }),
    );

    const result = await createBrowserRoomApi({
      accessToken: JWT,
      fetcher,
    }).commitCommand(commandInput);

    expect(result).toMatchObject({
      ok: true,
      value: {
        state: {
          objects: {
            [object.id]: {
              id: object.id,
              type: object.type,
              payload: object.payload,
            },
          },
        },
      },
    });
  });

  it("rejects an authoritative canvas whose object references a missing frame", async () => {
    const fetcher = vi.fn<RoomApiFetch>(async () =>
      Response.json({
        ok: true,
        mutation: {
          roomId: ROOM_ID,
          revision: 1,
          receiptId: RECEIPT_ID,
          state: {
            ...authoritativeState,
            objects: {
              [noteObject.id]: { ...noteObject, parentId: "frame-missing" },
            },
          },
        },
      }),
    );

    const result = await createBrowserRoomApi({
      accessToken: JWT,
      fetcher,
    }).commitCommand(commandInput);

    expect(result).toEqual({
      ok: false,
      error: {
        code: "invalid_response",
        message: "Canvas command could not be committed.",
        status: 200,
      },
    });
  });

  it("preserves the allowlisted demo storage-cap refusal from a command", async () => {
    const fetcher = vi.fn(async () =>
      Response.json(
        {
          ok: false,
          error: {
            code: "demo_room_storage_limit_reached",
            message:
              "This demo room reached its storage limit. Reset the demo to continue.",
          },
        },
        { status: 409 },
      ),
    );
    const api = createBrowserRoomApi({ accessToken: JWT, fetcher });

    const result = await api.commitCommand(commandInput);

    expect(result).toEqual({
      ok: false,
      error: {
        code: "demo_room_storage_limit_reached",
        message:
          "This demo room reached its storage limit. Reset the demo to continue.",
        status: 409,
      },
    });
  });

  it("preserves an allowlisted authoritative command code on a refusal", async () => {
    const fetcher = vi.fn(async () =>
      Response.json(
        {
          ok: false,
          error: {
            code: "invalid_command",
            commandCode: "NOTE_TEXT_LIMIT",
            message:
              "That thought card reached its 4,000-character limit. Finish it and start another thought.",
          },
        },
        { status: 400 },
      ),
    );

    const result = await createBrowserRoomApi({
      accessToken: JWT,
      fetcher,
    }).commitCommand(commandInput);

    expect(result).toEqual({
      ok: false,
      error: {
        code: "invalid_command",
        commandCode: "NOTE_TEXT_LIMIT",
        message:
          "That thought card reached its 4,000-character limit. Finish it and start another thought.",
        status: 400,
      },
    });
  });

  it("preserves a compact server error without leaking transport internals", async () => {
    const fetcher = vi.fn(async () =>
      Response.json(
        {
          ok: false,
          error: {
            code: "join_unavailable",
            message: "Room is unavailable or the join link is invalid.",
          },
        },
        { status: 404 },
      ),
    );
    const api = createBrowserRoomApi({ accessToken: JWT, fetcher });

    const result = await api.joinRoom({
      slug: ROOM_SLUG,
      joinToken: JOIN_TOKEN,
      displayName: "Sarah",
      color: "#a855f7",
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "join_unavailable",
        message: "Room is unavailable or the join link is invalid.",
        status: 404,
      },
    });
    expect(JSON.stringify(result)).not.toContain(JOIN_TOKEN);
  });

  it("never reflects the submitted join capability from a server error", async () => {
    const fetcher = vi.fn(async () =>
      Response.json(
        {
          ok: false,
          error: {
            code: "join_unavailable",
            message: `Provider rejected capability ${JOIN_TOKEN}`,
          },
        },
        { status: 404 },
      ),
    );
    const api = createBrowserRoomApi({ accessToken: JWT, fetcher });

    const result = await api.joinRoom({
      slug: ROOM_SLUG,
      joinToken: JOIN_TOKEN,
      displayName: "Sarah",
      color: "#a855f7",
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "invalid_response",
        message: "Room could not be joined.",
        status: 404,
      },
    });
    expect(JSON.stringify(result)).not.toContain(JOIN_TOKEN);
    expect(JSON.stringify(result)).not.toContain("Provider");
  });

  it("honors an already-cancelled request without starting a network call", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetcher = vi.fn();
    const api = createBrowserRoomApi({ accessToken: JWT, fetcher });

    const result = await api.createRoom(
      {
        mode: "demo",
        name: "Launch room",
        displayName: "Danny",
        color: "#0ea5e9",
      },
      { signal: controller.signal },
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: "request_cancelled",
        message: "Request was cancelled.",
      },
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("refuses a malformed session token before constructing an Authorization header", async () => {
    const fetcher = vi.fn();
    const api = createBrowserRoomApi({
      accessToken: `${JWT}\r\nx-injected: yes`,
      fetcher,
    });

    const result = await api.createRoom({
      mode: "demo",
      name: "Launch room",
      displayName: "Danny",
      color: "#0ea5e9",
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "authorization_invalid",
        message: "A valid session is required.",
      },
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("rejects a success body delivered outside the JSON response contract", async () => {
    const fetcher = vi.fn(async () =>
      new Response(
        JSON.stringify({
          ok: true,
          room: {
            roomId: ROOM_ID,
            slug: ROOM_SLUG,
            joinToken: JOIN_TOKEN,
            role: "host",
            joined: true,
          },
        }),
        {
          status: 201,
          headers: { "content-type": "text/plain" },
        },
      ),
    );
    const api = createBrowserRoomApi({ accessToken: JWT, fetcher });

    const result = await api.createRoom({
      mode: "demo",
      name: "Launch room",
      displayName: "Danny",
      color: "#0ea5e9",
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "invalid_response",
        message: "Room could not be created.",
        status: 201,
      },
    });
    expect(JSON.stringify(result)).not.toContain(JOIN_TOKEN);
  });

  it("strictly rejects a join response that reflects the submitted capability", async () => {
    const fetcher = vi.fn(async () =>
      Response.json(
        {
          ok: true,
          room: {
            roomId: ROOM_ID,
            role: "participant",
            joined: true,
            joinToken: JOIN_TOKEN,
          },
        },
        { status: 200 },
      ),
    );
    const api = createBrowserRoomApi({ accessToken: JWT, fetcher });

    const result = await api.joinRoom({
      slug: ROOM_SLUG,
      joinToken: JOIN_TOKEN,
      displayName: "Sarah",
      color: "#a855f7",
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "invalid_response",
        message: "Room could not be joined.",
        status: 200,
      },
    });
    expect(JSON.stringify(result)).not.toContain(JOIN_TOKEN);
  });

  it("rejects command metadata that disagrees with the authoritative state", async () => {
    const fetcher = vi.fn(async () =>
      Response.json(
        {
          ok: true,
          mutation: {
            roomId: ROOM_ID,
            revision: 2,
            receiptId: RECEIPT_ID,
            state: authoritativeState,
          },
        },
        { status: 200 },
      ),
    );
    const api = createBrowserRoomApi({ accessToken: JWT, fetcher });

    const result = await api.commitCommand(commandInput);

    expect(result).toEqual({
      ok: false,
      error: {
        code: "invalid_response",
        message: "Canvas command could not be committed.",
        status: 200,
      },
    });
  });

  it("returns an invalid-response error for malformed JSON rather than a network claim", async () => {
    const fetcher = vi.fn(async () =>
      new Response("{not-json", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const api = createBrowserRoomApi({ accessToken: JWT, fetcher });

    const result = await api.joinRoom({
      slug: ROOM_SLUG,
      joinToken: JOIN_TOKEN,
      displayName: "Sarah",
      color: "#a855f7",
    });

    expect(result).toEqual({
      ok: false,
      error: {
        code: "invalid_response",
        message: "Room could not be joined.",
        status: 200,
      },
    });
  });

  it("rejects a strict-schema request before fetch", async () => {
    const fetcher = vi.fn();
    const api = createBrowserRoomApi({ accessToken: JWT, fetcher });

    const result = await api.joinRoom({
      slug: ROOM_SLUG,
      joinToken: JOIN_TOKEN,
      displayName: "Sarah",
      color: "#a855f7",
      actorUserId: ACTOR_ID,
    } as never);

    expect(result).toEqual({
      ok: false,
      error: {
        code: "invalid_request",
        message: "Join request is invalid.",
      },
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("maps an in-flight AbortError to cancellation while forwarding the signal", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.signal).toBe(controller.signal);
      controller.abort();
      throw new DOMException("The operation was aborted.", "AbortError");
    });
    const api = createBrowserRoomApi({ accessToken: JWT, fetcher });

    const result = await api.createRoom(
      {
        mode: "demo",
        name: "Launch room",
        displayName: "Danny",
        color: "#0ea5e9",
      },
      { signal: controller.signal },
    );

    expect(result).toEqual({
      ok: false,
      error: {
        code: "request_cancelled",
        message: "Request was cancelled.",
      },
    });
  });
});
