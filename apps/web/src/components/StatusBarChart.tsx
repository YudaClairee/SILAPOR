// StatusBarChart (Admin dashboard beautification): vertical column chart for
// the ticket pipeline ("Alur Status Tiket"). One column per pipeline stage the
// page orders by workflow; stages with a zero count are left out so the plot
// only shows real activity, and an all-zero dataset falls back to the empty
// message.
//
// Colour is never the sole encoding: every column carries its Indonesian status
// label underneath, and the visually hidden table repeats the same numbers for
// assistive tech. Motion is limited to a hover opacity (DESIGN.md motion dial).
import type { ReactNode } from 'react';
import { statusLabel } from '../lib/admin-reports.js';
import {
  formatAxisTick,
  formatNumberId,
  formatPercent,
  niceCountAxisMax,
} from '../lib/dashboard-period.js';

export type StatusBarTone = 'active' | 'success' | 'danger' | 'muted';

export interface StatusBarDatum {
  readonly status: string;
  readonly value: number;
  /** Overrides the tone derived from the status. */
  readonly tone?: StatusBarTone;
}

export interface StatusBarChartProps {
  readonly title: string;
  readonly subtitle?: string;
  readonly data: readonly StatusBarDatum[];
  readonly aside?: ReactNode;
  /** Heading id for aria-labelledby; override when two charts share a page. */
  readonly titleId?: string;
  readonly emptyMessage?: string;
}

const WIDTH = 640;
const HEIGHT = 286;
const PAD = { top: 30, right: 18, bottom: 64, left: 46 } as const;
const PLOT_WIDTH = WIDTH - PAD.left - PAD.right;
const PLOT_HEIGHT = HEIGHT - PAD.top - PAD.bottom;
const BASELINE = PAD.top + PLOT_HEIGHT;
const TICKS = 4;
const LABEL_LINE_LENGTH = 13;

const TONE_COLORS: Record<StatusBarTone, string> = {
  active: '#0a3947',
  success: '#258a5b',
  danger: '#b8453d',
  // Muted (#94a3b8) is too pale for a 3:1 graphical object; use the muted text
  // token instead so a DUPLICATE column still clears non-text contrast.
  muted: '#64748b',
};

/** Semantic tone per status: open work teal, finished green, rejected red. */
export function statusBarTone(status: string): StatusBarTone {
  if (status === 'RESOLVED' || status === 'CLOSED') {
    return 'success';
  }
  if (status === 'REJECTED') {
    return 'danger';
  }
  if (status === 'DUPLICATE') {
    return 'muted';
  }
  return 'active';
}

/** Break a status label onto at most two x-axis lines. */
function wrapLabel(label: string): readonly string[] {
  if (label.length <= LABEL_LINE_LENGTH) {
    return [label];
  }
  const words = label.split(' ');
  if (words.length === 1) {
    return [label];
  }
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current === '' ? word : `${current} ${word}`;
    if (candidate.length <= LABEL_LINE_LENGTH || current === '') {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current !== '') {
    lines.push(current);
  }
  return lines.slice(0, 2);
}

export function StatusBarChart({
  title,
  subtitle,
  data,
  aside,
  titleId = 'status-bar-title',
  emptyMessage = 'Belum ada tiket pada periode ini.',
}: StatusBarChartProps) {
  const rows = data.filter((datum) => datum.value > 0);
  const total = rows.reduce((sum, datum) => sum + datum.value, 0);

  return (
    <section
      aria-labelledby={titleId}
      className="rounded-xl border border-[#e1e5e9] bg-white p-6 shadow-sm"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={titleId} className="text-lg font-semibold text-[#202a33]">
            {title}
          </h2>
          {subtitle === undefined ? null : (
            <p className="mt-1 text-[13px] text-[#697784]">{subtitle}</p>
          )}
        </div>
        {aside === undefined ? null : <div className="shrink-0">{aside}</div>}
      </div>

      {rows.length === 0 ? (
        <p className="mt-6 text-sm text-[#697784]">{emptyMessage}</p>
      ) : (
        <StatusBarPlot title={title} rows={rows} total={total} />
      )}
    </section>
  );
}

interface StatusBarPlotProps {
  readonly title: string;
  readonly rows: readonly StatusBarDatum[];
  readonly total: number;
}

function StatusBarPlot({ title, rows, total }: StatusBarPlotProps) {
  const axisMax = niceCountAxisMax(Math.max(...rows.map((row) => row.value)), TICKS);
  const slot = PLOT_WIDTH / rows.length;
  const barWidth = Math.min(52, Math.max(14, slot * 0.52));
  const ticks = Array.from({ length: TICKS + 1 }, (_, index) => index);

  return (
    <>
      <div className="mt-5 overflow-x-auto">
        <svg
          aria-hidden="true"
          role="presentation"
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          className="h-auto w-full min-w-[440px]"
        >
          <text x={2} y={14} fill="#697784" fontSize="10" letterSpacing="0.6">
            TIKET
          </text>

          {ticks.map((tick) => {
            const y = BASELINE - (tick / TICKS) * PLOT_HEIGHT;
            return (
              <g key={`grid-${tick}`}>
                <line
                  x1={PAD.left}
                  x2={PAD.left + PLOT_WIDTH}
                  y1={y}
                  y2={y}
                  stroke="#e1e5e9"
                  strokeWidth="1"
                  strokeDasharray={tick === 0 ? undefined : '4 5'}
                />
                <text x={PAD.left - 10} y={y + 3} textAnchor="end" fill="#8a97a3" fontSize="10">
                  {formatAxisTick((axisMax / TICKS) * tick)}
                </text>
              </g>
            );
          })}

          {rows.map((datum, index) => {
            const label = statusLabel(datum.status);
            const height = Math.max(3, (datum.value / axisMax) * PLOT_HEIGHT);
            const x = PAD.left + index * slot + (slot - barWidth) / 2;
            const y = BASELINE - height;
            const [firstLine, secondLine] = wrapLabel(label);
            return (
              <g key={`bar-${datum.status}`}>
                <rect
                  x={x}
                  y={y}
                  width={barWidth}
                  height={height}
                  rx="4"
                  fill={TONE_COLORS[datum.tone ?? statusBarTone(datum.status)]}
                  className="transition-opacity hover:opacity-80"
                >
                  <title>
                    {`${label}: ${formatNumberId(datum.value)} tiket (${formatPercent(
                      datum.value,
                      total,
                    )})`}
                  </title>
                </rect>
                <text
                  x={x + barWidth / 2}
                  y={y - 8}
                  textAnchor="middle"
                  fill="#202a33"
                  fontSize="11"
                  fontWeight="600"
                >
                  {formatNumberId(datum.value)}
                </text>
                <text
                  x={x + barWidth / 2}
                  y={BASELINE + 18}
                  textAnchor="middle"
                  fill="#202a33"
                  fontSize="9.5"
                  fontWeight="600"
                >
                  {firstLine}
                </text>
                {secondLine === undefined ? null : (
                  <text
                    x={x + barWidth / 2}
                    y={BASELINE + 30}
                    textAnchor="middle"
                    fill="#697784"
                    fontSize="9.5"
                  >
                    {secondLine}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>

      <table className="sr-only">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th scope="col">Status</th>
            <th scope="col">Tiket</th>
            <th scope="col">Porsi</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((datum) => (
            <tr key={`row-${datum.status}`}>
              <th scope="row">{statusLabel(datum.status)}</th>
              <td>{formatNumberId(datum.value)}</td>
              <td>{formatPercent(datum.value, total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
