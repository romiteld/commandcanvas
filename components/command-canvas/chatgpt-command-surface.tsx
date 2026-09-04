"use client";

import { useEffect, useRef, type ReactNode } from "react";

import type { projectCanvasState } from "@/lib/webmcp/canvas-state-projection";
import type { WebMcpExecutionEvent } from "@/lib/webmcp/registry";

export type WebMcpSurfaceState =
  | { status: "checking" }
  | { status: "unavailable" }
  | { status: "registration_failed" }
  | { status: "registered_to_page"; registeredToolCount: number }
  | {
      status: "invoked";
      registeredToolCount: number;
      latestInvocationId: string;
    };

type CanvasProjection = ReturnType<typeof projectCanvasState>;

export interface ChatGptCommandSurfaceProps {
  surfaceState: WebMcpSurfaceState;
  executionActivity: readonly WebMcpExecutionEvent[];
  projection: CanvasProjection;
  drawerOpen: boolean;
  drawingActive: boolean;
  realtimeActive: boolean;
  realtimeAvailable: boolean;
  onOpenDrawer: () => void;
  /** Agent-originated requests wait for the room's drawing-safe overlay gate. */
  onRequestDrawerOpen: () => void;
  onCloseDrawer: () => void;
  onToggleRealtimeVoice: () => void;
  onViewAllActivity: () => void;
  realtimeContent?: ReactNode;
  typedCommandContent?: ReactNode;
  packetPanel?: ReactNode;
  commandDrawerDeferred?: boolean;
}

export function ChatGptCommandSurface({
  surfaceState,
  executionActivity,
  projection,
  drawerOpen,
  drawingActive,
  realtimeActive,
  realtimeAvailable,
  onOpenDrawer,
  onRequestDrawerOpen,
  onCloseDrawer,
  onToggleRealtimeVoice,
  onViewAllActivity,
  realtimeContent,
  typedCommandContent,
  packetPanel,
  commandDrawerDeferred = false,
}: ChatGptCommandSurfaceProps) {
  const approvalSectionRef = useRef<HTMLElement>(null);
  const revealedApprovalInvocationRef = useRef<string | null>(null);
  const siteToolsRegistered =
    surfaceState.status === "registered_to_page" ||
    surfaceState.status === "invoked";
  const awaitingApproval = [...executionActivity].reverse().find(
    (event) => event.status === "awaiting_human_approval",
  );

  useEffect(() => {
    if (!awaitingApproval) return;
    if (revealedApprovalInvocationRef.current !== awaitingApproval.invocationId) {
      revealedApprovalInvocationRef.current = awaitingApproval.invocationId;
      if (!drawerOpen) {
        onRequestDrawerOpen();
        return;
      }
    }
    if (drawerOpen) approvalSectionRef.current?.focus();
  }, [awaitingApproval, drawerOpen, onRequestDrawerOpen]);

  const commandDrawerInteractive = drawerOpen && !drawingActive;

  function useVoice() {
    if (realtimeActive) {
      onToggleRealtimeVoice();
      return;
    }
    if (!realtimeAvailable) {
      onOpenDrawer();
      return;
    }
    onToggleRealtimeVoice();
    if (!drawingActive) onOpenDrawer();
  }

  return (
    <div
      className={`chatgpt-command-surface${drawingActive ? " is-drawing" : ""}`}
    >
      <div
        className="chatgpt-command-pill"
        role="group"
        aria-label="WebMCP tools and CommandCanvas Live Voice"
      >
        <button
          type="button"
          className="chatgpt-command-segment"
          aria-label="Open WebMCP agent activity"
          aria-expanded={drawerOpen}
          disabled={drawingActive}
          onClick={onOpenDrawer}
        >
          <span className="agent-pulse" aria-hidden="true" />
          <span className="chatgpt-command-label">
            <strong>WebMCP</strong>
            <small>tools</small>
          </span>
        </button>
        <button
          type="button"
          className="chatgpt-voice-segment"
          aria-label={
            realtimeActive
              ? "Stop CommandCanvas Live Voice"
              : "Start CommandCanvas Live Voice"
          }
          title={
            realtimeActive
              ? "Stop CommandCanvas Live Voice"
              : "Start CommandCanvas Live Voice"
          }
          aria-pressed={realtimeActive || undefined}
          disabled={!realtimeActive && !realtimeAvailable}
          onClick={useVoice}
        >
          <span className="chatgpt-live-indicator" aria-hidden="true">●</span>
          <small>Live voice</small>
        </button>
      </div>

      {drawingActive && commandDrawerDeferred ? (
        <p className="chatgpt-deferred-command-notice" role="status">
          Agent request queued until drawing finishes.
        </p>
      ) : null}

      <aside
        className={`command-rail overlay-drawer persistent-command-drawer chatgpt-command-drawer${
          commandDrawerInteractive ? " is-open" : ""
        }`}
        aria-label="WebMCP activity and CommandCanvas Live Voice drawer"
        aria-hidden={commandDrawerInteractive ? undefined : true}
        inert={commandDrawerInteractive ? undefined : true}
      >
        <div className="rail-heading">
          <div>
            <p className="eyebrow">Agent activity and Live Voice</p>
            <h2>WebMCP activity</h2>
          </div>
          <button
            type="button"
            aria-label="Close WebMCP activity and CommandCanvas Live Voice drawer"
            onClick={onCloseDrawer}
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>

        <section className="chatgpt-mode-summary" aria-label="Agent and voice mode">
          <strong>{surfaceHeading(surfaceState)}</strong>
          <p>{surfaceDescription(surfaceState)}</p>
          {siteToolsRegistered ? (
            <p className="chatgpt-host-voice-guidance" role="status">
              When this page is open in the ChatGPT desktop app&apos;s built-in
              browser, the surrounding host uses the ChatGPT account already
              signed into that app to discover and invoke WebMCP tools.
              CommandCanvas never receives that surrounding ChatGPT credential.
              Registration alone does not prove a tool ran. An actual invocation
              and receipt below prove page execution, but this page does not
              authenticate which compatible agent host initiated it. Current
              OpenAI guidance does not promise that ChatGPT Voice will invoke
              WebMCP tools, so verify that host behavior before relying on it. The
              adjacent mic starts CommandCanvas Live Voice, which uses a
              separately billed user-owned OpenAI API credential.
            </p>
          ) : null}
          {siteToolsRegistered && realtimeAvailable ? (
            <button
              type="button"
              aria-label={
                realtimeActive
                  ? "Stop CommandCanvas Live Voice from drawer"
                  : "Start CommandCanvas Live Voice from drawer"
              }
              onClick={onToggleRealtimeVoice}
            >
              {realtimeActive
                ? "Stop CommandCanvas Live Voice"
                : "Start CommandCanvas Live Voice"}
            </button>
          ) : null}
        </section>

        <section className="chatgpt-canvas-context" aria-label="Visible canvas context">
          <strong>What the page can share</strong>
          <p>
            Revision {projection.revision} · {projection.objects.length}{" "}
            visible {projection.objects.length === 1 ? "object" : "objects"}
          </p>
          <span>
            {projection.selectedObjectId
              ? `Selected: ${
                  projection.objects.find(
                    (object) => object.id === projection.selectedObjectId,
                  )?.title ?? projection.selectedObjectId
                }`
              : "No object selected"}
          </span>
        </section>

        <section className="chatgpt-tool-activity" aria-label="Recent WebMCP activity">
          <strong>WebMCP activity</strong>
          {executionActivity.length === 0 ? (
            <p>No WebMCP tool has been invoked on this page yet.</p>
          ) : (
            <ol>
              {executionActivity.map((event) => (
                <li key={event.invocationId} data-status={event.status}>
                  <span>{humanize(event.toolName)}</span>
                  <strong>{humanize(event.status).toUpperCase()}</strong>
                  <p>{event.message}</p>
                  {event.receiptId ? <small>Receipt {event.receiptId}</small> : null}
                </li>
              ))}
            </ol>
          )}
        </section>

        {realtimeContent ? (
          <section className="chatgpt-realtime-content" aria-label="CommandCanvas Live Voice">
            {realtimeContent}
          </section>
        ) : null}

        {packetPanel ? (
          <section
            className="chatgpt-packet-approval"
            aria-label="Meeting packet approval"
            tabIndex={-1}
            ref={approvalSectionRef}
          >
            {packetPanel}
          </section>
        ) : null}

        <section className="chatgpt-recent-receipts" aria-label="Recent canvas receipts">
          <div>
            <strong>Recent receipts</strong>
            <button type="button" onClick={onViewAllActivity}>
              View all activity
            </button>
          </div>
          {projection.receipts.length === 0 ? (
            <p>No durable canvas receipt is in the current projection.</p>
          ) : (
            <ol>
              {[...projection.receipts]
                .reverse()
                .slice(0, 3)
                .map((receipt) => (
                  <li key={receipt.id}>
                    <p>{receipt.description}</p>
                    <span>R{receipt.revision} · {receipt.source}</span>
                  </li>
                ))}
            </ol>
          )}
        </section>

        {typedCommandContent ? (
          <section className="chatgpt-typed-command" aria-label="Typed command fallback">
            {typedCommandContent}
          </section>
        ) : null}
      </aside>
    </div>
  );
}

function surfaceHeading(state: WebMcpSurfaceState) {
  switch (state.status) {
    case "checking":
      return "Checking WebMCP tool registration";
    case "unavailable":
      return "WebMCP tools unavailable in this browser session";
    case "registration_failed":
      return "WebMCP tool registration failed";
    case "registered_to_page":
      return `${state.registeredToolCount} WebMCP tools registered to this page`;
    case "invoked":
      return "A WebMCP tool was invoked";
  }
}

function surfaceDescription(state: WebMcpSurfaceState) {
  switch (state.status) {
    case "checking":
      return "CommandCanvas is checking whether it can register WebMCP tools on this page.";
    case "unavailable":
      return "No additional ChatGPT sign-in is required. This browser session did not expose WebMCP tools to CommandCanvas. Availability can depend on the browser, account, selected model, workspace policy, or rollout. Canvas controls and typed commands still work; CommandCanvas Live Voice is a separate optional API-key path.";
    case "registration_failed":
      return "The page could not register WebMCP tools. Canvas controls still work normally.";
    case "registered_to_page":
      return "CommandCanvas registers its WebMCP tools automatically when the live canvas is ready. Compatible agents can discover and invoke them without opening this activity drawer. Registration alone does not prove a tool ran. An actual invocation and receipt below prove page execution, but this page does not authenticate which compatible agent host initiated it.";
    case "invoked":
      return "This status is based on an actual page-observable WebMCP tool invocation and its recorded activity.";
  }
}

function humanize(value: string) {
  return value.replaceAll("_", " ");
}
