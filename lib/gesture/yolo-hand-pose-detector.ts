import type {
  HandDetector,
  HandDetectorDiagnostics,
  HandDetectorLoadOptions,
  HandDetectorResult,
} from "@/lib/gesture/hand-tracking-worker-core";

export const YOLO_HAND_POSE_MODEL_REVISION =
  "2abb91a7030e1aa5231ec900ccb2c07ab3f03460" as const;
export const YOLO_HAND_POSE_MODEL_URL =
  "/models/yolo26_hand_pose_320_fp16.onnx" as const;
export const YOLO_HAND_POSE_MODEL_BYTES = 21_447_188;
export const YOLO_HAND_POSE_MODEL_SHA256 =
  "07a1cfb3d782d4bfd3b8843dbe8b3af971fc9f297c33ea5d14893ed8704e81fc" as const;

const INPUT_SIZE = 320;
const OUTPUT_ROWS = 300;
const OUTPUT_COLUMNS = 69;
const DEFAULT_CONFIDENCE_THRESHOLD = 0.45;

export function selectYoloWasmThreadCount(environment: {
  crossOriginIsolated: boolean;
  hardwareConcurrency: number;
}) {
  if (!environment.crossOriginIsolated) return 1;
  const available = Number.isFinite(environment.hardwareConcurrency)
    ? Math.max(1, Math.floor(environment.hardwareConcurrency))
    : 1;
  return Math.min(4, available);
}

export interface YoloTensorData {
  data: Float32Array | readonly number[];
  dims: readonly number[];
}

export interface YoloHandPoseSession {
  readonly inputNames: readonly string[];
  readonly outputNames: readonly string[];
  run(feeds: Record<string, unknown>): Promise<Record<string, YoloTensorData>>;
  release(): void | Promise<void>;
}

interface Canvas2DLike {
  fillStyle: string;
  fillRect(x: number, y: number, width: number, height: number): void;
  drawImage(
    image: CanvasImageSource,
    dx: number,
    dy: number,
    dWidth: number,
    dHeight: number,
  ): void;
  getImageData(
    sx: number,
    sy: number,
    sw: number,
    sh: number,
  ): { data: Uint8ClampedArray };
}

interface CanvasLike {
  width: number;
  height: number;
  getContext(kind: "2d", options?: { willReadFrequently?: boolean }): Canvas2DLike | null;
}

export interface YoloHandPoseRuntime {
  configure(wasmBaseUrl: string): void | Promise<void>;
  createSession(
    modelAssetUrl: string,
    options: { executionProviders: readonly ("webgpu" | "wasm")[] },
  ): Promise<YoloHandPoseSession>;
  getWebGpuAdapterInfo?(): HandDetectorDiagnostics["adapter"];
  getWebGpuUnavailableReason?(): string | undefined;
  createTensor(data: Float32Array, dims: readonly number[]): unknown;
  createCanvas(width: number, height: number): CanvasLike;
}

export interface LetterboxTransform {
  inputSize: number;
  sourceWidth: number;
  sourceHeight: number;
  scale: number;
  offsetX: number;
  offsetY: number;
  renderedWidth: number;
  renderedHeight: number;
}

export async function loadYoloHandPoseDetector(
  options: HandDetectorLoadOptions,
  providedRuntime?: YoloHandPoseRuntime,
): Promise<HandDetector> {
  const runtime = providedRuntime ?? (await createDefaultYoloRuntime());
  await runtime.configure(options.wasmBaseUrl);
  let executionProvider: "webgpu" | "wasm" = "webgpu";
  let fallbackReason: string | undefined;
  let session: YoloHandPoseSession;
  try {
    const webGpuUnavailableReason = runtime.getWebGpuUnavailableReason?.();
    if (webGpuUnavailableReason) throw new Error(webGpuUnavailableReason);
    session = await runtime.createSession(options.modelAssetUrl, {
      executionProviders: ["webgpu"],
    });
  } catch (error) {
    executionProvider = "wasm";
    fallbackReason = compactError(error);
    session = await runtime.createSession(options.modelAssetUrl, {
      executionProviders: ["wasm"],
    });
  }
  const inputName = session.inputNames[0];
  const outputName = session.outputNames[0];
  if (!inputName || !outputName) {
    await session.release();
    throw new Error("YOLO hand-pose model is missing an input or output tensor.");
  }
  const canvas = runtime.createCanvas(INPUT_SIZE, INPUT_SIZE);
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) {
    await session.release();
    throw new Error("YOLO hand-pose preprocessing needs a 2D canvas context.");
  }

  return {
    getDiagnostics() {
      return {
        executionProvider,
        highPerformanceGpuRequested: true,
        ...(executionProvider === "webgpu" && runtime.getWebGpuAdapterInfo
          ? { adapter: runtime.getWebGpuAdapterInfo() }
          : {}),
        ...(fallbackReason ? { fallbackReason } : {}),
      };
    },
    async detectForVideo(frame) {
      const transform = createLetterboxTransform(
        frame.width,
        frame.height,
        INPUT_SIZE,
      );
      context.fillStyle = "rgb(114, 114, 114)";
      context.fillRect(0, 0, INPUT_SIZE, INPUT_SIZE);
      context.drawImage(
        frame,
        transform.offsetX,
        transform.offsetY,
        transform.renderedWidth,
        transform.renderedHeight,
      );
      const rgba = context.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE).data;
      const tensor = runtime.createTensor(
        rgbaToNchwFloat32(rgba, INPUT_SIZE * INPUT_SIZE),
        [1, 3, INPUT_SIZE, INPUT_SIZE],
      );
      const outputs = await session.run({ [inputName]: tensor });
      const output = outputs[outputName];
      if (!output)
        throw new Error(`YOLO hand-pose output '${outputName}' is missing.`);
      return parseYoloHandPoseOutput(output, transform, {
        confidenceThreshold: DEFAULT_CONFIDENCE_THRESHOLD,
        maxHands: options.numHands,
      });
    },
    async close() {
      await session.release();
    },
  };
}

export function createLetterboxTransform(
  sourceWidth: number,
  sourceHeight: number,
  inputSize: number,
): LetterboxTransform {
  if (
    !Number.isFinite(sourceWidth) ||
    !Number.isFinite(sourceHeight) ||
    sourceWidth <= 0 ||
    sourceHeight <= 0 ||
    !Number.isFinite(inputSize) ||
    inputSize <= 0
  )
    throw new Error("YOLO hand-pose input dimensions must be positive.");
  const scale = Math.min(inputSize / sourceWidth, inputSize / sourceHeight);
  const renderedWidth = sourceWidth * scale;
  const renderedHeight = sourceHeight * scale;
  return {
    inputSize,
    sourceWidth,
    sourceHeight,
    scale,
    offsetX: (inputSize - renderedWidth) / 2,
    offsetY: (inputSize - renderedHeight) / 2,
    renderedWidth,
    renderedHeight,
  };
}

export function rgbaToNchwFloat32(
  rgba: Uint8ClampedArray,
  pixelCount: number,
): Float32Array {
  if (rgba.length !== pixelCount * 4)
    throw new Error("YOLO hand-pose RGBA input has an invalid length.");
  const tensor = new Float32Array(pixelCount * 3);
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    const rgbaOffset = pixel * 4;
    tensor[pixel] = rgba[rgbaOffset]! / 255;
    tensor[pixelCount + pixel] = rgba[rgbaOffset + 1]! / 255;
    tensor[pixelCount * 2 + pixel] = rgba[rgbaOffset + 2]! / 255;
  }
  return tensor;
}

export function parseYoloHandPoseOutput(
  tensor: YoloTensorData,
  transform: LetterboxTransform,
  options: { confidenceThreshold?: number; maxHands?: number } = {},
): HandDetectorResult {
  if (
    tensor.dims.length !== 3 ||
    tensor.dims[0] !== 1 ||
    tensor.dims[1] !== OUTPUT_ROWS ||
    tensor.dims[2] !== OUTPUT_COLUMNS ||
    tensor.data.length !== OUTPUT_ROWS * OUTPUT_COLUMNS
  )
    throw new Error(
      "CommandCanvas expected YOLO hand-pose output [1,300,69]; a bbox-only model is incompatible.",
    );
  const confidenceThreshold =
    options.confidenceThreshold ?? DEFAULT_CONFIDENCE_THRESHOLD;
  const maxHands = Math.max(1, Math.min(2, options.maxHands ?? 2));
  const detections = Array.from({ length: OUTPUT_ROWS }, (_, row) => {
    const offset = row * OUTPUT_COLUMNS;
    return { row, confidence: Number(tensor.data[offset + 4]) };
  })
    .filter(
      (detection) =>
        Number.isFinite(detection.confidence) &&
        detection.confidence >= confidenceThreshold,
    )
    .sort((left, right) => right.confidence - left.confidence)
    .slice(0, maxHands);

  const landmarks = detections.map(({ row }) => {
    const offset = row * OUTPUT_COLUMNS + 6;
    return Array.from({ length: 21 }, (_, keypointIndex) => {
      const pointOffset = offset + keypointIndex * 3;
      const x = Number(tensor.data[pointOffset]);
      const y = Number(tensor.data[pointOffset + 1]);
      const visibility = Number(tensor.data[pointOffset + 2]);
      if (
        !Number.isFinite(x) ||
        !Number.isFinite(y) ||
        !Number.isFinite(visibility)
      )
        throw new Error("YOLO hand-pose returned a non-finite keypoint.");
      return {
        x: rounded(
          clamp((x - transform.offsetX) / transform.scale / transform.sourceWidth),
        ),
        y: rounded(
          clamp((y - transform.offsetY) / transform.scale / transform.sourceHeight),
        ),
        visibility: rounded(clamp(visibility)),
      };
    });
  });
  return {
    landmarks,
    handedness: detections.map(({ confidence }) => [
      { categoryName: "Unknown", score: confidence },
    ]),
  };
}

async function createDefaultYoloRuntime(): Promise<YoloHandPoseRuntime> {
  // The `all` build uses the JSEP assets copied by build-hand-worker.mjs.
  // The native `/webgpu` build instead requests asyncify assets that are not
  // part of this pinned worker bundle.
  const ort = await import("onnxruntime-web/all");
  let adapterInfo: HandDetectorDiagnostics["adapter"];
  let webGpuUnavailableReason: string | undefined;
  return {
    async configure(wasmBaseUrl) {
      ort.env.wasm.wasmPaths = ensureTrailingSlash(wasmBaseUrl);
      ort.env.wasm.numThreads = selectYoloWasmThreadCount({
        crossOriginIsolated:
          typeof crossOriginIsolated !== "undefined" && crossOriginIsolated,
        hardwareConcurrency:
          typeof navigator === "undefined" ? 1 : navigator.hardwareConcurrency,
      });
      ort.env.webgpu.powerPreference = "high-performance";
      ort.env.webgpu.forceFallbackAdapter = false;
      const configured = await configureYoloWebGpuAdapter(
        readGpuNavigator(),
        (adapter) => {
          // Let ONNX Runtime create its own device so it can request every
          // optional feature and limit its kernels need. Supplying a bare
          // device can omit shader-f16 and return empty detections.
          ort.env.webgpu.adapter = adapter as never;
        },
      );
      adapterInfo = configured.adapterInfo;
      webGpuUnavailableReason = configured.unavailableReason;
    },
    async createSession(modelAssetUrl, options) {
      return (await ort.InferenceSession.create(modelAssetUrl, {
        executionProviders: [...options.executionProviders],
        graphOptimizationLevel: "all",
      })) as unknown as YoloHandPoseSession;
    },
    getWebGpuAdapterInfo: () => adapterInfo,
    getWebGpuUnavailableReason: () => webGpuUnavailableReason,
    createTensor(data, dims) {
      return new ort.Tensor("float32", data, [...dims]);
    },
    createCanvas(width, height) {
      if (typeof OffscreenCanvas === "function")
        return new OffscreenCanvas(width, height) as unknown as CanvasLike;
      if (typeof document !== "undefined") {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        return canvas as unknown as CanvasLike;
      }
      throw new Error(
        "YOLO hand-pose preprocessing needs OffscreenCanvas or an in-page canvas.",
      );
    },
  };
}

interface BrowserGpuAdapter {
  readonly info?: unknown;
  readonly features: { has(feature: string): boolean };
}

interface BrowserGpuNavigator {
  requestAdapter(options: {
    powerPreference: "high-performance";
    forceFallbackAdapter: false;
  }): Promise<BrowserGpuAdapter | null>;
}

export async function configureYoloWebGpuAdapter(
  gpu: BrowserGpuNavigator | null,
  setAdapter: (adapter: BrowserGpuAdapter) => void,
): Promise<{
  adapterInfo?: HandDetectorDiagnostics["adapter"];
  unavailableReason?: string;
}> {
  if (!gpu)
    return { unavailableReason: "WebGPU is unavailable in this browser" };
  try {
    const adapter = await gpu.requestAdapter({
      powerPreference: "high-performance",
      forceFallbackAdapter: false,
    });
    if (!adapter)
      return { unavailableReason: "WebGPU did not return a GPU adapter" };
    if (!adapter.features.has("shader-f16")) {
      return {
        unavailableReason:
          "The selected WebGPU adapter lacks shader-f16 for this FP16 model",
      };
    }
    setAdapter(adapter);
    return { adapterInfo: sanitizeAdapterInfo(adapter.info) };
  } catch (error) {
    return { unavailableReason: compactError(error) };
  }
}

function readGpuNavigator(): BrowserGpuNavigator | null {
  if (typeof navigator === "undefined") return null;
  const candidate = (navigator as Navigator & { gpu?: unknown }).gpu;
  if (!candidate || typeof candidate !== "object") return null;
  const requestAdapter = Reflect.get(candidate, "requestAdapter");
  if (typeof requestAdapter !== "function") return null;
  return {
    requestAdapter: (options) =>
      requestAdapter.call(candidate, options) as Promise<BrowserGpuAdapter | null>,
  };
}

function sanitizeAdapterInfo(
  value: unknown,
): HandDetectorDiagnostics["adapter"] | undefined {
  if (!value || typeof value !== "object") return undefined;
  const output = Object.fromEntries(
    ["vendor", "architecture", "device", "description"].flatMap((key) => {
      const raw = Reflect.get(value, key);
      if (typeof raw !== "string" || !raw.trim()) return [];
      return [[key, raw.trim().slice(0, 120)]];
    }),
  );
  return Object.keys(output).length > 0 ? output : undefined;
}

function compactError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.trim().slice(0, 240) || "WebGPU session unavailable";
}

function ensureTrailingSlash(value: string) {
  return value.endsWith("/") ? value : `${value}/`;
}

function clamp(value: number) {
  return Math.min(1, Math.max(0, value));
}

function rounded(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}
