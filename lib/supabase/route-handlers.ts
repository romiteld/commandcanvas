import "server-only";

import { z } from "zod";

import {
  commandRequestSchema,
  createRoomRequestSchema,
  joinRoomRequestSchema,
} from "@/lib/supabase/room-contracts";
import type { CommandErrorCode } from "@/lib/canvas/command-engine";
import {
  authenticateRequestActor,
  type SupabaseUserVerifier,
} from "@/lib/supabase/server-auth";
import {
  createServerServiceClient,
  createServerUserVerifierClient,
  readServerSupabaseConfig,
} from "@/lib/supabase/server-client";
import type {
  CommandCanvasRoomService,
  RoomServiceError,
  RoomServiceClient,
} from "@/lib/supabase/room-service";
import { createRoomService } from "@/lib/supabase/room-service";

const ROOM_REQUEST_MAX_BYTES = 64 * 1_024;
const COMMAND_REQUEST_MAX_BYTES = 2 * 1_024 * 1_024;

export interface RoomRouteDependencies {
  verifier: SupabaseUserVerifier;
  service: CommandCanvasRoomService;
}

export type ServerRoomRouteDependenciesResult =
  | { ok: true; dependencies: RoomRouteDependencies }
  | { ok: false };

export function createServerRoomRouteDependencies(): ServerRoomRouteDependenciesResult {
  const config = readServerSupabaseConfig();
  if (!config.ok) return { ok: false };

  try {
    const client = createServerServiceClient<RoomServiceClient>(config.config);
    const verifier = createServerUserVerifierClient<SupabaseUserVerifier>(
      config.config,
    );
    return {
      ok: true,
      dependencies: {
        verifier,
        service: createRoomService(client),
      },
    };
  } catch {
    return { ok: false };
  }
}

interface RouteError {
  code: string;
  message: string;
  commandCode?: CommandErrorCode;
}

type ParsedRequest<T> =
  | { ok: true; value: T }
  | { ok: false; response: Response };

export async function handleCreateRoomRequest(
  request: Request,
  dependencies: RoomRouteDependencies,
): Promise<Response> {
  const actor = await authenticate(request, dependencies);
  if (!actor.ok) return actor.response;

  const input = await parseJsonRequest(
    request,
    ROOM_REQUEST_MAX_BYTES,
    createRoomRequestSchema,
  );
  if (!input.ok) return input.response;

  try {
    const result = await dependencies.service.createRoom(
      actor.actorUserId,
      input.value,
    );
    if (!result.ok && result.error.code === "demo_room_limit_reached")
      return errorResponse(409, result.error);
    if (!result.ok)
      return errorResponse(503, {
        code: "create_unavailable",
        message: "Room could not be created.",
      });

    return jsonResponse(201, { ok: true, room: result.value });
  } catch {
    return serviceUnavailable();
  }
}

export async function handleDeleteDemoRoomRequest(
  request: Request,
  pathRoomId: string,
  dependencies: RoomRouteDependencies,
): Promise<Response> {
  const actor = await authenticate(request, dependencies);
  if (!actor.ok) return actor.response;
  if (!z.uuid().safeParse(pathRoomId).success)
    return errorResponse(400, {
      code: "invalid_room_id",
      message: "Room ID is invalid.",
    });

  try {
    const result = await dependencies.service.deleteDemoRoom(
      actor.actorUserId,
      pathRoomId,
    );
    if (!result.ok && result.error.code === "host_required")
      return errorResponse(403, result.error);
    if (!result.ok)
      return errorResponse(503, {
        code: "delete_unavailable",
        message: "Demo room could not be deleted.",
      });
    return jsonResponse(200, { ok: true, room: result.value });
  } catch {
    return serviceUnavailable();
  }
}

export async function handleJoinRoomRequest(
  request: Request,
  dependencies: RoomRouteDependencies,
): Promise<Response> {
  const actor = await authenticate(request, dependencies);
  if (!actor.ok) return actor.response;

  const input = await parseJsonRequest(
    request,
    ROOM_REQUEST_MAX_BYTES,
    joinRoomRequestSchema,
  );
  if (!input.ok) return input.response;

  try {
    const result = await dependencies.service.joinRoom(
      actor.actorUserId,
      input.value,
    );
    if (!result.ok)
      return errorResponse(404, {
        code: "join_unavailable",
        message: "Room is unavailable or the join link is invalid.",
      });

    return jsonResponse(200, { ok: true, room: result.value });
  } catch {
    return serviceUnavailable();
  }
}

export async function handleCommandRequest(
  request: Request,
  pathRoomId: string,
  dependencies: RoomRouteDependencies,
): Promise<Response> {
  const actor = await authenticate(request, dependencies);
  if (!actor.ok) return actor.response;

  const input = await parseJsonRequest(
    request,
    COMMAND_REQUEST_MAX_BYTES,
    commandRequestSchema,
  );
  if (!input.ok) return input.response;
  if (input.value.roomId !== pathRoomId)
    return errorResponse(400, {
      code: "room_mismatch",
      message: "Room ID does not match the request path.",
    });

  try {
    const result = await dependencies.service.commitCommand(
      actor.actorUserId,
      input.value,
    );
    if (!result.ok) return commandServiceError(result.error);

    return jsonResponse(200, { ok: true, mutation: result.value });
  } catch {
    return serviceUnavailable();
  }
}

export function serviceUnavailableResponse(): Response {
  return serviceUnavailable();
}

async function authenticate(
  request: Request,
  dependencies: RoomRouteDependencies,
): Promise<
  | { ok: true; actorUserId: string }
  | { ok: false; response: Response }
> {
  const result = await authenticateRequestActor(
    request.headers.get("authorization"),
    dependencies.verifier,
  );
  if (result.ok) return result;
  return {
    ok: false,
    response: errorResponse(401, result.error),
  };
}

async function parseJsonRequest<S extends z.ZodType>(
  request: Request,
  maxBytes: number,
  schema: S,
): Promise<ParsedRequest<z.infer<S>>> {
  if (!isApplicationJson(request.headers.get("content-type")))
    return {
      ok: false,
      response: errorResponse(415, {
        code: "unsupported_media_type",
        message: "Content-Type must be application/json.",
      }),
    };

  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null && /^\d+$/.test(declaredLength)) {
    const bytes = Number(declaredLength);
    if (Number.isSafeInteger(bytes) && bytes > maxBytes)
      return { ok: false, response: requestTooLarge() };
  }

  const bytes = await readBoundedBody(request, maxBytes);
  if (!bytes.ok) return bytes;

  let raw: unknown;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes.value);
    raw = JSON.parse(text);
  } catch {
    return { ok: false, response: invalidRequest() };
  }

  const parsed = schema.safeParse(raw);
  if (!parsed.success)
    return { ok: false, response: invalidRequest() };
  return { ok: true, value: parsed.data };
}

async function readBoundedBody(
  request: Request,
  maxBytes: number,
): Promise<ParsedRequest<Uint8Array>> {
  if (request.body === null)
    return { ok: false, response: invalidRequest() };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value === undefined) continue;
      length += value.byteLength;
      if (length > maxBytes) {
        await reader.cancel();
        return { ok: false, response: requestTooLarge() };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, response: invalidRequest() };
  }

  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, value: body };
}

function isApplicationJson(contentType: string | null) {
  return contentType?.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}

function commandServiceError(error: RoomServiceError): Response {
  const { code, commandCode } = error;
  const safeError = (message: string): RouteError => ({
    code,
    message: commandCode ? commandErrorMessage(commandCode) : message,
    ...(commandCode ? { commandCode } : {}),
  });
  switch (code) {
    case "member_required":
      return errorResponse(
        403,
        safeError("Join this room before changing its canvas."),
      );
    case "host_required":
      return errorResponse(
        403,
        safeError("Only the room host can authorize this action."),
      );
    case "permission_denied":
      return errorResponse(
        403,
        safeError("This participant cannot perform that command."),
      );
    case "room_unavailable":
      return errorResponse(404, safeError("Room is unavailable."));
    case "stale_revision":
      return errorResponse(
        409,
        safeError("Canvas changed. Reload and try again."),
      );
    case "object_pinned":
      return errorResponse(
        409,
        safeError("Unpin the object before moving or resizing it."),
      );
    case "invalid_hierarchy":
      return errorResponse(
        409,
        safeError("That frame or group hierarchy is no longer valid."),
      );
    case "frame_not_empty":
      return errorResponse(
        409,
        safeError("Ungroup the frame before moving it to trash."),
      );
    case "command_conflict":
      return errorResponse(
        409,
        safeError("Canvas changed before the command could be committed."),
      );
    case "demo_room_storage_limit_reached":
      return errorResponse(
        409,
        safeError(
          "This demo room reached its storage limit. Reset the demo to continue.",
        ),
      );
    case "nothing_to_undo":
      return errorResponse(409, safeError("There is nothing left to undo."));
    case "nothing_to_redo":
      return errorResponse(409, safeError("There is nothing left to redo."));
    case "invalid_command":
      return errorResponse(400, safeError("Canvas command is invalid."));
    case "create_unavailable":
    case "demo_room_limit_reached":
    case "delete_unavailable":
    case "join_unavailable":
    case "invalid_persisted_state":
    case "mutation_unavailable":
      return errorResponse(
        503,
        safeError("Canvas state is temporarily unavailable."),
      );
  }
}

function commandErrorMessage(code: CommandErrorCode): string {
  switch (code) {
    case "OBJECT_NOT_EDITABLE":
      return "Only an active note can receive dictated text.";
    case "NOTE_TEXT_LIMIT":
      return "That thought card reached its 4,000-character limit. Finish it and start another thought.";
    case "STALE_OBJECT_VERSION":
      return "That thought card changed. Continue from its latest text.";
    case "OBJECT_PINNED":
      return "Unpin the object before moving or resizing it.";
    case "STALE_REVISION":
      return "Canvas changed. Reload and try again.";
    case "OBJECT_EXISTS":
    case "OBJECT_NOT_FOUND":
      return "Canvas changed before the command could be committed.";
    case "INVALID_HIERARCHY":
      return "That frame or group hierarchy is no longer valid.";
    case "FRAME_NOT_EMPTY":
      return "Ungroup the frame before moving it to trash.";
    case "NOTHING_TO_UNDO":
      return "There is nothing left to undo.";
    case "NOTHING_TO_REDO":
      return "There is nothing left to redo.";
    case "INVALID_COMMAND":
    case "ROOM_MISMATCH":
      return "Canvas command is invalid.";
  }
}

function invalidRequest() {
  return errorResponse(400, {
    code: "invalid_request",
    message: "Request body is invalid.",
  });
}

function requestTooLarge() {
  return errorResponse(413, {
    code: "request_too_large",
    message: "Request body is too large.",
  });
}

function serviceUnavailable() {
  return errorResponse(503, {
    code: "service_unavailable",
    message: "CommandCanvas service is unavailable.",
  });
}

function errorResponse(status: number, error: RouteError) {
  return jsonResponse(status, { ok: false, error });
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
    },
  });
}
