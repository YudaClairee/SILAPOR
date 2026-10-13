// Admin workflow core (Phase 5 P5-3): verify / reject / mark-duplicate /
// set-final-priority mutations with optimistic locking.
//
// Every mutation runs atomically inside one `db.transaction`: the guarded
// status update (WHERE id AND version) + append-only report_events rows +
// audit_logs row + PENDING outbox_events row. The WHERE-version guard makes
// concurrent admin writes fail with 409 instead of last-writer-wins, and the
// pre-transaction version check in `withReportLock` fails fast before any
// write. This module logs nothing and carries no PII in messages.

import { and, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { badRequest, conflict, internal, notFound } from '@silapor/shared';
import {
  ACTIVE_REPORT_STATUSES,
  canTransition,
  PRIORITY_LEVELS,
  scorePriority,
  SCORING_CONFIG_VERSION,
  type PriorityLevel,
} from '@silapor/domain';
import * as schema from './schema.js';
import { countAffectedReporters } from './reports.js';

type Database = PostgresJsDatabase<typeof schema>;

// Transaction client handed to `db.transaction` callbacks (select/insert/
// update only — no nested transactions). Mirrors the derivation in
// reports.ts; structurally identical so `countAffectedReporters` accepts it.
type WorkflowTx = Parameters<Parameters<Database['transaction']>[0]>[0];

export interface WorkflowActor {
  readonly actorId: string;
  readonly requestId?: string | null | undefined;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const PRIORITY_SET: ReadonlySet<string> = new Set(PRIORITY_LEVELS);

// Statuses that may receive a post-verification priority change. REPORTED
// (unscored), REJECTED / DUPLICATE / CLOSED (terminal) are excluded.
const PRIORITY_EDITABLE_STATUSES: ReadonlySet<string> = new Set([
  'VERIFIED',
  'ASSIGNED',
  'INSPECTION',
  'IN_REPAIR',
  'RESOLVED',
]);

// Duplicate targets must stay actionable: active work plus RESOLVED.
// CLOSED / REJECTED / DUPLICATE can never absorb another report.
const DUPLICATE_TARGET_STATUSES: ReadonlySet<string> = new Set([
  ...ACTIVE_REPORT_STATUSES,
  'RESOLVED',
]);

function requireUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    throw badRequest(`${field} must be a valid UUID`);
  }
  return value;
}

function requirePriority(value: unknown): PriorityLevel {
  if (typeof value !== 'string' || !PRIORITY_SET.has(value)) {
    throw badRequest('Invalid final priority');
  }
  return value as PriorityLevel;
}

function requireReason(value: unknown, message: string): string {
  if (typeof value !== 'string' || value.trim().length < 5) {
    throw badRequest(message);
  }
  return value.trim();
}

// ---------------------------------------------------------------------------
// Shared lock helper (exported for P5-4 assignment/update reuse).
// ---------------------------------------------------------------------------

// Loads the report, fails fast on a stale `expectedVersion` (409), validates
// the actor when one is given, then runs `fn` inside `db.transaction` so the
// caller's updates + event / audit / outbox inserts commit atomically. The
// caller MUST additionally guard its UPDATE with `WHERE id AND version` and
// map an empty returning set to 409 — the pre-check here cannot close the
// read/write race on its own.
export async function withReportLock<T>(
  db: Database,
  reportId: string,
  expectedVersion: number,
  fn: (tx: WorkflowTx, report: schema.Report) => Promise<T>,
  actor?: WorkflowActor | undefined,
): Promise<T> {
  const id = requireUuid(reportId, 'reportId');
  const rows = await db
    .select()
    .from(schema.maintenanceReports)
    .where(eq(schema.maintenanceReports.id, id));
  const report = rows[0];
  if (report === undefined) {
    throw notFound('Report not found');
  }
  if (report.version !== expectedVersion) {
    throw conflict('Report was modified by another admin; refresh and retry');
  }
  return await db.transaction(async (tx) => {
    if (actor !== undefined) {
      const actorId = requireUuid(actor.actorId, 'actorId');
      const found = (
        await tx.select().from(schema.users).where(eq(schema.users.id, actorId))
      )[0];
      if (found === undefined) {
        throw notFound('Actor not found');
      }
      if (!found.isActive) {
        throw badRequest('Actor is inactive');
      }
    }
    return await fn(tx, report);
  });
}

// ---------------------------------------------------------------------------
// Audit + outbox helpers (local; every workflow mutation uses both).
// ---------------------------------------------------------------------------

interface WorkflowAuditInput {
  readonly actorId: string;
  readonly requestId?: string | null | undefined;
  readonly action: string;
  readonly entityId: string;
  readonly before: unknown;
  readonly after: unknown;
}

async function buildWorkflowAudit(tx: WorkflowTx, input: WorkflowAuditInput): Promise<void> {
  await tx.insert(schema.auditLogs).values({
    actorId: input.actorId,
    requestId: input.requestId ?? null,
    action: input.action,
    entityType: 'maintenance_report',
    entityId: input.entityId,
    beforeData: input.before,
    afterData: input.after,
  });
}

interface WorkflowNotificationInput {
  readonly reportId: string;
  readonly ticketNumber: string;
  readonly kind: string;
  readonly actorId?: string | null | undefined;
}

async function queueWorkflowNotification(
  tx: WorkflowTx,
  input: WorkflowNotificationInput,
): Promise<void> {
  await tx.insert(schema.outboxEvents).values({
    type: 'WORKFLOW_NOTIFICATION',
    payload: {
      reportId: input.reportId,
      ticketNumber: input.ticketNumber,
      kind: input.kind,
      actorId: input.actorId ?? null,
    },
    status: 'PENDING',
  });
}

// ---------------------------------------------------------------------------
// verifyReport.
// ---------------------------------------------------------------------------

export interface VerifyReportInput {
  readonly finalCategoryId: string;
  readonly finalIssueTypeId: string;
  readonly assetId?: string | null | undefined;
  readonly locationId?: string | null | undefined;
  readonly finalPriority: PriorityLevel;
  readonly overrideReason?: string | null | undefined;
  readonly affectedReporters?: number | null | undefined;
}

function validateVerifyInputShape(input: VerifyReportInput): {
  readonly finalCategoryId: string;
  readonly finalIssueTypeId: string;
  readonly assetId: string | null | undefined;
  readonly locationId: string | null | undefined;
  readonly finalPriority: PriorityLevel;
} {
  if (typeof input !== 'object' || input === null) {
    throw badRequest('Invalid verification input');
  }
  const finalCategoryId = requireUuid(input.finalCategoryId, 'finalCategoryId');
  const finalIssueTypeId = requireUuid(input.finalIssueTypeId, 'finalIssueTypeId');
  const assetId =
    input.assetId === undefined || input.assetId === null
      ? input.assetId
      : requireUuid(input.assetId, 'assetId');
  const locationId =
    input.locationId === undefined || input.locationId === null
      ? input.locationId
      : requireUuid(input.locationId, 'locationId');
  const finalPriority = requirePriority(input.finalPriority);
  const affected = input.affectedReporters;
  if (affected !== undefined && affected !== null) {
    if (typeof affected !== 'number' || !Number.isFinite(affected) || affected < 0) {
      throw badRequest('affectedReporters must be a non-negative number or null');
    }
  }
  return { finalCategoryId, finalIssueTypeId, assetId, locationId, finalPriority };
}

export async function verifyReport(
  db: Database,
  reportId: string,
  input: VerifyReportInput,
  expectedVersion: number,
  actor: WorkflowActor,
): Promise<schema.Report> {
  // Pure shape checks first: no DB touched on malformed input.
  const shaped = validateVerifyInputShape(input);
  return await withReportLock(
    db,
    reportId,
    expectedVersion,
    async (tx, report) => {
      if (!canTransition('REPORTED', 'VERIFIED')) {
        throw internal('Report verification is not configured');
      }
      if (report.status !== 'REPORTED') {
        throw badRequest('Only REPORTED reports can be verified');
      }

      const category = (
        await tx
          .select()
          .from(schema.facilityCategories)
          .where(eq(schema.facilityCategories.id, shaped.finalCategoryId))
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
          .where(eq(schema.issueTypes.id, shaped.finalIssueTypeId))
      )[0];
      if (issueType === undefined) {
        throw notFound('Issue type not found');
      }
      if (!issueType.isActive) {
        throw badRequest('Issue type is inactive');
      }

      const effectiveAssetId = shaped.assetId ?? report.assetId;
      const effectiveLocationId = shaped.locationId ?? report.locationId;
      if (effectiveAssetId === null || effectiveAssetId === undefined) {
        throw badRequest('Asset is required for verification');
      }
      if (shaped.assetId !== undefined && shaped.assetId !== null) {
        const asset = (
          await tx
            .select()
            .from(schema.facilityAssets)
            .where(eq(schema.facilityAssets.id, shaped.assetId))
        )[0];
        if (asset === undefined) {
          throw notFound('Asset not found');
        }
        if (!asset.isActive) {
          throw badRequest('Asset is inactive');
        }
      }
      if (shaped.locationId !== undefined && shaped.locationId !== null) {
        const location = (
          await tx
            .select()
            .from(schema.locations)
            .where(eq(schema.locations.id, shaped.locationId))
        )[0];
        if (location === undefined) {
          throw notFound('Location not found');
        }
        if (!location.isActive) {
          throw badRequest('Location is inactive');
        }
      }

      // Scoring weights for the effective scope. Missing rows cannot happen
      // (FK restrict) but map to null weights instead of failing verification.
      const assetRow = (
        await tx
          .select({ weight: schema.facilityAssets.weight })
          .from(schema.facilityAssets)
          .where(eq(schema.facilityAssets.id, effectiveAssetId))
      )[0];
      const locationRow = (
        await tx
          .select({ tierScore: schema.locations.tierScore })
          .from(schema.locations)
          .where(eq(schema.locations.id, effectiveLocationId))
      )[0];

      // Reporter-frequency must never fail verification: on any counting
      // error fall back to a single reporter.
      let affected: number;
      if (input.affectedReporters !== undefined && input.affectedReporters !== null) {
        affected = input.affectedReporters;
      } else {
        try {
          affected = await countAffectedReporters(tx, {
            assetId: effectiveAssetId,
            locationId: effectiveLocationId,
            categoryId: shaped.finalCategoryId,
            issueTypeId: shaped.finalIssueTypeId,
          });
        } catch {
          affected = 1;
        }
      }

      const score = scorePriority({
        categoryWeight: category.weight,
        assetWeight: assetRow?.weight ?? null,
        locationScore: locationRow?.tierScore ?? null,
        affectedReporters: affected,
        issueTypeCode: issueType.code,
      });

      if (shaped.finalPriority !== score.suggestedPriority) {
        requireReason(
          input.overrideReason,
          'Priority override requires a reason (min 5 chars)',
        );
      }

      const now = new Date();
      const updated = await tx
        .update(schema.maintenanceReports)
        .set({
          status: 'VERIFIED',
          finalCategoryId: shaped.finalCategoryId,
          finalIssueTypeId: shaped.finalIssueTypeId,
          assetId: effectiveAssetId,
          locationId: effectiveLocationId,
          priorityScore: score.score,
          priorityFactors: { ...score.factors, scoringComplete: score.scoringComplete },
          finalPriority: shaped.finalPriority,
          priorityOverrideReason:
            typeof input.overrideReason === 'string' ? input.overrideReason.trim() : null,
          priorityDecidedBy: actor.actorId,
          priorityDecidedAt: now,
          scoringConfigVersion: SCORING_CONFIG_VERSION,
          verifiedAt: now,
          version: report.version + 1,
          updatedAt: now,
        })
        .where(
          and(
            eq(schema.maintenanceReports.id, report.id),
            eq(schema.maintenanceReports.version, expectedVersion),
          ),
        )
        .returning();
      const next = updated[0];
      if (next === undefined) {
        throw conflict('Report was modified by another admin; refresh and retry');
      }

      await tx.insert(schema.reportEvents).values([
        {
          reportId: report.id,
          eventType: 'REPORT_VERIFIED',
          actorId: actor.actorId,
          fromValue: 'REPORTED',
          toValue: 'VERIFIED',
          metadata: {
            finalCategoryId: shaped.finalCategoryId,
            finalIssueTypeId: shaped.finalIssueTypeId,
          },
        },
        {
          reportId: report.id,
          eventType: 'PRIORITY_CHANGED',
          actorId: actor.actorId,
          fromValue: report.finalPriority,
          toValue: shaped.finalPriority,
          metadata: {
            score: score.score,
            suggestedPriority: score.suggestedPriority,
            factors: score.factors,
            scoringComplete: score.scoringComplete,
            scoringConfigVersion: score.scoringConfigVersion,
          },
        },
      ]);
      await buildWorkflowAudit(tx, {
        actorId: actor.actorId,
        requestId: actor.requestId,
        action: 'REPORT_VERIFIED',
        entityId: report.id,
        before: report,
        after: next,
      });
      await queueWorkflowNotification(tx, {
        reportId: report.id,
        ticketNumber: report.ticketNumber,
        kind: 'REPORT_VERIFIED',
        actorId: actor.actorId,
      });
      return next;
    },
    actor,
  );
}

// ---------------------------------------------------------------------------
// rejectReport.
// ---------------------------------------------------------------------------

export async function rejectReport(
  db: Database,
  reportId: string,
  reason: string,
  expectedVersion: number,
  actor: WorkflowActor,
): Promise<schema.Report> {
  const cleanReason = requireReason(reason, 'Rejection reason must be at least 5 characters');
  return await withReportLock(
    db,
    reportId,
    expectedVersion,
    async (tx, report) => {
      if (!canTransition('REPORTED', 'REJECTED')) {
        throw internal('Report rejection is not configured');
      }
      if (report.status !== 'REPORTED') {
        throw badRequest('Only REPORTED reports can be rejected');
      }
      const now = new Date();
      const updated = await tx
        .update(schema.maintenanceReports)
        .set({ status: 'REJECTED', version: report.version + 1, updatedAt: now })
        .where(
          and(
            eq(schema.maintenanceReports.id, report.id),
            eq(schema.maintenanceReports.version, expectedVersion),
          ),
        )
        .returning();
      const next = updated[0];
      if (next === undefined) {
        throw conflict('Report was modified by another admin; refresh and retry');
      }
      await tx.insert(schema.reportEvents).values({
        reportId: report.id,
        eventType: 'STATUS_CHANGED',
        actorId: actor.actorId,
        fromValue: 'REPORTED',
        toValue: 'REJECTED',
        metadata: { reason: cleanReason },
      });
      await buildWorkflowAudit(tx, {
        actorId: actor.actorId,
        requestId: actor.requestId,
        action: 'REPORT_REJECTED',
        entityId: report.id,
        before: report,
        after: next,
      });
      await queueWorkflowNotification(tx, {
        reportId: report.id,
        ticketNumber: report.ticketNumber,
        kind: 'REPORT_REJECTED',
        actorId: actor.actorId,
      });
      return next;
    },
    actor,
  );
}

// ---------------------------------------------------------------------------
// markDuplicate.
// ---------------------------------------------------------------------------

export async function markDuplicate(
  db: Database,
  reportId: string,
  canonicalReportId: string,
  expectedVersion: number,
  actor: WorkflowActor,
): Promise<schema.Report> {
  const id = requireUuid(reportId, 'reportId');
  const canonicalId = requireUuid(canonicalReportId, 'canonicalReportId');
  if (id === canonicalId) {
    throw badRequest('A report cannot be a duplicate of itself');
  }
  return await withReportLock(
    db,
    id,
    expectedVersion,
    async (tx, report) => {
      if (!canTransition('REPORTED', 'DUPLICATE')) {
        throw internal('Duplicate marking is not configured');
      }
      if (report.status !== 'REPORTED') {
        throw badRequest('Only REPORTED reports can be marked as duplicate');
      }
      const canonical = (
        await tx
          .select()
          .from(schema.maintenanceReports)
          .where(eq(schema.maintenanceReports.id, canonicalId))
      )[0];
      if (canonical === undefined) {
        throw notFound('Canonical report not found');
      }
      if (!DUPLICATE_TARGET_STATUSES.has(canonical.status)) {
        throw badRequest('Canonical report must be active or resolved');
      }
      const now = new Date();
      const updated = await tx
        .update(schema.maintenanceReports)
        .set({
          status: 'DUPLICATE',
          duplicateOfReportId: canonicalId,
          version: report.version + 1,
          updatedAt: now,
        })
        .where(
          and(
            eq(schema.maintenanceReports.id, report.id),
            eq(schema.maintenanceReports.version, expectedVersion),
          ),
        )
        .returning();
      const next = updated[0];
      if (next === undefined) {
        throw conflict('Report was modified by another admin; refresh and retry');
      }
      await tx.insert(schema.reportEvents).values({
        reportId: report.id,
        eventType: 'STATUS_CHANGED',
        actorId: actor.actorId,
        fromValue: 'REPORTED',
        toValue: 'DUPLICATE',
        metadata: { canonicalReportId: canonicalId },
      });
      await buildWorkflowAudit(tx, {
        actorId: actor.actorId,
        requestId: actor.requestId,
        action: 'REPORT_MARKED_DUPLICATE',
        entityId: report.id,
        before: report,
        after: next,
      });
      await queueWorkflowNotification(tx, {
        reportId: report.id,
        ticketNumber: report.ticketNumber,
        kind: 'REPORT_MARKED_DUPLICATE',
        actorId: actor.actorId,
      });
      return next;
    },
    actor,
  );
}

// ---------------------------------------------------------------------------
// setFinalPriority.
// ---------------------------------------------------------------------------

export async function setFinalPriority(
  db: Database,
  reportId: string,
  priority: PriorityLevel,
  reason: string | null,
  expectedVersion: number,
  actor: WorkflowActor,
): Promise<schema.Report> {
  const nextPriority = requirePriority(priority);
  return await withReportLock(
    db,
    reportId,
    expectedVersion,
    async (tx, report) => {
      if (!PRIORITY_EDITABLE_STATUSES.has(report.status)) {
        throw badRequest('Priority can only be changed after verification');
      }
      // Idempotent no-op: same value returns the version-checked row WITHOUT
      // a version bump, event, audit, or outbox write.
      if (nextPriority === report.finalPriority) {
        return report;
      }
      const cleanReason = requireReason(
        reason,
        'Priority change requires a reason (min 5 chars)',
      );
      const now = new Date();
      const updated = await tx
        .update(schema.maintenanceReports)
        .set({
          finalPriority: nextPriority,
          priorityOverrideReason: cleanReason,
          priorityDecidedBy: actor.actorId,
          priorityDecidedAt: now,
          version: report.version + 1,
          updatedAt: now,
        })
        .where(
          and(
            eq(schema.maintenanceReports.id, report.id),
            eq(schema.maintenanceReports.version, expectedVersion),
          ),
        )
        .returning();
      const next = updated[0];
      if (next === undefined) {
        throw conflict('Report was modified by another admin; refresh and retry');
      }
      await tx.insert(schema.reportEvents).values({
        reportId: report.id,
        eventType: 'PRIORITY_CHANGED',
        actorId: actor.actorId,
        fromValue: report.finalPriority,
        toValue: nextPriority,
        metadata: { reason: cleanReason },
      });
      await buildWorkflowAudit(tx, {
        actorId: actor.actorId,
        requestId: actor.requestId,
        action: 'PRIORITY_CHANGED',
        entityId: report.id,
        before: report,
        after: next,
      });
      await queueWorkflowNotification(tx, {
        reportId: report.id,
        ticketNumber: report.ticketNumber,
        kind: 'PRIORITY_CHANGED',
        actorId: actor.actorId,
      });
      return next;
    },
    actor,
  );
}
