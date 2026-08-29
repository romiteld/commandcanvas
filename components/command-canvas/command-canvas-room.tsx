"use client";

import {
  useMemo,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import type { StoreApi } from "zustand";
import { useStore } from "zustand";

import { DiagramPreview } from "@/components/command-canvas/diagram-preview";
import {
  ChatGptCommandSurface,
  type WebMcpSurfaceState,
} from "@/components/command-canvas/chatgpt-command-surface";
import { HandInkPreview } from "@/components/command-canvas/hand-ink-preview";
import {
  HumanCommandControl,
  type HumanCommandObjectSnapshot,
  type HumanCommandResult,
  type HumanCommandSource,
} from "@/components/command-canvas/human-command-control";
import {
  RealtimeVoiceControl,
  type RealtimeVoiceControlHandle,
  type RealtimeVoiceControlProps,
} from "@/components/command-canvas/realtime-voice-control";
import { SemanticObjectPreview } from "@/components/command-canvas/semantic-object-preview";
import { SketchComposer } from "@/components/command-canvas/sketch-composer";
import { SketchPreview } from "@/components/command-canvas/sketch-preview";
import {
  SpatialCameraControl,
  type SpatialCameraControllerPreferences,
} from "@/components/command-canvas/spatial-camera-control";
import type { CanvasStoreState } from "@/lib/canvas/canvas-store";
import {
  NOTE_APPEND_TEXT_MAX_LENGTH,
  type SketchPayload,
} from "@/lib/canvas/object-model";
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
import type { DirectCanvasIntent } from "@/lib/canvas/direct-command";
import type {
  HandTrackingController,
  HandTrackingObservation,
  HandTrackingStatus,
} from "@/lib/gesture/hand-tracking-controller";
import {
  createCanvasMotionLayer,
  type CanvasMotionLayer,
} from "@/lib/gesture/canvas-motion-layer";
import type { RealtimeVoiceIntentResult } from "@/lib/realtime-voice/tools";
import {
  createGestureSketchCommand,
  createInitialSpatialGestureState,
  reduceSpatialGesture,
  spatialGestureCompletionToCommand,
  type SpatialGestureEffect,
  type SpatialGestureCompletionEffect,
  type SpatialGestureState,
} from "@/lib/gesture/spatial-gesture";
import {
  createInitialSpatialRoomInputState,
  createInitialStrokeSampleState,
  reduceSpatialRoomObservation,
  sampleTrackedStrokePoint,
  type SpatialRoomInputState,
  type StrokeSampleState,
} from "@/lib/gesture/spatial-room-input";
import type { HandCalibrationProfile } from "@/lib/gesture/hand-calibration";
import type { CanvasSketchTransformer } from "@/lib/vision/canvas-transform";
import { projectCanvasState } from "@/lib/webmcp/canvas-state-projection";
import type { WebMcpExecutionEvent } from "@/lib/webmcp/registry";
import type { JsonValue } from "@/lib/webmcp/tool-catalog";

const configuredSourceRevision =
  process.env.NEXT_PUBLIC_COMMANDCANVAS_SOURCE_REVISION ?? "main";
const sourceRevision = /^[0-9a-f]{40}$/.test(configuredSourceRevision)
  ? configuredSourceRevision
  : "main";
const correspondingSourceUrl =
  `https://github.com/romiteld/commandcanvas/tree/${sourceRevision}`;

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
  createHandTrackingController?: (
    preferences: SpatialCameraControllerPreferences,
  ) => HandTrackingController;
  privateGpuRelayAvailable?: boolean;
  realtimeVoice?: Omit<RealtimeVoiceControlProps, "onIntent">;
  webMcpSurfaceState?: WebMcpSurfaceState;
  webMcpExecutionActivity?: readonly WebMcpExecutionEvent[];
  meetingMediaPanel?: ReactNode;
  commandDrawerRequestKey?: string;
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
  "Make this usable as a professional visual.";
const SELECTED_OBJECT_RENDER_Z_INDEX = 1_000_000;
const POINTER_SKETCH_WIDTH = 720;
const POINTER_SKETCH_HEIGHT = 420;
const COMPACT_POINTER_SKETCH_WIDTH = 420;
const COMPACT_POINTER_SKETCH_HEIGHT = 720;
const FULL_CANVAS_HAND_ZONE = Object.freeze({
  left: 0,
  right: 1,
  top: 0,
  bottom: 1,
});

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
  privateGpuRelayAvailable = false,
  realtimeVoice,
  webMcpSurfaceState = { status: "unavailable" },
  webMcpExecutionActivity = [],
  meetingMediaPanel,
  commandDrawerRequestKey,
  meetingPacketPanel,
}: CommandCanvasRoomProps) {
  const [objectPreviews, setObjectPreviews] = useState<
    Record<string, ObjectTransformPreview>
  >({});
  const [drag, setDrag] = useState<ObjectDragState | null>(null);
  const [resize, setResize] = useState<ObjectResizeState | null>(null);
  const [pan, setPan] = useState<CanvasPanState | null>(null);
  const [sketchComposerOpen, setSketchComposerOpen] = useState(false);
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [gestureSketchStrokes, setGestureSketchStrokes] = useState<
    readonly (readonly CanvasPoint[])[]
  >([]);
  const [handInteractionMode, setHandInteractionMode] =
    useState<HandInteractionMode>("manipulate");
  const [handDrawingTool, setHandDrawingTool] =
    useState<HandDrawingTool>("draw");
  const [handTrackingStatus, setHandTrackingStatus] =
    useState<HandTrackingStatus>({ state: "off" });
  const [handFeedback, setHandFeedback] = useState<HandCanvasFeedback | null>(
    null,
  );
  const [handTargetObjectId, setHandTargetObjectId] = useState<string | null>(
    null,
  );
  const [gestureExitAnimations, setGestureExitAnimations] = useState<
    Record<string, "discard-left" | "discard-right">
  >({});
  const [gestureEdgePreview, setGestureEdgePreview] = useState<
    Extract<SpatialGestureEffect, { type: "object.preview_edge_action" }> | null
  >(null);
  const [palmFinishPreview, setPalmFinishPreview] = useState<number | null>(null);
  const [openDrawer, setOpenDrawer] = useState<WorkspaceDrawer>(null);
  const [handCalibrationOpen, setHandCalibrationOpen] = useState(false);
  const [handCalibrationProfile, setHandCalibrationProfile] =
    useState<HandCalibrationProfile | null>(null);
  const [typedFallbackOpen, setTypedFallbackOpen] = useState(false);
  const [realtimeVoiceActive, setRealtimeVoiceActive] = useState(false);
  const [commandExecution, setCommandExecution] =
    useState<CommandExecutionState>({ status: "idle" });
  const [sketchTransformExecution, setSketchTransformExecution] =
    useState<SketchTransformExecutionState>({ status: "idle" });
  const [pointerSketchDimensions, setPointerSketchDimensions] = useState({
    width: POINTER_SKETCH_WIDTH,
    height: POINTER_SKETCH_HEIGHT,
  });
  const [latestReceiptVisible, setLatestReceiptVisible] = useState(false);
  const canvasViewportRef = useRef<HTMLDivElement>(null);
  const spatialGestureState = useRef(createInitialSpatialGestureState());
  const spatialRoomInputState = useRef<SpatialRoomInputState>(
    createInitialSpatialRoomInputState(),
  );
  const canvasMotionLayerRef = useRef<CanvasMotionLayer | null>(null);
  const gesturePreviewObjectId = useRef<string | null>(null);
  const gestureSketchStrokesRef = useRef<readonly (readonly CanvasPoint[])[]>([]);
  const strokeSampleStateRef = useRef<StrokeSampleState>(
    createInitialStrokeSampleState(),
  );
  const palmFinishStartedAtRef = useRef<number | null>(null);
  const palmFinishPreviewValueRef = useRef<number | null>(null);
  const edgePreviewVisibleRef = useRef(false);
  const handTargetObjectIdRef = useRef<string | null>(null);
  const handEraseLatchedRef = useRef(false);
  const initialCompactCompositionFitRef = useRef(false);
  const seededCompositionAtMountRef = useRef(
    Object.values(store.getState().canvas.objects).filter(
      (object) => !object.deletedAt,
    ).length >= 2,
  );
  const lastToastReceiptIdRef = useRef(
    store.getState().canvas.receipts.at(-1)?.id,
  );
  const activeVoiceThoughtIdRef = useRef<string | null>(null);
  const realtimeVoiceControlRef = useRef<RealtimeVoiceControlHandle>(null);
  const gestureExitTimeoutsRef = useRef(new Map<string, number>());
  const pendingGestureCompletionObjectIdsRef = useRef(new Set<string>());
  const canvas = useStore(store, (state) => state.canvas);
  const selectedObjectId = useStore(store, (state) => state.selectedObjectId);
  const selectedObjectIds = useStore(store, (state) => state.selectedObjectIds);
  const viewport = useStore(store, (state) => state.viewport);
  const lastError = useStore(store, (state) => state.lastError);
  const dispatch = useStore(store, (state) => state.dispatch);
  const selectObject = useStore(store, (state) => state.selectObject);
  const selectObjects = useStore(store, (state) => state.selectObjects);
  const toggleObjectSelection = useStore(
    store,
    (state) => state.toggleObjectSelection,
  );
  const setViewport = useStore(store, (state) => state.setViewport);
  const objects = Object.values(canvas.objects).filter(
    (object) => !object.deletedAt,
  );
  const transformationPairs = objects.flatMap((object) => {
    if (object.type !== "diagram") return [];
    const sourceSketchId = object.payload.sourceSketchId;
    if (!sourceSketchId) return [];
    const source = canvas.objects[sourceSketchId];
    return source && !source.deletedAt && source.type === "sketch"
      ? [{ source, diagram: object }]
      : [];
  });
  const latestReceipt = canvas.receipts.at(-1);
  const selectedObject = selectedObjectId
    ? canvas.objects[selectedObjectId]
    : undefined;
  const selectedObjects = selectedObjectIds.flatMap((objectId) => {
    const object = canvas.objects[objectId];
    return object && !object.deletedAt ? [object] : [];
  });
  const canGroup =
    selectedObjects.length >= 2 &&
    selectedObjects.every((object) => !object.pinned && !object.parentId);
  const selectedFrame =
    selectedObject?.type === "frame"
      ? selectedObject
      : selectedObject?.parentId
        ? canvas.objects[selectedObject.parentId]
        : undefined;
  const canUngroup = Boolean(
    selectedFrame && !selectedFrame.deletedAt && selectedFrame.type === "frame",
  );
  const canRedo = (canvas.redoReceiptIds?.length ?? 0) > 0;
  const commandPending = commandExecution.status === "pending";
  const sketchTransformPending = sketchTransformExecution.status === "pending";
  const interactionPending = commandPending || sketchTransformPending;
  const drawingActive =
    sketchComposerOpen || handInteractionMode === "draw";
  const chatGptProjection = useMemo(
    () =>
      projectCanvasState(canvas, selectedObjectId, {
        scope: "all",
        includeReceipts: true,
      }),
    [canvas, selectedObjectId],
  );
  const spatialServiceState = serviceStateForHandTracking(
    handTrackingStatus,
    serviceStatus?.spatialInput,
  );

  useEffect(() => {
    if (!commandDrawerRequestKey) return;
    const timeoutId = window.setTimeout(() => setOpenDrawer("command"), 0);
    return () => window.clearTimeout(timeoutId);
  }, [commandDrawerRequestKey]);

  useEffect(() => {
    const layer = createCanvasMotionLayer({ root: () => canvasViewportRef.current });
    canvasMotionLayerRef.current = layer;
    return () => {
      layer.dispose();
      canvasMotionLayerRef.current = null;
    };
  }, []);

  useEffect(() => {
    edgePreviewVisibleRef.current = gestureEdgePreview !== null;
  }, [gestureEdgePreview]);

  useEffect(
    () => () => {
      for (const timeoutId of gestureExitTimeoutsRef.current.values())
        window.clearTimeout(timeoutId);
      gestureExitTimeoutsRef.current.clear();
    },
    [],
  );

  useEffect(() => {
    if (
      initialCompactCompositionFitRef.current ||
      !seededCompositionAtMountRef.current ||
      objects.length < 2
    )
      return;
    let cancelled = false;
    let attempts = 0;
    let timeoutId = 0;

    const fitSeededComposition = () => {
      if (cancelled || initialCompactCompositionFitRef.current) return;
      const viewportElement = canvasViewportRef.current;
      const measured = viewportElement?.getBoundingClientRect();
      if (!measured || measured.width <= 0 || measured.height <= 0) {
        attempts += 1;
        if (attempts < 20)
          timeoutId = window.setTimeout(fitSeededComposition, 16);
        return;
      }

      initialCompactCompositionFitRef.current = true;
      if (measured.width > 640) return;
      const state = store.getState();
      const worldBounds = Object.values(state.canvas.objects).flatMap((object) =>
        object.deletedAt
          ? []
          : [
              {
                x: object.x,
                y: object.y,
                width: object.width,
                height: object.minimized ? 62 : object.height,
              },
            ],
      );
      if (worldBounds.length < 2) return;
      const fitted = fitViewportToWorldBounds(
        state.viewport,
        worldBounds,
        { x: 0, y: 0, width: measured.width, height: measured.height },
        20,
        0.5,
      );
      if (fitted) {
        const left = Math.min(...worldBounds.map((bounds) => bounds.x));
        const right = Math.max(
          ...worldBounds.map((bounds) => bounds.x + bounds.width),
        );
        const fittedWidth = (right - left) * fitted.scale;
        setViewport(
          fittedWidth > measured.width - 40
            ? { ...fitted, x: 20 - left * fitted.scale }
            : fitted,
        );
      }
    };

    timeoutId = window.setTimeout(fitSeededComposition, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [objects.length, setViewport, store]);

  useEffect(() => {
    if (!latestReceipt || latestReceipt.id === lastToastReceiptIdRef.current)
      return;
    lastToastReceiptIdRef.current = latestReceipt.id;
    setLatestReceiptVisible(true);
    const timeoutId = window.setTimeout(
      () => setLatestReceiptVisible(false),
      4_200,
    );
    return () => window.clearTimeout(timeoutId);
  }, [latestReceipt]);

  function runCommand(
    command: CanvasCommand,
    source: CanvasCommandSource,
    onApplied?: () => void,
    onRefused?: (message: string) => void,
  ) {
    if (!onCommand) {
      const result = dispatch(command, source);
      if (result.ok) onApplied?.();
      else onRefused?.(result.error.message);
      return;
    }
    if (interactionPending) {
      onRefused?.("Wait for the current canvas action to finish.");
      return;
    }

    setCommandExecution({ status: "pending" });
    let execution: void | CommandResult | Promise<void | CommandResult>;
    try {
      execution = onCommand(command, source);
    } catch (error) {
      const refusal = commandRefusal(error);
      setCommandExecution(refusal);
      onRefused?.(refusal.message);
      return;
    }

    if (!isPromiseLike(execution)) {
      finishRemoteCommand(execution, onApplied, onRefused);
      return;
    }

    void Promise.resolve(execution).then(
      (result) => finishRemoteCommand(result, onApplied, onRefused),
      (error) => {
        const refusal = commandRefusal(error);
        setCommandExecution(refusal);
        onRefused?.(refusal.message);
      },
    );
  }

  async function submitConfirmedRealtimeCommand(
    command: CanvasCommand,
  ): Promise<HumanCommandResult> {
    if (interactionPending)
      return {
        ok: false,
        message: "Wait for the current canvas action to finish.",
      };
    if (!onCommand) {
      const result = dispatch(command, "voice");
      return result.ok
        ? { ok: true, message: "Canvas action confirmed." }
        : { ok: false, message: result.error.message };
    }

    setCommandExecution({ status: "pending" });
    try {
      const result = await onCommand(command, "voice");
      if (result && !result.ok) {
        setCommandExecution({
          status: "refused",
          message: result.error.message,
        });
        return { ok: false, message: result.error.message };
      }
      if (result?.ok && !store.getState().confirmCanvas(result.state)) {
        const message = "The shared canvas did not confirm that voice action.";
        setCommandExecution({ status: "refused", message });
        return { ok: false, message };
      }
      setCommandExecution({ status: "idle" });
      return { ok: true, message: "Canvas action confirmed." };
    } catch (error) {
      const refusal = commandRefusal(error);
      setCommandExecution(refusal);
      return { ok: false, message: refusal.message };
    }
  }

  async function transformSelectedSketch(
    source: CanvasCommandSource = UI_SKETCH_TRANSFORM_SOURCE,
    narration?: string,
  ) {
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
        ...(narration ? { narration } : {}),
        outputKind: "auto",
        source,
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
    onRefused?: (message: string) => void,
  ) {
    if (result && !result.ok) {
      setCommandExecution({
        status: "refused",
        message: result.error.message,
      });
      onRefused?.(result.error.message);
      return;
    }
    if (result?.ok && !store.getState().confirmCanvas(result.state)) {
      const message = "The shared canvas did not confirm that command.";
      setCommandExecution({ status: "refused", message });
      onRefused?.(message);
      return;
    }
    setCommandExecution({ status: "idle" });
    onApplied?.();
  }

  function creationAnchor(baseX: number, baseY: number) {
    const slot = objects.length;
    return screenToWorld(
      {
        x: baseX + (slot % 2) * 620,
        y: baseY + Math.floor(slot / 2) * 380,
      },
      viewport,
    );
  }

  function openPointerSketch() {
    const measured = canvasViewportRef.current?.getBoundingClientRect();
    const compact = Boolean(measured && measured.width > 0 && measured.width <= 640);
    setPointerSketchDimensions(
      compact
        ? {
            width: COMPACT_POINTER_SKETCH_WIDTH,
            height: COMPACT_POINTER_SKETCH_HEIGHT,
          }
        : { width: POINTER_SKETCH_WIDTH, height: POINTER_SKETCH_HEIGHT },
    );
    setSketchComposerOpen(true);
    setOpenDrawer(null);
  }

  function revealObjectOnCompactCanvas(objectId: string) {
    const viewportElement = canvasViewportRef.current;
    if (!viewportElement) return;
    const measured = viewportElement.getBoundingClientRect();
    if (measured.width <= 0 || measured.width > 640) return;
    const state = store.getState();
    const object = state.canvas.objects[objectId];
    if (!object || object.deletedAt) return;
    const bounds = {
      x: object.x,
      y: object.y,
      width: object.width,
      height: object.height,
    };
    const fitted = fitViewportToWorldBounds(
      state.viewport,
      [bounds, bounds],
      { x: 0, y: 0, width: measured.width, height: measured.height },
      24,
      0.5,
    );
    if (fitted) setViewport(fitted);
  }

  function createNote(
    source: CanvasCommandSource = "pointer",
    text?: string,
  ) {
    const objectId = createClientId("note");
    const anchor = creationAnchor(160, 130);
    runCommand(
      {
        type: "object.create",
        object: {
          id: objectId,
          type: "note",
          title: "New thought",
          x: anchor.x,
          y: anchor.y,
          width: 280,
          height: 190,
          zIndex: canvas.revision + 1,
          payload: {
            text:
              text ??
              "Capture the decision while everyone can still see the context.",
            tone: "coral",
          },
        },
      },
      source,
      () => revealObjectOnCompactCanvas(objectId),
    );
  }

  function createTaskBoard(source: CanvasCommandSource = "pointer") {
    const objectId = createClientId("board");
    const anchor = creationAnchor(140, 110);
    runCommand(
      {
        type: "object.create",
        object: {
          id: objectId,
          type: "task_board",
          title: "Launch board",
          x: anchor.x,
          y: anchor.y,
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
      source,
      () => revealObjectOnCompactCanvas(objectId),
    );
  }

  function createSchedule(source: CanvasCommandSource = "pointer") {
    const objectId = createClientId("schedule");
    const anchor = creationAnchor(180, 140);
    runCommand(
      {
        type: "object.create",
        object: {
          id: objectId,
          type: "schedule",
          title: "Next week",
          x: anchor.x,
          y: anchor.y,
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
      source,
      () => revealObjectOnCompactCanvas(objectId),
    );
  }

  function handleObjectSelect(
    event: ReactMouseEvent<HTMLButtonElement>,
    objectId: string,
  ) {
    if (multiSelectMode || event.shiftKey || event.ctrlKey || event.metaKey) {
      toggleObjectSelection(objectId);
      return;
    }
    selectObject(objectId);
    revealObjectOnCompactCanvas(objectId);
  }

  function groupSelectedObjects(source: CanvasCommandSource = "pointer") {
    const current = store.getState();
    const groupable = current.selectedObjectIds.flatMap((objectId) => {
      const object = current.canvas.objects[objectId];
      return object && !object.deletedAt && !object.pinned && !object.parentId
        ? [object]
        : [];
    });
    if (groupable.length < 2 || groupable.length !== current.selectedObjectIds.length)
      return;

    const padding = 44;
    const frameId = createClientId("frame");
    const left = Math.min(...groupable.map((object) => object.x));
    const top = Math.min(...groupable.map((object) => object.y));
    const right = Math.max(
      ...groupable.map((object) => object.x + object.width),
    );
    const bottom = Math.max(
      ...groupable.map((object) => object.y + object.height),
    );
    runCommand(
      {
        type: "objects.group",
        objectIds: groupable.map((object) => object.id),
        frame: {
          id: frameId,
          type: "frame",
          title: `Frame ${current.canvas.revision + 1}`,
          x: left - padding,
          y: top - padding,
          width: right - left + padding * 2,
          height: bottom - top + padding * 2,
          zIndex: Math.max(
            0,
            Math.min(...groupable.map((object) => object.zIndex)) - 1,
          ),
          payload: { tone: "violet" },
        },
      },
      source,
      () => {
        const frame = store.getState().canvas.objects[frameId];
        if (frame && !frame.deletedAt) selectObjects([frameId]);
        setMultiSelectMode(false);
      },
    );
  }

  function ungroupSelectedFrame(source: CanvasCommandSource = "pointer") {
    if (!selectedFrame || selectedFrame.deletedAt || selectedFrame.type !== "frame")
      return;
    runCommand(
      { type: "objects.ungroup", frameId: selectedFrame.id },
      source,
    );
  }

  function rotateSelectedObject(
    delta: number,
    source: CanvasCommandSource = "pointer",
  ) {
    if (!selectedObject || selectedObject.deletedAt || selectedObject.pinned) return;
    runCommand(
      {
        type: "object.transform",
        objectId: selectedObject.id,
        transform: {
          rotation: wrapRotation((selectedObject.rotation ?? 0) + delta),
        },
      },
      source,
    );
  }

  async function handleRealtimeIntent(
    intent: DirectCanvasIntent,
    source: "voice",
  ): Promise<RealtimeVoiceIntentResult> {
    switch (intent.type) {
      case "start_thought":
        return startVoiceThoughtCapture();
      case "append_thought":
        return appendVoiceThoughtTranscript(intent.text);
      case "finish_thought":
        return finishVoiceThoughtCapture();
      default:
        return handleDirectIntent(intent, source);
    }
  }

  async function startVoiceThoughtCapture(): Promise<HumanCommandResult> {
    const objectId = createClientId("note");
    const anchor = creationAnchor(160, 130);
    activeVoiceThoughtIdRef.current = null;
    const result = await submitConfirmedRealtimeCommand({
      type: "object.create",
      object: {
        id: objectId,
        type: "note",
        title: "New thought",
        x: anchor.x,
        y: anchor.y,
        width: 280,
        height: 190,
        zIndex: store.getState().canvas.revision + 1,
        payload: { text: "", tone: "coral" },
      },
    });
    if (!result.ok) return result;

    const object = store.getState().canvas.objects[objectId];
    if (!object || object.deletedAt || object.type !== "note")
      return realtimeConfirmationFailure(
        "The shared canvas did not confirm the new thought card.",
      );
    activeVoiceThoughtIdRef.current = objectId;
    selectObject(objectId);
    revealObjectOnCompactCanvas(objectId);
    return { ok: true, message: "Thought capture started." };
  }

  async function appendVoiceThoughtTranscript(
    rawText: string,
  ): Promise<RealtimeVoiceIntentResult> {
    const text = rawText.replace(/\s+/g, " ").trim();
    if (!text)
      return { ok: false, message: "No completed speech was available to add." };
    if (text.length > NOTE_APPEND_TEXT_MAX_LENGTH)
      return {
        ok: false,
        message: "Keep each dictated thought turn to 1,000 characters or fewer.",
      };

    const objectId = activeVoiceThoughtIdRef.current;
    if (!objectId)
      return { ok: false, message: "Start a new thought before dictating into it." };
    const current = store.getState().canvas.objects[objectId];
    if (!current || current.deletedAt || current.type !== "note") {
      return abortVoiceThoughtCapture(
        "The active thought card is no longer available.",
      );
    }
    const expectedText = current.payload.text
      ? `${current.payload.text}\n${text}`
      : text;
    const result = await submitConfirmedRealtimeCommand({
      type: "object.append_note_text",
      objectId,
      expectedVersion: current.version,
      text,
    });
    if (!result.ok) return abortVoiceThoughtCapture(result.message);

    const updated = store.getState().canvas.objects[objectId];
    if (
      !updated ||
      updated.deletedAt ||
      updated.type !== "note" ||
      updated.version !== current.version + 1 ||
      updated.payload.text !== expectedText
    ) {
      const message = "The shared canvas did not confirm that thought transcript.";
      realtimeConfirmationFailure(message);
      return abortVoiceThoughtCapture(message);
    }
    return { ok: true, message: "Thought transcript added." };
  }

  function finishVoiceThoughtCapture(): RealtimeVoiceIntentResult {
    const objectId = activeVoiceThoughtIdRef.current;
    if (!objectId)
      return {
        ok: false,
        message: "There is no active thought to finish.",
        thoughtCapture: "aborted",
      };
    activeVoiceThoughtIdRef.current = null;
    return { ok: true, message: "Thought capture finished." };
  }

  function abortVoiceThoughtCapture(message: string): RealtimeVoiceIntentResult {
    activeVoiceThoughtIdRef.current = null;
    return { ok: false, message, thoughtCapture: "aborted" };
  }

  function realtimeConfirmationFailure(message: string): HumanCommandResult {
    setCommandExecution({ status: "refused", message });
    return { ok: false, message };
  }

  function handleDirectIntent(
    intent: DirectCanvasIntent,
    source: HumanCommandSource,
    target?: HumanCommandObjectSnapshot,
  ): HumanCommandResult {
    if (interactionPending)
      return {
        ok: false,
        message: "Wait for the current canvas action to finish.",
      };

    switch (intent.type) {
      case "start_thought":
      case "append_thought":
      case "finish_thought":
        return {
          ok: false,
          message: "Thought dictation is available through Live voice.",
        };
      case "create_note":
        createNote(source, intent.text);
        return { ok: true, message: "Note command submitted." };
      case "create_semantic_object":
        runCommand({ type: "object.create", object: intent.object }, source);
        return { ok: true, message: "Semantic object command submitted." };
      case "create_board":
        createTaskBoard(source);
        return { ok: true, message: "Board command submitted." };
      case "create_schedule":
        createSchedule(source);
        return { ok: true, message: "Schedule command submitted." };
      case "open_sketch":
        if (
          handTrackingStatus.state === "ready" &&
          (intent as DirectCanvasIntent & { inputMode?: "hand" | "pointer" })
            .inputMode !== "pointer"
        ) {
          beginHandDrawing();
          return { ok: true, message: "Tracked-hand drawing started." };
        }
        openPointerSketch();
        return { ok: true, message: "Touch and stylus sketch surface opened." };
      case "finish_sketch": {
        if (handInteractionMode !== "draw")
          return { ok: false, message: "Start a tracked-hand drawing first." };
        const activeStrokeReady =
          spatialGestureState.current.phase === "drawing" &&
          spatialGestureState.current.stroke.length >= 2;
        if (gestureSketchStrokesRef.current.length === 0 && !activeStrokeReady)
          return { ok: false, message: "Draw at least one line first." };
        finishHandDrawing();
        return { ok: true, message: "Finger sketch command submitted." };
      }
      case "cancel_sketch":
        if (handInteractionMode === "draw") {
          cancelHandDrawing();
          return { ok: true, message: "Finger drawing cancelled." };
        }
        if (sketchComposerOpen) {
          setSketchComposerOpen(false);
          return { ok: true, message: "Drawing cancelled." };
        }
        return { ok: false, message: "There is no active drawing to cancel." };
      case "transform_selected_sketch":
        if (
          !selectedObject ||
          selectedObject.deletedAt ||
          selectedObject.type !== "sketch"
        )
          return {
            ok: false,
            message: "Select an active sketch first.",
          };
        if (!onTransformSketch)
          return {
            ok: false,
            message: "Sketch interpretation is unavailable in this room.",
          };
        void transformSelectedSketch(source, intent.narration);
        return { ok: true, message: "Sketch interpretation submitted." };
      case "undo":
        if (canvas.receipts.length === 0)
          return { ok: false, message: "There is no canvas change to undo." };
        runCommand({ type: "history.undo" }, source);
        return { ok: true, message: "Undo command submitted." };
      case "redo":
        if (!canRedo)
          return { ok: false, message: "There is no canvas change to redo." };
        runCommand({ type: "history.redo" }, source);
        return { ok: true, message: "Redo command submitted." };
      case "focus_selected":
        if (!selectedObject || selectedObject.deletedAt)
          return { ok: false, message: "Select an active object first." };
        focusCanvasObject(selectedObject.id);
        return { ok: true, message: "Focus command applied." };
      case "group_selected":
        if (!canGroup)
          return {
            ok: false,
            message: "Select at least two unpinned top-level objects first.",
          };
        groupSelectedObjects(source);
        return { ok: true, message: "Group command submitted." };
      case "ungroup_selected":
        if (!canUngroup)
          return { ok: false, message: "Select a frame to ungroup first." };
        ungroupSelectedFrame(source);
        return { ok: true, message: "Ungroup command submitted." };
      case "rotate_selected":
        if (!selectedObject || selectedObject.deletedAt)
          return { ok: false, message: "Select an active object first." };
        if (selectedObject.pinned)
          return {
            ok: false,
            message: `Unpin “${selectedObject.title}” before rotating it.`,
          };
        rotateSelectedObject(
          intent.direction === "clockwise" ? 15 : -15,
          source,
        );
        return { ok: true, message: "Rotate command submitted." };
      case "pin_selected":
        return setSelectedFlagFromHuman(source, "pinned", true, "Pin");
      case "unpin_selected":
        return setSelectedFlagFromHuman(source, "pinned", false, "Unpin");
      case "minimize_selected":
        return setSelectedFlagFromHuman(
          source,
          "minimized",
          true,
          "Minimize",
        );
      case "restore_selected":
        return setSelectedFlagFromHuman(
          source,
          "minimized",
          false,
          "Restore",
        );
      case "discard_selected": {
        const discardTarget =
          target ??
          (source === "voice" && selectedObject && !selectedObject.deletedAt
            ? {
                objectId: selectedObject.id,
                title: selectedObject.title,
                version: selectedObject.version,
              }
            : null);
        if (!discardTarget)
          return { ok: false, message: "Select an active object first." };
        const targetObject = canvas.objects[discardTarget.objectId];
        if (!targetObject || targetObject.deletedAt)
          return {
            ok: false,
            message: `Discard cancelled because “${discardTarget.title}” is no longer active.`,
          };
        if (
          targetObject.version !== discardTarget.version ||
          targetObject.title !== discardTarget.title
        )
          return {
            ok: false,
            message: `Discard cancelled because “${discardTarget.title}” changed. Review it and try again.`,
          };
        runCommand(
          { type: "object.discard", objectId: discardTarget.objectId },
          source,
        );
        return {
          ok: true,
          message: "Recoverable discard command submitted.",
        };
      }
    }
  }

  function setSelectedFlagFromHuman(
    source: HumanCommandSource,
    flag: "pinned" | "minimized",
    value: boolean,
    actionLabel: string,
  ): HumanCommandResult {
    if (!selectedObject || selectedObject.deletedAt)
      return { ok: false, message: "Select an active object first." };
    if (selectedObject[flag] === value)
      return {
        ok: false,
        message: `“${selectedObject.title}” is already ${flag === "pinned" ? (value ? "pinned" : "unpinned") : value ? "minimized" : "restored"}.`,
      };
    runCommand(
      {
        type: "object.set_flags",
        objectId: selectedObject.id,
        flags: { [flag]: value },
      },
      source,
    );
    return { ok: true, message: `${actionLabel} command submitted.` };
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
          title: "Rough sketch",
          x: (180 - viewport.x) / viewport.scale,
          y: (130 - viewport.y) / viewport.scale,
          width: pointerSketchDimensions.width,
          height: pointerSketchDimensions.height,
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
    if (
      multiSelectMode ||
      event.shiftKey ||
      event.ctrlKey ||
      event.metaKey
    )
      return;
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
    if (handCalibrationOpen) return;
    if (observation.mode !== "idle" && openDrawer === "system")
      setOpenDrawer(null);
    const canvasViewport = canvasViewportRef.current;
    if (!canvasViewport || interactionPending) return;
    const bounds = canvasViewport.getBoundingClientRect();
    if (bounds.width <= 0 || bounds.height <= 0) return;
    if (!handCalibrationProfile) return;
    const roomInput = reduceSpatialRoomObservation(
      spatialRoomInputState.current,
      observation,
      {
        calibration: handCalibrationProfile,
        canvas: bounds,
        gainState: handControlGainState(
          handInteractionMode,
          spatialGestureState.current,
          handTargetObjectIdRef.current,
        ),
        edgePreviewVisible: edgePreviewVisibleRef.current,
      },
    );
    spatialRoomInputState.current = roomInput.state;
    const input = roomInput.input;
    const displayPointer =
      input.mode === "idle"
        ? null
        : input.mode === "bimanual_pinch"
          ? {
              x: (input.pointers[0].x + input.pointers[1].x) / 2,
              y: (input.pointers[0].y + input.pointers[1].y) / 2,
            }
          : input.pointer;
    if (displayPointer) canvasMotionLayerRef.current?.previewCursor(displayPointer);
    else canvasMotionLayerRef.current?.hideCursor();

    if (handInteractionMode === "draw" && handDrawingTool === "erase") {
      if (input.mode !== "point") {
        handEraseLatchedRef.current = false;
        if (input.mode === "idle") setHandFeedback(null);
        else
          setHandFeedback({
            mode: input.mode,
            pointer: displayPointer!,
            label: "ERASE · POINT",
          });
        return;
      }
      const pointer = displayPointer!;
      setHandFeedback({
        mode: input.mode,
        pointer,
        label: "ERASING",
      });
      if (!handEraseLatchedRef.current) {
        handEraseLatchedRef.current = true;
        eraseNearestGestureStroke(pointer, bounds);
      }
      return;
    }

    if (handInteractionMode === "draw" && input.mode === "point") {
      const sampled = sampleTrackedStrokePoint(strokeSampleStateRef.current, {
        pointer: displayPointer!,
        timestamp: observation.timestamp,
        canvasSize: bounds,
      });
      strokeSampleStateRef.current = sampled.state;
      resetPalmFinishPreview();
      if (!sampled.accepted) {
        updateHandFeedback({
          mode: input.mode,
          pointer: displayPointer!,
          interactionPhase: spatialGestureState.current.phase,
          label: "DRAWING",
        });
        return;
      }
    } else if (input.mode !== "open_palm") {
      strokeSampleStateRef.current = createInitialStrokeSampleState();
      resetPalmFinishPreview();
    }

    const current = store.getState();
    const primaryObjectId = current.selectedObjectId;
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
                zIndex: effectiveObjectZIndex(
                  object.zIndex,
                  object.id === primaryObjectId,
                ),
                rotation: object.rotation,
                pinned: object.pinned,
                minimized: object.minimized,
              },
            ],
    );
    const transition = reduceSpatialGesture(
      spatialGestureState.current,
      input,
      {
        bounds,
        viewport: current.viewport,
        handActiveZone: FULL_CANVAS_HAND_ZONE,
        selectedObjectId: current.selectedObjectId,
        targetedObjectId: handTargetObjectIdRef.current,
        objects: sceneObjects,
      },
      {
        drawingEnabled: handInteractionMode === "draw",
        manipulationEnabled: handInteractionMode === "manipulate",
      },
    );
    spatialGestureState.current = transition.state;
    if (observation.mode === "idle") {
      handTargetObjectIdRef.current = null;
      setHandTargetObjectId(null);
    }
    if (
      observation.mode === "idle" &&
      !transition.effects.some(
        (effect) => effect.type === "object.preview_edge_action",
      )
    )
      setHandFeedback(null);
    if (observation.mode !== "idle") {
      const semanticMode = input.mode === "idle" ? observation.mode : input.mode;
      updateHandFeedback({
        mode: semanticMode,
        pointer: displayPointer!,
        grabbedObjectId: transition.state.held?.objectId,
        interactionPhase: transition.state.phase,
        label: contextualHandLabel(
          semanticMode,
          observation.mode === "bimanual_pinch"
            ? undefined
            : observation.trackingState,
          transition.state,
          handInteractionMode,
          gestureEdgePreview,
        ),
      });
    }
    for (const effect of transition.effects) applySpatialGestureEffect(effect);
    if (handInteractionMode === "draw" && input.mode === "open_palm")
      updatePalmFinishPreview(observation.timestamp);
  }

  function applySpatialGestureEffect(effect: SpatialGestureEffect) {
    switch (effect.type) {
      case "stroke.preview":
        scheduleStrokePreview(effect.points);
        return;
      case "stroke.commit": {
        const next = [...gestureSketchStrokesRef.current, effect.points];
        gestureSketchStrokesRef.current = next;
        setGestureSketchStrokes(next);
        return;
      }
      case "object.select":
        handTargetObjectIdRef.current = null;
        setHandTargetObjectId(null);
        selectObject(effect.objectId);
        return;
      case "object.target":
        handTargetObjectIdRef.current = effect.objectId;
        setHandTargetObjectId(effect.objectId);
        return;
      case "object.preview_transform":
        setHandTargetObjectId(null);
        gesturePreviewObjectId.current = effect.objectId;
        canvasMotionLayerRef.current?.previewObject(
          effect.objectId,
          effect.transform,
        );
        return;
      case "object.preview_edge_action":
        setGestureEdgePreview(effect);
        return;
      case "object.complete_transform":
      case "object.complete_edge_action":
        commitSpatialGestureCompletion(effect);
        return;
      case "object.preview_move":
        setHandTargetObjectId(null);
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
      case "object.preview_resize":
        gesturePreviewObjectId.current = effect.objectId;
        setObjectPreviews((current) => ({
          ...current,
          [effect.objectId]: {
            ...current[effect.objectId],
            width: effect.width,
            height: effect.height,
          },
        }));
        return;
      case "object.commit_resize":
        runCommand(
          {
            type: "object.transform",
            objectId: effect.objectId,
            transform: { width: effect.width, height: effect.height },
          },
          "gesture",
        );
        return;
      case "viewport.pan_by": {
        const current = store.getState().viewport;
        setViewport({
          ...current,
          x: current.x + effect.deltaX,
          y: current.y + effect.deltaY,
        });
        return;
      }
      case "viewport.zoom_at": {
        const current = store.getState().viewport;
        setViewport(zoomViewportAt(current, effect.screenPoint, effect.scale));
        return;
      }
      case "object.stage_action": {
        const target = store.getState().canvas.objects[effect.objectId];
        if (!target || target.deletedAt) return;
        const commitAction = () => {
          gestureExitTimeoutsRef.current.delete(target.id);
          setGestureExitAnimations((current) => {
            const next = { ...current };
            delete next[target.id];
            return next;
          });
          clearObjectPreview(target.id);
          if (gesturePreviewObjectId.current === target.id)
            gesturePreviewObjectId.current = null;
          runCommand(
            effect.action === "discard"
              ? { type: "object.discard", objectId: target.id }
              : {
                  type: "object.set_flags",
                  objectId: target.id,
                  flags: { minimized: true },
                },
            "gesture",
          );
        };
        const reduceMotion =
          typeof window.matchMedia === "function" &&
          window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        if (effect.action === "discard" && !reduceMotion) {
          const exit = effect.edge === "right" ? "discard-right" : "discard-left";
          setGestureExitAnimations((current) => ({
            ...current,
            [target.id]: exit,
          }));
          const timeoutId = window.setTimeout(commitAction, 190);
          gestureExitTimeoutsRef.current.set(target.id, timeoutId);
        } else {
          commitAction();
        }
        setHandFeedback((current) =>
          current
            ? {
                ...current,
                label:
                  effect.action === "discard"
                    ? "TRASHED · UNDO AVAILABLE"
                    : "MINIMIZED · UNDO AVAILABLE",
              }
            : current,
        );
        return;
      }
      case "object.focus":
        focusCanvasObject(effect.objectId);
        setHandFeedback((current) =>
          current ? { ...current, label: "FOCUSED" } : current,
        );
        return;
      case "object.restore":
        runCommand(
          {
            type: "object.set_flags",
            objectId: effect.objectId,
            flags: { minimized: false },
          },
          "gesture",
        );
        setHandFeedback((current) =>
          current ? { ...current, label: "RESTORED" } : current,
        );
        return;
      case "palm.progress":
        setHandFeedback((current) =>
          current
            ? {
                ...current,
                label: `PALM · HOLD ${Math.round(effect.progress * 100)}%`,
              }
            : current,
        );
        return;
      case "preview.clear": {
        clearScheduledStrokePreview();
        setGestureEdgePreview(null);
        edgePreviewVisibleRef.current = false;
        const objectId = gesturePreviewObjectId.current;
        if (
          objectId &&
          (gestureExitTimeoutsRef.current.has(objectId) ||
            pendingGestureCompletionObjectIdsRef.current.has(objectId))
        )
          return;
        gesturePreviewObjectId.current = null;
        if (objectId) {
          clearObjectPreview(objectId);
          canvasMotionLayerRef.current?.clearObject(objectId);
        }
      }
    }
  }

  function commitSpatialGestureCompletion(
    effect: SpatialGestureCompletionEffect,
  ) {
    const command = spatialGestureCompletionToCommand(effect);
    const objectId = effect.objectId;
    const settle = () => {
      pendingGestureCompletionObjectIdsRef.current.delete(objectId);
      gestureExitTimeoutsRef.current.delete(objectId);
      setGestureExitAnimations((current) => {
        const next = { ...current };
        delete next[objectId];
        return next;
      });
      canvasMotionLayerRef.current?.clearObject(objectId);
      if (gesturePreviewObjectId.current === objectId)
        gesturePreviewObjectId.current = null;
    };
    const submit = () => {
      gestureExitTimeoutsRef.current.delete(objectId);
      pendingGestureCompletionObjectIdsRef.current.add(objectId);
      runCommand(command, "gesture", settle, settle);
    };
    const reduceMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (
      effect.type === "object.complete_edge_action" &&
      effect.action === "discard" &&
      !reduceMotion
    ) {
      const exit = effect.edge === "right" ? "discard-right" : "discard-left";
      setGestureExitAnimations((current) => ({ ...current, [objectId]: exit }));
      const timeoutId = window.setTimeout(submit, 190);
      gestureExitTimeoutsRef.current.set(objectId, timeoutId);
    } else submit();
    setGestureEdgePreview(null);
    edgePreviewVisibleRef.current = false;
  }

  function updateHandFeedback(next: HandCanvasFeedback) {
    if (
      handFeedback &&
      handFeedback.label === next.label &&
      handFeedback.mode === next.mode &&
      handFeedback.grabbedObjectId === next.grabbedObjectId &&
      handFeedback.interactionPhase === next.interactionPhase
    )
      return;
    setHandFeedback(next);
  }

  function scheduleStrokePreview(points: readonly CanvasPoint[]) {
    canvasMotionLayerRef.current?.previewInk(points);
  }

  function clearScheduledStrokePreview() {
    canvasMotionLayerRef.current?.clearInk();
  }

  function resetPalmFinishPreview() {
    palmFinishStartedAtRef.current = null;
    if (palmFinishPreviewValueRef.current === null) return;
    palmFinishPreviewValueRef.current = null;
    setPalmFinishPreview(null);
  }

  function updatePalmFinishPreview(timestamp: number) {
    strokeSampleStateRef.current = createInitialStrokeSampleState();
    if (gestureSketchStrokesRef.current.length === 0) return;
    const startedAt = palmFinishStartedAtRef.current ?? timestamp;
    palmFinishStartedAtRef.current = startedAt;
    const elapsed = Math.max(0, timestamp - startedAt);
    const progress = Math.min(1, elapsed / 300);
    if (palmFinishPreviewValueRef.current !== progress) {
      palmFinishPreviewValueRef.current = progress;
      setPalmFinishPreview(progress);
    }
    if (elapsed >= 300) finishHandDrawing();
  }

  function openHandCalibration() {
    const previewObjectId = gesturePreviewObjectId.current;
    if (
      previewObjectId &&
      !gestureExitTimeoutsRef.current.has(previewObjectId)
    )
      clearObjectPreview(previewObjectId);
    gesturePreviewObjectId.current = null;
    spatialGestureState.current = createInitialSpatialGestureState();
    handTargetObjectIdRef.current = null;
    setHandTargetObjectId(null);
    setHandFeedback(null);
    clearScheduledStrokePreview();
    resetPalmFinishPreview();
    setHandCalibrationOpen(true);
    setOpenDrawer(null);
  }

  function beginHandDrawing() {
    spatialGestureState.current = createInitialSpatialGestureState();
    clearScheduledStrokePreview();
    gestureSketchStrokesRef.current = [];
    setGestureSketchStrokes([]);
    strokeSampleStateRef.current = createInitialStrokeSampleState();
    resetPalmFinishPreview();
    setHandTargetObjectId(null);
    setHandDrawingTool("draw");
    handEraseLatchedRef.current = false;
    selectObject(null);
    setHandInteractionMode("draw");
    setOpenDrawer(null);
  }

  function cancelHandDrawing() {
    spatialGestureState.current = createInitialSpatialGestureState();
    clearScheduledStrokePreview();
    gestureSketchStrokesRef.current = [];
    setGestureSketchStrokes([]);
    strokeSampleStateRef.current = createInitialStrokeSampleState();
    resetPalmFinishPreview();
    setHandInteractionMode("manipulate");
    setHandTargetObjectId(null);
    setHandDrawingTool("draw");
    handEraseLatchedRef.current = false;
    setHandFeedback(null);
  }

  function finishHandDrawing() {
    const activeStroke =
      spatialGestureState.current.phase === "drawing" &&
      spatialGestureState.current.stroke.length >= 2
        ? spatialGestureState.current.stroke
        : null;
    const strokes = activeStroke
      ? [...gestureSketchStrokesRef.current, activeStroke]
      : gestureSketchStrokesRef.current;
    if (strokes.length === 0) return;
    const activeObjects = Object.values(store.getState().canvas.objects).filter(
      (object) => !object.deletedAt,
    );
    const highestZ = activeObjects.reduce(
      (maximum, object) => Math.max(maximum, object.zIndex),
      0,
    );
    const objectId = createClientId("sketch");
    runCommand(
      createGestureSketchCommand(strokes, {
        objectId,
        strokeIds: strokes.map(() => createClientId("stroke")),
        zIndex: highestZ + 1,
      }),
      "gesture",
      () => {
        spatialGestureState.current = createInitialSpatialGestureState();
        clearScheduledStrokePreview();
        gestureSketchStrokesRef.current = [];
        setGestureSketchStrokes([]);
        strokeSampleStateRef.current = createInitialStrokeSampleState();
        resetPalmFinishPreview();
        setHandInteractionMode("manipulate");
        setHandDrawingTool("draw");
        handEraseLatchedRef.current = false;
        setHandFeedback(null);
        selectObject(objectId);
      },
    );
  }

  function eraseNearestGestureStroke(
    pointer: CanvasPoint,
    bounds: { width: number; height: number },
  ) {
    const currentViewport = store.getState().viewport;
    const point = {
      x: (pointer.x * bounds.width - currentViewport.x) / currentViewport.scale,
      y: (pointer.y * bounds.height - currentViewport.y) / currentViewport.scale,
    };
    const radius = 34 / currentViewport.scale;
    const strokes = gestureSketchStrokesRef.current;
    let nearestIndex = -1;
    let nearestDistance = Number.POSITIVE_INFINITY;
    strokes.forEach((stroke, index) => {
      const distance = distanceToStroke(point, stroke);
      if (distance < nearestDistance) {
        nearestIndex = index;
        nearestDistance = distance;
      }
    });
    if (nearestIndex < 0 || nearestDistance > radius) return;
    const next = strokes.filter((_stroke, index) => index !== nearestIndex);
    gestureSketchStrokesRef.current = next;
    setGestureSketchStrokes(next);
  }

  function focusCanvasObject(objectId: string) {
    selectObject(objectId);
    const viewportElement = canvasViewportRef.current;
    const state = store.getState();
    const object = state.canvas.objects[objectId];
    if (!viewportElement || !object || object.deletedAt) return;
    const measured = viewportElement.getBoundingClientRect();
    const height = object.minimized ? 62 : object.height;
    const fitted = fitViewportToWorldBounds(
      { ...state.viewport, scale: 2.5 },
      [
        { x: object.x, y: object.y, width: object.width, height },
        { x: object.x, y: object.y, width: object.width, height },
      ],
      { x: 0, y: 0, width: measured.width, height: measured.height },
      Math.min(96, measured.width * 0.16),
      0.35,
    );
    if (fitted) setViewport(fitted);
  }

  function startCanvasPan(event: ReactPointerEvent<HTMLDivElement>) {
    if (interactionPending) return;
    if (handInteractionMode === "draw") return;
    if (
      (event.target as HTMLElement).closest(
        ".canvas-object, .hand-mode-toolbar, .gesture-edge-targets, .overlay-drawer, .tool-dock, .command-drawer-trigger, .canvas-status-strip, button, input, textarea, select, a",
      )
    )
      return;
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

  function handleCanvasKeyboard(event: ReactKeyboardEvent<HTMLElement>) {
    const target = event.target;
    if (
      target instanceof HTMLElement &&
      (target.isContentEditable || target.matches("input, textarea, select"))
    )
      return;

    if (event.key === "Escape") {
      selectObject(null);
      setMultiSelectMode(false);
      return;
    }
    if ((!event.ctrlKey && !event.metaKey) || interactionPending) return;
    const key = event.key.toLowerCase();
    if (key === "z") {
      event.preventDefault();
      runCommand(
        { type: event.shiftKey ? "history.redo" : "history.undo" },
        "typed",
      );
      return;
    }
    if (key === "y") {
      event.preventDefault();
      runCommand({ type: "history.redo" }, "typed");
      return;
    }
    if (key === "g") {
      if (event.shiftKey) {
        if (!canUngroup) return;
        event.preventDefault();
        ungroupSelectedFrame("typed");
        return;
      }
      if (!canGroup) return;
      event.preventDefault();
      groupSelectedObjects("typed");
    }
  }

  return (
    <main
      className={`command-canvas-shell${meetingMediaPanel ? " has-meeting-media" : ""}${drawingActive ? " is-drawing" : ""}${openDrawer === "system" ? " is-system-open" : ""}`}
      aria-label="Spatial command surface"
      aria-busy={interactionPending}
      onKeyDown={handleCanvasKeyboard}
    >
      <header className="room-header">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">CC</span>
          <div>
            <p className="eyebrow">CommandCanvas</p>
            <h1>Spatial command surface</h1>
          </div>
        </div>

        <div className="room-identity" aria-label="Room status">
          <span className={`status-dot status-dot-${roomStatus}`} aria-hidden="true" />
          <strong>{roomLabel}</strong>
          <span>{roomStatus.toUpperCase()}</span>
          <span>R{canvas.revision}</span>
        </div>

        {participants.length > 0 ? (
          <div
            className="presence-stack"
            aria-label={`${participants.length} ${participants.length === 1 ? "participant" : "participants"} present`}
          >
            {participants.map((participant) => (
              <span
                key={participant.id}
                className="presence-person"
                title={`${participant.displayName} · ${participant.role ?? "participant"}`}
              >
                <span
                  className="presence-token"
                  style={{ background: participant.color ?? "#74859a" }}
                  aria-hidden="true"
                >
                  {initials(participant.displayName)}
                </span>
                <span className="presence-name">{participant.displayName}</span>
              </span>
            ))}
          </div>
        ) : null}

        <div className="header-actions">
          <button
            type="button"
            className="system-status-trigger"
            aria-label="Open system status"
            aria-expanded={openDrawer === "system"}
            onClick={() => setOpenDrawer(openDrawer === "system" ? null : "system")}
          >
            <CompactStatus
              label={roomStatus === "live" ? "Live" : "Local"}
              tone={roomStatus === "live" ? "ready" : "idle"}
            />
            <CompactStatus
              label={handTrackingStatus.state === "ready" ? "Hand" : "Hand"}
              tone={handTrackingStatus.state === "ready" ? "ready" : "idle"}
            />
            <CompactStatus
              label="WebMCP"
              tone={serviceStatus?.webMcp?.tone ?? "idle"}
            />
          </button>
          <button
            type="button"
            className="activity-trigger"
            aria-label="Open activity drawer"
            aria-expanded={openDrawer === "activity"}
            onClick={() => setOpenDrawer(openDrawer === "activity" ? null : "activity")}
          >
            <span aria-hidden="true">↗</span>
            <span>Activity</span>
            <strong>{canvas.receipts.length}</strong>
          </button>
        </div>
      </header>

      {meetingMediaPanel ? (
        <div className="meeting-media-slot">{meetingMediaPanel}</div>
      ) : null}

      <section className="workspace-grid" aria-label="CommandCanvas workspace">
        <section className="canvas-panel" aria-label="Infinite canvas">
          <div className="canvas-status-strip" aria-label="Canvas coordinates">
            <span>{objects.length} objects</span>
            <span>Zoom {Math.round(viewport.scale * 100)}%</span>
            <span>Revision {canvas.revision}</span>
          </div>
          <div
            ref={canvasViewportRef}
            className={`canvas-viewport${pan ? " is-panning" : ""}`}
            data-spatial-control-plane={
              handTrackingStatus.state === "ready" ? "active" : undefined
            }
            style={{
              backgroundPosition: `${viewport.x}px ${viewport.y}px, ${viewport.x}px ${viewport.y}px, ${viewport.x}px ${viewport.y}px`,
              backgroundSize: `${96 * viewport.scale}px ${96 * viewport.scale}px, ${96 * viewport.scale}px ${96 * viewport.scale}px, ${16 * viewport.scale}px ${16 * viewport.scale}px`,
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
            {handTrackingStatus.state === "ready" ? (
              <div className="hand-control-plane-indicator" aria-hidden="true">
                <span className="hand-control-plane-label">
                  <strong>HAND CONTROL</strong>
                  <span>FULL CANVAS</span>
                </span>
                <i data-plane-corner="north-west" />
                <i data-plane-corner="north-east" />
                <i data-plane-corner="south-west" />
                <i data-plane-corner="south-east" />
              </div>
            ) : null}
            <div
              className="canvas-world"
              style={
                {
                  transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`,
                  "--canvas-ui-scale": `${1 / viewport.scale}`,
                } as CSSProperties
              }
            >
              {transformationPairs.map(({ source, diagram }) => (
                <TransformationBridge
                  key={`${source.id}-${diagram.id}`}
                  source={source}
                  diagram={diagram}
                />
              ))}
              {handInteractionMode === "draw" || gestureSketchStrokes.length > 0 ? (
                <svg className="gesture-stroke-preview" aria-hidden="true" viewBox="0 0 1 1">
                  {gestureSketchStrokes
                    .filter((points) => points.length > 0)
                    .map((points, index) => (
                      <polyline
                        key={index}
                        points={points
                          .map((point) => `${point.x},${point.y}`)
                          .join(" ")}
                      />
                    ))}
                  <HandInkPreview />
                </svg>
              ) : null}
              {objects.map((object) => (
                <CanvasObjectCard
                  key={object.id}
                  object={object}
                  preview={objectPreviews[object.id]}
                  isSelected={selectedObjectIds.includes(object.id)}
                  isPrimary={selectedObjectId === object.id}
                  childCount={objects.filter((child) => child.parentId === object.id).length}
                  isHeld={
                    drag?.objectId === object.id ||
                    handFeedback?.grabbedObjectId === object.id
                  }
                  isTargeted={handTargetObjectId === object.id}
                  gestureExit={gestureExitAnimations[object.id]}
                  onSelect={(event) => handleObjectSelect(event, object.id)}
                  onPointerDown={(event) => startObjectDrag(event, object)}
                  onPointerMove={updateObjectDrag}
                  onPointerUp={finishObjectDrag}
                  onPointerCancel={cancelObjectDrag}
                  onResizePointerDown={(event) => startObjectResize(event, object)}
                  onResizePointerMove={updateObjectResize}
                  onResizePointerUp={finishObjectResize}
                  onResizePointerCancel={cancelObjectResize}
                  onTogglePin={() =>
                    runCommand(
                      {
                        type: "object.set_flags",
                        objectId: object.id,
                        flags: { pinned: !object.pinned },
                      },
                      "pointer",
                    )
                  }
                  onToggleMinimize={() =>
                    runCommand(
                      {
                        type: "object.set_flags",
                        objectId: object.id,
                        flags: { minimized: !object.minimized },
                      },
                      "pointer",
                    )
                  }
                  onFocus={() => focusCanvasObject(object.id)}
                  onRotateCounterClockwise={() => rotateSelectedObject(-15)}
                  onRotateClockwise={() => rotateSelectedObject(15)}
                  onDiscard={() =>
                    runCommand(
                      { type: "object.discard", objectId: object.id },
                      "pointer",
                    )
                  }
                  onMakeUsable={
                    object.type === "sketch" && onTransformSketch
                      ? () => void transformSelectedSketch()
                      : undefined
                  }
                  transformPending={sketchTransformPending}
                  onLoadPreparedInterpretation={
                    object.type === "sketch" &&
                    sketchTransformExecution.status === "refused" &&
                    sketchTransformExecution.sourceSketchId === object.id
                      ? loadPreparedDemoInterpretation
                      : undefined
                  }
                  commandsDisabled={interactionPending || drawingActive}
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
                    left: screenPoint.x,
                    top: screenPoint.y,
                    color: cursor.color,
                  }}
                >
                  <span className="remote-cursor-pointer" />
                  <span className="remote-cursor-name">{cursor.displayName}</span>
                </div>
              );
            })}

            {handFeedback ? (
              <div
                className={`hand-canvas-feedback${handFeedback.grabbedObjectId ? " is-grabbing" : ""}`}
                data-hand-cursor
                aria-live="polite"
                style={{
                  left: "var(--hand-cursor-x, 50%)",
                  top: "var(--hand-cursor-y, 50%)",
                }}
              >
                <span className="hand-cursor-ring" aria-hidden="true" />
                <strong>{handFeedback.label}</strong>
              </div>
            ) : null}

            {handFeedback?.interactionPhase !== "two_hand_pending" &&
            handFeedback?.interactionPhase !== "transforming_two" &&
            handFeedback?.interactionPhase !== "lost_grace" &&
            (handFeedback?.grabbedObjectId || gestureEdgePreview) ? (
              <div className="gesture-edge-targets" aria-live="polite">
                <div
                  className={`gesture-edge-target gesture-edge-discard gesture-edge-discard-left${gestureEdgePreview?.edge === "left" && gestureEdgePreview.armed ? " is-armed" : ""}`}
                >
                  <span>Throw to trash</span>
                </div>
                <div
                  className={`gesture-edge-target gesture-edge-discard gesture-edge-discard-right${gestureEdgePreview?.edge === "right" && gestureEdgePreview.armed ? " is-armed" : ""}`}
                >
                  <span>Throw to trash</span>
                </div>
                <div
                  className={`gesture-edge-target gesture-edge-minimize${gestureEdgePreview?.edge === "bottom" && gestureEdgePreview.armed ? " is-armed" : ""}`}
                >
                  <span>Minimize dock</span>
                </div>
                <div
                  className={`gesture-edge-target gesture-edge-maximize${gestureEdgePreview?.edge === "top" && gestureEdgePreview.armed ? " is-armed" : ""}`}
                >
                  <span>Maximize</span>
                </div>
              </div>
            ) : null}

            {handTrackingStatus.state === "ready" ||
            handInteractionMode === "draw" ? (
              <section
                className={`hand-mode-toolbar hand-mode-${handInteractionMode}`}
                aria-label="Hand interaction controls"
              >
                {handInteractionMode === "manipulate" ? (
                  <>
                    <strong>HAND CONTROL · FULL CANVAS</strong>
                    <span>Point at an object · pinch to hold</span>
                    <button
                      type="button"
                      aria-label="Draw with index finger"
                      onClick={beginHandDrawing}
                    >
                      Start draw
                    </button>
                    <button
                      type="button"
                      aria-label="Open hand calibration"
                      onClick={openHandCalibration}
                    >
                      Calibrate
                    </button>
                  </>
                ) : (
                  <>
                    <strong>
                      {handTrackingStatus.state === "ready"
                        ? "DRAW MODE"
                        : "TRACKING LOST · SKETCH PRESERVED"}
                    </strong>
                    <span>
                      {gestureSketchStrokes.length} {gestureSketchStrokes.length === 1 ? "stroke" : "strokes"} ready
                    </span>
                    {palmFinishPreview !== null ? (
                      <span
                        className="palm-finish-preview"
                        role="status"
                        data-palm-finish-progress={Math.round(
                          palmFinishPreview * 100,
                        )}
                        style={
                          {
                            "--palm-finish-progress": palmFinishPreview,
                          } as CSSProperties
                        }
                      >
                        OPEN PALM · HOLD TO FINISH {Math.round(palmFinishPreview * 100)}%
                      </span>
                    ) : null}
                    <button
                      type="button"
                      aria-label={handDrawingTool === "draw" ? "Use hand eraser" : "Use hand draw"}
                      aria-pressed={handDrawingTool === "erase"}
                      onClick={() => {
                        spatialGestureState.current = createInitialSpatialGestureState();
                        clearScheduledStrokePreview();
                        handEraseLatchedRef.current = false;
                        setHandDrawingTool((current) => current === "draw" ? "erase" : "draw");
                      }}
                    >
                      {handDrawingTool === "draw" ? "Erase" : "Draw"}
                    </button>
                    <button
                      type="button"
                      aria-label="Finish hand sketch"
                      onClick={finishHandDrawing}
                    >
                      Finish
                    </button>
                    <button
                      type="button"
                      aria-label="Cancel hand sketch"
                      onClick={cancelHandDrawing}
                    >
                      Cancel
                    </button>
                  </>
                )}
              </section>
            ) : null}

            {objects.length === 0 ? (
              <div className="canvas-empty-state">
                <span className="empty-crosshair" aria-hidden="true" />
                <p>No objects yet</p>
                <span>Speak to ChatGPT, draw, or choose an object below.</span>
              </div>
            ) : null}
          </div>

          {sketchComposerOpen ? (
            <section
              className="canvas-sketch-layer"
              aria-label="Draw directly on the canvas"
            >
              <div className="canvas-sketch-heading">
                <div>
                  <p className="eyebrow">Original artifact stays here</p>
                  <h2>Draw what you mean</h2>
                </div>
                <span>Mouse · touch · stylus · finger</span>
              </div>
              <SketchComposer
                width={pointerSketchDimensions.width}
                height={pointerSketchDimensions.height}
                onDone={createSketch}
                onCancel={() => {
                  if (!interactionPending) setSketchComposerOpen(false);
                }}
              />
            </section>
          ) : null}
        </section>

        <SpatialCameraControl
          calibrationOpen={handCalibrationOpen}
          calibrationDeviceKey="commandcanvas-hand-camera"
          calibrationProfile={handCalibrationProfile}
          createController={createHandTrackingController}
          privateGpuRelayAvailable={privateGpuRelayAvailable}
          onCalibrationResult={(result) => {
            spatialRoomInputState.current = createInitialSpatialRoomInputState();
            setHandCalibrationProfile(result.profile);
          }}
          onCalibrationOpenChange={(open) => {
            if (open) {
              openHandCalibration();
              return;
            }
            setHandCalibrationOpen(false);
          }}
          onObservation={handleHandObservation}
          onSpatialModeStarted={() => {
            setHandCalibrationOpen(false);
            setOpenDrawer(null);
          }}
          onStatusChange={(status) => {
            setHandTrackingStatus(status);
            if (status.state !== "ready") setHandFeedback(null);
          }}
        />

        <aside className="tool-dock" aria-label="Object tools">
          <span className="dock-label">Canvas</span>
          <button type="button" onClick={() => createNote()} aria-label="Create note" disabled={interactionPending || drawingActive}>
            <span aria-hidden="true">＋</span><small>Note</small>
          </button>
          <button type="button" onClick={() => createTaskBoard()} aria-label="Create task board" disabled={interactionPending || drawingActive}>
            <span aria-hidden="true">▦</span><small>Board</small>
          </button>
          <button type="button" onClick={() => createSchedule()} aria-label="Create schedule" disabled={interactionPending || drawingActive}>
            <span aria-hidden="true">31</span><small>Schedule</small>
          </button>
          <button
            type="button"
            onClick={openPointerSketch}
            aria-label={
              handTrackingStatus.state === "ready"
                ? "Draw with touch, stylus, or mouse"
                : "Create sketch"
            }
            aria-pressed={sketchComposerOpen}
            className={sketchComposerOpen ? "is-active" : undefined}
            disabled={interactionPending || drawingActive}
          >
            <span aria-hidden="true">⌁</span>
            <small>Draw</small>
          </button>
          {handTrackingStatus.state === "ready" ? (
            <button
              type="button"
              onClick={beginHandDrawing}
              aria-label="Draw with hand"
              aria-pressed={handInteractionMode === "draw"}
              className={handInteractionMode === "draw" ? "is-active" : undefined}
              disabled={interactionPending || drawingActive}
            >
              <span aria-hidden="true">☝</span>
              <small>Hand</small>
            </button>
          ) : null}
          <button
            type="button"
            aria-label="Undo last change"
            disabled={drawingActive || interactionPending || canvas.receipts.length === 0}
            onClick={() => runCommand({ type: "history.undo" }, "typed")}
          >
            <span aria-hidden="true">↶</span><small>Undo</small>
          </button>
          <button
            type="button"
            aria-label={
              multiSelectMode
                ? "Disable multiple selection"
                : "Enable multiple selection"
            }
            aria-pressed={multiSelectMode}
            className={multiSelectMode ? "is-active" : undefined}
            disabled={interactionPending || drawingActive}
            onClick={() => setMultiSelectMode((current) => !current)}
          >
            <span aria-hidden="true">◇</span><small>Select</small>
          </button>
          <button
            type="button"
            aria-label="Group selected objects"
            disabled={interactionPending || drawingActive || !canGroup}
            onClick={() => groupSelectedObjects()}
          >
            <span aria-hidden="true">▣</span><small>Group</small>
          </button>
          <button
            type="button"
            aria-label="Ungroup selected frame"
            disabled={interactionPending || drawingActive || !canUngroup}
            onClick={() => ungroupSelectedFrame()}
          >
            <span aria-hidden="true">▢</span><small>Ungroup</small>
          </button>
          <button
            type="button"
            aria-label="Redo last undone change"
            disabled={interactionPending || drawingActive || !canRedo}
            onClick={() => runCommand({ type: "history.redo" }, "typed")}
          >
            <span aria-hidden="true">↷</span><small>Redo</small>
          </button>
        </aside>

        <ChatGptCommandSurface
          surfaceState={webMcpSurfaceState}
          executionActivity={webMcpExecutionActivity}
          projection={chatGptProjection}
          drawerOpen={openDrawer === "command"}
          drawingActive={drawingActive}
          realtimeActive={realtimeVoiceActive}
          realtimeAvailable={Boolean(realtimeVoice && !realtimeVoice.disabled)}
          onOpenDrawer={() => setOpenDrawer("command")}
          onCloseDrawer={() => {
            setHandCalibrationOpen(false);
            setOpenDrawer(null);
          }}
          onToggleRealtimeVoice={() => realtimeVoiceControlRef.current?.toggle()}
          onViewAllActivity={() => setOpenDrawer("activity")}
          realtimeContent={
            realtimeVoice ? (
              <RealtimeVoiceControl
                ref={realtimeVoiceControlRef}
                {...realtimeVoice}
                onIntent={handleRealtimeIntent}
                inspectCanvas={(input, signal) => {
                  signal.throwIfAborted();
                  const state = store.getState();
                  return projectCanvasState(
                    state.canvas,
                    state.selectedObjectId,
                    input,
                  ) as unknown as JsonValue;
                }}
                onActiveChange={setRealtimeVoiceActive}
              />
            ) : undefined
          }
          typedCommandContent={
            realtimeVoice ? (
              <details
                className="typed-command-fallback has-realtime-voice"
                open={typedFallbackOpen}
                onToggle={(event) =>
                  setTypedFallbackOpen(event.currentTarget.open)
                }
              >
                <summary>Type a command instead</summary>
                {typedFallbackOpen ? (
                  <HumanCommandControl
                    disabled={interactionPending}
                    onIntent={handleDirectIntent}
                    selectedObject={
                      selectedObject && !selectedObject.deletedAt
                        ? {
                            objectId: selectedObject.id,
                            title: selectedObject.title,
                            version: selectedObject.version,
                          }
                        : null
                    }
                  />
                ) : null}
              </details>
            ) : (
              <HumanCommandControl
                disabled={interactionPending}
                onIntent={handleDirectIntent}
                selectedObject={
                  selectedObject && !selectedObject.deletedAt
                    ? {
                        objectId: selectedObject.id,
                        title: selectedObject.title,
                        version: selectedObject.version,
                      }
                    : null
                }
              />
            )
          }
          packetPanel={meetingPacketPanel}
        />

        {latestReceipt && latestReceiptVisible && !drawingActive && openDrawer !== "activity" ? (
          <button
            type="button"
            className="latest-activity-toast"
            aria-label={`Open activity drawer: ${latestReceipt.description}`}
            onClick={() => setOpenDrawer("activity")}
          >
            <span className={`actor-token actor-${latestReceipt.actor.type}`}>
              {latestReceipt.actor.type === "agent"
                ? "AI"
                : initials(latestReceipt.actor.displayName)}
            </span>
            <span>
              <strong>{latestReceipt.description}</strong>
              <small>R{latestReceipt.revision} · {latestReceipt.source}</small>
            </span>
          </button>
        ) : null}

        {commandExecution.status !== "idle" ||
        sketchTransformExecution.status === "refused" ||
        lastError ? (
          <div className="operation-toast" role="status" aria-live="polite">
            {commandExecution.status === "pending" ? (
              <><strong>Applying command…</strong><span>Waiting for the shared canvas to confirm the change.</span></>
            ) : commandExecution.status === "refused" ? (
              <><strong>Command refused</strong><span>{commandExecution.message}</span></>
            ) : sketchTransformExecution.status === "refused" ? (
              <><strong>Sketch interpretation failed</strong><span>{sketchTransformExecution.message}</span></>
            ) : lastError ? (
              <><strong>{lastError.code}</strong><span>{lastError.message}</span></>
            ) : null}
          </div>
        ) : null}

        <aside
          className={`command-rail overlay-drawer persistent-system-drawer${
            openDrawer === "system" ? " is-open" : ""
          }`}
          aria-label="System status drawer"
          aria-hidden={openDrawer === "system" ? undefined : true}
          inert={openDrawer !== "system"}
        >
            <DrawerHeading
              eyebrow="Quiet until needed"
              title="Inputs & services"
              closeLabel="Close system status drawer"
              onClose={() => {
                setHandCalibrationOpen(false);
                setOpenDrawer(null);
              }}
            />
            <section className="service-stack" aria-label="Service status">
              <ServiceState
                label="WebMCP"
                value={serviceStatus?.webMcp?.value ?? "WebMCP not exercised"}
                tone={serviceStatus?.webMcp?.tone ?? "idle"}
              />
              <ServiceState
                label="Collaboration"
                value={serviceStatus?.collaboration?.value ?? "Realtime not connected"}
                tone={serviceStatus?.collaboration?.tone ?? "idle"}
                announce
              />
              <ServiceState label="Spatial input" value={spatialServiceState.value} tone={spatialServiceState.tone} />
            </section>
            <a
              className="source-offer"
              href={correspondingSourceUrl}
              target="_blank"
              rel="noreferrer"
            >
              <span>Source · AGPL-3.0</span>
              <span aria-hidden="true">↗</span>
            </a>
        </aside>

        {openDrawer === "activity" ? (
          <aside className="command-rail overlay-drawer" aria-label="Activity drawer">
            <DrawerHeading
              eyebrow="Visible, reversible, attributable"
              title="Activity"
              closeLabel="Close activity drawer"
              onClose={() => setOpenDrawer(null)}
            />
            <section className="activity-section" aria-labelledby="activity-heading">
              <div className="activity-header">
                <h3 id="activity-heading">Room receipts</h3>
                <span>{canvas.receipts.length}</span>
              </div>
              {canvas.receipts.length === 0 ? (
                <p className="activity-empty">Human, collaborator, and agent actions land in one receipt stream.</p>
              ) : (
                <ol className="receipt-list">
                  {[...canvas.receipts].reverse().map((receipt) => (
                    <li key={receipt.id}>
                      <span className={`actor-token actor-${receipt.actor.type}`}>
                        {receipt.actor.type === "agent" ? "AI" : initials(receipt.actor.displayName)}
                      </span>
                      <div>
                        <p>{receipt.description}</p>
                        <span>R{receipt.revision} · {receipt.source}</span>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </aside>
        ) : null}
      </section>
    </main>
  );
}

interface CanvasObjectCardProps {
  object: CanvasObject;
  preview?: ObjectTransformPreview;
  isSelected: boolean;
  isPrimary: boolean;
  isHeld: boolean;
  isTargeted: boolean;
  gestureExit?: "discard-left" | "discard-right";
  childCount: number;
  onSelect: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerCancel: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onResizePointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onResizePointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onResizePointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onResizePointerCancel: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onTogglePin: () => void;
  onToggleMinimize: () => void;
  onFocus: () => void;
  onRotateCounterClockwise: () => void;
  onRotateClockwise: () => void;
  onDiscard: () => void;
  onMakeUsable?: () => void;
  transformPending: boolean;
  onLoadPreparedInterpretation?: () => void;
  commandsDisabled: boolean;
}

function CanvasObjectCard({
  object,
  preview,
  isSelected,
  isPrimary,
  isHeld,
  isTargeted,
  gestureExit,
  childCount,
  onSelect,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onResizePointerDown,
  onResizePointerMove,
  onResizePointerUp,
  onResizePointerCancel,
  onTogglePin,
  onToggleMinimize,
  onFocus,
  onRotateCounterClockwise,
  onRotateClockwise,
  onDiscard,
  onMakeUsable,
  transformPending,
  onLoadPreparedInterpretation,
  commandsDisabled,
}: CanvasObjectCardProps) {
  const typeClass = objectTypeClass(object);

  return (
    <article
      className={`canvas-object ${typeClass}${isSelected ? " is-selected" : ""}${isTargeted ? " is-hand-target" : ""}${isHeld ? " is-held" : ""}${object.minimized ? " is-minimized" : ""}`}
      data-gesture-exit={gestureExit}
      data-object-state={object.minimized ? "minimized" : isHeld ? "held" : isTargeted ? "target" : "open"}
      data-canvas-object={object.id}
      style={{
        left: `var(--gesture-x, ${preview?.x ?? object.x}px)`,
        top: `var(--gesture-y, ${preview?.y ?? object.y}px)`,
        width: `var(--gesture-width, ${preview?.width ?? object.width}px)`,
        height: object.minimized
          ? 62
          : `var(--gesture-height, ${preview?.height ?? object.height}px)`,
        zIndex: effectiveObjectZIndex(object.zIndex, isPrimary),
        transform: `${isHeld ? "scale(1.018) " : ""}rotate(var(--gesture-rotation, ${object.rotation ?? 0}deg))`,
      }}
    >
      {isPrimary ? (
        <div
          className="object-spatial-chrome"
          role="toolbar"
          aria-label={`${object.title} spatial controls`}
        >
          {onMakeUsable ? (
            <button
              type="button"
              className="object-transform-action"
              aria-label={transformPending ? "Interpreting sketch…" : "Make usable"}
              disabled={commandsDisabled}
              onClick={onMakeUsable}
            >
              {transformPending ? "Interpreting…" : "Make usable"}
            </button>
          ) : null}
          {onLoadPreparedInterpretation ? (
            <button
              type="button"
              className="object-transform-action"
              aria-label="Load prepared demo interpretation"
              disabled={commandsDisabled}
              onClick={onLoadPreparedInterpretation}
            >
              Prepared fallback
            </button>
          ) : null}
          <button
            type="button"
            aria-label="Focus object"
            disabled={commandsDisabled}
            onClick={onFocus}
            title="Focus or maximize"
          >
            <span aria-hidden="true">⛶</span>
          </button>
          <button
            type="button"
            aria-label={object.minimized ? "Restore object" : "Minimize object"}
            disabled={commandsDisabled}
            onClick={onToggleMinimize}
            title={object.minimized ? "Restore" : "Minimize"}
          >
            <span aria-hidden="true">{object.minimized ? "□" : "−"}</span>
          </button>
          <button
            type="button"
            className="danger-action"
            aria-label="Move object to trash"
            disabled={commandsDisabled}
            onClick={onDiscard}
            title="Move to recoverable trash"
          >
            <span aria-hidden="true">×</span>
          </button>
          <button
            type="button"
            aria-label={object.pinned ? "Unpin object" : "Pin object"}
            disabled={commandsDisabled}
            onClick={onTogglePin}
            title={object.pinned ? "Unpin" : "Pin"}
          >
            <span aria-hidden="true">⌖</span>
          </button>
          <button
            type="button"
            aria-label="Rotate counterclockwise"
            disabled={commandsDisabled || object.pinned}
            onClick={onRotateCounterClockwise}
            title="Rotate counterclockwise 15 degrees"
          >
            <span aria-hidden="true">↶</span>
          </button>
          <button
            type="button"
            aria-label="Rotate clockwise"
            disabled={commandsDisabled || object.pinned}
            onClick={onRotateClockwise}
            title="Rotate clockwise 15 degrees"
          >
            <span aria-hidden="true">↷</span>
          </button>
        </div>
      ) : null}
      <button
        type="button"
        className="object-select-hitbox"
        aria-label={`Select ${object.title}`}
        aria-pressed={isSelected}
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
        <span className="object-title-line">
          <strong>{object.title}</strong>
          {object.type === "diagram" &&
          !object.payload.interpretationSummary.startsWith("Prepared demo fallback") ? (
            <span className="object-provenance object-provenance-agent">
              <span aria-hidden="true">✦</span> Agent structured
            </span>
          ) : null}
        </span>
        {!object.minimized ? (
          <CanvasObjectContent object={object} childCount={childCount} />
        ) : null}
      </button>
      {isPrimary && !object.minimized && !object.pinned ? (
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
      {isPrimary && !object.minimized && !object.pinned ? (
        <>
          <span className="resize-corner resize-corner-nw" aria-hidden="true" />
          <span className="resize-corner resize-corner-ne" aria-hidden="true" />
          <span className="resize-corner resize-corner-sw" aria-hidden="true" />
        </>
      ) : null}
      {object.pinned ? <span className="pin-state">Pinned to canvas</span> : null}
    </article>
  );
}

function CanvasObjectContent({
  object,
  childCount,
}: {
  object: CanvasObject;
  childCount: number;
}) {
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
    case "data_table":
    case "reference_card":
    case "meeting_card":
      return <SemanticObjectPreview object={object} />;
    case "frame":
      return (
        <div className="frame-preview">
          <span>{childCount} {childCount === 1 ? "object" : "objects"}</span>
          <small>Move or rotate this frame to carry its contents.</small>
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
    case "data_table":
      return "data-table-object";
    case "reference_card":
      return "reference-card-object";
    case "meeting_card":
      return `meeting-card-object meeting-card-${object.payload.kind}`;
    case "frame":
      return `frame-object tone-${object.payload.tone}`;
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
      switch (object.payload.kind) {
        case "architecture":
          return "ARCHITECTURE DIAGRAM";
        case "flowchart":
          return "FLOWCHART";
        case "diagram":
          return "STRUCTURED DIAGRAM";
        case "pie_chart":
          return "PIE CHART";
        case "bar_chart":
          return "BAR CHART";
        case "line_chart":
          return "LINE CHART";
      }
    case "frame":
      return "FRAME";
    case "data_table":
      return "DATA TABLE";
    case "reference_card":
      return "REFERENCE";
    case "meeting_card":
      return object.payload.kind.replaceAll("_", " ").toUpperCase();
  }
}

function TransformationBridge({
  source,
  diagram,
}: {
  source: Extract<CanvasObject, { type: "sketch" }>;
  diagram: Extract<CanvasObject, { type: "diagram" }>;
}) {
  const start = {
    x: source.x + source.width,
    y: source.y + (source.minimized ? 62 : source.height) / 2,
  };
  const end = {
    x: diagram.x,
    y: diagram.y + (diagram.minimized ? 62 : diagram.height) / 2,
  };
  const distance = Math.hypot(end.x - start.x, end.y - start.y);
  const angle = Math.atan2(end.y - start.y, end.x - start.x);

  return (
    <div
      className="transformation-bridge"
      role="img"
      aria-label={`Transformation from ${source.title} to ${diagram.title}`}
      style={{
        left: start.x,
        top: start.y,
        width: distance,
        transform: `rotate(${angle}rad)`,
      }}
    >
      <span aria-hidden="true">ROUGH → STRUCTURED</span>
    </div>
  );
}

function CompactStatus({
  label,
  tone,
}: {
  label: string;
  tone: ServiceTone;
}) {
  return (
    <span className={`compact-status compact-status-${tone}`}>
      <span aria-hidden="true" />
      {label}
    </span>
  );
}

function DrawerHeading({
  eyebrow,
  title,
  closeLabel,
  onClose,
}: {
  eyebrow: string;
  title: string;
  closeLabel: string;
  onClose: () => void;
}) {
  return (
    <div className="rail-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
      </div>
      <button type="button" aria-label={closeLabel} onClick={onClose}>
        <span aria-hidden="true">×</span>
      </button>
    </div>
  );
}

type WorkspaceDrawer = "command" | "activity" | "system" | null;
type HandInteractionMode = "manipulate" | "draw";
type HandDrawingTool = "draw" | "erase";

interface HandCanvasFeedback {
  mode: "point" | "pinch" | "open_palm" | "bimanual_pinch";
  pointer: CanvasPoint;
  grabbedObjectId?: string;
  interactionPhase?: ReturnType<
    typeof createInitialSpatialGestureState
  >["phase"];
  label: string;
}

function contextualHandLabel(
  mode: HandCanvasFeedback["mode"],
  trackingState: "tracked" | "grace" | undefined,
  state: SpatialGestureState,
  interactionMode: HandInteractionMode,
  edgePreview: Extract<
    SpatialGestureEffect,
    { type: "object.preview_edge_action" }
  > | null,
) {
  if (mode !== "bimanual_pinch" && trackingState === "grace")
    return "REACQUIRE";
  if (interactionMode === "draw")
    return mode === "point"
      ? "DRAWING"
      : mode === "open_palm"
        ? "PEN UP"
        : "DRAW · READY";
  if (edgePreview?.armed)
    return edgePreview.action === "discard"
      ? "THROW ARMED"
      : edgePreview.action === "maximize"
        ? "MAXIMIZE ARMED"
        : "MINIMIZE ARMED";
  if (state.phase === "lost_grace") return "REACQUIRE";
  if (state.phase === "transforming_two" || state.phase === "two_hand_pending")
    return "RESIZE";
  if (state.held) return "HELD";
  if (state.phase === "panning")
    return mode === "bimanual_pinch" ? "CANVAS ZOOM" : "PAN";
  if (state.phase === "pinch_pending" || mode === "pinch")
    return "PINCH";
  if (state.candidate) return "TARGET";
  return "POINT";
}

function handControlGainState(
  interactionMode: HandInteractionMode,
  state: SpatialGestureState,
  targetObjectId: string | null,
) {
  if (interactionMode === "draw") return "draw" as const;
  if (
    state.phase === "transforming_two" ||
    state.phase === "two_hand_pending"
  )
    return "two_hand" as const;
  if (state.held) return "held" as const;
  if (targetObjectId || state.candidate) return "target" as const;
  return "hover" as const;
}


interface ObjectTransformPreview {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
}

function wrapRotation(rotation: number) {
  if (rotation > 180) return rotation - 360;
  if (rotation < -180) return rotation + 360;
  return rotation;
}

function effectiveObjectZIndex(zIndex: number, isPrimary: boolean) {
  return isPrimary ? SELECTED_OBJECT_RENDER_Z_INDEX : zIndex;
}

function distanceToStroke(
  point: CanvasPoint,
  stroke: readonly CanvasPoint[],
) {
  if (stroke.length === 0) return Number.POSITIVE_INFINITY;
  if (stroke.length === 1)
    return Math.hypot(point.x - stroke[0].x, point.y - stroke[0].y);
  let minimum = Number.POSITIVE_INFINITY;
  for (let index = 1; index < stroke.length; index += 1) {
    const start = stroke[index - 1];
    const end = stroke[index];
    const deltaX = end.x - start.x;
    const deltaY = end.y - start.y;
    const lengthSquared = deltaX * deltaX + deltaY * deltaY;
    const projection =
      lengthSquared === 0
        ? 0
        : Math.max(
            0,
            Math.min(
              1,
              ((point.x - start.x) * deltaX + (point.y - start.y) * deltaY) /
                lengthSquared,
            ),
          );
    minimum = Math.min(
      minimum,
      Math.hypot(
        point.x - (start.x + projection * deltaX),
        point.y - (start.y + projection * deltaY),
      ),
    );
  }
  return minimum;
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

function commandRefusal(
  error: unknown,
): Extract<CommandExecutionState, { status: "refused" }> {
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
  announce?: boolean;
}

function ServiceState({
  label,
  value,
  tone,
  announce = false,
}: ServiceStateProps) {
  return (
    <div className="service-state">
      <span className={`service-orb service-${tone}`} aria-hidden="true" />
      <div>
        <strong>{label}</strong>
        <span
          role={announce ? "status" : undefined}
          aria-live={announce ? "polite" : undefined}
          aria-atomic={announce ? "true" : undefined}
        >
          {value}
        </span>
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
