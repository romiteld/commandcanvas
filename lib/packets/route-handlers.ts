import type { z } from "zod";

import {
  approvePacketRequestSchema,
  cancelPacketSendRequestSchema,
  executePacketSendRequestSchema,
  preparePacketRequestSchema,
  stagePacketSendRequestSchema,
  updatePacketRequestSchema,
} from "@/lib/packets/contracts";
import type { CommandCanvasPacketService } from "@/lib/packets/server-service";
import type { PacketServiceError } from "@/lib/packets/server-service";
import {
  authenticateRequestActor,
  type SupabaseUserVerifier,
} from "@/lib/supabase/server-auth";

export interface PacketRouteDependencies {
  verifier: SupabaseUserVerifier;
  service: CommandCanvasPacketService;
}

const PACKET_REQUEST_MAX_BYTES = 64 * 1_024;

type ParsedRequest<T> =
  | { ok: true; value: T }
  | { ok: false; response: Response };

export async function handleLoadLatestPacketRequest(
  request: Request,
  pathRoomId: string,
  dependencies: PacketRouteDependencies,
): Promise<Response> {
  const actor = await authenticate(request, dependencies);
  if (!actor.ok) return actor.response;

  try {
    const result = await dependencies.service.loadLatest(
      actor.actorUserId,
      pathRoomId,
    );
    if (!result.ok) return serviceErrorResponse(result.error);
    return jsonResponse(200, { ok: true, workflow: result.value });
  } catch {
    return serviceUnavailable();
  }
}

export async function handlePreparePacketRequest(
  request: Request,
  pathRoomId: string,
  dependencies: PacketRouteDependencies,
): Promise<Response> {
  const actor = await authenticate(request, dependencies);
  if (!actor.ok) return actor.response;
  const input = await parseJsonRequest(request, preparePacketRequestSchema);
  if (!input.ok) return input.response;
  const mismatch = roomAndEntityMismatch(input.value, pathRoomId);
  if (mismatch) return mismatch;

  try {
    const result = await dependencies.service.prepareDraft(
      actor.actorUserId,
      input.value,
    );
    if (!result.ok) return serviceErrorResponse(result.error);
    return jsonResponse(201, { ok: true, packet: result.value });
  } catch {
    return serviceUnavailable();
  }
}

export async function handleUpdatePacketRequest(
  request: Request,
  pathRoomId: string,
  pathPacketId: string,
  dependencies: PacketRouteDependencies,
): Promise<Response> {
  const actor = await authenticate(request, dependencies);
  if (!actor.ok) return actor.response;
  const input = await parseJsonRequest(request, updatePacketRequestSchema);
  if (!input.ok) return input.response;
  const mismatch = roomAndEntityMismatch(
    input.value,
    pathRoomId,
    pathPacketId,
    "packetId",
  );
  if (mismatch) return mismatch;

  try {
    const result = await dependencies.service.updateDraft(
      actor.actorUserId,
      input.value,
    );
    if (!result.ok) return serviceErrorResponse(result.error);
    return jsonResponse(200, { ok: true, packet: result.value });
  } catch {
    return serviceUnavailable();
  }
}

export async function handleApprovePacketRequest(
  request: Request,
  pathRoomId: string,
  pathPacketId: string,
  dependencies: PacketRouteDependencies,
): Promise<Response> {
  const actor = await authenticate(request, dependencies);
  if (!actor.ok) return actor.response;
  const input = await parseJsonRequest(request, approvePacketRequestSchema);
  if (!input.ok) return input.response;
  const mismatch = roomAndEntityMismatch(
    input.value,
    pathRoomId,
    pathPacketId,
    "packetId",
  );
  if (mismatch) return mismatch;

  try {
    const result = await dependencies.service.approve(
      actor.actorUserId,
      input.value,
    );
    if (!result.ok) return serviceErrorResponse(result.error);
    return jsonResponse(200, { ok: true, packet: result.value });
  } catch {
    return serviceUnavailable();
  }
}

export async function handleStagePacketSendRequest(
  request: Request,
  pathRoomId: string,
  pathPacketId: string,
  dependencies: PacketRouteDependencies,
): Promise<Response> {
  const actor = await authenticate(request, dependencies);
  if (!actor.ok) return actor.response;
  const input = await parseJsonRequest(request, stagePacketSendRequestSchema);
  if (!input.ok) return input.response;
  const mismatch = roomAndEntityMismatch(
    input.value,
    pathRoomId,
    pathPacketId,
    "packetId",
  );
  if (mismatch) return mismatch;

  try {
    const result = await dependencies.service.stageSend(
      actor.actorUserId,
      input.value,
    );
    if (!result.ok) return serviceErrorResponse(result.error);
    return jsonResponse(200, { ok: true, send: result.value });
  } catch {
    return serviceUnavailable();
  }
}

export async function handleExecutePacketSendRequest(
  request: Request,
  pathRoomId: string,
  pathSendRequestId: string,
  dependencies: PacketRouteDependencies,
): Promise<Response> {
  const actor = await authenticate(request, dependencies);
  if (!actor.ok) return actor.response;
  const raw = await parseRawJsonRequest(request);
  if (!raw.ok) return raw.response;
  if (
    !raw.value ||
    typeof raw.value !== "object" ||
    Array.isArray(raw.value) ||
    (raw.value as { explicitHostAuthorization?: unknown })
      .explicitHostAuthorization !== true
  )
    return errorResponse(400, {
      code: "explicit_host_authorization_required",
      message: "Click SEND to authorize this external action.",
    });

  const input = executePacketSendRequestSchema.safeParse(raw.value);
  if (!input.success) return invalidRequest();
  const mismatch = roomAndEntityMismatch(
    input.data,
    pathRoomId,
    pathSendRequestId,
    "sendRequestId",
  );
  if (mismatch) return mismatch;

  try {
    const result = await dependencies.service.executeSend(
      actor.actorUserId,
      input.data,
      request.signal,
    );
    if (!result.ok) return serviceErrorResponse(result.error);
    return jsonResponse(200, { ok: true, send: result.value });
  } catch {
    return serviceUnavailable();
  }
}

export async function handleCancelPacketSendRequest(
  request: Request,
  pathRoomId: string,
  pathSendRequestId: string,
  dependencies: PacketRouteDependencies,
): Promise<Response> {
  const actor = await authenticate(request, dependencies);
  if (!actor.ok) return actor.response;
  const raw = await parseRawJsonRequest(request);
  if (!raw.ok) return raw.response;
  if (
    !raw.value ||
    typeof raw.value !== "object" ||
    Array.isArray(raw.value) ||
    (raw.value as { explicitHostCancellation?: unknown })
      .explicitHostCancellation !== true
  )
    return errorResponse(400, {
      code: "explicit_host_cancellation_required",
      message: "Click Cancel to cancel this staged send.",
    });

  const input = cancelPacketSendRequestSchema.safeParse(raw.value);
  if (!input.success) return invalidRequest();
  const mismatch = roomAndEntityMismatch(
    input.data,
    pathRoomId,
    pathSendRequestId,
    "sendRequestId",
  );
  if (mismatch) return mismatch;

  try {
    const result = await dependencies.service.cancelSend(
      actor.actorUserId,
      input.data,
    );
    if (!result.ok) return serviceErrorResponse(result.error);
    return jsonResponse(200, { ok: true, send: result.value });
  } catch {
    return serviceUnavailable();
  }
}

export function packetServiceUnavailableResponse() {
  return serviceUnavailable();
}

async function authenticate(
  request: Request,
  dependencies: PacketRouteDependencies,
): Promise<
  | { ok: true; actorUserId: string }
  | { ok: false; response: Response }
> {
  const result = await authenticateRequestActor(
    request.headers.get("authorization"),
    dependencies.verifier,
  );
  if (result.ok) return result;
  return { ok: false, response: errorResponse(401, result.error) };
}

async function parseJsonRequest<S extends z.ZodType>(
  request: Request,
  schema: S,
): Promise<ParsedRequest<z.infer<S>>> {
  const raw = await parseRawJsonRequest(request);
  if (!raw.ok) return raw;
  const parsed = schema.safeParse(raw.value);
  if (!parsed.success) return { ok: false, response: invalidRequest() };
  return { ok: true, value: parsed.data };
}

async function parseRawJsonRequest(
  request: Request,
): Promise<ParsedRequest<unknown>> {
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
    if (Number.isSafeInteger(bytes) && bytes > PACKET_REQUEST_MAX_BYTES)
      return { ok: false, response: requestTooLarge() };
  }

  const bytes = await readBoundedBody(request, PACKET_REQUEST_MAX_BYTES);
  if (!bytes.ok) return bytes;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes.value);
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, response: invalidRequest() };
  }
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

function roomAndEntityMismatch(
  input: { roomId: string; packetId?: string; sendRequestId?: string },
  pathRoomId: string,
  pathEntityId?: string,
  entityKey?: "packetId" | "sendRequestId",
) {
  if (input.roomId !== pathRoomId)
    return errorResponse(400, {
      code: "room_mismatch",
      message: "Room ID does not match the request path.",
    });
  if (
    pathEntityId !== undefined &&
    entityKey !== undefined &&
    input[entityKey] !== pathEntityId
  )
    return errorResponse(400, {
      code: `${entityKey === "packetId" ? "packet" : "send_request"}_mismatch`,
      message:
        entityKey === "packetId"
          ? "Packet ID does not match the request path."
          : "Send request ID does not match the request path.",
    });
  return null;
}

function serviceErrorResponse(error: PacketServiceError) {
  switch (error.code) {
    case "invalid_request":
      return errorResponse(400, error);
    case "host_required":
      return errorResponse(403, error);
    case "room_unavailable":
    case "packet_not_found":
      return errorResponse(404, error);
    case "content_required":
    case "recipient_required":
    case "approval_required":
    case "send_request_unavailable":
    case "packet_conflict":
      return errorResponse(409, error);
    case "email_submission_failed":
      return errorResponse(502, error);
    case "email_rate_limited":
      return errorResponse(429, error, { "retry-after": "3600" });
    case "email_recording_failed":
    case "packet_unavailable":
      return errorResponse(503, error);
  }
}

function isApplicationJson(contentType: string | null) {
  return contentType?.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}

function invalidRequest() {
  return errorResponse(400, {
    code: "invalid_request",
    message: "Meeting packet request is invalid.",
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
    message: "Meeting packet service is unavailable.",
  });
}

function errorResponse(
  status: number,
  error: { code: string; message: string },
  headers: Readonly<Record<string, string>> = {},
) {
  return jsonResponse(status, { ok: false, error }, headers);
}

function jsonResponse(
  status: number,
  body: unknown,
  extraHeaders: Readonly<Record<string, string>> = {},
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "cache-control": "no-store",
      "content-type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
  });
}
