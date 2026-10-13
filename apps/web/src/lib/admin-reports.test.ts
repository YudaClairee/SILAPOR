// Admin reports helper tests (Phase 3 P3-6). Pure functions only —
// no DB, no HTTP, no DOM: admin list param building, pagination ranges,
// and Indonesian status/priority labels. Written RED-first: this file must
// fail before admin-reports.ts exists.
import { describe, expect, it } from 'vitest';
import {
  buildAdminListParams,
  pageRange,
  priorityLabel,
  statusLabel,
  toAdminListQuery,
} from './admin-reports.js';

const UUID_A = '11111111-1111-1111-1111-111111111111';
const UUID_B = '22222222-2222-2222-2222-222222222222';

describe('buildAdminListParams', () => {
  it('omits a blank search (no filter)', () => {
    expect(buildAdminListParams({ search: '' })).not.toHaveProperty('search');
    expect(buildAdminListParams({ search: '   ' })).not.toHaveProperty('search');
    expect(buildAdminListParams({})).not.toHaveProperty('search');
  });

  it('omits a single-character search (server minimum is 2 chars)', () => {
    expect(buildAdminListParams({ search: 'a' })).not.toHaveProperty('search');
  });

  it('passes a valid search through trimmed', () => {
    expect(buildAdminListParams({ search: '  MNT-2026  ' })).toMatchObject({
      search: 'MNT-2026',
    });
  });

  it('passes a single status filter through', () => {
    expect(buildAdminListParams({ status: 'REPORTED' })).toMatchObject({
      status: 'REPORTED',
    });
  });

  it('passes multiple statuses through as an array', () => {
    expect(buildAdminListParams({ status: ['REPORTED', 'VERIFIED'] })).toMatchObject({
      status: ['REPORTED', 'VERIFIED'],
    });
  });

  it('omits unknown statuses (server 400s them; helpers omit)', () => {
    expect(buildAdminListParams({ status: 'BOGUS' })).not.toHaveProperty('status');
    expect(buildAdminListParams({ status: ['REPORTED', 'BOGUS'] })).toMatchObject({
      status: 'REPORTED',
    });
    expect(buildAdminListParams({ status: ['BOGUS'] })).not.toHaveProperty('status');
    expect(buildAdminListParams({ status: '' })).not.toHaveProperty('status');
  });

  it('passes category/location/reporter/date filters through, omits blanks', () => {
    const params = buildAdminListParams({
      categoryId: UUID_A,
      locationId: UUID_B,
      reporterId: UUID_A,
      from: '2026-01-01',
      to: '2026-12-31',
    });
    expect(params).toMatchObject({
      categoryId: UUID_A,
      locationId: UUID_B,
      reporterId: UUID_A,
      from: '2026-01-01',
      to: '2026-12-31',
    });
    expect(
      buildAdminListParams({
        categoryId: '',
        locationId: '  ',
        reporterId: '',
        from: '',
        to: '',
      }),
    ).not.toHaveProperty('categoryId');
  });

  it('passes valid priorities through and omits invalid ones', () => {
    expect(buildAdminListParams({ priority: 'HIGH' })).toMatchObject({ priority: 'HIGH' });
    expect(buildAdminListParams({ priority: 'BOGUS' })).not.toHaveProperty('priority');
    expect(buildAdminListParams({ priority: '' })).not.toHaveProperty('priority');
  });

  it('accepts only the four binding sorts, defaulting to reported_desc', () => {
    for (const sort of ['reported_desc', 'reported_asc', 'ticket_asc', 'ticket_desc']) {
      expect(buildAdminListParams({ sort })).toMatchObject({ sort });
    }
    expect(buildAdminListParams({})).toMatchObject({ sort: 'reported_desc' });
    expect(buildAdminListParams({ sort: 'BOGUS' })).toMatchObject({
      sort: 'reported_desc',
    });
  });

  it('defaults limit 50 / offset 0 and clamps non-positive values', () => {
    expect(buildAdminListParams({})).toMatchObject({ limit: '50', offset: '0' });
    expect(buildAdminListParams({ limit: -5, offset: -10 })).toMatchObject({
      limit: '50',
      offset: '0',
    });
    expect(buildAdminListParams({ limit: 25, offset: 50 })).toMatchObject({
      limit: '25',
      offset: '50',
    });
  });

  it('serializes to a query string with repeatable status keys', () => {
    const query = toAdminListQuery(
      buildAdminListParams({ search: 'mnt', status: ['REPORTED', 'VERIFIED'] }),
    );
    const parsed = new URLSearchParams(query);
    expect(parsed.get('search')).toBe('mnt');
    expect(parsed.getAll('status')).toEqual(['REPORTED', 'VERIFIED']);
  });
});

describe('pageRange', () => {
  it('returns an empty range when there is nothing to show', () => {
    expect(pageRange(0, 50, 0)).toEqual({ from: 0, to: 0, hasPrev: false, hasNext: false });
  });

  it('covers an exact full page with no prev/next', () => {
    expect(pageRange(50, 50, 0)).toEqual({ from: 1, to: 50, hasPrev: false, hasNext: false });
  });

  it('covers a partial last page with prev but no next', () => {
    expect(pageRange(75, 50, 50)).toEqual({ from: 51, to: 75, hasPrev: true, hasNext: false });
  });

  it('marks both directions on a middle page', () => {
    expect(pageRange(130, 50, 50)).toEqual({ from: 51, to: 100, hasPrev: true, hasNext: true });
  });

  it('marks next only on the first page of many', () => {
    expect(pageRange(130, 50, 0)).toEqual({ from: 1, to: 50, hasPrev: false, hasNext: true });
  });
});

describe('statusLabel', () => {
  it('labels all 9 binding statuses in Indonesian', () => {
    expect(statusLabel('REPORTED')).toBe('Dilaporkan');
    expect(statusLabel('VERIFIED')).toBe('Terverifikasi');
    expect(statusLabel('ASSIGNED')).toBe('Ditugaskan');
    expect(statusLabel('INSPECTION')).toBe('Inspeksi');
    expect(statusLabel('IN_REPAIR')).toBe('Dalam perbaikan');
    expect(statusLabel('RESOLVED')).toBe('Selesai');
    expect(statusLabel('CLOSED')).toBe('Ditutup');
    expect(statusLabel('REJECTED')).toBe('Ditolak');
    expect(statusLabel('DUPLICATE')).toBe('Duplikat');
  });

  it('passes unknown statuses through untouched', () => {
    expect(statusLabel('BOGUS')).toBe('BOGUS');
  });
});

describe('priorityLabel', () => {
  it('labels all 3 binding priorities in Indonesian', () => {
    expect(priorityLabel('LOW')).toBe('Rendah');
    expect(priorityLabel('MEDIUM')).toBe('Sedang');
    expect(priorityLabel('HIGH')).toBe('Tinggi');
  });

  it('renders "Belum ditetapkan" for null/undefined/empty (pre-verification)', () => {
    expect(priorityLabel(null)).toBe('Belum ditetapkan');
    expect(priorityLabel(undefined)).toBe('Belum ditetapkan');
    expect(priorityLabel('')).toBe('Belum ditetapkan');
  });

  it('passes unknown priorities through untouched', () => {
    expect(priorityLabel('BOGUS')).toBe('BOGUS');
  });
});
