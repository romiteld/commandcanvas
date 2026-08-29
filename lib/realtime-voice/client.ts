import type { DirectCanvasIntent } from "@/lib/canvas/direct-command";
import {
  executeRealtimeVoiceTool,
  type RealtimeVoiceCanvasInspector,
  type RealtimeVoiceIntentResult,
} from "@/lib/realtime-voice/tools";

export type RealtimeVoiceStatus =
  | "idle"
  | "connecting"
  | "listening"
  | "thinking"
  | "speaking"
  | "error";

export type RealtimeVoiceState =
  | { status: Exclude<RealtimeVoiceStatus, "error"> }
  | { status: "error"; message: string };

export interface RealtimeVoiceToolAction {
  callId: string;
  name: string;
  status: "running" | "observed" | "submitted" | "refused" | "cancelled";
  message?: string;
}

export type RealtimeVoiceResponseOutcome = "completed" | "interrupted";

export interface RealtimeVoiceTurnContext {
  itemId?: string;
  signal: AbortSignal;
}

export interface RealtimeVoiceMediaTrack {
  kind: string;
  stop: () => void;
}

export interface RealtimeVoiceMediaStream {
  getTracks: () => RealtimeVoiceMediaTrack[];
  getAudioTracks: () => RealtimeVoiceMediaTrack[];
}

export interface RealtimeVoiceDataChannel extends EventTarget {
  readyState: RTCDataChannelState;
  send: (value: string) => void;
  close: () => void;
}

export interface RealtimeVoicePeerConnection extends EventTarget {
  readonly connectionState: RTCPeerConnectionState;
  createDataChannel: (label: string) => RealtimeVoiceDataChannel;
  addTrack: (
    track: RealtimeVoiceMediaTrack,
    stream: RealtimeVoiceMediaStream,
  ) => unknown;
  createOffer: () => Promise<{ type: string; sdp?: string }>;
  setLocalDescription: (description: {
    type: string;
    sdp?: string;
  }) => Promise<void>;
  setRemoteDescription: (description: {
    type: "answer";
    sdp: string;
  }) => Promise<void>;
  close: () => void;
  ontrack:
    | ((event: { streams: RealtimeVoiceMediaStream[] }) => void)
    | null;
}

export interface RealtimeVoiceRemoteAudio {
  autoplay: boolean;
  playsInline: boolean;
  srcObject: RealtimeVoiceMediaStream | null;
  play: () => Promise<void>;
  pause: () => void;
}

export interface RealtimeVoicePlatform {
  createPeerConnection: () => RealtimeVoicePeerConnection;
  getUserMedia: (constraints: MediaStreamConstraints) => Promise<RealtimeVoiceMediaStream>;
  createRemoteAudio: () => RealtimeVoiceRemoteAudio;
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

export interface RealtimeVoiceControllerOptions {
  roomId: string;
  getAccessToken: () => string | null;
  onIntent: (
    intent: DirectCanvasIntent,
    source: "voice",
    turn?: RealtimeVoiceTurnContext,
  ) =>
    | RealtimeVoiceIntentResult
    | Promise<RealtimeVoiceIntentResult>;
  onStatusChange?: (status: RealtimeVoiceStatus) => void;
  onTranscript?: (text: string, itemId?: string) => void;
  onTranscriptDelta?: (delta: string, itemId?: string) => void;
  onAssistantTranscript?: (text: string) => void;
  onUserSpeechStarted?: (itemId?: string) => void;
  onResponseSettled?: (
    outcome: RealtimeVoiceResponseOutcome,
    itemId?: string,
  ) => void;
  onToolAction?: (action: RealtimeVoiceToolAction) => void;
  inspectCanvas?: RealtimeVoiceCanvasInspector;
  onPlaybackBlocked?: () => void;
  platform?: RealtimeVoicePlatform;
}

export interface RealtimeVoiceController {
  getState: () => RealtimeVoiceState;
  subscribe: (listener: () => void) => () => void;
  start: () => Promise<void>;
  stop: () => void;
  resumeAudio: () => Promise<boolean>;
}

const SESSION_ENDPOINT = "/api/realtime/session";
const MAX_SDP_ANSWER_LENGTH = 1_048_576;
const MAX_SESSION_MILLISECONDS = 10 * 60 * 1_000;
const MAX_SETUP_MILLISECONDS = 20 * 1_000;
const MAX_TRACKED_INPUT_TURNS = 16;
const MAX_TRANSCRIPT_DELTA_CHARS = 2_000;

export function createRealtimeVoiceController(
  options: RealtimeVoiceControllerOptions,
): RealtimeVoiceController {
  const platform = options.platform ?? browserPlatform();
  const listeners = new Set<() => void>();
  let state: RealtimeVoiceState = { status: "idle" };
  let generation = 0;
  let peer: RealtimeVoicePeerConnection | null = null;
  let channel: RealtimeVoiceDataChannel | null = null;
  let microphone: RealtimeVoiceMediaStream | null = null;
  let remoteAudio: RealtimeVoiceRemoteAudio | null = null;
  let sessionRequest: AbortController | null = null;
  let intentSession: AbortController | null = null;
  let sessionLimitTimer: ReturnType<typeof setTimeout> | null = null;
  let setupTimer: ReturnType<typeof setTimeout> | null = null;
  let sessionReady = false;
  let pendingToolFollowupResponses = 0;
  let toolQueue: Promise<void> = Promise.resolve();
  const handledCallIds = new Set<string>();
  const remoteStreams = new Set<RealtimeVoiceMediaStream>();
  const pendingInputItemIds: string[] = [];
  const responseInputItemIds = new Map<string, string | null>();
  const settledInputItemIds = new Set<string>();

  function getState() {
    return state;
  }

  function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function update(next: RealtimeVoiceState) {
    state = next;
    try {
      options.onStatusChange?.(next.status);
    } catch {
      // Status observers cannot interrupt the media lifecycle.
    }
    listeners.forEach((listener) => {
      try {
        listener();
      } catch {
        // A view subscriber cannot interrupt the media lifecycle.
      }
    });
  }

  async function start() {
    if (["connecting", "listening", "thinking", "speaking"].includes(state.status))
      return;
    releaseResources();
    const activeGeneration = ++generation;
    const activeIntentSession = new AbortController();
    intentSession = activeIntentSession;
    handledCallIds.clear();
    remoteStreams.clear();
    pendingInputItemIds.length = 0;
    responseInputItemIds.clear();
    settledInputItemIds.clear();
    sessionReady = false;
    pendingToolFollowupResponses = 0;
    toolQueue = Promise.resolve();
    update({ status: "connecting" });
    setupTimer = setTimeout(() => {
      failConnection(
        activeGeneration,
        "The live voice session timed out. Start it again to reconnect.",
      );
    }, MAX_SETUP_MILLISECONDS);

    try {
      const accessToken = options.getAccessToken();
      if (!accessToken)
        throw new RealtimeVoiceError(
          "Your no-signup room session is not ready yet.",
        );

      const nextPeer = platform.createPeerConnection();
      const nextChannel = nextPeer.createDataChannel("oai-events");
      const nextAudio = platform.createRemoteAudio();
      nextAudio.autoplay = true;
      nextAudio.playsInline = true;
      peer = nextPeer;
      channel = nextChannel;
      remoteAudio = nextAudio;

      nextPeer.ontrack = (event) => {
        if (generation !== activeGeneration) return;
        const stream = event.streams[0];
        if (!stream) return;
        remoteStreams.add(stream);
        nextAudio.srcObject = stream;
        void nextAudio.play().catch(() => {
          if (generation !== activeGeneration) return;
          try {
            options.onPlaybackBlocked?.();
          } catch {
            // Playback observers cannot interrupt the media lifecycle.
          }
        });
      };
      nextChannel.addEventListener("open", () => {
        if (generation !== activeGeneration) return;
        // The trusted server supplied the complete session configuration in
        // the unified WebRTC call. Wait for OpenAI to acknowledge it.
      });
      nextChannel.addEventListener("message", (event) => {
        if (generation !== activeGeneration) return;
        void handleServerEvent(
          messageData(event),
          nextChannel,
          activeGeneration,
          options.onIntent,
          activeIntentSession.signal,
        );
      });
      nextChannel.addEventListener("close", () => {
        failConnection(
          activeGeneration,
          "The live voice connection closed. Start it again to reconnect.",
        );
      });
      nextChannel.addEventListener("error", () => {
        failConnection(
          activeGeneration,
          "The live voice connection failed. Start it again to reconnect.",
        );
      });
      nextPeer.addEventListener("connectionstatechange", () => {
        if (
          nextPeer.connectionState === "failed" ||
          nextPeer.connectionState === "closed" ||
          nextPeer.connectionState === "disconnected"
        )
          failConnection(
            activeGeneration,
            "The live voice connection failed. Start it again to reconnect.",
          );
      });

      const nextMicrophone = await platform.getUserMedia({
        audio: {
          autoGainControl: true,
          echoCancellation: true,
          noiseSuppression: true,
        },
        video: false,
      });
      if (generation !== activeGeneration) {
        nextMicrophone.getTracks().forEach((track) => track.stop());
        return;
      }
      microphone = nextMicrophone;
      const audioTrack = nextMicrophone.getAudioTracks()[0];
      if (!audioTrack)
        throw new RealtimeVoiceError("No microphone audio track was available.");
      nextPeer.addTrack(audioTrack, nextMicrophone);

      const offer = await nextPeer.createOffer();
      if (!offer.sdp)
        throw new RealtimeVoiceError("The browser could not create a voice session.");
      await nextPeer.setLocalDescription(offer);
      if (generation !== activeGeneration) return;

      const abortController = new AbortController();
      sessionRequest = abortController;
      const response = await platform.fetch(SESSION_ENDPOINT, {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/sdp",
          "x-commandcanvas-room-id": options.roomId,
        },
        body: offer.sdp,
        cache: "no-store",
        signal: abortController.signal,
      });
      if (generation !== activeGeneration) return;
      if (!response.ok)
        throw new RealtimeVoiceError(await readSessionFailure(response));
      const answerSdp = await response.text();
      if (
        answerSdp.length === 0 ||
        answerSdp.length > MAX_SDP_ANSWER_LENGTH ||
        !answerSdp.startsWith("v=0")
      )
        throw new RealtimeVoiceError("The voice session response was invalid.");
      await nextPeer.setRemoteDescription({ type: "answer", sdp: answerSdp });
      if (sessionRequest === abortController) sessionRequest = null;
    } catch (error) {
      if (generation !== activeGeneration) return;
      ++generation;
      releaseResources();
      update({
        status: "error",
        message:
          error instanceof RealtimeVoiceError
            ? error.message
            : "Live voice could not start. Check microphone access and try again.",
      });
    }
  }

  function stop() {
    ++generation;
    releaseResources();
    update({ status: "idle" });
  }

  async function resumeAudio() {
    const audio = remoteAudio;
    if (!audio || !audio.srcObject) return false;
    try {
      await audio.play();
      return true;
    } catch {
      return false;
    }
  }

  function releaseResources() {
    if (setupTimer !== null) clearTimeout(setupTimer);
    setupTimer = null;
    if (sessionLimitTimer !== null) clearTimeout(sessionLimitTimer);
    sessionLimitTimer = null;
    sessionRequest?.abort();
    sessionRequest = null;
    intentSession?.abort(
      new DOMException("Voice session stopped", "AbortError"),
    );
    intentSession = null;
    if (peer) peer.ontrack = null;
    const tracks = new Set<RealtimeVoiceMediaTrack>();
    microphone?.getTracks().forEach((track) => tracks.add(track));
    remoteStreams.forEach((stream) =>
      stream.getTracks().forEach((track) => tracks.add(track)),
    );
    tracks.forEach((track) => {
      try {
        track.stop();
      } catch {
        // Continue releasing the remaining resources.
      }
    });
    microphone = null;
    remoteStreams.clear();
    pendingInputItemIds.length = 0;
    responseInputItemIds.clear();
    settledInputItemIds.clear();
    pendingToolFollowupResponses = 0;
    try {
      channel?.close();
    } catch {
      // Continue releasing the remaining resources.
    }
    channel = null;
    try {
      peer?.close();
    } catch {
      // Continue releasing the remaining resources.
    }
    peer = null;
    if (remoteAudio) {
      remoteAudio.pause();
      remoteAudio.srcObject = null;
    }
    remoteAudio = null;
  }

  function failConnection(activeGeneration: number, message: string) {
    if (generation !== activeGeneration) return;
    ++generation;
    releaseResources();
    update({ status: "error", message });
  }

  function acknowledgeSession(activeGeneration: number) {
    if (generation !== activeGeneration || sessionReady) return;
    sessionReady = true;
    if (setupTimer !== null) clearTimeout(setupTimer);
    setupTimer = null;
    sessionLimitTimer = setTimeout(() => {
      failConnection(
        activeGeneration,
        "Live voice stopped after 10 minutes. Start it again if you still need it.",
      );
    }, MAX_SESSION_MILLISECONDS);
    update({ status: "listening" });
  }

  async function handleServerEvent(
    raw: unknown,
    activeChannel: RealtimeVoiceDataChannel,
    activeGeneration: number,
    onIntent: RealtimeVoiceControllerOptions["onIntent"],
    intentSignal: AbortSignal,
  ) {
    const event = parseServerEvent(raw);
    if (!event) return;
    if (event.type === "session.created" || event.type === "session.updated") {
      acknowledgeSession(activeGeneration);
      return;
    }
    if (!sessionReady) return;
    switch (event.type) {
      case "input_audio_buffer.speech_started":
        rememberPendingInputItem(readEventId(event.item_id));
        try {
          options.onUserSpeechStarted?.(readEventId(event.item_id));
        } catch {
          // Turn observers cannot interrupt the media lifecycle.
        }
        update({ status: "listening" });
        return;
      case "input_audio_buffer.speech_stopped":
        update({ status: "thinking" });
        return;
      case "response.created":
        if (pendingToolFollowupResponses > 0) {
          pendingToolFollowupResponses -= 1;
          bindResponseToInput(event.response, true);
        } else bindResponseToInput(event.response);
        update({ status: "thinking" });
        return;
      case "response.output_audio.delta":
        update({ status: "speaking" });
        return;
      case "conversation.item.input_audio_transcription.completed": {
        const transcript = cleanTranscript(event.transcript);
        const itemId = readEventId(event.item_id);
        rememberPendingInputItem(itemId);
        if (transcript) options.onTranscript?.(transcript, itemId);
        return;
      }
      case "conversation.item.input_audio_transcription.delta": {
        const delta = cleanTranscriptDelta(event.delta);
        const itemId = readEventId(event.item_id);
        rememberPendingInputItem(itemId);
        if (delta) options.onTranscriptDelta?.(delta, itemId);
        return;
      }
      case "response.output_audio_transcript.done": {
        const transcript = cleanTranscript(event.transcript);
        if (transcript) options.onAssistantTranscript?.(transcript);
        return;
      }
      case "response.output_item.done":
      {
        const itemId = bindResponseToInputId(event.response_id);
        await queueFunctionItem(
          event.item,
          activeChannel,
          activeGeneration,
          onIntent,
          intentSignal,
          itemId ?? undefined,
        );
      }
        return;
      case "response.function_call_arguments.done":
      {
        const itemId = bindResponseToInputId(event.response_id);
        await queueFunctionItem(
          event,
          activeChannel,
          activeGeneration,
          onIntent,
          intentSignal,
          itemId ?? undefined,
        );
      }
        return;
      case "response.done": {
        const responseBinding = takeResponseInput(event.response);
        const calls = responseFunctionItems(event.response);
        for (const item of calls)
          await queueFunctionItem(
            item,
            activeChannel,
            activeGeneration,
            onIntent,
            intentSignal,
            responseBinding.itemId ?? undefined,
          );
        if (calls.length > 0) await toolQueue;
        if (!responseBinding.known || responseBinding.itemId) {
          try {
            options.onResponseSettled?.(
              responseOutcome(event.response),
              responseBinding.itemId ?? undefined,
            );
          } catch {
            // Turn observers cannot interrupt the media lifecycle.
          }
        }
        if (calls.length === 0 && generation === activeGeneration)
          update({ status: "listening" });
        return;
      }
      case "error":
        try {
          options.onResponseSettled?.("interrupted");
        } catch {
          // Turn observers cannot interrupt the media lifecycle.
        }
        failConnection(
          activeGeneration,
          "The live voice service reported an error. Start it again to reconnect.",
        );
    }
  }

  function queueFunctionItem(
    rawItem: unknown,
    activeChannel: RealtimeVoiceDataChannel,
    activeGeneration: number,
    onIntent: RealtimeVoiceControllerOptions["onIntent"],
    intentSignal: AbortSignal,
    itemId?: string,
  ) {
    const call = parseFunctionCall(rawItem);
    if (!call || handledCallIds.has(call.callId)) return;
    handledCallIds.add(call.callId);
    toolQueue = toolQueue
      .then(() =>
        handleFunctionCall(
          call,
          activeChannel,
          activeGeneration,
          onIntent,
          intentSignal,
          itemId,
        ),
      )
      .catch(() => {
        failConnection(
          activeGeneration,
          "The live voice connection failed. Start it again to reconnect.",
        );
      });
    return toolQueue;
  }

  async function handleFunctionCall(
    call: { callId: string; name: string; arguments: string },
    activeChannel: RealtimeVoiceDataChannel,
    activeGeneration: number,
    onIntent: RealtimeVoiceControllerOptions["onIntent"],
    intentSignal: AbortSignal,
    itemId?: string,
  ) {
    if (generation !== activeGeneration) return;
    update({ status: "thinking" });
    options.onToolAction?.({
      callId: call.callId,
      name: call.name,
      status: "running",
    });
    const result = await executeRealtimeVoiceTool(
      { name: call.name, arguments: call.arguments },
      (intent, source) =>
        onIntent(intent, source, {
          ...(itemId ? { itemId } : {}),
          signal: intentSignal,
        }),
      {
        signal: intentSignal,
        inspectCanvas: options.inspectCanvas,
      },
    );
    if (result.outcome === "cancelled")
      options.onToolAction?.({
        callId: call.callId,
        name: call.name,
        status: "cancelled",
        message: result.message,
      });
    else
      options.onToolAction?.({
        callId: call.callId,
        name: call.name,
        status:
          result.outcome === "observed"
            ? "observed"
            : result.ok
              ? "submitted"
              : "refused",
        message: result.message,
      });
    if (
      generation !== activeGeneration ||
      activeChannel.readyState !== "open"
    )
      return;
    if (!send(activeChannel, {
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: call.callId,
        output: JSON.stringify(result),
      },
    })) {
      failConnection(
        activeGeneration,
        "The live voice connection failed. Start it again to reconnect.",
      );
      return;
    }
    if (!send(activeChannel, { type: "response.create" }))
      failConnection(
        activeGeneration,
        "The live voice connection failed. Start it again to reconnect.",
      );
    else
      pendingToolFollowupResponses = Math.min(
        pendingToolFollowupResponses + 1,
        MAX_TRACKED_INPUT_TURNS,
      );
  }

  function rememberPendingInputItem(itemId: string | undefined) {
    if (!itemId || pendingInputItemIds.includes(itemId)) return;
    if (settledInputItemIds.has(itemId)) return;
    if ([...responseInputItemIds.values()].includes(itemId)) return;
    pendingInputItemIds.push(itemId);
    if (pendingInputItemIds.length > MAX_TRACKED_INPUT_TURNS)
      pendingInputItemIds.shift();
  }

  function bindResponseToInput(
    rawResponse: unknown,
    forceUnassociated = false,
  ) {
    if (!rawResponse || typeof rawResponse !== "object") return;
    bindResponseToInputId(
      readEventId((rawResponse as Record<string, unknown>).id),
      forceUnassociated,
    );
  }

  function bindResponseToInputId(
    responseId: unknown,
    forceUnassociated = false,
  ) {
    const id = readEventId(responseId);
    if (!id) return undefined;
    if (!responseInputItemIds.has(id)) {
      const itemId = forceUnassociated
        ? null
        : pendingInputItemIds.shift() ?? null;
      responseInputItemIds.set(id, itemId);
      if (responseInputItemIds.size > MAX_TRACKED_INPUT_TURNS) {
        const oldest = responseInputItemIds.keys().next().value;
        if (oldest) responseInputItemIds.delete(oldest);
      }
    }
    return responseInputItemIds.get(id) ?? null;
  }

  function takeResponseInput(rawResponse: unknown): {
    known: boolean;
    itemId: string | null;
  } {
    if (!rawResponse || typeof rawResponse !== "object")
      return { known: false, itemId: null };
    const responseId = readEventId(
      (rawResponse as Record<string, unknown>).id,
    );
    if (!responseId) return { known: false, itemId: null };
    if (!responseInputItemIds.has(responseId))
      bindResponseToInputId(responseId);
    const itemId = responseInputItemIds.get(responseId) ?? null;
    responseInputItemIds.delete(responseId);
    if (itemId) {
      settledInputItemIds.add(itemId);
      if (settledInputItemIds.size > MAX_TRACKED_INPUT_TURNS) {
        const oldest = settledInputItemIds.values().next().value;
        if (oldest) settledInputItemIds.delete(oldest);
      }
    }
    return { known: true, itemId };
  }

  return { getState, subscribe, start, stop, resumeAudio };
}

function browserPlatform(): RealtimeVoicePlatform {
  return {
    createPeerConnection: () =>
      new RTCPeerConnection() as unknown as RealtimeVoicePeerConnection,
    getUserMedia: async (constraints) =>
      (await navigator.mediaDevices.getUserMedia(
        constraints,
      )) as unknown as RealtimeVoiceMediaStream,
    createRemoteAudio: () =>
      document.createElement("audio") as unknown as RealtimeVoiceRemoteAudio,
    fetch: globalThis.fetch.bind(globalThis),
  };
}

function send(channel: RealtimeVoiceDataChannel, event: unknown) {
  if (channel.readyState !== "open") return false;
  try {
    channel.send(JSON.stringify(event));
    return true;
  } catch {
    return false;
  }
}

function messageData(event: Event) {
  return event instanceof MessageEvent ? event.data : null;
}

function parseServerEvent(raw: unknown): Record<string, unknown> | null {
  try {
    const value = typeof raw === "string" ? JSON.parse(raw) : raw;
    return value !== null && typeof value === "object"
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function readEventId(raw: unknown) {
  return typeof raw === "string" && /^[A-Za-z0-9_-]{1,160}$/.test(raw)
    ? raw
    : undefined;
}

function parseFunctionCall(raw: unknown) {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (value.type !== "function_call") return null;
  const callId = typeof value.call_id === "string" ? value.call_id : "";
  const name = typeof value.name === "string" ? value.name : "";
  const args = typeof value.arguments === "string" ? value.arguments : "";
  if (
    !/^[A-Za-z0-9_-]{1,160}$/.test(callId) ||
    !/^[a-z][a-z0-9_]{0,63}$/.test(name) ||
    args.length === 0
  )
    return null;
  return { callId, name, arguments: args };
}

function responseFunctionItems(raw: unknown): unknown[] {
  if (!raw || typeof raw !== "object") return [];
  const output = (raw as Record<string, unknown>).output;
  return Array.isArray(output)
    ? output.filter(
        (item) =>
          item !== null &&
          typeof item === "object" &&
          (item as Record<string, unknown>).type === "function_call",
      )
    : [];
}

function responseOutcome(raw: unknown): RealtimeVoiceResponseOutcome {
  if (!raw || typeof raw !== "object") return "completed";
  const status = (raw as Record<string, unknown>).status;
  return status === undefined || status === "completed"
    ? "completed"
    : "interrupted";
}

function cleanTranscript(raw: unknown) {
  if (typeof raw !== "string") return null;
  const transcript = raw.replace(/\s+/g, " ").trim();
  return transcript.length > 0 ? transcript.slice(0, 2_000) : null;
}

function cleanTranscriptDelta(raw: unknown) {
  if (typeof raw !== "string") return "";
  return raw
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .slice(0, MAX_TRANSCRIPT_DELTA_CHARS);
}

async function readSessionFailure(response: Response) {
  try {
    const data = (await response.json()) as {
      error?: { message?: unknown };
    };
    const message = data.error?.message;
    if (typeof message === "string" && message.length > 0 && message.length <= 200)
      return message;
  } catch {
    // Return the stable fallback below.
  }
  return "Live voice is temporarily unavailable.";
}

class RealtimeVoiceError extends Error {}
