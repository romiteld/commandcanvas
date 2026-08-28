import { z } from "zod";

import { canvasCommandSchema } from "@/lib/canvas/object-model";

const roomIdSchema = z.string().uuid();
const displayNameSchema = z.string().trim().min(1).max(64);
const participantColorSchema = z.string().regex(/^#[0-9a-f]{6}$/i);
const roomSlugSchema = z
  .string()
  .min(12)
  .max(96)
  .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/);
const joinTokenSchema = z
  .string()
  .min(43)
  .max(86)
  .regex(/^[A-Za-z0-9_-]+$/);

export const createRoomRequestSchema = z
  .object({
    mode: z.literal("demo"),
    name: z.string().trim().min(1).max(120),
    displayName: displayNameSchema,
    color: participantColorSchema,
  })
  .strict();

export const joinRoomRequestSchema = z
  .object({
    slug: roomSlugSchema,
    joinToken: joinTokenSchema,
    displayName: displayNameSchema,
    color: participantColorSchema,
  })
  .strict();

export const commandRequestSchema = z
  .object({
    commandId: z.string().uuid(),
    roomId: roomIdSchema,
    baseRevision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    source: z.enum([
      "pointer",
      "touch",
      "stylus",
      "gesture",
      "voice",
      "typed",
      "collaborator",
      "webmcp",
      "system",
    ]),
    command: canvasCommandSchema,
  })
  .strict();

export type CreateRoomRequest = z.infer<typeof createRoomRequestSchema>;
export type JoinRoomRequest = z.infer<typeof joinRoomRequestSchema>;
export type CommandRequest = z.infer<typeof commandRequestSchema>;
