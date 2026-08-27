"use client";

import { useEffect, useState } from "react";

import { CommandCanvasRoom } from "@/components/command-canvas/command-canvas-room";
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
import type { BrowserRoomClient } from "@/lib/supabase/browser-room";
import { createBrowserSupabaseClient } from "@/lib/supabase/browser-client";
import { createBrowserRoomApi } from "@/lib/supabase/room-api";
import type { NoSignupAuthClient } from "@/lib/supabase/session";
import { createCanvasWebMcpAdapters } from "@/lib/webmcp/canvas-adapters";
import { resolveDocumentWebMcpTarget } from "@/lib/webmcp/document-target";
import type { WebMcpExecutionContext } from "@/lib/webmcp/phase-guards";
import { WebMcpRegistry } from "@/lib/webmcp/registry";

export interface DemoCommandCanvasEnvironment {
  bootstrap: () => Promise<DemoRoomBootstrapResult>;
  copyInvite: (inviteUrl: string) => Promise<void>;
  resetDemo: () => void;
}

interface DemoCommandCanvasProps {
  environment?: DemoCommandCanvasEnvironment;
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
};

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
  const readyRoom = view.status === "ready" ? view.room : null;

  useEffect(() => {
    let active = true;
    let session: DemoRoomSession | null = null;
    let unsubscribe: () => void = () => undefined;

    void environment.bootstrap().then(async (result) => {
      if (!active) {
        if (result.ok) await result.session.dispose();
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
      if (session) void session.dispose();
    };
  }, [environment]);

  useEffect(() => {
    if (!readyRoom) return;
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
      getContext: () => demoWebMcpContext(room.session, room.store),
      adapters: createCanvasWebMcpAdapters({
        store: room.store,
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
    };
  }, [readyRoom]);

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
        <button type="button" aria-label="Reset demo" onClick={environment.resetDemo}>
          Reset demo
        </button>
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
        onCanvasPointerWorldMove={(point) => {
          void room.session.publishCursor(point);
        }}
      />
    </div>
  );
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
  return bootstrapDemoRoom({
    search: window.location.search,
    origin: window.location.origin,
    storage: window.sessionStorage,
    replacePath: (path) => window.history.replaceState(null, "", path),
    createSession: (hydrateCanvas) =>
      createDemoRoomSession({
        authClient: client as unknown as NoSignupAuthClient,
        roomDataClient: client as unknown as BrowserRoomClient,
        realtimeClient: client as unknown as DemoRoomRealtimeClient,
        createRoomApi: (accessToken) => createBrowserRoomApi({ accessToken }),
        hydrateCanvas,
        createCommandId: () => globalThis.crypto.randomUUID(),
        now: () => new Date(),
      }),
  });
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
      packet: "none",
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
