import { describe, expect, it, vi } from "vitest";

import {
  createBrowserSpeechRecognizer,
  type BrowserSpeechRecognitionConstructor,
  type BrowserSpeechRecognitionLike,
} from "@/lib/canvas/speech-recognition";

function speechHarness() {
  const instances: BrowserSpeechRecognitionLike[] = [];
  const Recognition = vi.fn(function Recognition(
    this: BrowserSpeechRecognitionLike,
  ) {
    this.lang = "";
    this.continuous = true;
    this.interimResults = true;
    this.maxAlternatives = 0;
    this.start = vi.fn();
    this.stop = vi.fn();
    this.abort = vi.fn();
    this.onstart = null;
    this.onresult = null;
    this.onerror = null;
    this.onend = null;
    instances.push(this);
  }) as unknown as BrowserSpeechRecognitionConstructor;
  return {
    Recognition,
    get instance() {
      return instances.at(-1) ?? null;
    },
  };
}

describe("createBrowserSpeechRecognizer", () => {
  it("reports unsupported without inventing a microphone path", () => {
    const recognizer = createBrowserSpeechRecognizer({ navigatorLanguage: "en-US" });

    expect(recognizer.supported).toBe(false);
    expect(() => recognizer.start()).toThrow(
      "Browser speech transcription is unavailable.",
    );
  });

  it("configures one bounded final transcript and exposes lifecycle events", () => {
    const harness = speechHarness();
    const transcripts: string[] = [];
    const states: string[] = [];
    const errors: string[] = [];
    const recognizer = createBrowserSpeechRecognizer({
      SpeechRecognition: harness.Recognition,
      navigatorLanguage: "en-GB",
      onTranscript: (value) => transcripts.push(value),
      onStateChange: (state) => states.push(state),
      onError: (message) => errors.push(message),
    });

    recognizer.start();
    const instance = harness.instance;
    if (!instance) throw new Error("Speech recognition was not constructed.");
    expect(instance.lang).toBe("en-GB");
    expect(instance.continuous).toBe(false);
    expect(instance.interimResults).toBe(false);
    expect(instance.maxAlternatives).toBe(1);
    expect(instance.start).toHaveBeenCalledOnce();

    instance.onstart?.(new Event("start"));
    instance.onresult?.({
      resultIndex: 0,
      results: {
        length: 1,
        0: {
          isFinal: true,
          length: 1,
          0: { transcript: "  Bring in our project board  ", confidence: 0.93 },
        },
      },
    });
    instance.onend?.(new Event("end"));

    expect(transcripts).toEqual(["Bring in our project board"]);
    expect(states).toEqual(["listening", "idle"]);
    expect(errors).toEqual([]);
  });

  it("maps provider errors to compact user-facing messages and aborts cleanly", () => {
    const harness = speechHarness();
    const errors: string[] = [];
    const recognizer = createBrowserSpeechRecognizer({
      SpeechRecognition: harness.Recognition,
      navigatorLanguage: "en-US",
      onError: (message) => errors.push(message),
    });

    recognizer.start();
    const instance = harness.instance;
    if (!instance) throw new Error("Speech recognition was not constructed.");
    instance.onerror?.({ error: "not-allowed", message: "secret vendor detail" });
    recognizer.stop();

    expect(errors).toEqual([
      "Microphone or speech-recognition permission was not granted.",
    ]);
    expect(instance.abort).toHaveBeenCalledOnce();
  });

  it("disposes native handlers and ignores events already queued by the provider", () => {
    const harness = speechHarness();
    const transcripts: string[] = [];
    const states: string[] = [];
    const errors: string[] = [];
    const recognizer = createBrowserSpeechRecognizer({
      SpeechRecognition: harness.Recognition,
      onTranscript: (value) => transcripts.push(value),
      onStateChange: (state) => states.push(state),
      onError: (message) => errors.push(message),
    });
    const instance = harness.instance;
    if (!instance) throw new Error("Speech recognition was not constructed.");
    const lateStart = instance.onstart;
    const lateResult = instance.onresult;
    const lateError = instance.onerror;
    const lateEnd = instance.onend;

    recognizer.dispose();
    lateStart?.(new Event("start"));
    lateResult?.({
      resultIndex: 0,
      results: {
        length: 1,
        0: {
          isFinal: true,
          length: 1,
          0: { transcript: "Discard this", confidence: 0.99 },
        },
      },
    });
    lateError?.({ error: "network" });
    lateEnd?.(new Event("end"));

    expect(instance.abort).toHaveBeenCalledOnce();
    expect(instance.onstart).toBeNull();
    expect(instance.onresult).toBeNull();
    expect(instance.onerror).toBeNull();
    expect(instance.onend).toBeNull();
    expect(transcripts).toEqual([]);
    expect(states).toEqual([]);
    expect(errors).toEqual([]);
  });
});
