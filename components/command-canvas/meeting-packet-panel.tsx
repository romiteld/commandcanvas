"use client";

import { useId, useRef, useState } from "react";

import type { PacketContentSnapshot } from "@/lib/packets/contracts";

import styles from "./meeting-packet-panel.module.css";

export interface MeetingPacketRecipientInput {
  name: string;
  email: string;
}

export interface MeetingPacketApprovalSnapshotView {
  version: number;
  title: string;
  contentSummary: string;
  contentSnapshot: PacketContentSnapshot;
  contentHash: string;
  recipientHash: string;
  recipients: readonly MeetingPacketRecipientInput[];
}

interface MeetingPacketViewBase {
  id: string;
  version: number;
  title: string;
  contentSummary: string;
  contentSnapshot: PacketContentSnapshot;
  recipients: readonly MeetingPacketRecipientInput[];
}

export interface DraftMeetingPacketView extends MeetingPacketViewBase {
  status: "draft";
}

export interface ApprovedMeetingPacketView extends MeetingPacketViewBase {
  status: "approved";
  approvedSnapshot: MeetingPacketApprovalSnapshotView;
}

export type MeetingPacketView =
  | DraftMeetingPacketView
  | ApprovedMeetingPacketView;

export interface StagedPacketSendView {
  id: string;
  approvedPacketVersion: number;
  contentHash: string;
  recipientHash: string;
  recipients: readonly MeetingPacketRecipientInput[];
}

export type MeetingPacketSendOutcomeView =
  | { kind: "preview_only" }
  | { kind: "submitted" }
  | { kind: "cancelled" }
  | { kind: "failure"; message: string };

export interface MeetingPacketActivityView {
  receiptId: string;
  revision: number;
  occurredAt: string;
  actorType: "human" | "agent" | "system";
  actorDisplayName: string;
  action:
    | "packet_prepared"
    | "packet_draft_updated"
    | "packet_approved"
    | "packet_send_staged"
    | "packet_send_cancelled"
    | "packet_send_previewed"
    | "packet_send_authorized"
    | "packet_send_expired"
    | "packet_send_submitted"
    | "packet_send_failed";
  description: string;
}

export interface SaveMeetingPacketChangesInput {
  packetId: string;
  version: number;
  recipients: MeetingPacketRecipientInput[];
}

export interface ApproveMeetingPacketInput {
  packetId: string;
  version: number;
}

export interface CancelPacketSendInput {
  sendRequestId: string;
}

export interface AuthorizePacketSendInput {
  packetId: string;
  sendRequestId: string;
  approvedPacketVersion: number;
}

export interface MeetingPacketPanelProps {
  packet: MeetingPacketView;
  activity?: readonly MeetingPacketActivityView[];
  stagedSend?: StagedPacketSendView;
  sendOutcome?: MeetingPacketSendOutcomeView;
  operationBusy?: boolean;
  onSaveChanges: (
    input: SaveMeetingPacketChangesInput,
  ) => void | Promise<void>;
  onApprove: (input: ApproveMeetingPacketInput) => void | Promise<void>;
  onCancelSend: (input: CancelPacketSendInput) => void | Promise<void>;
  onAuthorizeSend: (input: AuthorizePacketSendInput) => void | Promise<void>;
}

interface EditableRecipient extends MeetingPacketRecipientInput {
  key: number;
}

type PendingAction = "save" | "approve" | "cancel-send" | "send";

const MAX_RECIPIENTS = 10;

export function MeetingPacketPanel(props: MeetingPacketPanelProps) {
  const { packet } = props;
  const stateKey = `${packet.id}:${packet.version}:${packet.status}`;

  return <MeetingPacketPanelState key={stateKey} {...props} />;
}

function MeetingPacketPanelState({
  packet,
  activity = [],
  stagedSend,
  sendOutcome,
  operationBusy = false,
  onSaveChanges,
  onApprove,
  onCancelSend,
  onAuthorizeSend,
}: MeetingPacketPanelProps) {
  const headingId = useId();
  const nextRecipientKey = useRef(packet.recipients.length);
  const [recipients, setRecipients] = useState<EditableRecipient[]>(() =>
    packet.recipients.map((recipient, index) => ({
      ...recipient,
      key: index,
    })),
  );
  const [savedRecipients, setSavedRecipients] = useState<
    MeetingPacketRecipientInput[]
  >(() => packet.recipients.map(copyRecipient));
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const isDraft = packet.status === "draft";
  const isBusy = operationBusy || pendingAction !== null;
  const editableRecipients = recipients.map(copyRecipient);
  const hasUnsavedChanges = !recipientsEqual(
    editableRecipients,
    savedRecipients,
  );
  const recipientsAreComplete = editableRecipients.every(
    (recipient) => recipient.name.trim() && recipient.email.trim(),
  );
  const displayedPacket = isDraft ? packet : packet.approvedSnapshot;

  async function runAction(action: PendingAction, callback: () => unknown) {
    setActionError(null);
    setPendingAction(action);
    try {
      await callback();
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : "The action could not be completed.",
      );
      return false;
    } finally {
      setPendingAction(null);
    }
    return true;
  }

  function updateRecipient(
    key: number,
    field: keyof MeetingPacketRecipientInput,
    value: string,
  ) {
    setRecipients((current) =>
      current.map((recipient) =>
        recipient.key === key ? { ...recipient, [field]: value } : recipient,
      ),
    );
  }

  return (
    <article className={styles.panel} aria-labelledby={headingId}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Meeting packet</p>
          <h2 id={headingId}>{displayedPacket.title}</h2>
        </div>
        <span className={isDraft ? styles.draftBadge : styles.approvedBadge}>
          {isDraft ? `Draft v${packet.version}` : `Approved packet v${packet.approvedSnapshot.version}`}
        </span>
      </header>

      <section className={styles.summary} aria-labelledby={`${headingId}-summary`}>
        <h3 id={`${headingId}-summary`}>Content summary</h3>
        <p>{displayedPacket.contentSummary}</p>
      </section>

      <PacketContentSnapshotView snapshot={displayedPacket.contentSnapshot} />

      {isDraft ? (
        <form
          className={styles.recipientForm}
          onSubmit={(event) => {
            event.preventDefault();
            if (
              isBusy ||
              !hasUnsavedChanges ||
              !recipientsAreComplete ||
              recipients.length > MAX_RECIPIENTS
            ) {
              return;
            }
            void runAction("save", async () => {
              await onSaveChanges({
                packetId: packet.id,
                version: packet.version,
                recipients: editableRecipients,
              });
              setSavedRecipients(editableRecipients.map(copyRecipient));
            });
          }}
        >
          <fieldset disabled={isBusy} className={styles.recipientFieldset}>
            <legend>Recipients</legend>
            <p className={styles.recipientHelp}>
              Approval locks these exact names and addresses into the packet snapshot.
            </p>
            <div className={styles.recipientRows}>
              {recipients.map((recipient, index) => (
                <div className={styles.recipientRow} key={recipient.key}>
                  <label>
                    <span>Recipient {index + 1} name</span>
                    <input
                      type="text"
                      value={recipient.name}
                      autoComplete="name"
                      onChange={(event) =>
                        updateRecipient(recipient.key, "name", event.target.value)
                      }
                    />
                  </label>
                  <label>
                    <span>Recipient {index + 1} email</span>
                    <input
                      type="email"
                      value={recipient.email}
                      autoComplete="email"
                      onChange={(event) =>
                        updateRecipient(recipient.key, "email", event.target.value)
                      }
                    />
                  </label>
                  <button
                    type="button"
                    className={styles.removeButton}
                    aria-label={`Remove recipient ${index + 1}`}
                    onClick={() =>
                      setRecipients((current) =>
                        current.filter((candidate) => candidate.key !== recipient.key),
                      )
                    }
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
            <div className={styles.recipientLimit}>
              <button
                type="button"
                className={styles.secondaryButton}
                disabled={recipients.length >= MAX_RECIPIENTS}
                onClick={() => {
                  const key = nextRecipientKey.current;
                  nextRecipientKey.current += 1;
                  setRecipients((current) => [
                    ...current,
                    { key, name: "", email: "" },
                  ]);
                }}
              >
                Add recipient
              </button>
              <span>
                {recipients.length >= MAX_RECIPIENTS
                  ? "Maximum 10 recipients."
                  : `${recipients.length} of ${MAX_RECIPIENTS}`}
              </span>
            </div>
          </fieldset>

          <div className={styles.actions}>
            <button
              type="submit"
              className={styles.secondaryButton}
              disabled={
                isBusy ||
                !hasUnsavedChanges ||
                !recipientsAreComplete ||
                recipients.length > MAX_RECIPIENTS
              }
            >
              {pendingAction === "save" ? "Saving…" : "Save changes"}
            </button>
            <button
              type="button"
              className={styles.primaryButton}
              disabled={
                isBusy ||
                hasUnsavedChanges ||
                recipients.length === 0 ||
                !recipientsAreComplete
              }
              onClick={() =>
                void runAction("approve", () =>
                  onApprove({ packetId: packet.id, version: packet.version }),
                )
              }
            >
              {pendingAction === "approve" ? "Approving…" : "Approve packet"}
            </button>
          </div>
        </form>
      ) : (
        <section
          className={styles.snapshot}
          aria-labelledby={`${headingId}-snapshot`}
        >
          <h3 id={`${headingId}-snapshot`}>Approved recipients</h3>
          <p>
            {packet.approvedSnapshot.recipients.length} recipients locked in this
            approval snapshot. Editing creates a new draft and invalidates this
            approval.
          </p>
          <RecipientList recipients={packet.approvedSnapshot.recipients} />
        </section>
      )}

      {stagedSend ? (
        <section
          className={styles.sendConfirmation}
          role="alertdialog"
          aria-modal="false"
          aria-labelledby={`${headingId}-send-title`}
          aria-describedby={`${headingId}-send-description`}
        >
          <div className={styles.sendHeading}>
            <div>
              <p className={styles.eyebrow}>External action</p>
              <h3 id={`${headingId}-send-title`}>Send packet?</h3>
            </div>
            <strong>Approved packet v{stagedSend.approvedPacketVersion}</strong>
          </div>
          <p id={`${headingId}-send-description`}>
            Review the exact recipient snapshot. Nothing is sent until the host
            presses SEND.
          </p>
          <strong>
            {stagedSend.recipients.length}{" "}
            {stagedSend.recipients.length === 1 ? "recipient" : "recipients"}
          </strong>
          <RecipientList recipients={stagedSend.recipients} />
          <dl className={styles.snapshotHashes}>
            <div>
              <dt>Content hash</dt>
              <dd>{stagedSend.contentHash}</dd>
            </div>
            <div>
              <dt>Recipient hash</dt>
              <dd>{stagedSend.recipientHash}</dd>
            </div>
          </dl>
          <div className={styles.actions}>
            <button
              type="button"
              className={styles.secondaryButton}
              aria-label="Cancel packet send"
              disabled={isBusy}
              onClick={() => {
                void runAction("cancel-send", () =>
                  onCancelSend({ sendRequestId: stagedSend.id }),
                );
              }}
            >
              {pendingAction === "cancel-send" ? "Canceling…" : "Cancel"}
            </button>
            <button
              type="button"
              className={styles.sendButton}
              disabled={isBusy}
              onClick={() =>
                void runAction("send", () =>
                  onAuthorizeSend({
                    packetId: packet.id,
                    sendRequestId: stagedSend.id,
                    approvedPacketVersion: stagedSend.approvedPacketVersion,
                  }),
                )
              }
            >
              {pendingAction === "send" ? "Sending…" : "SEND"}
            </button>
          </div>
        </section>
      ) : null}

      {sendOutcome ? <SendOutcome outcome={sendOutcome} /> : null}
      {activity.length > 0 ? (
        <PacketActivity activity={activity} headingId={headingId} />
      ) : null}
      {actionError ? (
        <p className={styles.failure} role="alert">
          Action failed: {actionError}
        </p>
      ) : null}
    </article>
  );
}

function PacketActivity({
  activity,
  headingId,
}: {
  activity: readonly MeetingPacketActivityView[];
  headingId: string;
}) {
  return (
    <section
      className={styles.activity}
      aria-labelledby={`${headingId}-activity`}
    >
      <div className={styles.activityHeading}>
        <div>
          <p className={styles.eyebrow}>Immutable receipts</p>
          <h3 id={`${headingId}-activity`}>Meeting packet activity</h3>
        </div>
        <span>{activity.length} recent</span>
      </div>
      <ol className={styles.activityList}>
        {activity.map((receipt) => (
          <li key={receipt.receiptId}>
            <div className={styles.activityMeta}>
              <strong>Revision {receipt.revision}</strong>
              <span>{receipt.actorDisplayName}</span>
            </div>
            <p>{receipt.description}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}

function PacketContentSnapshotView({
  snapshot,
}: {
  snapshot: PacketContentSnapshot;
}) {
  return (
    <section
      className={styles.contentSnapshot}
      aria-label="Packet content snapshot"
    >
      <div className={styles.contentSnapshotHeading}>
        <div>
          <p className={styles.eyebrow}>Exact approval content</p>
          <h3>{snapshot.content.roomName}</h3>
        </div>
        <span>Canvas revision {snapshot.content.sourceRevision}</span>
      </div>
      <ol className={styles.contentObjects}>
        {snapshot.content.objects.map((object) => (
          <li key={object.objectId}>
            <div>
              <strong>{object.title}</strong>
              <span>{object.objectType.replaceAll("_", " ")}</span>
            </div>
            <code>{JSON.stringify(object.payload)}</code>
          </li>
        ))}
      </ol>
    </section>
  );
}

function RecipientList({
  recipients,
}: {
  recipients: readonly MeetingPacketRecipientInput[];
}) {
  return (
    <ul className={styles.recipientList}>
      {recipients.map((recipient, index) => (
        <li key={`${recipient.email}:${index}`}>
          {recipient.name} &lt;{recipient.email}&gt;
        </li>
      ))}
    </ul>
  );
}

function SendOutcome({ outcome }: { outcome: MeetingPacketSendOutcomeView }) {
  if (outcome.kind === "failure") {
    return (
      <p className={styles.failure} role="alert">
        Send failed: {outcome.message}
      </p>
    );
  }

  return (
    <p className={styles.outcome} role="status" aria-live="polite">
      {outcome.kind === "preview_only"
        ? "Preview only: not sent"
        : outcome.kind === "cancelled"
          ? "Send request cancelled: no email was sent"
          : "Submitted to Resend; delivery pending"}
    </p>
  );
}

function copyRecipient(
  recipient: MeetingPacketRecipientInput,
): MeetingPacketRecipientInput {
  return { name: recipient.name, email: recipient.email };
}

function recipientsEqual(
  left: readonly MeetingPacketRecipientInput[],
  right: readonly MeetingPacketRecipientInput[],
) {
  if (left.length !== right.length) return false;
  return left.every(
    (recipient, index) =>
      recipient.name === right[index]?.name &&
      recipient.email === right[index]?.email,
  );
}
