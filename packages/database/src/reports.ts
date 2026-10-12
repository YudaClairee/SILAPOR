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

import { and, desc, eq, gte, inArray, ne, or, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import {
  badRequest,
  internal,
  isAppError,
  notFound,
} from '@silapor/shared';
import {
  ACTIVE_REPORT_STATUSES,
  DUPLICATE_LOOKBACK_DAYS,
  formatTicketNumber,
} from '@silapor/domain';
import * as schema from './schema.js';

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

function candidateConditions(
  filter: DuplicateCandidateFilter,
  since: Date | null,
): ReturnType<typeof and> {
  const scope =
    filter.assetId !== undefined && filter.assetId !== null
      ? sql`${schema.maintenanceReports.assetId} IS NOT DISTINCT FROM ${filter.assetId}`
      : eq(schema.maintenanceReports.locationId, filter.locationId);
  const conditions = [
    eq(schema.maintenanceReports.reporterId, filter.reporterId),
    inArray(schema.maintenanceReports.status, [...ACTIVE_REPORT_STATUSES]),
    scope,
    or(
      eq(schema.maintenanceReports.submittedCategoryId, filter.categoryId),
      eq(schema.maintenanceReports.finalCategoryId, filter.categoryId),
    ),
    sql`${schema.maintenanceReports.submittedIssueTypeId} IS NOT DISTINCT FROM ${filter.issueTypeId ?? null}`,
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
function isUniqueViolation(error: unknown): boolean {
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
    if (isAppError(error)) {
      throw error;
    }
    if (isUniqueViolation(error)) {
      const winner = await findReportByKey(db, key);
      if (winner !== undefined) {
        const replayCandidates = await findDuplicateCandidates(db, toFilterInput(winner));
        return { report: winner, duplicateCandidates: replayCandidates, idempotentReplay: true };
      }
    }
    throw error;
  }
}
