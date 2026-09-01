import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StrictMode } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  DemoCommandCanvas,
  type DemoCommandCanvasEnvironment,
} from "@/components/command-canvas/demo-command-canvas";
import { createCanvasStore } from "@/lib/canvas/canvas-store";
import { createEmptyCanvasState } from "@/lib/canvas/command-engine";
import type {
  DemoRoomSession,
  DemoRoomSnapshot,
} from "@/lib/demo/room-session";
import type {
  CanvasSketchTransformer,
  CanvasSketchTransformerOptions,
} from "@/lib/vision/canvas-transform";
import type { RegisteredWebMcpTool } from "@/lib/webmcp/registry";
import * as demoBootstrapModule from "@/lib/demo/bootstrap";
import * as roomSessionModule from "@/lib/demo/room-session";
import * as browserClientModule from "@/lib/supabase/browser-client";
import * as browserTransformModule from "@/lib/vision/browser-api";
import * as browserPacketModule from "@/lib/packets/browser-api";

const ROOM_ID = "d32af6a9-31dd-4dfc-98d5-fcf439b9b106";
const HOST_ID = "96ceecfe-ab18-4fda-9591-9945a73fe709";
const SARAH_ID = "99999999-9999-4999-8999-999999999999";
const packetContentSnapshot = {
  title: "Launch meeting packet",
  content: {
    schemaVersion: 1 as const,
    roomName: "CommandCanvas demo",
    sourceRevision: 4,
    objects: [
      {
        objectId: "note-launch",
        objectType: "note" as const,
        title: "Launch decision",
        payload: { text: "Ship the verified spatial workflow." },
      },
    ],
  },
};

function readyEnvironment(options?: {
  withSketch?: boolean;
  withContent?: boolean;
  createSketchTransformer?: (
    options: CanvasSketchTransformerOptions,
  ) => CanvasSketchTransformer;
  packetSession?: Partial<
    Pick<
      DemoRoomSession,
      | "preparePacket"
      | "loadLatestPacketWorkflow"
      | "updatePacket"
      | "approvePacket"
      | "stagePacketSend"
      | "cancelPacketSend"
      | "executePacketSend"
    >
  >;
  packetId?: string;
  deleteHostedDemoRoom?: DemoRoomSession["deleteHostedDemoRoom"];
  role?: "host" | "participant";
}) {
  const canvas = createEmptyCanvasState(ROOM_ID);
  const store = createCanvasStore(ROOM_ID, {
    actor: { id: HOST_ID, displayName: "Daniel", type: "human" },
    createId: (prefix) => `${prefix}-fixture`,
    now: () => "2026-08-27T12:00:00.000Z",
  });
  store.getState().hydrateCanvas(canvas);
  if (options?.withSketch)
    store.getState().dispatch(
      {
        type: "object.create",
        object: {
          id: "sketch-source",
          type: "sketch",
          title: "Rough architecture",
          x: 20,
          y: 30,
          width: 360,
          height: 220,
          zIndex: 1,
          payload: {
            strokes: [
              {
                id: "stroke-source",
                color: "#12233d",
                width: 5,
                points: [
                  { x: 12, y: 20 },
                  { x: 100, y: 30 },
                ],
              },
            ],
          },
        },
      },
      "system",
    );
  if (options?.withContent)
    store.getState().dispatch(
      {
        type: "object.create",
        object: {
          id: "note-launch",
          type: "note",
          title: "Launch decision",
          x: 120,
          y: 80,
          width: 280,
          height: 190,
          zIndex: 2,
          payload: {
            text: "Ship the verified spatial workflow.",
            tone: "sky",
          },
        },
      },
      "system",
    );
  let snapshot: DemoRoomSnapshot = {
    status: "ready",
    realtimeStatus: "connected",
    identity: { userId: HOST_ID, isAnonymous: true },
    roomId: ROOM_ID,
    membership: {
      roomId: ROOM_ID,
      userId: HOST_ID,
      role: options?.role ?? "host",
      displayName: "Daniel",
      color: "#f26a5b",
      joinedAt: "2026-08-27T12:00:00.000Z",
    },
    state: canvas,
    joinAccess:
      (options?.role ?? "host") === "host"
        ? {
            slug: "room-0123456789abcdef0123456789abcdef",
            joinToken: "t".repeat(43),
          }
        : null,
    presence: [
      {
        participantId: HOST_ID,
        displayName: "Daniel",
        role: "host",
        color: "#f26a5b",
        onlineAt: "2026-08-27T12:00:00.000Z",
      },
      {
        participantId: SARAH_ID,
        displayName: "Sarah",
        role: "participant",
        color: "#38bdf8",
        onlineAt: "2026-08-27T12:00:01.000Z",
      },
    ],
    cursors: {
      [SARAH_ID]: {
        participantId: SARAH_ID,
        seq: 1,
        x: 220,
        y: 160,
        sentAt: 1,
      },
    },
    commandPending: false,
    lastError: null,
  };
  const listeners = new Set<() => void>();
  const deleteHostedDemoRoom = vi.fn(
    options?.deleteHostedDemoRoom ??
      (async () => ({ ok: true as const, roomId: ROOM_ID, deleted: true as const })),
  );
  const session: DemoRoomSession = {
    getSnapshot: () => snapshot,
    getAccessToken: () => "header.payload.signature",
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start: async () => ({ ok: true, roomId: ROOM_ID }),
    submitCommand: async () => ({ ok: true, state: canvas }),
    transformSketch: async () => ({
      ok: false,
      error: {
        code: "sketch_transform_unconfigured",
        message: "Sketch interpretation is not configured.",
      },
    }),
    loadLatestPacketWorkflow: async () => ({
      ok: true,
      value: { packet: null, latestSend: null, activity: [] },
    }),
    preparePacket: async () => ({
      ok: false,
      error: { code: "packet_api_unconfigured", message: "Not configured." },
    }),
    updatePacket: async () => ({
      ok: false,
      error: { code: "packet_api_unconfigured", message: "Not configured." },
    }),
    approvePacket: async () => ({
      ok: false,
      error: { code: "packet_api_unconfigured", message: "Not configured." },
    }),
    stagePacketSend: async () => ({
      ok: false,
      error: { code: "packet_api_unconfigured", message: "Not configured." },
    }),
    cancelPacketSend: async () => ({
      ok: false,
      error: { code: "packet_api_unconfigured", message: "Not configured." },
    }),
    executePacketSend: async () => ({
      ok: false,
      error: { code: "packet_api_unconfigured", message: "Not configured." },
    }),
    ...options?.packetSession,
    publishCursor: async () => true,
    deleteHostedDemoRoom,
    whenIdle: async () => undefined,
    dispose: vi.fn(async () => undefined),
  };
  const copyInvite = vi.fn(async () => undefined);
  const resetDemo = vi.fn();
  const environment: DemoCommandCanvasEnvironment = {
    bootstrap: async () => ({
      ok: true,
      session,
      store,
      role: options?.role ?? "host",
      inviteUrl:
        (options?.role ?? "host") === "host"
          ? "https://commandcanvas.example/demo?room=room&join=token"
          : null,
    }),
    copyInvite,
    resetDemo,
    createPacketId: () => options?.packetId ?? "packet-launch",
    ...(
      options?.createSketchTransformer
        ? { createSketchTransformer: options.createSketchTransformer }
        : {}
    ),
  };
  return { environment, session, store, copyInvite, resetDemo, deleteHostedDemoRoom, setSnapshot: (next: DemoRoomSnapshot) => {
    snapshot = next;
    listeners.forEach((listener) => listener());
  } };
}

describe("DemoCommandCanvas", () => {
  it("shares one in-memory OpenAI key with room providers and clears it on unmount", async () => {
    const user = userEvent.setup();
    const harness = readyEnvironment();
    const originalBootstrap = harness.environment.bootstrap;
    let readOpenAiApiKey: (() => string) | undefined;
    harness.environment.bootstrap = (async (...args: unknown[]) => {
      readOpenAiApiKey = args[0] as (() => string) | undefined;
      return originalBootstrap();
    }) as DemoCommandCanvasEnvironment["bootstrap"];

    const view = render(<DemoCommandCanvas environment={harness.environment} />);
    expect(await screen.findByText("Live demo room")).toBeVisible();
    expect(readOpenAiApiKey).toBeTypeOf("function");

    const input = screen.getByLabelText("Your OpenAI API key");
    await user.type(input, "sk-user-session-key-1234567890");
    expect(readOpenAiApiKey?.()).toBe("sk-user-session-key-1234567890");

    view.unmount();
    expect(readOpenAiApiKey?.()).toBe("");
  });

  it("bootstraps one no-signup identity and room under React Strict Mode", async () => {
    const harness = readyEnvironment();
    const bootstrap = vi.spyOn(harness.environment, "bootstrap");

    const view = render(
      <StrictMode>
        <DemoCommandCanvas environment={harness.environment} />
      </StrictMode>,
    );

    expect(await screen.findByText("Live demo room")).toBeVisible();
    expect(bootstrap).toHaveBeenCalledOnce();
    expect(harness.session.dispose).not.toHaveBeenCalled();

    view.unmount();
    await waitFor(() => expect(harness.session.dispose).toHaveBeenCalledOnce());
  });

  it("wires authenticated sketch and packet APIs into the default room session", async () => {
    const harness = readyEnvironment();
    const browserApi = { transform: vi.fn() };
    const createBrowserSketchTransformApi = vi
      .spyOn(browserTransformModule, "createBrowserSketchTransformApi")
      .mockReturnValue(browserApi);
    const packetApi = { prepare: vi.fn() };
    const createBrowserPacketApi = vi
      .spyOn(browserPacketModule, "createBrowserPacketApi")
      .mockReturnValue(packetApi as never);
    vi.spyOn(browserClientModule, "createBrowserSupabaseClient").mockReturnValue({
      ok: true,
      client: {},
    } as never);
    const createDemoRoomSession = vi
      .spyOn(roomSessionModule, "createDemoRoomSession")
      .mockReturnValue(harness.session);
    vi.spyOn(demoBootstrapModule, "bootstrapDemoRoom").mockImplementation(
      async (options) => {
        options.createSession(() => true);
        return {
          ok: false,
          code: "fixture_complete",
          message: "Default dependencies captured.",
        };
      },
    );

    try {
      render(<DemoCommandCanvas />);
      expect(await screen.findByText("Default dependencies captured.")).toBeVisible();
      const dependencies = createDemoRoomSession.mock.calls[0]?.[0];
      expect(dependencies).toBeDefined();
      expect(dependencies?.createSketchTransformApi?.("header.payload.signature"))
        .toBe(browserApi);
      expect(createBrowserSketchTransformApi).toHaveBeenCalledWith({
        accessToken: "header.payload.signature",
        getOpenAiApiKey: expect.any(Function),
      });
      expect(dependencies?.createPacketApi?.("header.payload.signature"))
        .toBe(packetApi);
      expect(createBrowserPacketApi).toHaveBeenCalledWith({
        accessToken: "header.payload.signature",
      });
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("uses WebMCP to prepare and stage while the host alone authorizes the external action", async () => {
    const user = userEvent.setup();
    const registeredTools: RegisteredWebMcpTool[] = [];
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: {
        registerTool: vi.fn(async (tool: RegisteredWebMcpTool) => {
          registeredTools.push(tool);
        }),
      },
    });
    const preparePacket = vi.fn(async () => ({
      ok: true as const,
      value: {
        packetId: "packet-launch",
        packetVersion: 1,
        sourceRevision: 4,
        status: "draft" as const,
        title: "Launch meeting packet",
        objectCount: 1,
        contentSnapshot: packetContentSnapshot,
      },
    }));
    const updatePacket = vi.fn(async () => ({
      ok: true as const,
      value: {
        packetId: "packet-launch",
        status: "draft" as const,
        recipientCount: 1,
        changed: true,
      },
    }));
    const approvePacket = vi.fn(async () => ({
      ok: true as const,
      value: {
        packetId: "packet-launch",
        packetVersion: 1,
        status: "approved" as const,
        contentHash: "a".repeat(64),
        recipientHash: "b".repeat(64),
        recipientCount: 1,
        contentSnapshot: packetContentSnapshot,
        recipientSnapshot: [
          { name: "Demo reviewer", email: "reviewer@example.com" },
        ],
        changed: true,
      },
    }));
    const stagePacketSend = vi.fn(async () => ({
      ok: true as const,
      value: {
        sendRequestId: "22222222-2222-4222-8222-222222222222",
        packetId: "packet-launch",
        status: "awaiting_human_approval" as const,
        packetVersion: 1,
        contentHash: "a".repeat(64),
        recipientHash: "b".repeat(64),
        recipientSnapshot: [
          { name: "Locked recipient", email: "locked@example.com" },
        ],
        recipientCount: 1,
        staged: true as const,
        changed: true,
      },
    }));
    const executePacketSend = vi.fn(async () => ({
      ok: true as const,
      value: {
        mode: "preview_only" as const,
        status: "preview_only" as const,
        sendRequestId: "22222222-2222-4222-8222-222222222222",
        outboundShareId: "22222222-2222-4222-8222-222222222222",
        reason: "resend_unconfigured" as const,
        message: "Preview only: no email was sent." as const,
        preview: {
          subject: "Launch meeting packet",
          recipients: [
            { name: "Demo reviewer", email: "reviewer@example.com" },
          ],
          contentSnapshot: {
            title: "Launch meeting packet",
            content: {
              schemaVersion: 1 as const,
              roomName: "Live demo room",
              sourceRevision: 1,
              objects: [
                {
                  objectId: "note-launch",
                  objectType: "note" as const,
                  title: "Launch decision",
                  payload: { text: "Ship." },
                },
              ],
            },
          },
        },
      },
    }));
    const harness = readyEnvironment({
      withContent: true,
      packetSession: {
        preparePacket,
        updatePacket,
        approvePacket,
        stagePacketSend,
        executePacketSend,
      },
    });

    try {
      render(<DemoCommandCanvas environment={harness.environment} />);
      await screen.findByText("Live demo room");
      await user.click(
        screen.getByRole("button", { name: "Open ChatGPT command drawer" }),
      );
      await waitFor(() => {
        expect(
          registeredTools.some((tool) => tool.name === "prepare_meeting_packet"),
        ).toBe(true);
      });
      const signal = new AbortController().signal;
      const prepareTool = registeredTools.find(
        (tool) => tool.name === "prepare_meeting_packet",
      )!;
      const prepared = await prepareTool.execute(
        { title: "Launch meeting packet", objectIds: ["note-launch"] },
        { signal },
      );

      expect(prepared).toMatchObject({
        ok: true,
        status: "completed",
        data: { packetId: "packet-launch", packetVersion: 1 },
      });
      expect(preparePacket).toHaveBeenCalledWith(
        expect.objectContaining({
          actorType: "agent",
          title: "Launch meeting packet",
          selectedObjectIds: ["note-launch"],
        }),
        signal,
      );
      expect(updatePacket).toHaveBeenCalledWith({
        packetId: "packet-launch",
        title: "Launch meeting packet",
        recipients: [
          { name: "Demo reviewer", email: "reviewer@example.com" },
        ],
      }, signal);
      expect(await screen.findByText("Draft v1")).toBeVisible();

      await user.click(screen.getByRole("button", { name: "Approve packet" }));
      expect(approvePacket).toHaveBeenCalledWith({ packetId: "packet-launch" });
      await screen.findByText("Approved packet v1");

      const sendTool = registeredTools.find(
        (tool) => tool.name === "request_packet_send",
      )!;
      const staged = await sendTool.execute(
        { packetId: "packet-launch" },
        { signal },
      );
      expect(staged).toMatchObject({
        ok: true,
        status: "awaiting_human_approval",
        data: {
          sendRequestId: "22222222-2222-4222-8222-222222222222",
        },
      });
      expect(executePacketSend).not.toHaveBeenCalled();
      expect(await screen.findByRole("heading", { name: "Send packet?" }))
        .toBeVisible();
      const confirmation = screen.getByRole("alertdialog", {
        name: "Send packet?",
      });
      expect(
        within(confirmation).getByText(
          "Locked recipient <locked@example.com>",
        ),
      ).toBeVisible();
      expect(within(confirmation).queryByText(/reviewer@example\.com/i)).toBeNull();

      await user.click(screen.getByRole("button", { name: "SEND" }));
      expect(executePacketSend).toHaveBeenCalledExactlyOnceWith({
        sendRequestId: "22222222-2222-4222-8222-222222222222",
        explicitHostAuthorization: true,
      });
      expect(await screen.findByText("Preview only: not sent")).toBeVisible();
    } finally {
      delete (document as unknown as { modelContext?: unknown }).modelContext;
    }
  });

  it("keeps a button fallback for packet preparation when Site Tools are unavailable", async () => {
    const user = userEvent.setup();
    const preparePacket = vi.fn(async () => ({
      ok: true as const,
      value: {
        packetId: "packet-fallback",
        packetVersion: 1,
        sourceRevision: 4,
        status: "draft" as const,
        title: "CommandCanvas meeting packet",
        objectCount: 1,
        contentSnapshot: {
          ...packetContentSnapshot,
          title: "CommandCanvas meeting packet",
        },
      },
    }));
    const updatePacket = vi.fn(async () => ({
      ok: true as const,
      value: {
        packetId: "packet-fallback",
        status: "draft" as const,
        recipientCount: 1,
        changed: true,
      },
    }));
    const harness = readyEnvironment({
      withContent: true,
      packetId: "packet-fallback",
      packetSession: { preparePacket, updatePacket },
    });

    render(<DemoCommandCanvas environment={harness.environment} />);
    await screen.findByText("Live demo room");
    await user.click(
      screen.getByRole("button", { name: "Open ChatGPT command drawer" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Prepare meeting packet" }),
    );

    expect(preparePacket).toHaveBeenCalledWith(
      expect.objectContaining({ actorType: "human" }),
      undefined,
    );
    expect(await screen.findByText("Draft v1")).toBeVisible();
  });

  it("reconstructs the persisted packet workflow and immutable receipts after reload", async () => {
    const user = userEvent.setup();
    const loadLatestPacketWorkflow = vi.fn(async () => ({
      ok: true as const,
      value: {
        packet: {
          packetId: "packet-reloaded",
          packetVersion: 2,
          sourceRevision: 4,
          status: "approved" as const,
          title: "Launch meeting packet",
          contentSnapshot: packetContentSnapshot,
          recipients: [
            { name: "Demo reviewer", email: "reviewer@example.com" },
          ],
          approvedSnapshot: {
            packetVersion: 2,
            contentHash: "a".repeat(64),
            recipientHash: "b".repeat(64),
            contentSnapshot: packetContentSnapshot,
            recipients: [
              { name: "Demo reviewer", email: "reviewer@example.com" },
            ],
          },
        },
        latestSend: {
          sendRequestId: "22222222-2222-4222-8222-222222222222",
          packetId: "packet-reloaded",
          packetVersion: 2,
          contentHash: "a".repeat(64),
          recipientHash: "b".repeat(64),
          recipients: [
            { name: "Demo reviewer", email: "reviewer@example.com" },
          ],
          status: "cancelled" as const,
          providerMessageId: null,
          deliveryStatus: null,
        },
        activity: [
          {
            receiptId: "33333333-3333-4333-8333-333333333333",
            revision: 5,
            occurredAt: "2026-08-27T16:05:00.000Z",
            actorType: "human" as const,
            actorDisplayName: "Daniel",
            action: "packet_send_cancelled" as const,
            packetId: "packet-reloaded",
            sendRequestId: "22222222-2222-4222-8222-222222222222",
            description: "Daniel cancelled the staged packet send.",
          },
        ],
      },
    }));
    const harness = readyEnvironment({
      packetSession: { loadLatestPacketWorkflow },
    });

    render(<DemoCommandCanvas environment={harness.environment} />);
    await screen.findByText("Live demo room");
    await user.click(
      screen.getByRole("button", { name: "Open ChatGPT command drawer" }),
    );

    expect(await screen.findByText("Approved packet v2")).toBeVisible();
    expect(loadLatestPacketWorkflow).toHaveBeenCalledOnce();
    const activity = screen.getByRole("region", {
      name: "Meeting packet activity",
    });
    expect(
      within(activity).getByText("Daniel cancelled the staged packet send."),
    ).toBeVisible();
    expect(
      screen.getByText("Send request cancelled: no email was sent"),
    ).toBeVisible();
    expect(screen.queryByRole("button", { name: "SEND" })).toBeNull();
  });

  it("refreshes the persisted receipt stream after a packet mutation", async () => {
    const loadLatestPacketWorkflow = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true as const,
        value: { packet: null, latestSend: null, activity: [] },
      })
      .mockResolvedValue({
        ok: true as const,
        value: {
          packet: {
            packetId: "packet-refresh",
            packetVersion: 1,
            sourceRevision: 4,
            status: "draft" as const,
            title: "CommandCanvas meeting packet",
            contentSnapshot: {
              ...packetContentSnapshot,
              title: "CommandCanvas meeting packet",
            },
            recipients: [
              { name: "Demo reviewer", email: "reviewer@example.com" },
            ],
          },
          latestSend: null,
          activity: [
            {
              receiptId: "33333333-3333-4333-8333-333333333333",
              revision: 1,
              occurredAt: "2026-08-27T16:01:00.000Z",
              actorType: "human" as const,
              actorDisplayName: "Daniel",
              action: "packet_prepared" as const,
              packetId: "packet-refresh",
              sendRequestId: null,
              description: "Daniel prepared a meeting packet draft.",
            },
          ],
        },
      });
    const harness = readyEnvironment({
      withContent: true,
      packetId: "packet-refresh",
      packetSession: {
        loadLatestPacketWorkflow,
        preparePacket: async () => ({
          ok: true as const,
          value: {
            packetId: "packet-refresh",
            packetVersion: 1,
            sourceRevision: 4,
            status: "draft" as const,
            title: "CommandCanvas meeting packet",
            objectCount: 1,
            contentSnapshot: {
              ...packetContentSnapshot,
              title: "CommandCanvas meeting packet",
            },
          },
        }),
        updatePacket: async () => ({
          ok: true as const,
          value: {
            packetId: "packet-refresh",
            status: "draft" as const,
            recipientCount: 1,
            changed: true,
          },
        }),
      },
    });
    const user = userEvent.setup();

    render(<DemoCommandCanvas environment={harness.environment} />);
    await screen.findByText("Live demo room");
    await user.click(
      screen.getByRole("button", { name: "Open ChatGPT command drawer" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Prepare meeting packet" }),
    );

    expect(
      await screen.findByText("Daniel prepared a meeting packet draft."),
    ).toBeVisible();
    expect(loadLatestPacketWorkflow).toHaveBeenCalledTimes(2);
  });

  it("persists host cancellation before removing the staged SEND action", async () => {
    const user = userEvent.setup();
    const stagePacketSend = vi.fn(async () => {
      const sendRequestId =
        stagePacketSend.mock.calls.length === 1
          ? "22222222-2222-4222-8222-222222222222"
          : "44444444-4444-4444-8444-444444444444";
      return {
        ok: true as const,
        value: {
          sendRequestId,
          packetId: "packet-cancel",
          status: "awaiting_human_approval" as const,
          packetVersion: 1,
          contentHash: "a".repeat(64),
          recipientHash: "b".repeat(64),
          recipientSnapshot: [
            { name: "Demo reviewer", email: "reviewer@example.com" },
          ],
          recipientCount: 1,
          staged: true as const,
          changed: true,
        },
      };
    });
    const cancelPacketSend = vi.fn(async () => ({
      ok: true as const,
      value: {
        sendRequestId: "22222222-2222-4222-8222-222222222222",
        packetId: "packet-cancel",
        status: "cancelled" as const,
        receiptId: "33333333-3333-4333-8333-333333333333",
        changed: true,
      },
    }));
    const executePacketSend = vi.fn();
    const harness = readyEnvironment({
      withContent: true,
      packetId: "packet-cancel",
      packetSession: {
        preparePacket: async () => ({
          ok: true as const,
          value: {
            packetId: "packet-cancel",
            packetVersion: 1,
            sourceRevision: 4,
            status: "draft" as const,
            title: "CommandCanvas meeting packet",
            objectCount: 1,
            contentSnapshot: {
              ...packetContentSnapshot,
              title: "CommandCanvas meeting packet",
            },
          },
        }),
        updatePacket: async () => ({
          ok: true as const,
          value: {
            packetId: "packet-cancel",
            status: "draft" as const,
            recipientCount: 1,
            changed: true,
          },
        }),
        approvePacket: async () => ({
          ok: true as const,
          value: {
            packetId: "packet-cancel",
            packetVersion: 1,
            status: "approved" as const,
            contentHash: "a".repeat(64),
            recipientHash: "b".repeat(64),
            recipientCount: 1,
            contentSnapshot: {
              ...packetContentSnapshot,
              title: "CommandCanvas meeting packet",
            },
            recipientSnapshot: [
              { name: "Demo reviewer", email: "reviewer@example.com" },
            ],
            changed: true,
          },
        }),
        stagePacketSend,
        cancelPacketSend,
        executePacketSend,
      },
    });

    render(<DemoCommandCanvas environment={harness.environment} />);
    await screen.findByText("Live demo room");
    await user.click(
      screen.getByRole("button", { name: "Open ChatGPT command drawer" }),
    );
    await user.click(
      screen.getByRole("button", { name: "Prepare meeting packet" }),
    );
    await screen.findByText("Draft v1");
    await user.click(screen.getByRole("button", { name: "Approve packet" }));
    await screen.findByText("Approved packet v1");
    await user.click(screen.getByRole("button", { name: "Request email send" }));
    await screen.findByRole("heading", { name: "Send packet?" });
    await user.click(screen.getByRole("button", { name: "Cancel packet send" }));

    expect(cancelPacketSend).toHaveBeenCalledExactlyOnceWith({
      sendRequestId: "22222222-2222-4222-8222-222222222222",
      explicitHostCancellation: true,
    });
    expect(executePacketSend).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "SEND" })).toBeNull();
    expect(
      screen.getByText("Send request cancelled: no email was sent"),
    ).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: "Request email send" }),
    );
    expect(stagePacketSend).toHaveBeenCalledTimes(2);
    expect(await screen.findByRole("heading", { name: "Send packet?" })).toBeVisible();
    expect(
      screen.queryByText("Send request cancelled: no email was sent"),
    ).toBeNull();
  });

  it("refreshes a terminal send failure before allowing a new durable stage", async () => {
    const user = userEvent.setup();
    const firstSendRequestId = "22222222-2222-4222-8222-222222222222";
    const retrySendRequestId = "44444444-4444-4444-8444-444444444444";
    const persistedPacket = {
      packetId: "packet-failure",
      packetVersion: 1,
      sourceRevision: 4,
      status: "approved" as const,
      title: "CommandCanvas meeting packet",
      contentSnapshot: {
        ...packetContentSnapshot,
        title: "CommandCanvas meeting packet",
      },
      recipients: [
        { name: "Demo reviewer", email: "reviewer@example.com" },
      ],
      approvedSnapshot: {
        packetVersion: 1,
        contentHash: "a".repeat(64),
        recipientHash: "b".repeat(64),
        contentSnapshot: {
          ...packetContentSnapshot,
          title: "CommandCanvas meeting packet",
        },
        recipients: [
          { name: "Demo reviewer", email: "reviewer@example.com" },
        ],
      },
    };
    const persistedSend = (sendRequestId: string, status: "awaiting_human_approval" | "failed") => ({
      sendRequestId,
      packetId: "packet-failure",
      packetVersion: 1,
      contentHash: "a".repeat(64),
      recipientHash: "b".repeat(64),
      recipients: [
        { name: "Demo reviewer", email: "reviewer@example.com" },
      ],
      status,
      providerMessageId: null,
      deliveryStatus: null,
    });
    const loadLatestPacketWorkflow = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true as const,
        value: {
          packet: persistedPacket,
          latestSend: persistedSend(
            firstSendRequestId,
            "awaiting_human_approval",
          ),
          activity: [],
        },
      })
      .mockResolvedValueOnce({
        ok: true as const,
        value: {
          packet: persistedPacket,
          latestSend: persistedSend(firstSendRequestId, "failed"),
          activity: [],
        },
      })
      .mockResolvedValueOnce({
        ok: true as const,
        value: {
          packet: persistedPacket,
          latestSend: persistedSend(
            retrySendRequestId,
            "awaiting_human_approval",
          ),
          activity: [],
        },
      });
    const executePacketSend = vi.fn(async () => ({
      ok: false as const,
      error: {
        code: "email_submission_failed",
        message: "Resend did not accept the packet.",
      },
    }));
    const stagePacketSend = vi.fn(async () => ({
      ok: true as const,
      value: {
        sendRequestId: retrySendRequestId,
        packetId: "packet-failure",
        status: "awaiting_human_approval" as const,
        packetVersion: 1,
        contentHash: "a".repeat(64),
        recipientHash: "b".repeat(64),
        recipientSnapshot: persistedPacket.recipients,
        recipientCount: 1,
        staged: true as const,
        changed: true,
      },
    }));
    const harness = readyEnvironment({
      packetSession: {
        loadLatestPacketWorkflow,
        executePacketSend,
        stagePacketSend,
      },
    });

    render(<DemoCommandCanvas environment={harness.environment} />);
    await screen.findByText("Live demo room");

    expect(await screen.findByRole("heading", { name: "Send packet?" })).toBeVisible();
    await user.click(screen.getByRole("button", { name: "SEND" }));

    expect(executePacketSend).toHaveBeenCalledWith({
      sendRequestId: firstSendRequestId,
      explicitHostAuthorization: true,
    });
    expect(await screen.findByText(/send failed/i)).toBeVisible();
    expect(loadLatestPacketWorkflow).toHaveBeenCalledTimes(2);
    await user.click(
      screen.getByRole("button", { name: "Request email send" }),
    );

    expect(stagePacketSend).toHaveBeenCalledOnce();
    expect(await screen.findByRole("heading", { name: "Send packet?" })).toBeVisible();
    expect(screen.queryByText(/send failed/i)).toBeNull();
    expect(loadLatestPacketWorkflow).toHaveBeenCalledTimes(3);
  });

  it("shows an explicit no-signup loading state before a room is verified", () => {
    const environment: DemoCommandCanvasEnvironment = {
      bootstrap: () => new Promise(() => undefined),
      copyInvite: async () => undefined,
      resetDemo: () => undefined,
    };
    render(<DemoCommandCanvas environment={environment} />);

    expect(screen.getByText("Opening your no-signup demo room…")).toBeVisible();
    expect(screen.queryByRole("textbox", { name: /email|password/i })).toBeNull();
  });

  it("does not offer private GPU camera upload when the server feature is disabled", async () => {
    const user = userEvent.setup();
    const harness = readyEnvironment();

    render(
      <DemoCommandCanvas
        environment={harness.environment}
        privateGpuRelayEnabled={false}
      />,
    );

    expect(await screen.findByText("Live demo room")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Open system status" }));
    expect(
      screen.queryByRole("checkbox", {
        name: "Use private GPU hand tracking",
      }),
    ).toBeNull();
  });

  it("renders only actual Presence participants and one remote cursor", async () => {
    const user = userEvent.setup();
    const { environment } = readyEnvironment();
    const { container } = render(<DemoCommandCanvas environment={environment} />);

    expect(await screen.findByText("Live demo room")).toBeVisible();
    expect(screen.getByLabelText("2 participants present")).toBeVisible();
    expect(screen.getByTitle("Daniel · host")).toBeVisible();
    expect(screen.getByTitle("Sarah · participant")).toBeVisible();
    expect(
      container.querySelector(`[data-remote-cursor="${SARAH_ID}"]`),
    ).not.toBeNull();
    expect(screen.queryByText(/fixture collaborator/i)).toBeNull();
    await user.click(
      screen.getByRole("button", { name: "Open ChatGPT command drawer" }),
    );
    expect(screen.getByRole("button", { name: "Start live voice" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Run direct command" })).toBeNull();
    await user.click(screen.getByText("Type a command instead"));
    expect(screen.getByRole("button", { name: "Run direct command" })).toBeVisible();
  });

  it("copies the host invite and exposes an exact reset action", async () => {
    const user = userEvent.setup();
    const { environment, copyInvite, resetDemo, deleteHostedDemoRoom } =
      readyEnvironment();
    render(<DemoCommandCanvas environment={environment} />);
    await screen.findByText("Live demo room");

    await user.click(screen.getByRole("button", { name: "Copy participant invite" }));
    expect(copyInvite).toHaveBeenCalledWith(
      "https://commandcanvas.example/demo?room=room&join=token",
    );
    expect(await screen.findByText("Invite copied")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Reset demo" }));
    expect(deleteHostedDemoRoom).toHaveBeenCalledOnce();
    expect(resetDemo).toHaveBeenCalledOnce();
  });

  it("does not clear or reload the demo when durable room deletion fails", async () => {
    const user = userEvent.setup();
    const { environment, resetDemo, deleteHostedDemoRoom } = readyEnvironment({
      deleteHostedDemoRoom: async () => ({
        ok: false,
        code: "network_unavailable",
        message: "Demo room was not reset. Try again.",
      }),
    });
    render(<DemoCommandCanvas environment={environment} />);
    await screen.findByText("Live demo room");

    await user.click(screen.getByRole("button", { name: "Reset demo" }));

    expect(deleteHostedDemoRoom).toHaveBeenCalledOnce();
    expect(resetDemo).not.toHaveBeenCalled();
    const resetError = screen.getByText("Demo room was not reset. Try again.");
    expect(resetError).toHaveAttribute("role", "alert");
  });

  it("lets a participant leave local demo state without deleting the host room", async () => {
    const user = userEvent.setup();
    const { environment, resetDemo, deleteHostedDemoRoom } = readyEnvironment({
      role: "participant",
    });
    render(<DemoCommandCanvas environment={environment} />);
    await screen.findByText("Live demo room");

    await user.click(screen.getByRole("button", { name: "Reset demo" }));

    expect(deleteHostedDemoRoom).not.toHaveBeenCalled();
    expect(resetDemo).toHaveBeenCalledOnce();
  });

  it("keeps a failed service state honest and retryable", async () => {
    const resetDemo = vi.fn();
    const environment: DemoCommandCanvasEnvironment = {
      bootstrap: async () => ({
        ok: false,
        code: "service_unavailable",
        message: "The shared demo service is unavailable.",
      }),
      copyInvite: async () => undefined,
      resetDemo,
    };
    const user = userEvent.setup();
    render(<DemoCommandCanvas environment={environment} />);

    expect(await screen.findByText("Demo room unavailable")).toBeVisible();
    expect(screen.getByText("The shared demo service is unavailable.")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    expect(resetDemo).toHaveBeenCalledOnce();
  });

  it("updates collaboration status when Realtime degrades without losing the canvas", async () => {
    const harness = readyEnvironment();
    render(<DemoCommandCanvas environment={harness.environment} />);
    await screen.findByText("Live demo room");

    harness.setSnapshot({
      ...harness.session.getSnapshot(),
      status: "degraded",
      realtimeStatus: "channel_error",
      lastError: {
        code: "realtime_channel_error",
        message: "Live collaboration is unavailable; verified room state is preserved.",
      },
    });

    await waitFor(() => {
      expect(screen.getByText("Realtime unavailable · state preserved")).toBeVisible();
    });
    expect(screen.getByText("Live demo room")).toBeVisible();
  });

  it("constructs one canvas sketch transformer and shares it across UI and WebMCP paths", async () => {
    const user = userEvent.setup();
    const registeredTools: RegisteredWebMcpTool[] = [];
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: {
        registerTool: vi.fn(async (tool: RegisteredWebMcpTool) => {
          registeredTools.push(tool);
        }),
      },
    });
    const transform = vi.fn().mockResolvedValue({
      ok: true,
      diagramObjectId: "diagram-result",
      receiptId: "receipt-transform",
      revision: 2,
      provider: "openai",
      model: "gpt-5.6-terra",
    });
    const createSketchTransformer = vi.fn(() => ({ transform }));
    const harness = readyEnvironment({
      withSketch: true,
      createSketchTransformer,
    });

    try {
      render(<DemoCommandCanvas environment={harness.environment} />);
      await screen.findByText("Live demo room");
      await user.click(
        screen.getByRole("button", { name: "Select Rough architecture" }),
      );
      await waitFor(() => {
        expect(
          registeredTools.some((tool) => tool.name === "transform_sketch"),
        ).toBe(true);
      });
      const webMcpSignal = new AbortController().signal;
      const transformTool = registeredTools.find(
        (tool) => tool.name === "transform_sketch",
      )!;

      await transformTool.execute(
        {
          sketchId: "sketch-source",
          instruction: "Clarify the API boundary.",
        },
        { signal: webMcpSignal },
      );
      await user.click(screen.getByRole("button", { name: "Make usable" }));

      expect(createSketchTransformer).toHaveBeenCalledExactlyOnceWith({
        store: harness.store,
        session: harness.session,
      });
      expect(transform).toHaveBeenNthCalledWith(1, {
        sketchObjectId: "sketch-source",
        instruction: "Clarify the API boundary.",
        outputKind: "auto",
        source: "webmcp",
        signal: webMcpSignal,
      });
      expect(transform).toHaveBeenNthCalledWith(2, {
        sketchObjectId: "sketch-source",
        instruction: "Make this usable as a professional visual.",
        outputKind: "auto",
        source: "typed",
      });
    } finally {
      delete (document as unknown as { modelContext?: unknown }).modelContext;
    }
  });
});
