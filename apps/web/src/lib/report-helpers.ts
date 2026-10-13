// Reporter report-form pure helpers (Phase 3 P3-5).
//
// Client-side only: option filtering for the dependent selects, fast
// client validation mirroring the server rules (server validation in
// packages/database remains authoritative — repo 400s render as-is),
// duplicate-check param building, "Laporan Saya" query building, and the
// SAFE timeline/status label maps (labels + timestamps only — raw event
// message/metadata blobs are never rendered).
//
// Structural (minimal-field) generics keep this module decoupled from the
// server option shapes in `../server/reports.js` — the payloads are
// compatible by construction (same ids).

import { ACTIVE_REPORT_STATUSES, REPORT_STATUS } from '@silapor/domain';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// Form values + validation.
// ---------------------------------------------------------------------------

export interface ReportFormValues {
  readonly buildingId: string;
  readonly locationId: string;
  readonly categoryId: string;
  // '' means "no asset" (asset tidak ditemukan) — sent as null.
  readonly assetId: string;
  readonly issueTypeId: string;
  readonly description: string;
  // '' means "no occurredAt" — otherwise a datetime-local value.
  readonly occurredAt: string;
}

export type ReportFormField =
  | 'buildingId'
  | 'locationId'
  | 'categoryId'
  | 'assetId'
  | 'issueTypeId'
  | 'description'
  | 'occurredAt';

export type ReportFormErrors = Partial<Record<ReportFormField, string>>;

function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

// Fast client feedback only — mirrors the repo validators
// (`validateCreateReportInput`): required ids, description 10–2000 trimmed,
// occurredAt ≤ now. The issue type is required by this form (the server
// accepts null, but the form always offers the 7 generic options).
export function validateReportForm(values: ReportFormValues): ReportFormErrors {
  const errors: ReportFormErrors = {};
  if (values.buildingId === '') {
    errors.buildingId = 'Pilih gedung terlebih dahulu.';
  }
  if (values.locationId === '') {
    errors.locationId = 'Pilih ruangan terlebih dahulu.';
  } else if (!isUuid(values.locationId)) {
    errors.locationId = 'Ruangan tidak valid.';
  }
  if (values.categoryId === '') {
    errors.categoryId = 'Pilih kategori terlebih dahulu.';
  } else if (!isUuid(values.categoryId)) {
    errors.categoryId = 'Kategori tidak valid.';
  }
  if (values.assetId !== '' && !isUuid(values.assetId)) {
    errors.assetId = 'Asset tidak valid.';
  }
  if (values.issueTypeId === '') {
    errors.issueTypeId = 'Pilih jenis masalah terlebih dahulu.';
  } else if (!isUuid(values.issueTypeId)) {
    errors.issueTypeId = 'Jenis masalah tidak valid.';
  }
  const trimmed = values.description.trim();
  if (trimmed.length < 10) {
    errors.description = 'Deskripsi minimal 10 karakter.';
  } else if (trimmed.length > 2000) {
    errors.description = 'Deskripsi maksimal 2000 karakter.';
  }
  if (values.occurredAt !== '') {
    const date = new Date(values.occurredAt);
    if (Number.isNaN(date.getTime())) {
      errors.occurredAt = 'Waktu kejadian tidak valid.';
    } else if (date.getTime() > Date.now()) {
      errors.occurredAt = 'Waktu kejadian tidak boleh di masa depan.';
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Option filtering (one form-options payload feeds every select).
// ---------------------------------------------------------------------------

export interface AssetRef {
  readonly id: string;
  readonly categoryId: string | null;
  readonly locationId: string | null;
}

// Assets carry categoryId/locationId UUIDs (not codes): keep rows matching
// BOTH selected ids. Nulls never match a selection.
export function filterAssetsByCategoryLocation<T extends AssetRef>(
  assets: readonly T[],
  categoryId: string,
  locationId: string,
): T[] {
  return assets.filter(
    (asset) => asset.categoryId === categoryId && asset.locationId === locationId,
  );
}

export interface LocationRef {
  readonly id: string;
  readonly type: string;
  readonly parentId: string | null;
}

// Defensive re-filter: the server already excludes inactive + reporterHidden
// rows, but any leak (or foreign shape carrying the flags) is dropped here.
// Plain option payloads (no flags) pass through unchanged.
export function visibleLocations<T>(locations: readonly T[]): T[] {
  return locations.filter((location) => {
    const flags = location as { readonly isActive?: unknown; readonly reporterHidden?: unknown };
    return flags.isActive !== false && flags.reporterHidden !== true;
  });
}

// Gedung select: BUILDING rows only.
export function buildingsOf<T extends LocationRef>(locations: readonly T[]): T[] {
  return locations.filter((location) => location.type === 'BUILDING');
}

// Ruangan cascade: ROOM rows under the building — directly parented, or via
// one of the building's FLOOR rows (seed shape: building → floor → room).
export function roomsForBuilding<T extends LocationRef>(
  locations: readonly T[],
  buildingId: string,
): T[] {
  const floorIds = new Set(
    locations
      .filter((location) => location.type === 'FLOOR' && location.parentId === buildingId)
      .map((floor) => floor.id),
  );
  return locations.filter(
    (location) =>
      location.type === 'ROOM' &&
      (location.parentId === buildingId ||
        (location.parentId !== null && floorIds.has(location.parentId))),
  );
}

export interface IssueTypeRef {
  readonly id: string;
  readonly categoryId: string | null;
}

// Generic (unlinked) issue types show for every category; a category-linked
// row shows only for its category. No category chosen yet → show all.
export function issueTypesForCategory<T extends IssueTypeRef>(
  issueTypes: readonly T[],
  categoryId: string,
): T[] {
  if (categoryId === '') {
    return [...issueTypes];
  }
  return issueTypes.filter(
    (issueType) => issueType.categoryId === null || issueType.categoryId === categoryId,
  );
}

// ---------------------------------------------------------------------------
// Duplicate-check params.
// ---------------------------------------------------------------------------

export interface DuplicateCheckParams {
  readonly locationId: string;
  readonly categoryId: string;
  readonly assetId?: string | undefined;
  readonly issueTypeId?: string | undefined;
}

// Empty optionals are omitted (the server treats them as absent).
export function buildDuplicateCheckParams(
  values: Pick<ReportFormValues, 'locationId' | 'categoryId' | 'assetId' | 'issueTypeId'>,
): DuplicateCheckParams {
  return {
    locationId: values.locationId,
    categoryId: values.categoryId,
    ...(values.assetId !== '' ? { assetId: values.assetId } : {}),
    ...(values.issueTypeId !== '' ? { issueTypeId: values.issueTypeId } : {}),
  };
}

export function toDuplicateCheckQuery(params: DuplicateCheckParams): string {
  const search = new URLSearchParams();
  search.set('locationId', params.locationId);
  search.set('categoryId', params.categoryId);
  if (params.assetId !== undefined) {
    search.set('assetId', params.assetId);
  }
  if (params.issueTypeId !== undefined) {
    search.set('issueTypeId', params.issueTypeId);
  }
  return search.toString();
}

// ---------------------------------------------------------------------------
// "Laporan Saya" list query.
// ---------------------------------------------------------------------------

const TERMINAL_REPORT_STATUSES: readonly string[] = REPORT_STATUS.filter(
  (status) => !(ACTIVE_REPORT_STATUSES as readonly string[]).includes(status),
);

function isKnownStatus(value: string): boolean {
  return (REPORT_STATUS as readonly string[]).includes(value);
}

// Default sort reported_desc, limit 50 (brief binding). An exact status wins
// over the chip filter; chips expand to the binding status sets.
export function buildMyReportsQuery(input: {
  readonly filter?: string | undefined;
  readonly status?: string | undefined;
  readonly offset?: number | undefined;
}): string {
  const search = new URLSearchParams();
  search.set('sort', 'reported_desc');
  search.set('limit', '50');
  const offset = input.offset ?? 0;
  search.set('offset', String(Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : 0));
  const exact = input.status ?? '';
  if (exact !== '' && isKnownStatus(exact)) {
    search.set('status', exact);
    return search.toString();
  }
  const statuses =
    input.filter === 'aktif'
      ? ACTIVE_REPORT_STATUSES
      : input.filter === 'selesai'
        ? TERMINAL_REPORT_STATUSES
        : [];
  for (const status of statuses) {
    search.append('status', status);
  }
  return search.toString();
}

// ---------------------------------------------------------------------------
// Safe display labels (Indonesian). Timeline renders these + timestamps
// ONLY — never raw message/metadata blobs.
// ---------------------------------------------------------------------------

const STATUS_LABELS: Record<string, string> = {
  REPORTED: 'Dilaporkan',
  VERIFIED: 'Terverifikasi',
  ASSIGNED: 'Ditugaskan',
  INSPECTION: 'Inspeksi',
  IN_REPAIR: 'Dalam perbaikan',
  RESOLVED: 'Selesai',
  CLOSED: 'Ditutup',
  REJECTED: 'Ditolak',
  DUPLICATE: 'Duplikat',
};

export function reportStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

const EVENT_LABELS: Record<string, string> = {
  REPORT_CREATED: 'Laporan dibuat',
  AI_ANALYSIS_COMPLETED: 'Analisis AI selesai',
  REPORT_VERIFIED: 'Laporan diverifikasi',
  STATUS_CHANGED: 'Status berubah',
  PRIORITY_CHANGED: 'Prioritas berubah',
  ASSIGNMENT_CHANGED: 'Penugasan berubah',
  PUBLIC_UPDATE_ADDED: 'Pembaruan ditambahkan',
  INTERNAL_NOTE_ADDED: 'Catatan internal ditambahkan',
  REPORT_RESOLVED: 'Laporan diselesaikan',
  REPORT_CLOSED: 'Laporan ditutup',
};

export function eventLabel(type: string): string {
  return EVENT_LABELS[type] ?? type;
}
