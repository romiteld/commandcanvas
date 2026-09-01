import { StrictMode } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const TOKEN = "a".repeat(43);
const OPENAI_API_KEY = `sk-proj-${"a".repeat(40)}`;
const SAVED_OPENAI_CREDENTIAL = {
  configured: true,
  fingerprint: "sha256:0123456789abcdef",
  updatedAt: "2026-09-01T03:12:34.000Z",
};

interface FakeAuthSession {
  access_token: string;
  user: {
    id: string;
    email: string;
    email_confirmed_at: string;
    is_anonymous: boolean;
  };
}

interface FakeSessionResult {
  data: { session: FakeAuthSession | null };
  error: { message: string } | null;
}

const fakes = vi.hoisted(() => {
  const order: string[] = [];
  const webMcpSignals: AbortSignal[] = [];
  const disposeSession = vi.fn(async () => undefined);
  const submitCommand = vi.fn();
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
  let invitationStatus:
    | "created"
    | "sending"
    | "preview_only"
    | "reconciling"
    | "submitted"
    | "delivered"
    | "bounced"
    | "complained"
    | "failed"
    | "suppressed" = "preview_only";
  let invitationFailure: { code: string; message: string } | null = null;
  let meetingFailure: { code: string; message: string } | null = null;
  let sessionError: { message: string } | null = null;
  let roomOnCommand:
    | ((command: unknown, source: unknown) => unknown)
    | null = null;
  let roomProps: {
    openAiApiKey?: string;
    onOpenAiApiKeyChange?: (value: string) => void;
    realtimeVoice?: {
      useSavedOpenAiCredential?: boolean;
      onUseSavedOpenAiCredentialChange?: (value: boolean) => void;
      savedOpenAiCredential?: {
        configured: boolean;
        fingerprint?: string;
        updatedAt?: string;
        busy: boolean;
        error?: string;
        onSave: (apiKey: string) => Promise<void> | void;
        onDelete: () => Promise<void> | void;
      };
    };
  } | null = null;
  let sketchCredentialOptions: {
    getOpenAiApiKey?: () => string;
    getUseSavedOpenAiCredential?: () => boolean;
  } | null = null;
  const loadOpenAiCredential = vi.fn();
  const saveOpenAiCredential = vi.fn();
  const deleteOpenAiCredential = vi.fn();
  const createOpenAiCredentialApi = vi.fn(() => ({
    load: loadOpenAiCredential,
    save: saveOpenAiCredential,
    clear: deleteOpenAiCredential,
  }));
  const signOut = vi.fn(async () => ({ error: null }));
  const signInWithOtp = vi.fn(async () => ({ data: {}, error: null }));
  const verifyOtp = vi.fn(async () => ({
    data: {
      session: { access_token: "invited.header.signature" },
      user: {
        id: "44444444-4444-4444-8444-444444444444",
        email: "mike@example.com",
        is_anonymous: false,
      },
    },
    error: null,
  }));
  const acceptInvitation = vi.fn(
    async (): Promise<
      | {
          ok: true;
          value: {
            roomId: string;
            role: "participant";
            joined: true;
          };
        }
      | { ok: false; error: { code: string; message: string } }
    > => ({
      ok: true,
      value: { roomId: ROOM_ID, role: "participant", joined: true },
    }),
  );
  const createInvitation = vi.fn(
    async (
      requestAccessToken: string,
      roomId: string,
      input: { email: string; displayName: string },
    ) => {
      if (invitationFailure)
        return { ok: false as const, error: invitationFailure };
      return {
        ok: true as const,
        value: {
          invitationId: "33333333-3333-4333-8333-333333333333",
          roomId,
          expiresAt: "2026-08-29T12:00:00.000Z",
          joinUrl: `https://commandcanvas.example/meet#invite=${TOKEN}`,
          delivery: {
            status: invitationStatus,
            message: `${input.displayName} can use the secure link.`,
          },
          requestAccessToken,
        },
      };
    },
  );
  const createMeeting = vi.fn(
    async (
      requestAccessToken: string,
      input: { name: string; displayName: string; color: string },
    ) =>
      meetingFailure
        ? { ok: false as const, error: meetingFailure }
        : {
            ok: true as const,
            value: { roomId: ROOM_ID, role: "host" as const, joined: true },
            requestAccessToken,
            input,
          },
  );
  const loadInvitationDelivery = vi.fn();
  const loadUserProfile = vi.fn();
  const createUserProfileApi = vi.fn(() => ({
    load: loadUserProfile,
    save: vi.fn(),
  }));
  const getSession = vi.fn(async (): Promise<FakeSessionResult> => ({
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
    error: sessionError,
  }));
  const refreshSession = vi.fn(async (): Promise<FakeSessionResult> => ({
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
      refreshSession,
      signOut,
      signInWithOtp,
      verifyOtp,
      onAuthStateChange: vi.fn(() => ({
        data: { subscription: { unsubscribe: vi.fn() } },
      })),
    },
  };
  return {
    order,
    acceptInvitation,
    createInvitation,
    createMeeting,
    loadInvitationDelivery,
    loadUserProfile,
    createUserProfileApi,
    client,
    webMcpSignals,
    disposeSession,
    submitCommand,
    getSession,
    refreshSession,
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
    setInvitationStatus(nextStatus: typeof invitationStatus) {
      invitationStatus = nextStatus;
    },
    setInvitationFailure(nextFailure: typeof invitationFailure) {
      invitationFailure = nextFailure;
    },
    setMeetingFailure(nextFailure: typeof meetingFailure) {
      meetingFailure = nextFailure;
    },
    setSessionError(nextError: typeof sessionError) {
      sessionError = nextError;
    },
    setRoomOnCommand(
      nextOnCommand: ((command: unknown, source: unknown) => unknown) | null,
    ) {
      roomOnCommand = nextOnCommand;
    },
    setRoomProps(nextRoomProps: typeof roomProps) {
      roomProps = nextRoomProps;
    },
    get roomProps() {
      return roomProps;
    },
    setSketchCredentialOptions(nextOptions: typeof sketchCredentialOptions) {
      sketchCredentialOptions = nextOptions;
    },
    get sketchCredentialOptions() {
      return sketchCredentialOptions;
    },
    loadOpenAiCredential,
    saveOpenAiCredential,
    deleteOpenAiCredential,
    createOpenAiCredentialApi,
    signOut,
    signInWithOtp,
    verifyOtp,
    get roomOnCommand() {
      return roomOnCommand;
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
    createMeeting: (input: {
      name: string;
      displayName: string;
      color: string;
    }) => fakes.createMeeting(accessToken, input),
    createInvitation: (
      roomId: string,
      input: { email: string; displayName: string },
    ) => fakes.createInvitation(accessToken, roomId, input),
    loadInvitationDelivery: fakes.loadInvitationDelivery,
  })),
}));

vi.mock("@/lib/user-profiles/browser-api", () => ({
  createBrowserUserProfileApi: fakes.createUserProfileApi,
}));

vi.mock("@/lib/demo/room-session", () => ({
  createDemoRoomSession: vi.fn((dependencies) => {
    dependencies.createSketchTransformApi("header.payload.signature");
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
      submitCommand: fakes.submitCommand,
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
  CommandCanvasRoom: (props: {
    meetingPacketPanel?: React.ReactNode;
    onCommand?: (command: unknown, source: unknown) => unknown;
    openAiApiKey?: string;
    onOpenAiApiKeyChange?: (value: string) => void;
    realtimeVoice?: {
      useSavedOpenAiCredential?: boolean;
      onUseSavedOpenAiCredentialChange?: (value: boolean) => void;
      savedOpenAiCredential?: {
        configured: boolean;
        fingerprint?: string;
        updatedAt?: string;
        busy: boolean;
        error?: string;
        onSave: (apiKey: string) => Promise<void> | void;
        onDelete: () => Promise<void> | void;
      };
    };
  }) => {
    const { meetingPacketPanel, onCommand } = props;
    fakes.setRoomOnCommand(onCommand ?? null);
    fakes.setRoomProps(props);
    return (
      <div data-testid="meeting-room">
        Shared canvas
        {meetingPacketPanel}
      </div>
    );
  },
}));
vi.mock("@/lib/openai-credentials/browser-api", () => ({
  createBrowserOpenAiCredentialApi: fakes.createOpenAiCredentialApi,
}));
vi.mock("@/lib/vision/browser-api", () => ({
  createBrowserSketchTransformApi: vi.fn((options) => {
    fakes.setSketchCredentialOptions(options);
    return { transform: vi.fn() };
  }),
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
    fakes.submitCommand.mockReset();
    fakes.setRoomOnCommand(null);
    fakes.setRoomProps(null);
    fakes.setSketchCredentialOptions(null);
    fakes.loadOpenAiCredential.mockReset();
    fakes.loadOpenAiCredential.mockResolvedValue({
      ok: true,
      value: { configured: false },
    });
    fakes.saveOpenAiCredential.mockReset();
    fakes.saveOpenAiCredential.mockResolvedValue({
      ok: true,
      value: SAVED_OPENAI_CREDENTIAL,
    });
    fakes.deleteOpenAiCredential.mockReset();
    fakes.deleteOpenAiCredential.mockResolvedValue({
      ok: true,
      value: { configured: false },
    });
    fakes.createOpenAiCredentialApi.mockClear();
    fakes.signOut.mockClear();
    fakes.signInWithOtp.mockClear();
    fakes.verifyOtp.mockClear();
    fakes.acceptInvitation.mockClear();
    fakes.createInvitation.mockClear();
    fakes.createMeeting.mockClear();
    fakes.loadInvitationDelivery.mockReset();
    fakes.loadInvitationDelivery.mockResolvedValue({
      ok: false,
      error: {
        code: "request_failed",
        message: "Delivery refresh is temporarily unavailable.",
      },
    });
    fakes.loadUserProfile.mockReset();
    fakes.loadUserProfile.mockResolvedValue({ ok: true, value: null });
    fakes.createUserProfileApi.mockClear();
    fakes.getSession.mockClear();
    fakes.refreshSession.mockClear();
    fakes.startSession.mockClear();
    fakes.subscribeSession.mockClear();
    fakes.unsubscribeSession.mockClear();
    fakes.setRole("participant");
    fakes.setAccessToken("bootstrap.header.signature");
    fakes.setInvitationStatus("preview_only");
    fakes.setInvitationFailure(null);
    fakes.setMeetingFailure(null);
    fakes.setSessionError(null);
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
      ).toHaveLength(11),
    );
    const registrationCount = fakes.webMcpSignals.length;
    fakes.roomListener?.();
    await waitFor(() =>
      expect(fakes.webMcpSignals).toHaveLength(registrationCount),
    );
    expect(
      fakes.webMcpSignals.filter((signal) => !signal.aborted),
    ).toHaveLength(11);
    expect(fakes.disposeSession).not.toHaveBeenCalled();
    view.unmount();
    expect(fakes.webMcpSignals.every((signal) => signal.aborted)).toBe(true);
    await waitFor(() => expect(fakes.disposeSession).toHaveBeenCalledTimes(1));
    replace.mockRestore();
  });

  it("keeps a rejected invitation in page memory while the user switches to the invited account", async () => {
    const user = userEvent.setup();
    fakes.acceptInvitation
      .mockResolvedValueOnce({
        ok: false as const,
        error: {
          code: "invitation_unavailable",
          message:
            "This invitation is unavailable for the signed-in account.",
        },
      })
      .mockResolvedValueOnce({
        ok: true as const,
        value: { roomId: ROOM_ID, role: "participant" as const, joined: true },
      });

    render(<MeetingCommandCanvas />);

    expect(
      await screen.findByRole("heading", { name: "Switch to the invited account" }),
    ).toBeVisible();
    expect(screen.getByText(/signed in as sarah@example\.com/i)).toBeVisible();
    expect(window.location.hash).toBe("");
    expect(window.location.href).not.toContain(TOKEN);
    expect(JSON.stringify(window.localStorage)).not.toContain(TOKEN);
    expect(JSON.stringify(window.sessionStorage)).not.toContain(TOKEN);

    await user.click(
      screen.getByRole("button", { name: "Switch account and continue" }),
    );

    expect(fakes.signOut).toHaveBeenCalledWith({ scope: "local" });
    expect(
      await screen.findByRole("heading", { name: "Verify your invitation" }),
    ).toBeVisible();
    expect(window.location.href).not.toContain(TOKEN);

    await user.type(screen.getByLabelText("Email"), "mike@example.com");
    await user.click(screen.getByRole("button", { name: "Email me a code" }));
    expect(fakes.signInWithOtp).toHaveBeenCalledWith({
      email: "mike@example.com",
      options: { shouldCreateUser: true },
    });

    await user.type(screen.getByLabelText("Verification code"), "123456");
    await user.click(screen.getByRole("button", { name: "Verify email" }));

    expect(await screen.findByTestId("meeting-room")).toBeVisible();
    expect(fakes.verifyOtp).toHaveBeenCalledWith({
      email: "mike@example.com",
      token: "123456",
      type: "email",
    });
    expect(fakes.acceptInvitation).toHaveBeenNthCalledWith(
      2,
      { token: TOKEN },
      expect.any(AbortSignal),
    );
    expect(window.location.hash).toBe("");
    expect(window.location.search).toBe(`?room=${ROOM_ID}`);
  });

  it("loads a saved credential after verified room entry and selects it for voice and vision", async () => {
    fakes.loadOpenAiCredential.mockResolvedValueOnce({
      ok: true,
      value: SAVED_OPENAI_CREDENTIAL,
    });

    render(<MeetingCommandCanvas />);

    expect(await screen.findByTestId("meeting-room")).toBeVisible();
    await waitFor(() =>
      expect(fakes.createOpenAiCredentialApi).toHaveBeenCalledWith({
        accessToken: "bootstrap.header.signature",
      }),
    );
    expect(fakes.startSession.mock.invocationCallOrder[0]).toBeLessThan(
      fakes.createOpenAiCredentialApi.mock.invocationCallOrder[0]!,
    );
    expect(fakes.loadOpenAiCredential).toHaveBeenCalledWith(
      expect.any(AbortSignal),
    );
    await waitFor(() =>
      expect(fakes.roomProps?.realtimeVoice).toMatchObject({
        useSavedOpenAiCredential: true,
        savedOpenAiCredential: SAVED_OPENAI_CREDENTIAL,
      }),
    );
    expect(
      fakes.sketchCredentialOptions?.getUseSavedOpenAiCredential?.(),
    ).toBe(true);
    expect(fakes.sketchCredentialOptions?.getOpenAiApiKey?.()).toBe("");
  });

  it("loads a returning permanent user's saved profile before rendering the host form", async () => {
    window.history.replaceState(null, "", "/meet");
    fakes.loadUserProfile.mockResolvedValueOnce({
      ok: true,
      value: {
        displayName: "Daniel",
        color: "#0EA5E9",
        updatedAt: "2026-09-01T19:00:00.000Z",
      },
    });

    render(<MeetingCommandCanvas />);

    expect(
      await screen.findByRole("heading", { name: "Create a shared spatial room" }),
    ).toBeVisible();
    expect(screen.getByLabelText("Your display name")).toHaveValue("Daniel");
    expect(fakes.createUserProfileApi).toHaveBeenCalledWith({
      accessToken: "bootstrap.header.signature",
    });
    expect(fakes.loadUserProfile).toHaveBeenCalledWith(expect.any(AbortSignal));
  });

  it("recovers an expired cached session through refresh before profile setup", async () => {
    window.history.replaceState(null, "", "/meet");
    fakes.getSession.mockResolvedValueOnce({
      data: { session: null },
      error: { message: "cached session expired" },
    });

    render(<MeetingCommandCanvas />);

    expect(
      await screen.findByRole("heading", { name: "Create a shared spatial room" }),
    ).toBeVisible();
    expect(fakes.refreshSession).toHaveBeenCalledTimes(1);
  });

  it("preserves the entered room and display names after a create failure", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/meet");
    fakes.setMeetingFailure({
      code: "service_unavailable",
      message: "Room could not be created. Try again.",
    });
    render(<MeetingCommandCanvas />);

    expect(
      await screen.findByRole("heading", { name: "Create a shared spatial room" }),
    ).toBeVisible();
    const roomName = screen.getByLabelText("Room name");
    const displayName = screen.getByLabelText("Your display name");
    await user.clear(roomName);
    await user.type(roomName, "Launch recovery room");
    await user.type(displayName, "Daniel Romitelli");
    await user.click(screen.getByRole("button", { name: "Enter CommandCanvas" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Room could not be created. Try again.",
    );
    expect(screen.getByLabelText("Room name")).toHaveValue(
      "Launch recovery room",
    );
    expect(screen.getByLabelText("Your display name")).toHaveValue(
      "Daniel Romitelli",
    );
  });

  it("preserves the entered values when session lookup throws before creation", async () => {
    const user = userEvent.setup();
    window.history.replaceState(null, "", "/meet");
    render(<MeetingCommandCanvas />);

    expect(
      await screen.findByRole("heading", { name: "Create a shared spatial room" }),
    ).toBeVisible();
    await user.clear(screen.getByLabelText("Room name"));
    await user.type(screen.getByLabelText("Room name"), "Session recovery room");
    await user.type(screen.getByLabelText("Your display name"), "Daniel");
    fakes.getSession.mockRejectedValueOnce(new Error("network unavailable"));
    await user.click(screen.getByRole("button", { name: "Enter CommandCanvas" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your session could not be refreshed. Try again.",
    );
    expect(screen.getByLabelText("Room name")).toHaveValue(
      "Session recovery room",
    );
    expect(screen.getByLabelText("Your display name")).toHaveValue("Daniel");
  });

  it("saves a confirmed key, clears its raw state, and selects the saved credential everywhere", async () => {
    render(<MeetingCommandCanvas />);

    expect(await screen.findByTestId("meeting-room")).toBeVisible();
    await waitFor(() =>
      expect(fakes.roomProps?.realtimeVoice?.savedOpenAiCredential).toBeDefined(),
    );
    await act(async () => {
      fakes.roomProps?.onOpenAiApiKeyChange?.(OPENAI_API_KEY);
    });
    expect(fakes.roomProps?.openAiApiKey).toBe(OPENAI_API_KEY);

    await act(async () => {
      await fakes.roomProps?.realtimeVoice?.savedOpenAiCredential?.onSave(
        OPENAI_API_KEY,
      );
    });

    expect(fakes.saveOpenAiCredential).toHaveBeenCalledWith(
      { apiKey: OPENAI_API_KEY, confirmSave: true },
      expect.any(AbortSignal),
    );
    expect(fakes.createOpenAiCredentialApi).toHaveBeenLastCalledWith({
      accessToken: "header.payload.signature",
    });
    await waitFor(() => expect(fakes.roomProps?.openAiApiKey).toBe(""));
    expect(fakes.roomProps?.realtimeVoice).toMatchObject({
      useSavedOpenAiCredential: true,
      savedOpenAiCredential: SAVED_OPENAI_CREDENTIAL,
    });
    expect(fakes.sketchCredentialOptions?.getOpenAiApiKey?.()).toBe("");
    expect(
      fakes.sketchCredentialOptions?.getUseSavedOpenAiCredential?.(),
    ).toBe(true);
    expect(
      JSON.stringify({
        openAiApiKey: fakes.roomProps?.openAiApiKey,
        useSavedOpenAiCredential:
          fakes.roomProps?.realtimeVoice?.useSavedOpenAiCredential,
        savedOpenAiCredential: {
          configured:
            fakes.roomProps?.realtimeVoice?.savedOpenAiCredential?.configured,
          fingerprint:
            fakes.roomProps?.realtimeVoice?.savedOpenAiCredential?.fingerprint,
          updatedAt:
            fakes.roomProps?.realtimeVoice?.savedOpenAiCredential?.updatedAt,
          error: fakes.roomProps?.realtimeVoice?.savedOpenAiCredential?.error,
        },
      }),
    ).not.toContain(OPENAI_API_KEY);
  });

  it("preserves a temporary key in tab memory when saving it fails", async () => {
    fakes.saveOpenAiCredential.mockResolvedValueOnce({
      ok: false,
      error: {
        code: "credential_unavailable",
        message: "OpenAI credential could not be saved. Try again.",
      },
    });
    render(<MeetingCommandCanvas />);

    expect(await screen.findByTestId("meeting-room")).toBeVisible();
    await waitFor(() =>
      expect(fakes.roomProps?.realtimeVoice?.savedOpenAiCredential).toBeDefined(),
    );
    await act(async () => {
      fakes.roomProps?.onOpenAiApiKeyChange?.(OPENAI_API_KEY);
    });
    await act(async () => {
      await fakes.roomProps?.realtimeVoice?.savedOpenAiCredential?.onSave(
        OPENAI_API_KEY,
      );
    });

    expect(fakes.roomProps?.openAiApiKey).toBe(OPENAI_API_KEY);
    expect(fakes.sketchCredentialOptions?.getOpenAiApiKey?.()).toBe(
      OPENAI_API_KEY,
    );
    expect(
      fakes.roomProps?.realtimeVoice?.savedOpenAiCredential?.error,
    ).toBe("OpenAI credential could not be saved. Try again.");
    expect(fakes.roomProps?.realtimeVoice?.useSavedOpenAiCredential).toBe(false);
  });

  it("deletes saved credential state and disables its shared voice and vision selection", async () => {
    fakes.loadOpenAiCredential.mockResolvedValueOnce({
      ok: true,
      value: SAVED_OPENAI_CREDENTIAL,
    });
    render(<MeetingCommandCanvas />);

    expect(await screen.findByTestId("meeting-room")).toBeVisible();
    await waitFor(() =>
      expect(
        fakes.roomProps?.realtimeVoice?.useSavedOpenAiCredential,
      ).toBe(true),
    );
    await act(async () => {
      await fakes.roomProps?.realtimeVoice?.savedOpenAiCredential?.onDelete();
    });

    expect(fakes.deleteOpenAiCredential).toHaveBeenCalledWith(
      expect.any(AbortSignal),
    );
    await waitFor(() =>
      expect(fakes.roomProps?.realtimeVoice).toMatchObject({
        useSavedOpenAiCredential: false,
        savedOpenAiCredential: { configured: false },
      }),
    );
    expect(
      fakes.sketchCredentialOptions?.getUseSavedOpenAiCredential?.(),
    ).toBe(false);
  });

  it("surfaces a compact credential load failure without blocking the room", async () => {
    fakes.loadOpenAiCredential.mockResolvedValueOnce({
      ok: false,
      error: {
        code: "credential_unavailable",
        message: "OpenAI credential storage is temporarily unavailable.",
      },
    });
    render(<MeetingCommandCanvas />);

    expect(await screen.findByTestId("meeting-room")).toBeVisible();
    await waitFor(() =>
      expect(
        fakes.roomProps?.realtimeVoice?.savedOpenAiCredential?.error,
      ).toBe("OpenAI credential storage is temporarily unavailable."),
    );
    expect(fakes.roomProps?.realtimeVoice?.useSavedOpenAiCredential).toBe(false);
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

  it("preserves an authoritative terminal command code through the real meeting adapter", async () => {
    fakes.submitCommand.mockResolvedValueOnce({
      ok: false,
      code: "invalid_command",
      commandCode: "NOTE_TEXT_LIMIT",
      message:
        "That thought card reached its 4,000-character limit. Finish it and start another thought.",
    });
    render(<MeetingCommandCanvas />);

    expect(await screen.findByTestId("meeting-room")).toBeVisible();
    if (!fakes.roomOnCommand)
      throw new Error("Meeting canvas command adapter was not captured.");

    await expect(
      fakes.roomOnCommand(
        {
          type: "object.append_note_text",
          objectId: "note-thought",
          expectedVersion: 4,
          text: "This terminal refusal must stop thought capture.",
        },
        "voice",
      ),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: "NOTE_TEXT_LIMIT",
        message:
          "That thought card reached its 4,000-character limit. Finish it and start another thought.",
      },
    });
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
    await user.click(screen.getByRole("button", { name: "Send invitation" }));
    await waitFor(() => expect(fakes.createInvitation).toHaveBeenCalledTimes(1));
    expect(
      await screen.findByText("Preview only: email not sent"),
    ).toBeVisible();

    expect(fakes.getSession).toHaveBeenCalledTimes(bootstrapSessionReads + 1);
    expect(fakes.createInvitation.mock.calls.map(([token]) => token)).toEqual([
      "fresh.one.signature",
    ]);
  });

  it.each([
    ["created", "Invitation ready to send"],
    ["sending", "Email submission in progress"],
    ["preview_only", "Preview only: email not sent"],
    ["reconciling", "Email submission being reconciled"],
    ["submitted", "Email submitted: delivery pending"],
    ["delivered", "Email delivered"],
    ["bounced", "Email bounced"],
    ["complained", "Recipient reported this email"],
    ["failed", "Email delivery failed"],
    ["suppressed", "Email suppressed"],
  ] as const)(
    "renders the %s invitation state without collapsing it into a preview label",
    async (status, label) => {
      const user = userEvent.setup();
      fakes.setRole("host");
      fakes.setInvitationStatus(status);
      render(<MeetingCommandCanvas />);

      expect(await screen.findByTestId("meeting-room")).toBeVisible();
      await user.click(screen.getByRole("button", { name: "Invite" }));
      await user.type(screen.getByLabelText("Display name"), "Mike");
      await user.type(screen.getByLabelText("Email"), "mike@example.com");
      await user.click(
        screen.getByRole("button", { name: "Send invitation" }),
      );

      expect(await screen.findByText(label)).toBeVisible();
      expect(
        screen.getByRole("button", { name: "Copy secure link" }),
      ).toBeVisible();
    },
  );

  it("polls a nonterminal invitation until the durable delivery state changes", async () => {
    const user = userEvent.setup();
    fakes.setRole("host");
    fakes.setInvitationStatus("submitted");
    fakes.loadInvitationDelivery.mockResolvedValueOnce({
      ok: true,
      value: {
        invitationId: "33333333-3333-4333-8333-333333333333",
        roomId: ROOM_ID,
        delivery: {
          status: "delivered",
          message: "Resend confirmed delivery.",
        },
      },
    });
    render(<MeetingCommandCanvas />);

    expect(await screen.findByTestId("meeting-room")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Invite" }));
    await user.type(screen.getByLabelText("Display name"), "Mike");
    await user.type(screen.getByLabelText("Email"), "mike@example.com");
    await user.click(screen.getByRole("button", { name: "Send invitation" }));

    expect(await screen.findByText("Email delivered")).toBeVisible();
    expect(screen.getByText("Resend confirmed delivery.")).toBeVisible();
    expect(fakes.loadInvitationDelivery).toHaveBeenCalledWith(
      ROOM_ID,
      "33333333-3333-4333-8333-333333333333",
      expect.any(AbortSignal),
    );
  });

  it("renders an invitation request failure inside the open dialog", async () => {
    const user = userEvent.setup();
    fakes.setRole("host");
    fakes.setInvitationFailure({
      code: "request_failed",
      message: "Invitation service is temporarily unavailable.",
    });
    render(<MeetingCommandCanvas />);

    expect(await screen.findByTestId("meeting-room")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Invite" }));
    await user.type(screen.getByLabelText("Display name"), "Mike");
    await user.type(screen.getByLabelText("Email"), "mike@example.com");
    await user.click(
      screen.getByRole("button", { name: "Send invitation" }),
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Invitation not created");
    expect(alert).toHaveTextContent(
      "Invitation service is temporarily unavailable.",
    );
  });

  it("renders an expired invitation session inside the open dialog", async () => {
    const user = userEvent.setup();
    fakes.setRole("host");
    render(<MeetingCommandCanvas />);

    expect(await screen.findByTestId("meeting-room")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Invite" }));
    await user.type(screen.getByLabelText("Display name"), "Mike");
    await user.type(screen.getByLabelText("Email"), "mike@example.com");
    fakes.setSessionError({ message: "Session refresh failed." });
    await user.click(
      screen.getByRole("button", { name: "Send invitation" }),
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Invitation not created");
    expect(alert).toHaveTextContent(
      "Your session could not be refreshed. Try again.",
    );
  });

  it("renders a rejected session refresh inside the open dialog", async () => {
    const user = userEvent.setup();
    fakes.setRole("host");
    render(<MeetingCommandCanvas />);

    expect(await screen.findByTestId("meeting-room")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "Invite" }));
    await user.type(screen.getByLabelText("Display name"), "Mike");
    await user.type(screen.getByLabelText("Email"), "mike@example.com");
    fakes.getSession.mockRejectedValueOnce(new Error("network unavailable"));
    await user.click(
      screen.getByRole("button", { name: "Send invitation" }),
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Invitation not created");
    expect(alert).toHaveTextContent(
      "Your session could not be refreshed. Try again.",
    );
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
