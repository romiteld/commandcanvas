import { describe, expect, it, vi } from "vitest";

import { createEmptyCanvasState, type CanvasState } from "@/lib/canvas/command-engine";
import type { CanvasCommand } from "@/lib/canvas/object-model";
import {
  createDemoRoomSession,
  type DemoRoomSessionDependencies,
} from "@/lib/demo/room-session";
import type { PresenceParticipant } from "@/lib/realtime/protocol";
import type { OwnRoomMembership } from "@/lib/supabase/browser-room";
import type { BrowserRoomApi } from "@/lib/supabase/room-api";
import type { NoSignupSession } from "@/lib/supabase/session";
import type {
  BrowserSketchTransformApi,
  BrowserSketchTransformResult,
} from "@/lib/vision/browser-api";
import type { SketchTransformRequest } from "@/lib/vision/diagram-transform";
import type { BrowserPacketApi } from "@/lib/packets/browser-api";

const USER_ID = "22222222-2222-4222-8222-222222222222";
const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const RECEIPT_ID = "33333333-3333-4333-8333-333333333333";
const COMMAND_ID = "44444444-4444-4444-8444-444444444444";
const SLUG = "room-2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a";
const JOIN_TOKEN =
  "q6urq6urq6urq6urq6urq6urq6urq6urq6urq6urq6s";

const SESSION: NoSignupSession = {
  access_token: "header.payload.signature",
  user: { id: USER_ID, is_anonymous: true },
};

const REFRESHED_SESSION: NoSignupSession = {
  access_token: "refreshed.payload.signature",
  user: { id: USER_ID, is_anonymous: true },
};

const SKETCH_INPUT: Omit<SketchTransformRequest, "roomId"> = {
  sketchObjectId: "sketch-source",
  sourceVersion: 1,
  instruction: "Turn this into a deployment diagram.",
  outputKind: "architecture",
  imageDataUrl:
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
};

type SketchTransformFactory = (accessToken: string) => BrowserSketchTransformApi;
type PacketApiFactory = (accessToken: string) => BrowserPacketApi;
type DemoRoomSketchBridge = {
  transformSketch: (
    input: Omit<SketchTransformRequest, "roomId">,
    signal?: AbortSignal,
  ) => Promise<BrowserSketchTransformResult>;
};

function canvas(revision: number): CanvasState {
  return { ...createEmptyCanvasState(ROOM_ID), revision };
}

function membership(
  role: "host" | "participant" = "host",
): OwnRoomMembership {
  return {
    roomId: ROOM_ID,
    userId: USER_ID,
    role,
    displayName: role === "host" ? "Danny" : "Sarah",
    color: role === "host" ? "#0ea5e9" : "#a855f7",
    joinedAt: "2026-08-27T12:00:00.000Z",
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function createHarness(options?: {
  initialState?: CanvasState;
  ownMembership?: OwnRoomMembership;
  api?: Partial<BrowserRoomApi>;
  loadCanvas?: DemoRoomSessionDependencies["loadCanvas"];
  loadMembership?: DemoRoomSessionDependencies["loadMembership"];
  hydrateCanvas?: DemoRoomSessionDependencies["hydrateCanvas"];
  createSketchTransformApi?: SketchTransformFactory;
  createPacketApi?: PacketApiFactory;
  roomApiForToken?: (
    accessToken: string,
    defaultApi: BrowserRoomApi,
  ) => BrowserRoomApi;
}) {
  let realtimeOptions:
    | Parameters<DemoRoomSessionDependencies["createRealtime"]>[0]
    | undefined;
  const connect = vi.fn(async () => undefined);
  const publishCursor = vi.fn(async () => true);
  const realtimeDispose = vi.fn(async () => undefined);
  const createRealtime: DemoRoomSessionDependencies["createRealtime"] = vi.fn(
    (input) => {
      realtimeOptions = input;
      return { connect, publishCursor, dispose: realtimeDispose };
    },
  );
  const createRoom = vi.fn(async () => ({
    ok: true as const,
    value: {
      roomId: ROOM_ID,
      slug: SLUG,
      joinToken: JOIN_TOKEN,
      role: "host" as const,
      joined: true as const,
    },
  }));
  const joinRoom = vi.fn(async () => ({
    ok: true as const,
    value: {
      roomId: ROOM_ID,
      role: "participant" as const,
      joined: true,
    },
  }));
  const deleteDemoRoom = vi.fn<BrowserRoomApi["deleteDemoRoom"]>(async () => ({
    ok: true as const,
    value: {
      roomId: ROOM_ID,
      deleted: true as const,
    },
  }));
  const commitCommand = vi.fn<BrowserRoomApi["commitCommand"]>(async () => ({
    ok: true as const,
    value: {
      roomId: ROOM_ID,
      revision: 1,
      receiptId: RECEIPT_ID,
      state: canvas(1),
    },
  }));
  const roomApi: BrowserRoomApi = {
    createRoom,
    deleteDemoRoom,
    joinRoom,
    commitCommand,
    ...options?.api,
  };
  const createRoomApi = vi.fn((accessToken: string) =>
    options?.roomApiForToken?.(accessToken, roomApi) ?? roomApi,
  );
  let authStateChange:
    | ((event: string, session: NoSignupSession | null) => void)
    | null = null;
  const authUnsubscribe = vi.fn();
  const authClient = {
    auth: {
      getSession: vi.fn(async () => ({
        data: { session: SESSION },
        error: null,
      })),
      signInAnonymously: vi.fn(async () => ({
        data: { session: SESSION },
        error: null,
      })),
      onAuthStateChange: vi.fn(
        (
          callback: (event: string, session: NoSignupSession | null) => void,
        ) => {
          authStateChange = callback;
          return { data: { subscription: { unsubscribe: authUnsubscribe } } };
        },
      ),
    },
  };
  const ensureSession = vi.fn(async () => ({
    ok: true as const,
    session: SESSION,
    created: true,
  }));
  const loadMembership =
    options?.loadMembership ??
    vi.fn(async () => ({
      ok: true as const,
      membership: options?.ownMembership ?? membership(),
    }));
  const loadCanvas =
    options?.loadCanvas ??
    vi.fn(async () => ({
      ok: true as const,
      state: options?.initialState ?? canvas(0),
    }));
  const hydrateCanvas = options?.hydrateCanvas ?? vi.fn(() => true);
  const dependencies = {
    authClient,
    roomDataClient: {} as DemoRoomSessionDependencies["roomDataClient"],
    realtimeClient: {} as DemoRoomSessionDependencies["realtimeClient"],
    createRoomApi,
    ensureSession,
    loadMembership,
    loadCanvas,
    createRealtime,
    hydrateCanvas,
    createCommandId: () => COMMAND_ID,
    now: () => new Date("2026-08-27T12:00:00.000Z"),
  } satisfies DemoRoomSessionDependencies;

  const session = createDemoRoomSession({
    ...dependencies,
    ...(options?.createSketchTransformApi
      ? { createSketchTransformApi: options.createSketchTransformApi }
      : {}),
    ...(options?.createPacketApi
      ? { createPacketApi: options.createPacketApi }
      : {}),
  });

  return {
    session,
    dependencies,
    ensureSession,
    loadMembership,
    loadCanvas,
    createRoom,
    deleteDemoRoom,
    joinRoom,
    commitCommand,
    createRoomApi,
    connect,
    publishCursor,
    realtimeDispose,
    getRealtimeOptions: () => realtimeOptions,
    emitAuthStateChange: (event: string, session: NoSignupSession | null) =>
      authStateChange?.(event, session),
    authUnsubscribe,
  };
}

describe("authenticated token rotation", () => {
  it("exposes only the current bearer token to authenticated browser adapters", async () => {
    const harness = createHarness();

    expect(harness.session.getAccessToken()).toBeNull();
    await harness.session.start({
      kind: "host",
      roomName: "CommandCanvas demo",
      displayName: "Danny",
      color: "#0ea5e9",
    });
    expect(harness.session.getAccessToken()).toBe(SESSION.access_token);

    harness.emitAuthStateChange("TOKEN_REFRESHED", REFRESHED_SESSION);
    expect(harness.session.getAccessToken()).toBe(REFRESHED_SESSION.access_token);

    await harness.session.dispose();
    expect(harness.session.getAccessToken()).toBeNull();
  });

  it("uses a refreshed token for room, vision, packet, and Realtime recovery work", async () => {
    const refreshedCommit = vi.fn<BrowserRoomApi["commitCommand"]>(async () => ({
      ok: true as const,
      value: {
        roomId: ROOM_ID,
        revision: 1,
        receiptId: RECEIPT_ID,
        state: canvas(1),
      },
    }));
    const refreshedTransform = vi.fn<BrowserSketchTransformApi["transform"]>(
      async () => ({
        ok: false as const,
        error: {
          code: "model_unavailable",
          message: "Interpretation is temporarily unavailable.",
        },
      }),
    );
    const initialTransform = vi.fn<BrowserSketchTransformApi["transform"]>();
    const refreshedLoadLatest = vi.fn<BrowserPacketApi["loadLatest"]>(async () => ({
      ok: true as const,
      value: { packet: null, latestSend: null, activity: [] },
    }));
    const packetApi = (loadLatest: BrowserPacketApi["loadLatest"]): BrowserPacketApi => ({
      loadLatest,
      prepare: vi.fn(),
      update: vi.fn(),
      approve: vi.fn(),
      stageSend: vi.fn(),
      cancelSend: vi.fn(),
      executeSend: vi.fn(),
    });
    const initialLoadLatest = vi.fn<BrowserPacketApi["loadLatest"]>();
    const createSketchTransformApi = vi.fn<SketchTransformFactory>(
      (accessToken) => ({
        transform:
          accessToken === REFRESHED_SESSION.access_token
            ? refreshedTransform
            : initialTransform,
      }),
    );
    const createPacketApi = vi.fn<PacketApiFactory>((accessToken) =>
      packetApi(
        accessToken === REFRESHED_SESSION.access_token
          ? refreshedLoadLatest
          : initialLoadLatest,
      ),
    );
    const harness = createHarness({
      roomApiForToken: (accessToken, defaultApi) =>
        accessToken === REFRESHED_SESSION.access_token
          ? { ...defaultApi, commitCommand: refreshedCommit }
          : defaultApi,
      createSketchTransformApi,
      createPacketApi,
    });

    await harness.session.start({
      kind: "host",
      roomName: "Architecture review",
      displayName: "Danny",
      color: "#0ea5e9",
    });
    harness.emitAuthStateChange("TOKEN_REFRESHED", REFRESHED_SESSION);

    await expect(
      harness.session.submitCommand(
        {
          type: "object.create",
          object: {
            id: "note-refresh",
            type: "note",
            title: "Fresh token",
            x: 40,
            y: 40,
            width: 280,
            height: 190,
            zIndex: 1,
            payload: { text: "Use the rotated credential.", tone: "sky" },
          },
        },
        "typed",
      ),
    ).resolves.toMatchObject({ ok: true });
    await harness.session.transformSketch(SKETCH_INPUT);
    await harness.session.loadLatestPacketWorkflow();

    expect(harness.createRoomApi).toHaveBeenLastCalledWith(
      REFRESHED_SESSION.access_token,
    );
    expect(createSketchTransformApi).toHaveBeenLastCalledWith(
      REFRESHED_SESSION.access_token,
    );
    expect(createPacketApi).toHaveBeenLastCalledWith(
      REFRESHED_SESSION.access_token,
    );
    expect(refreshedCommit).toHaveBeenCalledOnce();
    expect(refreshedTransform).toHaveBeenCalledOnce();
    expect(refreshedLoadLatest).toHaveBeenCalledOnce();
    expect(initialTransform).not.toHaveBeenCalled();
    expect(initialLoadLatest).not.toHaveBeenCalled();
    expect(harness.getRealtimeOptions()?.accessToken).toBe(
      REFRESHED_SESSION.access_token,
    );

    await harness.session.dispose();
    expect(harness.authUnsubscribe).toHaveBeenCalledOnce();
  });
});

describe("authenticated packet workflow bridge", () => {
  it("creates one authenticated packet API and injects the verified room ID", async () => {
    const packetApi: BrowserPacketApi = {
      loadLatest: vi.fn(async () => ({
        ok: true as const,
        value: { packet: null, latestSend: null, activity: [] },
      })),
      prepare: vi.fn(async () => ({
        ok: true as const,
        value: {
          packetId: "packet-launch",
          packetVersion: 1,
          sourceRevision: 3,
          status: "draft" as const,
          title: "Launch packet",
          objectCount: 2,
          contentSnapshot: {
            title: "Launch packet",
            content: {
              schemaVersion: 1 as const,
              roomName: "Architecture review",
              sourceRevision: 3,
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
      })),
      update: vi.fn(),
      approve: vi.fn(),
      stageSend: vi.fn(),
      cancelSend: vi.fn(async () => ({
        ok: true as const,
        value: {
          sendRequestId: "55555555-5555-4555-8555-555555555555",
          packetId: "packet-launch",
          status: "cancelled" as const,
          receiptId: "66666666-6666-4666-8666-666666666666",
          changed: true,
        },
      })),
      executeSend: vi.fn(),
    };
    const createPacketApi = vi.fn(() => packetApi);
    const harness = createHarness({ createPacketApi });
    await harness.session.start({
      kind: "host",
      roomName: "Architecture review",
      displayName: "Danny",
      color: "#0ea5e9",
    });

    const signal = new AbortController().signal;
    await expect(
      harness.session.loadLatestPacketWorkflow(signal),
    ).resolves.toEqual({
      ok: true,
      value: { packet: null, latestSend: null, activity: [] },
    });
    expect(packetApi.loadLatest).toHaveBeenCalledExactlyOnceWith(
      ROOM_ID,
      signal,
    );

    await expect(
      harness.session.preparePacket(
        {
          packetId: "packet-launch",
          actorType: "agent",
          title: "Launch packet",
          selectedObjectIds: ["note-launch", "diagram-system"],
        },
        signal,
      ),
    ).resolves.toMatchObject({ ok: true });
    expect(createPacketApi).toHaveBeenCalledExactlyOnceWith(SESSION.access_token);
    expect(packetApi.prepare).toHaveBeenCalledExactlyOnceWith(
      {
        roomId: ROOM_ID,
        packetId: "packet-launch",
        actorType: "agent",
        title: "Launch packet",
        selectedObjectIds: ["note-launch", "diagram-system"],
      },
      signal,
    );

    await expect(
      harness.session.cancelPacketSend(
        {
          sendRequestId: "55555555-5555-4555-8555-555555555555",
          explicitHostCancellation: true,
        },
        signal,
      ),
    ).resolves.toMatchObject({ ok: true, value: { status: "cancelled" } });
    expect(packetApi.cancelSend).toHaveBeenCalledExactlyOnceWith(
      {
        roomId: ROOM_ID,
        sendRequestId: "55555555-5555-4555-8555-555555555555",
        explicitHostCancellation: true,
      },
      signal,
    );
  });

  it("fails compactly before a packet API or verified room exists", async () => {
    const harness = createHarness();

    await expect(
      harness.session.stagePacketSend({
        packetId: "packet-launch",
        requestedByActorType: "agent",
      }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: "room_not_ready",
        message: "Create or join a room before using meeting packets.",
      },
    });

    await harness.session.start({
      kind: "host",
      roomName: "Architecture review",
      displayName: "Danny",
      color: "#0ea5e9",
    });
    await expect(
      harness.session.approvePacket({ packetId: "packet-launch" }),
    ).resolves.toEqual({
      ok: false,
      error: {
        code: "packet_api_unconfigured",
        message: "Meeting packet actions are not configured.",
      },
    });
  });
});

describe("demo room bootstrap", () => {
  it("preserves an actionable bounded room-open refusal", async () => {
    const harness = createHarness({
      api: {
        createRoom: vi.fn(async () => ({
          ok: false as const,
          error: {
            code: "demo_room_limit_reached",
            message: "Reset one of your demo rooms before creating another.",
            status: 409,
          },
        })),
      },
    });

    await expect(
      harness.session.start({
        kind: "host",
        roomName: "CommandCanvas demo",
        displayName: "Danny",
        color: "#0ea5e9",
      }),
    ).resolves.toEqual({
      ok: false,
      code: "demo_room_limit_reached",
      message: "Reset one of your demo rooms before creating another.",
    });
  });

  it("creates a host room with the anonymous identity, then exposes only RLS-verified state", async () => {
    const harness = createHarness();
    const observed: string[] = [];
    harness.session.subscribe(() => observed.push(harness.session.getSnapshot().status));

    const result = await harness.session.start({
      kind: "host",
      roomName: "Architecture review",
      displayName: "Danny",
      color: "#0ea5e9",
    });

    expect(result).toEqual({ ok: true, roomId: ROOM_ID });
    expect(harness.ensureSession).toHaveBeenCalledWith(
      harness.dependencies.authClient,
    );
    expect(harness.createRoom).toHaveBeenCalledExactlyOnceWith({
      mode: "demo",
      name: "Architecture review",
      displayName: "Danny",
      color: "#0ea5e9",
    });
    expect(harness.createRoomApi).toHaveBeenCalledExactlyOnceWith(
      SESSION.access_token,
    );
    expect(harness.loadMembership).toHaveBeenCalledWith(
      harness.dependencies.roomDataClient,
      ROOM_ID,
      USER_ID,
    );
    expect(harness.loadCanvas).toHaveBeenCalledWith(
      harness.dependencies.roomDataClient,
      ROOM_ID,
    );

    const snapshot = harness.session.getSnapshot();
    expect(snapshot.identity).toEqual({ userId: USER_ID, isAnonymous: true });
    expect(snapshot.membership).toEqual(membership("host"));
    expect(snapshot.state).toEqual(canvas(0));
    expect(snapshot.joinAccess).toEqual({ slug: SLUG, joinToken: JOIN_TOKEN });
    expect(snapshot.presence).toEqual([]);
    expect(snapshot.cursors).toEqual({});
    expect(snapshot.status).toBe("connecting");
    expect(snapshot.realtimeStatus).toBe("connecting");
    expect(observed).toEqual(
      expect.arrayContaining(["authenticating", "creating", "verifying", "connecting"]),
    );

    const realtime = harness.getRealtimeOptions();
    expect(realtime?.accessToken).toBe(SESSION.access_token);
    expect(realtime?.participant).toEqual({
      participantId: USER_ID,
      displayName: "Danny",
      role: "host",
      color: "#0ea5e9",
      onlineAt: "2026-08-27T12:00:00.000Z",
    });
    expect(harness.connect).toHaveBeenCalledOnce();
  });

  it("joins with the supplied capability but does not retain or re-expose it", async () => {
    const harness = createHarness({ ownMembership: membership("participant") });

    await harness.session.start({
      kind: "join",
      slug: SLUG,
      joinToken: JOIN_TOKEN,
      displayName: "Sarah",
      color: "#a855f7",
    });

    expect(harness.joinRoom).toHaveBeenCalledExactlyOnceWith({
      slug: SLUG,
      joinToken: JOIN_TOKEN,
      displayName: "Sarah",
      color: "#a855f7",
    });
    expect(harness.session.getSnapshot().membership?.role).toBe("participant");
    expect(harness.session.getSnapshot().joinAccess).toBeNull();
    expect(JSON.stringify(harness.session.getSnapshot())).not.toContain(JOIN_TOKEN);
  });

  it("resumes a validated host descriptor without calling create or join", async () => {
    const harness = createHarness();

    const result = await harness.session.start({
      kind: "resume",
      roomId: ROOM_ID,
      expectedRole: "host",
      joinAccess: { slug: SLUG, joinToken: JOIN_TOKEN },
    });

    expect(result).toEqual({ ok: true, roomId: ROOM_ID });
    expect(harness.createRoom).not.toHaveBeenCalled();
    expect(harness.joinRoom).not.toHaveBeenCalled();
    expect(harness.loadMembership).toHaveBeenCalledWith(
      harness.dependencies.roomDataClient,
      ROOM_ID,
      USER_ID,
    );
    expect(harness.session.getSnapshot()).toMatchObject({
      roomId: ROOM_ID,
      membership: membership("host"),
      state: canvas(0),
      joinAccess: { slug: SLUG, joinToken: JOIN_TOKEN },
    });
  });

  it("rejects a participant resume descriptor that tries to retain join access", async () => {
    const harness = createHarness({ ownMembership: membership("participant") });

    const result = await harness.session.start({
      kind: "resume",
      roomId: ROOM_ID,
      expectedRole: "participant",
      joinAccess: { slug: SLUG, joinToken: JOIN_TOKEN },
    } as unknown as Parameters<typeof harness.session.start>[0]);

    expect(result).toEqual({
      ok: false,
      code: "invalid_resume_descriptor",
      message: "Stored room access could not be verified.",
    });
    expect(harness.ensureSession).not.toHaveBeenCalled();
    expect(harness.createRoom).not.toHaveBeenCalled();
    expect(harness.joinRoom).not.toHaveBeenCalled();
    expect(harness.loadMembership).not.toHaveBeenCalled();
    expect(JSON.stringify(harness.session.getSnapshot())).not.toContain(JOIN_TOKEN);
  });

  it("refuses an unverified or role-mismatched membership before creating Presence", async () => {
    const harness = createHarness({ ownMembership: membership("participant") });

    const result = await harness.session.start({
      kind: "host",
      roomName: "Architecture review",
      displayName: "Danny",
      color: "#0ea5e9",
    });

    expect(result).toEqual({
      ok: false,
      code: "membership_unavailable",
      message: "Room membership could not be verified.",
    });
    expect(harness.dependencies.createRealtime).not.toHaveBeenCalled();
    expect(harness.session.getSnapshot()).toMatchObject({
      status: "error",
      membership: null,
      state: null,
      presence: [],
    });
  });

  it("keeps verified canvas state available when Realtime reports a channel failure", async () => {
    const harness = createHarness();
    await harness.session.start({
      kind: "host",
      roomName: "Architecture review",
      displayName: "Danny",
      color: "#0ea5e9",
    });

    harness.getRealtimeOptions()?.onStatus("channel_error");

    expect(harness.session.getSnapshot()).toMatchObject({
      status: "degraded",
      realtimeStatus: "channel_error",
      state: canvas(0),
      presence: [],
    });
  });

  it("keeps a verified room usable when Realtime connection itself rejects", async () => {
    const harness = createHarness();
    harness.connect.mockRejectedValueOnce(new Error("socket offline"));

    const result = await harness.session.start({
      kind: "host",
      roomName: "Architecture review",
      displayName: "Danny",
      color: "#0ea5e9",
    });

    expect(result).toEqual({ ok: true, roomId: ROOM_ID });
    expect(harness.session.getSnapshot()).toMatchObject({
      status: "degraded",
      state: canvas(0),
      membership: membership("host"),
      presence: [],
      lastError: {
        code: "realtime_unavailable",
        message: "Live collaboration is unavailable; verified room state is preserved.",
      },
    });
  });
});

describe("actual Presence, cursors, and durable revision reloads", () => {
  it("never fabricates a participant and only exposes Presence emitted by Realtime", async () => {
    const harness = createHarness();
    await harness.session.start({
      kind: "host",
      roomName: "Architecture review",
      displayName: "Danny",
      color: "#0ea5e9",
    });
    expect(harness.session.getSnapshot().presence).toEqual([]);

    const remote: PresenceParticipant = {
      participantId: "99999999-9999-4999-8999-999999999999",
      displayName: "Sarah",
      role: "participant",
      color: "#a855f7",
      onlineAt: "2026-08-27T12:01:00.000Z",
    };
    harness.getRealtimeOptions()?.onPresence([remote]);

    expect(harness.session.getSnapshot().presence).toEqual([remote]);
  });

  it("coalesces revision broadcasts into one in-flight durable reload", async () => {
    const reload = deferred<{ ok: true; state: CanvasState }>();
    const loadCanvas = vi
      .fn()
      .mockResolvedValueOnce({ ok: true as const, state: canvas(1) })
      .mockImplementationOnce(() => reload.promise);
    const harness = createHarness({ loadCanvas });
    await harness.session.start({
      kind: "host",
      roomName: "Architecture review",
      displayName: "Danny",
      color: "#0ea5e9",
    });

    harness.getRealtimeOptions()?.onRevision(2);
    harness.getRealtimeOptions()?.onRevision(3);
    harness.getRealtimeOptions()?.onRevision(4);
    await Promise.resolve();

    expect(loadCanvas).toHaveBeenCalledTimes(2);
    reload.resolve({ ok: true, state: canvas(4) });
    await harness.session.whenIdle();

    expect(loadCanvas).toHaveBeenCalledTimes(2);
    expect(harness.session.getSnapshot().state?.revision).toBe(4);
  });

  it("runs one follow-up reload when a newer broadcast arrives during an older reload", async () => {
    const firstReload = deferred<{ ok: true; state: CanvasState }>();
    const loadCanvas = vi
      .fn()
      .mockResolvedValueOnce({ ok: true as const, state: canvas(1) })
      .mockImplementationOnce(() => firstReload.promise)
      .mockResolvedValueOnce({ ok: true as const, state: canvas(3) });
    const harness = createHarness({ loadCanvas });
    await harness.session.start({
      kind: "host",
      roomName: "Architecture review",
      displayName: "Danny",
      color: "#0ea5e9",
    });

    harness.getRealtimeOptions()?.onRevision(2);
    await Promise.resolve();
    harness.getRealtimeOptions()?.onRevision(3);
    firstReload.resolve({ ok: true, state: canvas(2) });
    await harness.session.whenIdle();

    expect(loadCanvas).toHaveBeenCalledTimes(3);
    expect(harness.session.getSnapshot().state?.revision).toBe(3);
  });

  it("exposes only the newest cursor sequence and delegates cursor publishing", async () => {
    const harness = createHarness();
    await harness.session.start({
      kind: "host",
      roomName: "Architecture review",
      displayName: "Danny",
      color: "#0ea5e9",
    });
    const realtime = harness.getRealtimeOptions();
    const participantId = "99999999-9999-4999-8999-999999999999";
    realtime?.onCursor({ participantId, seq: 2, x: 20, y: 30, sentAt: 20 });
    realtime?.onCursor({ participantId, seq: 1, x: 1, y: 1, sentAt: 10 });

    expect(harness.session.getSnapshot().cursors[participantId]).toMatchObject({
      seq: 2,
      x: 20,
      y: 30,
    });
    await expect(harness.session.publishCursor({ x: 42, y: 84 })).resolves.toBe(
      true,
    );
    expect(harness.publishCursor).toHaveBeenCalledWith({ x: 42, y: 84 });
  });
});

describe("canonical command submission and lifecycle", () => {
  const command: CanvasCommand = {
    type: "object.create",
    object: {
      id: "note-launch",
      type: "note",
      title: "Launch decision",
      x: 120,
      y: 80,
      width: 280,
      height: 190,
      zIndex: 1,
      payload: { text: "Ship the verified path.", tone: "sky" },
    },
  };

  it("submits against the current revision and hydrates the authoritative response", async () => {
    const hydrateCanvas = vi.fn(() => true);
    const harness = createHarness({ initialState: canvas(5), hydrateCanvas });
    const authoritative = canvas(6);
    harness.commitCommand.mockResolvedValueOnce({
      ok: true,
      value: {
        roomId: ROOM_ID,
        revision: 6,
        receiptId: RECEIPT_ID,
        state: authoritative,
      },
    });
    await harness.session.start({
      kind: "host",
      roomName: "Architecture review",
      displayName: "Danny",
      color: "#0ea5e9",
    });
    hydrateCanvas.mockClear();

    const result = await harness.session.submitCommand(command, "pointer");

    expect(result).toEqual({ ok: true, state: authoritative });
    expect(harness.commitCommand).toHaveBeenCalledExactlyOnceWith({
      commandId: COMMAND_ID,
      roomId: ROOM_ID,
      baseRevision: 5,
      source: "pointer",
      command,
    });
    expect(hydrateCanvas).toHaveBeenCalledExactlyOnceWith(authoritative);
    expect(harness.session.getSnapshot().state).toEqual(authoritative);
    expect(harness.session.getSnapshot().commandPending).toBe(false);
  });

  it("threads the exact cancellation signal through the room API", async () => {
    const harness = createHarness();
    await harness.session.start({
      kind: "host",
      roomName: "Architecture review",
      displayName: "Danny",
      color: "#0ea5e9",
    });
    const controller = new AbortController();

    await harness.session.submitCommand(command, "webmcp", controller.signal);

    expect(harness.commitCommand.mock.calls[0]?.[1]?.signal).toBe(
      controller.signal,
    );
  });

  it("preserves an authoritative terminal command code for the meeting adapter", async () => {
    const harness = createHarness();
    harness.commitCommand.mockResolvedValueOnce({
      ok: false,
      error: {
        code: "invalid_command",
        commandCode: "NOTE_TEXT_LIMIT",
        message:
          "That thought card reached its 4,000-character limit. Finish it and start another thought.",
        status: 400,
      },
    });
    await harness.session.start({
      kind: "host",
      roomName: "Architecture review",
      displayName: "Danny",
      color: "#0ea5e9",
    });

    await expect(
      harness.session.submitCommand(command, "voice"),
    ).resolves.toEqual({
      ok: false,
      code: "invalid_command",
      commandCode: "NOTE_TEXT_LIMIT",
      message:
        "That thought card reached its 4,000-character limit. Finish it and start another thought.",
    });
  });

  it("refuses an already-cancelled command without API work", async () => {
    const harness = createHarness();
    await harness.session.start({
      kind: "host",
      roomName: "Architecture review",
      displayName: "Danny",
      color: "#0ea5e9",
    });
    const controller = new AbortController();
    controller.abort();

    await expect(
      harness.session.submitCommand(command, "webmcp", controller.signal),
    ).resolves.toEqual({
      ok: false,
      code: "command_cancelled",
      message: "Canvas change was cancelled.",
    });
    expect(harness.commitCommand).not.toHaveBeenCalled();
  });

  it("serializes commands so two callers cannot use the same base revision", async () => {
    const commandResponse =
      deferred<Awaited<ReturnType<BrowserRoomApi["commitCommand"]>>>();
    const commitCommand = vi.fn(() => commandResponse.promise);
    const harness = createHarness({ api: { commitCommand } });
    await harness.session.start({
      kind: "host",
      roomName: "Architecture review",
      displayName: "Danny",
      color: "#0ea5e9",
    });

    const first = harness.session.submitCommand(command, "typed");
    await expect(harness.session.submitCommand(command, "typed")).resolves.toEqual({
      ok: false,
      code: "command_pending",
      message: "Wait for the current canvas change to finish.",
    });
    commandResponse.resolve({
      ok: true,
      value: {
        roomId: ROOM_ID,
        revision: 1,
        receiptId: RECEIPT_ID,
        state: canvas(1),
      },
    });
    await first;

    expect(commitCommand).toHaveBeenCalledOnce();
  });

  it("disposes Presence exactly once and ignores callbacks after disposal", async () => {
    const harness = createHarness();
    await harness.session.start({
      kind: "host",
      roomName: "Architecture review",
      displayName: "Danny",
      color: "#0ea5e9",
    });
    const realtime = harness.getRealtimeOptions();

    await harness.session.dispose();
    await harness.session.dispose();
    realtime?.onPresence([
      {
        participantId: "99999999-9999-4999-8999-999999999999",
        displayName: "Sarah",
        role: "participant",
        color: "#a855f7",
        onlineAt: "2026-08-27T12:01:00.000Z",
      },
    ]);
    realtime?.onRevision(9);

    expect(harness.realtimeDispose).toHaveBeenCalledOnce();
    expect(harness.session.getSnapshot()).toMatchObject({
      status: "disposed",
      presence: [],
      cursors: {},
    });
    expect(harness.loadCanvas).toHaveBeenCalledOnce();
    await expect(harness.session.publishCursor({ x: 1, y: 2 })).resolves.toBe(
      false,
    );
  });

  it("deletes the exact hosted demo room before disposing its live session", async () => {
    const harness = createHarness();
    await harness.session.start({
      kind: "host",
      roomName: "Architecture review",
      displayName: "Danny",
      color: "#0ea5e9",
    });
    const result = await harness.session.deleteHostedDemoRoom();

    expect(result).toEqual({
      ok: true,
      roomId: ROOM_ID,
      deleted: true,
    });
    expect(harness.deleteDemoRoom).toHaveBeenCalledExactlyOnceWith(ROOM_ID, {
      signal: undefined,
    });
    expect(harness.realtimeDispose).toHaveBeenCalledOnce();
    expect(harness.session.getSnapshot().status).toBe("disposed");
  });

  it("refuses participant deletion without calling the room API", async () => {
    const harness = createHarness({ ownMembership: membership("participant") });
    await harness.session.start({
      kind: "join",
      slug: SLUG,
      joinToken: JOIN_TOKEN,
      displayName: "Sarah",
      color: "#a855f7",
    });

    const result = await harness.session.deleteHostedDemoRoom();

    expect(result).toEqual({
      ok: false,
      code: "host_required",
      message: "Only the demo room host can delete this room.",
    });
    expect(harness.deleteDemoRoom).not.toHaveBeenCalled();
    expect(harness.realtimeDispose).not.toHaveBeenCalled();
    expect(harness.session.getSnapshot().status).not.toBe("disposed");
  });

  it("keeps the verified room active when durable deletion fails", async () => {
    const harness = createHarness();
    harness.deleteDemoRoom.mockResolvedValueOnce({
      ok: false,
      error: {
        code: "network_unavailable",
        message: "CommandCanvas could not be reached.",
      },
    });
    await harness.session.start({
      kind: "host",
      roomName: "Architecture review",
      displayName: "Danny",
      color: "#0ea5e9",
    });
    const statusBeforeDelete = harness.session.getSnapshot().status;

    const result = await harness.session.deleteHostedDemoRoom();

    expect(result).toEqual({
      ok: false,
      code: "network_unavailable",
      message: "Demo room was not reset. Try again.",
    });
    expect(harness.realtimeDispose).not.toHaveBeenCalled();
    expect(harness.session.getSnapshot()).toMatchObject({
      status: statusBeforeDelete,
      roomId: ROOM_ID,
      membership: membership("host"),
      lastError: {
        code: "network_unavailable",
        message: "Demo room was not reset. Try again.",
      },
    });
  });
});

describe("authenticated sketch transformation", () => {
  it("scopes interpretation to the verified room and forwards the caller signal", async () => {
    const transformed: BrowserSketchTransformResult = {
      ok: false,
      error: {
        code: "model_unavailable",
        message: "Interpretation is temporarily unavailable.",
      },
    };
    const transform = vi.fn(async () => transformed);
    const createSketchTransformApi = vi.fn<SketchTransformFactory>(() => ({
      transform,
    }));
    const harness = createHarness({ createSketchTransformApi });
    const bridge = harness.session as unknown as DemoRoomSketchBridge;
    const controller = new AbortController();

    expect(await bridge.transformSketch(SKETCH_INPUT)).toEqual({
      ok: false,
      error: {
        code: "room_not_ready",
        message: "Create or join a room before interpreting a sketch.",
      },
    });
    expect(createSketchTransformApi).not.toHaveBeenCalled();

    await harness.session.start({
      kind: "host",
      roomName: "Architecture review",
      displayName: "Danny",
      color: "#0ea5e9",
    });
    const stateBeforeTransform = harness.session.getSnapshot().state;

    await expect(
      bridge.transformSketch(SKETCH_INPUT, controller.signal),
    ).resolves.toEqual(transformed);
    expect(createSketchTransformApi).toHaveBeenCalledExactlyOnceWith(
      SESSION.access_token,
    );
    expect(transform).toHaveBeenCalledExactlyOnceWith(
      { ...SKETCH_INPUT, roomId: ROOM_ID },
      controller.signal,
    );
    expect(harness.session.getSnapshot().state).toBe(stateBeforeTransform);
  });

  it("returns compact errors without mutating canvas when unavailable or disposed", async () => {
    const harness = createHarness();
    const bridge = harness.session as unknown as DemoRoomSketchBridge;
    const initialSnapshot = harness.session.getSnapshot();

    await expect(bridge.transformSketch(SKETCH_INPUT)).resolves.toEqual({
      ok: false,
      error: {
        code: "room_not_ready",
        message: "Create or join a room before interpreting a sketch.",
      },
    });
    expect(harness.session.getSnapshot()).toEqual(initialSnapshot);

    await harness.session.start({
      kind: "host",
      roomName: "Architecture review",
      displayName: "Danny",
      color: "#0ea5e9",
    });
    const verifiedState = harness.session.getSnapshot().state;

    await expect(bridge.transformSketch(SKETCH_INPUT)).resolves.toEqual({
      ok: false,
      error: {
        code: "sketch_transform_unconfigured",
        message: "Sketch interpretation is not configured.",
      },
    });
    expect(harness.session.getSnapshot().state).toBe(verifiedState);

    await harness.session.dispose();

    await expect(bridge.transformSketch(SKETCH_INPUT)).resolves.toEqual({
      ok: false,
      error: {
        code: "session_disposed",
        message: "This demo room session has been closed.",
      },
    });
    expect(harness.session.getSnapshot().state).toBe(verifiedState);
  });
});
