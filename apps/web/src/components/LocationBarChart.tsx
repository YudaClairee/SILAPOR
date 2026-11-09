// LocationBarChart (Admin dashboard beautification): horizontal bar chart for
// "Ruang Paling Sering Dilaporkan". Rows keep a fixed label column, a scaled
// track and a right-aligned count, with a shared 0…max axis above the bars so
// the lengths are comparable instead of merely ranked.
//
// The track is decorative: every row prints its room name and count as text, so
// nothing depends on bar length or colour alone.
import type { ReactNode } from 'react';
import { formatNumberId, niceCountAxisMax } from '../lib/dashboard-period.js';

export interface LocationBarItem {
  readonly id: string;
  readonly label: string;
  readonly value: number;
}

export interface LocationBarChartProps {
  readonly title: string;
  readonly subtitle?: string;
  readonly items: readonly LocationBarItem[];
  readonly aside?: ReactNode;
  /** Heading id for aria-labelledby; override when two charts share a page. */
  readonly titleId?: string;
  readonly emptyMessage?: string;
  readonly className?: string;
}

const TICKS = 4;

export function LocationBarChart({
  title,
  subtitle,
  items,
  aside,
  titleId = 'location-bar-title',
  emptyMessage = 'Belum ada laporan per ruang pada periode ini.',
  className,
}: LocationBarChartProps) {
  const peak = items.reduce((max, item) => Math.max(max, item.value), 0);
  const axisMax = niceCountAxisMax(peak, TICKS);
  const ticks = Array.from({ length: TICKS + 1 }, (_, index) => index);
  const rowGrid =
    'grid grid-cols-[minmax(0,7rem)_1fr_2rem] items-center gap-3 sm:grid-cols-[minmax(0,10rem)_1fr_2.25rem]';

  return (
    <section
      aria-labelledby={titleId}
      className={`rounded-xl border border-[#e1e5e9] bg-white p-6 shadow-sm ${className ?? ''}`.trim()}
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

      {items.length === 0 ? (
        <p className="mt-6 text-sm text-[#697784]">{emptyMessage}</p>
      ) : (
        <div className="mt-5">
          <div aria-hidden="true" className={`${rowGrid} text-[10px] font-medium text-[#8a97a3]`}>
            <span />
            <span className="flex justify-between">
              {ticks.map((tick) => (
                <span key={`tick-${tick}`}>{formatNumberId((axisMax / TICKS) * tick)}</span>
              ))}
            </span>
            <span />
          </div>

          <ul aria-label={`Rincian ${title}`} className="mt-2 space-y-3">
            {items.map((item) => (
              <li key={item.id} className={rowGrid}>
                <span title={item.label} className="truncate text-xs font-medium text-[#202a33]">
                  {item.label}
                </span>
                <span
                  aria-hidden="true"
                  className="block h-2.5 w-full overflow-hidden rounded-full bg-[#eef2f5]"
                >
                  <span
                    className="block h-full rounded-full bg-accent transition-[width] duration-300"
                    style={{
                      width: `${Math.min(100, Math.max(2, (item.value / axisMax) * 100))}%`,
                    }}
                  />
                </span>
                <span className="text-right text-xs font-semibold text-[#202a33]">
                  {formatNumberId(item.value)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
