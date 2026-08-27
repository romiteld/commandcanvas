import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

import {
  buildSketchRasterPlan,
  rasterizeSketchToPng,
  type SketchRasterContext,
} from "@/lib/sketch/rasterize";

describe("buildSketchRasterPlan", () => {
  it("fits negative-coordinate strokes into a padded, aspect-preserving 1024px raster", () => {
    const payload = {
      strokes: [
        {
          id: "stroke-pressure",
          color: "#123456",
          width: 4,
          points: [
            { x: -10, y: -5, pressure: 0.5 },
            { x: 10, y: 5, pressure: 1 },
          ],
        },
        {
          id: "stroke-wide",
          color: "#abcdef",
          width: 8,
          points: [
            { x: 0, y: -10 },
            { x: 20, y: 10 },
          ],
        },
      ],
    } as const;
    const sourceSnapshot = structuredClone(payload);

    const plan = buildSketchRasterPlan(payload);

    expect(plan).toMatchObject({
      width: 1024,
      height: 768,
      maxDimension: 1024,
      padding: 24,
      background: "#ffffff",
      lineCap: "round",
      lineJoin: "round",
      bounds: { minX: -10, minY: -10, maxX: 20, maxY: 10 },
      paddedBounds: { minX: -14, minY: -14, maxX: 24, maxY: 14 },
    });
    expect(plan.scale).toBeCloseTo(976 / 38, 10);
    expect(plan.segments).toHaveLength(2);
    expect(plan.segments[0]).toMatchObject({
      strokeId: "stroke-pressure",
      color: "#123456",
    });
    expect(plan.segments[0]?.from.x).toBeCloseTo(126.7368421053, 8);
    expect(plan.segments[0]?.from.y).toBeCloseTo(255.1578947368, 8);
    expect(plan.segments[0]?.to.x).toBeCloseTo(640.4210526316, 8);
    expect(plan.segments[0]?.to.y).toBeCloseTo(512, 8);
    expect(plan.segments[0]?.width).toBeCloseTo(77.0526315789, 8);
    expect(plan.segments[1]?.width).toBeCloseTo(205.4736842105, 8);
    expect(payload).toEqual(sourceSnapshot);
  });

  it("refuses a sketch with no strokes instead of producing non-finite bounds", () => {
    expect(() => buildSketchRasterPlan({ strokes: [] })).toThrow(
      "Cannot rasterize an empty sketch.",
    );
  });

  it("uses the shared sketch schema to reject a single-point stroke", () => {
    expect(() =>
      buildSketchRasterPlan({
        strokes: [
          {
            id: "stroke-short",
            color: "#123456",
            width: 2,
            points: [{ x: 0, y: 0 }],
          },
        ],
      }),
    ).toThrow(ZodError);
  });

  it("uses the shared sketch schema to reject out-of-range geometry", () => {
    expect(() =>
      buildSketchRasterPlan({
        strokes: [
          {
            id: "stroke-excessive",
            color: "#123456",
            width: 2,
            points: [
              { x: 0, y: 0 },
              { x: 1_000_001, y: 0 },
            ],
          },
        ],
      }),
    ).toThrow(ZodError);
  });

  it("uses the shared sketch schema to reject more than 128 strokes", () => {
    const strokes = Array.from({ length: 129 }, (_, index) => ({
      id: `stroke-${index}`,
      color: "#123456",
      width: 2,
      points: [
        { x: 0, y: index },
        { x: 1, y: index },
      ],
    }));

    expect(() => buildSketchRasterPlan({ strokes })).toThrow(ZodError);
  });
});

describe("rasterizeSketchToPng", () => {
  it("paints the white background and exact rounded pressure-aware segments before encoding PNG", async () => {
    const operations: Array<readonly [string, ...unknown[]]> = [];
    const context: SketchRasterContext = {
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 0,
      lineCap: "butt",
      lineJoin: "miter",
      fillRect: (x, y, width, height) =>
        operations.push(["fillRect", x, y, width, height]),
      beginPath: () => operations.push(["beginPath"]),
      moveTo: (x, y) => operations.push(["moveTo", x, y]),
      lineTo: (x, y) => operations.push(["lineTo", x, y]),
      stroke: () => operations.push(["stroke"]),
    };
    const blob = new Blob(["png-bytes"], { type: "image/png" });

    const result = await rasterizeSketchToPng(
      {
        strokes: [
          {
            id: "stroke-one",
            color: "#123456",
            width: 2,
            points: [
              { x: 0, y: 0, pressure: 0.5 },
              { x: 10, y: 0, pressure: 1 },
              { x: 20, y: 10, pressure: 0.5 },
            ],
          },
        ],
      },
      (width, height) => ({
        width,
        height,
        getContext: (type) => (type === "2d" ? context : null),
        toBlob: (callback, type) => {
          operations.push(["toBlob", type]);
          callback(blob);
        },
      }),
    );

    expect(result).toEqual({
      kind: "blob",
      mimeType: "image/png",
      width: 1024,
      height: 581,
      blob,
    });
    expect(context).toMatchObject({
      fillStyle: "#ffffff",
      strokeStyle: "#123456",
      lineCap: "round",
      lineJoin: "round",
    });
    expect(context.lineWidth).toBeCloseTo(66.5454545455, 8);
    expect(operations).toHaveLength(10);
    expect(operations[0]).toEqual(["fillRect", 0, 0, 1024, 581]);
    expect(operations[1]).toEqual(["beginPath"]);
    expect(operations[2]?.[0]).toBe("moveTo");
    expect(operations[2]?.[1]).toBeCloseTo(68.3636363636, 8);
    expect(operations[2]?.[2]).toBeCloseTo(68.3636363636, 8);
    expect(operations[3]?.[0]).toBe("lineTo");
    expect(operations[3]?.[1]).toBeCloseTo(512, 8);
    expect(operations[3]?.[2]).toBeCloseTo(68.3636363636, 8);
    expect(operations[4]).toEqual(["stroke"]);
    expect(operations[5]).toEqual(["beginPath"]);
    expect(operations[6]?.[0]).toBe("moveTo");
    expect(operations[6]?.[1]).toBeCloseTo(512, 8);
    expect(operations[6]?.[2]).toBeCloseTo(68.3636363636, 8);
    expect(operations[7]?.[0]).toBe("lineTo");
    expect(operations[7]?.[1]).toBeCloseTo(955.6363636364, 8);
    expect(operations[7]?.[2]).toBeCloseTo(512, 8);
    expect(operations[8]).toEqual(["stroke"]);
    expect(operations[9]).toEqual(["toBlob", "image/png"]);
  });

  it("falls back to an image/png data URL when Blob encoding is unavailable", async () => {
    let requestedType: string | undefined;
    const context: SketchRasterContext = {
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

    const result = await rasterizeSketchToPng(
      {
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
      },
      (width, height) => ({
        width,
        height,
        getContext: () => context,
        toDataURL: (type) => {
          requestedType = type;
          return "data:image/png;base64,cG5n";
        },
      }),
    );

    expect(result).toEqual({
      kind: "data-url",
      mimeType: "image/png",
      width: 1024,
      height: 211,
      dataUrl: "data:image/png;base64,cG5n",
    });
    expect(requestedType).toBe("image/png");
  });

  it("refuses a data URL whose media type only shares the PNG prefix", async () => {
    const context: SketchRasterContext = {
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

    await expect(
      rasterizeSketchToPng(
        {
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
        },
        (width, height) => ({
          width,
          height,
          getContext: () => context,
          toDataURL: () => "data:image/pngish;base64,cG5n",
        }),
      ),
    ).rejects.toThrow("The canvas returned a non-PNG data URL.");
  });
});
