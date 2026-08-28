import { describe, expect, it, vi } from "vitest";

import {
  createHandTrackingController,
  type HandTrackingWorkerLike,
} from "@/lib/gesture/hand-tracking-controller";
import type { HandLandmarks } from "@/lib/gesture/hand-intent";
import { YOLO_HAND_POSE_MODEL_URL } from "@/lib/gesture/yolo-hand-pose-detector";

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
      wasmBaseUrl: "/onnxruntime/",
      modelAssetUrl: YOLO_HAND_POSE_MODEL_URL,
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
      hands: [],
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

  it("uses the in-page local detector endpoint when a worker canvas is unavailable", async () => {
    const browserWorker = new FakeWorker();
    const track = { stop: vi.fn() };
    const detector = {
      detectForVideo: vi.fn(() => ({ landmarks: [], handedness: [] })),
      close: vi.fn(),
    };
    const loadDetector = vi.fn(async () => detector);
    const video = {
      srcObject: null,
      readyState: 4,
      play: vi.fn(async () => undefined),
    } as unknown as HTMLVideoElement;
    const dependencies = {
      getUserMedia: vi.fn(async () => ({
        getTracks: () => [track],
      }) as unknown as MediaStream),
      createWorker: vi.fn(() => {
        queueMicrotask(() => browserWorker.emit({ type: "ready" }));
        return browserWorker;
      }),
      loadDetector,
      supportsWorkerCanvas: false,
      createImageBitmap: vi.fn(
        async () => ({ close: vi.fn() }) as unknown as ImageBitmap,
      ),
      requestAnimationFrame: vi.fn(() => 1),
      cancelAnimationFrame: vi.fn(),
      now: () => 1_000,
    };
    const controller = createHandTrackingController(dependencies);

    await controller.start(video);

    expect(loadDetector).toHaveBeenCalledWith({
      wasmBaseUrl: "/onnxruntime/",
      modelAssetUrl: YOLO_HAND_POSE_MODEL_URL,
      runningMode: "VIDEO",
      numHands: 2,
    });
    expect(browserWorker.postMessage).not.toHaveBeenCalled();
    expect(controller.getStatus()).toEqual({ state: "ready" });
    controller.stop();
    expect(track.stop).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(detector.close).toHaveBeenCalledOnce());
  });

  it("falls back from the mandatory YOLO primary worker to the labeled landmark engine", async () => {
    const primaryWorker = new FakeWorker();
    const fallbackWorker = new FakeWorker();
    const track = { stop: vi.fn() };
    const video = {
      srcObject: null,
      readyState: 4,
      play: vi.fn(async () => undefined),
    } as unknown as HTMLVideoElement;
    const createWorkerForEngine = vi.fn((engine: { id: string }) =>
      engine.id.startsWith("yolo26") ? primaryWorker : fallbackWorker,
    );
    const controller = createHandTrackingController({
      getUserMedia: vi.fn(async () => ({
        getTracks: () => [track],
      }) as unknown as MediaStream),
      createWorkerForEngine,
      createImageBitmap: vi.fn(
        async () => ({ close: vi.fn() }) as unknown as ImageBitmap,
      ),
      requestAnimationFrame: vi.fn(() => 1),
      cancelAnimationFrame: vi.fn(),
      now: () => 1_000,
    });
    const engines: unknown[] = [];
    controller.subscribeEngineStatus?.((engine) => engines.push(engine));

    const starting = controller.start(video);
    await vi.waitFor(() => expect(primaryWorker.postMessage).toHaveBeenCalled());
    primaryWorker.emit({ type: "error", message: "YOLO initialization failed" });
    await vi.waitFor(() => expect(fallbackWorker.postMessage).toHaveBeenCalledWith({
      type: "initialize",
      wasmBaseUrl: "/mediapipe/wasm",
      modelAssetUrl:
        "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
    }));
    fallbackWorker.emit({ type: "ready" });
    await starting;

    expect(controller.getEngineStatus?.()).toMatchObject({
      id: "mediapipe-hand-landmarker-v1",
      displayName: "MediaPipe Hand Landmarker",
      fallback: true,
    });
    expect(engines).toContainEqual(
      expect.objectContaining({ id: "yolo26-hand-pose-2abb91", fallback: false }),
    );
    expect(engines).toContainEqual(
      expect.objectContaining({ id: "mediapipe-hand-landmarker-v1", fallback: true }),
    );
    expect(track.stop).not.toHaveBeenCalled();
    controller.stop();
  });

  it("reports a post-ready YOLO inference failure before starting the labeled fallback", async () => {
    const primaryWorker = new FakeWorker();
    const fallbackWorker = new FakeWorker();
    const video = {
      srcObject: null,
      readyState: 4,
      play: vi.fn(async () => undefined),
    } as unknown as HTMLVideoElement;
    const controller = createHandTrackingController({
      getUserMedia: vi.fn(async () => ({
        getTracks: () => [{ stop: vi.fn() }],
      }) as unknown as MediaStream),
      createWorkerForEngine: vi.fn((engine: { id: string }) =>
        engine.id.startsWith("yolo26") ? primaryWorker : fallbackWorker,
      ),
      createImageBitmap: vi.fn(
        async () => ({ close: vi.fn() }) as unknown as ImageBitmap,
      ),
      requestAnimationFrame: vi.fn(() => 1),
      cancelAnimationFrame: vi.fn(),
      now: () => 1_000,
    });
    const engines: unknown[] = [];
    controller.subscribeEngineStatus?.((engine) => engines.push(engine));

    const starting = controller.start(video);
    await vi.waitFor(() => expect(primaryWorker.postMessage).toHaveBeenCalled());
    primaryWorker.emit({ type: "ready" });
    await starting;
    expect(controller.getEngineStatus?.()).toMatchObject({
      id: "yolo26-hand-pose-2abb91",
      fallback: false,
    });

    primaryWorker.emit({
      type: "error",
      message: "YOLO inference failed after startup",
    });
    await vi.waitFor(() =>
      expect(fallbackWorker.postMessage).toHaveBeenCalledWith({
        type: "initialize",
        wasmBaseUrl: "/mediapipe/wasm",
        modelAssetUrl:
          "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
      }),
    );
    expect(primaryWorker.terminate).toHaveBeenCalledOnce();
    expect(controller.getStatus()).toEqual({ state: "starting" });
    expect(controller.getEngineStatus?.()).toMatchObject({
      id: "mediapipe-hand-landmarker-v1",
      fallback: true,
    });

    fallbackWorker.emit({ type: "ready" });
    expect(controller.getStatus()).toEqual({ state: "ready" });
    expect(engines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "yolo26-hand-pose-2abb91",
          fallback: false,
        }),
        expect.objectContaining({
          id: "mediapipe-hand-landmarker-v1",
          fallback: true,
        }),
      ]),
    );
    controller.stop();
  });

  it("reuses an explicitly shared local camera stream without opening or stopping a second capture", async () => {
    const worker = new FakeWorker();
    const sharedTrack = { stop: vi.fn() };
    const sharedStream = {
      getTracks: () => [sharedTrack],
    } as unknown as MediaStream;
    const getUserMedia = vi.fn();
    const getSharedMediaStream = vi.fn(async () => sharedStream);
    const video = {
      srcObject: null,
      readyState: 4,
      play: vi.fn(async () => undefined),
    } as unknown as HTMLVideoElement;
    const controller = createHandTrackingController({
      getUserMedia,
      getSharedMediaStream,
      createWorker: () => worker,
      createImageBitmap: vi.fn(async () => ({ close: vi.fn() }) as unknown as ImageBitmap),
      requestAnimationFrame: vi.fn(() => 1),
      cancelAnimationFrame: vi.fn(),
      now: () => 1_000,
    });

    const starting = controller.start(video);
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalled());
    worker.emit({ type: "ready" });
    await starting;

    expect(getSharedMediaStream).toHaveBeenCalledOnce();
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(video.srcObject).toBe(sharedStream);
    controller.stop();
    expect(sharedTrack.stop).not.toHaveBeenCalled();
    expect(video.srcObject).toBeNull();
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
      hands: [
        {
          handedness: "left",
          confidence: 0.96,
          landmarks: hand(),
        },
      ],
    });

    expect(observations).toEqual([
      expect.objectContaining({
        mode: "point",
        pointer: { x: 0.7, y: 0.4 },
        confidence: 0.96,
        handedness: "left",
        landmarks: expect.any(Array),
        pinchDistance: 0.2,
        trackingState: "tracked",
        timestamp: 1_000,
      }),
    ]);
  });

  it("emits a semantic bimanual pinch with two tagged pointers and span", async () => {
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
      hands: [
        {
          handedness: "left",
          confidence: 0.96,
          landmarks: hand({ x: 0.3, y: 0.4 }, { x: 0.32, y: 0.4 }),
        },
        {
          handedness: "right",
          confidence: 0.94,
          landmarks: hand({ x: 0.7, y: 0.4 }, { x: 0.72, y: 0.4 }),
        },
      ],
    });

    expect(observations).toEqual([
      expect.objectContaining({
        mode: "bimanual_pinch",
        hands: [
          expect.objectContaining({
            handedness: "left",
            pointer: { x: 0.7, y: 0.4 },
            confidence: 0.96,
            landmarks: expect.any(Array),
            pinchDistance: 0.02,
          }),
          expect.objectContaining({
            handedness: "right",
            pointer: { x: 0.3, y: 0.4 },
            confidence: 0.94,
            landmarks: expect.any(Array),
            pinchDistance: 0.02,
          }),
        ],
        center: { x: 0.5, y: 0.4 },
        span: 0.4,
        timestamp: 1_000,
      }),
    ]);
  });

  it("bridges one brief missing frame while pinched, then reports lost tracking", async () => {
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
      hands: [
        {
          handedness: "left",
          confidence: 0.96,
          landmarks: hand({ x: 0.3, y: 0.4 }, { x: 0.33, y: 0.4 }),
        },
      ],
    });
    worker.emit({ type: "result", timestamp: 1_080, hands: [] });
    worker.emit({ type: "result", timestamp: 1_260, hands: [] });

    expect(observations).toEqual([
      expect.objectContaining({ mode: "pinch", trackingState: "tracked" }),
      expect.objectContaining({ mode: "pinch", trackingState: "grace" }),
      { mode: "idle", timestamp: 1_260, trackingState: "lost" },
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
    await vi.waitFor(() => expect(firstTrack.stop).toHaveBeenCalledOnce());
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
      "YOLO26 Hand Pose did not become ready in time.",
    );
    expect(track.stop).toHaveBeenCalledOnce();
    expect(controller.getStatus()).toEqual({
      state: "unavailable",
      message: "YOLO26 Hand Pose did not become ready in time.",
    });
  });
});
