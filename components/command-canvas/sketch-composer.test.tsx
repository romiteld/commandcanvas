import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { SketchComposer } from "@/components/command-canvas/sketch-composer";
import {
  sketchPayloadSchema,
  type SketchPayload,
} from "@/lib/canvas/object-model";

const WORLD_WIDTH = 400;
const WORLD_HEIGHT = 200;

describe("SketchComposer", () => {
  it("offers explicit accessible editing actions and refuses an empty sketch", () => {
    const completed: SketchPayload[] = [];
    render(
      <SketchComposer
        width={WORLD_WIDTH}
        height={WORLD_HEIGHT}
        onDone={(payload) => completed.push(payload)}
        onCancel={() => undefined}
      />,
    );

    expect(screen.getByRole("img", { name: "Sketch draft surface" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Draw mode" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Erase mode" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("button", { name: "Clear sketch" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Cancel sketch" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Finish sketch" })).toBeDisabled();
    expect(screen.getByText("0 draft strokes")).toBeInTheDocument();
    expect(completed).toEqual([]);
  });

  it("captures mouse, touch, and pen strokes as scaled object-local coordinates", async () => {
    const user = userEvent.setup();
    const completed: SketchPayload[] = [];
    const inputSources: string[] = [];
    const { container } = render(
      <SketchComposer
        width={WORLD_WIDTH}
        height={WORLD_HEIGHT}
        onDone={(payload, source) => {
          completed.push(payload);
          inputSources.push(source);
        }}
        onCancel={() => undefined}
      />,
    );
    const { surface, captured, released } = prepareSurface(container);

    drawStroke(surface, {
      pointerId: 1,
      pointerType: "mouse",
      from: [110, 60],
      through: [150, 75],
      to: [200, 100],
    });
    drawStroke(surface, {
      pointerId: 2,
      pointerType: "touch",
      from: [120, 120],
      through: [160, 125],
      to: [210, 130],
    });
    drawStroke(surface, {
      pointerId: 3,
      pointerType: "pen",
      from: [130, 140],
      through: [170, 145],
      to: [220, 150],
      pressure: [0.2, 0.7, 0.5],
    });

    expect(screen.getByText("3 draft strokes")).toBeInTheDocument();
    expect(captured).toEqual([1, 2, 3]);
    expect(released).toEqual([1, 2, 3]);

    await user.click(screen.getByRole("button", { name: "Finish sketch" }));

    expect(completed).toHaveLength(1);
    expect(completed[0]?.strokes).toHaveLength(3);
    expect(completed[0]?.strokes[0]?.points).toEqual([
      { x: 20, y: 20 },
      { x: 100, y: 50 },
      { x: 200, y: 100 },
    ]);
    expect(completed[0]?.strokes[1]?.points).toEqual([
      { x: 40, y: 140 },
      { x: 120, y: 150 },
      { x: 220, y: 160 },
    ]);
    expect(completed[0]?.strokes[2]?.points).toEqual([
      { x: 60, y: 180, pressure: 0.2 },
      { x: 140, y: 190, pressure: 0.7 },
      { x: 240, y: 200, pressure: 0.5 },
    ]);
    expect(inputSources).toEqual(["stylus"]);
    expect(sketchPayloadSchema.safeParse(completed[0]).success).toBe(true);
  });

  it("clamps out-of-bounds pointer movement to the world-space draft", async () => {
    const user = userEvent.setup();
    const completed: SketchPayload[] = [];
    const { container } = render(
      <SketchComposer
        width={WORLD_WIDTH}
        height={WORLD_HEIGHT}
        onDone={(payload) => completed.push(payload)}
        onCancel={() => undefined}
      />,
    );
    const { surface } = prepareSurface(container);

    drawStroke(surface, {
      pointerId: 4,
      pointerType: "pen",
      from: [50, 25],
      through: [200, 100],
      to: [350, 175],
    });
    await user.click(screen.getByRole("button", { name: "Finish sketch" }));

    expect(completed[0]?.strokes[0]?.points).toEqual([
      { x: 0, y: 0 },
      { x: 200, y: 100 },
      { x: 400, y: 200 },
    ]);
    expect(sketchPayloadSchema.safeParse(completed[0]).success).toBe(true);
  });

  it("drops a tap instead of emitting a schema-invalid one-point stroke", () => {
    const completed: SketchPayload[] = [];
    const { container } = render(
      <SketchComposer
        width={WORLD_WIDTH}
        height={WORLD_HEIGHT}
        onDone={(payload) => completed.push(payload)}
        onCancel={() => undefined}
      />,
    );
    const { surface } = prepareSurface(container);

    fireEvent.pointerDown(surface, {
      pointerId: 5,
      pointerType: "touch",
      clientX: 160,
      clientY: 90,
    });
    fireEvent.pointerUp(surface, {
      pointerId: 5,
      pointerType: "touch",
      clientX: 160,
      clientY: 90,
    });

    expect(screen.getByText("0 draft strokes")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Finish sketch" })).toBeDisabled();
    expect(completed).toEqual([]);
  });

  it("erases only a draft stroke whose segment intersects the eraser", async () => {
    const user = userEvent.setup();
    const completed: SketchPayload[] = [];
    const { container } = render(
      <SketchComposer
        width={WORLD_WIDTH}
        height={WORLD_HEIGHT}
        onDone={(payload) => completed.push(payload)}
        onCancel={() => undefined}
      />,
    );
    const { surface } = prepareSurface(container);
    drawStroke(surface, {
      pointerId: 6,
      pointerType: "pen",
      from: [110, 70],
      through: [290, 70],
      to: [290, 70],
    });
    drawStroke(surface, {
      pointerId: 7,
      pointerType: "pen",
      from: [110, 130],
      through: [290, 130],
      to: [290, 130],
    });
    expect(screen.getByText("2 draft strokes")).toBeInTheDocument();
    expect(completed).toEqual([]);

    await user.click(screen.getByRole("button", { name: "Erase mode" }));
    expect(screen.getByRole("button", { name: "Erase mode" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    fireEvent.pointerDown(surface, {
      pointerId: 8,
      pointerType: "touch",
      clientX: 200,
      clientY: 70,
    });
    fireEvent.pointerUp(surface, {
      pointerId: 8,
      pointerType: "touch",
      clientX: 200,
      clientY: 70,
    });

    expect(screen.getByText("1 draft stroke")).toBeInTheDocument();
    expect(completed).toEqual([]);
    await user.click(screen.getByRole("button", { name: "Finish sketch" }));
    expect(completed[0]?.strokes).toHaveLength(1);
    expect(completed[0]?.strokes[0]?.points).toEqual([
      { x: 20, y: 160 },
      { x: 380, y: 160 },
    ]);
    expect(sketchPayloadSchema.safeParse(completed[0]).success).toBe(true);
  });

  it("clears the draft without emitting a completed payload", async () => {
    const user = userEvent.setup();
    const completed: SketchPayload[] = [];
    const { container } = render(
      <SketchComposer
        width={WORLD_WIDTH}
        height={WORLD_HEIGHT}
        onDone={(payload) => completed.push(payload)}
        onCancel={() => undefined}
      />,
    );
    const { surface } = prepareSurface(container);
    drawStroke(surface, {
      pointerId: 9,
      pointerType: "mouse",
      from: [120, 80],
      through: [180, 100],
      to: [220, 120],
    });

    await user.click(screen.getByRole("button", { name: "Clear sketch" }));

    expect(screen.getByText("0 draft strokes")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Finish sketch" })).toBeDisabled();
    expect(completed).toEqual([]);
  });

  it("supports keyboard cancellation without emitting a sketch payload", async () => {
    const user = userEvent.setup();
    const completed: SketchPayload[] = [];
    let cancellations = 0;
    const { container } = render(
      <SketchComposer
        width={WORLD_WIDTH}
        height={WORLD_HEIGHT}
        onDone={(payload) => completed.push(payload)}
        onCancel={() => {
          cancellations += 1;
        }}
      />,
    );
    const { surface } = prepareSurface(container);
    drawStroke(surface, {
      pointerId: 10,
      pointerType: "stylus",
      from: [120, 80],
      through: [180, 100],
      to: [220, 120],
    });
    const cancel = screen.getByRole("button", { name: "Cancel sketch" });

    cancel.focus();
    await user.keyboard("{Enter}");

    expect(cancellations).toBe(1);
    expect(completed).toEqual([]);
  });
});

interface StrokeGesture {
  pointerId: number;
  pointerType: string;
  from: readonly [number, number];
  through: readonly [number, number];
  to: readonly [number, number];
  pressure?: readonly [number, number, number];
}

function drawStroke(surface: SVGSVGElement, gesture: StrokeGesture) {
  fireEvent.pointerDown(surface, {
    pointerId: gesture.pointerId,
    pointerType: gesture.pointerType,
    clientX: gesture.from[0],
    clientY: gesture.from[1],
    pressure: gesture.pressure?.[0] ?? 0,
  });
  fireEvent.pointerMove(surface, {
    pointerId: gesture.pointerId,
    pointerType: gesture.pointerType,
    clientX: gesture.through[0],
    clientY: gesture.through[1],
    pressure: gesture.pressure?.[1] ?? 0,
  });
  fireEvent.pointerUp(surface, {
    pointerId: gesture.pointerId,
    pointerType: gesture.pointerType,
    clientX: gesture.to[0],
    clientY: gesture.to[1],
    pressure: gesture.pressure?.[2] ?? 0,
  });
}

function prepareSurface(container: HTMLElement) {
  const surface = container.querySelector<SVGSVGElement>("svg");
  if (!surface) throw new Error("Sketch surface did not render.");
  const captured: number[] = [];
  const released: number[] = [];
  const held = new Set<number>();
  surface.getBoundingClientRect = () =>
    ({ left: 100, top: 50, width: 200, height: 100 }) as DOMRect;
  surface.setPointerCapture = (pointerId) => {
    captured.push(pointerId);
    held.add(pointerId);
  };
  surface.hasPointerCapture = (pointerId) => held.has(pointerId);
  surface.releasePointerCapture = (pointerId) => {
    released.push(pointerId);
    held.delete(pointerId);
  };
  return { surface, captured, released };
}
