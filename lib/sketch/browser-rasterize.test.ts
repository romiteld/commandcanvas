import { describe, expect, it, vi } from "vitest";

import {
  BrowserSketchRasterError,
  createDomSketchCanvasFactory,
  isStrictPngDataUrl,
  rasterizeSketchInBrowser,
  type BrowserCanvasDocument,
} from "@/lib/sketch/browser-rasterize";
import type {
  SketchRasterCanvas,
  SketchRasterContext,
} from "@/lib/sketch/rasterize";

const PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

const sketch = {
  strokes: [
    {
      id: "stroke-one",
      color: "#234567",
      width: 2,
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
    },
  ],
} as const;

function context(): SketchRasterContext {
  return {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 0,
    lineCap: "butt",
    lineJoin: "miter",
    fillRect: () => undefined,
    beginPath: () => undefined,
    moveTo: () => undefined,
    lineTo: () => undefined,
    stroke: () => undefined,
  };
}

describe("strict PNG data URL validation", () => {
  it("accepts a base64 PNG signature and rejects MIME-prefix lookalikes or non-PNG bytes", () => {
    expect(isStrictPngDataUrl(PNG_DATA_URL)).toBe(true);
    expect(isStrictPngDataUrl("data:image/png;base64,dGV4dA==")).toBe(false);
    expect(isStrictPngDataUrl("data:image/pngish;base64,iVBORw0KGgo=")).toBe(
      false,
    );
    expect(isStrictPngDataUrl("data:image/png;base64,iVBORw0KGgo*!")).toBe(
      false,
    );
    expect(isStrictPngDataUrl("data:image/png;charset=utf-8;base64,iVBORw0KGgo="))
      .toBe(false);
  });
});

describe("browser sketch raster bridge", () => {
  it("forces the existing rasterizer through image/png toDataURL and returns dimensions", async () => {
    const toDataURL = vi.fn(() => PNG_DATA_URL);
    const result = await rasterizeSketchInBrowser(sketch, {
      createCanvas: (width, height) => ({
        width,
        height,
        getContext: () => context(),
        toDataURL,
        toBlob: undefined,
      }),
    });

    expect(toDataURL).toHaveBeenCalledExactlyOnceWith("image/png");
    expect(result).toEqual({
      mimeType: "image/png",
      width: 1024,
      height: 211,
      dataUrl: PNG_DATA_URL,
    });
  });

  it("uses a supplied DOM document by setting canvas dimensions and exposing no Blob encoder", async () => {
    const canvasElement = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => context()),
      toDataURL: vi.fn(() => PNG_DATA_URL),
      toBlob: vi.fn(),
    };
    const documentRef: BrowserCanvasDocument = {
      createElement: vi.fn(() => canvasElement),
    };
    const factory = createDomSketchCanvasFactory(documentRef);

    const exposedCanvas = factory(320, 180);

    expect(documentRef.createElement).toHaveBeenCalledExactlyOnceWith("canvas");
    expect(canvasElement).toMatchObject({ width: 320, height: 180 });
    expect(exposedCanvas.toBlob).toBeUndefined();
    expect(exposedCanvas.toDataURL?.("image/png")).toBe(PNG_DATA_URL);
    expect(canvasElement.toDataURL).toHaveBeenCalledExactlyOnceWith("image/png");
    expect(canvasElement.toBlob).not.toHaveBeenCalled();
  });

  it("fails honestly when no browser document is available", async () => {
    await expect(
      rasterizeSketchInBrowser(sketch, { documentRef: null }),
    ).rejects.toMatchObject({
      name: "BrowserSketchRasterError",
      code: "document_unavailable",
      message: "A browser document is required to rasterize the sketch.",
    });
  });

  it("fails honestly when the document cannot create a usable canvas", () => {
    expect(() =>
      createDomSketchCanvasFactory({
        createElement: () => null,
      })(320, 180),
    ).toThrowError(
      new BrowserSketchRasterError(
        "canvas_unavailable",
        "A browser canvas is required to rasterize the sketch.",
      ),
    );
  });

  it("fails honestly when a 2D context is unavailable", async () => {
    await expect(
      rasterizeSketchInBrowser(sketch, {
        createCanvas: (width, height) => ({
          width,
          height,
          getContext: () => null,
          toDataURL: () => PNG_DATA_URL,
        }),
      }),
    ).rejects.toMatchObject({
      code: "context_unavailable",
      message: "A 2D canvas context is required to rasterize the sketch.",
    });
  });

  it.each([
    ["a non-PNG payload", "data:image/png;base64,dGV4dA=="],
    ["an invalid Base64 payload", "data:image/png;base64,iVBORw0KGgo*!"],
    ["an empty encoder result", "data:,"],
  ])("rejects %s instead of sending it to vision", async (_label, encoded) => {
    await expect(
      rasterizeSketchInBrowser(sketch, {
        createCanvas: (width, height) => ({
          width,
          height,
          getContext: () => context(),
          toDataURL: () => encoded,
        }),
      }),
    ).rejects.toMatchObject({
      code: "invalid_png_data_url",
      message: "The browser returned an invalid PNG data URL.",
    });
  });

  it("reports an unavailable encoder without pretending rasterization succeeded", async () => {
    await expect(
      rasterizeSketchInBrowser(sketch, {
        createCanvas: (width, height) =>
          ({
            width,
            height,
            getContext: () => context(),
          }) satisfies SketchRasterCanvas,
      }),
    ).rejects.toMatchObject({
      code: "png_encoding_unavailable",
      message: "The browser could not encode the sketch as PNG.",
    });
  });

  it("reports a thrown browser encoder failure without exposing a fake result", async () => {
    await expect(
      rasterizeSketchInBrowser(sketch, {
        createCanvas: (width, height) => ({
          width,
          height,
          getContext: () => context(),
          toDataURL: () => {
            throw new DOMException("Canvas is tainted", "SecurityError");
          },
        }),
      }),
    ).rejects.toMatchObject({
      code: "png_encoding_unavailable",
      message: "The browser could not encode the sketch as PNG.",
    });
  });
});
