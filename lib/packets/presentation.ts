import {
  dataTablePayloadSchema,
  diagramPayloadSchema,
  meetingCardPayloadSchema,
  notePayloadSchema,
  referenceCardPayloadSchema,
  schedulePayloadSchema,
  taskBoardPayloadSchema,
} from "@/lib/canvas/object-model";
import type { PacketContentSnapshot } from "@/lib/packets/contracts";

interface PacketSectionBase {
  objectId: string;
  objectType:
    | "note"
    | "task_board"
    | "schedule"
    | "diagram"
    | "data_table"
    | "reference_card"
    | "meeting_card";
  title: string;
}

export type PacketPresentationSection =
  | (PacketSectionBase & {
      kind: "note";
      text: string;
      tone: "coral" | "sky" | "sand" | "violet";
    })
  | (PacketSectionBase & {
      kind: "task_board";
      columns: Array<{
        title: string;
        tasks: Array<{
          title: string;
          owner?: string;
          dueDate?: string;
          priority?: "low" | "medium" | "high";
        }>;
      }>;
    })
  | (PacketSectionBase & {
      kind: "schedule";
      timezone: string;
      days: Array<{
        date: string;
        label: string;
        entries: Array<{ time: string; title: string; owner?: string }>;
      }>;
    })
  | (PacketSectionBase & {
      kind: "node_diagram";
      diagramKind: "architecture" | "flowchart" | "diagram";
      summary: string;
      nodes: Array<{ label: string; nodeKind: string }>;
      edges: Array<{ from: string; to: string; label?: string }>;
    })
  | (PacketSectionBase & {
      kind: "chart";
      chartKind: "pie_chart" | "bar_chart" | "line_chart";
      summary: string;
      chartTitle: string;
      xAxisLabel: string | null;
      yAxisLabel: string | null;
      series: Array<{
        label: string;
        points: Array<{ label: string; value: number }>;
      }>;
    })
  | (PacketSectionBase & {
      kind: "data_table";
      columns: Array<{ label: string; dataKind: string }>;
      rows: Array<Array<string | number | boolean | null>>;
    })
  | (PacketSectionBase & {
      kind: "reference_card";
      referenceKind: "article" | "document" | "image" | "link";
      sourceUrl: string | null;
      summary: string;
      excerpt: string | null;
    })
  | (PacketSectionBase & {
      kind: "meeting_card";
      cardKind:
        | "decision"
        | "action_item"
        | "summary"
        | "risk"
        | "open_question";
      body: string;
      bullets: string[];
      owner: string | null;
      dueDate: string | null;
      status:
        | "proposed"
        | "confirmed"
        | "open"
        | "in_progress"
        | "done"
        | "blocked";
    })
  | (PacketSectionBase & {
      kind: "fallback";
      message: string;
    });

export interface PacketPresentation {
  title: string;
  roomName: string;
  sourceRevision: number;
  sections: PacketPresentationSection[];
}

const FALLBACK_MESSAGE = "Content unavailable in this packet preview.";

export function createPacketPresentation(
  snapshot: PacketContentSnapshot,
): PacketPresentation {
  return {
    title: snapshot.title,
    roomName: snapshot.content.roomName,
    sourceRevision: snapshot.content.sourceRevision,
    sections: snapshot.content.objects.map((object) => {
      const base: PacketSectionBase = {
        objectId: object.objectId,
        objectType: object.objectType,
        title: object.title,
      };

      switch (object.objectType) {
        case "note": {
          const payload = notePayloadSchema.safeParse(object.payload);
          return payload.success
            ? {
                ...base,
                kind: "note" as const,
                text: payload.data.text,
                tone: payload.data.tone,
              }
            : fallback(base);
        }
        case "task_board": {
          const payload = taskBoardPayloadSchema.safeParse(object.payload);
          return payload.success
            ? {
                ...base,
                kind: "task_board" as const,
                columns: payload.data.columns.map((column) => ({
                  title: column.title,
                  tasks: column.tasks.map((task) => ({
                    title: task.title,
                    ...(task.owner ? { owner: task.owner } : {}),
                    ...(task.dueDate ? { dueDate: task.dueDate } : {}),
                    ...(task.priority ? { priority: task.priority } : {}),
                  })),
                })),
              }
            : fallback(base);
        }
        case "schedule": {
          const payload = schedulePayloadSchema.safeParse(object.payload);
          return payload.success
            ? {
                ...base,
                kind: "schedule" as const,
                timezone: payload.data.timezone,
                days: payload.data.days.map((day) => ({
                  date: day.date,
                  label: day.label,
                  entries: day.entries.map((entry) => ({
                    time: entry.time,
                    title: entry.title,
                    ...(entry.owner ? { owner: entry.owner } : {}),
                  })),
                })),
              }
            : fallback(base);
        }
        case "diagram": {
          const payload = diagramPayloadSchema.safeParse(object.payload);
          if (!payload.success) return fallback(base);
          if ("nodes" in payload.data) {
            const labels = new Map(
              payload.data.nodes.map((node) => [node.id, node.label]),
            );
            return {
              ...base,
              kind: "node_diagram",
              diagramKind: payload.data.kind,
              summary: payload.data.interpretationSummary,
              nodes: payload.data.nodes.map((node) => ({
                label: node.label,
                nodeKind: node.kind,
              })),
              edges: payload.data.edges.map((edge) => ({
                from: labels.get(edge.from) ?? edge.from,
                to: labels.get(edge.to) ?? edge.to,
                ...(edge.label ? { label: edge.label } : {}),
              })),
            };
          }
          return {
            ...base,
            kind: "chart",
            chartKind: payload.data.kind,
            summary: payload.data.interpretationSummary,
            chartTitle: payload.data.chart.title,
            xAxisLabel: payload.data.chart.xAxisLabel,
            yAxisLabel: payload.data.chart.yAxisLabel,
            series: payload.data.chart.series.map((series) => ({
              label: series.label,
              points: series.points.map((point) => ({ ...point })),
            })),
          };
        }
        case "data_table": {
          const payload = dataTablePayloadSchema.safeParse(object.payload);
          return payload.success
            ? {
                ...base,
                kind: "data_table" as const,
                columns: payload.data.columns.map((column) => ({
                  label: column.label,
                  dataKind: column.kind,
                })),
                rows: payload.data.rows.map((row) => [...row.cells]),
              }
            : fallback(base);
        }
        case "reference_card": {
          const payload = referenceCardPayloadSchema.safeParse(object.payload);
          return payload.success
            ? {
                ...base,
                kind: "reference_card" as const,
                referenceKind: payload.data.kind,
                sourceUrl: payload.data.sourceUrl,
                summary: payload.data.summary,
                excerpt: payload.data.excerpt,
              }
            : fallback(base);
        }
        case "meeting_card": {
          const payload = meetingCardPayloadSchema.safeParse(object.payload);
          return payload.success
            ? {
                ...base,
                kind: "meeting_card" as const,
                cardKind: payload.data.kind,
                body: payload.data.body,
                bullets: [...payload.data.bullets],
                owner: payload.data.owner,
                dueDate: payload.data.dueDate,
                status: payload.data.status,
              }
            : fallback(base);
        }
      }
    }),
  };
}

export function renderPacketPresentationText(
  presentation: PacketPresentation,
): string {
  const header = [
    presentation.title.toUpperCase(),
    presentation.roomName,
    `Canvas revision ${presentation.sourceRevision}`,
  ].join("\n");
  const sections = presentation.sections.map(renderSectionText);
  return [header, ...sections].join("\n\n");
}

export function renderPacketPresentationHtml(
  presentation: PacketPresentation,
): string {
  const sections = presentation.sections.length
    ? presentation.sections.map(renderSectionHtml).join("")
    : '<p style="margin:0;color:#5b667a">No packet content is available.</p>';
  return [
    '<main style="max-width:760px;margin:0 auto;padding:28px;background:#f6f7fb;font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;line-height:1.55;color:#10182b">',
    '<header style="padding:24px;border-radius:18px;background:linear-gradient(135deg,#172554,#4338ca);color:#fff">',
    '<p style="margin:0 0 8px;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:#c7d2fe">CommandCanvas meeting packet</p>',
    `<h1 style="margin:0;font-size:28px;line-height:1.15">${escapeHtml(presentation.title)}</h1>`,
    `<p style="margin:12px 0 0;color:#e0e7ff">${escapeHtml(presentation.roomName)} · Canvas revision ${presentation.sourceRevision}</p>`,
    "</header>",
    '<p style="margin:20px 0;color:#4b5563">This packet was reviewed and approved in CommandCanvas.</p>',
    `<section style="display:grid;gap:14px">${sections}</section>`,
    '<footer style="margin-top:22px;padding-top:14px;border-top:1px solid #d9deea;color:#6b7280;font-size:12px">Every item came from the approved canvas snapshot.</footer>',
    "</main>",
  ].join("");
}

function fallback(base: PacketSectionBase): PacketPresentationSection {
  return { ...base, kind: "fallback", message: FALLBACK_MESSAGE };
}

function renderSectionText(section: PacketPresentationSection): string {
  const heading = `${section.title}\n${sectionLabel(section)}`;
  switch (section.kind) {
    case "note":
      return `${heading}\n${section.text}`;
    case "task_board":
      return [
        heading,
        ...section.columns.flatMap((column) => [
          column.title,
          ...(column.tasks.length
            ? column.tasks.map(
                (task) =>
                  `- ${task.title}${task.owner ? ` - ${task.owner}` : ""}${task.dueDate ? ` - ${task.dueDate}` : ""}${task.priority ? ` - ${task.priority} priority` : ""}`,
              )
            : ["- No tasks"]),
        ]),
      ].join("\n");
    case "schedule":
      return [
        heading,
        `Timezone: ${section.timezone}`,
        ...section.days.flatMap((day) => [
          `${day.label}, ${day.date}`,
          ...(day.entries.length
            ? day.entries.map(
                (entry) =>
                  `${entry.time} - ${entry.title}${entry.owner ? ` - ${entry.owner}` : ""}`,
              )
            : ["No scheduled items"]),
        ]),
      ].join("\n");
    case "node_diagram":
      return [
        heading,
        section.summary,
        `Nodes: ${section.nodes.map((node) => `${node.label} (${humanize(node.nodeKind)})`).join(", ")}`,
        ...(section.edges.length
          ? section.edges.map(
              (edge) =>
                `${edge.from} -> ${edge.to}${edge.label ? ` - ${edge.label}` : ""}`,
            )
          : ["Connections: none"]),
      ].join("\n");
    case "chart":
      return [
        heading,
        section.summary,
        section.chartTitle,
        ...(section.yAxisLabel ? [`Value axis: ${section.yAxisLabel}`] : []),
        ...section.series.flatMap((series) => [
          series.label,
          ...series.points.map((point) => `${point.label}: ${formatCell(point.value)}`),
        ]),
      ].join("\n");
    case "data_table":
      return [
        heading,
        section.columns.map((column) => column.label).join(" | "),
        ...section.rows.map((row) => row.map(formatCell).join(" | ")),
      ].join("\n");
    case "reference_card":
      return [
        heading,
        section.summary,
        ...(section.excerpt ? [section.excerpt] : []),
        ...(section.sourceUrl ? [`Source: ${section.sourceUrl}`] : []),
      ].join("\n");
    case "meeting_card":
      return [
        heading,
        section.body,
        ...section.bullets.map((bullet) => `- ${bullet}`),
        `Status: ${humanize(section.status)}`,
        ...(section.owner ? [`Owner: ${section.owner}`] : []),
        ...(section.dueDate ? [`Due: ${section.dueDate}`] : []),
      ].join("\n");
    case "fallback":
      return `${heading}\n${section.message}`;
  }
}

function renderSectionHtml(section: PacketPresentationSection): string {
  const heading = [
    '<article style="padding:18px;border:1px solid #d9deea;border-radius:14px;background:#fff;box-shadow:0 8px 22px rgba(15,23,42,.05)">',
    `<p style="margin:0;color:#6366f1;font-size:10px;font-weight:750;letter-spacing:.1em;text-transform:uppercase">${escapeHtml(sectionLabel(section))}</p>`,
    `<h2 style="margin:5px 0 12px;font-size:18px;line-height:1.25">${escapeHtml(section.title)}</h2>`,
  ].join("");
  let body: string;
  switch (section.kind) {
    case "note":
      body = `<p style="margin:0;white-space:pre-wrap;color:#374151">${escapeHtml(section.text)}</p>`;
      break;
    case "task_board":
      body = section.columns
        .map(
          (column) =>
            `<section style="margin-top:10px;padding:12px;border-radius:10px;background:#f7f8fc"><h3 style="margin:0 0 8px;font-size:14px">${escapeHtml(column.title)}</h3>${renderHtmlList(
              column.tasks.map(
                (task) =>
                  `${task.title}${task.owner ? ` · ${task.owner}` : ""}${task.dueDate ? ` · ${task.dueDate}` : ""}${task.priority ? ` · ${task.priority} priority` : ""}`,
              ),
              "No tasks",
            )}</section>`,
        )
        .join("");
      break;
    case "schedule":
      body = [
        `<p style="margin:0 0 8px;color:#6b7280;font-size:12px">Timezone: ${escapeHtml(section.timezone)}</p>`,
        ...section.days.map(
          (day) =>
            `<section style="margin-top:10px"><h3 style="margin:0 0 6px;font-size:14px">${escapeHtml(day.label)}, ${escapeHtml(day.date)}</h3>${renderHtmlList(
              day.entries.map(
                (entry) =>
                  `${entry.time} · ${entry.title}${entry.owner ? ` · ${entry.owner}` : ""}`,
              ),
              "No scheduled items",
            )}</section>`,
        ),
      ].join("");
      break;
    case "node_diagram":
      body = [
        `<p style="margin:0 0 10px;color:#4b5563">${escapeHtml(section.summary)}</p>`,
        '<div style="display:flex;flex-wrap:wrap;gap:8px">',
        ...section.nodes.map(
          (node) =>
            `<span style="display:inline-block;padding:8px 10px;border:1px solid #c7d2fe;border-radius:9px;background:#eef2ff"><strong>${escapeHtml(node.label)}</strong><small style="display:block;color:#6b7280">${escapeHtml(humanize(node.nodeKind))}</small></span>`,
        ),
        "</div>",
        section.edges.length
          ? `<h3 style="margin:14px 0 6px;font-size:13px">Connections</h3>${renderHtmlList(
              section.edges.map(
                (edge) =>
                  `${edge.from} -> ${edge.to}${edge.label ? ` · ${edge.label}` : ""}`,
              ),
            )}`
          : '<p style="margin:12px 0 0;color:#6b7280">No connections</p>',
      ].join("");
      break;
    case "chart":
      body = [
        `<p style="margin:0 0 8px;color:#4b5563">${escapeHtml(section.summary)}</p>`,
        `<h3 style="margin:0 0 8px;font-size:14px">${escapeHtml(section.chartTitle)}</h3>`,
        ...(section.yAxisLabel
          ? [`<p style="margin:0 0 8px;color:#6b7280;font-size:12px">Value axis: ${escapeHtml(section.yAxisLabel)}</p>`]
          : []),
        renderChartTable(section),
      ].join("");
      break;
    case "data_table":
      body = renderDataTable(section);
      break;
    case "reference_card":
      body = [
        `<p style="margin:0;color:#374151">${escapeHtml(section.summary)}</p>`,
        ...(section.excerpt
          ? [`<blockquote style="margin:12px 0 0;padding:10px 12px;border-left:3px solid #818cf8;background:#f7f8fc;color:#4b5563">${escapeHtml(section.excerpt)}</blockquote>`]
          : []),
        ...(section.sourceUrl
          ? [`<p style="margin:12px 0 0"><a href="${escapeHtml(section.sourceUrl)}" style="color:#4338ca">Open source</a></p>`]
          : []),
      ].join("");
      break;
    case "meeting_card":
      body = [
        `<p style="margin:0;color:#374151">${escapeHtml(section.body)}</p>`,
        section.bullets.length ? renderHtmlList(section.bullets) : "",
        '<dl style="display:flex;flex-wrap:wrap;gap:8px 18px;margin:12px 0 0;color:#4b5563;font-size:12px">',
        `<div><dt style="font-weight:700">Status</dt><dd style="margin:0">${escapeHtml(humanize(section.status))}</dd></div>`,
        ...(section.owner
          ? [`<div><dt style="font-weight:700">Owner</dt><dd style="margin:0">${escapeHtml(section.owner)}</dd></div>`]
          : []),
        ...(section.dueDate
          ? [`<div><dt style="font-weight:700">Due</dt><dd style="margin:0">${escapeHtml(section.dueDate)}</dd></div>`]
          : []),
        "</dl>",
      ].join("");
      break;
    case "fallback":
      body = `<p style="margin:0;padding:10px 12px;border-radius:9px;background:#fff7ed;color:#9a3412">${escapeHtml(section.message)}</p>`;
      break;
  }
  return `${heading}${body}</article>`;
}

function renderChartTable(section: Extract<PacketPresentationSection, { kind: "chart" }>) {
  const categories = section.series[0]?.points.map((point) => point.label) ?? [];
  return renderTable(
    [
      section.xAxisLabel ?? "Category",
      ...section.series.map((series) =>
        section.yAxisLabel
          ? `${series.label} (${section.yAxisLabel})`
          : series.label,
      ),
    ],
    categories.map((category, index) => [
      category,
      ...section.series.map((series) => series.points[index]?.value ?? null),
    ]),
  );
}

function renderDataTable(
  section: Extract<PacketPresentationSection, { kind: "data_table" }>,
) {
  return renderTable(
    section.columns.map((column) => column.label),
    section.rows,
  );
}

function renderTable(
  headers: readonly string[],
  rows: readonly (readonly (string | number | boolean | null)[])[],
) {
  return [
    '<div style="overflow-x:auto"><table style="width:100%;border-collapse:collapse;font-size:12px">',
    `<thead><tr>${headers.map((header) => `<th style="padding:8px;border-bottom:2px solid #c7d2fe;text-align:left">${escapeHtml(header)}</th>`).join("")}</tr></thead>`,
    `<tbody>${rows
      .map(
        (row) =>
          `<tr>${row.map((cell) => `<td style="padding:8px;border-bottom:1px solid #e5e7eb">${escapeHtml(formatCell(cell))}</td>`).join("")}</tr>`,
      )
      .join("")}</tbody>`,
    "</table></div>",
  ].join("");
}

function renderHtmlList(values: readonly string[], emptyLabel = "None") {
  if (values.length === 0)
    return `<p style="margin:0;color:#6b7280">${escapeHtml(emptyLabel)}</p>`;
  return `<ul style="margin:8px 0 0;padding-left:20px;color:#374151">${values.map((value) => `<li style="margin:4px 0">${escapeHtml(value)}</li>`).join("")}</ul>`;
}

function sectionLabel(section: PacketPresentationSection): string {
  switch (section.kind) {
    case "node_diagram":
      return humanize(section.diagramKind);
    case "chart":
      return humanize(section.chartKind);
    case "reference_card":
      return humanize(section.referenceKind);
    case "meeting_card":
      return humanize(section.cardKind);
    case "fallback":
      return humanize(section.objectType);
    default:
      return humanize(section.kind);
  }
}

function humanize(value: string): string {
  return value.replaceAll("_", " ");
}

function formatCell(value: string | number | boolean | null): string {
  if (value === null) return "-";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character] ?? character,
  );
}
