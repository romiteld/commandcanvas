import { z } from "zod";

export const cursorMessageSchema = z
  .object({
    participantId: z.string().min(2).max(96),
    seq: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    x: z.number().finite().min(-1_000_000).max(1_000_000),
    y: z.number().finite().min(-1_000_000).max(1_000_000),
    sentAt: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  })
  .strict();

export type CursorMessage = z.infer<typeof cursorMessageSchema>;
export type RemoteCursorState = Record<string, CursorMessage>;

export const presenceParticipantSchema = z
  .object({
    participantId: z.string().uuid(),
    displayName: z.string().trim().min(1).max(64),
    role: z.enum(["host", "participant"]),
    color: z.string().regex(/^#[0-9a-f]{6}$/i),
    onlineAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export const revisionMessageSchema = z
  .object({
    id: z.string().uuid().optional(),
    roomId: z.string().uuid(),
    revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    receiptId: z.string().uuid(),
  })
  .strict();

export type PresenceParticipant = z.infer<typeof presenceParticipantSchema>;

export function parsePresenceState(input: unknown): PresenceParticipant[] {
  if (!input || typeof input !== "object" || Array.isArray(input)) return [];

  const participants = new Map<string, PresenceParticipant>();
  for (const [presenceKey, rawEntries] of Object.entries(input)) {
    if (!Array.isArray(rawEntries)) continue;
    for (const rawEntry of rawEntries) {
      if (!rawEntry || typeof rawEntry !== "object" || Array.isArray(rawEntry))
        continue;
      const candidate = { ...(rawEntry as Record<string, unknown>) };
      delete candidate.presence_ref;
      const parsed = presenceParticipantSchema.safeParse(candidate);
      if (!parsed.success || parsed.data.participantId !== presenceKey) continue;

      const current = participants.get(parsed.data.participantId);
      if (!current || current.onlineAt < parsed.data.onlineAt)
        participants.set(parsed.data.participantId, parsed.data);
    }
  }

  return [...participants.values()].sort((left, right) =>
    left.displayName.localeCompare(right.displayName),
  );
}

export function applyCursorMessage(
  state: RemoteCursorState,
  input: unknown,
): RemoteCursorState {
  const parsed = cursorMessageSchema.safeParse(input);
  if (!parsed.success) return state;

  const message = parsed.data;
  const current = state[message.participantId];
  if (current && current.seq >= message.seq) return state;

  return { ...state, [message.participantId]: message };
}

const CURSOR_BROADCAST_INTERVAL_MS = Math.ceil(1_000 / 30);

export function shouldBroadcastCursor(
  lastSentAt: number | null,
  now: number,
): boolean {
  return lastSentAt === null || now - lastSentAt >= CURSOR_BROADCAST_INTERVAL_MS;
}
