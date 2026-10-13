// Input (Task D-1). Styled native <input>; no Radix needed.
import type { InputHTMLAttributes } from 'react';
import { formControlClasses } from './formControls';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /**
   * Error state. When true the border swaps to danger AND the caller MUST
   * pass `aria-describedby={fieldErrorId}` with a matching
   * `<FieldError id={fieldErrorId} message={error} />` element.
   * @default false
   */
  readonly invalid?: boolean;
}

export function Input({ invalid = false, className, ...rest }: InputProps) {
  const base = formControlClasses(invalid);
  const classes = className === undefined ? base : `${base} ${className}`;
  return <input className={classes} aria-invalid={invalid || undefined} {...rest} />;
}
