import { randomBytes as nodeRandomBytes, randomUUID } from "node:crypto";

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
    outcome: z.literal("created"),
    invitationId: z.uuid(),
    roomId: z.uuid(),
    expiresAt: z.iso.datetime({ offset: true }),
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
}

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
        const invitationId = exactUuid(dependencies.createUuid());
        const token = Buffer.from(exactEntropy(dependencies, 32)).toString(
          "base64url",
        );
        const expiresAt = new Date(
          dependencies.now().getTime() + input.data.expiresInHours * 3_600_000,
        ).toISOString();
        const response = await client.rpc("create_room_email_invitation", {
          p_invitation_id: invitationId,
          p_room_id: roomId,
          p_actor_user_id: actorUserId,
          p_invited_email: input.data.email,
          p_display_name: input.data.displayName,
          p_color: input.data.color,
          p_token: token,
          p_expires_at: expiresAt,
          p_requested_role: "participant",
        });
        if (response.error) return providerFailure(response.error);
        const parsed = invitationRpcSchema.safeParse(response.data);
        if (
          !parsed.success ||
          parsed.data.invitationId !== invitationId ||
          parsed.data.roomId !== roomId ||
          parsed.data.expiresAt !== expiresAt
        )
          return unavailable();
        return {
          ok: true,
          value: {
            invitationId,
            roomId,
            email: input.data.email,
            displayName: input.data.displayName,
            token,
            expiresAt,
          },
        };
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
  return unavailable();
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
