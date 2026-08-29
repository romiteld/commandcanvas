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
  selectedObjectIds: string[];
  viewport: CanvasViewport;
  lastError: CommandError | null;
  dispatch: (
    command: CanvasCommand,
    source: CanvasCommandSource,
    actorOverride?: CanvasActor,
  ) => CommandResult;
  hydrateCanvas: (canvas: CanvasState) => boolean;
  confirmCanvas: (canvas: CanvasState) => boolean;
  selectObject: (objectId: string | null) => void;
  selectObjects: (objectIds: string[]) => void;
  toggleObjectSelection: (objectId: string) => void;
  setViewport: (viewport: CanvasViewport) => void;
}

export function createCanvasStore(
  roomId: string,
  dependencies: CanvasStoreDependencies,
): StoreApi<CanvasStoreState> {
  return createStore<CanvasStoreState>((set, get) => ({
    canvas: createEmptyCanvasState(roomId),
    selectedObjectId: null,
    selectedObjectIds: [],
    viewport: { x: 0, y: 0, scale: 1 },
    lastError: null,
    dispatch(command, source, actorOverride) {
      const current = get().canvas;
      const result = applyCanvasCommand(
        current,
        {
          id: dependencies.createId("command"),
          roomId,
          baseRevision: current.revision,
          issuedAt: dependencies.now(),
          actor: actorOverride ?? dependencies.actor,
          source,
          command,
        },
        { createId: dependencies.createId },
      );

      if (result.ok) {
        const selectedObjectIds = activeSelection(
          get().selectedObjectIds,
          result.state,
        );
        set({
          canvas: result.state,
          selectedObjectIds,
          selectedObjectId: selectedObjectIds.at(-1) ?? null,
          lastError: null,
        });
      }
      else set({ lastError: result.error });

      return result;
    },
    hydrateCanvas(canvas) {
      const current = get();
      if (
        canvas.roomId !== roomId ||
        canvas.revision < current.canvas.revision
      )
        return false;

      const selectedObjectIds = activeSelection(
        current.selectedObjectIds,
        canvas,
      );
      set({
        canvas,
        selectedObjectIds,
        selectedObjectId: selectedObjectIds.at(-1) ?? null,
        lastError: null,
      });
      return true;
    },
    confirmCanvas(canvas) {
      const current = get().canvas;
      if (canvas.roomId !== roomId) return false;
      if (canvas.revision < current.revision) return true;
      return get().hydrateCanvas(canvas);
    },
    selectObject(selectedObjectId) {
      const selectedObjectIds = selectedObjectId ? [selectedObjectId] : [];
      set({ selectedObjectId, selectedObjectIds });
    },
    selectObjects(objectIds) {
      const selectedObjectIds = activeSelection(
        [...new Set(objectIds)],
        get().canvas,
      );
      set({
        selectedObjectIds,
        selectedObjectId: selectedObjectIds.at(-1) ?? null,
      });
    },
    toggleObjectSelection(objectId) {
      const current = get();
      const object = current.canvas.objects[objectId];
      if (!object || object.deletedAt) return;
      const selectedObjectIds = current.selectedObjectIds.includes(objectId)
        ? current.selectedObjectIds.filter((id) => id !== objectId)
        : [...current.selectedObjectIds, objectId];
      set({
        selectedObjectIds,
        selectedObjectId: selectedObjectIds.at(-1) ?? null,
      });
    },
    setViewport(viewport) {
      set({ viewport });
    },
  }));
}

function activeSelection(objectIds: string[], canvas: CanvasState) {
  return objectIds.filter((objectId) => {
    const object = canvas.objects[objectId];
    return Boolean(object && !object.deletedAt);
  });
}
