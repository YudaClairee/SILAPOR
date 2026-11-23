// Report creation transaction + duplicate-first submit (Task 3 AI verification).
//
// `createReport` is duplicate-first: inside a single `db.transaction` it
// replays an idempotency key, validates the new input shape (reporter +
// location + exactly one of asset or service category + description; the
// reporter NEVER sends a category, issue type, or occurredAt), checks the
// referenced rows, then looks for an ACTIVE report on the SAME target BEFORE
// minting a ticket. The target is the asset for damage reports, or the
// location + category for service reports (`assetId` null, which never
// matches or merges with damage reports):
// same-reporter actives throw `DuplicateActiveError` (`DUPLICATE_ACTIVE`
// with the active ticketNumber, consuming no ticket); different-reporter
// actives attach as a supporter row in `report_supporters` on the earliest
// active ticket in the SAME transaction without minting a new ticket or
// enqueuing AI review.
// When no active ticket exists, a new report is created: one ticket per
// idempotency key, one REPORT_CREATED event, one PENDING AI_REVIEW_REQUESTED
// outbox row. It NEVER calls AI and NEVER uses REJECTED/DUPLICATE statuses
// (7-status lifecycle).
//
// `applyVerification` moves a held REPORTED row to VERIFIED with the
// verifier-supplied finals plus a REPORT_VERIFIED event, atomically.
//
// Errors use `AppError` from `@silapor/shared` (400 validation, 404 missing
// reference, 409 duplicate block carrying the active ticketNumber in
// `details`, 409 mapped to idempotent replay on a key race). This module logs
// nothing and carries no PII in messages.

import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
} from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { AppError, badRequest, conflict, internal, isAppError, notFound } from '@silapor/shared';
import {
  ACTIVE_REPORT_STATUSES,
  DUPLICATE_LOOKBACK_DAYS,
  LAPORAN_PALSU_NEUTRAL_MESSAGE,
  RELATION_TYPE,
  REPORT_STATUS,
  formatTicketNumber,
  higherPriority,
  scorePriority,
  type PriorityLevel,
} from '@silapor/domain';
import * as schema from './schema.js';
import { type AttachmentSummary } from './attachments.js';
import { normalizeListOptions } from './master-data.js';

type Database = PostgresJsDatabase<typeof schema>;

// Transaction client handed to `db.transaction` callbacks (select/insert/
// update only — no nested transactions). `findDuplicateCandidates` accepts
// either so `createReport` can read its own write inside the transaction.
type TransactionClient = Parameters<Parameters<Database['transaction']>[0]>[0];

export type ReportQueryDb = Database | TransactionClient;

// ---------------------------------------------------------------------------
// AI-verdict vocabulary (structural copy of Task 2 `packages/domain/src/
// ai-verdict.ts` — COPIED, not imported: this package must not depend on
// `@silapor/domain` for these types). Kept in sync by hand; the field names
// and reason literals are verbatim so later tasks (submit verify, held
// hand-verify) can map AI outcomes onto `applyVerification` finals.
// ---------------------------------------------------------------------------

export interface AiVerdictInput {
  impliedCategory: string;
  assetCategory: string;
  category: string;
  issueType: string;
  priority: string;
  categories: readonly string[];
  issueTypes: readonly string[];
}

export type AiVerdictResult =
  | { ok: true; categoryCode: string; issueTypeCode: string; priority: string }
  | { ok: false; reason: 'WRONG_ASSET' | 'UNCLEAR_EVIDENCE' | 'UNKNOWN_CODE' };

// ---------------------------------------------------------------------------
// Pure input validation (no I/O; FK existence is checked by `createReport`).
// ---------------------------------------------------------------------------

// Exactly one target: `assetId` (laporan kerusakan fasilitas) or
// `serviceCategoryId` (laporan layanan, kategori dengan requiresAsset=false).
export interface CreateReportInput {
  readonly reporterId: string;
  readonly locationId: string;
  readonly assetId?: string | undefined;
  readonly serviceCategoryId?: string | undefined;
  readonly description: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function checkRequiredUuid(record: Record<string, unknown>, field: string, errors: string[]): void {
  const value = record[field];
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    errors.push(`${field} must be a valid UUID`);
  }
}

// Shape-only checks. Reporter-supplied classification is rejected outright
// (the verifier owns category/issue/priority); asset existence/activeness
// needs database rows and lives in `createReport`, not here.
export function validateCreateReportInput(input: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(input)) {
    return ['input must be an object'];
  }
  checkRequiredUuid(input, 'reporterId', errors);
  checkRequiredUuid(input, 'locationId', errors);

  // Exactly one target: a damage report names an asset, a service report
  // names a service category. Sending both, or neither, is rejected.
  const hasAsset = input['assetId'] !== undefined;
  const hasService = input['serviceCategoryId'] !== undefined;
  if (hasAsset && hasService) {
    errors.push('assetId and serviceCategoryId are mutually exclusive');
  } else if (hasAsset) {
    checkRequiredUuid(input, 'assetId', errors);
  } else if (hasService) {
    checkRequiredUuid(input, 'serviceCategoryId', errors);
  } else {
    errors.push('assetId or serviceCategoryId is required');
  }

  for (const field of ['submittedCategoryId', 'submittedIssueTypeId', 'occurredAt']) {
    if (input[field] !== undefined) {
      errors.push(`${field} must not be provided`);
    }
  }

  const description = input['description'];
  if (typeof description !== 'string' || description.trim().length < 10) {
    errors.push('description must be at least 10 characters');
  } else if (description.trim().length > 2000) {
    errors.push('description must be at most 2000 characters');
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Jakarta calendar year (ticket counters are per Asia/Jakarta year).
// ---------------------------------------------------------------------------

export function getJakartaYear(now: Date = new Date()): number {
  const yearText = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
  }).format(now);
  return Number.parseInt(yearText, 10);
}

// ---------------------------------------------------------------------------
// Duplicate-candidate search.
// ---------------------------------------------------------------------------

export interface DuplicateCandidateFilter {
  readonly reporterId: string;
  readonly assetId?: string | null | undefined;
  readonly locationId: string;
  readonly categoryId: string;
  readonly issueTypeId?: string | null | undefined;
  // Excludes one report (the just-created row, so the fast path can still
  // fall back to the full scan when only self matches). Optional and
  // additive: callers passing the five base fields are unaffected.
  readonly excludeReportId?: string | null | undefined;
}

export interface DuplicateCandidate {
  readonly id: string;
  readonly ticketNumber: string;
  readonly status: string;
  readonly reportedAt: Date;
}

// Incident-matching core shared by `findDuplicateCandidates` (same
// reporter) and `countAffectedReporters` (all reporters): ACTIVE statuses
// only, same asset/location scope, same submitted-or-final category, same
// issue type (null-safe). Single definition — callers only add their own
// extra conditions (reporter, lookback, exclusion) around it. Non-active
// rows (RESOLVED/CLOSED) never match.
interface IncidentScope {
  readonly assetId?: string | null | undefined;
  readonly locationId: string;
  readonly categoryId: string;
  readonly issueTypeId?: string | null | undefined;
}

function incidentConditions(filter: IncidentScope) {
  // Damage reports match only their own asset. Service reports (no asset)
  // match only other asset-less rows at the same location, so a service
  // report never duplicates or merges with a damage report, and vice versa.
  const scope =
    filter.assetId !== undefined && filter.assetId !== null
      ? sql`${schema.maintenanceReports.assetId} IS NOT DISTINCT FROM ${filter.assetId}`
      : and(
          eq(schema.maintenanceReports.locationId, filter.locationId),
          isNull(schema.maintenanceReports.assetId),
        );
  return [
    inArray(schema.maintenanceReports.status, [...ACTIVE_REPORT_STATUSES]),
    scope,
    or(
      eq(schema.maintenanceReports.submittedCategoryId, filter.categoryId),
      eq(schema.maintenanceReports.finalCategoryId, filter.categoryId),
    ),
    sql`${schema.maintenanceReports.submittedIssueTypeId} IS NOT DISTINCT FROM ${filter.issueTypeId ?? null}`,
  ];
}

function candidateConditions(
  filter: DuplicateCandidateFilter,
  since: Date | null,
): ReturnType<typeof and> {
  const conditions = [
    eq(schema.maintenanceReports.reporterId, filter.reporterId),
    ...incidentConditions(filter),
  ];
  if (since !== null) {
    conditions.push(gte(schema.maintenanceReports.reportedAt, since));
  }
  if (filter.excludeReportId !== undefined && filter.excludeReportId !== null) {
    conditions.push(ne(schema.maintenanceReports.id, filter.excludeReportId));
  }
  return and(...conditions);
}

async function queryCandidates(
  db: ReportQueryDb,
  filter: DuplicateCandidateFilter,
  since: Date | null,
): Promise<DuplicateCandidate[]> {
  const rows = await db
    .select({
      id: schema.maintenanceReports.id,
      ticketNumber: schema.maintenanceReports.ticketNumber,
      status: schema.maintenanceReports.status,
      reportedAt: schema.maintenanceReports.reportedAt,
    })
    .from(schema.maintenanceReports)
    .where(candidateConditions(filter, since))
    .orderBy(desc(schema.maintenanceReports.reportedAt));
  return rows;
}

// Active reports by the SAME reporter matching the same incident, newest
// first. Fast path scans the DUPLICATE_LOOKBACK_DAYS window; when it finds
// nothing a full active scan follows so the lookback NEVER hides an active
// match. Non-active rows (RESOLVED/CLOSED) and other reporters' rows are
// never returned. (Kept for detail/count read paths; the submit path itself
// blocks/merges via the asset lookups in `createReport`.)
export async function findDuplicateCandidates(
  db: ReportQueryDb,
  filter: DuplicateCandidateFilter,
): Promise<DuplicateCandidate[]> {
  const cutoff = new Date(Date.now() - DUPLICATE_LOOKBACK_DAYS * 24 * 3_600_000);
  const recent = await queryCandidates(db, filter, cutoff);
  if (recent.length > 0) {
    return recent;
  }
  return await queryCandidates(db, filter, null);
}

// ---------------------------------------------------------------------------
// createReport.
// ---------------------------------------------------------------------------

export type CreateReportResult =
  | {
      readonly kind: 'CREATED';
      readonly report: schema.Report;
      // Compat: still computed via `findDuplicateCandidates`. Always empty on the
      // new flow (same-reporter actives throw; other reporters are scoped out).
      readonly duplicateCandidates: DuplicateCandidate[];
      readonly supporter: null;
      readonly idempotentReplay: boolean;
    }
  | {
      readonly kind: 'SUPPORTED';
      readonly report: schema.Report;
      readonly duplicateCandidates: DuplicateCandidate[];
      readonly supporter: schema.ReportSupporter;
      readonly affectedReporters: number;
      readonly idempotentReplay: boolean;
    };

// Kept until Langkah 7 migrates `SubmitVerifiedResult` in apps/web.
export interface SupportingRelationRef {
  readonly type: 'SUPPORTING';
  readonly targetTicket: string;
}

// Thrown when the same reporter submits the same target while an ACTIVE
// report on it exists (either as primary reporter or existing supporter).
// An `AppError` with code `DUPLICATE_ACTIVE`, status 409, and the active
// ticketNumber in `details`, so `isAppError` / `toHttpResponse` carry
// status+code through transport. Always thrown BEFORE the ticket counter
// increments — a blocked submit consumes no ticket and writes no rows.
export class DuplicateActiveError extends AppError {
  constructor(
    ticketNumber: string,
    message = 'Duplicate report: an active report already exists for this asset',
  ) {
    super({
      code: 'DUPLICATE_ACTIVE',
      message,
      status: 409,
      details: { ticketNumber },
    });
    this.name = 'DuplicateActiveError';
  }
}

// Earliest ACTIVE report on the target (asset for damage, or location +
// service category with asset_id IS NULL for service), regardless of reporter.
// Deterministic via reportedAt ASC, then id ASC.
async function findEarliestActiveOnTarget(
  db: ReportQueryDb,
  locationId: string,
  target: SubmissionTarget,
): Promise<schema.Report | undefined> {
  const targetCondition =
    target.assetId !== null
      ? eq(schema.maintenanceReports.assetId, target.assetId)
      : and(
          isNull(schema.maintenanceReports.assetId),
          eq(schema.maintenanceReports.locationId, locationId),
          eq(schema.maintenanceReports.submittedCategoryId, target.categoryId),
        );
  const rows = await db
    .select()
    .from(schema.maintenanceReports)
    .where(and(targetCondition, inArray(schema.maintenanceReports.status, [...ACTIVE_REPORT_STATUSES])))
    .orderBy(asc(schema.maintenanceReports.reportedAt), asc(schema.maintenanceReports.id))
    .limit(1);
  return rows[0];
}

async function hasReporterSupported(
  db: ReportQueryDb,
  reportId: string,
  reporterId: string,
): Promise<boolean> {
  const rows = await db
    .select({ id: schema.reportSupporters.id })
    .from(schema.reportSupporters)
    .where(
      and(
        eq(schema.reportSupporters.reportId, reportId),
        eq(schema.reportSupporters.reporterId, reporterId),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export interface SupporterByKeyMatch {
  readonly supporter: schema.ReportSupporter;
  readonly report: schema.Report;
}

export async function findSupporterByKey(
  db: ReportQueryDb,
  idempotencyKey: string,
): Promise<SupporterByKeyMatch | undefined> {
  const rows = await db
    .select({
      supporter: schema.reportSupporters,
      report: schema.maintenanceReports,
    })
    .from(schema.reportSupporters)
    .innerJoin(
      schema.maintenanceReports,
      eq(schema.reportSupporters.reportId, schema.maintenanceReports.id),
    )
    .where(eq(schema.reportSupporters.idempotencyKey, idempotencyKey))
    .limit(1);
  return rows[0];
}

// Drizzle wraps storage errors in `DrizzleQueryError` with the postgres
// error nested under `.cause`, so unwrap a few levels before matching.
// Exported for unit-testing the error mapper (Fix 2) without a live race.
export function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4; depth++) {
    if (typeof current !== 'object' || current === null) {
      break;
    }
    if ((current as Record<string, unknown>)['code'] === '23505') {
      return true;
    }
    if (current instanceof Error && current.message.includes('duplicate key')) {
      return true;
    }
    const next = (current as Record<string, unknown>)['cause'];
    if (next === undefined || next === null) {
      break;
    }
    current = next;
  }
  return false;
}

// Same unwrapping for FK violations (SQLSTATE 23503). Residual FK failures
// (e.g. a referenced row deleted mid-transaction) must surface as AppError,
// never as a raw driver error.
export function isForeignKeyViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4; depth++) {
    if (typeof current !== 'object' || current === null) {
      break;
    }
    if ((current as Record<string, unknown>)['code'] === '23503') {
      return true;
    }
    if (
      current instanceof Error &&
      (current.message.includes('foreign key') || current.message.includes('violates foreign key'))
    ) {
      return true;
    }
    const next = (current as Record<string, unknown>)['cause'];
    if (next === undefined || next === null) {
      break;
    }
    current = next;
  }
  return false;
}

// Idempotency lookup by key (global, like the create fast-path): lets the
// verified submit replay a prior ticket before touching staged keys.
export async function findReportByKey(
  db: ReportQueryDb,
  idempotencyKey: string,
): Promise<schema.Report | undefined> {
  const rows = await db
    .select()
    .from(schema.maintenanceReports)
    .where(eq(schema.maintenanceReports.idempotencyKey, idempotencyKey));
  return rows[0];
}

function toFilterInput(report: schema.Report): DuplicateCandidateFilter {
  return {
    reporterId: report.reporterId,
    assetId: report.assetId,
    locationId: report.locationId,
    categoryId: report.submittedCategoryId,
    issueTypeId: report.submittedIssueTypeId,
    excludeReportId: report.id,
  };
}

// What a new report is filed against: an active asset (damage report) or,
// with `assetId: null`, a service category at the location (service report).
interface SubmissionTarget {
  readonly assetId: string | null;
  readonly categoryId: string;
}

const SERVICE_DUPLICATE_MESSAGE =
  'Duplicate report: an active report already exists for this location and category';

// Damage report: the asset row is locked (`FOR UPDATE`) so concurrent
// same-asset submits serialize here: the loser blocks until the winner
// commits, then the checks below see the winner's row.
async function resolveAssetTarget(
  tx: TransactionClient,
  assetId: string,
): Promise<SubmissionTarget> {
  const asset = (
    await tx
      .select()
      .from(schema.facilityAssets)
      .where(eq(schema.facilityAssets.id, assetId))
      .for('update')
  )[0];
  if (asset === undefined) {
    throw notFound('Asset not found');
  }
  if (!asset.isActive) {
    throw badRequest('Asset is inactive');
  }
  if (asset.categoryId === null || asset.categoryId === undefined) {
    throw badRequest('Asset has no category');
  }
  // The derived submitted category must itself be active — an asset
  // pointing at an archived category cannot accept new reports.
  const assetCategory = (
    await tx
      .select()
      .from(schema.facilityCategories)
      .where(eq(schema.facilityCategories.id, asset.categoryId))
  )[0];
  if (assetCategory === undefined) {
    throw notFound('Category not found');
  }
  if (!assetCategory.isActive) {
    throw badRequest('Category is inactive');
  }
  return { assetId, categoryId: asset.categoryId };
}

// Service report: the category must be active and asset-less by design
// (`requiresAsset=false`). There is no asset row to lock, so the location row
// is locked instead. One lock per transaction, taken before the ticket counter,
// the same position as the asset lock.
async function resolveServiceTarget(
  tx: TransactionClient,
  locationId: string,
  serviceCategoryId: string,
): Promise<SubmissionTarget> {
  const category = (
    await tx
      .select()
      .from(schema.facilityCategories)
      .where(eq(schema.facilityCategories.id, serviceCategoryId))
  )[0];
  if (category === undefined) {
    throw notFound('Category not found');
  }
  if (!category.isActive) {
    throw badRequest('Category is inactive');
  }
  if (category.requiresAsset) {
    throw badRequest('Category requires an asset');
  }
  await tx
    .select({ id: schema.locations.id })
    .from(schema.locations)
    .where(eq(schema.locations.id, locationId))
    .for('update');
  return { assetId: null, categoryId: category.id };
}

async function resolveSubmissionTarget(
  tx: TransactionClient,
  input: CreateReportInput,
): Promise<SubmissionTarget> {
  if (input.assetId !== undefined) {
    return await resolveAssetTarget(tx, input.assetId);
  }
  if (input.serviceCategoryId !== undefined) {
    return await resolveServiceTarget(tx, input.locationId, input.serviceCategoryId);
  }
  // Unreachable after `validateCreateReportInput`, kept for type narrowing.
  throw badRequest('Invalid report input: assetId or serviceCategoryId is required');
}

function extractConstraintName(error: unknown): string | null {
  let current: unknown = error;
  for (let depth = 0; depth < 4; depth++) {
    if (typeof current !== 'object' || current === null) {
      break;
    }
    const record = current as Record<string, unknown>;
    const constraint = record['constraint_name'] ?? record['constraint'];
    if (typeof constraint === 'string' && constraint.length > 0) {
      return constraint;
    }
    const next = record['cause'];
    if (next === undefined || next === null) {
      break;
    }
    current = next;
  }
  return null;
}

async function countSupportersForReport(db: ReportQueryDb, reportId: string): Promise<number> {
  const rows = await db
    .select({ value: count() })
    .from(schema.reportSupporters)
    .where(eq(schema.reportSupporters.reportId, reportId));
  return rows[0]?.value ?? 0;
}

function asPriorityLevel(value: unknown): PriorityLevel | null {
  if (value === 'LOW' || value === 'MEDIUM' || value === 'HIGH') {
    return value;
  }
  return null;
}

async function loadScoringWeights(
  tx: TransactionClient,
  report: {
    readonly finalCategoryId: string;
    readonly finalIssueTypeId: string;
    readonly assetId: string | null;
    readonly locationId: string;
  },
): Promise<{
  readonly categoryWeight: number | null;
  readonly assetWeight: number | null;
  readonly locationScore: number | null;
  readonly issueTypeCode: string | null;
}> {
  const category = (
    await tx
      .select({ weight: schema.facilityCategories.weight })
      .from(schema.facilityCategories)
      .where(eq(schema.facilityCategories.id, report.finalCategoryId))
  )[0];
  const asset =
    report.assetId === null
      ? undefined
      : (
          await tx
            .select({ weight: schema.facilityAssets.weight })
            .from(schema.facilityAssets)
            .where(eq(schema.facilityAssets.id, report.assetId))
        )[0];
  const location = (
    await tx
      .select({ tierScore: schema.locations.tierScore })
      .from(schema.locations)
      .where(eq(schema.locations.id, report.locationId))
  )[0];
  const issueType = (
    await tx
      .select({ code: schema.issueTypes.code })
      .from(schema.issueTypes)
      .where(eq(schema.issueTypes.id, report.finalIssueTypeId))
  )[0];
  return {
    categoryWeight: category?.weight ?? null,
    assetWeight: asset?.weight ?? null,
    locationScore: location?.tierScore ?? null,
    issueTypeCode: issueType?.code ?? null,
  };
}

async function refreshPriorityOnSupport(
  tx: TransactionClient,
  report: schema.Report,
  affectedReporters: number,
  supporterId: string,
): Promise<schema.Report> {
  if (report.finalCategoryId === null || report.finalIssueTypeId === null) {
    return report;
  }
  const weights = await loadScoringWeights(tx, {
    finalCategoryId: report.finalCategoryId,
    finalIssueTypeId: report.finalIssueTypeId,
    assetId: report.assetId,
    locationId: report.locationId,
  });
  const score = scorePriority({
    ...weights,
    affectedReporters,
  });
  const nextPriority =
    report.priorityOverrideReason !== null
      ? report.finalPriority
      : higherPriority(asPriorityLevel(report.finalPriority), score.suggestedPriority);
  const priorityFactors = {
    ...score.factors,
    scoringComplete: score.scoringComplete,
    ...(report.assetId === null ? { assetless: true } : {}),
  };
  const now = new Date();
  const updated = await tx
    .update(schema.maintenanceReports)
    .set({
      priorityScore: score.score,
      priorityFactors,
      finalPriority: nextPriority,
      scoringConfigVersion: score.scoringConfigVersion,
      version: report.version + 1,
      updatedAt: now,
    })
    .where(eq(schema.maintenanceReports.id, report.id))
    .returning();
  if (nextPriority !== report.finalPriority) {
    await tx.insert(schema.reportEvents).values({
      reportId: report.id,
      eventType: 'PRIORITY_CHANGED',
      actorId: null,
      fromValue: report.finalPriority,
      toValue: nextPriority,
      metadata: {
        reason: 'SUPPORTER_ADDED',
        supporterId,
        affectedReporters,
        score: score.score,
        suggestedPriority: score.suggestedPriority,
      },
    });
  }
  return updated[0] ?? report;
}

async function buildCreatedReplayResult(
  db: ReportQueryDb,
  report: schema.Report,
): Promise<CreateReportResult> {
  return {
    kind: 'CREATED',
    report,
    duplicateCandidates: await findDuplicateCandidates(db, toFilterInput(report)),
    supporter: null,
    idempotentReplay: true,
  };
}

async function buildSupportedResult(
  db: ReportQueryDb,
  report: schema.Report,
  supporter: schema.ReportSupporter,
  idempotentReplay: boolean,
): Promise<CreateReportResult> {
  const supporterCount = await countSupportersForReport(db, report.id);
  return {
    kind: 'SUPPORTED',
    report,
    duplicateCandidates: [],
    supporter,
    affectedReporters: 1 + supporterCount,
    idempotentReplay,
  };
}

async function findActiveForDuplicateError(
  db: ReportQueryDb,
  input: CreateReportInput,
): Promise<schema.Report | undefined> {
  if (input.assetId !== undefined) {
    return await findEarliestActiveOnTarget(db, input.locationId, {
      assetId: input.assetId,
      categoryId: '',
    });
  }
  if (input.serviceCategoryId !== undefined) {
    return await findEarliestActiveOnTarget(db, input.locationId, {
      assetId: null,
      categoryId: input.serviceCategoryId,
    });
  }
  return undefined;
}

export async function createReport(
  db: Database,
  input: CreateReportInput,
  idempotencyKey: string,
): Promise<CreateReportResult> {
  if (typeof idempotencyKey !== 'string' || idempotencyKey.trim() === '') {
    throw badRequest('Idempotency key is required');
  }
  const key = idempotencyKey.trim();

  // Replay-before-validation (Fix 1): a same-key retry must replay the
  // original ticket or supporter attachment even when the retried payload
  // drifted. The in-transaction lookup below still covers concurrent races.
  const fastReportReplay = await findReportByKey(db, key);
  if (fastReportReplay !== undefined) {
    return await buildCreatedReplayResult(db, fastReportReplay);
  }
  const fastSupporterReplay = await findSupporterByKey(db, key);
  if (fastSupporterReplay !== undefined) {
    return await buildSupportedResult(
      db,
      fastSupporterReplay.report,
      fastSupporterReplay.supporter,
      true,
    );
  }

  const shapeErrors = validateCreateReportInput(input);
  if (shapeErrors.length > 0) {
    throw badRequest(`Invalid report input: ${shapeErrors.join('; ')}`);
  }

  try {
    return await db.transaction(async (tx) => {
      // Referenced rows must exist AND be active. The target lock (asset row or
      // location row, see `resolveSubmissionTarget`) serializes concurrent
      // submits to the same target. One lock per transaction, always taken
      // before the shared ticket counter — no lock-order inversion.
      const reporter = (
        await tx.select().from(schema.users).where(eq(schema.users.id, input.reporterId))
      )[0];
      if (reporter === undefined) {
        throw notFound('Reporter not found');
      }
      if (!reporter.isActive) {
        throw badRequest('Reporter is inactive');
      }
      const location = (
        await tx.select().from(schema.locations).where(eq(schema.locations.id, input.locationId))
      )[0];
      if (location === undefined) {
        throw notFound('Location not found');
      }
      if (!location.isActive) {
        throw badRequest('Location is inactive');
      }
      const target = await resolveSubmissionTarget(tx, input);

      // Same-key retry AFTER the target lock: a concurrent same-key winner may
      // have committed while this transaction waited on the lock — replay it
      // with NO new ticket/supporter/event/job instead of misreading it as a duplicate.
      const existingReport = await findReportByKey(tx, key);
      if (existingReport !== undefined) {
        return await buildCreatedReplayResult(tx, existingReport);
      }
      const existingSupporter = await findSupporterByKey(tx, key);
      if (existingSupporter !== undefined) {
        return await buildSupportedResult(
          tx,
          existingSupporter.report,
          existingSupporter.supporter,
          true,
        );
      }

      // Active-target lookup: same reporter (primary or already supporting)
      // throws 409 DUPLICATE_ACTIVE; different reporter attaches as supporter
      // on the existing active ticket without minting a new ticket.
      const activeTarget = await findEarliestActiveOnTarget(tx, input.locationId, target);
      if (activeTarget !== undefined) {
        if (
          activeTarget.reporterId === input.reporterId ||
          (await hasReporterSupported(tx, activeTarget.id, input.reporterId))
        ) {
          throw new DuplicateActiveError(
            activeTarget.ticketNumber,
            target.assetId === null ? SERVICE_DUPLICATE_MESSAGE : undefined,
          );
        }

        const insertedSupporter = await tx
          .insert(schema.reportSupporters)
          .values({
            reportId: activeTarget.id,
            reporterId: input.reporterId,
            idempotencyKey: key,
            description: input.description.trim(),
          })
          .returning();
        const supporter = insertedSupporter[0];
        if (supporter === undefined) {
          throw internal('Failed to create report supporter');
        }

        await tx.insert(schema.reportEvents).values({
          reportId: activeTarget.id,
          eventType: 'SUPPORTER_ADDED',
          actorId: input.reporterId,
          metadata: { supporterId: supporter.id },
        });

        const supporterCount = await countSupportersForReport(tx, activeTarget.id);
        const affectedReporters = 1 + supporterCount;
        const updatedTarget = await refreshPriorityOnSupport(
          tx,
          activeTarget,
          affectedReporters,
          supporter.id,
        );
        return {
          kind: 'SUPPORTED',
          report: updatedTarget,
          duplicateCandidates: [],
          supporter,
          affectedReporters,
          idempotentReplay: false,
        };
      }

      // Lock/increment the per-year ticket counter atomically.
      const year = getJakartaYear(new Date());
      const counter = await tx
        .insert(schema.ticketCounters)
        .values({ year, lastSeq: 1 })
        .onConflictDoUpdate({
          target: schema.ticketCounters.year,
          set: { lastSeq: sql`${schema.ticketCounters.lastSeq} + 1` },
        })
        .returning({ lastSeq: schema.ticketCounters.lastSeq });
      const seq = counter[0]?.lastSeq;
      if (seq === undefined) {
        throw internal('Failed to allocate ticket number');
      }
      const ticketNumber = formatTicketNumber(year, seq);

      const occurredAt = null;

      const inserted = await tx
        .insert(schema.maintenanceReports)
        .values({
          ticketNumber,
          idempotencyKey: key,
          reporterId: input.reporterId,
          locationId: input.locationId,
          assetId: target.assetId,
          submittedCategoryId: target.categoryId,
          submittedIssueTypeId: null,
          description: input.description.trim(),
          occurredAt,
          status: 'REPORTED',
          version: 1,
          reportedAt: new Date(),
        })
        .returning();
      const report = inserted[0];
      if (report === undefined) {
        throw internal('Failed to create report');
      }

      await tx.insert(schema.reportEvents).values({
        reportId: report.id,
        eventType: 'REPORT_CREATED',
        actorId: input.reporterId,
      });

      // The AI worker picks this up later; never call AI here.
      await tx.insert(schema.outboxEvents).values({
        type: 'AI_REVIEW_REQUESTED',
        payload: { reportId: report.id, ticketNumber },
        status: 'PENDING',
      });

      const duplicateCandidates = await findDuplicateCandidates(tx, toFilterInput(report));
      return {
        kind: 'CREATED',
        report,
        duplicateCandidates,
        supporter: null,
        idempotentReplay: false,
      };
    });
  } catch (error) {
    if (isAppError(error)) {
      throw error;
    }
    if (isUniqueViolation(error)) {
      const winnerReport = await findReportByKey(db, key);
      if (winnerReport !== undefined) {
        return await buildCreatedReplayResult(db, winnerReport);
      }
      const winnerSupporter = await findSupporterByKey(db, key);
      if (winnerSupporter !== undefined) {
        return await buildSupportedResult(
          db,
          winnerSupporter.report,
          winnerSupporter.supporter,
          true,
        );
      }
      const constraint = extractConstraintName(error);
      if (
        constraint === 'report_supporters_report_reporter_unique' ||
        (error instanceof Error && error.message.includes('report_supporters_report_reporter_unique'))
      ) {
        const activeTarget = await findActiveForDuplicateError(db, input);
        if (activeTarget !== undefined) {
          throw new DuplicateActiveError(
            activeTarget.ticketNumber,
            input.assetId === undefined ? SERVICE_DUPLICATE_MESSAGE : undefined,
          );
        }
      }
      throw internal('Failed to create report');
    }
    if (isForeignKeyViolation(error)) {
      throw notFound('Referenced record not found');
    }
    throw internal('Failed to create report');
  }
}

// Compensates a failed supporter attachment (e.g. staged-photo claim CONFLICT)
// by deleting only the supporter row and its SUPPORTER_ADDED / PRIORITY_CHANGED
// events, and re-syncing priority score/factors on the primary report — NEVER
// deleting the primary maintenance_reports row belonging to another reporter.
export async function compensateFailedSupporter(db: Database, supporterId: string): Promise<void> {
  const id = requireUuid(supporterId, 'supporterId');
  await db.transaction(async (tx) => {
    const deleted = await tx
      .delete(schema.reportSupporters)
      .where(eq(schema.reportSupporters.id, id))
      .returning({ reportId: schema.reportSupporters.reportId });
    const reportId = deleted[0]?.reportId;
    if (reportId !== undefined) {
      await tx
        .delete(schema.reportEvents)
        .where(
          and(
            eq(schema.reportEvents.reportId, reportId),
            eq(schema.reportEvents.eventType, 'SUPPORTER_ADDED'),
            sql`${schema.reportEvents.metadata}->>'supporterId' = ${id}`,
          ),
        );
      const deletedPriorityEvents = await tx
        .delete(schema.reportEvents)
        .where(
          and(
            eq(schema.reportEvents.reportId, reportId),
            eq(schema.reportEvents.eventType, 'PRIORITY_CHANGED'),
            sql`${schema.reportEvents.metadata}->>'supporterId' = ${id}`,
          ),
        )
        .returning({
          fromValue: schema.reportEvents.fromValue,
          toValue: schema.reportEvents.toValue,
        });
      const deletedPriorityEvent = deletedPriorityEvents[0];
      const primary = (
        await tx
          .select()
          .from(schema.maintenanceReports)
          .where(eq(schema.maintenanceReports.id, reportId))
      )[0];
      if (
        primary !== undefined &&
        primary.finalCategoryId !== null &&
        primary.finalIssueTypeId !== null
      ) {
        const remainingAffected = 1 + (await countSupportersForReport(tx, reportId));
        const weights = await loadScoringWeights(tx, {
          finalCategoryId: primary.finalCategoryId,
          finalIssueTypeId: primary.finalIssueTypeId,
          assetId: primary.assetId,
          locationId: primary.locationId,
        });
        const score = scorePriority({
          ...weights,
          affectedReporters: remainingAffected,
        });
        const priorityFactors = {
          ...score.factors,
          scoringComplete: score.scoringComplete,
          ...(primary.assetId === null ? { assetless: true } : {}),
        };
        const restoredPriorityFromEvent =
          deletedPriorityEvent !== undefined &&
          primary.priorityOverrideReason === null &&
          primary.finalPriority === deletedPriorityEvent.toValue
            ? asPriorityLevel(deletedPriorityEvent.fromValue)
            : null;
        const restoredPriority = restoredPriorityFromEvent ?? primary.finalPriority;
        await tx
          .update(schema.maintenanceReports)
          .set({
            priorityScore: score.score,
            priorityFactors,
            finalPriority: restoredPriority,
            scoringConfigVersion: score.scoringConfigVersion,
            version: primary.version + 1,
            updatedAt: new Date(),
          })
          .where(eq(schema.maintenanceReports.id, reportId));
      }
    }
  });
}

// ---------------------------------------------------------------------------
// applyVerification: held REPORTED → VERIFIED with verifier finals.
// ---------------------------------------------------------------------------

export type PriorityDecider = 'AI' | 'ADMIN';

export interface ApplyVerificationInput {
  readonly finalCategoryId: string;
  readonly finalIssueTypeId: string;
  readonly finalPriority: 'LOW' | 'MEDIUM' | 'HIGH';
}

// Sets the final classification + priority on a held REPORTED row and flips
// it to VERIFIED, with a REPORT_VERIFIED event, all in one transaction. The
// status guard (`WHERE status = REPORTED`) makes a concurrent second verify
// fail with 400 instead of double-writing. SUPPORTING links are never
// touched — verification must not disturb the submit-time auto-merge.
// `decidedBy` records whether the AI or a held-verify admin made the call;
// the final priority is floored to HIGH for DANGEROUS issue types.
export async function applyVerification(
  db: Database,
  reportId: string,
  finals: ApplyVerificationInput,
  actorId?: string | null | undefined,
  decidedBy: PriorityDecider = 'ADMIN',
): Promise<schema.Report> {
  if (typeof reportId !== 'string' || !UUID_RE.test(reportId)) {
    throw badRequest('reportId must be a valid UUID');
  }
  if (typeof finals !== 'object' || finals === null) {
    throw badRequest('Invalid verification input');
  }
  if (typeof finals.finalCategoryId !== 'string' || !UUID_RE.test(finals.finalCategoryId)) {
    throw badRequest('finalCategoryId must be a valid UUID');
  }
  if (typeof finals.finalIssueTypeId !== 'string' || !UUID_RE.test(finals.finalIssueTypeId)) {
    throw badRequest('finalIssueTypeId must be a valid UUID');
  }
  if (
    finals.finalPriority !== 'LOW' &&
    finals.finalPriority !== 'MEDIUM' &&
    finals.finalPriority !== 'HIGH'
  ) {
    throw badRequest('Invalid final priority');
  }
  if (
    actorId !== undefined &&
    actorId !== null &&
    (typeof actorId !== 'string' || !UUID_RE.test(actorId))
  ) {
    throw badRequest('actorId must be a valid UUID');
  }

  const rows = await db
    .select()
    .from(schema.maintenanceReports)
    .where(eq(schema.maintenanceReports.id, reportId));
  const report = rows[0];
  if (report === undefined) {
    throw notFound('Report not found');
  }
  if (report.status !== 'REPORTED') {
    throw badRequest('Only REPORTED reports can be verified');
  }

  try {
    return await db.transaction(async (tx) => {
      const category = (
        await tx
          .select()
          .from(schema.facilityCategories)
          .where(eq(schema.facilityCategories.id, finals.finalCategoryId))
      )[0];
      if (category === undefined) {
        throw notFound('Category not found');
      }
      if (!category.isActive) {
        throw badRequest('Category is inactive');
      }
      const issueType = (
        await tx
          .select()
          .from(schema.issueTypes)
          .where(eq(schema.issueTypes.id, finals.finalIssueTypeId))
      )[0];
      if (issueType === undefined) {
        throw notFound('Issue type not found');
      }
      if (!issueType.isActive) {
        throw badRequest('Issue type is inactive');
      }
      // A category-bound issue type must belong to the final category;
      // generic (unbound) issue types stay valid for any category.
      if (issueType.categoryId !== null && issueType.categoryId !== finals.finalCategoryId) {
        throw badRequest('Issue type does not belong to the final category');
      }
      // No silent recode, even for callers that skip `mapAiVerdict`. An asset
      // report's final category must equal its asset's master category; the
      // asset row is loaded in-tx so a concurrent recategorization cannot slip
      // between the check and the update. A service report has no asset, so
      // its final category must be the one the reporter chose and must itself
      // be asset-less (`requiresAsset=false`).
      let assetWeight: number | null = null;
      if (report.assetId === null || report.assetId === undefined) {
        if (category.id !== report.submittedCategoryId) {
          throw badRequest('Final category does not match the reported service category');
        }
        if (category.requiresAsset) {
          throw badRequest('Category requires an asset');
        }
      } else {
        const asset = (
          await tx
            .select()
            .from(schema.facilityAssets)
            .where(eq(schema.facilityAssets.id, report.assetId))
        )[0];
        if (asset === undefined) {
          throw notFound('Asset not found');
        }
        if (asset.categoryId === null || asset.categoryId === undefined) {
          throw badRequest('Asset has no category');
        }
        if (asset.categoryId !== finals.finalCategoryId) {
          throw badRequest('Final category does not match asset category');
        }
        assetWeight = asset.weight ?? null;
      }

      const locationRow = (
        await tx
          .select({ tierScore: schema.locations.tierScore })
          .from(schema.locations)
          .where(eq(schema.locations.id, report.locationId))
      )[0];
      let affected = 1;
      try {
        affected = Math.max(
          1,
          await countAffectedReporters(tx, {
            assetId: report.assetId,
            locationId: report.locationId,
            categoryId: category.id,
            issueTypeId: issueType.id,
          }),
        );
      } catch {
        affected = 1;
      }
      const score = scorePriority({
        categoryWeight: category.weight,
        assetWeight,
        locationScore: locationRow?.tierScore ?? null,
        affectedReporters: affected,
        issueTypeCode: issueType.code,
      });

      // Spec floor: a DANGEROUS final issue type keeps minimum HIGH, whether
      // the verdict came from the AI or a hand verify.
      const finalPriority =
        issueType.code === 'DANGEROUS' && finals.finalPriority !== 'HIGH'
          ? 'HIGH'
          : finals.finalPriority;

      const now = new Date();
      const updated = await tx
        .update(schema.maintenanceReports)
        .set({
          status: 'VERIFIED',
          finalCategoryId: finals.finalCategoryId,
          finalIssueTypeId: finals.finalIssueTypeId,
          priorityScore: score.score,
          priorityFactors: {
            ...score.factors,
            scoringComplete: score.scoringComplete,
            ...(report.assetId === null ? { assetless: true } : {}),
          },
          scoringConfigVersion: score.scoringConfigVersion,
          finalPriority,
          priorityDecidedBy: decidedBy,
          priorityDecidedAt: now,
          verifiedAt: now,
          version: report.version + 1,
          updatedAt: now,
        })
        .where(
          and(
            eq(schema.maintenanceReports.id, report.id),
            eq(schema.maintenanceReports.status, 'REPORTED'),
          ),
        )
        .returning();
      const next = updated[0];
      if (next === undefined) {
        throw badRequest('Only REPORTED reports can be verified');
      }

      await tx.insert(schema.reportEvents).values({
        reportId: report.id,
        eventType: 'REPORT_VERIFIED',
        actorId: actorId ?? null,
        fromValue: 'REPORTED',
        toValue: 'VERIFIED',
        metadata: {
          finalCategoryId: finals.finalCategoryId,
          finalIssueTypeId: finals.finalIssueTypeId,
          finalPriority,
        },
      });
      // Parity with workflow.verifyReport: verification must reach the
      // reporter. Without this row the held/AI verify paths leave the reporter
      // with no "Laporan diverifikasi" notification (notifications.ts only
      // reads WORKFLOW_NOTIFICATION outbox rows). Queued in-tx so the
      // notification can never disagree with the status flip; the worker
      // consumes it asynchronously and idempotently.
      await tx.insert(schema.outboxEvents).values({
        type: 'WORKFLOW_NOTIFICATION',
        payload: {
          reportId: report.id,
          ticketNumber: report.ticketNumber,
          kind: 'REPORT_VERIFIED',
          actorId: actorId ?? null,
        },
        status: 'PENDING',
      });
      return next;
    });
  } catch (error) {
    if (isAppError(error)) {
      throw error;
    }
    if (isForeignKeyViolation(error)) {
      throw notFound('Referenced record not found');
    }
    throw internal('Failed to verify report');
  }
}

// ---------------------------------------------------------------------------
// P3-3 report queries + supporting links.
//
// Reporter read paths: `listMyReports`, `getMyReportDetail`, and
// `getMyReportTimeline` take `reporterId` and filter by it; `getMy*` returns
// an identical 404 for missing vs foreign rows. The campus paths
// (`listCampusReports`, `getCampusReportDetail`) instead expose every ticket
// through a sanitized projection (no reporter identity/idempotency/audit
// fields; attachments are campus-readable while duplicate candidates stay
// owner-only) and 404 only when the ticket itself is missing. Admin paths
// (`listAllReports`, `getAdminReportDetail`) add reporter/search filters and
// skip ownership.
// `linkSupportingReport` is metadata only: no status change, no repair job.
// `countAffectedReporters` counts DISTINCT reporters over the shared incident
// predicate above plus one hop of SUPPORTING/RELATED links.
//
// Pagination ALWAYS reuses `normalizeListOptions` (default 50, max 200) and
// every sort ALWAYS tiebreaks by id asc so pages are stable. Errors use
// `AppError` (400 validation, 404 missing, 409 duplicate link) with no PII.
// ---------------------------------------------------------------------------

const REPORT_STATUS_SET: ReadonlySet<string> = new Set(REPORT_STATUS);
const RELATION_TYPE_SET: ReadonlySet<string> = new Set(RELATION_TYPE);
const PRIORITY_SET: ReadonlySet<string> = new Set(['LOW', 'MEDIUM', 'HIGH']);

export const REPORT_SORTS = [
  'reported_desc',
  'reported_asc',
  'ticket_asc',
  'ticket_desc',
  // Admin Figma 150:626 "Urutan Default: Skor Prioritas Tertinggi".
  'priority_desc',
] as const;

export type ReportSort = (typeof REPORT_SORTS)[number];

export interface ReportOrderSpec {
  readonly column: 'reportedAt' | 'ticketNumber' | 'id' | 'priorityScore';
  readonly direction: 'asc' | 'desc';
  /** Priority ordering keeps unscored rows (null) after scored rows. */
  readonly nullsLast?: boolean;
}

// Validates `sort` (default `reported_desc`, anything else → 400).
export function resolveReportSort(sort: unknown): ReportSort {
  if (sort === undefined || sort === null) {
    return 'reported_desc';
  }
  if (typeof sort === 'string' && (REPORT_SORTS as readonly string[]).includes(sort)) {
    return sort as ReportSort;
  }
  throw badRequest('Invalid report sort');
}

// Pure order spec for a validated sort. The trailing `{ column: 'id',
// direction: 'asc' }` tiebreak is what keeps pagination deterministic when
// rows share `reported_at` / `ticket_number`.
export function reportOrderBy(sort: unknown): readonly ReportOrderSpec[] {
  const resolved = resolveReportSort(sort);
  switch (resolved) {
    case 'reported_asc':
      return [
        { column: 'reportedAt', direction: 'asc' },
        { column: 'id', direction: 'asc' },
      ];
    case 'ticket_asc':
      return [
        { column: 'ticketNumber', direction: 'asc' },
        { column: 'id', direction: 'asc' },
      ];
    case 'ticket_desc':
      return [
        { column: 'ticketNumber', direction: 'desc' },
        { column: 'id', direction: 'asc' },
      ];
    case 'priority_desc':
      return [
        { column: 'priorityScore', direction: 'desc', nullsLast: true },
        { column: 'reportedAt', direction: 'desc' },
        { column: 'id', direction: 'asc' },
      ];
    case 'reported_desc':
    default:
      return [
        { column: 'reportedAt', direction: 'desc' },
        { column: 'id', direction: 'asc' },
      ];
  }
}

function drizzleOrderBy(sort: ReportSort): ReturnType<typeof asc>[] {
  switch (sort) {
    case 'reported_asc':
      return [asc(schema.maintenanceReports.reportedAt), asc(schema.maintenanceReports.id)];
    case 'ticket_asc':
      return [asc(schema.maintenanceReports.ticketNumber), asc(schema.maintenanceReports.id)];
    case 'ticket_desc':
      return [desc(schema.maintenanceReports.ticketNumber), asc(schema.maintenanceReports.id)];
    case 'priority_desc':
      // Postgres DESC defaults to NULLS FIRST; unscored tickets must stay last.
      return [
        sql`${schema.maintenanceReports.priorityScore} DESC NULLS LAST`,
        desc(schema.maintenanceReports.reportedAt),
        asc(schema.maintenanceReports.id),
      ];
    case 'reported_desc':
    default:
      return [desc(schema.maintenanceReports.reportedAt), asc(schema.maintenanceReports.id)];
  }
}

// Validates a `search` value into a parameterized ILIKE pattern (`%q%` with
// `%_\` escaped) or `null` when there is no search filter. Blank/omitted
// search is NOT an error; non-blank must be 2–100 chars after trimming.
export function buildSearchPattern(search: unknown): string | null {
  if (search === undefined || search === null) {
    return null;
  }
  if (typeof search !== 'string') {
    throw badRequest('Invalid report search');
  }
  const query = search.trim();
  if (query === '') {
    return null;
  }
  if (query.length < 2 || query.length > 100) {
    throw badRequest('Search must be 2-100 characters');
  }
  const escaped = query.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
  return `%${escaped}%`;
}

function requireUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    throw badRequest(`${field} must be a valid UUID`);
  }
  return value;
}

function optionalUuid(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  return requireUuid(value, field);
}

function parseStatusFilter(status: unknown): Array<(typeof REPORT_STATUS)[number]> | undefined {
  if (status === undefined || status === null) {
    return undefined;
  }
  const values = Array.isArray(status) ? status : [status];
  for (const value of values) {
    if (typeof value !== 'string' || !REPORT_STATUS_SET.has(value)) {
      throw badRequest('Invalid report status filter');
    }
  }
  return values as Array<(typeof REPORT_STATUS)[number]>;
}

// Empty means "no filter"; anything other than DAMAGE/SERVICE is a 400.
function parseReportKindFilter(kind: unknown): ReportKindFilter | undefined {
  if (kind === undefined || kind === null || kind === '') {
    return undefined;
  }
  if (typeof kind !== 'string' || !(REPORT_KIND_FILTER as readonly string[]).includes(kind)) {
    throw badRequest('Invalid report kind filter');
  }
  return kind as ReportKindFilter;
}

function parsePriorityFilter(priority: unknown): string | undefined {
  if (priority === undefined || priority === null) {
    return undefined;
  }
  if (typeof priority !== 'string' || !PRIORITY_SET.has(priority)) {
    throw badRequest('Invalid report priority filter');
  }
  return priority;
}

const JAKARTA_DAY_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const JAKARTA_OFFSET_MS = 7 * 3_600_000;

interface ListDateBound {
  readonly instant: Date;
  readonly exclusive: boolean;
}

function parseDateBound(value: unknown, field: string): ListDateBound | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === 'string' && JAKARTA_DAY_ONLY_PATTERN.test(value)) {
    const [year, month, day] = value.split('-').map(Number) as [number, number, number];
    const dayStart = new Date(Date.UTC(year, month - 1, day) - JAKARTA_OFFSET_MS);
    const roundTrip = new Date(dayStart.getTime() + JAKARTA_OFFSET_MS);
    if (
      roundTrip.getUTCFullYear() !== year ||
      roundTrip.getUTCMonth() !== month - 1 ||
      roundTrip.getUTCDate() !== day
    ) {
      throw badRequest(`Invalid ${field} date`);
    }
    // Date-only values name inclusive Jakarta business days, matching the
    // dashboard ranges; `to` ends at the next day's start.
    return field === 'to'
      ? { instant: new Date(dayStart.getTime() + 24 * 3_600_000), exclusive: true }
      : { instant: dayStart, exclusive: false };
  }
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw badRequest(`Invalid ${field} date`);
  }
  return { instant: date, exclusive: false };
}

export interface ListMyReportsOptions {
  readonly status?: string | readonly string[] | undefined;
  readonly categoryId?: string | undefined;
  readonly locationId?: string | undefined;
  readonly priority?: string | undefined;
  readonly from?: string | Date | undefined;
  readonly to?: string | Date | undefined;
  readonly limit?: number | undefined;
  readonly offset?: number | undefined;
  readonly sort?: string | undefined;
}

export interface ListAllReportsOptions extends ListMyReportsOptions {
  readonly reporterId?: string | undefined;
  readonly search?: string | undefined;
  // DAMAGE = reports on an asset; SERVICE = asset-less service reports.
  readonly reportKind?: string | undefined;
}

export const REPORT_KIND_FILTER = ['DAMAGE', 'SERVICE'] as const;
export type ReportKindFilter = (typeof REPORT_KIND_FILTER)[number];

export interface ReportListResult {
  readonly items: schema.Report[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

// Shared filtered list: identical WHERE for the page query and the COUNT so
// `total` always matches the filter. All option validation throws (400)
// before the first query.
async function queryReportList(
  db: ReportQueryDb,
  filter: {
    readonly reporterId?: string | undefined;
    readonly status?: unknown;
    readonly categoryId?: unknown;
    readonly locationId?: unknown;
    readonly priority?: unknown;
    readonly from?: unknown;
    readonly to?: unknown;
    readonly search?: unknown;
    readonly reportKind?: unknown;
    // Campus list searches ticket + asset name + location name (reporter-safe
    // locations only); admin lists add description and include hidden/inactive
    // locations because UMPER must find lift rooms and archived assets too.
    readonly searchScope?: 'default' | 'campus' | 'admin' | undefined;
    readonly limit?: number | undefined;
    readonly offset?: number | undefined;
    readonly sort?: unknown;
  },
): Promise<ReportListResult> {
  const reporterId =
    filter.reporterId === undefined ? undefined : requireUuid(filter.reporterId, 'reporterId');
  const statuses = parseStatusFilter(filter.status);
  const categoryId = optionalUuid(filter.categoryId, 'categoryId');
  const locationId = optionalUuid(filter.locationId, 'locationId');
  const priority = parsePriorityFilter(filter.priority);
  const reportKind = parseReportKindFilter(filter.reportKind);
  const from = parseDateBound(filter.from, 'from');
  const to = parseDateBound(filter.to, 'to');
  const pattern = buildSearchPattern(filter.search);
  const sort = resolveReportSort(filter.sort);
  const page = normalizeListOptions({ limit: filter.limit, offset: filter.offset });

  const conditions = [];
  if (reporterId !== undefined) {
    conditions.push(eq(schema.maintenanceReports.reporterId, reporterId));
  }
  if (statuses !== undefined) {
    conditions.push(inArray(schema.maintenanceReports.status, statuses));
    if (statuses.includes('REPORTED')) {
      // Held-queue exclusion: rows auto-merged as SUPPORTING evidence at
      // submit are never verified (one verification per incident lives on
      // the target), so unclassified supporting-linked rows stay out of the
      // REPORTED queue. Other status filters and list-all views keep them
      // visible for audit.
      conditions.push(
        or(
          isNotNull(schema.maintenanceReports.finalCategoryId),
          sql`NOT EXISTS (SELECT 1 FROM report_relations rr WHERE rr.source_report_id = ${schema.maintenanceReports.id} AND rr.relation_type = 'SUPPORTING')`,
        ),
      );
    }
  }
  if (categoryId !== undefined) {
    // Verification may retarget the category, so the filter matches either.
    conditions.push(
      or(
        eq(schema.maintenanceReports.submittedCategoryId, categoryId),
        eq(schema.maintenanceReports.finalCategoryId, categoryId),
      ),
    );
  }
  if (locationId !== undefined) {
    conditions.push(eq(schema.maintenanceReports.locationId, locationId));
  }
  if (priority !== undefined) {
    conditions.push(eq(schema.maintenanceReports.finalPriority, priority));
  }
  if (reportKind !== undefined) {
    conditions.push(
      reportKind === 'DAMAGE'
        ? isNotNull(schema.maintenanceReports.assetId)
        : isNull(schema.maintenanceReports.assetId),
    );
  }
  if (from !== undefined) {
    conditions.push(gte(schema.maintenanceReports.reportedAt, from.instant));
  }
  if (to !== undefined) {
    conditions.push(
      to.exclusive
        ? lt(schema.maintenanceReports.reportedAt, to.instant)
        : lte(schema.maintenanceReports.reportedAt, to.instant),
    );
  }
  if (pattern !== null) {
    if (filter.searchScope === 'campus' || filter.searchScope === 'admin') {
      // Search follows the UI placeholder: ticket number, asset name, or
      // location name. The campus leg deliberately excludes hidden/inactive
      // locations so a reporter search cannot reveal lift rooms; the admin leg
      // has no such restriction (UMPER manages those locations).
      const locationScope =
        filter.searchScope === 'campus'
          ? sql`AND l.is_active = true AND l.reporter_hidden = false`
          : sql``;
      const parts = [
        ilike(schema.maintenanceReports.ticketNumber, pattern),
        sql`EXISTS (
            SELECT 1 FROM facility_assets fa
            WHERE fa.id = ${schema.maintenanceReports.assetId}
              AND fa.name ILIKE ${pattern}
          )`,
        sql`EXISTS (
            SELECT 1 FROM locations l
            WHERE l.id = ${schema.maintenanceReports.locationId}
              ${locationScope}
              AND l.name ILIKE ${pattern}
          )`,
      ];
      if (filter.searchScope === 'admin') {
        // Preserve the legacy admin description search in addition.
        parts.push(ilike(schema.maintenanceReports.description, pattern));
      }
      conditions.push(or(...parts));
    } else {
      conditions.push(
        or(
          ilike(schema.maintenanceReports.ticketNumber, pattern),
          ilike(schema.maintenanceReports.description, pattern),
        ),
      );
    }
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const items = await db
    .select()
    .from(schema.maintenanceReports)
    .where(where)
    .orderBy(...drizzleOrderBy(sort))
    .limit(page.limit)
    .offset(page.offset);
  const counted = await db.select({ value: count() }).from(schema.maintenanceReports).where(where);
  return { items, total: counted[0]?.value ?? 0, limit: page.limit, offset: page.offset };
}

// Reporter list: rows with `reporter_id = :reporterId` only — no
// cross-reporter leakage by construction.
export async function listMyReports(
  db: ReportQueryDb,
  reporterId: string,
  opts?: ListMyReportsOptions,
): Promise<ReportListResult> {
  return await queryReportList(db, { ...(opts ?? {}), reporterId });
}

// Admin list: same filters plus `reporterId?` and `search?`. The caller
// enforces the ADMIN role — this repo does not check roles.
export async function listAllReports(
  db: ReportQueryDb,
  opts?: ListAllReportsOptions,
): Promise<ReportListResult> {
  return await queryReportList(db, { ...(opts ?? {}) });
}

// ---------------------------------------------------------------------------
// Admin list projection (Figma "Kelola Laporan" 150:626).
// ---------------------------------------------------------------------------
//
// The table needs display labels the raw report row does not carry: asset
// name, location name (including hidden/inactive rooms — UMPER manages them),
// the currently assigned technician, and the verified reporter count. Names
// are joined here so the UI never resolves ids client-side. `statusCounts`
// feeds the status tabs: one grouped query over the same canonical status set
// and held-queue exclusion the list uses, so tab totals and filtered pages
// agree.

export interface AdminReportStatusCount {
  readonly status: schema.Report['status'];
  readonly count: number;
}

export interface AdminReportListItem extends schema.Report {
  readonly assetName: string | null;
  readonly locationName: string | null;
  /** Active assignment only (`unassigned_at IS NULL`); null before assignment. */
  readonly technicianName: string | null;
  /** `priority_factors.affectedReporters`; null for pre-scoring rows. */
  readonly reporterCount: number | null;
}

export interface AdminReportListResult {
  readonly items: AdminReportListItem[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
  readonly statusCounts: readonly AdminReportStatusCount[];
}

// Counts for the admin status tabs. Mirrors `getReportsByStatus` in
// `@silapor/analytics` (canonical statuses + held-queue exclusion for
// REPORTED) without pulling the analytics dashboard aggregates into the list.
export async function countReportsByStatus(
  db: ReportQueryDb,
): Promise<readonly AdminReportStatusCount[]> {
  const rows = await db
    .select({ status: schema.maintenanceReports.status, value: count() })
    .from(schema.maintenanceReports)
    .where(
      and(
        inArray(schema.maintenanceReports.status, [...REPORT_STATUS]),
        or(
          ne(schema.maintenanceReports.status, 'REPORTED'),
          isNotNull(schema.maintenanceReports.finalCategoryId),
          sql`NOT EXISTS (SELECT 1 FROM report_relations rr WHERE rr.source_report_id = ${schema.maintenanceReports.id} AND rr.relation_type = 'SUPPORTING')`,
        ),
      ),
    )
    .groupBy(schema.maintenanceReports.status);
  const counts = new Map(rows.map((row) => [row.status, row.value] as const));
  return REPORT_STATUS.map((status) => ({ status, count: counts.get(status) ?? 0 }));
}

// Enriched admin list. Search spans ticket number, description, asset name,
// and location name (all locations) so the page placeholder is accurate.
export async function listAdminReports(
  db: ReportQueryDb,
  opts?: ListAllReportsOptions,
): Promise<AdminReportListResult> {
  const [result, statusCounts] = await Promise.all([
    queryReportList(db, { ...(opts ?? {}), searchScope: 'admin' }),
    countReportsByStatus(db),
  ]);

  const rows = result.items;
  const reportIds = rows.map((row) => row.id);
  const assetIds = [
    ...new Set(rows.map((row) => row.assetId).filter((value): value is string => value !== null)),
  ];
  const locationIds = [...new Set(rows.map((row) => row.locationId))];

  const [assetRows, locationRows, assignmentRows] = await Promise.all([
    assetIds.length === 0
      ? Promise.resolve([] as Array<{ id: string; name: string }>)
      : db
          .select({ id: schema.facilityAssets.id, name: schema.facilityAssets.name })
          .from(schema.facilityAssets)
          .where(inArray(schema.facilityAssets.id, assetIds)),
    locationIds.length === 0
      ? Promise.resolve([] as Array<{ id: string; name: string }>)
      : db
          .select({ id: schema.locations.id, name: schema.locations.name })
          .from(schema.locations)
          .where(inArray(schema.locations.id, locationIds)),
    reportIds.length === 0
      ? Promise.resolve([] as Array<{ reportId: string; technicianName: string; assignedAt: Date }>)
      : db
          .select({
            reportId: schema.reportAssignments.reportId,
            technicianName: schema.technicians.displayName,
            assignedAt: schema.reportAssignments.assignedAt,
          })
          .from(schema.reportAssignments)
          .innerJoin(
            schema.technicians,
            eq(schema.technicians.id, schema.reportAssignments.technicianId),
          )
          .where(
            and(
              inArray(schema.reportAssignments.reportId, reportIds),
              isNull(schema.reportAssignments.unassignedAt),
            ),
          )
          .orderBy(desc(schema.reportAssignments.assignedAt)),
  ]);

  const assetNames = new Map(assetRows.map((row) => [row.id, row.name] as const));
  const locationNames = new Map(locationRows.map((row) => [row.id, row.name] as const));
  // Assignment rows are newest-first, so the first hit per report wins.
  const technicianNames = new Map<string, string>();
  for (const row of assignmentRows) {
    if (!technicianNames.has(row.reportId)) {
      technicianNames.set(row.reportId, row.technicianName);
    }
  }

  return {
    items: rows.map((row) => ({
      ...row,
      assetName: row.assetId === null ? null : (assetNames.get(row.assetId) ?? null),
      locationName: locationNames.get(row.locationId) ?? null,
      technicianName: technicianNames.get(row.id) ?? null,
      reporterCount: reporterCountOf(row.priorityFactors),
    })),
    total: result.total,
    limit: result.limit,
    offset: result.offset,
    statusCounts,
  };
}

export interface ListCampusReportsOptions extends ListMyReportsOptions {
  /** `true` = "Laporan Saya" filter; default is the whole campus. */
  readonly mine?: boolean | undefined;
  /** Campus search: ticket number, asset name, or location name. */
  readonly search?: string | undefined;
}

// Reporter-facing campus projection. Identity and audit-only fields never
// leave the repository: no reporterId, idempotencyKey, priority weights, or
// decider ids. Asset/location display names are joined server-side so the UI
// never has to leak a hidden location by resolving an id client-side.
export interface CampusReportListItem {
  readonly id: string;
  readonly ticketNumber: string;
  readonly status: schema.Report['status'];
  readonly locationId: string;
  readonly assetId: string | null;
  readonly assetName: string | null;
  // Name of the submitted category: the label for asset-less service reports,
  // where `assetName` is null.
  readonly submittedCategoryName: string | null;
  // Null when the location is inactive or reporterHidden (lift rooms).
  readonly locationName: string | null;
  readonly locationBuildingCode: string | null;
  readonly locationFloorNumber: number | null;
  readonly submittedCategoryId: string;
  readonly submittedIssueTypeId: string | null;
  readonly finalCategoryId: string | null;
  readonly finalIssueTypeId: string | null;
  readonly finalPriority: string | null;
  // Snapshot from priority_factors.affectedReporters (the verified impact
  // count). Null for rows created before the factor existed.
  readonly reporterCount: number | null;
  readonly reportedAt: Date;
  readonly resolvedAt: Date | null;
  readonly closedAt: Date | null;
  readonly isOwn: boolean;
}

export interface CampusReportListResult {
  readonly items: CampusReportListItem[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

function reporterCountOf(value: unknown): number | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const raw = (value as { readonly affectedReporters?: unknown }).affectedReporters;
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? raw : null;
}

function toCampusReportListItem(row: schema.Report, viewerId: string): CampusReportListItem {
  return {
    id: row.id,
    ticketNumber: row.ticketNumber,
    status: row.status,
    locationId: row.locationId,
    assetId: row.assetId,
    assetName: null,
    submittedCategoryName: null,
    locationName: null,
    locationBuildingCode: null,
    locationFloorNumber: null,
    submittedCategoryId: row.submittedCategoryId,
    submittedIssueTypeId: row.submittedIssueTypeId,
    finalCategoryId: row.finalCategoryId,
    finalIssueTypeId: row.finalIssueTypeId,
    finalPriority: row.finalPriority,
    reporterCount: reporterCountOf(row.priorityFactors),
    reportedAt: row.reportedAt,
    resolvedAt: row.resolvedAt,
    closedAt: row.closedAt,
    isOwn: row.reporterId === viewerId,
  };
}

// Campus-wide reporter list (UI No. 5). Every authenticated reporter sees
// all sanitized tickets; `mine=true` narrows to the viewer's own rows and
// `search` matches ticket number, asset name, or visible location name.
// The shared query keeps filters, deterministic ordering, and pagination
// identical to the reporter/admin lists.
export async function listCampusReports(
  db: ReportQueryDb,
  viewerId: string,
  opts?: ListCampusReportsOptions,
): Promise<CampusReportListResult> {
  const id = requireUuid(viewerId, 'viewerId');
  const { mine, search, ...base } = opts ?? {};
  const result = await queryReportList(db, {
    ...base,
    ...(search === undefined ? {} : { search }),
    searchScope: 'campus',
    ...(mine === true ? { reporterId: id } : {}),
  });

  const rows = result.items.map((row) => toCampusReportListItem(row, id));
  const assetIds = [
    ...new Set(rows.map((row) => row.assetId).filter((value): value is string => value !== null)),
  ];
  const locationIds = [...new Set(rows.map((row) => row.locationId))];
  const categoryIds = [...new Set(rows.map((row) => row.submittedCategoryId))];
  const assetRows =
    assetIds.length === 0
      ? []
      : await db
          .select({ id: schema.facilityAssets.id, name: schema.facilityAssets.name })
          .from(schema.facilityAssets)
          .where(inArray(schema.facilityAssets.id, assetIds));
  const categoryRows =
    categoryIds.length === 0
      ? []
      : await db
          .select({ id: schema.facilityCategories.id, name: schema.facilityCategories.name })
          .from(schema.facilityCategories)
          .where(inArray(schema.facilityCategories.id, categoryIds));
  const locationRows =
    locationIds.length === 0
      ? []
      : await db
          .select({
            id: schema.locations.id,
            name: schema.locations.name,
            buildingCode: schema.locations.buildingCode,
            floorNumber: schema.locations.floorNumber,
            isActive: schema.locations.isActive,
            reporterHidden: schema.locations.reporterHidden,
          })
          .from(schema.locations)
          .where(inArray(schema.locations.id, locationIds));
  const assetNames = new Map(assetRows.map((row) => [row.id, row.name] as const));
  const categoryNames = new Map(categoryRows.map((row) => [row.id, row.name] as const));
  const locationsById = new Map(locationRows.map((row) => [row.id, row] as const));

  return {
    items: rows.map((row) => {
      const location = locationsById.get(row.locationId);
      const visibleLocation =
        location !== undefined && location.isActive && !location.reporterHidden ? location : null;
      return {
        ...row,
        assetName: row.assetId === null ? null : (assetNames.get(row.assetId) ?? null),
        submittedCategoryName: categoryNames.get(row.submittedCategoryId) ?? null,
        locationName: visibleLocation?.name ?? null,
        locationBuildingCode: visibleLocation?.buildingCode ?? null,
        locationFloorNumber: visibleLocation?.floorNumber ?? null,
      };
    }),
    total: result.total,
    limit: result.limit,
    offset: result.offset,
  };
}

export interface CampusReportStats {
  readonly total: number;
  readonly active: number;
  readonly inRepair: number;
  readonly done: number;
  readonly mineTotal: number;
}

// KPI counters for the reporter landing page. Counts are campus-wide except
// `mineTotal` (the "Laporan Saya" tab). `active` follows the domain's open-work
// subset (RESOLVED is NOT active); `done` is RESOLVED + CLOSED.
export async function getCampusReportStats(
  db: ReportQueryDb,
  viewerId: string,
): Promise<CampusReportStats> {
  const id = requireUuid(viewerId, 'viewerId');
  const [totalRows, activeRows, inRepairRows, doneRows, mineRows] = await Promise.all([
    db.select({ value: count() }).from(schema.maintenanceReports),
    db
      .select({ value: count() })
      .from(schema.maintenanceReports)
      .where(inArray(schema.maintenanceReports.status, [...ACTIVE_REPORT_STATUSES])),
    db
      .select({ value: count() })
      .from(schema.maintenanceReports)
      .where(eq(schema.maintenanceReports.status, 'IN_REPAIR')),
    db
      .select({ value: count() })
      .from(schema.maintenanceReports)
      .where(inArray(schema.maintenanceReports.status, ['RESOLVED', 'CLOSED'])),
    db
      .select({ value: count() })
      .from(schema.maintenanceReports)
      .where(eq(schema.maintenanceReports.reporterId, id)),
  ]);
  return {
    total: totalRows[0]?.value ?? 0,
    active: activeRows[0]?.value ?? 0,
    inRepair: inRepairRows[0]?.value ?? 0,
    done: doneRows[0]?.value ?? 0,
    mineTotal: mineRows[0]?.value ?? 0,
  };
}

export interface CampusReport {
  readonly id: string;
  readonly ticketNumber: string;
  readonly status: schema.Report['status'];
  readonly locationId: string;
  readonly assetId: string | null;
  readonly submittedCategoryId: string;
  readonly submittedIssueTypeId: string | null;
  readonly finalCategoryId: string | null;
  readonly finalIssueTypeId: string | null;
  readonly description: string;
  readonly occurredAt: Date | null;
  readonly finalPriority: string | null;
  // Snapshot of the verified impact count (`priority_factors.affectedReporters`).
  // Null for rows created before the factor existed; the ticket detail renders
  // the "laporan mendukung" line only when a count is present.
  readonly reporterCount: number | null;
  readonly reportedAt: Date;
  readonly verifiedAt: Date | null;
  readonly resolvedAt: Date | null;
  readonly closedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface CampusReportRelation {
  readonly id: string;
  readonly sourceReportId: string;
  readonly targetReportId: string;
  readonly relationType: string;
  readonly createdAt: Date;
}

export interface CampusReportDetail {
  readonly report: CampusReport;
  readonly isOwn: boolean;
  readonly attachments: AttachmentSummary[];
  readonly events: schema.ReportEvent[];
  readonly relations: CampusReportRelation[];
  readonly duplicateCandidates: DuplicateCandidate[];
  // AI classifier confidence (0..1) from the latest analysis row. Non-PII
  // metadata; null when the report predates AI verification or the analysis
  // never completed. The detail page hides the confidence meter when null.
  readonly classificationConfidence: number | null;
  // Tickets grouped into the same incident via SUPPORTING/RELATED relations
  // (auto-merged at submit time for a different reporter). Sanitized to the
  // same public-safe fields as the campus list — never the reporter id.
  readonly relatedReports: CampusRelatedReport[];
}

export interface CampusRelatedReport {
  readonly id: string;
  readonly ticketNumber: string;
  readonly description: string;
  readonly status: string;
  readonly relationType: string;
  readonly reportedAt: Date;
}

function toCampusReport(row: schema.Report): CampusReport {
  return {
    id: row.id,
    ticketNumber: row.ticketNumber,
    status: row.status,
    locationId: row.locationId,
    assetId: row.assetId,
    submittedCategoryId: row.submittedCategoryId,
    submittedIssueTypeId: row.submittedIssueTypeId,
    finalCategoryId: row.finalCategoryId,
    finalIssueTypeId: row.finalIssueTypeId,
    description: row.description,
    occurredAt: row.occurredAt,
    finalPriority: row.finalPriority,
    reporterCount: reporterCountOf(row.priorityFactors),
    reportedAt: row.reportedAt,
    verifiedAt: row.verifiedAt,
    resolvedAt: row.resolvedAt,
    closedAt: row.closedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export interface ReportDetail {
  readonly report: schema.Report;
  // Public-safe projection only: id + display metadata + integrity fields.
  // NEVER `storageKey` (opaque internal key), `uploadedBy` (user id), or
  // `reportId` (redundant — the parent id is `report.id`). Mirrors the
  // `listAttachments` projection; bytes stay behind the authorized
  // download endpoint. No UI/consumer reads the dropped fields (reporter +
  // admin galleries use id/filename/mime/size via the download URL).
  readonly attachments: AttachmentSummary[];
  readonly events: schema.ReportEvent[];
  readonly relations: schema.ReportRelation[];
  readonly duplicateCandidates: DuplicateCandidate[];
}

export interface AdminReportDetail extends ReportDetail {
  /** Latest verifier row; null for rows created before AI analysis existed. */
  readonly aiAnalysis: schema.AiAnalysis | null;
}

async function loadReportDetail(db: ReportQueryDb, row: schema.Report): Promise<ReportDetail> {
  const attachments = await db
    .select({
      id: schema.reportAttachments.id,
      supporterId: schema.reportAttachments.supporterId,
      originalFilename: schema.reportAttachments.originalFilename,
      mimeType: schema.reportAttachments.mimeType,
      sizeBytes: schema.reportAttachments.sizeBytes,
      checksum: schema.reportAttachments.checksum,
      createdAt: schema.reportAttachments.createdAt,
    })
    .from(schema.reportAttachments)
    .where(eq(schema.reportAttachments.reportId, row.id))
    .orderBy(asc(schema.reportAttachments.createdAt), asc(schema.reportAttachments.id));
  const events = await db
    .select()
    .from(schema.reportEvents)
    .where(eq(schema.reportEvents.reportId, row.id))
    .orderBy(asc(schema.reportEvents.createdAt), asc(schema.reportEvents.id));
  const relations = await db
    .select()
    .from(schema.reportRelations)
    .where(
      or(
        eq(schema.reportRelations.sourceReportId, row.id),
        eq(schema.reportRelations.targetReportId, row.id),
      ),
    )
    .orderBy(asc(schema.reportRelations.createdAt), asc(schema.reportRelations.id));
  // Same-incident hint for readers: the row itself is excluded so it never
  // matches itself. Read-only here — submit-time auto-merge lives in
  // `createReport`.
  const duplicateCandidates = await findDuplicateCandidates(db, {
    reporterId: row.reporterId,
    assetId: row.assetId,
    locationId: row.locationId,
    categoryId: row.submittedCategoryId,
    issueTypeId: row.submittedIssueTypeId,
    excludeReportId: row.id,
  });
  return { report: row, attachments, events, relations, duplicateCandidates };
}

// Reporter detail: identical 404 when the row is missing OR belongs to
// another reporter (never reveal another reporter's ticket). Events are
// sanitized for reporter consumption: actorId is nulled, UUID-looking
// fromValue/toValue are nulled (status strings kept), all note text stays
// visible, and a LAPORAN_PALSU note is replaced with neutral text. Admin
// detail stays raw — see getAdminReportDetail.
function sanitizeDetailValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return UUID_RE.test(value) ? null : value;
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeDetailValue);
  }
  if (typeof value === 'object' && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out[key] = sanitizeDetailValue(entry);
    }
    return out;
  }
  return value;
}

function sanitizeReporterDetailEvent(event: schema.ReportEvent): schema.ReportEvent {
  const metadata = event.metadata;
  let nextMetadata = metadata;
  let eventType = event.eventType;
  if (metadata !== null && typeof metadata === 'object' && !Array.isArray(metadata)) {
    const rest = { ...(metadata as Record<string, unknown>) };
    if (rest['condition'] === 'LAPORAN_PALSU') {
      if ('note' in rest) {
        rest['note'] = LAPORAN_PALSU_NEUTRAL_MESSAGE;
      }
      delete rest['condition'];
    }
    // Drop the retired visibility marker from legacy event metadata.
    delete rest['visibility'];
    nextMetadata = rest;
  }
  // Legacy internal-note events are progress notes under the current rule.
  if (eventType === 'INTERNAL_NOTE_ADDED') {
    eventType = 'PROGRESS_NOTE_ADDED';
  }
  return {
    ...event,
    eventType,
    actorId: null,
    fromValue: sanitizeDetailValue(event.fromValue),
    toValue: sanitizeDetailValue(event.toValue),
    metadata: nextMetadata,
  };
}

export async function getMyReportDetail(
  db: ReportQueryDb,
  reporterId: string,
  reportId: string,
): Promise<ReportDetail> {
  requireUuid(reporterId, 'reporterId');
  const id = requireUuid(reportId, 'reportId');
  const rows = await db
    .select()
    .from(schema.maintenanceReports)
    .where(eq(schema.maintenanceReports.id, id));
  const row = rows[0];
  if (row === undefined || row.reporterId !== reporterId) {
    throw notFound('Report not found');
  }
  const detail = await loadReportDetail(db, row);
  const events = detail.events.map(sanitizeReporterDetailEvent);
  return { ...detail, events };
}

// Campus-wide reporter detail (UI No. 5). Another reporter's ticket is a
// normal 200 sanitized view — never a 404/403 existence oracle. Attachments
// are readable by every authenticated reporter (campus transparency), while
// duplicate candidates remain owner-only; events use the same reporter
// sanitization as the own-ticket path; relation `created_by` is omitted.
export async function getCampusReportDetail(
  db: ReportQueryDb,
  viewerId: string,
  reportId: string,
): Promise<CampusReportDetail> {
  const viewer = requireUuid(viewerId, 'viewerId');
  const id = requireUuid(reportId, 'reportId');
  const rows = await db
    .select()
    .from(schema.maintenanceReports)
    .where(eq(schema.maintenanceReports.id, id));
  const row = rows[0];
  if (row === undefined) {
    throw notFound('Report not found');
  }
  const isOwn = row.reporterId === viewer;
  const detail = await loadReportDetail(db, row);
  const events = detail.events.map(sanitizeReporterDetailEvent);
  const relations = detail.relations.map((relation) => ({
    id: relation.id,
    sourceReportId: relation.sourceReportId,
    targetReportId: relation.targetReportId,
    relationType: relation.relationType,
    createdAt: relation.createdAt,
  }));

  // Related tickets for the "laporan pendukung" block: the non-self endpoint
  // of each relation, read in one batch. Display fields only — descriptions
  // are already visible through the campus detail endpoint for every
  // authenticated reporter, and the reporter id never leaves the database.
  const relatedIds = [
    ...new Set(
      detail.relations.map((relation) =>
        relation.sourceReportId === row.id ? relation.targetReportId : relation.sourceReportId,
      ),
    ),
  ].filter((relatedId) => relatedId !== row.id);
  const relationTypeById = new Map(
    detail.relations.map(
      (relation) =>
        [
          relation.sourceReportId === row.id ? relation.targetReportId : relation.sourceReportId,
          relation.relationType,
        ] as const,
    ),
  );
  const relatedRows =
    relatedIds.length === 0
      ? []
      : await db
          .select({
            id: schema.maintenanceReports.id,
            ticketNumber: schema.maintenanceReports.ticketNumber,
            description: schema.maintenanceReports.description,
            status: schema.maintenanceReports.status,
            reportedAt: schema.maintenanceReports.reportedAt,
          })
          .from(schema.maintenanceReports)
          .where(inArray(schema.maintenanceReports.id, relatedIds))
          .orderBy(asc(schema.maintenanceReports.reportedAt), asc(schema.maintenanceReports.id));

  // Classifier confidence from the latest analysis row (0..1, nullable).
  const confidenceRows = await db
    .select({ confidence: schema.aiAnalyses.confidence })
    .from(schema.aiAnalyses)
    .where(eq(schema.aiAnalyses.reportId, id))
    .orderBy(desc(schema.aiAnalyses.createdAt))
    .limit(1);

  return {
    report: toCampusReport(row),
    isOwn,
    attachments: detail.attachments,
    events,
    relations,
    duplicateCandidates: isOwn ? detail.duplicateCandidates : [],
    classificationConfidence: confidenceRows[0]?.confidence ?? null,
    relatedReports: relatedRows.map((related) => ({
      id: related.id,
      ticketNumber: related.ticketNumber,
      description: related.description,
      status: related.status,
      relationType: relationTypeById.get(related.id) ?? 'RELATED',
      reportedAt: related.reportedAt,
    })),
  };
}

// Admin detail: same shape plus the latest AI verifier row, no ownership check
// (404 only when truly missing).
export async function getAdminReportDetail(
  db: ReportQueryDb,
  reportId: string,
): Promise<AdminReportDetail> {
  const id = requireUuid(reportId, 'reportId');
  const rows = await db
    .select()
    .from(schema.maintenanceReports)
    .where(eq(schema.maintenanceReports.id, id));
  const row = rows[0];
  if (row === undefined) {
    throw notFound('Report not found');
  }
  const detail = await loadReportDetail(db, row);
  const analyses = await db
    .select()
    .from(schema.aiAnalyses)
    .where(eq(schema.aiAnalyses.reportId, id))
    .orderBy(desc(schema.aiAnalyses.createdAt))
    .limit(1);
  return { ...detail, aiAnalysis: analyses[0] ?? null };
}

export interface ReportTimelineEntry {
  readonly type: string;
  readonly actorId: string | null;
  readonly fromValue: unknown;
  readonly toValue: unknown;
  readonly metadata: unknown;
  readonly createdAt: Date;
}

// Reporter event timeline: ownership check first (same 404 rule as detail),
// then event rows sanitized like the detail projection (all notes visible,
// actor ids null, LAPORAN_PALSU neutralized).
export async function getMyReportTimeline(
  db: ReportQueryDb,
  reporterId: string,
  reportId: string,
): Promise<ReportTimelineEntry[]> {
  requireUuid(reporterId, 'reporterId');
  const id = requireUuid(reportId, 'reportId');
  const rows = await db
    .select({ id: schema.maintenanceReports.id, reporterId: schema.maintenanceReports.reporterId })
    .from(schema.maintenanceReports)
    .where(eq(schema.maintenanceReports.id, id));
  const row = rows[0];
  if (row === undefined || row.reporterId !== reporterId) {
    throw notFound('Report not found');
  }
  const events = await db
    .select()
    .from(schema.reportEvents)
    .where(eq(schema.reportEvents.reportId, id))
    .orderBy(asc(schema.reportEvents.createdAt), asc(schema.reportEvents.id));
  return events.map(sanitizeReporterDetailEvent).map((event) => ({
    type: event.eventType,
    actorId: event.actorId,
    fromValue: event.fromValue,
    toValue: event.toValue,
    metadata: event.metadata,
    createdAt: event.createdAt,
  }));
}

export interface LinkSupportingReportInput {
  readonly sourceReportId: string;
  readonly targetReportId: string;
  readonly relationType: string;
  readonly createdBy: string;
}

// Admin supporting link: metadata only — changes neither report's status and
// creates no repair job. Duplicate triples → 409; the reverse triple is a
// distinct row (no auto-mirror) and stays allowed. Existence checks + insert
// run atomically inside a transaction when the handle supports it, so a
// report deleted mid-link cannot leave a half-checked insert; residual FK
// violations map to 404 alongside the 409 path, never raw.
export async function linkSupportingReport(
  db: ReportQueryDb,
  input: LinkSupportingReportInput,
): Promise<schema.ReportRelation> {
  if (typeof input !== 'object' || input === null) {
    throw badRequest('Invalid supporting-link input');
  }
  if (typeof input.relationType !== 'string' || !RELATION_TYPE_SET.has(input.relationType)) {
    throw badRequest('Invalid relation type');
  }
  const sourceId = requireUuid(input.sourceReportId, 'sourceReportId');
  const targetId = requireUuid(input.targetReportId, 'targetReportId');
  const createdBy = requireUuid(input.createdBy, 'createdBy');
  if (sourceId === targetId) {
    throw badRequest('A report cannot link to itself');
  }

  const run = async (conn: ReportQueryDb): Promise<schema.ReportRelation> => {
    const source = await conn
      .select({ id: schema.maintenanceReports.id })
      .from(schema.maintenanceReports)
      .where(eq(schema.maintenanceReports.id, sourceId));
    if (source.length === 0) {
      throw notFound('Report not found');
    }
    const target = await conn
      .select({ id: schema.maintenanceReports.id })
      .from(schema.maintenanceReports)
      .where(eq(schema.maintenanceReports.id, targetId));
    if (target.length === 0) {
      throw notFound('Report not found');
    }
    // Mirror the createReport reporter guard: UUID-shaped but nonexistent
    // (or inactive) link creators must 404/400, never surface raw FK 23503.
    const creator = (
      await conn.select().from(schema.users).where(eq(schema.users.id, createdBy))
    )[0];
    if (creator === undefined) {
      throw notFound('Link creator not found');
    }
    if (!creator.isActive) {
      throw badRequest('Link creator is inactive');
    }
    try {
      const inserted = await conn
        .insert(schema.reportRelations)
        .values({
          sourceReportId: sourceId,
          targetReportId: targetId,
          relationType: input.relationType,
          createdBy,
        })
        .returning();
      const row = inserted[0];
      if (row === undefined) {
        throw internal('Failed to create report link');
      }
      return row;
    } catch (error) {
      if (isAppError(error)) {
        throw error;
      }
      if (isUniqueViolation(error)) {
        throw conflict('Supporting link already exists');
      }
      if (isForeignKeyViolation(error)) {
        throw notFound('Referenced record not found');
      }
      throw internal('Failed to create report link');
    }
  };

  const maybeTx = (db as Partial<Database>)['transaction'];
  if (typeof maybeTx === 'function') {
    return await (db as Database).transaction(async (tx) => run(tx));
  }
  return await run(db);
}

export interface AffectedCountFilter {
  readonly assetId?: string | null | undefined;
  readonly locationId: string;
  readonly categoryId: string;
  readonly issueTypeId?: string | null | undefined;
}

// Distinct reporters over active incident rows + attached `report_supporters`
// PLUS reporters (and supporters) of rows linked via `report_relations` (one
// hop). Same-reporter rows collapse to one; non-active rows contribute nothing
// unless linked to an active match.
export async function countAffectedReporters(
  db: ReportQueryDb,
  filter: AffectedCountFilter,
): Promise<number> {
  if (typeof filter !== 'object' || filter === null) {
    throw badRequest('Invalid affected-count filter');
  }
  const locationId = requireUuid(filter.locationId, 'locationId');
  const categoryId = requireUuid(filter.categoryId, 'categoryId');
  const assetId =
    filter.assetId === undefined || filter.assetId === null
      ? filter.assetId
      : requireUuid(filter.assetId, 'assetId');
  const issueTypeId =
    filter.issueTypeId === undefined || filter.issueTypeId === null
      ? filter.issueTypeId
      : requireUuid(filter.issueTypeId, 'issueTypeId');

  const scope =
    assetId !== undefined && assetId !== null
      ? sql`${schema.maintenanceReports.assetId} IS NOT DISTINCT FROM ${assetId}`
      : and(
          eq(schema.maintenanceReports.locationId, locationId),
          isNull(schema.maintenanceReports.assetId),
        );
  const conditions = [
    inArray(schema.maintenanceReports.status, [...ACTIVE_REPORT_STATUSES]),
    scope,
    or(
      eq(schema.maintenanceReports.submittedCategoryId, categoryId),
      eq(schema.maintenanceReports.finalCategoryId, categoryId),
    ),
  ];
  if (issueTypeId === null) {
    conditions.push(isNull(schema.maintenanceReports.submittedIssueTypeId));
  } else if (issueTypeId !== undefined) {
    conditions.push(
      or(
        eq(schema.maintenanceReports.submittedIssueTypeId, issueTypeId),
        eq(schema.maintenanceReports.finalIssueTypeId, issueTypeId),
        and(
          isNull(schema.maintenanceReports.submittedIssueTypeId),
          isNull(schema.maintenanceReports.finalIssueTypeId),
        ),
      ),
    );
  }

  const matched = await db
    .select({
      id: schema.maintenanceReports.id,
      reporterId: schema.maintenanceReports.reporterId,
    })
    .from(schema.maintenanceReports)
    .where(and(...conditions));
  if (matched.length === 0) {
    return 0;
  }
  const reporters = new Set(matched.map((row) => row.reporterId));
  const matchedIds = matched.map((row) => row.id);
  const supporterRows = await db
    .select({ reporterId: schema.reportSupporters.reporterId })
    .from(schema.reportSupporters)
    .where(inArray(schema.reportSupporters.reportId, matchedIds));
  for (const supporter of supporterRows) {
    reporters.add(supporter.reporterId);
  }

  const matchedSet = new Set(matchedIds);
  const links = await db
    .select({
      sourceReportId: schema.reportRelations.sourceReportId,
      targetReportId: schema.reportRelations.targetReportId,
    })
    .from(schema.reportRelations)
    .where(
      or(
        inArray(schema.reportRelations.sourceReportId, matchedIds),
        inArray(schema.reportRelations.targetReportId, matchedIds),
      ),
    );
  const neighborIds = new Set<string>();
  for (const link of links) {
    if (!matchedSet.has(link.sourceReportId)) {
      neighborIds.add(link.sourceReportId);
    }
    if (!matchedSet.has(link.targetReportId)) {
      neighborIds.add(link.targetReportId);
    }
  }
  if (neighborIds.size > 0) {
    const neighborIdList = [...neighborIds];
    const neighbors = await db
      .select({ reporterId: schema.maintenanceReports.reporterId })
      .from(schema.maintenanceReports)
      .where(inArray(schema.maintenanceReports.id, neighborIdList));
    for (const neighbor of neighbors) {
      reporters.add(neighbor.reporterId);
    }
    const neighborSupporters = await db
      .select({ reporterId: schema.reportSupporters.reporterId })
      .from(schema.reportSupporters)
      .where(inArray(schema.reportSupporters.reportId, neighborIdList));
    for (const supporter of neighborSupporters) {
      reporters.add(supporter.reporterId);
    }
  }
  return reporters.size;
}
