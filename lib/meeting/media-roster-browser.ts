import { z } from "zod";

const roomIdSchema = z.uuid();
const MAX_RESPONSE_BYTES = 16 * 1_024;
const REQUEST_TIMEOUT_MS = 1_500;
const eligibleRosterResponseSchema = z
  .object({
    ok: z.literal(true),
    status: z.literal("eligible"),
    participantIds: z.array(z.uuid()).min(1).max(4),
  })
  .strict()
  .refine(({ participantIds }) => new Set(participantIds).size === participantIds.length);
const overCapacityRosterResponseSchema = z
  .object({
    ok: z.literal(true),
    status: z.literal("over_capacity"),
  })
  .strict();
const rosterResponseSchema = z.discriminatedUnion("status", [
  eligibleRosterResponseSchema,
  overCapacityRosterResponseSchema,
]);

export type AuthoritativeMeetingRosterResult =
  | { status: "eligible"; participantIds: ReadonlySet<string> }
  | { status: "over_capacity" }
  | { status: "unavailable" };

export async function requestAuthoritativeMeetingRoster(input: {
  roomId: string;
  accessToken: string | null;
  signal?: AbortSignal;
  fetch?: typeof fetch;
}): Promise<AuthoritativeMeetingRosterResult> {
  if (
    !roomIdSchema.safeParse(input.roomId).success ||
    !input.accessToken ||
    input.signal?.aborted
  )
    return unavailableResult();

  const controller = new AbortController();
  const forwardAbort = () => controller.abort(input.signal?.reason);
  input.signal?.addEventListener("abort", forwardAbort, { once: true });
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await (input.fetch ?? fetch)(
      `/api/rooms/${input.roomId}/media/roster`,
      {
        method: "GET",
        cache: "no-store",
        headers: { authorization: `Bearer ${input.accessToken}` },
        signal: controller.signal,
      },
    );
    if (!response.ok) return unavailableResult();
    const raw = await response.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_RESPONSE_BYTES)
      return unavailableResult();
    const parsed = rosterResponseSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return unavailableResult();
    return parsed.data.status === "over_capacity"
      ? { status: "over_capacity" }
      : {
          status: "eligible",
          participantIds: new Set(parsed.data.participantIds),
        };
  } catch {
    return unavailableResult();
  } finally {
    clearTimeout(timeout);
    input.signal?.removeEventListener("abort", forwardAbort);
  }
}

function unavailableResult(): AuthoritativeMeetingRosterResult {
  return { status: "unavailable" };
}
