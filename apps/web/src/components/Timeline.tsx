// Timeline (Task D-1). Status/progress history using the maintenance rail:
// a persistent vertical rule with an accent signal milestone per item.
// Takes generic items — NOT report-shaped — so any history can reuse it.
//
// Ticket Detail V2 adds an optional `badge` + `actor` meta row: when either is
// supplied the timestamp moves to the TOP row (timestamp · badge · actor) and
// the body renders underneath, matching the reporter ticket design. Items
// without meta keep the original label → description → timestamp order.
import type { ReactNode } from 'react';
import { UserIcon } from './Icon';

export interface TimelineItem {
  readonly id: string;
  readonly label: ReactNode;
  /** Optional progress-note text; rendered as plain text. */
  readonly description?: ReactNode;
  /** Pre-formatted timestamp text (rendered in mono per DESIGN.md). */
  readonly timestamp: string;
  /** Status chip shown beside the timestamp (e.g. `<StatusBadge status="…" />`). */
  readonly badge?: ReactNode;
  /** Sanitized actor label, e.g. "Catatan Admin/UMPER" or "Sistem SCMS". */
  readonly actor?: string;
}

export interface TimelineProps {
  readonly items: readonly TimelineItem[];
}

export function Timeline({ items }: TimelineProps) {
  return (
    <ol className="border-l-2 border-border pl-0">
      {items.map((item) => {
        const hasMeta = item.badge !== undefined || item.actor !== undefined;
        return (
          <li key={item.id} className="relative pb-4 pl-5 last:pb-0">
            <span
              aria-hidden="true"
              className="absolute top-1 -left-[7px] h-3 w-3 rounded-full border-2 border-accent bg-elevated"
            />
            {hasMeta ? (
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs text-muted">{item.timestamp}</span>
                {item.badge}
                {item.actor === undefined || item.actor === '' ? null : (
                  <span className="inline-flex items-center gap-1 text-xs text-muted">
                    <UserIcon className="h-3 w-3" />
                    {item.actor}
                  </span>
                )}
              </div>
            ) : null}
            <p className="text-sm text-text">{item.label}</p>
            {item.description !== undefined &&
            item.description !== null &&
            item.description !== '' ? (
              <p className="mt-1 text-sm text-pretty break-words whitespace-pre-wrap text-muted">
                {item.description}
              </p>
            ) : null}
            {hasMeta ? null : <p className="font-mono text-xs text-muted">{item.timestamp}</p>}
          </li>
        );
      })}
    </ol>
  );
}

