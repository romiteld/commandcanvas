import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  createStandardMeetingWebMcpRegistry,
  MeetingLobby,
  meetingHandControllerOptions,
  readMeetingInviteOnce,
} from "@/components/command-canvas/meeting-command-canvas";
import { createCanvasStore } from "@/lib/canvas/canvas-store";
import type { DemoRoomSnapshot } from "@/lib/demo/room-session";
import type {
  RegisteredWebMcpTool,
  WebMcpExecutionEvent,
} from "@/lib/webmcp/registry";

describe("normal meeting lobby", () => {
  it("uses a compact email OTP gate with no password and preserves the no-signup demo link", () => {
    render(
      <MeetingLobby
        state={{ phase: "email", invited: false }}
        onRequestCode={vi.fn()}
        onVerifyCode={vi.fn()}
        onCreateMeeting={vi.fn()}
      />,
    );

    expect(screen.getByRole("textbox", { name: "Email" })).toHaveAttribute(
      "type",
      "email",
    );
    expect(screen.queryByLabelText(/password/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Email me a code" })).toBeVisible();
    expect(screen.getByRole("link", { name: /no-signup demo/i })).toHaveAttribute(
      "href",
      "/demo",
    );
  });

  it("renders an invitation-specific exact-email gate and a six-digit OTP input", () => {
    const view = render(
      <MeetingLobby
        state={{ phase: "email", invited: true }}
        onRequestCode={vi.fn()}
        onVerifyCode={vi.fn()}
        onCreateMeeting={vi.fn()}
      />,
    );
    expect(screen.getByRole("heading", { name: "Verify your invitation" })).toBeVisible();
    expect(screen.queryByRole("link", { name: /no-signup demo/i })).not.toBeInTheDocument();

    view.rerender(
      <MeetingLobby
        state={{ phase: "otp", invited: true, email: "sarah@example.com" }}
        onRequestCode={vi.fn()}
        onVerifyCode={vi.fn()}
        onCreateMeeting={vi.fn()}
      />,
    );
    const code = screen.getByLabelText("Verification code");
    expect(code).toHaveAttribute("pattern", "[0-9]{6}");
    expect(code).toHaveAttribute("autocomplete", "one-time-code");
    fireEvent.change(code, { target: { value: "123456" } });
    expect(code).toHaveValue("123456");
  });
});

describe("normal meeting private hand relay binding", () => {
  it("does not offer a private relay when the server feature is disabled", () => {
    expect(
      meetingHandControllerOptions({
        enabled: false,
        roomId: "11111111-1111-4111-8111-111111111111",
        getAccessToken: () => "token",
        cameraUploadConsent: () => true,
        getMeetingStream: () => null,
      }),
    ).not.toHaveProperty("privateHandRelay");
  });

  it("binds the exact room, access-token getter, and explicit camera consent", () => {
    const getAccessToken = () => "token";
    const cameraUploadConsent = () => true;
    expect(
      meetingHandControllerOptions({
        enabled: true,
        roomId: "11111111-1111-4111-8111-111111111111",
        getAccessToken,
        cameraUploadConsent,
        getMeetingStream: () => null,
      }),
    ).toMatchObject({
      privateHandRelay: {
        roomId: "11111111-1111-4111-8111-111111111111",
        getAccessToken,
        cameraUploadConsent,
      },
    });
  });
});

describe("meeting invitation lifecycle and Site Tools", () => {
  it("retains the scrubbed token across the StrictMode effect replay", () => {
    const memory = {
      read: { current: false },
      token: { current: null as string | null },
    };
    const replaceState = vi.fn();
    const token = "a".repeat(43);
    const location = {
      href: `https://commandcanvas.example/meet#invite=${token}`,
      replaceState,
    };

    expect(readMeetingInviteOnce(memory, location)).toBe(token);
    expect(readMeetingInviteOnce(memory, { ...location, href: "https://commandcanvas.example/meet" })).toBe(token);
    expect(replaceState).toHaveBeenCalledTimes(1);
  });

  it("registers standard-room Site Tools and aborts every lifecycle signal on disposal", async () => {
    const roomId = "11111111-1111-4111-8111-111111111111";
    const store = createCanvasStore(roomId, {
      actor: { id: "host", displayName: "Danny", type: "human" },
      createId: (prefix) => `${prefix}-test`,
      now: () => "2026-08-28T12:00:00.000Z",
    });
    const signals: AbortSignal[] = [];
    const registered: RegisteredWebMcpTool[] = [];
    const executionActivity: WebMcpExecutionEvent[] = [];
    const registry = createStandardMeetingWebMcpRegistry({
      mode: "static",
      target: {
        registerTool: vi.fn(async (tool, options) => {
          registered.push(tool);
          signals.push(options.signal);
        }),
      },
      store,
      session: { submitCommand: vi.fn() },
      getSnapshot: () =>
        ({
          roomId,
          membership: {
            roomId,
            userId: "22222222-2222-4222-8222-222222222222",
            displayName: "Danny",
            color: "#0EA5E9",
            role: "host",
          },
          presence: [],
        }) as unknown as DemoRoomSnapshot,
      transformSketch: vi.fn(),
      onExecutionEvent: (event) => executionActivity.push(event),
    });

    await registry.sync();
    expect(registry.registeredToolNames()).toHaveLength(10);
    expect(signals.every((signal) => !signal.aborted)).toBe(true);
    const inspect = registered.find((tool) => tool.name === "get_canvas_state");
    if (!inspect) throw new Error("get_canvas_state was not registered");
    await inspect.execute(
      { scope: "all", includeReceipts: true },
      { signal: new AbortController().signal },
    );
    expect(executionActivity.map((event) => event.status)).toEqual([
      "running",
      "completed",
    ]);
    registry.dispose();
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });

  it("routes host packet preparation and staged send through the shared packet workflow", async () => {
    const roomId = "11111111-1111-4111-8111-111111111111";
    const store = createCanvasStore(roomId, {
      actor: { id: "host", displayName: "Danny", type: "human" },
      createId: (prefix) => `${prefix}-test`,
      now: () => "2026-08-28T12:00:00.000Z",
    });
    store.getState().dispatch(
      {
        type: "object.create",
        object: {
          id: "note-launch",
          type: "note",
          title: "Launch decision",
          x: 10,
          y: 20,
          width: 260,
          height: 180,
          zIndex: 1,
          payload: { text: "Ship Friday", tone: "sky" },
        },
      },
      "system",
    );
    const tools = new Map<string, RegisteredWebMcpTool>();
    const preparePacket = vi.fn(async () => ({
      ok: true as const,
      value: {
        packetId: "packet-standard",
        packetVersion: 1,
        sourceRevision: 1,
        objectCount: 1,
      },
    }));
    const stagePacketSend = vi.fn(async () => ({
      ok: true as const,
      value: {
        packetId: "packet-standard",
        sendRequestId: "33333333-3333-4333-8333-333333333333",
        recipientCount: 1,
      },
    }));
    let packetStatus: "none" | "draft" | "approved" = "none";
    const registry = createStandardMeetingWebMcpRegistry({
      mode: "static",
      target: {
        registerTool: vi.fn(async (tool) => {
          tools.set(tool.name, tool);
        }),
      },
      store,
      session: { submitCommand: vi.fn() },
      getSnapshot: () =>
        ({
          roomId,
          membership: {
            roomId,
            userId: "22222222-2222-4222-8222-222222222222",
            displayName: "Danny",
            color: "#0EA5E9",
            role: "host",
          },
          presence: [],
        }) as unknown as DemoRoomSnapshot,
      transformSketch: vi.fn(),
      packetWorkflow: {
        getStatus: () => packetStatus,
        preparePacket,
        stagePacketSend,
      },
    });

    await registry.sync();
    const prepared = await tools.get("prepare_meeting_packet")!.execute(
      { title: "Launch packet", objectIds: ["note-launch"] },
      { signal: new AbortController().signal },
    );
    expect(prepared).toMatchObject({
      ok: true,
      status: "completed",
      data: { packetId: "packet-standard", packetVersion: 1 },
    });
    expect(preparePacket).toHaveBeenCalledWith(
      {
        title: "Launch packet",
        objectIds: ["note-launch"],
        actorType: "agent",
      },
      expect.any(AbortSignal),
    );

    packetStatus = "approved";
    const staged = await tools.get("request_packet_send")!.execute(
      { packetId: "packet-standard" },
      { signal: new AbortController().signal },
    );
    expect(staged).toMatchObject({
      ok: true,
      status: "awaiting_human_approval",
      data: { sendRequestId: "33333333-3333-4333-8333-333333333333" },
    });
    expect(stagePacketSend).toHaveBeenCalledWith(
      "packet-standard",
      "agent",
      expect.any(AbortSignal),
    );
  });

  it("lets an authenticated participant create an ordinary canvas object through their own Site Tools", async () => {
    const roomId = "11111111-1111-4111-8111-111111111111";
    const store = createCanvasStore(roomId, {
      actor: { id: "participant", displayName: "Sarah", type: "participant" },
      createId: (prefix) => `${prefix}-test`,
      now: () => "2026-08-28T12:00:00.000Z",
    });
    const tools = new Map<string, RegisteredWebMcpTool>();
    const submitCommand = vi.fn(async (command, source) => {
      const result = store.getState().dispatch(command, source, {
        id: "agent-chatgpt",
        displayName: "ChatGPT",
        type: "agent",
      });
      return result.ok
        ? { ok: true as const, state: result.state }
        : {
            ok: false as const,
            code: result.error.code,
            message: result.error.message,
          };
    });
    const registry = createStandardMeetingWebMcpRegistry({
      mode: "static",
      target: {
        registerTool: vi.fn(async (tool) => {
          tools.set(tool.name, tool);
        }),
      },
      store,
      session: { submitCommand },
      getSnapshot: () =>
        ({
          roomId,
          membership: {
            roomId,
            userId: "44444444-4444-4444-8444-444444444444",
            displayName: "Sarah",
            color: "#A855F7",
            role: "participant",
          },
          presence: [],
        }) as unknown as DemoRoomSnapshot,
      transformSketch: vi.fn(),
    });

    await registry.sync();
    const result = await tools.get("create_object")!.execute(
      {
        object: {
          id: "note-participant-agent",
          type: "note",
          title: "Participant agent note",
          x: 120,
          y: 160,
          width: 260,
          height: 180,
          zIndex: 4,
          payload: { text: "Created through Sarah's ChatGPT.", tone: "sky" },
        },
      },
      { signal: new AbortController().signal },
    );

    expect(result).toMatchObject({
      ok: true,
      status: "completed",
      receiptId: "receipt-test",
    });
    expect(store.getState().canvas.objects["note-participant-agent"]).toMatchObject({
      title: "Participant agent note",
      createdBy: "agent-chatgpt",
    });
  });

  it("refuses participant packet effects before shared packet operations run", async () => {
    const roomId = "11111111-1111-4111-8111-111111111111";
    const store = createCanvasStore(roomId, {
      actor: { id: "participant", displayName: "Sarah", type: "participant" },
      createId: (prefix) => `${prefix}-test`,
      now: () => "2026-08-28T12:00:00.000Z",
    });
    store.getState().dispatch(
      {
        type: "object.create",
        object: {
          id: "note-launch",
          type: "note",
          title: "Launch decision",
          x: 10,
          y: 20,
          width: 260,
          height: 180,
          zIndex: 1,
          payload: { text: "Ship Friday", tone: "sky" },
        },
      },
      "system",
    );
    const tools = new Map<string, RegisteredWebMcpTool>();
    const preparePacket = vi.fn();
    const registry = createStandardMeetingWebMcpRegistry({
      mode: "static",
      target: {
        registerTool: vi.fn(async (tool) => {
          tools.set(tool.name, tool);
        }),
      },
      store,
      session: { submitCommand: vi.fn() },
      getSnapshot: () =>
        ({
          roomId,
          membership: {
            roomId,
            userId: "44444444-4444-4444-8444-444444444444",
            displayName: "Sarah",
            color: "#A855F7",
            role: "participant",
          },
          presence: [],
        }) as unknown as DemoRoomSnapshot,
      transformSketch: vi.fn(),
      packetWorkflow: {
        getStatus: () => "none",
        preparePacket,
        stagePacketSend: vi.fn(),
      },
    });

    await registry.sync();
    await expect(
      tools.get("prepare_meeting_packet")!.execute(
        { objectIds: ["note-launch"] },
        { signal: new AbortController().signal },
      ),
    ).resolves.toMatchObject({ ok: false, code: "forbidden" });
    expect(preparePacket).not.toHaveBeenCalled();
  });
});
