import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
  it("lets a visitor create and undo a note without a login or provider request", async () => {
    delete (document as unknown as Record<string, unknown>).modelContext;
    const user = userEvent.setup();
    const fetch = vi.spyOn(globalThis, "fetch");
    render(<LocalCommandCanvas />);

    expect(screen.getByText("Changes stay in this tab. Reload to start again.")).toBeVisible();
    expect(screen.getByRole("link", { name: /Watch the walkthrough/ })).toHaveAttribute("href", "https://youtu.be/s5h2cr2Qpfw");
    expect(screen.getByRole("button", { name: "Select Rough sketch · sample" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Select Structured diagram · sample" })).toBeInTheDocument();
    expect(screen.getByText("Prepared example")).toBeVisible();
    expect(screen.queryByText("Agent structured")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Make usable" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Start voice transcription/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Undo last change" })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Open create menu" }));
    await user.click(screen.getByRole("button", { name: "Create note" }));
    expect(screen.getByRole("button", { name: "Select New thought" })).toBeInTheDocument();
    expect(screen.getAllByText("You created “New thought”.").length).toBeGreaterThan(0);
    expect(screen.getAllByText("R1 · pointer").length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "Undo last change" }));
    expect(screen.queryByRole("button", { name: "Select New thought" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Select Rough sketch · sample" })).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reports the ordinary-browser fallback when document.modelContext is absent", async () => {
    delete (document as unknown as Record<string, unknown>).modelContext;

    render(<LocalCommandCanvas />);

    expect(await screen.findAllByText("WebMCP tools unavailable")).not.toHaveLength(0);
  });

  it("registers the stable tool catalog against the current document surface", async () => {
    const user = userEvent.setup();
    const registered: RegisteredWebMcpTool[] = [];
    const registerTool = vi.fn(async (tool: RegisteredWebMcpTool) => {
      registered.push(tool);
    });
    Object.defineProperty(document, "modelContext", {
      value: { registerTool },
      configurable: true,
    });

    render(<LocalCommandCanvas />);

    await waitFor(() => expect(registerTool).toHaveBeenCalledTimes(12));
    expect(screen.getByText("12 WebMCP tools registered")).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Open WebMCP agent activity" }),
    );
    expect(
      screen.getByText("12 WebMCP tools registered to this page"),
    ).toBeVisible();
    expect(
      screen.getByText("No WebMCP tool has been invoked on this page yet."),
    ).toBeVisible();
    expect(registered.map((tool) => tool.name)).toEqual([
      "get_canvas_state",
      "create_object",
      "update_object_content",
      "transform_object",
      "set_object_state",
      "discard_object",
      "organize_objects",
      "history_action",
      "transform_sketch",
      "prepare_meeting_packet",
      "request_packet_send",
      "control_workspace",
    ]);

    const createObject = registered.find((tool) => tool.name === "create_object");
    if (!createObject) throw new Error("create_object was not registered");
    const controller = new AbortController();
    let result: Awaited<ReturnType<RegisteredWebMcpTool["execute"]>> | undefined;
    await act(async () => {
      result = await createObject.execute(
        {
          type: "note",
          title: "Shared agent action",
          text: "Same live page, same semantic state.",
          tone: "sky",
        },
        { signal: controller.signal },
      );
    });

    expect(result).toMatchObject({
      ok: true,
      status: "completed",
      message: "WebMCP agent created “Shared agent action”.",
    });
    expect(
      screen.getByRole("button", { name: "Select Shared agent action" }),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText("WebMCP agent created “Shared agent action”.").length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText("R1 · webmcp").length).toBeGreaterThan(0);
    expect(screen.getByText("A WebMCP tool was invoked")).toBeVisible();
    expect(screen.getByText("create object")).toBeVisible();
    expect(screen.getByText("COMPLETED")).toBeVisible();
  });

  it("registers once when the document surface arrives after mount and aborts it on disposal", async () => {
    delete (document as unknown as Record<string, unknown>).modelContext;
    const signals: AbortSignal[] = [];
    const registerTool = vi.fn(
      async (_tool: RegisteredWebMcpTool, options: { signal: AbortSignal }) => {
        signals.push(options.signal);
      },
    );
    const view = render(<LocalCommandCanvas />);

    expect(
      await screen.findAllByText("WebMCP tools unavailable"),
    ).not.toHaveLength(0);
    Object.defineProperty(document, "modelContext", {
      value: { registerTool },
      configurable: true,
    });

    await waitFor(() => expect(registerTool).toHaveBeenCalledTimes(12));
    act(() => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await Promise.resolve();
    expect(registerTool).toHaveBeenCalledTimes(12);
    expect(signals.every((signal) => !signal.aborted)).toBe(true);

    view.unmount();
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });

  it(
    "recovers when the host exposes document.modelContext after the startup window",
    async () => {
      delete (document as unknown as Record<string, unknown>).modelContext;
      const signals: AbortSignal[] = [];
      const registerTool = vi.fn(
        async (_tool: RegisteredWebMcpTool, options: { signal: AbortSignal }) => {
          signals.push(options.signal);
        },
      );
      const view = render(<LocalCommandCanvas />);

      await screen.findAllByText("WebMCP tools unavailable");
      await new Promise((resolve) => window.setTimeout(resolve, 3_200));
      Object.defineProperty(document, "modelContext", {
        value: { registerTool },
        configurable: true,
      });

      await waitFor(
        () => expect(registerTool).toHaveBeenCalledTimes(12),
        { timeout: 1_500 },
      );
      view.unmount();
      expect(signals.every((signal) => signal.aborted)).toBe(true);
      await new Promise((resolve) => window.setTimeout(resolve, 1_100));
      expect(registerTool).toHaveBeenCalledTimes(12);
    },
    8_000,
  );

  it("aborts the old catalog before registering a replacement document surface", async () => {
    const oldSignals: AbortSignal[] = [];
    const newSignals: AbortSignal[] = [];
    const oldRegisterTool = vi.fn(
      async (_tool: RegisteredWebMcpTool, options: { signal: AbortSignal }) => {
        oldSignals.push(options.signal);
      },
    );
    Object.defineProperty(document, "modelContext", {
      value: { registerTool: oldRegisterTool },
      configurable: true,
    });
    const view = render(<LocalCommandCanvas />);
    await waitFor(() => expect(oldRegisterTool).toHaveBeenCalledTimes(12));

    const newRegisterTool = vi.fn(
      async (_tool: RegisteredWebMcpTool, options: { signal: AbortSignal }) => {
        newSignals.push(options.signal);
      },
    );
    Object.defineProperty(document, "modelContext", {
      value: { registerTool: newRegisterTool },
      configurable: true,
    });
    act(() => window.dispatchEvent(new Event("focus")));

    await waitFor(() => expect(newRegisterTool).toHaveBeenCalledTimes(12));
    expect(oldSignals.every((signal) => signal.aborted)).toBe(true);
    expect(newSignals.every((signal) => !signal.aborted)).toBe(true);

    view.unmount();
    expect(newSignals.every((signal) => signal.aborted)).toBe(true);
  });
});
