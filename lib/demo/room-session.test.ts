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
    joinRoom,
    commitCommand,
    ...options?.api,
  };
  const createRoomApi = vi.fn(() => roomApi);
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
    authClient: {} as DemoRoomSessionDependencies["authClient"],
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

  return {
    session: createDemoRoomSession(dependencies),
    dependencies,
    ensureSession,
    loadMembership,
    loadCanvas,
    createRoom,
    joinRoom,
    commitCommand,
    createRoomApi,
    connect,
    publishCursor,
    realtimeDispose,
    getRealtimeOptions: () => realtimeOptions,
  };
}

describe("demo room bootstrap", () => {
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
});
