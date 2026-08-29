import { act, render, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { CommandCanvasRoom } from "@/components/command-canvas/command-canvas-room";
import {
  createCanvasStore,
  type CanvasStoreDependencies,
} from "@/lib/canvas/canvas-store";
import type {
  CanvasCommand,
  CanvasCommandSource,
  CommandResult,
} from "@/lib/canvas/command-engine";
import type { RealtimeVoiceControllerOptions } from "@/lib/realtime-voice/client";

function dependencies(): CanvasStoreDependencies {
  let id = 0;
  let second = 0;
  return {
    actor: {
      id: "participant-host",
      displayName: "Danny",
      type: "human",
    },
    createId: (prefix) => `${prefix}-${++id}`,
    now: () =>
      `2026-08-29T14:00:${String(second++).padStart(2, "0")}.000Z`,
  };
}

function renderVoiceRoom(options?: {
  onCommand?: (
    command: CanvasCommand,
    source: CanvasCommandSource,
  ) => void | CommandResult | Promise<void | CommandResult>;
  onThoughtDraftChange?: (text: string | null) => void;
}) {
  const store = createCanvasStore("room-thought-draft", dependencies());
  let voice: RealtimeVoiceControllerOptions | undefined;
  const idleState = { status: "idle" as const };
  const view = render(
    <CommandCanvasRoom
      store={store}
      onCommand={options?.onCommand}
      realtimeVoice={{
        roomId: "room-thought-draft",
        getAccessToken: () => "header.payload.signature",
        onThoughtDraftChange: options?.onThoughtDraftChange,
        createController(nextOptions) {
          voice = nextOptions;
          return {
            getState: () => idleState,
            subscribe: () => () => undefined,
            start: vi.fn(async () => undefined),
            stop: vi.fn(),
            resumeAudio: vi.fn(async () => true),
          };
        },
      }}
    />,
  );
  if (!voice) throw new Error("Realtime voice callbacks were not captured.");
  return { ...view, store, voice };
}

async function startThought(voice: RealtimeVoiceControllerOptions) {
  await act(async () => {
    await voice.onIntent({ type: "start_thought" }, "voice");
  });
}

function objectCard(container: HTMLElement, objectId: string) {
  const card = container.querySelector<HTMLElement>(
    `[data-canvas-object="${objectId}"]`,
  );
  if (!card) throw new Error(`Canvas object ${objectId} was not rendered.`);
  return card;
}

describe("Realtime thought draft on the spatial canvas", () => {
  it("shows provisional speech inside only the active thought card without persisting it", async () => {
    const user = userEvent.setup();
    const { container, store, voice } = renderVoiceRoom();
    await startThought(voice);
    const thoughtId = store.getState().selectedObjectId;
    if (!thoughtId) throw new Error("Thought card was not selected.");

    act(() => {
      store.getState().dispatch(
        {
          type: "object.create",
          object: {
            id: "other-note",
            type: "note",
            title: "Other note",
            x: 520,
            y: 80,
            width: 280,
            height: 190,
            zIndex: 2,
            payload: { text: "Existing text", tone: "sky" },
          },
        },
        "collaborator",
      );
    });
    await user.click(within(objectCard(container, "other-note")).getByRole("button", {
      name: "Select Other note",
    }));

    act(() => {
      voice.onUserSpeechStarted?.("thought-live-delta");
      voice.onTranscriptDelta?.("This is still being spoken.", "thought-live-delta");
    });

    expect(
      within(objectCard(container, thoughtId)).getByRole("status", {
        name: "Live transcription for New thought",
      }),
    ).toHaveTextContent("This is still being spoken.");
    expect(
      within(objectCard(container, "other-note")).queryByRole("status", {
        name: /Live transcription/,
      }),
    ).toBeNull();
    const thought = store.getState().canvas.objects[thoughtId];
    expect(thought?.type === "note" ? thought.payload.text : undefined).toBe("");
    expect(store.getState().canvas.receipts.map((receipt) => receipt.action)).toEqual([
      "create",
      "create",
    ]);
  });

  it("keeps the provisional draft until the canonical append succeeds and never renders final text twice", async () => {
    let resolveAppend: ((result: CommandResult) => void) | undefined;
    const drafts: Array<string | null> = [];
    const storeRef: {
      current: ReturnType<typeof createCanvasStore> | null;
    } = { current: null };
    const onCommand = (
      command: CanvasCommand,
      source: CanvasCommandSource,
    ): CommandResult | Promise<CommandResult> => {
      if (!storeRef.current) throw new Error("Canvas store is unavailable.");
      const result = storeRef.current.getState().dispatch(command, source);
      if (command.type !== "object.append_note_text") return result;
      return new Promise<CommandResult>((resolve) => {
        resolveAppend = resolve;
      });
    };
    const rendered = renderVoiceRoom({
      onCommand,
      onThoughtDraftChange: (text) => drafts.push(text),
    });
    const store = rendered.store;
    storeRef.current = store;
    const { container, voice } = rendered;
    await startThought(voice);
    const thoughtId = store.getState().selectedObjectId;
    if (!thoughtId) throw new Error("Thought card was not selected.");

    act(() => {
      voice.onUserSpeechStarted?.("thought-final");
      voice.onTranscriptDelta?.("A professional pie chart.", "thought-final");
      voice.onTranscript?.("A professional pie chart.", "thought-final");
      voice.onResponseSettled?.("completed", "thought-final");
    });

    await waitFor(() => {
      const thought = store.getState().canvas.objects[thoughtId];
      expect(thought?.type === "note" ? thought.payload.text : undefined).toBe(
        "A professional pie chart.",
      );
    });
    expect(drafts.at(-1)).toBe("A professional pie chart.");
    expect(
      within(objectCard(container, thoughtId)).getAllByText(
        "A professional pie chart.",
      ),
    ).toHaveLength(1);
    expect(resolveAppend).toBeDefined();

    await act(async () => {
      resolveAppend?.({
        ok: true,
        state: store.getState().canvas,
        receipt: store.getState().canvas.receipts.at(-1)!,
      });
    });
    await waitFor(() => expect(drafts.at(-1)).toBeNull());
    expect(
      within(objectCard(container, thoughtId)).queryByRole("status", {
        name: "Live transcription for New thought",
      }),
    ).toBeNull();

    act(() => {
      voice.onTranscript?.("A professional pie chart.", "thought-final");
      voice.onResponseSettled?.("completed", "thought-final");
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    const thought = store.getState().canvas.objects[thoughtId];
    expect(thought?.type === "note" ? thought.payload.text : undefined).toBe(
      "A professional pie chart.",
    );
    expect(
      store
        .getState()
        .canvas.receipts.filter((receipt) => receipt.action === "update"),
    ).toHaveLength(1);
  });

  it("keeps a thought active and visible so a rejected transport append can be retried once", async () => {
    const drafts: Array<string | null> = [];
    const storeRef: {
      current: ReturnType<typeof createCanvasStore> | null;
    } = { current: null };
    let appendAttempts = 0;
    const onCommand = (
      command: CanvasCommand,
      source: CanvasCommandSource,
    ): CommandResult => {
      if (!storeRef.current) throw new Error("Canvas store is unavailable.");
      if (command.type === "object.append_note_text") {
        appendAttempts += 1;
        if (appendAttempts === 1)
          throw new Error("Realtime transport disconnected before confirmation.");
      }
      return storeRef.current.getState().dispatch(command, source);
    };
    const rendered = renderVoiceRoom({
      onCommand,
      onThoughtDraftChange: (text) => drafts.push(text),
    });
    const store = rendered.store;
    storeRef.current = store;
    const { container, voice } = rendered;
    await startThought(voice);
    const thoughtId = store.getState().selectedObjectId;
    if (!thoughtId) throw new Error("Thought card was not selected.");

    act(() => {
      voice.onUserSpeechStarted?.("thought-transport-failure");
      voice.onTranscriptDelta?.(
        "Keep this sentence through reconnect.",
        "thought-transport-failure",
      );
      voice.onTranscript?.(
        "Keep this sentence through reconnect.",
        "thought-transport-failure",
      );
      voice.onResponseSettled?.("completed", "thought-transport-failure");
    });

    await waitFor(() => expect(appendAttempts).toBe(1));
    expect(drafts.at(-1)).toBe("Keep this sentence through reconnect.");
    expect(
      within(objectCard(container, thoughtId)).getByRole("status", {
        name: "Live transcription for New thought",
      }),
    ).toHaveTextContent("Keep this sentence through reconnect.");
    let thought = store.getState().canvas.objects[thoughtId];
    expect(thought?.type === "note" ? thought.payload.text : undefined).toBe("");
    expect(store.getState().canvas.receipts).toHaveLength(1);

    act(() => {
      voice.onUserSpeechStarted?.("thought-transport-retry");
      voice.onTranscriptDelta?.(
        "Keep this sentence through reconnect.",
        "thought-transport-retry",
      );
      voice.onTranscript?.(
        "Keep this sentence through reconnect.",
        "thought-transport-retry",
      );
      voice.onResponseSettled?.("completed", "thought-transport-retry");
    });

    await waitFor(() => expect(appendAttempts).toBe(2));
    await waitFor(() => expect(drafts.at(-1)).toBeNull());
    thought = store.getState().canvas.objects[thoughtId];
    expect(thought?.type === "note" ? thought.payload.text : undefined).toBe(
      "Keep this sentence through reconnect.",
    );
    expect(
      store
        .getState()
        .canvas.receipts.filter((receipt) => receipt.action === "update"),
    ).toHaveLength(1);
  });

  it("keeps the live draft and capture active after a stale-version conflict", async () => {
    const drafts: Array<string | null> = [];
    const storeRef: {
      current: ReturnType<typeof createCanvasStore> | null;
    } = { current: null };
    let appendAttempts = 0;
    const onCommand = (
      command: CanvasCommand,
      source: CanvasCommandSource,
    ): CommandResult => {
      if (!storeRef.current) throw new Error("Canvas store is unavailable.");
      if (command.type === "object.append_note_text") {
        appendAttempts += 1;
        return {
          ok: false,
          state: storeRef.current.getState().canvas,
          error: {
            code: "STALE_OBJECT_VERSION",
            message: "The thought changed while speech was being confirmed.",
          },
        };
      }
      return storeRef.current.getState().dispatch(command, source);
    };
    const rendered = renderVoiceRoom({
      onCommand,
      onThoughtDraftChange: (text) => drafts.push(text),
    });
    const store = rendered.store;
    storeRef.current = store;
    const { container, voice } = rendered;
    await startThought(voice);
    const thoughtId = store.getState().selectedObjectId;
    if (!thoughtId) throw new Error("Thought card was not selected.");

    act(() => {
      voice.onUserSpeechStarted?.("thought-stale-conflict");
      voice.onTranscriptDelta?.(
        "Preserve these conflicted words.",
        "thought-stale-conflict",
      );
      voice.onTranscript?.(
        "Preserve these conflicted words.",
        "thought-stale-conflict",
      );
      voice.onResponseSettled?.("completed", "thought-stale-conflict");
    });

    await waitFor(() => expect(appendAttempts).toBe(1));
    expect(drafts.at(-1)).toBe("Preserve these conflicted words.");
    expect(
      within(objectCard(container, thoughtId)).getByRole("status", {
        name: "Live transcription for New thought",
      }),
    ).toHaveTextContent("Preserve these conflicted words.");
    await expect(
      voice.onIntent(
        { type: "create_note", text: "This must wait for thought recovery." },
        "voice",
      ),
    ).resolves.toEqual({
      ok: false,
      message: "Finish the active thought before using other canvas commands.",
    });
  });

  it("clears and releases capture when the canonical boundary says the card is not editable", async () => {
    const drafts: Array<string | null> = [];
    const storeRef: {
      current: ReturnType<typeof createCanvasStore> | null;
    } = { current: null };
    let appendAttempts = 0;
    const onCommand = (
      command: CanvasCommand,
      source: CanvasCommandSource,
    ): CommandResult => {
      if (!storeRef.current) throw new Error("Canvas store is unavailable.");
      if (command.type === "object.append_note_text") {
        appendAttempts += 1;
        return {
          ok: false,
          state: storeRef.current.getState().canvas,
          error: {
            code: "OBJECT_NOT_EDITABLE",
            message: "Only an active note can receive dictated text.",
          },
        };
      }
      return storeRef.current.getState().dispatch(command, source);
    };
    const rendered = renderVoiceRoom({
      onCommand,
      onThoughtDraftChange: (text) => drafts.push(text),
    });
    const store = rendered.store;
    storeRef.current = store;
    const { container, voice } = rendered;
    await startThought(voice);
    const thoughtId = store.getState().selectedObjectId;
    if (!thoughtId) throw new Error("Thought card was not selected.");

    act(() => {
      voice.onUserSpeechStarted?.("thought-wrong-type");
      voice.onTranscriptDelta?.("This card became invalid.", "thought-wrong-type");
      voice.onTranscript?.("This card became invalid.", "thought-wrong-type");
      voice.onResponseSettled?.("completed", "thought-wrong-type");
    });

    await waitFor(() => expect(appendAttempts).toBe(1));
    await waitFor(() => expect(drafts.at(-1)).toBeNull());
    expect(
      within(objectCard(container, thoughtId)).queryByRole("status", {
        name: "Live transcription for New thought",
      }),
    ).toBeNull();
    await expect(
      voice.onIntent(
        { type: "create_note", text: "Continue after terminal refusal." },
        "voice",
      ),
    ).resolves.toEqual({ ok: true, message: "Note command submitted." });
  });

  it("clears uncommitted speech when the turn is interrupted", async () => {
    const { container, store, voice } = renderVoiceRoom();
    await startThought(voice);
    const thoughtId = store.getState().selectedObjectId;
    if (!thoughtId) throw new Error("Thought card was not selected.");

    act(() => {
      voice.onUserSpeechStarted?.("thought-interrupted");
      voice.onTranscriptDelta?.("Unfinished sentence", "thought-interrupted");
      voice.onTranscript?.("Unfinished sentence", "thought-interrupted");
      voice.onResponseSettled?.("interrupted", "thought-interrupted");
    });

    await waitFor(() =>
      expect(
        within(objectCard(container, thoughtId)).queryByRole("status", {
          name: "Live transcription for New thought",
        }),
      ).toBeNull(),
    );
    const thought = store.getState().canvas.objects[thoughtId];
    expect(thought?.type === "note" ? thought.payload.text : undefined).toBe("");
    expect(store.getState().canvas.receipts).toHaveLength(1);
  });

  it("clears and releases thought capture immediately when a collaborator deletes the active card", async () => {
    const { container, store, voice } = renderVoiceRoom();
    await startThought(voice);
    const thoughtId = store.getState().selectedObjectId;
    if (!thoughtId) throw new Error("Thought card was not selected.");
    act(() => {
      voice.onUserSpeechStarted?.("thought-before-delete");
      voice.onTranscriptDelta?.("Do not leave this floating", "thought-before-delete");
    });
    expect(
      within(objectCard(container, thoughtId)).getByRole("status", {
        name: "Live transcription for New thought",
      }),
    ).toBeVisible();

    act(() => {
      store
        .getState()
        .dispatch({ type: "object.discard", objectId: thoughtId }, "collaborator");
    });

    await waitFor(() =>
      expect(
        container.querySelector(`[data-canvas-object="${thoughtId}"]`),
      ).toBeNull(),
    );
    let result: Awaited<ReturnType<RealtimeVoiceControllerOptions["onIntent"]>>;
    await act(async () => {
      result = await voice.onIntent(
        { type: "create_note", text: "Continue after deletion" },
        "voice",
      );
    });
    expect(result!).toEqual({ ok: true, message: "Note command submitted." });
    expect(
      Object.values(store.getState().canvas.objects).some(
        (object) =>
          !object.deletedAt &&
          object.type === "note" &&
          object.payload.text === "Continue after deletion",
      ),
    ).toBe(true);
  });
});
