// TrendChart (Admin dashboard V2, Figma 150:191): dual-axis area+line chart for
// "Tren Laporan dan Durasi Penanganan". Reports use a filled solid line on the
// left axis; the historical average duration uses a dashed line on the right.
//
// Presentational only: the page owns bucketing (Harian/Mingguan/Bulanan) and
// passes the legend tabs through `aside`. The SVG is decorative; a screen
// reader gets the same numbers from the visually hidden table.
import type { ReactNode } from 'react';
import { formatHours } from '../lib/dashboard-period.js';

export interface TrendChartDatum {
  readonly key: string;
  readonly label: string;
  readonly sublabel: string;
  readonly reports: number;
  /** Average REPORTED→RESOLVED duration; null when nothing was resolved. */
  readonly averageSeconds: number | null;
}

export interface TrendChartProps {
  readonly title: string;
  readonly subtitle?: string;
  readonly data: readonly TrendChartDatum[];
  readonly aside?: ReactNode;
  readonly emptyMessage?: string;
}

const WIDTH = 980;
const HEIGHT = 250;
const PAD = { top: 30, right: 52, bottom: 44, left: 46 } as const;
const PLOT_WIDTH = WIDTH - PAD.left - PAD.right;
const PLOT_HEIGHT = HEIGHT - PAD.top - PAD.bottom;
const LINE_COLOR = '#0a3947';
const DURATION_COLOR = '#3d6d7a';

/** Round a peak up to a friendly axis maximum (1/2/2.5/5 × power of ten). */
function niceMax(value: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    return 1;
  }
  const exponent = 10 ** Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) {
    const candidate = step * exponent;
    if (value <= candidate) {
      return candidate;
    }
  }
  return 10 * exponent;
}

/** Compact tick label: 2.5 → "2,5", 20 → "20". */
function tickLabel(value: number): string {
  return value.toLocaleString('id-ID', { maximumFractionDigits: 1 });
}

export function TrendChart({
  title,
  subtitle,
  data,
  aside,
  emptyMessage = 'Belum ada data pada periode ini.',
}: TrendChartProps) {
  const hasActivity = data.some(
    (datum) => datum.reports > 0 || (datum.averageSeconds ?? 0) > 0,
  );
  const showPills = data.length <= 10;

  return (
    <figure aria-label={title} className="rounded-xl border border-[#e1e5e9] bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <figcaption className="min-w-0">
          <h2 className="text-lg font-semibold text-[#202a33]">{title}</h2>
          {subtitle === undefined ? null : (
            <p className="mt-1 text-[13px] text-[#697784]">{subtitle}</p>
          )}
        </figcaption>
        {aside === undefined ? null : <div className="shrink-0">{aside}</div>}
      </div>

      {data.length === 0 || !hasActivity ? (
        <p className="mt-6 text-sm text-[#697784]">{emptyMessage}</p>
      ) : (
        <TrendChartPlot title={title} data={data} showPills={showPills} />
      )}
    </figure>
  );
}

interface TrendChartPlotProps {
  readonly title: string;
  readonly data: readonly TrendChartDatum[];
  readonly showPills: boolean;
}

function TrendChartPlot({ title, data, showPills }: TrendChartPlotProps) {
  const reportsMax = niceMax(Math.max(...data.map((datum) => datum.reports), 0));
  const durationMax = niceMax(
    Math.max(...data.map((datum) => (datum.averageSeconds ?? 0) / 3600), 0),
  );
  const step = data.length > 1 ? PLOT_WIDTH / (data.length - 1) : 0;
  const xOf = (index: number): number =>
    data.length > 1 ? PAD.left + index * step : PAD.left + PLOT_WIDTH / 2;
  const yOfReports = (value: number): number =>
    PAD.top + PLOT_HEIGHT - (value / reportsMax) * PLOT_HEIGHT;
  const yOfDuration = (seconds: number): number =>
    PAD.top + PLOT_HEIGHT - (seconds / 3600 / durationMax) * PLOT_HEIGHT;

  const reportPoints = data.map((datum, index) => ({
    x: xOf(index),
    y: yOfReports(datum.reports),
    datum,
  }));
  const durationPoints = data
    .map((datum, index) => ({
      x: xOf(index),
      y: yOfDuration(datum.averageSeconds ?? 0),
      datum,
    }))
    .filter((point) => point.datum.averageSeconds !== null);
  const pointsAttr = (points: readonly { x: number; y: number }[]): string =>
    points.map((point) => `${point.x},${point.y}`).join(' ');
  const baseline = PAD.top + PLOT_HEIGHT;
  const areaPath =
    reportPoints.length === 0
      ? ''
      : `M ${reportPoints[0]?.x ?? PAD.left} ${baseline} L ${reportPoints
          .map((point) => `${point.x} ${point.y}`)
          .join(' L ')} L ${reportPoints[reportPoints.length - 1]?.x ?? PAD.left} ${baseline} Z`;
  const ticks = [0, 1, 2, 3, 4];

  return (
    <>
      <svg
        aria-hidden="true"
        role="presentation"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="mt-5 h-auto w-full"
      >
        <defs>
          <linearGradient id="trend-area-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={LINE_COLOR} stopOpacity="0.16" />
            <stop offset="100%" stopColor={LINE_COLOR} stopOpacity="0.01" />
          </linearGradient>
        </defs>

        <text x={2} y={12} fill="#697784" fontSize="10" letterSpacing="0.6">
          TIKET
        </text>
        <text x={WIDTH - 2} y={12} textAnchor="end" fill="#697784" fontSize="10" letterSpacing="0.6">
          DURASI
        </text>

        {ticks.map((tick) => {
          const y = PAD.top + PLOT_HEIGHT - (tick / 4) * PLOT_HEIGHT;
          return (
            <g key={`tick-${tick}`}>
              <line
                x1={PAD.left}
                x2={PAD.left + PLOT_WIDTH}
                y1={y}
                y2={y}
                stroke="#e1e5e9"
                strokeWidth="1"
                strokeDasharray="4 5"
              />
              <text x={PAD.left - 10} y={y + 3} textAnchor="end" fill="#8a97a3" fontSize="10">
                {tickLabel((reportsMax / 4) * tick)}
              </text>
              <text x={PAD.left + PLOT_WIDTH + 10} y={y + 3} fill="#8a97a3" fontSize="10">
                {`${tickLabel((durationMax / 4) * tick)}j`}
              </text>
            </g>
          );
        })}

        <path d={areaPath} fill="url(#trend-area-fill)" />
        <polyline
          points={pointsAttr(reportPoints)}
          fill="none"
          stroke={LINE_COLOR}
          strokeWidth="2.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <polyline
          points={pointsAttr(durationPoints)}
          fill="none"
          stroke={DURATION_COLOR}
          strokeWidth="2"
          strokeDasharray="7 5"
          strokeLinejoin="round"
        />
        {reportPoints.map((point) => (
          <circle
            key={`reports-${point.datum.key}`}
            cx={point.x}
            cy={point.y}
            r="4"
            fill="#ffffff"
            stroke={LINE_COLOR}
            strokeWidth="2"
          />
        ))}
        {durationPoints.map((point) => (
          <circle
            key={`duration-${point.datum.key}`}
            cx={point.x}
            cy={point.y}
            r="3.5"
            fill="#ffffff"
            stroke={DURATION_COLOR}
            strokeWidth="1.8"
          />
        ))}
        {showPills
          ? reportPoints.map((point) => (
              <g key={`reports-pill-${point.datum.key}`}>
                <rect
                  x={point.x - 26}
                  y={point.y - 27}
                  width="52"
                  height="18"
                  rx="4"
                  fill={LINE_COLOR}
                />
                <text x={point.x} y={point.y - 14} textAnchor="middle" fill="#ffffff" fontSize="10">
                  {`${point.datum.reports} tiket`}
                </text>
              </g>
            ))
          : null}
        {showPills
          ? durationPoints.map((point) => (
              <g key={`duration-pill-${point.datum.key}`}>
                <rect
                  x={point.x - 24}
                  y={point.y + 10}
                  width="48"
                  height="17"
                  rx="4"
                  fill="#ffffff"
                  stroke="#d5dee3"
                />
                <text x={point.x} y={point.y + 22} textAnchor="middle" fill="#3d6d7a" fontSize="10">
                  {`${formatHours(point.datum.averageSeconds)} jam`}
                </text>
              </g>
            ))
          : null}
        {data.map((datum, index) => (
          <g key={`axis-${datum.key}`}>
            <text
              x={xOf(index)}
              y={HEIGHT - PAD.bottom + 18}
              textAnchor="middle"
              fill="#202a33"
              fontSize="11"
              fontWeight="600"
            >
              {datum.label}
            </text>
            <text
              x={xOf(index)}
              y={HEIGHT - PAD.bottom + 31}
              textAnchor="middle"
              fill="#8a97a3"
              fontSize="10"
            >
              {datum.sublabel}
            </text>
          </g>
        ))}
      </svg>

      <table className="sr-only">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th scope="col">Periode</th>
            <th scope="col">Laporan masuk (tiket)</th>
            <th scope="col">Rata-rata durasi (jam)</th>
          </tr>
        </thead>
        <tbody>
          {data.map((datum) => (
            <tr key={`row-${datum.key}`}>
              <th scope="row">{`${datum.label} ${datum.sublabel}`.trim()}</th>
              <td>{datum.reports}</td>
              <td>{formatHours(datum.averageSeconds)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
