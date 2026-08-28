export type BoundedBodyResult =
  | { ok: true; text: string }
  | { ok: false; reason: "too_large" | "aborted" | "read_failed" };

/**
 * Reads a streaming HTTP body without first allocating the entire payload.
 * The reader is cancelled as soon as the byte budget is crossed.
 */
export async function readBoundedUtf8Body(
  body: ReadableStream<Uint8Array> | null,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<BoundedBodyResult> {
  if (!body) return { ok: true, text: "" };
  if (signal?.aborted) return { ok: false, reason: "aborted" };

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  let cancelled = false;
  const abort = () => {
    cancelled = true;
    void reader.cancel(signal?.reason).catch(() => undefined);
  };
  signal?.addEventListener("abort", abort, { once: true });

  try {
    while (true) {
      const next = await reader.read();
      if (signal?.aborted) return { ok: false, reason: "aborted" };
      if (next.done) break;
      const chunk = next.value;
      if (byteLength + chunk.byteLength > maxBytes) {
        cancelled = true;
        await reader.cancel("body_limit_exceeded").catch(() => undefined);
        return { ok: false, reason: "too_large" };
      }
      byteLength += chunk.byteLength;
      chunks.push(chunk);
    }

    const bytes = new Uint8Array(byteLength);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return { ok: true, text: new TextDecoder("utf-8", { fatal: true }).decode(bytes) };
  } catch {
    return {
      ok: false,
      reason: signal?.aborted ? "aborted" : "read_failed",
    };
  } finally {
    signal?.removeEventListener("abort", abort);
    if (!cancelled) reader.releaseLock();
  }
}
