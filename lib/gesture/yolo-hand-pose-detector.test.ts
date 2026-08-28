import { describe, expect, it, vi } from "vitest";

import {
  YOLO_HAND_POSE_MODEL_BYTES,
  YOLO_HAND_POSE_MODEL_SHA256,
  YOLO_HAND_POSE_MODEL_URL,
  createLetterboxTransform,
  configureYoloWebGpuAdapter,
  loadYoloHandPoseDetector,
  parseYoloHandPoseOutput,
  rgbaToNchwFloat32,
  selectYoloWasmThreadCount,
  type YoloTensorData,
} from "@/lib/gesture/yolo-hand-pose-detector";

function outputWithDetections(
  detections: readonly {
    confidence: number;
    keypoint: (index: number) => { x: number; y: number; visibility?: number };
  }[],
): YoloTensorData {
  const rowLength = 69;
  const data = new Float32Array(300 * rowLength);
  detections.forEach((detection, row) => {
    const offset = row * rowLength;
    data[offset] = 20;
    data[offset + 1] = 30;
    data[offset + 2] = 620;
    data[offset + 3] = 610;
    data[offset + 4] = detection.confidence;
    data[offset + 5] = 0;
    for (let keypointIndex = 0; keypointIndex < 21; keypointIndex += 1) {
      const point = detection.keypoint(keypointIndex);
      const pointOffset = offset + 6 + keypointIndex * 3;
      data[pointOffset] = point.x;
      data[pointOffset + 1] = point.y;
      data[pointOffset + 2] = point.visibility ?? 0.95;
    }
  });
  return { data, dims: [1, 300, 69] };
}

describe("YOLO 21-keypoint browser detector", () => {
  it("reports unavailable WebGPU without trying to select an adapter", async () => {
    const setAdapter = vi.fn();

    await expect(
      configureYoloWebGpuAdapter(null, setAdapter),
    ).resolves.toEqual({
      highPerformanceGpuRequested: false,
      unavailableReason: "WebGPU is unavailable in this browser",
    });
    expect(setAdapter).not.toHaveBeenCalled();
  });

  it("requests a high-performance non-fallback adapter and records its identity", async () => {
    const requestDevice = vi.fn();
    const adapter = {
      info: {
        vendor: "nvidia",
        architecture: "ampere",
        description: "NVIDIA GeForce RTX 3090",
      },
      features: new Set(["shader-f16"]),
      requestDevice,
    };
    const requestAdapter = vi.fn(async () => adapter);
    const setAdapter = vi.fn();

    await expect(
      configureYoloWebGpuAdapter({ requestAdapter }, setAdapter),
    ).resolves.toEqual({
      highPerformanceGpuRequested: true,
      adapterInfo: {
        vendor: "nvidia",
        architecture: "ampere",
        description: "NVIDIA GeForce RTX 3090",
      },
    });
    expect(requestAdapter).toHaveBeenCalledWith({
      powerPreference: "high-performance",
      forceFallbackAdapter: false,
    });
    expect(setAdapter).toHaveBeenCalledWith(adapter);
    expect(requestDevice).not.toHaveBeenCalled();
  });

  it("refuses a featureless software adapter before ONNX can emit invalid FP16 kernels", async () => {
    const setAdapter = vi.fn();
    const requestDevice = vi.fn();
    const adapter = {
      info: { vendor: "google", architecture: "swiftshader" },
      features: new Set<string>(),
      requestDevice,
    };

    await expect(
      configureYoloWebGpuAdapter(
        { requestAdapter: vi.fn(async () => adapter) },
        setAdapter,
      ),
    ).resolves.toEqual({
      highPerformanceGpuRequested: true,
      unavailableReason:
        "The selected WebGPU adapter lacks shader-f16 for this FP16 model",
    });
    expect(setAdapter).not.toHaveBeenCalled();
    expect(requestDevice).not.toHaveBeenCalled();
  });

  it("turns adapter lookup failures and null adapters into explicit fallback reasons", async () => {
    const setAdapter = vi.fn();

    await expect(
      configureYoloWebGpuAdapter(
        { requestAdapter: vi.fn(async () => null) },
        setAdapter,
      ),
    ).resolves.toEqual({
      highPerformanceGpuRequested: true,
      unavailableReason: "WebGPU did not return a GPU adapter",
    });
    await expect(
      configureYoloWebGpuAdapter(
        {
          requestAdapter: vi.fn(async () => {
            throw new Error("GPU process unavailable");
          }),
        },
        setAdapter,
      ),
    ).resolves.toEqual({
      highPerformanceGpuRequested: true,
      unavailableReason: "GPU process unavailable",
    });
    expect(setAdapter).not.toHaveBeenCalled();
  });

  it("uses bounded parallel WASM inference only in a cross-origin-isolated worker", () => {
    expect(
      selectYoloWasmThreadCount({
        crossOriginIsolated: true,
        hardwareConcurrency: 12,
      }),
    ).toBe(4);
    expect(
      selectYoloWasmThreadCount({
        crossOriginIsolated: true,
        hardwareConcurrency: 2,
      }),
    ).toBe(2);
    expect(
      selectYoloWasmThreadCount({
        crossOriginIsolated: false,
        hardwareConcurrency: 12,
      }),
    ).toBe(1);
  });

  it("pins the locally served 320px export derived from the verified Hugging Face revision", () => {
    expect(YOLO_HAND_POSE_MODEL_URL).toBe(
      "/models/yolo26_hand_pose_320_fp16.onnx",
    );
    expect(YOLO_HAND_POSE_MODEL_BYTES).toBe(21_447_188);
    expect(YOLO_HAND_POSE_MODEL_SHA256).toBe(
      "07a1cfb3d782d4bfd3b8843dbe8b3af971fc9f297c33ea5d14893ed8704e81fc",
    );
  });

  it("parses the verified [1,300,69] output into two normalized 21-point hands", () => {
    const transform = createLetterboxTransform(1280, 720, 640);
    const tensor = outputWithDetections([
      {
        confidence: 0.92,
        keypoint: () => ({ x: 320, y: 320 }),
      },
      {
        confidence: 0.71,
        keypoint: (index) => ({
          x: 160 + index,
          y: 230 + index,
          visibility: index === 8 ? 0.42 : 0.95,
        }),
      },
      {
        confidence: 0.2,
        keypoint: () => ({ x: 100, y: 100 }),
      },
    ]);

    const result = parseYoloHandPoseOutput(tensor, transform, {
      confidenceThreshold: 0.45,
      maxHands: 2,
    });

    expect(result.landmarks).toHaveLength(2);
    expect(result.landmarks[0]).toHaveLength(21);
    expect(result.landmarks[0]?.[8]).toEqual({
      x: 0.5,
      y: 0.5,
      visibility: 0.95,
    });
    expect(result.landmarks[1]?.[8]).toEqual({
      x: 0.2625,
      y: 0.272222,
      visibility: 0.42,
    });
    expect(result.handedness).toEqual([
      [{ categoryName: "Unknown", score: expect.closeTo(0.92, 5) }],
      [{ categoryName: "Unknown", score: expect.closeTo(0.71, 5) }],
    ]);
  });

  it("refuses bbox-only or otherwise incompatible model output", () => {
    expect(() =>
      parseYoloHandPoseOutput(
        { data: new Float32Array(300 * 6), dims: [1, 300, 6] },
        createLetterboxTransform(640, 640, 640),
      ),
    ).toThrow("expected YOLO hand-pose output [1,300,69]");
  });

  it("letterboxes camera pixels into RGB NCHW float input without stretching", () => {
    expect(createLetterboxTransform(1280, 720, 640)).toEqual({
      inputSize: 640,
      sourceWidth: 1280,
      sourceHeight: 720,
      scale: 0.5,
      offsetX: 0,
      offsetY: 140,
      renderedWidth: 640,
      renderedHeight: 360,
    });
    const tensor = rgbaToNchwFloat32(
      new Uint8ClampedArray([
        255, 128, 0, 255,
        64, 32, 16, 255,
      ]),
      2,
    );
    expect([...tensor]).toEqual([
      expect.closeTo(1, 6),
      expect.closeTo(64 / 255, 6),
      expect.closeTo(128 / 255, 6),
      expect.closeTo(32 / 255, 6),
      expect.closeTo(0, 6),
      expect.closeTo(16 / 255, 6),
    ]);
  });

  it("runs ONNX inference asynchronously and returns the shared detector contract", async () => {
    const output = outputWithDetections([
      {
        confidence: 0.88,
        keypoint: () => ({ x: 320, y: 320 }),
      },
    ]);
    const session = {
      inputNames: ["images"],
      outputNames: ["output0"],
      run: vi.fn(async () => ({ output0: output })),
      release: vi.fn(async () => undefined),
    };
    const context = {
      fillStyle: "",
      fillRect: vi.fn(),
      drawImage: vi.fn(),
      getImageData: vi.fn(() => ({
        data: new Uint8ClampedArray(320 * 320 * 4),
      })),
    };
    const runtime = {
      configure: vi.fn(),
      createSession: vi.fn(async () => session),
      createTensor: vi.fn((data: Float32Array, dims: readonly number[]) => ({
        data,
        dims,
      })),
      createCanvas: vi.fn(() => ({
        width: 320,
        height: 320,
        getContext: () => context,
      })),
    };

    const detector = await loadYoloHandPoseDetector(
      {
        wasmBaseUrl: "/onnxruntime/",
        modelAssetUrl: YOLO_HAND_POSE_MODEL_URL,
        runningMode: "VIDEO",
        numHands: 2,
      },
      runtime,
    );
    const result = await detector.detectForVideo(
      { width: 1280, height: 720 } as ImageBitmap,
      1_000,
    );

    expect(runtime.configure).toHaveBeenCalledWith("/onnxruntime/");
    expect(runtime.createSession).toHaveBeenCalledWith(
      YOLO_HAND_POSE_MODEL_URL,
      { executionProviders: ["webgpu"] },
    );
    expect(detector.getDiagnostics?.()).toMatchObject({
      executionProvider: "webgpu",
      highPerformanceGpuRequested: false,
    });
    expect(runtime.createTensor).toHaveBeenCalledWith(
      expect.any(Float32Array),
      [1, 3, 320, 320],
    );
    expect(session.run).toHaveBeenCalledWith({ images: expect.any(Object) });
    expect(result.landmarks[0]).toHaveLength(21);
    await detector.close();
    expect(session.release).toHaveBeenCalledOnce();
  });

  it("labels threaded WASM only after a WebGPU-only session actually fails", async () => {
    const session = {
      inputNames: ["images"],
      outputNames: ["output0"],
      run: vi.fn(async () => ({
        output0: outputWithDetections([]),
      })),
      release: vi.fn(),
    };
    const runtime = {
      configure: vi.fn(),
      didRequestHighPerformanceWebGpuAdapter: () => true,
      createSession: vi
        .fn()
        .mockRejectedValueOnce(new Error("WebGPU unavailable"))
        .mockResolvedValueOnce(session),
      createTensor: vi.fn(),
      createCanvas: vi.fn(() => ({
        width: 320,
        height: 320,
        getContext: () => ({
          fillStyle: "",
          fillRect: vi.fn(),
          drawImage: vi.fn(),
          getImageData: vi.fn(() => ({
            data: new Uint8ClampedArray(320 * 320 * 4),
          })),
        }),
      })),
    };

    const detector = await loadYoloHandPoseDetector(
      {
        wasmBaseUrl: "/onnxruntime/",
        modelAssetUrl: YOLO_HAND_POSE_MODEL_URL,
        runningMode: "VIDEO",
        numHands: 2,
      },
      runtime,
    );

    expect(runtime.createSession).toHaveBeenNthCalledWith(
      1,
      YOLO_HAND_POSE_MODEL_URL,
      { executionProviders: ["webgpu"] },
    );
    expect(runtime.createSession).toHaveBeenNthCalledWith(
      2,
      YOLO_HAND_POSE_MODEL_URL,
      { executionProviders: ["wasm"] },
    );
    expect(detector.getDiagnostics?.()).toMatchObject({
      executionProvider: "wasm",
      highPerformanceGpuRequested: true,
    });
  });
});
