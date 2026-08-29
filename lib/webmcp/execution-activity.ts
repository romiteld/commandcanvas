import type { WebMcpExecutionEvent } from "@/lib/webmcp/registry";

const MAX_EXECUTION_ACTIVITY = 6;

export function upsertWebMcpExecutionActivity(
  current: readonly WebMcpExecutionEvent[],
  event: WebMcpExecutionEvent,
): readonly WebMcpExecutionEvent[] {
  const existingIndex = current.findIndex(
    (candidate) => candidate.invocationId === event.invocationId,
  );
  if (existingIndex >= 0) {
    const next = [...current];
    next[existingIndex] = event;
    return next;
  }
  return [...current, event].slice(-MAX_EXECUTION_ACTIVITY);
}
