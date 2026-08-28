import { StrictMode } from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const TOKEN = "a".repeat(43);

const fakes = vi.hoisted(() => {
  const order: string[] = [];
  const webMcpSignals: AbortSignal[] = [];
  const disposeSession = vi.fn(async () => undefined);
  const unsubscribeSession = vi.fn();
  const subscribeSession = vi.fn((listener: () => void) => {
    roomListener = listener;
    return unsubscribeSession;
  });
  const startSession = vi.fn(
    async (
      hydrateCanvas: (state: unknown) => unknown,
      state: unknown,
    ) => {
      hydrateCanvas(state);
      return { ok: true as const, roomId: ROOM_ID };
    },
  );
  let roomListener: (() => void) | null = null;
  let role: "host" | "participant" = "participant";
  let accessToken = "bootstrap.header.signature";
  const acceptInvitation = vi.fn(async () => ({
    ok: true as const,
    value: { roomId: ROOM_ID, role: "participant" as const, joined: true },
  }));
  const createInvitation = vi.fn(
    async (
      requestAccessToken: string,
      roomId: string,
      input: { email: string; displayName: string },
    ) => ({
      ok: true as const,
      value: {
        invitationId: "33333333-3333-4333-8333-333333333333",
        roomId,
        expiresAt: "2026-08-29T12:00:00.000Z",
        joinUrl: `https://commandcanvas.example/meet#invite=${TOKEN}`,
        delivery: {
          status: "preview_only" as const,
          message: `${input.displayName} can use the secure link.`,
        },
        requestAccessToken,
      },
    }),
  );
  const getSession = vi.fn(async () => ({
    data: {
      session: {
        access_token: accessToken,
        user: {
          id: USER_ID,
          email: "sarah@example.com",
          email_confirmed_at: "2026-08-28T12:00:00.000Z",
          is_anonymous: false,
        },
      },
    },
    error: null,
  }));
  const client = {
    auth: {
      getSession,
      signOut: vi.fn(),
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
    },
  };
  return {
    order,
    acceptInvitation,
    createInvitation,
    client,
    webMcpSignals,
    disposeSession,
    getSession,
    startSession,
    subscribeSession,
    unsubscribeSession,
    get roomListener() {
      return roomListener;
    },
    setRoomListener(listener: () => void) {
      roomListener = listener;
    },
    setRole(nextRole: "host" | "participant") {
      role = nextRole;
    },
    setAccessToken(nextAccessToken: string) {
      accessToken = nextAccessToken;
    },
    get role() {
      return role;
    },
  };
});

vi.mock("@/lib/supabase/browser-client", () => ({
  createBrowserSupabaseClient: vi.fn(() => {
    fakes.order.push("client");
    return { ok: true, client: fakes.client };
  }),
}));

vi.mock("@/lib/supabase/meeting-api", () => ({
  createBrowserMeetingApi: vi.fn(({ accessToken }: { accessToken: string }) => ({
    acceptInvitation: fakes.acceptInvitation,
    createMeeting: vi.fn(),
    createInvitation: (
      roomId: string,
      input: { email: string; displayName: string },
    ) => fakes.createInvitation(accessToken, roomId, input),
  })),
}));

vi.mock("@/lib/demo/room-session", () => ({
  createDemoRoomSession: vi.fn((dependencies) => {
    const snapshot = {
      status: "ready",
      realtimeStatus: "connected",
      identity: { userId: USER_ID, isAnonymous: false },
      roomId: ROOM_ID,
      membership: {
        roomId: ROOM_ID,
        userId: USER_ID,
        role: fakes.role,
        displayName: fakes.role === "host" ? "Danny" : "Sarah",
        color: fakes.role === "host" ? "#0EA5E9" : "#A855F7",
      },
      state: {
        roomId: ROOM_ID,
        revision: 0,
        objects: {},
        receipts: [],
        undoneReceiptIds: [],
      },
      joinAccess: null,
      presence: [],
      cursors: {},
      commandPending: false,
      lastError: null,
    };
    return {
      start: vi.fn(() =>
        fakes.startSession(dependencies.hydrateCanvas, snapshot.state),
      ),
      getSnapshot: () => snapshot,
      getAccessToken: () => "header.payload.signature",
      subscribe: fakes.subscribeSession,
      dispose: fakes.disposeSession,
      submitCommand: vi.fn(),
      publishCursor: vi.fn(),
      loadLatestPacketWorkflow: vi.fn(async () => ({
        ok: true as const,
        value: { packet: null, latestSend: null, activity: [] },
      })),
      preparePacket: vi.fn(),
      updatePacket: vi.fn(),
      approvePacket: vi.fn(),
      stagePacketSend: vi.fn(),
      cancelPacketSend: vi.fn(),
      executePacketSend: vi.fn(),
    };
  }),
}));

vi.mock("@/components/command-canvas/command-canvas-room", () => ({
  CommandCanvasRoom: ({ meetingPacketPanel }: { meetingPacketPanel?: React.ReactNode }) => (
    <div data-testid="meeting-room">
      Shared canvas
      {meetingPacketPanel}
    </div>
  ),
}));
vi.mock("@/components/command-canvas/meeting-filmstrip", () => ({
  MeetingFilmstrip: () => <div>Filmstrip</div>,
}));
vi.mock("@/lib/vision/canvas-transform", () => ({
  createCanvasSketchTransformer: () => ({ transform: vi.fn() }),
}));
vi.mock("@/lib/webmcp/document-target", () => ({
  resolveDocumentWebMcpTarget: () => ({
    registerTool: vi.fn(async (_tool, options) => {
      fakes.webMcpSignals.push(options.signal);
    }),
  }),
}));

import { MeetingCommandCanvas } from "@/components/command-canvas/meeting-command-canvas";

describe("meeting invitation StrictMode handshake", () => {
  beforeEach(() => {
    fakes.order.length = 0;
    fakes.webMcpSignals.length = 0;
    fakes.disposeSession.mockClear();
    fakes.acceptInvitation.mockClear();
    fakes.createInvitation.mockClear();
    fakes.getSession.mockClear();
    fakes.startSession.mockClear();
    fakes.subscribeSession.mockClear();
    fakes.unsubscribeSession.mockClear();
    fakes.setRole("participant");
    fakes.setAccessToken("bootstrap.header.signature");
    window.history.replaceState(null, "", `/meet#invite=${TOKEN}`);
  });

  it("scrubs before client work, retains the token across effect replay, accepts, and enters", async () => {
    const originalReplace = window.history.replaceState.bind(window.history);
    const replace = vi
      .spyOn(window.history, "replaceState")
      .mockImplementation((data, unused, url) => {
        fakes.order.push("scrub");
        originalReplace(data, unused, url);
      });

    const view = render(
      <StrictMode>
        <MeetingCommandCanvas />
      </StrictMode>,
    );

    expect(await screen.findByTestId("meeting-room")).toBeVisible();
    await waitFor(() => expect(fakes.acceptInvitation).toHaveBeenCalledTimes(1));
    expect(fakes.acceptInvitation).toHaveBeenCalledWith(
      { token: TOKEN },
      expect.any(AbortSignal),
    );
    expect(fakes.order[0]).toBe("scrub");
    expect(fakes.order.indexOf("scrub")).toBeLessThan(
      fakes.order.indexOf("client"),
    );
    expect(window.location.hash).toBe("");
    expect(window.location.search).toBe(`?room=${ROOM_ID}`);
    await waitFor(() =>
      expect(
        fakes.webMcpSignals.filter((signal) => !signal.aborted),
      ).toHaveLength(10),
    );
    const registrationCount = fakes.webMcpSignals.length;
    fakes.roomListener?.();
    await waitFor(() =>
      expect(fakes.webMcpSignals).toHaveLength(registrationCount),
    );
    expect(
      fakes.webMcpSignals.filter((signal) => !signal.aborted),
    ).toHaveLength(10);
    expect(fakes.disposeSession).not.toHaveBeenCalled();
    view.unmount();
    expect(fakes.webMcpSignals.every((signal) => signal.aborted)).toBe(true);
    await waitFor(() => expect(fakes.disposeSession).toHaveBeenCalledTimes(1));
    replace.mockRestore();
  });

  it("renders the reviewed packet workflow only for a standard-room host", async () => {
    fakes.setRole("host");
    window.history.replaceState(null, "", `/meet#invite=${TOKEN}`);

    render(<MeetingCommandCanvas />);

    expect(await screen.findByTestId("meeting-room")).toBeVisible();
    expect(
      await screen.findByRole("button", { name: "Prepare meeting packet" }),
    ).toBeVisible();
  });

  it("refreshes the Supabase access token immediately before an invitation request", async () => {
    const user = userEvent.setup();
    fakes.setRole("host");
    render(<MeetingCommandCanvas />);

    expect(await screen.findByTestId("meeting-room")).toBeVisible();
    const bootstrapSessionReads = fakes.getSession.mock.calls.length;
    await user.click(screen.getByRole("button", { name: "Invite" }));
    await user.type(screen.getByLabelText("Display name"), "Mike");
    await user.type(screen.getByLabelText("Email"), "mike@example.com");

    fakes.setAccessToken("fresh.one.signature");
    await user.click(screen.getByRole("button", { name: "Create invitation" }));
    await waitFor(() => expect(fakes.createInvitation).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("Preview only")).toBeVisible();

    expect(fakes.getSession).toHaveBeenCalledTimes(bootstrapSessionReads + 1);
    expect(fakes.createInvitation.mock.calls.map(([token]) => token)).toEqual([
      "fresh.one.signature",
    ]);
  });

  it("does not enter a room after invitation acceptance resolves post-unmount", async () => {
    let resolveAcceptance!: (result: {
      ok: true;
      value: { roomId: string; role: "participant"; joined: true };
    }) => void;
    fakes.acceptInvitation.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveAcceptance = resolve;
        }),
    );
    const view = render(<MeetingCommandCanvas />);

    await waitFor(() => expect(fakes.acceptInvitation).toHaveBeenCalledTimes(1));
    expect(window.location.pathname).toBe("/meet");
    expect(window.location.search).toBe("");
    view.unmount();
    resolveAcceptance({
      ok: true,
      value: { roomId: ROOM_ID, role: "participant", joined: true },
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(fakes.startSession).not.toHaveBeenCalled();
    expect(fakes.subscribeSession).not.toHaveBeenCalled();
    expect(window.location.search).toBe("");
  });

  it("disposes a room start that resolves post-unmount without committing history or a subscription", async () => {
    let resolveStart!: (result: { ok: true; roomId: string }) => void;
    fakes.startSession.mockImplementationOnce(
      async (hydrateCanvas, state) => {
        hydrateCanvas(state);
        return new Promise((resolve) => {
          resolveStart = resolve;
        });
      },
    );
    const view = render(<MeetingCommandCanvas />);

    await waitFor(() => expect(fakes.startSession).toHaveBeenCalledTimes(1));
    expect(window.location.search).toBe("");
    view.unmount();
    resolveStart({ ok: true, roomId: ROOM_ID });
    await waitFor(() => expect(fakes.disposeSession).toHaveBeenCalledTimes(1));

    expect(fakes.subscribeSession).not.toHaveBeenCalled();
    expect(window.location.search).toBe("");
  });
});
