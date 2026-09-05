"use client";

import { useEffect, useState } from "react";

import { CommandCanvasRoom } from "@/components/command-canvas/command-canvas-room";
import type { WebMcpSurfaceState } from "@/components/command-canvas/chatgpt-command-surface";
import {
  createCanvasStore,
  type CanvasStoreState,
} from "@/lib/canvas/canvas-store";
import { createCanvasWorkspaceController } from "@/lib/canvas/workspace-controller";
import {
  createLocalPreviewState,
  LOCAL_PREVIEW_ROOM_ID,
} from "@/lib/canvas/local-preview";
import { createCanvasWebMcpAdapters } from "@/lib/webmcp/canvas-adapters";
import type { WebMcpExecutionContext } from "@/lib/webmcp/phase-guards";
import { WebMcpRegistry } from "@/lib/webmcp/registry";
import type { WebMcpExecutionEvent } from "@/lib/webmcp/registry";
import { upsertWebMcpExecutionActivity } from "@/lib/webmcp/execution-activity";
import { useDocumentWebMcpTarget } from "@/lib/webmcp/use-document-target";
import "./local-preview.css";

export function LocalCommandCanvas() {
  const [webMcpStatus, setWebMcpStatus] = useState<{
    value: string;
    tone: "idle" | "working" | "ready";
  }>({ value: "Checking WebMCP tools…", tone: "working" });
  const [webMcpSurfaceState, setWebMcpSurfaceState] =
    useState<WebMcpSurfaceState>({ status: "checking" });
  const [webMcpExecutionActivity, setWebMcpExecutionActivity] = useState<
    readonly WebMcpExecutionEvent[]
  >([]);
  const webMcpTarget = useDocumentWebMcpTarget();
  const [workspaceController] = useState(createCanvasWorkspaceController);
  const [store] = useState(() => {
    const localStore = createCanvasStore(LOCAL_PREVIEW_ROOM_ID, {
      actor: {
        id: "participant-local-host",
        displayName: "You",
        type: "human",
      },
      createId,
      now: () => new Date().toISOString(),
    });
    localStore.getState().hydrateCanvas(createLocalPreviewState());
    return localStore;
  });

  useEffect(() => {
    let active = true;
    if (!webMcpTarget) {
      queueMicrotask(() => {
        if (active)
          setWebMcpStatus({ value: "WebMCP tools unavailable", tone: "idle" });
        if (active) setWebMcpSurfaceState({ status: "unavailable" });
      });
      return () => {
        active = false;
      };
    }

    const mode =
      process.env.NEXT_PUBLIC_WEBMCP_DYNAMIC_REGISTRATION === "true"
        ? "dynamic"
        : "static";
    const registry = new WebMcpRegistry({
      mode,
      target: webMcpTarget,
      getContext: () => localWebMcpContext(store.getState()),
      adapters: createCanvasWebMcpAdapters({
        store,
        controlWorkspace: (request) =>
          workspaceController.execute(
            request.input,
            request.signal,
            request.source ?? "webmcp",
          ),
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

    const sync = async () => {
      try {
        await registry.sync();
        if (active)
          setWebMcpStatus({
            value: `${registry.registeredToolNames().length} WebMCP tools registered`,
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
            value: "WebMCP tool registration failed",
            tone: "idle",
          });
        if (active)
          setWebMcpSurfaceState({ status: "registration_failed" });
      }
    };

    void sync();
    const unsubscribe =
      mode === "dynamic" ? store.subscribe(() => void sync()) : () => undefined;

    return () => {
      active = false;
      unsubscribe();
      registry.dispose();
    };
  }, [store, webMcpTarget, workspaceController]);

  return (
    <div className="local-preview">
      <section
        className="local-preview-intro"
        aria-label="About this interactive preview"
      >
        <div>
          <strong>Interactive preview</strong>
          <p>Changes stay in this tab. Reload to start again.</p>
          <p>
            Create a note, move it, draw, then Undo. Open Activity to inspect your
            changes.
          </p>
        </div>
        <a
          href="https://youtu.be/s5h2cr2Qpfw"
          target="_blank"
          rel="noopener noreferrer"
        >
          Watch the walkthrough ↗
        </a>
      </section>
      <CommandCanvasRoom
        store={store}
        roomLabel="Your preview"
        roomStatus="local"
        allowBrowserSpeech={false}
        serviceStatus={{
          webMcp: webMcpStatus,
          collaboration: { value: "This tab only", tone: "idle" },
        }}
        previewBoundary={{
          label: "Prepared sample",
          description:
            "The starting sketch and diagram are prepared examples, not a live AI result. This preview keeps canvas changes in this tab. Shared rooms, embedded voice, AI interpretation, and email are unavailable here. Optional hand tracking runs locally after camera permission.",
        }}
        webMcpSurfaceState={webMcpSurfaceState}
        webMcpExecutionActivity={webMcpExecutionActivity}
        workspaceController={workspaceController}
      />
    </div>
  );
}

function localWebMcpContext(state: CanvasStoreState): WebMcpExecutionContext {
  const objects = Object.values(state.canvas.objects).filter(
    (object) => !object.deletedAt,
  );
  const selected = state.selectedObjectId
    ? state.canvas.objects[state.selectedObjectId]
    : undefined;
  return {
    phase: {
      roomActive: true,
      hasContent: objects.length > 0,
      selection: selected
        ? selected.type === "sketch"
          ? "sketch"
          : "object"
        : "none",
      collaboratorCount: 1,
      packet: "none",
    },
    actor: { participantId: "participant-local-host", role: "host" },
    canMutateCanvas: true,
  };
}

function createId(prefix: string) {
  const suffix = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`;
  return `${prefix}-${suffix}`;
}
