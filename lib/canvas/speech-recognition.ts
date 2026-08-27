export type SpeechRecognitionState = "idle" | "listening";

export interface BrowserSpeechRecognitionAlternativeLike {
  readonly transcript: string;
  readonly confidence: number;
}

export interface BrowserSpeechRecognitionResultLike {
  readonly isFinal: boolean;
  readonly length: number;
  readonly [index: number]: BrowserSpeechRecognitionAlternativeLike;
}

export interface BrowserSpeechRecognitionResultListLike {
  readonly length: number;
  readonly [index: number]: BrowserSpeechRecognitionResultLike;
}

export interface BrowserSpeechRecognitionResultEventLike {
  readonly resultIndex: number;
  readonly results: BrowserSpeechRecognitionResultListLike;
}

export interface BrowserSpeechRecognitionErrorEventLike {
  readonly error: string;
  readonly message?: string;
}

export interface BrowserSpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: ((event: Event) => void) | null;
  onresult: ((event: BrowserSpeechRecognitionResultEventLike) => void) | null;
  onerror: ((event: BrowserSpeechRecognitionErrorEventLike) => void) | null;
  onend: ((event: Event) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export interface BrowserSpeechRecognitionConstructor {
  new (): BrowserSpeechRecognitionLike;
}

export interface BrowserSpeechRecognizer {
  readonly supported: boolean;
  start(): void;
  stop(): void;
  dispose(): void;
}

export interface BrowserSpeechRecognizerOptions {
  SpeechRecognition?: BrowserSpeechRecognitionConstructor | null;
  navigatorLanguage?: string;
  onTranscript?: (transcript: string) => void;
  onStateChange?: (state: SpeechRecognitionState) => void;
  onError?: (message: string) => void;
}

interface SpeechRecognitionGlobal {
  SpeechRecognition?: BrowserSpeechRecognitionConstructor;
  webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
  navigator?: { language?: string };
}

const UNSUPPORTED_MESSAGE = "Browser speech transcription is unavailable.";

export function createBrowserSpeechRecognizer(
  options: BrowserSpeechRecognizerOptions = {},
): BrowserSpeechRecognizer {
  const root = globalThis as unknown as SpeechRecognitionGlobal;
  const Recognition =
    options.SpeechRecognition ??
    root.SpeechRecognition ??
    root.webkitSpeechRecognition ??
    null;
  if (!Recognition)
    return {
      supported: false,
      start() {
        throw new Error(UNSUPPORTED_MESSAGE);
      },
      stop() {},
      dispose() {},
    };

  const recognition = new Recognition();
  let disposed = false;
  recognition.lang = options.navigatorLanguage ?? root.navigator?.language ?? "en-US";
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;
  recognition.onstart = () => {
    if (disposed) return;
    options.onStateChange?.("listening");
  };
  recognition.onresult = (event) => {
    if (disposed) return;
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      const alternative = result?.[0];
      if (!result?.isFinal || !alternative) continue;
      const transcript = alternative.transcript.replace(/\s+/g, " ").trim();
      if (transcript) options.onTranscript?.(transcript.slice(0, 280));
      break;
    }
  };
  recognition.onerror = (event) => {
    if (disposed) return;
    options.onStateChange?.("idle");
    options.onError?.(speechErrorMessage(event.error));
  };
  recognition.onend = () => {
    if (disposed) return;
    options.onStateChange?.("idle");
  };

  return {
    supported: true,
    start() {
      if (disposed) throw new Error(UNSUPPORTED_MESSAGE);
      recognition.start();
    },
    stop() {
      if (disposed) return;
      recognition.abort();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      try {
        recognition.abort();
      } catch {
        // Some engines throw when an idle recognizer is aborted during cleanup.
      }
      recognition.onstart = null;
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
    },
  };
}

function speechErrorMessage(code: string) {
  switch (code) {
    case "not-allowed":
    case "service-not-allowed":
      return "Microphone or speech-recognition permission was not granted.";
    case "audio-capture":
      return "No usable microphone was found.";
    case "no-speech":
      return "No speech was detected. Try again or type the command.";
    case "network":
      return "Browser speech transcription could not reach its provider.";
    default:
      return "Browser speech transcription stopped before producing a command.";
  }
}
