"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";

import {
  parseDirectCanvasCommand,
  type DirectCanvasIntent,
} from "@/lib/canvas/direct-command";
import { MAX_DIAGRAM_TRANSFORM_NARRATION_CHARS } from "@/lib/vision/diagram-transform";
import {
  createRealtimeVoiceController,
  type RealtimeVoiceController,
  type RealtimeVoiceControllerOptions,
  type RealtimeVoiceResponseOutcome,
  type RealtimeVoiceTurnContext,
  type RealtimeVoiceToolAction,
} from "@/lib/realtime-voice/client";
import type { RealtimeVoiceIntentResult } from "@/lib/realtime-voice/tools";

export type RealtimeVoiceControlController = RealtimeVoiceController;

export interface SavedOpenAiCredentialControl {
  configured: boolean;
  fingerprint?: string;
  updatedAt?: string;
  busy: boolean;
  error?: string;
  onSave: (apiKey: string) => Promise<void> | void;
  onDelete: () => Promise<void> | void;
}

export interface RealtimeVoiceControlProps {
  roomId: string;
  getAccessToken: () => string | null;
  openAiApiKey?: string;
  onOpenAiApiKeyChange?: (value: string) => void;
  useSavedOpenAiCredential?: boolean;
  onUseSavedOpenAiCredentialChange?: (value: boolean) => void;
  savedOpenAiCredential?: SavedOpenAiCredentialControl;
  disabled?: boolean;
  onIntent: RealtimeVoiceControllerOptions["onIntent"];
  inspectCanvas?: RealtimeVoiceControllerOptions["inspectCanvas"];
  invokeCapability?: RealtimeVoiceControllerOptions["invokeCapability"];
  onThoughtDraftChange?: (text: string | null) => void;
  onActiveChange?: (active: boolean) => void;
  createController?: (
    options: RealtimeVoiceControllerOptions,
  ) => RealtimeVoiceControlController;
}

export interface RealtimeVoiceControlHandle {
  start: () => void;
  stop: () => void;
  toggle: () => void;
  isActive: () => boolean;
  cancelThoughtCapture: () => void;
}

interface VoiceActivity {
  id: number;
  speaker: "You" | "CommandCanvas" | "Action";
  text: string;
  tone: "neutral" | "success" | "error";
}

const stateLabels = {
  idle: "Voice off",
  connecting: "Connecting",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Speaking",
  error: "Voice error",
} as const;

const MAX_RECENT_SPOKEN_CONTEXT_TURNS = 4;
const MAX_TRACKED_VOICE_TURNS = 16;
const MAX_IGNORED_LATE_TURNS = 32;
const LEGACY_TURN_KEY = "legacy";

type VoiceIntentResult = RealtimeVoiceIntentResult;

interface BufferedVoiceTurn {
  key: string;
  thoughtCaptureActiveAtStart: boolean;
  transcriptReceived: boolean;
  transcriptAvailableForTool: boolean;
  pendingThoughtTranscripts: string[];
  pendingNarrationTranscripts: string[];
  commandTranscriptCount: number;
  suppressUpcomingTranscriptCount: number;
  provisionalText: string;
  responseOutcome?: RealtimeVoiceResponseOutcome;
}

class LatestVoiceHandlers {
  private recentSpokenContext: readonly string[] = [];
  private thoughtCaptureActive = false;
  private activeThoughtObjectId: string | null = null;
  private thoughtAppendQueue: Promise<void> = Promise.resolve();
  private currentTurnKey = LEGACY_TURN_KEY;
  private legacyTurn: BufferedVoiceTurn;
  private turns = new Map<string, BufferedVoiceTurn>();
  private orderedTurnKeys: string[] = [];
  private ignoredLateTurnIds = new Set<string>();
  private ignoredLateTurnOrder: string[] = [];
  private sessionGeneration = 0;
  private activeSessionSignal: AbortSignal | undefined;
  private draftTurnKey: string | null = null;

  constructor(
    private readToken: () => string | null,
    private submitIntent: RealtimeVoiceControllerOptions["onIntent"],
    private inspectSemanticCanvas: RealtimeVoiceControllerOptions["inspectCanvas"],
    private invokeCanonicalCapability: RealtimeVoiceControllerOptions["invokeCapability"],
    private publishThoughtDraft: (text: string | null) => void,
  ) {
    this.legacyTurn = this.createTurn(LEGACY_TURN_KEY);
  }

  update(
    readToken: () => string | null,
    submitIntent: RealtimeVoiceControllerOptions["onIntent"],
    inspectSemanticCanvas: RealtimeVoiceControllerOptions["inspectCanvas"],
    invokeCanonicalCapability: RealtimeVoiceControllerOptions["invokeCapability"],
    publishThoughtDraft: (text: string | null) => void,
  ) {
    this.readToken = readToken;
    this.submitIntent = submitIntent;
    this.inspectSemanticCanvas = inspectSemanticCanvas;
    this.invokeCanonicalCapability = invokeCanonicalCapability;
    this.publishThoughtDraft = publishThoughtDraft;
  }

  getAccessToken() {
    return this.readToken();
  }

  inspectCanvas(
    input: Parameters<NonNullable<RealtimeVoiceControllerOptions["inspectCanvas"]>>[0],
    signal: AbortSignal,
  ) {
    if (!this.inspectSemanticCanvas)
      throw new Error("Canvas inspection is unavailable.");
    return this.inspectSemanticCanvas(input, signal);
  }

  invokeCapability(
    ...args: Parameters<NonNullable<RealtimeVoiceControllerOptions["invokeCapability"]>>
  ) {
    if (!this.invokeCanonicalCapability)
      throw new Error("Canonical canvas capabilities are unavailable.");
    return this.invokeCanonicalCapability(...args);
  }

  consumeSketchNarration() {
    const narration = spokenNarration(this.recentSpokenContext);
    this.resetSpokenContext();
    return narration;
  }

  async onIntent(
    intent: DirectCanvasIntent,
    source: "voice",
    turnContext?: RealtimeVoiceTurnContext,
  ) {
    const turn = this.turnForContext(turnContext);
    if (intent.type !== "append_thought")
      this.reserveCurrentTranscriptForTool(turn);
    if (intent.type === "start_thought") {
      await this.thoughtAppendQueue;
      this.resetSpokenContext();
      const result = await this.submit(intent, source, turnContext);
      if (result.ok) {
        this.thoughtCaptureActive = true;
        this.activeThoughtObjectId = intent.objectId ?? null;
        this.activeSessionSignal = turnContext?.signal;
      }
      return result;
    }
    if (intent.type === "finish_thought") {
      await this.thoughtAppendQueue;
      const result = await this.submit(intent, source, turnContext);
      if (
        result.ok ||
        (!result.ok && result.thoughtCapture === "aborted")
      ) {
        this.thoughtCaptureActive = false;
        this.activeThoughtObjectId = null;
      }
      this.clearThoughtDraft();
      this.activeSessionSignal = undefined;
      return result;
    }
    if (this.thoughtCaptureActive && intent.type !== "append_thought") {
      await this.thoughtAppendQueue;
      if (this.thoughtCaptureActive)
        return {
          ok: false as const,
          message: "Finish the active thought before using other canvas commands.",
        };
    }
    await this.thoughtAppendQueue;
    if (intent.type === "open_sketch") {
      this.resetSpokenContext();
      return this.submit(intent, source, turnContext);
    }
    if (intent.type !== "transform_selected_sketch")
      return this.submit(intent, source, turnContext);

    const narration = spokenNarration(this.recentSpokenContext);
    this.resetSpokenContext();
    return this.submit(
      narration ? { ...intent, narration } : intent,
      source,
      turnContext,
    );
  }

  rememberTranscriptDelta(rawDelta: string, itemId?: string) {
    if (itemId && this.ignoredLateTurnIds.has(itemId)) return;
    const turn = this.turnForItem(itemId);
    const capturingThought =
      turn.key === LEGACY_TURN_KEY
        ? this.thoughtCaptureActive
        : turn.thoughtCaptureActiveAtStart;
    if (!capturingThought) return;
    turn.provisionalText = `${turn.provisionalText}${boundedDraftDelta(rawDelta)}`.slice(
      0,
      1_000,
    );
    if (isThoughtBoundaryDraft(turn.provisionalText)) {
      this.clearDraftForTurn(turn.key);
      return;
    }
    this.draftTurnKey = turn.key;
    this.publishThoughtDraft(turn.provisionalText || null);
  }

  rememberUserTranscript(rawText: string, itemId?: string) {
    const text = normalizeCompletedTranscript(rawText);
    if (!text || (itemId && this.ignoredLateTurnIds.has(itemId)))
      return Promise.resolve<VoiceIntentResult[]>([]);
    const turn = this.turnForItem(itemId);
    turn.transcriptReceived = true;
    if (turn.suppressUpcomingTranscriptCount > 0) {
      turn.suppressUpcomingTranscriptCount -= 1;
      return this.drainReadyTurns(turn);
    }
    const capturingThought =
      turn.key === LEGACY_TURN_KEY
        ? this.thoughtCaptureActive
        : turn.thoughtCaptureActiveAtStart;
    turn.transcriptAvailableForTool = true;
    if (capturingThought) {
      if (isThoughtBoundaryTranscript(text)) {
        turn.commandTranscriptCount += 1;
        this.clearDraftForTurn(turn.key);
      } else {
        turn.pendingThoughtTranscripts.push(text);
        turn.provisionalText = text;
        this.draftTurnKey = turn.key;
        this.publishThoughtDraft(text);
      }
      return this.drainReadyTurns(turn);
    }
    if (isCanvasCommandTranscript(text)) {
      turn.commandTranscriptCount += 1;
      return this.drainReadyTurns(turn);
    }
    turn.pendingNarrationTranscripts.push(text);
    return this.drainReadyTurns(turn);
  }

  beginUserTurn(itemId?: string) {
    if (itemId) {
      this.currentTurnKey = itemId;
      this.ensureTurn(itemId);
      return;
    }
    this.currentTurnKey = LEGACY_TURN_KEY;
    this.legacyTurn = this.createTurn(LEGACY_TURN_KEY);
  }

  settleResponse(outcome: RealtimeVoiceResponseOutcome, itemId?: string) {
    if (itemId && this.ignoredLateTurnIds.has(itemId))
      return Promise.resolve<VoiceIntentResult[]>([]);
    const turn = this.turnForItem(itemId);
    turn.responseOutcome = outcome;
    return this.drainReadyTurns(turn);
  }

  private reserveCurrentTranscriptForTool(turn: BufferedVoiceTurn) {
    if (turn.transcriptAvailableForTool) {
      turn.transcriptAvailableForTool = false;
      if (turn.pendingThoughtTranscripts.length > 0)
        turn.pendingThoughtTranscripts.pop();
      else if (turn.pendingNarrationTranscripts.length > 0)
        turn.pendingNarrationTranscripts.pop();
      else if (turn.commandTranscriptCount > 0)
        turn.commandTranscriptCount -= 1;
      return;
    }
    turn.suppressUpcomingTranscriptCount += 1;
  }

  private turnForContext(context?: RealtimeVoiceTurnContext) {
    return this.turnForItem(context?.itemId);
  }

  private turnForItem(itemId?: string) {
    if (itemId) return this.ensureTurn(itemId);
    if (this.currentTurnKey !== LEGACY_TURN_KEY)
      return this.ensureTurn(this.currentTurnKey);
    return this.legacyTurn;
  }

  private ensureTurn(itemId: string) {
    const existing = this.turns.get(itemId);
    if (existing) return existing;
    const turn = this.createTurn(itemId);
    this.turns.set(itemId, turn);
    this.orderedTurnKeys.push(itemId);
    while (this.orderedTurnKeys.length > MAX_TRACKED_VOICE_TURNS) {
      const expired = this.orderedTurnKeys.shift();
      if (!expired) break;
      this.turns.delete(expired);
      this.rememberIgnoredTurn(expired);
    }
    return turn;
  }

  private createTurn(key: string): BufferedVoiceTurn {
    return {
      key,
      thoughtCaptureActiveAtStart: this.thoughtCaptureActive,
      transcriptReceived: false,
      transcriptAvailableForTool: false,
      pendingThoughtTranscripts: [],
      pendingNarrationTranscripts: [],
      commandTranscriptCount: 0,
      suppressUpcomingTranscriptCount: 0,
      provisionalText: "",
    };
  }

  private drainReadyTurns(trigger: BufferedVoiceTurn) {
    if (trigger.key === LEGACY_TURN_KEY) {
      if (!trigger.responseOutcome) return Promise.resolve<VoiceIntentResult[]>([]);
      if (
        trigger.responseOutcome === "completed" &&
        !trigger.transcriptReceived
      )
        return Promise.resolve<VoiceIntentResult[]>([]);
      const operations = this.commitTurn(trigger);
      this.legacyTurn = this.createTurn(LEGACY_TURN_KEY);
      return Promise.all(operations);
    }

    const operations: Array<Promise<VoiceIntentResult>> = [];
    while (this.orderedTurnKeys.length > 0) {
      const key = this.orderedTurnKeys[0]!;
      const turn = this.turns.get(key);
      if (!turn) {
        this.orderedTurnKeys.shift();
        continue;
      }
      if (!turn.responseOutcome) break;
      if (turn.responseOutcome === "completed" && !turn.transcriptReceived)
        break;
      this.orderedTurnKeys.shift();
      this.turns.delete(key);
      this.rememberIgnoredTurn(key);
      operations.push(...this.commitTurn(turn));
    }
    return Promise.all(operations);
  }

  private commitTurn(turn: BufferedVoiceTurn) {
    if (turn.responseOutcome === "interrupted") {
      this.clearDraftForTurn(turn.key);
      return [];
    }
    turn.pendingNarrationTranscripts.forEach((text) => {
      this.recentSpokenContext = appendSpokenContext(
        this.recentSpokenContext,
        text,
      );
    });
    return turn.pendingThoughtTranscripts.map((text) =>
      this.queueThoughtAppend(text, turn.key),
    );
  }

  private rememberIgnoredTurn(itemId: string) {
    if (this.ignoredLateTurnIds.has(itemId)) return;
    this.ignoredLateTurnIds.add(itemId);
    this.ignoredLateTurnOrder.push(itemId);
    while (this.ignoredLateTurnOrder.length > MAX_IGNORED_LATE_TURNS) {
      const expired = this.ignoredLateTurnOrder.shift();
      if (expired) this.ignoredLateTurnIds.delete(expired);
    }
  }

  private queueThoughtAppend(text: string, turnKey: string) {
    const generation = this.sessionGeneration;
    const result = this.thoughtAppendQueue.then(async () => {
      let outcome: RealtimeVoiceIntentResult;
      if (
        generation !== this.sessionGeneration ||
        this.activeSessionSignal?.aborted
      ) {
        this.clearDraftForTurn(turnKey);
        return {
          ok: false as const,
          message: "Voice session ended before that thought was confirmed.",
          thoughtCapture: "aborted" as const,
        };
      }
      try {
        if (this.invokeCanonicalCapability && this.activeThoughtObjectId) {
          const capabilityResult = await this.invokeCanonicalCapability(
            "update_object_content",
            { objectId: this.activeThoughtObjectId, text },
            this.activeSessionSignal ?? new AbortController().signal,
          );
          outcome = capabilityResult.ok
            ? { ok: true, message: capabilityResult.message }
            : {
                ok: false,
                message: capabilityResult.message,
                ...(capabilityResult.code === "invalid_input"
                  ? { thoughtCapture: "aborted" as const }
                  : {}),
              };
        } else
          outcome = await this.submit(
            { type: "append_thought", text },
            "voice",
            this.activeSessionSignal
              ? { signal: this.activeSessionSignal }
              : undefined,
          );
      } catch {
        outcome = {
          ok: false as const,
          message: "That speech could not be added to the thought card.",
          thoughtCapture: "aborted",
        };
      }
      if (!outcome.ok && outcome.thoughtCapture === "aborted")
        this.thoughtCaptureActive = false;
      if (outcome.ok || outcome.thoughtCapture === "aborted")
        this.clearDraftForTurn(turnKey);
      return outcome;
    });
    this.thoughtAppendQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  resetSpokenContext() {
    this.recentSpokenContext = [];
  }

  resetSessionContext() {
    this.sessionGeneration += 1;
    this.clearThoughtDraft();
    this.resetSpokenContext();
    this.thoughtCaptureActive = false;
    this.activeThoughtObjectId = null;
    this.currentTurnKey = LEGACY_TURN_KEY;
    this.turns.clear();
    this.orderedTurnKeys = [];
    this.ignoredLateTurnIds.clear();
    this.ignoredLateTurnOrder = [];
    this.legacyTurn = this.createTurn(LEGACY_TURN_KEY);
    this.activeSessionSignal = undefined;
  }

  cancelThoughtCapture() {
    this.sessionGeneration += 1;
    this.clearThoughtDraft();
    this.thoughtCaptureActive = false;
    this.currentTurnKey = LEGACY_TURN_KEY;
    this.turns.clear();
    this.orderedTurnKeys = [];
    this.legacyTurn = this.createTurn(LEGACY_TURN_KEY);
    this.activeSessionSignal = undefined;
  }

  private submit(
    intent: DirectCanvasIntent,
    source: "voice",
    context?: RealtimeVoiceTurnContext,
  ) {
    return context
      ? this.submitIntent(intent, source, context)
      : this.submitIntent(intent, source);
  }

  private clearDraftForTurn(turnKey: string) {
    if (this.draftTurnKey !== turnKey) return;
    this.clearThoughtDraft();
  }

  private clearThoughtDraft() {
    if (this.draftTurnKey === null) return;
    this.draftTurnKey = null;
    this.publishThoughtDraft(null);
  }
}

export const RealtimeVoiceControl = forwardRef<
  RealtimeVoiceControlHandle,
  RealtimeVoiceControlProps
>(function RealtimeVoiceControl({
  roomId,
  getAccessToken,
  openAiApiKey: controlledOpenAiApiKey,
  onOpenAiApiKeyChange,
  useSavedOpenAiCredential = false,
  onUseSavedOpenAiCredentialChange,
  savedOpenAiCredential,
  disabled = false,
  onIntent,
  inspectCanvas,
  invokeCapability,
  onThoughtDraftChange = () => undefined,
  onActiveChange,
  createController = createRealtimeVoiceController,
}, ref) {
  const [activity, setActivity] = useState<VoiceActivity[]>([]);
  const [playbackBlocked, setPlaybackBlocked] = useState(false);
  const [localOpenAiApiKey, setLocalOpenAiApiKey] = useState("");
  const [deleteConfirmationOpen, setDeleteConfirmationOpen] = useState(false);
  const [replacementOpen, setReplacementOpen] = useState(false);
  const openAiApiKey = controlledOpenAiApiKey ?? localOpenAiApiKey;
  const updateOpenAiApiKey =
    onOpenAiApiKeyChange ?? setLocalOpenAiApiKey;
  const capabilityInvocationAvailable = Boolean(invokeCapability);
  const [latestHandlers] = useState(
    () =>
      new LatestVoiceHandlers(
        getAccessToken,
        onIntent,
        inspectCanvas,
        invokeCapability,
        onThoughtDraftChange,
      ),
  );

  useEffect(() => {
    latestHandlers.update(
      getAccessToken,
      onIntent,
      inspectCanvas,
      invokeCapability,
      onThoughtDraftChange,
    );
  }, [
    getAccessToken,
    inspectCanvas,
    invokeCapability,
    latestHandlers,
    onIntent,
    onThoughtDraftChange,
  ]);

  const appendActivity = useCallback((entry: Omit<VoiceActivity, "id">) => {
    setActivity((current) =>
      [
        ...current,
        { ...entry, id: (current.at(-1)?.id ?? 0) + 1 },
      ].slice(-6),
    );
  }, []);

  const readLatestAccessToken = useCallback(
    () => latestHandlers.getAccessToken(),
    [latestHandlers],
  );
  const submitLatestIntent = useCallback<
    RealtimeVoiceControllerOptions["onIntent"]
  >(
    (intent, source, turn) => latestHandlers.onIntent(intent, source, turn),
    [latestHandlers],
  );
  const inspectLatestCanvas = useCallback<
    NonNullable<RealtimeVoiceControllerOptions["inspectCanvas"]>
  >(
    (input, signal) => latestHandlers.inspectCanvas(input, signal),
    [latestHandlers],
  );
  const invokeLatestCapability = useCallback<
    NonNullable<RealtimeVoiceControllerOptions["invokeCapability"]>
  >(
    (capability, input, signal) =>
      latestHandlers.invokeCapability(capability, input, signal),
    [latestHandlers],
  );
  const consumeLatestSketchNarration = useCallback(
    () => latestHandlers.consumeSketchNarration(),
    [latestHandlers],
  );

  const reportThoughtResults = useCallback(
    (results: readonly VoiceIntentResult[]) => {
      results.forEach((result) => {
        if (result.ok) return;
        appendActivity({
          speaker: "Action",
          text: result.message,
          tone: "error",
        });
      });
    },
    [appendActivity],
  );

  const controller = useMemo(
    () =>
      createController({
        roomId,
        getAccessToken: readLatestAccessToken,
        onIntent: submitLatestIntent,
        onTranscript(text, itemId) {
          appendActivity({ speaker: "You", text, tone: "neutral" });
          void latestHandlers
            .rememberUserTranscript(text, itemId)
            .then(reportThoughtResults);
        },
        onTranscriptDelta(delta, itemId) {
          latestHandlers.rememberTranscriptDelta(delta, itemId);
        },
        onUserSpeechStarted(itemId) {
          latestHandlers.beginUserTurn(itemId);
        },
        onResponseSettled(outcome, itemId) {
          void latestHandlers
            .settleResponse(outcome, itemId)
            .then(reportThoughtResults);
        },
        onAssistantTranscript(text) {
          appendActivity({
            speaker: "CommandCanvas",
            text,
            tone: "neutral",
          });
        },
        onToolAction(action) {
          const entry = toolActivity(action);
          if (entry) appendActivity(entry);
        },
        onStatusChange(status) {
          if (status === "error") latestHandlers.resetSessionContext();
        },
        inspectCanvas: inspectLatestCanvas,
        ...(capabilityInvocationAvailable
          ? { invokeCapability: invokeLatestCapability }
          : {}),
        consumeSketchNarration: consumeLatestSketchNarration,
        onPlaybackBlocked() {
          setPlaybackBlocked(true);
        },
      }),
    [
      appendActivity,
      createController,
      latestHandlers,
      readLatestAccessToken,
      reportThoughtResults,
      roomId,
      submitLatestIntent,
      inspectLatestCanvas,
      capabilityInvocationAvailable,
      invokeLatestCapability,
      consumeLatestSketchNarration,
    ],
  );
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getState,
    controller.getState,
  );

  useEffect(
    () => () => {
      latestHandlers.resetSessionContext();
      controller.stop();
    },
    [controller, latestHandlers],
  );

  useEffect(() => {
    if (disabled && state.status !== "idle") {
      latestHandlers.resetSessionContext();
      controller.stop();
    }
  }, [controller, disabled, latestHandlers, state.status]);

  const active = ["connecting", "listening", "thinking", "speaking"].includes(
    state.status,
  );

  useEffect(() => {
    onActiveChange?.(active);
  }, [active, onActiveChange]);

  const startVoice = useCallback(() => {
    if (disabled || active) return;
    latestHandlers.resetSessionContext();
    setPlaybackBlocked(false);
    void controller.start(
      useSavedOpenAiCredential
        ? { useSavedOpenAiCredential: true }
        : { openAiApiKey },
    );
  }, [
    active,
    controller,
    disabled,
    latestHandlers,
    openAiApiKey,
    useSavedOpenAiCredential,
  ]);

  const stopVoice = useCallback(() => {
    if (!active) return;
    latestHandlers.resetSessionContext();
    controller.stop();
  }, [active, controller, latestHandlers]);

  useImperativeHandle(
    ref,
    () => ({
      start: startVoice,
      stop: stopVoice,
      toggle: active ? stopVoice : startVoice,
      isActive: () => active,
      cancelThoughtCapture: () => latestHandlers.cancelThoughtCapture(),
    }),
    [active, latestHandlers, startVoice, stopVoice],
  );

  return (
    <section className="realtime-voice-control" aria-label="Live voice command">
      <div className="realtime-voice-heading">
        <div>
          <strong>Live voice</strong>
          <span>GPT Realtime 2.1 · automatic turn detection</span>
        </div>
        <button
          type="button"
          aria-label={active ? "Stop live voice" : "Start live voice"}
          disabled={!active && disabled}
          onClick={() => {
            if (active) stopVoice();
            else startVoice();
          }}
        >
          {active ? "Stop" : "Start"}
        </button>
      </div>
      <div className="realtime-voice-credential">
        {!savedOpenAiCredential?.configured || replacementOpen ? (
          <label>
            <span>
              {savedOpenAiCredential?.configured
                ? "Replacement OpenAI API key"
                : "Your OpenAI API key"}
            </span>
            <input
              type="password"
              name="commandcanvas-openai-api-key"
              value={openAiApiKey}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              disabled={active || savedOpenAiCredential?.busy}
              placeholder="sk-…"
              onChange={(event) => {
                const value = event.currentTarget.value;
                updateOpenAiApiKey(value);
                if (value.length > 0)
                  onUseSavedOpenAiCredentialChange?.(false);
              }}
            />
          </label>
        ) : null}
        {savedOpenAiCredential?.configured ? (
          <div className="realtime-voice-saved-credential" role="status">
            <span>
              Saved to your CommandCanvas account and selected automatically
              when you sign in
            </span>
            {savedOpenAiCredential.fingerprint ? (
              <strong>{savedOpenAiCredential.fingerprint}</strong>
            ) : null}
            {!useSavedOpenAiCredential ? (
              <button
                type="button"
                disabled={active || savedOpenAiCredential.busy}
                onClick={() => {
                  updateOpenAiApiKey("");
                  onUseSavedOpenAiCredentialChange?.(true);
                }}
              >
                Use saved key
              </button>
            ) : null}
            {!replacementOpen ? (
              <button
                type="button"
                disabled={active || savedOpenAiCredential.busy}
                onClick={() => {
                  updateOpenAiApiKey("");
                  setReplacementOpen(true);
                }}
              >
                Replace saved key
              </button>
            ) : null}
            {deleteConfirmationOpen ? (
              <div
                className="realtime-voice-credential-actions"
                role="alertdialog"
                aria-label="Confirm saved OpenAI key removal"
              >
                <span>Remove saved OpenAI key? This cannot be undone.</span>
                <button
                  type="button"
                  disabled={active || savedOpenAiCredential.busy}
                  onClick={() => setDeleteConfirmationOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  aria-label="Confirm remove saved key"
                  disabled={active || savedOpenAiCredential.busy}
                  onClick={() => {
                    setDeleteConfirmationOpen(false);
                    void savedOpenAiCredential.onDelete();
                  }}
                >
                  Remove key
                </button>
              </div>
            ) : (
              <button
                type="button"
                disabled={active || savedOpenAiCredential.busy}
                onClick={() => setDeleteConfirmationOpen(true)}
              >
                Remove saved key
              </button>
            )}
          </div>
        ) : null}
        {replacementOpen ? (
          <div className="realtime-voice-credential-actions">
            <button
              type="button"
              disabled={active || savedOpenAiCredential?.busy}
              onClick={() => {
                updateOpenAiApiKey("");
                setReplacementOpen(false);
                onUseSavedOpenAiCredentialChange?.(true);
              }}
            >
              Cancel replacement
            </button>
            <button
              type="button"
              disabled={
                active || savedOpenAiCredential?.busy || !openAiApiKey.trim()
              }
              onClick={() => {
                void Promise.resolve(
                  savedOpenAiCredential?.onSave(openAiApiKey),
                ).then(() => setReplacementOpen(false));
              }}
            >
              Save replacement
            </button>
          </div>
        ) : openAiApiKey ? (
          <div className="realtime-voice-credential-actions">
            <button
              type="button"
              aria-label="Clear OpenAI API key"
              disabled={active || savedOpenAiCredential?.busy}
              onClick={() => updateOpenAiApiKey("")}
            >
              Clear
            </button>
            {savedOpenAiCredential ? (
              <button
                type="button"
                aria-label="Save key to my account"
                disabled={active || savedOpenAiCredential.busy}
                onClick={() => void savedOpenAiCredential.onSave(openAiApiKey)}
              >
                Save to account
              </button>
            ) : null}
          </div>
        ) : null}
        {savedOpenAiCredential?.error ? (
          <p role="alert">{savedOpenAiCredential.error}</p>
        ) : null}
        <p>
          {savedOpenAiCredential
            ? "Live Voice and visual interpretation use your own OpenAI API billing. Signed-in users can save an encrypted key to their CommandCanvas account; its raw value is never returned to this browser."
            : "Optional Live Voice and direct sketch interpretation use your own API billing. The key stays in this tab's memory, is sent transiently through CommandCanvas to OpenAI, and is never saved."}
        </p>
      </div>
      <div
        className={`realtime-voice-state voice-state-${state.status}`}
        role="status"
        aria-live="polite"
      >
        <span aria-hidden="true" className="realtime-voice-pulse" />
        <strong>{stateLabels[state.status]}</strong>
        <span>
          {state.status === "idle"
            ? "Start once, then speak naturally. No Run button."
            : state.status === "connecting"
              ? "Securing the microphone and live session…"
              : state.status === "listening"
                ? "Speak a canvas command whenever you are ready."
                : state.status === "thinking"
                  ? "Interpreting your request and validating the action."
                  : state.status === "speaking"
                    ? "Responding while the canvas stays interactive."
                    : state.status === "error"
                      ? state.message
                      : ""}
        </span>
      </div>
      {playbackBlocked ? (
        <button
          type="button"
          className="realtime-voice-resume-audio"
          aria-label="Tap to hear responses"
          onClick={() => {
            void controller.resumeAudio().then((resumed) => {
              if (resumed) setPlaybackBlocked(false);
            });
          }}
        >
          Tap to hear responses
        </button>
      ) : null}
      {activity.length > 0 ? (
        <ol className="realtime-voice-activity" aria-label="Live voice transcript">
          {activity.map((entry) => (
            <li key={entry.id} data-tone={entry.tone}>
              <strong>{entry.speaker}</strong>
              <span>{entry.text}</span>
            </li>
          ))}
        </ol>
      ) : null}
      <p className="realtime-voice-privacy">
        ChatGPT Site Tools use the account signed into ChatGPT and do not need
        this key. For embedded Live Voice, audio travels to OpenAI only while
        voice is on. Canvas mutations still pass through the same validated
        command and receipt pipeline.
      </p>
    </section>
  );
});

function appendSpokenContext(
  current: readonly string[],
  rawText: string,
): readonly string[] {
  const text = rawText.replace(/\s+/g, " ").trim();
  if (!text) return current;
  const turns = [...current, text].slice(-MAX_RECENT_SPOKEN_CONTEXT_TURNS);
  while (
    turns.length > 1 &&
    turns.join("\n").length > MAX_DIAGRAM_TRANSFORM_NARRATION_CHARS
  )
    turns.shift();
  return turns;
}

function normalizeCompletedTranscript(rawText: string) {
  return rawText.replace(/\s+/g, " ").trim();
}

function boundedDraftDelta(rawDelta: string) {
  return rawDelta
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .slice(0, 1_000);
}

function isThoughtBoundaryDraft(text: string) {
  return /^(finish|finish thought|stop|stop thought|end|end thought)(?:\s|[.!?]|$)/i.test(
    text.trim(),
  );
}

function isCanvasCommandTranscript(text: string) {
  return parseDirectCanvasCommand(text).ok;
}

function isThoughtBoundaryTranscript(text: string) {
  const parsed = parseDirectCanvasCommand(text);
  return (
    parsed.ok &&
    (parsed.intent.type === "start_thought" ||
      parsed.intent.type === "finish_thought")
  );
}

function spokenNarration(turns: readonly string[]): string | undefined {
  const narration = turns.join("\n").trim();
  if (!narration) return undefined;
  return narration.slice(0, MAX_DIAGRAM_TRANSFORM_NARRATION_CHARS);
}

function toolActivity(
  action: RealtimeVoiceToolAction,
): Omit<VoiceActivity, "id"> | null {
  if (action.status === "running")
    return {
      speaker: "Action",
      text: `Running ${humanizeToolName(action.name)}…`,
      tone: "neutral",
    };
  return {
    speaker: "Action",
    text:
      action.message ??
      (action.status === "submitted"
        ? `${humanizeToolName(action.name)} submitted; waiting for the shared receipt.`
        : action.status === "observed"
          ? `${humanizeToolName(action.name)} observed the current canvas.`
          : action.status === "cancelled"
            ? `${humanizeToolName(action.name)} was cancelled.`
        : `${humanizeToolName(action.name)} was refused.`),
    tone:
      action.status === "submitted" || action.status === "observed"
        ? "neutral"
        : "error",
  };
}

function humanizeToolName(name: string) {
  return name.replaceAll("_", " ");
}
