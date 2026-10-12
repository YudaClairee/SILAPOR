// TicketMono (Task D-1). Mono span for ticket numbers, room codes,
// timestamps and audit metadata (DESIGN.md utility role).
import type { HTMLAttributes, ReactNode } from 'react';

export interface TicketMonoProps extends HTMLAttributes<HTMLSpanElement> {
  readonly children: ReactNode;
}

export function TicketMono({ children, className, ...rest }: TicketMonoProps) {
  const classes = className === undefined ? 'font-mono' : `font-mono ${className}`;
  return (
    <span className={classes} {...rest}>
      {children}
    </span>
  );
}
