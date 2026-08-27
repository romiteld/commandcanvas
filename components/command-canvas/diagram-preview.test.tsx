import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DiagramPreview } from "@/components/command-canvas/diagram-preview";

const payload = {
  kind: "architecture" as const,
  sourceSketchId: "sketch-source",
  interpretationSummary: "Browser to API to durable data.",
  nodes: [
    {
      id: "node-browser",
      label: "Browser",
      kind: "client" as const,
      x: 0,
      y: 0,
      width: 140,
      height: 64,
    },
    {
      id: "node-api",
      label: "Command API",
      kind: "service" as const,
      x: 240,
      y: 0,
      width: 160,
      height: 64,
    },
    {
      id: "node-db",
      label: "Supabase",
      kind: "database" as const,
      x: 480,
      y: 0,
      width: 150,
      height: 64,
    },
  ],
  edges: [
    {
      id: "edge-browser-api",
      from: "node-browser",
      to: "node-api",
      label: "semantic intent",
    },
    { id: "edge-api-db", from: "node-api", to: "node-db" },
  ],
};

describe("DiagramPreview", () => {
  it("renders structured nodes and directed edges as an accessible SVG", () => {
    const { container } = render(<DiagramPreview payload={payload} />);

    expect(
      screen.getByRole("img", {
        name: "Architecture diagram: Browser to API to durable data.",
      }),
    ).toBeVisible();
    expect(screen.getByText("Browser")).toBeVisible();
    expect(screen.getByText("Command API")).toBeVisible();
    expect(screen.getByText("Supabase")).toBeVisible();
    expect(screen.getByText("semantic intent")).toBeVisible();
    expect(container.querySelectorAll("[data-diagram-edge]")).toHaveLength(2);
    expect(container.querySelectorAll("[data-diagram-node]")).toHaveLength(3);
  });

  it("uses bounds derived from the model layout rather than fixed canvas coordinates", () => {
    const { container } = render(<DiagramPreview payload={payload} />);
    const svg = container.querySelector("svg");

    expect(svg?.getAttribute("viewBox")).toBe("-28 -28 686 120");
  });
});
