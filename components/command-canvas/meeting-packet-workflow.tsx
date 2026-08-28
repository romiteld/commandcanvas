"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { StoreApi } from "zustand";

import {
  MeetingPacketPanel,
  type MeetingPacketActivityView,
  type MeetingPacketRecipientInput,
  type MeetingPacketSendOutcomeView,
  type MeetingPacketView,
  type StagedPacketSendView,
} from "@/components/command-canvas/meeting-packet-panel";
import type { CanvasStoreState } from "@/lib/canvas/canvas-store";
import type { DemoRoomSession } from "@/lib/demo/room-session";
import type { BrowserPersistedPacketWorkflow } from "@/lib/packets/browser-api";

export interface MeetingPacketWorkflowState {
  packet: MeetingPacketView | null;
  activity?: readonly MeetingPacketActivityView[];
  stagedSend?: StagedPacketSendView;
  sendOutcome?: MeetingPacketSendOutcomeView;
  error?: string;
}

export interface MeetingPacketOperationError {
  code: string;
  message: string;
  status?: number;
}

export type MeetingPacketOperationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: MeetingPacketOperationError };

type PacketSession = Pick<
  DemoRoomSession,
  | "loadLatestPacketWorkflow"
  | "preparePacket"
  | "updatePacket"
  | "approvePacket"
  | "stagePacketSend"
  | "cancelPacketSend"
  | "executePacketSend"
>;

export interface MeetingPacketWorkflowController {
  canManage: boolean;
  state: MeetingPacketWorkflowState;
  busy: boolean;
  getStatus: () => "none" | "draft" | "approved";
  preparePacket: (
    input: {
      title?: string;
      objectIds?: readonly string[];
      actorType: "human" | "agent";
    },
    signal?: AbortSignal,
  ) => Promise<MeetingPacketOperationResult<{
    packetId: string;
    packetVersion: number;
    sourceRevision: number;
    objectCount: number;
  }>>;
  savePacketChanges: (input: {
    packetId: string;
    version: number;
    recipients: MeetingPacketRecipientInput[];
  }) => Promise<void>;
  approvePacket: (input: { packetId: string; version: number }) => Promise<void>;
  stagePacketSend: (
    packetId: string,
    requestedByActorType: "human" | "agent",
    signal?: AbortSignal,
  ) => Promise<MeetingPacketOperationResult<{
    packetId: string;
    sendRequestId: string;
    recipientCount: number;
  }>>;
  cancelPacketSend: (input: { sendRequestId: string }) => Promise<void>;
  authorizePacketSend: (input: {
    packetId: string;
    sendRequestId: string;
    approvedPacketVersion: number;
  }) => Promise<void>;
  recordError: (message: string) => void;
}

const EMPTY_PACKET_WORKFLOW: MeetingPacketWorkflowState = { packet: null };
const NO_PACKET_RECIPIENTS: readonly MeetingPacketRecipientInput[] = [];

export function useMeetingPacketWorkflow(options: {
  session: PacketSession | null;
  store: StoreApi<CanvasStoreState> | null;
  canManage: boolean;
  defaultRecipients?: readonly MeetingPacketRecipientInput[];
  createPacketId?: () => string;
}): MeetingPacketWorkflowController {
  const {
    session,
    store,
    canManage,
    defaultRecipients = NO_PACKET_RECIPIENTS,
    createPacketId = defaultPacketId,
  } = options;
  const [state, setState] =
    useState<MeetingPacketWorkflowState>(EMPTY_PACKET_WORKFLOW);
  const [busy, setBusy] = useState(false);
  const stateRef = useRef(state);
  const operationActiveRef = useRef(false);

  const commit = useCallback((next: MeetingPacketWorkflowState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const runOperation = useCallback(
    async <T,>(
      operation: () => Promise<MeetingPacketOperationResult<T>>,
    ): Promise<MeetingPacketOperationResult<T>> => {
      if (!canManage)
        return packetOperationFailure(
          "host_required",
          "Only the room host can manage the meeting packet.",
        );
      if (operationActiveRef.current)
        return packetOperationFailure(
          "packet_action_pending",
          "Wait for the current meeting packet action to finish.",
        );
      operationActiveRef.current = true;
      setBusy(true);
      try {
        return await operation();
      } catch {
        return packetOperationFailure(
          "packet_service_unavailable",
          "Meeting packet service is temporarily unavailable.",
        );
      } finally {
        operationActiveRef.current = false;
        setBusy(false);
      }
    },
    [canManage],
  );

  const refreshPersisted = useCallback(
    async (fallback: MeetingPacketWorkflowState, signal?: AbortSignal) => {
      if (!session || !canManage) return;
      const persisted = await session.loadLatestPacketWorkflow(signal);
      if (signal?.aborted) return;
      if (!persisted.ok) {
        commit({ ...fallback, error: persisted.error.message });
        return;
      }
      const restored = packetWorkflowFromPersisted(persisted.value);
      commit(
        restored.packet || !fallback.packet
          ? restored
          : { ...fallback, activity: restored.activity, error: undefined },
      );
    },
    [canManage, commit, session],
  );

  useEffect(() => {
    if (!session || !canManage) return;
    const controller = new AbortController();
    queueMicrotask(() => {
      if (!controller.signal.aborted)
        void refreshPersisted(EMPTY_PACKET_WORKFLOW, controller.signal);
    });
    return () => controller.abort();
  }, [canManage, refreshPersisted, session]);

  const preparePacket = useCallback(
    async (
      input: {
        title?: string;
        objectIds?: readonly string[];
        actorType: "human" | "agent";
      },
      signal?: AbortSignal,
    ) =>
      runOperation(async () => {
        if (!session || !store)
          return packetOperationFailure(
            "room_not_ready",
            "Create or join a room before preparing a packet.",
          );
        const semanticObjects = Object.values(
          store.getState().canvas.objects,
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

        const packetId = createPacketId();
        const prepared = await session.preparePacket(
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

        const recipients = normalizePacketRecipients(defaultRecipients);
        if (recipients.length > 0) {
          const updated = await session.updatePacket(
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
        }

        const packet: MeetingPacketView = {
          id: packetId,
          version: prepared.value.packetVersion,
          status: "draft",
          title: prepared.value.title,
          contentSummary: `${prepared.value.objectCount} semantic ${prepared.value.objectCount === 1 ? "object" : "objects"} captured from canvas revision ${prepared.value.sourceRevision}.`,
          contentSnapshot: prepared.value.contentSnapshot,
          recipients,
        };
        commit({ packet });
        await refreshPersisted({ packet }, signal);
        return { ok: true as const, value: prepared.value };
      }),
    [
      commit,
      createPacketId,
      defaultRecipients,
      refreshPersisted,
      runOperation,
      session,
      store,
    ],
  );

  const savePacketChanges = useCallback(
    async (input: {
      packetId: string;
      version: number;
      recipients: MeetingPacketRecipientInput[];
    }) => {
      const result = await runOperation(async () => {
        const current = stateRef.current.packet;
        if (
          !session ||
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
        const updated = await session.updatePacket({
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
        const packet: MeetingPacketView = { ...current, recipients };
        commit({ packet });
        await refreshPersisted({ packet });
        return { ok: true as const, value: updated.value };
      });
      if (!result.ok) throw new Error(result.error.message);
    },
    [commit, refreshPersisted, runOperation, session],
  );

  const approvePacket = useCallback(
    async (input: { packetId: string; version: number }) => {
      const result = await runOperation(async () => {
        const current = stateRef.current.packet;
        if (
          !session ||
          !current ||
          current.status !== "draft" ||
          current.id !== input.packetId ||
          current.version !== input.version
        )
          return packetOperationFailure(
            "packet_conflict",
            "The packet changed before approval.",
          );
        const approved = await session.approvePacket({ packetId: current.id });
        if (!approved.ok) return approved;
        if (
          approved.value.packetId !== current.id ||
          approved.value.packetVersion !== current.version ||
          approved.value.contentSnapshot.title !== current.title ||
          approved.value.recipientCount !== approved.value.recipientSnapshot.length
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
        commit({ packet });
        await refreshPersisted({ packet });
        return { ok: true as const, value: approved.value };
      });
      if (!result.ok) throw new Error(result.error.message);
    },
    [commit, refreshPersisted, runOperation, session],
  );

  const stagePacketSend = useCallback(
    async (
      packetId: string,
      requestedByActorType: "human" | "agent",
      signal?: AbortSignal,
    ) =>
      runOperation(async () => {
        const current = stateRef.current.packet;
        if (
          !session ||
          !current ||
          current.status !== "approved" ||
          current.id !== packetId
        )
          return packetOperationFailure(
            "approval_required",
            "Approve the current packet before requesting a send.",
          );
        const staged = await session.stagePacketSend(
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
        commit({ packet: current, stagedSend });
        await refreshPersisted({ packet: current, stagedSend }, signal);
        return { ok: true as const, value: staged.value };
      }),
    [commit, refreshPersisted, runOperation, session],
  );

  const cancelPacketSend = useCallback(
    async (input: { sendRequestId: string }) => {
      const result = await runOperation(async () => {
        const current = stateRef.current;
        if (
          !session ||
          !current.packet ||
          current.stagedSend?.id !== input.sendRequestId
        )
          return packetOperationFailure(
            "packet_conflict",
            "The staged send is no longer available.",
          );
        const cancelled = await session.cancelPacketSend({
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
        const next: MeetingPacketWorkflowState = {
          packet: current.packet,
          sendOutcome: { kind: "cancelled" },
        };
        commit(next);
        await refreshPersisted(next);
        return { ok: true as const, value: cancelled.value };
      });
      if (!result.ok) throw new Error(result.error.message);
    },
    [commit, refreshPersisted, runOperation, session],
  );

  const authorizePacketSend = useCallback(
    async (input: {
      packetId: string;
      sendRequestId: string;
      approvedPacketVersion: number;
    }) => {
      const result = await runOperation(async () => {
        const current = stateRef.current;
        if (
          !session ||
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
        const executed = await session.executePacketSend({
          sendRequestId: input.sendRequestId,
          explicitHostAuthorization: true,
        });
        if (!executed.ok) return executed;
        const next: MeetingPacketWorkflowState = {
          packet: current.packet,
          sendOutcome:
            executed.value.mode === "preview_only"
              ? { kind: "preview_only" }
              : { kind: "submitted" },
        };
        commit(next);
        await refreshPersisted(next);
        return { ok: true as const, value: executed.value };
      });
      if (!result.ok) {
        const current = stateRef.current;
        const fallback: MeetingPacketWorkflowState = {
          ...(result.error.code === "email_submission_failed"
            ? { packet: current.packet }
            : current),
          sendOutcome: { kind: "failure", message: result.error.message },
        };
        commit(fallback);
        await refreshPersisted(fallback);
        throw new Error(result.error.message);
      }
    },
    [commit, refreshPersisted, runOperation, session],
  );

  const getStatus = useCallback(
    () => stateRef.current.packet?.status ?? "none",
    [],
  );
  const recordError = useCallback(
    (message: string) => commit({ ...stateRef.current, error: message }),
    [commit],
  );

  return {
    canManage,
    state,
    busy,
    getStatus,
    preparePacket,
    savePacketChanges,
    approvePacket,
    stagePacketSend,
    cancelPacketSend,
    authorizePacketSend,
    recordError,
  };
}

export function MeetingPacketWorkflowPanel({
  workflow,
}: {
  workflow: MeetingPacketWorkflowController;
}) {
  if (!workflow.canManage) return null;
  const { state } = workflow;
  return (
    <section className="packet-workflow-shell" aria-label="Meeting packet workflow">
      {state.packet ? (
        <>
          <MeetingPacketPanel
            packet={state.packet}
            activity={state.activity}
            stagedSend={state.stagedSend}
            sendOutcome={state.sendOutcome}
            operationBusy={workflow.busy}
            onSaveChanges={workflow.savePacketChanges}
            onApprove={workflow.approvePacket}
            onCancelSend={workflow.cancelPacketSend}
            onAuthorizeSend={workflow.authorizePacketSend}
          />
          {state.packet.status === "approved" &&
          !state.stagedSend &&
          state.sendOutcome?.kind !== "submitted" ? (
            <button
              type="button"
              className="packet-fallback-action"
              disabled={workflow.busy}
              onClick={async () => {
                const result = await workflow.stagePacketSend(
                  state.packet!.id,
                  "human",
                );
                if (!result.ok) workflow.recordError(result.error.message);
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
            disabled={workflow.busy}
            onClick={async () => {
              const result = await workflow.preparePacket({ actorType: "human" });
              if (!result.ok) workflow.recordError(result.error.message);
            }}
          >
            {workflow.busy ? "Preparing packet…" : "Prepare meeting packet"}
          </button>
        </div>
      )}
      {state.error ? (
        <p className="packet-workflow-error" role="alert">
          {state.error}
        </p>
      ) : null}
    </section>
  );
}

export function packetWorkflowFromPersisted(
  persisted: BrowserPersistedPacketWorkflow,
): MeetingPacketWorkflowState {
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
  const objectCount = persistedPacket.contentSnapshot.content.objects.length;
  const contentSummary = `${objectCount} semantic ${objectCount === 1 ? "object" : "objects"} captured from canvas revision ${persistedPacket.sourceRevision}.`;
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

export function packetOperationFailure(
  code: string,
  message: string,
): MeetingPacketOperationResult<never> {
  return { ok: false, error: { code, message } };
}

export function webMcpPacketFailure(error: MeetingPacketOperationError) {
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

function defaultPacketId() {
  return `packet-${globalThis.crypto.randomUUID().replaceAll("-", "").slice(0, 16)}`;
}
