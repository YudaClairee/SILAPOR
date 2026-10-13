// Textarea (Task D-1). Styled native <textarea>; no Radix needed.
import type { TextareaHTMLAttributes } from 'react';
import { formControlClasses } from './formControls';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /**
   * Error state. When true the border swaps to danger AND the caller MUST
   * pass `aria-describedby={fieldErrorId}` with a matching
   * `<FieldError id={fieldErrorId} message={error} />` element.
   * @default false
   */
  readonly invalid?: boolean;
}

export function Textarea({ invalid = false, className, ...rest }: TextareaProps) {
  const base = formControlClasses(invalid);
  const classes = className === undefined ? base : `${base} ${className}`;
  return <textarea className={classes} aria-invalid={invalid || undefined} {...rest} />;
}
