import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DiagramPreview } from "@/components/command-canvas/diagram-preview";
import type { DiagramPayload } from "@/lib/canvas/object-model";

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

  it("renders a semantic pie chart with one visible segment and label per value", () => {
    const chart = {
      kind: "pie_chart",
      sourceSketchId: "sketch-market-share",
      interpretationSummary: "A three-part share breakdown.",
      chart: {
        title: "Market share",
        xAxisLabel: null,
        yAxisLabel: null,
        series: [
          {
            id: "series-share",
            label: "Share",
            points: [
              { label: "North", value: 50 },
              { label: "South", value: 30 },
              { label: "West", value: 20 },
            ],
          },
        ],
      },
    } satisfies DiagramPayload;

    const { container } = render(<DiagramPreview payload={chart} />);

    expect(
      screen.getByRole("img", {
        name: "Pie chart: Market share. A three-part share breakdown.",
      }),
    ).toBeVisible();
    expect(container.querySelectorAll("[data-chart-segment]")).toHaveLength(3);
    expect(screen.getByText("North · 50")).toBeVisible();
    expect(screen.getByText("South · 30")).toBeVisible();
    expect(screen.getByText("West · 20")).toBeVisible();
  });

  it("renders a grouped bar for every validated series point", () => {
    const chart = {
      kind: "bar_chart",
      sourceSketchId: "sketch-tickets",
      interpretationSummary: "Ticket counts by team.",
      chart: {
        title: "Tickets",
        xAxisLabel: "Team",
        yAxisLabel: "Count",
        series: [
          {
            id: "series-open",
            label: "Open",
            points: [
              { label: "Design", value: 8 },
              { label: "Engineering", value: 15 },
            ],
          },
        ],
      },
    } satisfies DiagramPayload;

    const { container } = render(<DiagramPreview payload={chart} />);

    expect(
      screen.getByRole("img", {
        name: "Bar chart: Tickets. Ticket counts by team.",
      }),
    ).toBeVisible();
    expect(container.querySelectorAll("[data-chart-bar]")).toHaveLength(2);
    expect(screen.getByText("Team")).toBeVisible();
    expect(screen.getByText("Count")).toBeVisible();
  });

  it("renders each line series as a path with visible data points", () => {
    const chart = {
      kind: "line_chart",
      sourceSketchId: "sketch-signups",
      interpretationSummary: "Signups increase over three weeks.",
      chart: {
        title: "Weekly signups",
        xAxisLabel: "Week",
        yAxisLabel: "Signups",
        series: [
          {
            id: "series-signups",
            label: "Signups",
            points: [
              { label: "W1", value: 12 },
              { label: "W2", value: 18 },
              { label: "W3", value: 27 },
            ],
          },
        ],
      },
    } satisfies DiagramPayload;

    const { container } = render(<DiagramPreview payload={chart} />);

    expect(
      screen.getByRole("img", {
        name: "Line chart: Weekly signups. Signups increase over three weeks.",
      }),
    ).toBeVisible();
    expect(container.querySelectorAll("[data-chart-line]")).toHaveLength(1);
    expect(container.querySelectorAll("[data-chart-point]")).toHaveLength(3);
    expect(screen.getByText("W3")).toBeVisible();
  });
});
