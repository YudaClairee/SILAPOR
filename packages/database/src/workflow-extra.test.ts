// P5-4 workflow extras: assign / transition / updates / timeline (Phase 5).
//
// Pure validation tests run offline (no DB touched — the stub handle is never
// reached on malformed input). DB-gated integration uses a SCRATCH database
// (`silapor_p54_test`) created/dropped in beforeAll/afterAll — the shared dev
// database is never touched. Without a reachable PostgreSQL the integration
// suite skips (same offline-skip contract as workflow.test.ts).
import postgres from 'postgres';
import { randomUUID } from 'node:crypto';
import { describe, expect, it, afterAll, beforeAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb, resolveDatabaseUrl } from './index.js';
import { runMigrations } from './migrate.js';
import {
  auditLogs,
  facilityAssets,
  facilityCategories,
  issueTypes,
  locations,
  maintenanceReports,
  outboxEvents,
  reportAssignments,
  reportEvents,
  reportUpdates,
  technicians,
  users,
} from './schema.js';
import { linkSupportingReport } from './reports.js';
import { verifyReport, type VerifyReportInput } from './workflow.js';
import {
  addInternalNote,
  addPublicUpdate,
  addReportUpdate,
  assignTechnician,
  getAdminTimeline,
  getReporterTimeline,
  transitionReport,
} from './workflow-extra.js';

type ExtraDb = Parameters<typeof assignTechnician>[0];

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';

// Untouched handle: pure-validation paths throw before the first query, so a
// missing handle proves no DB access happened.
const UNTOUCHED_DB = undefined as unknown as ExtraDb;
const ACTOR = { actorId: UUID_A };

// ---------------------------------------------------------------------------
// Pure validation (no DB).
// ---------------------------------------------------------------------------

describe('workflow-extra input validation (pure, offline)', () => {
  it('assignTechnician rejects malformed ids with 400', async () => {
    await expect(
      assignTechnician(UNTOUCHED_DB, 'bogus', UUID_B, 1, ACTOR),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      assignTechnician(UNTOUCHED_DB, UUID_A, 'bogus', 1, ACTOR),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('transitionReport rejects an unknown status with 400', async () => {
    await expect(
      transitionReport(UNTOUCHED_DB, UUID_A, 'BOGUS' as never, 1, ACTOR),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('transitionReport rejects delegated VERIFIED/REJECTED/DUPLICATE targets with 400', async () => {
    await expect(
      transitionReport(UNTOUCHED_DB, UUID_A, 'VERIFIED', 1, ACTOR),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      transitionReport(UNTOUCHED_DB, UUID_A, 'REJECTED', 1, ACTOR),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      transitionReport(UNTOUCHED_DB, UUID_A, 'DUPLICATE', 1, ACTOR),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('addReportUpdate rejects short/oversize messages and bad visibility with 400', async () => {
    await expect(
      addReportUpdate(UNTOUCHED_DB, UUID_A, 'PUBLIC', 'no', 1, ACTOR),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      addReportUpdate(UNTOUCHED_DB, UUID_A, 'PUBLIC', '   ', 1, ACTOR),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      addReportUpdate(UNTOUCHED_DB, UUID_A, 'BOGUS' as never, 'pesan yang cukup panjang', 1, ACTOR),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      addPublicUpdate(UNTOUCHED_DB, UUID_A, 'ab', 1, ACTOR),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      addInternalNote(UNTOUCHED_DB, UUID_A, '', 1, ACTOR),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('timelines reject malformed ids with 400', async () => {
    await expect(getAdminTimeline(UNTOUCHED_DB, 'bogus')).rejects.toMatchObject({
      status: 400,
    });
    await expect(getReporterTimeline(UNTOUCHED_DB, 'bogus', UUID_A)).rejects.toMatchObject({
      status: 400,
    });
    await expect(getReporterTimeline(UNTOUCHED_DB, UUID_A, 'bogus')).rejects.toMatchObject({
      status: 400,
    });
  });
});

// ---------------------------------------------------------------------------
// DB-gated integration (scratch database, live only).
// ---------------------------------------------------------------------------

const SCRATCH_DB_NAME = 'silapor_p54_test';

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

describe.skipIf(!enabled)('workflow-extra mutations (requires reachable PostgreSQL)', () => {
  const url = scratchUrl(baseUrl);
  let close: () => Promise<void> = async () => undefined;
  let db: ReturnType<typeof getDb>['db'] | undefined;

  let adminId = '';
  let reporterId = '';
  let otherReporterId = '';
  let locId = '';
  let catId = '';
  let itId = '';
  let assetId = '';
  let techAId = '';
  let techBId = '';
  let techInactiveId = '';

  const requireDb = (): NonNullable<typeof db> => {
    if (db === undefined) {
      throw new Error('test db not initialised');
    }
    return db;
  };

  async function makeReport() {
    const handle = requireDb();
    const rows = await handle
      .insert(maintenanceReports)
      .values({
        ticketNumber: `P54-${randomUUID()}`,
        idempotencyKey: randomUUID(),
        reporterId,
        locationId: locId,
        assetId,
        submittedCategoryId: catId,
        submittedIssueTypeId: itId,
        description: 'Lampu ruangan mati total sejak pagi hari, mohon segera diperbaiki.',
        status: 'REPORTED',
      })
      .returning();
    const row = rows[0];
    if (row === undefined) {
      throw new Error('fixture: report insert failed');
    }
    return row;
  }

  function verifyInput(): VerifyReportInput {
    return {
      finalCategoryId: catId,
      finalIssueTypeId: itId,
      finalPriority: 'LOW',
      affectedReporters: 1,
    };
  }

  const actor = () => ({ actorId: adminId, requestId: 'p54-req-1' });

  async function makeVerified() {
    const created = await makeReport();
    return await verifyReport(requireDb(), created.id, verifyInput(), 1, actor());
  }

  async function makeAssigned() {
    const verified = await makeVerified();
    return await assignTechnician(requireDb(), verified.id, techAId, verified.version, actor());
  }

  async function makeInspection() {
    const assigned = await makeAssigned();
    return await transitionReport(
      requireDb(),
      assigned.id,
      'INSPECTION',
      assigned.version,
      actor(),
      'Teknisi tiba di lokasi dan mulai pemeriksaan awal',
    );
  }

  async function makeInRepair() {
    const inspection = await makeInspection();
    return await transitionReport(
      requireDb(),
      inspection.id,
      'IN_REPAIR',
      inspection.version,
      actor(),
      'Kerusakan dikonfirmasi, mulai perbaikan penggantian lampu',
    );
  }

  async function refresh(reportId: string) {
    const rows = await requireDb()
      .select()
      .from(maintenanceReports)
      .where(eq(maintenanceReports.id, reportId));
    const row = rows[0];
    if (row === undefined) {
      throw new Error('fixture: report missing');
    }
    return row;
  }

  async function eventsFor(reportId: string) {
    return await requireDb()
      .select()
      .from(reportEvents)
      .where(eq(reportEvents.reportId, reportId));
  }

  async function updatesFor(reportId: string) {
    return await requireDb()
      .select()
      .from(reportUpdates)
      .where(eq(reportUpdates.reportId, reportId));
  }

  async function assignmentsFor(reportId: string) {
    return await requireDb()
      .select()
      .from(reportAssignments)
      .where(eq(reportAssignments.reportId, reportId));
  }

  async function auditsFor(reportId: string) {
    return await requireDb().select().from(auditLogs).where(eq(auditLogs.entityId, reportId));
  }

  async function outboxFor(reportId: string) {
    const rows = await requireDb().select().from(outboxEvents);
    return rows.filter(
      (row) =>
        typeof row.payload === 'object' &&
        row.payload !== null &&
        (row.payload as Record<string, unknown>)['reportId'] === reportId,
    );
  }

  beforeAll(
    async () => {
      const admin = postgres(baseUrl, { max: 1 });
      try {
        await admin.unsafe(`DROP DATABASE IF EXISTS "${SCRATCH_DB_NAME}"`);
        await admin.unsafe(`CREATE DATABASE "${SCRATCH_DB_NAME}"`);
      } finally {
        await admin.end();
      }
      await runMigrations(url);

      const conn = getDb(url);
      close = conn.close;
      db = conn.db;

      const insertUser = async (username: string, role: 'REPORTER' | 'ADMIN'): Promise<string> => {
        const rows = await db!
          .insert(users)
          .values({ username, role })
          .returning({ id: users.id });
        const id = rows[0]?.id;
        if (id === undefined) {
          throw new Error('fixture: user insert failed');
        }
        return id;
      };
      adminId = await insertUser('p54-admin', 'ADMIN');
      reporterId = await insertUser('p54-reporter', 'REPORTER');
      otherReporterId = await insertUser('p54-other', 'REPORTER');

      const locRows = await db!
        .insert(locations)
        .values({ type: 'ROOM', code: 'P54-ROOM', name: 'P5-4 room', tierScore: 10 })
        .returning({ id: locations.id });
      locId = locRows[0]?.id ?? '';
      const catRows = await db!
        .insert(facilityCategories)
        .values({ code: 'P54-CAT', name: 'P5-4 category', weight: 10 })
        .returning({ id: facilityCategories.id });
      catId = catRows[0]?.id ?? '';
      const itRows = await db!
        .insert(issueTypes)
        .values({ code: 'P54-IT', name: 'P5-4 issue', categoryId: catId })
        .returning({ id: issueTypes.id });
      itId = itRows[0]?.id ?? '';
      const assetRows = await db!
        .insert(facilityAssets)
        .values({
          assetCode: 'P54-ASSET',
          name: 'P5-4 asset',
          categoryId: catId,
          locationId: locId,
          weight: 10,
        })
        .returning({ id: facilityAssets.id });
      assetId = assetRows[0]?.id ?? '';
      const techRows = await db!
        .insert(technicians)
        .values([
          { technicianCode: 'P54-TECH-A', displayName: 'Teknisi A' },
          { technicianCode: 'P54-TECH-B', displayName: 'Teknisi B' },
          { technicianCode: 'P54-TECH-OFF', displayName: 'Teknisi Off' },
        ])
        .returning({ id: technicians.id });
      techAId = techRows[0]?.id ?? '';
      techBId = techRows[1]?.id ?? '';
      techInactiveId = techRows[2]?.id ?? '';
      await db!
        .update(technicians)
        .set({ isActive: false })
        .where(eq(technicians.id, techInactiveId));
      if (
        adminId === '' ||
        reporterId === '' ||
        locId === '' ||
        catId === '' ||
        itId === '' ||
        assetId === '' ||
        techAId === '' ||
        techBId === '' ||
        techInactiveId === ''
      ) {
        throw new Error('fixture: setup failed');
      }
    },
    120_000,
  );

  afterAll(async () => {
    await close();
    const admin = postgres(baseUrl, { max: 1 });
    try {
      await admin.unsafe(`DROP DATABASE IF EXISTS "${SCRATCH_DB_NAME}"`);
    } finally {
      await admin.end();
    }
  });

  it('assign happy path: VERIFIED→ASSIGNED + history row + events/audit/outbox', async () => {
    const verified = await makeVerified();
    const next = await assignTechnician(
      requireDb(),
      verified.id,
      techAId,
      verified.version,
      actor(),
      'Shift pagi tersedia',
    );
    expect(next.status).toBe('ASSIGNED');
    expect(next.version).toBe(verified.version + 1);

    const assignments = await assignmentsFor(verified.id);
    expect(assignments).toHaveLength(1);
    expect(assignments[0]?.technicianId).toBe(techAId);
    expect(assignments[0]?.assignedBy).toBe(adminId);
    expect(assignments[0]?.unassignedAt).toBeNull();

    const events = await eventsFor(verified.id);
    expect(events.some((e) => e.eventType === 'ASSIGNMENT_CHANGED')).toBe(true);
    expect(
      events.some((e) => e.eventType === 'STATUS_CHANGED' && e.toValue === 'ASSIGNED'),
    ).toBe(true);
    expect((await auditsFor(verified.id)).some((a) => a.action === 'ASSIGNMENT_CHANGED')).toBe(
      true,
    );
    const outbox = await outboxFor(verified.id);
    expect(
      outbox.some(
        (o) => (o.payload as Record<string, unknown>)['kind'] === 'REPORT_ASSIGNED',
      ),
    ).toBe(true);
  });

  it('assign rejects an inactive technician with 400 and no partial writes', async () => {
    const verified = await makeVerified();
    await expect(
      assignTechnician(requireDb(), verified.id, techInactiveId, verified.version, actor()),
    ).rejects.toMatchObject({ status: 400 });
    expect(await assignmentsFor(verified.id)).toEqual([]);
    expect((await refresh(verified.id)).status).toBe('VERIFIED');
  });

  it('assign rejects a REPORTED report with 400', async () => {
    const created = await makeReport();
    await expect(
      assignTechnician(requireDb(), created.id, techAId, 1, actor()),
    ).rejects.toMatchObject({ status: 400 });
    expect(await assignmentsFor(created.id)).toEqual([]);
  });

  it('reassign keeps status and closes the previous assignment (single active)', async () => {
    const assigned = await makeAssigned();
    const next = await assignTechnician(
      requireDb(),
      assigned.id,
      techBId,
      assigned.version,
      actor(),
      'Alih shift sore',
    );
    expect(next.status).toBe(assigned.status);
    expect(next.version).toBe(assigned.version + 1);
    const assignments = await assignmentsFor(assigned.id);
    expect(assignments).toHaveLength(2);
    const active = assignments.filter((a) => a.unassignedAt === null);
    expect(active).toHaveLength(1);
    expect(active[0]?.technicianId).toBe(techBId);
    const closed = assignments.find((a) => a.technicianId === techAId);
    expect(closed?.unassignedAt).not.toBeNull();
  });

  it('transition INSPECTION→IN_REPAIR requires a note; with note stores INTERNAL', async () => {
    const inspection = await makeInspection();
    await expect(
      transitionReport(requireDb(), inspection.id, 'IN_REPAIR', inspection.version, actor()),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      transitionReport(requireDb(), inspection.id, 'IN_REPAIR', inspection.version, actor(), 'ok'),
    ).rejects.toMatchObject({ status: 400 });

    const next = await transitionReport(
      requireDb(),
      inspection.id,
      'IN_REPAIR',
      inspection.version,
      actor(),
      'Kerusakan dikonfirmasi, mulai perbaikan sekarang',
    );
    expect(next.status).toBe('IN_REPAIR');
    const updates = await updatesFor(inspection.id);
    // One INTERNAL note from ASSIGNED→INSPECTION setup + one new.
    expect(updates.filter((u) => u.visibility === 'INTERNAL')).toHaveLength(2);
    const latest = updates.find((u) => u.message.includes('mulai perbaikan'));
    expect(latest?.visibility).toBe('INTERNAL');
  });

  it('transition IN_REPAIR→RESOLVED stores a PUBLIC note + resolvedAt', async () => {
    const inRepair = await makeInRepair();
    const next = await transitionReport(
      requireDb(),
      inRepair.id,
      'RESOLVED',
      inRepair.version,
      actor(),
      'Perbaikan selesai, lampu sudah menyala kembali',
    );
    expect(next.status).toBe('RESOLVED');
    expect(next.resolvedAt).not.toBeNull();
    const updates = await updatesFor(inRepair.id);
    const pub = updates.filter((u) => u.visibility === 'PUBLIC');
    expect(pub.length).toBeGreaterThanOrEqual(1);
    expect(pub.some((u) => u.message.includes('menyala kembali'))).toBe(true);
    const events = await eventsFor(inRepair.id);
    expect(events.some((e) => e.eventType === 'REPORT_RESOLVED')).toBe(true);
  });

  it('reopen RESOLVED→IN_REPAIR requires a note', async () => {
    const inRepair = await makeInRepair();
    const resolved = await transitionReport(
      requireDb(),
      inRepair.id,
      'RESOLVED',
      inRepair.version,
      actor(),
      'Perbaikan selesai, lampu sudah menyala kembali',
    );
    await expect(
      transitionReport(requireDb(), resolved.id, 'IN_REPAIR', resolved.version, actor()),
    ).rejects.toMatchObject({ status: 400 });
    const reopened = await transitionReport(
      requireDb(),
      resolved.id,
      'IN_REPAIR',
      resolved.version,
      actor(),
      'Lampu mati lagi keesokan harinya, buka kembali',
    );
    expect(reopened.status).toBe('IN_REPAIR');
  });

  it('transition RESOLVED→CLOSED sets closedAt', async () => {
    const inRepair = await makeInRepair();
    const resolved = await transitionReport(
      requireDb(),
      inRepair.id,
      'RESOLVED',
      inRepair.version,
      actor(),
      'Perbaikan selesai, lampu sudah menyala kembali',
    );
    const closed = await transitionReport(
      requireDb(),
      resolved.id,
      'CLOSED',
      resolved.version,
      actor(),
    );
    expect(closed.status).toBe('CLOSED');
    expect(closed.closedAt).not.toBeNull();
    const events = await eventsFor(resolved.id);
    expect(events.some((e) => e.eventType === 'REPORT_CLOSED')).toBe(true);
  });

  it('illegal ASSIGNED→RESOLVED fails with 400 and no partial writes', async () => {
    const assigned = await makeAssigned();
    const eventsBefore = await eventsFor(assigned.id);
    const updatesBefore = await updatesFor(assigned.id);
    await expect(
      transitionReport(
        requireDb(),
        assigned.id,
        'RESOLVED',
        assigned.version,
        actor(),
        'Upaya lompat status yang tidak sah sama sekali',
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect((await refresh(assigned.id)).status).toBe('ASSIGNED');
    expect(await eventsFor(assigned.id)).toHaveLength(eventsBefore.length);
    expect(await updatesFor(assigned.id)).toHaveLength(updatesBefore.length);
  });

  it('stale expectedVersion fails with 409 and leaves the row untouched', async () => {
    const assigned = await makeAssigned();
    await expect(
      transitionReport(
        requireDb(),
        assigned.id,
        'INSPECTION',
        999,
        actor(),
        'Catatan pemeriksaan yang cukup panjang',
      ),
    ).rejects.toMatchObject({ status: 409 });
    const current = await refresh(assigned.id);
    expect(current.status).toBe('ASSIGNED');
    expect(current.version).toBe(assigned.version);
    // No transition events beyond the assignment pair.
    expect((await eventsFor(assigned.id)).filter((e) => e.eventType === 'STATUS_CHANGED')).toHaveLength(
      1,
    );
    await expect(
      addPublicUpdate(requireDb(), assigned.id, 'Pembaruan publik yang valid', 999, actor()),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('PUBLIC update is reporter-visible, INTERNAL note is hidden; foreign reporter 404s', async () => {
    const assigned = await makeAssigned();
    const pub = await addPublicUpdate(
      requireDb(),
      assigned.id,
      'Teknisi dijadwalkan datang besok pagi hari',
      assigned.version,
      actor(),
    );
    expect(pub.visibility).toBe('PUBLIC');
    const internal = await addInternalNote(
      requireDb(),
      assigned.id,
      'Catatan internal vendor belum terverifikasi harga',
      pub ? (await refresh(assigned.id)).version : assigned.version,
      actor(),
    );
    expect(internal.visibility).toBe('INTERNAL');

    const reporterView = await getReporterTimeline(requireDb(), assigned.id, reporterId);
    expect(reporterView.every((e) => e.actorId === null)).toBe(true);
    expect(
      reporterView.some(
        (e) =>
          e.kind === 'update' &&
          (e.detail as Record<string, unknown>)?.['message'] ===
            'Teknisi dijadwalkan datang besok pagi hari',
      ),
    ).toBe(true);
    expect(
      reporterView.some(
        (e) =>
          e.kind === 'update' &&
          (e.detail as Record<string, unknown>)?.['message'] ===
            'Catatan internal vendor belum terverifikasi harga',
      ),
    ).toBe(false);
    expect(reporterView.some((e) => e.label === 'INTERNAL_NOTE_ADDED')).toBe(false);

    const adminView = await getAdminTimeline(requireDb(), assigned.id);
    expect(
      adminView.some(
        (e) =>
          (e.detail as Record<string, unknown>)?.['message'] ===
          'Catatan internal vendor belum terverifikasi harga',
      ),
    ).toBe(true);

    await expect(
      getReporterTimeline(requireDb(), assigned.id, otherReporterId),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      getReporterTimeline(requireDb(), randomUUID(), reporterId),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('reporter timeline strips internal transition note metadata but keeps RESOLVED public note', async () => {
    const inspection = await makeInspection();
    const internalNote = `Rahasia internal ${randomUUID()} jangan bocor`;
    const inRepair = await transitionReport(
      requireDb(),
      inspection.id,
      'IN_REPAIR',
      inspection.version,
      actor(),
      internalNote,
    );
    expect(inRepair.status).toBe('IN_REPAIR');

    const reporterView = await getReporterTimeline(requireDb(), inspection.id, reporterId);
    expect(JSON.stringify(reporterView)).not.toContain(internalNote);
    for (const entry of reporterView) {
      expect(entry.actorId).toBeNull();
      if (entry.kind === 'event') {
        const detail = entry.detail as Record<string, unknown> | null;
        const metadata = detail?.['metadata'] as Record<string, unknown> | null | undefined;
        if (metadata !== null && metadata !== undefined && typeof metadata === 'object') {
          expect(JSON.stringify(metadata)).not.toContain(internalNote);
          const eventType = detail?.['eventType'];
          const toValue = detail?.['toValue'];
          const keepsNote =
            eventType === 'REPORT_RESOLVED' ||
            eventType === 'PUBLIC_UPDATE_ADDED' ||
            (eventType === 'STATUS_CHANGED' && toValue === 'RESOLVED');
          if (!keepsNote) {
            expect('note' in metadata).toBe(false);
          }
        }
      }
      if (entry.kind === 'update') {
        expect((entry.detail as Record<string, unknown>)?.['authorId']).toBeNull();
      }
      if (entry.kind === 'assignment') {
        expect((entry.detail as Record<string, unknown>)?.['assignedBy']).toBeNull();
        expect(typeof (entry.detail as Record<string, unknown>)?.['technicianId']).toBe(
          'string',
        );
      }
    }

    const adminView = await getAdminTimeline(requireDb(), inspection.id);
    expect(JSON.stringify(adminView)).toContain(internalNote);

    const publicNote = `Perbaikan selesai publik ${randomUUID()} lampu menyala`;
    const resolved = await transitionReport(
      requireDb(),
      inRepair.id,
      'RESOLVED',
      inRepair.version,
      actor(),
      publicNote,
    );
    expect(resolved.status).toBe('RESOLVED');
    const reporterAfter = await getReporterTimeline(requireDb(), inspection.id, reporterId);
    expect(JSON.stringify(reporterAfter)).toContain(publicNote);
  });

  it('admin timeline is chronological and contains assignment + relation entries', async () => {
    const assigned = await makeAssigned();
    const other = await makeReport();
    await linkSupportingReport(requireDb(), {
      sourceReportId: assigned.id,
      targetReportId: other.id,
      relationType: 'RELATED',
      createdBy: adminId,
    });
    await addPublicUpdate(
      requireDb(),
      assigned.id,
      'Pembaruan kronologi untuk pengujian urutan waktu',
      (await refresh(assigned.id)).version,
      actor(),
    );

    const timeline = await getAdminTimeline(requireDb(), assigned.id);
    expect(timeline.some((e) => e.kind === 'assignment')).toBe(true);
    expect(timeline.some((e) => e.kind === 'relation')).toBe(true);
    expect(timeline.some((e) => e.kind === 'event')).toBe(true);
    expect(timeline.some((e) => e.kind === 'update')).toBe(true);
    for (let i = 1; i < timeline.length; i++) {
      expect(timeline[i]?.at.getTime()).toBeGreaterThanOrEqual(
        timeline[i - 1]?.at.getTime() ?? 0,
      );
    }
  });

  it('updates are blocked on CLOSED reports with 400', async () => {
    const inRepair = await makeInRepair();
    const resolved = await transitionReport(
      requireDb(),
      inRepair.id,
      'RESOLVED',
      inRepair.version,
      actor(),
      'Perbaikan selesai, lampu sudah menyala kembali',
    );
    const closed = await transitionReport(
      requireDb(),
      resolved.id,
      'CLOSED',
      resolved.version,
      actor(),
    );
    await expect(
      addPublicUpdate(requireDb(), closed.id, 'Upaya pembaruan setelah tutup laporan', closed.version, actor()),
    ).rejects.toMatchObject({ status: 400 });
  });
});
