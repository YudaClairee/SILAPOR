// StatusBadge (Task D-1). Semantic background + Indonesian text label —
// status is NEVER color-alone. Labels reuse the admin-reports maps
// (statusLabel/priorityLabel) so badge copy cannot drift from list copy.
import type { HTMLAttributes } from 'react';
import { priorityLabel, statusLabel } from '../lib/admin-reports';

const badgeBaseClasses =
  'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium';

const STATUS_TONE_CLASSES: Record<string, string> = {
  REPORTED: 'bg-tint-info text-badge-info',
  VERIFIED: 'bg-tint-info text-badge-info',
  ASSIGNED: 'bg-tint-info text-badge-info',
  INSPECTION: 'bg-tint-info text-badge-info',
  IN_REPAIR: 'bg-tint-info text-badge-info',
  RESOLVED: 'bg-tint-success text-badge-success',
  CLOSED: 'bg-tint-success text-badge-success',
  REJECTED: 'bg-tint-danger text-badge-danger',
  DUPLICATE: 'bg-tint-muted text-badge-muted',
};

const MUTED_TONE = 'bg-tint-muted text-badge-muted';

const PRIORITY_TONE_CLASSES: Record<string, string> = {
  HIGH: 'bg-tint-danger text-badge-danger',
  MEDIUM: 'bg-tint-warning text-badge-warning',
  LOW: 'bg-tint-info text-badge-info',
};

/** Full badge class string for a report status; unknown statuses get muted. */
export function statusBadgeClassesFor(status: string): string {
  return `${badgeBaseClasses} ${STATUS_TONE_CLASSES[status] ?? MUTED_TONE}`;
}

/**
 * Full badge class string for a priority. Null/undefined/blank (unset
 * pre-verification) get muted — the label renders "Belum ditetapkan".
 */
export function priorityBadgeClassesFor(priority: string | null | undefined): string {
  if (priority === null || priority === undefined || priority === '') {
    return `${badgeBaseClasses} ${MUTED_TONE}`;
  }
  return `${badgeBaseClasses} ${PRIORITY_TONE_CLASSES[priority] ?? MUTED_TONE}`;
}

export interface StatusBadgeProps extends HTMLAttributes<HTMLSpanElement> {
  /**
   * Report status (one of the 9 REPORT_STATUS values). When non-blank the
   * badge shows the status; otherwise it shows `priority` (null renders
   * "Belum ditetapkan").
   */
  readonly status?: string | null;
  readonly priority?: string | null | undefined;
}

/**
 * Renders a status badge when `status` is non-blank, else a priority badge.
 * Exactly one of the two is shown; never color-alone (always with text).
 */
export function StatusBadge({ status, priority, className, ...rest }: StatusBadgeProps) {
  const hasStatus = status !== undefined && status !== null && status !== '';
  const label = hasStatus ? statusLabel(status) : priorityLabel(priority ?? null);
  const tone = hasStatus ? statusBadgeClassesFor(status) : priorityBadgeClassesFor(priority);
  const classes = className === undefined ? tone : `${tone} ${className}`;
  return (
    <span className={classes} {...rest}>
      {label}
    </span>
  );
}
