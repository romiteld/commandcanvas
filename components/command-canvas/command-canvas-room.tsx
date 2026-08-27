"use client";

import { useState, type PointerEvent as ReactPointerEvent } from "react";
import type { StoreApi } from "zustand";
import { useStore } from "zustand";

import type { CanvasStoreState } from "@/lib/canvas/canvas-store";
import type { CanvasObject } from "@/lib/canvas/command-engine";
import { zoomViewportAt } from "@/lib/canvas/coordinates";

export interface CommandCanvasRoomProps {
  store: StoreApi<CanvasStoreState>;
  serviceStatus?: CommandCanvasServiceStatus;
}

type ServiceTone = "idle" | "working" | "ready";

export interface CommandCanvasServiceStatus {
  webMcp?: { value: string; tone: ServiceTone };
  collaboration?: { value: string; tone: ServiceTone };
  spatialInput?: { value: string; tone: ServiceTone };
}

export function CommandCanvasRoom({
  store,
  serviceStatus,
}: CommandCanvasRoomProps) {
  const [objectPreviews, setObjectPreviews] = useState<
    Record<string, ObjectTransformPreview>
  >({});
  const [drag, setDrag] = useState<ObjectDragState | null>(null);
  const [resize, setResize] = useState<ObjectResizeState | null>(null);
  const [pan, setPan] = useState<CanvasPanState | null>(null);
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

  function createNote() {
    dispatch(
      {
        type: "object.create",
        object: {
          id: createClientId("note"),
          type: "note",
          title: "New thought",
          x: 160 - viewport.x / viewport.scale,
          y: 130 - viewport.y / viewport.scale,
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
    dispatch(
      {
        type: "object.create",
        object: {
          id: createClientId("board"),
          type: "task_board",
          title: "Launch board",
          x: 140 - viewport.x / viewport.scale,
          y: 110 - viewport.y / viewport.scale,
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
    dispatch(
      {
        type: "object.create",
        object: {
          id: createClientId("schedule"),
          type: "schedule",
          title: "Next week",
          x: 180 - viewport.x / viewport.scale,
          y: 140 - viewport.y / viewport.scale,
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

  function startObjectDrag(
    event: ReactPointerEvent<HTMLButtonElement>,
    object: CanvasObject,
  ) {
    event.stopPropagation();
    selectObject(object.id);
    if (object.pinned) return;

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
    dispatch(
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
    dispatch(
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

  function startCanvasPan(event: ReactPointerEvent<HTMLDivElement>) {
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
    <main className="command-canvas-shell">
      <header className="room-header">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            CC
          </span>
          <div>
            <p className="eyebrow">CommandCanvas / local checkpoint</p>
            <h1>Spatial command surface</h1>
          </div>
        </div>
        <div className="room-badges" aria-label="Room status">
          <span className="status-dot status-dot-local" aria-hidden="true" />
          <strong>Local room</strong>
          <span>r{canvas.revision}</span>
        </div>
      </header>

      <section className="workspace-grid" aria-label="CommandCanvas workspace">
        <aside className="tool-dock" aria-label="Object tools">
          <button type="button" onClick={createNote} aria-label="Create note">
            <span aria-hidden="true">＋</span>
            <small>Note</small>
          </button>
          <button
            type="button"
            onClick={createTaskBoard}
            aria-label="Create task board"
          >
            <span aria-hidden="true">▦</span>
            <small>Board</small>
          </button>
          <button
            type="button"
            onClick={createSchedule}
            aria-label="Create schedule"
          >
            <span aria-hidden="true">31</span>
            <small>Schedule</small>
          </button>
          <button
            type="button"
            aria-label="Undo last change"
            disabled={canvas.receipts.length === 0}
            onClick={() => dispatch({ type: "history.undo" }, "typed")}
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
                />
              ))}
            </div>
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
              <button
                type="button"
                aria-label={selectedObject.pinned ? "Unpin object" : "Pin object"}
                onClick={() =>
                  dispatch(
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
                onClick={() =>
                  dispatch(
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
                onClick={() =>
                  dispatch(
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
            <span className="live-pill">LOCAL</span>
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
              value={serviceStatus?.spatialInput?.value ?? "Camera off"}
              tone={serviceStatus?.spatialInput?.tone ?? "idle"}
            />
          </section>

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
          <span>{object.payload.strokes.length}</span>
          <small>source strokes preserved</small>
        </div>
      );
    case "diagram":
      return (
        <div className="diagram-preview">
          {object.payload.nodes.slice(0, 6).map((node) => (
            <span key={node.id}>{node.label}</span>
          ))}
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

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}
