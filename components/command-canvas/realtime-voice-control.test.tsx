import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  RealtimeVoiceControl,
  type RealtimeVoiceControlController,
} from "@/components/command-canvas/realtime-voice-control";
import type { RealtimeVoiceControllerOptions } from "@/lib/realtime-voice/client";

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

describe("RealtimeVoiceControl", () => {
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

  it("stops the media session on unmount", () => {
    const setup = controllerHarness();
    const view = render(
      <RealtimeVoiceControl
        roomId={ROOM_ID}
        getAccessToken={() => "header.payload.signature"}
        onIntent={() => ({ ok: true, message: "Submitted." })}
        createController={() => setup.controller}
      />,
    );

    view.unmount();
    expect(setup.controller.stop).toHaveBeenCalledOnce();
  });

  it("keeps one live controller while callback and token function identities change", async () => {
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
    const view = render(
      <RealtimeVoiceControl
        roomId={ROOM_ID}
        getAccessToken={firstToken}
        onIntent={firstIntent}
        createController={createController}
      />,
    );
    view.rerender(
      <RealtimeVoiceControl
        roomId={ROOM_ID}
        getAccessToken={secondToken}
        onIntent={secondIntent}
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
    expect(firstIntent).not.toHaveBeenCalled();
    expect(secondIntent).toHaveBeenCalledOnce();
  });
});
