import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { CommandCanvasRoom } from "@/components/command-canvas/command-canvas-room";
import {
  createCanvasStore,
  type CanvasStoreDependencies,
} from "@/lib/canvas/canvas-store";
import type {
  CanvasCommand,
  CanvasCommandSource,
} from "@/lib/canvas/command-engine";

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

describe("CommandCanvasRoom", () => {
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
