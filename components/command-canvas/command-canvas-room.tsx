"use client";

import {
  useRef,
  useState,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { StoreApi } from "zustand";
import { useStore } from "zustand";

import { DiagramPreview } from "@/components/command-canvas/diagram-preview";
import { SketchComposer } from "@/components/command-canvas/sketch-composer";
import { SketchPreview } from "@/components/command-canvas/sketch-preview";
import { SpatialCameraControl } from "@/components/command-canvas/spatial-camera-control";
import type { CanvasStoreState } from "@/lib/canvas/canvas-store";
import type { SketchPayload } from "@/lib/canvas/object-model";
import type {
  CanvasCommand,
  CanvasCommandSource,
  CanvasObject,
  CommandResult,
} from "@/lib/canvas/command-engine";
import {
  fitViewportToWorldBounds,
  screenToWorld,
  worldToScreen,
  zoomViewportAt,
  type CanvasPoint,
} from "@/lib/canvas/coordinates";
import type {
  HandTrackingController,
  HandTrackingObservation,
  HandTrackingStatus,
} from "@/lib/gesture/hand-tracking-controller";
import {
  createGestureSketchCommand,
  createInitialSpatialGestureState,
  reduceSpatialGesture,
  type SpatialGestureEffect,
} from "@/lib/gesture/spatial-gesture";
import type { CanvasSketchTransformer } from "@/lib/vision/canvas-transform";

export interface CommandCanvasRoomProps {
  store: StoreApi<CanvasStoreState>;
  serviceStatus?: CommandCanvasServiceStatus;
  roomLabel?: string;
  roomStatus?: CommandCanvasRoomStatus;
  participants?: readonly CommandCanvasParticipant[];
  remoteCursors?: readonly CommandCanvasRemoteCursor[];
  onCommand?: CommandCanvasCommandHandler;
  onTransformSketch?: CommandCanvasSketchTransformHandler;
  onCanvasPointerWorldMove?: (point: CanvasPoint) => void;
  createHandTrackingController?: () => HandTrackingController;
  meetingPacketPanel?: ReactNode;
}

export type CommandCanvasRoomStatus =
  | "local"
  | "connecting"
  | "live"
  | "offline";

export interface CommandCanvasParticipant {
  id: string;
  displayName: string;
  color?: string;
  role?: "host" | "participant" | "agent";
}

export interface CommandCanvasRemoteCursor extends CanvasPoint {
  participantId: string;
  displayName: string;
  color: string;
}

export type CommandCanvasCommandHandler = (
  command: CanvasCommand,
  source: CanvasCommandSource,
) => void | CommandResult | Promise<void | CommandResult>;

export type CommandCanvasSketchTransformHandler =
  CanvasSketchTransformer["transform"];

const UI_SKETCH_TRANSFORM_SOURCE: CanvasCommandSource = "typed";
const UI_SKETCH_TRANSFORM_INSTRUCTION =
  "Make this sketch usable as a clean architecture diagram.";

type ServiceTone = "idle" | "working" | "ready";

export interface CommandCanvasServiceStatus {
  webMcp?: { value: string; tone: ServiceTone };
  collaboration?: { value: string; tone: ServiceTone };
  spatialInput?: { value: string; tone: ServiceTone };
}

export function CommandCanvasRoom({
  store,
  serviceStatus,
  roomLabel = "Local room",
  roomStatus = "local",
  participants = [],
  remoteCursors = [],
  onCommand,
  onTransformSketch,
  onCanvasPointerWorldMove,
  createHandTrackingController,
  meetingPacketPanel,
}: CommandCanvasRoomProps) {
  const [objectPreviews, setObjectPreviews] = useState<
    Record<string, ObjectTransformPreview>
  >({});
  const [drag, setDrag] = useState<ObjectDragState | null>(null);
  const [resize, setResize] = useState<ObjectResizeState | null>(null);
  const [pan, setPan] = useState<CanvasPanState | null>(null);
  const [sketchComposerOpen, setSketchComposerOpen] = useState(false);
  const [gestureStrokePreview, setGestureStrokePreview] = useState<
    readonly CanvasPoint[]
  >([]);
  const [handTrackingStatus, setHandTrackingStatus] =
    useState<HandTrackingStatus>({ state: "off" });
  const [commandExecution, setCommandExecution] =
    useState<CommandExecutionState>({ status: "idle" });
  const [sketchTransformExecution, setSketchTransformExecution] =
    useState<SketchTransformExecutionState>({ status: "idle" });
  const canvasViewportRef = useRef<HTMLDivElement>(null);
  const spatialGestureState = useRef(createInitialSpatialGestureState());
  const gesturePreviewObjectId = useRef<string | null>(null);
  const canvas = useStore(store, (state) => state.canvas);
  const selectedObjectId = useStore(store, (state) => state.selectedObjectId);
  const viewport = useStore(store, (state) => state.viewport);
  const lastError = useStore(store, (state) => state.lastError);
  const dispatch = useStore(store, (state) => state.dispatch);
  const selectObject = useStore(store, (state) => state.selectObject);
  const setViewport = useStore(store, (state) => state.setViewport);
  const objects = Object.values(canvas.objects).filter(
    (object) => !object.deletedAt,
  );
  const selectedObject = selectedObjectId
    ? canvas.objects[selectedObjectId]
    : undefined;
  const commandPending = commandExecution.status === "pending";
  const sketchTransformPending = sketchTransformExecution.status === "pending";
  const interactionPending = commandPending || sketchTransformPending;
  const spatialServiceState = serviceStateForHandTracking(
    handTrackingStatus,
    serviceStatus?.spatialInput,
  );

  function runCommand(
    command: CanvasCommand,
    source: CanvasCommandSource,
    onApplied?: () => void,
  ) {
    if (!onCommand) {
      const result = dispatch(command, source);
      if (result.ok) onApplied?.();
      return;
    }
    if (interactionPending) return;

    setCommandExecution({ status: "pending" });
    let execution: void | CommandResult | Promise<void | CommandResult>;
    try {
      execution = onCommand(command, source);
    } catch (error) {
      setCommandExecution(commandRefusal(error));
      return;
    }

    if (!isPromiseLike(execution)) {
      finishRemoteCommand(execution, onApplied);
      return;
    }

    void Promise.resolve(execution).then(
      (result) => finishRemoteCommand(result, onApplied),
      (error) => {
        setCommandExecution(commandRefusal(error));
      },
    );
  }

  async function transformSelectedSketch() {
    if (
      !onTransformSketch ||
      interactionPending ||
      !selectedObject ||
      selectedObject.deletedAt ||
      selectedObject.type !== "sketch"
    )
      return;

    setSketchTransformExecution({ status: "pending" });
    try {
      const result = await onTransformSketch({
        sketchObjectId: selectedObject.id,
        instruction: UI_SKETCH_TRANSFORM_INSTRUCTION,
        outputKind: "architecture",
        source: UI_SKETCH_TRANSFORM_SOURCE,
      });
      if (!result.ok) {
        setSketchTransformExecution({
          status: "refused",
          message: result.message,
          sourceSketchId: selectedObject.id,
        });
        return;
      }
      setSketchTransformExecution({ status: "idle" });
      if (result.diagramObjectId) {
        selectObject(result.diagramObjectId);
        revealSketchTransformation(
          selectedObject.id,
          result.diagramObjectId,
        );
      }
    } catch (error) {
      setSketchTransformExecution({
        status: "refused",
        sourceSketchId: selectedObject.id,
        message:
          error instanceof Error && error.message.trim()
            ? error.message
            : "Sketch interpretation is temporarily unavailable.",
      });
    }
  }

  function loadPreparedDemoInterpretation() {
    if (
      interactionPending ||
      sketchTransformExecution.status !== "refused" ||
      !selectedObject ||
      selectedObject.deletedAt ||
      selectedObject.type !== "sketch" ||
      selectedObject.id !== sketchTransformExecution.sourceSketchId
    )
      return;

    const sourceSketchId = selectedObject.id;
    const diagramId = createClientId("diagram");
    const highestZ = objects.reduce(
      (maximum, object) => Math.max(maximum, object.zIndex),
      0,
    );
    const clientNodeId = `${diagramId}-client`;
    const serviceNodeId = `${diagramId}-service`;
    const databaseNodeId = `${diagramId}-database`;

    runCommand(
      {
        type: "object.create",
        object: {
          id: diagramId,
          type: "diagram",
          title: "Prepared demo fallback",
          x: selectedObject.x + selectedObject.width + 64,
          y: selectedObject.y,
          width: 620,
          height: 360,
          zIndex: highestZ + 1,
          payload: {
            kind: "architecture",
            sourceSketchId,
            interpretationSummary:
              "Prepared demo fallback: not generated by the vision model.",
            nodes: [
              {
                id: clientNodeId,
                label: "Browser",
                kind: "client",
                x: 32,
                y: 126,
                width: 140,
                height: 72,
              },
              {
                id: serviceNodeId,
                label: "CommandCanvas",
                kind: "service",
                x: 240,
                y: 126,
                width: 156,
                height: 72,
              },
              {
                id: databaseNodeId,
                label: "Shared room",
                kind: "database",
                x: 464,
                y: 126,
                width: 140,
                height: 72,
              },
            ],
            edges: [
              {
                id: `${diagramId}-client-service`,
                from: clientNodeId,
                to: serviceNodeId,
                label: "semantic command",
              },
              {
                id: `${diagramId}-service-database`,
                from: serviceNodeId,
                to: databaseNodeId,
                label: "validated mutation",
              },
            ],
          },
        },
      },
      UI_SKETCH_TRANSFORM_SOURCE,
      () => {
        setSketchTransformExecution({ status: "idle" });
        selectObject(diagramId);
        revealSketchTransformation(sourceSketchId, diagramId);
      },
    );
  }

  function revealSketchTransformation(
    sourceSketchId: string,
    diagramObjectId: string,
  ) {
    const state = store.getState();
    const source = state.canvas.objects[sourceSketchId];
    const diagram = state.canvas.objects[diagramObjectId];
    const canvasViewport = canvasViewportRef.current;
    if (
      !canvasViewport ||
      !source ||
      source.deletedAt ||
      source.type !== "sketch" ||
      !diagram ||
      diagram.deletedAt ||
      diagram.type !== "diagram" ||
      diagram.payload.sourceSketchId !== source.id
    )
      return;

    const measured = canvasViewport.getBoundingClientRect();
    const revealPadding = Math.min(48, measured.width * 0.08);
    const fitted = fitViewportToWorldBounds(
      state.viewport,
      [
        {
          x: source.x,
          y: source.y,
          width: source.width,
          height: source.height,
        },
        {
          x: diagram.x,
          y: diagram.y,
          width: diagram.width,
          height: diagram.height,
        },
      ],
      { x: 0, y: 0, width: measured.width, height: measured.height },
      revealPadding,
      0.24,
    );
    if (fitted) setViewport(fitted);
  }

  function finishRemoteCommand(
    result: void | CommandResult,
    onApplied?: () => void,
  ) {
    if (result && !result.ok) {
      setCommandExecution({
        status: "refused",
        message: result.error.message,
      });
      return;
    }
    if (result?.ok) store.getState().hydrateCanvas(result.state);
    setCommandExecution({ status: "idle" });
    onApplied?.();
  }

  function createNote() {
    runCommand(
      {
        type: "object.create",
        object: {
          id: createClientId("note"),
          type: "note",
          title: "New thought",
          x: (160 - viewport.x) / viewport.scale,
          y: (130 - viewport.y) / viewport.scale,
          width: 280,
          height: 190,
          zIndex: canvas.revision + 1,
          payload: {
            text: "Capture the decision while everyone can still see the context.",
            tone: "coral",
          },
        },
      },
      "pointer",
    );
  }

  function createTaskBoard() {
    runCommand(
      {
        type: "object.create",
        object: {
          id: createClientId("board"),
          type: "task_board",
          title: "Launch board",
          x: (140 - viewport.x) / viewport.scale,
          y: (110 - viewport.y) / viewport.scale,
          width: 560,
          height: 320,
          zIndex: canvas.revision + 1,
          payload: {
            columns: [
              {
                id: createClientId("column"),
                title: "Next",
                tasks: [
                  {
                    id: createClientId("task"),
                    title: "Confirm launch date",
                    owner: "Danny",
                    priority: "high",
                  },
                ],
              },
              {
                id: createClientId("column"),
                title: "In progress",
                tasks: [
                  {
                    id: createClientId("task"),
                    title: "Polish the demo path",
                    owner: "Sarah",
                    priority: "medium",
                  },
                ],
              },
              {
                id: createClientId("column"),
                title: "Done",
                tasks: [],
              },
            ],
          },
        },
      },
      "pointer",
    );
  }

  function createSchedule() {
    runCommand(
      {
        type: "object.create",
        object: {
          id: createClientId("schedule"),
          type: "schedule",
          title: "Next week",
          x: (180 - viewport.x) / viewport.scale,
          y: (140 - viewport.y) / viewport.scale,
          width: 460,
          height: 310,
          zIndex: canvas.revision + 1,
          payload: {
            timezone: "America/New_York",
            days: [
              {
                date: "2026-08-31",
                label: "Mon, Aug 31",
                entries: [
                  {
                    id: createClientId("schedule-entry"),
                    time: "09:30",
                    title: "Review WebMCP flow",
                    owner: "Danny",
                  },
                ],
              },
              {
                date: "2026-09-01",
                label: "Tue, Sep 1",
                entries: [
                  {
                    id: createClientId("schedule-entry"),
                    time: "14:00",
                    title: "Record final demo",
                    owner: "Team",
                  },
                ],
              },
            ],
          },
        },
      },
      "pointer",
    );
  }

  function createSketch(
    payload: SketchPayload,
    source: "pointer" | "touch" | "stylus",
  ) {
    const highestZ = objects.reduce(
      (maximum, object) => Math.max(maximum, object.zIndex),
      0,
    );
    runCommand(
      {
        type: "object.create",
        object: {
          id: createClientId("sketch"),
          type: "sketch",
          title: "Rough architecture",
          x: (180 - viewport.x) / viewport.scale,
          y: (130 - viewport.y) / viewport.scale,
          width: 440,
          height: 280,
          zIndex: highestZ + 1,
          payload,
        },
      },
      source,
      () => setSketchComposerOpen(false),
    );
  }

  function startObjectDrag(
    event: ReactPointerEvent<HTMLButtonElement>,
    object: CanvasObject,
  ) {
    event.stopPropagation();
    selectObject(object.id);
    if (object.pinned || interactionPending) return;

    event.preventDefault();
    if (typeof event.currentTarget.setPointerCapture === "function")
      event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({
      pointerId: event.pointerId,
      objectId: object.id,
      startClientX: event.clientX,
      startClientY: event.clientY,
      initialX: object.x,
      initialY: object.y,
    });
  }

  function updateObjectDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const preview = objectDragTransform(drag, event.clientX, event.clientY, viewport.scale);
    setObjectPreviews((current) => ({
      ...current,
      [drag.objectId]: preview,
    }));
  }

  function finishObjectDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const transform = objectDragTransform(
      drag,
      event.clientX,
      event.clientY,
      viewport.scale,
    );
    if (
      typeof event.currentTarget.hasPointerCapture === "function" &&
      event.currentTarget.hasPointerCapture(event.pointerId)
    )
      event.currentTarget.releasePointerCapture(event.pointerId);
    setObjectPreviews((current) => {
      const next = { ...current };
      delete next[drag.objectId];
      return next;
    });
    setDrag(null);

    if (transform.x === drag.initialX && transform.y === drag.initialY) return;
    runCommand(
      {
        type: "object.transform",
        objectId: drag.objectId,
        transform,
      },
      "pointer",
    );
  }

  function cancelObjectDrag(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!drag || drag.pointerId !== event.pointerId) return;
    setObjectPreviews((current) => {
      const next = { ...current };
      delete next[drag.objectId];
      return next;
    });
    setDrag(null);
  }

  function startObjectResize(
    event: ReactPointerEvent<HTMLButtonElement>,
    object: CanvasObject,
  ) {
    event.preventDefault();
    event.stopPropagation();
    if (interactionPending) return;
    if (typeof event.currentTarget.setPointerCapture === "function")
      event.currentTarget.setPointerCapture(event.pointerId);
    setResize({
      pointerId: event.pointerId,
      objectId: object.id,
      startClientX: event.clientX,
      startClientY: event.clientY,
      initialWidth: object.width,
      initialHeight: object.height,
    });
  }

  function updateObjectResize(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!resize || resize.pointerId !== event.pointerId) return;
    const preview = objectResizeTransform(
      resize,
      event.clientX,
      event.clientY,
      viewport.scale,
    );
    setObjectPreviews((current) => ({
      ...current,
      [resize.objectId]: preview,
    }));
  }

  function finishObjectResize(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!resize || resize.pointerId !== event.pointerId) return;
    const transform = objectResizeTransform(
      resize,
      event.clientX,
      event.clientY,
      viewport.scale,
    );
    if (
      typeof event.currentTarget.hasPointerCapture === "function" &&
      event.currentTarget.hasPointerCapture(event.pointerId)
    )
      event.currentTarget.releasePointerCapture(event.pointerId);
    clearObjectPreview(resize.objectId);
    setResize(null);

    if (
      transform.width === resize.initialWidth &&
      transform.height === resize.initialHeight
    )
      return;
    runCommand(
      {
        type: "object.transform",
        objectId: resize.objectId,
        transform,
      },
      "pointer",
    );
  }

  function cancelObjectResize(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!resize || resize.pointerId !== event.pointerId) return;
    clearObjectPreview(resize.objectId);
    setResize(null);
  }

  function clearObjectPreview(objectId: string) {
    setObjectPreviews((current) => {
      const next = { ...current };
      delete next[objectId];
      return next;
    });
  }

  function handleHandObservation(observation: HandTrackingObservation) {
    const canvasViewport = canvasViewportRef.current;
    if (!canvasViewport || interactionPending) return;
    const bounds = canvasViewport.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    const current = store.getState();
    const sceneObjects = Object.values(current.canvas.objects).flatMap(
      (object) =>
        object.deletedAt
          ? []
          : [
              {
                id: object.id,
                x: object.x,
                y: object.y,
                width: object.width,
                height: object.height,
                zIndex: object.zIndex,
                pinned: object.pinned,
                minimized: object.minimized,
              },
            ],
    );
    const transition = reduceSpatialGesture(
      spatialGestureState.current,
      observation.mode === "idle"
        ? { mode: "idle" }
        : { mode: observation.mode, pointer: observation.pointer },
      {
        bounds,
        viewport: current.viewport,
        objects: sceneObjects,
      },
    );
    spatialGestureState.current = transition.state;
    for (const effect of transition.effects) applySpatialGestureEffect(effect);
  }

  function applySpatialGestureEffect(effect: SpatialGestureEffect) {
    switch (effect.type) {
      case "stroke.preview":
        setGestureStrokePreview(effect.points);
        return;
      case "stroke.commit": {
        const activeObjects = Object.values(store.getState().canvas.objects).filter(
          (object) => !object.deletedAt,
        );
        const highestZ = activeObjects.reduce(
          (maximum, object) => Math.max(maximum, object.zIndex),
          0,
        );
        runCommand(
          createGestureSketchCommand(effect.points, {
            objectId: createClientId("sketch"),
            strokeId: createClientId("stroke"),
            zIndex: highestZ + 1,
          }),
          "gesture",
        );
        return;
      }
      case "object.select":
        selectObject(effect.objectId);
        return;
      case "object.preview_move":
        gesturePreviewObjectId.current = effect.objectId;
        setObjectPreviews((current) => ({
          ...current,
          [effect.objectId]: { x: effect.x, y: effect.y },
        }));
        return;
      case "object.commit_move":
        runCommand(
          {
            type: "object.transform",
            objectId: effect.objectId,
            transform: { x: effect.x, y: effect.y },
          },
          "gesture",
        );
        return;
      case "preview.clear": {
        setGestureStrokePreview([]);
        const objectId = gesturePreviewObjectId.current;
        gesturePreviewObjectId.current = null;
        if (objectId) clearObjectPreview(objectId);
      }
    }
  }

  function startCanvasPan(event: ReactPointerEvent<HTMLDivElement>) {
    if (interactionPending) return;
    if ((event.target as HTMLElement).closest(".canvas-object")) return;
    event.preventDefault();
    selectObject(null);
    if (typeof event.currentTarget.setPointerCapture === "function")
      event.currentTarget.setPointerCapture(event.pointerId);
    setPan({
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      initialX: viewport.x,
      initialY: viewport.y,
    });
  }

  function updateCanvasPan(event: ReactPointerEvent<HTMLDivElement>) {
    if (onCanvasPointerWorldMove) {
      const bounds = event.currentTarget.getBoundingClientRect();
      onCanvasPointerWorldMove(
        screenToWorld(
          { x: event.clientX, y: event.clientY },
          viewport,
          { left: bounds.left, top: bounds.top },
        ),
      );
    }
    if (!pan || pan.pointerId !== event.pointerId) return;
    setViewport({
      ...viewport,
      x: pan.initialX + event.clientX - pan.startClientX,
      y: pan.initialY + event.clientY - pan.startClientY,
    });
  }

  function finishCanvasPan(event: ReactPointerEvent<HTMLDivElement>) {
    if (!pan || pan.pointerId !== event.pointerId) return;
    if (
      typeof event.currentTarget.hasPointerCapture === "function" &&
      event.currentTarget.hasPointerCapture(event.pointerId)
    )
      event.currentTarget.releasePointerCapture(event.pointerId);
    setPan(null);
  }

  return (
    <main className="command-canvas-shell" aria-busy={interactionPending}>
      <header className="room-header">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            CC
          </span>
          <div>
            <p className="eyebrow">
              CommandCanvas / {roomStatus === "local" ? "local checkpoint" : "shared room"}
            </p>
            <h1>Spatial command surface</h1>
          </div>
        </div>
        <div className="room-badges" aria-label="Room status">
          <span
            className={`status-dot status-dot-${roomStatus}`}
            aria-hidden="true"
          />
          <strong>{roomLabel}</strong>
          <span>r{canvas.revision}</span>
          {participants.length > 0 ? (
            <div
              className="presence-stack"
              aria-label={`${participants.length} ${participants.length === 1 ? "participant" : "participants"} present`}
            >
              {participants.map((participant) => (
                <span
                  key={participant.id}
                  className="presence-token"
                  title={`${participant.displayName} · ${participant.role ?? "participant"}`}
                  style={{
                    background: participant.color ?? "#74859a",
                    color: "#081016",
                  }}
                >
                  {initials(participant.displayName)}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </header>

      <section className="workspace-grid" aria-label="CommandCanvas workspace">
        <aside className="tool-dock" aria-label="Object tools">
          <button
            type="button"
            onClick={createNote}
            aria-label="Create note"
            disabled={interactionPending}
          >
            <span aria-hidden="true">＋</span>
            <small>Note</small>
          </button>
          <button
            type="button"
            onClick={createTaskBoard}
            aria-label="Create task board"
            disabled={interactionPending}
          >
            <span aria-hidden="true">▦</span>
            <small>Board</small>
          </button>
          <button
            type="button"
            onClick={createSchedule}
            aria-label="Create schedule"
            disabled={interactionPending}
          >
            <span aria-hidden="true">31</span>
            <small>Schedule</small>
          </button>
          <button
            type="button"
            onClick={() => setSketchComposerOpen(true)}
            aria-label="Create sketch"
            disabled={interactionPending}
          >
            <span aria-hidden="true">⌁</span>
            <small>Sketch</small>
          </button>
          <button
            type="button"
            aria-label="Undo last change"
            disabled={interactionPending || canvas.receipts.length === 0}
            onClick={() => runCommand({ type: "history.undo" }, "typed")}
          >
            <span aria-hidden="true">↶</span>
            <small>Undo</small>
          </button>
        </aside>

        <section className="canvas-panel" aria-label="Infinite canvas">
          <div className="canvas-status-strip">
            <span>Objects {objects.length}</span>
            <span>Zoom {Math.round(viewport.scale * 100)}%</span>
            <span>Revision {canvas.revision}</span>
          </div>
          <div
            ref={canvasViewportRef}
            className={`canvas-viewport${pan ? " is-panning" : ""}`}
            style={{
              backgroundPosition: `${viewport.x}px ${viewport.y}px, ${viewport.x}px ${viewport.y}px, ${viewport.x}px ${viewport.y}px`,
              backgroundSize: `${80 * viewport.scale}px ${80 * viewport.scale}px, ${80 * viewport.scale}px ${80 * viewport.scale}px, ${16 * viewport.scale}px ${16 * viewport.scale}px`,
            }}
            onPointerDown={startCanvasPan}
            onPointerMove={updateCanvasPan}
            onPointerUp={finishCanvasPan}
            onPointerCancel={finishCanvasPan}
            onWheel={(event) => {
              event.preventDefault();
              const bounds = event.currentTarget.getBoundingClientRect();
              const point = {
                x: event.clientX - bounds.left,
                y: event.clientY - bounds.top,
              };
              const scale = viewport.scale * Math.exp(-event.deltaY * 0.0012);
              setViewport(zoomViewportAt(viewport, point, scale));
            }}
          >
            <div
              className="canvas-world"
              style={{
                transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`,
              }}
            >
              {gestureStrokePreview.length > 0 ? (
                <svg
                  className="gesture-stroke-preview"
                  aria-hidden="true"
                  viewBox="0 0 1 1"
                >
                  <polyline
                    points={gestureStrokePreview
                      .map((point) => `${point.x},${point.y}`)
                      .join(" ")}
                  />
                </svg>
              ) : null}
              {objects.map((object) => (
                <CanvasObjectCard
                  key={object.id}
                  object={object}
                  preview={objectPreviews[object.id]}
                  isSelected={selectedObjectId === object.id}
                  onSelect={() => selectObject(object.id)}
                  onPointerDown={(event) => startObjectDrag(event, object)}
                  onPointerMove={updateObjectDrag}
                  onPointerUp={finishObjectDrag}
                  onPointerCancel={cancelObjectDrag}
                  onResizePointerDown={(event) =>
                    startObjectResize(event, object)
                  }
                  onResizePointerMove={updateObjectResize}
                  onResizePointerUp={finishObjectResize}
                  onResizePointerCancel={cancelObjectResize}
                  commandsDisabled={interactionPending}
                />
              ))}
            </div>
            {remoteCursors.map((cursor) => {
              const screenPoint = worldToScreen(cursor, viewport);
              return (
                <div
                  key={cursor.participantId}
                  className="remote-cursor"
                  data-remote-cursor={cursor.participantId}
                  aria-hidden="true"
                  style={{
                    position: "absolute",
                    left: screenPoint.x,
                    top: screenPoint.y,
                    zIndex: 100_000,
                    pointerEvents: "none",
                    color: cursor.color,
                    transform: "translate(-3px, -3px)",
                  }}
                >
                  <span
                    style={{
                      display: "block",
                      width: 0,
                      height: 0,
                      borderTop: "13px solid currentColor",
                      borderRight: "8px solid transparent",
                    }}
                  />
                  <span
                    style={{
                      display: "inline-block",
                      marginLeft: 10,
                      padding: "2px 7px",
                      borderRadius: 999,
                      background: cursor.color,
                      color: "#081016",
                      fontSize: 11,
                      fontWeight: 700,
                      whiteSpace: "nowrap",
                    }}
                  >
                    {cursor.displayName}
                  </span>
                </div>
              );
            })}
            {objects.length === 0 ? (
              <div className="canvas-empty-state">
                <span className="empty-crosshair" aria-hidden="true" />
                <p>No objects yet</p>
                <span>Create an object to start the shared command history.</span>
              </div>
            ) : null}
          </div>

          {selectedObject && !selectedObject.deletedAt ? (
            <div className="selection-toolbar" aria-label="Selected object actions">
              <span className="selection-name">{selectedObject.title}</span>
              {selectedObject.type === "sketch" && onTransformSketch ? (
                <>
                  <button
                    type="button"
                    aria-label={
                      sketchTransformPending
                        ? "Interpreting sketch…"
                        : "Make usable"
                    }
                    disabled={interactionPending}
                    onClick={transformSelectedSketch}
                  >
                    {sketchTransformPending
                      ? "Interpreting sketch…"
                      : "Make usable"}
                  </button>
                  {sketchTransformExecution.status === "refused" &&
                  sketchTransformExecution.sourceSketchId === selectedObject.id ? (
                    <button
                      type="button"
                      aria-label="Load prepared demo interpretation"
                      disabled={interactionPending}
                      onClick={loadPreparedDemoInterpretation}
                    >
                      Load prepared demo interpretation
                    </button>
                  ) : null}
                </>
              ) : null}
              <button
                type="button"
                aria-label={selectedObject.pinned ? "Unpin object" : "Pin object"}
                disabled={interactionPending}
                onClick={() =>
                  runCommand(
                    {
                      type: "object.set_flags",
                      objectId: selectedObject.id,
                      flags: { pinned: !selectedObject.pinned },
                    },
                    "pointer",
                  )
                }
              >
                {selectedObject.pinned ? "Unpin" : "Pin"}
              </button>
              <button
                type="button"
                aria-label={
                  selectedObject.minimized ? "Restore object" : "Minimize object"
                }
                disabled={interactionPending}
                onClick={() =>
                  runCommand(
                    {
                      type: "object.set_flags",
                      objectId: selectedObject.id,
                      flags: { minimized: !selectedObject.minimized },
                    },
                    "pointer",
                  )
                }
              >
                {selectedObject.minimized ? "Restore" : "Minimize"}
              </button>
              <button
                type="button"
                className="danger-action"
                aria-label="Move object to trash"
                disabled={interactionPending}
                onClick={() =>
                  runCommand(
                    { type: "object.discard", objectId: selectedObject.id },
                    "pointer",
                  )
                }
              >
                Trash
              </button>
            </div>
          ) : null}
        </section>

        <aside className="command-rail" aria-label="Command and activity rail">
          <div className="rail-heading">
            <div>
              <p className="eyebrow">Shared provenance</p>
              <h2>Command rail</h2>
            </div>
            <span className="live-pill">{roomStatus.toUpperCase()}</span>
          </div>

          <section className="service-stack" aria-label="Service status">
            <ServiceState
              label="WebMCP"
              value={serviceStatus?.webMcp?.value ?? "WebMCP not exercised"}
              tone={serviceStatus?.webMcp?.tone ?? "idle"}
            />
            <ServiceState
              label="Collaboration"
              value={
                serviceStatus?.collaboration?.value ?? "Realtime not connected"
              }
              tone={serviceStatus?.collaboration?.tone ?? "idle"}
            />
            <ServiceState
              label="Spatial input"
              value={spatialServiceState.value}
              tone={spatialServiceState.tone}
            />
          </section>

          <SpatialCameraControl
            createController={createHandTrackingController}
            onObservation={handleHandObservation}
            onStatusChange={setHandTrackingStatus}
          />

          {meetingPacketPanel}

          {commandExecution.status === "pending" ? (
            <div className="command-error" role="status" aria-live="polite">
              <strong>Applying command…</strong>
              <span>Waiting for the shared canvas to confirm the change.</span>
            </div>
          ) : null}

          {commandExecution.status === "refused" ? (
            <div className="command-error" role="status" aria-live="polite">
              <strong>Command refused</strong>
              <span>{commandExecution.message}</span>
            </div>
          ) : null}

          {sketchTransformExecution.status === "refused" ? (
            <div className="command-error" role="status" aria-live="polite">
              <strong>Sketch interpretation failed</strong>
              <span>{sketchTransformExecution.message}</span>
            </div>
          ) : null}

          {lastError ? (
            <div className="command-error" role="status">
              <strong>{lastError.code}</strong>
              <span>{lastError.message}</span>
            </div>
          ) : null}

          <section className="activity-section" aria-labelledby="activity-heading">
            <div className="activity-header">
              <h3 id="activity-heading">Activity</h3>
              <span>{canvas.receipts.length}</span>
            </div>
            {canvas.receipts.length === 0 ? (
              <p className="activity-empty">
                Human, collaborator, and agent actions will resolve to the same
                receipt stream.
              </p>
            ) : (
              <ol className="receipt-list">
                {[...canvas.receipts].reverse().map((receipt) => (
                  <li key={receipt.id}>
                    <span className={`actor-token actor-${receipt.actor.type}`}>
                      {receipt.actor.type === "agent"
                        ? "AI"
                        : initials(receipt.actor.displayName)}
                    </span>
                    <div>
                      <p>{receipt.description}</p>
                      <span>
                        R{receipt.revision} · {receipt.source}
                      </span>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </aside>
      </section>

      {sketchComposerOpen ? (
        <div className="sketch-dialog-backdrop">
          <section
            className="sketch-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sketch-dialog-title"
          >
            <div className="sketch-dialog-heading">
              <div>
                <p className="eyebrow">Original artifact preserved</p>
                <h2 id="sketch-dialog-title">Draw a rough sketch</h2>
              </div>
              <span>Mouse · touch · stylus · finger</span>
            </div>
            <SketchComposer
              width={440}
              height={280}
              onDone={createSketch}
              onCancel={() => {
                if (!interactionPending) setSketchComposerOpen(false);
              }}
            />
          </section>
        </div>
      ) : null}
    </main>
  );
}

interface CanvasObjectCardProps {
  object: CanvasObject;
  preview?: ObjectTransformPreview;
  isSelected: boolean;
  onSelect: () => void;
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onResizePointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onResizePointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onResizePointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onResizePointerCancel: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  commandsDisabled: boolean;
}

function CanvasObjectCard({
  object,
  preview,
  isSelected,
  onSelect,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onResizePointerDown,
  onResizePointerMove,
  onResizePointerUp,
  onResizePointerCancel,
  commandsDisabled,
}: CanvasObjectCardProps) {
  const typeClass = objectTypeClass(object);

  return (
    <article
      className={`canvas-object ${typeClass}${isSelected ? " is-selected" : ""}${object.minimized ? " is-minimized" : ""}`}
      style={{
        left: preview?.x ?? object.x,
        top: preview?.y ?? object.y,
        width: preview?.width ?? object.width,
        height: object.minimized ? 62 : (preview?.height ?? object.height),
        zIndex: object.zIndex,
      }}
    >
      <button
        type="button"
        className="object-select-hitbox"
        aria-label={`Select ${object.title}`}
        disabled={commandsDisabled}
        onClick={onSelect}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
      >
        <span className="object-kicker">
          {objectTypeLabel(object)} · V{object.version}
          {object.pinned ? " · PINNED" : ""}
        </span>
        <strong>{object.title}</strong>
        {!object.minimized ? <CanvasObjectContent object={object} /> : null}
      </button>
      {isSelected && !object.minimized && !object.pinned ? (
        <button
          type="button"
          className="resize-handle"
          aria-label={`Resize ${object.title}`}
          disabled={commandsDisabled}
          onPointerDown={onResizePointerDown}
          onPointerMove={onResizePointerMove}
          onPointerUp={onResizePointerUp}
          onPointerCancel={onResizePointerCancel}
        />
      ) : null}
      {object.pinned ? <span className="pin-state">Pinned to canvas</span> : null}
    </article>
  );
}

function CanvasObjectContent({ object }: { object: CanvasObject }) {
  switch (object.type) {
    case "note":
      return <p>{object.payload.text}</p>;
    case "task_board":
      return (
        <div className="task-board-preview">
          {object.payload.columns.map((column) => (
            <span key={column.id} className="task-column-preview">
              <span className="task-column-title">
                {column.title}
                <small>{column.tasks.length}</small>
              </span>
              {column.tasks.length === 0 ? (
                <span className="task-column-empty">Clear</span>
              ) : (
                column.tasks.map((task) => (
                  <span key={task.id} className="task-card-preview">
                    <b>{task.title}</b>
                    {task.owner ? <small>{task.owner}</small> : null}
                  </span>
                ))
              )}
            </span>
          ))}
        </div>
      );
    case "schedule":
      return (
        <div className="schedule-preview">
          <span className="schedule-timezone">{object.payload.timezone}</span>
          {object.payload.days.map((day) => (
            <span key={day.date} className="schedule-day-preview">
              <span className="schedule-day-label">{day.label}</span>
              {day.entries.map((entry) => (
                <span key={entry.id} className="schedule-entry-preview">
                  <time dateTime={`${day.date}T${entry.time}`}>{entry.time}</time>
                  <b>{entry.title}</b>
                  {entry.owner ? <small>{entry.owner}</small> : null}
                </span>
              ))}
            </span>
          ))}
        </div>
      );
    case "sketch":
      return (
        <div className="sketch-preview">
          <SketchPreview
            title={object.title}
            width={object.width}
            height={object.height}
            payload={object.payload}
          />
          <small>Original source · {object.payload.strokes.length} strokes</small>
        </div>
      );
    case "diagram":
      return (
        <div className="diagram-preview">
          <DiagramPreview payload={object.payload} />
        </div>
      );
  }
}

function objectTypeClass(object: CanvasObject) {
  switch (object.type) {
    case "note":
      return `note-object tone-${object.payload.tone}`;
    case "task_board":
      return "task-board-object";
    case "schedule":
      return "schedule-object";
    case "sketch":
      return "sketch-object";
    case "diagram":
      return "diagram-object";
  }
}

function objectTypeLabel(object: CanvasObject) {
  switch (object.type) {
    case "note":
      return "NOTE";
    case "task_board":
      return "PROJECT BOARD";
    case "schedule":
      return "SCHEDULE";
    case "sketch":
      return "ROUGH SKETCH";
    case "diagram":
      return object.payload.kind === "architecture"
        ? "ARCHITECTURE DIAGRAM"
        : "FLOWCHART";
  }
}

interface ObjectTransformPreview {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

type CommandExecutionState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "refused"; message: string };

type SketchTransformExecutionState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "refused"; message: string; sourceSketchId: string };

function isPromiseLike(
  value: void | CommandResult | Promise<void | CommandResult>,
): value is Promise<void | CommandResult> {
  return Boolean(
    value &&
      typeof value === "object" &&
      "then" in value &&
      typeof value.then === "function",
  );
}

function commandRefusal(error: unknown): CommandExecutionState {
  return {
    status: "refused",
    message:
      error instanceof Error && error.message.trim()
        ? error.message
        : "The shared canvas did not apply this command.",
  };
}

interface ObjectResizeState {
  pointerId: number;
  objectId: string;
  startClientX: number;
  startClientY: number;
  initialWidth: number;
  initialHeight: number;
}

interface CanvasPanState {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  initialX: number;
  initialY: number;
}

interface ObjectDragState {
  pointerId: number;
  objectId: string;
  startClientX: number;
  startClientY: number;
  initialX: number;
  initialY: number;
}

function objectDragTransform(
  drag: ObjectDragState,
  clientX: number,
  clientY: number,
  scale: number,
): ObjectTransformPreview {
  return {
    x: drag.initialX + (clientX - drag.startClientX) / scale,
    y: drag.initialY + (clientY - drag.startClientY) / scale,
  };
}

function objectResizeTransform(
  resize: ObjectResizeState,
  clientX: number,
  clientY: number,
  scale: number,
): ObjectTransformPreview & { width: number; height: number } {
  return {
    width: Math.max(
      220,
      resize.initialWidth + (clientX - resize.startClientX) / scale,
    ),
    height: Math.max(
      120,
      resize.initialHeight + (clientY - resize.startClientY) / scale,
    ),
  };
}

interface ServiceStateProps {
  label: string;
  value: string;
  tone: ServiceTone;
}

function ServiceState({ label, value, tone }: ServiceStateProps) {
  return (
    <div className="service-state">
      <span className={`service-orb service-${tone}`} aria-hidden="true" />
      <div>
        <strong>{label}</strong>
        <span>{value}</span>
      </div>
    </div>
  );
}

function createClientId(prefix: string) {
  const suffix = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}`;
  return `${prefix}-${suffix}`;
}

function serviceStateForHandTracking(
  status: HandTrackingStatus,
  fallback: CommandCanvasServiceStatus["spatialInput"],
): { value: string; tone: ServiceTone } {
  switch (status.state) {
    case "off":
      return fallback ?? { value: "Camera off", tone: "idle" };
    case "starting":
      return { value: "Starting camera locally…", tone: "working" };
    case "ready":
      return { value: "Hand input ready · local only", tone: "ready" };
    case "refused":
      return { value: "Camera permission refused · pointer active", tone: "idle" };
    case "unavailable":
      return { value: "Hand input unavailable · pointer active", tone: "idle" };
  }
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}
