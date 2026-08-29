import {
  createHmac,
  randomBytes as nodeRandomBytes,
  randomUUID,
} from "node:crypto";

import { z } from "zod";

import {
  acceptMeetingInvitationRequestSchema,
  createMeetingInvitationRequestSchema,
  createMeetingRequestSchema,
  type AcceptMeetingInvitationRequest,
  type CreateMeetingInvitationRequest,
  type CreateMeetingRequest,
} from "@/lib/supabase/meeting-contracts";

const uuidSchema = z.uuid();
const roomRpcSchema = z
  .object({
    roomId: z.uuid(),
    slug: z.string().min(12).max(96),
    role: z.literal("host"),
    joined: z.literal(true),
  })
  .strict();
const invitationRpcSchema = z
  .object({
    outcome: z.enum(["created", "existing"]),
    invitationId: z.uuid(),
    roomId: z.uuid(),
    expiresAt: z.iso.datetime({ offset: true }),
    roomName: z.string().trim().min(1).max(120),
    idempotencyKey: z.string().min(16).max(256),
    deliveryStatus: z.enum([
      "created",
      "sending",
      "reconciling",
      "preview_only",
      "submitted",
      "delivered",
      "bounced",
      "complained",
      "failed",
      "suppressed",
    ]),
    providerMessageId: z.string().trim().min(1).max(256).nullable(),
  })
  .strict();
const invitationDeliveryRpcSchema = z
  .object({
    invitationId: z.uuid(),
    deliveryStatus: invitationRpcSchema.shape.deliveryStatus,
    providerMessageId: z.string().trim().min(1).max(256).nullable(),
    changed: z.boolean(),
  })
  .strict();
const acceptanceRpcSchema = z.discriminatedUnion("outcome", [
  z
    .object({
      outcome: z.enum(["joined", "already_joined"]),
      roomId: z.uuid(),
      role: z.literal("participant"),
      joined: z.boolean(),
    })
    .strict(),
  z.object({ outcome: z.literal("unavailable") }).strict(),
]);

export interface MeetingServiceClient {
  rpc: (
    name: string,
    input: Record<string, unknown>,
  ) => Promise<{ data: unknown; error: unknown }>;
}

export interface MeetingServiceDependencies {
  createUuid: () => string;
  randomBytes: (size: number) => Uint8Array;
  now: () => Date;
  inviteTokenSecret?: string;
}

export type InvitationDeliveryStatus = z.infer<
  typeof invitationRpcSchema.shape.deliveryStatus
>;

export type InvitationDeliveryCompletion =
  | { status: "preview_only" }
  | { status: "submitted"; providerId: string }
  | { status: "reconciling"; errorCode: string; providerId?: string }
  | { status: "failed"; errorCode: string };

export type MeetingServiceResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      error: {
        code:
          | "invalid_request"
          | "permanent_email_auth_required"
          | "host_required"
          | "rate_limited"
          | "invitation_conflict"
          | "invitation_unavailable"
          | "service_unavailable";
        message: string;
      };
    };

export interface MeetingService {
  createMeeting: (
    actorUserId: string,
    input: CreateMeetingRequest,
  ) => Promise<MeetingServiceResult<{ roomId: string; role: "host"; joined: true }>>;
  createInvitation: (
    actorUserId: string,
    roomId: string,
    input: CreateMeetingInvitationRequest,
  ) => Promise<
    MeetingServiceResult<{
      invitationId: string;
      roomId: string;
      email: string;
      displayName: string;
      token: string;
      expiresAt: string;
      roomName: string;
      idempotencyKey: string;
      deliveryStatus: InvitationDeliveryStatus;
      providerMessageId: string | null;
      created: boolean;
    }>
  >;
  reserveInvitationDelivery: (
    actorUserId: string,
    roomId: string,
    invitationId: string,
  ) => Promise<
    MeetingServiceResult<{
      invitationId: string;
      deliveryStatus: InvitationDeliveryStatus;
      providerMessageId: string | null;
      changed: boolean;
    }>
  >;
  completeInvitationDelivery: (
    actorUserId: string,
    roomId: string,
    invitationId: string,
    delivery: InvitationDeliveryCompletion,
  ) => Promise<
    MeetingServiceResult<{
      invitationId: string;
      deliveryStatus: InvitationDeliveryStatus;
      providerMessageId: string | null;
      changed: boolean;
    }>
  >;
  acceptInvitation: (
    actorUserId: string,
    input: AcceptMeetingInvitationRequest,
  ) => Promise<
    MeetingServiceResult<{
      roomId: string;
      role: "participant";
      joined: boolean;
    }>
  >;
}

const defaults: MeetingServiceDependencies = {
  createUuid: randomUUID,
  randomBytes: (size) => nodeRandomBytes(size),
  now: () => new Date(),
  inviteTokenSecret: process.env.COMMANDCANVAS_INVITE_TOKEN_SECRET,
};

export function createMeetingService(
  client: MeetingServiceClient,
  dependencies: MeetingServiceDependencies = defaults,
): MeetingService {
  return {
    async createMeeting(actorUserId, rawInput) {
      const input = createMeetingRequestSchema.safeParse(rawInput);
      if (!input.success || !uuidSchema.safeParse(actorUserId).success)
        return invalidRequest();
      try {
        const roomId = exactUuid(dependencies.createUuid());
        const slug = `room-${Buffer.from(exactEntropy(dependencies, 16)).toString("hex")}`;
        const joinToken = Buffer.from(exactEntropy(dependencies, 32)).toString(
          "base64url",
        );
        const response = await client.rpc("create_standard_meeting_with_host", {
          p_room_id: roomId,
          p_slug: slug,
          p_name: input.data.name,
          p_host_user_id: actorUserId,
          p_display_name: input.data.displayName,
          p_color: input.data.color,
          p_join_token: joinToken,
        });
        if (response.error) return providerFailure(response.error);
        const parsed = roomRpcSchema.safeParse(response.data);
        if (!parsed.success || parsed.data.roomId !== roomId)
          return unavailable();
        return {
          ok: true,
          value: { roomId, role: "host", joined: true },
        };
      } catch {
        return unavailable();
      }
    },

    async createInvitation(actorUserId, roomId, rawInput) {
      const input = createMeetingInvitationRequestSchema.safeParse(rawInput);
      if (
        !input.success ||
        !uuidSchema.safeParse(actorUserId).success ||
        !uuidSchema.safeParse(roomId).success
      )
        return invalidRequest();
      try {
        const secret = validInviteSecret(dependencies.inviteTokenSecret);
        const invitationId = exactUuid(dependencies.createUuid());
        const token = createHmac("sha256", secret)
          .update(
            JSON.stringify([
              input.data.requestId,
              roomId,
              actorUserId,
              input.data.email,
              input.data.displayName,
              input.data.color.toUpperCase(),
              input.data.expiresInHours,
            ]),
          )
          .digest("base64url");
        const response = await client.rpc("create_room_email_invitation", {
          p_invitation_id: invitationId,
          p_request_id: input.data.requestId,
          p_room_id: roomId,
          p_actor_user_id: actorUserId,
          p_recipient_email: input.data.email,
          p_display_name: input.data.displayName,
          p_color: input.data.color,
          p_token: token,
          p_expires_in_hours: input.data.expiresInHours,
          p_requested_role: "participant",
        });
        if (response.error) return providerFailure(response.error);
        const parsed = invitationRpcSchema.safeParse(response.data);
        if (
          !parsed.success ||
          parsed.data.roomId !== roomId ||
          (parsed.data.outcome === "created" &&
            parsed.data.invitationId !== invitationId)
        )
          return unavailable();
        return {
          ok: true,
          value: {
            invitationId: parsed.data.invitationId,
            roomId,
            email: input.data.email,
            displayName: input.data.displayName,
            token,
            expiresAt: parsed.data.expiresAt,
            roomName: parsed.data.roomName,
            idempotencyKey: parsed.data.idempotencyKey,
            deliveryStatus: parsed.data.deliveryStatus,
            providerMessageId: parsed.data.providerMessageId,
            created: parsed.data.outcome === "created",
          },
        };
      } catch {
        return unavailable();
      }
    },

    async reserveInvitationDelivery(actorUserId, roomId, invitationId) {
      if (![actorUserId, roomId, invitationId].every((value) =>
        uuidSchema.safeParse(value).success,
      )) return invalidRequest();
      try {
        const response = await client.rpc("reserve_room_invitation_delivery", {
          p_room_id: roomId,
          p_invitation_id: invitationId,
          p_host_user_id: actorUserId,
        });
        if (response.error) return providerFailure(response.error);
        const parsed = invitationDeliveryRpcSchema.safeParse(response.data);
        if (!parsed.success || parsed.data.invitationId !== invitationId)
          return unavailable();
        return { ok: true, value: parsed.data };
      } catch {
        return unavailable();
      }
    },

    async completeInvitationDelivery(
      actorUserId,
      roomId,
      invitationId,
      delivery,
    ) {
      if (
        ![actorUserId, roomId, invitationId].every((value) =>
          uuidSchema.safeParse(value).success,
        ) ||
        !validDeliveryCompletion(delivery)
      ) return invalidRequest();
      try {
        const response = await client.rpc("complete_room_invitation_delivery", {
          p_room_id: roomId,
          p_invitation_id: invitationId,
          p_host_user_id: actorUserId,
          p_outcome: delivery.status,
          p_provider_message_id:
            "providerId" in delivery ? delivery.providerId ?? null : null,
          p_error_code: "errorCode" in delivery ? delivery.errorCode : null,
        });
        if (response.error) return providerFailure(response.error);
        const parsed = invitationDeliveryRpcSchema.safeParse(response.data);
        if (!parsed.success || parsed.data.invitationId !== invitationId)
          return unavailable();
        return { ok: true, value: parsed.data };
      } catch {
        return unavailable();
      }
    },

    async acceptInvitation(actorUserId, rawInput) {
      const input = acceptMeetingInvitationRequestSchema.safeParse(rawInput);
      if (!input.success || !uuidSchema.safeParse(actorUserId).success)
        return invalidRequest();
      try {
        const response = await client.rpc("accept_room_email_invitation", {
          p_actor_user_id: actorUserId,
          p_token: input.data.token,
        });
        if (response.error) return providerFailure(response.error);
        const parsed = acceptanceRpcSchema.safeParse(response.data);
        if (!parsed.success) return unavailable();
        if (parsed.data.outcome === "unavailable")
          return failure(
            "invitation_unavailable",
            "This invitation is invalid, expired, used, or belongs to another email.",
          );
        return {
          ok: true,
          value: {
            roomId: parsed.data.roomId,
            role: "participant",
            joined: parsed.data.joined,
          },
        };
      } catch {
        return unavailable();
      }
    },
  };
}

function exactUuid(value: string) {
  return uuidSchema.parse(value);
}

function exactEntropy(dependencies: MeetingServiceDependencies, size: number) {
  const bytes = dependencies.randomBytes(size);
  if (bytes.byteLength !== size) throw new Error("invalid entropy");
  return bytes;
}

function providerFailure(error: unknown): MeetingServiceResult<never> {
  const message =
    typeof error === "object" && error && "message" in error
      ? String(error.message)
      : "";
  if (message.includes("permanent_email_auth_required"))
    return failure(
      "permanent_email_auth_required",
      "Verify your email before using a meeting room.",
    );
  if (message.includes("meeting_host_required"))
    return failure("host_required", "Only the room host can invite participants.");
  if (message.includes("rate_limit"))
    return failure("rate_limited", "Too many requests. Try again later.");
  if (message.includes("meeting_invitation_unavailable"))
    return failure(
      "invitation_unavailable",
      "This invitation is invalid, expired, used, or belongs to another email.",
    );
  if (message.includes("meeting_invitation_request_conflict"))
    return failure(
      "invitation_conflict",
      "This invitation request ID was already used with different details.",
    );
  return unavailable();
}

function validInviteSecret(raw: string | undefined) {
  const secret = raw?.trim() ?? "";
  if (Buffer.byteLength(secret, "utf8") < 32 || secret.length > 1024)
    throw new Error("invite token secret unavailable");
  return secret;
}

function validDeliveryCompletion(
  value: InvitationDeliveryCompletion,
): value is InvitationDeliveryCompletion {
  const errorCodeSchema = z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[a-z][a-z0-9_]*$/);
  if (value.status === "preview_only") return true;
  if (value.status === "submitted")
    return z.string().trim().min(1).max(256).safeParse(value.providerId).success;
  if (value.status === "reconciling")
    return (
      errorCodeSchema.safeParse(value.errorCode).success &&
      (value.providerId === undefined ||
        z.string().trim().min(1).max(256).safeParse(value.providerId).success)
    );
  return errorCodeSchema.safeParse(value.errorCode).success;
}

function invalidRequest(): MeetingServiceResult<never> {
  return failure("invalid_request", "Request body is invalid.");
}

function unavailable(): MeetingServiceResult<never> {
  return failure("service_unavailable", "Meeting service is unavailable.");
}

function failure(
  code: Extract<MeetingServiceResult<never>, { ok: false }>["error"]["code"],
  message: string,
): MeetingServiceResult<never> {
  return { ok: false, error: { code, message } };
}
