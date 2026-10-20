// Data Master Referensi helpers contract (Figma 150:2220). Pure functions
// only — no DB, no HTTP, no DOM: leaf view, search/building filters, and
// numbered pagination.
import { describe, expect, it } from 'vitest';
import {
  buildingOptions,
  filterLocationViews,
  floorLabelOf,
  isLeafLocation,
  masterPaginationItems,
  matchesLocationSearch,
  paginateMasterRows,
  resolveBuildingName,
  toLocationViewRows,
  type LocationFilters,
  type MasterLocation,
} from './admin-master-data.js';

const RAW: MasterLocation[] = [
  {
    id: 'b1',
    type: 'CAMPUS',
    code: 'UPI-TASIK',
    name: 'UPI Kampus Tasikmalaya',
    buildingCode: null,
    floorNumber: null,
    isActive: true,
  },
  {
    id: 'b2',
    type: 'BUILDING',
    code: 'C',
    name: 'Gedung C',
    buildingCode: 'C',
    floorNumber: null,
    isActive: true,
  },
  {
    id: 'f1',
    type: 'FLOOR',
    code: 'C-01',
    name: 'Lantai 1 Gedung C',
    buildingCode: 'C',
    floorNumber: 1,
    isActive: true,
  },
  {
    id: 'r1',
    type: 'ROOM',
    code: 'LOK-GDC-01',
    name: 'Ruang 1',
    buildingCode: 'C',
    floorNumber: 1,
    isActive: true,
  },
  {
    id: 'r2',
    type: 'ROOM',
    code: 'LOK-GDC-07',
    name: 'Toilet Pria Lt. 1',
    buildingCode: 'C',
    floorNumber: 1,
    isActive: false,
  },
  {
    id: 's1',
    type: 'SHARED_AREA',
    code: 'LOK-TMD-01',
    name: 'Taman Digital 1',
    buildingCode: null,
    floorNumber: null,
    isActive: true,
  },
];

const ALL: LocationFilters = { search: '', building: '', includeInactive: true };

describe('isLeafLocation', () => {
  it('keeps rooms and shared areas only', () => {
    expect(isLeafLocation('ROOM')).toBe(true);
    expect(isLeafLocation('SHARED_AREA')).toBe(true);
    expect(isLeafLocation('BUILDING')).toBe(false);
    expect(isLeafLocation('FLOOR')).toBe(false);
    expect(isLeafLocation('CAMPUS')).toBe(false);
  });
});

describe('toLocationViewRows', () => {
  it('flattens to leaf rows with resolved building + floor labels, sorted by code', () => {
    const rows = toLocationViewRows(RAW);
    expect(rows.map((row) => row.code)).toEqual(['LOK-GDC-01', 'LOK-GDC-07', 'LOK-TMD-01']);
    expect(rows[0]).toMatchObject({ buildingName: 'Gedung C', floorLabel: 'Lantai 1' });
    expect(rows[2]).toMatchObject({ buildingName: 'Taman Digital 1', floorLabel: '—' });
  });

  it('falls back to null when the building code is unknown', () => {
    const rows = toLocationViewRows([
      {
        id: 'x',
        type: 'ROOM',
        code: 'Z-1',
        name: 'Ruang X',
        buildingCode: 'Z',
        floorNumber: 2,
        isActive: true,
      },
    ]);
    expect(rows[0]?.buildingName).toBeNull();
    expect(resolveBuildingName(RAW[1]!, new Map())).toBe('Gedung C');
    expect(floorLabelOf(null)).toBe('—');
  });
});

describe('matchesLocationSearch', () => {
  const rows = toLocationViewRows(RAW);
  it('matches kode, gedung, lantai, and ruangan case-insensitively', () => {
    expect(matchesLocationSearch(rows[0]!, 'gdc-01')).toBe(true);
    expect(matchesLocationSearch(rows[0]!, 'gedung c')).toBe(true);
    expect(matchesLocationSearch(rows[0]!, 'lantai 1')).toBe(true);
    expect(matchesLocationSearch(rows[0]!, 'RUANG 1')).toBe(true);
    expect(matchesLocationSearch(rows[0]!, '  ')).toBe(true);
    expect(matchesLocationSearch(rows[0]!, 'taman')).toBe(false);
  });
});

describe('filterLocationViews', () => {
  const rows = toLocationViewRows(RAW);
  it('combines search, building, and the inactive toggle', () => {
    expect(filterLocationViews(rows, ALL)).toHaveLength(3);
    expect(filterLocationViews(rows, { ...ALL, includeInactive: false })).toHaveLength(2);
    expect(filterLocationViews(rows, { ...ALL, building: 'Gedung C' })).toHaveLength(2);
    expect(filterLocationViews(rows, { ...ALL, search: 'taman' })).toHaveLength(1);
  });
});

describe('buildingOptions', () => {
  it('returns unique sorted building labels', () => {
    expect(buildingOptions(toLocationViewRows(RAW))).toEqual(['Gedung C', 'Taman Digital 1']);
  });
});

describe('paginateMasterRows', () => {
  it('slices 1-based pages with the from–to range', () => {
    const page = paginateMasterRows([1, 2, 3, 4], 2, 3);
    expect(page).toMatchObject({ currentPage: 2, totalPages: 2, from: 4, to: 4, total: 4 });
    expect(page.items).toEqual([4]);
  });

  it('reports empty lists with zeros', () => {
    expect(paginateMasterRows([], 1, 12)).toMatchObject({
      items: [],
      total: 0,
      totalPages: 0,
      currentPage: 0,
      from: 0,
      to: 0,
    });
  });
});

describe('masterPaginationItems', () => {
  it('lists every page when there are few and collapses long ranges', () => {
    expect(masterPaginationItems(1, 5)).toEqual([1, 2, 3, 4, 5]);
    expect(masterPaginationItems(10, 21)).toEqual([1, 'ellipsis', 9, 10, 11, 'ellipsis', 21]);
  });
});
