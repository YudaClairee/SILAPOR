// LoadingState (Task D-1). Async-update indicator with role=status
// (implicit aria-live polite).
import type { ReactNode } from 'react';

export interface LoadingStateProps {
  readonly message?: string;
  readonly children?: ReactNode;
}

export function LoadingState({ message = 'Memuat…', children }: LoadingStateProps) {
  return (
    <p role="status" className="text-sm text-muted">
      {children ?? message}
    </p>
  );
}
