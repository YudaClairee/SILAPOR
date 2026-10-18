import {
  applyVerification as repoApplyVerification,
  getAdminReportDetail as repoGetAdminReportDetail,
  getAsset as repoGetAsset,
  getDb,
  listCategories as repoListCategories,
  listIssueTypes as repoListIssueTypes,
  type Report,
} from '@silapor/database';
import { AppError, badRequest, conflict, notFound, type AppErrorCode } from '@silapor/shared';
import { requireExpectedVersion } from './workflow.js';

export interface HeldVerifyCodes {
  readonly category: string;
  readonly issueType: string;
  readonly priority: string;
}

export interface HeldVerifyIds {
  readonly finalCategoryId: string;
  readonly finalIssueTypeId: string;
  readonly finalPriority: string;
}

export type HeldVerifyDecision = HeldVerifyCodes | HeldVerifyIds;

export interface NormalizedHeldVerify {
  readonly decision: HeldVerifyDecision;
  readonly expectedVersion: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fieldOf(body: Record<string, unknown>, names: readonly string[]): unknown {
  for (const name of names) {
    const value = body[name];
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

// Held-only guard: verified or non-reported rows are gone, never overridden.
// Supporting-merged rows are never verifiable either — their incident's one
// verification already belongs to the target ticket.
export function isHeldReport(row: {
  readonly status: string;
  readonly finalCategoryId: string | null;
  readonly verifiedAt: Date | null;
  readonly supportingLinked?: boolean | null | undefined;
}): boolean {
  return (
    row.status === 'REPORTED' &&
    row.finalCategoryId === null &&
    row.verifiedAt === null &&
    row.supportingLinked !== true
  );
}

// Gone signals a hold that already resolved elsewhere.
function gone(message: string): AppError {
  return new AppError({ code: 'GONE' as AppErrorCode, message, status: 410 });
}

export function normalizeHeldVerifyBody(body: unknown): NormalizedHeldVerify {
  const expectedVersion = requireExpectedVersion(body);
  if (!isRecord(body)) {
    throw badRequest('Invalid verification input');
  }
  const category = fieldOf(body, ['category']);
  const issueType = fieldOf(body, ['issueType', 'issue_type']);
  const finalCategoryId = fieldOf(body, ['finalCategoryId', 'final_category_id']);
  const finalIssueTypeId = fieldOf(body, ['finalIssueTypeId', 'final_issue_type_id']);
  const priority = fieldOf(body, ['priority', 'finalPriority', 'final_priority']);
  if (category !== undefined || issueType !== undefined) {
    return {
      decision: { category, issueType, priority } as HeldVerifyDecision,
      expectedVersion,
    };
  }
  if (finalCategoryId !== undefined || finalIssueTypeId !== undefined) {
    return {
      decision: { finalCategoryId, finalIssueTypeId, finalPriority: priority } as HeldVerifyDecision,
      expectedVersion,
    };
  }
  throw badRequest('Invalid verification input');
}

function toFinalPriority(value: unknown): 'LOW' | 'MEDIUM' | 'HIGH' {
  const priority = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (priority === 'LOW' || priority === 'MEDIUM' || priority === 'HIGH') {
    return priority;
  }
  throw badRequest('Invalid final priority');
}

function trimmedCode(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export async function verifyHeldReport(
  adminId: string,
  reportId: string,
  decision: HeldVerifyDecision,
  expectedVersion: number,
): Promise<Report> {
  const version = requireExpectedVersion({ expectedVersion });
  if (!isRecord(decision)) {
    throw badRequest('Invalid verification input');
  }
  const codesPath = 'category' in decision || 'issueType' in decision;
  const conn = getDb();
  try {
    const categories: { readonly id: string; readonly code: string }[] = [];
    let offset = 0;
    for (;;) {
      const rows = await repoListCategories(conn.db, {
        includeInactive: false,
        limit: 200,
        offset,
      });
      categories.push(...rows);
      if (rows.length < 200) {
        break;
      }
      offset += 200;
    }
    const issueTypes: { readonly id: string; readonly code: string; readonly categoryId: string | null }[] = [];
    offset = 0;
    for (;;) {
      const rows = await repoListIssueTypes(conn.db, {
        includeInactive: false,
        limit: 200,
        offset,
      });
      issueTypes.push(...rows);
      if (rows.length < 200) {
        break;
      }
      offset += 200;
    }
    let finalCategoryId: string;
    let finalIssueTypeId: string;
    if (codesPath) {
      const codes = decision as Partial<HeldVerifyCodes>;
      const categoryCode = trimmedCode(codes.category);
      const issueTypeCode = trimmedCode(codes.issueType);
      if (categoryCode === '' || issueTypeCode === '') {
        throw badRequest('Invalid verification input');
      }
      const category = categories.find((entry) => entry.code === categoryCode);
      if (category === undefined) {
        throw badRequest('Unknown category');
      }
      const issueType = issueTypes.find((entry) => entry.code === issueTypeCode);
      if (issueType === undefined) {
        throw badRequest('Unknown issue type');
      }
      finalCategoryId = category.id;
      finalIssueTypeId = issueType.id;
    } else {
      const ids = decision as Partial<HeldVerifyIds>;
      if (typeof ids.finalCategoryId !== 'string' || typeof ids.finalIssueTypeId !== 'string') {
        throw badRequest('Invalid verification input');
      }
      const category = categories.find((entry) => entry.id === ids.finalCategoryId);
      if (category === undefined) {
        throw badRequest('Unknown category');
      }
      const issueType = issueTypes.find((entry) => entry.id === ids.finalIssueTypeId);
      if (issueType === undefined) {
        throw badRequest('Unknown issue type');
      }
      finalCategoryId = category.id;
      finalIssueTypeId = issueType.id;
    }
    const issueType = issueTypes.find((entry) => entry.id === finalIssueTypeId);
    if (
      issueType !== undefined &&
      issueType.categoryId !== null &&
      issueType.categoryId !== finalCategoryId
    ) {
      throw badRequest('Issue type does not belong to the final category');
    }
    const finalPriority = toFinalPriority(
      (decision as Partial<HeldVerifyCodes & HeldVerifyIds>).priority ??
        (decision as Partial<HeldVerifyIds>).finalPriority,
    );
    const detail = await repoGetAdminReportDetail(conn.db, reportId);
    const report = detail.report;
    // Supporting-merged rows were auto-joined into another reporter's ticket
    // at submit and never verify — reject them as non-verifiable (410 gone).
    const supportingLinked = (detail.relations ?? []).some(
      (rel) => rel.relationType === 'SUPPORTING' && rel.sourceReportId === report.id,
    );
    if (!isHeldReport({ ...report, supportingLinked })) {
      throw gone(
        supportingLinked
          ? 'Report was merged as supporting evidence into another ticket and cannot be verified'
          : 'Report is no longer held for verification',
      );
    }
    // Stale versions conflict so the admin refreshes before retrying.
    if (report.version !== version) {
      throw conflict('Report was modified by another admin; refresh and retry');
    }
    if (report.assetId === null) {
      throw badRequest('Report has no asset');
    }
    const asset = await repoGetAsset(conn.db, report.assetId);
    if (asset === undefined) {
      throw notFound('Asset not found');
    }
    if (asset.categoryId === null) {
      throw badRequest('Asset has no category');
    }
    if (asset.categoryId !== finalCategoryId) {
      throw badRequest('Final category does not match asset category');
    }
    return await repoApplyVerification(
      conn.db,
      report.id,
      { finalCategoryId, finalIssueTypeId, finalPriority },
      adminId,
      'ADMIN',
    );
  } finally {
    await conn.close().catch(() => undefined);
  }
}
