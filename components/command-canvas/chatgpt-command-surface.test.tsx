import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ChatGptCommandSurface } from "@/components/command-canvas/chatgpt-command-surface";
import type { WebMcpExecutionEvent } from "@/lib/webmcp/registry";

const projection = {
  roomId: "room-live",
  revision: 18,
  selectedObjectId: "diagram-1",
  objects: [{ id: "diagram-1", type: "diagram", title: "System map" }],
  receipts: [
    {
      id: "receipt-18",
      revision: 18,
      actor: { id: "agent", displayName: "ChatGPT", type: "agent" },
      source: "webmcp",
      action: "object.create",
      affectedObjectIds: ["diagram-1"],
      description: "ChatGPT created System map.",
      createdAt: "2026-08-29T01:00:00.000Z",
    },
  ],
  truncation: {
    resultByteBudget: 32_768,
    objects: { total: 1, returned: 1, omitted: 0, limit: 50, reasons: [] },
    receipts: {
      requested: true,
      total: 1,
      returned: 1,
      omitted: 0,
      limit: 20,
      reasons: [],
    },
  },
};

function renderSurface(
  overrides: Partial<React.ComponentProps<typeof ChatGptCommandSurface>> = {},
) {
  const onOpenDrawer = vi.fn();
  const onRequestDrawerOpen = vi.fn();
  const onCloseDrawer = vi.fn();
  const onToggleRealtimeVoice = vi.fn();
  const onViewAllActivity = vi.fn();
  render(
    <ChatGptCommandSurface
      surfaceState={{ status: "registered_to_page", registeredToolCount: 10 }}
      executionActivity={[]}
      projection={projection as never}
      drawerOpen={false}
      drawingActive={false}
      realtimeActive={false}
      realtimeAvailable
      onOpenDrawer={onOpenDrawer}
      onRequestDrawerOpen={onRequestDrawerOpen}
      onCloseDrawer={onCloseDrawer}
      onToggleRealtimeVoice={onToggleRealtimeVoice}
      onViewAllActivity={onViewAllActivity}
      {...overrides}
    />,
  );
  return {
    onOpenDrawer,
    onRequestDrawerOpen,
    onCloseDrawer,
    onToggleRealtimeVoice,
    onViewAllActivity,
  };
}

describe("ChatGptCommandSurface", () => {
  it("frames WebMCP as automatic agent tools with a separate activity inspector", async () => {
    const user = userEvent.setup();
    renderSurface();

    const group = screen.getByRole("group", {
      name: "WebMCP tools and CommandCanvas Live Voice",
    });
    expect(group).toHaveClass("chatgpt-command-pill");
    expect(group.querySelectorAll("button")).toHaveLength(2);
    expect(within(group).getByText("WebMCP")).toBeVisible();
    expect(within(group).getByText("tools")).toBeVisible();
    expect(within(group).getByText("Live voice")).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: "Open WebMCP agent activity" }),
    );
    expect(
      screen.getByText(
        /CommandCanvas registers its WebMCP tools automatically when the live canvas is ready/i,
      ),
    ).toBeVisible();
    expect(
      screen.getByText(
        /Compatible agents can discover and invoke them without opening this activity drawer/i,
      ),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Start CommandCanvas Live Voice" }),
    ).toHaveClass("chatgpt-voice-segment");
  });

  it("starts the explicit in-page Live Voice path even when WebMCP tools are registered", async () => {
    const user = userEvent.setup();
    const callbacks = renderSurface();

    await user.click(
      screen.getByRole("button", { name: "Start CommandCanvas Live Voice" }),
    );

    expect(callbacks.onOpenDrawer).toHaveBeenCalledOnce();
    expect(callbacks.onToggleRealtimeVoice).toHaveBeenCalledOnce();
    expect(
      screen.getByText(
        /ChatGPT desktop app's built-in browser/i,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getAllByText(/an actual invocation and receipt below prove page execution/i),
    ).toHaveLength(2);
    expect(
      screen.getAllByText(/does not authenticate which compatible agent host initiated it/i),
    ).toHaveLength(2);
    expect(
      screen.getByText(/CommandCanvas never receives that surrounding ChatGPT credential/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/does not promise that ChatGPT Voice will invoke WebMCP tools/i),
    ).toBeInTheDocument();
  });

  it("starts ordinary-browser Live Voice directly from the trusted mic click", async () => {
    const user = userEvent.setup();
    const callOrder: string[] = [];
    renderSurface({
      surfaceState: { status: "unavailable" },
      onToggleRealtimeVoice: () => callOrder.push("voice"),
      onOpenDrawer: () => callOrder.push("drawer"),
    });

    await user.click(
      screen.getByRole("button", { name: "Start CommandCanvas Live Voice" }),
    );

    expect(callOrder).toEqual(["voice", "drawer"]);
  });

  it("keeps the active local microphone stoppable when WebMCP tools register later", async () => {
    const user = userEvent.setup();
    const callbacks = renderSurface({
      surfaceState: { status: "registered_to_page", registeredToolCount: 10 },
      realtimeActive: true,
      drawerOpen: false,
    });

    const stopVoice = screen.getByRole("button", {
      name: "Stop CommandCanvas Live Voice",
    });
    expect(stopVoice).toHaveAttribute("aria-pressed", "true");
    await user.click(stopVoice);

    expect(callbacks.onToggleRealtimeVoice).toHaveBeenCalledOnce();
    expect(callbacks.onOpenDrawer).not.toHaveBeenCalled();
  });

  it("keeps explicit CommandCanvas Live Voice opt-in available without autostarting it", async () => {
    const user = userEvent.setup();
    const callbacks = renderSurface({ drawerOpen: true });

    expect(callbacks.onToggleRealtimeVoice).not.toHaveBeenCalled();
    expect(screen.getByText(/registered to this page/i)).toBeInTheDocument();
    expect(
      screen.getAllByText(/an actual invocation and receipt below prove page execution/i),
    ).toHaveLength(2);
    await user.click(
      screen.getByRole("button", {
        name: "Start CommandCanvas Live Voice from drawer",
      }),
    );
    expect(callbacks.onToggleRealtimeVoice).toHaveBeenCalledOnce();
  });

  it("removes surrounding-host guidance if the page registration surface becomes unavailable", () => {
    const callbacks = {
      onOpenDrawer: vi.fn(),
      onRequestDrawerOpen: vi.fn(),
      onCloseDrawer: vi.fn(),
      onToggleRealtimeVoice: vi.fn(),
      onViewAllActivity: vi.fn(),
    };
    const view = render(
      <ChatGptCommandSurface
        surfaceState={{ status: "registered_to_page", registeredToolCount: 10 }}
        executionActivity={[]}
        projection={projection as never}
        drawerOpen
        drawingActive={false}
        realtimeActive={false}
        realtimeAvailable
        {...callbacks}
      />,
    );
    expect(
      screen.getAllByText(/an actual invocation and receipt below prove page execution/i),
    ).toHaveLength(2);

    view.rerender(
      <ChatGptCommandSurface
        surfaceState={{ status: "unavailable" }}
        executionActivity={[]}
        projection={projection as never}
        drawerOpen
        drawingActive={false}
        realtimeActive={false}
        realtimeAvailable
        {...callbacks}
      />,
    );

    expect(
      screen.getByText("WebMCP tools unavailable in this browser session"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/an actual invocation and receipt below prove page execution/i),
    ).not.toBeInTheDocument();
  });

  it("does not mistake unavailable WebMCP tools for a missing ChatGPT login", () => {
    renderSurface({
      surfaceState: { status: "unavailable" },
      drawerOpen: true,
    });

    expect(
      screen.getByText(/no additional ChatGPT sign-in is required/i),
    ).toBeVisible();
    expect(
      screen.getByText(/this browser session did not expose WebMCP tools/i),
    ).toBeVisible();
    expect(
      screen.getByText(/Availability can depend on the browser/i),
    ).toBeVisible();
    expect(
      screen.queryByText(/^Open this page inside ChatGPT/i),
    ).not.toBeInTheDocument();
  });

  it("renders actual page-observable tool lifecycle and recent receipt without raw inputs", () => {
    const activity: WebMcpExecutionEvent[] = [
      {
        invocationId: "create_object-1",
        toolName: "create_object",
        status: "completed",
        message: "Canvas mutation completed.",
        receiptId: "receipt-18",
      },
      {
        invocationId: "request_packet_send-2",
        toolName: "request_packet_send",
        status: "awaiting_human_approval",
        message: "Host review is required.",
      },
    ];
    renderSurface({ drawerOpen: true, executionActivity: activity });

    expect(screen.getByText("create object")).toBeInTheDocument();
    expect(screen.getByText("COMPLETED")).toBeInTheDocument();
    expect(screen.getByText("AWAITING HUMAN APPROVAL")).toBeInTheDocument();
    expect(screen.getByText("ChatGPT created System map.")).toBeInTheDocument();
    expect(screen.getByText("Revision 18 · 1 visible object")).toBeInTheDocument();
    expect(screen.queryByText(/recipient@example.com/i)).not.toBeInTheDocument();
  });

  it("reveals the existing approval panel once when a new Site Tool request awaits the host", async () => {
    const activity: WebMcpExecutionEvent[] = [
      {
        invocationId: "request-packet-send-approval-1",
        toolName: "request_packet_send",
        status: "awaiting_human_approval",
        message: "request packet send is awaiting human approval.",
      },
    ];
    const callbacks = renderSurface({
      drawerOpen: false,
      executionActivity: activity,
      packetPanel: <button type="button">Send approved packet</button>,
    });

    await waitFor(() => expect(callbacks.onRequestDrawerOpen).toHaveBeenCalledOnce());
  });

  it("keeps the mic operable while drawing without opening a drawer", async () => {
    const user = userEvent.setup();
    const callbacks = renderSurface({
      surfaceState: { status: "unavailable" },
      drawingActive: true,
    });

    const mic = screen.getByRole("button", {
      name: "Start CommandCanvas Live Voice",
    });
    expect(mic).toBeEnabled();
    await user.click(mic);

    expect(callbacks.onToggleRealtimeVoice).toHaveBeenCalledOnce();
    expect(callbacks.onOpenDrawer).not.toHaveBeenCalled();
  });

  it("keeps a pre-opened command drawer inert while drawing and exposes only a status notice", () => {
    renderSurface({
      drawerOpen: true,
      drawingActive: true,
      commandDrawerDeferred: true,
    });

    const drawer = screen.getByLabelText(
      "WebMCP activity and CommandCanvas Live Voice drawer",
    );
    expect(drawer).toHaveAttribute("aria-hidden", "true");
    expect(drawer).toHaveAttribute("inert");
    expect(drawer).not.toHaveClass("is-open");
    expect(
      screen.getByText("Agent request queued until drawing finishes."),
    ).toBeVisible();
  });
});
