import { act, render, renderHook, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  isMeetingPacketObjectType,
  MeetingPacketWorkflowPanel,
  packetSendOutcomeFromExecution,
  packetWorkflowFromPersisted,
  type MeetingPacketWorkflowController,
  useMeetingPacketWorkflow,
} from "@/components/command-canvas/meeting-packet-workflow";
import type { BrowserExecutedPacketSend } from "@/lib/packets/browser-api";
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

function workflowController(
  canStageSend: boolean,
): MeetingPacketWorkflowController {
  const packetState = packetWorkflowFromPersisted(
    workflow("reconciling", "reconciling"),
  );
  return {
    canManage: true,
    state: { ...packetState, canStageSend },
    busy: false,
    getStatus: () => "approved",
    preparePacket: vi.fn(),
    savePacketChanges: vi.fn(),
    approvePacket: vi.fn(),
    stagePacketSend: vi.fn(),
    cancelPacketSend: vi.fn(),
    authorizePacketSend: vi.fn(),
    recordError: vi.fn(),
  };
}

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
  it("includes every packet-safe semantic object without including rough or layout-only objects", () => {
    for (const objectType of [
      "note",
      "task_board",
      "schedule",
      "diagram",
      "data_table",
      "reference_card",
      "meeting_card",
    ] as const)
      expect(isMeetingPacketObjectType(objectType)).toBe(true);

    expect(isMeetingPacketObjectType("sketch")).toBe(false);
    expect(isMeetingPacketObjectType("frame")).toBe(false);
  });

  it("prepares data tables, references, and meeting cards through the product workflow", async () => {
    const semanticObjects = {
      "table-launch-metrics": {
        id: "table-launch-metrics",
        type: "data_table" as const,
        title: "Launch metrics",
        payload: {
          columns: [{ id: "column-metric", label: "Metric", kind: "text" as const }],
          rows: [{ id: "row-signups", cells: ["Signups"] }],
        },
      },
      "reference-launch-brief": {
        id: "reference-launch-brief",
        type: "reference_card" as const,
        title: "Launch brief",
        payload: {
          kind: "article" as const,
          sourceUrl: "https://example.com/launch-brief",
          summary: "A bounded launch source.",
          excerpt: null,
        },
      },
      "decision-launch-date": {
        id: "decision-launch-date",
        type: "meeting_card" as const,
        title: "Launch date",
        payload: {
          kind: "decision" as const,
          body: "Ship on September 3.",
          bullets: [],
          owner: "Danny",
          dueDate: "2026-09-03",
          status: "confirmed" as const,
        },
      },
    };
    const persistedObjects = Object.fromEntries(
      Object.values(semanticObjects).map((object, index) => [
        object.id,
        {
          ...object,
          roomId: "11111111-1111-4111-8111-111111111111",
          x: 100 + index * 40,
          y: 100 + index * 40,
          width: 320,
          height: 220,
          zIndex: index + 1,
          minimized: false,
          pinned: false,
          createdBy: "22222222-2222-4222-8222-222222222222",
          createdAt: "2026-08-29T12:00:00.000Z",
          updatedAt: "2026-08-29T12:00:00.000Z",
          deletedAt: null,
          version: 1,
          metadata: {},
        },
      ]),
    );
    const preparePacket = vi.fn(async (input) => ({
      ok: true as const,
      value: {
        packetId: input.packetId,
        packetVersion: 1,
        sourceRevision: 3,
        status: "draft" as const,
        title: input.title,
        objectCount: input.selectedObjectIds.length,
        contentSnapshot: {
          title: input.title,
          content: {
            schemaVersion: 1 as const,
            roomName: "Launch room",
            sourceRevision: 3,
            objects: Object.values(semanticObjects).map((object) => ({
              objectId: object.id,
              objectType: object.type,
              title: object.title,
              payload: object.payload,
            })),
          },
        },
      },
    }));
    const sessionDependencies = {
      loadLatestPacketWorkflow: vi.fn(async () => ({
        ok: true as const,
        value: { packet: null, latestSend: null, activity: [] },
      })),
      preparePacket,
      updatePacket: vi.fn(),
      approvePacket: vi.fn(),
      stagePacketSend: vi.fn(),
      cancelPacketSend: vi.fn(),
      executePacketSend: vi.fn(),
    };
    const session =
      sessionDependencies as unknown as Parameters<
        typeof useMeetingPacketWorkflow
      >[0]["session"];
    const store = {
      getState: () => ({ canvas: { objects: persistedObjects } }),
    } as unknown as Parameters<typeof useMeetingPacketWorkflow>[0]["store"];
    const { result } = renderHook(() =>
      useMeetingPacketWorkflow({
        session,
        store,
        canManage: true,
        createPacketId: () => "packet-semantic-output",
      }),
    );
    await waitFor(() =>
      expect(sessionDependencies.loadLatestPacketWorkflow).toHaveBeenCalled(),
    );

    await act(async () => {
      const prepared = await result.current.preparePacket({ actorType: "agent" });
      expect(prepared.ok).toBe(true);
    });

    expect(preparePacket).toHaveBeenCalledWith(
      expect.objectContaining({
        packetId: "packet-semantic-output",
        selectedObjectIds: [
          "table-launch-metrics",
          "reference-launch-brief",
          "decision-launch-date",
        ],
      }),
      undefined,
    );
  });

  it("preserves a reconciling execute response even when the refresh cannot improve it", () => {
    const executed: BrowserExecutedPacketSend = {
      mode: "resend",
      status: "reconciling",
      sendRequestId: SEND_ID,
      outboundShareId: "33333333-3333-4333-8333-333333333333",
      providerMessageId: "email_accepted_123",
      recipientCount: 1,
      subject: "Launch meeting packet",
      message: "Submission is being reconciled; delivery is not confirmed.",
    };

    expect(packetSendOutcomeFromExecution(executed)).toEqual({
      kind: "reconciling",
    });
  });

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

  it("offers another staged send only for backend-restartable terminal states", () => {
    expect(packetWorkflowFromPersisted(workflow("cancelled", null)).canStageSend).toBe(
      true,
    );
    expect(
      packetWorkflowFromPersisted(workflow("preview_only", "preview_only"))
        .canStageSend,
    ).toBe(true);

    const terminalFailure = workflow("failed", "failed");
    terminalFailure.latestSend!.providerMessageId = null;
    expect(packetWorkflowFromPersisted(terminalFailure).canStageSend).toBe(true);

    expect(
      packetWorkflowFromPersisted(workflow("reconciling", "reconciling"))
        .canStageSend,
    ).toBe(false);
    expect(
      packetWorkflowFromPersisted(workflow("submitted", "delivered"))
        .canStageSend,
    ).toBe(false);
    expect(
      packetWorkflowFromPersisted(workflow("submitted", "bounced"))
        .canStageSend,
    ).toBe(false);
  });

  it("does not render another send request while provider submission is being reconciled", () => {
    render(<MeetingPacketWorkflowPanel workflow={workflowController(false)} />);

    expect(
      screen.queryByRole("button", { name: "Request email send" }),
    ).toBeNull();
  });

  it("presents packet preparation as a WebMCP capability with a human fallback", () => {
    const controller = workflowController(false);
    render(
      <MeetingPacketWorkflowPanel
        workflow={{
          ...controller,
          state: { packet: null, canStageSend: false },
          getStatus: () => "none",
        }}
      />,
    );

    expect(
      screen.getByText(/prepare this through CommandCanvas WebMCP tools/i),
    ).toBeVisible();
    expect(screen.queryByText(/through Site Tools/i)).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Prepare meeting packet" }),
    ).toBeEnabled();
  });
});
