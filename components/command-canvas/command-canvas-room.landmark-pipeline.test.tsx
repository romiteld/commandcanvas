import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CommandCanvasRoom } from "@/components/command-canvas/command-canvas-room";
import {
  createCanvasStore,
  type CanvasStoreDependencies,
} from "@/lib/canvas/canvas-store";
import type { HandControlGainState } from "@/lib/gesture/hand-calibration";
import {
  createHandTrackingController,
  type HandTrackingController,
  type HandTrackingWorkerLike,
} from "@/lib/gesture/hand-tracking-controller";
import type { HandLandmarks } from "@/lib/gesture/hand-intent";
import type {
  HandTrackingWorkerInboundMessage,
  HandTrackingWorkerOutboundMessage,
} from "@/lib/gesture/hand-tracking-worker-core";

type LandmarkMode = "point" | "pinch" | "neutral";

class TestLandmarkWorker implements HandTrackingWorkerLike {
  onmessage:
    | ((event: MessageEvent<HandTrackingWorkerOutboundMessage>) => void)
    | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  readonly postMessage = vi.fn((message: HandTrackingWorkerInboundMessage) => {
    if (message.type !== "initialize") return;
    queueMicrotask(() => this.emit({ type: "ready" }));
  });
  readonly terminate = vi.fn();

  emit(message: HandTrackingWorkerOutboundMessage) {
    this.onmessage?.({ data: message } as MessageEvent<HandTrackingWorkerOutboundMessage>);
  }
}

interface TestLandmarkFrameSource {
  readonly controller: HandTrackingController;
  readonly observations: readonly string[];
  emit(input: {
    readonly x: number;
    readonly y: number;
    readonly gain: HandControlGainState;
    readonly mode: LandmarkMode;
    readonly timestamp: number;
    readonly supportVisibility?: number;
  }): void;
}

/** Test-only worker seam. This module is matched only by Vitest's *.test.tsx glob. */
function createTestLandmarkFrameSource(): TestLandmarkFrameSource {
  let now = 1_000;
  const worker = new TestLandmarkWorker();
  const controller = createHandTrackingController({
    getUserMedia: async () =>
      ({
        getTracks: () => [{ kind: "video", stop: vi.fn() }],
      }) as unknown as MediaStream,
    createWorker: () => worker,
    createImageBitmap: async () =>
      ({ close: vi.fn() }) as unknown as ImageBitmap,
    requestAnimationFrame: () => 1,
    cancelAnimationFrame: () => undefined,
    now: () => now,
  });
  const observations: string[] = [];
  controller.subscribeObservations((observation) =>
    observations.push(observation.mode),
  );
  return {
    controller,
    observations,
    emit(input) {
      now = input.timestamp;
      worker.emit({
        type: "result",
        timestamp: input.timestamp,
        hands: [
          {
            handedness: "right",
            confidence: 0.99,
            landmarks: productionLandmarks(
              input.x,
              input.y,
              input.gain,
              input.mode,
              input.supportVisibility,
            ),
          },
        ],
      });
    },
  };
}

function storeDependencies(): CanvasStoreDependencies {
  let id = 0;
  let second = 0;
  return {
    actor: { id: "participant-host", displayName: "Danny", type: "human" },
    createId: (prefix) => `${prefix}-${++id}`,
    now: () => `2026-08-29T15:00:${String(second++).padStart(2, "0")}.000Z`,
  };
}

function setCanvasBounds(container: HTMLElement) {
  const viewport = container.querySelector(".canvas-viewport");
  if (!(viewport instanceof HTMLElement))
    throw new Error("Canvas viewport fixture was not rendered.");
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

function seedSpatialNote(store: ReturnType<typeof createCanvasStore>) {
  store.getState().dispatch(
    {
      type: "object.create",
      object: {
        id: "note-landmark-move",
        type: "note",
        title: "Move with landmarks",
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
}

async function startCalibratedHandInput(
  user: ReturnType<typeof userEvent.setup>,
) {
  await user.click(screen.getByRole("button", { name: "Open system status" }));
  await user.click(screen.getByRole("button", { name: "Enable hand input" }));
  await user.click(
    await screen.findByRole("button", { name: "Skip hand calibration" }),
  );
}

beforeEach(() => {
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
});

describe("production landmark frames through the canonical room pipeline", () => {
  it("threads explicit Draw mode to relaxed index-led raw landmark interpretation", async () => {
    const user = userEvent.setup();
    const source = createTestLandmarkFrameSource();
    const store = createCanvasStore("room-relaxed-index-draw", storeDependencies());
    const { container } = render(
      <CommandCanvasRoom
        store={store}
        createHandTrackingController={() => source.controller}
      />,
    );
    setCanvasBounds(container);
    await startCalibratedHandInput(user);
    await user.click(screen.getByRole("button", { name: "Draw with index finger" }));

    act(() => {
      source.emit({
        x: 0.3,
        y: 0.3,
        gain: "draw",
        mode: "point",
        timestamp: 1_050,
        supportVisibility: 0.2,
      });
      source.emit({
        x: 0.4,
        y: 0.4,
        gain: "draw",
        mode: "point",
        timestamp: 1_066,
        supportVisibility: 0.2,
      });
      source.emit({
        x: 0.4,
        y: 0.4,
        gain: "draw",
        mode: "neutral",
        timestamp: 1_082,
        supportVisibility: 0.2,
      });
    });

    expect(source.observations).toEqual(["point", "point", "idle"]);
    expect(screen.getByText("1 stroke ready")).toBeVisible();
    expect(screen.queryByRole("complementary", { name: /drawer/i })).toBeNull();
  });

  it("keeps multiple index-finger strokes in one sketch while opening zero panels", async () => {
    const user = userEvent.setup();
    const source = createTestLandmarkFrameSource();
    const store = createCanvasStore("room-landmark-draw", storeDependencies());
    const { container } = render(
      <CommandCanvasRoom
        store={store}
        createHandTrackingController={() => source.controller}
      />,
    );
    setCanvasBounds(container);
    await startCalibratedHandInput(user);
    await user.click(
      screen.getByRole("button", { name: "Draw with index finger" }),
    );

    act(() => {
      for (let stroke = 0; stroke < 3; stroke += 1) {
        const timestamp = 1_100 + stroke * 64;
        source.emit({
          x: 0.2 + stroke * 0.08,
          y: 0.25 + stroke * 0.04,
          gain: "draw",
          mode: "point",
          timestamp,
        });
        source.emit({
          x: 0.26 + stroke * 0.08,
          y: 0.32 + stroke * 0.04,
          gain: "draw",
          mode: "point",
          timestamp: timestamp + 16,
        });
        source.emit({
          x: 0.26 + stroke * 0.08,
          y: 0.32 + stroke * 0.04,
          gain: "draw",
          mode: "neutral",
          timestamp: timestamp + 32,
        });
      }
    });

    expect(source.observations).toEqual([
      "point",
      "point",
      "idle",
      "point",
      "point",
      "idle",
      "point",
      "point",
      "idle",
    ]);
    expect(screen.getByText("3 strokes ready")).toBeVisible();
    expect(
      screen.queryByRole("complementary", { name: /drawer/i }),
    ).toBeNull();
    expect(Object.values(store.getState().canvas.objects)).toHaveLength(0);

    await user.click(
      screen.getByRole("button", { name: "Finish hand sketch" }),
    );

    const objects = Object.values(store.getState().canvas.objects);
    expect(objects).toHaveLength(1);
    expect(objects[0]).toMatchObject({ type: "sketch" });
    if (objects[0]?.type !== "sketch")
      throw new Error("Expected one canonical sketch object.");
    expect(objects[0].payload.strokes).toHaveLength(3);
    expect(store.getState().canvas.receipts).toHaveLength(1);
    expect(store.getState().canvas.receipts[0]).toMatchObject({
      action: "create",
      source: "gesture",
      affectedObjectIds: [objects[0].id],
    });
    expect(
      screen.queryByRole("complementary", { name: /drawer/i }),
    ).toBeNull();
  });

  it("turns a landmark pinch move and release into one canonical transform receipt", async () => {
    const user = userEvent.setup();
    const source = createTestLandmarkFrameSource();
    const store = createCanvasStore("room-landmark-move", storeDependencies());
    seedSpatialNote(store);
    const initialReceiptCount = store.getState().canvas.receipts.length;
    const { container } = render(
      <CommandCanvasRoom
        store={store}
        createHandTrackingController={() => source.controller}
      />,
    );
    setCanvasBounds(container);
    await startCalibratedHandInput(user);

    act(() => {
      source.emit({ x: 0.29, y: 0.44, gain: "hover", mode: "point", timestamp: 2_000 });
      source.emit({ x: 0.29, y: 0.44, gain: "target", mode: "point", timestamp: 2_100 });
      source.emit({ x: 0.29, y: 0.44, gain: "target", mode: "pinch", timestamp: 2_116 });
      source.emit({ x: 0.29, y: 0.44, gain: "target", mode: "pinch", timestamp: 2_132 });
      source.emit({ x: 0.45, y: 0.58, gain: "held", mode: "pinch", timestamp: 2_148 });
      source.emit({ x: 0.45, y: 0.58, gain: "held", mode: "pinch", timestamp: 2_164 });
      source.emit({ x: 0.45, y: 0.58, gain: "held", mode: "pinch", timestamp: 2_180 });
      source.emit({ x: 0.45, y: 0.58, gain: "held", mode: "point", timestamp: 2_196 });
      source.emit({ x: 0.45, y: 0.58, gain: "held", mode: "point", timestamp: 2_212 });
    });

    await waitFor(() =>
      expect(store.getState().canvas.objects["note-landmark-move"].version).toBe(2),
    );
    expect(store.getState().canvas.objects["note-landmark-move"]).toMatchObject({
      x: expect.any(Number),
      y: expect.any(Number),
      version: 2,
    });
    expect(store.getState().canvas.objects["note-landmark-move"].x).toBeGreaterThan(200);
    expect(store.getState().canvas.objects["note-landmark-move"].y).not.toBe(150);
    expect(store.getState().canvas.receipts).toHaveLength(initialReceiptCount + 1);
    expect(store.getState().canvas.receipts.at(-1)).toMatchObject({
      action: "transform",
      source: "gesture",
      affectedObjectIds: ["note-landmark-move"],
    });
  });
});

function productionLandmarks(
  canvasX: number,
  canvasY: number,
  gain: HandControlGainState,
  mode: LandmarkMode,
  supportVisibility = 0.99,
): HandLandmarks {
  const points = Array.from({ length: 21 }, () => ({
    x: 0.3,
    y: 0.78,
    z: 0,
    visibility: 0.99,
  }));
  points[0] = { x: 0.3, y: 0.82, z: 0, visibility: 0.99 };
  points[5] = { x: 0.2, y: 0.62, z: 0, visibility: 0.99 };
  points[6] = { x: 0.25, y: 0.54, z: 0, visibility: 0.99 };
  points[7] = { x: 0.275, y: 0.47, z: 0, visibility: 0.99 };
  points[9] = { x: 0.3, y: 0.6, z: 0, visibility: 0.99 };
  points[10] = { x: 0.31, y: 0.69, z: 0, visibility: 0.99 };
  points[12] = { x: 0.31, y: 0.76, z: 0, visibility: 0.99 };
  points[13] = { x: 0.38, y: 0.62, z: 0, visibility: 0.99 };
  points[14] = { x: 0.36, y: 0.7, z: 0, visibility: 0.99 };
  points[16] = { x: 0.34, y: 0.77, z: 0, visibility: 0.99 };
  points[17] = { x: 0.42, y: 0.65, z: 0, visibility: 0.99 };
  points[18] = { x: 0.4, y: 0.72, z: 0, visibility: 0.99 };
  points[20] = { x: 0.37, y: 0.79, z: 0, visibility: 0.99 };
  for (const index of [10, 12, 14, 16, 18, 20] as const)
    points[index] = { ...points[index], visibility: supportVisibility };

  const cameraX = inverseFallbackAxis(canvasX, 1_000, gain, 0.15, 0.7);
  const cameraY = inverseFallbackAxis(canvasY, 500, gain, 0.12, 0.76);
  const rawIndex = { x: 1 - cameraX, y: cameraY };
  const offsetX = rawIndex.x - 0.3;
  const offsetY = rawIndex.y - 0.4;
  for (const point of points) {
    point.x += offsetX;
    point.y += offsetY;
  }
  points[8] = {
    x: rawIndex.x,
    y: mode === "neutral" ? rawIndex.y + 0.18 : rawIndex.y,
    z: 0,
    visibility: 0.99,
  };
  if (mode === "neutral")
    points[7] = {
      x: rawIndex.x - 0.02,
      y: rawIndex.y + 0.15,
      z: 0,
      visibility: 0.99,
    };
  points[4] =
    mode === "pinch"
      ? { x: rawIndex.x + 0.008, y: rawIndex.y, z: 0, visibility: 0.99 }
      : {
          x: rawIndex.x - 0.2,
          y: rawIndex.y,
          z: 0,
          visibility: 0.99,
        };
  return points as unknown as HandLandmarks;
}

function inverseFallbackAxis(
  canvasRatio: number,
  canvasSize: number,
  gainState: HandControlGainState,
  cameraStart: number,
  cameraSpan: number,
) {
  const gain =
    gainState === "hover"
      ? 1.5
      : gainState === "target"
        ? 1.25
        : gainState === "two_hand"
          ? 1
          : 1.1;
  const safeRatio = Math.min(24, canvasSize / 2) / canvasSize;
  const edgeExtrapolation = 0.1;
  const comfortable =
    canvasRatio < safeRatio
      ? -edgeExtrapolation * (1 - canvasRatio / safeRatio)
      : canvasRatio > 1 - safeRatio
        ? 1 +
          edgeExtrapolation *
            (1 - (1 - canvasRatio) / safeRatio)
        : (canvasRatio - safeRatio) / (1 - safeRatio * 2);
  const beforeGain = (comfortable - 0.5) / gain + 0.5;
  return cameraStart + beforeGain * cameraSpan;
}
