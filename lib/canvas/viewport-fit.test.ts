import { describe, expect, it } from "vitest";

import { fitViewportToWorldBounds } from "@/lib/canvas/coordinates";

describe("fitViewportToWorldBounds", () => {
  it("zooms out and centers a preserved sketch and generated diagram inside the visible rectangle", () => {
    const fitted = fitViewportToWorldBounds(
      { x: 0, y: 0, scale: 1 },
      [
        { x: 20, y: 30, width: 360, height: 220 },
        { x: 444, y: 30, width: 620, height: 360 },
      ],
      { x: 0, y: 0, width: 800, height: 450 },
      48,
    );

    expect(fitted).not.toBeNull();
    expect(fitted!.scale).toBeCloseTo(0.6743295, 7);
    expect(fitted!.x).toBeCloseTo(34.51341, 5);
    expect(fitted!.y).toBeCloseTo(83.390805, 5);
  });

  it("keeps the current scale when all objects already fit rather than zooming in", () => {
    const fitted = fitViewportToWorldBounds(
      { x: 95, y: -30, scale: 0.6 },
      [
        { x: 0, y: 0, width: 160, height: 100 },
        { x: 220, y: 20, width: 180, height: 120 },
      ],
      { x: 0, y: 0, width: 900, height: 600 },
      48,
    );

    expect(fitted).toEqual({ x: 330, y: 258, scale: 0.6 });
  });

  it.each([360, 420, 480])(
    "fits both reveal objects at a %ipx canvas width without changing the manual zoom floor",
    (screenWidth) => {
      const screenHeight = 450;
      const padding = Math.min(48, screenWidth * 0.08);
      const source = { x: 20, y: 30, width: 360, height: 220 };
      const diagram = { x: 444, y: 30, width: 620, height: 360 };
      const fitted = fitViewportToWorldBounds(
        { x: 0, y: 0, scale: 1 },
        [source, diagram],
        { x: 0, y: 0, width: screenWidth, height: screenHeight },
        padding,
        0.24,
      );

      expect(fitted).not.toBeNull();
      for (const rectangle of [source, diagram]) {
        expect(rectangle.x * fitted!.scale + fitted!.x).toBeGreaterThanOrEqual(
          padding - 1e-6,
        );
        expect(rectangle.y * fitted!.scale + fitted!.y).toBeGreaterThanOrEqual(
          padding - 1e-6,
        );
        expect(
          (rectangle.x + rectangle.width) * fitted!.scale + fitted!.x,
        ).toBeLessThanOrEqual(screenWidth - padding + 1e-6);
        expect(
          (rectangle.y + rectangle.height) * fitted!.scale + fitted!.y,
        ).toBeLessThanOrEqual(screenHeight - padding + 1e-6);
      }
    },
  );

  it("keeps the manual canvas zoom floor as the default fit floor", () => {
    const fitted = fitViewportToWorldBounds(
      { x: 0, y: 0, scale: 1 },
      [
        { x: 20, y: 30, width: 360, height: 220 },
        { x: 444, y: 30, width: 620, height: 360 },
      ],
      { x: 0, y: 0, width: 360, height: 450 },
      28.8,
    );

    expect(fitted?.scale).toBe(0.35);
  });

  it("does not zoom in from an earlier presentation reveal below its requested floor", () => {
    const fitted = fitViewportToWorldBounds(
      { x: 0, y: 0, scale: 0.2 },
      [
        { x: 20, y: 30, width: 360, height: 220 },
        { x: 444, y: 30, width: 620, height: 360 },
      ],
      { x: 0, y: 0, width: 480, height: 450 },
      38.4,
      0.24,
    );

    expect(fitted?.scale).toBe(0.2);
  });

  it("refuses incomplete or invalid geometry instead of moving the canvas", () => {
    expect(
      fitViewportToWorldBounds(
        { x: 0, y: 0, scale: 1 },
        [{ x: 20, y: 30, width: 360, height: 220 }],
        { x: 0, y: 0, width: 800, height: 450 },
      ),
    ).toBeNull();
    expect(
      fitViewportToWorldBounds(
        { x: 0, y: 0, scale: 1 },
        [
          { x: 20, y: 30, width: 360, height: 220 },
          { x: 444, y: 30, width: Number.NaN, height: 360 },
        ],
        { x: 0, y: 0, width: 800, height: 450 },
      ),
    ).toBeNull();
    expect(
      fitViewportToWorldBounds(
        { x: 0, y: 0, scale: 1 },
        [
          { x: 20, y: 30, width: 360, height: 220 },
          { x: 444, y: 30, width: 620, height: 360 },
        ],
        { x: 0, y: 0, width: 0, height: 450 },
      ),
    ).toBeNull();
  });
});
