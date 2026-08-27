import { describe, expect, it, vi } from "vitest";

import {
  createHandTrackingController,
  type HandTrackingWorkerLike,
} from "@/lib/gesture/hand-tracking-controller";
import type { HandLandmarks } from "@/lib/gesture/hand-intent";

function hand(index = { x: 0.3, y: 0.4 }, thumb = { x: 0.1, y: 0.4 }) {
  const points = Array.from({ length: 21 }, () => ({ x: 0.1, y: 0.2, z: 0 }));
  points[4] = { ...thumb, z: 0 };
  points[8] = { ...index, z: 0 };
  return points as unknown as HandLandmarks;
}

class FakeWorker implements HandTrackingWorkerLike {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();

  emit(data: unknown) {
    this.onmessage?.({ data } as MessageEvent);
  }
}

function harness() {
  const worker = new FakeWorker();
  const track = { stop: vi.fn() };
  const stream = {
    getTracks: () => [track],
  } as unknown as MediaStream;
  const getUserMedia = vi.fn(async () => stream);
  const createWorker = vi.fn(() => worker);
  const bitmaps: Array<{ close: ReturnType<typeof vi.fn> }> = [];
  const createImageBitmap = vi.fn(async () => {
    const bitmap = { close: vi.fn() };
    bitmaps.push(bitmap);
    return bitmap as unknown as ImageBitmap;
  });
  const frames = new Map<number, FrameRequestCallback>();
  let frameId = 0;
  const requestAnimationFrame = vi.fn((callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  const cancelAnimationFrame = vi.fn((id: number) => frames.delete(id));
  const video = {
    srcObject: null,
    readyState: 4,
    play: vi.fn(async () => undefined),
  } as unknown as HTMLVideoElement;
  const controller = createHandTrackingController({
    getUserMedia,
    createWorker,
    createImageBitmap,
    requestAnimationFrame,
    cancelAnimationFrame,
    now: () => 1_000,
  });
  return {
    controller,
    worker,
    track,
    getUserMedia,
    createWorker,
    createImageBitmap,
    frames,
    bitmaps,
    video,
  };
}

describe("hand tracking controller lifecycle", () => {
  it("does not request camera permission or create a worker before explicit start", () => {
    const { controller, getUserMedia, createWorker } = harness();

    expect(controller.getStatus()).toEqual({ state: "off" });
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(createWorker).not.toHaveBeenCalled();
  });

  it("starts local one-frame-at-a-time inference and releases every resource", async () => {
    const {
      controller,
      worker,
      track,
      getUserMedia,
      createImageBitmap,
      frames,
      video,
    } = harness();
    const statuses: unknown[] = [];
    controller.subscribeStatus((status) => statuses.push(status));

    const starting = controller.start(video);
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalled());
    expect(getUserMedia).toHaveBeenCalledWith({
      audio: false,
      video: {
        facingMode: "user",
        width: { ideal: 640 },
        height: { ideal: 480 },
        frameRate: { ideal: 30, max: 30 },
      },
    });
    expect(worker.postMessage).toHaveBeenCalledWith({
      type: "initialize",
      wasmBaseUrl: "/mediapipe/wasm",
      modelAssetUrl:
        "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
    });

    worker.emit({ type: "ready" });
    await starting;
    expect(controller.getStatus()).toEqual({ state: "ready" });

    const firstFrame = [...frames.values()][0];
    firstFrame?.(1_000);
    await vi.waitFor(() => expect(createImageBitmap).toHaveBeenCalledTimes(1));
    expect(worker.postMessage).toHaveBeenLastCalledWith(
      { type: "frame", frame: expect.any(Object), timestamp: 1_000 },
      [expect.any(Object)],
    );

    const secondTick = [...frames.values()].at(-1);
    secondTick?.(1_016);
    await Promise.resolve();
    expect(createImageBitmap).toHaveBeenCalledTimes(1);

    worker.emit({
      type: "result",
      timestamp: 1_000,
      confidence: null,
      landmarks: null,
    });
    const thirdTick = [...frames.values()].at(-1);
    thirdTick?.(1_032);
    await vi.waitFor(() => expect(createImageBitmap).toHaveBeenCalledTimes(2));

    controller.stop();
    expect(track.stop).toHaveBeenCalledOnce();
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(video.srcObject).toBeNull();
    expect(controller.getStatus()).toEqual({ state: "off" });
    expect(statuses).toContainEqual({ state: "starting" });
    expect(statuses).toContainEqual({ state: "ready" });
  });

  it("emits an actual point observation only after a verified landmark result", async () => {
    const { controller, worker, video } = harness();
    const observations: unknown[] = [];
    controller.subscribeObservations((observation) => observations.push(observation));
    const starting = controller.start(video);
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalled());
    worker.emit({ type: "ready" });
    await starting;

    worker.emit({
      type: "result",
      timestamp: 1_000,
      confidence: 0.96,
      landmarks: hand(),
    });

    expect(observations).toEqual([
      {
        mode: "point",
        pointer: { x: 0.7, y: 0.4 },
        confidence: 0.96,
        timestamp: 1_000,
      },
    ]);
  });

  it("labels denied permission as refused and leaves pointer fallback available", async () => {
    const { controller, getUserMedia, video } = harness();
    getUserMedia.mockRejectedValueOnce(
      new DOMException("Permission denied", "NotAllowedError"),
    );

    await expect(controller.start(video)).rejects.toThrow("Permission denied");
    expect(controller.getStatus()).toEqual({
      state: "refused",
      message: "Camera permission was not granted.",
    });
  });

  it("labels a missing browser capability as unavailable without requesting media", async () => {
    const { controller, getUserMedia, video } = harness();
    const unavailable = createHandTrackingController({
      getUserMedia: undefined,
      createWorker: undefined,
      createImageBitmap: undefined,
      requestAnimationFrame: undefined,
      cancelAnimationFrame: undefined,
      now: () => 1_000,
    });

    await expect(unavailable.start(video)).rejects.toThrow(
      "Local hand tracking is unavailable in this browser.",
    );
    expect(unavailable.getStatus()).toEqual({
      state: "unavailable",
      message: "Local hand tracking is unavailable in this browser.",
    });
    expect(getUserMedia).not.toHaveBeenCalled();
    controller.stop();
  });

  it("does not let a stale frame failure overwrite the explicit off state", async () => {
    const { controller, worker, createImageBitmap, frames, video } = harness();
    let rejectFrame!: (error: Error) => void;
    createImageBitmap.mockImplementationOnce(
      () =>
        new Promise<ImageBitmap>((_resolve, reject) => {
          rejectFrame = reject;
        }),
    );

    const starting = controller.start(video);
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalled());
    worker.emit({ type: "ready" });
    await starting;
    [...frames.values()][0]?.(1_000);
    await vi.waitFor(() => expect(createImageBitmap).toHaveBeenCalledOnce());

    controller.stop();
    rejectFrame(new Error("stale frame failure"));
    await Promise.resolve();
    await Promise.resolve();
    expect(controller.getStatus()).toEqual({ state: "off" });
  });

  it("ignores a stale worker error delivered after stop", async () => {
    const { controller, worker, video } = harness();
    const starting = controller.start(video);
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalled());
    worker.emit({ type: "ready" });
    await starting;

    controller.stop();
    worker.onerror?.({ message: "stale worker failure" } as ErrorEvent);

    expect(controller.getStatus()).toEqual({ state: "off" });
  });

  it("does not let a stopped pending camera start steal a restarted stream", async () => {
    const firstTrack = { stop: vi.fn() };
    const secondTrack = { stop: vi.fn() };
    let resolveFirst!: (stream: MediaStream) => void;
    const firstMedia = new Promise<MediaStream>((resolve) => {
      resolveFirst = resolve;
    });
    const getUserMedia = vi
      .fn()
      .mockImplementationOnce(() => firstMedia)
      .mockResolvedValueOnce({
        getTracks: () => [secondTrack],
      } as unknown as MediaStream);
    const restartedWorker = new FakeWorker();
    const createWorker = vi.fn(() => restartedWorker);
    const video = {
      srcObject: null,
      readyState: 4,
      play: vi.fn(async () => undefined),
    } as unknown as HTMLVideoElement;
    const controller = createHandTrackingController({
      getUserMedia,
      createWorker,
      createImageBitmap: vi.fn(async () => ({ close: vi.fn() }) as unknown as ImageBitmap),
      requestAnimationFrame: vi.fn(() => 1),
      cancelAnimationFrame: vi.fn(),
      now: () => 1_000,
    });

    const staleStart = controller.start(video);
    controller.stop();
    const restarted = controller.start(video);
    await vi.waitFor(() => expect(restartedWorker.postMessage).toHaveBeenCalled());
    resolveFirst({ getTracks: () => [firstTrack] } as unknown as MediaStream);
    await staleStart;
    expect(firstTrack.stop).toHaveBeenCalledOnce();
    expect(secondTrack.stop).not.toHaveBeenCalled();
    expect(video.srcObject).not.toBeNull();

    restartedWorker.emit({ type: "ready" });
    await restarted;
    expect(controller.getStatus()).toEqual({ state: "ready" });
    controller.stop();
    expect(secondTrack.stop).toHaveBeenCalledOnce();
  });

  it("does not create a worker when stop wins while video.play is pending", async () => {
    const { controller, createWorker, track, video } = harness();
    let resolvePlay!: () => void;
    vi.mocked(video.play).mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolvePlay = resolve;
        }),
    );

    const starting = controller.start(video);
    await vi.waitFor(() => expect(video.play).toHaveBeenCalledOnce());
    controller.stop();
    resolvePlay();
    const settled = await Promise.race([
      starting.then(() => true),
      new Promise<false>((resolve) => setTimeout(() => resolve(false), 25)),
    ]);

    expect(settled).toBe(true);
    expect(createWorker).not.toHaveBeenCalled();
    expect(track.stop).toHaveBeenCalledOnce();
    expect(video.srcObject).toBeNull();
    expect(controller.getStatus()).toEqual({ state: "off" });
  });

  it("fails closed and releases resources when worker readiness times out", async () => {
    const { getUserMedia, createWorker, createImageBitmap, video, track } = harness();
    let expire!: () => void;
    const controller = createHandTrackingController({
      getUserMedia,
      createWorker,
      createImageBitmap,
      requestAnimationFrame: vi.fn(() => 1),
      cancelAnimationFrame: vi.fn(),
      setTimeout: vi.fn((callback) => {
        expire = callback;
        return 99;
      }),
      clearTimeout: vi.fn(),
      workerReadyTimeoutMs: 5_000,
      now: () => 1_000,
    });

    const starting = controller.start(video);
    await vi.waitFor(() => expect(createWorker).toHaveBeenCalledOnce());
    expire();

    await expect(starting).rejects.toThrow(
      "Local hand tracking did not become ready in time.",
    );
    expect(track.stop).toHaveBeenCalledOnce();
    expect(controller.getStatus()).toEqual({
      state: "unavailable",
      message: "Local hand tracking did not become ready in time.",
    });
  });
});
