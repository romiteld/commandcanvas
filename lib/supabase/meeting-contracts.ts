import { z } from "zod";

export const normalizedEmailSchema = z
  .string()
  .trim()
  .max(254)
  .email()
  .transform((email) => email.toLowerCase());

const displayNameSchema = z.string().trim().min(1).max(64);
const participantColorSchema = z.string().regex(/^#[0-9a-f]{6}$/i);

export const createMeetingRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    displayName: displayNameSchema,
    color: participantColorSchema,
  })
  .strict();

export const createMeetingInvitationRequestSchema = z
  .object({
    requestId: z.uuid(),
    email: normalizedEmailSchema,
    displayName: displayNameSchema,
    color: participantColorSchema,
    expiresInHours: z.number().int().min(1).max(168),
  })
  .strict();

export const invitationTokenSchema = z
  .string()
  .min(43)
  .max(86)
  .regex(/^[A-Za-z0-9_-]+$/);

export const acceptMeetingInvitationRequestSchema = z
  .object({ token: invitationTokenSchema })
  .strict();

export type CreateMeetingRequest = z.infer<typeof createMeetingRequestSchema>;
export type CreateMeetingInvitationRequest = z.infer<
  typeof createMeetingInvitationRequestSchema
>;
export type CreateMeetingInvitationDraft = Omit<
  CreateMeetingInvitationRequest,
  "requestId"
>;
export type AcceptMeetingInvitationRequest = z.infer<
  typeof acceptMeetingInvitationRequestSchema
>;
