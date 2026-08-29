import { Profiler } from "react";
import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { HandInkPreview } from "@/components/command-canvas/hand-ink-preview";
import { createCanvasMotionLayer } from "@/lib/gesture/canvas-motion-layer";

describe("HandInkPreview", () => {
  it("does not rerender React while twenty transient ink samples are coalesced", () => {
    let commits = 0;
    const callbacks: FrameRequestCallback[] = [];
    const { container } = render(
      <Profiler
        id="hand-ink-preview"
        onRender={() => {
          commits += 1;
        }}
      >
        <svg>
          <HandInkPreview />
        </svg>
      </Profiler>,
    );
    const layer = createCanvasMotionLayer({
      root: () => container,
      requestAnimationFrame(callback) {
        callbacks.push(callback);
        return callbacks.length;
      },
      cancelAnimationFrame: vi.fn(),
    });
    const commitsAfterMount = commits;

    for (let index = 0; index < 20; index += 1) {
      layer.previewInk(
        Array.from({ length: index + 1 }, (_, pointIndex) => ({
          x: pointIndex * 2,
          y: pointIndex * 3,
        })),
      );
    }

    expect(callbacks).toHaveLength(1);
    callbacks[0]?.(16);
    expect(commits).toBe(commitsAfterMount);
    expect(
      container.querySelector("[data-hand-ink-preview]"),
    ).toHaveAttribute("points", expect.stringContaining("38,57"));
  });
});
