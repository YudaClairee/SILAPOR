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

// Phase 5 P5-1: report lifecycle state machine (pure — no I/O, no imports).
// Canonical transition matrix (binding); CLOSED is terminal.
export const REPORT_TRANSITIONS: Readonly<
  Record<ReportStatus, readonly ReportStatus[]>
> = {
  REPORTED: ['VERIFIED'],
  VERIFIED: ['ASSIGNED'],
  ASSIGNED: ['INSPECTION'],
  INSPECTION: ['IN_REPAIR'],
  IN_REPAIR: ['RESOLVED'],
  RESOLVED: ['CLOSED'],
  CLOSED: [],
};

// Pure lookup; unknown strings → false (do not throw).
export function canTransition(from: ReportStatus, to: ReportStatus): boolean {
  const allowed: readonly ReportStatus[] | undefined = (
    REPORT_TRANSITIONS as Partial<Record<string, readonly ReportStatus[]>>
  )[from as string];
  return allowed?.includes(to) ?? false;
}

export function assertTransition(from: ReportStatus, to: ReportStatus): void {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid transition from ${from} to ${to}`);
  }
}

export const TERMINAL_STATUSES = ['CLOSED'] as const;

export type TerminalStatus = (typeof TERMINAL_STATUSES)[number];

// Mandatory-note rule helper (Phase 5 step 10). Keys are transition targets.
export const NOTE_REQUIRED_TRANSITIONS: ReadonlySet<string> = new Set([
  'INSPECTION',
  'IN_REPAIR',
  'RESOLVED',
]);

export function requiresNote(from: ReportStatus, to: ReportStatus): boolean {
  return NOTE_REQUIRED_TRANSITIONS.has(to);
}

// Phase 6 P6-1, realigned 2026-10-17: derived facility status (pure — no I/O,
// no imports). Plan §4.6: facility status is DERIVED from active reports,
// never stored as an independent source of truth. REPORTED_ISSUE was dropped;
// active REPORTED/VERIFIED reports now sit in UNDER_INSPECTION.
export const FACILITY_STATUSES = [
  'OPERATIONAL',
  'UNDER_INSPECTION',
  'IN_REPAIR',
] as const;

export type FacilityStatus = (typeof FACILITY_STATUSES)[number];

// Active report status → public facility status (plan §4.6 table).
const REPORT_STATUS_TO_FACILITY: Readonly<Record<string, FacilityStatus>> = {
  REPORTED: 'UNDER_INSPECTION',
  VERIFIED: 'UNDER_INSPECTION',
  ASSIGNED: 'UNDER_INSPECTION',
  INSPECTION: 'UNDER_INSPECTION',
  IN_REPAIR: 'IN_REPAIR',
};

// Operational severity used when one asset has several active reports:
// IN_REPAIR > UNDER_INSPECTION > OPERATIONAL (plan §4.6).
const FACILITY_SEVERITY: Readonly<Record<FacilityStatus, number>> = {
  OPERATIONAL: 0,
  UNDER_INSPECTION: 1,
  IN_REPAIR: 2,
};

/**
 * Operational severity ranking used for ordering/precedence comparisons:
 * IN_REPAIR (2) > UNDER_INSPECTION (1) > OPERATIONAL (0).
 */
export function facilityStatusSeverity(status: FacilityStatus): number {
  return FACILITY_SEVERITY[status];
}

/**
 * Derives the public facility status from the statuses of a facility's active

 * reports. Unknown/terminal statuses are ignored defensively (callers must
 * pass active statuses only, but a stray RESOLVED/CLOSED must not crash or
 * skew the result). No active report → OPERATIONAL.
 */
export function deriveFacilityStatus(activeStatuses: readonly string[]): FacilityStatus {
  let best: FacilityStatus = 'OPERATIONAL';
  for (const status of activeStatuses) {
    const mapped = REPORT_STATUS_TO_FACILITY[status];
    if (mapped !== undefined && FACILITY_SEVERITY[mapped] > FACILITY_SEVERITY[best]) {
      best = mapped;
    }
  }
  return best;
}

// Phase 5 P5-1: priority scoring — pure deterministic service (pure, no I/O).
// Baseline provisional (pending UMPER calibration).
export const PRIORITY_LEVELS = ['LOW', 'MEDIUM', 'HIGH'] as const;

export type PriorityLevel = (typeof PRIORITY_LEVELS)[number];

export const SCORING_CONFIG_VERSION = 1 as const;

// New-scale medians used when a weight is null/missing (scoringComplete=false).
const CATEGORY_MEDIAN = 17;
const ASSET_MEDIAN = 12;
const LOCATION_MEDIAN = 12;

export interface PriorityScoreInput {
  categoryWeight: number | null;
  assetWeight: number | null;
  locationScore: number | null;
  affectedReporters: number;
  issueTypeCode: string | null;
}

export interface PriorityScoreResult {
  score: number;
  suggestedPriority: PriorityLevel;
  factors: {
    category: number;
    asset: number;
    location: number;
    frequency: number;
    affectedReporters: number;
  };
  scoringComplete: boolean;
  scoringConfigVersion: number;
}

// Frequency tier over distinct active reporters (caller-computed): 1→0, 2→5,
// 3-4→10, ≥5→15; 0 reporters → 0.
export function frequencyBonus(affectedReporters: number): number {
  const n = Math.floor(affectedReporters);
  if (n <= 1) return 0;
  if (n === 2) return 5;
  if (n <= 4) return 10;
  return 15;
}

// Thresholds: 0-39 → LOW, 40-69 → MEDIUM, 70-100 → HIGH. No CRITICAL.
export function mapScoreToPriority(score: number): PriorityLevel {
  if (score >= 70) return 'HIGH';
  if (score >= 40) return 'MEDIUM';
  return 'LOW';
}

export function scorePriority(input: PriorityScoreInput): PriorityScoreResult {
  const category = Math.max(0, Math.min(input.categoryWeight ?? CATEGORY_MEDIAN, 35));
  const asset = Math.max(0, Math.min(input.assetWeight ?? ASSET_MEDIAN, 25));
  const location = Math.max(0, Math.min(input.locationScore ?? LOCATION_MEDIAN, 25));
  const frequency = frequencyBonus(input.affectedReporters);
  const score = Math.min(100, Math.max(0, category + asset + location + frequency));
  let suggestedPriority = mapScoreToPriority(score);
  // Safety override: DANGEROUS issues get at least HIGH; score stays as computed.
  if (input.issueTypeCode === 'DANGEROUS' && suggestedPriority !== 'HIGH') {
    suggestedPriority = 'HIGH';
  }
  const scoringComplete =
    input.categoryWeight != null &&
    input.assetWeight != null &&
    input.locationScore != null;
  return {
    score,
    suggestedPriority,
    factors: {
      category,
      asset,
      location,
      frequency,
      affectedReporters: input.affectedReporters,
    },
    scoringComplete,
    scoringConfigVersion: SCORING_CONFIG_VERSION,
  };
}

// Task 2: AI-verdict mapping (pure, no imports beyond this package).
export { mapAiVerdict } from './ai-verdict.js';
export type { AiVerdictInput, AiVerdictResult } from './ai-verdict.js';
