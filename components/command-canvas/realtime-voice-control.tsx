"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";

import type { DirectCanvasIntent } from "@/lib/canvas/direct-command";
import {
  createRealtimeVoiceController,
  type RealtimeVoiceController,
  type RealtimeVoiceControllerOptions,
  type RealtimeVoiceToolAction,
} from "@/lib/realtime-voice/client";

export type RealtimeVoiceControlController = RealtimeVoiceController;

export interface RealtimeVoiceControlProps {
  roomId: string;
  getAccessToken: () => string | null;
  disabled?: boolean;
  onIntent: (
    intent: DirectCanvasIntent,
    source: "voice",
  ) =>
    | { ok: true; message: string }
    | { ok: false; message: string }
    | Promise<{ ok: true; message: string } | { ok: false; message: string }>;
  createController?: (
    options: RealtimeVoiceControllerOptions,
  ) => RealtimeVoiceControlController;
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

class LatestVoiceHandlers {
  constructor(
    private readToken: () => string | null,
    private submitIntent: RealtimeVoiceControllerOptions["onIntent"],
  ) {}

  update(
    readToken: () => string | null,
    submitIntent: RealtimeVoiceControllerOptions["onIntent"],
  ) {
    this.readToken = readToken;
    this.submitIntent = submitIntent;
  }

  getAccessToken() {
    return this.readToken();
  }

  onIntent(
    ...args: Parameters<RealtimeVoiceControllerOptions["onIntent"]>
  ) {
    return this.submitIntent(...args);
  }
}

export function RealtimeVoiceControl({
  roomId,
  getAccessToken,
  disabled = false,
  onIntent,
  createController = createRealtimeVoiceController,
}: RealtimeVoiceControlProps) {
  const [activity, setActivity] = useState<VoiceActivity[]>([]);
  const [playbackBlocked, setPlaybackBlocked] = useState(false);
  const [latestHandlers] = useState(
    () => new LatestVoiceHandlers(getAccessToken, onIntent),
  );

  useEffect(() => {
    latestHandlers.update(getAccessToken, onIntent);
  }, [getAccessToken, latestHandlers, onIntent]);

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
    (intent, source) => latestHandlers.onIntent(intent, source),
    [latestHandlers],
  );

  const controller = useMemo(
    () =>
      createController({
        roomId,
        getAccessToken: readLatestAccessToken,
        onIntent: submitLatestIntent,
        onTranscript(text) {
          appendActivity({ speaker: "You", text, tone: "neutral" });
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
        onPlaybackBlocked() {
          setPlaybackBlocked(true);
        },
      }),
    [
      appendActivity,
      createController,
      readLatestAccessToken,
      roomId,
      submitLatestIntent,
    ],
  );
  const state = useSyncExternalStore(
    controller.subscribe,
    controller.getState,
    controller.getState,
  );

  useEffect(() => () => controller.stop(), [controller]);

  useEffect(() => {
    if (disabled && state.status !== "idle") controller.stop();
  }, [controller, disabled, state.status]);

  const active = ["connecting", "listening", "thinking", "speaking"].includes(
    state.status,
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
            if (active) controller.stop();
            else {
              setPlaybackBlocked(false);
              void controller.start();
            }
          }}
        >
          {active ? "Stop" : "Start"}
        </button>
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
        Audio travels to OpenAI only while live voice is on. Canvas mutations
        still pass through the same validated command and receipt pipeline.
      </p>
    </section>
  );
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
        : `${humanizeToolName(action.name)} was refused.`),
    tone: action.status === "submitted" ? "neutral" : "error",
  };
}

function humanizeToolName(name: string) {
  return name.replaceAll("_", " ");
}
