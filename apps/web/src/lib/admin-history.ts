// Shared admin-history helpers (pure): normalize the two timeline shapes the
// history tab can receive — modern TimelineEntry (kind/at/label/detail) and
// the legacy HistoryEventLike fallback (eventType/createdAt/metadata).
import { eventLabel } from './report-helpers.js';

export interface HistoryEntryLike {
  readonly eventType?: unknown;
  readonly type?: unknown;
  readonly label?: unknown;
  readonly kind?: unknown;
  readonly createdAt?: unknown;
  readonly at?: unknown;
  readonly fromValue?: unknown;
  readonly toValue?: unknown;
  readonly metadata?: unknown;
  readonly message?: unknown;
  readonly note?: unknown;
  readonly reason?: unknown;
  readonly condition?: unknown;
  readonly technicianId?: unknown;
  readonly detail?: unknown;
  readonly id?: unknown;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function nonEmpty(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const t = value.trim();
  return t === '' ? null : t;
}

/** createdAt (legacy) atau at (TimelineEntry). */
export function historyTimestampOf(entry: HistoryEntryLike): string {
  if (typeof entry.createdAt === 'string' && entry.createdAt !== '') return entry.createdAt;
  if (typeof entry.at === 'string' && entry.at !== '') return entry.at;
  return '';
}

function labelKeyOf(entry: HistoryEntryLike): string {
  const direct =
    nonEmpty(entry.eventType) ?? nonEmpty(entry.type) ?? nonEmpty(entry.label) ?? null;
  if (direct !== null) return direct;
  const detail = asRecord(entry.detail);
  if (detail !== null) {
    const nested =
      nonEmpty(detail['eventType']) ??
      nonEmpty(detail['label']) ??
      nonEmpty(detail['relationType']) ??
      null;
    if (nested !== null) return nested;
  }
  return '';
}

function kindOf(entry: HistoryEntryLike): string {
  const detail = asRecord(entry.detail);
  const raw =
    nonEmpty(entry.kind) ?? (detail === null ? null : nonEmpty(detail['kind'])) ?? '';
  return raw.toLowerCase();
}

/** Tipe event kanonik untuk badge/aktor. */
export function entryTypeOf(entry: HistoryEntryLike): string {
  const key = labelKeyOf(entry);
  if (key === 'PROGRESS_NOTE_ADDED' || key === 'ASSIGNMENT') return key;
  return key;
}

/** "Teknisi ditugaskan" / "Relasi laporan" / label event map. */
export function historyLabelOf(entry: HistoryEntryLike): string {
  const kind = kindOf(entry);
  if (kind === 'update') return 'Catatan progres';
  if (kind === 'assignment') return 'Teknisi ditugaskan';
  if (kind === 'relation') return 'Relasi laporan';
  const type = entryTypeOf(entry);
  if (type === 'ASSIGNMENT') return 'Teknisi ditugaskan';
  if (type === 'SUPPORTING' || type === 'RELATED') return 'Relasi laporan';
  if (type !== '') return eventLabel(type);
  return 'Riwayat';
}


/** Status yang dicapai baris ini (chip). Pola reporter + relasi tanpa chip. */
export function historyStatusOf(entry: HistoryEntryLike): string | null {
  const type = entryTypeOf(entry);
  if (type === 'REPORT_CREATED') return 'REPORTED';
  if (type === 'REPORT_VERIFIED') return 'VERIFIED';
  if (type === 'ASSIGNMENT_CHANGED' || type === 'ASSIGNMENT') return 'ASSIGNED';
  if (type === 'REPORT_RESOLVED') return 'RESOLVED';
  if (type === 'REPORT_CLOSED') return 'CLOSED';
  if (type === 'STATUS_CHANGED') {
    const detail = asRecord(entry.detail);
    const meta = detail === null ? null : asRecord(detail['metadata']);
    const metaTop = asRecord(entry.metadata);
    const toValue =
      nonEmpty(entry.toValue) ??
      (detail === null ? null : nonEmpty(detail['toValue'])) ??
      (meta === null ? null : nonEmpty(meta['toValue'])) ??
      (metaTop === null ? null : nonEmpty(metaTop['toValue']));
    return toValue;
  }
  return null;
}

/** Catatan: message update, note transisi (metadata atau detail), alasan. */
export function historyNoteOf(entry: HistoryEntryLike): string | null {
  const detail = asRecord(entry.detail);
  if (detail !== null) {
    const fromDetail =
      nonEmpty(detail['message']) ?? nonEmpty(detail['note']) ?? nonEmpty(detail['reason']);
    if (fromDetail !== null) return fromDetail;
    const meta = asRecord(detail['metadata']);
    if (meta !== null) {
      const note = nonEmpty(meta['note']);
      if (note !== null) return note;
    }
  }
  const metaTop = asRecord(entry.metadata);
  if (metaTop !== null) {
    const note = nonEmpty(metaTop['note']);
    if (note !== null) return note;
  }
  return nonEmpty(entry.message) ?? nonEmpty(entry.note) ?? nonEmpty(entry.reason) ?? null;
}

/** Aktor admin: sistem vs UMPER (UUID tidak pernah dirender). */
export function historyActorOf(entry: HistoryEntryLike): string {
  const type = entryTypeOf(entry);
  if (type === 'REPORT_CREATED' || type === 'AI_ANALYSIS_COMPLETED' || type === 'REPORT_VERIFIED') {
    return 'Sistem SCMS';
  }
  return 'Admin/UMPER';
}

/** Kondisi LAPORAN_PALSU (atas atau nested). */
export function historyConditionOf(entry: HistoryEntryLike): string | null {
  if (entry.condition === 'LAPORAN_PALSU') return 'LAPORAN_PALSU';
  const detail = asRecord(entry.detail);
  if (detail !== null && detail['condition'] === 'LAPORAN_PALSU') return 'LAPORAN_PALSU';
  return null;
}

/** technicianId opaque entry assignment (nama di-resolve terpisah). */
export function historyTechnicianIdOf(entry: HistoryEntryLike): string | null {
  const detail = asRecord(entry.detail);
  if (detail !== null) {
    const id = nonEmpty(detail['technicianId']);
    if (id !== null) return id;
  }
  return nonEmpty(entry.technicianId);
}

/** Pasangan UUID relasi entry kind relation. */
export function historyRelationIdsOf(entry: HistoryEntryLike): {
  readonly source: string | null;
  readonly target: string | null;
} {
  const detail = asRecord(entry.detail);
  if (detail === null) return { source: null, target: null };
  return {
    source: nonEmpty(detail['sourceReportId']),
    target: nonEmpty(detail['targetReportId']),
  };
}

/** "SUPPORTING" → "Pendukung", "RELATED" → "Terkait". */
export function relationTypeLabel(value: string | null): string {
  if (value === 'SUPPORTING') return 'Pendukung';
  if (value === 'RELATED') return 'Terkait';
  return value ?? 'Relasi';
}
