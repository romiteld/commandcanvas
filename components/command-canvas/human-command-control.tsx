"use client";

import { useEffect, useId, useRef, useState } from "react";

import {
  parseDirectCanvasCommand,
  type DirectCanvasIntent,
} from "@/lib/canvas/direct-command";
import {
  createBrowserSpeechRecognizer,
  type BrowserSpeechRecognizer,
  type BrowserSpeechRecognizerOptions,
  type SpeechRecognitionState,
} from "@/lib/canvas/speech-recognition";

export type HumanCommandSource = "typed" | "voice";

export type HumanCommandResult =
  | { ok: true; message: string }
  | { ok: false; message: string };

export interface HumanCommandObjectSnapshot {
  objectId: string;
  title: string;
  version: number;
}

export interface HumanCommandControlProps {
  disabled?: boolean;
  allowBrowserSpeech?: boolean;
  onIntent: (
    intent: DirectCanvasIntent,
    source: HumanCommandSource,
    target?: HumanCommandObjectSnapshot,
  ) => HumanCommandResult;
  selectedObject?: HumanCommandObjectSnapshot | null;
  createSpeechRecognizer?: (
    options: BrowserSpeechRecognizerOptions,
  ) => BrowserSpeechRecognizer;
}

type CommandFeedback =
  | { tone: "idle"; message: string }
  | { tone: "ready" | "error"; message: string };

export function HumanCommandControl({
  disabled = false,
  allowBrowserSpeech = true,
  onIntent,
  selectedObject = null,
  createSpeechRecognizer = createBrowserSpeechRecognizer,
}: HumanCommandControlProps) {
  const [command, setCommand] = useState("");
  const [source, setSource] = useState<HumanCommandSource>("typed");
  const [speechState, setSpeechState] =
    useState<SpeechRecognitionState>("idle");
  const [speechSupported, setSpeechSupported] = useState(false);
  const [feedback, setFeedback] = useState<CommandFeedback>({
    tone: "idle",
    message: "Try: Bring in our project board",
  });
  const [pendingDiscard, setPendingDiscard] = useState<{
    intent: Extract<DirectCanvasIntent, { type: "discard_selected" }>;
    source: HumanCommandSource;
    target: HumanCommandObjectSnapshot;
  } | null>(null);
  const speechRecognizerRef = useRef<BrowserSpeechRecognizer | null>(null);
  const runButtonRef = useRef<HTMLButtonElement>(null);
  const cancelDiscardButtonRef = useRef<HTMLButtonElement>(null);
  const discardWasOpenRef = useRef(false);
  const discardTitleId = useId();

  useEffect(() => {
    if (!allowBrowserSpeech) return;
    const speechRecognizer = createSpeechRecognizer({
      onTranscript(transcript) {
        setCommand(transcript);
        setSource("voice");
        setFeedback({
          tone: "ready",
          message: "Transcript ready. Review it, then run the direct command.",
        });
      },
      onStateChange: setSpeechState,
      onError(message) {
        setFeedback({ tone: "error", message });
      },
    });
    speechRecognizerRef.current = speechRecognizer;
    // The Web Speech API is browser-only, so support must be resolved after hydration.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSpeechSupported(speechRecognizer.supported);
    return () => {
      speechRecognizer.dispose();
      speechRecognizerRef.current = null;
    };
  }, [allowBrowserSpeech, createSpeechRecognizer]);

  useEffect(() => {
    if (disabled && speechState === "listening")
      speechRecognizerRef.current?.stop();
  }, [disabled, speechState]);

  useEffect(() => {
    if (pendingDiscard) {
      discardWasOpenRef.current = true;
      cancelDiscardButtonRef.current?.focus();
      return;
    }
    if (!discardWasOpenRef.current) return;
    discardWasOpenRef.current = false;
    runButtonRef.current?.focus();
  }, [pendingDiscard]);

  function submit() {
    if (disabled) return;
    const parsed = parseDirectCanvasCommand(command);
    if (!parsed.ok) {
      setPendingDiscard(null);
      setFeedback({ tone: "error", message: parsed.message });
      return;
    }
    if (parsed.intent.type === "discard_selected") {
      if (!selectedObject) {
        applyIntent(parsed.intent, source);
        return;
      }
      setPendingDiscard({
        intent: parsed.intent,
        source,
        target: { ...selectedObject },
      });
      setFeedback({
        tone: "ready",
        message: "Confirm the recoverable discard before it is applied.",
      });
      return;
    }
    applyIntent(parsed.intent, source);
  }

  function applyIntent(
    intent: DirectCanvasIntent,
    intentSource: HumanCommandSource,
    target?: HumanCommandObjectSnapshot,
  ) {
    const result = target
      ? onIntent(intent, intentSource, target)
      : onIntent(intent, intentSource);
    setPendingDiscard(null);
    setFeedback({
      tone: result.ok ? "ready" : "error",
      message: result.message,
    });
    if (result.ok) setCommand("");
  }

  const listening = speechState === "listening";
  const speechRecognizer = speechRecognizerRef.current;

  return (
    <section className="human-command-control" aria-label="Direct human command">
      <div className="human-command-heading">
        <div>
          <strong>Human command</strong>
          <span>
            {listening
              ? "Listening…"
              : allowBrowserSpeech
                ? "Typed or browser-transcribed"
                : "Type a canvas command"}
          </span>
        </div>
        {allowBrowserSpeech ? (
          <button
          type="button"
          aria-label={
            speechSupported
              ? listening
                ? "Stop voice transcription"
                : "Start voice transcription"
              : "Voice transcription unavailable"
          }
          disabled={!listening && (disabled || !speechSupported)}
          onClick={() => {
            if (!speechRecognizer) return;
            if (listening) speechRecognizer.stop();
            else {
              try {
                speechRecognizer.start();
              } catch (error) {
                setFeedback({
                  tone: "error",
                  message:
                    error instanceof Error
                      ? error.message
                      : "Browser speech transcription is unavailable.",
                });
              }
            }
          }}
        >
          {listening ? "Stop" : "Speak"}
          </button>
        ) : null}
      </div>
      <form
        className="human-command-form"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <input
          type="text"
          aria-label="Direct canvas command"
          value={command}
          maxLength={280}
          disabled={disabled}
          placeholder="Bring in our project board"
          onChange={(event) => {
            setCommand(event.target.value);
            setSource("typed");
            setPendingDiscard(null);
          }}
        />
        <button
          ref={runButtonRef}
          type="submit"
          aria-label="Run direct command"
          disabled={disabled || command.trim().length === 0}
        >
          Run
        </button>
      </form>
      <p>
        Direct shortcuts use the human command path. Agent actions arrive
        through WebMCP.
      </p>
      <span
        className={`human-command-feedback feedback-${feedback.tone}`}
        role="status"
        aria-live="polite"
      >
        {feedback.message}
      </span>
      {pendingDiscard ? (
        <div
          className="human-command-confirmation"
          role="alertdialog"
          aria-modal="false"
          aria-labelledby={discardTitleId}
          onKeyDown={(event) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            setPendingDiscard(null);
            setFeedback({ tone: "idle", message: "Discard cancelled." });
          }}
        >
          <p id={discardTitleId}>
            Move {pendingDiscard.target.title} to recoverable trash?
          </p>
          <div>
            <button
              ref={cancelDiscardButtonRef}
              type="button"
              aria-label="Cancel recoverable discard"
              onClick={() => {
                setPendingDiscard(null);
                setFeedback({ tone: "idle", message: "Discard cancelled." });
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              aria-label="Confirm recoverable discard"
              onClick={() =>
                applyIntent(
                  pendingDiscard.intent,
                  pendingDiscard.source,
                  pendingDiscard.target,
                )
              }
            >
              Move to trash
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
