import { describe, expect, it, vi } from "vitest";

import { createCanvasCapabilityRuntime } from "@/lib/canvas/capability-runtime";

const hostContext = {
  phase: {
    roomActive: true,
    hasContent: true,
    selection: "object" as const,
    collaboratorCount: 1,
    packet: "approved" as const,
  },
  actor: { participantId: "host-1", role: "host" as const },
  canMutateCanvas: true,
};

describe("CanvasCapabilityRuntime", () => {
  it("executes voice capabilities without a WebMCP registration target", async () => {
    const adapter = vi.fn(async () => ({
      ok: true as const,
      status: "completed" as const,
      message: "Note created.",
      data: { affectedObjectIds: ["note-1"] },
    }));
    const runtime = createCanvasCapabilityRuntime({
      getContext: () => hostContext,
      adapter,
    });

    await expect(
      runtime.invokeCapability(
        "create_object",
        { type: "note", title: "Voice note" },
        new AbortController().signal,
        "voice",
      ),
    ).resolves.toMatchObject({ ok: true, status: "completed" });

    expect(adapter).toHaveBeenCalledWith(
      expect.objectContaining({
        capability: "create_object",
        source: "voice",
        input: { type: "note", title: "Voice note" },
      }),
    );
  });

  it("keeps the shared role guard when invoked without WebMCP registration", async () => {
    const adapter = vi.fn();
    const runtime = createCanvasCapabilityRuntime({
      getContext: () => ({
        ...hostContext,
        actor: { participantId: "participant-1", role: "participant" as const },
      }),
      adapter,
    });

    await expect(
      runtime.invokeCapability(
        "prepare_meeting_packet",
        {},
        new AbortController().signal,
        "voice",
      ),
    ).resolves.toMatchObject({
      ok: false,
      code: "forbidden",
    });
    expect(adapter).not.toHaveBeenCalled();
  });
});
