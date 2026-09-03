import { describe, expect, it, vi } from "vitest";

import {
  createRealtimeVoiceController,
  type RealtimeVoiceDataChannel,
  type RealtimeVoiceControllerOptions,
  type RealtimeVoiceStartOptions,
  type RealtimeVoiceMediaStream,
  type RealtimeVoicePeerConnection,
  type RealtimeVoiceRemoteAudio,
} from "@/lib/realtime-voice/client";
import { createTestOpenAiApiKey } from "@/lib/testing/openai-key-fixture";

const ROOM_ID = "11111111-1111-4111-8111-111111111111";
const AUTHORIZATION = "header.payload.signature";
const SESSION_OPENAI_API_KEY = createTestOpenAiApiKey(
  "test-session-only-commandcanvas-key",
);
const SEMANTIC_NOTE_OBJECT = {
  id: "note-voice-client",
  type: "note",
  title: "Launch thought",
  x: 120,
  y: 160,
  width: 320,
  height: 220,
  zIndex: 8,
  payload: { text: "Confirm the launch date.", tone: "sky" },
} as const;

class FakeDataChannel extends EventTarget implements RealtimeVoiceDataChannel {
  readyState: RTCDataChannelState = "connecting";
  sent: string[] = [];
  throwOnSend = false;
  close = vi.fn(() => {
    this.readyState = "closed";
  });
  send(value: string) {
    if (this.throwOnSend) throw new Error("send failed");
    this.sent.push(value);
  }
  open() {
    this.readyState = "open";
    this.dispatchEvent(new Event("open"));
  }
  message(value: unknown) {
    this.dispatchEvent(
      new MessageEvent("message", { data: JSON.stringify(value) }),
    );
  }
  fail() {
    this.dispatchEvent(new Event("error"));
  }
}

class FakePeerConnection extends EventTarget implements RealtimeVoicePeerConnection {
  connectionState: RTCPeerConnectionState = "new";
  createDataChannel: RealtimeVoicePeerConnection["createDataChannel"];
  addTrack = vi.fn();
  createOffer = vi.fn(async () => ({
    type: "offer",
    sdp: "v=0\no=browser-offer",
  }));
  setLocalDescription = vi.fn(async () => undefined);
  setRemoteDescription = vi.fn(async () => undefined);
  close = vi.fn();
  ontrack: RealtimeVoicePeerConnection["ontrack"] = null;

  constructor(channel: FakeDataChannel) {
    super();
    this.createDataChannel = vi.fn(() => channel);
  }

  fail() {
    this.connectionState = "failed";
    this.dispatchEvent(new Event("connectionstatechange"));
  }
}

function harness(options?: {
  fetchResponse?: Response;
  onIntent?: RealtimeVoiceControllerOptions["onIntent"];
  inspectCanvas?: RealtimeVoiceControllerOptions["inspectCanvas"];
  invokeCapability?: RealtimeVoiceControllerOptions["invokeCapability"];
  consumeSketchNarration?: RealtimeVoiceControllerOptions["consumeSketchNarration"];
  onPlaybackBlocked?: () => void;
}) {
  const channel = new FakeDataChannel();
  const microphoneTrack = { kind: "audio", stop: vi.fn() };
  const stream: RealtimeVoiceMediaStream = {
    getTracks: () => [microphoneTrack],
    getAudioTracks: () => [microphoneTrack],
  };
  const remoteTrack = { kind: "audio", stop: vi.fn() };
  const remoteStream: RealtimeVoiceMediaStream = {
    getTracks: () => [remoteTrack],
    getAudioTracks: () => [remoteTrack],
  };
  const peer = new FakePeerConnection(channel);
  const remoteAudio: RealtimeVoiceRemoteAudio = {
    autoplay: false,
    playsInline: false,
    srcObject: null,
    play: vi.fn(async () => undefined),
    pause: vi.fn(),
  };
  const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => {
    void _input;
    void _init;
    return (
      options?.fetchResponse ??
      new Response("v=0\no=openai-answer", {
        status: 200,
        headers: { "content-type": "application/sdp" },
      })
    );
  });
  const getUserMedia = vi.fn(async () => stream);
  const statuses: string[] = [];
  const transcripts: string[] = [];
  const transcriptDeltas: Array<{ delta: string; itemId?: string }> = [];
  const transcriptEvents: Array<{ text: string; itemId?: string }> = [];
  const assistantTranscripts: string[] = [];
  const speechStarts: number[] = [];
  const speechStartItemIds: Array<string | undefined> = [];
  const responseOutcomes: string[] = [];
  const responseEvents: Array<{ outcome: string; itemId?: string }> = [];
  const toolActions: unknown[] = [];
  const onIntent =
    options?.onIntent ??
    vi.fn(() => ({ ok: true as const, message: "Board command submitted." }));
  const voiceController = createRealtimeVoiceController({
    roomId: ROOM_ID,
    getAccessToken: () => AUTHORIZATION,
    onIntent,
    onStatusChange: (status) => statuses.push(status),
    onTranscript: (text, itemId) => {
      transcripts.push(text);
      transcriptEvents.push({ text, ...(itemId ? { itemId } : {}) });
    },
    onTranscriptDelta: (delta, itemId) => {
      transcriptDeltas.push({ delta, ...(itemId ? { itemId } : {}) });
    },
    onAssistantTranscript: (text) => assistantTranscripts.push(text),
    onUserSpeechStarted: (itemId) => {
      speechStarts.push(speechStarts.length + 1);
      speechStartItemIds.push(itemId);
    },
    onResponseSettled: (outcome, itemId) => {
      responseOutcomes.push(outcome);
      responseEvents.push({ outcome, ...(itemId ? { itemId } : {}) });
    },
    onToolAction: (action) => toolActions.push(action),
    inspectCanvas: options?.inspectCanvas,
    invokeCapability: options?.invokeCapability,
    consumeSketchNarration: options?.consumeSketchNarration,
    onPlaybackBlocked: options?.onPlaybackBlocked,
    platform: {
      createPeerConnection: () => peer,
      getUserMedia,
      createRemoteAudio: () => remoteAudio,
      fetch: fetcher,
    },
  });
  const controller = {
    ...voiceController,
    start: (
      startOptions: RealtimeVoiceStartOptions = {
        openAiApiKey: SESSION_OPENAI_API_KEY,
      },
    ) => voiceController.start(startOptions),
  };

  return {
    controller,
    channel,
    peer,
    stream,
    microphoneTrack,
    remoteAudio,
    remoteTrack,
    remoteStream,
    fetcher,
    getUserMedia,
    statuses,
    transcripts,
    transcriptDeltas,
    transcriptEvents,
    assistantTranscripts,
    speechStarts,
    speechStartItemIds,
    responseOutcomes,
    responseEvents,
    toolActions,
    onIntent,
    emitRemoteTrack: () => peer.ontrack?.({ streams: [remoteStream] }),
  };
}

describe("Realtime voice WebRTC controller", () => {
  it("streams bounded item-correlated input transcription deltas separately from completion", async () => {
    const setup = harness();
    await setup.controller.start();
    setup.channel.open();
    setup.channel.message({ type: "session.created", session: { type: "realtime" } });

    setup.channel.message({
      type: "conversation.item.input_audio_transcription.delta",
      item_id: "item-thought-1",
      delta: "The launch ",
    });
    setup.channel.message({
      type: "conversation.item.input_audio_transcription.delta",
      item_id: "item-thought-1",
      delta: "risk is timing.",
    });
    setup.channel.message({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "item-thought-1",
      transcript: "The launch risk is timing.",
    });

    expect(setup.transcriptDeltas).toEqual([
      { delta: "The launch ", itemId: "item-thought-1" },
      { delta: "risk is timing.", itemId: "item-thought-1" },
    ]);
    expect(setup.transcriptEvents).toEqual([
      { text: "The launch risk is timing.", itemId: "item-thought-1" },
    ]);
  });

  it("passes one session cancellation signal through an unresolved intent and reports cancellation", async () => {
    let observedSignal: AbortSignal | undefined;
    const onIntent = vi.fn<RealtimeVoiceControllerOptions["onIntent"]>(
      async (_intent, _source, turn) => {
        observedSignal = turn?.signal;
        return await new Promise((resolve, reject) => {
          turn?.signal.addEventListener(
            "abort",
            () => reject(turn.signal.reason),
            { once: true },
          );
          void resolve;
        });
      },
    );
    const setup = harness({ onIntent });
    await setup.controller.start();
    setup.channel.open();
    setup.channel.message({ type: "session.created", session: { type: "realtime" } });
    setup.channel.message({
      type: "response.output_item.done",
      item: {
        type: "function_call",
        call_id: "call-cancelled-1",
        name: "undo",
        arguments: "{}",
      },
    });
    await vi.waitFor(() => expect(onIntent).toHaveBeenCalledOnce());

    setup.controller.stop();

    expect(observedSignal?.aborted).toBe(true);
    await vi.waitFor(() =>
      expect(setup.toolActions).toEqual([
        { callId: "call-cancelled-1", name: "undo", status: "running" },
        {
          callId: "call-cancelled-1",
          name: "undo",
          status: "cancelled",
          message: "Voice action cancelled before the canvas confirmed it.",
        },
      ]),
    );
    expect(setup.channel.sent).toEqual([]);
  });

  it("keeps an already-committed canvas outcome visible when Stop suppresses the provider follow-up", async () => {
    let resolveIntent:
      | ((value: { ok: true; message: string }) => void)
      | undefined;
    const onIntent = vi.fn(
      () =>
        new Promise<{ ok: true; message: string }>((resolve) => {
          resolveIntent = resolve;
        }),
    );
    const setup = harness({ onIntent });
    await setup.controller.start();
    setup.channel.open();
    setup.channel.message({ type: "session.created", session: { type: "realtime" } });
    setup.channel.message({
      type: "response.output_item.done",
      item: {
        type: "function_call",
        call_id: "call-committed-1",
        name: "undo",
        arguments: "{}",
      },
    });
    await vi.waitFor(() => expect(onIntent).toHaveBeenCalledOnce());

    resolveIntent?.({ ok: true, message: "Board committed with a receipt." });
    setup.controller.stop();

    await vi.waitFor(() =>
      expect(setup.toolActions).toEqual([
        { callId: "call-committed-1", name: "undo", status: "running" },
        {
          callId: "call-committed-1",
          name: "undo",
          status: "submitted",
          message: "Canvas action submitted; check the canvas receipt for the result.",
        },
      ]),
    );
    expect(setup.channel.sent).toEqual([]);
  });

  it("posts browser SDP through the authenticated server boundary and waits for the configured session acknowledgement", async () => {
    const setup = harness();

    await setup.controller.start({ openAiApiKey: SESSION_OPENAI_API_KEY });
    setup.channel.open();

    expect(setup.fetcher).toHaveBeenCalledWith(
      "/api/realtime/session",
      expect.objectContaining({
        method: "POST",
        body: "v=0\no=browser-offer",
        headers: {
          authorization: `Bearer ${AUTHORIZATION}`,
          "content-type": "application/sdp",
          "x-commandcanvas-room-id": ROOM_ID,
          "x-commandcanvas-openai-key": SESSION_OPENAI_API_KEY,
        },
      }),
    );
    expect(setup.peer.addTrack).toHaveBeenCalledWith(
      setup.microphoneTrack,
      setup.stream,
    );
    expect(setup.getUserMedia).toHaveBeenCalledWith({
      audio: {
        autoGainControl: true,
        echoCancellation: true,
        noiseSuppression: true,
      },
      video: false,
    });
    expect(setup.peer.setRemoteDescription).toHaveBeenCalledWith({
      type: "answer",
      sdp: "v=0\no=openai-answer",
    });
    expect(setup.channel.sent).toEqual([]);
    expect(setup.controller.getState()).toEqual({ status: "connecting" });
    setup.channel.message({ type: "session.created", session: { type: "realtime" } });
    expect(setup.statuses).toEqual(["connecting", "listening"]);
  });

  it("requests an account-saved credential without putting a raw key in the browser request", async () => {
    const setup = harness();

    await setup.controller.start({ useSavedOpenAiCredential: true });

    expect(setup.fetcher).toHaveBeenCalledWith(
      "/api/realtime/session",
      expect.objectContaining({
        headers: {
          authorization: `Bearer ${AUTHORIZATION}`,
          "content-type": "application/sdp",
          "x-commandcanvas-openai-credential": "saved",
          "x-commandcanvas-room-id": ROOM_ID,
        },
      }),
    );
    const init = setup.fetcher.mock.calls[0]?.[1];
    expect(init?.headers).not.toHaveProperty("x-commandcanvas-openai-key");
  });

  it("refuses ambiguous saved and session credentials before opening media", async () => {
    const setup = harness();

    await setup.controller.start({
      openAiApiKey: SESSION_OPENAI_API_KEY,
      useSavedOpenAiCredential: true,
    });

    expect(setup.controller.getState()).toEqual({
      status: "error",
      message: "Choose either your saved OpenAI credential or a temporary key.",
    });
    expect(setup.fetcher).not.toHaveBeenCalled();
    expect(setup.peer.createDataChannel).not.toHaveBeenCalled();
  });

  it("refuses an invalid session key before opening media or transport resources", async () => {
    const setup = harness();

    await setup.controller.start({ openAiApiKey: "not-a-provider-key" });

    expect(setup.controller.getState()).toEqual({
      status: "error",
      message: "Enter a valid OpenAI API key to start live voice.",
    });
    expect(setup.fetcher).not.toHaveBeenCalled();
    expect(setup.peer.createDataChannel).not.toHaveBeenCalled();
    expect(setup.microphoneTrack.stop).not.toHaveBeenCalled();
  });

  it("surfaces listening, thinking, speaking, and transcript events", async () => {
    const setup = harness();
    await setup.controller.start();
    setup.channel.open();
    setup.channel.message({ type: "session.created", session: { type: "realtime" } });

    setup.channel.message({ type: "input_audio_buffer.speech_started" });
    setup.channel.message({
      type: "conversation.item.input_audio_transcription.completed",
      transcript: "Bring in our project board",
    });
    setup.channel.message({ type: "input_audio_buffer.speech_stopped" });
    setup.channel.message({ type: "response.output_audio.delta", delta: "AA==" });
    setup.channel.message({
      type: "response.output_audio_transcript.done",
      transcript: "I added the project board.",
    });
    setup.channel.message({ type: "response.done", response: { output: [] } });

    expect(setup.transcripts).toEqual(["Bring in our project board"]);
    expect(setup.assistantTranscripts).toEqual(["I added the project board."]);
    expect(setup.speechStarts).toEqual([1]);
    expect(setup.responseOutcomes).toEqual(["completed"]);
    expect(setup.statuses).toEqual([
      "connecting",
      "listening",
      "listening",
      "thinking",
      "speaking",
      "listening",
    ]);
  });

  it("correlates a completed input item in both legal transcription and response orders", async () => {
    const setup = harness();
    await setup.controller.start();
    setup.channel.open();
    setup.channel.message({ type: "session.created", session: { type: "realtime" } });

    setup.channel.message({
      type: "input_audio_buffer.speech_started",
      item_id: "item-transcript-first",
    });
    setup.channel.message({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "item-transcript-first",
      transcript: "Transcript arrived first.",
    });
    setup.channel.message({
      type: "response.created",
      response: { id: "response-transcript-first" },
    });
    setup.channel.message({
      type: "response.done",
      response: {
        id: "response-transcript-first",
        status: "completed",
        output: [],
      },
    });

    setup.channel.message({
      type: "input_audio_buffer.speech_started",
      item_id: "item-response-first",
    });
    setup.channel.message({
      type: "response.created",
      response: { id: "response-response-first" },
    });
    setup.channel.message({
      type: "response.done",
      response: {
        id: "response-response-first",
        status: "completed",
        output: [],
      },
    });
    setup.channel.message({
      type: "conversation.item.input_audio_transcription.completed",
      item_id: "item-response-first",
      transcript: "Response arrived first.",
    });

    expect(setup.speechStartItemIds).toEqual([
      "item-transcript-first",
      "item-response-first",
    ]);
    expect(setup.transcriptEvents).toEqual([
      { text: "Transcript arrived first.", itemId: "item-transcript-first" },
      { text: "Response arrived first.", itemId: "item-response-first" },
    ]);
    expect(setup.responseEvents).toEqual([
      { outcome: "completed", itemId: "item-transcript-first" },
      { outcome: "completed", itemId: "item-response-first" },
    ]);
  });

  it("marks cancelled and failed responses interrupted so pending dictation cannot commit", async () => {
    const setup = harness();
    await setup.controller.start();
    setup.channel.open();
    setup.channel.message({ type: "session.created", session: { type: "realtime" } });

    setup.channel.message({
      type: "response.done",
      response: { status: "cancelled", output: [] },
    });
    setup.channel.message({
      type: "response.done",
      response: { status: "failed", output: [] },
    });
    setup.channel.message({ type: "error", error: { message: "provider failed" } });

    await vi.waitFor(() => {
      expect(setup.responseOutcomes).toEqual([
        "interrupted",
        "interrupted",
        "interrupted",
      ]);
      expect(setup.controller.getState()).toEqual({
        status: "error",
        message: "The live voice service reported an error. Start it again to reconnect.",
      });
    });
  });

  it("executes a validated semantic creation, returns function_call_output, then asks the model to respond", async () => {
    const setup = harness();
    await setup.controller.start();
    setup.channel.open();
    setup.channel.message({ type: "session.created", session: { type: "realtime" } });
    setup.channel.sent.length = 0;

    setup.channel.message({
      type: "response.output_item.done",
      item: {
        type: "function_call",
        call_id: "call-object-1",
        name: "create_semantic_object",
        arguments: JSON.stringify({ object: SEMANTIC_NOTE_OBJECT }),
      },
    });
    await vi.waitFor(() => expect(setup.channel.sent).toHaveLength(2));

    expect(vi.mocked(setup.onIntent).mock.calls[0]?.slice(0, 2)).toEqual([
      { type: "create_semantic_object", object: SEMANTIC_NOTE_OBJECT },
      "voice",
    ]);
    expect(vi.mocked(setup.onIntent).mock.calls[0]?.[2]?.signal).toBeInstanceOf(
      AbortSignal,
    );
    expect(JSON.parse(setup.channel.sent[0]!)).toEqual({
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: "call-object-1",
        output: JSON.stringify({
          ok: true,
          outcome: "submitted",
          action: "create_semantic_object",
          message:
            "Canvas action submitted; check the canvas receipt for the result.",
        }),
      },
    });
    expect(JSON.parse(setup.channel.sent[1]!)).toEqual({
      type: "response.create",
    });
    expect(setup.toolActions).toEqual([
      {
        callId: "call-object-1",
        name: "create_semantic_object",
        status: "running",
      },
      {
        callId: "call-object-1",
        name: "create_semantic_object",
        status: "submitted",
        message:
          "Canvas action submitted; check the canvas receipt for the result.",
      },
    ]);
  });

  it("executes an underspecified create_board call through the canonical capability", async () => {
    const invokeCapability = vi.fn(async () => ({
      ok: true as const,
      status: "completed" as const,
      message: "Board created.",
    }));
    const setup = harness({ invokeCapability });
    await setup.controller.start();
    setup.channel.open();
    setup.channel.message({ type: "session.created", session: { type: "realtime" } });
    setup.channel.sent.length = 0;

    setup.channel.message({
      type: "response.output_item.done",
      item: {
        type: "function_call",
        call_id: "call-board-default-1",
        name: "create_board",
        arguments: "{}",
      },
    });

    await vi.waitFor(() => expect(setup.channel.sent).toHaveLength(2));
    expect(invokeCapability).toHaveBeenCalledWith(
      "create_object",
      {
        type: "task_board",
        title: "Project board",
        columns: [
          { title: "Next", tasks: [] },
          { title: "In progress", tasks: [] },
          { title: "Done", tasks: [] },
        ],
      },
      expect.any(AbortSignal),
    );
    expect(JSON.parse(setup.channel.sent[0]!)).toMatchObject({
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: "call-board-default-1",
      },
    });
    expect(JSON.parse(setup.channel.sent[1]!)).toEqual({
      type: "response.create",
    });
    expect(setup.toolActions).toEqual([
      {
        callId: "call-board-default-1",
        name: "create_board",
        status: "running",
      },
      {
        callId: "call-board-default-1",
        name: "create_board",
        status: "submitted",
        message: "Canvas action submitted; check the canvas receipt for the result.",
      },
    ]);
  });

  it("forwards buffered drawing narration into a canonical sketch transformation", async () => {
    const invokeCapability = vi.fn(async () => ({
      ok: true as const,
      status: "completed" as const,
      message: "Transformed.",
    }));
    const consumeSketchNarration = vi.fn(
      () => "The curve is revenue and the line is the target.",
    );
    const setup = harness({
      invokeCapability,
      consumeSketchNarration,
      inspectCanvas: async () => ({
        roomId: "room-1",
        revision: 9,
        selectedObjectId: "sketch-1",
        objects: [{ id: "sketch-1", type: "sketch" }],
        receipts: [],
        truncation: {},
      }),
    });
    await setup.controller.start();
    setup.channel.open();
    setup.channel.message({
      type: "session.created",
      session: { type: "realtime" },
    });
    setup.channel.sent.length = 0;

    setup.channel.message({
      type: "response.output_item.done",
      item: {
        type: "function_call",
        call_id: "call-transform-with-narration",
        name: "transform_selected_sketch",
        arguments: "{}",
      },
    });

    await vi.waitFor(() => expect(invokeCapability).toHaveBeenCalledOnce());
    expect(invokeCapability).toHaveBeenCalledWith(
      "transform_sketch",
      {
        sketchId: "sketch-1",
        instruction: "Make that usable.",
        narration: "The curve is revenue and the line is the target.",
      },
      expect.any(AbortSignal),
    );
    expect(consumeSketchNarration).toHaveBeenCalledOnce();
  });

  it("passes the originating input item to its canvas tool", async () => {
    const setup = harness();
    await setup.controller.start();
    setup.channel.open();
    setup.channel.message({ type: "session.created", session: { type: "realtime" } });

    setup.channel.message({
      type: "input_audio_buffer.speech_started",
      item_id: "item-tool-turn",
    });
    setup.channel.message({
      type: "response.created",
      response: { id: "response-tool-turn" },
    });
    setup.channel.message({
      type: "response.output_item.done",
      response_id: "response-tool-turn",
      item: {
        type: "function_call",
        call_id: "call-tool-turn",
        name: "discard_selected",
        arguments: "{}",
      },
    });

    await vi.waitFor(() => expect(setup.onIntent).toHaveBeenCalledOnce());
    expect(vi.mocked(setup.onIntent).mock.calls[0]?.slice(0, 2)).toEqual([
      { type: "discard_selected" },
      "voice",
    ]);
    expect(vi.mocked(setup.onIntent).mock.calls[0]?.[2]).toMatchObject({
      itemId: "item-tool-turn",
    });
    expect(vi.mocked(setup.onIntent).mock.calls[0]?.[2]?.signal).toBeInstanceOf(
      AbortSignal,
    );
  });

  it("does not let a tool followup response claim a newer barged-in input item", async () => {
    const setup = harness();
    await setup.controller.start();
    setup.channel.open();
    setup.channel.message({ type: "session.created", session: { type: "realtime" } });

    setup.channel.message({
      type: "input_audio_buffer.speech_started",
      item_id: "item-tool-origin",
    });
    setup.channel.message({
      type: "response.created",
      response: { id: "response-tool-origin" },
    });
    const functionItem = {
      type: "function_call",
      call_id: "call-barge-in",
      name: "undo",
      arguments: "{}",
    };
    setup.channel.message({
      type: "response.output_item.done",
      response_id: "response-tool-origin",
      item: functionItem,
    });
    setup.channel.message({
      type: "response.done",
      response: {
        id: "response-tool-origin",
        status: "completed",
        output: [functionItem],
      },
    });
    await vi.waitFor(() => expect(setup.channel.sent).toHaveLength(2));

    setup.channel.message({
      type: "input_audio_buffer.speech_started",
      item_id: "item-barged-in",
    });
    setup.channel.message({
      type: "response.created",
      response: { id: "response-tool-followup" },
    });
    setup.channel.message({
      type: "response.done",
      response: {
        id: "response-tool-followup",
        status: "completed",
        output: [],
      },
    });
    expect(setup.responseEvents).toEqual([
      { outcome: "completed", itemId: "item-tool-origin" },
    ]);
    setup.channel.message({
      type: "response.created",
      response: { id: "response-barged-in" },
    });
    setup.channel.message({
      type: "response.done",
      response: {
        id: "response-barged-in",
        status: "completed",
        output: [],
      },
    });

    await vi.waitFor(() =>
      expect(setup.responseEvents).toEqual([
        { outcome: "completed", itemId: "item-tool-origin" },
        { outcome: "completed", itemId: "item-barged-in" },
      ]),
    );
  });

  it("settles a response only after an already-queued function item finishes", async () => {
    let resolveIntent: ((value: { ok: true; message: string }) => void) | undefined;
    const onIntent = vi.fn(
      () =>
        new Promise<{ ok: true; message: string }>((resolve) => {
          resolveIntent = resolve;
        }),
    );
    const setup = harness({ onIntent });
    await setup.controller.start();
    setup.channel.open();
    setup.channel.message({ type: "session.created", session: { type: "realtime" } });

    const functionItem = {
      type: "function_call",
      call_id: "call-order-1",
      name: "undo",
      arguments: "{}",
    };
    setup.channel.message({ type: "response.output_item.done", item: functionItem });
    setup.channel.message({
      type: "response.done",
      response: { status: "completed", output: [functionItem] },
    });

    await vi.waitFor(() => expect(onIntent).toHaveBeenCalledOnce());
    expect(setup.responseOutcomes).toEqual([]);
    resolveIntent?.({ ok: true, message: "Board submitted." });
    await vi.waitFor(() =>
      expect(setup.responseOutcomes).toEqual(["completed"]),
    );
  });

  it("returns an invalid-argument refusal without invoking a canvas intent", async () => {
    const setup = harness();
    await setup.controller.start();
    setup.channel.open();
    setup.channel.message({ type: "session.created", session: { type: "realtime" } });
    setup.channel.sent.length = 0;

    setup.channel.message({
      type: "response.output_item.done",
      item: {
        type: "function_call",
        call_id: "call-bad-1",
        name: "create_semantic_object",
        arguments: '{"object":{"type":"note"}}',
      },
    });
    await vi.waitFor(() => expect(setup.channel.sent).toHaveLength(2));

    expect(setup.onIntent).not.toHaveBeenCalled();
    const output = JSON.parse(JSON.parse(setup.channel.sent[0]!).item.output);
    expect(output).toEqual({
      ok: false,
      outcome: "refused",
      action: "create_semantic_object",
      message: "Voice action arguments were invalid.",
    });
  });

  it("stops every media and transport resource and ignores late tool results", async () => {
    let resolveIntent!: (value: { ok: true; message: string }) => void;
    const pendingIntent = new Promise<{ ok: true; message: string }>((resolve) => {
      resolveIntent = resolve;
    });
    const setup = harness({ onIntent: vi.fn(() => pendingIntent) });
    await setup.controller.start();
    setup.channel.open();
    setup.channel.message({ type: "session.created", session: { type: "realtime" } });
    setup.emitRemoteTrack();
    setup.channel.sent.length = 0;
    setup.channel.message({
      type: "response.output_item.done",
      item: {
        type: "function_call",
        call_id: "call-late-1",
        name: "undo",
        arguments: "{}",
      },
    });

    setup.controller.stop();
    resolveIntent({ ok: true, message: "Undo submitted." });
    await Promise.resolve();
    await Promise.resolve();

    expect(setup.microphoneTrack.stop).toHaveBeenCalledOnce();
    expect(setup.channel.close).toHaveBeenCalledOnce();
    expect(setup.peer.close).toHaveBeenCalledOnce();
    expect(setup.remoteAudio.pause).toHaveBeenCalledOnce();
    expect(setup.remoteAudio.srcObject).toBeNull();
    expect(setup.remoteTrack.stop).toHaveBeenCalledOnce();
    expect(setup.channel.sent).toEqual([]);
    expect(setup.controller.getState()).toMatchObject({ status: "idle" });
  });

  it("surfaces blocked mobile playback and resumes only from an explicit user action", async () => {
    const onPlaybackBlocked = vi.fn();
    const setup = harness({ onPlaybackBlocked });
    vi.mocked(setup.remoteAudio.play)
      .mockRejectedValueOnce(new DOMException("Not allowed", "NotAllowedError"))
      .mockResolvedValueOnce(undefined);
    await setup.controller.start();
    setup.channel.open();
    setup.channel.message({ type: "session.created", session: { type: "realtime" } });

    setup.emitRemoteTrack();
    await vi.waitFor(() => expect(onPlaybackBlocked).toHaveBeenCalledOnce());

    await expect(setup.controller.resumeAudio()).resolves.toBe(true);
    expect(setup.remoteAudio.play).toHaveBeenCalledTimes(2);
  });

  it("cleans up and reports a compact error when session creation fails", async () => {
    const setup = harness({
      fetchResponse: new Response(
        JSON.stringify({
          ok: false,
          error: { code: "realtime_unavailable", message: "Voice is unavailable." },
        }),
        { status: 503, headers: { "content-type": "application/json" } },
      ),
    });

    await setup.controller.start();

    expect(setup.controller.getState()).toEqual({
      status: "error",
      message: "Voice is unavailable.",
    });
    expect(setup.microphoneTrack.stop).toHaveBeenCalledOnce();
    expect(setup.channel.close).toHaveBeenCalledOnce();
    expect(setup.peer.close).toHaveBeenCalledOnce();
  });

  it("automatically releases a live session after the bounded ten-minute window", async () => {
    vi.useFakeTimers();
    try {
      const setup = harness();
      await setup.controller.start();
      setup.channel.open();
      setup.channel.message({ type: "session.created", session: { type: "realtime" } });

      await vi.advanceTimersByTimeAsync(10 * 60 * 1_000);

      expect(setup.microphoneTrack.stop).toHaveBeenCalledOnce();
      expect(setup.channel.close).toHaveBeenCalledOnce();
      expect(setup.peer.close).toHaveBeenCalledOnce();
      expect(setup.controller.getState()).toEqual({
        status: "error",
        message:
          "Live voice stopped after 10 minutes. Start it again if you still need it.",
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails closed when setup receives no session acknowledgement within twenty seconds", async () => {
    vi.useFakeTimers();
    try {
      const setup = harness();
      await setup.controller.start();
      setup.channel.open();

      await vi.advanceTimersByTimeAsync(20 * 1_000);

      expect(setup.controller.getState()).toEqual({
        status: "error",
        message: "The live voice session timed out. Start it again to reconnect.",
      });
      expect(setup.microphoneTrack.stop).toHaveBeenCalledOnce();
      expect(setup.channel.close).toHaveBeenCalledOnce();
      expect(setup.peer.close).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("serializes canvas tool submissions even when provider calls arrive together", async () => {
    let releaseFirst!: (value: { ok: true; message: string }) => void;
    const first = new Promise<{ ok: true; message: string }>((resolve) => {
      releaseFirst = resolve;
    });
    const onIntent = vi
      .fn<RealtimeVoiceControllerOptions["onIntent"]>()
      .mockReturnValueOnce(first)
      .mockReturnValue({ ok: true, message: "Second submitted." });
    const setup = harness({ onIntent });
    await setup.controller.start();
    setup.channel.open();
    setup.channel.message({ type: "session.created", session: { type: "realtime" } });

    setup.channel.message({
      type: "response.output_item.done",
      item: {
        type: "function_call",
        call_id: "call-first",
        name: "undo",
        arguments: "{}",
      },
    });
    setup.channel.message({
      type: "response.output_item.done",
      item: {
        type: "function_call",
        call_id: "call-second",
        name: "redo",
        arguments: "{}",
      },
    });
    await vi.waitFor(() => expect(onIntent).toHaveBeenCalledTimes(1));

    releaseFirst({ ok: true, message: "First submitted." });
    await vi.waitFor(() => expect(onIntent).toHaveBeenCalledTimes(2));
    expect(onIntent.mock.calls.map(([intent]) => intent.type)).toEqual([
      "undo",
      "redo",
    ]);
  });

  it("cleans up deterministically on peer or data-channel failure", async () => {
    const peerFailure = harness();
    await peerFailure.controller.start();
    peerFailure.channel.open();
    peerFailure.channel.message({ type: "session.created", session: { type: "realtime" } });
    peerFailure.peer.fail();
    expect(peerFailure.controller.getState()).toMatchObject({ status: "error" });
    expect(peerFailure.microphoneTrack.stop).toHaveBeenCalledOnce();

    const channelFailure = harness();
    await channelFailure.controller.start();
    channelFailure.channel.open();
    channelFailure.channel.message({ type: "session.created", session: { type: "realtime" } });
    channelFailure.channel.fail();
    expect(channelFailure.controller.getState()).toMatchObject({ status: "error" });
    expect(channelFailure.microphoneTrack.stop).toHaveBeenCalledOnce();
  });

  it("turns a data-channel send exception into a controlled connection error", async () => {
    const setup = harness();
    await setup.controller.start();
    setup.channel.open();
    setup.channel.message({ type: "session.created", session: { type: "realtime" } });
    setup.channel.throwOnSend = true;
    setup.channel.message({
      type: "response.output_item.done",
      item: {
        type: "function_call",
        call_id: "call-send-failure",
        name: "undo",
        arguments: "{}",
      },
    });

    await vi.waitFor(() =>
      expect(setup.controller.getState()).toMatchObject({ status: "error" }),
    );
    expect(setup.microphoneTrack.stop).toHaveBeenCalledOnce();
  });
});
