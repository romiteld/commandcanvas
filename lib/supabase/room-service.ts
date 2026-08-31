import { randomBytes as nodeRandomBytes, randomUUID } from "node:crypto";

import { z } from "zod";

import type {
  CanvasActor,
  CanvasCommandSource,
  CanvasState,
  CommandErrorCode,
} from "@/lib/canvas/command-engine";
import {
  buildCanvasMutationPlan,
  parseCanvasPersistenceRows,
  roomDataRowSchema,
  type CanvasMutationPlanErrorCode,
} from "@/lib/supabase/persistence";
import {
  commandRequestSchema,
  createRoomRequestSchema,
  joinRoomRequestSchema,
  type CommandRequest,
  type CreateRoomRequest,
  type JoinRoomRequest,
} from "@/lib/supabase/room-contracts";

export interface RoomServiceQueryResult {
  data: unknown;
  error: unknown;
}

export interface RoomServiceQueryBuilder
  extends PromiseLike<RoomServiceQueryResult> {
  select: (columns: string) => RoomServiceQueryBuilder;
  eq: (column: string, value: unknown) => RoomServiceQueryBuilder;
  order: (
    column: string,
    options: { ascending: boolean },
  ) => RoomServiceQueryBuilder;
  maybeSingle: () => PromiseLike<RoomServiceQueryResult>;
}

export interface RoomServiceClient {
  from: (table: string) => RoomServiceQueryBuilder;
  rpc: (
    functionName: string,
    args: Record<string, unknown>,
  ) => PromiseLike<RoomServiceQueryResult>;
}

export interface RoomServiceDependencies {
  createUuid: () => string;
  randomBytes: (size: number) => Uint8Array;
  now: () => Date;
}

export type RoomServiceErrorCode =
  | "create_unavailable"
  | "demo_room_limit_reached"
  | "demo_room_storage_limit_reached"
  | "delete_unavailable"
  | "join_unavailable"
  | "room_unavailable"
  | "invalid_persisted_state"
  | "member_required"
  | "host_required"
  | "stale_revision"
  | "object_pinned"
  | "invalid_hierarchy"
  | "frame_not_empty"
  | "command_conflict"
  | "permission_denied"
  | "invalid_command"
  | "nothing_to_undo"
  | "nothing_to_redo"
  | "mutation_unavailable";

export interface RoomServiceError {
  code: RoomServiceErrorCode;
  message: string;
  commandCode?: CommandErrorCode;
}

export type RoomServiceResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: RoomServiceError };

export interface CreateRoomValue {
  roomId: string;
  slug: string;
  joinToken: string;
  role: "host";
  joined: true;
}

export interface JoinRoomValue {
  roomId: string;
  role: "host" | "participant";
  joined: boolean;
}

export interface DeleteDemoRoomValue {
  roomId: string;
  deleted: true;
}

export interface CommitCommandValue {
  roomId: string;
  revision: number;
  receiptId: string;
  state: CanvasState;
}

export interface CommandCanvasRoomService {
  createRoom: (
    actorUserId: string,
    input: CreateRoomRequest,
  ) => Promise<RoomServiceResult<CreateRoomValue>>;
  joinRoom: (
    actorUserId: string,
    input: JoinRoomRequest,
  ) => Promise<RoomServiceResult<JoinRoomValue>>;
  deleteDemoRoom: (
    actorUserId: string,
    roomId: string,
  ) => Promise<RoomServiceResult<DeleteDemoRoomValue>>;
  loadCanvas: (roomId: string) => Promise<RoomServiceResult<CanvasState>>;
  commitCommand: (
    actorUserId: string,
    input: CommandRequest,
  ) => Promise<RoomServiceResult<CommitCommandValue>>;
}

const uuidSchema = z.uuid();
const roomLookupSchema = z
  .object({ id: z.uuid(), mode: z.literal("demo") })
  .strict();
const memberSchema = z
  .object({
    role: z.enum(["host", "participant"]),
    display_name: z.string().trim().min(1).max(64),
  })
  .strict();
const createRoomRpcSchema = z
  .object({
    roomId: z.uuid(),
    slug: z.string().min(12).max(96),
    role: z.literal("host"),
    joined: z.literal(true),
    resumed: z.boolean(),
  })
  .strict();
const joinRoomRpcSchema = z
  .object({
    roomId: z.uuid(),
    role: z.enum(["host", "participant"]),
    joined: z.boolean(),
  })
  .strict();
const deleteDemoRoomRpcSchema = z
  .object({
    roomId: z.uuid(),
    deleted: z.literal(true),
  })
  .strict();
const mutationRpcSchema = z
  .object({
    receiptId: z.uuid(),
    revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    action: z.enum([
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
    ]),
    affectedObjectIds: z.array(
      z.string().min(2).max(96).regex(/^[a-z][a-z0-9-]*$/),
    ),
  })
  .strict();

const defaultDependencies: RoomServiceDependencies = {
  createUuid: randomUUID,
  randomBytes: (size) => nodeRandomBytes(size),
  now: () => new Date(),
};

export function createRoomService(
  client: RoomServiceClient,
  dependencies: RoomServiceDependencies = defaultDependencies,
): CommandCanvasRoomService {
  async function createRoom(
    actorUserId: string,
    rawInput: CreateRoomRequest,
  ): Promise<RoomServiceResult<CreateRoomValue>> {
    const input = createRoomRequestSchema.safeParse(rawInput);
    if (!input.success || !uuidSchema.safeParse(actorUserId).success)
      return failure("create_unavailable", "Room could not be created.");

    let roomId: string;
    let slug: string;
    let joinToken: string;
    try {
      roomId = uuidSchema.parse(dependencies.createUuid());
      const slugEntropy = exactRandomBytes(dependencies, 16);
      const joinTokenBytes = exactRandomBytes(dependencies, 32);
      slug = `room-${Buffer.from(slugEntropy).toString("hex")}`;
      joinToken = Buffer.from(joinTokenBytes).toString("base64url");
    } catch {
      return failure("create_unavailable", "Room could not be created.");
    }

    try {
      const response = await client.rpc("open_demo_room_with_host", {
        p_room_id: roomId,
        p_slug: slug,
        p_name: input.data.name,
        p_host_user_id: actorUserId,
        p_display_name: input.data.displayName,
        p_color: input.data.color,
        p_join_token: joinToken,
      });
      if (providerErrorMessage(response.error) === "demo_room_limit_reached")
        return failure(
          "demo_room_limit_reached",
          "Reset one of your demo rooms before creating another.",
        );
      if (hasError(response))
        return failure("create_unavailable", "Room could not be created.");

      const parsed = createRoomRpcSchema.safeParse(response.data);
      if (
        !parsed.success ||
        (!parsed.data.resumed &&
          (parsed.data.roomId !== roomId || parsed.data.slug !== slug))
      )
        return failure("create_unavailable", "Room could not be created.");

      return {
        ok: true,
        value: {
          roomId: parsed.data.roomId,
          slug: parsed.data.slug,
          joinToken,
          role: "host",
          joined: true,
        },
      };
    } catch {
      return failure("create_unavailable", "Room could not be created.");
    }
  }

  async function deleteDemoRoom(
    actorUserId: string,
    roomId: string,
  ): Promise<RoomServiceResult<DeleteDemoRoomValue>> {
    if (
      !uuidSchema.safeParse(actorUserId).success ||
      !uuidSchema.safeParse(roomId).success
    )
      return failure("delete_unavailable", "Demo room could not be deleted.");

    try {
      const response = await client.rpc("delete_demo_room_as_host", {
        p_room_id: roomId,
        p_actor_user_id: actorUserId,
      });
      if (
        providerErrorMessage(response.error) === "demo_room_delete_forbidden"
      )
        return failure(
          "host_required",
          "Only the demo room host can delete this room.",
        );
      if (hasError(response))
        return failure("delete_unavailable", "Demo room could not be deleted.");

      const parsed = deleteDemoRoomRpcSchema.safeParse(response.data);
      if (!parsed.success || parsed.data.roomId !== roomId)
        return failure("delete_unavailable", "Demo room could not be deleted.");
      return { ok: true, value: parsed.data };
    } catch {
      return failure("delete_unavailable", "Demo room could not be deleted.");
    }
  }

  async function joinRoom(
    actorUserId: string,
    rawInput: JoinRoomRequest,
  ): Promise<RoomServiceResult<JoinRoomValue>> {
    const input = joinRoomRequestSchema.safeParse(rawInput);
    if (!input.success || !uuidSchema.safeParse(actorUserId).success)
      return joinUnavailable();

    try {
      const lookup = await client
        .from("rooms")
        .select("id, mode")
        .eq("slug", input.data.slug)
        .maybeSingle();
      if (hasError(lookup)) return joinUnavailable();
      const room = roomLookupSchema.safeParse(lookup.data);
      if (!room.success) return joinUnavailable();

      const response = await client.rpc("join_room_as_participant", {
        p_room_id: room.data.id,
        p_user_id: actorUserId,
        p_display_name: input.data.displayName,
        p_color: input.data.color,
        p_join_token: input.data.joinToken,
        p_requested_role: "participant",
      });
      if (hasError(response)) return joinUnavailable();
      const result = joinRoomRpcSchema.safeParse(response.data);
      if (!result.success || result.data.roomId !== room.data.id)
        return joinUnavailable();

      return { ok: true, value: result.data };
    } catch {
      return joinUnavailable();
    }
  }

  async function loadCanvas(
    roomId: string,
  ): Promise<RoomServiceResult<CanvasState>> {
    if (!uuidSchema.safeParse(roomId).success)
      return failure("room_unavailable", "Room is unavailable.");

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const roomBeforeResponse = await readExactRoom(client, roomId);
        if (hasError(roomBeforeResponse) || roomBeforeResponse.data === null)
          return failure("room_unavailable", "Room is unavailable.");
        const roomBefore = roomDataRowSchema.safeParse(roomBeforeResponse.data);
        if (!roomBefore.success || roomBefore.data.id !== roomId)
          return failure(
            "invalid_persisted_state",
            "Canvas state could not be verified.",
          );

        const objectQuery = client
          .from("canvas_objects")
          .select("*")
          .eq("room_id", roomId)
          .order("id", { ascending: true });
        const receiptQuery = client
          .from("receipts")
          .select("*")
          .eq("room_id", roomId)
          .order("revision", { ascending: true });
        const [objectResponse, receiptResponse] = await Promise.all([
          objectQuery,
          receiptQuery,
        ]);
        if (hasError(objectResponse) || hasError(receiptResponse))
          return failure("room_unavailable", "Room is unavailable.");

        const roomAfterResponse = await readExactRoom(client, roomId);
        if (hasError(roomAfterResponse) || roomAfterResponse.data === null)
          return failure("room_unavailable", "Room is unavailable.");
        const roomAfter = roomDataRowSchema.safeParse(roomAfterResponse.data);
        if (!roomAfter.success || roomAfter.data.id !== roomId)
          return failure(
            "invalid_persisted_state",
            "Canvas state could not be verified.",
          );

        if (roomBefore.data.revision !== roomAfter.data.revision) {
          if (attempt === 0) continue;
          return failure("room_unavailable", "Room is unavailable.");
        }

        const parsed = parseCanvasPersistenceRows({
          room: roomAfter.data,
          objects: objectResponse.data,
          receipts: receiptResponse.data,
        });
        if (!parsed.ok)
          return failure(
            "invalid_persisted_state",
            "Canvas state could not be verified.",
          );
        return { ok: true, value: parsed.state };
      } catch {
        return failure("room_unavailable", "Room is unavailable.");
      }
    }

    return failure("room_unavailable", "Room is unavailable.");
  }

  async function commitCommand(
    actorUserId: string,
    rawInput: CommandRequest,
  ): Promise<RoomServiceResult<CommitCommandValue>> {
    const input = commandRequestSchema.safeParse(rawInput);
    if (!input.success || !uuidSchema.safeParse(actorUserId).success)
      return failure("invalid_command", "Canvas command is invalid.");

    const membershipResult = await loadMembership(
      client,
      input.data.roomId,
      actorUserId,
    );
    if (!membershipResult.ok) return membershipResult;

    const actorResult = deriveActor(
      actorUserId,
      membershipResult.value,
      input.data.source,
    );
    if (!actorResult.ok) return actorResult;

    const current = await loadCanvas(input.data.roomId);
    if (!current.ok) return current;
    if (input.data.baseRevision !== current.value.revision)
      return failure("stale_revision", "Canvas changed. Reload and try again.");

    let issuedAt: string;
    try {
      issuedAt = dependencies.now().toISOString();
    } catch {
      return failure("mutation_unavailable", "Canvas mutation is unavailable.");
    }

    const envelope = {
      id: input.data.commandId,
      roomId: input.data.roomId,
      baseRevision: input.data.baseRevision,
      issuedAt,
      actor: actorResult.value.actor,
      source: actorResult.value.source,
      command: input.data.command,
    };
    const planned = buildCanvasMutationPlan(current.value, envelope);
    if (!planned.ok) return mapPlanError(planned.error.code);

    let response: RoomServiceQueryResult;
    try {
      response = await client.rpc("commit_canvas_mutation_at_revision", {
        p_room_id: input.data.roomId,
        p_expected_room_revision: input.data.baseRevision,
        p_actor_user_id: actorUserId,
        p_actor_type: actorResult.value.actor.type,
        p_source: actorResult.value.source,
        p_action: planned.plan.action,
        p_description: planned.plan.description,
        p_changes: planned.plan.changes,
        p_inverse_command: null,
        p_reversible: planned.plan.reversible,
        p_undoes_receipt_id: planned.plan.undoesReceiptId,
        p_receipt_id: input.data.commandId,
      });
    } catch {
      return failure("mutation_unavailable", "Canvas mutation is unavailable.");
    }
    if (hasError(response)) return mapMutationError(response.error);

    const mutation = mutationRpcSchema.safeParse(response.data);
    if (
      !mutation.success ||
      mutation.data.receiptId !== input.data.commandId ||
      mutation.data.revision !== current.value.revision + 1 ||
      mutation.data.action !== planned.plan.action
    )
      return failure("mutation_unavailable", "Canvas mutation is unavailable.");

    const reloaded = await loadCanvas(input.data.roomId);
    if (!reloaded.ok) return reloaded;
    const committedReceipt = reloaded.value.receipts.find(
      (receipt) => receipt.id === input.data.commandId,
    );
    if (
      reloaded.value.revision !== mutation.data.revision ||
      !committedReceipt ||
      committedReceipt.commandId !== input.data.commandId ||
      committedReceipt.source !== actorResult.value.source
    )
      return failure(
        "invalid_persisted_state",
        "Canvas state could not be verified.",
      );

    return {
      ok: true,
      value: {
        roomId: input.data.roomId,
        revision: mutation.data.revision,
        receiptId: mutation.data.receiptId,
        state: reloaded.value,
      },
    };
  }

  return {
    createRoom,
    joinRoom,
    deleteDemoRoom,
    loadCanvas,
    commitCommand,
  };
}

function readExactRoom(client: RoomServiceClient, roomId: string) {
  return client.from("rooms").select("*").eq("id", roomId).maybeSingle();
}

function exactRandomBytes(
  dependencies: RoomServiceDependencies,
  size: number,
): Uint8Array {
  const bytes = dependencies.randomBytes(size);
  if (!(bytes instanceof Uint8Array) || bytes.byteLength !== size)
    throw new Error("Random byte provider returned the wrong length.");
  return bytes;
}

function hasError(result: RoomServiceQueryResult) {
  return result.error !== null && result.error !== undefined;
}

function providerErrorMessage(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("message" in error))
    return null;
  return typeof error.message === "string" ? error.message : null;
}

function failure<C extends RoomServiceErrorCode>(
  code: C,
  message: string,
  commandCode?: CommandErrorCode,
): { ok: false; error: RoomServiceError & { code: C } } {
  return {
    ok: false,
    error: {
      code,
      message,
      ...(commandCode ? { commandCode } : {}),
    },
  };
}

function joinUnavailable(): RoomServiceResult<never> {
  return failure(
    "join_unavailable",
    "Room is unavailable or the join link is invalid.",
  );
}

async function loadMembership(
  client: RoomServiceClient,
  roomId: string,
  actorUserId: string,
): Promise<RoomServiceResult<z.infer<typeof memberSchema>>> {
  try {
    const response = await client
      .from("room_members")
      .select("role,display_name")
      .eq("room_id", roomId)
      .eq("user_id", actorUserId)
      .maybeSingle();
    if (hasError(response))
      return failure("mutation_unavailable", "Canvas mutation is unavailable.");
    if (response.data === null)
      return failure(
        "member_required",
        "Join this room before changing its canvas.",
      );
    const member = memberSchema.safeParse(response.data);
    if (!member.success)
      return failure("mutation_unavailable", "Canvas mutation is unavailable.");
    return { ok: true, value: member.data };
  } catch {
    return failure("mutation_unavailable", "Canvas mutation is unavailable.");
  }
}

function deriveActor(
  actorUserId: string,
  member: z.infer<typeof memberSchema>,
  requestedSource: CanvasCommandSource,
): RoomServiceResult<{ actor: CanvasActor; source: CanvasCommandSource }> {
  if (requestedSource === "webmcp") {
    return {
      ok: true,
      value: {
        actor: {
          id: actorUserId,
          displayName: "CommandCanvas agent",
          type: "agent",
        },
        source: "webmcp",
      },
    };
  }

  if (member.role === "participant")
    return {
      ok: true,
      value: {
        actor: {
          id: actorUserId,
          displayName: member.display_name,
          type: "participant",
        },
        source: requestedSource === "system" ? "system" : "collaborator",
      },
    };

  if (requestedSource === "collaborator")
    return failure("invalid_command", "Canvas command is invalid.");

  return {
    ok: true,
    value: {
      actor: {
        id: actorUserId,
        displayName: member.display_name,
        type: "human",
      },
      source: requestedSource,
    },
  };
}

function mapPlanError(
  code: CanvasMutationPlanErrorCode,
): RoomServiceResult<never> {
  switch (code) {
    case "OBJECT_PINNED":
      return failure(
        "object_pinned",
        "Unpin the object before moving or resizing it.",
        code,
      );
    case "STALE_REVISION":
      return failure(
        "stale_revision",
        "Canvas changed. Reload and try again.",
        code,
      );
    case "OBJECT_EXISTS":
    case "OBJECT_NOT_FOUND":
      return failure(
        "command_conflict",
        "Canvas changed before the command could be committed.",
        code,
      );
    case "STALE_OBJECT_VERSION":
      return failure(
        "command_conflict",
        "That thought card changed. Continue from its latest text.",
        code,
      );
    case "NOTHING_TO_UNDO":
      return failure(
        "nothing_to_undo",
        "There is nothing left to undo.",
        code,
      );
    case "NOTHING_TO_REDO":
      return failure(
        "nothing_to_redo",
        "There is nothing left to redo.",
        code,
      );
    case "INVALID_HIERARCHY":
      return failure(
        "invalid_hierarchy",
        "That frame or group hierarchy is no longer valid.",
        code,
      );
    case "FRAME_NOT_EMPTY":
      return failure(
        "frame_not_empty",
        "Ungroup the frame before moving it to trash.",
        code,
      );
    case "INVALID_STATE":
      return failure(
        "invalid_persisted_state",
        "Canvas state could not be verified.",
      );
    case "INVALID_COMMAND":
    case "ROOM_MISMATCH":
      return failure("invalid_command", "Canvas command is invalid.", code);
    case "OBJECT_NOT_EDITABLE":
      return failure(
        "invalid_command",
        "Only an active note can receive dictated text.",
        code,
      );
    case "NOTE_TEXT_LIMIT":
      return failure(
        "invalid_command",
        "That thought card reached its 4,000-character limit. Finish it and start another thought.",
        code,
      );
  }
}

function mapMutationError(error: unknown): RoomServiceResult<never> {
  const message = databaseErrorMessage(error);
  if (message === "demo_room_storage_limit_reached")
    return failure(
      "demo_room_storage_limit_reached",
      "This demo room reached its storage limit. Reset the demo to continue.",
    );
  if (
    includesAny(message, [
      "canvas_object_version_conflict",
      "canvas_room_revision_conflict",
      "canvas_revision_conflict",
      "canvas_receipt_id_exists",
      "canvas_object_exists",
      "canvas_object_not_found",
      "canvas_object_deleted",
      "canvas_undo_state_conflict",
      "canvas_undo_target_not_latest",
      "canvas_undo_target_already_undone",
      "canvas_redo_state_conflict",
      "canvas_redo_target_already_redone",
      "canvas_redo_target_not_found",
      "canvas_redo_target_not_latest",
      "canvas_redo_target_not_undo",
    ])
  )
    return failure(
      "command_conflict",
      "Canvas changed before the command could be committed.",
    );
  if (message.includes("canvas_pinned_transform_forbidden"))
    return failure(
      "object_pinned",
      "Unpin the object before moving or resizing it.",
    );
  if (
    includesAny(message, [
      "canvas_invalid_parent_id",
      "canvas_parent_not_active_frame",
    ])
  )
    return failure(
      "invalid_hierarchy",
      "That frame or group hierarchy is no longer valid.",
    );
  if (message.includes("canvas_actor_not_member"))
    return failure(
      "member_required",
      "Join this room before changing its canvas.",
    );
  if (message.includes("canvas_agent_requires_host"))
    return failure(
      "host_required",
      "Only the room host can authorize WebMCP mutations.",
    );
  if (message.includes("canvas_actor_type_mismatch"))
    return failure(
      "permission_denied",
      "This participant cannot perform that command.",
    );
  if (message.includes("canvas_room_not_found"))
    return failure("room_unavailable", "Room is unavailable.");
  return failure("mutation_unavailable", "Canvas mutation is unavailable.");
}

function databaseErrorMessage(error: unknown) {
  if (!error || typeof error !== "object" || Array.isArray(error)) return "";
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" ? message : "";
}

function includesAny(value: string, candidates: string[]) {
  return candidates.some((candidate) => value.includes(candidate));
}
