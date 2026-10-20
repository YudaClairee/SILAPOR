// CategoryDonut (Admin dashboard V2, Figma 150:191): donut + legend for
// "Kerusakan per Kategori Fasilitas". The ring is decorative — the legend list
// carries the same numbers, so no colour-only encoding.
import type { ReactNode } from 'react';
import { formatNumberId, formatPercent } from '../lib/dashboard-period.js';

export interface CategoryDonutDatum {
  readonly label: string;
  readonly value: number;
}

export interface CategoryDonutProps {
  readonly title: string;
  readonly subtitle?: string;
  /** Caption under the centre total, e.g. "TOTAL TIKET". */
  readonly centerLabel: string;
  readonly data: readonly CategoryDonutDatum[];
  readonly emptyMessage?: string;
  readonly aside?: ReactNode;
  /** Heading id for aria-labelledby; override when two donuts share a page. */
  readonly titleId?: string;
}

const SIZE = 190;
const RADIUS = 68;
const STROKE = 26;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;
const SLICE_COLORS = ['#0a3947', '#1d5b6b', '#3d8ea0', '#7fb0bd', '#d7e3e8'] as const;

export function CategoryDonut({
  title,
  subtitle,
  centerLabel,
  data,
  emptyMessage = 'Belum ada laporan pada periode ini.',
  aside,
  titleId = 'category-donut-title',
}: CategoryDonutProps) {
  const total = data.reduce((sum, datum) => sum + datum.value, 0);
  const sectors = data.map((datum, index) => {
    const fraction = total === 0 ? 0 : datum.value / total;
    return {
      datum,
      color: SLICE_COLORS[index % SLICE_COLORS.length] as string,
      length: fraction * CIRCUMFERENCE,
      offset: data
        .slice(0, index)
        .reduce((sum, previous) => sum + (total === 0 ? 0 : previous.value / total), 0) *
        CIRCUMFERENCE,
    };
  });

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

      {total === 0 ? (
        <p className="mt-6 text-sm text-[#697784]">{emptyMessage}</p>
      ) : (
        <div className="mt-6 flex flex-col items-center gap-6 sm:flex-row sm:items-center">
          <div className="relative shrink-0">
            <svg
              aria-hidden="true"
              role="presentation"
              viewBox={`0 0 ${SIZE} ${SIZE}`}
              className="h-[190px] w-[190px]"
            >
              <circle
                cx={SIZE / 2}
                cy={SIZE / 2}
                r={RADIUS}
                fill="none"
                stroke="#eef2f5"
                strokeWidth={STROKE}
              />
              <g transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}>
                {sectors.map((sector) => (
                  <circle
                    key={sector.datum.label}
                    cx={SIZE / 2}
                    cy={SIZE / 2}
                    r={RADIUS}
                    fill="none"
                    stroke={sector.color}
                    strokeWidth={STROKE}
                    strokeDasharray={`${sector.length} ${CIRCUMFERENCE - sector.length}`}
                    strokeDashoffset={-sector.offset}
                  />
                ))}
              </g>
            </svg>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-3xl font-bold text-[#202a33]">{formatNumberId(total)}</span>
              <span className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.12em] text-[#697784]">
                {centerLabel}
              </span>
            </div>
          </div>

          <ul aria-label={`Rincian ${title}`} className="w-full min-w-0 space-y-3">
            {data.map((datum, index) => (
              <li key={datum.label} className="flex items-center gap-3 text-sm">
                <span
                  aria-hidden="true"
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: SLICE_COLORS[index % SLICE_COLORS.length] }}
                />
                <span className="min-w-0 flex-1 break-words text-[#202a33]">{datum.label}</span>
                <span className="shrink-0 font-semibold text-[#202a33]">
                  {formatNumberId(datum.value)}
                </span>
                <span className="w-16 shrink-0 text-right text-xs text-[#697784]">
                  ({formatPercent(datum.value, total)})
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
