import { z } from "zod";

const roomIdSchema = z.uuid();
const requestIdSchema = z.uuid();
const MAX_RESPONSE_BYTES = 32 * 1_024;
const REQUEST_TIMEOUT_MS = 1_500;
const directIceServers: readonly RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
];
const iceServerSchema = z
  .object({
    urls: z.union([
      z.string().min(1).max(2_048),
      z.array(z.string().min(1).max(2_048)).min(1).max(8),
    ]),
    username: z.string().min(1).max(512).optional(),
    credential: z.string().min(1).max(2_048).optional(),
  })
  .strict();
const turnResponseSchema = z
  .object({
    ok: z.literal(true),
    expiresAt: z.iso.datetime(),
    iceServers: z.array(iceServerSchema).min(2).max(9),
  })
  .strict()
  .refine(({ iceServers }) =>
    iceServers.some(({ urls, username, credential }) => {
      const values = Array.isArray(urls) ? urls : [urls];
      return (
        values.some(
          (url) => url.startsWith("turn:") || url.startsWith("turns:"),
        ) &&
        username !== undefined &&
        credential !== undefined
      );
    }),
  );

export type MeetingIceServerResult =
  | {
      mode: "turn";
      expiresAt: string;
      iceServers: readonly RTCIceServer[];
    }
  | { mode: "direct"; iceServers: readonly RTCIceServer[] };

export async function requestMeetingIceServers(input: {
  roomId: string;
  accessToken: string | null;
  signal?: AbortSignal;
  fetch?: typeof fetch;
  createRequestId?: () => string;
}): Promise<MeetingIceServerResult> {
  if (
    !roomIdSchema.safeParse(input.roomId).success ||
    !input.accessToken ||
    input.signal?.aborted
  )
    return directResult();
  const requestId = input.createRequestId?.() ?? globalThis.crypto.randomUUID();
  if (!requestIdSchema.safeParse(requestId).success) return directResult();

  const controller = new AbortController();
  const forwardAbort = () => controller.abort(input.signal?.reason);
  input.signal?.addEventListener("abort", forwardAbort, { once: true });
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await (input.fetch ?? fetch)(
      `/api/rooms/${input.roomId}/media/turn`,
      {
        method: "POST",
        cache: "no-store",
        headers: {
          authorization: `Bearer ${input.accessToken}`,
          "idempotency-key": requestId,
        },
        signal: controller.signal,
      },
    );
    if (!response.ok) return directResult();
    const raw = await response.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_RESPONSE_BYTES)
      return directResult();
    const parsed = turnResponseSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) return directResult();
    return {
      mode: "turn",
      expiresAt: parsed.data.expiresAt,
      iceServers: parsed.data.iceServers,
    };
  } catch {
    return directResult();
  } finally {
    clearTimeout(timeout);
    input.signal?.removeEventListener("abort", forwardAbort);
  }
}

function directResult(): MeetingIceServerResult {
  return { mode: "direct", iceServers: directIceServers };
}
