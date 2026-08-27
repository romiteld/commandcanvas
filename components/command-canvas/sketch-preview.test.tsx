import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SketchPreview } from "@/components/command-canvas/sketch-preview";

describe("SketchPreview", () => {
  it("renders the preserved stroke geometry rather than a stroke count", () => {
    const { container } = render(
      <SketchPreview
        title="Rough system sketch"
        width={360}
        height={220}
        payload={{
          strokes: [
            {
              id: "stroke-one",
              color: "#12233d",
              width: 5,
              points: [
                { x: 12, y: 20 },
                { x: 80, y: 42 },
                { x: 130, y: 28 },
              ],
            },
          ],
        }}
      />,
    );

    expect(
      screen.getByRole("img", { name: "Original rough sketch: Rough system sketch" }),
    ).toBeVisible();
    expect(container.querySelector("svg")?.getAttribute("viewBox")).toBe(
      "0 0 360 220",
    );
    expect(container.querySelector("path")?.getAttribute("d")).toBe(
      "M 12 20 L 80 42 L 130 28",
    );
  });
});
