// In-app notifications from outbox events (Phase 6 P6-3).
//
// The workflow mutations enqueue `WORKFLOW_NOTIFICATION` outbox rows with
// payload `{ reportId, ticketNumber, kind, actorId }` (Phase 5). This module
// turns one outbox row into notification rows for the report's reporter:
//
// - Idempotent by construction: the (source_event_id, user_id) unique pair
//   plus `onConflictDoNothing` makes worker redelivery a no-op (plan step 11).
// - INTERNAL_NOTE_ADDED and PRIORITY_CHANGED never notify (decision §7
//   visibility rules; plan step 9 event list).
// - Recipient is the report's reporter_id loaded fresh from the report row —
//   never trusted from the payload. Messages carry the ticket number only;
//   no PII, no report description, no actor identity.
//
// The consumer (worker, P6-4) calls `processNotificationOutboxEvent` inside
// the same transaction that marks the outbox row DISPATCHED, so a crash
// between the two is impossible; a post-commit redelivery is absorbed by the
// unique constraint.

import { eq } from 'drizzle-orm';
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

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
