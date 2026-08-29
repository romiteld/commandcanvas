import { z } from "zod";

import {
  newCanvasObjectSchema,
  type CanvasObject,
} from "@/lib/canvas/object-model";
import {
  commandRequestSchema,
  createRoomRequestSchema,
  joinRoomRequestSchema,
  type CommandRequest,
  type CreateRoomRequest,
  type JoinRoomRequest,
} from "@/lib/supabase/room-contracts";
import type {
  CommitCommandValue,
  CreateRoomValue,
  DeleteDemoRoomValue,
  JoinRoomValue,
} from "@/lib/supabase/room-service";
import { parseBearerJwtHeader } from "@/lib/supabase/server-auth";

export type RoomApiFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface BrowserRoomApiOptions {
  accessToken: string;
  fetcher?: RoomApiFetch;
}

export interface RoomApiRequestOptions {
  signal?: AbortSignal;
}

export type RoomApiResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      error: {
        code: string;
        message: string;
        status?: number;
      };
    };

export interface BrowserRoomApi {
  createRoom: (
    input: CreateRoomRequest,
    options?: RoomApiRequestOptions,
  ) => Promise<RoomApiResult<CreateRoomValue>>;
  deleteDemoRoom: (
    roomId: string,
    options?: RoomApiRequestOptions,
  ) => Promise<RoomApiResult<DeleteDemoRoomValue>>;
  joinRoom: (
    input: JoinRoomRequest,
    options?: RoomApiRequestOptions,
  ) => Promise<RoomApiResult<JoinRoomValue>>;
  commitCommand: (
    input: CommandRequest,
    options?: RoomApiRequestOptions,
  ) => Promise<RoomApiResult<CommitCommandValue>>;
}

const objectIdSchema = z
  .string()
  .min(2)
  .max(96)
  .regex(/^[a-z][a-z0-9-]*$/);
const timestampSchema = z.iso.datetime({ offset: true });
const revisionSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);

const createRoomResponseSchema = z
  .object({
    ok: z.literal(true),
    room: z
      .object({
        roomId: z.uuid(),
        slug: z
          .string()
          .min(12)
          .max(96)
          .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/),
        joinToken: z
          .string()
          .min(43)
          .max(86)
          .regex(/^[A-Za-z0-9_-]+$/),
        role: z.literal("host"),
        joined: z.literal(true),
      })
      .strict(),
  })
  .strict();

const joinRoomResponseSchema = z
  .object({
    ok: z.literal(true),
    room: z
      .object({
        roomId: z.uuid(),
        role: z.enum(["host", "participant"]),
        joined: z.boolean(),
      })
      .strict(),
  })
  .strict();
const deleteDemoRoomResponseSchema = z
  .object({
    ok: z.literal(true),
    room: z
      .object({
        roomId: z.uuid(),
        deleted: z.literal(true),
      })
      .strict(),
  })
  .strict();

const canvasObjectSchema = z
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
    title: z.string(),
    x: z.number(),
    y: z.number(),
    width: z.number(),
    height: z.number(),
    zIndex: z.number(),
    rotation: z.number().finite().min(-180).max(180).optional(),
    parentId: objectIdSchema.nullable().optional(),
    minimized: z.boolean(),
    pinned: z.boolean(),
    createdBy: z.uuid(),
    createdAt: timestampSchema,
    updatedAt: timestampSchema,
    deletedAt: timestampSchema.nullable(),
    version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    metadata: z.record(z.string(), z.unknown()),
    payload: z.unknown(),
  })
  .strict()
  .transform((value, context): CanvasObject => {
    const object = newCanvasObjectSchema.safeParse({
      id: value.id,
      type: value.type,
      title: value.title,
      x: value.x,
      y: value.y,
      width: value.width,
      height: value.height,
      zIndex: value.zIndex,
      ...(value.rotation !== undefined ? { rotation: value.rotation } : {}),
      payload: value.payload,
    });
    if (!object.success) {
      context.addIssue({
        code: "custom",
        message: "Canvas object does not match its semantic object schema.",
      });
      return z.NEVER;
    }
    return {
      ...object.data,
      roomId: value.roomId,
      minimized: value.minimized,
      pinned: value.pinned,
      createdBy: value.createdBy,
      createdAt: value.createdAt,
      updatedAt: value.updatedAt,
      deletedAt: value.deletedAt,
      version: value.version,
      metadata: value.metadata,
      ...(value.rotation !== undefined ? { rotation: value.rotation } : {}),
      ...(value.parentId !== undefined ? { parentId: value.parentId } : {}),
    };
  });

const receiptObjectStateSchema = z
  .object({
    objects: z.record(z.string(), canvasObjectSchema.nullable()),
  })
  .strict();

const activityReceiptSchema = z
  .object({
    id: z.uuid(),
    roomId: z.uuid(),
    commandId: z.string().min(1).max(128),
    revision: revisionSchema.min(1),
    occurredAt: timestampSchema,
    actor: z
      .object({
        id: z.uuid(),
        displayName: z.string().trim().min(1).max(80),
        type: z.enum(["human", "participant", "agent"]),
      })
      .strict(),
    source: z.enum([
      "pointer",
      "touch",
      "stylus",
      "gesture",
      "voice",
      "typed",
      "collaborator",
      "webmcp",
      "system",
    ]),
    action: z.enum([
      "create",
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
    ]),
    affectedObjectIds: z.array(objectIdSchema).min(1).max(50),
    before: receiptObjectStateSchema,
    after: receiptObjectStateSchema,
    description: z.string().trim().min(1).max(280),
    undoOfReceiptId: z.uuid().optional(),
  })
  .strict()
  .superRefine((receipt, context) => {
    const affectedIds = new Set(receipt.affectedObjectIds);
    if (affectedIds.size !== receipt.affectedObjectIds.length)
      context.addIssue({
        code: "custom",
        path: ["affectedObjectIds"],
        message: "Receipt object IDs must be unique.",
      });
    for (const side of ["before", "after"] as const) {
      const snapshotIds = Object.keys(receipt[side].objects);
      if (
        snapshotIds.length !== affectedIds.size ||
        snapshotIds.some((id) => !affectedIds.has(id))
      )
        context.addIssue({
          code: "custom",
          path: [side, "objects"],
          message: "Receipt snapshots must match affected object IDs.",
        });
    }
  });

const canvasStateSchema = z
  .object({
    roomId: z.uuid(),
    revision: revisionSchema,
    objects: z.record(z.string(), canvasObjectSchema),
    receipts: z.array(activityReceiptSchema),
    undoneReceiptIds: z.array(z.uuid()),
    redoReceiptIds: z.array(z.uuid()).optional().default([]),
  })
  .strict()
  .superRefine((state, context) => {
    for (const [objectId, object] of Object.entries(state.objects)) {
      if (objectId !== object.id || object.roomId !== state.roomId)
        context.addIssue({
          code: "custom",
          path: ["objects", objectId],
          message: "Canvas object identity does not match its state key and room.",
        });
      if (!object.deletedAt && object.parentId) {
        const parent = state.objects[object.parentId];
        if (!parent || parent.deletedAt || parent.type !== "frame")
          context.addIssue({
            code: "custom",
            path: ["objects", objectId, "parentId"],
            message: "Canvas object parent must be an active frame.",
          });
      }
      if (object.deletedAt) continue;
      const visited = new Set([objectId]);
      let cursor = object;
      while (cursor.parentId) {
        if (visited.has(cursor.parentId)) {
          context.addIssue({
            code: "custom",
            path: ["objects", objectId, "parentId"],
            message: "Canvas frame hierarchy cannot contain a cycle.",
          });
          break;
        }
        visited.add(cursor.parentId);
        const parent = state.objects[cursor.parentId];
        if (!parent) break;
        cursor = parent;
      }
    }

    let previousRevision = 0;
    const receiptIds = new Set<string>();
    for (const [index, receipt] of state.receipts.entries()) {
      if (
        receipt.roomId !== state.roomId ||
        receipt.revision <= previousRevision ||
        receipt.revision > state.revision ||
        receiptIds.has(receipt.id)
      )
        context.addIssue({
          code: "custom",
          path: ["receipts", index],
          message: "Canvas receipt identity or revision order is invalid.",
        });
      previousRevision = receipt.revision;
      receiptIds.add(receipt.id);
    }
    if (
      state.receipts.length !== state.revision ||
      (state.receipts.at(-1)?.revision ?? 0) !== state.revision
    )
      context.addIssue({
        code: "custom",
        path: ["receipts"],
        message: "Canvas receipts must cover the authoritative revision.",
      });
    if (state.undoneReceiptIds.some((id) => !receiptIds.has(id)))
      context.addIssue({
        code: "custom",
        path: ["undoneReceiptIds"],
        message: "Undone receipt IDs must reference canvas receipts.",
      });
    if (state.redoReceiptIds.some((id) => !receiptIds.has(id)))
      context.addIssue({
        code: "custom",
        path: ["redoReceiptIds"],
        message: "Redo receipt IDs must reference canvas receipts.",
      });
  });

const commandResponseSchema = z
  .object({
    ok: z.literal(true),
    mutation: z
      .object({
        roomId: z.uuid(),
        revision: revisionSchema.min(1),
        receiptId: z.uuid(),
        state: canvasStateSchema,
      })
      .strict(),
  })
  .strict()
  .superRefine((response, context) => {
    const { mutation } = response;
    if (
      mutation.roomId !== mutation.state.roomId ||
      mutation.revision !== mutation.state.revision ||
      !mutation.state.receipts.some(
        (receipt) =>
          receipt.id === mutation.receiptId &&
          receipt.revision === mutation.revision,
      )
    )
      context.addIssue({
        code: "custom",
        path: ["mutation"],
        message: "Mutation metadata does not match its authoritative state.",
      });
  });

const errorResponseSchema = z
  .object({
    ok: z.literal(false),
    error: z
      .object({
        code: z.enum([
          "authorization_missing",
          "authorization_malformed",
          "authorization_too_large",
          "authentication_failed",
          "unsupported_media_type",
          "request_too_large",
          "invalid_request",
          "create_unavailable",
          "demo_room_limit_reached",
          "demo_room_storage_limit_reached",
          "delete_unavailable",
          "join_unavailable",
          "room_mismatch",
          "invalid_room_id",
          "member_required",
          "host_required",
          "permission_denied",
          "room_unavailable",
          "stale_revision",
          "object_pinned",
          "invalid_hierarchy",
          "frame_not_empty",
          "command_conflict",
          "nothing_to_undo",
          "nothing_to_redo",
          "invalid_command",
          "invalid_persisted_state",
          "mutation_unavailable",
          "service_unavailable",
        ]),
        message: z.string().trim().min(1).max(280),
      })
      .strict(),
  })
  .strict();

export function createBrowserRoomApi({
  accessToken,
  fetcher = fetch,
}: BrowserRoomApiOptions): BrowserRoomApi {
  const authorization = parseBearerJwtHeader(`Bearer ${accessToken}`);
  const bearerToken = authorization.ok ? authorization.token : null;

  return {
    async createRoom(rawInput, options) {
      if (bearerToken === null) return invalidAuthorization();
      const input = createRoomRequestSchema.safeParse(rawInput);
      if (!input.success)
        return failure("invalid_request", "Room request is invalid.");
      if (options?.signal?.aborted) return cancelled();

      try {
        const response = await fetcher("/api/rooms", {
          method: "POST",
          headers: {
            authorization: `Bearer ${bearerToken}`,
            "content-type": "application/json",
          },
          cache: "no-store",
          body: JSON.stringify(input.data),
          signal: options?.signal,
        });
        const rawResponse = await readJsonResponse(response);
        if (!rawResponse.ok)
          return failure(
            "invalid_response",
            "Room could not be created.",
            response.status,
          );
        const raw = rawResponse.value;
        if (response.status !== 201)
          return parseErrorResponse(
            raw,
            response.status,
            "Room could not be created.",
            [accessToken],
          );
        const parsed = createRoomResponseSchema.safeParse(raw);
        if (!parsed.success)
          return failure("invalid_response", "Room could not be created.", response.status);
        return { ok: true, value: parsed.data.room };
      } catch (error) {
        return requestFailure(error, options?.signal);
      }
    },
    async deleteDemoRoom(roomId, options) {
      if (bearerToken === null) return invalidAuthorization();
      if (!z.uuid().safeParse(roomId).success)
        return failure("invalid_request", "Room ID is invalid.");
      if (options?.signal?.aborted) return cancelled();

      try {
        const response = await fetcher(
          `/api/rooms/${encodeURIComponent(roomId)}`,
          {
            method: "DELETE",
            headers: { authorization: `Bearer ${bearerToken}` },
            cache: "no-store",
            signal: options?.signal,
          },
        );
        const rawResponse = await readJsonResponse(response);
        if (!rawResponse.ok)
          return failure(
            "invalid_response",
            "Demo room could not be deleted.",
            response.status,
          );
        const raw = rawResponse.value;
        if (response.status !== 200)
          return parseErrorResponse(
            raw,
            response.status,
            "Demo room could not be deleted.",
            [accessToken],
          );
        const parsed = deleteDemoRoomResponseSchema.safeParse(raw);
        if (!parsed.success || parsed.data.room.roomId !== roomId)
          return failure(
            "invalid_response",
            "Demo room could not be deleted.",
            response.status,
          );
        return { ok: true, value: parsed.data.room };
      } catch (error) {
        return requestFailure(error, options?.signal);
      }
    },
    async joinRoom(rawInput, options) {
      if (bearerToken === null) return invalidAuthorization();
      const input = joinRoomRequestSchema.safeParse(rawInput);
      if (!input.success)
        return failure("invalid_request", "Join request is invalid.");
      if (options?.signal?.aborted) return cancelled();

      try {
        const response = await fetcher("/api/rooms/join", {
          method: "POST",
          headers: {
            authorization: `Bearer ${bearerToken}`,
            "content-type": "application/json",
          },
          cache: "no-store",
          body: JSON.stringify(input.data),
          signal: options?.signal,
        });
        const rawResponse = await readJsonResponse(response);
        if (!rawResponse.ok)
          return failure(
            "invalid_response",
            "Room could not be joined.",
            response.status,
          );
        const raw = rawResponse.value;
        if (response.status !== 200)
          return parseErrorResponse(
            raw,
            response.status,
            "Room could not be joined.",
            [accessToken, input.data.joinToken],
          );
        const parsed = joinRoomResponseSchema.safeParse(raw);
        if (!parsed.success)
          return failure("invalid_response", "Room could not be joined.", response.status);
        return { ok: true, value: parsed.data.room };
      } catch (error) {
        return requestFailure(error, options?.signal);
      }
    },
    async commitCommand(rawInput, options) {
      if (bearerToken === null) return invalidAuthorization();
      const input = commandRequestSchema.safeParse(rawInput);
      if (!input.success)
        return failure("invalid_request", "Canvas command is invalid.");
      if (options?.signal?.aborted) return cancelled();

      try {
        const response = await fetcher(
          `/api/rooms/${encodeURIComponent(input.data.roomId)}/commands`,
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${bearerToken}`,
              "content-type": "application/json",
            },
            cache: "no-store",
            body: JSON.stringify(input.data),
            signal: options?.signal,
          },
        );
        const rawResponse = await readJsonResponse(response);
        if (!rawResponse.ok)
          return failure(
            "invalid_response",
            "Canvas command could not be committed.",
            response.status,
          );
        const raw = rawResponse.value;
        if (response.status !== 200)
          return parseErrorResponse(
            raw,
            response.status,
            "Canvas command could not be committed.",
            [accessToken],
          );
        const parsed = commandResponseSchema.safeParse(raw);
        if (!parsed.success)
          return failure(
            "invalid_response",
            "Canvas command could not be committed.",
            response.status,
          );
        return { ok: true, value: parsed.data.mutation };
      } catch (error) {
        return requestFailure(error, options?.signal);
      }
    },
  };
}

function failure(code: string, message: string, status?: number) {
  return {
    ok: false as const,
    error: {
      code,
      message,
      ...(status === undefined ? {} : { status }),
    },
  };
}

function cancelled() {
  return failure("request_cancelled", "Request was cancelled.");
}

function invalidAuthorization() {
  return failure("authorization_invalid", "A valid session is required.");
}

function requestFailure(error: unknown, signal?: AbortSignal) {
  if (
    signal?.aborted ||
    (error instanceof Error && error.name === "AbortError")
  )
    return cancelled();
  return failure("network_unavailable", "CommandCanvas could not be reached.");
}

function parseErrorResponse(
  raw: unknown,
  status: number,
  fallbackMessage: string,
  forbiddenValues: readonly string[],
) {
  if (status < 400 || status > 599)
    return failure("invalid_response", fallbackMessage, status);
  const parsed = errorResponseSchema.safeParse(raw);
  if (
    !parsed.success ||
    forbiddenValues.some(
      (value) => value.length > 0 && parsed.data.error.message.includes(value),
    )
  )
    return failure("invalid_response", fallbackMessage, status);
  return failure(parsed.data.error.code, parsed.data.error.message, status);
}

async function readJsonResponse(
  response: Response,
): Promise<{ ok: true; value: unknown } | { ok: false }> {
  const contentType = response.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (contentType !== "application/json") return { ok: false };
  try {
    return { ok: true, value: await response.json() };
  } catch {
    return { ok: false };
  }
}
