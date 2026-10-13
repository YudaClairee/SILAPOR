// FieldError (Task D-1). Form error text wired to the describedby contract:
// render `<FieldError id={fieldErrorId} message={error} />` and pass
// `aria-describedby={fieldErrorId}` to the matching Input/Textarea/Select.
// Renders nothing when `message` is null/undefined/blank.
import type { ReactNode } from 'react';

export interface FieldErrorProps {
  /** Must match the control's `aria-describedby` value. */
  readonly id: string;
  readonly message?: string | null | undefined;
  readonly children?: ReactNode;
}

export function FieldError({ id, message, children }: FieldErrorProps) {
  const text = children ?? message;
  if (text === undefined || text === null || (typeof text === 'string' && text === '')) {
    return null;
  }
  return (
    <p id={id} className="mt-1 text-sm text-danger">
      {text}
    </p>
  );
}
