import { describe, expect, it } from "vitest";

import { upsertWebMcpExecutionActivity } from "@/lib/webmcp/execution-activity";
import type { WebMcpExecutionEvent } from "@/lib/webmcp/registry";

function event(
  invocationId: string,
  status: WebMcpExecutionEvent["status"],
): WebMcpExecutionEvent {
  return {
    invocationId,
    toolName: "get_canvas_state",
    status,
    message: status,
  };
}

describe("upsertWebMcpExecutionActivity", () => {
  it("updates one invocation in place and retains the last six unique invocations", () => {
    let activity: readonly WebMcpExecutionEvent[] = [];
    for (let index = 1; index <= 7; index += 1) {
      activity = upsertWebMcpExecutionActivity(
        activity,
        event(`invocation-${index}`, "running"),
      );
      activity = upsertWebMcpExecutionActivity(
        activity,
        event(`invocation-${index}`, "completed"),
      );
    }

    expect(activity.map(({ invocationId, status }) => ({ invocationId, status }))).toEqual([
      { invocationId: "invocation-2", status: "completed" },
      { invocationId: "invocation-3", status: "completed" },
      { invocationId: "invocation-4", status: "completed" },
      { invocationId: "invocation-5", status: "completed" },
      { invocationId: "invocation-6", status: "completed" },
      { invocationId: "invocation-7", status: "completed" },
    ]);
  });
});
