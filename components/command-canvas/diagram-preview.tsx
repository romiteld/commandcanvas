import { useId } from "react";

import { ChartPreview } from "@/components/command-canvas/chart-preview";
import type { DiagramPayload } from "@/lib/canvas/object-model";

const VIEWBOX_PADDING = 28;

export function DiagramPreview({ payload }: { payload: DiagramPayload }) {
  if ("chart" in payload) return <ChartPreview payload={payload} />;
  return <NodeDiagramPreview payload={payload} />;
}

function NodeDiagramPreview({
  payload,
}: {
  payload: Exclude<DiagramPayload, { chart: unknown }>;
}) {
  const markerId = `diagram-arrow-${useId().replaceAll(":", "")}`;
  const nodes = new Map(payload.nodes.map((node) => [node.id, node]));
  const bounds = diagramBounds(payload);
  const kindLabel =
    payload.kind === "architecture"
      ? "Architecture"
      : payload.kind === "flowchart"
        ? "Flowchart"
        : "Structured";

  return (
    <svg
      className="structured-diagram"
      role="img"
      aria-label={`${kindLabel} diagram: ${payload.interpretationSummary}`}
      viewBox={`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`}
      preserveAspectRatio="xMidYMid meet"
    >
      <defs>
        <marker
          id={markerId}
          markerWidth="8"
          markerHeight="8"
          refX="7"
          refY="4"
          orient="auto"
          markerUnits="strokeWidth"
        >
          <path d="M 0 0 L 8 4 L 0 8 z" className="diagram-arrowhead" />
        </marker>
      </defs>

      <g className="diagram-edges">
        {payload.edges.map((edge) => {
          const from = nodes.get(edge.from);
          const to = nodes.get(edge.to);
          if (!from || !to) return null;
          const endpoints = edgeEndpoints(from, to);
          return (
            <g key={edge.id} data-diagram-edge={edge.id}>
              <path
                className="diagram-edge"
                d={`M ${endpoints.from.x} ${endpoints.from.y} L ${endpoints.to.x} ${endpoints.to.y}`}
                markerEnd={`url(#${markerId})`}
              />
              {edge.label ? (
                <text
                  className="diagram-edge-label"
                  x={(endpoints.from.x + endpoints.to.x) / 2}
                  y={(endpoints.from.y + endpoints.to.y) / 2 - 7}
                  textAnchor="middle"
                >
                  {edge.label}
                </text>
              ) : null}
            </g>
          );
        })}
      </g>

      <g className="diagram-nodes">
        {payload.nodes.map((node) => (
          <g
            key={node.id}
            data-diagram-node={node.id}
            className={`diagram-node diagram-node-${node.kind}`}
          >
            <rect
              x={node.x}
              y={node.y}
              width={node.width}
              height={node.height}
              rx="12"
            />
            <text
              x={node.x + node.width / 2}
              y={node.y + node.height / 2}
              textAnchor="middle"
              dominantBaseline="middle"
            >
              {truncateLabel(node.label)}
            </text>
            <text
              className="diagram-node-kind"
              x={node.x + node.width / 2}
              y={node.y + node.height - 10}
              textAnchor="middle"
            >
              {node.kind.toUpperCase()}
            </text>
          </g>
        ))}
      </g>
    </svg>
  );
}

type NodeDiagramPayload = Exclude<DiagramPayload, { chart: unknown }>;

function diagramBounds(payload: NodeDiagramPayload) {
  const minX = Math.min(...payload.nodes.map((node) => node.x));
  const minY = Math.min(...payload.nodes.map((node) => node.y));
  const maxX = Math.max(...payload.nodes.map((node) => node.x + node.width));
  const maxY = Math.max(...payload.nodes.map((node) => node.y + node.height));
  return {
    x: minX - VIEWBOX_PADDING,
    y: minY - VIEWBOX_PADDING,
    width: maxX - minX + VIEWBOX_PADDING * 2,
    height: maxY - minY + VIEWBOX_PADDING * 2,
  };
}

type DiagramNode = NodeDiagramPayload["nodes"][number];

function edgeEndpoints(from: DiagramNode, to: DiagramNode) {
  const fromCenter = {
    x: from.x + from.width / 2,
    y: from.y + from.height / 2,
  };
  const toCenter = {
    x: to.x + to.width / 2,
    y: to.y + to.height / 2,
  };
  const horizontal = Math.abs(toCenter.x - fromCenter.x) >= Math.abs(toCenter.y - fromCenter.y);

  if (horizontal)
    return toCenter.x >= fromCenter.x
      ? {
          from: { x: from.x + from.width, y: fromCenter.y },
          to: { x: to.x, y: toCenter.y },
        }
      : {
          from: { x: from.x, y: fromCenter.y },
          to: { x: to.x + to.width, y: toCenter.y },
        };

  return toCenter.y >= fromCenter.y
    ? {
        from: { x: fromCenter.x, y: from.y + from.height },
        to: { x: toCenter.x, y: to.y },
      }
    : {
        from: { x: fromCenter.x, y: from.y },
        to: { x: toCenter.x, y: to.y + to.height },
      };
}

function truncateLabel(label: string) {
  return label.length <= 28 ? label : `${label.slice(0, 25)}…`;
}
