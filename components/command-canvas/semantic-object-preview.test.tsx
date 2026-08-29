import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { SemanticObjectPreview } from "@/components/command-canvas/semantic-object-preview";
import type { CanvasObject } from "@/lib/canvas/object-model";

function persist<T extends CanvasObject>(object: Omit<T, keyof PersistedFields>) {
  return {
    ...object,
    roomId: "room-demo",
    minimized: false,
    pinned: false,
    createdBy: "user-danny",
    createdAt: "2026-08-29T12:00:00.000Z",
    updatedAt: "2026-08-29T12:00:00.000Z",
    deletedAt: null,
    version: 1,
    metadata: {},
    parentId: null,
  } as T;
}

type PersistedFields = Pick<
  CanvasObject,
  | "roomId"
  | "minimized"
  | "pinned"
  | "createdBy"
  | "createdAt"
  | "updatedAt"
  | "deletedAt"
  | "version"
  | "metadata"
  | "parentId"
>;

const geometry = {
  x: 40,
  y: 80,
  width: 560,
  height: 340,
  zIndex: 2,
};

describe("SemanticObjectPreview", () => {
  it("renders a semantic table as an accessible bounded grid", () => {
    const object = persist<Extract<CanvasObject, { type: "data_table" }>>({
      id: "table-launch",
      type: "data_table",
      title: "Launch metrics",
      ...geometry,
      payload: {
        columns: [
          { id: "column-metric", label: "Metric", kind: "text" },
          { id: "column-target", label: "Target", kind: "number" },
        ],
        rows: [{ id: "row-signups", cells: ["Signups", 250] }],
      },
    });

    render(<SemanticObjectPreview object={object} />);

    const table = screen.getByRole("table", { name: "Launch metrics" });
    expect(within(table).getByText("Metric")).toBeVisible();
    expect(within(table).getByText("Signups")).toBeVisible();
    expect(within(table).getByText("250")).toBeVisible();
  });

  it("renders a safe reference with visible source provenance", () => {
    const object = persist<Extract<CanvasObject, { type: "reference_card" }>>({
      id: "reference-research",
      type: "reference_card",
      title: "Hand interaction research",
      ...geometry,
      payload: {
        kind: "article",
        sourceUrl: "https://example.com/research/hand-interaction",
        summary: "A cited source brought into the live canvas.",
        excerpt: "Pinch hysteresis improves acquisition stability.",
      },
    });

    render(<SemanticObjectPreview object={object} />);

    expect(screen.getByText("A cited source brought into the live canvas.")).toBeVisible();
    expect(screen.getByText(/Pinch hysteresis/)).toBeVisible();
    expect(screen.getByText("example.com")).toBeVisible();
  });

  it("renders decisions and action metadata without turning them into generic notes", () => {
    const object = persist<Extract<CanvasObject, { type: "meeting_card" }>>({
      id: "meeting-action",
      type: "meeting_card",
      title: "Verify browser behavior",
      ...geometry,
      payload: {
        kind: "action_item",
        body: "Verify the public room in the target browsers.",
        bullets: ["Chrome", "ChatGPT built-in browser"],
        owner: "Danny",
        dueDate: "2026-09-03",
        status: "open",
      },
    });

    render(<SemanticObjectPreview object={object} />);

    expect(screen.getByText("ACTION ITEM")).toBeVisible();
    expect(screen.getByText("Danny")).toBeVisible();
    expect(screen.getByText("2026-09-03")).toBeVisible();
    expect(screen.getByText("ChatGPT built-in browser")).toBeVisible();
  });
});
