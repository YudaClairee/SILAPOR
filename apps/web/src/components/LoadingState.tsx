// LoadingState (Task D-1). Async-update indicator with role=status
// (implicit aria-live polite).
import type { ReactNode } from 'react';

export interface LoadingStateProps {
  readonly message?: string;
  readonly children?: ReactNode;
}

export function LoadingState({ message = 'Memuat…', children }: LoadingStateProps) {
  return (
    <div
      role="status"
      className="flex items-center gap-3 rounded-lg border border-border bg-surface px-4 py-4 text-sm text-muted"
    >
      <span
        aria-hidden="true"
        className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-border border-t-accent motion-reduce:animate-none"
      />
      <span>{children ?? message}</span>
    </div>
  );
}
