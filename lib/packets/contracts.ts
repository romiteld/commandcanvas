import { z } from "zod";

const roomIdSchema = z.uuid();
const packetIdSchema = z
  .string()
  .min(2)
  .max(96)
  .regex(/^[a-z][a-z0-9-]*$/);
const noHeaderControls = /^[^\u0000-\u001f\u007f]*$/;

export const packetTitleSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(noHeaderControls);

const recipientNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(noHeaderControls)
  .regex(/^[^<>]*$/);

export const packetRecipientSchema = z
  .object({
    name: recipientNameSchema,
    email: z.string().trim().toLowerCase().email().max(254),
  })
  .strict();

export const packetRecipientsSchema = z
  .array(packetRecipientSchema)
  .max(10)
  .superRefine((value, context) => {
    const seen = new Set<string>();
    for (const [index, recipient] of value.entries()) {
      if (seen.has(recipient.email))
        context.addIssue({
          code: "custom",
          message: "Recipient email addresses must be unique.",
          path: [index, "email"],
        });
      seen.add(recipient.email);
    }
  });

export const packetContentSchema = z
  .object({
    schemaVersion: z.literal(1),
    roomName: z.string().trim().min(1).max(160),
    sourceRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    objects: z
      .array(
        z
          .object({
            objectId: packetIdSchema,
            objectType: z.enum(["note", "task_board", "schedule", "diagram"]),
            title: packetTitleSchema,
            payload: z.record(z.string(), z.unknown()),
          })
          .strict(),
      )
      .min(1)
      .max(50),
  })
  .strict();

export const packetContentSnapshotSchema = z
  .object({
    title: packetTitleSchema,
    content: packetContentSchema,
  })
  .strict();

export const preparePacketRequestSchema = z
  .object({
    roomId: roomIdSchema,
    packetId: packetIdSchema,
    actorType: z.enum(["human", "agent"]),
    title: packetTitleSchema.optional(),
    selectedObjectIds: z
      .array(packetIdSchema)
      .min(1)
      .max(50)
      .refine((value) => new Set(value).size === value.length)
      .optional(),
  })
  .strict();

export const updatePacketRequestSchema = z
  .object({
    roomId: roomIdSchema,
    packetId: packetIdSchema,
    title: packetTitleSchema,
    recipients: packetRecipientsSchema,
  })
  .strict();

export const approvePacketRequestSchema = z
  .object({
    roomId: roomIdSchema,
    packetId: packetIdSchema,
  })
  .strict();

export const stagePacketSendRequestSchema = z
  .object({
    roomId: roomIdSchema,
    packetId: packetIdSchema,
    requestedByActorType: z.enum(["human", "agent"]),
  })
  .strict();

export const executePacketSendRequestSchema = z
  .object({
    roomId: roomIdSchema,
    sendRequestId: z.uuid(),
    explicitHostAuthorization: z.literal(true),
  })
  .strict();

export const cancelPacketSendRequestSchema = z
  .object({
    roomId: roomIdSchema,
    sendRequestId: z.uuid(),
    explicitHostCancellation: z.literal(true),
  })
  .strict();

export type PacketRecipient = z.infer<typeof packetRecipientSchema>;
export type PreparePacketRequest = z.infer<typeof preparePacketRequestSchema>;
export type UpdatePacketRequest = z.infer<typeof updatePacketRequestSchema>;
export type ApprovePacketRequest = z.infer<typeof approvePacketRequestSchema>;
export type StagePacketSendRequest = z.infer<
  typeof stagePacketSendRequestSchema
>;
export type ExecutePacketSendRequest = z.infer<
  typeof executePacketSendRequestSchema
>;
export type CancelPacketSendRequest = z.infer<
  typeof cancelPacketSendRequestSchema
>;

export type PacketContentSnapshot = z.infer<typeof packetContentSnapshotSchema>;
