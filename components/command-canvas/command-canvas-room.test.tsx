import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
} from "@/lib/canvas/command-engine";
import type {
  HandTrackingController,
  HandTrackingObservation,
  HandTrackingStatus,
} from "@/lib/gesture/hand-tracking-controller";
import type { RealtimeVoiceControllerOptions } from "@/lib/realtime-voice/client";
import { DEFAULT_HAND_ACTIVE_ZONE } from "@/lib/gesture/spatial-gesture";

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
    now: () => `2026-08-27T14:00:${String(second++).padStart(2, "0")}.000Z`,
  };
}

function seedSketch(store: ReturnType<typeof createCanvasStore>) {
  store.getState().dispatch(
    {
      type: "object.create",
      object: {
        id: "sketch-source",
        type: "sketch",
        title: "Rough architecture",
        x: 20,
        y: 30,
        width: 360,
        height: 220,
        zIndex: 1,
        payload: {
          strokes: [
            {
              id: "stroke-source",
              color: "#12233d",
              width: 5,
              points: [
                { x: 12, y: 20 },
                { x: 100, y: 30 },
              ],
            },
          ],
        },
      },
    },
    "system",
  );
}

function seedNote(
  store: ReturnType<typeof createCanvasStore>,
  input: { id: string; title: string; x: number },
) {
  store.getState().dispatch(
    {
      type: "object.create",
      object: {
        id: input.id,
        type: "note",
        title: input.title,
        x: input.x,
        y: 30,
        width: 280,
        height: 190,
        zIndex: input.x,
        payload: { text: input.title, tone: "sky" },
      },
    },
    "system",
  );
}

function fakeHandController() {
  let status: HandTrackingStatus = { state: "off" };
  const statusListeners = new Set<(next: HandTrackingStatus) => void>();
  const observationListeners = new Set<
    (next: HandTrackingObservation) => void
  >();
  const controller: HandTrackingController = {
    getStatus: () => status,
    subscribeStatus(listener) {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    },
    subscribeObservations(listener) {
      observationListeners.add(listener);
      return () => observationListeners.delete(listener);
    },
    start: vi.fn(async () => undefined),
    stop: vi.fn(),
  };
  return {
    controller,
    setStatus(next: HandTrackingStatus) {
      status = next;
      statusListeners.forEach((listener) => listener(next));
    },
    emit(next: HandTrackingObservation) {
      // Component tests describe logical canvas positions. The fake camera
      // converts them into the comfortable physical control region before the
      // production component maps that region back across the canvas.
      observationListeners.forEach((listener) =>
        listener(cameraObservationForCanvasObservation(next)),
      );
    },
  };
}

function cameraObservationForCanvasObservation(
  observation: HandTrackingObservation,
): HandTrackingObservation {
  if (observation.mode === "idle") return observation;
  if (observation.mode !== "bimanual_pinch")
    return { ...observation, pointer: cameraPointer(observation.pointer) };
  const hands = observation.hands.map((hand) => ({
    ...hand,
    pointer: cameraPointer(hand.pointer),
  })) as unknown as typeof observation.hands;
  return {
    ...observation,
    hands,
    center: cameraPointer(observation.center),
    span: Math.hypot(
      hands[0].pointer.x - hands[1].pointer.x,
      hands[0].pointer.y - hands[1].pointer.y,
    ),
  };
}

function cameraPointer(pointer: { x: number; y: number }) {
  return {
    x:
      DEFAULT_HAND_ACTIVE_ZONE.left +
      pointer.x *
        (DEFAULT_HAND_ACTIVE_ZONE.right - DEFAULT_HAND_ACTIVE_ZONE.left),
    y:
      DEFAULT_HAND_ACTIVE_ZONE.top +
      pointer.y *
        (DEFAULT_HAND_ACTIVE_ZONE.bottom - DEFAULT_HAND_ACTIVE_ZONE.top),
  };
}

function setCanvasBounds(
  container: HTMLElement,
  dimensions: { width: number; height: number } = {
    width: 1_000,
    height: 500,
  },
) {
  const viewport = container.querySelector(".canvas-viewport");
  if (!(viewport instanceof HTMLElement))
    throw new Error("Canvas viewport fixture was not rendered.");
  vi.spyOn(viewport, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: dimensions.width,
    bottom: dimensions.height,
    width: dimensions.width,
    height: dimensions.height,
    toJSON: () => ({}),
  });
}

describe("CommandCanvasRoom", () => {
  it("offers the complete AGPL source from the browser-visible system drawer", async () => {
    const user = userEvent.setup();
    const store = createCanvasStore("room-local", dependencies());

    render(<CommandCanvasRoom store={store} />);
    await user.click(screen.getByRole("button", { name: "Open system status" }));

    expect(
      screen.getByRole("link", { name: "Source · AGPL-3.0" }),
    ).toHaveAttribute(
      "href",
      expect.stringMatching(
        /^https:\/\/github\.com\/romiteld\/commandcanvas\/tree\/(?:main|[0-9a-f]{40})$/,
      ),
    );
  });

  it("auto-fits a seeded workspace once on a compact viewport", async () => {
    const store = createCanvasStore("room-mobile-seed", dependencies());
    seedNote(store, { id: "seed-left", title: "Launch board", x: 90 });
    seedNote(store, { id: "seed-right", title: "Schedule", x: 760 });
    const { container } = render(<CommandCanvasRoom store={store} />);
    setCanvasBounds(container, { width: 390, height: 620 });

    await waitFor(() => {
      expect(store.getState().viewport.scale).toBeLessThan(1);
    });

    const fitted = store.getState().viewport;
    const left = store.getState().canvas.objects["seed-left"];
    expect(fitted.scale).toBeGreaterThanOrEqual(0.5);
    expect(left.x * fitted.scale + fitted.x).toBeGreaterThanOrEqual(0);
    expect(left.x * fitted.scale + fitted.x).toBeLessThan(390);
    expect(container.querySelector(".canvas-world")).toHaveStyle({
      "--canvas-ui-scale": `${1 / fitted.scale}`,
    });
  });

  it("reserves a top-edge media row so meeting video does not cover the canvas", () => {
    const store = createCanvasStore("room-local", dependencies());
    const { container } = render(
      <CommandCanvasRoom
        store={store}
        meetingMediaPanel={<section aria-label="Meeting video">Video tiles</section>}
      />,
    );

    expect(screen.getByRole("region", { name: "Meeting video" })).toBeVisible();
    expect(container.querySelector(".command-canvas-shell")).toHaveClass(
      "has-meeting-media",
    );
    expect(
      screen.getByRole("region", { name: "Infinite canvas" }),
    ).toBeVisible();
  });

  it("keeps command, approval, and system scaffolding in an opt-in overlay drawer", async () => {
    const user = userEvent.setup();
    const store = createCanvasStore("room-local", dependencies());
    render(
      <CommandCanvasRoom
        store={store}
        realtimeVoice={{
          roomId: "room-local",
          getAccessToken: () => "header.payload.signature",
        }}
        meetingPacketPanel={
          <section aria-label="Meeting packet workflow">Packet review</section>
        }
      />,
    );

    expect(
      screen.getByRole("region", { name: "Infinite canvas" }),
    ).toBeVisible();
    expect(
      screen.queryByRole("complementary", { name: "Command drawer" }),
    ).toBeNull();
    expect(
      screen.queryByRole("region", { name: "Meeting packet workflow" }),
    ).toBeNull();

    await user.click(screen.getByRole("button", { name: "Open command drawer" }));

    expect(
      screen.getByRole("complementary", { name: "Command drawer" }),
    ).toBeVisible();
    expect(screen.getByLabelText("Live voice command")).toBeVisible();
    expect(screen.getByLabelText("Meeting packet workflow")).toBeVisible();
    expect(screen.getByText("Packet review")).toBeVisible();
    expect(
      screen.getByText("Type a command instead"),
    ).toBeVisible();
    expect(
      screen.queryByRole("textbox", { name: "Direct canvas command" }),
    ).toBeNull();
    await user.click(screen.getByText("Type a command instead"));
    expect(
      screen.getByRole("textbox", { name: "Direct canvas command" }),
    ).toBeVisible();
    expect(
      screen
        .getByRole("button", { name: "Voice transcription unavailable" })
        .closest(".typed-command-fallback"),
    ).toHaveClass("has-realtime-voice");

    await user.click(screen.getByRole("button", { name: "Close command drawer" }));
    expect(
      screen.queryByRole("complementary", { name: "Command drawer" }),
    ).toBeNull();
  });

  it("does not pan the canvas when an overlay control moves under a pointer", async () => {
    const user = userEvent.setup();
    const store = createCanvasStore("room-local", dependencies());
    const { container } = render(<CommandCanvasRoom store={store} />);

    await user.click(screen.getByRole("button", { name: "Open command drawer" }));
    const close = screen.getByRole("button", { name: "Close command drawer" });
    const viewport = container.querySelector<HTMLElement>(".canvas-viewport");
    if (!viewport) throw new Error("Canvas viewport fixture was not rendered.");
    const before = store.getState().viewport;

    fireEvent.pointerDown(close, {
      pointerId: 17,
      clientX: 100,
      clientY: 100,
    });
    fireEvent.pointerMove(viewport, {
      pointerId: 17,
      clientX: 96,
      clientY: 100,
    });
    fireEvent.pointerUp(viewport, {
      pointerId: 17,
      clientX: 96,
      clientY: 100,
    });

    expect(store.getState().viewport).toEqual(before);
  });

  it("routes Realtime tool intents through the canonical voice mutation pipeline", async () => {
    const user = userEvent.setup();
    const store = createCanvasStore("room-local", dependencies());
    let options: RealtimeVoiceControllerOptions | undefined;
    const idleState = { status: "idle" as const };
    const controller = {
      getState: () => idleState,
      subscribe: () => () => undefined,
      start: vi.fn(async () => undefined),
      stop: vi.fn(),
      resumeAudio: vi.fn(async () => true),
    };

    render(
      <CommandCanvasRoom
        store={store}
        realtimeVoice={{
          roomId: "room-local",
          getAccessToken: () => "header.payload.signature",
          createController(nextOptions) {
            options = nextOptions;
            return controller;
          },
        }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Open command drawer" }));
    expect(screen.getByRole("button", { name: "Start live voice" })).toBeVisible();

    let result:
      | { ok: true; message: string }
      | { ok: false; message: string }
      | undefined;
    await act(async () => {
      result = await options?.onIntent({ type: "create_board" }, "voice");
    });

    expect(result).toEqual({ ok: true, message: "Board command submitted." });
    expect(
      Object.values(store.getState().canvas.objects).some(
        (object) => object.type === "task_board" && !object.deletedAt,
      ),
    ).toBe(true);
    expect(store.getState().canvas.receipts.at(-1)?.source).toBe("voice");
  });

  it("routes expanded Realtime spatial intents through selection and canonical history", async () => {
    const user = userEvent.setup();
    const store = createCanvasStore("room-local", dependencies());
    seedNote(store, { id: "note-first", title: "First note", x: 40 });
    seedNote(store, { id: "note-second", title: "Second note", x: 400 });
    let options: RealtimeVoiceControllerOptions | undefined;
    const idleState = { status: "idle" as const };
    const { container } = render(
      <CommandCanvasRoom
        store={store}
        realtimeVoice={{
          roomId: "room-local",
          getAccessToken: () => "header.payload.signature",
          createController(nextOptions) {
            options = nextOptions;
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
    setCanvasBounds(container);

    await user.click(screen.getByRole("button", { name: "Select First note" }));
    await user.keyboard("{Shift>}");
    await user.click(screen.getByRole("button", { name: "Select Second note" }));
    await user.keyboard("{/Shift}");

    let result: Awaited<ReturnType<RealtimeVoiceControllerOptions["onIntent"]>>;
    await act(async () => {
      result = await options!.onIntent({ type: "group_selected" }, "voice");
    });
    expect(result!).toEqual({ ok: true, message: "Group command submitted." });
    const frame = Object.values(store.getState().canvas.objects).find(
      (object) => object.type === "frame" && !object.deletedAt,
    );
    expect(frame).toBeDefined();
    expect(store.getState().canvas.receipts.at(-1)?.source).toBe("voice");

    await act(async () => {
      result = await options!.onIntent({ type: "focus_selected" }, "voice");
    });
    expect(result!).toEqual({ ok: true, message: "Focus command applied." });
    expect(store.getState().viewport.scale).toBeGreaterThan(1);

    await act(async () => {
      result = await options!.onIntent(
        { type: "rotate_selected", direction: "clockwise" },
        "voice",
      );
    });
    expect(result!).toEqual({ ok: true, message: "Rotate command submitted." });
    expect(store.getState().canvas.objects[frame!.id]?.rotation).toBe(15);

    await act(async () => {
      await options!.onIntent({ type: "undo" }, "voice");
      result = await options!.onIntent({ type: "redo" }, "voice");
    });
    expect(result!).toEqual({ ok: true, message: "Redo command submitted." });
    expect(store.getState().canvas.objects[frame!.id]?.rotation).toBe(15);

    await act(async () => {
      result = await options!.onIntent({ type: "ungroup_selected" }, "voice");
    });
    expect(result!).toEqual({ ok: true, message: "Ungroup command submitted." });
    expect(store.getState().canvas.objects["note-first"]?.parentId).toBeNull();
    expect(store.getState().canvas.objects["note-second"]?.parentId).toBeNull();
  });

  it("keeps an active Realtime session mounted when the command drawer closes", async () => {
    const user = userEvent.setup();
    const store = createCanvasStore("room-local", dependencies());
    const idleState = { status: "idle" as const };
    const controller = {
      getState: () => idleState,
      subscribe: () => () => undefined,
      start: vi.fn(async () => undefined),
      stop: vi.fn(),
      resumeAudio: vi.fn(async () => true),
    };

    render(
      <CommandCanvasRoom
        store={store}
        realtimeVoice={{
          roomId: "room-local",
          getAccessToken: () => "header.payload.signature",
          createController: () => controller,
        }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Open command drawer" }));
    await user.click(screen.getByRole("button", { name: "Start live voice" }));
    await user.click(screen.getByRole("button", { name: "Close command drawer" }));

    expect(controller.start).toHaveBeenCalledOnce();
    expect(controller.stop).not.toHaveBeenCalled();
    expect(
      screen.queryByRole("complementary", { name: "Command drawer" }),
    ).toBeNull();
  });

  it("opens the command drawer when a consequential approval requests attention", async () => {
    const store = createCanvasStore("room-local", dependencies());
    const { rerender } = render(
      <CommandCanvasRoom
        store={store}
        meetingPacketPanel={
          <section aria-label="Packet approval">Review exact recipients</section>
        }
      />,
    );
    expect(
      screen.queryByRole("complementary", { name: "Command drawer" }),
    ).toBeNull();

    rerender(
      <CommandCanvasRoom
        store={store}
        commandDrawerRequestKey="send-request-1"
        meetingPacketPanel={
          <section aria-label="Packet approval">Review exact recipients</section>
        }
      />,
    );

    expect(
      await screen.findByRole("complementary", { name: "Command drawer" }),
    ).toBeVisible();
    expect(screen.getByText("Review exact recipients")).toBeVisible();
  });

  it("shows the current hand mode and grabbed object on the canvas itself", async () => {
    const user = userEvent.setup();
    const hand = fakeHandController();
    const store = createCanvasStore("room-local", dependencies());
    seedNote(store, { id: "note-spatial", title: "Spatial note", x: 200 });
    const { container } = render(
      <CommandCanvasRoom
        store={store}
        createHandTrackingController={() => hand.controller}
      />,
    );
    setCanvasBounds(container);

    await user.click(screen.getByRole("button", { name: "Open system status" }));
    await user.click(screen.getByRole("button", { name: "Enable hand input" }));
    act(() => hand.setStatus({ state: "ready" }));
    hand.emit({
      mode: "point",
      pointer: { x: 0.72, y: 0.42 },
      confidence: 0.97,
      timestamp: 1_000,
    });

    expect(await screen.findByText("POINT")).toBeVisible();
    expect(container.querySelector("[data-hand-cursor]")).not.toBeNull();

    hand.emit({ mode: "idle", timestamp: 1_008 });
    hand.emit({
      mode: "point",
      pointer: { x: 0.19, y: 0.18 },
      confidence: 0.97,
      timestamp: 1_012,
    });
    expect(await screen.findByText("TARGET")).toBeVisible();
    expect(
      screen
        .getByRole("button", { name: "Select Spatial note" })
        .closest("article"),
    ).toHaveClass("is-hand-target");

    hand.emit({ mode: "idle", timestamp: 1_014 });
    hand.emit({
      mode: "pinch",
      pointer: { x: 0.25, y: 0.18 },
      confidence: 0.97,
      timestamp: 1_016,
    });

    expect(await screen.findByText("HELD")).toBeVisible();
    expect(
      screen
        .getByRole("button", { name: "Select Spatial note" })
        .closest("article"),
    ).toHaveClass("is-held");
    expect(screen.getAllByText("Throw to trash")).toHaveLength(2);
    expect(screen.getByText("Minimize dock")).toBeVisible();
  });

  it("closes calibration automatically and keeps enabled hand input active", async () => {
    const user = userEvent.setup();
    const hand = fakeHandController();
    const store = createCanvasStore("room-local", dependencies());
    const { container } = render(
      <CommandCanvasRoom
        store={store}
        createHandTrackingController={() => hand.controller}
      />,
    );
    setCanvasBounds(container);

    await user.click(screen.getByRole("button", { name: "Open system status" }));
    await user.click(screen.getByRole("button", { name: "Enable hand input" }));
    act(() => hand.setStatus({ state: "ready" }));

    expect(
      screen.queryByRole("complementary", { name: "System status drawer" }),
    ).toBeNull();
    expect(hand.controller.stop).not.toHaveBeenCalled();

    hand.emit({
      mode: "point",
      pointer: { x: 0.4, y: 0.35 },
      confidence: 0.98,
      timestamp: 1_040,
    });

    expect(await screen.findByText("POINT")).toBeVisible();
    expect(container.querySelector("[data-hand-cursor]")).not.toBeNull();
  });

  it("returns active hand control to the full canvas instead of leaving the camera as the workspace", async () => {
    const user = userEvent.setup();
    const hand = fakeHandController();
    const store = createCanvasStore("room-local", dependencies());
    const { container } = render(
      <CommandCanvasRoom
        store={store}
        createHandTrackingController={() => hand.controller}
      />,
    );
    setCanvasBounds(container);

    await user.click(screen.getByRole("button", { name: "Open system status" }));
    await user.click(screen.getByRole("button", { name: "Enable hand input" }));
    act(() => hand.setStatus({ state: "ready" }));

    expect(
      screen.queryByRole("complementary", { name: "System status drawer" }),
    ).toBeNull();
    expect(
      screen.getByRole("region", { name: "Hand interaction controls" }),
    ).toHaveTextContent("HAND CONTROL · FULL CANVAS");
    expect(
      screen.getByRole("button", { name: "Open hand calibration" }),
    ).toBeVisible();

    await user.click(
      screen.getByRole("button", { name: "Open hand calibration" }),
    );

    expect(
      screen.getByRole("complementary", { name: "System status drawer" }),
    ).toBeVisible();
    expect(container.querySelector(".command-canvas-shell")).toHaveClass(
      "is-system-open",
    );
    expect(
      screen.getByRole("button", { name: "Close hand calibration" }),
    ).toBeVisible();

    await user.click(
      screen.getByRole("button", { name: "Close hand calibration" }),
    );
    expect(
      screen.queryByRole("complementary", { name: "System status drawer" }),
    ).toBeNull();
    expect(container.querySelector(".command-canvas-shell")).not.toHaveClass(
      "is-system-open",
    );
  });

  it("treats camera calibration as sensor-only input and never manipulates the hidden canvas", async () => {
    const user = userEvent.setup();
    const hand = fakeHandController();
    const store = createCanvasStore("room-local", dependencies());
    seedNote(store, { id: "note-calibration", title: "Calibration target", x: 120 });
    const { container } = render(
      <CommandCanvasRoom
        store={store}
        createHandTrackingController={() => hand.controller}
      />,
    );
    setCanvasBounds(container);

    await user.click(screen.getByRole("button", { name: "Open system status" }));
    await user.click(screen.getByRole("button", { name: "Enable hand input" }));
    act(() => hand.setStatus({ state: "ready" }));

    act(() => {
      hand.emit({ mode: "idle", timestamp: 990 });
      hand.emit({
        mode: "point",
        pointer: { x: 0.19, y: 0.18 },
        confidence: 0.98,
        timestamp: 995,
      });
    });
    expect(await screen.findByText("TARGET")).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: "Open hand calibration" }),
    );

    expect(
      screen
        .getByRole("button", { name: "Select Calibration target" })
        .closest("article"),
    ).not.toHaveClass("is-hand-target");

    act(() =>
      hand.emit({
        mode: "pinch",
        pointer: { x: 0.2, y: 0.3 },
        confidence: 0.98,
        timestamp: 1_000,
      }),
    );

    expect(
      screen.getByRole("complementary", { name: "System status drawer" }),
    ).toBeVisible();
    expect(
      screen
        .getByRole("button", { name: "Select Calibration target" })
        .closest("article"),
    ).not.toHaveClass("is-held");
    expect(store.getState().canvas.receipts).toHaveLength(1);

    await user.click(
      screen.getByRole("button", { name: "Close hand calibration" }),
    );
    act(() =>
      hand.emit({
        mode: "pinch",
        pointer: { x: 0.19, y: 0.18 },
        confidence: 0.98,
        timestamp: 1_010,
      }),
    );
    expect(
      screen
        .getByRole("button", { name: "Select Calibration target" })
        .closest("article"),
    ).not.toHaveClass("is-held");

    act(() => {
      hand.emit({ mode: "idle", timestamp: 1_020 });
      hand.emit({
        mode: "point",
        pointer: { x: 0.19, y: 0.18 },
        confidence: 0.98,
        timestamp: 1_030,
      });
    });
    expect(await screen.findByText("TARGET")).toBeVisible();
  });

  it("uses the whole viewport as the visible hand control plane and closes diagnostics on activity", async () => {
    const user = userEvent.setup();
    const hand = fakeHandController();
    const store = createCanvasStore("room-local", dependencies());
    const { container } = render(
      <CommandCanvasRoom
        store={store}
        createHandTrackingController={() => hand.controller}
      />,
    );
    setCanvasBounds(container);

    const viewport = container.querySelector(".canvas-viewport");
    expect(viewport).not.toHaveAttribute("data-spatial-control-plane");

    await user.click(screen.getByRole("button", { name: "Open system status" }));
    await user.click(screen.getByRole("button", { name: "Enable hand input" }));
    act(() => hand.setStatus({ state: "ready" }));

    expect(viewport).toHaveAttribute("data-spatial-control-plane", "active");
    expect(container.querySelector(".hand-control-plane-indicator")).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Open system status" }));
    expect(
      screen.getByRole("complementary", { name: "System status drawer" }),
    ).toBeVisible();

    act(() =>
      hand.emit({
        mode: "point",
        pointer: { x: 0.5, y: 0.5 },
        confidence: 0.98,
        timestamp: 1_040,
      }),
    );

    expect(
      screen.queryByRole("complementary", { name: "System status drawer" }),
    ).toBeNull();
    expect(hand.controller.stop).not.toHaveBeenCalled();
  });

  it("keeps a magnetic hand target through the point-to-pinch shape change", async () => {
    const user = userEvent.setup();
    const hand = fakeHandController();
    const store = createCanvasStore("room-local", dependencies());
    seedNote(store, { id: "note-spatial", title: "Spatial note", x: 200 });
    const { container } = render(
      <CommandCanvasRoom
        store={store}
        createHandTrackingController={() => hand.controller}
      />,
    );
    setCanvasBounds(container);
    await user.click(screen.getByRole("button", { name: "Open system status" }));
    await user.click(screen.getByRole("button", { name: "Enable hand input" }));
    act(() => hand.setStatus({ state: "ready" }));

    act(() =>
      hand.emit({
        mode: "point",
        pointer: { x: 0.19, y: 0.35 },
        confidence: 0.97,
        timestamp: 1_000,
      }),
    );
    expect(await screen.findByText("TARGET")).toBeVisible();

    act(() =>
      hand.emit({
        mode: "pinch",
        pointer: { x: 0.12, y: 0.35 },
        confidence: 0.97,
        timestamp: 1_016,
      }),
    );

    expect(await screen.findByText("HELD")).toBeVisible();
    expect(
      screen
        .getByRole("button", { name: "Select Spatial note" })
        .closest("article"),
    ).toHaveClass("is-held");
  });

  it("keeps pointing non-mutating until the user explicitly arms hand drawing", async () => {
    const user = userEvent.setup();
    const hand = fakeHandController();
    const store = createCanvasStore("room-local", dependencies());
    const { container } = render(
      <CommandCanvasRoom
        store={store}
        createHandTrackingController={() => hand.controller}
      />,
    );
    setCanvasBounds(container);
    await user.click(screen.getByRole("button", { name: "Open system status" }));
    await user.click(screen.getByRole("button", { name: "Enable hand input" }));
    act(() => hand.setStatus({ state: "ready" }));
    expect(await screen.findAllByText("Hand input ready · local only")).toHaveLength(2);
    expect(screen.queryByText("Camera off")).toBeNull();

    hand.emit({
      mode: "point",
      pointer: { x: 0.2, y: 0.3 },
      confidence: 0.96,
      timestamp: 1_000,
    });
    hand.emit({
      mode: "point",
      pointer: { x: 0.26, y: 0.36 },
      confidence: 0.96,
      timestamp: 1_016,
    });
    hand.emit({ mode: "idle", timestamp: 1_032 });

    expect(Object.values(store.getState().canvas.objects)).toHaveLength(0);
    expect(screen.getByText("HAND CONTROL · FULL CANVAS")).toBeVisible();
  });

  it("collects repeated finger lines into one sketch and one receipt when finished", async () => {
    const user = userEvent.setup();
    const hand = fakeHandController();
    const store = createCanvasStore("room-local", dependencies());
    const { container } = render(
      <CommandCanvasRoom
        store={store}
        createHandTrackingController={() => hand.controller}
      />,
    );
    setCanvasBounds(container);
    await user.click(screen.getByRole("button", { name: "Open system status" }));
    await user.click(screen.getByRole("button", { name: "Enable hand input" }));
    act(() => hand.setStatus({ state: "ready" }));
    await user.click(
      screen.getByRole("button", { name: "Draw with index finger" }),
    );

    act(() => {
      hand.emit({
        mode: "point",
        pointer: { x: 0.2, y: 0.3 },
        confidence: 0.96,
        timestamp: 1_000,
      });
      hand.emit({
        mode: "point",
        pointer: { x: 0.26, y: 0.36 },
        confidence: 0.96,
        timestamp: 1_016,
      });
      hand.emit({ mode: "idle", timestamp: 1_032 });
      hand.emit({
        mode: "point",
        pointer: { x: 0.26, y: 0.36 },
        confidence: 0.96,
        timestamp: 1_048,
      });
      hand.emit({
        mode: "point",
        pointer: { x: 0.3, y: 0.48 },
        confidence: 0.96,
        timestamp: 1_064,
      });
      hand.emit({ mode: "idle", timestamp: 1_080 });
    });

    expect(Object.values(store.getState().canvas.objects)).toHaveLength(0);
    expect(screen.getByText("2 strokes ready")).toBeVisible();
    expect(
      screen.queryByRole("complementary", { name: /drawer/i }),
    ).toBeNull();

    await user.click(
      screen.getByRole("button", { name: "Finish hand sketch" }),
    );

    const sketches = Object.values(store.getState().canvas.objects).filter(
      (object) => object.type === "sketch",
    );
    expect(sketches).toHaveLength(1);
    const sketch = sketches[0];
    expect(sketch).toMatchObject({
      type: "sketch",
      title: "Finger sketch",
      x: 184,
      y: 134,
      payload: {
        strokes: [
          {
            points: [
              { x: 16, y: 16 },
              { x: 76, y: 46 },
            ],
          },
          {
            points: [
              { x: 76, y: 46 },
              { x: 116, y: 106 },
            ],
          },
        ],
      },
    });
    expect(store.getState().canvas.receipts).toHaveLength(1);
    expect(store.getState().canvas.receipts.at(-1)?.source).toBe("gesture");
  });

  it("starts and finishes a finger sketch through live voice without another canvas click", async () => {
    const user = userEvent.setup();
    const hand = fakeHandController();
    const store = createCanvasStore("room-local", dependencies());
    let options: RealtimeVoiceControllerOptions | undefined;
    const idleState = { status: "idle" as const };
    const { container } = render(
      <CommandCanvasRoom
        store={store}
        createHandTrackingController={() => hand.controller}
        realtimeVoice={{
          roomId: "room-local",
          getAccessToken: () => "header.payload.signature",
          createController(nextOptions) {
            options = nextOptions;
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
    setCanvasBounds(container);

    await user.click(screen.getByRole("button", { name: "Open system status" }));
    await user.click(screen.getByRole("button", { name: "Enable hand input" }));
    act(() => hand.setStatus({ state: "ready" }));
    await act(async () => {
      await options?.onIntent({ type: "open_sketch" }, "voice");
    });
    act(() => {
      hand.emit({
        mode: "point",
        pointer: { x: 0.2, y: 0.3 },
        confidence: 0.96,
        timestamp: 1_000,
      });
      hand.emit({
        mode: "point",
        pointer: { x: 0.34, y: 0.48 },
        confidence: 0.96,
        timestamp: 1_016,
      });
      hand.emit({ mode: "idle", timestamp: 1_032 });
    });

    let result: Awaited<ReturnType<RealtimeVoiceControllerOptions["onIntent"]>> | undefined;
    await act(async () => {
      result = await options?.onIntent({ type: "finish_sketch" }, "voice");
    });

    expect(result).toEqual({
      ok: true,
      message: "Finger sketch command submitted.",
    });
    expect(
      Object.values(store.getState().canvas.objects).filter(
        (object) => object.type === "sketch" && !object.deletedAt,
      ),
    ).toHaveLength(1);
    expect(screen.getByText("HAND CONTROL · FULL CANVAS")).toBeVisible();
  });

  it("creates one selected thought card and receipts later completed speech inside it", async () => {
    const store = createCanvasStore("room-local", dependencies());
    let options: RealtimeVoiceControllerOptions | undefined;
    const idleState = { status: "idle" as const };
    render(
      <CommandCanvasRoom
        store={store}
        realtimeVoice={{
          roomId: "room-local",
          getAccessToken: () => "header.payload.signature",
          createController(nextOptions) {
            options = nextOptions;
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

    options?.onTranscript?.("Start a new thought");
    await act(async () => {
      await options?.onIntent({ type: "start_thought" }, "voice");
    });

    const thoughtId = store.getState().selectedObjectId;
    expect(thoughtId).toBeTruthy();
    expect(thoughtId && store.getState().canvas.objects[thoughtId]).toMatchObject({
      type: "note",
      title: "New thought",
      payload: { text: "", tone: "coral" },
    });

    options?.onTranscript?.(
      "The first customer problem is scattered meeting context.",
    );
    options?.onResponseSettled?.("completed");
    options?.onAssistantTranscript?.(
      "I will keep that inside the selected thought card.",
    );
    options?.onTranscript?.("The final output must stay attributable.");
    options?.onResponseSettled?.("completed");

    await waitFor(() => {
      const object = thoughtId
        ? store.getState().canvas.objects[thoughtId]
        : undefined;
      expect(object?.type === "note" ? object.payload.text : undefined).toBe(
        "The first customer problem is scattered meeting context.\n" +
          "The final output must stay attributable.",
      );
    });
    expect(store.getState().canvas.receipts.map((receipt) => receipt.action)).toEqual([
      "create",
      "update",
      "update",
    ]);
    expect(
      store.getState().canvas.receipts.every((receipt) => receipt.source === "voice"),
    ).toBe(true);

    options?.onTranscript?.("Finish this thought");
    await act(async () => {
      await options?.onIntent({ type: "finish_thought" }, "voice");
    });
    options?.onTranscript?.("This sentence belongs outside the finished card.");
    await new Promise((resolve) => setTimeout(resolve, 0));

    const finished = thoughtId
      ? store.getState().canvas.objects[thoughtId]
      : undefined;
    expect(finished?.type === "note" ? finished.payload.text : undefined).toBe(
      "The first customer problem is scattered meeting context.\n" +
        "The final output must stay attributable.",
    );
    expect(store.getState().canvas.receipts).toHaveLength(3);
  });

  it("ends voice thought capture when a collaborator discards the active card", async () => {
    const store = createCanvasStore("room-local", dependencies());
    let options: RealtimeVoiceControllerOptions | undefined;
    const idleState = { status: "idle" as const };
    render(
      <CommandCanvasRoom
        store={store}
        realtimeVoice={{
          roomId: "room-local",
          getAccessToken: () => "header.payload.signature",
          createController(nextOptions) {
            options = nextOptions;
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

    await act(async () => {
      await options?.onIntent({ type: "start_thought" }, "voice");
    });
    const thoughtId = store.getState().selectedObjectId;
    expect(thoughtId).toBeTruthy();

    act(() => {
      store.getState().dispatch(
        { type: "object.discard", objectId: thoughtId! },
        "collaborator",
      );
    });
    options?.onUserSpeechStarted?.("thought-after-discard");
    options?.onTranscript?.(
      "This turn arrives after Sarah discarded the card.",
      "thought-after-discard",
    );
    options?.onResponseSettled?.("completed", "thought-after-discard");

    let recovery:
      | Awaited<ReturnType<RealtimeVoiceControllerOptions["onIntent"]>>
      | undefined;
    await act(async () => {
      recovery = await options?.onIntent(
        { type: "create_note", text: "Recovered follow-up" },
        "voice",
      );
    });

    expect(recovery).toEqual({
      ok: true,
      message: "Note command submitted.",
    });
    expect(
      Object.values(store.getState().canvas.objects).some(
        (object) =>
          !object.deletedAt &&
          object.type === "note" &&
          object.payload.text === "Recovered follow-up",
      ),
    ).toBe(true);
  });

  it("does not start dictation when thought-card creation is refused", async () => {
    const store = createCanvasStore("room-local", dependencies());
    let options: RealtimeVoiceControllerOptions | undefined;
    const idleState = { status: "idle" as const };
    render(
      <CommandCanvasRoom
        store={store}
        onCommand={async () => {
          throw new Error("The shared room refused the thought card.");
        }}
        realtimeVoice={{
          roomId: "room-local",
          getAccessToken: () => "header.payload.signature",
          createController(nextOptions) {
            options = nextOptions;
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

    let result:
      | Awaited<ReturnType<RealtimeVoiceControllerOptions["onIntent"]>>
      | undefined;
    await act(async () => {
      result = await options?.onIntent({ type: "start_thought" }, "voice");
    });
    options?.onTranscript?.("This must not mutate a missing card.");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(result).toEqual({
      ok: false,
      message: "The shared room refused the thought card.",
    });
    expect(Object.values(store.getState().canvas.objects)).toHaveLength(0);
    expect(store.getState().canvas.receipts).toHaveLength(0);
  });

  it("reports a refused thought transcript without bypassing the canonical command", async () => {
    const store = createCanvasStore("room-local", dependencies());
    let options: RealtimeVoiceControllerOptions | undefined;
    const idleState = { status: "idle" as const };
    render(
      <CommandCanvasRoom
        store={store}
        onCommand={(command, source) => {
          if (command.type === "object.create")
            return store.getState().dispatch(command, source);
          return {
            ok: false as const,
            state: store.getState().canvas,
            error: {
              code: "STALE_OBJECT_VERSION" as const,
              message: "That thought card changed. Continue from its latest text.",
            },
          };
        }}
        realtimeVoice={{
          roomId: "room-local",
          getAccessToken: () => "header.payload.signature",
          createController(nextOptions) {
            options = nextOptions;
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

    await act(async () => {
      await options?.onIntent({ type: "start_thought" }, "voice");
    });
    options?.onTranscript?.("Start a new thought");
    options?.onTranscript?.("This update must be refused truthfully.");
    options?.onResponseSettled?.("completed");

    expect(
      await screen.findAllByText(
        "That thought card changed. Continue from its latest text.",
      ),
    ).toHaveLength(2);
    const thought = Object.values(store.getState().canvas.objects)[0];
    expect(thought?.type === "note" ? thought.payload.text : undefined).toBe("");
    expect(store.getState().canvas.receipts.map((receipt) => receipt.action)).toEqual([
      "create",
    ]);
  });

  it("honors an explicit live-voice discard as recoverable trash", async () => {
    const user = userEvent.setup();
    const store = createCanvasStore("room-local", dependencies());
    seedNote(store, { id: "voice-trash", title: "Draft chart", x: 40 });
    let options: RealtimeVoiceControllerOptions | undefined;
    const idleState = { status: "idle" as const };
    render(
      <CommandCanvasRoom
        store={store}
        realtimeVoice={{
          roomId: "room-local",
          getAccessToken: () => "header.payload.signature",
          createController(nextOptions) {
            options = nextOptions;
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
    await user.click(screen.getByRole("button", { name: "Select Draft chart" }));

    let result: Awaited<ReturnType<RealtimeVoiceControllerOptions["onIntent"]>> | undefined;
    await act(async () => {
      result = await options?.onIntent({ type: "discard_selected" }, "voice");
    });

    expect(result).toEqual({
      ok: true,
      message: "Recoverable discard command submitted.",
    });
    expect(store.getState().canvas.objects["voice-trash"]?.deletedAt).not.toBeNull();
    expect(store.getState().canvas.receipts.at(-1)?.source).toBe("voice");
  });

  it("routes the persistent Draw action into tracked-hand drawing when hand input is ready", async () => {
    const user = userEvent.setup();
    const hand = fakeHandController();
    const store = createCanvasStore("room-local", dependencies());
    render(
      <CommandCanvasRoom
        store={store}
        createHandTrackingController={() => hand.controller}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Open system status" }));
    await user.click(screen.getByRole("button", { name: "Enable hand input" }));
    act(() => hand.setStatus({ state: "ready" }));

    await user.click(
      screen.getByRole("button", { name: "Draw with tracked hand" }),
    );

    expect(screen.getByText("DRAW MODE")).toBeVisible();
    expect(
      screen.queryByRole("region", { name: "Draw directly on the canvas" }),
    ).toBeNull();
  });

  it("keeps Undo among the first persistent canvas actions", () => {
    const store = createCanvasStore("room-local", dependencies());
    render(<CommandCanvasRoom store={store} />);

    const dock = screen.getByRole("complementary", { name: "Object tools" });
    expect(
      within(dock)
        .getAllByRole("button")
        .slice(0, 6)
        .map((button) => button.getAttribute("aria-label")),
    ).toEqual([
      "Create note",
      "Create task board",
      "Create schedule",
      "Create sketch",
      "Undo last change",
      "Enable multiple selection",
    ]);
  });

  it("locks background canvas actions while the pointer sketch surface is active", async () => {
    const user = userEvent.setup();
    const store = createCanvasStore("room-local", dependencies());
    render(<CommandCanvasRoom store={store} />);

    await user.click(screen.getByRole("button", { name: "Create sketch" }));

    const dock = screen.getByRole("complementary", { name: "Object tools" });
    expect(
      within(dock)
        .getAllByRole("button")
        .every((button) => button.hasAttribute("disabled")),
    ).toBe(true);
    expect(screen.getByRole("button", { name: "Open command drawer" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Create task board" }));
    expect(Object.values(store.getState().canvas.objects)).toHaveLength(0);
  });

  it("uses a portrait sketch surface on compact canvases", async () => {
    const user = userEvent.setup();
    const store = createCanvasStore("room-local", dependencies());
    const { container } = render(<CommandCanvasRoom store={store} />);
    setCanvasBounds(container, { width: 390, height: 706 });

    await user.click(screen.getByRole("button", { name: "Create sketch" }));

    expect(
      screen.getByRole("img", { name: "Sketch draft surface" }),
    ).toHaveAttribute("viewBox", "0 0 420 720");
  });

  it("brings a partially visible selected object into the compact viewport", async () => {
    const user = userEvent.setup();
    const store = createCanvasStore("room-local", dependencies());
    seedNote(store, { id: "edge-note", title: "Edge note", x: 40 });
    store.getState().setViewport({ x: -260, y: 0, scale: 1 });
    const { container } = render(<CommandCanvasRoom store={store} />);
    setCanvasBounds(container, { width: 390, height: 620 });

    await user.click(screen.getByRole("button", { name: "Select Edge note" }));

    await waitFor(() => {
      const object = store.getState().canvas.objects["edge-note"];
      const nextViewport = store.getState().viewport;
      const screenLeft = object.x * nextViewport.scale + nextViewport.x;
      const screenRight =
        (object.x + object.width) * nextViewport.scale + nextViewport.x;
      expect(screenLeft).toBeGreaterThanOrEqual(0);
      expect(screenRight).toBeLessThanOrEqual(390);
    });
  });

  it("keeps drawing from a tracked index fingertip when the rest of the hand reads open", async () => {
    const user = userEvent.setup();
    const hand = fakeHandController();
    const store = createCanvasStore("room-local", dependencies());
    const { container } = render(
      <CommandCanvasRoom
        store={store}
        createHandTrackingController={() => hand.controller}
      />,
    );
    setCanvasBounds(container);
    await user.click(screen.getByRole("button", { name: "Open system status" }));
    await user.click(screen.getByRole("button", { name: "Enable hand input" }));
    act(() => hand.setStatus({ state: "ready" }));
    await user.click(screen.getByRole("button", { name: "Draw with index finger" }));

    act(() => {
      hand.emit({
        mode: "open_palm",
        pointer: { x: 0.22, y: 0.3 },
        confidence: 0.94,
        timestamp: 1_000,
      });
      hand.emit({
        mode: "open_palm",
        pointer: { x: 0.31, y: 0.39 },
        confidence: 0.94,
        timestamp: 1_084,
      });
      hand.emit({
        mode: "pinch",
        pointer: { x: 0.31, y: 0.39 },
        confidence: 0.94,
        timestamp: 1_168,
      });
    });

    expect(screen.getByText("1 stroke ready")).toBeVisible();
    expect(screen.queryByRole("complementary", { name: /drawer/i })).toBeNull();
  });

  it("keeps ten independent hand-drawn lines in one sketch without opening drawers", async () => {
    const user = userEvent.setup();
    const hand = fakeHandController();
    const store = createCanvasStore("room-local", dependencies());
    const { container } = render(
      <CommandCanvasRoom
        store={store}
        createHandTrackingController={() => hand.controller}
      />,
    );
    setCanvasBounds(container);
    await user.click(screen.getByRole("button", { name: "Open system status" }));
    await user.click(screen.getByRole("button", { name: "Enable hand input" }));
    act(() => hand.setStatus({ state: "ready" }));
    await user.click(
      screen.getByRole("button", { name: "Draw with index finger" }),
    );

    act(() => {
      for (let index = 0; index < 10; index += 1) {
        const timestamp = 2_000 + index * 48;
        hand.emit({
          mode: "point",
          pointer: { x: 0.12 + index * 0.025, y: 0.2 + index * 0.02 },
          confidence: 0.96,
          timestamp,
        });
        hand.emit({
          mode: "point",
          pointer: { x: 0.15 + index * 0.025, y: 0.24 + index * 0.02 },
          confidence: 0.96,
          timestamp: timestamp + 16,
        });
        hand.emit({ mode: "idle", timestamp: timestamp + 32 });
      }
    });

    expect(screen.getByText("10 strokes ready")).toBeVisible();
    expect(Object.values(store.getState().canvas.objects)).toHaveLength(0);
    expect(screen.queryByRole("complementary", { name: /drawer/i })).toBeNull();

    await user.click(screen.getByRole("button", { name: "Finish hand sketch" }));

    const objects = Object.values(store.getState().canvas.objects);
    expect(objects).toHaveLength(1);
    expect(objects[0]).toMatchObject({
      type: "sketch",
      payload: { strokes: expect.arrayContaining(Array.from({ length: 10 }, () => expect.any(Object))) },
    });
    if (objects[0]?.type === "sketch")
      expect(objects[0].payload.strokes).toHaveLength(10);
    expect(store.getState().canvas.receipts).toHaveLength(1);
    expect(screen.queryByRole("complementary", { name: /drawer/i })).toBeNull();
  });

  it("erases a stroke inside the active hand-drawing session without creating another object", async () => {
    const user = userEvent.setup();
    const hand = fakeHandController();
    const store = createCanvasStore("room-local", dependencies());
    const { container } = render(
      <CommandCanvasRoom
        store={store}
        createHandTrackingController={() => hand.controller}
      />,
    );
    setCanvasBounds(container);
    await user.click(screen.getByRole("button", { name: "Open system status" }));
    await user.click(screen.getByRole("button", { name: "Enable hand input" }));
    act(() => hand.setStatus({ state: "ready" }));
    await user.click(screen.getByRole("button", { name: "Draw with index finger" }));

    act(() => {
      for (let index = 0; index < 3; index += 1) {
        const timestamp = 3_000 + index * 48;
        hand.emit({
          mode: "point",
          pointer: { x: 0.2 + index * 0.1, y: 0.3 },
          confidence: 0.96,
          timestamp,
        });
        hand.emit({
          mode: "point",
          pointer: { x: 0.25 + index * 0.1, y: 0.35 },
          confidence: 0.96,
          timestamp: timestamp + 16,
        });
        hand.emit({ mode: "idle", timestamp: timestamp + 32 });
      }
    });
    expect(screen.getByText("3 strokes ready")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Use hand eraser" }));
    act(() => {
      hand.emit({
        mode: "point",
        pointer: { x: 0.325, y: 0.325 },
        confidence: 0.96,
        timestamp: 3_200,
      });
      hand.emit({ mode: "idle", timestamp: 3_216 });
    });

    expect(screen.getByText("2 strokes ready")).toBeVisible();
    expect(Object.values(store.getState().canvas.objects)).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: "Finish hand sketch" }));
    const objects = Object.values(store.getState().canvas.objects);
    expect(objects).toHaveLength(1);
    if (objects[0]?.type === "sketch")
      expect(objects[0].payload.strokes).toHaveLength(2);
    expect(store.getState().canvas.receipts).toHaveLength(1);
    expect(screen.queryByRole("complementary", { name: /drawer/i })).toBeNull();
  });

  it("commits a pinch drag as one canonical object transform", async () => {
    const user = userEvent.setup();
    const hand = fakeHandController();
    const store = createCanvasStore("room-local", dependencies());
    store.getState().dispatch(
      {
        type: "object.create",
        object: {
          id: "note-spatial",
          type: "note",
          title: "Spatial note",
          x: 200,
          y: 150,
          width: 180,
          height: 140,
          zIndex: 1,
          payload: { text: "Move me", tone: "sky" },
        },
      },
      "system",
    );
    const { container } = render(
      <CommandCanvasRoom
        store={store}
        createHandTrackingController={() => hand.controller}
      />,
    );
    setCanvasBounds(container);
    await user.click(screen.getByRole("button", { name: "Open system status" }));
    await user.click(screen.getByRole("button", { name: "Enable hand input" }));
    act(() => hand.setStatus({ state: "ready" }));

    hand.emit({
      mode: "pinch",
      pointer: { x: 0.25, y: 0.4 },
      confidence: 0.96,
      timestamp: 1_000,
    });
    hand.emit({
      mode: "pinch",
      pointer: { x: 0.35, y: 0.5 },
      confidence: 0.96,
      timestamp: 1_016,
    });
    hand.emit({ mode: "idle", timestamp: 1_032 });

    expect(store.getState().canvas.objects["note-spatial"]).toMatchObject({
      x: 300,
      y: 200,
      version: 2,
    });
    expect(store.getState().canvas.receipts.at(-1)).toMatchObject({
      source: "gesture",
      action: "transform",
      affectedObjectIds: ["note-spatial"],
    });
  });

  it("throws a held object through the left edge into recoverable trash immediately", async () => {
    const user = userEvent.setup();
    const hand = fakeHandController();
    const store = createCanvasStore("room-local", dependencies());
    seedNote(store, { id: "note-spatial", title: "Spatial note", x: 200 });
    const { container } = render(
      <CommandCanvasRoom
        store={store}
        createHandTrackingController={() => hand.controller}
      />,
    );
    setCanvasBounds(container);
    await user.click(screen.getByRole("button", { name: "Open system status" }));
    await user.click(screen.getByRole("button", { name: "Enable hand input" }));
    act(() => hand.setStatus({ state: "ready" }));

    hand.emit({
      mode: "pinch",
      pointer: { x: 0.25, y: 0.18 },
      confidence: 0.97,
      timestamp: 1_000,
    });
    hand.emit({
      mode: "pinch",
      pointer: { x: 0.04, y: 0.18 },
      confidence: 0.97,
      timestamp: 1_200,
    });
    hand.emit({ mode: "idle", timestamp: 1_216 });

    expect(store.getState().canvas.objects["note-spatial"]?.deletedAt).toBeNull();
    await waitFor(() => {
      expect(
        screen
          .getByRole("button", { name: "Select Spatial note" })
          .closest("article"),
      ).toHaveAttribute("data-gesture-exit", "discard-left");
    });
    expect(screen.queryByRole("alertdialog")).toBeNull();
    await waitFor(() => {
      expect(
        store.getState().canvas.objects["note-spatial"]?.deletedAt,
      ).not.toBeNull();
    });
    expect(store.getState().canvas.receipts.at(-1)).toMatchObject({
        source: "gesture",
        action: "discard",
        affectedObjectIds: ["note-spatial"],
      });
    await user.click(screen.getByRole("button", { name: "Undo last change" }));
    expect(store.getState().canvas.objects["note-spatial"]?.deletedAt).toBeNull();
  });

  it("keeps pinned objects protected from edge-throw discard", async () => {
    const user = userEvent.setup();
    const hand = fakeHandController();
    const store = createCanvasStore("room-local", dependencies());
    seedNote(store, { id: "note-spatial", title: "Spatial note", x: 200 });
    store.getState().dispatch(
      {
        type: "object.set_flags",
        objectId: "note-spatial",
        flags: { pinned: true },
      },
      "system",
    );
    const { container } = render(
      <CommandCanvasRoom
        store={store}
        createHandTrackingController={() => hand.controller}
      />,
    );
    setCanvasBounds(container);
    await user.click(screen.getByRole("button", { name: "Open system status" }));
    await user.click(screen.getByRole("button", { name: "Enable hand input" }));
    act(() => hand.setStatus({ state: "ready" }));

    hand.emit({
      mode: "pinch",
      pointer: { x: 0.25, y: 0.18 },
      confidence: 0.97,
      timestamp: 1_000,
    });
    hand.emit({
      mode: "pinch",
      pointer: { x: 0.04, y: 0.18 },
      confidence: 0.97,
      timestamp: 1_200,
    });
    hand.emit({ mode: "idle", timestamp: 1_216 });
    expect(store.getState().canvas.objects["note-spatial"]?.deletedAt).toBeNull();
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("minimizes through the distinct bottom dock and keeps it reversible through universal undo", async () => {
    const user = userEvent.setup();
    const hand = fakeHandController();
    const store = createCanvasStore("room-local", dependencies());
    seedNote(store, { id: "note-spatial", title: "Spatial note", x: 200 });
    const { container } = render(
      <CommandCanvasRoom
        store={store}
        createHandTrackingController={() => hand.controller}
      />,
    );
    setCanvasBounds(container);
    await user.click(screen.getByRole("button", { name: "Open system status" }));
    await user.click(screen.getByRole("button", { name: "Enable hand input" }));
    act(() => hand.setStatus({ state: "ready" }));

    hand.emit({
      mode: "pinch",
      pointer: { x: 0.25, y: 0.18 },
      confidence: 0.97,
      timestamp: 1_000,
    });
    hand.emit({
      mode: "pinch",
      pointer: { x: 0.25, y: 0.96 },
      confidence: 0.97,
      timestamp: 1_200,
    });
    hand.emit({ mode: "idle", timestamp: 1_216 });
    expect(store.getState().canvas.objects["note-spatial"]?.minimized).toBe(true);
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(store.getState().canvas.receipts.at(-1)?.source).toBe("gesture");
    await user.click(screen.getByRole("button", { name: "Undo last change" }));
    expect(store.getState().canvas.objects["note-spatial"]?.minimized).toBe(false);
  });

  it("restores a minimized object through deliberate open-palm dwell", async () => {
    const user = userEvent.setup();
    const hand = fakeHandController();
    const store = createCanvasStore("room-local", dependencies());
    seedNote(store, { id: "note-spatial", title: "Spatial note", x: 200 });
    store.getState().dispatch(
      {
        type: "object.set_flags",
        objectId: "note-spatial",
        flags: { minimized: true },
      },
      "system",
    );
    const { container } = render(
      <CommandCanvasRoom
        store={store}
        createHandTrackingController={() => hand.controller}
      />,
    );
    setCanvasBounds(container);
    await user.click(screen.getByRole("button", { name: "Open system status" }));
    await user.click(screen.getByRole("button", { name: "Enable hand input" }));
    act(() => hand.setStatus({ state: "ready" }));

    hand.emit({
      mode: "open_palm",
      pointer: { x: 0.25, y: 0.12 },
      confidence: 0.96,
      timestamp: 1_000,
    });
    expect(await screen.findByText("PALM · HOLD 0%")).toBeVisible();
    hand.emit({
      mode: "open_palm",
      pointer: { x: 0.25, y: 0.12 },
      confidence: 0.96,
      timestamp: 1_660,
    });

    expect(store.getState().canvas.objects["note-spatial"]?.minimized).toBe(false);
    expect(store.getState().canvas.receipts.at(-1)).toMatchObject({
      source: "gesture",
      action: "restore",
      affectedObjectIds: ["note-spatial"],
    });
  });

  it("commits two-hand span resize through one canonical gesture transform", async () => {
    const user = userEvent.setup();
    const hand = fakeHandController();
    const store = createCanvasStore("room-local", dependencies());
    seedNote(store, { id: "note-spatial", title: "Spatial note", x: 200 });
    const { container } = render(
      <CommandCanvasRoom
        store={store}
        createHandTrackingController={() => hand.controller}
      />,
    );
    setCanvasBounds(container);
    await user.click(screen.getByRole("button", { name: "Select Spatial note" }));
    await user.click(screen.getByRole("button", { name: "Open system status" }));
    await user.click(screen.getByRole("button", { name: "Enable hand input" }));
    act(() => hand.setStatus({ state: "ready" }));
    const bimanual = (span: number, leftX: number, rightX: number, timestamp: number) =>
      hand.emit({
        mode: "bimanual_pinch",
        hands: [
          {
            handedness: "left",
            pointer: { x: leftX, y: 0.3 },
            confidence: 0.96,
          },
          {
            handedness: "right",
            pointer: { x: rightX, y: 0.3 },
            confidence: 0.96,
          },
        ],
        center: { x: (leftX + rightX) / 2, y: 0.3 },
        span,
        timestamp,
      });

    bimanual(0.3, 0.35, 0.65, 1_000);
    expect(await screen.findByText("RESIZING")).toBeVisible();
    bimanual(0.45, 0.275, 0.725, 1_100);
    // Real two-hand release is staggered: one hand usually remains pinched for
    // one detector frame. That frame must commit the resize, not start a grab.
    hand.emit({
      mode: "pinch",
      pointer: { x: 0.275, y: 0.3 },
      confidence: 0.96,
      timestamp: 1_116,
    });

    expect(store.getState().canvas.objects["note-spatial"]).toMatchObject({
      width: 420,
      height: 285,
      version: 2,
    });
    expect(store.getState().canvas.receipts.at(-1)).toMatchObject({
      source: "gesture",
      action: "transform",
      affectedObjectIds: ["note-spatial"],
    });
  });

  it("creates a semantic note through the command pipeline and shows its receipt", async () => {
    const user = userEvent.setup();
    const store = createCanvasStore("room-local", dependencies());
    render(<CommandCanvasRoom store={store} />);

    expect(
      screen.getByRole("heading", { name: "Spatial command surface" }),
    ).toBeInTheDocument();
    expect(screen.getByText("No objects yet")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Create note" }));

    expect(
      screen.getByRole("button", { name: "Select New thought" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Danny created “New thought”."),
    ).toBeInTheDocument();
    expect(store.getState().canvas.revision).toBe(1);
  });

  it("creates a task board from the object toolbar and renders its columns and tasks", async () => {
    const user = userEvent.setup();
    const store = createCanvasStore("room-local", dependencies());
    render(<CommandCanvasRoom store={store} />);

    await user.click(screen.getByRole("button", { name: "Create task board" }));

    expect(
      screen.getByRole("button", { name: "Select Launch board" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Next")).toBeInTheDocument();
    expect(screen.getByText("Confirm launch date")).toBeInTheDocument();
    expect(screen.getByText("In progress")).toBeInTheDocument();
    expect(screen.getByText("Polish the demo path")).toBeInTheDocument();
    expect(Object.values(store.getState().canvas.objects)[0]?.type).toBe(
      "task_board",
    );
  });

  it("creates a schedule from the object toolbar and renders dated commitments", async () => {
    const user = userEvent.setup();
    const store = createCanvasStore("room-local", dependencies());
    render(<CommandCanvasRoom store={store} />);

    await user.click(screen.getByRole("button", { name: "Create schedule" }));

    expect(
      screen.getByRole("button", { name: "Select Next week" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Mon, Aug 31")).toBeInTheDocument();
    expect(screen.getByText("09:30")).toBeInTheDocument();
    expect(screen.getByText("Review WebMCP flow")).toBeInTheDocument();
    expect(screen.getByText("America/New_York")).toBeInTheDocument();
    expect(Object.values(store.getState().canvas.objects)[0]?.type).toBe(
      "schedule",
    );
  });

  it("spawns consecutive semantic objects into distinct spatial slots", async () => {
    const user = userEvent.setup();
    const store = createCanvasStore("room-local", dependencies());
    render(<CommandCanvasRoom store={store} />);

    await user.click(screen.getByRole("button", { name: "Create task board" }));
    await user.click(screen.getByRole("button", { name: "Create schedule" }));

    const board = Object.values(store.getState().canvas.objects).find(
      (object) => object.type === "task_board",
    );
    const schedule = Object.values(store.getState().canvas.objects).find(
      (object) => object.type === "schedule",
    );
    expect(board).toBeDefined();
    expect(schedule).toBeDefined();
    expect(schedule!.x).toBeGreaterThanOrEqual(board!.x + board!.width + 80);
  });

  it("places toolbar-created objects at their screen anchors after viewport translation and scaling", async () => {
    const user = userEvent.setup();
    const store = createCanvasStore("room-live", dependencies());
    store.getState().setViewport({ x: 40, y: -20, scale: 2 });
    const received: CanvasCommand[] = [];
    render(
      <CommandCanvasRoom
        store={store}
        onCommand={(command) => {
          received.push(command);
        }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Create note" }));
    await user.click(screen.getByRole("button", { name: "Create task board" }));
    await user.click(screen.getByRole("button", { name: "Create schedule" }));

    expect(received).toHaveLength(3);
    expect(received[0]).toMatchObject({
      type: "object.create",
      object: { type: "note", x: 60, y: 75 },
    });
    expect(received[1]).toMatchObject({
      type: "object.create",
      object: { type: "task_board", x: 50, y: 65 },
    });
    expect(received[2]).toMatchObject({
      type: "object.create",
      object: { type: "schedule", x: 70, y: 80 },
    });
  });

  it("places a finished sketch at its screen anchor after viewport translation and scaling", async () => {
    const user = userEvent.setup();
    const store = createCanvasStore("room-live", dependencies());
    store.getState().setViewport({ x: 40, y: -20, scale: 2 });
    const received: CanvasCommand[] = [];
    render(
      <CommandCanvasRoom
        store={store}
        onCommand={(command) => {
          received.push(command);
        }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Create sketch" }));
    const surface = screen.getByRole("img", {
      name: "Sketch draft surface",
    }) as unknown as SVGSVGElement;
    surface.getBoundingClientRect = () =>
      ({ left: 100, top: 50, width: 440, height: 280 }) as DOMRect;
    surface.setPointerCapture = () => undefined;
    surface.hasPointerCapture = () => false;

    fireEvent.pointerDown(surface, {
      pointerId: 15,
      pointerType: "mouse",
      clientX: 120,
      clientY: 90,
    });
    fireEvent.pointerMove(surface, {
      pointerId: 15,
      pointerType: "mouse",
      clientX: 240,
      clientY: 150,
    });
    fireEvent.pointerUp(surface, {
      pointerId: 15,
      pointerType: "mouse",
      clientX: 360,
      clientY: 210,
    });
    await user.click(screen.getByRole("button", { name: "Finish sketch" }));

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      type: "object.create",
      object: { type: "sketch", x: 70, y: 75 },
    });
  });

  it("renders preserved sketch geometry and its structured diagram as live objects", () => {
    const store = createCanvasStore("room-local", dependencies());
    store.getState().dispatch(
      {
        type: "object.create",
        object: {
          id: "sketch-source",
          type: "sketch",
          title: "Rough architecture",
          x: 20,
          y: 30,
          width: 360,
          height: 220,
          zIndex: 1,
          payload: {
            strokes: [
              {
                id: "stroke-source",
                color: "#12233d",
                width: 5,
                points: [
                  { x: 12, y: 20 },
                  { x: 100, y: 30 },
                ],
              },
            ],
          },
        },
      },
      "system",
    );
    store.getState().dispatch(
      {
        type: "object.create",
        object: {
          id: "diagram-result",
          type: "diagram",
          title: "Usable architecture",
          x: 420,
          y: 30,
          width: 520,
          height: 280,
          zIndex: 2,
          payload: {
            kind: "architecture",
            sourceSketchId: "sketch-source",
            interpretationSummary: "Browser to API.",
            nodes: [
              {
                id: "node-browser",
                label: "Browser",
                kind: "client",
                x: 20,
                y: 50,
                width: 140,
                height: 64,
              },
              {
                id: "node-api",
                label: "API",
                kind: "service",
                x: 240,
                y: 50,
                width: 140,
                height: 64,
              },
            ],
            edges: [
              {
                id: "edge-browser-api",
                from: "node-browser",
                to: "node-api",
              },
            ],
          },
        },
      },
      "system",
    );

    render(<CommandCanvasRoom store={store} />);

    expect(
      screen.getByRole("img", {
        name: "Original rough sketch: Rough architecture",
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("img", {
        name: "Architecture diagram: Browser to API.",
      }),
    ).toBeVisible();
    expect(screen.getByText("Agent structured")).toBeVisible();
    expect(
      screen.getByLabelText(
        "Transformation from Rough architecture to Usable architecture",
      ),
    ).toBeVisible();
    expect(store.getState().canvas.objects["sketch-source"]?.deletedAt).toBeNull();
  });

  it("offers sketch interpretation only for the selected active sketch and selects its returned diagram", async () => {
    const user = userEvent.setup();
    const store = createCanvasStore("room-live", dependencies());
    seedSketch(store);
    const transformSketch = vi.fn().mockResolvedValue({
      ok: true,
      diagramObjectId: "diagram-result",
      receiptId: "receipt-transform",
      revision: 2,
      provider: "openai",
      model: "gpt-5.6-terra",
    });
    render(
      <CommandCanvasRoom
        store={store}
        onTransformSketch={transformSketch}
      />,
    );

    expect(screen.queryByRole("button", { name: "Make usable" })).toBeNull();
    await user.click(
      screen.getByRole("button", { name: "Select Rough architecture" }),
    );
    await user.click(screen.getByRole("button", { name: "Make usable" }));

    expect(transformSketch).toHaveBeenCalledExactlyOnceWith({
      sketchObjectId: "sketch-source",
      instruction: "Make this usable as a professional visual.",
      outputKind: "auto",
      source: "typed",
    });
    await waitFor(() => {
      expect(store.getState().selectedObjectId).toBe("diagram-result");
    });
    expect(store.getState().canvas.objects["sketch-source"]?.deletedAt).toBeNull();
  });

  it("forwards spoken sketch narration through the existing vision transformation path", async () => {
    const user = userEvent.setup();
    const store = createCanvasStore("room-live", dependencies());
    seedSketch(store);
    const transformSketch = vi.fn().mockResolvedValue({
      ok: true,
      diagramObjectId: "diagram-result",
      receiptId: "receipt-transform",
      revision: 2,
      provider: "openai",
      model: "gpt-5.6-terra",
    });
    let options: RealtimeVoiceControllerOptions | undefined;
    const idleState = { status: "idle" as const };
    render(
      <CommandCanvasRoom
        store={store}
        onTransformSketch={transformSketch}
        realtimeVoice={{
          roomId: "room-live",
          getAccessToken: () => "header.payload.signature",
          createController(nextOptions) {
            options = nextOptions;
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

    await user.click(
      screen.getByRole("button", { name: "Select Rough architecture" }),
    );
    await act(async () => {
      await options?.onIntent(
        {
          type: "transform_selected_sketch",
          narration:
            "The larger circle is revenue and the smaller slice is support cost.",
        },
        "voice",
      );
    });

    expect(transformSketch).toHaveBeenCalledWith(
      expect.objectContaining({
        narration:
          "The larger circle is revenue and the smaller slice is support cost.",
        source: "voice",
      }),
    );
  });

  it.each([360, 420, 480])(
    "reveals the preserved sketch and authoritative diagram fully at a %ipx canvas width",
    async (screenWidth) => {
    const user = userEvent.setup();
    const store = createCanvasStore("room-live", dependencies());
    seedSketch(store);
    const { container } = render(
      <CommandCanvasRoom
        store={store}
        onTransformSketch={async () => {
          const applied = store.getState().dispatch(
            {
              type: "object.create",
              object: {
                id: "diagram-result",
                type: "diagram",
                title: "Structured architecture",
                x: 444,
                y: 30,
                width: 620,
                height: 360,
                zIndex: 2,
                payload: {
                  kind: "architecture",
                  sourceSketchId: "sketch-source",
                  interpretationSummary: "Browser to API.",
                  nodes: [
                    {
                      id: "node-browser",
                      label: "Browser",
                      kind: "client",
                      x: 24,
                      y: 24,
                      width: 140,
                      height: 64,
                    },
                  ],
                  edges: [],
                },
              },
            },
            "typed",
          );
          if (!applied.ok) throw new Error("Diagram fixture was refused.");
          return {
            ok: true,
            diagramObjectId: "diagram-result",
            receiptId: applied.receipt.id,
            revision: applied.state.revision,
            provider: "openai" as const,
            model: "gpt-5.6-terra" as const,
          };
        }}
      />,
    );
    setCanvasBounds(container, { width: screenWidth, height: 450 });

    await user.click(
      screen.getByRole("button", { name: "Select Rough architecture" }),
    );
    await user.click(screen.getByRole("button", { name: "Make usable" }));

    await waitFor(() => {
      expect(store.getState().selectedObjectId).toBe("diagram-result");
    });
    const fitted = store.getState().viewport;
    const source = { x: 20, y: 30, width: 360, height: 220 };
    const diagram = { x: 444, y: 30, width: 620, height: 360 };
    for (const rectangle of [source, diagram]) {
      expect(rectangle.x * fitted.scale + fitted.x).toBeGreaterThanOrEqual(0);
      expect(rectangle.y * fitted.scale + fitted.y).toBeGreaterThanOrEqual(0);
      expect(
        (rectangle.x + rectangle.width) * fitted.scale + fitted.x,
      ).toBeLessThanOrEqual(screenWidth + 1e-6);
      expect(
        (rectangle.y + rectangle.height) * fitted.scale + fitted.y,
      ).toBeLessThanOrEqual(450 + 1e-6);
    }
    expect(store.getState().canvas.objects["sketch-source"]?.deletedAt).toBeNull();
    },
  );

  it("labels sketch interpretation honestly and disables conflicting actions while pending", async () => {
    const user = userEvent.setup();
    const store = createCanvasStore("room-live", dependencies());
    seedSketch(store);
    let finish!: (result: {
      ok: false;
      code: string;
      message: string;
    }) => void;
    const pending = new Promise<{
      ok: false;
      code: string;
      message: string;
    }>((resolve) => {
      finish = resolve;
    });
    render(
      <CommandCanvasRoom
        store={store}
        onTransformSketch={() => pending}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: "Select Rough architecture" }),
    );

    await user.click(screen.getByRole("button", { name: "Make usable" }));

    expect(
      screen.getByRole("button", { name: "Interpreting sketch…" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Create note" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Pin object" })).toBeDisabled();

    finish({
      ok: false,
      code: "provider_unavailable",
      message: "Sketch interpretation is temporarily unavailable.",
    });
    expect(
      await screen.findByRole("button", { name: "Make usable" }),
    ).toBeEnabled();
  });

  it("surfaces sketch-transform refusal without implying that a diagram was created", async () => {
    const user = userEvent.setup();
    const store = createCanvasStore("room-live", dependencies());
    seedSketch(store);
    render(
      <CommandCanvasRoom
        store={store}
        onTransformSketch={async () => ({
          ok: false,
          code: "source_version_changed",
          message: "The sketch changed while it was being interpreted.",
        })}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: "Select Rough architecture" }),
    );

    await user.click(screen.getByRole("button", { name: "Make usable" }));

    expect(await screen.findByText("Sketch interpretation failed")).toBeVisible();
    expect(
      screen.getByText("The sketch changed while it was being interpreted."),
    ).toBeVisible();
    expect(store.getState().selectedObjectId).toBe("sketch-source");
    expect(Object.values(store.getState().canvas.objects)).toHaveLength(1);
  });

  it("offers an explicit prepared interpretation after failure and records it honestly", async () => {
    const user = userEvent.setup();
    const store = createCanvasStore("room-live", dependencies());
    seedSketch(store);
    render(
      <CommandCanvasRoom
        store={store}
        onTransformSketch={async () => ({
          ok: false,
          code: "provider_unavailable",
          message: "Sketch interpretation is temporarily unavailable.",
        })}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: "Select Rough architecture" }),
    );

    expect(
      screen.queryByRole("button", {
        name: "Load prepared demo interpretation",
      }),
    ).toBeNull();
    await user.click(screen.getByRole("button", { name: "Make usable" }));

    expect(
      await screen.findByRole("button", {
        name: "Load prepared demo interpretation",
      }),
    ).toBeEnabled();
    await user.click(
      screen.getByRole("button", {
        name: "Load prepared demo interpretation",
      }),
    );

    await waitFor(() => {
      expect(
        Object.values(store.getState().canvas.objects).some(
          (object) => object.type === "diagram",
        ),
      ).toBe(true);
    });
    const diagram = Object.values(store.getState().canvas.objects).find(
      (object) => object.type === "diagram",
    );
    expect(diagram).toMatchObject({
      type: "diagram",
      title: "Prepared demo fallback",
      x: 444,
      y: 30,
      payload: {
        kind: "architecture",
        sourceSketchId: "sketch-source",
        interpretationSummary:
          "Prepared demo fallback: not generated by the vision model.",
      },
    });
    expect(store.getState().canvas.objects["sketch-source"]?.deletedAt).toBeNull();
    expect(store.getState().canvas.receipts.at(-1)).toMatchObject({
      action: "create",
      source: "typed",
      description: 'Danny created “Prepared demo fallback”.',
      affectedObjectIds: [diagram?.id],
    });
    expect(JSON.stringify(diagram)).not.toMatch(/openai/i);
    expect(
      screen.queryByRole("button", {
        name: "Load prepared demo interpretation",
      }),
    ).toBeNull();
  });

  it("commits a pointer-authored sketch atomically through the same command pipeline", async () => {
    const user = userEvent.setup();
    const store = createCanvasStore("room-live", dependencies());
    const received: Array<{
      command: CanvasCommand;
      source: CanvasCommandSource;
    }> = [];
    render(
      <CommandCanvasRoom
        store={store}
        onCommand={(command, source) => {
          received.push({ command, source });
        }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Create sketch" }));
    expect(
      screen.getByRole("region", { name: "Draw directly on the canvas" }),
    ).toBeVisible();
    expect(screen.queryByRole("dialog")).toBeNull();
    const surface = screen.getByRole("img", {
      name: "Sketch draft surface",
    }) as unknown as SVGSVGElement;
    surface.getBoundingClientRect = () =>
      ({ left: 100, top: 50, width: 440, height: 280 }) as DOMRect;
    surface.setPointerCapture = () => undefined;
    surface.hasPointerCapture = () => false;

    fireEvent.pointerDown(surface, {
      pointerId: 14,
      pointerType: "pen",
      clientX: 120,
      clientY: 90,
      pressure: 0.4,
    });
    fireEvent.pointerMove(surface, {
      pointerId: 14,
      pointerType: "pen",
      clientX: 260,
      clientY: 150,
      pressure: 0.7,
    });
    fireEvent.pointerUp(surface, {
      pointerId: 14,
      pointerType: "pen",
      clientX: 420,
      clientY: 210,
      pressure: 0.5,
    });
    await user.click(screen.getByRole("button", { name: "Finish sketch" }));

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      source: "stylus",
      command: {
        type: "object.create",
        object: {
          type: "sketch",
          title: "Rough sketch",
          width: 720,
          height: 420,
          payload: { strokes: [{ points: expect.any(Array) }] },
        },
      },
    });
    expect(
      screen.queryByRole("region", { name: "Draw directly on the canvas" }),
    ).toBeNull();
    expect(store.getState().canvas.revision).toBe(0);
  });

  it("pins the selected object and uses the same universal undo control", async () => {
    const user = userEvent.setup();
    const store = createCanvasStore("room-local", dependencies());
    render(<CommandCanvasRoom store={store} />);
    await user.click(screen.getByRole("button", { name: "Create note" }));
    await user.click(screen.getByRole("button", { name: "Select New thought" }));

    await user.click(screen.getByRole("button", { name: "Pin object" }));

    const object = Object.values(store.getState().canvas.objects)[0];
    expect(object?.pinned).toBe(true);
    expect(screen.getByText("Pinned to canvas")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Undo last change" }));

    expect(store.getState().canvas.objects[object!.id]?.pinned).toBe(false);
    expect(screen.getByText(/Danny undid: Danny pinned/)).toBeInTheDocument();
  });

  it("groups a modifier multi-selection into a movable frame and ungroups through canonical receipts", async () => {
    const user = userEvent.setup();
    const store = createCanvasStore("room-local", dependencies());
    seedNote(store, { id: "note-first", title: "First note", x: 40 });
    seedNote(store, { id: "note-second", title: "Second note", x: 400 });
    render(<CommandCanvasRoom store={store} />);

    await user.click(screen.getByRole("button", { name: "Select First note" }));
    await user.keyboard("{Shift>}");
    await user.click(screen.getByRole("button", { name: "Select Second note" }));
    await user.keyboard("{/Shift}");

    expect(store.getState().selectedObjectIds).toEqual([
      "note-first",
      "note-second",
    ]);
    await user.click(screen.getByRole("button", { name: "Group selected objects" }));

    const frame = Object.values(store.getState().canvas.objects).find(
      (object) => !object.deletedAt && object.type === "frame",
    );
    expect(frame).toBeDefined();
    expect(store.getState().canvas.objects["note-first"]?.parentId).toBe(frame?.id);
    expect(store.getState().canvas.objects["note-second"]?.parentId).toBe(frame?.id);
    expect(store.getState().canvas.receipts.at(-1)?.action).toBe("group");
    expect(
      screen.getByRole("button", { name: `Select ${frame?.title}` }),
    ).toBeVisible();

    await user.click(
      screen.getByRole("button", { name: "Ungroup selected frame" }),
    );
    expect(store.getState().canvas.objects["note-first"]?.parentId).toBeNull();
    expect(store.getState().canvas.objects["note-second"]?.parentId).toBeNull();
    expect(store.getState().canvas.objects[frame?.id ?? ""]?.deletedAt).not.toBeNull();
    expect(store.getState().canvas.receipts.at(-1)?.action).toBe("ungroup");
  });

  it("supports touch-friendly multi-select and keyboard group, undo, and redo", async () => {
    const user = userEvent.setup();
    const store = createCanvasStore("room-local", dependencies());
    seedNote(store, { id: "note-first", title: "First note", x: 40 });
    seedNote(store, { id: "note-second", title: "Second note", x: 400 });
    render(<CommandCanvasRoom store={store} />);

    await user.click(
      screen.getByRole("button", { name: "Enable multiple selection" }),
    );
    await user.click(screen.getByRole("button", { name: "Select First note" }));
    await user.click(screen.getByRole("button", { name: "Select Second note" }));
    expect(store.getState().selectedObjectIds).toEqual([
      "note-first",
      "note-second",
    ]);

    fireEvent.keyDown(screen.getByRole("main"), { key: "g", ctrlKey: true });
    expect(store.getState().canvas.receipts.at(-1)?.action).toBe("group");
    fireEvent.keyDown(screen.getByRole("main"), { key: "z", ctrlKey: true });
    expect(
      Object.values(store.getState().canvas.objects).some(
        (object) => object.type === "frame" && !object.deletedAt,
      ),
    ).toBe(false);
    fireEvent.keyDown(screen.getByRole("main"), { key: "y", ctrlKey: true });
    expect(
      Object.values(store.getState().canvas.objects).some(
        (object) => object.type === "frame" && !object.deletedAt,
      ),
    ).toBe(true);
    expect(store.getState().canvas.receipts.at(-1)?.action).toBe("redo");
  });

  it("rotates the primary object through a canonical transform receipt", async () => {
    const user = userEvent.setup();
    const store = createCanvasStore("room-local", dependencies());
    seedNote(store, { id: "note-first", title: "First note", x: 40 });
    const { container } = render(<CommandCanvasRoom store={store} />);

    await user.click(screen.getByRole("button", { name: "Select First note" }));
    await user.click(screen.getByRole("button", { name: "Rotate clockwise" }));

    expect(store.getState().canvas.objects["note-first"]).toMatchObject({
      rotation: 15,
      version: 2,
    });
    expect(store.getState().canvas.receipts.at(-1)?.action).toBe("transform");
    expect(container.querySelector(".canvas-object")).toHaveStyle({
      transform: "rotate(15deg)",
    });
  });

  it("lifts primary spatial controls above overlapping objects without mutating durable z order", async () => {
    const user = userEvent.setup();
    const store = createCanvasStore("room-local", dependencies());
    seedNote(store, { id: "note-first", title: "First note", x: 40 });
    seedNote(store, { id: "note-second", title: "Second note", x: 400 });
    render(<CommandCanvasRoom store={store} />);

    await user.click(screen.getByRole("button", { name: "Select First note" }));

    const selectedCard = screen
      .getByRole("button", { name: "Select First note" })
      .closest("article");
    expect(selectedCard).toHaveStyle({ zIndex: 1_000_000 });
    expect(screen.getByRole("button", { name: "Focus object" })).toBeVisible();
    expect(
      within(
        screen.getByRole("toolbar", { name: "First note spatial controls" }),
      )
        .getAllByRole("button")
        .slice(0, 3)
        .map((button) => button.getAttribute("aria-label")),
    ).toEqual(["Focus object", "Minimize object", "Move object to trash"]);
    expect(store.getState().canvas.objects["note-first"]?.zIndex).toBe(40);
    expect(store.getState().canvas.objects["note-second"]?.zIndex).toBe(400);
  });

  it("keeps every future integration visibly honest in local mode", async () => {
    const user = userEvent.setup();
    const store = createCanvasStore("room-local", dependencies());
    render(<CommandCanvasRoom store={store} />);

    expect(screen.getByText("Local room")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open system status" }));
    expect(screen.getByText("WebMCP not exercised")).toBeInTheDocument();
    expect(screen.getByText("Realtime not connected")).toHaveAttribute(
      "role",
      "status",
    );
    expect(screen.getByText("Realtime not connected")).toHaveAttribute(
      "aria-live",
      "polite",
    );
    expect(screen.getByText("Camera off")).toBeInTheDocument();
  });

  it("waits for a remote canonical command without optimistically changing local state", async () => {
    const user = userEvent.setup();
    const store = createCanvasStore("room-live", dependencies());
    const received: Array<{
      command: CanvasCommand;
      source: CanvasCommandSource;
    }> = [];
    let finishCommand!: () => void;
    const commandFinishes = new Promise<void>((resolve) => {
      finishCommand = resolve;
    });

    render(
      <CommandCanvasRoom
        store={store}
        onCommand={(command, source) => {
          received.push({ command, source });
          return commandFinishes;
        }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Create note" }));

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      command: { type: "object.create", object: { type: "note" } },
      source: "pointer",
    });
    expect(store.getState().canvas.revision).toBe(0);
    expect(screen.getByText("Applying command…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create note" })).toBeDisabled();

    finishCommand();

    await waitFor(() => {
      expect(screen.queryByText("Applying command…")).not.toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Create note" })).toBeEnabled();
    expect(store.getState().canvas.revision).toBe(0);
  });

  it("shows a rejected remote command instead of implying that it succeeded", async () => {
    const user = userEvent.setup();
    const store = createCanvasStore("room-live", dependencies());
    render(
      <CommandCanvasRoom
        store={store}
        onCommand={async () => {
          throw new Error("Canvas changed. Refresh and try again.");
        }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Create schedule" }));

    expect(await screen.findByText("Command refused")).toBeInTheDocument();
    expect(
      screen.getByText("Canvas changed. Refresh and try again."),
    ).toBeInTheDocument();
    expect(store.getState().canvas.revision).toBe(0);
    expect(screen.getByText("No objects yet")).toBeInTheDocument();
  });

  it("routes every toolbar and selected-object mutation through the remote handler", async () => {
    const user = userEvent.setup();
    const store = createCanvasStore("room-live", dependencies());
    store.getState().dispatch(
      {
        type: "object.create",
        object: {
          id: "note-seed",
          type: "note",
          title: "Seed note",
          x: 20,
          y: 30,
          width: 280,
          height: 190,
          zIndex: 1,
          payload: { text: "Seed", tone: "coral" },
        },
      },
      "system",
    );
    const received: CanvasCommand[] = [];
    render(
      <CommandCanvasRoom
        store={store}
        onCommand={(command) => {
          received.push(command);
        }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Create note" }));
    await user.click(screen.getByRole("button", { name: "Create task board" }));
    await user.click(screen.getByRole("button", { name: "Create schedule" }));
    await user.click(screen.getByRole("button", { name: "Select Seed note" }));
    await user.click(screen.getByRole("button", { name: "Pin object" }));
    await user.click(screen.getByRole("button", { name: "Minimize object" }));
    await user.click(screen.getByRole("button", { name: "Move object to trash" }));
    await user.click(screen.getByRole("button", { name: "Undo last change" }));

    expect(received.map((command) => command.type)).toEqual([
      "object.create",
      "object.create",
      "object.create",
      "object.set_flags",
      "object.set_flags",
      "object.discard",
      "history.undo",
    ]);
    expect(received[3]).toMatchObject({ flags: { pinned: true } });
    expect(received[4]).toMatchObject({ flags: { minimized: true } });
    expect(store.getState().canvas.revision).toBe(1);
  });

  it("routes bounded typed commands through the same canonical human source", async () => {
    const user = userEvent.setup();
    const store = createCanvasStore("room-local", dependencies());
    render(<CommandCanvasRoom store={store} />);
    await user.click(screen.getByRole("button", { name: "Open command drawer" }));
    const input = screen.getByRole("textbox", {
      name: "Direct canvas command",
    });

    await user.type(input, "Bring in our project board");
    await user.click(screen.getByRole("button", { name: "Run direct command" }));

    const board = Object.values(store.getState().canvas.objects).find(
      (object) => object.type === "task_board",
    );
    expect(board).toBeDefined();
    expect(store.getState().canvas.receipts.at(-1)?.source).toBe("typed");
    expect(screen.getByText("Board command submitted.")).toBeVisible();

    await user.click(screen.getByRole("button", { name: "Select Launch board" }));
    await user.type(input, "minimize it");
    await user.click(screen.getByRole("button", { name: "Run direct command" }));

    expect(store.getState().canvas.objects[board!.id]?.minimized).toBe(true);
    expect(store.getState().canvas.receipts.at(-1)?.source).toBe("typed");
  });

  it("uses direct note content and refuses selected-object language without a selection", async () => {
    const user = userEvent.setup();
    const store = createCanvasStore("room-local", dependencies());
    render(<CommandCanvasRoom store={store} />);
    await user.click(screen.getByRole("button", { name: "Open command drawer" }));
    const input = screen.getByRole("textbox", {
      name: "Direct canvas command",
    });

    await user.type(input, "pin this");
    await user.click(screen.getByRole("button", { name: "Run direct command" }));
    expect(screen.getByText("Select an active object first.")).toBeVisible();

    await user.clear(input);
    await user.type(input, "Make a note: Launch date is Friday");
    await user.click(screen.getByRole("button", { name: "Run direct command" }));

    const note = Object.values(store.getState().canvas.objects).find(
      (object) => object.type === "note",
    );
    expect(note?.type === "note" ? note.payload.text : undefined).toBe(
      "Launch date is Friday",
    );
  });

  it("discards the exact object staged before the selection changes", async () => {
    const user = userEvent.setup();
    const store = createCanvasStore("room-local", dependencies());
    seedNote(store, { id: "note-launch", title: "Launch note", x: 20 });
    seedNote(store, { id: "note-risk", title: "Risk note", x: 340 });
    render(<CommandCanvasRoom store={store} />);
    await user.click(screen.getByRole("button", { name: "Open command drawer" }));

    await user.click(screen.getByRole("button", { name: "Select Launch note" }));
    await user.type(
      screen.getByRole("textbox", { name: "Direct canvas command" }),
      "discard this",
    );
    await user.click(screen.getByRole("button", { name: "Run direct command" }));
    await user.click(screen.getByRole("button", { name: "Select Risk note" }));
    await user.click(
      screen.getByRole("button", { name: "Confirm recoverable discard" }),
    );

    expect(store.getState().canvas.objects["note-launch"]?.deletedAt).not.toBeNull();
    expect(store.getState().canvas.objects["note-risk"]?.deletedAt).toBeNull();
    expect(store.getState().canvas.receipts.at(-1)).toMatchObject({
      source: "typed",
      action: "discard",
      affectedObjectIds: ["note-launch"],
    });
  });

  it("refuses a staged discard when that object changed before confirmation", async () => {
    const user = userEvent.setup();
    const store = createCanvasStore("room-local", dependencies());
    seedNote(store, { id: "note-launch", title: "Launch note", x: 20 });
    render(<CommandCanvasRoom store={store} />);
    await user.click(screen.getByRole("button", { name: "Open command drawer" }));

    await user.click(screen.getByRole("button", { name: "Select Launch note" }));
    await user.type(
      screen.getByRole("textbox", { name: "Direct canvas command" }),
      "discard this",
    );
    await user.click(screen.getByRole("button", { name: "Run direct command" }));
    store.getState().dispatch(
      {
        type: "object.transform",
        objectId: "note-launch",
        transform: { x: 80 },
      },
      "collaborator",
    );
    await user.click(
      screen.getByRole("button", { name: "Confirm recoverable discard" }),
    );

    expect(store.getState().canvas.objects["note-launch"]).toMatchObject({
      deletedAt: null,
      version: 2,
      x: 80,
    });
    expect(
      screen.getByText(
        "Discard cancelled because “Launch note” changed. Review it and try again.",
      ),
    ).toBeVisible();
  });

  it("refuses a staged discard when that object was already deleted", async () => {
    const user = userEvent.setup();
    const store = createCanvasStore("room-local", dependencies());
    seedNote(store, { id: "note-launch", title: "Launch note", x: 20 });
    render(<CommandCanvasRoom store={store} />);
    await user.click(screen.getByRole("button", { name: "Open command drawer" }));

    await user.click(screen.getByRole("button", { name: "Select Launch note" }));
    await user.type(
      screen.getByRole("textbox", { name: "Direct canvas command" }),
      "discard this",
    );
    await user.click(screen.getByRole("button", { name: "Run direct command" }));
    store.getState().dispatch(
      { type: "object.discard", objectId: "note-launch" },
      "collaborator",
    );
    const revisionBeforeConfirmation = store.getState().canvas.revision;
    await user.click(
      screen.getByRole("button", { name: "Confirm recoverable discard" }),
    );

    expect(store.getState().canvas.revision).toBe(revisionBeforeConfirmation);
    expect(
      screen.getByText(
        "Discard cancelled because “Launch note” is no longer active.",
      ),
    ).toBeVisible();
  });

  it("routes completed drag and resize previews through the remote handler", () => {
    const store = createCanvasStore("room-live", dependencies());
    store.getState().dispatch(
      {
        type: "object.create",
        object: {
          id: "note-seed",
          type: "note",
          title: "Seed note",
          x: 20,
          y: 30,
          width: 280,
          height: 190,
          zIndex: 1,
          payload: { text: "Seed", tone: "coral" },
        },
      },
      "system",
    );
    const received: CanvasCommand[] = [];
    render(
      <CommandCanvasRoom
        store={store}
        onCommand={(command) => {
          received.push(command);
        }}
      />,
    );
    const object = screen.getByRole("button", { name: "Select Seed note" });

    fireEvent.pointerDown(object, {
      pointerId: 11,
      clientX: 100,
      clientY: 100,
    });
    expect(object.closest("article")).toHaveClass("is-held");
    fireEvent.pointerMove(object, {
      pointerId: 11,
      clientX: 130,
      clientY: 150,
    });
    fireEvent.pointerUp(object, {
      pointerId: 11,
      clientX: 130,
      clientY: 150,
    });
    expect(object.closest("article")).not.toHaveClass("is-held");

    const resize = screen.getByRole("button", { name: "Resize Seed note" });
    fireEvent.pointerDown(resize, {
      pointerId: 12,
      clientX: 200,
      clientY: 200,
    });
    fireEvent.pointerMove(resize, {
      pointerId: 12,
      clientX: 260,
      clientY: 240,
    });
    fireEvent.pointerUp(resize, {
      pointerId: 12,
      clientX: 260,
      clientY: 240,
    });

    expect(received).toEqual([
      {
        type: "object.transform",
        objectId: "note-seed",
        transform: { x: 50, y: 80 },
      },
      {
        type: "object.transform",
        objectId: "note-seed",
        transform: { width: 340, height: 230 },
      },
    ]);
    expect(store.getState().canvas.objects["note-seed"]).toMatchObject({
      x: 20,
      y: 30,
      width: 280,
      height: 190,
    });
    expect(store.getState().canvas.revision).toBe(1);
  });

  it("publishes pointer positions in world coordinates without persisting them", () => {
    const store = createCanvasStore("room-live", dependencies());
    store.getState().setViewport({ x: 40, y: -20, scale: 2 });
    const points: Array<{ x: number; y: number }> = [];
    const { container } = render(
      <CommandCanvasRoom
        store={store}
        onCanvasPointerWorldMove={(point) => points.push(point)}
      />,
    );
    const viewport = container.querySelector<HTMLElement>(".canvas-viewport");
    expect(viewport).not.toBeNull();
    viewport!.getBoundingClientRect = () =>
      ({ left: 100, top: 50, width: 800, height: 600 }) as DOMRect;

    fireEvent.pointerMove(viewport!, { clientX: 300, clientY: 230 });

    expect(points).toEqual([{ x: 80, y: 100 }]);
    expect(store.getState().canvas.revision).toBe(0);
  });

  it("renders live room identity, participant presence, and remote world cursors", () => {
    const store = createCanvasStore("room-live", dependencies());
    store.getState().setViewport({ x: 10, y: 20, scale: 2 });
    const { container } = render(
      <CommandCanvasRoom
        store={store}
        roomLabel="Launch planning"
        roomStatus="live"
        participants={[
          {
            id: "participant-host",
            displayName: "Danny",
            role: "host",
            color: "#ff7657",
          },
          {
            id: "participant-sarah",
            displayName: "Sarah",
            role: "participant",
            color: "#52d1b2",
          },
        ]}
        remoteCursors={[
          {
            participantId: "participant-sarah",
            displayName: "Sarah",
            color: "#52d1b2",
            x: 50,
            y: 75,
          },
        ]}
      />,
    );

    expect(screen.getByText("Launch planning")).toBeInTheDocument();
    expect(screen.getByText("LIVE")).toBeInTheDocument();
    expect(screen.getByLabelText("2 participants present")).toBeInTheDocument();
    expect(screen.getByTitle("Danny · host")).toBeInTheDocument();
    expect(screen.getByTitle("Sarah · participant")).toBeInTheDocument();
    const cursor = container.querySelector<HTMLElement>(
      '[data-remote-cursor="participant-sarah"]',
    );
    expect(cursor).not.toBeNull();
    expect(cursor).toHaveStyle({ left: "110px", top: "170px" });
    expect(cursor?.closest(".canvas-world")).toBeNull();
  });
});
