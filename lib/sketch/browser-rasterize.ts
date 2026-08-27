import {
  rasterizeSketchToPng,
  type SketchRasterCanvas,
  type SketchRasterCanvasFactory,
  type SketchRasterContext,
} from "@/lib/sketch/rasterize";

export type BrowserSketchRasterErrorCode =
  | "document_unavailable"
  | "canvas_unavailable"
  | "context_unavailable"
  | "png_encoding_unavailable"
  | "invalid_png_data_url";

export class BrowserSketchRasterError extends Error {
  readonly name = "BrowserSketchRasterError";

  constructor(
    readonly code: BrowserSketchRasterErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export interface BrowserCanvasElement {
  width: number;
  height: number;
  getContext: (type: "2d") => SketchRasterContext | null;
  toDataURL: (type: "image/png") => string;
}

export interface BrowserCanvasDocument {
  createElement: (tagName: "canvas") => BrowserCanvasElement | null;
}

export interface BrowserSketchRasterOptions {
  createCanvas?: SketchRasterCanvasFactory;
  /** `null` deliberately represents a non-browser runtime in tests/SSR. */
  documentRef?: BrowserCanvasDocument | null;
}

export interface BrowserRasterizedSketchPng {
  mimeType: "image/png";
  width: number;
  height: number;
  dataUrl: string;
}

const PNG_DATA_URL_PREFIX = "data:image/png;base64,";
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10] as const;
const PNG_IEND_TRAILER = [
  0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
] as const;
const BASE64_PATTERN =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/**
 * Creates a data-URL-only canvas adapter. `toBlob` is intentionally absent so
 * the shared rasterizer cannot select a Blob result at this browser boundary.
 */
export function createDomSketchCanvasFactory(
  documentRef: BrowserCanvasDocument,
): SketchRasterCanvasFactory {
  return (width, height) => {
    let element: BrowserCanvasElement | null;
    try {
      element = documentRef.createElement("canvas");
      if (!element) throw new Error("No canvas element was returned.");
      element.width = width;
      element.height = height;
    } catch (error) {
      throw new BrowserSketchRasterError(
        "canvas_unavailable",
        "A browser canvas is required to rasterize the sketch.",
        { cause: error },
      );
    }

    return exposeDataUrlOnlyCanvas(element, width, height);
  };
}

export async function rasterizeSketchInBrowser(
  input: unknown,
  options: BrowserSketchRasterOptions = {},
): Promise<BrowserRasterizedSketchPng> {
  const sourceFactory =
    options.createCanvas ??
    createDomSketchCanvasFactory(resolveDocument(options.documentRef));
  const dataUrlOnlyFactory: SketchRasterCanvasFactory = (width, height) => {
    let canvas: SketchRasterCanvas;
    try {
      canvas = sourceFactory(width, height);
    } catch (error) {
      if (error instanceof BrowserSketchRasterError) throw error;
      throw new BrowserSketchRasterError(
        "canvas_unavailable",
        "A browser canvas is required to rasterize the sketch.",
        { cause: error },
      );
    }
    if (
      !canvas ||
      typeof canvas !== "object" ||
      typeof canvas.getContext !== "function"
    )
      throw new BrowserSketchRasterError(
        "canvas_unavailable",
        "A browser canvas is required to rasterize the sketch.",
      );
    return exposeDataUrlOnlyCanvas(canvas, width, height);
  };

  let rasterized;
  try {
    rasterized = await rasterizeSketchToPng(input, dataUrlOnlyFactory);
  } catch (error) {
    if (error instanceof BrowserSketchRasterError) throw error;
    if (
      error instanceof Error &&
      error.message === "A 2D canvas context is required to rasterize a sketch."
    )
      throw new BrowserSketchRasterError(
        "context_unavailable",
        "A 2D canvas context is required to rasterize the sketch.",
        { cause: error },
      );
    if (
      error instanceof Error &&
      error.message === "The canvas returned a non-PNG data URL."
    )
      throw invalidPng(error);
    if (
      error instanceof Error &&
      error.message === "The canvas does not provide a PNG encoder."
    )
      throw encodingUnavailable(error);
    throw error;
  }

  if (rasterized.kind !== "data-url") throw encodingUnavailable();
  if (!isStrictPngDataUrl(rasterized.dataUrl)) throw invalidPng();
  return {
    mimeType: "image/png",
    width: rasterized.width,
    height: rasterized.height,
    dataUrl: rasterized.dataUrl,
  };
}

export function isStrictPngDataUrl(value: unknown): value is string {
  if (typeof value !== "string" || !value.startsWith(PNG_DATA_URL_PREFIX))
    return false;
  const payload = value.slice(PNG_DATA_URL_PREFIX.length);
  if (
    payload.length === 0 ||
    payload.length % 4 !== 0 ||
    !BASE64_PATTERN.test(payload)
  )
    return false;

  let decoded: string;
  try {
    if (typeof globalThis.atob !== "function") return false;
    decoded = globalThis.atob(payload);
  } catch {
    return false;
  }
  if (decoded.length < PNG_SIGNATURE.length + PNG_IEND_TRAILER.length)
    return false;
  if (
    !PNG_SIGNATURE.every(
      (byte, index) => decoded.charCodeAt(index) === byte,
    )
  )
    return false;
  const trailerOffset = decoded.length - PNG_IEND_TRAILER.length;
  return PNG_IEND_TRAILER.every(
    (byte, index) => decoded.charCodeAt(trailerOffset + index) === byte,
  );
}

function resolveDocument(
  supplied: BrowserCanvasDocument | null | undefined,
): BrowserCanvasDocument {
  if (supplied !== undefined) {
    if (supplied) return supplied;
    throw documentUnavailable();
  }
  if (typeof document === "undefined") throw documentUnavailable();
  return document as unknown as BrowserCanvasDocument;
}

function exposeDataUrlOnlyCanvas(
  canvas: SketchRasterCanvas,
  width: number,
  height: number,
): SketchRasterCanvas {
  return {
    width,
    height,
    getContext: () => {
      try {
        return canvas.getContext("2d");
      } catch (error) {
        throw new BrowserSketchRasterError(
          "context_unavailable",
          "A 2D canvas context is required to rasterize the sketch.",
          { cause: error },
        );
      }
    },
    ...(typeof canvas.toDataURL === "function"
      ? {
          toDataURL: (type: "image/png") => {
            try {
              return canvas.toDataURL!(type);
            } catch (error) {
              throw encodingUnavailable(error);
            }
          },
        }
      : {}),
  };
}

function documentUnavailable() {
  return new BrowserSketchRasterError(
    "document_unavailable",
    "A browser document is required to rasterize the sketch.",
  );
}

function encodingUnavailable(cause?: unknown) {
  return new BrowserSketchRasterError(
    "png_encoding_unavailable",
    "The browser could not encode the sketch as PNG.",
    cause === undefined ? undefined : { cause },
  );
}

function invalidPng(cause?: unknown) {
  return new BrowserSketchRasterError(
    "invalid_png_data_url",
    "The browser returned an invalid PNG data URL.",
    cause === undefined ? undefined : { cause },
  );
}
