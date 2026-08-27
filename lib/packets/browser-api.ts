import { z } from "zod";

import {
  approvePacketRequestSchema,
  cancelPacketSendRequestSchema,
  executePacketSendRequestSchema,
  packetContentSnapshotSchema,
  packetRecipientsSchema,
  packetTitleSchema,
  preparePacketRequestSchema,
  stagePacketSendRequestSchema,
  updatePacketRequestSchema,
  type ApprovePacketRequest,
  type CancelPacketSendRequest,
  type ExecutePacketSendRequest,
  type PreparePacketRequest,
  type StagePacketSendRequest,
  type UpdatePacketRequest,
} from "@/lib/packets/contracts";

const JWT_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const MAX_RESPONSE_CHARS = 1_000_000;
const packetIdSchema = z
  .string()
  .min(2)
  .max(96)
  .regex(/^[a-z][a-z0-9-]*$/);
const countSchema = z.number().int().nonnegative().max(50);
const hashSchema = z.string().regex(/^[0-9a-f]{64}$/);
const packetActivityActionSchema = z.enum([
  "packet_prepared",
  "packet_draft_updated",
  "packet_approved",
  "packet_send_staged",
  "packet_send_cancelled",
  "packet_send_previewed",
  "packet_send_authorized",
  "packet_send_expired",
  "packet_send_submitted",
  "packet_send_failed",
]);

const preparedPacketSchema = z
  .object({
    packetId: packetIdSchema,
    packetVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    sourceRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    status: z.literal("draft"),
    title: packetTitleSchema,
    objectCount: countSchema.min(1),
    contentSnapshot: packetContentSnapshotSchema,
  })
  .strict();
const updatedPacketSchema = z
  .object({
    packetId: packetIdSchema,
    status: z.enum(["draft", "approved"]),
    recipientCount: countSchema.max(10),
    changed: z.boolean(),
  })
  .strict();
const approvedPacketSchema = z
  .object({
    packetId: packetIdSchema,
    packetVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    status: z.literal("approved"),
    contentHash: hashSchema,
    recipientHash: hashSchema,
    recipientCount: countSchema.min(1).max(10),
    contentSnapshot: packetContentSnapshotSchema,
    recipientSnapshot: packetRecipientsSchema.min(1),
    changed: z.boolean(),
  })
  .strict()
  .refine((value) => value.recipientSnapshot.length === value.recipientCount);
const stagedSendSchema = z
  .object({
    sendRequestId: z.uuid(),
    packetId: packetIdSchema,
    status: z.literal("awaiting_human_approval"),
    packetVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    contentHash: hashSchema,
    recipientHash: hashSchema,
    recipientSnapshot: packetRecipientsSchema.min(1),
    recipientCount: countSchema.min(1).max(10),
    staged: z.literal(true),
    changed: z.boolean(),
  })
  .strict()
  .refine((value) => value.recipientSnapshot.length === value.recipientCount);
const cancelledSendSchema = z
  .object({
    sendRequestId: z.uuid(),
    packetId: packetIdSchema,
    status: z.literal("cancelled"),
    receiptId: z.uuid(),
    changed: z.boolean(),
  })
  .strict();
const previewSendSchema = z
  .object({
    mode: z.literal("preview_only"),
    status: z.literal("preview_only"),
    sendRequestId: z.uuid(),
    outboundShareId: z.uuid(),
    reason: z.enum(["resend_unconfigured", "recipient_not_allowed"]),
    message: z.literal("Preview only: no email was sent."),
    preview: z
      .object({
        subject: packetTitleSchema,
        recipients: packetRecipientsSchema.min(1),
        contentSnapshot: packetContentSnapshotSchema,
      })
      .strict(),
  })
  .strict();
const submittedSendSchema = z
  .object({
    mode: z.literal("resend"),
    status: z.literal("submitted"),
    sendRequestId: z.uuid(),
    outboundShareId: z.uuid(),
    providerMessageId: z.string().trim().min(1).max(240).nullable(),
    recipientCount: countSchema.min(1).max(10),
    subject: packetTitleSchema,
    message: z.enum([
      "Submitted to Resend; delivery is pending.",
      "This packet was already submitted to Resend.",
    ]),
  })
  .strict();
const executedSendSchema = z.discriminatedUnion("mode", [
  previewSendSchema,
  submittedSendSchema,
]);
const persistedPacketBase = {
  packetId: packetIdSchema,
  packetVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  sourceRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  title: packetTitleSchema,
  contentSnapshot: packetContentSnapshotSchema,
  recipients: packetRecipientsSchema,
};
const persistedDraftPacketSchema = z
  .object({ ...persistedPacketBase, status: z.literal("draft") })
  .strict();
const persistedApprovedPacketSchema = z
  .object({
    ...persistedPacketBase,
    status: z.literal("approved"),
    recipients: packetRecipientsSchema.min(1),
    approvedSnapshot: z
      .object({
        packetVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
        contentHash: hashSchema,
        recipientHash: hashSchema,
        contentSnapshot: packetContentSnapshotSchema,
        recipients: packetRecipientsSchema.min(1),
      })
      .strict(),
  })
  .strict();
const persistedPacketSchema = z.discriminatedUnion("status", [
  persistedDraftPacketSchema,
  persistedApprovedPacketSchema,
]);
const persistedPacketSendSchema = z
  .object({
    sendRequestId: z.uuid(),
    packetId: packetIdSchema,
    packetVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    contentHash: hashSchema,
    recipientHash: hashSchema,
    recipients: packetRecipientsSchema.min(1),
    status: z.enum([
      "awaiting_human_approval",
      "sending",
      "sent",
      "cancelled",
      "failed",
      "preview_only",
      "expired",
    ]),
  })
  .strict();
const packetActivitySchema = z
  .object({
    receiptId: z.uuid(),
    revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    occurredAt: z.iso.datetime({ offset: true }),
    actorType: z.enum(["human", "agent", "system"]),
    actorDisplayName: z.string().trim().min(1).max(80),
    action: packetActivityActionSchema,
    packetId: packetIdSchema,
    sendRequestId: z.uuid().nullable(),
    description: z.string().trim().min(1).max(280),
  })
  .strict();
const persistedPacketWorkflowSchema = z
  .object({
    packet: persistedPacketSchema.nullable(),
    latestSend: persistedPacketSendSchema.nullable(),
    activity: z.array(packetActivitySchema).max(12),
  })
  .strict()
  .refine(
    (value) =>
      value.latestSend === null ||
      (value.packet !== null &&
        value.latestSend.packetId === value.packet.packetId),
  );

const errorResponseSchema = z
  .object({
    ok: z.literal(false),
    error: z
      .object({
        code: z.string().trim().min(1).max(100),
        message: z.string().trim().min(1).max(280),
      })
      .strict(),
  })
  .strict();

export type BrowserPacketApiResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      error: { code: string; message: string; status?: number };
    };

export type BrowserPreparedPacket = z.infer<typeof preparedPacketSchema>;
export type BrowserUpdatedPacket = z.infer<typeof updatedPacketSchema>;
export type BrowserApprovedPacket = z.infer<typeof approvedPacketSchema>;
export type BrowserStagedPacketSend = z.infer<typeof stagedSendSchema>;
export type BrowserCancelledPacketSend = z.infer<typeof cancelledSendSchema>;
export type BrowserExecutedPacketSend = z.infer<typeof executedSendSchema>;
export type BrowserPersistedPacketWorkflow = z.infer<
  typeof persistedPacketWorkflowSchema
>;
export type BrowserPacketActivity = z.infer<typeof packetActivitySchema>;

export interface BrowserPacketApi {
  loadLatest: (
    roomId: string,
    signal?: AbortSignal,
  ) => Promise<BrowserPacketApiResult<BrowserPersistedPacketWorkflow>>;
  prepare: (
    input: PreparePacketRequest,
    signal?: AbortSignal,
  ) => Promise<BrowserPacketApiResult<BrowserPreparedPacket>>;
  update: (
    input: UpdatePacketRequest,
    signal?: AbortSignal,
  ) => Promise<BrowserPacketApiResult<BrowserUpdatedPacket>>;
  approve: (
    input: ApprovePacketRequest,
    signal?: AbortSignal,
  ) => Promise<BrowserPacketApiResult<BrowserApprovedPacket>>;
  stageSend: (
    input: StagePacketSendRequest,
    signal?: AbortSignal,
  ) => Promise<BrowserPacketApiResult<BrowserStagedPacketSend>>;
  cancelSend: (
    input: CancelPacketSendRequest,
    signal?: AbortSignal,
  ) => Promise<BrowserPacketApiResult<BrowserCancelledPacketSend>>;
  executeSend: (
    input: ExecutePacketSendRequest,
    signal?: AbortSignal,
  ) => Promise<BrowserPacketApiResult<BrowserExecutedPacketSend>>;
}

export interface BrowserPacketApiOptions {
  accessToken: string;
  fetcher?: PacketApiFetch;
}

type PacketApiFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export function createBrowserPacketApi({
  accessToken,
  fetcher = fetch,
}: BrowserPacketApiOptions): BrowserPacketApi {
  const tokenValid =
    accessToken.length <= 8_192 && JWT_PATTERN.test(accessToken);

  return {
    loadLatest: (rawRoomId, signal) => {
      const roomId = z.uuid().safeParse(rawRoomId);
      if (!roomId.success) return Promise.resolve(invalidRequest());
      return validateIdentity(
        requestPacket<"workflow", BrowserPersistedPacketWorkflow>(
          tokenValid,
          accessToken,
          fetcher,
          `/api/rooms/${roomId.data}/packets/latest`,
          "GET",
          undefined,
          z
            .object({
              ok: z.literal(true),
              workflow: persistedPacketWorkflowSchema,
            })
            .strict(),
          "workflow",
          signal,
        ),
        (value) =>
          value.packet === null ||
          value.activity.every(
            (receipt) => receipt.packetId === value.packet?.packetId,
          ),
      );
    },
    prepare: (rawInput, signal) => {
      const input = preparePacketRequestSchema.safeParse(rawInput);
      if (!input.success) return Promise.resolve(invalidRequest());
      return validateIdentity(
        requestPacket<"packet", BrowserPreparedPacket>(
          tokenValid,
          accessToken,
          fetcher,
          `/api/rooms/${input.data.roomId}/packets/prepare`,
          "POST",
          input.data,
          z.object({ ok: z.literal(true), packet: preparedPacketSchema }).strict(),
          "packet",
          signal,
        ),
        (value) => value.packetId === input.data.packetId,
      );
    },
    update: (rawInput, signal) => {
      const input = updatePacketRequestSchema.safeParse(rawInput);
      if (!input.success) return Promise.resolve(invalidRequest());
      return validateIdentity(requestPacket<"packet", BrowserUpdatedPacket>(
        tokenValid,
        accessToken,
        fetcher,
        `/api/rooms/${input.data.roomId}/packets/${input.data.packetId}`,
        "PATCH",
        input.data,
        z.object({ ok: z.literal(true), packet: updatedPacketSchema }).strict(),
        "packet",
        signal,
      ), (value) => value.packetId === input.data.packetId);
    },
    approve: (rawInput, signal) => {
      const input = approvePacketRequestSchema.safeParse(rawInput);
      if (!input.success) return Promise.resolve(invalidRequest());
      return validateIdentity(requestPacket<"packet", BrowserApprovedPacket>(
        tokenValid,
        accessToken,
        fetcher,
        `/api/rooms/${input.data.roomId}/packets/${input.data.packetId}/approve`,
        "POST",
        input.data,
        z.object({ ok: z.literal(true), packet: approvedPacketSchema }).strict(),
        "packet",
        signal,
      ), (value) => value.packetId === input.data.packetId);
    },
    stageSend: (rawInput, signal) => {
      const input = stagePacketSendRequestSchema.safeParse(rawInput);
      if (!input.success) return Promise.resolve(invalidRequest());
      return validateIdentity(requestPacket<"send", BrowserStagedPacketSend>(
        tokenValid,
        accessToken,
        fetcher,
        `/api/rooms/${input.data.roomId}/packets/${input.data.packetId}/stage-send`,
        "POST",
        input.data,
        z.object({ ok: z.literal(true), send: stagedSendSchema }).strict(),
        "send",
        signal,
      ), (value) => value.packetId === input.data.packetId);
    },
    cancelSend: (rawInput, signal) => {
      const input = cancelPacketSendRequestSchema.safeParse(rawInput);
      if (!input.success) return Promise.resolve(invalidRequest());
      return validateIdentity(
        requestPacket<"send", BrowserCancelledPacketSend>(
          tokenValid,
          accessToken,
          fetcher,
          `/api/rooms/${input.data.roomId}/packet-send-requests/${input.data.sendRequestId}/cancel`,
          "POST",
          input.data,
          z.object({ ok: z.literal(true), send: cancelledSendSchema }).strict(),
          "send",
          signal,
        ),
        (value) => value.sendRequestId === input.data.sendRequestId,
      );
    },
    executeSend: (rawInput, signal) => {
      const input = executePacketSendRequestSchema.safeParse(rawInput);
      if (!input.success) return Promise.resolve(invalidRequest());
      return validateIdentity(requestPacket<"send", BrowserExecutedPacketSend>(
        tokenValid,
        accessToken,
        fetcher,
        `/api/rooms/${input.data.roomId}/packet-send-requests/${input.data.sendRequestId}/execute`,
        "POST",
        input.data,
        z.object({ ok: z.literal(true), send: executedSendSchema }).strict(),
        "send",
        signal,
      ), (value) => value.sendRequestId === input.data.sendRequestId);
    },
  };
}

async function validateIdentity<T>(
  pending: Promise<BrowserPacketApiResult<T>>,
  predicate: (value: T) => boolean,
): Promise<BrowserPacketApiResult<T>> {
  const result = await pending;
  return result.ok && !predicate(result.value) ? invalidResponse(200) : result;
}

async function requestPacket<
  Key extends "packet" | "send" | "workflow",
  Value,
>(
  tokenValid: boolean,
  accessToken: string,
  fetcher: PacketApiFetch,
  path: string,
  method: "GET" | "POST" | "PATCH",
  body: unknown | undefined,
  successSchema: z.ZodType<{ ok: true } & Record<Key, Value>>,
  key: Key,
  signal?: AbortSignal,
): Promise<BrowserPacketApiResult<Value>> {
  if (!tokenValid)
    return failure(
      "authorization_invalid",
      "A valid session is required.",
    );
  if (signal?.aborted) return cancelled();

  let response: Response;
  try {
    response = await fetcher(
      path,
      method === "GET"
        ? {
            method,
            headers: { authorization: `Bearer ${accessToken}` },
            cache: "no-store",
            signal,
          }
        : {
            method,
            headers: {
              authorization: `Bearer ${accessToken}`,
              "content-type": "application/json",
            },
            cache: "no-store",
            body: JSON.stringify(body),
            signal,
          },
    );
  } catch (error) {
    if (signal?.aborted || isAbortError(error)) return cancelled();
    return failure(
      "service_unavailable",
      "Meeting packet service is temporarily unavailable.",
    );
  }

  const status = response.status;
  if (!isApplicationJson(response.headers.get("content-type")))
    return invalidResponse(status);
  let parsedBody: unknown;
  try {
    const text = await response.text();
    if (!text || text.length > MAX_RESPONSE_CHARS) return invalidResponse(status);
    parsedBody = JSON.parse(text);
  } catch {
    return invalidResponse(status);
  }

  if (!response.ok) {
    const parsedError = errorResponseSchema.safeParse(parsedBody);
    return parsedError.success
      ? {
          ok: false,
          error: { ...parsedError.data.error, status },
        }
      : invalidResponse(status);
  }
  const parsedSuccess = successSchema.safeParse(parsedBody);
  return parsedSuccess.success
    ? { ok: true, value: parsedSuccess.data[key] }
    : invalidResponse(status);
}

function invalidRequest(): BrowserPacketApiResult<never> {
  return failure("invalid_request", "Meeting packet request is invalid.");
}

function cancelled(): BrowserPacketApiResult<never> {
  return failure("request_cancelled", "Meeting packet request was cancelled.");
}

function invalidResponse(status?: number): BrowserPacketApiResult<never> {
  return {
    ok: false,
    error: {
      code: "invalid_response",
      message: "Meeting packet service returned an invalid response.",
      ...(status === undefined ? {} : { status }),
    },
  };
}

function failure(
  code: string,
  message: string,
): BrowserPacketApiResult<never> {
  return { ok: false, error: { code, message } };
}

function isApplicationJson(contentType: string | null) {
  return contentType?.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}

function isAbortError(error: unknown) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "name" in error &&
      error.name === "AbortError",
  );
}
