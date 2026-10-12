// Task 1 stub: real entities/state machines land in later tasks.
// Boundary: this package MUST NOT import framework/infra
// (see eslint.config.mjs + docs/monorepo-boundaries.md).
export const DOMAIN_PLACEHOLDER = true as const;

// Phase 3 P3-1: report lifecycle constants (pure — no I/O, no imports).
// Values are binding across P3 tasks; keep verbatim.

export const REPORT_STATUS = [
  'REPORTED',
  'VERIFIED',
  'ASSIGNED',
  'INSPECTION',
  'IN_REPAIR',
  'RESOLVED',
  'CLOSED',
  'REJECTED',
  'DUPLICATE',
] as const;

export type ReportStatus = (typeof REPORT_STATUS)[number];

// Open-work subset (decision §4): RESOLVED is NOT active.
export const ACTIVE_REPORT_STATUSES = [
  'REPORTED',
  'VERIFIED',
  'ASSIGNED',
  'INSPECTION',
  'IN_REPAIR',
] as const;

export type ActiveReportStatus = (typeof ACTIVE_REPORT_STATUSES)[number];

export const RELATION_TYPE = ['SUPPORTING', 'RELATED'] as const;

export type RelationType = (typeof RELATION_TYPE)[number];

// Minimum binding set; later phases may append.
export const REPORT_EVENT_TYPE = [
  'REPORT_CREATED',
  'AI_ANALYSIS_COMPLETED',
  'REPORT_VERIFIED',
  'STATUS_CHANGED',
  'PRIORITY_CHANGED',
  'ASSIGNMENT_CHANGED',
  'PUBLIC_UPDATE_ADDED',
  'INTERNAL_NOTE_ADDED',
  'REPORT_RESOLVED',
  'REPORT_CLOSED',
] as const;

export type ReportEventType = (typeof REPORT_EVENT_TYPE)[number];

export const DUPLICATE_LOOKBACK_DAYS = 14 as const;

// Ticket numbers are `MNT-{YEAR}-{SEQ padded to 6 digits}`
// (e.g. 2026, 124 → `MNT-2026-000124`).
export function formatTicketNumber(year: number, seq: number): string {
  return `MNT-${year}-${String(seq).padStart(6, '0')}`;
}
