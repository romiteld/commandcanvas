"use client";

import { useState, type PointerEvent as ReactPointerEvent } from "react";
import type { StoreApi } from "zustand";
import { useStore } from "zustand";

import type { CanvasStoreState } from "@/lib/canvas/canvas-store";
import type {
  CanvasCommand,
  CanvasCommandSource,
  CanvasObject,
  CommandResult,
} from "@/lib/canvas/command-engine";
import {
  screenToWorld,
  worldToScreen,
  zoomViewportAt,
  type CanvasPoint,
} from "@/lib/canvas/coordinates";

export interface CommandCanvasRoomProps {
  store: StoreApi<CanvasStoreState>;
  serviceStatus?: CommandCanvasServiceStatus;
  roomLabel?: string;
  roomStatus?: CommandCanvasRoomStatus;
  participants?: readonly CommandCanvasParticipant[];
  remoteCursors?: readonly CommandCanvasRemoteCursor[];
  onCommand?: CommandCanvasCommandHandler;
  onCanvasPointerWorldMove?: (point: CanvasPoint) => void;
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
  onCanvasPointerWorldMove,
}: CommandCanvasRoomProps) {
  const [objectPreviews, setObjectPreviews] = useState<
    Record<string, ObjectTransformPreview>
  >({});
  const [drag, setDrag] = useState<ObjectDragState | null>(null);
  const [resize, setResize] = useState<ObjectResizeState | null>(null);
  const [pan, setPan] = useState<CanvasPanState | null>(null);
  const [commandExecution, setCommandExecution] =
    useState<CommandExecutionState>({ status: "idle" });
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

  function runCommand(command: CanvasCommand, source: CanvasCommandSource) {
    if (!onCommand) {
      dispatch(command, source);
      return;
    }
    if (commandPending) return;

    setCommandExecution({ status: "pending" });
    let execution: void | CommandResult | Promise<void | CommandResult>;
    try {
      execution = onCommand(command, source);
    } catch (error) {
      setCommandExecution(commandRefusal(error));
      return;
    }

    if (!isPromiseLike(execution)) {
      finishRemoteCommand(execution);
      return;
    }

    void Promise.resolve(execution).then(finishRemoteCommand, (error) => {
      setCommandExecution(commandRefusal(error));
    });
  }

  function finishRemoteCommand(result: void | CommandResult) {
    if (result && !result.ok) {
      setCommandExecution({
        status: "refused",
        message: result.error.message,
      });
      return;
    }
    if (result?.ok) store.getState().hydrateCanvas(result.state);
    setCommandExecution({ status: "idle" });
  }

  function createNote() {
    runCommand(
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
    runCommand(
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
    runCommand(
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
    if (object.pinned || commandPending) return;

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
    if (commandPending) return;
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
    <main className="command-canvas-shell" aria-busy={commandPending}>
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
            disabled={commandPending}
          >
            <span aria-hidden="true">＋</span>
            <small>Note</small>
          </button>
          <button
            type="button"
            onClick={createTaskBoard}
            aria-label="Create task board"
            disabled={commandPending}
          >
            <span aria-hidden="true">▦</span>
            <small>Board</small>
          </button>
          <button
            type="button"
            onClick={createSchedule}
            aria-label="Create schedule"
            disabled={commandPending}
          >
            <span aria-hidden="true">31</span>
            <small>Schedule</small>
          </button>
          <button
            type="button"
            aria-label="Undo last change"
            disabled={commandPending || canvas.receipts.length === 0}
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
                  commandsDisabled={commandPending}
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
              <button
                type="button"
                aria-label={selectedObject.pinned ? "Unpin object" : "Pin object"}
                disabled={commandPending}
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
                disabled={commandPending}
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
                disabled={commandPending}
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
              value={serviceStatus?.spatialInput?.value ?? "Camera off"}
              tone={serviceStatus?.spatialInput?.tone ?? "idle"}
            />
          </section>

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

type CommandExecutionState =
  | { status: "idle" }
  | { status: "pending" }
  | { status: "refused"; message: string };

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

function initials(name: string) {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}
