import type {
  BrowserMeetingApi,
  BrowserMeetingApiResult,
  BrowserMeetingInvitationDeliveryValue,
} from "@/lib/supabase/meeting-api";

const TERMINAL_STATUSES = new Set([
  "preview_only",
  "delivered",
  "bounced",
  "complained",
  "failed",
  "suppressed",
]);

export async function pollInvitationDelivery(options: {
  api: Pick<BrowserMeetingApi, "loadInvitationDelivery">;
  roomId: string;
  invitationId: string;
  signal: AbortSignal;
  delaysMs?: readonly number[];
  wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
  onUpdate?: (value: BrowserMeetingInvitationDeliveryValue) => void;
}): Promise<
  | (BrowserMeetingApiResult<BrowserMeetingInvitationDeliveryValue> & {
      exhausted?: boolean;
    })
  | { ok: false; error: { code: "request_cancelled" } }
> {
  const delays = options.delaysMs ?? [1_000, 2_000, 4_000, 8_000, 15_000];
  const wait = options.wait ?? abortableWait;
  let latest: BrowserMeetingInvitationDeliveryValue | null = null;

  for (let attempt = 0; attempt <= delays.length; attempt += 1) {
    if (options.signal.aborted)
      return { ok: false, error: { code: "request_cancelled" } };
    let result: BrowserMeetingApiResult<BrowserMeetingInvitationDeliveryValue>;
    try {
      result = await options.api.loadInvitationDelivery(
        options.roomId,
        options.invitationId,
        options.signal,
      );
    } catch {
      return options.signal.aborted
        ? { ok: false, error: { code: "request_cancelled" } }
        : {
            ok: false,
            error: {
              code: "request_failed",
              message: "Invitation delivery status could not be refreshed.",
            },
          };
    }
    if (options.signal.aborted)
      return { ok: false, error: { code: "request_cancelled" } };
    if (!result.ok) return result;
    latest = result.value;
    options.onUpdate?.(latest);
    if (TERMINAL_STATUSES.has(latest.delivery.status)) return result;
    if (attempt === delays.length) break;
    try {
      await wait(delays[attempt]!, options.signal);
    } catch {
      return { ok: false, error: { code: "request_cancelled" } };
    }
  }

  return { ok: true, value: latest!, exhausted: true };
}

function abortableWait(milliseconds: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = globalThis.setTimeout(done, milliseconds);
    signal.addEventListener("abort", abort, { once: true });
    function done() {
      signal.removeEventListener("abort", abort);
      resolve();
    }
    function abort() {
      globalThis.clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    }
  });
}
