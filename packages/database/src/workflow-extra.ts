// Admin workflow extras (Phase 5 P5-4): assignment history, generic status
// transitions, public updates / internal notes, admin + reporter timelines.
//
// Every mutation reuses `withReportLock` from './workflow.js' — no forked
// locking logic. Each mutation runs atomically inside one `db.transaction`:
// the guarded report UPDATE (WHERE id AND version) + assignment/update rows +
// append-only report_events rows + audit_logs row + PENDING outbox_events row.
// The WHERE-version guard turns concurrent admin writes into 409 instead of
// last-writer-wins; the pre-transaction version check in `withReportLock`
// fails fast before any write. This module logs nothing and carries no PII
// in messages.
//
// Outbox choice: `addReportUpdate` ALWAYS queues a WORKFLOW_NOTIFICATION row
// (kind PUBLIC_UPDATE_ADDED or INTERNAL_NOTE_ADDED). Consumers (P5-5/6)
// filter INTERNAL kinds so reporters are never notified of internal notes —
// queueing uniformly keeps the producer simple and the outbox append-only.
// Timeline tiebreak: merged entries sort by `at` asc; ties resolve in the
// stable order events → updates → assignments → relations, then id asc.
// Reporter timeline: INTERNAL updates and INTERNAL_NOTE_ADDED events are
// excluded, and every entry's `actorId` is nulled (label text only) so no
// admin/technician PII leaks to reporters.

import { and, asc, eq, isNull, or } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { badRequest, conflict, notFound } from '@silapor/shared';
import {
  REPORT_STATUS,
  canTransition,
  requiresNote,
  type ReportStatus,
} from '@silapor/domain';
import * as schema from './schema.js';
import { withReportLock, type WorkflowActor } from './workflow.js';

type Database = PostgresJsDatabase<typeof schema>;

// Transaction client handed to `db.transaction` callbacks. Mirrors the
// derivation in workflow.ts / reports.ts.
type WorkflowExtraTx = Parameters<Parameters<Database['transaction']>[0]>[0];

export type { WorkflowActor };

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const REPORT_STATUS_SET: ReadonlySet<string> = new Set(REPORT_STATUS);

// Targets owned by verify/reject/duplicate — never via transitionReport.
const DELEGATED_TARGETS: ReadonlySet<string> = new Set([
  'VERIFIED',
  'REJECTED',
  'DUPLICATE',
]);

// Reassignment keeps the current status (no promotion).
const REASSIGNABLE_STATUSES: ReadonlySet<string> = new Set([
  'ASSIGNED',
  'INSPECTION',
  'IN_REPAIR',
]);

// Updates are closed-world denials: terminal reports accept no new notes.
const UPDATE_BLOCKED_STATUSES: ReadonlySet<string> = new Set([
  'CLOSED',
  'REJECTED',
  'DUPLICATE',
]);

const VISIBILITY_SET: ReadonlySet<string> = new Set(['PUBLIC', 'INTERNAL']);

function requireUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    throw badRequest(`${field} must be a valid UUID`);
  }
  return value;
}

function requireReportStatus(value: unknown): ReportStatus {
  if (typeof value !== 'string' || !REPORT_STATUS_SET.has(value)) {
    throw badRequest('Invalid report status');
  }
  return value as ReportStatus;
}

function requireVisibility(value: unknown): 'PUBLIC' | 'INTERNAL' {
  if (typeof value !== 'string' || !VISIBILITY_SET.has(value)) {
    throw badRequest('Invalid update visibility');
  }
  return value as 'PUBLIC' | 'INTERNAL';
}

// Trimmed 5–2000 char message; empty/whitespace is rejected (callers needing
// optional notes map empty to absent before calling).
function requireUpdateMessage(value: unknown): string {
  if (typeof value !== 'string') {
    throw badRequest('Update message must be 5-2000 characters');
  }
  const trimmed = value.trim();
  if (trimmed.length < 5 || trimmed.length > 2000) {
    throw badRequest('Update message must be 5-2000 characters');
  }
  return trimmed;
}

function normalizeOptionalReason(value: unknown): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw badRequest('Assignment reason must be a string or null');
  }
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

// ---------------------------------------------------------------------------
// Audit + outbox helpers (local mirrors of workflow.ts; every mutation here
// writes exactly one audit row and one PENDING outbox row).
// ---------------------------------------------------------------------------

interface ExtraAuditInput {
  readonly actorId: string;
  readonly requestId?: string | null | undefined;
  readonly action: string;
  readonly entityId: string;
  readonly before: unknown;
  readonly after: unknown;
}

async function buildExtraAudit(tx: WorkflowExtraTx, input: ExtraAuditInput): Promise<void> {
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

async function queueExtraNotification(
  tx: WorkflowExtraTx,
  input: {
    readonly reportId: string;
    readonly ticketNumber: string;
    readonly kind: string;
    readonly actorId?: string | null | undefined;
  },
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
// assignTechnician.
// ---------------------------------------------------------------------------

export async function assignTechnician(
  db: Database,
  reportId: string,
  technicianId: string,
  expectedVersion: number,
  actor: WorkflowActor,
  reason?: string | null | undefined,
): Promise<schema.Report> {
  // Pure shape checks first: no DB touched on malformed ids.
  requireUuid(reportId, 'reportId');
  requireUuid(technicianId, 'technicianId');
  const cleanReason = normalizeOptionalReason(reason);
  return await withReportLock(
    db,
    reportId,
    expectedVersion,
    async (tx, report) => {
      const technician = (
        await tx
          .select()
          .from(schema.technicians)
          .where(eq(schema.technicians.id, technicianId))
      )[0];
      if (technician === undefined) {
        throw notFound('Technician not found');
      }
      if (!technician.isActive) {
        throw badRequest('Technician is inactive');
      }

      let nextStatus: ReportStatus;
      if (report.status === 'VERIFIED') {
        if (!canTransition('VERIFIED', 'ASSIGNED')) {
          throw badRequest('Report cannot be assigned in status VERIFIED');
        }
        nextStatus = 'ASSIGNED';
      } else if (REASSIGNABLE_STATUSES.has(report.status)) {
        nextStatus = report.status as ReportStatus;
      } else {
        throw badRequest(`Report cannot be assigned in status ${report.status}`);
      }

      const active = await tx
        .select()
        .from(schema.reportAssignments)
        .where(
          and(
            eq(schema.reportAssignments.reportId, report.id),
            isNull(schema.reportAssignments.unassignedAt),
          ),
        );
      const prevTechnicianId: string | null =
        active.length > 0 && active[0] !== undefined ? active[0].technicianId : null;

      const now = new Date();
      if (active.length > 0) {
        await tx
          .update(schema.reportAssignments)
          .set({ unassignedAt: now })
          .where(
            and(
              eq(schema.reportAssignments.reportId, report.id),
              isNull(schema.reportAssignments.unassignedAt),
            ),
          );
      }

      // Always bump version (even on pure reassignment) so concurrent
      // assignments conflict with 409 instead of silently overwriting.
      const updated = await tx
        .update(schema.maintenanceReports)
        .set({ status: nextStatus, version: report.version + 1, updatedAt: now })
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

      await tx.insert(schema.reportAssignments).values({
        reportId: report.id,
        technicianId,
        assignedBy: actor.actorId,
        reason: cleanReason,
      });

      await tx.insert(schema.reportEvents).values({
        reportId: report.id,
        eventType: 'ASSIGNMENT_CHANGED',
        actorId: actor.actorId,
        fromValue: prevTechnicianId,
        toValue: technicianId,
        metadata: { technicianId, prevTechnicianId },
      });
      if (report.status === 'VERIFIED' && nextStatus === 'ASSIGNED') {
        await tx.insert(schema.reportEvents).values({
          reportId: report.id,
          eventType: 'STATUS_CHANGED',
          actorId: actor.actorId,
          fromValue: 'VERIFIED',
          toValue: 'ASSIGNED',
          metadata: { technicianId },
        });
      }

      await buildExtraAudit(tx, {
        actorId: actor.actorId,
        requestId: actor.requestId,
        action: 'ASSIGNMENT_CHANGED',
        entityId: report.id,
        before: report,
        after: next,
      });
      await queueExtraNotification(tx, {
        reportId: report.id,
        ticketNumber: report.ticketNumber,
        kind: 'REPORT_ASSIGNED',
        actorId: actor.actorId,
      });
      return next;
    },
    actor,
  );
}

// ---------------------------------------------------------------------------
// transitionReport.
// ---------------------------------------------------------------------------

export async function transitionReport(
  db: Database,
  reportId: string,
  nextStatus: ReportStatus,
  expectedVersion: number,
  actor: WorkflowActor,
  note?: string | null | undefined,
): Promise<schema.Report> {
  // Pure target checks first: no DB touched on malformed/delegated targets.
  const target = requireReportStatus(nextStatus);
  if (DELEGATED_TARGETS.has(target)) {
    throw badRequest('Use verifyReport/rejectReport/markDuplicate for this transition');
  }
  return await withReportLock(
    db,
    reportId,
    expectedVersion,
    async (tx, report) => {
      const from = report.status as ReportStatus;
      if (!canTransition(from, target)) {
        throw badRequest(`Invalid transition from ${from} to ${target}`);
      }

      let cleanNote: string | null = null;
      if (note !== undefined && note !== null) {
        if (typeof note !== 'string') {
          throw badRequest('A note is required for this transition (min 5 chars)');
        }
        const trimmed = note.trim();
        if (trimmed !== '') {
          if (trimmed.length < 5) {
            throw badRequest('A note is required for this transition (min 5 chars)');
          }
          if (trimmed.length > 2000) {
            throw badRequest('Transition note must be at most 2000 characters');
          }
          cleanNote = trimmed;
        }
      }
      if (requiresNote(from, target)) {
        if (cleanNote === null) {
          throw badRequest('A note is required for this transition (min 5 chars)');
        }
      }

      const now = new Date();
      const updated = await tx
        .update(schema.maintenanceReports)
        .set({
          status: target,
          version: report.version + 1,
          updatedAt: now,
          ...(target === 'RESOLVED' ? { resolvedAt: now } : {}),
          ...(target === 'CLOSED' ? { closedAt: now } : {}),
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

      // Notes persist as timeline updates: PUBLIC on RESOLVED (reporter
      // visible), INTERNAL otherwise.
      if (cleanNote !== null) {
        await tx.insert(schema.reportUpdates).values({
          reportId: report.id,
          authorId: actor.actorId,
          visibility: target === 'RESOLVED' ? 'PUBLIC' : 'INTERNAL',
          message: cleanNote,
        });
      }

      await tx.insert(schema.reportEvents).values({
        reportId: report.id,
        eventType: 'STATUS_CHANGED',
        actorId: actor.actorId,
        fromValue: from,
        toValue: target,
        metadata: cleanNote !== null ? { note: cleanNote } : {},
      });
      if (target === 'RESOLVED') {
        await tx.insert(schema.reportEvents).values({
          reportId: report.id,
          eventType: 'REPORT_RESOLVED',
          actorId: actor.actorId,
          fromValue: from,
          toValue: target,
        });
      } else if (target === 'CLOSED') {
        await tx.insert(schema.reportEvents).values({
          reportId: report.id,
          eventType: 'REPORT_CLOSED',
          actorId: actor.actorId,
          fromValue: from,
          toValue: target,
        });
      }

      await buildExtraAudit(tx, {
        actorId: actor.actorId,
        requestId: actor.requestId,
        action: 'STATUS_CHANGED',
        entityId: report.id,
        before: report,
        after: next,
      });
      await queueExtraNotification(tx, {
        reportId: report.id,
        ticketNumber: report.ticketNumber,
        kind: 'STATUS_CHANGED',
        actorId: actor.actorId,
      });
      return next;
    },
    actor,
  );
}

// ---------------------------------------------------------------------------
// addReportUpdate (+ wrappers).
// ---------------------------------------------------------------------------

export async function addReportUpdate(
  db: Database,
  reportId: string,
  visibility: 'PUBLIC' | 'INTERNAL',
  message: string,
  expectedVersion: number,
  actor: WorkflowActor,
): Promise<schema.ReportUpdate> {
  // Pure shape checks first: no DB touched on malformed input.
  const cleanVisibility = requireVisibility(visibility);
  const cleanMessage = requireUpdateMessage(message);
  return await withReportLock(
    db,
    reportId,
    expectedVersion,
    async (tx, report) => {
      if (UPDATE_BLOCKED_STATUSES.has(report.status)) {
        throw badRequest(`Report cannot be updated in status ${report.status}`);
      }
      const now = new Date();
      const updated = await tx
        .update(schema.maintenanceReports)
        .set({ version: report.version + 1, updatedAt: now })
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

      const inserted = await tx
        .insert(schema.reportUpdates)
        .values({
          reportId: report.id,
          authorId: actor.actorId,
          visibility: cleanVisibility,
          message: cleanMessage,
        })
        .returning();
      const row = inserted[0];
      if (row === undefined) {
        throw conflict('Report was modified by another admin; refresh and retry');
      }

      const eventType =
        cleanVisibility === 'PUBLIC' ? 'PUBLIC_UPDATE_ADDED' : 'INTERNAL_NOTE_ADDED';
      await tx.insert(schema.reportEvents).values({
        reportId: report.id,
        eventType,
        actorId: actor.actorId,
        metadata: { updateId: row.id, visibility: cleanVisibility },
      });
      await buildExtraAudit(tx, {
        actorId: actor.actorId,
        requestId: actor.requestId,
        action: eventType,
        entityId: report.id,
        before: report,
        after: next,
      });
      await queueExtraNotification(tx, {
        reportId: report.id,
        ticketNumber: report.ticketNumber,
        kind: eventType,
        actorId: actor.actorId,
      });
      return row;
    },
    actor,
  );
}

export async function addPublicUpdate(
  db: Database,
  reportId: string,
  message: string,
  expectedVersion: number,
  actor: WorkflowActor,
): Promise<schema.ReportUpdate> {
  return await addReportUpdate(db, reportId, 'PUBLIC', message, expectedVersion, actor);
}

export async function addInternalNote(
  db: Database,
  reportId: string,
  message: string,
  expectedVersion: number,
  actor: WorkflowActor,
): Promise<schema.ReportUpdate> {
  return await addReportUpdate(db, reportId, 'INTERNAL', message, expectedVersion, actor);
}

// ---------------------------------------------------------------------------
// Timeline projection.
// ---------------------------------------------------------------------------

export interface TimelineEntry {
  readonly id: string;
  readonly kind: 'event' | 'update' | 'assignment' | 'relation';
  readonly at: Date;
  readonly actorId: string | null;
  readonly label: string;
  readonly detail: Record<string, unknown> | null;
  readonly visibility?: 'PUBLIC' | 'INTERNAL' | null | undefined;
}

const TIMELINE_KIND_ORDER: Record<TimelineEntry['kind'], number> = {
  event: 0,
  update: 1,
  assignment: 2,
  relation: 3,
};

function sortTimeline(entries: TimelineEntry[]): TimelineEntry[] {
  return entries.sort((a, b) => {
    const time = a.at.getTime() - b.at.getTime();
    if (time !== 0) {
      return time;
    }
    const kind = TIMELINE_KIND_ORDER[a.kind] - TIMELINE_KIND_ORDER[b.kind];
    if (kind !== 0) {
      return kind;
    }
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

async function loadTimelineParts(
  db: Database,
  reportId: string,
): Promise<{
  readonly events: schema.ReportEvent[];
  readonly updates: schema.ReportUpdate[];
  readonly assignments: schema.ReportAssignment[];
  readonly relations: schema.ReportRelation[];
}> {
  const events = await db
    .select()
    .from(schema.reportEvents)
    .where(eq(schema.reportEvents.reportId, reportId))
    .orderBy(asc(schema.reportEvents.createdAt), asc(schema.reportEvents.id));
  const updates = await db
    .select()
    .from(schema.reportUpdates)
    .where(eq(schema.reportUpdates.reportId, reportId))
    .orderBy(asc(schema.reportUpdates.createdAt), asc(schema.reportUpdates.id));
  const assignments = await db
    .select()
    .from(schema.reportAssignments)
    .where(eq(schema.reportAssignments.reportId, reportId))
    .orderBy(asc(schema.reportAssignments.assignedAt), asc(schema.reportAssignments.id));
  const relations = await db
    .select()
    .from(schema.reportRelations)
    .where(
      or(
        eq(schema.reportRelations.sourceReportId, reportId),
        eq(schema.reportRelations.targetReportId, reportId),
      ),
    )
    .orderBy(asc(schema.reportRelations.createdAt), asc(schema.reportRelations.id));
  return { events, updates, assignments, relations };
}

function toAdminEntries(parts: {
  readonly events: schema.ReportEvent[];
  readonly updates: schema.ReportUpdate[];
  readonly assignments: schema.ReportAssignment[];
  readonly relations: schema.ReportRelation[];
}): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  for (const event of parts.events) {
    entries.push({
      id: event.id,
      kind: 'event',
      at: event.createdAt,
      actorId: event.actorId,
      label: event.eventType,
      detail: {
        eventType: event.eventType,
        fromValue: event.fromValue,
        toValue: event.toValue,
        metadata: event.metadata,
      },
      visibility: event.eventType === 'INTERNAL_NOTE_ADDED' ? 'INTERNAL' : null,
    });
  }
  for (const update of parts.updates) {
    const visibility = update.visibility === 'PUBLIC' ? 'PUBLIC' : 'INTERNAL';
    entries.push({
      id: update.id,
      kind: 'update',
      at: update.createdAt,
      actorId: update.authorId,
      label: visibility === 'PUBLIC' ? 'PUBLIC_UPDATE' : 'INTERNAL_NOTE',
      detail: { visibility, message: update.message, authorId: update.authorId },
      visibility,
    });
  }
  for (const assignment of parts.assignments) {
    entries.push({
      id: assignment.id,
      kind: 'assignment',
      at: assignment.assignedAt,
      actorId: assignment.assignedBy,
      label: 'ASSIGNMENT',
      detail: {
        technicianId: assignment.technicianId,
        assignedBy: assignment.assignedBy,
        assignedAt: assignment.assignedAt,
        unassignedAt: assignment.unassignedAt,
        reason: assignment.reason,
      },
      visibility: null,
    });
  }
  for (const relation of parts.relations) {
    entries.push({
      id: relation.id,
      kind: 'relation',
      at: relation.createdAt,
      actorId: relation.createdBy,
      label: relation.relationType,
      detail: {
        sourceReportId: relation.sourceReportId,
        targetReportId: relation.targetReportId,
        relationType: relation.relationType,
      },
      visibility: null,
    });
  }
  return sortTimeline(entries);
}

export async function getAdminTimeline(
  db: Database,
  reportId: string,
): Promise<TimelineEntry[]> {
  const id = requireUuid(reportId, 'reportId');
  const rows = await db
    .select({ id: schema.maintenanceReports.id })
    .from(schema.maintenanceReports)
    .where(eq(schema.maintenanceReports.id, id));
  if (rows[0] === undefined) {
    throw notFound('Report not found');
  }
  const parts = await loadTimelineParts(db, id);
  return toAdminEntries(parts);
}

export async function getReporterTimeline(
  db: Database,
  reportId: string,
  reporterId: string,
): Promise<TimelineEntry[]> {
  const id = requireUuid(reportId, 'reportId');
  requireUuid(reporterId, 'reporterId');
  const rows = await db
    .select({
      id: schema.maintenanceReports.id,
      reporterId: schema.maintenanceReports.reporterId,
    })
    .from(schema.maintenanceReports)
    .where(eq(schema.maintenanceReports.id, id));
  const row = rows[0];
  // Identical 404 for missing vs foreign rows: never reveal another
  // reporter's ticket existence.
  if (row === undefined || row.reporterId !== reporterId) {
    throw notFound('Report not found');
  }
  const parts = await loadTimelineParts(db, id);
  const visibleEvents = parts.events.filter(
    (event) => event.eventType !== 'INTERNAL_NOTE_ADDED',
  );
  const visibleUpdates = parts.updates.filter((update) => update.visibility === 'PUBLIC');
  const entries = toAdminEntries({
    events: visibleEvents,
    updates: visibleUpdates,
    assignments: parts.assignments,
    relations: parts.relations,
  });
  // Strip all actor PII for reporters: label text only.
  return entries.map((entry) => ({ ...entry, actorId: null }));
}
