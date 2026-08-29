import { describe, expect, it } from "vitest";

import type { PacketContentSnapshot } from "@/lib/packets/contracts";
import {
  createPacketPresentation,
  renderPacketPresentationHtml,
  renderPacketPresentationText,
} from "@/lib/packets/presentation";

const completeSnapshot: PacketContentSnapshot = {
  title: "Product planning packet",
  content: {
    schemaVersion: 1,
    roomName: "Product planning",
    sourceRevision: 42,
    objects: [
      {
        objectId: "note-launch",
        objectType: "note",
        title: "Launch decision",
        payload: { text: "Ship the shared workspace.", tone: "sky" },
      },
      {
        objectId: "board-launch",
        objectType: "task_board",
        title: "Launch board",
        payload: {
          columns: [
            {
              id: "column-todo",
              title: "To do",
              tasks: [
                {
                  id: "task-browser",
                  title: "Verify the browser flow",
                  owner: "Danny",
                  dueDate: "2026-09-01",
                  priority: "high",
                },
              ],
            },
          ],
        },
      },
      {
        objectId: "schedule-launch",
        objectType: "schedule",
        title: "Launch schedule",
        payload: {
          timezone: "America/New_York",
          days: [
            {
              date: "2026-09-01",
              label: "Tuesday",
              entries: [
                {
                  id: "entry-demo",
                  time: "14:30",
                  title: "Record the demo",
                  owner: "Sarah",
                },
              ],
            },
          ],
        },
      },
      {
        objectId: "diagram-system",
        objectType: "diagram",
        title: "System flow",
        payload: {
          kind: "architecture",
          interpretationSummary: "The browser writes through the API.",
          nodes: [
            {
              id: "node-browser",
              label: "Browser",
              kind: "client",
              x: 0,
              y: 0,
              width: 160,
              height: 80,
            },
            {
              id: "node-api",
              label: "API",
              kind: "service",
              x: 240,
              y: 0,
              width: 160,
              height: 80,
            },
          ],
          edges: [
            {
              id: "edge-browser-api",
              from: "node-browser",
              to: "node-api",
              label: "HTTPS",
            },
          ],
        },
      },
      {
        objectId: "diagram-progress",
        objectType: "diagram",
        title: "Launch readiness",
        payload: {
          kind: "bar_chart",
          interpretationSummary: "Readiness increased this week.",
          chart: {
            title: "Readiness by day",
            xAxisLabel: "Day",
            yAxisLabel: "Percent",
            series: [
              {
                id: "series-ready",
                label: "Ready",
                points: [
                  { label: "Monday", value: 60 },
                  { label: "Tuesday", value: 85 },
                ],
              },
            ],
          },
        },
      },
      {
        objectId: "table-risks",
        objectType: "data_table",
        title: "Risk register",
        payload: {
          columns: [
            { id: "column-risk", label: "Risk", kind: "text" },
            { id: "column-score", label: "Score", kind: "number" },
          ],
          rows: [
            { id: "row-camera", cells: ["Camera ergonomics", 3] },
          ],
        },
      },
      {
        objectId: "reference-spec",
        objectType: "reference_card",
        title: "WebMCP specification",
        payload: {
          kind: "article",
          sourceUrl: "https://example.com/spec?version=1&mode=live",
          summary: "The page exposes semantic tools to the agent.",
          excerpt: "Tools operate against the live page session.",
        },
      },
      {
        objectId: "decision-stack",
        objectType: "meeting_card",
        title: "Stack decision",
        payload: {
          kind: "decision",
          body: "Use Supabase Realtime for room collaboration.",
          bullets: ["Presence for participants", "Broadcast for cursors"],
          owner: "Danny",
          dueDate: "2026-09-01",
          status: "confirmed",
        },
      },
    ],
  },
};

describe("meeting packet presentation", () => {
  it("normalizes every packet-safe object into a typed, readable section without changing the snapshot", () => {
    const before = structuredClone(completeSnapshot);

    const presentation = createPacketPresentation(completeSnapshot);

    expect(presentation.sections.map((section) => section.kind)).toEqual([
      "note",
      "task_board",
      "schedule",
      "node_diagram",
      "chart",
      "data_table",
      "reference_card",
      "meeting_card",
    ]);
    expect(presentation).toMatchObject({
      title: "Product planning packet",
      roomName: "Product planning",
      sourceRevision: 42,
    });
    expect(completeSnapshot).toEqual(before);
  });

  it("renders one shared presentation as polished HTML and readable plain text instead of raw payload JSON", () => {
    const presentation = createPacketPresentation(completeSnapshot);

    const html = renderPacketPresentationHtml(presentation);
    const text = renderPacketPresentationText(presentation);

    expect(html).toContain("Product planning packet");
    expect(html).toContain("Launch board");
    expect(html).toContain("Verify the browser flow");
    expect(html).toContain("Browser");
    expect(html).toContain("Readiness by day");
    expect(html).toContain("Value axis: Percent");
    expect(html).toContain("Ready (Percent)");
    expect(html).toContain("<table");
    expect(html).toContain(
      'href="https://example.com/spec?version=1&amp;mode=live"',
    );
    expect(html).not.toContain("<pre");
    expect(html).not.toContain('"schemaVersion"');

    expect(text).toContain("PRODUCT PLANNING PACKET");
    expect(text).toContain("Tuesday, 2026-09-01");
    expect(text).toContain("14:30 - Record the demo - Sarah");
    expect(text).toContain("Browser -> API - HTTPS");
    expect(text).toContain("Monday: 60");
    expect(text).toContain("Value axis: Percent");
    expect(text).toContain("Risk | Score");
    expect(text).toContain("Presence for participants");
    expect(text).not.toContain('"columns"');
  });

  it("escapes every untrusted HTML value and replaces malformed payloads with a non-reflecting fallback", () => {
    const unsafe: PacketContentSnapshot = {
      title: '<img src=x onerror="alert(1)">',
      content: {
        schemaVersion: 1,
        roomName: "<script>alert('room')</script>",
        sourceRevision: 7,
        objects: [
          {
            objectId: "note-unsafe",
            objectType: "note",
            title: "<b>Unsafe title</b>",
            payload: {
              text: "<script>alert('note')</script>",
              tone: "sky",
            },
          },
          {
            objectId: "reference-invalid",
            objectType: "reference_card",
            title: "Malformed reference",
            payload: {
              kind: "article",
              sourceUrl: "javascript:alert('link')",
              summary: "Do not reflect this invalid payload marker.",
              excerpt: null,
            },
          },
        ],
      },
    };

    const presentation = createPacketPresentation(unsafe);
    const html = renderPacketPresentationHtml(presentation);
    const text = renderPacketPresentationText(presentation);

    expect(presentation.sections[1]).toMatchObject({ kind: "fallback" });
    expect(html).not.toMatch(/<script|<img|<b>|javascript:/i);
    expect(html).toContain("&lt;script&gt;alert(&#39;note&#39;)&lt;/script&gt;");
    expect(html).toContain("&lt;b&gt;Unsafe title&lt;/b&gt;");
    expect(html).not.toContain("invalid payload marker");
    expect(text).toContain("Content unavailable in this packet preview.");
    expect(text).not.toContain("invalid payload marker");
  });
});
