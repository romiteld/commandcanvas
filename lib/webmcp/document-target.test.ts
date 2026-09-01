import { describe, expect, it, vi } from "vitest";

import { resolveDocumentWebMcpTarget } from "@/lib/webmcp/document-target";

describe("resolveDocumentWebMcpTarget", () => {
  it("wraps the current document.modelContext registration surface", async () => {
    const registerTool = vi.fn().mockResolvedValue(undefined);
    const modelContext = { registerTool };
    const target = resolveDocumentWebMcpTarget({ modelContext });
    const tool = { name: "test-tool" } as never;
    const controller = new AbortController();

    expect(target).not.toBeNull();
    await target?.registerTool(tool, { signal: controller.signal });
    expect(registerTool).toHaveBeenCalledWith(tool, {
      signal: controller.signal,
    });
  });

  it("does not fall back to deprecated navigator.modelContext-shaped input", () => {
    expect(
      resolveDocumentWebMcpTarget({
        navigator: { modelContext: { registerTool: vi.fn() } },
      }),
    ).toBeNull();
  });

  it("keeps one target identity for one live modelContext surface", () => {
    const modelContext = { registerTool: vi.fn().mockResolvedValue(undefined) };

    const first = resolveDocumentWebMcpTarget({ modelContext });
    const second = resolveDocumentWebMcpTarget({ modelContext });

    expect(first).toBe(second);
  });
});
