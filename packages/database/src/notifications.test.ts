// P6-3 notifications: outbox event → idempotent reporter notification.
//
// Pure content-mapping tests run offline. DB-gated integration uses a SCRATCH
// database (`silapor_p63_test`) created/dropped in beforeAll/afterAll and
// skips without a reachable PostgreSQL (same contract as workflow.test.ts).
import postgres from 'postgres';
import { eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { describe, expect, it, afterAll, beforeAll } from 'vitest';
import { getDb, resolveDatabaseUrl } from './index.js';
import { runMigrations } from './migrate.js';
import {
  facilityAssets,
  facilityCategories,
  locations,
  maintenanceReports,
  notifications,
  outboxEvents,
  users,
} from './schema.js';
import {
  buildNotificationContent,
  listNotificationsForUser,
  markAllNotificationsRead,
  markNotificationRead,
  processNotificationOutboxEvent,
} from './notifications.js';

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

// ---------------------------------------------------------------------------
// P6-5b notification queries (scratch database, live only).
// ---------------------------------------------------------------------------

const QUERY_SCRATCH_DB_NAME = 'silapor_p65b_test';

function queryScratchUrl(base: string): string {
  const url = new URL(base);
  url.pathname = `/${QUERY_SCRATCH_DB_NAME}`;
  return url.toString();
}

describe.skipIf(!enabled)('notification queries (requires reachable PostgreSQL)', () => {
  const url = queryScratchUrl(baseUrl);
  let close: () => Promise<void> = async () => undefined;
  let db: ReturnType<typeof getDb>['db'] | undefined;

  let reporterAId = '';
  let reporterBId = '';
  let reportId = '';
  // Row ids for reporter A: oldest → middle (reportId null) → newest.
  let oldestId = '';
  let noReportId = '';
  let newestId = '';
  const bIds: string[] = [];

  const requireDb = (): NonNullable<typeof db> => {
    if (db === undefined) {
      throw new Error('test db not initialised');
    }
    return db;
  };

  beforeAll(async () => {
    const admin = postgres(baseUrl, { max: 1 });
    try {
      await admin.unsafe(`DROP DATABASE IF EXISTS "${QUERY_SCRATCH_DB_NAME}"`);
      await admin.unsafe(`CREATE DATABASE "${QUERY_SCRATCH_DB_NAME}"`);
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
        { username: `p65b-ra-${randomUUID().slice(0, 8)}`, role: 'REPORTER' },
        { username: `p65b-rb-${randomUUID().slice(0, 8)}`, role: 'REPORTER' },
      ])
      .returning({ id: users.id });
    reporterAId = userRows[0]!.id;
    reporterBId = userRows[1]!.id;

    const locRows = await d
      .insert(locations)
      .values({ type: 'CAMPUS', code: 'P65B-CAMPUS', name: 'Kampus' })
      .returning({ id: locations.id });
    const catRows = await d
      .insert(facilityCategories)
      .values({ code: 'P65B-ELEC', name: 'Elektronik' })
      .returning({ id: facilityCategories.id });
    const reportRows = await d
      .insert(maintenanceReports)
      .values({
        ticketNumber: 'MNT-2026-000210',
        idempotencyKey: randomUUID(),
        reporterId: reporterAId,
        locationId: locRows[0]!.id,
        submittedCategoryId: catRows[0]!.id,
        description: 'AC ruang kelas tidak dingin sejak dua hari lalu.',
        status: 'REPORTED',
      })
      .returning({ id: maintenanceReports.id });
    reportId = reportRows[0]!.id;

    // Reporter A: newest read + middle unread with no report + oldest unread.
    const aRows = await d
      .insert(notifications)
      .values([
        {
          userId: reporterAId,
          type: 'STATUS_CHANGED',
          title: 'Status laporan diperbarui',
          message: 'Status penanganan Tiket MNT-2026-000210 telah diperbarui.',
          reportId,
          sourceEventId: randomUUID(),
          readAt: new Date('2026-01-03T11:00:00Z'),
          createdAt: new Date('2026-01-03T10:00:00Z'),
        },
        {
          userId: reporterAId,
          type: 'REPORT_ASSIGNED',
          title: 'Teknisi ditugaskan',
          message: 'Tiket MNT-2026-000210 telah ditugaskan ke teknisi.',
          reportId: null,
          sourceEventId: randomUUID(),
          createdAt: new Date('2026-01-02T10:00:00Z'),
        },
        {
          userId: reporterAId,
          type: 'REPORT_VERIFIED',
          title: 'Laporan diverifikasi',
          message: 'Tiket MNT-2026-000210 telah diverifikasi admin.',
          reportId,
          sourceEventId: randomUUID(),
          createdAt: new Date('2026-01-01T10:00:00Z'),
        },
      ])
      .returning({ id: notifications.id, type: notifications.type });
    newestId = aRows.find((row) => row.type === 'STATUS_CHANGED')!.id;
    noReportId = aRows.find((row) => row.type === 'REPORT_ASSIGNED')!.id;
    oldestId = aRows.find((row) => row.type === 'REPORT_VERIFIED')!.id;

    // Reporter B: two foreign unread rows.
    const bRows = await d
      .insert(notifications)
      .values([
        {
          userId: reporterBId,
          type: 'REPORT_VERIFIED',
          title: 'Laporan diverifikasi',
          message: 'Tiket MNT-2026-000211 telah diverifikasi admin.',
          reportId: null,
          sourceEventId: randomUUID(),
        },
        {
          userId: reporterBId,
          type: 'STATUS_CHANGED',
          title: 'Status laporan diperbarui',
          message: 'Status penanganan Tiket MNT-2026-000211 telah diperbarui.',
          reportId: null,
          sourceEventId: randomUUID(),
        },
      ])
      .returning({ id: notifications.id });
    bIds.push(...bRows.map((row) => row.id));
  });

  afterAll(async () => {
    await close();
    const admin = postgres(baseUrl, { max: 1 });
    await admin`DROP DATABASE IF EXISTS ${admin(QUERY_SCRATCH_DB_NAME)}`;
    await admin.end();
  });

  it("lists only the user's own rows newest first with total and unreadCount", async () => {
    const result = await listNotificationsForUser(requireDb(), reporterAId);
    expect(result.items.map((item) => item.id)).toEqual([newestId, noReportId, oldestId]);
    expect(result.total).toBe(3);
    expect(result.unreadCount).toBe(2);
  });

  it('carries the joined ticket, status, and visible location, and stays null-safe without a report', async () => {
    const result = await listNotificationsForUser(requireDb(), reporterAId);
    const newest = result.items.find((item) => item.id === newestId)!;
    expect(newest.reportId).toBe(reportId);
    expect(newest.ticketNumber).toBe('MNT-2026-000210');
    expect(newest.reportStatus).toBe('REPORTED');
    expect(newest.assetName).toBeNull();
    expect(newest.locationName).toBe('Kampus');
    expect(newest.locationBuildingCode).toBeNull();
    expect(newest.locationFloorNumber).toBeNull();
    const noReport = result.items.find((item) => item.id === noReportId)!;
    expect(noReport.reportId).toBeNull();
    expect(noReport.ticketNumber).toBeNull();
    expect(noReport.reportStatus).toBeNull();
    expect(noReport.assetName).toBeNull();
    expect(noReport.locationName).toBeNull();
  });

  it("never leaks another reporter's rows", async () => {
    const result = await listNotificationsForUser(requireDb(), reporterBId);
    expect(result.total).toBe(2);
    expect(result.items.map((item) => item.id).sort()).toEqual([...bIds].sort());
    expect(result.unreadCount).toBe(2);
    expect(result.items.every((item) => item.reportId === null)).toBe(true);
  });

  it('marks a single notification read idempotently and 404s foreign and unknown ids', async () => {
    // Foreign id (reporter A's row, marked by reporter B) is indistinguishable
    // from a nonexistent one.
    await expect(markNotificationRead(requireDb(), reporterBId, oldestId)).rejects.toThrow(
      'Notification not found',
    );
    await expect(markNotificationRead(requireDb(), reporterBId, oldestId)).rejects.toMatchObject({
      status: 404,
    });
    await expect(
      markNotificationRead(requireDb(), reporterAId, 'not-a-valid-uuid'),
    ).rejects.toMatchObject({ status: 400 });

    await markNotificationRead(requireDb(), reporterAId, noReportId);
    const afterFirst = await listNotificationsForUser(requireDb(), reporterAId);
    expect(afterFirst.unreadCount).toBe(1);
    const noReport = afterFirst.items.find((item) => item.id === noReportId)!;
    expect(noReport.readAt).not.toBeNull();

    await markNotificationRead(requireDb(), reporterAId, noReportId);
    const afterSecond = await listNotificationsForUser(requireDb(), reporterAId);
    expect(afterSecond.unreadCount).toBe(1);
    expect(afterSecond.total).toBe(3);
  });

  it('marks all unread read once, then transitions nothing on a second pass', async () => {
    const first = await markAllNotificationsRead(requireDb(), reporterBId);
    expect(first).toBe(2);
    const after = await listNotificationsForUser(requireDb(), reporterBId);
    expect(after.unreadCount).toBe(0);
    expect(after.items.every((item) => item.readAt !== null)).toBe(true);

    const second = await markAllNotificationsRead(requireDb(), reporterBId);
    expect(second).toBe(0);

    const stillA = await listNotificationsForUser(requireDb(), reporterAId);
    expect(stillA.unreadCount).toBe(1);

    await expect(markAllNotificationsRead(requireDb(), 'not-a-valid-uuid')).rejects.toMatchObject({
      status: 400,
    });
  });

  it('resolves asset names and nulls locations that are reporter-hidden or inactive', async () => {
    const d = requireDb();
    const [campus] = await d
      .select({ id: locations.id })
      .from(locations)
      .where(eq(locations.code, 'P65B-CAMPUS'));
    const [category] = await d
      .select({ id: facilityCategories.id })
      .from(facilityCategories)
      .where(eq(facilityCategories.code, 'P65B-ELEC'));
    const [asset] = await d
      .insert(facilityAssets)
      .values({
        assetCode: 'P65B-ASSET',
        name: 'Proyektor Epson',
        categoryId: category!.id,
        locationId: campus!.id,
      })
      .returning({ id: facilityAssets.id });
    const [hiddenLocation] = await d
      .insert(locations)
      .values({
        type: 'ROOM',
        code: 'P65B-HIDDEN',
        name: 'Ruang Rapat',
        buildingCode: 'C',
        floorNumber: 3,
        reporterHidden: true,
      })
      .returning({ id: locations.id });
    const [reportRow] = await d
      .insert(maintenanceReports)
      .values({
        ticketNumber: 'MNT-2026-000212',
        idempotencyKey: randomUUID(),
        reporterId: reporterAId,
        assetId: asset!.id,
        locationId: hiddenLocation!.id,
        submittedCategoryId: category!.id,
        description: 'Proyektor tidak menyala saat perkuliahan.',
      })
      .returning({ id: maintenanceReports.id });
    await d.insert(notifications).values({
      userId: reporterAId,
      type: 'REPORT_RESOLVED',
      title: 'Laporan selesai',
      message: 'Tiket MNT-2026-000212 telah selesai ditangani.',
      reportId: reportRow!.id,
      sourceEventId: randomUUID(),
    });

    const resolve = async () =>
      (await listNotificationsForUser(requireDb(), reporterAId)).items.find(
        (item) => item.ticketNumber === 'MNT-2026-000212',
      )!;

    const hidden = await resolve();
    expect(hidden.assetName).toBe('Proyektor Epson');
    expect(hidden.reportStatus).toBe('REPORTED');
    expect(hidden.locationName).toBeNull();
    expect(hidden.locationBuildingCode).toBeNull();
    expect(hidden.locationFloorNumber).toBeNull();

    // Un-hide: the reporter-visible room and its denormalised parts resolve.
    await d
      .update(locations)
      .set({ reporterHidden: false })
      .where(eq(locations.id, hiddenLocation!.id));
    const visible = await resolve();
    expect(visible.locationName).toBe('Ruang Rapat');
    expect(visible.locationBuildingCode).toBe('C');
    expect(visible.locationFloorNumber).toBe(3);

    // Deactivated locations disappear from reporter-facing fields again.
    await d.update(locations).set({ isActive: false }).where(eq(locations.id, hiddenLocation!.id));
    const inactive = await resolve();
    expect(inactive.locationName).toBeNull();
    expect(inactive.locationBuildingCode).toBeNull();
    expect(inactive.locationFloorNumber).toBeNull();
  });
});
