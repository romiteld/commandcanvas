import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { HumanCommandControl } from "@/components/command-canvas/human-command-control";
import type { BrowserSpeechRecognizer } from "@/lib/canvas/speech-recognition";

function recognizerHarness(supported = true) {
  let transcript: ((value: string) => void) | undefined;
  let state: ((value: "idle" | "listening") => void) | undefined;
  const recognizer: BrowserSpeechRecognizer = {
    supported,
    start: vi.fn(),
    stop: vi.fn(),
    dispose: vi.fn(),
  };
  return {
    createRecognizer(options: {
      onTranscript?: (value: string) => void;
      onStateChange?: (value: "idle" | "listening") => void;
    }) {
      transcript = options.onTranscript;
      state = options.onStateChange;
      return recognizer;
    },
    recognizer,
    emitTranscript(value: string) {
      transcript?.(value);
    },
    emitState(value: "idle" | "listening") {
      state?.(value);
    },
  };
}

describe("HumanCommandControl", () => {
  it("submits one typed human intent and keeps agent authority separate", async () => {
    const user = userEvent.setup();
    const onIntent = vi.fn(() => ({ ok: true as const, message: "Board created." }));
    render(<HumanCommandControl onIntent={onIntent} />);

    expect(
      screen.getByText(
        "Direct shortcuts use the human command path. Agent actions arrive through WebMCP.",
      ),
    ).toBeVisible();
    await user.type(
      screen.getByRole("textbox", { name: "Direct canvas command" }),
      "Bring in our project board",
    );
    await user.click(screen.getByRole("button", { name: "Run direct command" }));

    expect(onIntent).toHaveBeenCalledWith(
      { type: "create_board" },
      "typed",
    );
    expect(await screen.findByText("Board created.")).toBeVisible();
  });

  it("stages recoverable discard for an explicit second confirmation", async () => {
    const user = userEvent.setup();
    const onIntent = vi.fn(() => ({ ok: true as const, message: "Moved to trash." }));
    render(
      <HumanCommandControl
        onIntent={onIntent}
        selectedObject={{ objectId: "note-a", title: "Launch note", version: 3 }}
      />,
    );

    await user.type(
      screen.getByRole("textbox", { name: "Direct canvas command" }),
      "get rid of that",
    );
    await user.click(screen.getByRole("button", { name: "Run direct command" }));

    expect(onIntent).not.toHaveBeenCalled();
    expect(
      screen.getByRole("alertdialog", {
        name: "Move Launch note to recoverable trash?",
      }),
    ).toBeVisible();
    expect(screen.getByRole("button", { name: "Cancel recoverable discard" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Confirm recoverable discard" }));

    expect(onIntent).toHaveBeenCalledWith(
      { type: "discard_selected" },
      "typed",
      { objectId: "note-a", title: "Launch note", version: 3 },
    );
  });

  it("keeps a discard confirmation bound to the exact staged object snapshot", async () => {
    const user = userEvent.setup();
    const onIntent = vi.fn(() => ({ ok: true as const, message: "Moved to trash." }));
    const { rerender } = render(
      <HumanCommandControl
        onIntent={onIntent}
        selectedObject={{ objectId: "note-a", title: "Launch note", version: 3 }}
      />,
    );

    await user.type(
      screen.getByRole("textbox", { name: "Direct canvas command" }),
      "get rid of that",
    );
    await user.click(screen.getByRole("button", { name: "Run direct command" }));

    rerender(
      <HumanCommandControl
        onIntent={onIntent}
        selectedObject={{ objectId: "note-b", title: "Risk note", version: 1 }}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Confirm recoverable discard" }));

    expect(onIntent).toHaveBeenCalledWith(
      { type: "discard_selected" },
      "typed",
      { objectId: "note-a", title: "Launch note", version: 3 },
    );
  });

  it("names the discard dialog, closes it with Escape, and returns focus", async () => {
    const user = userEvent.setup();
    render(
      <HumanCommandControl
        onIntent={() => ({ ok: true, message: "Moved to trash." })}
        selectedObject={{ objectId: "note-a", title: "Launch note", version: 3 }}
      />,
    );
    const run = screen.getByRole("button", { name: "Run direct command" });
    await user.type(
      screen.getByRole("textbox", { name: "Direct canvas command" }),
      "discard this",
    );
    await user.click(run);

    const dialog = screen.getByRole("alertdialog", {
      name: "Move Launch note to recoverable trash?",
    });
    expect(screen.getByRole("button", { name: "Cancel recoverable discard" })).toHaveFocus();
    await user.keyboard("{Escape}");

    expect(dialog).not.toBeInTheDocument();
    expect(run).toHaveFocus();
  });

  it("places browser speech transcription into the reviewable command input", async () => {
    const user = userEvent.setup();
    const speech = recognizerHarness();
    const onIntent = vi.fn(() => ({ ok: true as const, message: "Schedule created." }));
    render(
      <HumanCommandControl
        onIntent={onIntent}
        createSpeechRecognizer={speech.createRecognizer}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Start voice transcription" }));
    expect(speech.recognizer.start).toHaveBeenCalledOnce();
    act(() => speech.emitState("listening"));
    expect(await screen.findByText("Listening…")).toBeVisible();
    act(() => {
      speech.emitTranscript("Put next week's schedule over here");
      speech.emitState("idle");
    });

    expect(
      screen.getByRole("textbox", { name: "Direct canvas command" }),
    ).toHaveValue("Put next week's schedule over here");
    expect(onIntent).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Run direct command" }));
    expect(onIntent).toHaveBeenCalledWith(
      { type: "create_schedule" },
      "voice",
    );
  });

  it("keeps typed input available when browser speech is unsupported", () => {
    const speech = recognizerHarness(false);
    render(
      <HumanCommandControl
        onIntent={() => ({ ok: true, message: "Done." })}
        createSpeechRecognizer={speech.createRecognizer}
      />,
    );

    expect(screen.getByRole("textbox", { name: "Direct canvas command" })).toBeEnabled();
    expect(
      screen.getByRole("button", { name: "Voice transcription unavailable" }),
    ).toBeDisabled();
  });

  it("stops an active transcription when disabled without disabling Stop", async () => {
    const user = userEvent.setup();
    const speech = recognizerHarness();
    const { rerender } = render(
      <HumanCommandControl
        onIntent={() => ({ ok: true, message: "Done." })}
        createSpeechRecognizer={speech.createRecognizer}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Start voice transcription" }));
    act(() => speech.emitState("listening"));
    rerender(
      <HumanCommandControl
        disabled
        onIntent={() => ({ ok: true, message: "Done." })}
        createSpeechRecognizer={speech.createRecognizer}
      />,
    );

    expect(speech.recognizer.stop).toHaveBeenCalledOnce();
    expect(screen.getByRole("button", { name: "Stop voice transcription" })).toBeEnabled();
  });

  it("disposes the speech recognizer when the control unmounts", () => {
    const speech = recognizerHarness();
    const { unmount } = render(
      <HumanCommandControl
        onIntent={() => ({ ok: true, message: "Done." })}
        createSpeechRecognizer={speech.createRecognizer}
      />,
    );

    unmount();

    expect(speech.recognizer.dispose).toHaveBeenCalledOnce();
  });
});
