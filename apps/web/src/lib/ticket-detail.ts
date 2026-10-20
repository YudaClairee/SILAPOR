// Ticket detail helpers (Reporter Detail V2). Pure functions only so the
// page, the status stepper and the unit tests share one definition:
//
// - `STATUS_FLOW` is the reporter-visible normal path (REJECTED/DUPLICATE
//   are terminal side exits, not steps).
// - `deriveStatusTimestamps` reconstructs when each step was reached from the
//   report row plus its (already sanitized) events. Events arrive sorted
//   ascending, so the first match per status is the earliest one.
// - Jakarta formatting is explicit: the host timezone must never decide what
//   "WIB" means for a ticket timestamp.
import { eventLabel } from './report-helpers.js';

export const STATUS_FLOW = [
  'REPORTED',
  'VERIFIED',
  'ASSIGNED',
  'INSPECTION',
  'IN_REPAIR',
  'RESOLVED',
  'CLOSED',
] as const;

export type FlowStatus = (typeof STATUS_FLOW)[number];

const FLOW_SET: ReadonlySet<string> = new Set(STATUS_FLOW);

export function isFlowStatus(value: string): value is FlowStatus {
  return FLOW_SET.has(value);
}

/** Step copy for the "Tahap n dari 7 · …" line. */
export const FLOW_PHASE_LABELS: Record<FlowStatus, string> = {
  REPORTED: 'Laporan Diterima',
  VERIFIED: 'Verifikasi Selesai',
  ASSIGNED: 'Teknisi Ditugaskan',
  INSPECTION: 'Inspeksi Lapangan',
  IN_REPAIR: 'Perbaikan Sedang Berlangsung',
  RESOLVED: 'Menunggu Penutupan',
  CLOSED: 'Finalisasi',
};

export interface FlowEventLike {
  readonly eventType?: unknown;
  readonly type?: unknown;
  readonly createdAt?: unknown;
  readonly at?: unknown;
  readonly toValue?: unknown;
}

export interface FlowReportLike {
  readonly reportedAt: string;
  // Optional: an older cached payload may omit the milestone columns.
  readonly verifiedAt?: string | null;
  readonly resolvedAt?: string | null;
  readonly closedAt?: string | null;
}

export type FlowTimestamps = Record<FlowStatus, string | null>;

function emptyTimestamps(): FlowTimestamps {
  return {
    REPORTED: null,
    VERIFIED: null,
    ASSIGNED: null,
    INSPECTION: null,
    IN_REPAIR: null,
    RESOLVED: null,
    CLOSED: null,
  };
}

function eventTypeOf(entry: FlowEventLike): string {
  if (typeof entry.eventType === 'string') return entry.eventType;
  if (typeof entry.type === 'string') return entry.type;
  return '';
}

function strOrNull(value: string | null | undefined): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function eventTimeOf(entry: FlowEventLike): string {
  if (typeof entry.createdAt === 'string') return entry.createdAt;
  if (typeof entry.at === 'string') return entry.at;
  return '';
}

const EVENT_STATUS: Readonly<Record<string, FlowStatus>> = {
  REPORT_CREATED: 'REPORTED',
  REPORT_VERIFIED: 'VERIFIED',
  ASSIGNMENT_CHANGED: 'ASSIGNED',
  REPORT_RESOLVED: 'RESOLVED',
  REPORT_CLOSED: 'CLOSED',
};

export function deriveStatusTimestamps(
  report: FlowReportLike,
  events: readonly FlowEventLike[],
): FlowTimestamps {
  const out = emptyTimestamps();
  out.REPORTED = strOrNull(report.reportedAt);
  out.VERIFIED = strOrNull(report.verifiedAt);
  out.RESOLVED = strOrNull(report.resolvedAt);
  out.CLOSED = strOrNull(report.closedAt);

  for (const event of events) {
    const at = eventTimeOf(event);
    if (at === '') continue;
    const type = eventTypeOf(event);
    const status =
      EVENT_STATUS[type] ??
      (type === 'STATUS_CHANGED' && typeof event.toValue === 'string' && isFlowStatus(event.toValue)
        ? event.toValue
        : null);
    if (status === null || out[status] !== null) continue;
    out[status] = at;
  }
  return out;
}

/** 0-based index of the current step, or -1 for REJECTED/DUPLICATE/unknown. */
export function flowIndexOf(status: string): number {
  return STATUS_FLOW.indexOf(status as FlowStatus);
}

/** "Tahap 5 dari 7 · Perbaikan Sedang Berlangsung"; null off the normal path. */
export function flowPhaseLine(status: string): string | null {
  const index = flowIndexOf(status);
  if (index < 0) return null;
  const label = FLOW_PHASE_LABELS[status as FlowStatus];
  return `Tahap ${index + 1} dari ${STATUS_FLOW.length} · ${label}`;
}

const JAKARTA = 'Asia/Jakarta';

function toDate(value: string | null): Date | null {
  if (value === null || value === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function datePart(date: Date): string {
  return date.toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: JAKARTA,
  });
}

function timePart(date: Date): string {
  // id-ID renders 08.30; ticket copy uses 08:30.
  return date
    .toLocaleTimeString('id-ID', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone: JAKARTA,
    })
    .replace('.', ':');
}

/** "12 Okt 2026, 08:30 WIB" — null/empty renders an em dash. */
export function formatJakartaDateTime(value: string | null): string {
  const date = toDate(value);
  if (date === null) return '—';
  return `${datePart(date)}, ${timePart(date)} WIB`;
}

/** "12 Okt 08:30" — compact stepper milestone, no year/WIB suffix. */
export function formatJakartaShort(value: string | null): string {
  const date = toDate(value);
  if (date === null) return '—';
  const short = date.toLocaleDateString('id-ID', {
    day: 'numeric',
    month: 'short',
    timeZone: JAKARTA,
  });
  return `${short} ${timePart(date)}`;
}

/** "12 Okt 2026" — date-only label. */
export function formatJakartaDate(value: string | null): string {
  const date = toDate(value);
  return date === null ? '—' : datePart(date);
}

/** "12 Okt" — compact pager copy. */
export function formatJakartaDayMonth(value: string | null): string {
  const date = toDate(value);
  if (date === null) return '—';
  return date.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', timeZone: JAKARTA });
}

/**
 * Creation and AI verification are system steps; everything else the reporter
 * sees comes from a human admin/UMPER action. Identity stays hidden either way
 * (the reporter API never exposes actor ids).
 */
export function actorLabel(entry: FlowEventLike): string {
  const type = eventTypeOf(entry);
  if (type === 'REPORT_CREATED' || type === 'AI_ANALYSIS_COMPLETED' || type === 'REPORT_VERIFIED') {
    return 'Sistem SCMS';
  }
  return 'Catatan Admin/UMPER';
}

/** Event label for the timeline; unknown types fall back to the raw code. */
export function timelineLabel(entry: FlowEventLike): string {
  const type = eventTypeOf(entry);
  return type === '' ? 'Riwayat' : eventLabel(type);
}

/** 0..1 (or already-percent) confidence → integer percent; null stays null. */
export function confidencePercent(value: number | null): number | null {
  if (value === null || !Number.isFinite(value)) return null;
  const percent = value <= 1 ? value * 100 : value;
  return Math.max(0, Math.min(100, Math.round(percent)));
}

/** Confidence band copy used beside the meter. */
export function confidenceBand(percent: number): 'Tinggi' | 'Sedang' | 'Rendah' {
  if (percent >= 80) return 'Tinggi';
  if (percent >= 50) return 'Sedang';
  return 'Rendah';
}

/** Skor 0..100 → "88,5" (koma Indonesia, satu desimal bila perlu). */
export function formatScoreId(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const rounded = Math.round(value * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return text.replace('.', ',');
}

/** Confidence 0..1 (atau persen) → "94%" untuk meter AI. */
export function formatConfidencePercent(value: number | null): string {
  const percent = confidencePercent(value);
  return percent === null ? '—' : `${percent}%`;
}

export interface LocationHierarchyOption {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly parentId: string | null;
  readonly buildingCode: string | null;
  readonly floorNumber: number | null;
}

export interface LocationParts {
  readonly building: string | null;
  readonly floor: string | null;
  readonly room: string | null;
}

const EMPTY_LOCATION_PARTS: LocationParts = { building: null, floor: null, room: null };

/**
 * Walks the location ancestors (ROOM → FLOOR → BUILDING) from the form-options
 * projection. Missing links and cycles degrade to null instead of throwing, so
 * a partially seeded master data set still renders a usable card.
 */
export function locationParts(
  locationId: string | null,
  locations: readonly LocationHierarchyOption[],
): LocationParts {
  if (locationId === null) return EMPTY_LOCATION_PARTS;
  const byId = new Map(locations.map((location) => [location.id, location] as const));
  let cursor = byId.get(locationId) ?? null;
  const parts: { building: string | null; floor: string | null; room: string | null } = {
    ...EMPTY_LOCATION_PARTS,
  };
  const seen = new Set<string>();
  while (cursor !== null && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    if (cursor.type === 'ROOM' || cursor.type === 'SHARED_AREA') {
      parts.room ??= cursor.name;
    } else if (cursor.type === 'FLOOR') {
      parts.floor ??= cursor.name;
    } else if (cursor.type === 'BUILDING') {
      parts.building ??=
        cursor.name === ''
          ? cursor.buildingCode === null
            ? null
            : `Gedung ${cursor.buildingCode}`
          : cursor.name;
    }
    cursor = cursor.parentId === null ? null : (byId.get(cursor.parentId) ?? null);
  }
  if (parts.building === null || parts.floor === null) {
    const start = byId.get(locationId);
    if (start !== undefined) {
      if (parts.building === null && start.buildingCode !== null && start.buildingCode !== '') {
        parts.building = `Gedung ${start.buildingCode}`;
      }
      if (parts.floor === null && start.floorNumber !== null) {
        parts.floor = `Lantai ${start.floorNumber}`;
      }
    }
  }
  return parts;
}

