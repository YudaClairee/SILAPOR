import { beforeEach, describe, expect, it, vi } from 'vitest';
import { notFound, toHttpResponse } from '@silapor/shared';
import {
  isHeldReport,
  normalizeHeldVerifyBody,
  verifyHeldReport,
} from './held.js';

const dbMocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  listCategories: vi.fn(),
  listIssueTypes: vi.fn(),
  getAdminReportDetail: vi.fn(),
  getAsset: vi.fn(),
  applyVerification: vi.fn(),
}));

vi.mock('@silapor/database', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@silapor/database')>()),
  getDb: dbMocks.getDb,
  listCategories: dbMocks.listCategories,
  listIssueTypes: dbMocks.listIssueTypes,
  getAdminReportDetail: dbMocks.getAdminReportDetail,
  getAsset: dbMocks.getAsset,
  applyVerification: dbMocks.applyVerification,
}));

const admin = '11111111-1111-1111-1111-111111111111';
const heldId = '22222222-2222-2222-2222-222222222222';
const v = 1;
const CAT_PLUMBING = '33333333-3333-3333-3333-333333333333';
const CAT_HVAC = '55555555-5555-5555-5555-555555555555';
const ISSUE_LEAKING = '44444444-4444-4444-4444-444444444444';
const ASSET_ID = '66666666-6666-6666-6666-666666666666';

function arrangeMaster() {
  dbMocks.listCategories.mockResolvedValue([
    { id: CAT_PLUMBING, code: 'PLUMBING', name: 'Plumbing' },
    { id: CAT_HVAC, code: 'HVAC', name: 'HVAC' },
  ]);
  dbMocks.listIssueTypes.mockResolvedValue([
    { id: ISSUE_LEAKING, code: 'LEAKING', name: 'Leaking', categoryId: CAT_PLUMBING },
  ]);
}

function heldRow(version = 1) {
  return {
    id: heldId,
    status: 'REPORTED',
    version,
    finalCategoryId: null,
    verifiedAt: null,
    assetId: ASSET_ID,
  };
}

describe('verifyHeldReport', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMocks.getDb.mockReturnValue({ db: {}, close: async () => undefined });
    arrangeMaster();
  });

  it('rejects hand-verify with an unknown category before any write', async () => {
    await expect(
      verifyHeldReport(admin, heldId, { category: 'NOPE', issueType: 'LEAKING', priority: 'HIGH' }, v),
    ).rejects.toMatchObject({ status: 400 });
    expect(dbMocks.getAdminReportDetail).not.toHaveBeenCalled();
    expect(dbMocks.applyVerification).not.toHaveBeenCalled();
  });

  it('rejects an unknown issue type before any write', async () => {
    await expect(
      verifyHeldReport(admin, heldId, { category: 'PLUMBING', issueType: 'NOPE', priority: 'HIGH' }, v),
    ).rejects.toMatchObject({ status: 400 });
    expect(dbMocks.getAdminReportDetail).not.toHaveBeenCalled();
    expect(dbMocks.applyVerification).not.toHaveBeenCalled();
  });

  it('rejects an invalid priority before any write', async () => {
    await expect(
      verifyHeldReport(
        admin,
        heldId,
        { category: 'PLUMBING', issueType: 'LEAKING', priority: 'URGENT' },
        v,
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(dbMocks.applyVerification).not.toHaveBeenCalled();
  });

  it('rejects a bound issue type outside the final category before any write', async () => {
    await expect(
      verifyHeldReport(admin, heldId, { category: 'HVAC', issueType: 'LEAKING', priority: 'HIGH' }, v),
    ).rejects.toMatchObject({ status: 400 });
    expect(dbMocks.applyVerification).not.toHaveBeenCalled();
  });

  it('refuses an already verified row with 410 and no write', async () => {
    dbMocks.getAdminReportDetail.mockResolvedValue({
      report: { ...heldRow(), status: 'VERIFIED', finalCategoryId: CAT_PLUMBING },
    });
    await expect(
      verifyHeldReport(
        admin,
        heldId,
        { category: 'PLUMBING', issueType: 'LEAKING', priority: 'HIGH' },
        v,
      ),
    ).rejects.toMatchObject({ status: 410 });
    expect(dbMocks.applyVerification).not.toHaveBeenCalled();
  });

  it('refuses a reported row that already carries finals with 410 and no write', async () => {
    dbMocks.getAdminReportDetail.mockResolvedValue({
      report: { ...heldRow(), finalCategoryId: CAT_PLUMBING },
    });
    await expect(
      verifyHeldReport(
        admin,
        heldId,
        { category: 'PLUMBING', issueType: 'LEAKING', priority: 'HIGH' },
        v,
      ),
    ).rejects.toMatchObject({ status: 410 });
    expect(dbMocks.applyVerification).not.toHaveBeenCalled();
  });

  it('conflicts on a stale version with 409 and no write', async () => {
    dbMocks.getAdminReportDetail.mockResolvedValue({ report: heldRow(2) });
    await expect(
      verifyHeldReport(
        admin,
        heldId,
        { category: 'PLUMBING', issueType: 'LEAKING', priority: 'HIGH' },
        v,
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(dbMocks.applyVerification).not.toHaveBeenCalled();
  });

  it('rejects a final category outside the asset category before any write', async () => {
    dbMocks.getAdminReportDetail.mockResolvedValue({ report: heldRow() });
    dbMocks.getAsset.mockResolvedValue({ id: ASSET_ID, categoryId: CAT_HVAC });
    await expect(
      verifyHeldReport(
        admin,
        heldId,
        { category: 'PLUMBING', issueType: 'LEAKING', priority: 'HIGH' },
        v,
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(dbMocks.applyVerification).not.toHaveBeenCalled();
  });

  it('refuses a supporting-merged row as non-verifiable with 410 and no write', async () => {
    dbMocks.getAdminReportDetail.mockResolvedValue({
      report: heldRow(),
      relations: [
        { relationType: 'SUPPORTING', sourceReportId: heldId, targetReportId: 'target-1' },
      ],
    });
    await expect(
      verifyHeldReport(
        admin,
        heldId,
        { category: 'PLUMBING', issueType: 'LEAKING', priority: 'HIGH' },
        v,
      ),
    ).rejects.toMatchObject({ status: 410 });
    expect(dbMocks.applyVerification).not.toHaveBeenCalled();
  });

  it('verifies a held row with resolved ids and the admin as actor', async () => {
    const verified = { ...heldRow(), status: 'VERIFIED', version: 2 };
    dbMocks.getAdminReportDetail.mockResolvedValue({ report: heldRow() });
    dbMocks.getAsset.mockResolvedValue({ id: ASSET_ID, categoryId: CAT_PLUMBING });
    dbMocks.applyVerification.mockResolvedValue(verified);
    const result = await verifyHeldReport(
      admin,
      heldId,
      { category: 'PLUMBING', issueType: 'LEAKING', priority: 'HIGH' },
      v,
    );
    expect(result).toEqual(verified);
    expect(dbMocks.applyVerification).toHaveBeenCalledWith(
      expect.anything(),
      heldId,
      { finalCategoryId: CAT_PLUMBING, finalIssueTypeId: ISSUE_LEAKING, finalPriority: 'HIGH' },
      admin,
      'ADMIN',
    );
  });

  it('accepts legacy id fields through the same held guards', async () => {
    const verified = { ...heldRow(), status: 'VERIFIED', version: 2 };
    dbMocks.getAdminReportDetail.mockResolvedValue({ report: heldRow() });
    dbMocks.getAsset.mockResolvedValue({ id: ASSET_ID, categoryId: CAT_PLUMBING });
    dbMocks.applyVerification.mockResolvedValue(verified);
    const result = await verifyHeldReport(
      admin,
      heldId,
      { finalCategoryId: CAT_PLUMBING, finalIssueTypeId: ISSUE_LEAKING, finalPriority: 'MEDIUM' },
      v,
    );
    expect(result).toEqual(verified);
    expect(dbMocks.applyVerification).toHaveBeenCalledWith(
      expect.anything(),
      heldId,
      {
        finalCategoryId: CAT_PLUMBING,
        finalIssueTypeId: ISSUE_LEAKING,
        finalPriority: 'MEDIUM',
      },
      admin,
      'ADMIN',
    );
  });

  it('propagates a missing report as 404 with no write', async () => {
    dbMocks.getAdminReportDetail.mockRejectedValue(notFound('Report not found'));
    await expect(
      verifyHeldReport(
        admin,
        heldId,
        { category: 'PLUMBING', issueType: 'LEAKING', priority: 'HIGH' },
        v,
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(dbMocks.applyVerification).not.toHaveBeenCalled();
  });
});

describe('normalizeHeldVerifyBody', () => {
  it('parses category codes with priority and version', () => {
    expect(
      normalizeHeldVerifyBody({
        category: 'PLUMBING',
        issueType: 'LEAKING',
        priority: 'HIGH',
        expectedVersion: 3,
      }),
    ).toEqual({
      decision: { category: 'PLUMBING', issueType: 'LEAKING', priority: 'HIGH' },
      expectedVersion: 3,
    });
  });

  it('parses legacy id fields with snake_case version', () => {
    expect(
      normalizeHeldVerifyBody({
        final_category_id: CAT_PLUMBING,
        final_issue_type_id: ISSUE_LEAKING,
        final_priority: 'LOW',
        expected_version: 2,
      }),
    ).toEqual({
      decision: {
        finalCategoryId: CAT_PLUMBING,
        finalIssueTypeId: ISSUE_LEAKING,
        finalPriority: 'LOW',
      },
      expectedVersion: 2,
    });
  });

  it('400s when classification and version are missing', () => {
    for (const body of [{}, { priority: 'HIGH' }, { category: 'PLUMBING', issueType: 'LEAKING' }]) {
      try {
        normalizeHeldVerifyBody(body);
        throw new Error('expected normalizer to throw');
      } catch (error) {
        expect(toHttpResponse(error).status).toBe(400);
      }
    }
  });
});

describe('isHeldReport', () => {
  it('accepts only unverified reported rows', () => {
    expect(isHeldReport({ status: 'REPORTED', finalCategoryId: null, verifiedAt: null })).toBe(true);
    expect(
      isHeldReport({ status: 'VERIFIED', finalCategoryId: CAT_PLUMBING, verifiedAt: new Date() }),
    ).toBe(false);
    expect(
      isHeldReport({ status: 'REPORTED', finalCategoryId: CAT_PLUMBING, verifiedAt: null }),
    ).toBe(false);
  });

  it('rejects a supporting-linked row as non-verifiable', () => {
    expect(
      isHeldReport({ status: 'REPORTED', finalCategoryId: null, verifiedAt: null, supportingLinked: true }),
    ).toBe(false);
    expect(
      isHeldReport({ status: 'REPORTED', finalCategoryId: null, verifiedAt: null, supportingLinked: false }),
    ).toBe(true);
  });
});
