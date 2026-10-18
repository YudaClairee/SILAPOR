// P6-3 notifications: outbox event → idempotent reporter notification.
//
// Pure content-mapping tests run offline. DB-gated integration uses a SCRATCH
// database (`silapor_p63_test`) created/dropped in beforeAll/afterAll and
// skips without a reachable PostgreSQL (same contract as workflow.test.ts).
import postgres from 'postgres';
import { randomUUID } from 'node:crypto';
import { describe, expect, it, afterAll, beforeAll } from 'vitest';
import { getDb, resolveDatabaseUrl } from './index.js';
import { runMigrations } from './migrate.js';
import {
  facilityCategories,
  locations,
  maintenanceReports,
  notifications,
  outboxEvents,
  users,
} from './schema.js';
import { buildNotificationContent, processNotificationOutboxEvent } from './notifications.js';

type NotificationTestDb = Parameters<typeof processNotificationOutboxEvent>[0];

const UNTOUCHED_DB = undefined as unknown as NotificationTestDb;

// ---------------------------------------------------------------------------
// Pure content mapping (no DB).
// ---------------------------------------------------------------------------

describe('buildNotificationContent (pure, offline)', () => {
  it('maps plan step 9 event kinds to Indonesian copy with the ticket number', () => {
    const verified = buildNotificationContent('REPORT_VERIFIED', 'MNT-2026-000001');
    expect(verified).toMatchObject({
      type: 'REPORT_VERIFIED',
      title: 'Laporan diverifikasi',
      message: expect.stringContaining('MNT-2026-000001'),
    });
    expect(buildNotificationContent('REPORT_ASSIGNED', 'T')).toMatchObject({
      title: 'Teknisi ditugaskan',
    });
    expect(buildNotificationContent('STATUS_CHANGED', 'T')).toMatchObject({
      title: 'Status laporan diperbarui',
    });
    expect(buildNotificationContent('PROGRESS_NOTE_ADDED', 'T')).toMatchObject({
      title: 'Progres baru',
    });
    expect(buildNotificationContent('PUBLIC_UPDATE_ADDED', 'T')).toMatchObject({
      title: 'Progres baru',
    });
    expect(buildNotificationContent('REPORT_RESOLVED', 'T')).toMatchObject({
      title: 'Laporan diselesaikan',
    });
    expect(buildNotificationContent('REPORT_CLOSED', 'T')).toMatchObject({
      title: 'Laporan ditutup',
    });
  });

  it('also maps terminal rejections and duplicates (status-change ruling)', () => {
    expect(buildNotificationContent('REPORT_REJECTED', 'T')).toMatchObject({
      title: 'Laporan ditolak',
    });
    expect(buildNotificationContent('REPORT_MARKED_DUPLICATE', 'T')).toMatchObject({
      title: 'Laporan digabungkan',
    });
  });

  it('returns null for internal notes, priority changes, and unknown kinds', () => {
    expect(buildNotificationContent('INTERNAL_NOTE_ADDED', 'T')).toBeNull();
    expect(buildNotificationContent('PRIORITY_CHANGED', 'T')).toBeNull();
    expect(buildNotificationContent('SOMETHING_ELSE', 'T')).toBeNull();
  });
});

describe('processNotificationOutboxEvent validation (pure, offline)', () => {
  it('rejects a malformed outbox event id with 400', async () => {
    await expect(processNotificationOutboxEvent(UNTOUCHED_DB, 'nope')).rejects.toMatchObject({
      status: 400,
    });
  });
});

// ---------------------------------------------------------------------------
// DB-gated integration (scratch database, live only).
// ---------------------------------------------------------------------------

const SCRATCH_DB_NAME = 'silapor_p63_test';

function scratchUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.pathname = `/${SCRATCH_DB_NAME}`;
  return url.toString();
}

async function isReachable(url: string): Promise<boolean> {
  let sql: postgres.Sql | undefined;
  try {
    sql = postgres(url, { max: 1, connect_timeout: 2 });
    await sql`select 1`;
    return true;
  } catch {
    return false;
  } finally {
    await sql?.end().catch(() => undefined);
  }
}

const baseUrl = resolveDatabaseUrl(process.env['DATABASE_URL']);
const dbAvailable = await isReachable(baseUrl);
const enabled = dbAvailable;

describe.skipIf(!enabled)('notification processing (requires reachable PostgreSQL)', () => {
  const url = scratchUrl(baseUrl);
  let close: () => Promise<void> = async () => undefined;
  let db: ReturnType<typeof getDb>['db'] | undefined;

  let reporterId = '';
  let adminId = '';
  let reportId = '';

  const requireDb = (): NonNullable<typeof db> => {
    if (db === undefined) {
      throw new Error('test db not initialised');
    }
    return db;
  };

  async function queueEvent(kind: string, opts?: { reportId?: string; payload?: unknown }) {
    const rows = await requireDb()
      .insert(outboxEvents)
      .values({
        type: 'WORKFLOW_NOTIFICATION',
        payload: opts?.payload ?? {
          reportId: opts?.reportId ?? reportId,
          ticketNumber: 'MNT-2026-000099',
          kind,
          actorId: adminId,
        },
        status: 'PENDING',
      })
      .returning({ id: outboxEvents.id });
    return rows[0]!.id;
  }

  beforeAll(async () => {
    const admin = postgres(baseUrl, { max: 1 });
    try {
      await admin.unsafe(`DROP DATABASE IF EXISTS "${SCRATCH_DB_NAME}"`);
      await admin.unsafe(`CREATE DATABASE "${SCRATCH_DB_NAME}"`);
    } finally {
      await admin.end();
    }
    const handle = getDb(url);
    db = handle.db;
    close = handle.close;
    await runMigrations(url);
    const d = requireDb();

    const userRows = await d
      .insert(users)
      .values([
        { username: `p63-r-${randomUUID().slice(0, 8)}`, role: 'REPORTER' },
        { username: `p63-a-${randomUUID().slice(0, 8)}`, role: 'ADMIN' },
      ])
      .returning({ id: users.id, role: users.role });
    reporterId = userRows.find((row) => row.role === 'REPORTER')!.id;
    adminId = userRows.find((row) => row.role === 'ADMIN')!.id;

    const locRows = await d
      .insert(locations)
      .values({ type: 'CAMPUS', code: 'P63-CAMPUS', name: 'Kampus' })
      .returning({ id: locations.id });
    const catRows = await d
      .insert(facilityCategories)
      .values({ code: 'P63-ELEC', name: 'Elektronik' })
      .returning({ id: facilityCategories.id });
    const reportRows = await d
      .insert(maintenanceReports)
      .values({
        ticketNumber: 'MNT-2026-000099',
        idempotencyKey: randomUUID(),
        reporterId,
        locationId: locRows[0]!.id,
        submittedCategoryId: catRows[0]!.id,
        description: 'Lampu ruangan mati total sejak pagi hari, mohon segera diperbaiki.',
        status: 'REPORTED',
      })
      .returning({ id: maintenanceReports.id });
    reportId = reportRows[0]!.id;
  });

  afterAll(async () => {
    await close();
    const admin = postgres(baseUrl, { max: 1 });
    await admin`DROP DATABASE IF EXISTS ${admin(SCRATCH_DB_NAME)}`;
    await admin.end();
  });

  it('creates exactly one notification for the report owner', async () => {
    const eventId = await queueEvent('REPORT_VERIFIED');
    const result = await processNotificationOutboxEvent(requireDb(), eventId);
    expect(result).toEqual({ created: 1, skippedReason: null });
    const rows = await requireDb().select().from(notifications);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.userId).toBe(reporterId);
    expect(rows[0]!.type).toBe('REPORT_VERIFIED');
    expect(rows[0]!.reportId).toBe(reportId);
    expect(rows[0]!.readAt).toBeNull();
    expect(rows[0]!.message).not.toContain(adminId);
  });

  it('never creates a second notification when the same event is redelivered', async () => {
    const eventId = await queueEvent('STATUS_CHANGED');
    expect(await processNotificationOutboxEvent(requireDb(), eventId)).toEqual({
      created: 1,
      skippedReason: null,
    });
    expect(await processNotificationOutboxEvent(requireDb(), eventId)).toEqual({
      created: 0,
      skippedReason: 'duplicate',
    });
    const rows = await requireDb().select().from(notifications);
    expect(rows.filter((row) => row.type === 'STATUS_CHANGED')).toHaveLength(1);
  });

  it('skips internal notes and priority changes without creating rows', async () => {
    const internalId = await queueEvent('INTERNAL_NOTE_ADDED');
    expect(await processNotificationOutboxEvent(requireDb(), internalId)).toEqual({
      created: 0,
      skippedReason: 'not-notifiable',
    });
    const priorityId = await queueEvent('PRIORITY_CHANGED');
    expect(await processNotificationOutboxEvent(requireDb(), priorityId)).toEqual({
      created: 0,
      skippedReason: 'not-notifiable',
    });
    const rows = await requireDb().select().from(notifications);
    expect(rows.some((row) => row.type === 'INTERNAL_NOTE_ADDED')).toBe(false);
    expect(rows.some((row) => row.type === 'PRIORITY_CHANGED')).toBe(false);
  });

  it('rejects non-workflow rows, malformed payloads, and missing reports', async () => {
    const rows = await requireDb()
      .insert(outboxEvents)
      .values({ type: 'AI_REVIEW_REQUESTED', payload: { reportId }, status: 'PENDING' })
      .returning({ id: outboxEvents.id });
    await expect(processNotificationOutboxEvent(requireDb(), rows[0]!.id)).rejects.toMatchObject({
      status: 400,
    });
    const malformedId = await queueEvent('REPORT_VERIFIED', { payload: { kind: 42 } });
    await expect(processNotificationOutboxEvent(requireDb(), malformedId)).rejects.toMatchObject({
      status: 400,
    });
    const missingReportId = await queueEvent('REPORT_VERIFIED', {
      reportId: '00000000-0000-4000-8000-000000000000',
    });
    await expect(
      processNotificationOutboxEvent(requireDb(), missingReportId),
    ).rejects.toMatchObject({ status: 404 });
  });
});
