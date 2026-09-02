import { describe, expect, it, vi } from "vitest";

import { createCanvasWorkspaceController } from "@/lib/canvas/workspace-controller";

describe("CanvasWorkspaceController", () => {
  it("refuses honestly until the mounted canvas attaches its local handler", async () => {
    const controller = createCanvasWorkspaceController();

    await expect(
      controller.execute(
        { action: "fit_all" },
        new AbortController().signal,
        "voice",
      ),
    ).resolves.toEqual({
      ok: false,
      code: "not_available",
      message: "not available yet: workspace control is not mounted",
    });
  });

  it("routes both transports to the same current handler and detaches by identity", async () => {
    const controller = createCanvasWorkspaceController();
    const first = vi.fn(async () => ({
      ok: true as const,
      status: "completed" as const,
      message: "First.",
    }));
    const second = vi.fn(async () => ({
      ok: true as const,
      status: "completed" as const,
      message: "Second.",
    }));
    const detachFirst = controller.attach(first);
    const detachSecond = controller.attach(second);

    const signal = new AbortController().signal;
    await controller.execute({ action: "zoom_in" }, signal, "webmcp");
    detachFirst();
    await controller.execute({ action: "zoom_out" }, signal, "voice");
    detachSecond();

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenNthCalledWith(
      1,
      { action: "zoom_in" },
      signal,
      "webmcp",
    );
    expect(second).toHaveBeenNthCalledWith(
      2,
      { action: "zoom_out" },
      signal,
      "voice",
    );
  });

  it("honors cancellation before invoking local UI behavior", async () => {
    const controller = createCanvasWorkspaceController();
    const handler = vi.fn();
    controller.attach(handler);
    const abort = new AbortController();
    abort.abort();

    await expect(
      controller.execute({ action: "fit_all" }, abort.signal, "voice"),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(handler).not.toHaveBeenCalled();
  });
});
