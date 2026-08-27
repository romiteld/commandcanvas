import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { LocalCommandCanvas } from "@/components/command-canvas/local-command-canvas";
import type { RegisteredWebMcpTool } from "@/lib/webmcp/registry";

const originalModelContext = Object.getOwnPropertyDescriptor(
  document,
  "modelContext",
);

afterEach(() => {
  if (originalModelContext)
    Object.defineProperty(document, "modelContext", originalModelContext);
  else delete (document as unknown as Record<string, unknown>).modelContext;
});

describe("LocalCommandCanvas WebMCP bridge", () => {
  it("reports the ordinary-browser fallback when document.modelContext is absent", async () => {
    delete (document as unknown as Record<string, unknown>).modelContext;

    render(<LocalCommandCanvas />);

    expect(await screen.findByText("Site Tools unavailable")).toBeInTheDocument();
  });

  it("registers the stable tool catalog against the current document surface", async () => {
    const registered: RegisteredWebMcpTool[] = [];
    const registerTool = vi.fn(async (tool: RegisteredWebMcpTool) => {
      registered.push(tool);
    });
    Object.defineProperty(document, "modelContext", {
      value: { registerTool },
      configurable: true,
    });

    render(<LocalCommandCanvas />);

    await waitFor(() => expect(registerTool).toHaveBeenCalledTimes(8));
    expect(screen.getByText("8 Site Tools registered")).toBeInTheDocument();
    expect(registered.map((tool) => tool.name)).toEqual([
      "get_canvas_state",
      "create_object",
      "transform_object",
      "set_object_state",
      "discard_object",
      "transform_sketch",
      "prepare_meeting_packet",
      "request_packet_send",
    ]);

    const createObject = registered.find((tool) => tool.name === "create_object");
    if (!createObject) throw new Error("create_object was not registered");
    const controller = new AbortController();
    let result: Awaited<ReturnType<RegisteredWebMcpTool["execute"]>> | undefined;
    await act(async () => {
      result = await createObject.execute(
        {
          object: {
            id: "note-site-tools",
            type: "note",
            title: "Shared agent action",
            x: 240,
            y: 160,
            width: 280,
            height: 190,
            zIndex: 1,
            payload: { text: "Same live page, same semantic state.", tone: "sky" },
          },
        },
        { signal: controller.signal },
      );
    });

    expect(result).toMatchObject({
      ok: true,
      status: "completed",
      message: "ChatGPT created “Shared agent action”.",
    });
    expect(
      screen.getByRole("button", { name: "Select Shared agent action" }),
    ).toBeInTheDocument();
    expect(screen.getByText("ChatGPT created “Shared agent action”.")).toBeInTheDocument();
    expect(screen.getByText("R1 · webmcp")).toBeInTheDocument();
  });
});
