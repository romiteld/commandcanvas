import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  MeetingPacketPanel,
  type MeetingPacketPanelProps,
} from "./meeting-packet-panel";

const contentSnapshot = {
  title: "Launch readiness packet",
  content: {
    schemaVersion: 1 as const,
    roomName: "Architecture review",
    sourceRevision: 12,
    objects: [
      {
        objectId: "note-launch",
        objectType: "note" as const,
        title: "Launch decision",
        payload: { text: "Ship the shared spatial workflow.", tone: "sky" },
      },
      {
        objectId: "diagram-system",
        objectType: "diagram" as const,
        title: "System architecture",
        payload: {
          kind: "architecture",
          interpretationSummary: "The browser connects to the API.",
          nodes: [
            {
              id: "node-browser",
              label: "Browser",
              kind: "client",
              x: 0,
              y: 0,
              width: 160,
              height: 80,
            },
            {
              id: "node-api",
              label: "API",
              kind: "service",
              x: 240,
              y: 0,
              width: 160,
              height: 80,
            },
          ],
          edges: [
            {
              id: "edge-browser-api",
              from: "node-browser",
              to: "node-api",
              label: "HTTPS",
            },
          ],
        },
      },
    ],
  },
};

const typedContentSnapshot = {
  title: "Typed packet",
  content: {
    schemaVersion: 1 as const,
    roomName: "Planning room",
    sourceRevision: 18,
    objects: [
      {
        objectId: "board-launch",
        objectType: "task_board" as const,
        title: "Launch board",
        payload: {
          columns: [
            {
              id: "column-todo",
              title: "To do",
              tasks: [
                {
                  id: "task-demo",
                  title: "Verify demo",
                  owner: "Danny",
                  dueDate: "2026-09-01",
                  priority: "high",
                },
              ],
            },
          ],
        },
      },
      {
        objectId: "schedule-launch",
        objectType: "schedule" as const,
        title: "Launch schedule",
        payload: {
          timezone: "America/New_York",
          days: [
            {
              date: "2026-09-01",
              label: "Tuesday",
              entries: [
                {
                  id: "entry-record",
                  time: "14:30",
                  title: "Record demo",
                  owner: "Sarah",
                },
              ],
            },
          ],
        },
      },
      {
        objectId: "chart-readiness",
        objectType: "diagram" as const,
        title: "Readiness chart",
        payload: {
          kind: "bar_chart",
          interpretationSummary: "Readiness is increasing.",
          chart: {
            title: "Readiness by day",
            xAxisLabel: "Day",
            yAxisLabel: "Percent",
            series: [
              {
                id: "series-ready",
                label: "Ready",
                points: [
                  { label: "Monday", value: 60 },
                  { label: "Tuesday", value: 85 },
                ],
              },
            ],
          },
        },
      },
      {
        objectId: "table-risks",
        objectType: "data_table" as const,
        title: "Risk register",
        payload: {
          columns: [
            { id: "column-risk", label: "Risk", kind: "text" },
            { id: "column-score", label: "Score", kind: "number" },
          ],
          rows: [{ id: "row-camera", cells: ["Camera", 3] }],
        },
      },
      {
        objectId: "reference-spec",
        objectType: "reference_card" as const,
        title: "WebMCP specification",
        payload: {
          kind: "article",
          sourceUrl: "https://example.com/spec",
          summary: "Semantic tools operate on the live page.",
          excerpt: "The agent and human share one session.",
        },
      },
      {
        objectId: "decision-stack",
        objectType: "meeting_card" as const,
        title: "Stack decision",
        payload: {
          kind: "decision",
          body: "Use Supabase Realtime.",
          bullets: ["Presence for people", "Broadcast for cursors"],
          owner: "Danny",
          dueDate: "2026-09-01",
          status: "confirmed",
        },
      },
    ],
  },
};

const draftPacket = {
  id: "packet-launch",
  status: "draft" as const,
  version: 3,
  title: "Launch readiness packet",
  contentSummary:
    "Decision: ship the shared canvas. Action: Daniel verifies the public demo.",
  contentSnapshot,
  recipients: [
    { name: "Danny Romitelli", email: "danny@example.com" },
    { name: "Sarah Chen", email: "sarah@example.com" },
  ],
};

const approvedPacket = {
  id: "packet-launch",
  status: "approved" as const,
  version: 5,
  title: "Launch readiness packet",
  contentSummary:
    "Decision: ship the shared canvas. Action: Daniel verifies the public demo.",
  contentSnapshot,
  recipients: [
    { name: "Unsnapshotted name", email: "changed@example.com" },
  ],
  approvedSnapshot: {
    version: 4,
    title: "Launch readiness packet",
    contentSummary:
      "Decision: ship the shared canvas. Action: Daniel verifies the public demo.",
    contentSnapshot,
    contentHash: "a".repeat(64),
    recipientHash: "b".repeat(64),
    recipients: [
      { name: "Danny Romitelli", email: "danny@example.com" },
      { name: "Sarah Chen", email: "sarah@example.com" },
    ],
  },
};

function renderPanel(overrides: Partial<MeetingPacketPanelProps> = {}) {
  const props: MeetingPacketPanelProps = {
    packet: draftPacket,
    onSaveChanges: vi.fn(),
    onApprove: vi.fn(),
    onCancelSend: vi.fn(),
    onAuthorizeSend: vi.fn(),
    ...overrides,
  };

  return { ...render(<MeetingPacketPanel {...props} />), props };
}

describe("MeetingPacketPanel", () => {
  it("renders bounded immutable packet receipts with actor attribution", () => {
    renderPanel({
      activity: [
        {
          receiptId: "33333333-3333-4333-8333-333333333333",
          revision: 4,
          occurredAt: "2026-08-27T16:04:00.000Z",
          actorType: "human",
          actorDisplayName: "Danny",
          action: "packet_send_cancelled",
          description: "Danny cancelled the staged packet send.",
        },
        {
          receiptId: "44444444-4444-4444-8444-444444444444",
          revision: 3,
          occurredAt: "2026-08-27T16:03:00.000Z",
          actorType: "agent",
          actorDisplayName: "ChatGPT via WebMCP",
          action: "packet_send_staged",
          description: "ChatGPT requested approval to send the packet.",
        },
      ],
    });

    const activity = screen.getByRole("region", {
      name: "Meeting packet activity",
    });
    expect(within(activity).getByText("Revision 4")).toBeVisible();
    expect(within(activity).getByText("Danny")).toBeVisible();
    expect(
      within(activity).getByText("Danny cancelled the staged packet send."),
    ).toBeVisible();
    expect(within(activity).getByText("Revision 3")).toBeVisible();
    expect(within(activity).getByText("ChatGPT via WebMCP")).toBeVisible();
    expect(
      within(activity).getByText(
        "ChatGPT requested approval to send the packet.",
      ),
    ).toBeVisible();
  });

  it("shows the exact draft, edits recipient values, saves them, and then allows approval", async () => {
    const user = userEvent.setup();
    const onSaveChanges = vi.fn(async () => undefined);
    const onApprove = vi.fn(async () => undefined);
    renderPanel({ onSaveChanges, onApprove });

    expect(
      screen.getByRole("heading", { name: "Launch readiness packet" }),
    ).toBeVisible();
    const snapshot = screen.getByRole("region", {
      name: "Packet content snapshot",
    });
    expect(within(snapshot).getByText("Architecture review")).toBeVisible();
    expect(within(snapshot).getByText("Canvas revision 12")).toBeVisible();
    expect(within(snapshot).getByText("Launch decision")).toBeVisible();
    expect(within(snapshot).getByText("System architecture")).toBeVisible();
    expect(
      within(snapshot).getByText("Ship the shared spatial workflow."),
    ).toBeVisible();
    expect(
      within(snapshot).getByText("The browser connects to the API."),
    ).toBeVisible();
    expect(within(snapshot).getByText("Browser")).toBeVisible();
    expect(within(snapshot).getByText("API")).toBeVisible();
    expect(within(snapshot).getByText("Browser -> API - HTTPS")).toBeVisible();
    expect(within(snapshot).queryByText(/\{"text":/)).toBeNull();
    expect(
      screen.getByText(
        "Decision: ship the shared canvas. Action: Daniel verifies the public demo.",
        { exact: true },
      ),
    ).toBeVisible();
    expect(screen.getByLabelText("Recipient 1 name")).toHaveValue(
      "Danny Romitelli",
    );
    expect(screen.getByLabelText("Recipient 1 email")).toHaveValue(
      "danny@example.com",
    );

    await user.clear(screen.getByLabelText("Recipient 2 name"));
    await user.type(screen.getByLabelText("Recipient 2 name"), "Sarah Patel");
    await user.clear(screen.getByLabelText("Recipient 2 email"));
    await user.type(
      screen.getByLabelText("Recipient 2 email"),
      "sarah.patel@example.com",
    );
    await user.click(screen.getByRole("button", { name: "Add recipient" }));
    await user.type(screen.getByLabelText("Recipient 3 name"), "Jordan Lee");
    await user.type(
      screen.getByLabelText("Recipient 3 email"),
      "jordan@example.com",
    );

    expect(screen.getByRole("button", { name: "Approve packet" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(onSaveChanges).toHaveBeenCalledWith({
      packetId: "packet-launch",
      version: 3,
      recipients: [
        { name: "Danny Romitelli", email: "danny@example.com" },
        { name: "Sarah Patel", email: "sarah.patel@example.com" },
        { name: "Jordan Lee", email: "jordan@example.com" },
      ],
    });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Approve packet" })).toBeEnabled(),
    );
    await user.click(screen.getByRole("button", { name: "Approve packet" }));
    expect(onApprove).toHaveBeenCalledWith({
      packetId: "packet-launch",
      version: 3,
    });
  });

  it("renders task, schedule, chart, table, reference, and meeting content as readable semantic structures", () => {
    renderPanel({
      packet: {
        ...draftPacket,
        title: typedContentSnapshot.title,
        contentSnapshot: typedContentSnapshot,
      },
    });

    const snapshot = screen.getByRole("region", {
      name: "Packet content snapshot",
    });
    expect(within(snapshot).getByRole("heading", { name: "Launch board" })).toBeVisible();
    expect(within(snapshot).getByText("Verify demo")).toBeVisible();
    expect(within(snapshot).getByText(/Danny.*2026-09-01.*high priority/i)).toBeVisible();
    expect(within(snapshot).getByRole("heading", { name: "Launch schedule" })).toBeVisible();
    expect(within(snapshot).getByText("14:30")).toBeVisible();
    expect(within(snapshot).getByText(/Record demo.*Sarah/i)).toBeVisible();
    expect(within(snapshot).getByRole("table", { name: "Readiness by day" })).toBeVisible();
    expect(within(snapshot).getByText("Value axis: Percent")).toBeVisible();
    expect(
      within(snapshot).getByRole("columnheader", { name: "Ready (Percent)" }),
    ).toBeVisible();
    expect(within(snapshot).getByRole("table", { name: "Risk register" })).toBeVisible();
    expect(within(snapshot).getByRole("cell", { name: "Camera" })).toBeVisible();
    expect(within(snapshot).getByRole("link", { name: "Open source" })).toHaveAttribute(
      "href",
      "https://example.com/spec",
    );
    expect(within(snapshot).getByText("Use Supabase Realtime.")).toBeVisible();
    expect(within(snapshot).getByText("Presence for people")).toBeVisible();
    expect(within(snapshot).getByText("Confirmed")).toBeVisible();
    expect(within(snapshot).queryByRole("code")).toBeNull();
  });

  it("supports removing recipients but never permits more than ten", async () => {
    const user = userEvent.setup();
    const tenRecipients = Array.from({ length: 10 }, (_, index) => ({
      name: `Person ${index + 1}`,
      email: `person${index + 1}@example.com`,
    }));
    renderPanel({ packet: { ...draftPacket, recipients: tenRecipients } });

    expect(screen.getByRole("button", { name: "Add recipient" })).toBeDisabled();
    expect(screen.getByText("Maximum 10 recipients.")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Remove recipient 10" }));
    expect(screen.getByLabelText("Recipient 9 email")).toHaveValue(
      "person9@example.com",
    );
    expect(screen.getByRole("button", { name: "Add recipient" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Add recipient" }));
    expect(screen.getByLabelText("Recipient 10 email")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Add recipient" })).toBeDisabled();
  });

  it("renders the immutable approval snapshot and never exposes draft recipient controls", () => {
    renderPanel({ packet: approvedPacket });

    expect(screen.getByText("Approved packet v4")).toBeVisible();
    expect(
      screen.getByText(
        "2 recipients locked in this approval snapshot. Editing creates a new draft and invalidates this approval.",
      ),
    ).toBeVisible();
    expect(screen.getByText("Danny Romitelli <danny@example.com>")).toBeVisible();
    expect(screen.queryByDisplayValue("Unsnapshotted name")).toBeNull();
    expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Approve packet" })).toBeNull();
  });

  it("stages the exact approved send without authorizing it until the human presses SEND", async () => {
    const user = userEvent.setup();
    const onAuthorizeSend = vi.fn(async () => undefined);
    const onCancelSend = vi.fn(async () => undefined);
    renderPanel({
      packet: approvedPacket,
      stagedSend: {
        id: "send-request-9",
        approvedPacketVersion: 4,
        contentHash: "c".repeat(64),
        recipientHash: "d".repeat(64),
        recipients: [
          { name: "Authoritative snapshot", email: "locked@example.com" },
        ],
      },
      onAuthorizeSend,
      onCancelSend,
    });

    expect(onAuthorizeSend).not.toHaveBeenCalled();
    const confirmation = screen.getByRole("alertdialog", { name: "Send packet?" });
    expect(confirmation).toBeVisible();
    expect(
      within(confirmation).getByText("Approved packet v4", { selector: "strong" }),
    ).toBeVisible();
    expect(within(confirmation).getByText("1 recipient", { exact: true })).toBeVisible();
    expect(
      within(confirmation).getByText(
        "Authoritative snapshot <locked@example.com>",
      ),
    ).toBeVisible();
    expect(within(confirmation).queryByText(/danny@example\.com/i)).toBeNull();
    expect(within(confirmation).getByText("c".repeat(64))).toBeVisible();
    expect(within(confirmation).getByText("d".repeat(64))).toBeVisible();

    await user.click(screen.getByRole("button", { name: "SEND" }));
    expect(onAuthorizeSend).toHaveBeenCalledWith({
      packetId: "packet-launch",
      sendRequestId: "send-request-9",
      approvedPacketVersion: 4,
    });
  });

  it("renders cancellation and a later restage only from durable workflow props", async () => {
    const user = userEvent.setup();
    const onCancelSend = vi.fn(async () => undefined);
    const onAuthorizeSend = vi.fn(async () => undefined);
    const firstStage = {
      id: "send-request-9",
      approvedPacketVersion: 4,
      contentHash: "c".repeat(64),
      recipientHash: "d".repeat(64),
      recipients: [
        { name: "Authoritative snapshot", email: "locked@example.com" },
      ],
    };
    const rendered = renderPanel({
      packet: approvedPacket,
      stagedSend: firstStage,
      onCancelSend,
      onAuthorizeSend,
    });

    await user.click(screen.getByRole("button", { name: "Cancel packet send" }));

    expect(onCancelSend).toHaveBeenCalledWith({ sendRequestId: "send-request-9" });
    expect(onAuthorizeSend).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "SEND" })).toBeVisible();
    expect(screen.queryByRole("status")).toBeNull();

    rendered.rerender(
      <MeetingPacketPanel
        packet={approvedPacket}
        sendOutcome={{ kind: "cancelled" }}
        onSaveChanges={vi.fn()}
        onApprove={vi.fn()}
        onCancelSend={onCancelSend}
        onAuthorizeSend={onAuthorizeSend}
      />,
    );
    expect(screen.queryByRole("button", { name: "SEND" })).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Send request cancelled: no email was sent",
    );

    rendered.rerender(
      <MeetingPacketPanel
        packet={approvedPacket}
        stagedSend={{ ...firstStage, id: "send-request-10" }}
        onSaveChanges={vi.fn()}
        onApprove={vi.fn()}
        onCancelSend={onCancelSend}
        onAuthorizeSend={onAuthorizeSend}
      />,
    );
    expect(screen.getByRole("alertdialog", { name: "Send packet?" })).toBeVisible();
    expect(screen.getByRole("button", { name: "SEND" })).toBeVisible();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("disables conflicting draft controls while an asynchronous save is pending", async () => {
    const user = userEvent.setup();
    let finishSave: (() => void) | undefined;
    const onSaveChanges = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishSave = resolve;
        }),
    );
    renderPanel({ onSaveChanges });

    await user.type(screen.getByLabelText("Recipient 1 name"), " Jr.");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Approve packet" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add recipient" })).toBeDisabled();
    expect(screen.getByLabelText("Recipient 1 name")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Remove recipient 1" })).toBeDisabled();

    await act(async () => finishSave?.());
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Approve packet" })).toBeEnabled(),
    );
  });

  it("disables cancel and SEND together while external authorization is pending", async () => {
    const user = userEvent.setup();
    let finishSend: (() => void) | undefined;
    const onAuthorizeSend = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishSend = resolve;
        }),
    );
    renderPanel({
      packet: approvedPacket,
      stagedSend: {
        id: "send-request-9",
        approvedPacketVersion: 4,
        contentHash: "c".repeat(64),
        recipientHash: "d".repeat(64),
        recipients: approvedPacket.approvedSnapshot.recipients,
      },
      onAuthorizeSend,
    });

    await user.click(screen.getByRole("button", { name: "SEND" }));
    expect(screen.getByRole("button", { name: "Sending…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel packet send" })).toBeDisabled();

    await act(async () => finishSend?.());
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "SEND" })).toBeEnabled(),
    );
  });

  it("keeps staged send controls locked while the parent operation is still settling", () => {
    renderPanel({
      packet: approvedPacket,
      stagedSend: {
        id: "send-request-9",
        approvedPacketVersion: 4,
        contentHash: "c".repeat(64),
        recipientHash: "d".repeat(64),
        recipients: approvedPacket.approvedSnapshot.recipients,
      },
      operationBusy: true,
    } as Partial<MeetingPacketPanelProps>);

    expect(
      screen.getByRole("button", { name: "Cancel packet send" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "SEND" })).toBeDisabled();
  });

  it.each([
    ["preview_only", "Preview only: not sent"],
    ["submitted", "Submitted to Resend; delivery pending"],
    ["reconciling", "Submission status is being reconciled; delivery is not confirmed"],
    ["delivered", "Resend confirmed delivery"],
  ] as const)("reports the honest %s outcome", (kind, message) => {
    renderPanel({
      packet: approvedPacket,
      sendOutcome: { kind },
    });

    expect(screen.getByRole("status")).toHaveTextContent(message);
  });

  it("reports a send failure without implying delivery", () => {
    renderPanel({
      packet: approvedPacket,
      sendOutcome: {
        kind: "failure",
        message: "Resend rejected the request.",
      },
    });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Send failed: Resend rejected the request.",
    );
    expect(screen.queryByText(/delivery pending/i)).toBeNull();
  });
});
