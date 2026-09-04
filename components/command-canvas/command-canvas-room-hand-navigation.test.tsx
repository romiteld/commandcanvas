import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { CommandCanvasRoom } from "@/components/command-canvas/command-canvas-room";
import { createCanvasStore } from "@/lib/canvas/canvas-store";
import type {
  HandTrackingController,
  HandTrackingObservation,
  HandTrackingStatus,
} from "@/lib/gesture/hand-tracking-controller";
import type { HandControlGainState } from "@/lib/gesture/hand-calibration";
import type { HandPointPolicy } from "@/lib/gesture/hand-intent";

function store() {
  let id = 0;
  return createCanvasStore("room-hand-navigation", {
    actor: { id: "host", displayName: "Danny", type: "human" },
    createId: (prefix) => `${prefix}-${++id}`,
    now: () => `2026-08-28T12:00:${String(id).padStart(2, "0")}.000Z`,
  });
}

function seedNote(
  target: ReturnType<typeof store>,
  input: { id: string; x: number; zIndex: number; title?: string },
) {
  target.getState().dispatch(
    {
      type: "object.create",
      object: {
        id: input.id,
        type: "note",
        title: input.title ?? input.id,
        x: input.x,
        y: 150,
        width: 220,
        height: 140,
        zIndex: input.zIndex,
        payload: { text: input.id, tone: "sky" },
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
  let pinching = false;
  let pointPolicy: HandPointPolicy | null = null;
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
    setPointPolicy(next) {
      pointPolicy = next;
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
    emit(observation: HandTrackingObservation) {
      observationListeners.forEach((listener) =>
        listener(
          toCameraObservation(
            observation,
            observation.mode === "bimanual_pinch"
              ? "two_hand"
              : pinching
                ? "held"
                : observation.mode === "pinch"
                  ? "target"
                  : "hover",
          ),
        ),
      );
      pinching =
        observation.mode === "pinch" || observation.mode === "bimanual_pinch";
    },
    getPointPolicy() {
      return pointPolicy;
    },
  };
}

function toCameraPoint(
  point: { x: number; y: number },
  gainState: HandControlGainState,
) {
  return {
    x: inverseFallbackAxis(point.x, 1_000, gainState, 0.15, 0.7),
    y: inverseFallbackAxis(point.y, 500, gainState, 0.12, 0.76),
  };
}

function inverseFallbackAxis(
  canvasRatio: number,
  canvasSize: number,
  gainState: HandControlGainState,
  cameraStart: number,
  cameraSpan: number,
) {
  const gain = {
    hover: 1.1,
    target: 1.1,
    held: 1.1,
    draw: 1.1,
    two_hand: 1.1,
  }[gainState];
  const safeRatio = Math.min(24, canvasSize / 2) / canvasSize;
  const edgeExtrapolation = 0.1;
  const comfortable =
    canvasRatio < safeRatio
      ? -edgeExtrapolation * (1 - canvasRatio / safeRatio)
      : canvasRatio > 1 - safeRatio
        ? 1 + edgeExtrapolation * (1 - (1 - canvasRatio) / safeRatio)
        : (canvasRatio - safeRatio) / (1 - safeRatio * 2);
  const beforeGain = (comfortable - 0.5) / gain + 0.5;
  return cameraStart + beforeGain * cameraSpan;
}

function toCameraObservation(
  observation: HandTrackingObservation,
  gainState: HandControlGainState,
): HandTrackingObservation {
  if (observation.mode === "idle") return observation;
  if (observation.mode !== "bimanual_pinch")
    return {
      ...observation,
      pointer: toCameraPoint(observation.pointer, gainState),
      trackId: observation.trackId ?? "hand-a",
      prediction: observation.prediction ?? { predicted: false },
      trackingState: observation.trackingState ?? "tracked",
    };
  const hands = observation.hands.map((hand, index) => ({
    ...hand,
    pointer: toCameraPoint(hand.pointer, "two_hand"),
    trackId: hand.trackId ?? `hand-${index === 0 ? "a" : "b"}`,
    prediction: hand.prediction ?? { predicted: false },
    trackingState: hand.trackingState ?? "tracked",
  })) as unknown as typeof observation.hands;
  return {
    ...observation,
    hands,
    center: toCameraPoint(observation.center, "two_hand"),
    span: Math.hypot(
      hands[0].pointer.x - hands[1].pointer.x,
      hands[0].pointer.y - hands[1].pointer.y,
    ),
  };
}

function drawingMeasurements(x: number, y: number) {
  return {
    indexTip: { x, y },
    thumbTip: { x: x - 0.08, y: y + 0.08 },
    middleTip: { x: x - 0.06, y: y + 0.08 },
    pinchMidpoint: { x: x - 0.04, y: y + 0.04 },
    palmMcpCentroid: { x: x - 0.02, y: y + 0.18 },
    pinchDistance: 0.12,
    palmScale: 0.2,
    pinchRatio: 0.6,
    drawingClutchRatio: 0.2,
    confidence: 0.97,
    indexTipConfidence: 0.97,
    thumbTipConfidence: 0.97,
    middleTipConfidence: 0.97,
  };
}

function drawStroke(
  hand: ReturnType<typeof fakeHandController>,
  start: { x: number; y: number },
  end: { x: number; y: number },
  timestamp: number,
) {
  const midpoint = {
    x: (start.x + end.x) / 2,
    y: (start.y + end.y) / 2,
  };
  for (const [offset, pointer] of [
    [0, start],
    [8, midpoint],
    [16, end],
  ] as const)
    hand.emit({
      mode: "point",
      pointer,
      measurements: drawingMeasurements(pointer.x, pointer.y),
      confidence: 0.97,
      timestamp: timestamp + offset,
    });
}

function setCanvasBounds(container: HTMLElement) {
  const viewport = container.querySelector<HTMLElement>(".canvas-viewport");
  if (!viewport) throw new Error("Canvas viewport did not render.");
  vi.spyOn(viewport, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: 1_000,
    bottom: 500,
    width: 1_000,
    height: 500,
    toJSON: () => ({}),
  });
}

async function enableHand(hand: ReturnType<typeof fakeHandController>) {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Open system status" }));
  await user.click(screen.getByRole("button", { name: "Enable hand input" }));
  act(() => hand.setStatus({ state: "ready" }));
  await user.click(
    await screen.findByRole("button", { name: "Skip hand calibration" }),
  );
  return user;
}

function bimanual(
  hand: ReturnType<typeof fakeHandController>,
  leftX: number,
  rightX: number,
  timestamp: number,
) {
  hand.emit({
    mode: "bimanual_pinch",
    hands: [
      { handedness: "left", pointer: { x: leftX, y: 0.4 }, confidence: 0.96 },
      { handedness: "right", pointer: { x: rightX, y: 0.4 }, confidence: 0.96 },
    ],
    center: { x: (leftX + rightX) / 2, y: 0.4 },
    span: rightX - leftX,
    timestamp,
  });
}

function acquireAt(
  hand: ReturnType<typeof fakeHandController>,
  x: number,
  y: number,
  startedAt = 1_000,
) {
  hand.emit({
    mode: "point",
    pointer: { x, y },
    confidence: 0.97,
    timestamp: startedAt,
  });
  hand.emit({
    mode: "point",
    pointer: { x, y },
    confidence: 0.97,
    timestamp: startedAt + 100,
  });
  hand.emit({
    mode: "pinch",
    pointer: { x, y },
    confidence: 0.97,
    timestamp: startedAt + 110,
  });
}

describe("CommandCanvas hand-only navigation", () => {
  it("configures manipulation as spatial index-led pointing", () => {
    const target = store();
    const hand = fakeHandController();

    render(
      <CommandCanvasRoom
        store={target}
        createHandTrackingController={() => hand.controller}
      />,
    );

    expect(hand.getPointPolicy()).toBe("spatial-index-led");
  });

  it("pans the local viewport with an open palm over blank canvas without a receipt", async () => {
    const target = store();
    const hand = fakeHandController();
    const { container } = render(
      <CommandCanvasRoom
        store={target}
        createHandTrackingController={() => hand.controller}
      />,
    );
    setCanvasBounds(container);
    await enableHand(hand);

    act(() => {
      hand.emit({
        mode: "open_palm",
        pointer: { x: 0.7, y: 0.6 },
        confidence: 0.96,
        timestamp: 1_000,
      });
      hand.emit({
        mode: "open_palm",
        pointer: { x: 0.6, y: 0.5 },
        confidence: 0.96,
        timestamp: 1_016,
      });
    });

    expect(target.getState().viewport).toEqual({ x: -100, y: -50, scale: 1 });
    expect(target.getState().canvas.receipts).toHaveLength(0);
    expect(screen.getByText("PAN")).toBeVisible();
  });

  it("zooms the local viewport with two hands over blank canvas without a receipt", async () => {
    const target = store();
    const hand = fakeHandController();
    const { container } = render(
      <CommandCanvasRoom
        store={target}
        createHandTrackingController={() => hand.controller}
      />,
    );
    setCanvasBounds(container);
    await enableHand(hand);

    act(() => {
      bimanual(hand, 0.7, 0.9, 1_000);
      bimanual(hand, 0.65, 0.95, 1_016);
    });

    expect(target.getState().viewport.scale).toBeCloseTo(1.5);
    expect(target.getState().canvas.receipts).toHaveLength(0);
    expect(screen.getByText("CANVAS ZOOM")).toBeVisible();
  });

  it("keeps Finish and Cancel available if tracking is lost mid-sketch", async () => {
    const target = store();
    const hand = fakeHandController();
    const { container } = render(
      <CommandCanvasRoom
        store={target}
        createHandTrackingController={() => hand.controller}
      />,
    );
    setCanvasBounds(container);
    const user = await enableHand(hand);
    await user.click(
      screen.getByRole("button", { name: "Draw with index finger" }),
    );
    act(() => {
      drawStroke(hand, { x: 0.2, y: 0.3 }, { x: 0.3, y: 0.4 }, 1_000);
      hand.emit({ mode: "idle", timestamp: 1_032, trackingState: "lost" });
      hand.setStatus({ state: "unavailable", message: "Detector stopped." });
    });

    expect(screen.getByText("TRACKING LOST · SKETCH PRESERVED")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Finish hand sketch" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Cancel hand sketch" }),
    ).toBeVisible();
    await user.click(
      screen.getByRole("button", { name: "Finish hand sketch" }),
    );
    expect(
      Object.values(target.getState().canvas.objects).filter(
        (object) => object.type === "sketch",
      ),
    ).toHaveLength(1);
  });

  it("clears selected chrome before hand drawing so live ink stays unobstructed", async () => {
    const target = store();
    seedNote(target, { id: "selected-card", x: 200, zIndex: 1 });
    const hand = fakeHandController();
    const { container } = render(
      <CommandCanvasRoom
        store={target}
        createHandTrackingController={() => hand.controller}
      />,
    );
    setCanvasBounds(container);
    const user = await enableHand(hand);
    await user.click(
      screen.getByRole("button", { name: "Select selected-card" }),
    );
    expect(
      screen.getByRole("toolbar", { name: "selected-card spatial controls" }),
    ).toBeVisible();

    await user.click(
      screen.getByRole("button", { name: "Draw with index finger" }),
    );

    expect(target.getState().selectedObjectId).toBeNull();
    expect(
      screen.queryByRole("toolbar", { name: "selected-card spatial controls" }),
    ).toBeNull();
  });

  it("grabs the card that is visually raised above an overlapping card", async () => {
    const target = store();
    seedNote(target, { id: "raised-card", x: 200, zIndex: 1 });
    seedNote(target, { id: "durably-higher", x: 200, zIndex: 20 });
    const hand = fakeHandController();
    const { container } = render(
      <CommandCanvasRoom
        store={target}
        createHandTrackingController={() => hand.controller}
      />,
    );
    setCanvasBounds(container);
    const user = await enableHand(hand);
    await user.click(
      screen.getByRole("button", { name: "Select raised-card" }),
    );

    act(() => acquireAt(hand, 0.3, 0.4));

    expect(
      screen
        .getByRole("button", { name: "Select raised-card" })
        .closest("article"),
    ).toHaveClass("is-held");
    expect(
      screen
        .getByRole("button", { name: "Select durably-higher" })
        .closest("article"),
    ).not.toHaveClass("is-held");
  });

  it("arms edge feedback only from the reducer's exact staged action and hides it during resize", async () => {
    const target = store();
    seedNote(target, { id: "edge-card", x: 0, zIndex: 1 });
    const hand = fakeHandController();
    const { container } = render(
      <CommandCanvasRoom
        store={target}
        createHandTrackingController={() => hand.controller}
      />,
    );
    setCanvasBounds(container);
    await enableHand(hand);

    act(() => {
      acquireAt(hand, 0.055, 0.4);
      hand.emit({
        mode: "pinch",
        pointer: { x: 0.05, y: 0.4 },
        confidence: 0.97,
        timestamp: 1_126,
      });
    });
    expect(
      container.querySelector(".gesture-edge-discard-left"),
    ).not.toHaveClass("is-armed");

    act(() =>
      hand.emit({
        mode: "point",
        pointer: { x: 0.05, y: 0.4 },
        confidence: 0.97,
        timestamp: 1_140,
      }),
    );
    act(() => {
      acquireAt(hand, 0.055, 0.4, 1_300);
      bimanual(hand, 0.02, 0.18, 1_420);
      bimanual(hand, 0.02, 0.18, 1_520);
    });
    expect(screen.getByText("RESIZE")).toBeVisible();
    expect(container.querySelector(".gesture-edge-targets")).toBeNull();
  });
});
