// Button (Task D-1). Styled native <button>; no Radix needed (native
// controls satisfy the four-variant vocabulary with full keyboard support).
import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';

/** Base layout shared by every variant: >=44px target, md radius. */
export const buttonBaseClasses =
  'inline-flex min-h-[44px] items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50';

/** Variant tone classes. Primary uses dark text on accent per DESIGN.md
 *  (accent-contrast, 4.89:1 — accent itself is never body text). */
export const buttonVariantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-accent-contrast hover:brightness-95',
  secondary: 'border border-border bg-surface text-text hover:bg-background',
  ghost: 'text-text hover:bg-background',
  destructive: 'bg-danger text-white hover:brightness-95',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual variant. @default 'primary' */
  readonly variant?: ButtonVariant;
  readonly children: ReactNode;
}

export function Button({ variant = 'primary', children, type = 'button', className, ...rest }: ButtonProps) {
  const classes =
    className === undefined
      ? `${buttonBaseClasses} ${buttonVariantClasses[variant]}`
      : `${buttonBaseClasses} ${buttonVariantClasses[variant]} ${className}`;
  return (
    <button type={type} className={classes} {...rest}>
      {children}
    </button>
  );
}
