"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CommandCanvasRoom } from "@/components/command-canvas/command-canvas-room";
import type { WebMcpSurfaceState } from "@/components/command-canvas/chatgpt-command-surface";
import type { SpatialCameraControllerPreferences } from "@/components/command-canvas/spatial-camera-control";
import { MeetingFilmstrip } from "@/components/command-canvas/meeting-filmstrip";
import {
  MeetingPacketWorkflowPanel,
  useMeetingPacketWorkflow,
  webMcpPacketFailure,
} from "@/components/command-canvas/meeting-packet-workflow";
import type { MeetingPacketRecipientInput } from "@/components/command-canvas/meeting-packet-panel";
import {
  bootstrapDemoRoom,
  type DemoRoomBootstrapResult,
} from "@/lib/demo/bootstrap";
import { clearStoredDemoRoom } from "@/lib/demo/room-link";
import {
  createDemoRoomSession,
  type DemoRoomSession,
  type DemoRoomSnapshot,
} from "@/lib/demo/room-session";
import type { DemoRoomRealtimeClient } from "@/lib/demo/room-session";
import type { MeetingMediaClient } from "@/lib/meeting/media-controller";
import { createSharedCameraHandController } from "@/lib/gesture/shared-camera-controller";
import type { BrowserRoomClient } from "@/lib/supabase/browser-room";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser-client";
import { createBrowserRoomApi } from "@/lib/supabase/room-api";
import { createBrowserPacketApi } from "@/lib/packets/browser-api";
import {
  createBrowserOpenAiCredentialApi,
  type BrowserOpenAiCredentialApi,
  type BrowserOpenAiCredentialStatus,
} from "@/lib/openai-credentials/browser-api";
import { createCanvasWebMcpAdapters } from "@/lib/webmcp/canvas-adapters";
import type { WebMcpExecutionContext } from "@/lib/webmcp/phase-guards";
import {
  WebMcpRegistry,
  type WebMcpExecutionEvent,
} from "@/lib/webmcp/registry";
import { upsertWebMcpExecutionActivity } from "@/lib/webmcp/execution-activity";
import { useDocumentWebMcpTarget } from "@/lib/webmcp/use-document-target";
import {
  createCanvasSketchTransformer,
  type CanvasSketchTransformer,
  type CanvasSketchTransformerOptions,
} from "@/lib/vision/canvas-transform";
import { createBrowserSketchTransformApi } from "@/lib/vision/browser-api";

export interface DemoCommandCanvasEnvironment {
  bootstrap: (
    getOpenAiApiKey?: () => string,
    getUseSavedOpenAiCredential?: () => boolean,
  ) => Promise<DemoRoomBootstrapResult>;
  copyInvite: (inviteUrl: string) => Promise<void>;
  resetDemo: () => void;
  createSketchTransformer?: (
    options: CanvasSketchTransformerOptions,
  ) => CanvasSketchTransformer;
  createPacketId?: () => string;
}

interface DemoCommandCanvasProps {
  environment?: DemoCommandCanvasEnvironment;
  privateGpuRelayEnabled?: boolean;
}

interface DemoRoomBootstrapOperation {
  environment: DemoCommandCanvasEnvironment;
  promise: Promise<DemoRoomBootstrapResult>;
  activeConsumers: number;
  session: DemoRoomSession | null;
  disposed: boolean;
}

type DemoView =
  | { status: "loading" }
  | { status: "error"; code: string; message: string }
  | {
      status: "ready";
      room: Extract<DemoRoomBootstrapResult, { ok: true }>;
      snapshot: DemoRoomSnapshot;
    };

const defaultEnvironment: DemoCommandCanvasEnvironment = {
  bootstrap: bootstrapBrowserDemoRoom,
  async copyInvite(inviteUrl) {
    if (!navigator.clipboard?.writeText)
      throw new Error("Clipboard access is unavailable.");
    await navigator.clipboard.writeText(inviteUrl);
  },
  resetDemo() {
    clearStoredDemoRoom(window.sessionStorage);
    window.history.replaceState(null, "", "/demo");
    window.location.reload();
  },
  createPacketId: () =>
    `packet-${globalThis.crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`,
};

const DEMO_PACKET_RECIPIENTS: readonly MeetingPacketRecipientInput[] = [
  { name: "Demo reviewer", email: "reviewer@example.com" },
];

export function DemoCommandCanvas({
  environment = defaultEnvironment,
  privateGpuRelayEnabled = false,
}: DemoCommandCanvasProps) {
  const [view, setView] = useState<DemoView>({ status: "loading" });
  const [copyState, setCopyState] = useState<
    "idle" | "copying" | "copied" | "failed"
  >("idle");
  const [webMcpStatus, setWebMcpStatus] = useState<{
    value: string;
    tone: "idle" | "working" | "ready";
  }>({ value: "Checking Site Tools…", tone: "working" });
  const [webMcpSurfaceState, setWebMcpSurfaceState] =
    useState<WebMcpSurfaceState>({ status: "checking" });
  const [webMcpExecutionActivity, setWebMcpExecutionActivity] = useState<
    readonly WebMcpExecutionEvent[]
  >([]);
  const [resetState, setResetState] = useState<
    | { status: "idle" }
    | { status: "deleting" }
    | { status: "failed"; message: string }
  >({ status: "idle" });
  const [openAiApiKey, setOpenAiApiKey] = useState("");
  const [savedOpenAiCredential, setSavedOpenAiCredential] =
    useState<BrowserOpenAiCredentialStatus>({ configured: false });
  const [savedOpenAiCredentialBusy, setSavedOpenAiCredentialBusy] =
    useState(false);
  const [savedOpenAiCredentialError, setSavedOpenAiCredentialError] =
    useState<string | null>(null);
  const [useSavedOpenAiCredential, setUseSavedOpenAiCredential] =
    useState(false);
  const openAiApiKeyRef = useRef("");
  const useSavedOpenAiCredentialRef = useRef(false);
  const openAiCredentialApiRef = useRef<BrowserOpenAiCredentialApi | null>(null);
  const openAiCredentialAbortRef = useRef<AbortController | null>(null);
  const webMcpRegistryRef = useRef<WebMcpRegistry | null>(null);
  const webMcpTarget = useDocumentWebMcpTarget();
  const meetingMediaStreamRef = useRef<MediaStream | null>(null);
  const bootstrapOperationRef = useRef<DemoRoomBootstrapOperation | null>(null);
  const readyRoom = view.status === "ready" ? view.room : null;
  const activeRoomId = view.status === "ready" ? view.snapshot.roomId : null;
  const packetWorkflow = useMeetingPacketWorkflow({
    session: readyRoom?.session ?? null,
    store: readyRoom?.store ?? null,
    canManage: readyRoom?.role === "host",
    defaultRecipients: DEMO_PACKET_RECIPIENTS,
    createPacketId:
      environment.createPacketId ?? defaultEnvironment.createPacketId,
  });
  const handleMeetingMediaStreamChange = useCallback(
    (stream: MediaStream | null) => {
      meetingMediaStreamRef.current = stream;
    },
    [],
  );
  const createMeetingAwareHandController = useCallback(
    (preferences: SpatialCameraControllerPreferences) =>
      createSharedCameraHandController({
        getMeetingStream: () => meetingMediaStreamRef.current,
        ...(privateGpuRelayEnabled && readyRoom && activeRoomId
          ? {
              privateHandRelay: {
                roomId: activeRoomId,
                getAccessToken: readyRoom.session.getAccessToken,
                cameraUploadConsent: preferences.cameraUploadConsent,
              },
            }
          : {}),
      }),
    [activeRoomId, privateGpuRelayEnabled, readyRoom],
  );
  const updateOpenAiApiKey = useCallback((value: string) => {
    openAiApiKeyRef.current = value;
    setOpenAiApiKey(value);
  }, []);
  const selectSavedOpenAiCredential = useCallback((value: boolean) => {
    useSavedOpenAiCredentialRef.current = value;
    setUseSavedOpenAiCredential(value);
  }, []);
  const sketchTransformer = useMemo(() => {
    if (!readyRoom) return null;
    const createTransformer =
      environment.createSketchTransformer ?? createCanvasSketchTransformer;
    return createTransformer({
      store: readyRoom.store,
      session: readyRoom.session,
    });
  }, [environment, readyRoom]);

  async function resetCurrentDemoRoom() {
    if (resetState.status === "deleting") return;
    if (!readyRoom || readyRoom.role === "participant") {
      environment.resetDemo();
      return;
    }

    setResetState({ status: "deleting" });
    const deleted = await readyRoom.session.deleteHostedDemoRoom();
    if (!deleted.ok) {
      setResetState({ status: "failed", message: deleted.message });
      return;
    }
    environment.resetDemo();
  }

  useEffect(() => {
    let active = true;
    let session: DemoRoomSession | null = null;
    let unsubscribe: () => void = () => undefined;

    let operation = bootstrapOperationRef.current;
    if (!operation || operation.environment !== environment) {
      operation = {
        environment,
        promise: environment.bootstrap(
          () => openAiApiKeyRef.current,
          () => useSavedOpenAiCredentialRef.current,
        ),
        activeConsumers: 0,
        session: null,
        disposed: false,
      };
      bootstrapOperationRef.current = operation;
    }
    operation.activeConsumers += 1;

    const disposeOperation = async () => {
      if (operation.disposed || !operation.session) return;
      operation.disposed = true;
      await operation.session.dispose();
    };

    void operation.promise.then(async (result) => {
      if (result.ok) operation.session = result.session;
      if (!active) {
        if (operation.activeConsumers === 0) await disposeOperation();
        return;
      }
      if (!result.ok) {
        setView({ status: "error", code: result.code, message: result.message });
        return;
      }

      session = result.session;
      const updateSnapshot = () => {
        if (active && session)
          setView({
            status: "ready",
            room: result,
            snapshot: session.getSnapshot(),
          });
      };
      unsubscribe = session.subscribe(updateSnapshot);
      updateSnapshot();
    });

    return () => {
      active = false;
      unsubscribe();
      openAiApiKeyRef.current = "";
      useSavedOpenAiCredentialRef.current = false;
      operation.activeConsumers = Math.max(0, operation.activeConsumers - 1);
      if (operation.activeConsumers === 0) void disposeOperation();
    };
  }, [environment]);

  const permanentIdentityId =
    view.status === "ready" && view.snapshot.identity?.isAnonymous === false
      ? view.snapshot.identity.userId
      : null;

  useEffect(() => {
    let active = true;
    openAiCredentialAbortRef.current?.abort();
    openAiCredentialAbortRef.current = null;
    openAiCredentialApiRef.current = null;

    if (!readyRoom || !permanentIdentityId) {
      queueMicrotask(() => {
        if (!active) return;
        setSavedOpenAiCredential({ configured: false });
        setSavedOpenAiCredentialBusy(false);
        setSavedOpenAiCredentialError(null);
        selectSavedOpenAiCredential(false);
      });
      return () => {
        active = false;
      };
    }

    const accessToken = readyRoom.session.getAccessToken();
    if (!accessToken) {
      queueMicrotask(() => {
        if (!active) return;
        setSavedOpenAiCredential({ configured: false });
        setSavedOpenAiCredentialBusy(false);
        setSavedOpenAiCredentialError(
          "OpenAI credential service is unavailable for this room.",
        );
        selectSavedOpenAiCredential(false);
      });
      return () => {
        active = false;
      };
    }

    const lifecycle = new AbortController();
    const credentialApi = createBrowserOpenAiCredentialApi({ accessToken });
    openAiCredentialAbortRef.current = lifecycle;
    openAiCredentialApiRef.current = credentialApi;
    queueMicrotask(() => {
      if (!active || lifecycle.signal.aborted) return;
      setSavedOpenAiCredentialBusy(true);
      setSavedOpenAiCredentialError(null);
    });
    void credentialApi.load(lifecycle.signal).then((result) => {
      if (
        !active ||
        lifecycle.signal.aborted ||
        openAiCredentialApiRef.current !== credentialApi
      )
        return;
      setSavedOpenAiCredentialBusy(false);
      if (!result.ok) {
        setSavedOpenAiCredential({ configured: false });
        selectSavedOpenAiCredential(false);
        setSavedOpenAiCredentialError(result.error.message);
        return;
      }
      setSavedOpenAiCredential(result.value);
      selectSavedOpenAiCredential(result.value.configured);
    });

    return () => {
      active = false;
      lifecycle.abort();
      if (openAiCredentialAbortRef.current === lifecycle)
        openAiCredentialAbortRef.current = null;
      if (openAiCredentialApiRef.current === credentialApi)
        openAiCredentialApiRef.current = null;
    };
  }, [permanentIdentityId, readyRoom, selectSavedOpenAiCredential]);

  async function saveOpenAiCredential(apiKey: string) {
    const signal = openAiCredentialAbortRef.current?.signal;
    const accessToken = readyRoom?.session.getAccessToken();
    if (!permanentIdentityId || !accessToken || !signal || signal.aborted) {
      setSavedOpenAiCredentialError(
        "OpenAI credential service is unavailable for this room.",
      );
      return;
    }
    const credentialApi = createBrowserOpenAiCredentialApi({ accessToken });
    openAiCredentialApiRef.current = credentialApi;
    setSavedOpenAiCredentialBusy(true);
    setSavedOpenAiCredentialError(null);
    const result = await credentialApi.save(
      { apiKey, confirmSave: true },
      signal,
    );
    if (signal.aborted || openAiCredentialApiRef.current !== credentialApi)
      return;
    setSavedOpenAiCredentialBusy(false);
    if (!result.ok) {
      setSavedOpenAiCredentialError(result.error.message);
      return;
    }
    updateOpenAiApiKey("");
    setSavedOpenAiCredential(result.value);
    selectSavedOpenAiCredential(true);
  }

  async function deleteOpenAiCredential() {
    const signal = openAiCredentialAbortRef.current?.signal;
    const accessToken = readyRoom?.session.getAccessToken();
    if (!permanentIdentityId || !accessToken || !signal || signal.aborted) {
      setSavedOpenAiCredentialError(
        "OpenAI credential service is unavailable for this room.",
      );
      return;
    }
    const credentialApi = createBrowserOpenAiCredentialApi({ accessToken });
    openAiCredentialApiRef.current = credentialApi;
    setSavedOpenAiCredentialBusy(true);
    setSavedOpenAiCredentialError(null);
    const result = await credentialApi.clear(signal);
    if (signal.aborted || openAiCredentialApiRef.current !== credentialApi)
      return;
    setSavedOpenAiCredentialBusy(false);
    if (!result.ok) {
      setSavedOpenAiCredentialError(result.error.message);
      return;
    }
    setSavedOpenAiCredential(result.value);
    selectSavedOpenAiCredential(false);
  }

  /* Packet adapters intentionally call stable workflow methods that read the
     latest canonical state. Re-registering every render would create Site Tool
     lifecycle churn. */
  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    if (!readyRoom || !sketchTransformer) return;
    let active = true;
    if (!webMcpTarget) {
      queueMicrotask(() => {
        if (active)
          setWebMcpStatus({ value: "Site Tools unavailable", tone: "idle" });
        if (active) setWebMcpSurfaceState({ status: "unavailable" });
      });
      return () => {
        active = false;
      };
    }

    const room = readyRoom;
    const mode =
      process.env.NEXT_PUBLIC_WEBMCP_DYNAMIC_REGISTRATION === "true"
        ? "dynamic"
        : "static";
    const registry = new WebMcpRegistry({
      mode,
      target: webMcpTarget,
      getContext: () =>
        demoWebMcpContext(
          room.session,
          room.store,
          packetWorkflow.getStatus(),
        ),
      adapters: createCanvasWebMcpAdapters({
        store: room.store,
        transformSketch: sketchTransformer.transform,
        prepareMeetingPacket: async (request) => {
          const result = await packetWorkflow.preparePacket(
            {
              title: request.input.title,
              objectIds: request.input.objectIds,
              actorType: "agent",
            },
            request.signal,
          );
          if (!result.ok) return webMcpPacketFailure(result.error);
          return {
            ok: true,
            status: "completed",
            message: "Meeting packet draft prepared for host review.",
            data: {
              packetId: result.value.packetId,
              packetVersion: result.value.packetVersion,
              sourceRevision: result.value.sourceRevision,
              objectCount: result.value.objectCount,
            },
          };
        },
        stagePacketSendRequest: async (request) => {
          const result = await packetWorkflow.stagePacketSend(
            request.input.packetId,
            "agent",
            request.signal,
          );
          if (!result.ok) return webMcpPacketFailure(result.error);
          return {
            ok: true,
            status: "awaiting_human_approval",
            message:
              "Packet send staged. The host must review the exact recipients and press SEND.",
            data: {
              packetId: result.value.packetId,
              sendRequestId: result.value.sendRequestId,
              recipientCount: result.value.recipientCount,
            },
          };
        },
        dispatchMutation: async (command, signal) => {
          const result = await room.session.submitCommand(
            command,
            "webmcp",
            signal,
          );
          if (!result.ok)
            return {
              ok: false,
              code:
                result.code === "invalid_command"
                  ? "invalid_input"
                  : result.code === "host_required"
                    ? "forbidden"
                    : "execution_failed",
              message: result.message,
            };
          const receipt = result.state.receipts.at(-1);
          if (!receipt || receipt.source !== "webmcp")
            return {
              ok: false,
              code: "execution_failed",
              message: "The agent mutation receipt could not be verified.",
            };
          return {
            ok: true,
            status: "completed",
            message: receipt.description,
            receiptId: receipt.id,
            data: {
              revision: receipt.revision,
              affectedObjectIds: receipt.affectedObjectIds,
            },
          };
        },
      }),
      onExecutionEvent(event) {
        if (!active) return;
        setWebMcpExecutionActivity((current) =>
          upsertWebMcpExecutionActivity(current, event),
        );
        setWebMcpSurfaceState({
          status: "invoked",
          registeredToolCount: registry.registeredToolNames().length,
          latestInvocationId: event.invocationId,
        });
      },
    });
    webMcpRegistryRef.current = registry;

    const sync = async () => {
      try {
        await registry.sync();
        if (active)
          setWebMcpStatus({
            value: `${registry.registeredToolNames().length} Site Tools registered`,
            tone: "ready",
          });
        if (active)
          setWebMcpSurfaceState((current) =>
            current.status === "invoked"
              ? current
              : {
                  status: "registered_to_page",
                  registeredToolCount: registry.registeredToolNames().length,
                },
          );
      } catch {
        if (active)
          setWebMcpStatus({
            value: "Site Tools registration failed",
            tone: "idle",
          });
        if (active)
          setWebMcpSurfaceState({ status: "registration_failed" });
      }
    };
    void sync();
    const unsubscribers =
      mode === "dynamic"
        ? [
            room.store.subscribe(() => void sync()),
            room.session.subscribe(() => void sync()),
          ]
        : [];

    return () => {
      active = false;
      for (const unsubscribe of unsubscribers) unsubscribe();
      registry.dispose();
      if (webMcpRegistryRef.current === registry)
        webMcpRegistryRef.current = null;
    };
  }, [readyRoom, sketchTransformer, webMcpTarget]);
  /* eslint-enable react-hooks/exhaustive-deps */

  useEffect(() => {
    const registry = webMcpRegistryRef.current;
    if (!registry) return;
    void registry.sync().then(
      () =>
        {
          setWebMcpStatus({
            value: `${registry.registeredToolNames().length} Site Tools registered`,
            tone: "ready",
          });
          setWebMcpSurfaceState((current) =>
            current.status === "invoked"
              ? current
              : {
                  status: "registered_to_page",
                  registeredToolCount: registry.registeredToolNames().length,
                },
          );
        },
      () => {
        setWebMcpStatus({
          value: "Site Tools registration failed",
          tone: "idle",
        });
        setWebMcpSurfaceState({ status: "registration_failed" });
      },
    );
  }, [packetWorkflow.state.packet?.status]);

  if (view.status === "loading")
    return (
      <main className="demo-gate" aria-live="polite">
        <span className="demo-gate-mark" aria-hidden="true">
          CC
        </span>
        <p className="eyebrow">CommandCanvas / judge mode</p>
        <h1>Opening the no-signup judge preview…</h1>
        <p>
          Creating an anonymous browser identity, verifying room access, and
          arranging deterministic semantic objects.
        </p>
      </main>
    );

  if (view.status === "error")
    return (
      <main className="demo-gate" role="alert">
        <span className="demo-gate-mark" aria-hidden="true">
          !
        </span>
        <p className="eyebrow">{view.code}</p>
        <h1>Demo room unavailable</h1>
        <p>{view.message}</p>
        <button type="button" onClick={environment.resetDemo}>
          Try again
        </button>
        <a href="/local">Open local canvas fallback</a>
      </main>
    );

  const { room, snapshot } = view;
  const collaborationStatus = describeCollaboration(snapshot);
  const participants = snapshot.presence.map((participant) => ({
    id: participant.participantId,
    displayName: participant.displayName,
    color: participant.color,
    role: participant.role,
  }));
  const meetingParticipants = new Map(
    participants.map((participant) => [participant.id, participant]),
  );
  if (snapshot.membership)
    meetingParticipants.set(snapshot.membership.userId, {
      id: snapshot.membership.userId,
      displayName: snapshot.membership.displayName,
      color: snapshot.membership.color,
      role: snapshot.membership.role,
    });
  const participantById = new Map(
    snapshot.presence.map((participant) => [participant.participantId, participant]),
  );
  const remoteCursors = Object.values(snapshot.cursors).flatMap((cursor) => {
    if (cursor.participantId === snapshot.identity?.userId) return [];
    const participant = participantById.get(cursor.participantId);
    return participant
      ? [
          {
            participantId: cursor.participantId,
            displayName: participant.displayName,
            color: participant.color,
            x: cursor.x,
            y: cursor.y,
          },
        ]
      : [];
  });
  const meetingPacketPanel =
    room.role === "host" ? (
      <MeetingPacketWorkflowPanel workflow={packetWorkflow} />
    ) : undefined;

  return (
    <div className="demo-room-stage">
      <aside
        className="demo-preview-boundary"
        aria-label="No-signup judge preview"
      >
        <strong>No-signup judge preview</strong>
        <span>Temporary Supabase room · email remains preview-only</span>
        <a href="/meet">Workspace sign-in</a>
      </aside>
      <div className="demo-room-controls" aria-label="Demo room controls">
        <span>{room.role === "host" ? "HOST" : "PARTICIPANT"}</span>
        {room.inviteUrl ? (
          <button
            type="button"
            aria-label="Copy participant invite"
            disabled={copyState === "copying"}
            onClick={async () => {
              setCopyState("copying");
              try {
                await environment.copyInvite(room.inviteUrl!);
                setCopyState("copied");
              } catch {
                setCopyState("failed");
              }
            }}
          >
            {copyState === "copied"
              ? "Invite copied"
              : copyState === "failed"
                ? "Copy unavailable"
                : "Copy invite"}
          </button>
        ) : null}
        <button
          type="button"
          aria-label="Reset demo"
          disabled={resetState.status === "deleting"}
          onClick={() => void resetCurrentDemoRoom()}
        >
          {resetState.status === "deleting" ? "Resetting…" : "Reset demo"}
        </button>
        {resetState.status === "failed" ? (
          <p role="alert">{resetState.message}</p>
        ) : null}
      </div>
      <CommandCanvasRoom
        store={room.store}
        roomLabel="Live demo room"
        roomStatus={
          snapshot.realtimeStatus === "connected"
            ? "live"
            : snapshot.status === "degraded"
              ? "offline"
              : "connecting"
        }
        participants={participants}
        remoteCursors={remoteCursors}
        serviceStatus={{
          webMcp: webMcpStatus,
          collaboration: collaborationStatus,
          spatialInput: { value: "Camera off · pointer active", tone: "idle" },
        }}
        webMcpSurfaceState={webMcpSurfaceState}
        webMcpExecutionActivity={webMcpExecutionActivity}
        onCommand={async (command, source) => {
          const result = await room.session.submitCommand(command, source);
          if (!result.ok) throw new Error(result.message);
        }}
        onTransformSketch={sketchTransformer?.transform}
        onCanvasPointerWorldMove={(point) => {
          void room.session.publishCursor(point);
        }}
        createHandTrackingController={createMeetingAwareHandController}
        privateGpuRelayAvailable={Boolean(
          privateGpuRelayEnabled && activeRoomId && readyRoom,
        )}
        realtimeVoice={{
          roomId: snapshot.roomId!,
          getAccessToken: room.session.getAccessToken,
          disabled:
            snapshot.status !== "ready" && snapshot.status !== "degraded",
          ...(permanentIdentityId
            ? {
                useSavedOpenAiCredential,
                onUseSavedOpenAiCredentialChange:
                  selectSavedOpenAiCredential,
                savedOpenAiCredential: {
                  ...savedOpenAiCredential,
                  busy: savedOpenAiCredentialBusy,
                  ...(savedOpenAiCredentialError
                    ? { error: savedOpenAiCredentialError }
                    : {}),
                  onSave: saveOpenAiCredential,
                  onDelete: deleteOpenAiCredential,
                },
              }
            : {}),
        }}
        openAiApiKey={openAiApiKey}
        onOpenAiApiKeyChange={updateOpenAiApiKey}
        meetingMediaPanel={
          room.meetingMediaClient && snapshot.membership ? (
            <MeetingFilmstrip
              roomId={snapshot.roomId!}
              localParticipantId={snapshot.membership.userId}
              participants={[...meetingParticipants.values()]}
              getAccessToken={room.session.getAccessToken}
              client={room.meetingMediaClient}
              onLocalStreamChange={handleMeetingMediaStreamChange}
            />
          ) : undefined
        }
        commandDrawerRequestKey={packetWorkflow.state.stagedSend?.id}
        meetingPacketPanel={meetingPacketPanel}
      />
    </div>
  );
}

async function bootstrapBrowserDemoRoom(
  getOpenAiApiKey: () => string = () => "",
  getUseSavedOpenAiCredential: () => boolean = () => false,
) {
  const clientResult = createBrowserSupabaseClient({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });
  if (!clientResult.ok)
    return {
      ok: false as const,
      code: clientResult.code,
      message: clientResult.message,
    };

  const client = clientResult.client;
  const bootstrapped = await bootstrapDemoRoom({
    search: window.location.search,
    origin: window.location.origin,
    storage: window.sessionStorage,
    replacePath: (path) => window.history.replaceState(null, "", path),
    createSession: (hydrateCanvas) =>
      createDemoRoomSession({
        authClient: client,
        roomDataClient: client as unknown as BrowserRoomClient,
        realtimeClient: client as unknown as DemoRoomRealtimeClient,
        createRoomApi: (accessToken) => createBrowserRoomApi({ accessToken }),
        createSketchTransformApi: (accessToken) =>
          createBrowserSketchTransformApi({
            accessToken,
            getOpenAiApiKey,
            getUseSavedOpenAiCredential,
          }),
        createPacketApi: (accessToken) =>
          createBrowserPacketApi({ accessToken }),
        hydrateCanvas,
        createCommandId: () => globalThis.crypto.randomUUID(),
        now: () => new Date(),
      }),
  });
  return bootstrapped.ok
    ? {
        ...bootstrapped,
        meetingMediaClient: client as unknown as MeetingMediaClient,
      }
    : bootstrapped;
}

function describeCollaboration(snapshot: DemoRoomSnapshot) {
  if (snapshot.realtimeStatus === "connected")
    return {
      value: `${snapshot.presence.length} present via Supabase Realtime`,
      tone: "ready" as const,
    };
  if (snapshot.status === "degraded")
    return {
      value: "Realtime unavailable · state preserved",
      tone: "idle" as const,
    };
  return { value: "Connecting to Supabase Realtime…", tone: "working" as const };
}

function demoWebMcpContext(
  session: DemoRoomSession,
  store: Extract<DemoRoomBootstrapResult, { ok: true }>["store"],
  packetStatus: "none" | "draft" | "approved",
): WebMcpExecutionContext {
  const snapshot = session.getSnapshot();
  const state = store.getState();
  const objects = Object.values(state.canvas.objects).filter(
    (object) => !object.deletedAt,
  );
  const selected = state.selectedObjectId
    ? state.canvas.objects[state.selectedObjectId]
    : undefined;
  return {
    phase: {
      roomActive: Boolean(snapshot.roomId && snapshot.membership),
      hasContent: objects.length > 0,
      selection: selected
        ? selected.type === "sketch"
          ? "sketch"
          : "object"
        : "none",
      collaboratorCount: snapshot.presence.length,
      packet:
        packetStatus === "approved"
          ? "approved"
          : packetStatus === "draft"
            ? "prepared"
            : "none",
    },
    actor: snapshot.membership
      ? {
          participantId: snapshot.membership.userId,
          role: snapshot.membership.role,
        }
      : null,
    canMutateCanvas: snapshot.membership?.role === "host",
  };
}
