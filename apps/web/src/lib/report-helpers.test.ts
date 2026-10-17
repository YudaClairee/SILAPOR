// Reporter report-form helper tests (Phase 3 P3-5). Pure functions only —
// no DB, no HTTP, no DOM: option filtering, client validation (mirrors the
// server rules in packages/database validateCreateReportInput), duplicate
// check param building, list-query building, and safe timeline/status
// labels. Written RED-first: this file must fail before report-helpers.ts
// exists.
import { describe, expect, it } from 'vitest';
import {
  buildDuplicateCheckParams,
  buildMyReportsQuery,
  buildingsOf,
  eventLabel,
  filterAssetsByCategoryLocation,
  issueTypesForCategory,
  reportStatusLabel,
  roomsForBuilding,
  validateReportForm,
  visibleLocations,
  type ReportFormValues,
} from './report-helpers.js';

const UUID_A = '11111111-1111-1111-1111-111111111111';
const UUID_B = '22222222-2222-2222-2222-222222222222';
const UUID_C = '33333333-3333-3333-3333-333333333333';
const UUID_D = '44444444-4444-4444-4444-444444444444';

function validValues(overrides?: Partial<ReportFormValues>): ReportFormValues {
  return {
    buildingId: UUID_A,
    locationId: UUID_B,
    categoryId: UUID_C,
    assetId: '',
    issueTypeId: UUID_D,
    description: 'Lampu lorong mati total perlu perbaikan',
    occurredAt: '',
    ...overrides,
  };
}

describe('filterAssetsByCategoryLocation', () => {
  const assets = [
    { id: 'a1', categoryId: UUID_C, locationId: UUID_B },
    { id: 'a2', categoryId: UUID_C, locationId: UUID_A },
    { id: 'a3', categoryId: UUID_A, locationId: UUID_B },
    { id: 'a4', categoryId: null, locationId: UUID_B },
    { id: 'a5', categoryId: UUID_C, locationId: null },
  ];

  it('keeps only assets matching both the category and the location id', () => {
    expect(filterAssetsByCategoryLocation(assets, UUID_C, UUID_B).map((a) => a.id)).toEqual([
      'a1',
    ]);
  });

  it('returns an empty list when nothing matches', () => {
    expect(filterAssetsByCategoryLocation(assets, UUID_D, UUID_D)).toEqual([]);
  });

  it('returns an empty list for empty input', () => {
    expect(filterAssetsByCategoryLocation([], UUID_C, UUID_B)).toEqual([]);
  });

  it('does not match null category/location ids against a selection', () => {
    // Binding: match selected location/category IDs within the same
    // form-options payload — nulls are never a match.
    expect(filterAssetsByCategoryLocation(assets, UUID_C, UUID_B)).not.toContainEqual(
      expect.objectContaining({ id: 'a4' }),
    );
    expect(filterAssetsByCategoryLocation(assets, UUID_C, UUID_B)).not.toContainEqual(
      expect.objectContaining({ id: 'a5' }),
    );
  });
});

describe('visibleLocations', () => {
  it('passes through already-filtered server options unchanged', () => {
    const options = [
      { id: UUID_A, code: 'A', name: 'Gedung A' },
      { id: UUID_B, code: 'C-01', name: 'Ruang 01' },
    ];
    expect(visibleLocations(options)).toEqual(options);
  });

  it('drops rows flagged inactive or reporterHidden (leak guard)', () => {
    const options = [
      { id: UUID_A, code: 'A', name: 'Gedung A' },
      { id: UUID_B, code: 'LIFT', name: 'Ruang Lift', reporterHidden: true, isActive: true },
      { id: UUID_C, code: 'OLD', name: 'Gedung Lama', reporterHidden: false, isActive: false },
    ];
    expect(visibleLocations(options).map((l) => l.id)).toEqual([UUID_A]);
  });
});

describe('buildingsOf + roomsForBuilding (building → room cascade)', () => {
  const locations = [
    { id: UUID_A, type: 'BUILDING', parentId: null },
    { id: UUID_B, type: 'FLOOR', parentId: UUID_A },
    { id: UUID_C, type: 'ROOM', parentId: UUID_B },
    { id: UUID_D, type: 'ROOM', parentId: UUID_B },
    { id: 'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee', type: 'BUILDING', parentId: null },
    { id: 'ffffffff-ffff-ffff-ffff-ffffffffffff', type: 'ROOM', parentId: null },
  ];

  it('lists buildings only', () => {
    expect(buildingsOf(locations).map((l) => l.id)).toEqual([
      UUID_A,
      'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
    ]);
  });

  it('resolves rooms under a building through its floors', () => {
    expect(roomsForBuilding(locations, UUID_A).map((l) => l.id)).toEqual([UUID_C, UUID_D]);
  });

  it('returns no rooms for an unknown building', () => {
    expect(roomsForBuilding(locations, '99999999-9999-9999-9999-999999999999')).toEqual([]);
  });

  it('never leaks rooms parented elsewhere', () => {
    expect(roomsForBuilding(locations, UUID_A).map((l) => l.id)).not.toContain(
      'ffffffff-ffff-ffff-ffff-ffffffffffff',
    );
  });
});

describe('issueTypesForCategory', () => {
  const issueTypes = [
    { id: 'g1', categoryId: null },
    { id: 'g2', categoryId: null },
    { id: 's1', categoryId: UUID_C },
  ];

  it('shows generic (unlinked) issue types for any category', () => {
    expect(issueTypesForCategory(issueTypes, UUID_C).map((i) => i.id)).toEqual(['g1', 'g2', 's1']);
    expect(issueTypesForCategory(issueTypes, UUID_D).map((i) => i.id)).toEqual(['g1', 'g2']);
  });

  it('shows everything when no category is chosen yet', () => {
    expect(issueTypesForCategory(issueTypes, '').map((i) => i.id)).toEqual(['g1', 'g2', 's1']);
  });
});

describe('validateReportForm', () => {
  it('accepts a complete valid form', () => {
    expect(validateReportForm(validValues())).toEqual({});
  });

  it('accepts a valid form with optional asset + occurredAt', () => {
    expect(
      validateReportForm(validValues({ assetId: UUID_A, occurredAt: '2026-01-02T10:00' })),
    ).toEqual({});
  });

  it('requires building, room, category, and issue type', () => {
    const errors = validateReportForm(
      validValues({ buildingId: '', locationId: '', categoryId: '', issueTypeId: '' }),
    );
    expect(errors['buildingId']).toBe('Pilih gedung terlebih dahulu.');
    expect(errors['locationId']).toBe('Pilih ruangan terlebih dahulu.');
    expect(errors['categoryId']).toBe('Pilih kategori terlebih dahulu.');
    expect(errors['issueTypeId']).toBe('Pilih jenis masalah terlebih dahulu.');
  });

  it('rejects malformed UUID selections', () => {
    const errors = validateReportForm(
      validValues({ locationId: 'nope', categoryId: 'nope', assetId: 'nope' }),
    );
    expect(errors['locationId']).toBe('Ruangan tidak valid.');
    expect(errors['categoryId']).toBe('Kategori tidak valid.');
    expect(errors['assetId']).toBe('Asset tidak valid.');
  });

  it('enforces the 10-character description minimum (trimmed)', () => {
    expect(validateReportForm(validValues({ description: '9 chars!' }))['description']).toBe(
      'Deskripsi minimal 10 karakter.',
    );
    expect(validateReportForm(validValues({ description: '1234567890' }))['description']).toBe(
      undefined,
    );
    expect(validateReportForm(validValues({ description: '   ' }))['description']).toBe(
      'Deskripsi minimal 10 karakter.',
    );
  });

  it('enforces the 2000-character description maximum (trimmed)', () => {
    expect(validateReportForm(validValues({ description: 'x'.repeat(2000) }))['description']).toBe(
      undefined,
    );
    expect(validateReportForm(validValues({ description: 'x'.repeat(2001) }))['description']).toBe(
      'Deskripsi maksimal 2000 karakter.',
    );
  });

  it('rejects a future occurredAt and accepts the past', () => {
    expect(
      validateReportForm(validValues({ occurredAt: '2999-01-01T00:00' }))['occurredAt'],
    ).toBe('Waktu kejadian tidak boleh di masa depan.');
    expect(validateReportForm(validValues({ occurredAt: '2020-05-05T08:30' }))['occurredAt']).toBe(
      undefined,
    );
  });

  it('rejects an unparseable occurredAt', () => {
    expect(validateReportForm(validValues({ occurredAt: 'bukan-tanggal' }))['occurredAt']).toBe(
      'Waktu kejadian tidak valid.',
    );
  });
});

describe('buildDuplicateCheckParams', () => {
  it('builds the full param set when asset + issue type are chosen', () => {
    expect(
      buildDuplicateCheckParams({
        locationId: UUID_B,
        categoryId: UUID_C,
        assetId: UUID_A,
        issueTypeId: UUID_D,
      }),
    ).toEqual({ locationId: UUID_B, categoryId: UUID_C, assetId: UUID_A, issueTypeId: UUID_D });
  });

  it('omits empty optional ids (server treats them as absent)', () => {
    expect(
      buildDuplicateCheckParams({
        locationId: UUID_B,
        categoryId: UUID_C,
        assetId: '',
        issueTypeId: '',
      }),
    ).toEqual({ locationId: UUID_B, categoryId: UUID_C });
  });
});

describe('buildMyReportsQuery', () => {
  it('defaults to reported_desc + limit 50 + offset 0', () => {
    expect(buildMyReportsQuery({})).toBe('sort=reported_desc&limit=50&offset=0');
  });

  it('passes an exact status through', () => {
    expect(buildMyReportsQuery({ status: 'REPORTED' })).toBe(
      'sort=reported_desc&limit=50&offset=0&status=REPORTED',
    );
  });

  it('expands the aktif filter to the five open-work statuses', () => {
    const query = buildMyReportsQuery({ filter: 'aktif' });
    for (const status of ['REPORTED', 'VERIFIED', 'ASSIGNED', 'INSPECTION', 'IN_REPAIR']) {
      expect(query).toContain(`status=${status}`);
    }
    expect(query).not.toContain('RESOLVED');
  });

  it('expands the selesai filter to the two terminal statuses', () => {
    const query = buildMyReportsQuery({ filter: 'selesai' });
    for (const status of ['RESOLVED', 'CLOSED']) {
      expect(query).toContain(`status=${status}`);
    }
    expect(query).not.toContain('REJECTED');
    expect(query).not.toContain('DUPLICATE');
    expect(query).not.toContain('status=REPORTED');
  });

  it('clamps negative offsets to zero and keeps positive ones', () => {
    expect(buildMyReportsQuery({ offset: -5 })).toBe('sort=reported_desc&limit=50&offset=0');
    expect(buildMyReportsQuery({ offset: 50 })).toBe('sort=reported_desc&limit=50&offset=50');
  });

  it('prefers an exact status over the chip filter', () => {
    expect(buildMyReportsQuery({ filter: 'aktif', status: 'CLOSED' })).toBe(
      'sort=reported_desc&limit=50&offset=0&status=CLOSED',
    );
  });
});

describe('reportStatusLabel', () => {
  it('labels every binding status in Indonesian', () => {
    expect(reportStatusLabel('REPORTED')).toBe('Dilaporkan');
    expect(reportStatusLabel('VERIFIED')).toBe('Terverifikasi');
    expect(reportStatusLabel('ASSIGNED')).toBe('Ditugaskan');
    expect(reportStatusLabel('INSPECTION')).toBe('Inspeksi');
    expect(reportStatusLabel('IN_REPAIR')).toBe('Dalam perbaikan');
    expect(reportStatusLabel('RESOLVED')).toBe('Selesai');
    expect(reportStatusLabel('CLOSED')).toBe('Ditutup');
  });

  it('passes unknown codes through untouched', () => {
    expect(reportStatusLabel('BOGUS')).toBe('BOGUS');
  });
});

describe('eventLabel (timeline safe subset)', () => {
  it('labels every binding event type in Indonesian', () => {
    expect(eventLabel('REPORT_CREATED')).toBe('Laporan dibuat');
    expect(eventLabel('AI_ANALYSIS_COMPLETED')).toBe('Analisis AI selesai');
    expect(eventLabel('REPORT_VERIFIED')).toBe('Laporan diverifikasi');
    expect(eventLabel('STATUS_CHANGED')).toBe('Status berubah');
    expect(eventLabel('PRIORITY_CHANGED')).toBe('Prioritas berubah');
    expect(eventLabel('ASSIGNMENT_CHANGED')).toBe('Penugasan berubah');
    expect(eventLabel('PUBLIC_UPDATE_ADDED')).toBe('Pembaruan ditambahkan');
    expect(eventLabel('INTERNAL_NOTE_ADDED')).toBe('Catatan internal ditambahkan');
    expect(eventLabel('REPORT_RESOLVED')).toBe('Laporan diselesaikan');
    expect(eventLabel('REPORT_CLOSED')).toBe('Laporan ditutup');
  });

  it('passes unknown types through untouched (never blobs)', () => {
    expect(eventLabel('SOMETHING_NEW')).toBe('SOMETHING_NEW');
  });
});
