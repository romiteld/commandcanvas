import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { CommandCanvasRoom } from "@/components/command-canvas/command-canvas-room";
import {
  createCanvasStore,
  type CanvasStoreDependencies,
} from "@/lib/canvas/canvas-store";

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
});
