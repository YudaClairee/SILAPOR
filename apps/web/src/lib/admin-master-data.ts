// Data Master Referensi helpers (Figma 150:2220, admin/UMPER). Pure
// client-side only: denormalised location view (ROOM/SHARED_AREA leaf rows),
// search + building filter, and numbered pagination. No DB, no HTTP, no DOM.

export interface MasterLocation {
  readonly id: string;
  readonly type: string;
  readonly code: string;
  readonly name: string;
  readonly buildingCode: string | null;
  readonly floorNumber: number | null;
  readonly isActive: boolean;
  /** tierScore backend (0–30, null = DEFAULT di UI). Opsional untuk kompat. */
  readonly tierScore?: number | null | undefined;
}

export interface LocationViewRow extends MasterLocation {
  /** Resolved building/area label for the GEDUNG / AREA column. */
  readonly buildingName: string | null;
  /** "Lantai N" or "—" when the row carries no floor. */
  readonly floorLabel: string;
}

export interface LocationFilters {
  readonly search: string;
  readonly building: string;
  readonly includeInactive: boolean;
}

export const DEFAULT_LOCATION_FILTERS: LocationFilters = {
  search: '',
  building: '',
  includeInactive: false,
};

/** Leaf rows shown in the design table (rooms + shared areas only). */
export function isLeafLocation(type: string): boolean {
  return type === 'ROOM' || type === 'SHARED_AREA';
}

function buildingIndex(rows: readonly MasterLocation[]): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  for (const row of rows) {
    if (row.type !== 'BUILDING') continue;
    const key = (row.buildingCode ?? '').trim() !== '' ? (row.buildingCode as string) : row.code;
    if (!map.has(key)) map.set(key, row.name);
  }
  return map;
}

/** Resolves the GEDUNG / AREA cell: building name via buildingCode, with the
 *  area's own name as fallback for building-less shared areas. */
export function resolveBuildingName(
  row: MasterLocation,
  byCode: ReadonlyMap<string, string>,
): string | null {
  if (row.type === 'BUILDING') return row.name;
  if (row.buildingCode !== null) {
    const hit = byCode.get(row.buildingCode);
    if (hit !== undefined) return hit;
  }
  if (row.type === 'SHARED_AREA') return row.name;
  return null;
}

export function floorLabelOf(floorNumber: number | null): string {
  return floorNumber === null ? '—' : `Lantai ${floorNumber}`;
}

/** Flattens raw locations into the sorted leaf view the table renders. */
export function toLocationViewRows(rows: readonly MasterLocation[]): LocationViewRow[] {
  const byCode = buildingIndex(rows);
  return rows
    .filter((row) => isLeafLocation(row.type))
    .map((row) => ({
      ...row,
      buildingName: resolveBuildingName(row, byCode),
      floorLabel: floorLabelOf(row.floorNumber),
    }))
    .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
}

/** Case-insensitive substring match across kode, gedung, lantai, ruangan. */
export function matchesLocationSearch(row: LocationViewRow, search: string): boolean {
  const needle = search.trim().toLowerCase();
  if (needle === '') return true;
  const haystacks = [row.code, row.name, row.buildingName ?? '', row.floorLabel];
  return haystacks.some((field) => field.toLowerCase().includes(needle));
}

export function matchesLocationFilters(row: LocationViewRow, filters: LocationFilters): boolean {
  if (!matchesLocationSearch(row, filters.search)) return false;
  if (filters.building !== '' && (row.buildingName ?? '') !== filters.building) return false;
  if (!filters.includeInactive && !row.isActive) return false;
  return true;
}

export function filterLocationViews(
  rows: readonly LocationViewRow[],
  filters: LocationFilters,
): LocationViewRow[] {
  return rows.filter((row) => matchesLocationFilters(row, filters));
}

/** Unique sorted building labels for the "Semua Gedung & Area" dropdown. */
export function buildingOptions(rows: readonly LocationViewRow[]): string[] {
  const set = new Set<string>();
  for (const row of rows) {
    if (row.buildingName !== null && row.buildingName.trim() !== '') set.add(row.buildingName);
  }
  return Array.from(set).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

export interface MasterPage<T> {
  readonly items: readonly T[];
  readonly total: number;
  readonly totalPages: number;
  readonly currentPage: number;
  readonly from: number;
  readonly to: number;
}

/** 1-based numbered pagination slice (from/to are 0 when empty). */
export function paginateMasterRows<T>(
  rows: readonly T[],
  page: number,
  pageSize: number,
): MasterPage<T> {
  const safeSize = Number.isFinite(pageSize) && pageSize > 0 ? Math.floor(pageSize) : 12;
  const total = rows.length;
  const totalPages = total === 0 ? 0 : Math.ceil(total / safeSize);
  if (totalPages === 0) {
    return { items: [], total: 0, totalPages: 0, currentPage: 0, from: 0, to: 0 };
  }
  const currentPage = Math.min(Math.max(Math.floor(page) || 1, 1), totalPages);
  const start = (currentPage - 1) * safeSize;
  return {
    items: rows.slice(start, start + safeSize),
    total,
    totalPages,
    currentPage,
    from: start + 1,
    to: Math.min(start + safeSize, total),
  };
}

/** Numbered pagination items with ellipses (mirrors Kelola Laporan). */
export function masterPaginationItems(
  current: number,
  totalPages: number,
): ReadonlyArray<number | 'ellipsis'> {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }
  const window = new Set<number>([1, totalPages, current - 1, current, current + 1]);
  const pages = Array.from(window)
    .filter((page) => page >= 1 && page <= totalPages)
    .sort((a, b) => a - b);
  const items: Array<number | 'ellipsis'> = [];
  let previous: number | null = null;
  for (const page of pages) {
    if (previous !== null && page - previous > 1) items.push('ellipsis');
    items.push(page);
    previous = page;
  }
  return items;
}
