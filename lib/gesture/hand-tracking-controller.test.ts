import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createHandTrackingController,
  type HandTrackingObservation,
  type HandTrackingWorkerLike,
} from "@/lib/gesture/hand-tracking-controller";
import {
  createInitialHandReliabilityState,
  reduceHandReliability,
} from "@/lib/gesture/hand-calibration";
import type { HandLandmarks } from "@/lib/gesture/hand-intent";
import {
  MEDIA_PIPE_HAND_LANDMARKER_MODEL_URL,
  MEDIA_PIPE_IN_PAGE_RECOVERY_ENGINE_ID,
  MEDIA_PIPE_SPATIAL_VISION_ENGINE_ID,
} from "@/lib/gesture/spatial-vision-engine";

function hand(index = { x: 0.3, y: 0.4 }, thumb = { x: 0.1, y: 0.4 }) {
  const points = Array.from({ length: 21 }, () => ({ x: 0.3, y: 0.78, z: 0 }));
  points[0] = { x: 0.3, y: 0.82, z: 0 };
  points[5] = { x: 0.2, y: 0.62, z: 0 };
  points[6] = { x: 0.25, y: 0.54, z: 0 };
  points[9] = { x: 0.3, y: 0.6, z: 0 };
  points[10] = { x: 0.31, y: 0.69, z: 0 };
  points[12] = { x: 0.31, y: 0.76, z: 0 };
  points[13] = { x: 0.38, y: 0.62, z: 0 };
  points[14] = { x: 0.36, y: 0.7, z: 0 };
  points[16] = { x: 0.34, y: 0.77, z: 0 };
  points[17] = { x: 0.42, y: 0.65, z: 0 };
  points[18] = { x: 0.4, y: 0.72, z: 0 };
  points[20] = { x: 0.37, y: 0.79, z: 0 };
  points[4] = { ...thumb, z: 0 };
  points[8] = { ...index, z: 0 };
  return points as unknown as HandLandmarks;
}

function shiftedHand(offsetX: number, thumbX: number) {
  return hand({ x: 0.3, y: 0.4 }, { x: thumbX, y: 0.4 }).map((point) => ({
    ...point,
    x: point.x + offsetX,
  })) as unknown as HandLandmarks;
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

class FakeVideoTrack extends EventTarget {
  readonly kind = "video";
  readyState: MediaStreamTrackState = "live";
  stop = vi.fn(() => {
    this.readyState = "ended";
  });

  end(dispatchEvent = true) {
    this.readyState = "ended";
    if (dispatchEvent) this.dispatchEvent(new Event("ended"));
  }
}

function harness(now: () => number = () => 1_000) {
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
    now,
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

beforeEach(() => {
  sessionStorage.clear();
});

describe("hand tracking controller lifecycle", () => {
  it("does not request camera permission or create a worker before explicit start", () => {
    const { controller, getUserMedia, createWorker } = harness();

    expect(controller.getStatus()).toEqual({ state: "off" });
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(createWorker).not.toHaveBeenCalled();
  });

  it("starts local first-plus-newest inference and releases every resource", async () => {
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
      modelAssetUrl: MEDIA_PIPE_HAND_LANDMARKER_MODEL_URL,
    });

    worker.emit({
      type: "ready",
      diagnostics: {
        executionProvider: "webgpu",
        highPerformanceGpuRequested: true,
        adapter: { architecture: "ampere", description: "NVIDIA GPU" },
      },
    });
    await starting;
    expect(controller.getStatus()).toEqual({ state: "ready" });
    expect(controller.getEngineStatus?.()).toMatchObject({
      executionProvider: "webgpu",
      highPerformanceGpuRequested: true,
      adapter: { architecture: "ampere", description: "NVIDIA GPU" },
    });

    const firstFrame = [...frames.values()][0];
    firstFrame?.(1_000);
    await vi.waitFor(() => expect(createImageBitmap).toHaveBeenCalledTimes(1));
    expect(worker.postMessage).toHaveBeenLastCalledWith(
      { type: "frame", frame: expect.any(Object), timestamp: 1_000 },
      [expect.any(Object)],
    );

    const secondTick = [...frames.values()].at(-1);
    secondTick?.(1_016);
    await vi.waitFor(() => expect(createImageBitmap).toHaveBeenCalledTimes(2));

    worker.emit({
      type: "result",
      timestamp: 1_000,
      hands: [],
    });
    const thirdTick = [...frames.values()].at(-1);
    thirdTick?.(1_032);
    await vi.waitFor(() => expect(createImageBitmap).toHaveBeenCalledTimes(3));

    controller.stop();
    expect(track.stop).toHaveBeenCalledOnce();
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(video.srcObject).toBeNull();
    expect(controller.getStatus()).toEqual({ state: "off" });
    expect(statuses).toContainEqual({ state: "starting" });
    expect(statuses).toContainEqual({ state: "ready" });
  });

  it("reports measured detector round-trip and result cadence instead of guessing performance", async () => {
    let now = 1_000;
    const { controller, worker, video } = harness(() => now);
    const starting = controller.start(video);
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalled());
    worker.emit({ type: "ready" });
    await starting;

    now = 1_080;
    worker.emit({ type: "result", timestamp: 1_000, hands: [] });
    expect(controller.getEngineStatus?.()).toMatchObject({
      detectorRoundTripMs: 80,
      runtimeSamples: 1,
    });

    now = 1_160;
    worker.emit({ type: "result", timestamp: 1_080, hands: [] });
    expect(controller.getEngineStatus?.()).toMatchObject({
      detectorRoundTripMs: 80,
      resultRateFps: 12.5,
      runtimeSamples: 2,
    });
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
      wasmBaseUrl: "/mediapipe/wasm",
      modelAssetUrl: MEDIA_PIPE_HAND_LANDMARKER_MODEL_URL,
      runningMode: "VIDEO",
      numHands: 2,
    });
    expect(browserWorker.postMessage).not.toHaveBeenCalled();
    expect(controller.getStatus()).toEqual({ state: "ready" });
    controller.stop();
    expect(track.stop).toHaveBeenCalledOnce();
    await vi.waitFor(() => expect(detector.close).toHaveBeenCalledOnce());
  });

  it("falls back from the MediaPipe worker to the labeled in-page recovery engine", async () => {
    const primaryWorker = new FakeWorker();
    const fallbackWorker = new FakeWorker();
    const track = { stop: vi.fn() };
    const video = {
      srcObject: null,
      readyState: 4,
      play: vi.fn(async () => undefined),
    } as unknown as HTMLVideoElement;
    const createWorkerForEngine = vi.fn((engine: { id: string }) =>
      engine.id === MEDIA_PIPE_SPATIAL_VISION_ENGINE_ID
        ? primaryWorker
        : fallbackWorker,
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
    primaryWorker.emit({
      type: "error",
      message: "MediaPipe worker initialization failed",
    });
    await vi.waitFor(() => expect(fallbackWorker.postMessage).toHaveBeenCalledWith({
      type: "initialize",
      wasmBaseUrl: "/mediapipe/wasm",
      modelAssetUrl:
        "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
    }));
    fallbackWorker.emit({ type: "ready" });
    await starting;

    expect(controller.getEngineStatus?.()).toMatchObject({
      id: MEDIA_PIPE_IN_PAGE_RECOVERY_ENGINE_ID,
      displayName: "MediaPipe Hand Landmarker (in-page recovery)",
      fallback: true,
    });
    expect(engines).toContainEqual(
      expect.objectContaining({
        id: MEDIA_PIPE_SPATIAL_VISION_ENGINE_ID,
        fallback: false,
      }),
    );
    expect(engines).toContainEqual(
      expect.objectContaining({
        id: MEDIA_PIPE_IN_PAGE_RECOVERY_ENGINE_ID,
        fallback: true,
      }),
    );
    expect(track.stop).not.toHaveBeenCalled();
    controller.stop();
  });

  it("attempts the private CUDA relay first only with current upload consent, then falls back to local MediaPipe", async () => {
    let consent = false;
    const relayWorker = Object.assign(new FakeWorker(), {
      frameQueueMode: "newest-only" as const,
    });
    const mediaPipeWorker = new FakeWorker();
    const recoveryWorker = new FakeWorker();
    const createPrivateRelayWorker = vi.fn(() => relayWorker);
    const createWorkerForEngine = vi.fn((engine: { id: string }) =>
      engine.id === MEDIA_PIPE_SPATIAL_VISION_ENGINE_ID
        ? mediaPipeWorker
        : recoveryWorker,
    );
    const video = {
      srcObject: null,
      readyState: 4,
      play: vi.fn(async () => undefined),
    } as unknown as HTMLVideoElement;
    const controller = createHandTrackingController({
      getUserMedia: vi.fn(async () => ({
        getTracks: () => [{ stop: vi.fn() }],
      }) as unknown as MediaStream),
      privateHandRelay: {
        roomId: "11111111-1111-4111-8111-111111111111",
        getAccessToken: async () => "access-token",
        cameraUploadConsent: () => consent,
        createWorker: createPrivateRelayWorker,
      },
      createWorkerForEngine,
      createImageBitmap: vi.fn(
        async () => ({ close: vi.fn() }) as unknown as ImageBitmap,
      ),
      requestAnimationFrame: vi.fn(() => 1),
      cancelAnimationFrame: vi.fn(),
      now: () => 1_000,
    });

    const localStart = controller.start(video);
    await vi.waitFor(() => expect(mediaPipeWorker.postMessage).toHaveBeenCalled());
    expect(createPrivateRelayWorker).not.toHaveBeenCalled();
    mediaPipeWorker.emit({ type: "ready" });
    await localStart;
    controller.stop();

    consent = true;
    const relayStart = controller.start(video);
    await vi.waitFor(() => expect(createPrivateRelayWorker).toHaveBeenCalledOnce());
    expect(relayWorker.postMessage).toHaveBeenCalledWith({
      type: "initialize",
      wasmBaseUrl: "private-relay",
      modelAssetUrl: "private-relay",
    });
    relayWorker.emit({
      type: "error",
      message: "Private GPU relay timed out; switching to local hand tracking.",
    });
    await vi.waitFor(() =>
      expect(mediaPipeWorker.postMessage).toHaveBeenCalledTimes(3),
    );
    mediaPipeWorker.emit({ type: "ready" });
    await relayStart;

    expect(controller.getEngineStatus?.()).toMatchObject({
      id: MEDIA_PIPE_SPATIAL_VISION_ENGINE_ID,
      fallback: true,
      fallbackKind: "private-relay",
      fallbackReason: "Private GPU relay timed out; switching to local hand tracking.",
    });
  });

  it("allows the relay endpoint to retain one in-flight plus newest-only frames and reports relay processing latency", async () => {
    const relayWorker = Object.assign(new FakeWorker(), {
      frameQueueMode: "newest-only" as const,
    });
    const frames = new Map<number, FrameRequestCallback>();
    let nextFrame = 0;
    let now = 1_000;
    const createImageBitmap = vi.fn(
      async () => ({ close: vi.fn() }) as unknown as ImageBitmap,
    );
    const video = {
      srcObject: null,
      readyState: 4,
      play: vi.fn(async () => undefined),
    } as unknown as HTMLVideoElement;
    const controller = createHandTrackingController({
      getUserMedia: vi.fn(async () => ({
        getTracks: () => [{ stop: vi.fn() }],
      }) as unknown as MediaStream),
      privateHandRelay: {
        roomId: "11111111-1111-4111-8111-111111111111",
        getAccessToken: async () => "access-token",
        cameraUploadConsent: () => true,
        createWorker: () => relayWorker,
      },
      createImageBitmap,
      requestAnimationFrame: vi.fn((callback) => {
        frames.set(++nextFrame, callback);
        return nextFrame;
      }),
      cancelAnimationFrame: vi.fn((id) => frames.delete(id)),
      now: () => now,
    });

    const starting = controller.start(video);
    await vi.waitFor(() => expect(relayWorker.postMessage).toHaveBeenCalled());
    relayWorker.emit({
      type: "ready",
      diagnostics: {
        executionProvider: "cuda",
        processingLocation: "private-relay",
        highPerformanceGpuRequested: false,
        adapter: { description: "NVIDIA GeForce RTX 3090 Ti" },
      },
    });
    await starting;

    [...frames.values()].at(-1)?.(1_000);
    await vi.waitFor(() => expect(createImageBitmap).toHaveBeenCalledTimes(1));
    [...frames.values()].at(-1)?.(1_016);
    await vi.waitFor(() => expect(createImageBitmap).toHaveBeenCalledTimes(2));

    now = 1_090;
    relayWorker.emit({
      type: "result",
      timestamp: 1_000,
      hands: [],
      processingLatencyMs: 24,
      relayMetrics: {
        encodeLatencyMs: 8,
        relayRoundTripMs: 51,
        droppedBeforeEncode: 2,
        droppedBeforeSend: 0,
      },
    });
    expect(controller.getEngineStatus?.()).toMatchObject({
      executionProvider: "cuda",
      processingLocation: "private-relay",
      adapter: { description: "NVIDIA GeForce RTX 3090 Ti" },
      processingLatencyMs: 24,
      detectorRoundTripMs: 90,
      encodeLatencyMs: 8,
      relayRoundTripMs: 51,
      droppedBeforeEncode: 2,
      droppedBeforeSend: 0,
    });
  });

  it("reports a post-ready MediaPipe worker failure before starting the labeled in-page recovery", async () => {
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
        engine.id === MEDIA_PIPE_SPATIAL_VISION_ENGINE_ID
          ? primaryWorker
          : fallbackWorker,
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
      id: MEDIA_PIPE_SPATIAL_VISION_ENGINE_ID,
      fallback: false,
    });

    primaryWorker.emit({
      type: "error",
      message: "MediaPipe worker inference failed after startup",
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
      id: MEDIA_PIPE_IN_PAGE_RECOVERY_ENGINE_ID,
      fallback: true,
    });

    fallbackWorker.emit({ type: "ready" });
    expect(controller.getStatus()).toEqual({ state: "ready" });
    expect(engines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: MEDIA_PIPE_SPATIAL_VISION_ENGINE_ID,
          fallback: false,
        }),
        expect.objectContaining({
          id: MEDIA_PIPE_IN_PAGE_RECOVERY_ENGINE_ID,
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

  it("releases gesture state and becomes visibly recoverable when a shared camera track ends", async () => {
    const worker = new FakeWorker();
    const sharedTrack = new FakeVideoTrack();
    const sharedStream = {
      getTracks: () => [sharedTrack as unknown as MediaStreamTrack],
      getVideoTracks: () => [sharedTrack as unknown as MediaStreamTrack],
    } as unknown as MediaStream;
    const getUserMedia = vi.fn();
    const frames = new Map<number, FrameRequestCallback>();
    let frameId = 0;
    const cancelAnimationFrame = vi.fn((id: number) => frames.delete(id));
    const video = {
      srcObject: null,
      readyState: 4,
      play: vi.fn(async () => undefined),
    } as unknown as HTMLVideoElement;
    const controller = createHandTrackingController({
      getSharedMediaStream: () => sharedStream,
      getUserMedia,
      createWorker: () => worker,
      createImageBitmap: vi.fn(
        async () => ({ close: vi.fn() }) as unknown as ImageBitmap,
      ),
      requestAnimationFrame: vi.fn((callback) => {
        frames.set(++frameId, callback);
        return frameId;
      }),
      cancelAnimationFrame,
      now: () => 1_100,
    });
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
    expect(observations.at(-1)).toMatchObject({ mode: "pinch" });

    sharedTrack.end();

    expect(observations.at(-1)).toEqual({
      mode: "idle",
      timestamp: 1_100,
      trackingState: "lost",
    });
    expect(controller.getStatus()).toEqual({
      state: "unavailable",
      message:
        "The shared camera stopped. Enable hand input again to reconnect.",
    });
    expect(cancelAnimationFrame).toHaveBeenCalled();
    expect(frames.size).toBe(0);
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(sharedTrack.stop).not.toHaveBeenCalled();
    expect(video.srcObject).toBeNull();
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it("detects a locally stopped shared track from readyState even without an ended event", async () => {
    const worker = new FakeWorker();
    const sharedTrack = new FakeVideoTrack();
    const sharedStream = {
      getTracks: () => [sharedTrack as unknown as MediaStreamTrack],
      getVideoTracks: () => [sharedTrack as unknown as MediaStreamTrack],
    } as unknown as MediaStream;
    const frames = new Map<number, FrameRequestCallback>();
    let frameId = 0;
    const video = {
      srcObject: null,
      readyState: 4,
      play: vi.fn(async () => undefined),
    } as unknown as HTMLVideoElement;
    const controller = createHandTrackingController({
      getSharedMediaStream: () => sharedStream,
      getUserMedia: vi.fn(),
      createWorker: () => worker,
      createImageBitmap: vi.fn(
        async () => ({ close: vi.fn() }) as unknown as ImageBitmap,
      ),
      requestAnimationFrame: vi.fn((callback) => {
        frames.set(++frameId, callback);
        return frameId;
      }),
      cancelAnimationFrame: vi.fn((id: number) => frames.delete(id)),
      now: () => 1_200,
    });

    const starting = controller.start(video);
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalled());
    worker.emit({ type: "ready" });
    await starting;
    sharedTrack.end(false);
    [...frames.values()][0]?.(1_200);

    expect(controller.getStatus()).toEqual({
      state: "unavailable",
      message:
        "The shared camera stopped. Enable hand input again to reconnect.",
    });
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(sharedTrack.stop).not.toHaveBeenCalled();
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
        measurements: expect.objectContaining({
          indexTip: { x: 0.7, y: 0.4 },
          thumbTip: { x: 0.9, y: 0.4 },
          confidence: 0.96,
        }),
        source: MEDIA_PIPE_SPATIAL_VISION_ENGINE_ID,
        capturedAt: 1_000,
        receivedAt: 1_000,
        trackId: expect.stringMatching(/^hand-track-/),
        prediction: { predicted: false },
        trackingState: "tracked",
        timestamp: 1_000,
      }),
    ]);
  });

  it("accepts a valid 0.60-confidence MediaPipe hand instead of hard-dropping it", async () => {
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
          handedness: "unknown",
          confidence: 0.6,
          landmarks: hand(),
        },
      ],
    });

    expect(observations).toEqual([
      expect.objectContaining({
        mode: "point",
        confidence: 0.6,
        trackingState: "tracked",
      }),
    ]);
  });

  it("keeps pinch hysteresis with the nearest unknown hand when confidence order swaps", async () => {
    let now = 1_000;
    const { controller, worker, video } = harness(() => now);
    const observations: unknown[] = [];
    controller.subscribeObservations((observation) => observations.push(observation));
    const starting = controller.start(video);
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalled());
    worker.emit({ type: "ready" });
    await starting;

    worker.emit({
      type: "result",
      timestamp: now,
      hands: [
        {
          handedness: "unknown",
          confidence: 0.92,
          landmarks: shiftedHand(0, 0.33),
        },
        {
          handedness: "unknown",
          confidence: 0.8,
          landmarks: shiftedHand(0.4, 0.1),
        },
      ],
    });
    now = 1_016;
    worker.emit({
      type: "result",
      timestamp: now,
      hands: [
        {
          handedness: "unknown",
          confidence: 0.97,
          landmarks: shiftedHand(0.4, 0.1),
        },
        {
          handedness: "unknown",
          confidence: 0.85,
          landmarks: shiftedHand(0, 0.37),
        },
      ],
    });

    expect(observations).toHaveLength(2);
    expect(observations[0]).toMatchObject({ mode: "pinch" });
    expect(observations[1]).toMatchObject({
      mode: "pinch",
      pointer: { x: expect.closeTo(0.7, 2), y: expect.any(Number) },
    });

    now = 1_400;
    worker.emit({
      type: "result",
      timestamp: now,
      hands: [
        {
          handedness: "unknown",
          confidence: 0.9,
          landmarks: shiftedHand(0, 0.37),
        },
      ],
    });
    expect(observations[2]).toMatchObject({
      mode: "point",
      trackingState: "tracked",
    });
  });

  it("produces one spatially continuous track for a rapid label flip and reordered second-hand entrance", async () => {
    let now = 1_000;
    const { controller, worker, video } = harness(() => now);
    const observations: HandTrackingObservation[] = [];
    controller.subscribeObservations((observation) => observations.push(observation));
    const starting = controller.start(video);
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalled());
    worker.emit({ type: "ready" });
    await starting;

    worker.emit({
      type: "result",
      timestamp: now,
      hands: [
        {
          handedness: "left",
          confidence: 0.92,
          landmarks: shiftedHand(-0.15, 0.33),
        },
      ],
    });
    now = 1_016;
    worker.emit({
      type: "result",
      timestamp: now,
      hands: [
        {
          handedness: "left",
          confidence: 0.92,
          landmarks: shiftedHand(0.05, 0.33),
        },
      ],
    });
    now = 1_032;
    worker.emit({
      type: "result",
      timestamp: now,
      hands: [
        {
          handedness: "left",
          confidence: 0.96,
          landmarks: shiftedHand(-0.18, 0.5),
        },
        {
          handedness: "right",
          confidence: 0.92,
          landmarks: shiftedHand(0.35, 0.33),
        },
      ],
    });

    const primaryFrames = observations.filter(
      (observation): observation is Extract<
        HandTrackingObservation,
        { mode: "point" | "pinch" | "open_palm" }
      > => observation.mode !== "idle" && observation.mode !== "bimanual_pinch",
    );
    expect(primaryFrames).toHaveLength(3);
    const [first, second, third] = primaryFrames;
    expect(first?.trackId).toBeTruthy();
    expect([first?.trackId, second?.trackId, third?.trackId]).toEqual([
      first?.trackId,
      first?.trackId,
      first?.trackId,
    ]);
    expect(first?.trackId).not.toBe("left");
    expect(first?.trackId).not.toBe("right");
    expect(third?.handedness).toBe("right");

    let reliability = createInitialHandReliabilityState();
    for (const observation of primaryFrames) {
      const measurements = observation.measurements;
      if (!observation.trackId || !measurements)
        throw new Error("The controller must produce Task 1 measurement provenance.");
      reliability = reduceHandReliability(
        reliability,
        {
          timestamp: observation.timestamp,
          hands: [
            {
              trackId: observation.trackId,
              handedness: observation.handedness ?? "unknown",
              pointer: observation.pointer,
              confidence: observation.confidence,
              indexTipConfidence: measurements.indexTipConfidence,
              thumbTipConfidence: measurements.thumbTipConfidence,
              predicted: observation.prediction?.predicted ?? true,
              pinchRatio: observation.pinchRatio ?? Number.NaN,
            },
          ],
        },
        { engage: 0.38, release: 0.52 },
      ).state;
    }
    expect(reliability.activeHandId).toBe(first?.trackId);
    expect(reliability.lastValid).toMatchObject({
      trackId: first?.trackId,
      timestamp: 1_032,
    });
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
            trackId: expect.stringMatching(/^hand-track-/),
            prediction: { predicted: false },
            measurements: expect.objectContaining({
              indexTipConfidence: 1,
              thumbTipConfidence: 1,
            }),
            trackingState: "tracked",
          }),
          expect.objectContaining({
            handedness: "right",
            pointer: { x: 0.3, y: 0.4 },
            confidence: 0.94,
            landmarks: expect.any(Array),
            pinchDistance: 0.02,
            trackId: expect.stringMatching(/^hand-track-/),
            prediction: { predicted: false },
            measurements: expect.objectContaining({
              indexTipConfidence: 1,
              thumbTipConfidence: 1,
            }),
            trackingState: "tracked",
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

  it("bridges a brief confidence dip and releases pinch on recovered open geometry", async () => {
    let now = 1_000;
    const { controller, worker, video } = harness(() => now);
    const observations: unknown[] = [];
    controller.subscribeObservations((observation) => observations.push(observation));
    const starting = controller.start(video);
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalled());
    worker.emit({ type: "ready" });
    await starting;

    worker.emit({
      type: "result",
      timestamp: now,
      hands: [
        {
          handedness: "unknown",
          confidence: 0.6,
          landmarks: hand({ x: 0.3, y: 0.4 }, { x: 0.33, y: 0.4 }),
        },
      ],
    });
    now = 1_080;
    worker.emit({
      type: "result",
      timestamp: now,
      hands: [
        {
          handedness: "unknown",
          confidence: 0.4,
          landmarks: hand({ x: 0.3, y: 0.4 }, { x: 0.33, y: 0.4 }),
        },
      ],
    });
    now = 1_120;
    worker.emit({
      type: "result",
      timestamp: now,
      hands: [
        {
          handedness: "unknown",
          confidence: 0.6,
          landmarks: hand(),
        },
      ],
    });

    expect(observations).toEqual([
      expect.objectContaining({ mode: "pinch", trackingState: "tracked" }),
      expect.objectContaining({ mode: "pinch", trackingState: "grace" }),
      expect.objectContaining({ mode: "point", trackingState: "tracked" }),
    ]);
  });

  it("bridges one brief pointing dropout so a finger stroke is not fragmented", async () => {
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
    worker.emit({ type: "result", timestamp: 1_080, hands: [] });
    worker.emit({ type: "result", timestamp: 1_200, hands: [] });
    worker.emit({ type: "result", timestamp: 1_240, hands: [] });

    expect(observations).toEqual([
      expect.objectContaining({ mode: "point", trackingState: "tracked" }),
      expect.objectContaining({ mode: "point", trackingState: "grace" }),
      expect.objectContaining({ mode: "point", trackingState: "grace" }),
      { mode: "idle", timestamp: 1_240, trackingState: "lost" },
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
      "MediaPipe Hand Landmarker did not become ready in time.",
    );
    expect(track.stop).toHaveBeenCalledOnce();
    expect(controller.getStatus()).toEqual({
      state: "unavailable",
      message: "MediaPipe Hand Landmarker did not become ready in time.",
    });
  });

  it("prefers video-frame callbacks and cancels the exact scheduled callback on stop", async () => {
    const worker = new FakeWorker();
    const callbacks = new Map<number, VideoFrameRequestCallback>();
    let callbackId = 0;
    const requestVideoFrameCallback = vi.fn(
      (_video: HTMLVideoElement, callback: VideoFrameRequestCallback) => {
        callbacks.set(++callbackId, callback);
        return callbackId;
      },
    );
    const cancelVideoFrameCallback = vi.fn(
      (_video: HTMLVideoElement, id: number) => callbacks.delete(id),
    );
    const requestAnimationFrame = vi.fn(() => 99);
    const video = {
      srcObject: null,
      readyState: 4,
      currentTime: 0,
      play: vi.fn(async () => undefined),
    } as unknown as HTMLVideoElement;
    const controller = createHandTrackingController({
      getUserMedia: vi.fn(async () => ({
        getTracks: () => [{ stop: vi.fn() }],
      }) as unknown as MediaStream),
      createWorker: () => worker,
      createImageBitmap: vi.fn(async () => ({ close: vi.fn() }) as unknown as ImageBitmap),
      requestVideoFrameCallback,
      cancelVideoFrameCallback,
      requestAnimationFrame,
      cancelAnimationFrame: vi.fn(),
      now: () => 1_000,
    });

    const starting = controller.start(video);
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalled());
    worker.emit({ type: "ready" });
    await starting;

    expect(requestVideoFrameCallback).toHaveBeenCalledOnce();
    expect(requestAnimationFrame).not.toHaveBeenCalled();
    const scheduledId = [...callbacks.keys()][0]!;
    controller.stop();
    expect(cancelVideoFrameCallback).toHaveBeenCalledWith(video, scheduledId);
    expect(callbacks.size).toBe(0);
  });

  it("deduplicates requestAnimationFrame ticks that expose the same video currentTime", async () => {
    const { controller, worker, video, frames, createImageBitmap } = harness();
    Object.defineProperty(video, "currentTime", {
      configurable: true,
      writable: true,
      value: 1,
    });
    const starting = controller.start(video);
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalled());
    worker.emit({ type: "ready" });
    await starting;

    [...frames.values()].at(-1)?.(1_000);
    await vi.waitFor(() => expect(createImageBitmap).toHaveBeenCalledOnce());
    worker.emit({ type: "result", timestamp: 1_000, hands: [] });
    [...frames.values()].at(-1)?.(1_016);
    await Promise.resolve();
    expect(createImageBitmap).toHaveBeenCalledOnce();

    video.currentTime = 1.033;
    [...frames.values()].at(-1)?.(1_032);
    await vi.waitFor(() => expect(createImageBitmap).toHaveBeenCalledTimes(2));
  });

  it("keeps first inference plus only the newest pending bitmap and closes the superseded bitmap", async () => {
    const { controller, worker, video, frames, bitmaps, createImageBitmap } = harness();
    Object.defineProperty(video, "currentTime", {
      configurable: true,
      writable: true,
      value: 1,
    });
    const starting = controller.start(video);
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalled());
    worker.emit({ type: "ready" });
    await starting;

    [...frames.values()].at(-1)?.(1_000);
    await vi.waitFor(() => expect(createImageBitmap).toHaveBeenCalledOnce());
    video.currentTime = 1.016;
    [...frames.values()].at(-1)?.(1_016);
    await vi.waitFor(() => expect(createImageBitmap).toHaveBeenCalledTimes(2));
    video.currentTime = 1.032;
    [...frames.values()].at(-1)?.(1_032);
    await vi.waitFor(() => expect(createImageBitmap).toHaveBeenCalledTimes(3));

    expect(bitmaps[1]?.close).toHaveBeenCalledOnce();
    expect(bitmaps[2]?.close).not.toHaveBeenCalled();
    expect(
      worker.postMessage.mock.calls.filter(([message]) => message.type === "frame"),
    ).toHaveLength(1);

    worker.emit({ type: "result", timestamp: 1_000, hands: [] });
    expect(
      worker.postMessage.mock.calls.filter(([message]) => message.type === "frame"),
    ).toHaveLength(2);
    expect(worker.postMessage).toHaveBeenLastCalledWith(
      { type: "frame", frame: bitmaps[2], timestamp: 1_000 },
      [bitmaps[2]],
    );
    expect(controller.getEngineStatus?.()?.runtimeMetrics).toMatchObject({
      droppedSuperseded: 1,
    });
  });

  it("closes a capture completed after an engine epoch change instead of sending it to the fallback", async () => {
    const primaryWorker = new FakeWorker();
    const fallbackWorker = new FakeWorker();
    let resolveBitmap!: (bitmap: ImageBitmap) => void;
    const bitmap = { close: vi.fn() } as unknown as ImageBitmap;
    const frames = new Map<number, FrameRequestCallback>();
    let frameId = 0;
    const video = {
      srcObject: null,
      readyState: 4,
      currentTime: 1,
      play: vi.fn(async () => undefined),
    } as unknown as HTMLVideoElement;
    const controller = createHandTrackingController({
      getUserMedia: vi.fn(async () => ({
        getTracks: () => [{ stop: vi.fn() }],
      }) as unknown as MediaStream),
      createWorkerForEngine: vi.fn((engine: { id: string }) =>
        engine.id === MEDIA_PIPE_SPATIAL_VISION_ENGINE_ID
          ? primaryWorker
          : fallbackWorker,
      ),
      createImageBitmap: vi.fn(
        () => new Promise<ImageBitmap>((resolve) => { resolveBitmap = resolve; }),
      ),
      requestAnimationFrame: vi.fn((callback) => {
        frames.set(++frameId, callback);
        return frameId;
      }),
      cancelAnimationFrame: vi.fn((id) => frames.delete(id)),
      now: () => 1_000,
    });

    const starting = controller.start(video);
    await vi.waitFor(() => expect(primaryWorker.postMessage).toHaveBeenCalled());
    primaryWorker.emit({ type: "ready" });
    await starting;
    [...frames.values()].at(-1)?.(1_000);
    primaryWorker.emit({ type: "error", message: "primary stopped" });
    await vi.waitFor(() => expect(fallbackWorker.postMessage).toHaveBeenCalled());
    resolveBitmap(bitmap);
    await Promise.resolve();
    await Promise.resolve();

    expect(bitmap.close).toHaveBeenCalledOnce();
    expect(
      fallbackWorker.postMessage.mock.calls.some(([message]) => message.type === "frame"),
    ).toBe(false);
    fallbackWorker.emit({ type: "ready" });
    expect(controller.getEngineStatus?.()?.runtimeMetrics).toMatchObject({
      droppedLateCapture: 1,
    });
  });

  it("ignores an old-engine capture rejection after fallback without tearing down the healthy engine", async () => {
    const primaryWorker = new FakeWorker();
    const fallbackWorker = new FakeWorker();
    let rejectBitmap!: (error: Error) => void;
    const frames = new Map<number, FrameRequestCallback>();
    let frameId = 0;
    const video = {
      srcObject: null,
      readyState: 4,
      currentTime: 1,
      play: vi.fn(async () => undefined),
    } as unknown as HTMLVideoElement;
    const controller = createHandTrackingController({
      getUserMedia: vi.fn(async () => ({
        getTracks: () => [{ stop: vi.fn() }],
      }) as unknown as MediaStream),
      createWorkerForEngine: vi.fn((engine: { id: string }) =>
        engine.id === MEDIA_PIPE_SPATIAL_VISION_ENGINE_ID
          ? primaryWorker
          : fallbackWorker,
      ),
      createImageBitmap: vi.fn(
        () =>
          new Promise<ImageBitmap>((_resolve, reject) => {
            rejectBitmap = reject;
          }),
      ),
      requestAnimationFrame: vi.fn((callback) => {
        frames.set(++frameId, callback);
        return frameId;
      }),
      cancelAnimationFrame: vi.fn((id) => frames.delete(id)),
      now: () => 1_000,
    });

    const starting = controller.start(video);
    await vi.waitFor(() => expect(primaryWorker.postMessage).toHaveBeenCalled());
    primaryWorker.emit({ type: "ready" });
    await starting;
    [...frames.values()].at(-1)?.(1_000);
    primaryWorker.emit({ type: "error", message: "primary stopped" });
    await vi.waitFor(() => expect(fallbackWorker.postMessage).toHaveBeenCalled());
    fallbackWorker.emit({ type: "ready" });
    expect(controller.getStatus()).toEqual({ state: "ready" });

    rejectBitmap(new Error("old MediaPipe worker capture failed"));
    await vi.waitFor(() =>
      expect(controller.getEngineStatus?.()?.runtimeMetrics).toMatchObject({
        droppedLateCapture: 1,
      }),
    );

    expect(controller.getStatus()).toEqual({ state: "ready" });
    expect(controller.getEngineStatus?.()).toMatchObject({
      id: MEDIA_PIPE_IN_PAGE_RECOVERY_ENGINE_ID,
      fallback: true,
    });
    expect(fallbackWorker.terminate).not.toHaveBeenCalled();
  });

  it("falls back one-way when twelve post-warmup MediaPipe worker results miss the delivered-rate threshold", async () => {
    let now = 1_000;
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
        engine.id === MEDIA_PIPE_SPATIAL_VISION_ENGINE_ID
          ? primaryWorker
          : fallbackWorker,
      ),
      createImageBitmap: vi.fn(async () => ({ close: vi.fn() }) as unknown as ImageBitmap),
      requestAnimationFrame: vi.fn(() => 1),
      cancelAnimationFrame: vi.fn(),
      now: () => now,
    });
    const starting = controller.start(video);
    await vi.waitFor(() => expect(primaryWorker.postMessage).toHaveBeenCalled());
    primaryWorker.emit({ type: "ready" });
    await starting;

    for (let index = 0; index < 14; index += 1) {
      now = 1_100 + index * 60;
      primaryWorker.emit({
        type: "result",
        timestamp: now - 80,
        hands: [],
      });
    }

    await vi.waitFor(() =>
      expect(fallbackWorker.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: "initialize" }),
      ),
    );
    expect(controller.getEngineStatus?.()).toMatchObject({
      id: MEDIA_PIPE_IN_PAGE_RECOVERY_ENGINE_ID,
      fallback: true,
      fallbackReason: expect.stringMatching(/startup performance/i),
    });
  });

  it("accepts age 120 ms, rejects age 120.001 ms before interpretation, and counts the stale result", async () => {
    let now = 1_120;
    const { controller, worker, video } = harness(() => now);
    const observations: HandTrackingObservation[] = [];
    controller.subscribeObservations((observation) => observations.push(observation));
    const starting = controller.start(video);
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalled());
    worker.emit({ type: "ready" });
    await starting;

    worker.emit({
      type: "result",
      timestamp: 1_000,
      hands: [{ handedness: "left", confidence: 0.96, landmarks: hand() }],
    });
    now = 1_240.001;
    worker.emit({
      type: "result",
      timestamp: 1_120,
      hands: [{
        handedness: "left",
        confidence: 0.96,
        landmarks: hand({ x: 0.6, y: 0.4 }, { x: 0.62, y: 0.4 }),
      }],
    });

    expect(observations[0]).toMatchObject({ mode: "point", trackingState: "tracked" });
    expect(observations[1]).toEqual({
      mode: "idle",
      timestamp: 1_240.001,
      trackingState: "lost",
    });
    expect(controller.getEngineStatus?.()?.runtimeMetrics).toMatchObject({
      droppedStale: 1,
    });
  });

  it("publishes metric updates no faster than 250 ms and accepts a render acknowledgement", async () => {
    let now = 1_000;
    const { controller, worker, video } = harness(() => now);
    const engineEvents: unknown[] = [];
    controller.subscribeEngineStatus?.((engine) => engineEvents.push(engine));
    const starting = controller.start(video);
    await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalled());
    worker.emit({ type: "ready" });
    await starting;
    const beforeMetrics = engineEvents.length;

    worker.emit({ type: "result", timestamp: 990, hands: [] });
    const afterFirst = engineEvents.length;
    now = 1_100;
    worker.emit({ type: "result", timestamp: 1_090, hands: [] });
    expect(engineEvents.length).toBe(afterFirst);
    now = 1_250;
    worker.emit({ type: "result", timestamp: 1_240, hands: [] });
    expect(afterFirst).toBeGreaterThan(beforeMetrics);
    expect(engineEvents.length).toBe(afterFirst + 1);

    expect(controller.acknowledgeRendered?.(1_240, 1_280)).toBe(true);
    expect(controller.getEngineStatus?.()?.runtimeMetrics).toMatchObject({
      captureToRenderMs: { p50: 40, p95: 40 },
    });
  });
});
