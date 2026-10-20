// Kelola Aset helpers contract (Figma 150:1748). Pure functions only —
// no DB, no HTTP, no DOM: search/status filter match, per-building condition
// grouping, and numbered pagination.
import { describe, expect, it } from 'vitest';
import {
  assetPaginationItems,
  filterAssetRows,
  groupAssetsByBuilding,
  matchesAssetFilters,
  matchesAssetSearch,
  paginateAssetRows,
  type AssetManageFilters,
  type AssetManageRow,
} from './admin-assets.js';

const ROWS: AssetManageRow[] = [
  {
    assetId: 'a1',
    assetCode: 'AST-ELK-014',
    assetName: 'Proyektor Epson EB-X400',
    locationLabel: 'Gedung C · Lt. 3 · Ruang 3.2',
    buildingName: 'Gedung C',
    categoryName: 'Elektronik & Multimedia',
    installYear: 2023,
    derivedStatus: 'IN_REPAIR',
    isActive: true,
    activeReportCount: 1,
  },
  {
    assetId: 'a2',
    assetCode: 'AST-AC-008',
    assetName: 'AC Split Daikin Inverter 2 PK',
    locationLabel: 'Gedung Dr. Sutomo · Lt. 3 · Lab IoT',
    buildingName: 'Gedung Dr. Sutomo',
    categoryName: 'Pendingin Ruangan (AC)',
    installYear: 2022,
    derivedStatus: 'OPERATIONAL',
    isActive: true,
    activeReportCount: 0,
  },
  {
    assetId: 'a3',
    assetCode: 'AST-SAN-021',
    assetName: 'Kran Sensor Otomatis Wastafel',
    locationLabel: 'Gedung C · Lt. 1 · Toilet',
    buildingName: 'Gedung C',
    categoryName: 'Sanitasi & Plumbing',
    installYear: 2021,
    derivedStatus: 'UNDER_INSPECTION',
    isActive: true,
    activeReportCount: 1,
  },
  {
    assetId: 'a4',
    assetCode: 'AST-FUR-019',
    assetName: 'Kursi Kuliah Lipat Chitose',
    locationLabel: 'Gedung C · Lt. 4 · Ruang 4.1',
    buildingName: 'Gedung C',
    categoryName: 'Furnitur & Sarana Kelas',
    installYear: 2018,
    derivedStatus: 'OPERATIONAL',
    isActive: false,
    activeReportCount: 0,
  },
];

const ALL: AssetManageFilters = {
  search: '',
  building: '',
  category: '',
  status: '',
  includeInactive: true,
};

describe('matchesAssetSearch', () => {
  it('matches code or name case-insensitively, blank matches all', () => {
    expect(matchesAssetSearch(ROWS[0]!, 'elk-014')).toBe(true);
    expect(matchesAssetSearch(ROWS[0]!, 'epson')).toBe(true);
    expect(matchesAssetSearch(ROWS[0]!, '  PROYEKTOR  ')).toBe(true);
    expect(matchesAssetSearch(ROWS[0]!, '')).toBe(true);
    expect(matchesAssetSearch(ROWS[0]!, 'daikin')).toBe(false);
  });
});

describe('matchesAssetFilters', () => {
  it('filters by building, category, and derived status', () => {
    expect(matchesAssetFilters(ROWS[0]!, { ...ALL, building: 'Gedung C' })).toBe(true);
    expect(matchesAssetFilters(ROWS[1]!, { ...ALL, building: 'Gedung C' })).toBe(false);
    expect(
      matchesAssetFilters(ROWS[0]!, { ...ALL, category: 'Elektronik & Multimedia' }),
    ).toBe(true);
    expect(matchesAssetFilters(ROWS[0]!, { ...ALL, status: 'IN_REPAIR' })).toBe(true);
    expect(matchesAssetFilters(ROWS[0]!, { ...ALL, status: 'OPERATIONAL' })).toBe(false);
  });

  it('excludes inactive rows unless the toggle is on', () => {
    expect(matchesAssetFilters(ROWS[3]!, { ...ALL, includeInactive: false })).toBe(false);
    expect(matchesAssetFilters(ROWS[3]!, { ...ALL, includeInactive: true })).toBe(true);
  });

  it('rejects an unknown status filter', () => {
    expect(matchesAssetFilters(ROWS[0]!, { ...ALL, status: 'BOGUS' })).toBe(false);
  });
});

describe('filterAssetRows', () => {
  it('combines search and building filters', () => {
    const rows = filterAssetRows(ROWS, { ...ALL, search: 'gedung', building: '' });
    expect(rows).toHaveLength(0);
    expect(filterAssetRows(ROWS, { ...ALL, search: 'ast-' })).toHaveLength(4);
    expect(filterAssetRows(ROWS, { ...ALL, building: 'Gedung C' })).toHaveLength(3);
  });
});

describe('groupAssetsByBuilding', () => {
  it('aggregates active-only counts per building, desc by total', () => {
    expect(groupAssetsByBuilding(ROWS)).toEqual([
      {
        buildingName: 'Gedung C',
        total: 2,
        operational: 0,
        underInspection: 1,
        inRepair: 1,
      },
      {
        buildingName: 'Gedung Dr. Sutomo',
        total: 1,
        operational: 1,
        underInspection: 0,
        inRepair: 0,
      },
    ]);
  });

  it('falls back to "Lokasi lainnya" for missing building names', () => {
    const rows: AssetManageRow[] = [
      { ...ROWS[1]!, buildingName: null },
      { ...ROWS[1]!, assetId: 'a5', buildingName: '  ' },
    ];
    expect(groupAssetsByBuilding(rows)).toEqual([
      { buildingName: 'Lokasi lainnya', total: 2, operational: 2, underInspection: 0, inRepair: 0 },
    ]);
  });
});

describe('paginateAssetRows', () => {
  it('slices 1-based pages with the from–to range', () => {
    const page = paginateAssetRows(ROWS, 2, 3);
    expect(page.currentPage).toBe(2);
    expect(page.totalPages).toBe(2);
    expect(page.items.map((row) => row.assetId)).toEqual(['a4']);
    expect(page.from).toBe(4);
    expect(page.to).toBe(4);
    expect(page.total).toBe(4);
  });

  it('clamps out-of-range pages and reports empty lists', () => {
    expect(paginateAssetRows(ROWS, 99, 2).currentPage).toBe(2);
    expect(paginateAssetRows([], 1, 6)).toEqual({
      items: [],
      total: 0,
      totalPages: 0,
      currentPage: 0,
      from: 0,
      to: 0,
    });
  });
});

describe('assetPaginationItems', () => {
  it('lists every page when there are few', () => {
    expect(assetPaginationItems(1, 3)).toEqual([1, 2, 3]);
  });

  it('collapses long ranges with a single ellipsis', () => {
    expect(assetPaginationItems(1, 21)).toEqual([1, 2, 'ellipsis', 21]);
    expect(assetPaginationItems(10, 21)).toEqual([1, 'ellipsis', 9, 10, 11, 'ellipsis', 21]);
  });
});
