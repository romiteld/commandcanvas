import { createStore, type StoreApi } from "zustand";

import type { CanvasViewport } from "@/lib/canvas/coordinates";
import type {
  CanvasActor,
  CanvasCommand,
  CanvasCommandSource,
  CanvasState,
  CommandError,
  CommandResult,
} from "@/lib/canvas/command-engine";
import {
  applyCanvasCommand,
  createEmptyCanvasState,
} from "@/lib/canvas/command-engine";

export interface CanvasStoreDependencies {
  actor: CanvasActor;
  createId: (prefix: string) => string;
  now: () => string;
}

export interface CanvasStoreState {
  canvas: CanvasState;
  selectedObjectId: string | null;
  viewport: CanvasViewport;
  lastError: CommandError | null;
  dispatch: (command: CanvasCommand, source: CanvasCommandSource) => CommandResult;
  selectObject: (objectId: string | null) => void;
  setViewport: (viewport: CanvasViewport) => void;
}

export function createCanvasStore(
  roomId: string,
  dependencies: CanvasStoreDependencies,
): StoreApi<CanvasStoreState> {
  return createStore<CanvasStoreState>((set, get) => ({
    canvas: createEmptyCanvasState(roomId),
    selectedObjectId: null,
    viewport: { x: 0, y: 0, scale: 1 },
    lastError: null,
    dispatch(command, source) {
      const current = get().canvas;
      const result = applyCanvasCommand(
        current,
        {
          id: dependencies.createId("command"),
          roomId,
          baseRevision: current.revision,
          issuedAt: dependencies.now(),
          actor: dependencies.actor,
          source,
          command,
        },
        { createId: dependencies.createId },
      );

      if (result.ok) set({ canvas: result.state, lastError: null });
      else set({ lastError: result.error });

      return result;
    },
    selectObject(selectedObjectId) {
      set({ selectedObjectId });
    },
    setViewport(viewport) {
      set({ viewport });
    },
  }));
}
