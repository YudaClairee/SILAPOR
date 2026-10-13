// Report creation transaction + duplicate-candidate search (Phase 3 P3-2).
//
// `createReport` mints exactly one ticket per idempotency key in a single
// `db.transaction`: ticket counter → maintenance_reports row (REPORTED) →
// append-only REPORT_CREATED report_events row → PENDING AI_REVIEW_REQUESTED
// outbox_events row. It NEVER calls AI, NEVER auto-marks DUPLICATE, and NEVER
// auto-links relations — it only returns `duplicateCandidates` as a warning
// alongside the created (or replayed) report for the caller to surface.
//
// Errors use `AppError` from `@silapor/shared` (400 validation, 404 missing
// reference, 409 mapped to idempotent replay on a key race). This module logs
// nothing and carries no PII in messages.

import { and, asc, count, desc, eq, gte, ilike, inArray, lte, ne, or, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  badRequest,
  conflict,
  internal,
  isAppError,
  notFound,
} from '@silapor/shared';
import {
  ACTIVE_REPORT_STATUSES,
  DUPLICATE_LOOKBACK_DAYS,
  RELATION_TYPE,
  REPORT_STATUS,
  formatTicketNumber,
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
// Pure input validation (no I/O; FK existence is checked by `createReport`).
// ---------------------------------------------------------------------------

export interface CreateReportInput {
  readonly reporterId: string;
  readonly locationId: string;
  readonly assetId?: string | null | undefined;
  readonly submittedCategoryId: string;
  readonly submittedIssueTypeId?: string | null | undefined;
  readonly description: string;
  readonly occurredAt?: string | Date | null | undefined;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function checkRequiredUuid(
  record: Record<string, unknown>,
  field: string,
  errors: string[],
): void {
  const value = record[field];
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    errors.push(`${field} must be a valid UUID`);
  }
}

function checkOptionalUuid(
  record: Record<string, unknown>,
  field: string,
  errors: string[],
): void {
  const value = record[field];
  if (value === undefined || value === null) {
    return;
  }
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    errors.push(`${field} must be a valid UUID or null`);
  }
}

// Shape-only checks. Cross-consistency (issue-type/category, asset/category)
// needs database rows and lives in `createReport`, not here.
export function validateCreateReportInput(input: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(input)) {
    return ['input must be an object'];
  }
  checkRequiredUuid(input, 'reporterId', errors);
  checkRequiredUuid(input, 'locationId', errors);
  checkRequiredUuid(input, 'submittedCategoryId', errors);
  checkOptionalUuid(input, 'assetId', errors);
  checkOptionalUuid(input, 'submittedIssueTypeId', errors);

  const description = input['description'];
  if (typeof description !== 'string' || description.trim().length < 10) {
    errors.push('description must be at least 10 characters');
  } else if (description.trim().length > 2000) {
    errors.push('description must be at most 2000 characters');
  }

  const occurredAt = input['occurredAt'];
  if (occurredAt !== undefined && occurredAt !== null) {
    const date =
      occurredAt instanceof Date ? occurredAt : new Date(String(occurredAt));
    if (Number.isNaN(date.getTime())) {
      errors.push('occurredAt must be a valid date or null');
    } else if (date.getTime() > Date.now()) {
      errors.push('occurredAt must not be in the future');
    }
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

// Incident-matching core shared by `findDuplicateCandidates` (P3-2, same
// reporter) and `countAffectedReporters` (P3-3, all reporters): ACTIVE statuses
// only, same asset/location scope, same submitted-or-final category, same
// issue type (null-safe). Single definition — callers only add their own
// extra conditions (reporter, lookback, exclusion) around it.
interface IncidentScope {
  readonly assetId?: string | null | undefined;
  readonly locationId: string;
  readonly categoryId: string;
  readonly issueTypeId?: string | null | undefined;
}

function incidentConditions(filter: IncidentScope) {
  const scope =
    filter.assetId !== undefined && filter.assetId !== null
      ? sql`${schema.maintenanceReports.assetId} IS NOT DISTINCT FROM ${filter.assetId}`
      : eq(schema.maintenanceReports.locationId, filter.locationId);
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
// match. Terminal rows (CLOSED/REJECTED/DUPLICATE/RESOLVED) and other
// reporters' rows are never returned.
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

export interface CreateReportResult {
  readonly report: schema.Report;
  readonly duplicateCandidates: DuplicateCandidate[];
  readonly idempotentReplay: boolean;
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
      (current.message.includes('foreign key') ||
        current.message.includes('violates foreign key'))
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

async function findReportByKey(
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
  // original ticket even when the retried payload drifted (e.g. edited
  // description). The in-transaction lookup below still covers the race
  // where the key lands between this fast-path check and the transaction.
  const fastReplay = await findReportByKey(db, key);
  if (fastReplay !== undefined) {
    const replayCandidates = await findDuplicateCandidates(db, toFilterInput(fastReplay));
    return { report: fastReplay, duplicateCandidates: replayCandidates, idempotentReplay: true };
  }

  const shapeErrors = validateCreateReportInput(input);
  if (shapeErrors.length > 0) {
    throw badRequest(`Invalid report input: ${shapeErrors.join('; ')}`);
  }

  try {
    return await db.transaction(async (tx) => {
      // Same-key retry: return the existing row with NO new ticket/event/job.
      const existing = await findReportByKey(tx, key);
      if (existing !== undefined) {
        const replayCandidates = await findDuplicateCandidates(tx, toFilterInput(existing));
        return { report: existing, duplicateCandidates: replayCandidates, idempotentReplay: true };
      }

      // Referenced rows must exist AND be active.
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
        await tx
          .select()
          .from(schema.locations)
          .where(eq(schema.locations.id, input.locationId))
      )[0];
      if (location === undefined) {
        throw notFound('Location not found');
      }
      if (!location.isActive) {
        throw badRequest('Location is inactive');
      }
      const category = (
        await tx
          .select()
          .from(schema.facilityCategories)
          .where(eq(schema.facilityCategories.id, input.submittedCategoryId))
      )[0];
      if (category === undefined) {
        throw notFound('Category not found');
      }
      if (!category.isActive) {
        throw badRequest('Category is inactive');
      }

      if (input.submittedIssueTypeId !== undefined && input.submittedIssueTypeId !== null) {
        const issueType = (
          await tx
            .select()
            .from(schema.issueTypes)
            .where(eq(schema.issueTypes.id, input.submittedIssueTypeId))
        )[0];
        if (issueType === undefined) {
          throw notFound('Issue type not found');
        }
        if (!issueType.isActive) {
          throw badRequest('Issue type is inactive');
        }
        if (issueType.categoryId !== null && issueType.categoryId !== input.submittedCategoryId) {
          throw badRequest('Issue type does not belong to the submitted category');
        }
      }

      if (input.assetId !== undefined && input.assetId !== null) {
        const asset = (
          await tx
            .select()
            .from(schema.facilityAssets)
            .where(eq(schema.facilityAssets.id, input.assetId))
        )[0];
        if (asset === undefined) {
          throw notFound('Asset not found');
        }
        if (!asset.isActive) {
          throw badRequest('Asset is inactive');
        }
        if (asset.categoryId !== input.submittedCategoryId) {
          throw badRequest('Asset does not belong to the submitted category');
        }
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

      const occurredAt =
        input.occurredAt === undefined || input.occurredAt === null
          ? null
          : input.occurredAt instanceof Date
            ? input.occurredAt
            : new Date(String(input.occurredAt));

      const inserted = await tx
        .insert(schema.maintenanceReports)
        .values({
          ticketNumber,
          idempotencyKey: key,
          reporterId: input.reporterId,
          locationId: input.locationId,
          assetId: input.assetId ?? null,
          submittedCategoryId: input.submittedCategoryId,
          submittedIssueTypeId: input.submittedIssueTypeId ?? null,
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

      // Warning only: the new row is excluded from its own candidate list,
      // nothing is auto-marked DUPLICATE and nothing is auto-linked.
      const duplicateCandidates = await findDuplicateCandidates(tx, toFilterInput(report));
      return { report, duplicateCandidates, idempotentReplay: false };
    });
  } catch (error) {
    // Concurrent same-key race: the unique constraint let exactly one
    // transaction win; the loser replays the winner instead of 409ing.
    // Residual failures NEVER escape raw (SQL/PII leak risk): known FK
    // violations map to 404, everything else to a generic 500.
    if (isAppError(error)) {
      throw error;
    }
    if (isUniqueViolation(error)) {
      const winner = await findReportByKey(db, key);
      if (winner !== undefined) {
        const replayCandidates = await findDuplicateCandidates(db, toFilterInput(winner));
        return { report: winner, duplicateCandidates: replayCandidates, idempotentReplay: true };
      }
      throw internal('Failed to create report');
    }
    if (isForeignKeyViolation(error)) {
      throw notFound('Referenced record not found');
    }
    throw internal('Failed to create report');
  }
}

// ---------------------------------------------------------------------------
// P3-3 report queries + supporting links.
//
// Reporter read paths (`listMyReports`, `getMyReportDetail`,
// `getMyReportTimeline`) take `reporterId` and filter by it — that IS the
// enforcement (the repo performs no role checks; callers own ADMIN gating).
// `getMy*` returns an identical 404 for missing vs foreign rows so existence
// of another reporter's ticket is never revealed. Admin paths
// (`listAllReports`, `getAdminReportDetail`) add reporter/search filters and
// skip ownership. `linkSupportingReport` is metadata only: no status change,
// no repair job. `countAffectedReporters` counts DISTINCT reporters over the
// shared incident predicate above plus one hop of SUPPORTING/RELATED links.
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
] as const;

export type ReportSort = (typeof REPORT_SORTS)[number];

export interface ReportOrderSpec {
  readonly column: 'reportedAt' | 'ticketNumber' | 'id';
  readonly direction: 'asc' | 'desc';
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
  const escaped = query
    .replace(/\\/g, '\\\\')
    .replace(/%/g, '\\%')
    .replace(/_/g, '\\_');
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

function parsePriorityFilter(priority: unknown): string | undefined {
  if (priority === undefined || priority === null) {
    return undefined;
  }
  if (typeof priority !== 'string' || !PRIORITY_SET.has(priority)) {
    throw badRequest('Invalid report priority filter');
  }
  return priority;
}

function parseDateBound(value: unknown, field: string): Date | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) {
    throw badRequest(`Invalid ${field} date`);
  }
  return date;
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
}

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
  if (from !== undefined) {
    conditions.push(gte(schema.maintenanceReports.reportedAt, from));
  }
  if (to !== undefined) {
    conditions.push(lte(schema.maintenanceReports.reportedAt, to));
  }
  if (pattern !== null) {
    conditions.push(
      or(
        ilike(schema.maintenanceReports.ticketNumber, pattern),
        ilike(schema.maintenanceReports.description, pattern),
      ),
    );
  }
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const items = await db
    .select()
    .from(schema.maintenanceReports)
    .where(where)
    .orderBy(...drizzleOrderBy(sort))
    .limit(page.limit)
    .offset(page.offset);
  const counted = await db
    .select({ value: count() })
    .from(schema.maintenanceReports)
    .where(where);
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

async function loadReportDetail(
  db: ReportQueryDb,
  row: schema.Report,
): Promise<ReportDetail> {
  const attachments = await db
    .select({
      id: schema.reportAttachments.id,
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
  // Warning only (same contract as createReport): the row itself is excluded
  // so it never matches itself; nothing is auto-marked or auto-linked.
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
// sanitized for reporter consumption (P5-5 fix): INTERNAL_NOTE_ADDED rows
// are excluded entirely; remaining rows ship with actorId=null,
// metadata.note stripped except for public resolution notes
// (REPORT_RESOLVED, or STATUS_CHANGED→RESOLVED which carries the public
// RESOLVED note), and UUID-looking fromValue/toValue nulled (status
// strings kept). Admin detail stays full — see getAdminReportDetail.
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
  const keepsNote =
    event.eventType === 'REPORT_RESOLVED' || (event.eventType === 'STATUS_CHANGED' && event.toValue === 'RESOLVED');
  let metadata = event.metadata;
  if (
    !keepsNote &&
    metadata !== null &&
    typeof metadata === 'object' &&
    !Array.isArray(metadata)
  ) {
    const rest = { ...(metadata as Record<string, unknown>) };
    delete rest['note'];
    metadata = rest;
  }
  return {
    ...event,
    actorId: null,
    fromValue: sanitizeDetailValue(event.fromValue),
    toValue: sanitizeDetailValue(event.toValue),
    metadata,
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
  const events = detail.events
    .filter((event) => event.eventType !== 'INTERNAL_NOTE_ADDED')
    .map(sanitizeReporterDetailEvent);
  return { ...detail, events };
}

// Admin detail: same shape, no ownership check (404 only when truly missing).
export async function getAdminReportDetail(
  db: ReportQueryDb,
  reportId: string,
): Promise<ReportDetail> {
  const id = requireUuid(reportId, 'reportId');
  const rows = await db
    .select()
    .from(schema.maintenanceReports)
    .where(eq(schema.maintenanceReports.id, id));
  const row = rows[0];
  if (row === undefined) {
    throw notFound('Report not found');
  }
  return await loadReportDetail(db, row);
}

export interface ReportTimelineEntry {
  readonly type: string;
  readonly actorId: string | null;
  readonly fromValue: unknown;
  readonly toValue: unknown;
  readonly metadata: unknown;
  readonly createdAt: Date;
}

// Reporter timeline: ownership check first (same 404 rule as detail), then
// the raw `report_events` rows chronologically. Public/internal note
// separation lands in Phase 5 — sanitization happens at the service layer.
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
  return events.map((event) => ({
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

// Distinct reporters over the shared incident predicate (ACTIVE statuses
// only) PLUS reporters of rows linked as SUPPORTING/RELATED source/target of
// those matches (one hop). DISTINCT collapses same-reporter DUPLICATE rows
// to one; terminal rows contribute nothing unless linked to an active match.
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
  const matched = await db
    .select({
      id: schema.maintenanceReports.id,
      reporterId: schema.maintenanceReports.reporterId,
    })
    .from(schema.maintenanceReports)
    .where(and(...incidentConditions({ assetId, locationId, categoryId, issueTypeId })));
  if (matched.length === 0) {
    return 0;
  }
  const reporters = new Set(matched.map((row) => row.reporterId));
  const matchedIds = matched.map((row) => row.id);
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
    const neighbors = await db
      .select({ reporterId: schema.maintenanceReports.reporterId })
      .from(schema.maintenanceReports)
      .where(inArray(schema.maintenanceReports.id, [...neighborIds]));
    for (const neighbor of neighbors) {
      reporters.add(neighbor.reporterId);
    }
  }
  return reporters.size;
}
