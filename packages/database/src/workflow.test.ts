// Workflow core verify mutation (P5-3, trimmed 2026-10-15 per the AI design).
//
// Pure validation tests run offline (no DB touched — the stub handle is never
// reached on malformed input). DB-gated integration uses a SCRATCH database
// (`silapor_p53_test`) created/dropped in beforeAll/afterAll — the shared dev
// database is never touched. Without a reachable PostgreSQL the integration
// suite skips (same offline-skip contract as reports.test.ts).
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
  reportEvents,
  users,
} from './schema.js';
import {
  verifyReport,
  withReportLock,
  type VerifyReportInput,
} from './workflow.js';

type WorkflowDb = Parameters<typeof verifyReport>[0];

const UUID_A = '11111111-1111-4111-8111-111111111111';
const UUID_B = '22222222-2222-4222-8222-222222222222';

// Untouched handle: pure-validation paths throw before the first query, so a
// missing handle proves no DB access happened.
const UNTOUCHED_DB = undefined as unknown as WorkflowDb;
const ACTOR = { actorId: UUID_A };

function validVerifyInput(overrides: Partial<VerifyReportInput> = {}): VerifyReportInput {
  return {
    finalCategoryId: UUID_A,
    finalIssueTypeId: UUID_B,
    finalPriority: 'LOW',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Pure validation (no DB).
// ---------------------------------------------------------------------------

describe('workflow input validation (pure, offline)', () => {
  it('withReportLock rejects a malformed reportId with 400', async () => {
    await expect(
      withReportLock(UNTOUCHED_DB, 'not-a-uuid', 1, async () => 'unreachable'),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('verifyReport rejects a malformed reportId with 400', async () => {
    await expect(
      verifyReport(UNTOUCHED_DB, 'not-a-uuid', validVerifyInput(), 1, ACTOR),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('verifyReport rejects non-object input with 400', async () => {
    await expect(
      verifyReport(UNTOUCHED_DB, UUID_A, null as never, 1, ACTOR),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('verifyReport rejects malformed finalCategoryId / finalIssueTypeId with 400', async () => {
    await expect(
      verifyReport(UNTOUCHED_DB, UUID_A, validVerifyInput({ finalCategoryId: 'bogus' }), 1, ACTOR),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      verifyReport(UNTOUCHED_DB, UUID_A, validVerifyInput({ finalIssueTypeId: '' }), 1, ACTOR),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('verifyReport rejects CRITICAL priority with 400 (no CRITICAL level)', async () => {
    await expect(
      verifyReport(
        UNTOUCHED_DB,
        UUID_A,
        validVerifyInput({ finalPriority: 'CRITICAL' as never }),
        1,
        ACTOR,
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('verifyReport rejects malformed assetId / locationId / affectedReporters with 400', async () => {
    await expect(
      verifyReport(UNTOUCHED_DB, UUID_A, validVerifyInput({ assetId: 'bogus' }), 1, ACTOR),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      verifyReport(UNTOUCHED_DB, UUID_A, validVerifyInput({ locationId: 'bogus' }), 1, ACTOR),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      verifyReport(UNTOUCHED_DB, UUID_A, validVerifyInput({ affectedReporters: -1 }), 1, ACTOR),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      verifyReport(
        UNTOUCHED_DB,
        UUID_A,
        validVerifyInput({ affectedReporters: Number.NaN }),
        1,
        ACTOR,
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
});

// ---------------------------------------------------------------------------
// DB-gated integration (scratch database, live only).
// ---------------------------------------------------------------------------

const SCRATCH_DB_NAME = 'silapor_p53_test';

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

describe.skipIf(!enabled)('workflow mutations (requires reachable PostgreSQL)', () => {
  const url = scratchUrl(baseUrl);
  let close: () => Promise<void> = async () => undefined;
  let db: ReturnType<typeof getDb>['db'] | undefined;

  let adminId = '';
  let inactiveAdminId = '';
  let reporterId = '';
  let locId = '';
  let catId = '';
  let itNormalId = '';
  let itDangerousId = '';
  let assetId = '';

  const requireDb = (): NonNullable<typeof db> => {
    if (db === undefined) {
      throw new Error('test db not initialised');
    }
    return db;
  };

  // Direct REPORTED insert (bypasses createReport: no ticket-counter coupling).
  async function makeReport(overrides: { assetId?: string | null } = {}) {
    const handle = requireDb();
    const rows = await handle
      .insert(maintenanceReports)
      .values({
        ticketNumber: `P53-${randomUUID()}`,
        idempotencyKey: randomUUID(),
        reporterId,
        locationId: locId,
        assetId: overrides.assetId === undefined ? assetId : overrides.assetId,
        submittedCategoryId: catId,
        submittedIssueTypeId: itNormalId,
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

  async function eventsFor(reportId: string) {
    return await requireDb()
      .select()
      .from(reportEvents)
      .where(eq(reportEvents.reportId, reportId));
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
      adminId = await insertUser('p53-admin', 'ADMIN');
      reporterId = await insertUser('p53-reporter', 'REPORTER');
      inactiveAdminId = await insertUser('p53-inactive-admin', 'ADMIN');
      await db!
        .update(users)
        .set({ isActive: false })
        .where(eq(users.id, inactiveAdminId));

      const locRows = await db!
        .insert(locations)
        .values({ type: 'ROOM', code: 'P53-ROOM', name: 'P5-3 room', tierScore: 10 })
        .returning({ id: locations.id });
      locId = locRows[0]?.id ?? '';
      const catRows = await db!
        .insert(facilityCategories)
        .values({ code: 'P53-CAT', name: 'P5-3 category', weight: 10 })
        .returning({ id: facilityCategories.id });
      catId = catRows[0]?.id ?? '';
      const itRows = await db!
        .insert(issueTypes)
        .values([
          { code: 'P53-IT-NORMAL', name: 'P5-3 normal', categoryId: catId },
          { code: 'DANGEROUS', name: 'P5-3 dangerous', categoryId: catId },
        ])
        .returning({ id: issueTypes.id });
      itNormalId = itRows[0]?.id ?? '';
      itDangerousId = itRows[1]?.id ?? '';
      const assetRows = await db!
        .insert(facilityAssets)
        .values({
          assetCode: 'P53-ASSET',
          name: 'P5-3 asset',
          categoryId: catId,
          locationId: locId,
          weight: 10,
        })
        .returning({ id: facilityAssets.id });
      assetId = assetRows[0]?.id ?? '';
      if (
        adminId === '' ||
        reporterId === '' ||
        locId === '' ||
        catId === '' ||
        itNormalId === '' ||
        itDangerousId === '' ||
        assetId === ''
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

  const actor = () => ({ actorId: adminId, requestId: 'p53-req-1' });

  function verifyInput(overrides: Partial<VerifyReportInput> = {}): VerifyReportInput {
    return {
      finalCategoryId: catId,
      finalIssueTypeId: itNormalId,
      finalPriority: 'LOW',
      affectedReporters: 1,
      ...overrides,
    };
  }

  it('verify happy path: VERIFIED + score snapshot + decidedBy/At + version+1 + events/audit/outbox', async () => {
    const created = await makeReport();
    // 10 (category) + 10 (asset) + 10 (location) + 0 (frequency for 1) = 30 → LOW.
    const next = await verifyReport(requireDb(), created.id, verifyInput(), 1, actor());

    expect(next.status).toBe('VERIFIED');
    expect(next.version).toBe(2);
    expect(next.finalCategoryId).toBe(catId);
    expect(next.finalIssueTypeId).toBe(itNormalId);
    expect(next.priorityScore).toBe(30);
    expect(next.finalPriority).toBe('LOW');
    expect(next.priorityDecidedBy).toBe(adminId);
    expect(next.priorityDecidedAt).not.toBeNull();
    expect(next.verifiedAt).not.toBeNull();
    expect(next.scoringConfigVersion).toBe(1);
    const factors = next.priorityFactors as Record<string, unknown>;
    expect(factors['scoringComplete']).toBe(true);

    const events = await eventsFor(created.id);
    expect(events.map((e) => e.eventType).sort()).toEqual(['PRIORITY_CHANGED', 'REPORT_VERIFIED']);
    const priorityEvent = events.find((e) => e.eventType === 'PRIORITY_CHANGED');
    expect(priorityEvent?.toValue).toBe('LOW');
    expect(
      (priorityEvent?.metadata as Record<string, unknown>)?.['suggestedPriority'],
    ).toBe('LOW');

    const audits = await auditsFor(created.id);
    expect(audits.some((a) => a.action === 'REPORT_VERIFIED')).toBe(true);
    expect(audits[0]?.entityType).toBe('maintenance_report');

    const outbox = await outboxFor(created.id);
    expect(outbox.length).toBe(1);
    expect(outbox[0]?.type).toBe('WORKFLOW_NOTIFICATION');
    expect(outbox[0]?.status).toBe('PENDING');
    expect((outbox[0]?.payload as Record<string, unknown>)?.['kind']).toBe('REPORT_VERIFIED');
  });

  it('verify rejects an override without reason (400)', async () => {
    const created = await makeReport();
    await expect(
      verifyReport(requireDb(), created.id, verifyInput({ finalPriority: 'HIGH' }), 1, actor()),
    ).rejects.toMatchObject({ status: 400 });
    expect((await refresh(created.id)).status).toBe('REPORTED');
  });

  it('verify accepts an override with a reason and stores it', async () => {
    const created = await makeReport();
    const next = await verifyReport(
      requireDb(),
      created.id,
      verifyInput({ finalPriority: 'HIGH', overrideReason: 'Gedung ujian dipakai besok pagi' }),
      1,
      actor(),
    );
    expect(next.finalPriority).toBe('HIGH');
    expect(next.priorityOverrideReason).toBe('Gedung ujian dipakai besok pagi');
  });

  it('verify rejects a non-REPORTED report (400)', async () => {
    const created = await makeReport();
    await verifyReport(requireDb(), created.id, verifyInput(), 1, actor());
    await expect(
      verifyReport(requireDb(), created.id, verifyInput(), 2, actor()),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('verify keeps the DANGEROUS min-HIGH suggestion in the stored snapshot', async () => {
    const created = await makeReport();
    // Score is LOW (30) but DANGEROUS forces the suggestion to HIGH, so HIGH
    // needs no override reason.
    const next = await verifyReport(
      requireDb(),
      created.id,
      verifyInput({ finalIssueTypeId: itDangerousId, finalPriority: 'HIGH' }),
      1,
      actor(),
    );
    expect(next.finalPriority).toBe('HIGH');
    const events = await eventsFor(created.id);
    const priorityEvent = events.find((e) => e.eventType === 'PRIORITY_CHANGED');
    const metadata = priorityEvent?.metadata as Record<string, unknown>;
    expect(metadata['suggestedPriority']).toBe('HIGH');
    expect(metadata['score']).toBe(30);
  });

  it('verify rejects when no effective asset exists (400)', async () => {
    const created = await makeReport({ assetId: null });
    await expect(
      verifyReport(requireDb(), created.id, verifyInput(), 1, actor()),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('verify rejects a missing actor (404) and an inactive actor (400)', async () => {
    const created = await makeReport();
    await expect(
      verifyReport(requireDb(), created.id, verifyInput(), 1, {
        actorId: randomUUID(),
      }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      verifyReport(requireDb(), created.id, verifyInput(), 1, { actorId: inactiveAdminId }),
    ).rejects.toMatchObject({ status: 400 });
    expect((await refresh(created.id)).status).toBe('REPORTED');
  });

  it('stale expectedVersion fails with 409 and leaves the row untouched', async () => {
    const created = await makeReport();
    await expect(
      verifyReport(requireDb(), created.id, verifyInput(), 999, actor()),
    ).rejects.toMatchObject({ status: 409 });
    const current = await refresh(created.id);
    expect(current.status).toBe('REPORTED');
    expect(current.version).toBe(1);
    expect(await eventsFor(created.id)).toEqual([]);
    expect(await auditsFor(created.id)).toEqual([]);
    expect(await outboxFor(created.id)).toEqual([]);
  });
});
