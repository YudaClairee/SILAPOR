// Select (Task D-1). Styled native <select>; no Radix needed (native select
// keeps arrow-key/Enter/Escape/typed-search behavior for free).
import type { SelectHTMLAttributes } from 'react';
import { formControlClasses } from './formControls';

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  /**
   * Error state. When true the border swaps to danger AND the caller MUST
   * pass `aria-describedby={fieldErrorId}` with a matching
   * `<FieldError id={fieldErrorId} message={error} />` element.
   * @default false
   */
  readonly invalid?: boolean;
}

export function Select({ invalid = false, className, children, ...rest }: SelectProps) {
  const base = formControlClasses(invalid);
  const classes = className === undefined ? base : `${base} ${className}`;
  return (
    <select className={classes} aria-invalid={invalid || undefined} {...rest}>
      {children}
    </select>
  );
}
