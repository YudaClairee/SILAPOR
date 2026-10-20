// Kelola Aset helpers (Figma 150:1748). Pure client-side only: search match,
// facility-status filter match, grouping rows per building for the
// "Kondisi Fasilitas Per Lokasi Kampus" cards, and numbered pagination.
// No DB, no HTTP, no DOM.
export type FacilityDerivedStatus = 'OPERATIONAL' | 'UNDER_INSPECTION' | 'IN_REPAIR';

export interface AssetManageRow {
  readonly assetId: string;
  readonly assetCode: string;
  readonly assetName: string;
  readonly locationLabel: string;
  readonly buildingName: string | null;
  readonly categoryName: string | null;
  readonly installYear: number | null;
  readonly derivedStatus: FacilityDerivedStatus | string;
  readonly isActive: boolean;
  readonly activeReportCount: number;
}

export interface AssetManageFilters {
  readonly search: string;
  readonly building: string;
  readonly category: string;
  readonly status: string;
  readonly includeInactive: boolean;
}

export const DEFAULT_ASSET_MANAGE_FILTERS: AssetManageFilters = {
  search: '',
  building: '',
  category: '',
  status: '',
  includeInactive: false,
};

/** Case-insensitive substring match on asset code or name. Blank → all. */
export function matchesAssetSearch(
  row: Pick<AssetManageRow, 'assetCode' | 'assetName'>,
  search: string,
): boolean {
  const needle = search.trim().toLowerCase();
  if (needle === '') return true;
  return (
    row.assetCode.toLowerCase().includes(needle) || row.assetName.toLowerCase().includes(needle)
  );
}

const KNOWN_FACILITY_STATUS: ReadonlySet<string> = new Set([
  'OPERATIONAL',
  'UNDER_INSPECTION',
  'IN_REPAIR',
]);

/** True when a row passes every active filter. Unknown status filter → no match. */
export function matchesAssetFilters(row: AssetManageRow, filters: AssetManageFilters): boolean {
  if (!matchesAssetSearch(row, filters.search)) return false;
  if (filters.building !== '' && row.buildingName !== filters.building) return false;
  if (filters.category !== '' && (row.categoryName ?? '') !== filters.category) return false;
  if (filters.status !== '') {
    if (!KNOWN_FACILITY_STATUS.has(filters.status)) return false;
    if (row.derivedStatus !== filters.status) return false;
  }
  if (!filters.includeInactive && !row.isActive) return false;
  return true;
}

export function filterAssetRows(
  rows: readonly AssetManageRow[],
  filters: AssetManageFilters,
): AssetManageRow[] {
  return rows.filter((row) => matchesAssetFilters(row, filters));
}

export interface BuildingConditionGroup {
  readonly buildingName: string;
  readonly total: number;
  readonly operational: number;
  readonly underInspection: number;
  readonly inRepair: number;
}

/**
 * Groups rows per building for the condition cards: active-only (mirrors the
 * table's default), unknown building → "Lokasi lainnya", order desc by total.
 */
export function groupAssetsByBuilding(rows: readonly AssetManageRow[]): BuildingConditionGroup[] {
  const groups = new Map<string, { operational: number; underInspection: number; inRepair: number }>();
  for (const row of rows) {
    if (!row.isActive) continue;
    const key =
      row.buildingName === null || row.buildingName.trim() === ''
        ? 'Lokasi lainnya'
        : row.buildingName;
    const bucket = groups.get(key) ?? { operational: 0, underInspection: 0, inRepair: 0 };
    if (row.derivedStatus === 'IN_REPAIR') bucket.inRepair += 1;
    else if (row.derivedStatus === 'UNDER_INSPECTION') bucket.underInspection += 1;
    else bucket.operational += 1;
    groups.set(key, bucket);
  }
  return Array.from(groups.entries())
    .map(([buildingName, bucket]) => ({
      buildingName,
      total: bucket.operational + bucket.underInspection + bucket.inRepair,
      ...bucket,
    }))
    .sort((a, b) => b.total - a.total || (a.buildingName < b.buildingName ? -1 : 1));
}

export interface AssetPage {
  readonly items: AssetManageRow[];
  readonly total: number;
  readonly totalPages: number;
  readonly currentPage: number;
  readonly from: number;
  readonly to: number;
}

/** 1-based numbered pagination slice (both 0 when empty). */
export function paginateAssetRows(
  rows: readonly AssetManageRow[],
  page: number,
  pageSize: number,
): AssetPage {
  const safeSize = Number.isFinite(pageSize) && pageSize > 0 ? Math.floor(pageSize) : 6;
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

/**
 * Numbered pagination items with a single ellipsis (mirrors Kelola Laporan):
 * full list when ≤ 7 pages, else 1 … window(±1) … last.
 */
export function assetPaginationItems(
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
