// EmptyState (Task D-1). Explains the next action; primary action goes in
// the `action` slot (usually a Button Link).
import type { ReactNode } from 'react';

export interface EmptyStateProps {
  readonly title: string;
  readonly description: string;
  readonly action?: ReactNode;
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="rounded-md border border-border bg-surface px-6 py-10 text-center">
      <p className="text-base font-semibold text-text">{title}</p>
      <p className="mx-auto mt-2 max-w-[65ch] text-sm text-muted">{description}</p>
      {action === undefined ? null : <div className="mt-4">{action}</div>}
    </div>
  );
}
