import { render, screen, waitFor } from "@testing-library/react";
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
      onCloseDrawer={onCloseDrawer}
      onToggleRealtimeVoice={onToggleRealtimeVoice}
      onViewAllActivity={onViewAllActivity}
      {...overrides}
    />,
  );
  return {
    onOpenDrawer,
    onCloseDrawer,
    onToggleRealtimeVoice,
    onViewAllActivity,
  };
}

describe("ChatGptCommandSurface", () => {
  it("renders one ChatGPT pill with two accessible control segments", () => {
    renderSurface();

    const group = screen.getByRole("group", { name: "ChatGPT controls" });
    expect(group).toHaveClass("chatgpt-command-pill");
    expect(group.querySelectorAll("button")).toHaveLength(2);
    expect(
      screen.getByRole("button", { name: "Open ChatGPT command drawer" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Use voice with ChatGPT" }),
    ).toHaveClass("chatgpt-voice-segment");
  });

  it("guides registered Site Tools users to surrounding ChatGPT Voice without starting page audio", async () => {
    const user = userEvent.setup();
    const callbacks = renderSurface();

    await user.click(
      screen.getByRole("button", { name: "Use voice with ChatGPT" }),
    );

    expect(callbacks.onOpenDrawer).toHaveBeenCalledOnce();
    expect(callbacks.onToggleRealtimeVoice).not.toHaveBeenCalled();
    expect(
      screen.getByText(
        "Use ChatGPT Voice in the surrounding app. This page cannot press that microphone for you.",
      ),
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
      screen.getByRole("button", { name: "Use voice with ChatGPT" }),
    );

    expect(callOrder).toEqual(["voice", "drawer"]);
  });

  it("keeps explicit CommandCanvas Live Voice opt-in available without autostarting it", async () => {
    const user = userEvent.setup();
    const callbacks = renderSurface({ drawerOpen: true });

    expect(callbacks.onToggleRealtimeVoice).not.toHaveBeenCalled();
    expect(screen.getByText(/registered to this page/i)).toBeInTheDocument();
    expect(screen.getByText(/discovery is not confirmed/i)).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", {
        name: "Use CommandCanvas Live Voice instead",
      }),
    );
    expect(callbacks.onToggleRealtimeVoice).toHaveBeenCalledOnce();
  });

  it("removes surrounding-Voice guidance if the page registration surface becomes unavailable", async () => {
    const user = userEvent.setup();
    const callbacks = {
      onOpenDrawer: vi.fn(),
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
    await user.click(
      screen.getByRole("button", { name: "Use voice with ChatGPT" }),
    );
    expect(screen.getByText(/surrounding app/i)).toBeInTheDocument();

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

    expect(screen.getByText("Site Tools unavailable")).toBeInTheDocument();
    expect(screen.queryByText(/surrounding app/i)).not.toBeInTheDocument();
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

    await waitFor(() => expect(callbacks.onOpenDrawer).toHaveBeenCalledOnce());
  });

  it("keeps the mic operable while drawing without opening a drawer", async () => {
    const user = userEvent.setup();
    const callbacks = renderSurface({
      surfaceState: { status: "unavailable" },
      drawingActive: true,
    });

    const mic = screen.getByRole("button", { name: "Use voice with ChatGPT" });
    expect(mic).toBeEnabled();
    await user.click(mic);

    expect(callbacks.onToggleRealtimeVoice).toHaveBeenCalledOnce();
    expect(callbacks.onOpenDrawer).not.toHaveBeenCalled();
  });
});
