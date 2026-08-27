import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { CommandCanvasRoom } from "@/components/command-canvas/command-canvas-room";
import {
  createCanvasStore,
  type CanvasStoreDependencies,
} from "@/lib/canvas/canvas-store";
import type {
  CanvasCommand,
  CanvasCommandSource,
} from "@/lib/canvas/command-engine";
import type {
  HandTrackingController,
  HandTrackingObservation,
  HandTrackingStatus,
} from "@/lib/gesture/hand-tracking-controller";

function dependencies(): CanvasStoreDependencies {
  let id = 0;
  let second = 0;
  return {
    actor: {
      id: "participant-host",
      displayName: "Danny",
      type: "human",
    },
    createId: (prefix) => `${prefix}-${++id}`,
    now: () => `2026-08-27T14:00:${String(second++).padStart(2, "0")}.000Z`,
  };
}

function seedSketch(store: ReturnType<typeof createCanvasStore>) {
  store.getState().dispatch(
    {
      type: "object.create",
      object: {
        id: "sketch-source",
        type: "sketch",
        title: "Rough architecture",
        x: 20,
        y: 30,
        width: 360,
        height: 220,
        zIndex: 1,
        payload: {
          strokes: [
            {
              id: "stroke-source",
              color: "#12233d",
              width: 5,
              points: [
                { x: 12, y: 20 },
                { x: 100, y: 30 },
              ],
            },
          ],
        },
      },
    },
    "system",
  );
}

function fakeHandController() {
  let status: HandTrackingStatus = { state: "off" };
  const statusListeners = new Set<(next: HandTrackingStatus) => void>();
  const observationListeners = new Set<
    (next: HandTrackingObservation) => void
  >();
  const controller: HandTrackingController = {
    getStatus: () => status,
    subscribeStatus(listener) {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    },
    subscribeObservations(listener) {
      observationListeners.add(listener);
      return () => observationListeners.delete(listener);
    },
    start: vi.fn(async () => undefined),
    stop: vi.fn(),
  };
  return {
    controller,
    setStatus(next: HandTrackingStatus) {
      status = next;
      statusListeners.forEach((listener) => listener(next));
    },
    emit(next: HandTrackingObservation) {
      observationListeners.forEach((listener) => listener(next));
    },
  };
}

function setCanvasBounds(
  container: HTMLElement,
  dimensions: { width: number; height: number } = {
    width: 1_000,
    height: 500,
  },
) {
  const viewport = container.querySelector(".canvas-viewport");
  if (!(viewport instanceof HTMLElement))
    throw new Error("Canvas viewport fixture was not rendered.");
  vi.spyOn(viewport, "getBoundingClientRect").mockReturnValue({
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: dimensions.width,
    bottom: dimensions.height,
    width: dimensions.width,
    height: dimensions.height,
    toJSON: () => ({}),
  });
}

describe("CommandCanvasRoom", () => {
  it("renders a host-controlled meeting packet workflow inside the command rail", () => {
    const store = createCanvasStore("room-local", dependencies());
    render(
      <CommandCanvasRoom
        store={store}
        meetingPacketPanel={
          <section aria-label="Meeting packet workflow">Packet review</section>
        }
      />,
    );

    expect(screen.getByLabelText("Meeting packet workflow")).toBeVisible();
    expect(screen.getByText("Packet review")).toBeVisible();
  });

  it("commits an index-finger trace through the canonical gesture command path", async () => {
    const user = userEvent.setup();
    const hand = fakeHandController();
    const store = createCanvasStore("room-local", dependencies());
    const { container } = render(
      <CommandCanvasRoom
        store={store}
        createHandTrackingController={() => hand.controller}
      />,
    );
    setCanvasBounds(container);
    await user.click(screen.getByRole("button", { name: "Enable hand input" }));
    hand.setStatus({ state: "ready" });
    expect(await screen.findAllByText("Hand input ready · local only")).toHaveLength(2);
    expect(screen.queryByText("Camera off")).toBeNull();

    hand.emit({
      mode: "point",
      pointer: { x: 0.2, y: 0.3 },
      confidence: 0.96,
      timestamp: 1_000,
    });
    hand.emit({
      mode: "point",
      pointer: { x: 0.26, y: 0.36 },
      confidence: 0.96,
      timestamp: 1_016,
    });
    hand.emit({ mode: "idle", timestamp: 1_032 });

    const sketch = Object.values(store.getState().canvas.objects).find(
      (object) => object.type === "sketch",
    );
    expect(sketch).toMatchObject({
      type: "sketch",
      title: "Finger sketch",
      x: 184,
      y: 134,
      payload: {
        strokes: [
          {
            points: [
              { x: 16, y: 16 },
              { x: 76, y: 46 },
            ],
          },
        ],
      },
    });
    expect(store.getState().canvas.receipts.at(-1)?.source).toBe("gesture");
  });

  it("commits a pinch drag as one canonical object transform", async () => {
    const user = userEvent.setup();
    const hand = fakeHandController();
    const store = createCanvasStore("room-local", dependencies());
    store.getState().dispatch(
      {
        type: "object.create",
        object: {
          id: "note-spatial",
          type: "note",
          title: "Spatial note",
          x: 200,
          y: 150,
          width: 180,
          height: 140,
          zIndex: 1,
          payload: { text: "Move me", tone: "sky" },
        },
      },
      "system",
    );
    const { container } = render(
      <CommandCanvasRoom
        store={store}
        createHandTrackingController={() => hand.controller}
      />,
    );
    setCanvasBounds(container);
    await user.click(screen.getByRole("button", { name: "Enable hand input" }));
    hand.setStatus({ state: "ready" });

    hand.emit({
      mode: "pinch",
      pointer: { x: 0.25, y: 0.4 },
      confidence: 0.96,
      timestamp: 1_000,
    });
    hand.emit({
      mode: "pinch",
      pointer: { x: 0.35, y: 0.5 },
      confidence: 0.96,
      timestamp: 1_016,
    });
    hand.emit({ mode: "idle", timestamp: 1_032 });

    expect(store.getState().canvas.objects["note-spatial"]).toMatchObject({
      x: 300,
      y: 200,
      version: 2,
    });
    expect(store.getState().canvas.receipts.at(-1)).toMatchObject({
      source: "gesture",
      action: "transform",
      affectedObjectIds: ["note-spatial"],
    });
  });

  it("creates a semantic note through the command pipeline and shows its receipt", async () => {
    const user = userEvent.setup();
    const store = createCanvasStore("room-local", dependencies());
    render(<CommandCanvasRoom store={store} />);

    expect(
      screen.getByRole("heading", { name: "Spatial command surface" }),
    ).toBeInTheDocument();
    expect(screen.getByText("No objects yet")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Create note" }));

    expect(
      screen.getByRole("button", { name: "Select New thought" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Danny created “New thought”."),
    ).toBeInTheDocument();
    expect(store.getState().canvas.revision).toBe(1);
  });

  it("creates a task board from the object toolbar and renders its columns and tasks", async () => {
    const user = userEvent.setup();
    const store = createCanvasStore("room-local", dependencies());
    render(<CommandCanvasRoom store={store} />);

    await user.click(screen.getByRole("button", { name: "Create task board" }));

    expect(
      screen.getByRole("button", { name: "Select Launch board" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Next")).toBeInTheDocument();
    expect(screen.getByText("Confirm launch date")).toBeInTheDocument();
    expect(screen.getByText("In progress")).toBeInTheDocument();
    expect(screen.getByText("Polish the demo path")).toBeInTheDocument();
    expect(Object.values(store.getState().canvas.objects)[0]?.type).toBe(
      "task_board",
    );
  });

  it("creates a schedule from the object toolbar and renders dated commitments", async () => {
    const user = userEvent.setup();
    const store = createCanvasStore("room-local", dependencies());
    render(<CommandCanvasRoom store={store} />);

    await user.click(screen.getByRole("button", { name: "Create schedule" }));

    expect(
      screen.getByRole("button", { name: "Select Next week" }),
    ).toBeInTheDocument();
    expect(screen.getByText("Mon, Aug 31")).toBeInTheDocument();
    expect(screen.getByText("09:30")).toBeInTheDocument();
    expect(screen.getByText("Review WebMCP flow")).toBeInTheDocument();
    expect(screen.getByText("America/New_York")).toBeInTheDocument();
    expect(Object.values(store.getState().canvas.objects)[0]?.type).toBe(
      "schedule",
    );
  });

  it("places toolbar-created objects at their screen anchors after viewport translation and scaling", async () => {
    const user = userEvent.setup();
    const store = createCanvasStore("room-live", dependencies());
    store.getState().setViewport({ x: 40, y: -20, scale: 2 });
    const received: CanvasCommand[] = [];
    render(
      <CommandCanvasRoom
        store={store}
        onCommand={(command) => {
          received.push(command);
        }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Create note" }));
    await user.click(screen.getByRole("button", { name: "Create task board" }));
    await user.click(screen.getByRole("button", { name: "Create schedule" }));

    expect(received).toHaveLength(3);
    expect(received[0]).toMatchObject({
      type: "object.create",
      object: { type: "note", x: 60, y: 75 },
    });
    expect(received[1]).toMatchObject({
      type: "object.create",
      object: { type: "task_board", x: 50, y: 65 },
    });
    expect(received[2]).toMatchObject({
      type: "object.create",
      object: { type: "schedule", x: 70, y: 80 },
    });
  });

  it("places a finished sketch at its screen anchor after viewport translation and scaling", async () => {
    const user = userEvent.setup();
    const store = createCanvasStore("room-live", dependencies());
    store.getState().setViewport({ x: 40, y: -20, scale: 2 });
    const received: CanvasCommand[] = [];
    render(
      <CommandCanvasRoom
        store={store}
        onCommand={(command) => {
          received.push(command);
        }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Create sketch" }));
    const surface = screen.getByRole("img", {
      name: "Sketch draft surface",
    }) as unknown as SVGSVGElement;
    surface.getBoundingClientRect = () =>
      ({ left: 100, top: 50, width: 440, height: 280 }) as DOMRect;
    surface.setPointerCapture = () => undefined;
    surface.hasPointerCapture = () => false;

    fireEvent.pointerDown(surface, {
      pointerId: 15,
      pointerType: "mouse",
      clientX: 120,
      clientY: 90,
    });
    fireEvent.pointerMove(surface, {
      pointerId: 15,
      pointerType: "mouse",
      clientX: 240,
      clientY: 150,
    });
    fireEvent.pointerUp(surface, {
      pointerId: 15,
      pointerType: "mouse",
      clientX: 360,
      clientY: 210,
    });
    await user.click(screen.getByRole("button", { name: "Finish sketch" }));

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      type: "object.create",
      object: { type: "sketch", x: 70, y: 75 },
    });
  });

  it("renders preserved sketch geometry and its structured diagram as live objects", () => {
    const store = createCanvasStore("room-local", dependencies());
    store.getState().dispatch(
      {
        type: "object.create",
        object: {
          id: "sketch-source",
          type: "sketch",
          title: "Rough architecture",
          x: 20,
          y: 30,
          width: 360,
          height: 220,
          zIndex: 1,
          payload: {
            strokes: [
              {
                id: "stroke-source",
                color: "#12233d",
                width: 5,
                points: [
                  { x: 12, y: 20 },
                  { x: 100, y: 30 },
                ],
              },
            ],
          },
        },
      },
      "system",
    );
    store.getState().dispatch(
      {
        type: "object.create",
        object: {
          id: "diagram-result",
          type: "diagram",
          title: "Usable architecture",
          x: 420,
          y: 30,
          width: 520,
          height: 280,
          zIndex: 2,
          payload: {
            kind: "architecture",
            sourceSketchId: "sketch-source",
            interpretationSummary: "Browser to API.",
            nodes: [
              {
                id: "node-browser",
                label: "Browser",
                kind: "client",
                x: 20,
                y: 50,
                width: 140,
                height: 64,
              },
              {
                id: "node-api",
                label: "API",
                kind: "service",
                x: 240,
                y: 50,
                width: 140,
                height: 64,
              },
            ],
            edges: [
              {
                id: "edge-browser-api",
                from: "node-browser",
                to: "node-api",
              },
            ],
          },
        },
      },
      "system",
    );

    render(<CommandCanvasRoom store={store} />);

    expect(
      screen.getByRole("img", {
        name: "Original rough sketch: Rough architecture",
      }),
    ).toBeVisible();
    expect(
      screen.getByRole("img", {
        name: "Architecture diagram: Browser to API.",
      }),
    ).toBeVisible();
    expect(store.getState().canvas.objects["sketch-source"]?.deletedAt).toBeNull();
  });

  it("offers sketch interpretation only for the selected active sketch and selects its returned diagram", async () => {
    const user = userEvent.setup();
    const store = createCanvasStore("room-live", dependencies());
    seedSketch(store);
    const transformSketch = vi.fn().mockResolvedValue({
      ok: true,
      diagramObjectId: "diagram-result",
      receiptId: "receipt-transform",
      revision: 2,
      provider: "openai",
      model: "gpt-5.6-terra",
    });
    render(
      <CommandCanvasRoom
        store={store}
        onTransformSketch={transformSketch}
      />,
    );

    expect(screen.queryByRole("button", { name: "Make usable" })).toBeNull();
    await user.click(
      screen.getByRole("button", { name: "Select Rough architecture" }),
    );
    await user.click(screen.getByRole("button", { name: "Make usable" }));

    expect(transformSketch).toHaveBeenCalledExactlyOnceWith({
      sketchObjectId: "sketch-source",
      instruction: "Make this sketch usable as a clean architecture diagram.",
      outputKind: "architecture",
      source: "typed",
    });
    await waitFor(() => {
      expect(store.getState().selectedObjectId).toBe("diagram-result");
    });
    expect(store.getState().canvas.objects["sketch-source"]?.deletedAt).toBeNull();
  });

  it.each([360, 420, 480])(
    "reveals the preserved sketch and authoritative diagram fully at a %ipx canvas width",
    async (screenWidth) => {
    const user = userEvent.setup();
    const store = createCanvasStore("room-live", dependencies());
    seedSketch(store);
    const { container } = render(
      <CommandCanvasRoom
        store={store}
        onTransformSketch={async () => {
          const applied = store.getState().dispatch(
            {
              type: "object.create",
              object: {
                id: "diagram-result",
                type: "diagram",
                title: "Structured architecture",
                x: 444,
                y: 30,
                width: 620,
                height: 360,
                zIndex: 2,
                payload: {
                  kind: "architecture",
                  sourceSketchId: "sketch-source",
                  interpretationSummary: "Browser to API.",
                  nodes: [
                    {
                      id: "node-browser",
                      label: "Browser",
                      kind: "client",
                      x: 24,
                      y: 24,
                      width: 140,
                      height: 64,
                    },
                  ],
                  edges: [],
                },
              },
            },
            "typed",
          );
          if (!applied.ok) throw new Error("Diagram fixture was refused.");
          return {
            ok: true,
            diagramObjectId: "diagram-result",
            receiptId: applied.receipt.id,
            revision: applied.state.revision,
            provider: "openai" as const,
            model: "gpt-5.6-terra" as const,
          };
        }}
      />,
    );
    setCanvasBounds(container, { width: screenWidth, height: 450 });

    await user.click(
      screen.getByRole("button", { name: "Select Rough architecture" }),
    );
    await user.click(screen.getByRole("button", { name: "Make usable" }));

    await waitFor(() => {
      expect(store.getState().selectedObjectId).toBe("diagram-result");
    });
    const fitted = store.getState().viewport;
    const source = { x: 20, y: 30, width: 360, height: 220 };
    const diagram = { x: 444, y: 30, width: 620, height: 360 };
    for (const rectangle of [source, diagram]) {
      expect(rectangle.x * fitted.scale + fitted.x).toBeGreaterThanOrEqual(0);
      expect(rectangle.y * fitted.scale + fitted.y).toBeGreaterThanOrEqual(0);
      expect(
        (rectangle.x + rectangle.width) * fitted.scale + fitted.x,
      ).toBeLessThanOrEqual(screenWidth + 1e-6);
      expect(
        (rectangle.y + rectangle.height) * fitted.scale + fitted.y,
      ).toBeLessThanOrEqual(450 + 1e-6);
    }
    expect(store.getState().canvas.objects["sketch-source"]?.deletedAt).toBeNull();
    },
  );

  it("labels sketch interpretation honestly and disables conflicting actions while pending", async () => {
    const user = userEvent.setup();
    const store = createCanvasStore("room-live", dependencies());
    seedSketch(store);
    let finish!: (result: {
      ok: false;
      code: string;
      message: string;
    }) => void;
    const pending = new Promise<{
      ok: false;
      code: string;
      message: string;
    }>((resolve) => {
      finish = resolve;
    });
    render(
      <CommandCanvasRoom
        store={store}
        onTransformSketch={() => pending}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: "Select Rough architecture" }),
    );

    await user.click(screen.getByRole("button", { name: "Make usable" }));

    expect(
      screen.getByRole("button", { name: "Interpreting sketch…" }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: "Create note" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Pin object" })).toBeDisabled();

    finish({
      ok: false,
      code: "provider_unavailable",
      message: "Sketch interpretation is temporarily unavailable.",
    });
    expect(
      await screen.findByRole("button", { name: "Make usable" }),
    ).toBeEnabled();
  });

  it("surfaces sketch-transform refusal without implying that a diagram was created", async () => {
    const user = userEvent.setup();
    const store = createCanvasStore("room-live", dependencies());
    seedSketch(store);
    render(
      <CommandCanvasRoom
        store={store}
        onTransformSketch={async () => ({
          ok: false,
          code: "source_version_changed",
          message: "The sketch changed while it was being interpreted.",
        })}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: "Select Rough architecture" }),
    );

    await user.click(screen.getByRole("button", { name: "Make usable" }));

    expect(await screen.findByText("Sketch interpretation failed")).toBeVisible();
    expect(
      screen.getByText("The sketch changed while it was being interpreted."),
    ).toBeVisible();
    expect(store.getState().selectedObjectId).toBe("sketch-source");
    expect(Object.values(store.getState().canvas.objects)).toHaveLength(1);
  });

  it("offers an explicit prepared interpretation after failure and records it honestly", async () => {
    const user = userEvent.setup();
    const store = createCanvasStore("room-live", dependencies());
    seedSketch(store);
    render(
      <CommandCanvasRoom
        store={store}
        onTransformSketch={async () => ({
          ok: false,
          code: "provider_unavailable",
          message: "Sketch interpretation is temporarily unavailable.",
        })}
      />,
    );
    await user.click(
      screen.getByRole("button", { name: "Select Rough architecture" }),
    );

    expect(
      screen.queryByRole("button", {
        name: "Load prepared demo interpretation",
      }),
    ).toBeNull();
    await user.click(screen.getByRole("button", { name: "Make usable" }));

    expect(
      await screen.findByRole("button", {
        name: "Load prepared demo interpretation",
      }),
    ).toBeEnabled();
    await user.click(
      screen.getByRole("button", {
        name: "Load prepared demo interpretation",
      }),
    );

    await waitFor(() => {
      expect(
        Object.values(store.getState().canvas.objects).some(
          (object) => object.type === "diagram",
        ),
      ).toBe(true);
    });
    const diagram = Object.values(store.getState().canvas.objects).find(
      (object) => object.type === "diagram",
    );
    expect(diagram).toMatchObject({
      type: "diagram",
      title: "Prepared demo fallback",
      x: 444,
      y: 30,
      payload: {
        kind: "architecture",
        sourceSketchId: "sketch-source",
        interpretationSummary:
          "Prepared demo fallback: not generated by the vision model.",
      },
    });
    expect(store.getState().canvas.objects["sketch-source"]?.deletedAt).toBeNull();
    expect(store.getState().canvas.receipts.at(-1)).toMatchObject({
      action: "create",
      source: "typed",
      description: 'Danny created “Prepared demo fallback”.',
      affectedObjectIds: [diagram?.id],
    });
    expect(JSON.stringify(diagram)).not.toMatch(/openai/i);
    expect(
      screen.queryByRole("button", {
        name: "Load prepared demo interpretation",
      }),
    ).toBeNull();
  });

  it("commits a pointer-authored sketch atomically through the same command pipeline", async () => {
    const user = userEvent.setup();
    const store = createCanvasStore("room-live", dependencies());
    const received: Array<{
      command: CanvasCommand;
      source: CanvasCommandSource;
    }> = [];
    render(
      <CommandCanvasRoom
        store={store}
        onCommand={(command, source) => {
          received.push({ command, source });
        }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Create sketch" }));
    expect(
      screen.getByRole("dialog", { name: "Draw a rough sketch" }),
    ).toBeVisible();
    const surface = screen.getByRole("img", {
      name: "Sketch draft surface",
    }) as unknown as SVGSVGElement;
    surface.getBoundingClientRect = () =>
      ({ left: 100, top: 50, width: 440, height: 280 }) as DOMRect;
    surface.setPointerCapture = () => undefined;
    surface.hasPointerCapture = () => false;

    fireEvent.pointerDown(surface, {
      pointerId: 14,
      pointerType: "pen",
      clientX: 120,
      clientY: 90,
      pressure: 0.4,
    });
    fireEvent.pointerMove(surface, {
      pointerId: 14,
      pointerType: "pen",
      clientX: 260,
      clientY: 150,
      pressure: 0.7,
    });
    fireEvent.pointerUp(surface, {
      pointerId: 14,
      pointerType: "pen",
      clientX: 420,
      clientY: 210,
      pressure: 0.5,
    });
    await user.click(screen.getByRole("button", { name: "Finish sketch" }));

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      source: "stylus",
      command: {
        type: "object.create",
        object: {
          type: "sketch",
          title: "Rough architecture",
          payload: { strokes: [{ points: expect.any(Array) }] },
        },
      },
    });
    expect(
      screen.queryByRole("dialog", { name: "Draw a rough sketch" }),
    ).toBeNull();
    expect(store.getState().canvas.revision).toBe(0);
  });

  it("pins the selected object and uses the same universal undo control", async () => {
    const user = userEvent.setup();
    const store = createCanvasStore("room-local", dependencies());
    render(<CommandCanvasRoom store={store} />);
    await user.click(screen.getByRole("button", { name: "Create note" }));
    await user.click(screen.getByRole("button", { name: "Select New thought" }));

    await user.click(screen.getByRole("button", { name: "Pin object" }));

    const object = Object.values(store.getState().canvas.objects)[0];
    expect(object?.pinned).toBe(true);
    expect(screen.getByText("Pinned to canvas")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Undo last change" }));

    expect(store.getState().canvas.objects[object!.id]?.pinned).toBe(false);
    expect(screen.getByText(/Danny undid: Danny pinned/)).toBeInTheDocument();
  });

  it("keeps every future integration visibly honest in local mode", () => {
    const store = createCanvasStore("room-local", dependencies());
    render(<CommandCanvasRoom store={store} />);

    expect(screen.getByText("Local room")).toBeInTheDocument();
    expect(screen.getByText("WebMCP not exercised")).toBeInTheDocument();
    expect(screen.getByText("Realtime not connected")).toBeInTheDocument();
    expect(screen.getByText("Camera off")).toBeInTheDocument();
  });

  it("waits for a remote canonical command without optimistically changing local state", async () => {
    const user = userEvent.setup();
    const store = createCanvasStore("room-live", dependencies());
    const received: Array<{
      command: CanvasCommand;
      source: CanvasCommandSource;
    }> = [];
    let finishCommand!: () => void;
    const commandFinishes = new Promise<void>((resolve) => {
      finishCommand = resolve;
    });

    render(
      <CommandCanvasRoom
        store={store}
        onCommand={(command, source) => {
          received.push({ command, source });
          return commandFinishes;
        }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Create note" }));

    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({
      command: { type: "object.create", object: { type: "note" } },
      source: "pointer",
    });
    expect(store.getState().canvas.revision).toBe(0);
    expect(screen.getByText("Applying command…")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create note" })).toBeDisabled();

    finishCommand();

    await waitFor(() => {
      expect(screen.queryByText("Applying command…")).not.toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Create note" })).toBeEnabled();
    expect(store.getState().canvas.revision).toBe(0);
  });

  it("shows a rejected remote command instead of implying that it succeeded", async () => {
    const user = userEvent.setup();
    const store = createCanvasStore("room-live", dependencies());
    render(
      <CommandCanvasRoom
        store={store}
        onCommand={async () => {
          throw new Error("Canvas changed. Refresh and try again.");
        }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Create schedule" }));

    expect(await screen.findByText("Command refused")).toBeInTheDocument();
    expect(
      screen.getByText("Canvas changed. Refresh and try again."),
    ).toBeInTheDocument();
    expect(store.getState().canvas.revision).toBe(0);
    expect(screen.getByText("No objects yet")).toBeInTheDocument();
  });

  it("routes every toolbar and selected-object mutation through the remote handler", async () => {
    const user = userEvent.setup();
    const store = createCanvasStore("room-live", dependencies());
    store.getState().dispatch(
      {
        type: "object.create",
        object: {
          id: "note-seed",
          type: "note",
          title: "Seed note",
          x: 20,
          y: 30,
          width: 280,
          height: 190,
          zIndex: 1,
          payload: { text: "Seed", tone: "coral" },
        },
      },
      "system",
    );
    const received: CanvasCommand[] = [];
    render(
      <CommandCanvasRoom
        store={store}
        onCommand={(command) => {
          received.push(command);
        }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Create note" }));
    await user.click(screen.getByRole("button", { name: "Create task board" }));
    await user.click(screen.getByRole("button", { name: "Create schedule" }));
    await user.click(screen.getByRole("button", { name: "Select Seed note" }));
    await user.click(screen.getByRole("button", { name: "Pin object" }));
    await user.click(screen.getByRole("button", { name: "Minimize object" }));
    await user.click(screen.getByRole("button", { name: "Move object to trash" }));
    await user.click(screen.getByRole("button", { name: "Undo last change" }));

    expect(received.map((command) => command.type)).toEqual([
      "object.create",
      "object.create",
      "object.create",
      "object.set_flags",
      "object.set_flags",
      "object.discard",
      "history.undo",
    ]);
    expect(received[3]).toMatchObject({ flags: { pinned: true } });
    expect(received[4]).toMatchObject({ flags: { minimized: true } });
    expect(store.getState().canvas.revision).toBe(1);
  });

  it("routes completed drag and resize previews through the remote handler", () => {
    const store = createCanvasStore("room-live", dependencies());
    store.getState().dispatch(
      {
        type: "object.create",
        object: {
          id: "note-seed",
          type: "note",
          title: "Seed note",
          x: 20,
          y: 30,
          width: 280,
          height: 190,
          zIndex: 1,
          payload: { text: "Seed", tone: "coral" },
        },
      },
      "system",
    );
    const received: CanvasCommand[] = [];
    render(
      <CommandCanvasRoom
        store={store}
        onCommand={(command) => {
          received.push(command);
        }}
      />,
    );
    const object = screen.getByRole("button", { name: "Select Seed note" });

    fireEvent.pointerDown(object, {
      pointerId: 11,
      clientX: 100,
      clientY: 100,
    });
    fireEvent.pointerMove(object, {
      pointerId: 11,
      clientX: 130,
      clientY: 150,
    });
    fireEvent.pointerUp(object, {
      pointerId: 11,
      clientX: 130,
      clientY: 150,
    });

    const resize = screen.getByRole("button", { name: "Resize Seed note" });
    fireEvent.pointerDown(resize, {
      pointerId: 12,
      clientX: 200,
      clientY: 200,
    });
    fireEvent.pointerMove(resize, {
      pointerId: 12,
      clientX: 260,
      clientY: 240,
    });
    fireEvent.pointerUp(resize, {
      pointerId: 12,
      clientX: 260,
      clientY: 240,
    });

    expect(received).toEqual([
      {
        type: "object.transform",
        objectId: "note-seed",
        transform: { x: 50, y: 80 },
      },
      {
        type: "object.transform",
        objectId: "note-seed",
        transform: { width: 340, height: 230 },
      },
    ]);
    expect(store.getState().canvas.objects["note-seed"]).toMatchObject({
      x: 20,
      y: 30,
      width: 280,
      height: 190,
    });
    expect(store.getState().canvas.revision).toBe(1);
  });

  it("publishes pointer positions in world coordinates without persisting them", () => {
    const store = createCanvasStore("room-live", dependencies());
    store.getState().setViewport({ x: 40, y: -20, scale: 2 });
    const points: Array<{ x: number; y: number }> = [];
    const { container } = render(
      <CommandCanvasRoom
        store={store}
        onCanvasPointerWorldMove={(point) => points.push(point)}
      />,
    );
    const viewport = container.querySelector<HTMLElement>(".canvas-viewport");
    expect(viewport).not.toBeNull();
    viewport!.getBoundingClientRect = () =>
      ({ left: 100, top: 50, width: 800, height: 600 }) as DOMRect;

    fireEvent.pointerMove(viewport!, { clientX: 300, clientY: 230 });

    expect(points).toEqual([{ x: 80, y: 100 }]);
    expect(store.getState().canvas.revision).toBe(0);
  });

  it("renders live room identity, participant presence, and remote world cursors", () => {
    const store = createCanvasStore("room-live", dependencies());
    store.getState().setViewport({ x: 10, y: 20, scale: 2 });
    const { container } = render(
      <CommandCanvasRoom
        store={store}
        roomLabel="Launch planning"
        roomStatus="live"
        participants={[
          {
            id: "participant-host",
            displayName: "Danny",
            role: "host",
            color: "#ff7657",
          },
          {
            id: "participant-sarah",
            displayName: "Sarah",
            role: "participant",
            color: "#52d1b2",
          },
        ]}
        remoteCursors={[
          {
            participantId: "participant-sarah",
            displayName: "Sarah",
            color: "#52d1b2",
            x: 50,
            y: 75,
          },
        ]}
      />,
    );

    expect(screen.getByText("Launch planning")).toBeInTheDocument();
    expect(screen.getByText("LIVE")).toBeInTheDocument();
    expect(screen.getByLabelText("2 participants present")).toBeInTheDocument();
    expect(screen.getByTitle("Danny · host")).toBeInTheDocument();
    expect(screen.getByTitle("Sarah · participant")).toBeInTheDocument();
    const cursor = container.querySelector<HTMLElement>(
      '[data-remote-cursor="participant-sarah"]',
    );
    expect(cursor).not.toBeNull();
    expect(cursor).toHaveStyle({ left: "110px", top: "170px" });
    expect(cursor?.closest(".canvas-world")).toBeNull();
  });
});
