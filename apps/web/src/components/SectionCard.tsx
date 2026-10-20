// SectionCard (Ticket Detail V2): the ruled white card used across the
// reporter ticket page — dark-teal icon chip, heading + supporting line, and
// an optional right-aligned aside (badge, pager, action).
//
// Presentational only: no data fetching, no state. `titleId` lets the page
// wire `aria-labelledby` on the surrounding <section>. Ordinary content uses
// the md/lg radius from DESIGN.md; cards are never nested inside cards.
import type { ReactNode } from 'react';

export interface SectionCardProps {
  readonly icon: ReactNode;
  readonly title: string;
  /** Supporting line under the title; omit for a compact header. */
  readonly subtitle?: string;
  /** Right-aligned header slot (status chip, pager, "Read-Only"). */
  readonly aside?: ReactNode;
  readonly titleId?: string;
  readonly children: ReactNode;
  readonly className?: string;
  readonly bodyClassName?: string;
}

const CARD_CLASSES = 'rounded-xl border border-[#e1e5e9] bg-white shadow-sm';

export function SectionCard({
  icon,
  title,
  subtitle,
  aside,
  titleId,
  children,
  className,
  bodyClassName,
}: SectionCardProps) {
  return (
    <section aria-labelledby={titleId} className={`${CARD_CLASSES} ${className ?? ''}`.trim()}>
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#e1e5e9] px-5 py-4">
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden="true"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-white"
          >
            {icon}
          </span>
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-semibold text-text">
              {title}
            </h2>
            {subtitle === undefined ? null : (
              <p className="mt-0.5 text-xs text-muted">{subtitle}</p>
            )}
          </div>
        </div>
        {aside === undefined ? null : <div className="shrink-0">{aside}</div>}
      </div>
      <div className={`px-5 py-4 ${bodyClassName ?? ''}`.trim()}>{children}</div>
    </section>
  );
}
