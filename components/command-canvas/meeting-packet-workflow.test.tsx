import { describe, expect, it } from "vitest";

import { packetWorkflowFromPersisted } from "@/components/command-canvas/meeting-packet-workflow";
import type { BrowserPersistedPacketWorkflow } from "@/lib/packets/browser-api";

const SEND_ID = "22222222-2222-4222-8222-222222222222";
const contentSnapshot = {
  title: "Launch meeting packet",
  content: {
    schemaVersion: 1 as const,
    roomName: "Launch room",
    sourceRevision: 9,
    objects: [
      {
        objectId: "note-launch",
        objectType: "note" as const,
        title: "Launch decision",
        payload: { text: "Ship the verified path." },
      },
    ],
  },
};
const recipients = [{ name: "Danny", email: "danny@example.com" }];

function workflow(
  status: NonNullable<BrowserPersistedPacketWorkflow["latestSend"]>["status"],
  deliveryStatus: NonNullable<
    BrowserPersistedPacketWorkflow["latestSend"]
  >["deliveryStatus"],
): BrowserPersistedPacketWorkflow {
  return {
    packet: {
      packetId: "packet-launch",
      packetVersion: 2,
      sourceRevision: 9,
      status: "approved",
      title: contentSnapshot.title,
      contentSnapshot,
      recipients,
      approvedSnapshot: {
        packetVersion: 2,
        contentHash: "a".repeat(64),
        recipientHash: "b".repeat(64),
        contentSnapshot,
        recipients,
      },
    },
    latestSend: {
      sendRequestId: SEND_ID,
      packetId: "packet-launch",
      packetVersion: 2,
      contentHash: "a".repeat(64),
      recipientHash: "b".repeat(64),
      recipients,
      status,
      providerMessageId: "email_accepted_123",
      deliveryStatus,
    },
    activity: [],
  };
}

describe("persisted meeting packet delivery truth", () => {
  it("keeps provider acceptance distinct from delivery", () => {
    expect(
      packetWorkflowFromPersisted(workflow("submitted", "submitted"))
        .sendOutcome,
    ).toEqual({ kind: "submitted" });
    expect(
      packetWorkflowFromPersisted(workflow("submitted", "delivered"))
        .sendOutcome,
    ).toEqual({ kind: "delivered" });
  });

  it("surfaces ambiguous submission and adverse provider truth honestly", () => {
    expect(
      packetWorkflowFromPersisted(workflow("reconciling", "reconciling"))
        .sendOutcome,
    ).toEqual({ kind: "reconciling" });
    expect(
      packetWorkflowFromPersisted(workflow("submitted", "bounced"))
        .sendOutcome,
    ).toEqual({
      kind: "failure",
      message: "Resend reported that the packet email bounced.",
    });

    const rejected = workflow("failed", "failed");
    rejected.latestSend!.providerMessageId = null;
    expect(packetWorkflowFromPersisted(rejected).sendOutcome).toEqual({
      kind: "failure",
      message: "The recorded delivery attempt did not complete.",
    });
  });
});
