import "server-only";

import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  approvePacketRequestSchema,
  cancelPacketSendRequestSchema,
  executePacketSendRequestSchema,
  packetContentSchema,
  packetRecipientsSchema,
  packetContentSnapshotSchema,
  packetTitleSchema,
  preparePacketRequestSchema,
  stagePacketSendRequestSchema,
  updatePacketRequestSchema,
  type ApprovePacketRequest,
  type CancelPacketSendRequest,
  type ExecutePacketSendRequest,
  type PacketContentSnapshot,
  type PacketRecipient,
  type PreparePacketRequest,
  type StagePacketSendRequest,
  type UpdatePacketRequest,
} from "@/lib/packets/contracts";
import {
  submitResendPacketEmail,
  type ResendPacketEmailInput,
  type ResendPacketEmailResult,
} from "@/lib/packets/resend";

export interface PacketServiceQueryResult {
  data: unknown;
  error: unknown;
}

export interface PacketServiceQueryBuilder
  extends PromiseLike<PacketServiceQueryResult> {
  select: (columns: string) => PacketServiceQueryBuilder;
  eq: (column: string, value: unknown) => PacketServiceQueryBuilder;
  order: (
    column: string,
    options: { ascending: boolean },
  ) => PacketServiceQueryBuilder;
  limit: (count: number) => PacketServiceQueryBuilder;
  maybeSingle: () => PromiseLike<PacketServiceQueryResult>;
}

export interface PacketServiceClient {
  from: (table: string) => PacketServiceQueryBuilder;
  rpc: (
    functionName: string,
    args: Record<string, unknown>,
  ) => PromiseLike<PacketServiceQueryResult>;
}

type PacketEnvironment = Readonly<Record<string, string | undefined>>;

export interface PacketServiceDependencies {
  createUuid?: () => string;
  environment?: PacketEnvironment;
  submitResendEmail?: (
    input: ResendPacketEmailInput,
  ) => Promise<ResendPacketEmailResult>;
}

export type PacketServiceErrorCode =
  | "invalid_request"
  | "host_required"
  | "room_unavailable"
  | "packet_not_found"
  | "content_required"
  | "recipient_required"
  | "approval_required"
  | "send_request_unavailable"
  | "packet_conflict"
  | "packet_unavailable"
  | "email_submission_failed"
  | "email_recording_failed"
  | "email_rate_limited";

export interface PacketServiceError {
  code: PacketServiceErrorCode;
  message: string;
}

type PacketServiceFailure = { ok: false; error: PacketServiceError };

export type PacketServiceResult<T> =
  | { ok: true; value: T }
  | PacketServiceFailure;

export interface PreparedPacketValue {
  packetId: string;
  packetVersion: number;
  sourceRevision: number;
  status: "draft";
  title: string;
  objectCount: number;
  contentSnapshot: PacketContentSnapshot;
}

export interface UpdatedPacketValue {
  packetId: string;
  status: "draft" | "approved";
  recipientCount: number;
  changed: boolean;
}

export interface ApprovedPacketValue {
  packetId: string;
  packetVersion: number;
  status: "approved";
  contentHash: string;
  recipientHash: string;
  recipientCount: number;
  contentSnapshot: PacketContentSnapshot;
  recipientSnapshot: PacketRecipient[];
  changed: boolean;
}

export interface StagedPacketSendValue {
  sendRequestId: string;
  packetId: string;
  status: "awaiting_human_approval";
  packetVersion: number;
  contentHash: string;
  recipientHash: string;
  recipientSnapshot: PacketRecipient[];
  recipientCount: number;
  staged: true;
  changed: boolean;
}

export interface CancelledPacketSendValue {
  sendRequestId: string;
  packetId: string;
  status: "cancelled";
  receiptId: string;
  changed: boolean;
}

export interface PreviewOnlyPacketSendValue {
  mode: "preview_only";
  status: "preview_only";
  sendRequestId: string;
  outboundShareId: string;
  reason:
    | "resend_unconfigured"
    | "recipient_not_allowed"
    | "demo_room_preview_only";
  message: "Preview only: no email was sent.";
  preview: {
    subject: string;
    recipients: PacketRecipient[];
    contentSnapshot: PacketContentSnapshot;
  };
}

export interface SubmittedPacketSendValue {
  mode: "resend";
  status: "submitted";
  sendRequestId: string;
  outboundShareId: string;
  providerMessageId: string | null;
  recipientCount: number;
  subject: string;
  message:
    | "Submitted to Resend; delivery is pending."
    | "This packet was already submitted to Resend.";
}

export interface ReconcilingPacketSendValue {
  mode: "resend";
  status: "reconciling";
  sendRequestId: string;
  outboundShareId: string;
  providerMessageId: string | null;
  recipientCount: number;
  subject: string;
  message: "Submission is being reconciled; delivery is not confirmed.";
}

export type ExecutedPacketSendValue =
  | PreviewOnlyPacketSendValue
  | SubmittedPacketSendValue
  | ReconcilingPacketSendValue;

export const packetActivityActionSchema = z.enum([
  "packet_prepared",
  "packet_draft_updated",
  "packet_approved",
  "packet_send_staged",
  "packet_send_cancelled",
  "packet_send_previewed",
  "packet_send_authorized",
  "packet_send_expired",
  "packet_send_submitted",
  "packet_send_reconciling",
  "packet_send_failed",
  "packet_email_delivered",
  "packet_email_bounced",
  "packet_email_complained",
  "packet_email_failed",
  "packet_email_suppressed",
]);

export interface PacketActivityValue {
  receiptId: string;
  revision: number;
  occurredAt: string;
  actorType: "human" | "agent" | "system";
  actorDisplayName: string;
  action: z.infer<typeof packetActivityActionSchema>;
  packetId: string;
  sendRequestId: string | null;
  description: string;
}

export interface PersistedPacketValue {
  packetId: string;
  packetVersion: number;
  sourceRevision: number;
  status: "draft" | "approved";
  title: string;
  contentSnapshot: PacketContentSnapshot;
  recipients: PacketRecipient[];
  approvedSnapshot?: {
    packetVersion: number;
    contentHash: string;
    recipientHash: string;
    contentSnapshot: PacketContentSnapshot;
    recipients: PacketRecipient[];
  };
}

export interface PersistedPacketSendValue {
  sendRequestId: string;
  packetId: string;
  packetVersion: number;
  contentHash: string;
  recipientHash: string;
  recipients: PacketRecipient[];
  status:
    | "awaiting_human_approval"
    | "sending"
    | "reconciling"
    | "submitted"
    | "cancelled"
    | "failed"
    | "preview_only"
    | "expired";
  providerMessageId: string | null;
  deliveryStatus:
    | "pending"
    | "reconciling"
    | "submitted"
    | "delivered"
    | "bounced"
    | "complained"
    | "failed"
    | "suppressed"
    | "preview_only"
    | null;
}

export interface PersistedPacketWorkflowValue {
  packet: PersistedPacketValue | null;
  latestSend: PersistedPacketSendValue | null;
  activity: PacketActivityValue[];
}

export interface CommandCanvasPacketService {
  loadLatest: (
    actorUserId: string,
    roomId: string,
  ) => Promise<PacketServiceResult<PersistedPacketWorkflowValue>>;
  prepareDraft: (
    actorUserId: string,
    input: PreparePacketRequest,
  ) => Promise<PacketServiceResult<PreparedPacketValue>>;
  updateDraft: (
    actorUserId: string,
    input: UpdatePacketRequest,
  ) => Promise<PacketServiceResult<UpdatedPacketValue>>;
  approve: (
    actorUserId: string,
    input: ApprovePacketRequest,
  ) => Promise<PacketServiceResult<ApprovedPacketValue>>;
  stageSend: (
    actorUserId: string,
    input: StagePacketSendRequest,
  ) => Promise<PacketServiceResult<StagedPacketSendValue>>;
  cancelSend: (
    actorUserId: string,
    input: CancelPacketSendRequest,
  ) => Promise<PacketServiceResult<CancelledPacketSendValue>>;
  executeSend: (
    actorUserId: string,
    input: ExecutePacketSendRequest,
    signal?: AbortSignal,
  ) => Promise<PacketServiceResult<ExecutedPacketSendValue>>;
}

const uuidSchema = z.uuid();
const packetIdSchema = z
  .string()
  .min(2)
  .max(96)
  .regex(/^[a-z][a-z0-9-]*$/);
const revisionSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const hashSchema = z.string().regex(/^[0-9a-f]{64}$/);
const idempotencyKeySchema = z.string().min(16).max(180);
const nonEmptyRecipientsSchema = packetRecipientsSchema.refine(
  (value) => value.length >= 1,
);

const preparedPacketRpcSchema = z
  .object({
    packetId: packetIdSchema,
    packetVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    sourceRevision: revisionSchema,
    status: z.literal("draft"),
    title: z.string().trim().min(1).max(160),
    objectCount: z.number().int().positive().max(50),
    contentSnapshot: packetContentSnapshotSchema,
  })
  .strict();
const updatedPacketRpcSchema = z
  .object({
    packetId: packetIdSchema,
    status: z.enum(["draft", "approved"]),
    recipientCount: z.number().int().nonnegative().max(10),
    changed: z.boolean(),
  })
  .strict();
const approvedPacketRpcSchema = z
  .object({
    packetId: packetIdSchema,
    packetVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    status: z.literal("approved"),
    contentHash: hashSchema,
    recipientHash: hashSchema,
    recipientCount: z.number().int().positive().max(10),
    contentSnapshot: packetContentSnapshotSchema,
    recipientSnapshot: nonEmptyRecipientsSchema,
    changed: z.boolean(),
  })
  .strict()
  .refine((value) => value.recipientSnapshot.length === value.recipientCount);
const stagedPacketSendRpcSchema = z
  .object({
    sendRequestId: z.uuid(),
    packetId: packetIdSchema,
    status: z.literal("awaiting_human_approval"),
    idempotencyKey: idempotencyKeySchema,
    packetVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    contentHash: hashSchema,
    recipientHash: hashSchema,
    recipientSnapshot: nonEmptyRecipientsSchema,
    recipientCount: z.number().int().positive().max(10),
    staged: z.literal(true),
    changed: z.boolean(),
  })
  .strict()
  .refine((value) => value.recipientSnapshot.length === value.recipientCount);
const cancelledPacketSendRpcSchema = z
  .object({
    sendRequestId: z.uuid(),
    packetId: packetIdSchema,
    status: z.literal("cancelled"),
    receiptId: z.uuid(),
    changed: z.boolean(),
  })
  .strict();
const stagedSendRowSchema = z
  .object({
    status: z.enum([
      "awaiting_human_approval",
      "sending",
      "reconciling",
      "submitted",
      "failed",
      "preview_only",
      "expired",
    ]),
    recipient_snapshot: nonEmptyRecipientsSchema,
  })
  .strict();
const authorizedSendSchema = z
  .object({
    sendRequestId: z.uuid(),
    outboundShareId: z.uuid(),
    provider: z.enum(["preview", "resend"]),
    status: z.enum([
      "preview_only",
      "sending",
      "reconciling",
      "submitted",
      "failed",
    ]),
    subject: packetTitleSchema,
    contentSnapshot: packetContentSnapshotSchema,
    recipientSnapshot: nonEmptyRecipientsSchema,
    idempotencyKey: idempotencyKeySchema,
    providerMessageId: z.string().trim().min(1).max(240).nullable(),
    changed: z.boolean(),
  })
  .strict();
const authorizationRefusalSchema = z
  .object({
    ok: z.literal(false),
    code: z.string().min(1).max(120),
    sendRequestId: z.uuid(),
    status: z.literal("expired"),
    changed: z.boolean(),
  })
  .strict();
const resendAdmissionSchema = z.discriminatedUnion("allowed", [
  z
    .object({
      allowed: z.literal(true),
      reason: z.literal("admitted"),
      changed: z.boolean(),
    })
    .strict(),
  z
    .object({
      allowed: z.literal(false),
      reason: z.enum([
        "demo_room_preview_only",
        "packet_resend_rate_limited",
      ]),
      changed: z.literal(false),
    })
    .strict(),
]);
const completedSendSchema = z
  .object({
    sendRequestId: z.uuid(),
    outboundShareId: z.uuid(),
    status: z.enum(["reconciling", "submitted", "failed"]),
    provider: z.literal("resend"),
    providerMessageId: z.string().trim().min(1).max(240).nullable(),
    changed: z.boolean(),
  })
  .strict();

const hostMembershipRowSchema = z.object({ role: z.literal("host") }).strict();
const persistedPacketRowSchema = z
  .object({
    id: packetIdSchema,
    packet_version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    source_revision: revisionSchema,
    status: z.enum(["draft", "approved"]),
    title: packetTitleSchema,
    content: packetContentSchema,
    recipient_draft: packetRecipientsSchema,
    recipient_snapshot: packetRecipientsSchema.nullable(),
    recipient_snapshot_hash: hashSchema.nullable(),
    approved_content_snapshot: packetContentSnapshotSchema.nullable(),
    approved_content_hash: hashSchema.nullable(),
  })
  .strict();
const persistedSendRowSchema = z
  .object({
    id: z.uuid(),
    packet_id: packetIdSchema,
    packet_version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    packet_content_hash: hashSchema,
    recipient_snapshot_hash: hashSchema,
    recipient_snapshot: nonEmptyRecipientsSchema,
    status: z.enum([
      "awaiting_human_approval",
      "sending",
      "reconciling",
      "submitted",
      "cancelled",
      "failed",
      "preview_only",
      "expired",
    ]),
  })
  .strict();
const persistedOutboundRowSchema = z
  .object({
    provider_message_id: z.string().trim().min(1).max(240).nullable(),
    status: z.enum([
      "pending",
      "reconciling",
      "submitted",
      "delivered",
      "bounced",
      "complained",
      "failed",
      "suppressed",
      "preview_only",
    ]),
  })
  .strict();
const packetActivityRowSchema = z
  .object({
    id: z.uuid(),
    activity_revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    occurred_at: z.iso.datetime({ offset: true }),
    actor_type: z.enum(["human", "agent", "system"]),
    actor_display_name: z.string().trim().min(1).max(80),
    action: packetActivityActionSchema,
    packet_id: packetIdSchema,
    send_request_id: z.uuid().nullable(),
    description: z.string().trim().min(1).max(280),
  })
  .strict();
const packetActivityRowsSchema = z.array(packetActivityRowSchema).max(12);

const defaultDependencies = {
  createUuid: randomUUID,
  environment: process.env as PacketEnvironment,
  submitResendEmail: submitResendPacketEmail,
};

export function createPacketService(
  client: PacketServiceClient,
  providedDependencies: PacketServiceDependencies = {},
): CommandCanvasPacketService {
  const dependencies = {
    ...defaultDependencies,
    ...providedDependencies,
  };

  async function loadLatest(
    actorUserId: string,
    roomId: string,
  ): Promise<PacketServiceResult<PersistedPacketWorkflowValue>> {
    if (
      !uuidSchema.safeParse(actorUserId).success ||
      !uuidSchema.safeParse(roomId).success
    )
      return invalidRequest();

    try {
      const membershipResponse = await client
        .from("room_members")
        .select("role")
        .eq("room_id", roomId)
        .eq("user_id", actorUserId)
        .maybeSingle();
      if (hasError(membershipResponse)) return packetUnavailable();
      if (!hostMembershipRowSchema.safeParse(membershipResponse.data).success)
        return hostRequired();

      const packetResponse = await client
        .from("meeting_packets")
        .select(
          "id,packet_version,source_revision,status,title,content,recipient_draft,recipient_snapshot,recipient_snapshot_hash,approved_content_snapshot,approved_content_hash",
        )
        .eq("room_id", roomId)
        .order("packet_version", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (hasError(packetResponse)) return packetUnavailable();
      const parsedPacket =
        packetResponse.data === null
          ? null
          : persistedPacketRowSchema.safeParse(packetResponse.data);
      if (parsedPacket && !parsedPacket.success) return packetUnavailable();

      let latestSend: PersistedPacketSendValue | null = null;
      if (parsedPacket?.success) {
        const sendResponse = await client
          .from("packet_send_requests")
          .select(
            "id,packet_id,packet_version,packet_content_hash,recipient_snapshot_hash,recipient_snapshot,status",
          )
          .eq("room_id", roomId)
          .eq("packet_id", parsedPacket.data.id)
          .order("requested_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (hasError(sendResponse)) return packetUnavailable();
        if (sendResponse.data !== null) {
          const parsedSend = persistedSendRowSchema.safeParse(sendResponse.data);
          if (
            !parsedSend.success ||
            parsedSend.data.packet_id !== parsedPacket.data.id
          )
            return packetUnavailable();
          const outboundResponse = await client
            .from("outbound_shares")
            .select("provider_message_id,status")
            .eq("room_id", roomId)
            .eq("send_request_id", parsedSend.data.id)
            .maybeSingle();
          if (hasError(outboundResponse)) return packetUnavailable();
          const parsedOutbound =
            outboundResponse.data === null
              ? null
              : persistedOutboundRowSchema.safeParse(outboundResponse.data);
          if (parsedOutbound && !parsedOutbound.success)
            return packetUnavailable();
          latestSend = {
            sendRequestId: parsedSend.data.id,
            packetId: parsedSend.data.packet_id,
            packetVersion: parsedSend.data.packet_version,
            contentHash: parsedSend.data.packet_content_hash,
            recipientHash: parsedSend.data.recipient_snapshot_hash,
            recipients: parsedSend.data.recipient_snapshot,
            status: parsedSend.data.status,
            providerMessageId: parsedOutbound?.success
              ? parsedOutbound.data.provider_message_id
              : null,
            deliveryStatus: parsedOutbound?.success
              ? parsedOutbound.data.status
              : null,
          };
        }
      }

      const activityResponse = parsedPacket?.success
        ? await client
            .from("packet_activity_receipts")
            .select(
              "id,activity_revision,occurred_at,actor_type,actor_display_name,action,packet_id,send_request_id,description",
            )
            .eq("room_id", roomId)
            .eq("packet_id", parsedPacket.data.id)
            .order("activity_revision", { ascending: false })
            .limit(12)
        : { data: [], error: null };
      if (hasError(activityResponse)) return packetUnavailable();
      const parsedActivity = packetActivityRowsSchema.safeParse(
        activityResponse.data,
      );
      if (!parsedActivity.success) return packetUnavailable();

      const packet = parsedPacket?.success
        ? persistedPacketFromRow(parsedPacket.data)
        : null;
      if (parsedPacket?.success && packet === null) return packetUnavailable();

      return {
        ok: true,
        value: {
          packet,
          latestSend,
          activity: parsedActivity.data.map((receipt) => ({
            receiptId: receipt.id,
            revision: receipt.activity_revision,
            occurredAt: receipt.occurred_at,
            actorType: receipt.actor_type,
            actorDisplayName: receipt.actor_display_name,
            action: receipt.action,
            packetId: receipt.packet_id,
            sendRequestId: receipt.send_request_id,
            description: receipt.description,
          })),
        },
      };
    } catch {
      return packetUnavailable();
    }
  }

  async function prepareDraft(
    actorUserId: string,
    rawInput: PreparePacketRequest,
  ): Promise<PacketServiceResult<PreparedPacketValue>> {
    const input = preparePacketRequestSchema.safeParse(rawInput);
    if (!input.success || !uuidSchema.safeParse(actorUserId).success)
      return invalidRequest();

    const response = await callRpc(client, "prepare_meeting_packet_draft", {
      p_room_id: input.data.roomId,
      p_host_user_id: actorUserId,
      p_packet_id: input.data.packetId,
      p_actor_type: input.data.actorType,
      p_title: input.data.title ?? null,
      p_selected_object_ids: input.data.selectedObjectIds ?? null,
    });
    if (!response.ok) return response;
    const parsed = preparedPacketRpcSchema.safeParse(response.data);
    if (!parsed.success || parsed.data.packetId !== input.data.packetId)
      return packetUnavailable();
    return { ok: true, value: parsed.data };
  }

  async function updateDraft(
    actorUserId: string,
    rawInput: UpdatePacketRequest,
  ): Promise<PacketServiceResult<UpdatedPacketValue>> {
    const input = updatePacketRequestSchema.safeParse(rawInput);
    if (!input.success || !uuidSchema.safeParse(actorUserId).success)
      return invalidRequest();

    const response = await callRpc(client, "update_meeting_packet_draft", {
      p_room_id: input.data.roomId,
      p_packet_id: input.data.packetId,
      p_host_user_id: actorUserId,
      p_title: input.data.title,
      p_recipient_draft: input.data.recipients,
    });
    if (!response.ok) return response;
    const parsed = updatedPacketRpcSchema.safeParse(response.data);
    if (!parsed.success || parsed.data.packetId !== input.data.packetId)
      return packetUnavailable();
    return { ok: true, value: parsed.data };
  }

  async function approve(
    actorUserId: string,
    rawInput: ApprovePacketRequest,
  ): Promise<PacketServiceResult<ApprovedPacketValue>> {
    const input = approvePacketRequestSchema.safeParse(rawInput);
    if (!input.success || !uuidSchema.safeParse(actorUserId).success)
      return invalidRequest();

    const response = await callRpc(client, "approve_meeting_packet", {
      p_room_id: input.data.roomId,
      p_packet_id: input.data.packetId,
      p_host_user_id: actorUserId,
    });
    if (!response.ok) return response;
    const parsed = approvedPacketRpcSchema.safeParse(response.data);
    if (!parsed.success || parsed.data.packetId !== input.data.packetId)
      return packetUnavailable();
    return { ok: true, value: parsed.data };
  }

  async function stageSend(
    actorUserId: string,
    rawInput: StagePacketSendRequest,
  ): Promise<PacketServiceResult<StagedPacketSendValue>> {
    const input = stagePacketSendRequestSchema.safeParse(rawInput);
    if (!input.success || !uuidSchema.safeParse(actorUserId).success)
      return invalidRequest();

    let sendRequestId: string;
    try {
      sendRequestId = uuidSchema.parse(dependencies.createUuid());
    } catch {
      return packetUnavailable();
    }

    const response = await callRpc(client, "stage_meeting_packet_send", {
      p_room_id: input.data.roomId,
      p_packet_id: input.data.packetId,
      p_host_user_id: actorUserId,
      p_requested_by_actor_type: input.data.requestedByActorType,
      p_send_request_id: sendRequestId,
    });
    if (!response.ok) return response;
    const parsed = stagedPacketSendRpcSchema.safeParse(response.data);
    if (!parsed.success || parsed.data.packetId !== input.data.packetId)
      return packetUnavailable();

    return {
      ok: true,
      value: {
        sendRequestId: parsed.data.sendRequestId,
        packetId: parsed.data.packetId,
        status: parsed.data.status,
        packetVersion: parsed.data.packetVersion,
        contentHash: parsed.data.contentHash,
        recipientHash: parsed.data.recipientHash,
        recipientSnapshot: parsed.data.recipientSnapshot,
        recipientCount: parsed.data.recipientCount,
        staged: parsed.data.staged,
        changed: parsed.data.changed,
      },
    };
  }

  async function cancelSend(
    actorUserId: string,
    rawInput: CancelPacketSendRequest,
  ): Promise<PacketServiceResult<CancelledPacketSendValue>> {
    const input = cancelPacketSendRequestSchema.safeParse(rawInput);
    if (!input.success || !uuidSchema.safeParse(actorUserId).success)
      return invalidRequest();

    const response = await callRpc(client, "cancel_meeting_packet_send", {
      p_room_id: input.data.roomId,
      p_send_request_id: input.data.sendRequestId,
      p_host_user_id: actorUserId,
    });
    if (!response.ok) return response;
    const parsed = cancelledPacketSendRpcSchema.safeParse(response.data);
    if (
      !parsed.success ||
      parsed.data.sendRequestId !== input.data.sendRequestId
    )
      return packetUnavailable();
    return { ok: true, value: parsed.data };
  }

  async function executeSend(
    actorUserId: string,
    rawInput: ExecutePacketSendRequest,
    signal?: AbortSignal,
  ): Promise<PacketServiceResult<ExecutedPacketSendValue>> {
    const input = executePacketSendRequestSchema.safeParse(rawInput);
    if (!input.success || !uuidSchema.safeParse(actorUserId).success)
      return invalidRequest();

    const staged = await loadStagedSend(client, input.data);
    if (!staged.ok) return staged;
    let decision = decideDelivery(
      dependencies.environment,
      staged.value.recipient_snapshot,
    );

    if (decision.mode === "resend") {
      const admissionResponse = await callRpc(
        client,
        "reserve_packet_resend_admission",
        {
          p_room_id: input.data.roomId,
          p_send_request_id: input.data.sendRequestId,
          p_host_user_id: actorUserId,
        },
      );
      if (!admissionResponse.ok) return admissionResponse;
      const admission = resendAdmissionSchema.safeParse(admissionResponse.data);
      if (!admission.success) return packetUnavailable();
      if (!admission.data.allowed) {
        if (admission.data.reason === "packet_resend_rate_limited")
          return failure(
            "email_rate_limited",
            "Packet email capacity is temporarily unavailable.",
          );
        decision = {
          mode: "preview",
          reason: "demo_room_preview_only",
        };
      }
    }

    const authorization = await callRpc(
      client,
      "authorize_meeting_packet_send",
      {
        p_room_id: input.data.roomId,
        p_send_request_id: input.data.sendRequestId,
        p_host_user_id: actorUserId,
        p_delivery_mode: decision.mode,
        p_outbound_share_id: input.data.sendRequestId,
      },
    );
    if (!authorization.ok) return authorization;

    const refused = authorizationRefusalSchema.safeParse(authorization.data);
    if (refused.success)
      return failure(
        "send_request_unavailable",
        "The staged packet send is no longer available.",
      );
    const authorized = authorizedSendSchema.safeParse(authorization.data);
    if (
      !authorized.success ||
      authorized.data.sendRequestId !== input.data.sendRequestId ||
      authorized.data.outboundShareId !== input.data.sendRequestId ||
      authorized.data.provider !== decision.mode ||
      authorized.data.subject !== authorized.data.contentSnapshot.title
    )
      return packetUnavailable();

    const snapshotMatchesPreflight = sameRecipients(
      staged.value.recipient_snapshot,
      authorized.data.recipientSnapshot,
    );

    if (decision.mode === "preview") {
      if (
        authorized.data.status !== "preview_only" ||
        !snapshotMatchesPreflight
      )
        return packetUnavailable();
      return {
        ok: true,
        value: {
          mode: "preview_only",
          status: "preview_only",
          sendRequestId: authorized.data.sendRequestId,
          outboundShareId: authorized.data.outboundShareId,
          reason: decision.reason,
          message: "Preview only: no email was sent.",
          preview: {
            subject: authorized.data.subject,
            recipients: authorized.data.recipientSnapshot,
            contentSnapshot: authorized.data.contentSnapshot,
          },
        },
      };
    }

    if (
      !snapshotMatchesPreflight ||
      !recipientsAllowed(
        authorized.data.recipientSnapshot,
        decision.allowedRecipients,
      )
    ) {
      await completeSendAttempt(
        client,
        actorUserId,
        input.data,
        "failed",
        null,
        "approved_snapshot_mismatch",
      );
      return packetUnavailable();
    }

    if (authorized.data.status === "submitted")
      return {
        ok: true,
        value: {
          mode: "resend",
          status: "submitted",
          sendRequestId: authorized.data.sendRequestId,
          outboundShareId: authorized.data.outboundShareId,
          providerMessageId: authorized.data.providerMessageId,
          recipientCount: authorized.data.recipientSnapshot.length,
          subject: authorized.data.subject,
          message: "This packet was already submitted to Resend.",
        },
      };
    if (authorized.data.status === "failed")
      return failure(
        "email_submission_failed",
        "Resend did not accept the packet.",
      );
    if (
      authorized.data.status !== "sending" &&
      authorized.data.status !== "reconciling"
    )
      return packetUnavailable();

    const submitted = await dependencies.submitResendEmail({
      apiKey: decision.apiKey,
      from: decision.from,
      recipients: authorized.data.recipientSnapshot,
      subject: authorized.data.subject,
      contentSnapshot: authorized.data.contentSnapshot,
      idempotencyKey: authorized.data.idempotencyKey,
      signal,
    });
    if (!submitted.ok) {
      const outcome =
        submitted.errorCode === "resend_ambiguous" &&
        "reconciling" in submitted &&
        submitted.reconciling
          ? "reconciling"
          : "failed";
      const completed = await completeSendAttempt(
        client,
        actorUserId,
        input.data,
        outcome,
        null,
        submitted.errorCode,
      );
      if (!completed.ok)
        return failure(
          "email_recording_failed",
          "CommandCanvas could not record the email submission result.",
        );
      if (outcome === "reconciling")
        return {
          ok: true,
          value: {
            mode: "resend",
            status: "reconciling",
            sendRequestId: completed.value.sendRequestId,
            outboundShareId: completed.value.outboundShareId,
            providerMessageId: completed.value.providerMessageId,
            recipientCount: authorized.data.recipientSnapshot.length,
            subject: authorized.data.subject,
            message:
              "Submission is being reconciled; delivery is not confirmed.",
          },
        };
      return failure(
        "email_submission_failed",
        "Resend did not accept the packet.",
      );
    }

    const completed = await completeSendAttempt(
      client,
      actorUserId,
      input.data,
      "submitted",
      submitted.providerMessageId,
      null,
    );
    if (!completed.ok) {
      const reconciled = await completeSendAttempt(
        client,
        actorUserId,
        input.data,
        "reconciling",
        submitted.providerMessageId,
        "delivery_recording_failed",
      );
      if (reconciled.ok)
        return {
          ok: true,
          value: {
            mode: "resend",
            status: "reconciling",
            sendRequestId: reconciled.value.sendRequestId,
            outboundShareId: reconciled.value.outboundShareId,
            providerMessageId: reconciled.value.providerMessageId,
            recipientCount: authorized.data.recipientSnapshot.length,
            subject: authorized.data.subject,
            message:
              "Submission is being reconciled; delivery is not confirmed.",
          },
        };
      const recovered = await callRpc(
        client,
        "authorize_meeting_packet_send",
        {
          p_room_id: input.data.roomId,
          p_send_request_id: input.data.sendRequestId,
          p_host_user_id: actorUserId,
          p_delivery_mode: "resend",
          p_outbound_share_id: input.data.sendRequestId,
        },
      );
      const recoveredAuthorization = recovered.ok
        ? authorizedSendSchema.safeParse(recovered.data)
        : null;
      if (
        recoveredAuthorization?.success &&
        recoveredAuthorization.data.sendRequestId === input.data.sendRequestId &&
        recoveredAuthorization.data.outboundShareId === input.data.sendRequestId &&
        recoveredAuthorization.data.provider === "resend" &&
        recoveredAuthorization.data.idempotencyKey ===
          authorized.data.idempotencyKey &&
        recoveredAuthorization.data.subject === authorized.data.subject &&
        sameRecipients(
          recoveredAuthorization.data.recipientSnapshot,
          authorized.data.recipientSnapshot,
        ) &&
        recoveredAuthorization.data.providerMessageId ===
          submitted.providerMessageId
      ) {
        if (recoveredAuthorization.data.status === "submitted")
          return {
            ok: true,
            value: {
              mode: "resend",
              status: "submitted",
              sendRequestId: recoveredAuthorization.data.sendRequestId,
              outboundShareId: recoveredAuthorization.data.outboundShareId,
              providerMessageId:
                recoveredAuthorization.data.providerMessageId,
              recipientCount:
                recoveredAuthorization.data.recipientSnapshot.length,
              subject: recoveredAuthorization.data.subject,
              message: "This packet was already submitted to Resend.",
            },
          };
        if (recoveredAuthorization.data.status === "reconciling")
          return {
            ok: true,
            value: {
              mode: "resend",
              status: "reconciling",
              sendRequestId: recoveredAuthorization.data.sendRequestId,
              outboundShareId: recoveredAuthorization.data.outboundShareId,
              providerMessageId:
                recoveredAuthorization.data.providerMessageId,
              recipientCount:
                recoveredAuthorization.data.recipientSnapshot.length,
              subject: recoveredAuthorization.data.subject,
              message:
                "Submission is being reconciled; delivery is not confirmed.",
            },
          };
      }
      return failure(
        "email_recording_failed",
        "Resend accepted the request, but CommandCanvas could not record the result.",
      );
    }

    return {
      ok: true,
      value: {
        mode: "resend",
        status: "submitted",
        sendRequestId: completed.value.sendRequestId,
        outboundShareId: completed.value.outboundShareId,
        providerMessageId: completed.value.providerMessageId,
        recipientCount: authorized.data.recipientSnapshot.length,
        subject: authorized.data.subject,
        message: "Submitted to Resend; delivery is pending.",
      },
    };
  }

  return {
    loadLatest,
    prepareDraft,
    updateDraft,
    approve,
    stageSend,
    cancelSend,
    executeSend,
  };
}

function persistedPacketFromRow(
  row: z.infer<typeof persistedPacketRowSchema>,
): PersistedPacketValue | null {
  const contentSnapshot: PacketContentSnapshot = {
    title: row.title,
    content: row.content,
  };
  if (row.status === "draft") {
    if (
      row.recipient_snapshot !== null ||
      row.recipient_snapshot_hash !== null ||
      row.approved_content_snapshot !== null ||
      row.approved_content_hash !== null
    )
      return null;
    return {
      packetId: row.id,
      packetVersion: row.packet_version,
      sourceRevision: row.source_revision,
      status: "draft",
      title: row.title,
      contentSnapshot,
      recipients: row.recipient_draft,
    };
  }

  if (
    row.recipient_snapshot === null ||
    row.recipient_snapshot.length === 0 ||
    row.recipient_snapshot_hash === null ||
    row.approved_content_snapshot === null ||
    row.approved_content_hash === null ||
    row.approved_content_snapshot.title !== row.title
  )
    return null;
  return {
    packetId: row.id,
    packetVersion: row.packet_version,
    sourceRevision: row.source_revision,
    status: "approved",
    title: row.title,
    contentSnapshot: row.approved_content_snapshot,
    recipients: row.recipient_snapshot,
    approvedSnapshot: {
      packetVersion: row.packet_version,
      contentHash: row.approved_content_hash,
      recipientHash: row.recipient_snapshot_hash,
      contentSnapshot: row.approved_content_snapshot,
      recipients: row.recipient_snapshot,
    },
  };
}

async function loadStagedSend(
  client: PacketServiceClient,
  input: ExecutePacketSendRequest,
): Promise<PacketServiceResult<z.infer<typeof stagedSendRowSchema>>> {
  try {
    const response = await client
      .from("packet_send_requests")
      .select("status,recipient_snapshot")
      .eq("room_id", input.roomId)
      .eq("id", input.sendRequestId)
      .maybeSingle();
    if (hasError(response) || response.data === null)
      return failure(
        "send_request_unavailable",
        "The staged packet send is no longer available.",
      );
    const parsed = stagedSendRowSchema.safeParse(response.data);
    if (!parsed.success)
      return failure(
        "send_request_unavailable",
        "The staged packet send is no longer available.",
      );
    return { ok: true, value: parsed.data };
  } catch {
    return failure(
      "send_request_unavailable",
      "The staged packet send is no longer available.",
    );
  }
}

async function completeSendAttempt(
  client: PacketServiceClient,
  actorUserId: string,
  input: ExecutePacketSendRequest,
  outcome: "reconciling" | "submitted" | "failed",
  providerMessageId: string | null,
  errorCode: string | null,
): Promise<
  PacketServiceResult<z.infer<typeof completedSendSchema>>
> {
  const response = await callRpc(client, "complete_meeting_packet_send", {
    p_room_id: input.roomId,
    p_send_request_id: input.sendRequestId,
    p_host_user_id: actorUserId,
    p_outcome: outcome,
    p_provider_message_id: providerMessageId,
    p_error_code: errorCode,
  });
  if (!response.ok) return response;
  const completed = completedSendSchema.safeParse(response.data);
  if (
    !completed.success ||
    completed.data.status !== outcome ||
    completed.data.sendRequestId !== input.sendRequestId ||
    completed.data.outboundShareId !== input.sendRequestId ||
    completed.data.providerMessageId !== providerMessageId
  )
    return packetUnavailable();
  return { ok: true, value: completed.data };
}

type DeliveryDecision =
  | {
      mode: "preview";
      reason:
        | "resend_unconfigured"
        | "recipient_not_allowed"
        | "demo_room_preview_only";
    }
  | {
      mode: "resend";
      apiKey: string;
      from: string;
      allowedRecipients: ReadonlySet<string>;
    };

function decideDelivery(
  environment: PacketEnvironment,
  recipients: PacketRecipient[],
): DeliveryDecision {
  const apiKey = environment.RESEND_API_KEY?.trim() ?? "";
  const from = environment.RESEND_FROM?.trim() ?? "";
  const rawAllowlist = environment.COMMANDCANVAS_EMAIL_ALLOWLIST?.trim() ?? "";
  if (
    apiKey === "" ||
    from === "" ||
    rawAllowlist === "" ||
    /[\r\n]/.test(from)
  )
    return { mode: "preview", reason: "resend_unconfigured" };

  const entries = rawAllowlist
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value !== "");
  if (
    entries.length === 0 ||
    entries.some((email) => !z.email().safeParse(email).success)
  )
    return { mode: "preview", reason: "resend_unconfigured" };

  const allowedRecipients = new Set(entries);
  if (!recipientsAllowed(recipients, allowedRecipients))
    return { mode: "preview", reason: "recipient_not_allowed" };
  return { mode: "resend", apiKey, from, allowedRecipients };
}

function recipientsAllowed(
  recipients: PacketRecipient[],
  allowed: ReadonlySet<string>,
) {
  return recipients.every((recipient) => allowed.has(recipient.email));
}

function sameRecipients(left: PacketRecipient[], right: PacketRecipient[]) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function callRpc(
  client: PacketServiceClient,
  functionName: string,
  args: Record<string, unknown>,
): Promise<
  | { ok: true; data: unknown }
  | { ok: false; error: PacketServiceError }
> {
  try {
    const response = await client.rpc(functionName, args);
    if (hasError(response)) return mapPacketRpcError(response.error);
    return { ok: true, data: response.data };
  } catch {
    return packetUnavailable();
  }
}

function mapPacketRpcError(error: unknown): PacketServiceFailure {
  const message = databaseErrorMessage(error);
  if (message.includes("packet_host_required"))
    return failure(
      "host_required",
      "Only the room host can manage meeting packets.",
    );
  if (message.includes("packet_room_not_found"))
    return failure("room_unavailable", "Room is unavailable.");
  if (message.includes("packet_not_found"))
    return failure("packet_not_found", "Meeting packet is unavailable.");
  if (message.includes("packet_content_required"))
    return failure(
      "content_required",
      "Add semantic canvas content before preparing a packet.",
    );
  if (message.includes("packet_recipient_required"))
    return failure(
      "recipient_required",
      "Add at least one recipient before approving the packet.",
    );
  if (message.includes("packet_approval_required"))
    return failure(
      "approval_required",
      "Approve the exact packet and recipient snapshot before requesting a send.",
    );
  if (message.includes("packet_send_new_approval_required"))
    return failure(
      "approval_required",
      "Prepare and approve a new packet version before sending again.",
    );
  if (
    includesAny(message, [
      "packet_send_request_not_found",
      "packet_send_request_expired",
      "packet_send_cancellation_unavailable",
      "packet_send_cancelled",
      "packet_send_stale",
      "packet_changed_after_staging",
      "packet_send_already_authorized",
    ])
  )
    return failure(
      "send_request_unavailable",
      "The staged packet send is no longer available.",
    );
  if (
    includesAny(message, [
      "packet_send_stage_conflict",
      "packet_send_authorization_conflict",
      "packet_send_completion_conflict",
      "packet_approved_snapshot_conflict",
    ])
  )
    return failure(
      "packet_conflict",
      "Meeting packet state changed. Review it and try again.",
    );
  if (
    includesAny(message, [
      "packet_id_invalid",
      "packet_actor_type_invalid",
      "packet_title_invalid",
      "packet_selected_object_invalid",
      "packet_recipient_list_invalid",
      "packet_recipient_shape_invalid",
      "packet_recipient_name_invalid",
      "packet_recipient_email_invalid",
      "packet_recipient_duplicate_email",
      "packet_delivery_mode_invalid",
      "packet_send_outcome_invalid",
      "packet_send_completion_invalid",
    ])
  )
    return invalidRequest();
  return packetUnavailable();
}

function hasError(result: PacketServiceQueryResult) {
  return result.error !== null && result.error !== undefined;
}

function databaseErrorMessage(error: unknown) {
  if (!error || typeof error !== "object" || Array.isArray(error)) return "";
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" ? message : "";
}

function includesAny(value: string, candidates: string[]) {
  return candidates.some((candidate) => value.includes(candidate));
}

function failure<C extends PacketServiceErrorCode>(
  code: C,
  message: string,
): { ok: false; error: { code: C; message: string } } {
  return { ok: false, error: { code, message } };
}

function invalidRequest(): PacketServiceFailure {
  return failure("invalid_request", "Meeting packet request is invalid.");
}

function hostRequired(): PacketServiceFailure {
  return failure(
    "host_required",
    "Only the room host can manage meeting packets.",
  );
}

function packetUnavailable(): PacketServiceFailure {
  return failure(
    "packet_unavailable",
    "Meeting packet service is temporarily unavailable.",
  );
}
