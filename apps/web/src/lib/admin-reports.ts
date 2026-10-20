// Admin reports pure helpers (Phase 3 P3-6).
//
// Client-side only: admin list param building (mirrors the server parsing in
// `../server/reports.js` — blank search omitted, invalid values omitted here
// while the server still validates and 400s on bad direct API calls),
// pagination ranges, and Indonesian status/priority labels. No DB, no HTTP,
// no DOM.

import { REPORT_STATUS } from '@silapor/domain';

const KNOWN_STATUSES: ReadonlySet<string> = new Set(REPORT_STATUS as readonly string[]);

const ADMIN_SORTS = [
  'priority_desc',
  'reported_desc',
  'reported_asc',
  'ticket_asc',
  'ticket_desc',
] as const;

export type AdminSort = (typeof ADMIN_SORTS)[number];

/** Indonesian labels for the list sort control (Figma 150:626). */
export const ADMIN_SORT_LABELS: Readonly<Record<AdminSort, string>> = {
  priority_desc: 'Skor Prioritas Tertinggi',
  reported_desc: 'Terbaru Dulu',
  reported_asc: 'Terlama Dulu',
  ticket_asc: 'Nomor Tiket A–Z',
  ticket_desc: 'Nomor Tiket Z–A',
};

export const ADMIN_SORT_OPTIONS: ReadonlyArray<{ value: AdminSort; label: string }> =
  ADMIN_SORTS.map((value) => ({ value, label: ADMIN_SORT_LABELS[value] }));

const KNOWN_SORTS: ReadonlySet<string> = new Set(ADMIN_SORTS as readonly string[]);

const KNOWN_PRIORITIES: ReadonlySet<string> = new Set(['LOW', 'MEDIUM', 'HIGH']);

export const DEFAULT_ADMIN_SORT: AdminSort = 'reported_desc';
export const DEFAULT_ADMIN_LIMIT = 50;

// ---------------------------------------------------------------------------
// Admin list params.
// ---------------------------------------------------------------------------

export interface AdminListState {
  readonly search?: string | undefined;
  readonly status?: string | readonly string[] | undefined;
  readonly categoryId?: string | undefined;
  readonly locationId?: string | undefined;
  readonly priority?: string | undefined;
  readonly reporterId?: string | undefined;
  readonly from?: string | undefined;
  readonly to?: string | undefined;
  readonly sort?: string | undefined;
  readonly limit?: number | undefined;
  readonly offset?: number | undefined;
}

export type AdminListParams = Record<string, string | readonly string[]>;

function cleanText(value: string | undefined): string | null {
  if (value === undefined) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

// Builds the admin list query object: blank search omitted (the box needs
// min 2 chars — shorter input means "no filter", never a 400), unknown
// status/priority/sort values omitted-or-defaulted (the server validates
// direct API calls itself). Non-empty UUID/date/reporter filters pass
// through as-is.
export function buildAdminListParams(state: AdminListState): AdminListParams {
  const params: Record<string, string | readonly string[]> = {};

  const search = cleanText(state.search);
  if (search !== null && search.length >= 2) {
    params['search'] = search;
  }

  const rawStatuses =
    state.status === undefined ? [] : Array.isArray(state.status) ? state.status : [state.status];
  const statuses = rawStatuses.filter((status) => KNOWN_STATUSES.has(status));
  if (statuses.length === 1) {
    const only = statuses[0];
    if (only !== undefined) {
      params['status'] = only;
    }
  } else if (statuses.length > 1) {
    params['status'] = statuses;
  }

  const passthrough: ReadonlyArray<{
    readonly key: 'categoryId' | 'locationId' | 'reporterId' | 'from' | 'to';
    readonly param: string;
  }> = [
    { key: 'categoryId', param: 'categoryId' },
    { key: 'locationId', param: 'locationId' },
    { key: 'reporterId', param: 'reporterId' },
    { key: 'from', param: 'from' },
    { key: 'to', param: 'to' },
  ];
  for (const { key, param } of passthrough) {
    const value = cleanText(state[key]);
    if (value !== null) {
      params[param] = value;
    }
  }

  const priority = cleanText(state.priority);
  if (priority !== null && KNOWN_PRIORITIES.has(priority)) {
    params['priority'] = priority;
  }

  const sort = cleanText(state.sort);
  params['sort'] = sort !== null && KNOWN_SORTS.has(sort) ? sort : DEFAULT_ADMIN_SORT;

  const limit = state.limit;
  params['limit'] = String(
    limit !== undefined && Number.isFinite(limit) && limit > 0
      ? Math.floor(limit)
      : DEFAULT_ADMIN_LIMIT,
  );
  const offset = state.offset;
  params['offset'] = String(
    offset !== undefined && Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : 0,
  );

  return params;
}

// Serializes a param object to a query string (repeatable `status` keys).
export function toAdminListQuery(params: AdminListParams): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string') {
      search.set(key, value);
    } else {
      for (const entry of value) {
        search.append(key, entry);
      }
    }
  }
  return search.toString();
}

// ---------------------------------------------------------------------------
// Pagination range.
// ---------------------------------------------------------------------------

export interface PageRange {
  readonly from: number;
  readonly to: number;
  readonly hasPrev: boolean;
  readonly hasNext: boolean;
}

// `from`/`to` are 1-based row numbers for the "a–b dari N" indicator
// (both 0 when the list is empty).
export function pageRange(total: number, limit: number, offset: number): PageRange {
  const safeTotal = Number.isFinite(total) && total > 0 ? Math.floor(total) : 0;
  if (safeTotal === 0) {
    return { from: 0, to: 0, hasPrev: false, hasNext: false };
  }
  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : DEFAULT_ADMIN_LIMIT;
  const safeOffset = Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : 0;
  return {
    from: safeOffset + 1,
    to: Math.min(safeOffset + safeLimit, safeTotal),
    hasPrev: safeOffset > 0,
    hasNext: safeOffset + safeLimit < safeTotal,
  };
}

// ---------------------------------------------------------------------------
// Indonesian display labels.
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

export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

const PRIORITY_LABELS: Record<string, string> = {
  LOW: 'Rendah',
  MEDIUM: 'Sedang',
  HIGH: 'Tinggi',
};

// `final_priority` is nullable pre-verification — null renders
// "Belum ditetapkan", never a blank.
export function priorityLabel(priority: string | null | undefined): string {
  if (priority === null || priority === undefined || priority === '') {
    return 'Belum ditetapkan';
  }
  return PRIORITY_LABELS[priority] ?? priority;
}
