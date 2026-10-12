// Timeline (Task D-1). Status/progress history using the maintenance rail:
// a persistent vertical rule with an accent signal milestone per item.
// Takes generic items — NOT report-shaped — so any history can reuse it.
import type { ReactNode } from 'react';

export interface TimelineItem {
  readonly id: string;
  readonly label: ReactNode;
  /** Pre-formatted timestamp text (rendered in mono per DESIGN.md). */
  readonly timestamp: string;
}

export interface TimelineProps {
  readonly items: readonly TimelineItem[];
}

export function Timeline({ items }: TimelineProps) {
  return (
    <ol className="border-l-2 border-border pl-0">
      {items.map((item) => (
        <li key={item.id} className="relative pb-4 pl-5 last:pb-0">
          <span
            aria-hidden="true"
            className="absolute top-1 -left-[7px] h-3 w-3 rounded-full border-2 border-accent bg-elevated"
          />
          <p className="text-sm text-text">{item.label}</p>
          <p className="font-mono text-xs text-muted">{item.timestamp}</p>
        </li>
      ))}
    </ol>
  );
}
