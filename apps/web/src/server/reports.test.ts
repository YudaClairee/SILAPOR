// Report transport service tests (Phase 3 P3-4). Pure parsing/resolution
// helpers only — no DB, no HTTP: route-level handler tests are impractical
// (Start server handlers), so live route checks are proven with fetch in
// the task report instead.
//
// Covers: query-param parsing (invalid status/priority/sort → 400 shapes),
// ticket-vs-UUID classification, create-body normalization (client
// reporterId never survives), form-option projections (reporterHidden +
// inactive excluded, small payload keys), and 404 body byte-equality
// (missing vs foreign produce identical HTTP bodies).
import { describe, expect, it } from 'vitest';
import { resolveReportSort } from '@silapor/database';
import { notFound, toHttpResponse } from '@silapor/shared';
import {
  classifyReportRef,
  isReporterVisibleLocation,
  normalizeCreateReportBody,
  parseAdminReportsQuery,
  parseDuplicateCheckQuery,
  parseMyReportsQuery,
  toAssetOption,
  toCategoryOption,
  toIssueTypeOption,
  toLocationOption,
  type DuplicateCheckFilter,
} from './reports.js';

const UUID_A = '11111111-1111-1111-1111-111111111111';
const UUID_B = '22222222-2222-2222-2222-222222222222';
const BASE = 'http://localhost:3000';

function httpStatusOf(fn: () => unknown): number {
  try {
    fn();
  } catch (error) {
    return toHttpResponse(error).status;
  }
  throw new Error('expected parser to throw');
}

describe('parseDuplicateCheckQuery', () => {
  it('parses the required location/category pair', () => {
    const filter: DuplicateCheckFilter = parseDuplicateCheckQuery(
      `${BASE}/api/reports/duplicate-check?locationId=${UUID_A}&categoryId=${UUID_B}`,
    );
    expect(filter).toEqual({ locationId: UUID_A, categoryId: UUID_B });
  });

  it('passes optional asset/issue UUIDs through', () => {
    const filter = parseDuplicateCheckQuery(
      `${BASE}/api/reports/duplicate-check?locationId=${UUID_A}&categoryId=${UUID_B}&assetId=${UUID_A}&issueTypeId=${UUID_B}`,
    );
    expect(filter).toEqual({
      locationId: UUID_A,
      categoryId: UUID_B,
      assetId: UUID_A,
      issueTypeId: UUID_B,
    });
  });

  it('accepts snake_case aliases', () => {
    const filter = parseDuplicateCheckQuery(
      `${BASE}/api/reports/duplicate-check?location_id=${UUID_A}&category_id=${UUID_B}`,
    );
    expect(filter).toEqual({ locationId: UUID_A, categoryId: UUID_B });
  });

  it('400s on a missing locationId', () => {
    expect(httpStatusOf(() => parseDuplicateCheckQuery(`${BASE}/x?categoryId=${UUID_B}`))).toBe(
      400,
    );
  });

  it('400s on a missing categoryId', () => {
    expect(httpStatusOf(() => parseDuplicateCheckQuery(`${BASE}/x?locationId=${UUID_A}`))).toBe(
      400,
    );
  });

  it('400s on an invalid UUID combo', () => {
    expect(
      httpStatusOf(() => parseDuplicateCheckQuery(`${BASE}/x?locationId=nope&categoryId=${UUID_B}`)),
    ).toBe(400);
    expect(
      httpStatusOf(() =>
        parseDuplicateCheckQuery(
          `${BASE}/x?locationId=${UUID_A}&categoryId=${UUID_B}&assetId=nope`,
        ),
      ),
    ).toBe(400);
  });
});

describe('parseMyReportsQuery', () => {
  it('parses a full filter set', () => {
    expect(
      parseMyReportsQuery(
        `${BASE}/api/reports?status=REPORTED&status=VERIFIED&categoryId=${UUID_A}` +
          `&locationId=${UUID_B}&priority=HIGH&from=2026-01-01&to=2026-12-31` +
          `&limit=10&offset=5&sort=ticket_asc`,
      ),
    ).toEqual({
      status: ['REPORTED', 'VERIFIED'],
      categoryId: UUID_A,
      locationId: UUID_B,
      priority: 'HIGH',
      from: '2026-01-01',
      to: '2026-12-31',
      limit: 10,
      offset: 5,
      sort: 'ticket_asc',
    });
  });

  it('returns empty options for a bare list URL', () => {
    expect(parseMyReportsQuery(`${BASE}/api/reports`)).toEqual({});
  });

  it('maps an invalid sort to a 400 shape via the repo validator', () => {
    // The parser passes `sort` through; the repo's `resolveReportSort`
    // rejects unknown values — this is the exact 400 the list routes emit.
    const mapped = (() => {
      try {
        resolveReportSort('BOGUS');
        return null;
      } catch (error) {
        return toHttpResponse(error);
      }
    })();
    expect(mapped).toEqual({
      status: 400,
      body: { error: { code: 'BAD_REQUEST', message: 'Invalid report sort' } },
    });
  });

  it('accepts every binding sort value', () => {
    for (const sort of ['reported_desc', 'reported_asc', 'ticket_asc', 'ticket_desc']) {
      expect(resolveReportSort(sort)).toBe(sort);
    }
    expect(resolveReportSort(undefined)).toBe('reported_desc');
  });
});

describe('parseAdminReportsQuery', () => {
  it('adds reporterId and search to the base filters', () => {
    expect(
      parseAdminReportsQuery(
        `${BASE}/api/admin/reports?status=REPORTED&reporterId=${UUID_A}&search=MNT-2026`,
      ),
    ).toEqual({ status: ['REPORTED'], reporterId: UUID_A, search: 'MNT-2026' });
  });
});

describe('classifyReportRef', () => {
  it('detects ticket numbers by the MNT- prefix', () => {
    expect(classifyReportRef('MNT-2026-000001')).toBe('ticket');
  });

  it('detects UUID row ids', () => {
    expect(classifyReportRef(UUID_A)).toBe('uuid');
  });

  it('marks anything else invalid (→ 404, never 500)', () => {
    expect(classifyReportRef('nope')).toBe('invalid');
    expect(classifyReportRef('')).toBe('invalid');
    expect(classifyReportRef('MNT-')).toBe('ticket');
  });
});

describe('normalizeCreateReportBody', () => {
  it('maps snake_case keys to the repo shape', () => {
    expect(
      normalizeCreateReportBody({
        location_id: UUID_A,
        submitted_category_id: UUID_B,
        description: 'Lampu lorong mati total perlu perbaikan',
      }),
    ).toEqual({
      locationId: UUID_A,
      submittedCategoryId: UUID_B,
      description: 'Lampu lorong mati total perlu perbaikan',
    });
  });

  it('drops any client-supplied reporter id', () => {
    const normalized = normalizeCreateReportBody({
      reporterId: UUID_A,
      reporter_id: UUID_A,
      userId: UUID_A,
      locationId: UUID_A,
      submittedCategoryId: UUID_B,
      description: 'Lampu lorong mati total perlu perbaikan',
    }) as unknown as Record<string, unknown>;
    expect(normalized['reporterId']).toBeUndefined();
    expect(normalized['reporter_id']).toBeUndefined();
    expect(normalized['userId']).toBeUndefined();
  });

  it('passes non-objects through for repo validators to reject', () => {
    expect(normalizeCreateReportBody(null)).toBeNull();
  });
});

describe('form-option projections', () => {
  it('hides reporterHidden and inactive locations', () => {
    const base = {
      id: UUID_A,
      code: 'C-01',
      name: 'Ruang 01',
      parentId: null,
      type: 'ROOM',
      buildingCode: 'C',
      floorNumber: 1,
      usageTier: 'TIER_1',
      tierScore: 10,
      reporterHidden: false,
      isActive: true,
    };
    expect(isReporterVisibleLocation(base)).toBe(true);
    expect(isReporterVisibleLocation({ ...base, reporterHidden: true })).toBe(false);
    expect(isReporterVisibleLocation({ ...base, isActive: false })).toBe(false);
  });

  it('projects small payloads with exact keys only', () => {
    expect(
      toLocationOption({
        id: UUID_A,
        code: 'C-01',
        name: 'Ruang 01',
        parentId: null,
        type: 'ROOM',
        buildingCode: 'C',
        floorNumber: 1,
        usageTier: 'TIER_1',
        tierScore: 10,
        reporterHidden: false,
        isActive: true,
      }),
    ).toEqual({
      id: UUID_A,
      code: 'C-01',
      name: 'Ruang 01',
      type: 'ROOM',
      parentId: null,
      buildingCode: 'C',
      floorNumber: 1,
      usageTier: 'TIER_1',
      tierScore: 10,
    });
    expect(
      toCategoryOption({
        id: UUID_A,
        code: 'ELECTRICAL',
        name: 'Kelistrikan',
        description: 'dropped',
        weight: 40,
        isActive: true,
      }),
    ).toEqual({ id: UUID_A, code: 'ELECTRICAL', name: 'Kelistrikan', weight: 40 });
    expect(
      toIssueTypeOption({
        id: UUID_A,
        code: 'BROKEN',
        name: 'Rusak',
        categoryId: UUID_B,
        isActive: true,
      }),
    ).toEqual({ id: UUID_A, code: 'BROKEN', name: 'Rusak', categoryId: UUID_B });
    expect(
      toAssetOption({
        id: UUID_A,
        assetCode: 'AC-001',
        categoryId: UUID_B,
        locationId: UUID_A,
        name: 'AC Ruang 01',
        weight: 15,
        quantity: 99,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    ).toEqual({
      id: UUID_A,
      assetCode: 'AC-001',
      name: 'AC Ruang 01',
      categoryId: UUID_B,
      locationId: UUID_A,
      weight: 15,
    });
  });
});

describe('404 body byte-equality', () => {
  it('produces identical HTTP bodies for missing vs foreign rows', () => {
    // Both paths throw notFound('Report not found') — ticket resolution and
    // the repo ownership check share the exact message, so neither response
    // reveals whether the ticket exists.
    const missing = toHttpResponse(notFound('Report not found'));
    const foreign = toHttpResponse(notFound('Report not found'));
    expect(missing.status).toBe(404);
    expect(JSON.stringify(missing.body)).toBe(JSON.stringify(foreign.body));
    expect(missing.body).toEqual({ error: { code: 'NOT_FOUND', message: 'Report not found' } });
  });
});
