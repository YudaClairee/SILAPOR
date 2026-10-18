// In-app notifications from outbox events (Phase 6 P6-3).
//
// The workflow mutations enqueue `WORKFLOW_NOTIFICATION` outbox rows with
// payload `{ reportId, ticketNumber, kind, actorId }` (Phase 5). This module
// turns one outbox row into notification rows for the report's reporter:
//
// - Idempotent by construction: the (source_event_id, user_id) unique pair
//   plus `onConflictDoNothing` makes worker redelivery a no-op (plan step 11).
// - PROGRESS_NOTE_ADDED notifies the reporter; LAPORAN_PALSU still uses the
//   neutral message text on reporter surfaces.
// - INTERNAL_NOTE_ADDED is a legacy kind and stays unnotified; new writes use
//   PROGRESS_NOTE_ADDED with no visibility.
// - Recipient is the report's reporter_id loaded fresh from the report row —
//   never trusted from the payload. Messages carry the ticket number only;
//   no PII, no report description, no actor identity.
//
// The consumer (worker, P6-4) calls `processNotificationOutboxEvent` inside
// the same transaction that marks the outbox row DISPATCHED, so a crash
// between the two is impossible; a post-commit redelivery is absorbed by the
// unique constraint.

import { and, count, desc, eq, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { badRequest, notFound } from '@silapor/shared';
import * as schema from './schema.js';

type Database = PostgresJsDatabase<typeof schema>;
export type NotificationDb = Database | Parameters<Parameters<Database['transaction']>[0]>[0];

// ---------------------------------------------------------------------------
// Pure content mapping (unit-testable without a DB).
// ---------------------------------------------------------------------------

export interface NotificationContent {
  readonly type: string;
  readonly title: string;
  readonly message: string;
}

// Kinds that produce a reporter notification. INTERNAL_NOTE_ADDED and
// PRIORITY_CHANGED are deliberately absent (ledger ruling). Unknown kinds
// also return null — new event kinds must be mapped explicitly.
export function buildNotificationContent(
  kind: string,
  ticketNumber: string,
): NotificationContent | null {
  const ticket = `Tiket ${ticketNumber}`;
  switch (kind) {
    case 'REPORT_VERIFIED':
      return {
        type: kind,
        title: 'Laporan diverifikasi',
        message: `${ticket} telah diverifikasi admin dan masuk antrean penanganan.`,
      };
    case 'REPORT_REJECTED':
      return {
        type: kind,
        title: 'Laporan ditolak',
        message: `${ticket} ditolak admin setelah ditinjau. Buka detail untuk alasan lengkapnya.`,
      };
    case 'REPORT_MARKED_DUPLICATE':
      return {
        type: kind,
        title: 'Laporan digabungkan',
        message: `${ticket} ditandai sebagai duplikat; pantau tiket utama yang dirujuk.`,
      };
    case 'REPORT_ASSIGNED':
      return {
        type: kind,
        title: 'Teknisi ditugaskan',
        message: `${ticket} telah ditugaskan ke teknisi.`,
      };
    case 'STATUS_CHANGED':
      return {
        type: kind,
        title: 'Status laporan diperbarui',
        message: `Status penanganan ${ticket} telah diperbarui.`,
      };
    case 'PROGRESS_NOTE_ADDED':
      return {
        type: kind,
        title: 'Progres baru',
        message: `Ada catatan progres baru pada ${ticket}.`,
      };
    case 'PUBLIC_UPDATE_ADDED':
      return {
        type: kind,
        title: 'Progres baru',
        message: `Ada pembaruan progres baru pada ${ticket}.`,
      };
    case 'REPORT_RESOLVED':
      return {
        type: kind,
        title: 'Laporan diselesaikan',
        message: `Perbaikan ${ticket} telah diselesaikan.`,
      };
    case 'REPORT_CLOSED':
      return {
        type: kind,
        title: 'Laporan ditutup',
        message: `${ticket} telah ditutup dan diarsipkan. Terima kasih atas laporannya.`,
      };
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Outbox → notifications (idempotent).
// ---------------------------------------------------------------------------

export interface NotificationProcessResult {
  /** 0 when the kind is not notifiable or the delivery was a redelivery. */
  readonly created: number;
  readonly skippedReason: 'not-notifiable' | 'duplicate' | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function processNotificationOutboxEvent(
  db: NotificationDb,
  outboxEventId: string,
): Promise<NotificationProcessResult> {
  if (!UUID_RE.test(outboxEventId)) {
    throw badRequest('outboxEventId must be a valid UUID');
  }
  const eventRows = await db
    .select()
    .from(schema.outboxEvents)
    .where(eq(schema.outboxEvents.id, outboxEventId));
  const event = eventRows[0];
  if (event === undefined) {
    throw notFound('Outbox event not found');
  }
  if (event.type !== 'WORKFLOW_NOTIFICATION') {
    throw badRequest('Outbox event is not a workflow notification');
  }

  const record = event.payload as Record<string, unknown> | null;
  if (
    record === null ||
    typeof record !== 'object' ||
    Array.isArray(record) ||
    typeof record['kind'] !== 'string' ||
    typeof record['reportId'] !== 'string'
  ) {
    throw badRequest('Outbox event payload is malformed');
  }
  const reportId = record['reportId'];
  const content = buildNotificationContent(
    record['kind'],
    typeof record['ticketNumber'] === 'string' ? record['ticketNumber'] : '',
  );
  if (content === null) {
    return { created: 0, skippedReason: 'not-notifiable' };
  }

  // Recipient from the canonical report row, not the payload.
  const reportRows = await db
    .select({ reporterId: schema.maintenanceReports.reporterId })
    .from(schema.maintenanceReports)
    .where(eq(schema.maintenanceReports.id, record['reportId']));
  const report = reportRows[0];
  if (report === undefined) {
    throw notFound('Report not found');
  }

  const inserted = await db
    .insert(schema.notifications)
    .values({
      userId: report.reporterId,
      type: content.type,
      title: content.title,
      message: content.message,
      reportId,
      sourceEventId: event.id,
    })
    // Redelivery of the same event to the same reporter is a no-op.
    .onConflictDoNothing({
      target: [schema.notifications.sourceEventId, schema.notifications.userId],
    })
    .returning({ id: schema.notifications.id });
  if (inserted.length === 0) {
    return { created: 0, skippedReason: 'duplicate' };
  }
  return { created: 1, skippedReason: null };
}

// ---------------------------------------------------------------------------
// P6-5b read-side queries + mark-as-read.
// ---------------------------------------------------------------------------

export interface NotificationListItem {
  readonly id: string;
  readonly type: string;
  readonly title: string;
  readonly message: string;
  readonly reportId: string | null;
  /** The report's ticket when the notification's report row still exists. */
  readonly ticketNumber: string | null;
  readonly readAt: Date | null;
  readonly createdAt: Date;
}

export interface NotificationListResult {
  /** Newest first (createdAt DESC, id DESC tiebreak). */
  readonly items: readonly NotificationListItem[];
  readonly total: number;
  readonly unreadCount: number;
}

function requireUserUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    throw badRequest(`${field} must be a valid UUID`);
  }
  return value;
}

export async function listNotificationsForUser(
  db: NotificationDb,
  userId: string,
): Promise<NotificationListResult> {
  requireUserUuid(userId, 'userId');
  // LEFT JOIN keeps rows whose report was deleted null-safe (reportId stays,
  // ticketNumber turns null) — never filter by the join.
  const rows = await db
    .select({
      id: schema.notifications.id,
      type: schema.notifications.type,
      title: schema.notifications.title,
      message: schema.notifications.message,
      reportId: schema.notifications.reportId,
      ticketNumber: schema.maintenanceReports.ticketNumber,
      readAt: schema.notifications.readAt,
      createdAt: schema.notifications.createdAt,
    })
    .from(schema.notifications)
    .leftJoin(
      schema.maintenanceReports,
      eq(schema.notifications.reportId, schema.maintenanceReports.id),
    )
    .where(eq(schema.notifications.userId, userId))
    .orderBy(desc(schema.notifications.createdAt), desc(schema.notifications.id));
  const totalRows = await db
    .select({ value: count() })
    .from(schema.notifications)
    .where(eq(schema.notifications.userId, userId));
  const unreadRows = await db
    .select({ value: count() })
    .from(schema.notifications)
    .where(and(eq(schema.notifications.userId, userId), isNull(schema.notifications.readAt)));
  return {
    items: rows,
    total: totalRows[0]?.value ?? 0,
    unreadCount: unreadRows[0]?.value ?? 0,
  };
}

export async function markNotificationRead(
  db: NotificationDb,
  userId: string,
  notificationId: string,
): Promise<void> {
  requireUserUuid(userId, 'userId');
  requireUserUuid(notificationId, 'notificationId');
  const updated = await db
    .update(schema.notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(schema.notifications.id, notificationId),
        eq(schema.notifications.userId, userId),
        isNull(schema.notifications.readAt),
      ),
    )
    .returning({ id: schema.notifications.id });
  if (updated.length > 0) {
    return;
  }
  // No transition: either already read (idempotent success) or foreign/
  // unknown (IDOR-guarded 404, byte-identical body to other 404s).
  const owned = await db
    .select({ id: schema.notifications.id })
    .from(schema.notifications)
    .where(
      and(eq(schema.notifications.id, notificationId), eq(schema.notifications.userId, userId)),
    );
  if (owned.length === 0) {
    throw notFound('Notification not found');
  }
}

/** Marks every unread notification of the user read; returns the count of
 *  rows transitioned unread→read (0 when none were unread) — the web layer's
 *  `updated` field on read-all. */
export async function markAllNotificationsRead(
  db: NotificationDb,
  userId: string,
): Promise<number> {
  requireUserUuid(userId, 'userId');
  const updated = await db
    .update(schema.notifications)
    .set({ readAt: new Date() })
    .where(and(eq(schema.notifications.userId, userId), isNull(schema.notifications.readAt)))
    .returning({ id: schema.notifications.id });
  return updated.length;
}
