import { z } from "zod";

const participantIdSchema = z.uuid();

const baseSignal = {
  version: z.literal(1),
  senderId: participantIdSchema,
} as const;

const targetedSignal = {
  ...baseSignal,
  targetId: participantIdSchema,
} as const;

export const meetingMediaSignalSchema = z.discriminatedUnion("kind", [
  z
    .object({
      ...baseSignal,
      kind: z.literal("ready"),
      targetId: participantIdSchema.optional(),
    })
    .strict(),
  z.object({ ...baseSignal, kind: z.literal("left") }).strict(),
  z
    .object({
      ...targetedSignal,
      kind: z.literal("description"),
      description: z
        .object({
          type: z.enum(["offer", "answer"]),
          sdp: z.string().min(1).max(300_000),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...targetedSignal,
      kind: z.literal("ice"),
      candidate: z
        .object({
          candidate: z.string().max(4_096),
          sdpMid: z.string().max(128).nullable().optional(),
          sdpMLineIndex: z.number().int().min(0).max(128).nullable().optional(),
          usernameFragment: z.string().max(256).nullable().optional(),
        })
        .strict(),
    })
    .strict(),
]);

export type MeetingMediaSignal = z.infer<typeof meetingMediaSignalSchema>;
