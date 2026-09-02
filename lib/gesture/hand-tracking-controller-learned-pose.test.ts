import { describe, expect, it, vi } from "vitest";

import {
  createHandTrackingController,
  type HandTrackingObservation,
  type HandTrackingControllerDependencies,
  type HandTrackingWorkerLike,
} from "@/lib/gesture/hand-tracking-controller";
import { rawHandLandmarks } from "@/lib/testing/hand-landmark-fixtures";

class FakeWorker implements HandTrackingWorkerLike {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();

  emit(data: unknown) {
    this.onmessage?.({ data } as MessageEvent);
  }
}

function harness(
  classifyStaticPose: NonNullable<
    HandTrackingControllerDependencies["classifyStaticPose"]
  >,
) {
  const worker = new FakeWorker();
  const track = { stop: vi.fn(), kind: "video" };
  const stream = {
    getTracks: () => [track],
  } as unknown as MediaStream;
  const video = {
    srcObject: null,
    readyState: 4,
    play: vi.fn(async () => undefined),
  } as unknown as HTMLVideoElement;
  const controller = createHandTrackingController({
    getUserMedia: vi.fn(async () => stream),
    createWorker: () => worker,
    createImageBitmap: vi.fn(
      async () => ({ close: vi.fn() }) as unknown as ImageBitmap,
    ),
    requestAnimationFrame: vi.fn(() => 1),
    cancelAnimationFrame: vi.fn(),
    now: () => 1_000,
    classifyStaticPose,
  });
  return { controller, worker, video };
}

describe("hand controller learned-pose integration", () => {
  it("feeds the current raw hand through the classifier without bypassing the intent reducer", async () => {
    const classifyStaticPose = vi.fn(() => ({
      label: "point" as const,
      confidence: 0.99,
      source: "hagrid-v2-static-pose-v1" as const,
    }));
    const { controller, worker, video } = harness(classifyStaticPose);
    const observations: HandTrackingObservation[] = [];
    controller.subscribeObservations((observation) => observations.push(observation));
    const starting = controller.start(video);
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalled());
    worker.emit({ type: "ready" });
    await starting;

    const landmarks = rawHandLandmarks({
      pose: "relaxed_index",
      supportVisibility: 0.2,
    });
    worker.emit({
      type: "result",
      timestamp: 1_000,
      hands: [
        {
          handedness: "right",
          handednessConfidence: 0.99,
          confidence: 0.98,
          landmarks,
        },
      ],
    });

    expect(classifyStaticPose).toHaveBeenCalledWith(
      expect.objectContaining({
        handedness: "right",
        confidence: 0.98,
        landmarks,
        trackId: expect.any(String),
      }),
    );
    expect(observations.at(-1)).toMatchObject({ mode: "point" });
  });

  it("fails closed to canonical geometry when the optional classifier throws", async () => {
    const classifyStaticPose = vi.fn(() => {
      throw new Error("malformed model");
    });
    const { controller, worker, video } = harness(classifyStaticPose);
    const observations: HandTrackingObservation[] = [];
    controller.subscribeObservations((observation) => observations.push(observation));
    const starting = controller.start(video);
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalled());
    worker.emit({ type: "ready" });
    await starting;

    worker.emit({
      type: "result",
      timestamp: 1_000,
      hands: [
        {
          handedness: "right",
          confidence: 0.98,
          landmarks: rawHandLandmarks({ pose: "relaxed_index" }),
        },
      ],
    });

    expect(observations.at(-1)).toMatchObject({ mode: "point" });
  });

  it("requires the existing calibrated temporal vote before learned pinch support emits grab", async () => {
    const classifyStaticPose = vi.fn(() => ({
      label: "pinch" as const,
      confidence: 0.99,
      source: "hagrid-v2-static-pose-v1" as const,
    }));
    const { controller, worker, video } = harness(classifyStaticPose);
    controller.setPinchThresholds?.({
      fallback: { engage: 0.28, release: 0.5 },
      byTrackId: {},
      byHandedness: { right: { engage: 0.28, release: 0.5 } },
    });
    const observations: HandTrackingObservation[] = [];
    controller.subscribeObservations((observation) => observations.push(observation));
    const starting = controller.start(video);
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalled());
    worker.emit({ type: "ready" });
    await starting;

    const landmarks = rawHandLandmarks({
      pose: "relaxed_index",
      thumbTip: { x: 0.41, y: 0.22 },
    });
    worker.emit({
      type: "result",
      timestamp: 1_000,
      hands: [
        {
          handedness: "right",
          handednessConfidence: 0.99,
          confidence: 0.98,
          landmarks,
        },
      ],
    });
    expect(observations.at(-1)).not.toMatchObject({ mode: "pinch" });

    worker.emit({
      type: "result",
      timestamp: 1_016,
      hands: [
        {
          handedness: "right",
          handednessConfidence: 0.99,
          confidence: 0.98,
          landmarks,
        },
      ],
    });
    expect(observations.at(-1)).toMatchObject({ mode: "pinch" });
  });
});
