import { z } from "zod";

export const userProfileDraftSchema = z
  .object({
    displayName: z.string().trim().min(1).max(64),
    color: z.string().regex(/^#[0-9a-f]{6}$/i),
  })
  .strict();

export const userProfileSchema = userProfileDraftSchema
  .extend({ updatedAt: z.iso.datetime({ offset: true }) })
  .strict();

export type UserProfileDraft = z.infer<typeof userProfileDraftSchema>;
export type UserProfile = z.infer<typeof userProfileSchema>;
