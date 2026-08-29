"use client";

import { useEffect, useState } from "react";

import { CommandCanvasRoom } from "@/components/command-canvas/command-canvas-room";
import type { WebMcpSurfaceState } from "@/components/command-canvas/chatgpt-command-surface";
import {
  createCanvasStore,
  type CanvasStoreState,
} from "@/lib/canvas/canvas-store";
import { createCanvasWebMcpAdapters } from "@/lib/webmcp/canvas-adapters";
import { resolveDocumentWebMcpTarget } from "@/lib/webmcp/document-target";
import type { WebMcpExecutionContext } from "@/lib/webmcp/phase-guards";
import { WebMcpRegistry } from "@/lib/webmcp/registry";
import type { WebMcpExecutionEvent } from "@/lib/webmcp/registry";
import { upsertWebMcpExecutionActivity } from "@/lib/webmcp/execution-activity";

export function LocalCommandCanvas() {
  const [webMcpStatus, setWebMcpStatus] = useState<{
    value: string;
    tone: "idle" | "working" | "ready";
  }>({ value: "Checking Site Tools…", tone: "working" });
  const [webMcpSurfaceState, setWebMcpSurfaceState] =
    useState<WebMcpSurfaceState>({ status: "checking" });
  const [webMcpExecutionActivity, setWebMcpExecutionActivity] = useState<
    readonly WebMcpExecutionEvent[]
  >([]);
  const [store] = useState(() =>
    createCanvasStore("room-local", {
      actor: {
        id: "participant-local-host",
        displayName: "Danny",
        type: "human",
      },
      createId,
      now: () => new Date().toISOString(),
    }),
  );

  useEffect(() => {
    let active = true;
    const target = resolveDocumentWebMcpTarget(document);
    if (!target) {
      queueMicrotask(() => {
        if (active)
          setWebMcpStatus({ value: "Site Tools unavailable", tone: "idle" });
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
      target,
      getContext: () => localWebMcpContext(store.getState()),
      adapters: createCanvasWebMcpAdapters({ store }),
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
    const unsubscribe =
      mode === "dynamic" ? store.subscribe(() => void sync()) : () => undefined;

    return () => {
      active = false;
      unsubscribe();
      registry.dispose();
    };
  }, [store]);

  return (
    <CommandCanvasRoom
      store={store}
      serviceStatus={{ webMcp: webMcpStatus }}
      webMcpSurfaceState={webMcpSurfaceState}
      webMcpExecutionActivity={webMcpExecutionActivity}
    />
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
    canMutate: true,
  };
}

function createId(prefix: string) {
  const suffix = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`;
  return `${prefix}-${suffix}`;
}
