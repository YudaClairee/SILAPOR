// RankedBarList (Admin dashboard V2, Figma 150:191): the numbered ranking used
// by "Lokasi Rawan Gangguan" and the completion bars used by "Perbaikan Selesai
// per Teknisi". Bars are decorative; the value label next to each row carries
// the same number for assistive tech.
import type { ReactNode } from 'react';

export interface RankedBarItem {
  readonly id: string;
  readonly label: string;
  /** Right-aligned summary, e.g. "22 tiket (45,8%)" or "14 selesai". */
  readonly valueLabel: string;
  readonly value: number;
  readonly description?: string;
}

export interface RankedBarListProps {
  readonly title: string;
  readonly subtitle?: string;
  readonly items: readonly RankedBarItem[];
  readonly aside?: ReactNode;
  readonly titleId?: string;
  readonly showRank?: boolean;
  readonly emptyMessage?: string;
  readonly className?: string;
}

export function RankedBarList({
  title,
  subtitle,
  items,
  aside,
  titleId = 'ranked-bar-title',
  showRank = false,
  emptyMessage = 'Belum ada data pada periode ini.',
  className,
}: RankedBarListProps) {
  const max = items.reduce((peak, item) => Math.max(peak, item.value), 0);

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
        <ul className="mt-5 space-y-4">
          {items.map((item, index) => (
            <li key={item.id}>
              <div className="flex items-baseline justify-between gap-3">
                <span className="flex min-w-0 items-baseline gap-2">
                  {showRank ? (
                    <span className="shrink-0 text-sm font-semibold text-[#202a33]">
                      {index + 1}.
                    </span>
                  ) : null}
                  <span className="min-w-0 break-words text-sm font-semibold text-[#202a33]">
                    {item.label}
                  </span>
                </span>
                <span className="shrink-0 text-xs font-medium text-[#3f4c57]">
                  {item.valueLabel}
                </span>
              </div>
              <div aria-hidden="true" className="mt-2 h-2 overflow-hidden rounded-full bg-[#e8eef2]">
                <div
                  className="h-2 rounded-full bg-accent"
                  style={{ width: `${max === 0 ? 0 : Math.max(4, (item.value / max) * 100)}%` }}
                />
              </div>
              {item.description === undefined ? null : (
                <p className="mt-1 text-xs text-[#697784]">{item.description}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
