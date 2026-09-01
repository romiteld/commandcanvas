import { z } from "zod";

export const persistedRoomAccessRowSchema = z
  .object({
    mode: z.enum(["standard", "demo"]),
    created_at: z.iso.datetime({ offset: true }),
    demo_hard_expires_at: z.iso.datetime({ offset: true }).nullable(),
  })
  .strict();

const DEMO_LEGACY_LIFETIME_MS = 24 * 60 * 60 * 1_000;

export type PersistedRoomAccessRow = z.infer<
  typeof persistedRoomAccessRowSchema
>;

/**
 * Returns null for a non-expiring standard room, a finite epoch deadline for a
 * demo room, and undefined when the persisted access row cannot be trusted.
 */
export function persistedRoomHardExpiryEpochMs(row: unknown) {
  const parsed = persistedRoomAccessRowSchema.safeParse(row);
  if (!parsed.success) return undefined;
  if (parsed.data.mode === "standard") return null;

  const expiresAt = parsed.data.demo_hard_expires_at
    ? Date.parse(parsed.data.demo_hard_expires_at)
    : Date.parse(parsed.data.created_at) + DEMO_LEGACY_LIFETIME_MS;
  return Number.isFinite(expiresAt) ? expiresAt : undefined;
}

export function isPersistedRoomAccessActive(
  row: unknown,
  nowEpochMs: number = Date.now(),
) {
  if (!Number.isFinite(nowEpochMs)) return false;
  const expiresAt = persistedRoomHardExpiryEpochMs(row);
  if (expiresAt === undefined) return false;
  return expiresAt === null || expiresAt > nowEpochMs;
}
