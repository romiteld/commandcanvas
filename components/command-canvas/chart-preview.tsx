import type { DiagramPayload } from "@/lib/canvas/object-model";

type ChartPayload = Extract<DiagramPayload, { chart: unknown }>;

const CHART_WIDTH = 640;
const CHART_HEIGHT = 360;
const PLOT = { x: 72, y: 52, width: 520, height: 244 } as const;
const PALETTE = ["#21b8a6", "#6f78f6", "#ef765f", "#e9a33c", "#3f8fd2", "#a96ed2"];
const AXIS_COLOR = "#8191a6";
const TEXT_COLOR = "#10233b";

export function ChartPreview({ payload }: { payload: ChartPayload }) {
  const kindLabel = chartKindLabel(payload.kind);
  const ariaLabel = `${kindLabel}: ${payload.chart.title}. ${payload.interpretationSummary}`;

  if (payload.kind === "pie_chart")
    return <PieChart payload={payload} ariaLabel={ariaLabel} />;
  if (payload.kind === "bar_chart")
    return <CartesianChart payload={payload} ariaLabel={ariaLabel} mode="bar" />;
  return <CartesianChart payload={payload} ariaLabel={ariaLabel} mode="line" />;
}

function PieChart({
  payload,
  ariaLabel,
}: {
  payload: ChartPayload;
  ariaLabel: string;
}) {
  const points = payload.chart.series[0].points;
  const total = points.reduce((sum, point) => sum + point.value, 0);
  const sweeps = points.map((point) => (point.value / total) * Math.PI * 2);

  return (
    <svg
      className="structured-diagram structured-chart"
      role="img"
      aria-label={ariaLabel}
      viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
      preserveAspectRatio="xMidYMid meet"
    >
      <ChartTitle title={payload.chart.title} />
      <g transform="translate(190 190)">
        {points.map((point, index) => {
          const start =
            -Math.PI / 2 +
            sweeps.slice(0, index).reduce((sum, sweep) => sum + sweep, 0);
          const sweep = sweeps[index] ?? 0;
          const end = start + sweep;
          const color = PALETTE[index % PALETTE.length];
          if (Math.abs(sweep - Math.PI * 2) < 0.0001)
            return (
              <circle
                key={point.label}
                data-chart-segment={point.label}
                r="112"
                fill={color}
                stroke="#ffffff"
                strokeWidth="3"
              />
            );
          return (
            <path
              key={point.label}
              data-chart-segment={point.label}
              d={pieSlicePath(112, start, end)}
              fill={color}
              stroke="#ffffff"
              strokeWidth="3"
            />
          );
        })}
      </g>
      <g aria-label="Legend">
        {points.slice(0, 9).map((point, index) => (
          <g key={point.label} transform={`translate(350 ${86 + index * 28})`}>
            <rect width="14" height="14" rx="4" fill={PALETTE[index % PALETTE.length]} />
            <text x="24" y="12" fill={TEXT_COLOR} fontSize="15">
              {truncate(point.label, 20)} · {formatValue(point.value)}
            </text>
          </g>
        ))}
      </g>
    </svg>
  );
}

function CartesianChart({
  payload,
  ariaLabel,
  mode,
}: {
  payload: ChartPayload;
  ariaLabel: string;
  mode: "bar" | "line";
}) {
  const values = payload.chart.series.flatMap((series) =>
    series.points.map((point) => point.value),
  );
  const scale = valueScale(values);
  const categoryCount = Math.max(
    ...payload.chart.series.map((series) => series.points.length),
  );
  const categories = Array.from({ length: categoryCount }, (_, index) =>
    payload.chart.series.find((series) => series.points[index])?.points[index]?.label ??
    String(index + 1),
  );

  return (
    <svg
      className="structured-diagram structured-chart"
      role="img"
      aria-label={ariaLabel}
      viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
      preserveAspectRatio="xMidYMid meet"
    >
      <ChartTitle title={payload.chart.title} />
      <line
        x1={PLOT.x}
        x2={PLOT.x}
        y1={PLOT.y}
        y2={PLOT.y + PLOT.height}
        stroke={AXIS_COLOR}
      />
      <line
        x1={PLOT.x}
        x2={PLOT.x + PLOT.width}
        y1={scale.toY(0)}
        y2={scale.toY(0)}
        stroke={AXIS_COLOR}
      />
      {mode === "bar" ? (
        <Bars payload={payload} scale={scale} categoryCount={categoryCount} />
      ) : (
        <Lines payload={payload} scale={scale} />
      )}
      {categories.map((label, index) => (
        <text
          key={`${label}-${index}`}
          x={categoryX(index, categoryCount)}
          y={PLOT.y + PLOT.height + 22}
          fill={TEXT_COLOR}
          fontSize="13"
          textAnchor="middle"
        >
          {truncate(label, 11)}
        </text>
      ))}
      {payload.chart.xAxisLabel ? (
        <text
          x={PLOT.x + PLOT.width / 2}
          y="350"
          fill={TEXT_COLOR}
          fontSize="14"
          fontWeight="600"
          textAnchor="middle"
        >
          {payload.chart.xAxisLabel}
        </text>
      ) : null}
      {payload.chart.yAxisLabel ? (
        <text
          x="18"
          y={PLOT.y + PLOT.height / 2}
          fill={TEXT_COLOR}
          fontSize="14"
          fontWeight="600"
          textAnchor="middle"
          transform={`rotate(-90 18 ${PLOT.y + PLOT.height / 2})`}
        >
          {payload.chart.yAxisLabel}
        </text>
      ) : null}
      <text x={PLOT.x - 8} y={PLOT.y + 5} fill={AXIS_COLOR} fontSize="12" textAnchor="end">
        {formatValue(scale.max)}
      </text>
      <text
        x={PLOT.x - 8}
        y={PLOT.y + PLOT.height + 5}
        fill={AXIS_COLOR}
        fontSize="12"
        textAnchor="end"
      >
        {formatValue(scale.min)}
      </text>
    </svg>
  );
}

function Bars({
  payload,
  scale,
  categoryCount,
}: {
  payload: ChartPayload;
  scale: ReturnType<typeof valueScale>;
  categoryCount: number;
}) {
  const groupWidth = PLOT.width / Math.max(categoryCount, 1);
  const barWidth = Math.min(
    44,
    (groupWidth * 0.72) / payload.chart.series.length,
  );
  const baseline = scale.toY(0);

  return payload.chart.series.flatMap((series, seriesIndex) =>
    series.points.map((point, pointIndex) => {
      const valueY = scale.toY(point.value);
      const x =
        PLOT.x +
        pointIndex * groupWidth +
        groupWidth / 2 -
        (barWidth * payload.chart.series.length) / 2 +
        seriesIndex * barWidth;
      return (
        <rect
          key={`${series.id}-${point.label}`}
          data-chart-bar={`${series.id}-${point.label}`}
          aria-label={`${series.label}, ${point.label}: ${formatValue(point.value)}`}
          x={x}
          y={Math.min(valueY, baseline)}
          width={Math.max(barWidth - 3, 2)}
          height={Math.max(Math.abs(baseline - valueY), 1)}
          rx="4"
          fill={PALETTE[seriesIndex % PALETTE.length]}
        />
      );
    }),
  );
}

function Lines({
  payload,
  scale,
}: {
  payload: ChartPayload;
  scale: ReturnType<typeof valueScale>;
}) {
  return payload.chart.series.map((series, seriesIndex) => {
    const color = PALETTE[seriesIndex % PALETTE.length];
    const points = series.points.map((point, index) => ({
      ...point,
      x: categoryX(index, series.points.length),
      y: scale.toY(point.value),
    }));
    return (
      <g key={series.id}>
        <path
          data-chart-line={series.id}
          d={points.map((point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`).join(" ")}
          fill="none"
          stroke={color}
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {points.map((point) => (
          <circle
            key={point.label}
            data-chart-point={`${series.id}-${point.label}`}
            aria-label={`${series.label}, ${point.label}: ${formatValue(point.value)}`}
            cx={point.x}
            cy={point.y}
            r="6"
            fill="#ffffff"
            stroke={color}
            strokeWidth="4"
          />
        ))}
      </g>
    );
  });
}

function ChartTitle({ title }: { title: string }) {
  return (
    <text x={CHART_WIDTH / 2} y="28" fill={TEXT_COLOR} fontSize="19" fontWeight="700" textAnchor="middle">
      {truncate(title, 48)}
    </text>
  );
}

function valueScale(values: readonly number[]) {
  const min = Math.min(0, ...values);
  let max = Math.max(0, ...values);
  if (min === max) max = min + 1;
  const span = max - min;
  const paddedMin = min < 0 ? min - span * 0.08 : 0;
  const paddedMax = max > 0 ? max + span * 0.08 : 0;
  const paddedSpan = paddedMax - paddedMin || 1;
  return {
    min: paddedMin,
    max: paddedMax,
    toY(value: number) {
      return PLOT.y + PLOT.height - ((value - paddedMin) / paddedSpan) * PLOT.height;
    },
  };
}

function categoryX(index: number, count: number) {
  if (count <= 1) return PLOT.x + PLOT.width / 2;
  return PLOT.x + (index / (count - 1)) * PLOT.width;
}

function pieSlicePath(radius: number, startAngle: number, endAngle: number) {
  const start = polar(radius, startAngle);
  const end = polar(radius, endAngle);
  const largeArc = endAngle - startAngle > Math.PI ? 1 : 0;
  return `M 0 0 L ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} 1 ${end.x} ${end.y} Z`;
}

function polar(radius: number, angle: number) {
  return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
}

function chartKindLabel(kind: ChartPayload["kind"]) {
  if (kind === "pie_chart") return "Pie chart";
  if (kind === "bar_chart") return "Bar chart";
  return "Line chart";
}

function formatValue(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
}

function truncate(value: string, max: number) {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
