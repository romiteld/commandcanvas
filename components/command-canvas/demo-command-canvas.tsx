"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { CommandCanvasRoom } from "@/components/command-canvas/command-canvas-room";
import { MeetingFilmstrip } from "@/components/command-canvas/meeting-filmstrip";
import {
  MeetingPacketPanel,
  type MeetingPacketActivityView,
  type MeetingPacketRecipientInput,
  type MeetingPacketSendOutcomeView,
  type MeetingPacketView,
  type StagedPacketSendView,
} from "@/components/command-canvas/meeting-packet-panel";
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
import type { BrowserPersistedPacketWorkflow } from "@/lib/packets/browser-api";
import { createCanvasWebMcpAdapters } from "@/lib/webmcp/canvas-adapters";
import { resolveDocumentWebMcpTarget } from "@/lib/webmcp/document-target";
import type { WebMcpExecutionContext } from "@/lib/webmcp/phase-guards";
import { WebMcpRegistry } from "@/lib/webmcp/registry";
import {
  createCanvasSketchTransformer,
  type CanvasSketchTransformer,
  type CanvasSketchTransformerOptions,
} from "@/lib/vision/canvas-transform";
import { createBrowserSketchTransformApi } from "@/lib/vision/browser-api";

export interface DemoCommandCanvasEnvironment {
  bootstrap: () => Promise<DemoRoomBootstrapResult>;
  copyInvite: (inviteUrl: string) => Promise<void>;
  resetDemo: () => void;
  createSketchTransformer?: (
    options: CanvasSketchTransformerOptions,
  ) => CanvasSketchTransformer;
  createPacketId?: () => string;
}

interface DemoCommandCanvasProps {
  environment?: DemoCommandCanvasEnvironment;
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

interface DemoPacketWorkflowState {
  packet: MeetingPacketView | null;
  activity?: readonly MeetingPacketActivityView[];
  stagedSend?: StagedPacketSendView;
  sendOutcome?: MeetingPacketSendOutcomeView;
  error?: string;
}

const EMPTY_PACKET_WORKFLOW: DemoPacketWorkflowState = { packet: null };
const DEMO_PACKET_RECIPIENTS: readonly MeetingPacketRecipientInput[] = [
  { name: "Demo reviewer", email: "reviewer@example.com" },
];

export function DemoCommandCanvas({
  environment = defaultEnvironment,
}: DemoCommandCanvasProps) {
  const [view, setView] = useState<DemoView>({ status: "loading" });
  const [copyState, setCopyState] = useState<
    "idle" | "copying" | "copied" | "failed"
  >("idle");
  const [webMcpStatus, setWebMcpStatus] = useState<{
    value: string;
    tone: "idle" | "working" | "ready";
  }>({ value: "Checking Site Tools…", tone: "working" });
  const [packetWorkflow, setPacketWorkflow] =
    useState<DemoPacketWorkflowState>(EMPTY_PACKET_WORKFLOW);
  const [packetBusy, setPacketBusy] = useState(false);
  const [resetState, setResetState] = useState<
    | { status: "idle" }
    | { status: "deleting" }
    | { status: "failed"; message: string }
  >({ status: "idle" });
  const packetWorkflowRef = useRef(packetWorkflow);
  const packetOperationActive = useRef(false);
  const webMcpRegistryRef = useRef<WebMcpRegistry | null>(null);
  const meetingMediaStreamRef = useRef<MediaStream | null>(null);
  const bootstrapOperationRef = useRef<DemoRoomBootstrapOperation | null>(null);
  const handleMeetingMediaStreamChange = useCallback(
    (stream: MediaStream | null) => {
      meetingMediaStreamRef.current = stream;
    },
    [],
  );
  const createMeetingAwareHandController = useCallback(
    () =>
      createSharedCameraHandController({
        getMeetingStream: () => meetingMediaStreamRef.current,
      }),
    [],
  );
  const readyRoom = view.status === "ready" ? view.room : null;
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

  function commitPacketWorkflow(next: DemoPacketWorkflowState) {
    packetWorkflowRef.current = next;
    setPacketWorkflow(next);
  }

  async function runPacketOperation<T>(
    operation: () => Promise<DemoPacketOperationResult<T>>,
  ): Promise<DemoPacketOperationResult<T>> {
    if (packetOperationActive.current)
      return packetOperationFailure(
        "packet_action_pending",
        "Wait for the current meeting packet action to finish.",
      );
    packetOperationActive.current = true;
    setPacketBusy(true);
    try {
      return await operation();
    } catch {
      return packetOperationFailure(
        "packet_service_unavailable",
        "Meeting packet service is temporarily unavailable.",
      );
    } finally {
      packetOperationActive.current = false;
      setPacketBusy(false);
    }
  }

  async function refreshPersistedPacketWorkflow(
    fallback: DemoPacketWorkflowState,
    signal?: AbortSignal,
  ) {
    if (!readyRoom) return;
    const persisted = await readyRoom.session.loadLatestPacketWorkflow(signal);
    if (!persisted.ok) {
      commitPacketWorkflow({ ...fallback, error: persisted.error.message });
      return;
    }
    const restored = packetWorkflowFromPersisted(persisted.value);
    commitPacketWorkflow(
      restored.packet || !fallback.packet
        ? restored
        : { ...fallback, activity: restored.activity, error: undefined },
    );
  }

  async function preparePacket(
    input: {
      title?: string;
      objectIds?: readonly string[];
      actorType: "human" | "agent";
    },
    signal?: AbortSignal,
  ) {
    return runPacketOperation(async () => {
      if (!readyRoom)
        return packetOperationFailure(
          "room_not_ready",
          "Create or join a room before preparing a packet.",
        );
      const semanticObjects = Object.values(
        readyRoom.store.getState().canvas.objects,
      ).filter(
        (object) =>
          !object.deletedAt &&
          ["note", "task_board", "schedule", "diagram"].includes(object.type),
      );
      const semanticIds = new Set(semanticObjects.map((object) => object.id));
      const selectedObjectIds = input.objectIds
        ? [...input.objectIds]
        : semanticObjects.map((object) => object.id);
      if (
        selectedObjectIds.length === 0 ||
        selectedObjectIds.some((objectId) => !semanticIds.has(objectId))
      )
        return packetOperationFailure(
          "invalid_input",
          "Choose active semantic objects before preparing a packet.",
        );

      const createPacketId =
        environment.createPacketId ?? defaultEnvironment.createPacketId!;
      const packetId = createPacketId();
      const prepared = await readyRoom.session.preparePacket(
        {
          packetId,
          actorType: input.actorType,
          title: input.title ?? "CommandCanvas meeting packet",
          selectedObjectIds,
        },
        signal,
      );
      if (!prepared.ok) return prepared;
      if (prepared.value.packetId !== packetId)
        return packetOperationFailure(
          "invalid_response",
          "Meeting packet identity could not be verified.",
        );

      const recipients = normalizePacketRecipients(DEMO_PACKET_RECIPIENTS);
      const updated = await readyRoom.session.updatePacket(
        {
          packetId,
          title: prepared.value.title,
          recipients,
        },
        signal,
      );
      if (!updated.ok) return updated;
      if (
        updated.value.packetId !== packetId ||
        updated.value.status !== "draft" ||
        updated.value.recipientCount !== recipients.length
      )
        return packetOperationFailure(
          "invalid_response",
          "Meeting packet recipients could not be verified.",
        );

      const packet: MeetingPacketView = {
        id: packetId,
        version: prepared.value.packetVersion,
        status: "draft",
        title: prepared.value.title,
        contentSummary: `${prepared.value.objectCount} semantic ${prepared.value.objectCount === 1 ? "object" : "objects"} captured from canvas revision ${prepared.value.sourceRevision}.`,
        contentSnapshot: prepared.value.contentSnapshot,
        recipients,
      };
      commitPacketWorkflow({ packet });
      await refreshPersistedPacketWorkflow({ packet }, signal);
      return { ok: true as const, value: prepared.value };
    });
  }

  async function savePacketChanges(input: {
    packetId: string;
    version: number;
    recipients: MeetingPacketRecipientInput[];
  }) {
    const result = await runPacketOperation(async () => {
      const current = packetWorkflowRef.current.packet;
      if (
        !readyRoom ||
        !current ||
        current.status !== "draft" ||
        current.id !== input.packetId ||
        current.version !== input.version
      )
        return packetOperationFailure(
          "packet_conflict",
          "The packet changed before these recipients could be saved.",
        );
      const recipients = normalizePacketRecipients(input.recipients);
      const updated = await readyRoom.session.updatePacket({
        packetId: current.id,
        title: current.title,
        recipients,
      });
      if (!updated.ok) return updated;
      if (
        updated.value.packetId !== current.id ||
        updated.value.recipientCount !== recipients.length
      )
        return packetOperationFailure(
          "invalid_response",
          "The saved recipient snapshot could not be verified.",
        );
      const packet: MeetingPacketView = {
        ...current,
        status: "draft",
        recipients,
      };
      commitPacketWorkflow({ packet });
      await refreshPersistedPacketWorkflow({ packet });
      return { ok: true as const, value: updated.value };
    });
    if (!result.ok) throw new Error(result.error.message);
  }

  async function approvePacket(input: { packetId: string; version: number }) {
    const result = await runPacketOperation(async () => {
      const current = packetWorkflowRef.current.packet;
      if (
        !readyRoom ||
        !current ||
        current.status !== "draft" ||
        current.id !== input.packetId ||
        current.version !== input.version
      )
        return packetOperationFailure(
          "packet_conflict",
          "The packet changed before approval.",
        );
      const approved = await readyRoom.session.approvePacket({
        packetId: current.id,
      });
      if (!approved.ok) return approved;
      if (
        approved.value.packetId !== current.id ||
        approved.value.packetVersion !== current.version ||
        approved.value.contentSnapshot.title !== current.title ||
        approved.value.recipientCount !==
          approved.value.recipientSnapshot.length
      )
        return packetOperationFailure(
          "invalid_response",
          "The approved packet snapshot could not be verified.",
        );
      const packet: MeetingPacketView = {
        ...current,
        status: "approved",
        title: approved.value.contentSnapshot.title,
        contentSnapshot: approved.value.contentSnapshot,
        recipients: approved.value.recipientSnapshot,
        approvedSnapshot: {
          version: approved.value.packetVersion,
          title: approved.value.contentSnapshot.title,
          contentSummary: current.contentSummary,
          contentSnapshot: approved.value.contentSnapshot,
          contentHash: approved.value.contentHash,
          recipientHash: approved.value.recipientHash,
          recipients: approved.value.recipientSnapshot,
        },
      };
      commitPacketWorkflow({ packet });
      await refreshPersistedPacketWorkflow({ packet });
      return { ok: true as const, value: approved.value };
    });
    if (!result.ok) throw new Error(result.error.message);
  }

  async function stagePacketSend(
    packetId: string,
    requestedByActorType: "human" | "agent",
    signal?: AbortSignal,
  ) {
    return runPacketOperation(async () => {
      const current = packetWorkflowRef.current.packet;
      if (
        !readyRoom ||
        !current ||
        current.status !== "approved" ||
        current.id !== packetId
      )
        return packetOperationFailure(
          "approval_required",
          "Approve the current packet before requesting a send.",
        );
      const staged = await readyRoom.session.stagePacketSend(
        { packetId, requestedByActorType },
        signal,
      );
      if (!staged.ok) return staged;
      if (
        staged.value.packetId !== packetId ||
        staged.value.packetVersion !== current.approvedSnapshot.version ||
        staged.value.contentHash !== current.approvedSnapshot.contentHash ||
        staged.value.recipientHash !== current.approvedSnapshot.recipientHash ||
        staged.value.recipientCount !== staged.value.recipientSnapshot.length
      )
        return packetOperationFailure(
          "invalid_response",
          "The staged recipient snapshot could not be verified.",
        );
      const stagedSend: StagedPacketSendView = {
        id: staged.value.sendRequestId,
        approvedPacketVersion: staged.value.packetVersion,
        contentHash: staged.value.contentHash,
        recipientHash: staged.value.recipientHash,
        recipients: staged.value.recipientSnapshot,
      };
      commitPacketWorkflow({ packet: current, stagedSend });
      await refreshPersistedPacketWorkflow(
        { packet: current, stagedSend },
        signal,
      );
      return { ok: true as const, value: staged.value };
    });
  }

  async function cancelPacketSend(input: { sendRequestId: string }) {
    const result = await runPacketOperation(async () => {
      const current = packetWorkflowRef.current;
      if (
        !readyRoom ||
        !current.packet ||
        current.stagedSend?.id !== input.sendRequestId
      )
        return packetOperationFailure(
          "packet_conflict",
          "The staged send is no longer available.",
        );
      const cancelled = await readyRoom.session.cancelPacketSend({
        sendRequestId: input.sendRequestId,
        explicitHostCancellation: true,
      });
      if (!cancelled.ok) return cancelled;
      if (
        cancelled.value.sendRequestId !== input.sendRequestId ||
        cancelled.value.packetId !== current.packet.id ||
        cancelled.value.status !== "cancelled"
      )
        return packetOperationFailure(
          "invalid_response",
          "The cancelled send receipt could not be verified.",
        );
      const next: DemoPacketWorkflowState = {
        packet: current.packet,
        sendOutcome: { kind: "cancelled" },
      };
      commitPacketWorkflow(next);
      await refreshPersistedPacketWorkflow(next);
      return { ok: true as const, value: cancelled.value };
    });
    if (!result.ok) throw new Error(result.error.message);
  }

  async function authorizePacketSend(input: {
    packetId: string;
    sendRequestId: string;
    approvedPacketVersion: number;
  }) {
    const result = await runPacketOperation(async () => {
      const current = packetWorkflowRef.current;
      if (
        !readyRoom ||
        !current.packet ||
        current.packet.status !== "approved" ||
        current.packet.id !== input.packetId ||
        current.packet.approvedSnapshot.version !== input.approvedPacketVersion ||
        current.stagedSend?.id !== input.sendRequestId
      )
        return packetOperationFailure(
          "packet_conflict",
          "The staged send no longer matches the approved packet.",
        );
      const executed = await readyRoom.session.executePacketSend({
        sendRequestId: input.sendRequestId,
        explicitHostAuthorization: true,
      });
      if (!executed.ok) return executed;
      const next: DemoPacketWorkflowState = {
        packet: current.packet,
        sendOutcome:
          executed.value.mode === "preview_only"
            ? { kind: "preview_only" }
            : { kind: "submitted" },
      };
      commitPacketWorkflow(next);
      await refreshPersistedPacketWorkflow(next);
      return { ok: true as const, value: executed.value };
    });
    if (!result.ok) {
      const current = packetWorkflowRef.current;
      const fallback: DemoPacketWorkflowState = {
        ...(result.error.code === "email_submission_failed"
          ? { packet: current.packet }
          : current),
        sendOutcome: { kind: "failure", message: result.error.message },
      };
      commitPacketWorkflow(fallback);
      await refreshPersistedPacketWorkflow(fallback);
      throw new Error(result.error.message);
    }
  }

  useEffect(() => {
    let active = true;
    let session: DemoRoomSession | null = null;
    let unsubscribe: () => void = () => undefined;

    let operation = bootstrapOperationRef.current;
    if (!operation || operation.environment !== environment) {
      operation = {
        environment,
        promise: environment.bootstrap(),
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
      if (result.role === "host") {
        const persisted = await result.session.loadLatestPacketWorkflow();
        if (!active) {
          if (operation.activeConsumers === 0) await disposeOperation();
          return;
        }
        if (persisted.ok)
          commitPacketWorkflow(packetWorkflowFromPersisted(persisted.value));
        else
          commitPacketWorkflow({
            packet: null,
            error: persisted.error.message,
          });
      }
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
      operation.activeConsumers = Math.max(0, operation.activeConsumers - 1);
      if (operation.activeConsumers === 0) void disposeOperation();
    };
  }, [environment]);

  /* Packet adapters intentionally read packetWorkflowRef at execution time.
     Re-registering every render would create Site Tool lifecycle churn. */
  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    if (!readyRoom || !sketchTransformer) return;
    let active = true;
    const target = resolveDocumentWebMcpTarget(document);
    if (!target) {
      queueMicrotask(() => {
        if (active)
          setWebMcpStatus({ value: "Site Tools unavailable", tone: "idle" });
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
      target,
      getContext: () =>
        demoWebMcpContext(
          room.session,
          room.store,
          packetWorkflowRef.current.packet?.status ?? "none",
        ),
      adapters: createCanvasWebMcpAdapters({
        store: room.store,
        transformSketch: sketchTransformer.transform,
        prepareMeetingPacket: async (request) => {
          const result = await preparePacket(
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
          const result = await stagePacketSend(
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
      } catch {
        if (active)
          setWebMcpStatus({
            value: "Site Tools registration failed",
            tone: "idle",
          });
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
  }, [readyRoom, sketchTransformer]);
  /* eslint-enable react-hooks/exhaustive-deps */

  useEffect(() => {
    const registry = webMcpRegistryRef.current;
    if (!registry) return;
    void registry.sync().then(
      () =>
        setWebMcpStatus({
          value: `${registry.registeredToolNames().length} Site Tools registered`,
          tone: "ready",
        }),
      () =>
        setWebMcpStatus({
          value: "Site Tools registration failed",
          tone: "idle",
        }),
    );
  }, [packetWorkflow.packet?.status]);

  if (view.status === "loading")
    return (
      <main className="demo-gate" aria-live="polite">
        <span className="demo-gate-mark" aria-hidden="true">
          CC
        </span>
        <p className="eyebrow">CommandCanvas / judge mode</p>
        <h1>Opening your no-signup demo room…</h1>
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
      <section
        className="packet-workflow-shell"
        aria-label="Meeting packet workflow"
      >
        {packetWorkflow.packet ? (
          <>
            <MeetingPacketPanel
              packet={packetWorkflow.packet}
              activity={packetWorkflow.activity}
              stagedSend={packetWorkflow.stagedSend}
              sendOutcome={packetWorkflow.sendOutcome}
              operationBusy={packetBusy}
              onSaveChanges={savePacketChanges}
              onApprove={approvePacket}
              onCancelSend={cancelPacketSend}
              onAuthorizeSend={authorizePacketSend}
            />
            {packetWorkflow.packet.status === "approved" &&
            !packetWorkflow.stagedSend &&
            packetWorkflow.sendOutcome?.kind !== "submitted" ? (
              <button
                type="button"
                className="packet-fallback-action"
                disabled={packetBusy}
                onClick={async () => {
                  const result = await stagePacketSend(
                    packetWorkflow.packet!.id,
                    "human",
                  );
                  if (!result.ok)
                    commitPacketWorkflow({
                      ...packetWorkflowRef.current,
                      error: result.error.message,
                    });
                }}
              >
                Request email send
              </button>
            ) : null}
          </>
        ) : (
          <div className="packet-workflow-empty">
            <p className="eyebrow">Structured output</p>
            <strong>Meeting packet</strong>
            <p>
              ChatGPT can prepare this through Site Tools. This button keeps the
              same reviewed workflow available in an ordinary browser.
            </p>
            <button
              type="button"
              disabled={packetBusy}
              onClick={async () => {
                const result = await preparePacket({ actorType: "human" });
                if (!result.ok)
                  commitPacketWorkflow({
                    ...packetWorkflowRef.current,
                    error: result.error.message,
                  });
              }}
            >
              {packetBusy ? "Preparing packet…" : "Prepare meeting packet"}
            </button>
          </div>
        )}
        {packetWorkflow.error ? (
          <p className="packet-workflow-error" role="alert">
            {packetWorkflow.error}
          </p>
        ) : null}
      </section>
    ) : undefined;

  return (
    <div className="demo-room-stage">
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
        onCommand={async (command, source) => {
          const result = await room.session.submitCommand(command, source);
          if (!result.ok) throw new Error(result.message);
        }}
        onTransformSketch={sketchTransformer?.transform}
        onCanvasPointerWorldMove={(point) => {
          void room.session.publishCursor(point);
        }}
        createHandTrackingController={createMeetingAwareHandController}
        realtimeVoice={{
          roomId: snapshot.roomId!,
          getAccessToken: room.session.getAccessToken,
          disabled:
            snapshot.status !== "ready" && snapshot.status !== "degraded",
        }}
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
        commandDrawerRequestKey={packetWorkflow.stagedSend?.id}
        meetingPacketPanel={meetingPacketPanel}
      />
    </div>
  );
}

function packetWorkflowFromPersisted(
  persisted: BrowserPersistedPacketWorkflow,
): DemoPacketWorkflowState {
  const activity: MeetingPacketActivityView[] = persisted.activity.map(
    (receipt) => ({
      receiptId: receipt.receiptId,
      revision: receipt.revision,
      occurredAt: receipt.occurredAt,
      actorType: receipt.actorType,
      actorDisplayName: receipt.actorDisplayName,
      action: receipt.action,
      description: receipt.description,
    }),
  );
  if (!persisted.packet) return { packet: null, activity };

  const persistedPacket = persisted.packet;
  const contentSummary = `${persistedPacket.contentSnapshot.content.objects.length} semantic ${persistedPacket.contentSnapshot.content.objects.length === 1 ? "object" : "objects"} captured from canvas revision ${persistedPacket.sourceRevision}.`;
  const packet: MeetingPacketView =
    persistedPacket.status === "approved"
      ? {
          id: persistedPacket.packetId,
          version: persistedPacket.packetVersion,
          status: "approved",
          title: persistedPacket.title,
          contentSummary,
          contentSnapshot: persistedPacket.contentSnapshot,
          recipients: persistedPacket.recipients,
          approvedSnapshot: {
            version: persistedPacket.approvedSnapshot.packetVersion,
            title: persistedPacket.approvedSnapshot.contentSnapshot.title,
            contentSummary,
            contentSnapshot: persistedPacket.approvedSnapshot.contentSnapshot,
            contentHash: persistedPacket.approvedSnapshot.contentHash,
            recipientHash: persistedPacket.approvedSnapshot.recipientHash,
            recipients: persistedPacket.approvedSnapshot.recipients,
          },
        }
      : {
          id: persistedPacket.packetId,
          version: persistedPacket.packetVersion,
          status: "draft",
          title: persistedPacket.title,
          contentSummary,
          contentSnapshot: persistedPacket.contentSnapshot,
          recipients: persistedPacket.recipients,
        };

  const latestSend = persisted.latestSend;
  if (!latestSend) return { packet, activity };
  if (
    latestSend.status === "awaiting_human_approval" &&
    packet.status === "approved" &&
    latestSend.packetVersion === packet.approvedSnapshot.version &&
    latestSend.contentHash === packet.approvedSnapshot.contentHash &&
    latestSend.recipientHash === packet.approvedSnapshot.recipientHash
  )
    return {
      packet,
      activity,
      stagedSend: {
        id: latestSend.sendRequestId,
        approvedPacketVersion: latestSend.packetVersion,
        contentHash: latestSend.contentHash,
        recipientHash: latestSend.recipientHash,
        recipients: latestSend.recipients,
      },
    };
  if (latestSend.status === "cancelled")
    return { packet, activity, sendOutcome: { kind: "cancelled" } };
  if (latestSend.status === "preview_only")
    return { packet, activity, sendOutcome: { kind: "preview_only" } };
  if (latestSend.status === "sent")
    return { packet, activity, sendOutcome: { kind: "submitted" } };
  if (latestSend.status === "failed")
    return {
      packet,
      activity,
      sendOutcome: {
        kind: "failure",
        message: "The recorded delivery attempt did not complete.",
      },
    };
  return { packet, activity };
}

async function bootstrapBrowserDemoRoom() {
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
          createBrowserSketchTransformApi({ accessToken }),
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
  packetStatus: "none" | MeetingPacketView["status"],
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
    canMutate: snapshot.membership?.role === "host",
  };
}

interface DemoPacketOperationError {
  code: string;
  message: string;
  status?: number;
}

type DemoPacketOperationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: DemoPacketOperationError };

function packetOperationFailure(
  code: string,
  message: string,
): DemoPacketOperationResult<never> {
  return { ok: false, error: { code, message } };
}

function webMcpPacketFailure(error: DemoPacketOperationError) {
  return {
    ok: false as const,
    code:
      error.code === "invalid_request" || error.code === "invalid_input"
        ? ("invalid_input" as const)
        : error.code === "host_required"
          ? ("forbidden" as const)
          : ("execution_failed" as const),
    message: error.message,
  };
}

function normalizePacketRecipients(
  recipients: readonly MeetingPacketRecipientInput[],
) {
  return recipients
    .map((recipient) => ({
      name: recipient.name.trim(),
      email: recipient.email.trim().toLowerCase(),
    }))
    .sort(
      (left, right) =>
        left.email.localeCompare(right.email) ||
        left.name.localeCompare(right.name),
    );
}
