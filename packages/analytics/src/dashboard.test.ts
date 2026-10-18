import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { REPORT_STATUS } from '@silapor/domain';
import {
  facilityAssets,
  facilityCategories,
  getDb,
  locations,
  maintenanceReports,
  reportAssignments,
  resolveDatabaseUrl,
  runMigrations,
  technicians,
  users,
  type Report,
} from '@silapor/database';
import type { AnalyticsDb } from './dashboard.js';
import {
  getOverviewCards,
  getPriorityQueue,
  getReportsByCategory,
  getReportsByLocation,
  getReportsByStatus,
  getResolutionTimeMetrics,
  getTechnicianWorkload,
} from './dashboard.js';
import { jakartaDayRange } from './time.js';

const SCRATCH_DB_NAME = 'silapor_p7_test';

function scratchUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.pathname = `/${SCRATCH_DB_NAME}`;
  return url.toString();
}

// Analytics does not depend on the postgres driver directly, so the scratch
// DB is created and dropped through the existing drizzle client.
async function isReachable(url: string): Promise<boolean> {
  const handle = getDb(url);
  try {
    await handle.db.execute(sql.raw('select 1'));
    return true;
  } catch {
    return false;
  } finally {
    await handle.close().catch(() => undefined);
  }
}

async function recreateScratchDatabase(baseUrl: string): Promise<void> {
  const handle = getDb(baseUrl);
  try {
    await handle.db.execute(sql.raw(`DROP DATABASE IF EXISTS "${SCRATCH_DB_NAME}"`));
    await handle.db.execute(sql.raw(`CREATE DATABASE "${SCRATCH_DB_NAME}"`));
  } finally {
    await handle.close();
  }
}

async function dropScratchDatabase(baseUrl: string): Promise<void> {
  const handle = getDb(baseUrl);
  try {
    await handle.db.execute(sql.raw(`DROP DATABASE IF EXISTS "${SCRATCH_DB_NAME}"`));
  } finally {
    await handle.close();
  }
}

const baseUrl = resolveDatabaseUrl(process.env['DATABASE_URL']);
const enabled = await isReachable(baseUrl);

describe.skipIf(!enabled)('dashboard metrics (requires reachable PostgreSQL)', () => {
  const url = scratchUrl(baseUrl);
  let close: () => Promise<void> = async () => undefined;
  let db: AnalyticsDb | undefined;

  let hvacId = '';
  let electricalId = '';
  let roomId = '';
  let reporterAId = '';
  let reporterBId = '';
  let budiId = '';
  let sariId = '';
  let andiId = '';

  const r1Ticket = 'P7-0001';
  const r2Ticket = 'P7-0002';
  const r3Ticket = 'P7-0003';
  const r4Ticket = 'P7-0004';
  const r5Ticket = 'P7-0005';
  const r6Ticket = 'P7-0006';
  const r7Ticket = 'P7-0007';
  const r8Ticket = 'P7-0008';
  const r9Ticket = 'P7-0009';
  const r10Ticket = 'P7-0010';

  const range = jakartaDayRange({ from: '2026-10-01', to: '2026-10-18' }) as {
    from: Date;
    toExclusive: Date;
  };
  const zeroRange = jakartaDayRange({ from: '2025-01-01', to: '2025-01-02' }) as {
    from: Date;
    toExclusive: Date;
  };
  const octNow = new Date('2026-10-15T00:00:00.000Z');

  const requireDb = (): AnalyticsDb => {
    if (db === undefined) {
      throw new Error('test db not initialised');
    }
    return db;
  };

  async function insertFixtureReport(input: {
    ticketNumber: string;
    status: Report['status'];
    reporterId: string;
    reportedAt: Date;
    finalCategoryId?: string | null;
    finalPriority?: 'LOW' | 'MEDIUM' | 'HIGH' | null;
    resolvedAt?: Date | null;
    closedAt?: Date | null;
  }): Promise<string> {
    const rows = await requireDb()
      .insert(maintenanceReports)
      .values({
        ticketNumber: input.ticketNumber,
        idempotencyKey: randomUUID(),
        reporterId: input.reporterId,
        locationId: roomId,
        assetId: null,
        submittedCategoryId: hvacId,
        description: 'Kipas angin ruangan berhenti berputar sama sekali.',
        status: input.status,
        finalCategoryId: input.finalCategoryId ?? null,
        finalPriority: input.finalPriority ?? null,
        reportedAt: input.reportedAt,
        resolvedAt: input.resolvedAt ?? null,
        closedAt: input.closedAt ?? null,
      })
      .returning({ id: maintenanceReports.id });
    const row = rows[0];
    if (row === undefined) {
      throw new Error('fixture: report insert failed');
    }
    return row.id;
  }

  beforeAll(async () => {
    await recreateScratchDatabase(baseUrl);
    const handle = getDb(url);
    db = handle.db;
    close = handle.close;
    await runMigrations(url);
    const d = requireDb();

    const adminRows = await d
      .insert(users)
      .values({ username: 'p7-admin', role: 'ADMIN' })
      .returning({ id: users.id });
    const adminId = adminRows[0]?.id ?? '';
    const reporterARows = await d
      .insert(users)
      .values({ username: 'p7-reporter-a', role: 'REPORTER' })
      .returning({ id: users.id });
    reporterAId = reporterARows[0]?.id ?? '';
    const reporterBRows = await d
      .insert(users)
      .values({ username: 'p7-reporter-b', role: 'REPORTER' })
      .returning({ id: users.id });
    reporterBId = reporterBRows[0]?.id ?? '';

    const buildingRows = await d
      .insert(locations)
      .values({ type: 'BUILDING', code: 'P7-BLD', name: 'Gedung C' })
      .returning({ id: locations.id });
    const buildingId = buildingRows[0]?.id ?? '';
    const roomRows = await d
      .insert(locations)
      .values({
        type: 'ROOM',
        code: 'P7-ROM',
        name: 'Ruang Kuliah 01',
        parentId: buildingId,
        buildingCode: 'P7-BLD',
      })
      .returning({ id: locations.id });
    roomId = roomRows[0]?.id ?? '';

    const hvacRows = await d
      .insert(facilityCategories)
      .values({ code: 'HVAC', name: 'HVAC' })
      .returning({ id: facilityCategories.id });
    hvacId = hvacRows[0]?.id ?? '';
    const electricalRows = await d
      .insert(facilityCategories)
      .values({ code: 'ELECTRICAL', name: 'ELECTRICAL' })
      .returning({ id: facilityCategories.id });
    electricalId = electricalRows[0]?.id ?? '';

    const budiRows = await d
      .insert(technicians)
      .values({ technicianCode: 'P7-TECH-1', displayName: 'Budi', specialty: 'HVAC' })
      .returning({ id: technicians.id });
    budiId = budiRows[0]?.id ?? '';
    const sariRows = await d
      .insert(technicians)
      .values({ technicianCode: 'P7-TECH-2', displayName: 'Sari', specialty: 'ELECTRICAL' })
      .returning({ id: technicians.id });
    sariId = sariRows[0]?.id ?? '';
    const andiRows = await d
      .insert(technicians)
      .values({ technicianCode: 'P7-TECH-3', displayName: 'Andi' })
      .returning({ id: technicians.id });
    andiId = andiRows[0]?.id ?? '';

    await d
      .insert(facilityAssets)
      .values({ assetCode: 'P7-AC-01', categoryId: hvacId, locationId: roomId, name: 'AC Ruang 01' });

    await insertFixtureReport({
      ticketNumber: r1Ticket,
      status: 'REPORTED',
      reporterId: reporterAId,
      reportedAt: new Date('2026-10-01T03:00:00.000Z'),
    });
    await insertFixtureReport({
      ticketNumber: r2Ticket,
      status: 'VERIFIED',
      reporterId: reporterBId,
      reportedAt: new Date('2026-10-02T03:00:00.000Z'),
      finalCategoryId: hvacId,
      finalPriority: 'HIGH',
    });
    const r3Id = await insertFixtureReport({
      ticketNumber: r3Ticket,
      status: 'IN_REPAIR',
      reporterId: reporterAId,
      reportedAt: new Date('2026-10-03T03:00:00.000Z'),
      finalCategoryId: hvacId,
      finalPriority: 'MEDIUM',
    });
    await insertFixtureReport({
      ticketNumber: r4Ticket,
      status: 'RESOLVED',
      reporterId: reporterBId,
      reportedAt: new Date('2026-10-08T05:00:00.000Z'),
      finalCategoryId: electricalId,
      resolvedAt: new Date('2026-10-10T05:00:00.000Z'),
    });
    await insertFixtureReport({
      ticketNumber: r5Ticket,
      status: 'CLOSED',
      reporterId: reporterAId,
      reportedAt: new Date('2026-10-09T05:00:00.000Z'),
      finalCategoryId: electricalId,
      resolvedAt: new Date('2026-10-11T05:00:00.000Z'),
      closedAt: new Date('2026-10-12T05:00:00.000Z'),
    });
    await insertFixtureReport({
      ticketNumber: r6Ticket,
      status: 'CLOSED',
      reporterId: reporterBId,
      reportedAt: new Date('2026-09-25T03:00:00.000Z'),
      resolvedAt: new Date('2026-09-29T03:00:00.000Z'),
    });
    await insertFixtureReport({
      ticketNumber: r7Ticket,
      status: 'REPORTED',
      reporterId: reporterAId,
      reportedAt: new Date('2026-09-30T17:00:00.000Z'),
    });
    await insertFixtureReport({
      ticketNumber: r8Ticket,
      status: 'REPORTED',
      reporterId: reporterBId,
      reportedAt: new Date('2026-09-30T16:59:59.000Z'),
    });
    await insertFixtureReport({
      ticketNumber: r9Ticket,
      status: 'REJECTED',
      reporterId: reporterAId,
      reportedAt: new Date('2026-10-02T03:00:00.000Z'),
    });
    const r10Id = await insertFixtureReport({
      ticketNumber: r10Ticket,
      status: 'ASSIGNED',
      reporterId: reporterBId,
      reportedAt: new Date('2026-10-04T03:00:00.000Z'),
      finalCategoryId: electricalId,
      finalPriority: 'LOW',
    });

    await d.insert(reportAssignments).values([
      { reportId: r3Id, technicianId: budiId, assignedBy: adminId },
      {
        reportId: r10Id,
        technicianId: budiId,
        assignedBy: adminId,
        unassignedAt: new Date('2026-10-05T03:00:00.000Z'),
      },
      { reportId: r10Id, technicianId: sariId, assignedBy: adminId },
    ]);
  });

  afterAll(async () => {
    await close();
    await dropScratchDatabase(baseUrl);
  });

  it('summarises the overview cards', async () => {
    const cards = await getOverviewCards(requireDb(), range, octNow);
    expect(cards).toEqual({
      totalReports: 7,
      activeReports: 6,
      inRepair: 1,
      highPriorityActive: 1,
      resolvedThisMonth: 2,
    });
  });

  it('zero-fills every canonical status in order', async () => {
    const byStatus = await getReportsByStatus(requireDb(), range);
    expect(byStatus.map((item) => item.status)).toEqual([...REPORT_STATUS]);
    expect(byStatus).toEqual([
      { status: 'REPORTED', count: 2 },
      { status: 'VERIFIED', count: 1 },
      { status: 'ASSIGNED', count: 1 },
      { status: 'INSPECTION', count: 0 },
      { status: 'IN_REPAIR', count: 1 },
      { status: 'RESOLVED', count: 1 },
      { status: 'CLOSED', count: 1 },
    ]);
  });

  it('groups reported-in-range rows by final category, unclassified last', async () => {
    const byCategory = await getReportsByCategory(requireDb(), range);
    expect(byCategory).toEqual([
      { categoryId: electricalId, categoryName: 'ELECTRICAL', count: 3 },
      { categoryId: hvacId, categoryName: 'HVAC', count: 2 },
      { categoryId: null, categoryName: null, count: 2 },
    ]);
    const limited = await getReportsByCategory(requireDb(), range, 2);
    expect(limited).toEqual([
      { categoryId: electricalId, categoryName: 'ELECTRICAL', count: 3 },
      { categoryId: hvacId, categoryName: 'HVAC', count: 2 },
    ]);
  });

  it('groups reported-in-range rows by location', async () => {
    const byLocation = await getReportsByLocation(requireDb(), range);
    expect(byLocation).toEqual([
      { locationId: roomId, locationName: 'Ruang Kuliah 01', count: 7 },
    ]);
  });

  it('measures resolution time from resolved-in-range rows', async () => {
    const resolution = await getResolutionTimeMetrics(requireDb(), range);
    expect(resolution).toEqual({ sampleSize: 2, averageSeconds: 172800, medianSeconds: 172800 });
  });

  it('places the Jakarta midnight exactly on the day boundary', async () => {
    const firstOfOctober = jakartaDayRange({ from: '2026-10-01', to: '2026-10-01' }) as {
      from: Date;
      toExclusive: Date;
    };
    const octoberCards = await getOverviewCards(requireDb(), firstOfOctober, octNow);
    expect(octoberCards.totalReports).toBe(2);

    const lastOfSeptember = jakartaDayRange({ from: '2026-09-30', to: '2026-09-30' }) as {
      from: Date;
      toExclusive: Date;
    };
    const septemberCards = await getOverviewCards(requireDb(), lastOfSeptember, octNow);
    expect(septemberCards.totalReports).toBe(1);
    expect(await getReportsByStatus(requireDb(), lastOfSeptember)).toEqual([
      { status: 'REPORTED', count: 1 },
      { status: 'VERIFIED', count: 0 },
      { status: 'ASSIGNED', count: 0 },
      { status: 'INSPECTION', count: 0 },
      { status: 'IN_REPAIR', count: 0 },
      { status: 'RESOLVED', count: 0 },
      { status: 'CLOSED', count: 0 },
    ]);
  });

  it('excludes the legacy REJECTED row from every metric', async () => {
    const cards = await getOverviewCards(requireDb(), range, octNow);
    expect(cards.totalReports).toBe(7);

    const byStatus = await getReportsByStatus(requireDb(), range);
    expect(byStatus.some((item) => item.status === 'REJECTED')).toBe(false);
    expect(byStatus.reduce((sum, item) => sum + item.count, 0)).toBe(7);

    const byCategory = await getReportsByCategory(requireDb(), range);
    expect(byCategory.reduce((sum, item) => sum + item.count, 0)).toBe(7);
    expect(byCategory.at(-1)).toEqual({ categoryId: null, categoryName: null, count: 2 });

    const byLocation = await getReportsByLocation(requireDb(), range);
    expect(byLocation.reduce((sum, item) => sum + item.count, 0)).toBe(7);

    const resolution = await getResolutionTimeMetrics(requireDb(), range);
    expect(resolution).toEqual({ sampleSize: 2, averageSeconds: 172800, medianSeconds: 172800 });
  });

  it('returns zeroed metrics for an empty range', async () => {
    const now = new Date('2025-01-15T00:00:00.000Z');
    expect(await getOverviewCards(requireDb(), zeroRange, now)).toEqual({
      totalReports: 0,
      activeReports: 0,
      inRepair: 0,
      highPriorityActive: 0,
      resolvedThisMonth: 0,
    });
    expect(await getResolutionTimeMetrics(requireDb(), zeroRange)).toEqual({
      sampleSize: 0,
      averageSeconds: null,
      medianSeconds: null,
    });
    expect(await getReportsByStatus(requireDb(), zeroRange)).toEqual(
      REPORT_STATUS.map((status) => ({ status, count: 0 })),
    );
    expect(await getReportsByCategory(requireDb(), zeroRange)).toEqual([]);
    expect(await getReportsByLocation(requireDb(), zeroRange)).toEqual([]);
  });

  it('counts active ASSIGNED..IN_REPAIR reports per active technician', async () => {
    // R10 counts once under Sari: the Budi row with unassigned_at set is stale.
    // R2 (VERIFIED) is never assigned; Andi has no assignments at all.
    expect(await getTechnicianWorkload(requireDb())).toEqual([
      { technicianId: budiId, technicianName: 'Budi', activeCount: 1 },
      { technicianId: sariId, technicianName: 'Sari', activeCount: 1 },
      { technicianId: andiId, technicianName: 'Andi', activeCount: 0 },
    ]);
  });

  it('orders the priority queue by priority then reported_at', async () => {
    const queue = await getPriorityQueue(requireDb(), 10);
    expect(queue.map((item) => item.finalPriority)).toEqual([
      'HIGH',
      'MEDIUM',
      'LOW',
      null,
      null,
      null,
    ]);
    // The queue has no range filter, so boundary-out R8 (16:59:59Z) is open too
    // and precedes R7's 17:00:00Z among equal (null) priorities.
    expect(queue.map((item) => item.ticketNumber)).toEqual([
      r2Ticket,
      r3Ticket,
      r10Ticket,
      r8Ticket,
      r7Ticket,
      r1Ticket,
    ]);
    const limited = await getPriorityQueue(requireDb(), 1);
    expect(limited.length).toBe(1);
    expect(limited[0]!.ticketNumber).toBe(r2Ticket);
  });

  it('counts ~200 in-range reports at volume', async () => {
    const before = await getOverviewCards(requireDb(), range, octNow);
    await requireDb()
      .insert(maintenanceReports)
      .values(
        Array.from({ length: 200 }, (_, index) => ({
          ticketNumber: `P7-V${String(index + 1).padStart(4, '0')}`,
          idempotencyKey: randomUUID(),
          reporterId: reporterAId,
          locationId: roomId,
          assetId: null,
          submittedCategoryId: hvacId,
          description: 'Laporan volume untuk pengujian analitik dashboard.',
          status: 'REPORTED' as const,
          reportedAt: new Date(Date.UTC(2026, 9, 5, 0, 0, index)),
        })),
      );
    const after = await getOverviewCards(requireDb(), range, octNow);
    expect(after.totalReports).toBe(before.totalReports + 200);
    const byStatus = await getReportsByStatus(requireDb(), range);
    expect(byStatus.reduce((sum, item) => sum + item.count, 0)).toBe(after.totalReports);
  });
});
