// ErrorPanel (Task D-1). Failure surface with role=alert; retry control
// goes in the `retry` slot (usually a Button).
import type { ReactNode } from 'react';

export interface ErrorPanelProps {
  readonly title?: string;
  readonly message: string;
  readonly retry?: ReactNode;
}

export function ErrorPanel({ title = 'Gagal memuat', message, retry }: ErrorPanelProps) {
  return (
    <div role="alert" className="rounded-md border border-danger bg-surface px-4 py-3">
      <p className="text-sm font-semibold text-text">{title}</p>
      <p className="mt-1 text-sm text-muted">{message}</p>
      {retry === undefined ? null : <div className="mt-3">{retry}</div>}
    </div>
  );
}
