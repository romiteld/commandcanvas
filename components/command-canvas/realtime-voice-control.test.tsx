import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";

import {
  RealtimeVoiceControl,
  type RealtimeVoiceControlController,
} from "@/components/command-canvas/realtime-voice-control";
import type { RealtimeVoiceControllerOptions } from "@/lib/realtime-voice/client";
import { createTestOpenAiApiKey } from "@/lib/testing/openai-key-fixture";

const ROOM_ID = "11111111-1111-4111-8111-111111111111";

function controllerHarness() {
  let state: ReturnType<RealtimeVoiceControlController["getState"]> = {
    status: "idle",
  };
  const listeners = new Set<() => void>();
  const controller: RealtimeVoiceControlController = {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start: vi.fn(async () => {
      state = { status: "listening" as const };
      listeners.forEach((listener) => listener());
    }),
    stop: vi.fn(() => {
      state = { status: "idle" as const };
      listeners.forEach((listener) => listener());
    }),
    resumeAudio: vi.fn(async () => true),
  };
  return { controller };
}

function successfulIntentSpy() {
  return vi.fn<RealtimeVoiceControllerOptions["onIntent"]>(() => ({
    ok: true,
    message: "Submitted.",
  }));
}

describe("RealtimeVoiceControl", () => {
  it("uses a user-supplied session key for Live Voice without rendering or persisting it", async () => {
    const user = userEvent.setup();
    const setup = controllerHarness();
    const apiKey = createTestOpenAiApiKey("user-session-key");

    function SessionKeyHarness() {
      const [openAiApiKey, setOpenAiApiKey] = useState("");
      return (
        <RealtimeVoiceControl
          roomId={ROOM_ID}
          getAccessToken={() => "header.payload.signature"}
          openAiApiKey={openAiApiKey}
          onOpenAiApiKeyChange={setOpenAiApiKey}
          onIntent={successfulIntentSpy()}
          createController={() => setup.controller}
        />
      );
    }

    render(<SessionKeyHarness />);

    const input = screen.getByLabelText("Your OpenAI API key");
    expect(input).toHaveAttribute("type", "password");
    expect(input).toHaveAttribute("autocomplete", "off");
    expect(screen.getByText(/never saved/i)).toBeInTheDocument();
    expect(
      screen.getByText(/sent transiently through CommandCanvas/i),
    ).toBeInTheDocument();

    await user.type(input, `  ${apiKey}  `);
    expect(screen.queryByText(apiKey)).not.toBeInTheDocument();
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);

    await user.click(
      screen.getByRole("button", { name: "Start live voice" }),
    );
    expect(setup.controller.start).toHaveBeenCalledWith({
      openAiApiKey: `  ${apiKey}  `,
    });
    await waitFor(() => expect(input).toHaveValue(""));
    expect(screen.queryByDisplayValue(apiKey)).not.toBeInTheDocument();
  });

  it("starts from an account-saved credential without returning the raw key to the UI", async () => {
    const user = userEvent.setup();
    const setup = controllerHarness();
    render(
      <RealtimeVoiceControl
        roomId={ROOM_ID}
        getAccessToken={() => "header.payload.signature"}
        useSavedOpenAiCredential
        savedOpenAiCredential={{
          configured: true,
          fingerprint: "sk-…c4a9",
          updatedAt: "2026-09-01T03:15:00.000Z",
          busy: false,
          onSave: vi.fn(async () => undefined),
          onDelete: vi.fn(async () => undefined),
        }}
        onUseSavedOpenAiCredentialChange={vi.fn()}
        onIntent={successfulIntentSpy()}
        createController={() => setup.controller}
      />,
    );

    expect(screen.getByText(/saved to your commandcanvas account/i)).toBeInTheDocument();
    expect(screen.getByText("sk-…c4a9")).toBeInTheDocument();
    expect(
      screen.getByText(/selected automatically when you sign in/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByLabelText("Your OpenAI API key"),
    ).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue(/sk-/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Start live voice" }));
    expect(setup.controller.start).toHaveBeenCalledWith({
      useSavedOpenAiCredential: true,
    });
  });

  it("explicitly saves and removes a signed-in user's credential without browser storage", async () => {
    const user = userEvent.setup();
    const setup = controllerHarness();
    const save = vi.fn(async () => undefined);
    const remove = vi.fn(async () => undefined);
    const apiKey = `sk-account-${"a".repeat(32)}`;
    render(
      <RealtimeVoiceControl
        roomId={ROOM_ID}
        getAccessToken={() => "header.payload.signature"}
        savedOpenAiCredential={{
          configured: true,
          fingerprint: "sk-…c4a9",
          updatedAt: "2026-09-01T03:15:00.000Z",
          busy: false,
          onSave: save,
          onDelete: remove,
        }}
        onIntent={successfulIntentSpy()}
        createController={() => setup.controller}
      />,
    );

    expect(screen.queryByLabelText(/OpenAI API key/i)).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Replace saved key" }));
    await user.type(screen.getByLabelText("Replacement OpenAI API key"), apiKey);
    await user.click(screen.getByRole("button", { name: "Save replacement" }));
    expect(save).toHaveBeenCalledWith(apiKey);
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);

    await user.click(screen.getByRole("button", { name: "Remove saved key" }));
    expect(remove).not.toHaveBeenCalled();
    expect(
      screen.getByText("Remove saved OpenAI key? This cannot be undone."),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Confirm remove saved key" }),
    );
    expect(remove).toHaveBeenCalledOnce();
  });

  it("publishes thought transcription deltas provisionally and clears them after one final append", async () => {
    let callbacks: RealtimeVoiceControllerOptions | undefined;
    const setup = controllerHarness();
    const drafts: Array<string | null> = [];
    const onIntent = successfulIntentSpy();
    render(
      <RealtimeVoiceControl
        roomId={ROOM_ID}
        getAccessToken={() => "header.payload.signature"}
        onIntent={onIntent}
        onThoughtDraftChange={(text) => drafts.push(text)}
        createController={(options) => {
          callbacks = options;
          return setup.controller;
        }}
      />,
    );

    await callbacks?.onIntent({ type: "start_thought" }, "voice");
    callbacks?.onUserSpeechStarted?.("thought-item-1");
    callbacks?.onTranscriptDelta?.("The launch ", "thought-item-1");
    callbacks?.onTranscriptDelta?.("risk is timing.", "thought-item-1");
    expect(drafts.at(-1)).toBe("The launch risk is timing.");
    expect(onIntent).toHaveBeenCalledTimes(1);

    callbacks?.onTranscript?.("The launch risk is timing.", "thought-item-1");
    await callbacks?.onResponseSettled?.("completed", "thought-item-1");

    await vi.waitFor(() => expect(onIntent).toHaveBeenCalledTimes(2));
    expect(onIntent).toHaveBeenLastCalledWith(
      { type: "append_thought", text: "The launch risk is timing." },
      "voice",
    );
    expect(drafts.at(-1)).toBeNull();
  });

  it("appends active-thought speech through the canonical content capability when available", async () => {
    let callbacks: RealtimeVoiceControllerOptions | undefined;
    const setup = controllerHarness();
    const onIntent = successfulIntentSpy();
    const invokeCapability = vi.fn(async () => ({
      ok: true as const,
      status: "completed" as const,
      message: "Thought updated.",
      receiptId: "receipt-thought-update",
    }));
    render(
      <RealtimeVoiceControl
        roomId={ROOM_ID}
        getAccessToken={() => "header.payload.signature"}
        onIntent={onIntent}
        invokeCapability={invokeCapability}
        createController={(options) => {
          callbacks = options;
          return setup.controller;
        }}
      />,
    );

    await callbacks?.onIntent(
      { type: "start_thought", objectId: "note-thought-1" },
      "voice",
    );
    callbacks?.onUserSpeechStarted?.("thought-capability-turn");
    callbacks?.onTranscript?.(
      "Turn this spoken idea into durable card text.",
      "thought-capability-turn",
    );
    await callbacks?.onResponseSettled?.(
      "completed",
      "thought-capability-turn",
    );

    await vi.waitFor(() => expect(invokeCapability).toHaveBeenCalledOnce());
    expect(invokeCapability).toHaveBeenCalledWith(
      "update_object_content",
      {
        objectId: "note-thought-1",
        text: "Turn this spoken idea into durable card text.",
      },
      expect.any(AbortSignal),
    );
    expect(onIntent).toHaveBeenCalledTimes(1);
    expect(onIntent).toHaveBeenCalledWith(
      { type: "start_thought", objectId: "note-thought-1" },
      "voice",
    );
  });

  it("keeps provisional thought text visible after a non-aborting append refusal", async () => {
    let callbacks: RealtimeVoiceControllerOptions | undefined;
    const setup = controllerHarness();
    const drafts: Array<string | null> = [];
    const onIntent = vi.fn<RealtimeVoiceControllerOptions["onIntent"]>(
      (intent) =>
        intent.type === "append_thought"
          ? {
              ok: false,
              message: "The room is reconnecting. Your words remain visible.",
            }
          : { ok: true, message: "Submitted." },
    );
    render(
      <RealtimeVoiceControl
        roomId={ROOM_ID}
        getAccessToken={() => "header.payload.signature"}
        onIntent={onIntent}
        onThoughtDraftChange={(text) => drafts.push(text)}
        createController={(options) => {
          callbacks = options;
          return setup.controller;
        }}
      />,
    );

    await callbacks?.onIntent({ type: "start_thought" }, "voice");
    callbacks?.onUserSpeechStarted?.("thought-transient-refusal");
    callbacks?.onTranscriptDelta?.(
      "Keep these unconfirmed words.",
      "thought-transient-refusal",
    );
    callbacks?.onTranscript?.(
      "Keep these unconfirmed words.",
      "thought-transient-refusal",
    );
    await callbacks?.onResponseSettled?.(
      "completed",
      "thought-transient-refusal",
    );

    await vi.waitFor(() => expect(onIntent).toHaveBeenCalledTimes(2));
    expect(drafts.at(-1)).toBe("Keep these unconfirmed words.");
  });

  it("starts a persistent automatic voice session without a manual Run control", async () => {
    const user = userEvent.setup();
    const setup = controllerHarness();
    render(
      <RealtimeVoiceControl
        roomId={ROOM_ID}
        getAccessToken={() => "header.payload.signature"}
        onIntent={() => ({ ok: true, message: "Submitted." })}
        createController={() => setup.controller}
      />,
    );

    expect(screen.queryByRole("button", { name: /run/i })).not.toBeInTheDocument();
    expect(screen.getByText(/automatic turn detection/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Start live voice" }));

    expect(setup.controller.start).toHaveBeenCalledOnce();
    expect(screen.getByRole("status")).toHaveTextContent("Listening");
    await user.click(screen.getByRole("button", { name: "Stop live voice" }));
    expect(setup.controller.stop).toHaveBeenCalledOnce();
  });

  it("reports the actual live-session state to the shared ChatGPT control", async () => {
    const user = userEvent.setup();
    const setup = controllerHarness();
    const activity: boolean[] = [];
    render(
      <RealtimeVoiceControl
        roomId={ROOM_ID}
        getAccessToken={() => "header.payload.signature"}
        onIntent={() => ({ ok: true, message: "Submitted." })}
        onActiveChange={(active) => activity.push(active)}
        createController={() => setup.controller}
      />,
    );

    expect(activity).toEqual([false]);
    await user.click(screen.getByRole("button", { name: "Start live voice" }));
    expect(activity).toEqual([false, true]);

    await user.click(screen.getByRole("button", { name: "Stop live voice" }));
    expect(activity).toEqual([false, true, false]);
  });

  it("renders transcript, assistant, and tool activity callbacks", async () => {
    let callbacks:
      | {
          onTranscript?: (text: string) => void;
          onAssistantTranscript?: (text: string) => void;
          onToolAction?: (action: {
            callId: string;
            name: string;
            status: "running" | "submitted" | "refused";
            message?: string;
          }) => void;
        }
      | undefined;
    const setup = controllerHarness();
    render(
      <RealtimeVoiceControl
        roomId={ROOM_ID}
        getAccessToken={() => "header.payload.signature"}
        onIntent={() => ({ ok: true, message: "Submitted." })}
        createController={(options) => {
          callbacks = options;
          return setup.controller;
        }}
      />,
    );

    callbacks?.onTranscript?.("Make that usable");
    callbacks?.onToolAction?.({
      callId: "call-transform",
      name: "transform_selected_sketch",
      status: "submitted",
      message: "Diagram command submitted.",
    });
    callbacks?.onAssistantTranscript?.("I created the structured diagram.");

    expect(await screen.findByText("Make that usable")).toBeInTheDocument();
    expect(
      screen.getByText("Diagram command submitted.").closest("li"),
    ).toHaveAttribute("data-tone", "neutral");
    expect(screen.getByText("I created the structured diagram.")).toBeInTheDocument();
  });

  it("attaches recent completed user speech once when voice transforms a sketch", async () => {
    let callbacks: RealtimeVoiceControllerOptions | undefined;
    const setup = controllerHarness();
    const onIntent = successfulIntentSpy();
    render(
      <RealtimeVoiceControl
        roomId={ROOM_ID}
        getAccessToken={() => "header.payload.signature"}
        onIntent={onIntent}
        createController={(options) => {
          callbacks = options;
          return setup.controller;
        }}
      />,
    );

    callbacks?.onTranscript?.(
      "This box is the mobile client and it calls the API.",
    );
    callbacks?.onResponseSettled?.("completed");
    callbacks?.onAssistantTranscript?.(
      "I understand the service boundary.",
    );
    callbacks?.onTranscript?.("The API writes events to PostgreSQL.");
    callbacks?.onResponseSettled?.("completed");
    await callbacks?.onIntent(
      { type: "transform_selected_sketch" },
      "voice",
    );
    await callbacks?.onIntent(
      { type: "transform_selected_sketch" },
      "voice",
    );

    expect(onIntent).toHaveBeenNthCalledWith(
      1,
      {
        type: "transform_selected_sketch",
        narration:
          "This box is the mobile client and it calls the API.\n" +
          "The API writes events to PostgreSQL.",
      },
      "voice",
    );
    expect(onIntent).toHaveBeenNthCalledWith(
      2,
      { type: "transform_selected_sketch" },
      "voice",
    );
  });

  it("offers buffered spoken drawing context to canonical capability tools exactly once", async () => {
    let callbacks: RealtimeVoiceControllerOptions | undefined;
    const setup = controllerHarness();
    render(
      <RealtimeVoiceControl
        roomId={ROOM_ID}
        getAccessToken={() => "header.payload.signature"}
        onIntent={successfulIntentSpy()}
        createController={(options) => {
          callbacks = options;
          return setup.controller;
        }}
      />,
    );

    callbacks?.onUserSpeechStarted?.("drawing-explanation-1");
    callbacks?.onTranscript?.(
      "This curve is revenue and the dashed line is the target.",
      "drawing-explanation-1",
    );
    await callbacks?.onResponseSettled?.("completed", "drawing-explanation-1");

    expect(callbacks?.consumeSketchNarration?.()).toBe(
      "This curve is revenue and the dashed line is the target.",
    );
    expect(callbacks?.consumeSketchNarration?.()).toBeUndefined();
  });

  it("starts spoken sketch context after the voice drawing command", async () => {
    let callbacks: RealtimeVoiceControllerOptions | undefined;
    const setup = controllerHarness();
    const onIntent = successfulIntentSpy();
    render(
      <RealtimeVoiceControl
        roomId={ROOM_ID}
        getAccessToken={() => "header.payload.signature"}
        onIntent={onIntent}
        createController={(options) => {
          callbacks = options;
          return setup.controller;
        }}
      />,
    );

    callbacks?.onTranscript?.("Bring in our project board.");
    await callbacks?.onIntent({ type: "open_sketch" }, "voice");
    callbacks?.onTranscript?.("This circle is the event queue.");
    callbacks?.onResponseSettled?.("completed");
    await callbacks?.onIntent(
      { type: "transform_selected_sketch" },
      "voice",
    );

    expect(onIntent).toHaveBeenLastCalledWith(
      {
        type: "transform_selected_sketch",
        narration: "This circle is the event queue.",
      },
      "voice",
    );
  });

  it("drops interrupted non-thought narration before the next visual transform", async () => {
    let callbacks: RealtimeVoiceControllerOptions | undefined;
    const setup = controllerHarness();
    const onIntent = successfulIntentSpy();
    render(
      <RealtimeVoiceControl
        roomId={ROOM_ID}
        getAccessToken={() => "header.payload.signature"}
        onIntent={onIntent}
        createController={(options) => {
          callbacks = options;
          return setup.controller;
        }}
      />,
    );

    callbacks?.onTranscript?.("This unfinished explanation must be dropped.");
    callbacks?.onResponseSettled?.("interrupted");
    await callbacks?.onIntent(
      { type: "transform_selected_sketch" },
      "voice",
    );

    expect(onIntent).toHaveBeenLastCalledWith(
      { type: "transform_selected_sketch" },
      "voice",
    );
  });

  it("keeps an unsupported transform paraphrase out of narration in both event orders", async () => {
    let callbacks: RealtimeVoiceControllerOptions | undefined;
    const setup = controllerHarness();
    const onIntent = successfulIntentSpy();
    render(
      <RealtimeVoiceControl
        roomId={ROOM_ID}
        getAccessToken={() => "header.payload.signature"}
        onIntent={onIntent}
        createController={(options) => {
          callbacks = options;
          return setup.controller;
        }}
      />,
    );

    callbacks?.onTranscript?.("Render it cleanly");
    await callbacks?.onIntent(
      { type: "transform_selected_sketch" },
      "voice",
    );
    callbacks?.onResponseSettled?.("completed");

    await callbacks?.onIntent(
      { type: "transform_selected_sketch" },
      "voice",
    );
    callbacks?.onTranscript?.("Render it cleanly");
    callbacks?.onResponseSettled?.("completed");

    callbacks?.onUserSpeechStarted?.();
    callbacks?.onTranscript?.("The remaining explanation is a quarterly trend.");
    callbacks?.onResponseSettled?.("completed");
    callbacks?.onTranscript?.("Make that usable");
    await callbacks?.onIntent(
      { type: "transform_selected_sketch" },
      "voice",
    );

    expect(onIntent.mock.calls.map(([intent]) => intent)).toEqual([
      { type: "transform_selected_sketch" },
      { type: "transform_selected_sketch" },
      {
        type: "transform_selected_sketch",
        narration: "The remaining explanation is a quarterly trend.",
      },
    ]);
  });

  it("dictates completed user turns into one thought card between explicit capture boundaries", async () => {
    let callbacks: RealtimeVoiceControllerOptions | undefined;
    const setup = controllerHarness();
    const onIntent = vi.fn((intent) => ({
      ok: true as const,
      message:
        intent.type === "start_thought"
          ? "Thought capture submitted."
          : intent.type === "finish_thought"
            ? "Thought capture finished."
            : "Thought transcript submitted.",
    }));
    render(
      <RealtimeVoiceControl
        roomId={ROOM_ID}
        getAccessToken={() => "header.payload.signature"}
        onIntent={onIntent}
        createController={(options) => {
          callbacks = options;
          return setup.controller;
        }}
      />,
    );

    callbacks?.onTranscript?.("Start a new thought");
    await callbacks?.onIntent({ type: "start_thought" }, "voice");
    callbacks?.onTranscript?.(
      "  The first customer problem is scattered meeting context.  ",
    );
    callbacks?.onResponseSettled?.("completed");
    callbacks?.onAssistantTranscript?.(
      "I am capturing that in the selected thought card.",
    );
    callbacks?.onTranscript?.("The output should remain attributable.");
    callbacks?.onResponseSettled?.("completed");
    await screen.findByText("The output should remain attributable.");
    callbacks?.onTranscript?.("Finish this thought");
    await callbacks?.onIntent({ type: "finish_thought" }, "voice");
    callbacks?.onTranscript?.("This must stay outside the finished card.");

    await vi.waitFor(() => {
      expect(onIntent).toHaveBeenCalledTimes(4);
    });
    expect(onIntent).toHaveBeenNthCalledWith(
      1,
      { type: "start_thought" },
      "voice",
    );
    expect(onIntent).toHaveBeenNthCalledWith(
      2,
      {
        type: "append_thought",
        text: "The first customer problem is scattered meeting context.",
      },
      "voice",
    );
    expect(onIntent).toHaveBeenNthCalledWith(
      3,
      {
        type: "append_thought",
        text: "The output should remain attributable.",
      },
      "voice",
    );
    expect(onIntent).toHaveBeenNthCalledWith(
      4,
      { type: "finish_thought" },
      "voice",
    );
  });

  it("keeps thought turns ordered when Realtime settles before or after transcription", async () => {
    let callbacks: RealtimeVoiceControllerOptions | undefined;
    const setup = controllerHarness();
    const onIntent = successfulIntentSpy();
    render(
      <RealtimeVoiceControl
        roomId={ROOM_ID}
        getAccessToken={() => "header.payload.signature"}
        onIntent={onIntent}
        createController={(options) => {
          callbacks = options;
          return setup.controller;
        }}
      />,
    );

    await callbacks?.onIntent({ type: "start_thought" }, "voice");

    callbacks?.onUserSpeechStarted?.("item-response-first");
    callbacks?.onResponseSettled?.("completed", "item-response-first");

    callbacks?.onUserSpeechStarted?.("item-transcript-first");
    callbacks?.onTranscript?.(
      "The second spoken turn completed normally.",
      "item-transcript-first",
    );
    callbacks?.onResponseSettled?.("completed", "item-transcript-first");

    callbacks?.onTranscript?.(
      "The first spoken turn had a late transcript.",
      "item-response-first",
    );

    await vi.waitFor(() => expect(onIntent).toHaveBeenCalledTimes(3));
    expect(onIntent.mock.calls.map(([intent]) => intent)).toEqual([
      { type: "start_thought" },
      {
        type: "append_thought",
        text: "The first spoken turn had a late transcript.",
      },
      {
        type: "append_thought",
        text: "The second spoken turn completed normally.",
      },
    ]);
  });

  it("does not enter thought capture after a refused creation and reports append refusals", async () => {
    let callbacks: RealtimeVoiceControllerOptions | undefined;
    const setup = controllerHarness();
    const onIntent = vi
      .fn()
      .mockReturnValueOnce({
        ok: false as const,
        message: "The thought card could not be created.",
      })
      .mockReturnValueOnce({ ok: true as const, message: "Capture started." })
      .mockReturnValueOnce({
        ok: false as const,
        message: "That thought card reached its 4,000-character limit.",
      });
    render(
      <RealtimeVoiceControl
        roomId={ROOM_ID}
        getAccessToken={() => "header.payload.signature"}
        onIntent={onIntent}
        createController={(options) => {
          callbacks = options;
          return setup.controller;
        }}
      />,
    );

    callbacks?.onTranscript?.("Start a new thought");
    await callbacks?.onIntent({ type: "start_thought" }, "voice");
    callbacks?.onTranscript?.("This must not mutate a missing thought card.");
    callbacks?.onTranscript?.("Start a new thought");
    await callbacks?.onIntent({ type: "start_thought" }, "voice");
    callbacks?.onTranscript?.("This update is refused at the canonical boundary.");
    callbacks?.onResponseSettled?.("completed");

    expect(
      await screen.findByText(
        "That thought card reached its 4,000-character limit.",
      ),
    ).toBeInTheDocument();
    expect(onIntent).toHaveBeenCalledTimes(3);
    expect(onIntent).not.toHaveBeenCalledWith(
      {
        type: "append_thought",
        text: "This must not mutate a missing thought card.",
      },
      "voice",
    );
    expect(
      screen
        .getByText("That thought card reached its 4,000-character limit.")
        .closest("li"),
    ).toHaveAttribute("data-tone", "error");
  });

  it("serializes thought transcripts so every completed turn keeps card order", async () => {
    let callbacks: RealtimeVoiceControllerOptions | undefined;
    let resolveFirstAppend:
      | ((value: { ok: true; message: string }) => void)
      | undefined;
    const firstAppend = new Promise<{ ok: true; message: string }>((resolve) => {
      resolveFirstAppend = resolve;
    });
    const setup = controllerHarness();
    const onIntent = vi.fn((intent) => {
      if (intent.type === "append_thought" && intent.text === "First turn.")
        return firstAppend;
      return { ok: true as const, message: "Submitted." };
    });
    render(
      <RealtimeVoiceControl
        roomId={ROOM_ID}
        getAccessToken={() => "header.payload.signature"}
        onIntent={onIntent}
        createController={(options) => {
          callbacks = options;
          return setup.controller;
        }}
      />,
    );

    await callbacks?.onIntent({ type: "start_thought" }, "voice");
    callbacks?.onTranscript?.("Start a new thought");
    callbacks?.onTranscript?.("First turn.");
    callbacks?.onTranscript?.("Second turn.");
    callbacks?.onResponseSettled?.("completed");
    const finish = callbacks?.onIntent({ type: "finish_thought" }, "voice");

    await vi.waitFor(() => expect(onIntent).toHaveBeenCalledTimes(2));
    expect(onIntent).not.toHaveBeenCalledWith(
      { type: "append_thought", text: "Second turn." },
      "voice",
    );
    expect(onIntent).not.toHaveBeenCalledWith({ type: "finish_thought" }, "voice");

    resolveFirstAppend?.({ ok: true, message: "First submitted." });
    await finish;
    expect(onIntent.mock.calls.map(([intent]) => intent)).toEqual([
      { type: "start_thought" },
      { type: "append_thought", text: "First turn." },
      { type: "append_thought", text: "Second turn." },
      { type: "finish_thought" },
    ]);
  });

  it("reserves other tools during thought capture and keeps their command speech out of the card", async () => {
    let callbacks: RealtimeVoiceControllerOptions | undefined;
    const setup = controllerHarness();
    const onIntent = successfulIntentSpy();
    render(
      <RealtimeVoiceControl
        roomId={ROOM_ID}
        getAccessToken={() => "header.payload.signature"}
        onIntent={onIntent}
        createController={(options) => {
          callbacks = options;
          return setup.controller;
        }}
      />,
    );

    await callbacks?.onIntent({ type: "start_thought" }, "voice");
    callbacks?.onTranscript?.("Start a new thought");
    callbacks?.onTranscript?.("Bring in our project board");
    expect(await callbacks?.onIntent({ type: "create_board" }, "voice")).toEqual({
      ok: false,
      message: "Finish the active thought before using other canvas commands.",
    });
    callbacks?.onTranscript?.("Supplier risk belongs in this thought.");
    callbacks?.onResponseSettled?.("completed");
    callbacks?.onTranscript?.("Minimize this");
    expect(
      await callbacks?.onIntent({ type: "minimize_selected" }, "voice"),
    ).toEqual({
      ok: false,
      message: "Finish the active thought before using other canvas commands.",
    });
    await callbacks?.onIntent({ type: "finish_thought" }, "voice");

    expect(onIntent.mock.calls.map(([intent]) => intent)).toEqual([
      { type: "start_thought" },
      {
        type: "append_thought",
        text: "Supplier risk belongs in this thought.",
      },
      { type: "finish_thought" },
    ]);
  });

  it("keeps ordinary prose containing command-like words when no tool is called", async () => {
    let callbacks: RealtimeVoiceControllerOptions | undefined;
    const setup = controllerHarness();
    const onIntent = successfulIntentSpy();
    render(
      <RealtimeVoiceControl
        roomId={ROOM_ID}
        getAccessToken={() => "header.payload.signature"}
        onIntent={onIntent}
        createController={(options) => {
          callbacks = options;
          return setup.controller;
        }}
      />,
    );

    await callbacks?.onIntent({ type: "start_thought" }, "voice");
    callbacks?.onTranscript?.("Start a new thought");
    callbacks?.onTranscript?.(
      "We need to minimize launch risk without reducing scope.",
    );
    callbacks?.onResponseSettled?.("completed");
    callbacks?.onTranscript?.("Minimize this");
    expect(
      await callbacks?.onIntent({ type: "minimize_selected" }, "voice"),
    ).toEqual({
      ok: false,
      message: "Finish the active thought before using other canvas commands.",
    });
    await callbacks?.onIntent({ type: "finish_thought" }, "voice");

    expect(onIntent.mock.calls.map(([intent]) => intent)).toEqual([
      { type: "start_thought" },
      {
        type: "append_thought",
        text: "We need to minimize launch risk without reducing scope.",
      },
      { type: "finish_thought" },
    ]);
  });

  it("suppresses an unsupported tool paraphrase when transcript arrives before the tool", async () => {
    let callbacks: RealtimeVoiceControllerOptions | undefined;
    const setup = controllerHarness();
    const onIntent = successfulIntentSpy();
    render(
      <RealtimeVoiceControl
        roomId={ROOM_ID}
        getAccessToken={() => "header.payload.signature"}
        onIntent={onIntent}
        createController={(options) => {
          callbacks = options;
          return setup.controller;
        }}
      />,
    );

    await callbacks?.onIntent({ type: "start_thought" }, "voice");
    callbacks?.onTranscript?.("Start a new thought");
    callbacks?.onTranscript?.("Throw this away");
    expect(await callbacks?.onIntent({ type: "discard_selected" }, "voice")).toEqual({
      ok: false,
      message: "Finish the active thought before using other canvas commands.",
    });
    callbacks?.onResponseSettled?.("completed");
    callbacks?.onTranscript?.("The launch risk is supplier lead time.");
    callbacks?.onResponseSettled?.("completed");
    await callbacks?.onIntent({ type: "finish_thought" }, "voice");

    expect(onIntent.mock.calls.map(([intent]) => intent)).toEqual([
      { type: "start_thought" },
      {
        type: "append_thought",
        text: "The launch risk is supplier lead time.",
      },
      { type: "finish_thought" },
    ]);
  });

  it("suppresses an unsupported tool paraphrase when tool arrives before the transcript", async () => {
    let callbacks: RealtimeVoiceControllerOptions | undefined;
    const setup = controllerHarness();
    const onIntent = successfulIntentSpy();
    render(
      <RealtimeVoiceControl
        roomId={ROOM_ID}
        getAccessToken={() => "header.payload.signature"}
        onIntent={onIntent}
        createController={(options) => {
          callbacks = options;
          return setup.controller;
        }}
      />,
    );

    await callbacks?.onIntent({ type: "start_thought" }, "voice");
    callbacks?.onTranscript?.("Start a new thought");
    expect(await callbacks?.onIntent({ type: "discard_selected" }, "voice")).toEqual({
      ok: false,
      message: "Finish the active thought before using other canvas commands.",
    });
    callbacks?.onTranscript?.("Throw this away");
    callbacks?.onResponseSettled?.("completed");
    callbacks?.onUserSpeechStarted?.();
    callbacks?.onTranscript?.("The launch risk is supplier lead time.");
    callbacks?.onResponseSettled?.("completed");
    await callbacks?.onIntent({ type: "finish_thought" }, "voice");

    expect(onIntent.mock.calls.map(([intent]) => intent)).toEqual([
      { type: "start_thought" },
      {
        type: "append_thought",
        text: "The launch risk is supplier lead time.",
      },
      { type: "finish_thought" },
    ]);
  });

  it("keeps a late tool transcript out of the following item-correlated thought turn", async () => {
    let callbacks: RealtimeVoiceControllerOptions | undefined;
    const setup = controllerHarness();
    const onIntent = successfulIntentSpy();
    render(
      <RealtimeVoiceControl
        roomId={ROOM_ID}
        getAccessToken={() => "header.payload.signature"}
        onIntent={onIntent}
        createController={(options) => {
          callbacks = options;
          return setup.controller;
        }}
      />,
    );

    await callbacks?.onIntent({ type: "start_thought" }, "voice");
    callbacks?.onUserSpeechStarted?.("item-command");
    expect(
      await callbacks?.onIntent(
        { type: "discard_selected" },
        "voice",
        {
          itemId: "item-command",
          signal: new AbortController().signal,
        },
      ),
    ).toEqual({
      ok: false,
      message: "Finish the active thought before using other canvas commands.",
    });
    callbacks?.onResponseSettled?.("completed", "item-command");

    callbacks?.onUserSpeechStarted?.("item-content");
    callbacks?.onTranscript?.("Throw this away", "item-command");
    callbacks?.onTranscript?.(
      "The launch risk belongs in the thought card.",
      "item-content",
    );
    callbacks?.onResponseSettled?.("completed", "item-content");

    await vi.waitFor(() => expect(onIntent).toHaveBeenCalledTimes(2));
    expect(onIntent.mock.calls.map(([intent]) => intent)).toEqual([
      { type: "start_thought" },
      {
        type: "append_thought",
        text: "The launch risk belongs in the thought card.",
      },
    ]);
  });

  it("drops interrupted thought speech instead of appending it", async () => {
    let callbacks: RealtimeVoiceControllerOptions | undefined;
    const setup = controllerHarness();
    const onIntent = successfulIntentSpy();
    render(
      <RealtimeVoiceControl
        roomId={ROOM_ID}
        getAccessToken={() => "header.payload.signature"}
        onIntent={onIntent}
        createController={(options) => {
          callbacks = options;
          return setup.controller;
        }}
      />,
    );

    await callbacks?.onIntent({ type: "start_thought" }, "voice");
    callbacks?.onTranscript?.("Start a new thought");
    callbacks?.onTranscript?.("An incomplete sentence that must be dropped.");
    callbacks?.onResponseSettled?.("interrupted");
    callbacks?.onUserSpeechStarted?.();
    callbacks?.onTranscript?.("This completed sentence belongs in the card.");
    callbacks?.onResponseSettled?.("completed");
    await callbacks?.onIntent({ type: "finish_thought" }, "voice");

    expect(onIntent.mock.calls.map(([intent]) => intent)).toEqual([
      { type: "start_thought" },
      {
        type: "append_thought",
        text: "This completed sentence belongs in the card.",
      },
      { type: "finish_thought" },
    ]);
  });

  it("does not dictate capture commands when tool completion precedes its transcript", async () => {
    let callbacks: RealtimeVoiceControllerOptions | undefined;
    const setup = controllerHarness();
    const onIntent = successfulIntentSpy();
    render(
      <RealtimeVoiceControl
        roomId={ROOM_ID}
        getAccessToken={() => "header.payload.signature"}
        onIntent={onIntent}
        createController={(options) => {
          callbacks = options;
          return setup.controller;
        }}
      />,
    );

    await callbacks?.onIntent({ type: "start_thought" }, "voice");
    callbacks?.onTranscript?.("Start a new thought");
    callbacks?.onTranscript?.("This sentence belongs in the card.");
    callbacks?.onResponseSettled?.("completed");
    await callbacks?.onIntent({ type: "finish_thought" }, "voice");
    callbacks?.onTranscript?.("Finish this thought");

    expect(onIntent.mock.calls.map(([intent]) => intent)).toEqual([
      { type: "start_thought" },
      {
        type: "append_thought",
        text: "This sentence belongs in the card.",
      },
      { type: "finish_thought" },
    ]);
  });

  it("offers an explicit playback action when mobile autoplay is blocked", async () => {
    const user = userEvent.setup();
    let callbacks: RealtimeVoiceControllerOptions | undefined;
    const setup = controllerHarness();
    render(
      <RealtimeVoiceControl
        roomId={ROOM_ID}
        getAccessToken={() => "header.payload.signature"}
        onIntent={() => ({ ok: true, message: "Submitted." })}
        createController={(options) => {
          callbacks = options;
          return setup.controller;
        }}
      />,
    );

    callbacks?.onPlaybackBlocked?.();
    const resume = await screen.findByRole("button", {
      name: "Tap to hear responses",
    });
    await user.click(resume);

    expect(setup.controller.resumeAudio).toHaveBeenCalledOnce();
    expect(screen.queryByRole("button", { name: "Tap to hear responses" })).toBeNull();
  });

  it("stops the media session and clears provisional thought text on unmount", async () => {
    let callbacks: RealtimeVoiceControllerOptions | undefined;
    const setup = controllerHarness();
    const drafts: Array<string | null> = [];
    const view = render(
      <RealtimeVoiceControl
        roomId={ROOM_ID}
        getAccessToken={() => "header.payload.signature"}
        onIntent={() => ({ ok: true, message: "Submitted." })}
        onThoughtDraftChange={(text) => drafts.push(text)}
        createController={(options) => {
          callbacks = options;
          return setup.controller;
        }}
      />,
    );

    await callbacks?.onIntent({ type: "start_thought" }, "voice");
    callbacks?.onUserSpeechStarted?.("thought-before-unmount");
    callbacks?.onTranscriptDelta?.("Uncommitted words", "thought-before-unmount");
    expect(drafts.at(-1)).toBe("Uncommitted words");

    view.unmount();
    expect(setup.controller.stop).toHaveBeenCalledOnce();
    expect(drafts.at(-1)).toBeNull();
  });

  it("keeps one live controller while callback, token, inspector, and capability identities change", async () => {
    const setup = controllerHarness();
    let controllerOptions: RealtimeVoiceControllerOptions | undefined;
    const createController = vi.fn((options: RealtimeVoiceControllerOptions) => {
      controllerOptions = options;
      return setup.controller;
    });
    const firstIntent = vi.fn(() => ({ ok: true as const, message: "First." }));
    const secondIntent = vi.fn(() => ({ ok: true as const, message: "Second." }));
    const firstToken = vi.fn(() => "first.token.value");
    const secondToken = vi.fn(() => "second.token.value");
    const firstInspector = vi.fn(() => ({ revision: 1 }));
    const secondInspector = vi.fn(() => ({ revision: 2 }));
    const firstInvoker = vi.fn(async () => ({
      ok: true as const,
      status: "completed" as const,
      message: "First capability.",
    }));
    const secondInvoker = vi.fn(async () => ({
      ok: true as const,
      status: "completed" as const,
      message: "Second capability.",
    }));
    const view = render(
      <RealtimeVoiceControl
        roomId={ROOM_ID}
        getAccessToken={firstToken}
        onIntent={firstIntent}
        inspectCanvas={firstInspector}
        invokeCapability={firstInvoker}
        createController={createController}
      />,
    );
    view.rerender(
      <RealtimeVoiceControl
        roomId={ROOM_ID}
        getAccessToken={secondToken}
        onIntent={secondIntent}
        inspectCanvas={secondInspector}
        invokeCapability={secondInvoker}
        createController={createController}
      />,
    );

    expect(createController).toHaveBeenCalledOnce();
    expect(controllerOptions).toBeDefined();
    if (!controllerOptions) throw new Error("Controller options were not captured.");
    expect(controllerOptions.getAccessToken()).toBe("second.token.value");
    await expect(
      Promise.resolve(
        controllerOptions.onIntent({ type: "create_board" }, "voice"),
      ),
    ).resolves.toEqual({ ok: true, message: "Second." });
    await expect(
      Promise.resolve(
        controllerOptions.inspectCanvas?.(
          { scope: "all", includeReceipts: false },
          new AbortController().signal,
        ),
      ),
    ).resolves.toEqual({ revision: 2 });
    expect(firstIntent).not.toHaveBeenCalled();
    expect(secondIntent).toHaveBeenCalledOnce();
    expect(firstInspector).not.toHaveBeenCalled();
    expect(secondInspector).toHaveBeenCalledOnce();
    await expect(
      controllerOptions.invokeCapability?.(
        "control_workspace",
        { action: "fit_all" },
        new AbortController().signal,
      ),
    ).resolves.toMatchObject({ message: "Second capability." });
    expect(firstInvoker).not.toHaveBeenCalled();
    expect(secondInvoker).toHaveBeenCalledOnce();
  });
});
