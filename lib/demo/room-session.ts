import { z } from "zod";

import type {
  CanvasCommandSource,
  CanvasState,
  CommandErrorCode,
} from "@/lib/canvas/command-engine";
import {
  canvasCommandSchema,
  type CanvasCommand,
} from "@/lib/canvas/object-model";
import {
  applyCursorMessage,
  type CursorMessage,
  type PresenceParticipant,
  type RemoteCursorState,
} from "@/lib/realtime/protocol";
import {
  createRoomRealtime,
  type RoomRealtimeController,
} from "@/lib/realtime/room-channel";
import {
  loadBrowserCanvas,
  loadOwnRoomMembership,
  type BrowserRoomClient,
  type OwnRoomMembership,
} from "@/lib/supabase/browser-room";
import type { CommandRequest } from "@/lib/supabase/room-contracts";
import type { BrowserRoomApi } from "@/lib/supabase/room-api";
import {
  ensureNoSignupSession,
  type NoSignupAuthClient,
  type NoSignupSession,
} from "@/lib/supabase/session";
import type {
  BrowserSketchTransformApi,
  BrowserSketchTransformResult,
} from "@/lib/vision/browser-api";
import type { SketchTransformRequest } from "@/lib/vision/diagram-transform";
import type {
  ApprovePacketRequest,
  CancelPacketSendRequest,
  ExecutePacketSendRequest,
  PreparePacketRequest,
  StagePacketSendRequest,
  UpdatePacketRequest,
} from "@/lib/packets/contracts";
import type {
  BrowserApprovedPacket,
  BrowserCancelledPacketSend,
  BrowserExecutedPacketSend,
  BrowserPacketApi,
  BrowserPacketApiResult,
  BrowserPersistedPacketWorkflow,
  BrowserPreparedPacket,
  BrowserStagedPacketSend,
  BrowserUpdatedPacket,
} from "@/lib/packets/browser-api";

type RealtimeFactoryOptions = Parameters<typeof createRoomRealtime>[0];

export type DemoRoomRealtimeClient = RealtimeFactoryOptions["client"];

interface DemoRoomAuthSubscription {
  unsubscribe: () => void;
}

interface DemoRoomAuthClient extends NoSignupAuthClient {
  auth: NoSignupAuthClient["auth"] & {
    onAuthStateChange: (
      callback: (event: string, session: NoSignupSession | null) => void,
    ) => { data: { subscription: DemoRoomAuthSubscription } };
  };
}

export type DemoRoomStartIntent =
  | {
      kind: "host";
      roomName: string;
      displayName: string;
      color: string;
    }
  | {
      kind: "join";
      slug: string;
      joinToken: string;
      displayName: string;
      color: string;
    }
  | {
      kind: "resume";
      roomId: string;
      expectedRole: "host";
      joinAccess?: { slug: string; joinToken: string };
    }
  | {
      kind: "resume";
      roomId: string;
      expectedRole: "participant";
      joinAccess?: never;
    };

export type DemoRoomStatus =
  | "idle"
  | "authenticating"
  | "creating"
  | "joining"
  | "verifying"
  | "connecting"
  | "ready"
  | "degraded"
  | "error"
  | "disposed";

export type DemoRealtimeStatus =
  | "not_connected"
  | "connecting"
  | "connected"
  | "channel_error"
  | "timed_out"
  | "closed";

export interface DemoRoomSessionError {
  code: string;
  message: string;
  commandCode?: CommandErrorCode;
}

export interface DemoRoomSnapshot {
  status: DemoRoomStatus;
  realtimeStatus: DemoRealtimeStatus;
  identity: { userId: string; isAnonymous: boolean } | null;
  roomId: string | null;
  membership: OwnRoomMembership | null;
  state: CanvasState | null;
  joinAccess: { slug: string; joinToken: string } | null;
  presence: PresenceParticipant[];
  cursors: RemoteCursorState;
  commandPending: boolean;
  lastError: DemoRoomSessionError | null;
}

export interface DemoRoomSessionDependencies {
  authClient: DemoRoomAuthClient;
  roomDataClient: BrowserRoomClient;
  realtimeClient: DemoRoomRealtimeClient;
  createRoomApi: (accessToken: string) => BrowserRoomApi;
  createSketchTransformApi?: (
    accessToken: string,
  ) => BrowserSketchTransformApi;
  createPacketApi?: (accessToken: string) => BrowserPacketApi;
  ensureSession: typeof ensureNoSignupSession;
  loadMembership: typeof loadOwnRoomMembership;
  loadCanvas: typeof loadBrowserCanvas;
  createRealtime: typeof createRoomRealtime;
  hydrateCanvas: (state: CanvasState) => boolean | void;
  createCommandId: () => string;
  now: () => Date;
}

export interface DemoRoomSession {
  getSnapshot: () => DemoRoomSnapshot;
  getAccessToken: () => string | null;
  subscribe: (listener: () => void) => () => void;
  start: (intent: DemoRoomStartIntent) => Promise<DemoRoomStartResult>;
  submitCommand: (
    command: CanvasCommand,
    source: CanvasCommandSource,
    signal?: AbortSignal,
  ) => Promise<DemoRoomCommandResult>;
  transformSketch: (
    input: Omit<SketchTransformRequest, "roomId">,
    signal?: AbortSignal,
  ) => Promise<BrowserSketchTransformResult>;
  loadLatestPacketWorkflow: (
    signal?: AbortSignal,
  ) => Promise<BrowserPacketApiResult<BrowserPersistedPacketWorkflow>>;
  preparePacket: (
    input: Omit<PreparePacketRequest, "roomId">,
    signal?: AbortSignal,
  ) => Promise<BrowserPacketApiResult<BrowserPreparedPacket>>;
  updatePacket: (
    input: Omit<UpdatePacketRequest, "roomId">,
    signal?: AbortSignal,
  ) => Promise<BrowserPacketApiResult<BrowserUpdatedPacket>>;
  approvePacket: (
    input: Omit<ApprovePacketRequest, "roomId">,
    signal?: AbortSignal,
  ) => Promise<BrowserPacketApiResult<BrowserApprovedPacket>>;
  stagePacketSend: (
    input: Omit<StagePacketSendRequest, "roomId">,
    signal?: AbortSignal,
  ) => Promise<BrowserPacketApiResult<BrowserStagedPacketSend>>;
  cancelPacketSend: (
    input: Omit<CancelPacketSendRequest, "roomId">,
    signal?: AbortSignal,
  ) => Promise<BrowserPacketApiResult<BrowserCancelledPacketSend>>;
  executePacketSend: (
    input: Omit<ExecutePacketSendRequest, "roomId">,
    signal?: AbortSignal,
  ) => Promise<BrowserPacketApiResult<BrowserExecutedPacketSend>>;
  publishCursor: (point: { x: number; y: number }) => Promise<boolean>;
  deleteHostedDemoRoom: (
    signal?: AbortSignal,
  ) => Promise<DemoRoomDeleteResult>;
  whenIdle: () => Promise<void>;
  dispose: () => Promise<void>;
}

export type DemoRoomStartResult =
  | { ok: true; roomId: string }
  | ({ ok: false } & DemoRoomSessionError);

export type DemoRoomCommandResult =
  | { ok: true; state: CanvasState }
  | ({ ok: false } & DemoRoomSessionError);

export type DemoRoomDeleteResult =
  | { ok: true; roomId: string; deleted: true }
  | ({ ok: false } & DemoRoomSessionError);

const defaultOperations = {
  ensureSession: ensureNoSignupSession,
  loadMembership: loadOwnRoomMembership,
  loadCanvas: loadBrowserCanvas,
  createRealtime: createRoomRealtime,
};

const resumeIntentSchema = z.discriminatedUnion("expectedRole", [
  z
    .object({
      kind: z.literal("resume"),
      roomId: z.uuid(),
      expectedRole: z.literal("host"),
      joinAccess: z
        .object({
          slug: z
            .string()
            .min(12)
            .max(96)
            .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/),
          joinToken: z
            .string()
            .min(43)
            .max(86)
            .regex(/^[A-Za-z0-9_-]+$/),
        })
        .strict()
        .optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("resume"),
      roomId: z.uuid(),
      expectedRole: z.literal("participant"),
    })
    .strict(),
]);

export type DemoRoomSessionPorts = Omit<
  DemoRoomSessionDependencies,
  keyof typeof defaultOperations
> &
  Partial<typeof defaultOperations>;

/**
 * Coordinates one no-signup browser identity with one durable room session.
 * Presence is empty until the private Realtime channel reports connected clients.
 */
export function createDemoRoomSession(
  rawDependencies: DemoRoomSessionPorts,
): DemoRoomSession {
  const dependencies: DemoRoomSessionDependencies = {
    ...defaultOperations,
    ...rawDependencies,
  };
  const listeners = new Set<() => void>();
  let snapshot: DemoRoomSnapshot = {
    status: "idle",
    realtimeStatus: "not_connected",
    identity: null,
    roomId: null,
    membership: null,
    state: null,
    joinAccess: null,
    presence: [],
    cursors: {},
    commandPending: false,
    lastError: null,
  };
  let noSignupSession: NoSignupSession | null = null;
  let roomApi: BrowserRoomApi | null = null;
  let sketchTransformApi: BrowserSketchTransformApi | null = null;
  let packetApi: BrowserPacketApi | null = null;
  let realtime: RoomRealtimeController | null = null;
  let realtimeOptions: RealtimeFactoryOptions | null = null;
  let authSubscription: DemoRoomAuthSubscription | null = null;
  let disposed = false;
  let startCalled = false;
  let pendingRevision = 0;
  let revisionWork: Promise<void> | null = null;
  let commandWork: Promise<DemoRoomCommandResult> | null = null;
  let roomDeleteWork: Promise<DemoRoomDeleteResult> | null = null;

  function getSnapshot() {
    return snapshot;
  }

  function getAccessToken() {
    return noSignupSession?.access_token ?? null;
  }

  function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function update(patch: Partial<DemoRoomSnapshot>) {
    snapshot = { ...snapshot, ...patch };
    for (const listener of listeners) {
      try {
        listener();
      } catch {
        // A view listener cannot break the canonical room lifecycle.
      }
    }
  }

  function fail(code: string, message: string): DemoRoomStartResult {
    const error = { code, message };
    if (!disposed)
      update({
        status: "error",
        lastError: error,
        membership: null,
        state: null,
        joinAccess: null,
        presence: [],
        cursors: {},
      });
    return { ok: false, ...error };
  }

  function installAuthenticatedSession(session: NoSignupSession) {
    if (
      disposed ||
      (noSignupSession && noSignupSession.user.id !== session.user.id) ||
      noSignupSession?.access_token === session.access_token
    )
      return;
    noSignupSession = session;
    roomApi = dependencies.createRoomApi(session.access_token);
    sketchTransformApi =
      dependencies.createSketchTransformApi?.(session.access_token) ?? null;
    packetApi = dependencies.createPacketApi?.(session.access_token) ?? null;
    if (realtimeOptions) realtimeOptions.accessToken = session.access_token;
  }

  function subscribeToTokenRefresh() {
    authSubscription = dependencies.authClient.auth.onAuthStateChange(
      (event, session) => {
        if (event === "TOKEN_REFRESHED" && session)
          installAuthenticatedSession(session);
      },
    ).data.subscription;
  }

  async function start(intent: DemoRoomStartIntent): Promise<DemoRoomStartResult> {
    if (disposed) return disposedResult();
    if (startCalled)
      return {
        ok: false,
        code: "session_already_started",
        message: "This demo room session has already started.",
      };
    startCalled = true;
    const resumeIntent =
      intent.kind === "resume" ? resumeIntentSchema.safeParse(intent) : null;
    if (resumeIntent && !resumeIntent.success)
      return fail(
        "invalid_resume_descriptor",
        "Stored room access could not be verified.",
      );
    update({ status: "authenticating", lastError: null });

    try {
      const ensured = await dependencies.ensureSession(dependencies.authClient);
      if (disposed) return disposedResult();
      if (!ensured.ok)
        return fail(
          ensured.code,
          "A no-signup browser session could not be established.",
        );
      installAuthenticatedSession(ensured.session);
      subscribeToTokenRefresh();
      const bootstrapRoomApi = roomApi;
      if (!bootstrapRoomApi)
        return fail(
          "session_unavailable",
          "Demo room is temporarily unavailable.",
        );
      update({
        identity: {
          userId: ensured.session.user.id,
          isAnonymous: ensured.session.user.is_anonymous === true,
        },
      });

      let roomId: string;
      let requiredRole: OwnRoomMembership["role"];
      let joinAccess: DemoRoomSnapshot["joinAccess"] = null;

      if (intent.kind === "host") {
        update({ status: "creating" });
        const created = await bootstrapRoomApi.createRoom({
          mode: "demo",
          name: intent.roomName,
          displayName: intent.displayName,
          color: intent.color,
        });
        if (disposed) return disposedResult();
        if (!created.ok)
          return fail(created.error.code, "Demo room could not be created.");
        roomId = created.value.roomId;
        requiredRole = "host";
        joinAccess = {
          slug: created.value.slug,
          joinToken: created.value.joinToken,
        };
      } else if (intent.kind === "join") {
        update({ status: "joining" });
        const joined = await bootstrapRoomApi.joinRoom({
          slug: intent.slug,
          joinToken: intent.joinToken,
          displayName: intent.displayName,
          color: intent.color,
        });
        if (disposed) return disposedResult();
        if (!joined.ok)
          return fail(joined.error.code, "Demo room could not be joined.");
        roomId = joined.value.roomId;
        requiredRole = "participant";
      } else {
        const resumed = resumeIntent!.data;
        roomId = resumed.roomId;
        requiredRole = resumed.expectedRole;
        joinAccess =
          resumed.expectedRole === "host" ? resumed.joinAccess ?? null : null;
      }

      if (!z.uuid().safeParse(roomId).success)
        return fail("room_unavailable", "Demo room could not be verified.");

      update({ status: "verifying" });
      const verifiedMembership = await dependencies.loadMembership(
        dependencies.roomDataClient,
        roomId,
        ensured.session.user.id,
      );
      if (disposed) return disposedResult();
      if (
        !verifiedMembership.ok ||
        verifiedMembership.membership.role !== requiredRole ||
        verifiedMembership.membership.userId !== ensured.session.user.id ||
        verifiedMembership.membership.roomId !== roomId
      )
        return fail(
          "membership_unavailable",
          "Room membership could not be verified.",
        );

      const verifiedCanvas = await dependencies.loadCanvas(
        dependencies.roomDataClient,
        roomId,
      );
      if (disposed) return disposedResult();
      if (!verifiedCanvas.ok || verifiedCanvas.state.roomId !== roomId)
        return fail(
          verifiedCanvas.ok ? "invalid_persisted_state" : verifiedCanvas.code,
          "Canvas state could not be verified.",
        );
      if (dependencies.hydrateCanvas(verifiedCanvas.state) === false)
        return fail(
          "canvas_hydration_refused",
          "Canvas state could not be hydrated.",
        );

      update({
        roomId,
        membership: verifiedMembership.membership,
        state: verifiedCanvas.state,
        joinAccess,
        status: "connecting",
        realtimeStatus: "connecting",
        lastError: null,
      });
      pendingRevision = verifiedCanvas.state.revision;
      try {
        realtimeOptions = {
          client: dependencies.realtimeClient,
          roomId,
          accessToken: noSignupSession!.access_token,
          participant: {
            participantId: ensured.session.user.id,
            displayName: verifiedMembership.membership.displayName,
            role: verifiedMembership.membership.role,
            color: verifiedMembership.membership.color,
            onlineAt: dependencies.now().toISOString(),
          },
          getCurrentRevision: () => snapshot.state?.revision ?? 0,
          onPresence: handlePresence,
          onCursor: handleCursor,
          onRevision: requestRevisionReload,
          onStatus: handleRealtimeStatus,
        };
        realtime = dependencies.createRealtime(realtimeOptions);
        await realtime.connect();
      } catch {
        degrade(
          "realtime_unavailable",
          "Live collaboration is unavailable; verified room state is preserved.",
          "channel_error",
        );
      }
      if (disposed) return disposedResult();
      return { ok: true, roomId };
    } catch {
      return fail("session_unavailable", "Demo room is temporarily unavailable.");
    }
  }

  function handlePresence(participants: PresenceParticipant[]) {
    if (disposed) return;
    update({ presence: [...participants] });
  }

  function handleCursor(cursor: CursorMessage) {
    if (disposed) return;
    const cursors = applyCursorMessage(snapshot.cursors, cursor);
    if (cursors !== snapshot.cursors) update({ cursors });
  }

  function handleRealtimeStatus(status: DemoRealtimeStatus) {
    if (disposed) return;
    if (status === "connected") {
      update({ status: "ready", realtimeStatus: status, lastError: null });
      return;
    }
    if (status === "connecting") {
      update({ status: "connecting", realtimeStatus: status });
      return;
    }
    const error = {
      code: `realtime_${status}`,
      message: "Live collaboration is unavailable; verified room state is preserved.",
    };
    update({ status: "degraded", realtimeStatus: status, lastError: error });
  }

  function requestRevisionReload(revision: number) {
    if (disposed || !snapshot.state || revision <= snapshot.state.revision) return;
    pendingRevision = Math.max(pendingRevision, revision);
    if (!revisionWork) {
      revisionWork = reloadRequestedRevisions().finally(() => {
        revisionWork = null;
      });
    }
  }

  async function reloadRequestedRevisions() {
    while (!disposed && snapshot.state && snapshot.roomId) {
      const target = pendingRevision;
      if (snapshot.state.revision >= target) return;
      const beforeRevision = snapshot.state.revision;
      const loaded = await dependencies.loadCanvas(
        dependencies.roomDataClient,
        snapshot.roomId,
      );
      if (disposed) return;
      if (!loaded.ok || loaded.state.roomId !== snapshot.roomId) {
        degrade(
          loaded.ok ? "invalid_persisted_state" : loaded.code,
          "A live revision could not be verified from durable state.",
        );
        return;
      }
      if (loaded.state.revision < beforeRevision) {
        degrade(
          "stale_persisted_state",
          "A live revision could not be verified from durable state.",
        );
        return;
      }
      if (loaded.state.revision > beforeRevision) {
        if (dependencies.hydrateCanvas(loaded.state) === false) {
          degrade(
            "canvas_hydration_refused",
            "A verified live revision could not be hydrated.",
          );
          return;
        }
        update({ state: loaded.state, lastError: null });
      }
      if (loaded.state.revision < target && pendingRevision === target) {
        degrade(
          "revision_not_visible",
          "A live revision is not visible in durable state yet.",
        );
        return;
      }
    }
  }

  function degrade(
    code: string,
    message: string,
    realtimeStatus?: DemoRealtimeStatus,
  ) {
    if (disposed) return;
    update({
      status: "degraded",
      realtimeStatus: realtimeStatus ?? snapshot.realtimeStatus,
      lastError: { code, message },
    });
  }

  async function submitCommand(
    rawCommand: CanvasCommand,
    source: CanvasCommandSource,
    signal?: AbortSignal,
  ): Promise<DemoRoomCommandResult> {
    if (disposed) return disposedResult();
    if (signal?.aborted)
      return {
        ok: false,
        code: "command_cancelled",
        message: "Canvas change was cancelled.",
      };
    if (commandWork)
      return {
        ok: false,
        code: "command_pending",
        message: "Wait for the current canvas change to finish.",
      };
    if (!noSignupSession || !snapshot.roomId || !snapshot.state)
      return {
        ok: false,
        code: "room_not_ready",
        message: "Create or join a room before changing the canvas.",
      };
    const parsedCommand = canvasCommandSchema.safeParse(rawCommand);
    if (!parsedCommand.success)
      return {
        ok: false,
        code: "invalid_command",
        message: "Canvas command is invalid.",
      };

    const request: CommandRequest = {
      commandId: dependencies.createCommandId(),
      roomId: snapshot.roomId,
      baseRevision: snapshot.state.revision,
      source,
      command: parsedCommand.data,
    };
    const work = commitAuthoritativeCommand(request, signal);
    commandWork = work;
    update({ commandPending: true, lastError: null });
    try {
      return await work;
    } finally {
      commandWork = null;
      if (!disposed) update({ commandPending: false });
    }
  }

  async function commitAuthoritativeCommand(
    request: CommandRequest,
    signal?: AbortSignal,
  ): Promise<DemoRoomCommandResult> {
    try {
      const result = signal
        ? await roomApi!.commitCommand(request, { signal })
        : await roomApi!.commitCommand(request);
      if (disposed) return disposedResult();
      if (!result.ok) {
        const error = {
          code: result.error.code,
          message: result.error.message || "Canvas change was not committed.",
          ...(result.error.commandCode
            ? { commandCode: result.error.commandCode }
            : {}),
        };
        update({ lastError: error });
        return { ok: false, ...error };
      }
      const value = result.value;
      if (
        value.roomId !== request.roomId ||
        value.state.roomId !== request.roomId ||
        value.revision !== value.state.revision ||
        value.revision <= request.baseRevision ||
        !z.uuid().safeParse(value.receiptId).success
      ) {
        const error = {
          code: "invalid_authoritative_state",
          message: "The committed canvas response could not be verified.",
        };
        update({ lastError: error });
        return { ok: false, ...error };
      }
      if (dependencies.hydrateCanvas(value.state) === false) {
        const error = {
          code: "canvas_hydration_refused",
          message: "The committed canvas response could not be hydrated.",
        };
        update({ lastError: error });
        return { ok: false, ...error };
      }
      pendingRevision = Math.max(pendingRevision, value.revision);
      update({ state: value.state, lastError: null });
      return { ok: true, state: value.state };
    } catch {
      if (signal?.aborted)
        return {
          ok: false,
          code: "command_cancelled",
          message: "Canvas change was cancelled.",
        };
      const error = {
        code: "command_unavailable",
        message: "Canvas change is temporarily unavailable.",
      };
      if (!disposed) update({ lastError: error });
      return { ok: false, ...error };
    }
  }

  async function publishCursor(point: { x: number; y: number }) {
    if (disposed || !realtime) return false;
    try {
      return await realtime.publishCursor(point);
    } catch {
      degrade("cursor_unavailable", "Live cursor sharing is unavailable.");
      return false;
    }
  }

  async function deleteHostedDemoRoom(
    signal?: AbortSignal,
  ): Promise<DemoRoomDeleteResult> {
    if (disposed) return disposedResult();
    if (roomDeleteWork) return roomDeleteWork;
    if (
      !roomApi ||
      !snapshot.roomId ||
      !snapshot.membership ||
      snapshot.membership.role !== "host"
    )
      return {
        ok: false,
        code: "host_required",
        message: "Only the demo room host can delete this room.",
      };

    const roomId = snapshot.roomId;
    const work = (async (): Promise<DemoRoomDeleteResult> => {
      const result = await roomApi!.deleteDemoRoom(roomId, { signal });
      if (!result.ok) {
        const error = {
          code: result.error.code,
          message: "Demo room was not reset. Try again.",
        };
        if (!disposed) update({ lastError: error });
        return { ok: false, ...error };
      }
      await dispose();
      return { ok: true, roomId: result.value.roomId, deleted: true };
    })();
    roomDeleteWork = work;
    try {
      return await work;
    } catch {
      const error = {
        code: signal?.aborted ? "request_cancelled" : "delete_unavailable",
        message: "Demo room was not reset. Try again.",
      };
      if (!disposed) update({ lastError: error });
      return { ok: false, ...error };
    } finally {
      if (!disposed) roomDeleteWork = null;
    }
  }

  async function transformSketch(
    input: Omit<SketchTransformRequest, "roomId">,
    signal?: AbortSignal,
  ): Promise<BrowserSketchTransformResult> {
    if (disposed)
      return sketchTransformFailure(
        "session_disposed",
        "This demo room session has been closed.",
      );
    if (!noSignupSession || !snapshot.roomId)
      return sketchTransformFailure(
        "room_not_ready",
        "Create or join a room before interpreting a sketch.",
      );
    if (!sketchTransformApi)
      return sketchTransformFailure(
        "sketch_transform_unconfigured",
        "Sketch interpretation is not configured.",
      );
    return sketchTransformApi.transform({ ...input, roomId: snapshot.roomId }, signal);
  }

  async function preparePacket(
    input: Omit<PreparePacketRequest, "roomId">,
    signal?: AbortSignal,
  ) {
    const unavailable = packetWorkflowUnavailable<BrowserPreparedPacket>();
    if (unavailable) return unavailable;
    return packetApi!.prepare({ ...input, roomId: snapshot.roomId! }, signal);
  }

  async function loadLatestPacketWorkflow(signal?: AbortSignal) {
    const unavailable =
      packetWorkflowUnavailable<BrowserPersistedPacketWorkflow>();
    if (unavailable) return unavailable;
    return packetApi!.loadLatest(snapshot.roomId!, signal);
  }

  async function updatePacket(
    input: Omit<UpdatePacketRequest, "roomId">,
    signal?: AbortSignal,
  ) {
    const unavailable = packetWorkflowUnavailable<BrowserUpdatedPacket>();
    if (unavailable) return unavailable;
    return packetApi!.update({ ...input, roomId: snapshot.roomId! }, signal);
  }

  async function approvePacket(
    input: Omit<ApprovePacketRequest, "roomId">,
    signal?: AbortSignal,
  ) {
    const unavailable = packetWorkflowUnavailable<BrowserApprovedPacket>();
    if (unavailable) return unavailable;
    return packetApi!.approve({ ...input, roomId: snapshot.roomId! }, signal);
  }

  async function stagePacketSend(
    input: Omit<StagePacketSendRequest, "roomId">,
    signal?: AbortSignal,
  ) {
    const unavailable = packetWorkflowUnavailable<BrowserStagedPacketSend>();
    if (unavailable) return unavailable;
    return packetApi!.stageSend({ ...input, roomId: snapshot.roomId! }, signal);
  }

  async function executePacketSend(
    input: Omit<ExecutePacketSendRequest, "roomId">,
    signal?: AbortSignal,
  ) {
    const unavailable = packetWorkflowUnavailable<BrowserExecutedPacketSend>();
    if (unavailable) return unavailable;
    return packetApi!.executeSend({ ...input, roomId: snapshot.roomId! }, signal);
  }

  async function cancelPacketSend(
    input: Omit<CancelPacketSendRequest, "roomId">,
    signal?: AbortSignal,
  ) {
    const unavailable = packetWorkflowUnavailable<BrowserCancelledPacketSend>();
    if (unavailable) return unavailable;
    return packetApi!.cancelSend({ ...input, roomId: snapshot.roomId! }, signal);
  }

  function packetWorkflowUnavailable<T>(): BrowserPacketApiResult<T> | null {
    if (!noSignupSession || !snapshot.roomId)
      return {
        ok: false,
        error: {
          code: "room_not_ready",
          message: "Create or join a room before using meeting packets.",
        },
      };
    if (!packetApi)
      return {
        ok: false,
        error: {
          code: "packet_api_unconfigured",
          message: "Meeting packet actions are not configured.",
        },
      };
    return null;
  }

  async function whenIdle() {
    while (revisionWork || commandWork) {
      if (revisionWork) await revisionWork;
      if (commandWork) await commandWork;
    }
  }

  async function dispose() {
    if (disposed) return;
    disposed = true;
    const activeRealtime = realtime;
    const activeAuthSubscription = authSubscription;
    realtime = null;
    realtimeOptions = null;
    authSubscription = null;
    noSignupSession = null;
    roomApi = null;
    sketchTransformApi = null;
    packetApi = null;
    update({
      status: "disposed",
      realtimeStatus: "closed",
      presence: [],
      cursors: {},
      commandPending: false,
    });
    activeAuthSubscription?.unsubscribe();
    if (activeRealtime) await activeRealtime.dispose();
  }

  return {
    getSnapshot,
    getAccessToken,
    subscribe,
    start,
    submitCommand,
    transformSketch,
    loadLatestPacketWorkflow,
    preparePacket,
    updatePacket,
    approvePacket,
    stagePacketSend,
    cancelPacketSend,
    executePacketSend,
    publishCursor,
    deleteHostedDemoRoom,
    whenIdle,
    dispose,
  };
}

function disposedResult() {
  return {
    ok: false as const,
    code: "session_disposed",
    message: "This demo room session has been closed.",
  };
}

function sketchTransformFailure(
  code: string,
  message: string,
): BrowserSketchTransformResult {
  return { ok: false, error: { code, message } };
}
