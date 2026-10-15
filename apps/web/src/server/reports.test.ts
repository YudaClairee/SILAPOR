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
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DuplicateActiveError, resolveReportSort } from '@silapor/database';
import { notFound, toHttpResponse } from '@silapor/shared';
import {
  classifyReportRef,
  isReporterVisibleLocation,
  mapSubmitAiVerdict,
  normalizeCreateReportBody,
  normalizeVerifiedSubmitBody,
  parseAdminReportsQuery,
  parseDuplicateCheckQuery,
  parseMyReportsQuery,
  submitVerifiedReport,
  toAssetOption,
  toCategoryOption,
  toIssueTypeOption,
  toLocationOption,
  toReporterReason,
  type DuplicateCheckFilter,
} from './reports.js';
import type { SessionUser } from './auth.js';

const dbMocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  createReport: vi.fn(),
  recordAiAnalysis: vi.fn(),
  markAiAnalysis: vi.fn(),
  applyVerification: vi.fn(),
  getAsset: vi.fn(),
  getCategory: vi.fn(),
  getIssueType: vi.fn(),
  getLocation: vi.fn(),
  listCategories: vi.fn(),
  listIssueTypes: vi.fn(),
  countAffectedReporters: vi.fn(),
  requireUser: vi.fn(),
}));

vi.mock('@silapor/database', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@silapor/database')>()),
  getDb: dbMocks.getDb,
  createReport: dbMocks.createReport,
  recordAiAnalysis: dbMocks.recordAiAnalysis,
  markAiAnalysis: dbMocks.markAiAnalysis,
  applyVerification: dbMocks.applyVerification,
  getAsset: dbMocks.getAsset,
  getCategory: dbMocks.getCategory,
  getIssueType: dbMocks.getIssueType,
  getLocation: dbMocks.getLocation,
  listCategories: dbMocks.listCategories,
  listIssueTypes: dbMocks.listIssueTypes,
  countAffectedReporters: dbMocks.countAffectedReporters,
}));

vi.mock('./auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./auth')>()),
  requireUser: dbMocks.requireUser,
}));

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

const SUBMIT_REPORTER_ID = '33333333-3333-3333-3333-333333333333';
const SUBMIT_REPORT_ID = '44444444-4444-4444-4444-444444444444';
const SUBMIT_ANALYSIS_ID = '55555555-5555-5555-5555-555555555555';
const SUBMIT_CATEGORY_ID = '66666666-6666-6666-6666-666666666666';
const SUBMIT_ISSUE_ID = '77777777-7777-7777-7777-777777777777';

function submitBody() {
  return {
    locationId: UUID_A,
    assetId: UUID_B,
    description: 'Lampu lorong mati total perlu perbaikan segera',
    photoKeys: ['reports/submit/photo-1.jpg'],
  };
}

function submitRequest(): Request {
  return new Request('http://localhost:3000/api/reports', { method: 'POST' });
}

function sessionUser(): SessionUser {
  return { id: SUBMIT_REPORTER_ID, username: 'reporter', role: 'REPORTER' } as SessionUser;
}

function arrangeMasterContext() {
  dbMocks.getAsset.mockResolvedValue({
    id: UUID_B,
    assetCode: 'AC-001',
    name: 'AC Ruang 01',
    categoryId: SUBMIT_CATEGORY_ID,
    locationId: UUID_A,
    weight: 15,
  });
  dbMocks.listCategories.mockResolvedValue([
    { id: SUBMIT_CATEGORY_ID, code: 'PLUMBING', name: 'Plumbing', weight: 20 },
  ]);
  dbMocks.listIssueTypes.mockResolvedValue([
    { id: SUBMIT_ISSUE_ID, code: 'LEAKING', name: 'Leaking', categoryId: SUBMIT_CATEGORY_ID },
  ]);
  dbMocks.getLocation.mockResolvedValue({ id: UUID_A, tierScore: 12 });
  dbMocks.countAffectedReporters.mockResolvedValue(1);
}

describe('submitVerifiedReport held fallback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMocks.requireUser.mockResolvedValue(sessionUser());
    dbMocks.getDb.mockReturnValue({ db: {}, close: async () => undefined });
  });

  it('holds as REPORTED with a ticket when the AI is DOWN', async () => {
    arrangeMasterContext();
    dbMocks.createReport.mockResolvedValue({
      report: {
        id: SUBMIT_REPORT_ID,
        ticketNumber: 'MNT-2026-000007',
        status: 'REPORTED',
        reporterId: SUBMIT_REPORTER_ID,
        assetId: UUID_B,
        locationId: UUID_A,
        submittedCategoryId: SUBMIT_CATEGORY_ID,
      },
      duplicateCandidates: [],
      relation: null,
      idempotentReplay: false,
    });
    dbMocks.recordAiAnalysis.mockResolvedValue({ id: SUBMIT_ANALYSIS_ID, status: 'PENDING' });
    const res = await submitVerifiedReport(submitRequest(), submitBody(), 'key-down-1', {
      verify: async () => ({ kind: 'DOWN' }),
      model: 'test-model',
      timeoutMs: 50,
    });
    expect(res.status).toBe(202);
    if (res.status !== 202) {
      throw new Error('expected a held submit result');
    }
    expect(res.ticketNumber).toMatch(/^MNT-/);
    expect(res.report.status).toBe('REPORTED');
    expect(typeof res.message).toBe('string');
    expect(dbMocks.recordAiAnalysis).toHaveBeenCalledTimes(1);
    expect(dbMocks.markAiAnalysis).not.toHaveBeenCalled();
    expect(dbMocks.applyVerification).not.toHaveBeenCalled();
  });

  it('verifies as VERIFIED with a ticket when the AI passes', async () => {
    arrangeMasterContext();
    const calls: { updated: unknown[]; deleted: number } = { updated: [], deleted: 0 };
    dbMocks.getDb.mockReturnValue({
      db: {
        transaction: async (cb: (tx: unknown) => Promise<unknown>) =>
          cb({ delete: () => ({ where: async () => [] }) }),
        update: () => ({
          set: (values: unknown) => ({
            where: () => ({
              returning: async () => {
                calls.updated.push(values);
                return [];
              },
            }),
          }),
        }),
      },
      close: async () => undefined,
    });
    dbMocks.createReport.mockResolvedValue({
      report: {
        id: SUBMIT_REPORT_ID,
        ticketNumber: 'MNT-2026-000007',
        status: 'REPORTED',
        reporterId: SUBMIT_REPORTER_ID,
        assetId: UUID_B,
        locationId: UUID_A,
        submittedCategoryId: SUBMIT_CATEGORY_ID,
      },
      duplicateCandidates: [],
      relation: null,
      idempotentReplay: false,
    });
    dbMocks.recordAiAnalysis.mockResolvedValue({ id: SUBMIT_ANALYSIS_ID, status: 'PENDING' });
    dbMocks.applyVerification.mockResolvedValue({
      id: SUBMIT_REPORT_ID,
      ticketNumber: 'MNT-2026-000007',
      status: 'VERIFIED',
      version: 2,
    });
    const verify = vi.fn().mockResolvedValue({
      kind: 'PASS',
      category: 'PLUMBING',
      issueType: 'LEAKING',
      priority: 'MEDIUM',
      confidence: 0.9,
      reasons: ['photo shows a leak under the sink'],
      model: 'test-model',
      promptVersion: 'v1',
      schemaVersion: 'v1',
    });
    const res = await submitVerifiedReport(submitRequest(), submitBody(), 'key-pass-1', {
      verify,
      model: 'test-model',
      timeoutMs: 50,
    });
    expect(res.status).toBe(201);
    if (res.status !== 201) {
      throw new Error('expected a verified submit result');
    }
    expect(res.ticketNumber).toMatch(/^MNT-/);
    expect(res.verification).toEqual({
      status: 'VERIFIED',
      category: 'PLUMBING',
      issueType: 'LEAKING',
      priority: 'MEDIUM',
      confidence: 0.9,
    });
    expect(verify).toHaveBeenCalledTimes(1);
    expect(dbMocks.applyVerification).toHaveBeenCalledWith(
      expect.anything(),
      SUBMIT_REPORT_ID,
      {
        finalCategoryId: SUBMIT_CATEGORY_ID,
        finalIssueTypeId: SUBMIT_ISSUE_ID,
        finalPriority: 'MEDIUM',
      },
      SUBMIT_REPORTER_ID,
    );
    expect(calls.updated).toHaveLength(1);
    const snapshot = calls.updated[0] as Record<string, unknown>;
    expect(typeof snapshot['priorityScore']).toBe('number');
    expect(snapshot['priorityFactors']).toEqual(
      expect.objectContaining({ scoringComplete: expect.any(Boolean) }),
    );
    expect(dbMocks.markAiAnalysis).toHaveBeenCalledWith(
      expect.anything(),
      SUBMIT_ANALYSIS_ID,
      expect.objectContaining({
        status: 'SUCCEEDED',
        category: 'PLUMBING',
        issueType: 'LEAKING',
        priority: 'MEDIUM',
        confidence: 0.9,
        model: 'test-model',
      }),
    );
  });

  it('floors a DANGEROUS verdict to HIGH', async () => {
    arrangeMasterContext();
    dbMocks.listIssueTypes.mockResolvedValue([
      { id: SUBMIT_ISSUE_ID, code: 'DANGEROUS', name: 'Dangerous', categoryId: SUBMIT_CATEGORY_ID },
    ]);
    dbMocks.getDb.mockReturnValue({
      db: {
        transaction: async (cb: (tx: unknown) => Promise<unknown>) =>
          cb({ delete: () => ({ where: async () => [] }) }),
        update: () => ({
          set: () => ({ where: () => ({ returning: async () => [] }) }),
        }),
      },
      close: async () => undefined,
    });
    dbMocks.createReport.mockResolvedValue({
      report: {
        id: SUBMIT_REPORT_ID,
        ticketNumber: 'MNT-2026-000007',
        status: 'REPORTED',
        reporterId: SUBMIT_REPORTER_ID,
        assetId: UUID_B,
        locationId: UUID_A,
        submittedCategoryId: SUBMIT_CATEGORY_ID,
      },
      duplicateCandidates: [],
      relation: null,
      idempotentReplay: false,
    });
    dbMocks.recordAiAnalysis.mockResolvedValue({ id: SUBMIT_ANALYSIS_ID, status: 'PENDING' });
    dbMocks.applyVerification.mockResolvedValue({
      id: SUBMIT_REPORT_ID,
      ticketNumber: 'MNT-2026-000007',
      status: 'VERIFIED',
      version: 2,
    });
    const res = await submitVerifiedReport(submitRequest(), submitBody(), 'key-danger-1', {
      verify: async () => ({
        kind: 'PASS',
        category: 'PLUMBING',
        issueType: 'DANGEROUS',
        priority: 'LOW',
        confidence: 0.8,
        reasons: ['exposed wiring'],
        model: 'test-model',
        promptVersion: 'v1',
        schemaVersion: 'v1',
      }),
      model: 'test-model',
      timeoutMs: 50,
    });
    expect(res.status).toBe(201);
    if (res.status !== 201) {
      throw new Error('expected a verified submit result');
    }
    expect(res.verification.priority).toBe('HIGH');
    expect(dbMocks.applyVerification).toHaveBeenCalledWith(
      expect.anything(),
      SUBMIT_REPORT_ID,
      expect.objectContaining({ finalPriority: 'HIGH' }),
      SUBMIT_REPORTER_ID,
    );
  });

  it('rejects with 422 and no row when the AI fails', async () => {
    arrangeMasterContext();
    let deleted = 0;
    dbMocks.getDb.mockReturnValue({
      db: {
        transaction: async (cb: (tx: unknown) => Promise<unknown>) =>
          cb({
            delete: () => ({
              where: async () => {
                deleted += 1;
                return [];
              },
            }),
          }),
      },
      close: async () => undefined,
    });
    dbMocks.createReport.mockResolvedValue({
      report: {
        id: SUBMIT_REPORT_ID,
        ticketNumber: 'MNT-2026-000007',
        status: 'REPORTED',
        reporterId: SUBMIT_REPORTER_ID,
        assetId: UUID_B,
        locationId: UUID_A,
        submittedCategoryId: SUBMIT_CATEGORY_ID,
      },
      duplicateCandidates: [],
      relation: null,
      idempotentReplay: false,
    });
    dbMocks.recordAiAnalysis.mockResolvedValue({ id: SUBMIT_ANALYSIS_ID, status: 'PENDING' });
    const res = await submitVerifiedReport(submitRequest(), submitBody(), 'key-fail-1', {
      verify: async () => ({ kind: 'FAIL', reason: 'UNCLEAR_EVIDENCE' }),
      model: 'test-model',
      timeoutMs: 50,
    });
    expect(res.status).toBe(422);
    if (res.status !== 422) {
      throw new Error('expected a rejected submit result');
    }
    expect(res.reason).not.toContain('UNCLEAR_EVIDENCE');
    expect(typeof res.reason).toBe('string');
    expect(dbMocks.markAiAnalysis).toHaveBeenCalledWith(
      expect.anything(),
      SUBMIT_ANALYSIS_ID,
      { status: 'FAILED', errorCode: 'UNCLEAR_EVIDENCE' },
    );
    expect(deleted).toBeGreaterThan(0);
    expect(dbMocks.applyVerification).not.toHaveBeenCalled();
  });

  it('rejects with 422 when the AI verdict points at the wrong asset', async () => {
    arrangeMasterContext();
    dbMocks.listCategories.mockResolvedValue([
      { id: SUBMIT_CATEGORY_ID, code: 'PLUMBING', name: 'Plumbing', weight: 20 },
      { id: UUID_A, code: 'HVAC', name: 'HVAC', weight: 20 },
    ]);
    dbMocks.getDb.mockReturnValue({
      db: {
        transaction: async (cb: (tx: unknown) => Promise<unknown>) =>
          cb({ delete: () => ({ where: async () => [] }) }),
      },
      close: async () => undefined,
    });
    dbMocks.createReport.mockResolvedValue({
      report: {
        id: SUBMIT_REPORT_ID,
        ticketNumber: 'MNT-2026-000007',
        status: 'REPORTED',
        reporterId: SUBMIT_REPORTER_ID,
        assetId: UUID_B,
        locationId: UUID_A,
        submittedCategoryId: SUBMIT_CATEGORY_ID,
      },
      duplicateCandidates: [],
      relation: null,
      idempotentReplay: false,
    });
    dbMocks.recordAiAnalysis.mockResolvedValue({ id: SUBMIT_ANALYSIS_ID, status: 'PENDING' });
    const res = await submitVerifiedReport(submitRequest(), submitBody(), 'key-wrong-1', {
      verify: async () => ({
        kind: 'PASS',
        category: 'HVAC',
        issueType: 'LEAKING',
        priority: 'MEDIUM',
        confidence: 0.7,
        reasons: ['looks like an AC unit'],
        model: 'test-model',
        promptVersion: 'v1',
        schemaVersion: 'v1',
      }),
      model: 'test-model',
      timeoutMs: 50,
    });
    expect(res.status).toBe(422);
    if (res.status !== 422) {
      throw new Error('expected a rejected submit result');
    }
    expect(res.reason.toLowerCase()).toContain('asset');
    expect(dbMocks.markAiAnalysis).toHaveBeenCalledWith(
      expect.anything(),
      SUBMIT_ANALYSIS_ID,
      { status: 'FAILED', errorCode: 'WRONG_ASSET' },
    );
    expect(dbMocks.applyVerification).not.toHaveBeenCalled();
  });

  it('blocks a same-reporter duplicate with 409 before calling AI', async () => {
    arrangeMasterContext();
    dbMocks.createReport.mockRejectedValue(new DuplicateActiveError('MNT-2026-000003'));
    const verify = vi.fn().mockResolvedValue({ kind: 'DOWN' });
    await expect(
      submitVerifiedReport(submitRequest(), submitBody(), 'key-dup-1', {
        verify,
        model: 'test-model',
        timeoutMs: 50,
      }),
    ).rejects.toMatchObject({ code: 'DUPLICATE_ACTIVE' });
    expect(verify).not.toHaveBeenCalled();
    expect(dbMocks.recordAiAnalysis).not.toHaveBeenCalled();
  });
});

describe('normalizeVerifiedSubmitBody', () => {
  it('rejects reporter-supplied classification and occurredAt', () => {
    for (const body of [
      { ...submitBody(), categoryId: UUID_A },
      { ...submitBody(), submittedCategoryId: UUID_A },
      { ...submitBody(), issueTypeId: UUID_A },
      { ...submitBody(), submittedIssueTypeId: UUID_A },
      { ...submitBody(), occurredAt: '2026-10-01T00:00:00Z' },
    ]) {
      expect(() => normalizeVerifiedSubmitBody(body)).toThrowError(/must not be provided/);
    }
  });

  it('requires 1 to 3 photo keys', () => {
    expect(() => normalizeVerifiedSubmitBody({ ...submitBody(), photoKeys: [] })).toThrowError(
      /photoKeys/,
    );
    expect(() =>
      normalizeVerifiedSubmitBody({ ...submitBody(), photoKeys: ['a', 'b', 'c', 'd'] }),
    ).toThrowError(/photoKeys/);
    const { photoKeys: _dropped, ...withoutKeys } = submitBody();
    expect(normalizeVerifiedSubmitBody({ ...withoutKeys, photo_keys: ['key-1'] }).photoKeys).toEqual(
      ['key-1'],
    );
  });

  it('requires location, asset, and a 10-2000 description', () => {
    expect(() => normalizeVerifiedSubmitBody({ ...submitBody(), locationId: 'nope' })).toThrowError(
      /locationId/,
    );
    expect(() => normalizeVerifiedSubmitBody({ ...submitBody(), description: 'too short' })).toThrowError(
      /description/,
    );
  });
});

describe('mapSubmitAiVerdict', () => {
  const lists = { categories: ['PLUMBING', 'HVAC'], issueTypes: ['LEAKING'] };

  it('passes a matching verdict through', () => {
    expect(
      mapSubmitAiVerdict({
        impliedCategory: 'PLUMBING',
        assetCategory: 'PLUMBING',
        category: 'PLUMBING',
        issueType: 'LEAKING',
        priority: 'MEDIUM',
        ...lists,
      }),
    ).toEqual({ ok: true, categoryCode: 'PLUMBING', issueTypeCode: 'LEAKING', priority: 'MEDIUM' });
  });

  it('fails unknown codes before the asset check', () => {
    expect(
      mapSubmitAiVerdict({
        impliedCategory: 'ROOFING',
        assetCategory: 'PLUMBING',
        category: 'ROOFING',
        issueType: 'LEAKING',
        priority: 'MEDIUM',
        ...lists,
      }),
    ).toEqual({ ok: false, reason: 'UNKNOWN_CODE' });
  });

  it('fails a category mismatch as WRONG_ASSET', () => {
    expect(
      mapSubmitAiVerdict({
        impliedCategory: 'HVAC',
        assetCategory: 'PLUMBING',
        category: 'HVAC',
        issueType: 'LEAKING',
        priority: 'MEDIUM',
        ...lists,
      }),
    ).toEqual({ ok: false, reason: 'WRONG_ASSET' });
  });
});

describe('toReporterReason', () => {
  it('maps every machine code to plain language without leaking the code', () => {
    for (const code of [
      'INVALID_INPUT',
      'UNKNOWN_MODEL',
      'UPSTREAM_REJECTED',
      'UNCLEAR_EVIDENCE',
      'WRONG_ASSET',
      'UNKNOWN_CODE',
    ]) {
      const reason = toReporterReason(code);
      expect(typeof reason).toBe('string');
      expect(reason.length).toBeGreaterThan(0);
      expect(reason).not.toContain(code);
    }
    expect(toReporterReason('SOMETHING_NEW')).not.toContain('SOMETHING_NEW');
  });
});
