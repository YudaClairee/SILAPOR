// P3-2 createReport transaction + idempotency + duplicate warning (Phase 3 backend).
//
// Pure validator tests run offline. DB-gated integration uses a SCRATCH
// database (`silapor_p32_test`) created/dropped in beforeAll/afterAll — the
// shared dev database is never touched. Without a reachable PostgreSQL the
// integration suite skips (same offline-skip contract as db.integration.test.ts
// and reports-schema.test.ts).
import postgres from 'postgres';
import { randomUUID } from 'node:crypto';
import { describe, expect, it, afterAll, beforeAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb, resolveDatabaseUrl } from './index.js';
import { runMigrations } from './migrate.js';
import {
  facilityAssets,
  facilityCategories,
  issueTypes,
  locations,
  maintenanceReports,
  outboxEvents,
  reportAttachments,
  reportEvents,
  reportRelations,
  users,
} from './schema.js';
import {
  buildSearchPattern,
  countAffectedReporters,
  createReport,
  findDuplicateCandidates,
  getAdminReportDetail,
  getJakartaYear,
  getMyReportDetail,
  getMyReportTimeline,
  isForeignKeyViolation,
  isUniqueViolation,
  linkSupportingReport,
  listAllReports,
  listMyReports,
  reportOrderBy,
  validateCreateReportInput,
} from './reports.js';

const VALID_UUID_A = '11111111-1111-4111-8111-111111111111';
const VALID_UUID_B = '22222222-2222-4222-8222-222222222222';
const VALID_UUID_C = '33333333-3333-4333-8333-333333333333';
const VALID_UUID_D = '44444444-4444-4444-8444-444444444444';
const VALID_UUID_E = '55555555-5555-4555-8555-555555555555';

function validInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    reporterId: VALID_UUID_A,
    locationId: VALID_UUID_B,
    assetId: VALID_UUID_C,
    submittedCategoryId: VALID_UUID_D,
    submittedIssueTypeId: VALID_UUID_E,
    description: 'Lampu ruangan mati total sejak pagi, mohon segera diperbaiki.',
    occurredAt: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Pure validator (no DB).
// ---------------------------------------------------------------------------

describe('validateCreateReportInput (pure)', () => {
  it('accepts a fully-populated valid input', () => {
    expect(validateCreateReportInput(validInput())).toEqual([]);
  });

  it('accepts nullable assetId / submittedIssueTypeId / occurredAt as null or omitted', () => {
    const rest: Record<string, unknown> = validInput();
    delete rest['assetId'];
    delete rest['submittedIssueTypeId'];
    delete rest['occurredAt'];
    expect(validateCreateReportInput(rest)).toEqual([]);
    expect(
      validateCreateReportInput({ ...rest, assetId: null, submittedIssueTypeId: null }),
    ).toEqual([]);
  });

  it('rejects non-object input', () => {
    expect(validateCreateReportInput(null).length).toBeGreaterThan(0);
    expect(validateCreateReportInput('report').length).toBeGreaterThan(0);
    expect(validateCreateReportInput([]).length).toBeGreaterThan(0);
  });

  it('rejects a description shorter than 10 trimmed chars', () => {
    expect(validateCreateReportInput(validInput({ description: 'pendek' })).length).toBeGreaterThan(
      0,
    );
    expect(validateCreateReportInput(validInput({ description: '123456789' })).length).toBeGreaterThan(
      0,
    );
    expect(validateCreateReportInput(validInput({ description: '   ' })).length).toBeGreaterThan(0);
  });

  it('rejects a missing or non-string description', () => {
    const rest: Record<string, unknown> = validInput();
    delete rest['description'];
    expect(validateCreateReportInput(rest).length).toBeGreaterThan(0);
    expect(validateCreateReportInput(validInput({ description: 42 })).length).toBeGreaterThan(0);
  });

  it('accepts descriptions at the 10 and 2000 boundary, rejects 2001', () => {
    expect(validateCreateReportInput(validInput({ description: '1234567890' }))).toEqual([]);
    expect(validateCreateReportInput(validInput({ description: 'x'.repeat(2000) }))).toEqual([]);
    expect(
      validateCreateReportInput(validInput({ description: 'x'.repeat(2001) })).length,
    ).toBeGreaterThan(0);
  });

  it('rejects missing or malformed UUID references', () => {
    expect(validateCreateReportInput(validInput({ reporterId: undefined })).length).toBeGreaterThan(
      0,
    );
    expect(validateCreateReportInput(validInput({ locationId: 'not-a-uuid' })).length).toBeGreaterThan(
      0,
    );
    expect(
      validateCreateReportInput(validInput({ submittedCategoryId: '' })).length,
    ).toBeGreaterThan(0);
  });

  it('rejects malformed optional references but allows null', () => {
    expect(validateCreateReportInput(validInput({ assetId: '  ' })).length).toBeGreaterThan(0);
    expect(validateCreateReportInput(validInput({ assetId: 42 })).length).toBeGreaterThan(0);
    expect(
      validateCreateReportInput(validInput({ submittedIssueTypeId: 'bogus' })).length,
    ).toBeGreaterThan(0);
  });

  it('rejects an invalid or future occurredAt, accepts past and null', () => {
    expect(validateCreateReportInput(validInput({ occurredAt: 'not-a-date' })).length).toBeGreaterThan(
      0,
    );
    expect(
      validateCreateReportInput(
        validInput({ occurredAt: new Date(Date.now() + 3_600_000).toISOString() }),
      ).length,
    ).toBeGreaterThan(0);
    expect(
      validateCreateReportInput(
        validInput({ occurredAt: new Date(Date.now() - 3_600_000).toISOString() }),
      ),
    ).toEqual([]);
    expect(validateCreateReportInput(validInput({ occurredAt: null }))).toEqual([]);
  });

  it('ignores unknown and future fields without crashing', () => {
    expect(
      validateCreateReportInput({
        ...validInput(),
        status: 'CLOSED',
        futureField: { nested: true },
      }),
    ).toEqual([]);
  });
});

describe('getJakartaYear (pure)', () => {
  it('resolves the Asia/Jakarta calendar year (UTC New Year eve is already next year in Jakarta)', () => {
    // 2025-12-31T18:00:00Z == 2026-01-01T01:00:00+07:00.
    expect(getJakartaYear(new Date('2025-12-31T18:00:00.000Z'))).toBe(2026);
    expect(getJakartaYear(new Date('2026-06-15T12:00:00.000Z'))).toBe(2026);
  });
});

describe('error-code mappers (pure)', () => {
  it('detects unique violations by code, nested cause, and message', () => {
    expect(isUniqueViolation({ code: '23505' })).toBe(true);
    expect(isUniqueViolation(new Error('duplicate key value violates unique constraint'))).toBe(
      true,
    );
    expect(isUniqueViolation({ cause: { code: '23505' } })).toBe(true);
    expect(isUniqueViolation(new Error('connection reset'))).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });

  it('detects foreign-key violations by 23503 code (direct or nested)', () => {
    expect(isForeignKeyViolation({ code: '23503' })).toBe(true);
    expect(
      isForeignKeyViolation(
        new Error('violates foreign key constraint "maintenance_reports_reporter_id_users_id_fk"'),
      ),
    ).toBe(true);
    expect(isForeignKeyViolation({ cause: { cause: { code: '23503' } } })).toBe(true);
    expect(isForeignKeyViolation(new Error('duplicate key value'))).toBe(false);
    expect(isForeignKeyViolation(undefined)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// DB-gated integration (scratch database, live only).
// ---------------------------------------------------------------------------

const SCRATCH_DB_NAME = 'silapor_p32_test';

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

describe.skipIf(!enabled)('createReport + findDuplicateCandidates (requires reachable PostgreSQL)', () => {
  const url = scratchUrl(baseUrl);
  let close: () => Promise<void> = async () => undefined;
  let db: ReturnType<typeof getDb>['db'] | undefined;

  let reporterA = '';
  let reporterB = '';
  let locA = '';
  let locB = '';
  let catElec = '';
  let catHvac = '';
  let catInactive = '';
  let itElec = '';
  let itHvac = '';
  let itGeneric = '';
  let assetElec1 = '';
  let assetElec2 = '';
  let assetElec3 = '';
  let assetElec4 = '';
  let assetHvac1 = '';
  let assetInactive = '';

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

      const insertUser = async (username: string): Promise<string> => {
        const rows = await db!
          .insert(users)
          .values({ username, role: 'REPORTER' })
          .returning({ id: users.id });
        const id = rows[0]?.id;
        if (id === undefined) {
          throw new Error('fixture: user insert failed');
        }
        return id;
      };
      reporterA = await insertUser('p32-reporter-a');
      reporterB = await insertUser('p32-reporter-b');

      const insertLocation = async (code: string): Promise<string> => {
        const rows = await db!
          .insert(locations)
          .values({ type: 'ROOM', code, name: `P3-2 room ${code}` })
          .returning({ id: locations.id });
        const id = rows[0]?.id;
        if (id === undefined) {
          throw new Error('fixture: location insert failed');
        }
        return id;
      };
      locA = await insertLocation('P32-ROOM-A');
      locB = await insertLocation('P32-ROOM-B');

      const insertCategory = async (code: string, isActive: boolean): Promise<string> => {
        const rows = await db!
          .insert(facilityCategories)
          .values({ code, name: `P3-2 ${code}`, isActive })
          .returning({ id: facilityCategories.id });
        const id = rows[0]?.id;
        if (id === undefined) {
          throw new Error('fixture: category insert failed');
        }
        return id;
      };
      catElec = await insertCategory('P32-ELEC', true);
      catHvac = await insertCategory('P32-HVAC', true);
      catInactive = await insertCategory('P32-INACTIVE', false);

      const insertIssueType = async (code: string, categoryId: string | null): Promise<string> => {
        const rows = await db!
          .insert(issueTypes)
          .values({ code, name: `P3-2 ${code}`, categoryId })
          .returning({ id: issueTypes.id });
        const id = rows[0]?.id;
        if (id === undefined) {
          throw new Error('fixture: issue type insert failed');
        }
        return id;
      };
      itElec = await insertIssueType('P32-IT-ELEC', catElec);
      itHvac = await insertIssueType('P32-IT-HVAC', catHvac);
      itGeneric = await insertIssueType('P32-IT-GENERIC', null);

      const insertAsset = async (
        assetCode: string,
        categoryId: string,
        isActive: boolean,
      ): Promise<string> => {
        const rows = await db!
          .insert(facilityAssets)
          .values({ assetCode, name: `P3-2 ${assetCode}`, categoryId, locationId: locA })
          .returning({ id: facilityAssets.id });
        const id = rows[0]?.id;
        if (id === undefined) {
          throw new Error('fixture: asset insert failed');
        }
        if (!isActive) {
          await db!
            .update(facilityAssets)
            .set({ isActive: false })
            .where(eq(facilityAssets.id, id));
        }
        return id;
      };
      assetElec1 = await insertAsset('P32-ASSET-ELEC-1', catElec, true);
      assetElec2 = await insertAsset('P32-ASSET-ELEC-2', catElec, true);
      assetElec3 = await insertAsset('P32-ASSET-ELEC-3', catElec, true);
      assetElec4 = await insertAsset('P32-ASSET-ELEC-4', catElec, true);
      assetHvac1 = await insertAsset('P32-ASSET-HVAC-1', catHvac, true);
      assetInactive = await insertAsset('P32-ASSET-OFF', catElec, false);
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

  it('creates exactly 1 report + 1 REPORT_CREATED event + 1 PENDING outbox row', async () => {
    const result = await createReport(
      db!,
      {
        reporterId: reporterA,
        locationId: locA,
        assetId: assetElec1,
        submittedCategoryId: catElec,
        submittedIssueTypeId: itElec,
        description: 'Lampu ruangan mati total sejak pagi hari, mohon segera diperbaiki.',
        occurredAt: null,
      },
      randomUUID(),
    );
    expect(result.idempotentReplay).toBe(false);
    expect(result.report.status).toBe('REPORTED');
    expect(result.report.version).toBe(1);
    const year = getJakartaYear(new Date());
    expect(result.report.ticketNumber).toMatch(new RegExp(`^MNT-${year}-\\d{6}$`));

    expect(await db!.select().from(maintenanceReports)).toHaveLength(1);
    const events = await db!.select().from(reportEvents);
    expect(events).toHaveLength(1);
    expect(events[0]?.eventType).toBe('REPORT_CREATED');
    expect(events[0]?.reportId).toBe(result.report.id);
    const outbox = await db!.select().from(outboxEvents);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]?.type).toBe('AI_REVIEW_REQUESTED');
    expect(outbox[0]?.status).toBe('PENDING');
    expect(outbox[0]?.payload).toMatchObject({
      reportId: result.report.id,
      ticketNumber: result.report.ticketNumber,
    });
  });

  it('replays the same idempotency key: same ticket, no new rows', async () => {
    const key = randomUUID();
    const first = await createReport(
      db!,
      {
        reporterId: reporterA,
        locationId: locA,
        assetId: assetElec1,
        submittedCategoryId: catElec,
        submittedIssueTypeId: itElec,
        description: 'AC split tidak dingin sama sekali sejak kemarin sore.',
        occurredAt: null,
      },
      key,
    );
    const reportsBefore = await db!.select().from(maintenanceReports);
    const eventsBefore = await db!.select().from(reportEvents);
    const outboxBefore = await db!.select().from(outboxEvents);

    const replay = await createReport(
      db!,
      {
        reporterId: reporterA,
        locationId: locA,
        assetId: assetElec1,
        submittedCategoryId: catElec,
        submittedIssueTypeId: itElec,
        description: 'AC split tidak dingin sama sekali sejak kemarin sore.',
        occurredAt: null,
      },
      key,
    );
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.report.id).toBe(first.report.id);
    expect(replay.report.ticketNumber).toBe(first.report.ticketNumber);
    expect(await db!.select().from(maintenanceReports)).toHaveLength(reportsBefore.length);
    expect(await db!.select().from(reportEvents)).toHaveLength(eventsBefore.length);
    expect(await db!.select().from(outboxEvents)).toHaveLength(outboxBefore.length);
  });

  it('replays the same key even when the retried payload drifted past validation', async () => {
    const key = randomUUID();
    const first = await createReport(
      db!,
      {
        reporterId: reporterA,
        locationId: locA,
        assetId: assetElec1,
        submittedCategoryId: catElec,
        submittedIssueTypeId: itElec,
        description: 'Kabel stop kontak terkelupas dan terlihat berbahaya bagi penghuni.',
        occurredAt: null,
      },
      key,
    );
    const reportsBefore = await db!.select().from(maintenanceReports);
    const eventsBefore = await db!.select().from(reportEvents);
    const outboxBefore = await db!.select().from(outboxEvents);

    // Drifted retry: shape-INVALID payload (too-short description) under the
    // same key must still replay the original ticket, never 400.
    const replay = await createReport(
      db!,
      {
        reporterId: reporterA,
        locationId: locA,
        assetId: assetElec1,
        submittedCategoryId: catElec,
        submittedIssueTypeId: itElec,
        description: 'pendek',
        occurredAt: null,
      },
      key,
    );
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.report.id).toBe(first.report.id);
    expect(replay.report.ticketNumber).toBe(first.report.ticketNumber);
    expect(await db!.select().from(maintenanceReports)).toHaveLength(reportsBefore.length);
    expect(await db!.select().from(reportEvents)).toHaveLength(eventsBefore.length);
    expect(await db!.select().from(outboxEvents)).toHaveLength(outboxBefore.length);
  });

  it('warns on active same-reporter/same-asset repeat; CLOSED clears the warning', async () => {
    const input = {
      reporterId: reporterA,
      locationId: locA,
      assetId: assetElec2,
      submittedCategoryId: catElec,
      submittedIssueTypeId: itElec,
      description: 'Stop kontak mengeluarkan percikan api saat digunakan.',
      occurredAt: null,
    };
    const first = await createReport(db!, input, randomUUID());
    expect(first.duplicateCandidates).toEqual([]);

    const second = await createReport(db!, input, randomUUID());
    expect(second.idempotentReplay).toBe(false);
    expect(second.report.ticketNumber).not.toBe(first.report.ticketNumber);
    // Warning only: the repeat is still created as REPORTED, never auto-marked.
    expect(second.report.status).toBe('REPORTED');
    expect(second.report.duplicateOfReportId).toBeNull();
    expect(second.duplicateCandidates.map((c) => c.ticketNumber)).toContain(
      first.report.ticketNumber,
    );
    expect(await db!.select().from(reportRelations)).toEqual([]);

    // After CLOSED the same input yields no candidate but a new ticket is allowed.
    await db!
      .update(maintenanceReports)
      .set({ status: 'CLOSED' })
      .where(eq(maintenanceReports.id, first.report.id));
    await db!
      .update(maintenanceReports)
      .set({ status: 'CLOSED' })
      .where(eq(maintenanceReports.id, second.report.id));
    const third = await createReport(db!, input, randomUUID());
    expect(third.duplicateCandidates).toEqual([]);
    expect(third.report.status).toBe('REPORTED');
  });

  it('returns no candidate for a different asset or location, and none for a different reporter', async () => {
    // Fresh asset: earlier tests' active rows (assetElec1/assetElec2) must not
    // leak into this test's candidate sets.
    const base = {
      reporterId: reporterA,
      locationId: locA,
      assetId: assetElec3,
      submittedCategoryId: catElec,
      submittedIssueTypeId: itElec,
      description: 'Kabel lampu terlihat terkelupas dan berbahaya bagi pengguna.',
      occurredAt: null,
    };
    const baseCreated = await createReport(db!, base, randomUUID());
    expect(baseCreated.duplicateCandidates).toEqual([]);

    const repeatSame = await createReport(
      db!,
      { ...base, description: 'Saklar lampu patah dan tidak bisa digunakan sama sekali.' },
      randomUUID(),
    );
    expect(repeatSame.duplicateCandidates.map((c) => c.ticketNumber)).toContain(
      baseCreated.report.ticketNumber,
    );

    const switchedAsset = await createReport(
      db!,
      {
        ...base,
        assetId: assetElec4,
        description: 'Lampu di titik lain berkedip terus sejak minggu lalu.',
      },
      randomUUID(),
    );
    expect(switchedAsset.duplicateCandidates).toEqual([]);

    const noAssetOtherLocation = await createReport(
      db!,
      {
        reporterId: reporterA,
        locationId: locB,
        assetId: null,
        submittedCategoryId: catElec,
        submittedIssueTypeId: null,
        description: 'Lampu koridor gedung sebelah mati total sejak tadi malam.',
        occurredAt: null,
      },
      randomUUID(),
    );
    expect(noAssetOtherLocation.duplicateCandidates).toEqual([]);

    const otherReporter = await createReport(
      db!,
      {
        ...base,
        reporterId: reporterB,
        description: 'Lampu ruangan yang sama mati, dilaporkan penghuni lain.',
      },
      randomUUID(),
    );
    expect(otherReporter.duplicateCandidates).toEqual([]);
    expect(otherReporter.report.status).toBe('REPORTED');
    expect(await db!.select().from(reportRelations)).toEqual([]);
  });

  it('never returns CLOSED/REJECTED/DUPLICATE/RESOLVED rows as candidates', async () => {
    const input = {
      reporterId: reporterA,
      locationId: locA,
      assetId: assetHvac1,
      submittedCategoryId: catHvac,
      submittedIssueTypeId: itHvac,
      description: 'Unit outdoor AC berisik dan meneteskan air terus menerus.',
      occurredAt: null,
    };
    const created = await createReport(db!, input, randomUUID());
    await db!
      .update(maintenanceReports)
      .set({ status: 'REJECTED' })
      .where(eq(maintenanceReports.id, created.report.id));
    const probe = await createReport(
      db!,
      { ...input, description: 'Unit outdoor AC masih berisik sampai hari ini.' },
      randomUUID(),
    );
    expect(probe.duplicateCandidates).toEqual([]);
    await db!
      .update(maintenanceReports)
      .set({ status: 'DUPLICATE' })
      .where(eq(maintenanceReports.id, probe.report.id));

    // RESOLVED rows are terminal too: store one and assert exclusion.
    const resolvedFixture = await createReport(
      db!,
      { ...input, description: 'Unit outdoor AC sudah diperbaiki namun masih termonitor.' },
      randomUUID(),
    );
    expect(resolvedFixture.duplicateCandidates).toEqual([]);
    await db!
      .update(maintenanceReports)
      .set({ status: 'RESOLVED' })
      .where(eq(maintenanceReports.id, resolvedFixture.report.id));

    const direct = await findDuplicateCandidates(db!, {
      reporterId: reporterA,
      assetId: assetHvac1,
      locationId: locA,
      categoryId: catHvac,
      issueTypeId: itHvac,
    });
    expect(direct).toEqual([]);
  });

  it('still finds an active match older than the 14-day lookback (fallback scan)', async () => {
    const input = {
      reporterId: reporterB,
      locationId: locB,
      assetId: null,
      submittedCategoryId: catHvac,
      submittedIssueTypeId: itGeneric,
      description: 'Kipas angin plafon berputar lambat dan berbunyi kasar.',
      occurredAt: null,
    };
    const old = await createReport(db!, input, randomUUID());
    await db!
      .update(maintenanceReports)
      .set({ reportedAt: new Date(Date.now() - 20 * 24 * 3_600_000) })
      .where(eq(maintenanceReports.id, old.report.id));

    const fresh = await createReport(
      db!,
      { ...input, description: 'Kipas angin plafon masih lambat sampai minggu ini.' },
      randomUUID(),
    );
    expect(fresh.duplicateCandidates.map((c) => c.ticketNumber)).toContain(
      old.report.ticketNumber,
    );
  });

  it('orders candidates newest first and matches final_category_id too', async () => {
    const input = {
      reporterId: reporterB,
      locationId: locA,
      assetId: assetElec2,
      submittedCategoryId: catElec,
      submittedIssueTypeId: null,
      description: 'Lampu meja belajar redup dan sering mati sendiri.',
      occurredAt: null,
    };
    const first = await createReport(db!, input, randomUUID());
    await db!
      .update(maintenanceReports)
      .set({ reportedAt: new Date(Date.now() - 2 * 3_600_000) })
      .where(eq(maintenanceReports.id, first.report.id));
    const second = await createReport(
      db!,
      { ...input, description: 'Lampu meja belajar masih redup hingga pagi ini.' },
      randomUUID(),
    );
    const candidates = await findDuplicateCandidates(db!, {
      reporterId: reporterB,
      assetId: assetElec2,
      locationId: locA,
      categoryId: catElec,
      issueTypeId: null,
    });
    const tickets = candidates.map((c) => c.ticketNumber);
    expect(tickets).toContain(first.report.ticketNumber);
    expect(tickets).toContain(second.report.ticketNumber);
    expect(tickets.indexOf(second.report.ticketNumber)).toBeLessThan(
      tickets.indexOf(first.report.ticketNumber),
    );

    // Simulate verification retargeting the category: final_category_id matches too.
    await db!
      .update(maintenanceReports)
      .set({ finalCategoryId: catHvac })
      .where(eq(maintenanceReports.id, first.report.id));
    const viaFinal = await findDuplicateCandidates(db!, {
      reporterId: reporterB,
      assetId: assetElec2,
      locationId: locA,
      categoryId: catHvac,
      issueTypeId: null,
    });
    expect(viaFinal.map((c) => c.ticketNumber)).toContain(first.report.ticketNumber);
  });

  it('distinguishes null vs set issue types (IS NOT DISTINCT FROM)', async () => {
    const withNull = await createReport(
      db!,
      {
        reporterId: reporterB,
        locationId: locB,
        assetId: null,
        submittedCategoryId: catElec,
        submittedIssueTypeId: null,
        description: 'Jendela ruangan tidak bisa dikunci dengan benar.',
        occurredAt: null,
      },
      randomUUID(),
    );
    const sameNull = await findDuplicateCandidates(db!, {
      reporterId: reporterB,
      assetId: null,
      locationId: locB,
      categoryId: catElec,
      issueTypeId: null,
    });
    expect(sameNull.map((c) => c.ticketNumber)).toContain(withNull.report.ticketNumber);

    const mismatchedIssue = await findDuplicateCandidates(db!, {
      reporterId: reporterB,
      assetId: null,
      locationId: locB,
      categoryId: catElec,
      issueTypeId: itElec,
    });
    expect(mismatchedIssue.map((c) => c.ticketNumber)).not.toContain(
      withNull.report.ticketNumber,
    );
  });

  it('rejects invalid input and missing/inactive references with AppError statuses', async () => {
    const good = {
      reporterId: reporterA,
      locationId: locA,
      assetId: assetElec1,
      submittedCategoryId: catElec,
      submittedIssueTypeId: itElec,
      description: 'Lampu ruangan mati total sejak pagi hari, mohon diperbaiki.',
      occurredAt: null,
    };
    await expect(createReport(db!, good, '')).rejects.toMatchObject({ status: 400 });
    await expect(
      createReport(db!, { ...good, description: 'pendek' }, randomUUID()),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      createReport(
        db!,
        { ...good, occurredAt: new Date(Date.now() + 3_600_000).toISOString() },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      createReport(db!, { ...good, locationId: randomUUID() }, randomUUID()),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      createReport(db!, { ...good, reporterId: randomUUID() }, randomUUID()),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      createReport(db!, { ...good, submittedCategoryId: catInactive }, randomUUID()),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      createReport(
        db!,
        { ...good, submittedIssueTypeId: itHvac, submittedCategoryId: catElec },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      createReport(
        db!,
        { ...good, assetId: assetHvac1, submittedCategoryId: catElec },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      createReport(db!, { ...good, assetId: assetInactive }, randomUUID()),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('stores a past occurredAt and mints 10 unique tickets under parallel load', async () => {
    const occurredAt = new Date(Date.now() - 24 * 3_600_000).toISOString();
    const withDate = await createReport(
      db!,
      {
        reporterId: reporterA,
        locationId: locA,
        assetId: null,
        submittedCategoryId: catElec,
        submittedIssueTypeId: null,
        description: 'Plafon bocor saat hujan deras kemarin sore hari.',
        occurredAt,
      },
      randomUUID(),
    );
    expect(withDate.report.occurredAt?.getTime()).toBe(new Date(occurredAt).getTime());

    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        createReport(
          db!,
          {
            reporterId: reporterA,
            locationId: locA,
            assetId: null,
            submittedCategoryId: catElec,
            submittedIssueTypeId: null,
            description: `Laporan beban paralel ke-${i} dengan deskripsi yang cukup panjang.`,
            occurredAt: null,
          },
          randomUUID(),
        ),
      ),
    );
    const tickets = results.map((r) => r.report.ticketNumber);
    expect(new Set(tickets).size).toBe(10);
    for (const ticket of tickets) {
      expect(ticket).toMatch(/^MNT-\d{4}-\d{6}$/);
    }
  });

  it('collapses concurrent same-key requests into exactly one report', async () => {
    const key = randomUUID();
    const before = await db!.select().from(maintenanceReports);
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        createReport(
          db!,
          {
            reporterId: reporterB,
            locationId: locA,
            assetId: null,
            submittedCategoryId: catHvac,
            submittedIssueTypeId: null,
            description: 'Balon lampu lorong pecah dan perlu diganti segera.',
            occurredAt: null,
          },
          key,
        ),
      ),
    );
    const tickets = new Set(results.map((r) => r.report.ticketNumber));
    expect(tickets.size).toBe(1);
    const after = await db!.select().from(maintenanceReports);
    expect(after.length).toBe(before.length + 1);
    expect(results.filter((r) => r.idempotentReplay).length).toBeGreaterThan(0);
  });
});
it('reports P3-2 availability (informational)', () => {
  if (!enabled) {
    console.log(
      'SKIP P3-2 integration: PostgreSQL unreachable at ' +
        'the resolved DATABASE_URL — start local postgres (docker compose up) ' +
        'or set DATABASE_URL to a live instance to run.',
    );
  }
  expect(true).toBe(true);
});

it('reports P3-2 availability (informational)', () => {
  if (!enabled) {
    console.log(
      'SKIP P3-2 integration: PostgreSQL unreachable at ' +
        'the resolved DATABASE_URL — start local postgres (docker compose up) ' +
        'or set DATABASE_URL to a live instance to run.',
    );
  }
  expect(true).toBe(true);
});

// ---------------------------------------------------------------------------
// P3-3 report queries + supporting links (Phase 3 backend, final task).
//
// Pure validation tests run offline with a never-valued stub db (option
// validation throws before any I/O). DB-gated integration uses its own
// SCRATCH database (`silapor_p33_test`) created/dropped in
// beforeAll/afterAll — the shared dev database is never touched.
// ---------------------------------------------------------------------------

// Validation in every P3-3 entrypoint runs before the first query, so pure
// tests pass a stub that would crash on use; any path reaching the database
// with this stub fails loudly instead of passing silently.
const stubDb = undefined as never;

describe('P3-3 list validation (pure)', () => {
  it('rejects invalid status values with 400', async () => {
    await expect(
      listMyReports(stubDb, VALID_UUID_A, { status: 'BOGUS' }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      listMyReports(stubDb, VALID_UUID_A, { status: ['REPORTED', 'NOPE'] }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects invalid priority values with 400', async () => {
    await expect(
      listMyReports(stubDb, VALID_UUID_A, { priority: 'URGENT' }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects invalid from/to dates with 400', async () => {
    await expect(
      listMyReports(stubDb, VALID_UUID_A, { from: 'not-a-date' }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      listMyReports(stubDb, VALID_UUID_A, { to: '2342-13-99' }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects invalid sort values with 400', async () => {
    await expect(
      listMyReports(stubDb, VALID_UUID_A, { sort: 'newest' }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      listAllReports(stubDb, { sort: 'ticket_up' }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects too-short and too-long search with 400', async () => {
    await expect(listAllReports(stubDb, { search: 'x' })).rejects.toMatchObject({
      status: 400,
    });
    await expect(
      listAllReports(stubDb, { search: 'x'.repeat(101) }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('treats blank search as no filter (pure helper returns null)', () => {
    expect(buildSearchPattern('   ')).toBeNull();
    expect(buildSearchPattern('')).toBeNull();
    expect(buildSearchPattern(undefined)).toBeNull();
    expect(buildSearchPattern('  lampu  ')).toBe('%lampu%');
  });

  it('escapes LIKE wildcards in the search pattern', () => {
    expect(buildSearchPattern('te%st')).toBe('%te\\%st%');
    expect(buildSearchPattern('a_b\\c')).toBe('%a\\_b\\\\c%');
  });

  it('always tiebreaks ordering by id asc (deterministic pagination)', () => {
    for (const sort of ['reported_desc', 'reported_asc', 'ticket_asc', 'ticket_desc'] as const) {
      const spec = reportOrderBy(sort);
      expect(spec.length).toBeGreaterThan(1);
      expect(spec[spec.length - 1]).toEqual({ column: 'id', direction: 'asc' });
    }
    expect(reportOrderBy(undefined)[0]).toEqual({ column: 'reportedAt', direction: 'desc' });
    let thrown: unknown;
    try {
      reportOrderBy('bogus');
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toMatchObject({ status: 400 });
  });
});

describe('P3-3 link + detail validation (pure)', () => {
  const base = {
    sourceReportId: VALID_UUID_A,
    targetReportId: VALID_UUID_B,
    relationType: 'SUPPORTING',
    createdBy: VALID_UUID_C,
  };

  it('rejects self-link with 400', async () => {
    await expect(
      linkSupportingReport(stubDb, { ...base, targetReportId: VALID_UUID_A }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects unknown relation types with 400', async () => {
    await expect(
      linkSupportingReport(stubDb, { ...base, relationType: 'DUPLICATE_OF' }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      linkSupportingReport(stubDb, { ...base, relationType: 'supporting' }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects malformed report ids with 400 before any ownership check', async () => {
    await expect(getMyReportDetail(stubDb, VALID_UUID_A, 'not-a-uuid')).rejects.toMatchObject({
      status: 400,
    });
    await expect(getAdminReportDetail(stubDb, 'not-a-uuid')).rejects.toMatchObject({
      status: 400,
    });
  });

  it('rejects a missing affected-count scope with 400', async () => {
    await expect(
      countAffectedReporters(stubDb, {
        locationId: 'not-a-uuid',
        categoryId: VALID_UUID_D,
        issueTypeId: null,
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
});

const P33_SCRATCH_DB_NAME = 'silapor_p33_test';

function p33ScratchUrl(base: string): string {
  const url = new URL(base);
  url.pathname = `/${P33_SCRATCH_DB_NAME}`;
  return url.toString();
}

describe.skipIf(!enabled)('P3-3 report queries + supporting links (requires reachable PostgreSQL)', () => {
  const url = p33ScratchUrl(baseUrl);
  let close: () => Promise<void> = async () => undefined;
  let db: ReturnType<typeof getDb>['db'] | undefined;

  let reporterA = '';
  let reporterB = '';
  let reporterC = '';
  let locA = '';
  let catA = '';
  let catB = '';
  let a1Id = '';
  let a2Id = '';
  let a3Id = '';
  let b1Id = '';
  let b2Id = '';
  let a1Ticket = '';

  beforeAll(
    async () => {
      const admin = postgres(baseUrl, { max: 1 });
      try {
        await admin.unsafe(`DROP DATABASE IF EXISTS "${P33_SCRATCH_DB_NAME}"`);
        await admin.unsafe(`CREATE DATABASE "${P33_SCRATCH_DB_NAME}"`);
      } finally {
        await admin.end();
      }
      await runMigrations(url);

      const conn = getDb(url);
      close = conn.close;
      db = conn.db;

      const insertUser = async (username: string): Promise<string> => {
        const rows = await db!
          .insert(users)
          .values({ username, role: 'REPORTER' })
          .returning({ id: users.id });
        const id = rows[0]?.id;
        if (id === undefined) {
          throw new Error('fixture: user insert failed');
        }
        return id;
      };
      reporterA = await insertUser('p33-reporter-a');
      reporterB = await insertUser('p33-reporter-b');
      reporterC = await insertUser('p33-reporter-c');

      locA = (
        await db!
          .insert(locations)
          .values({ type: 'ROOM', code: 'P33-ROOM-A', name: 'P3-3 room A' })
          .returning({ id: locations.id })
      )[0]?.id as string;
      const insertCategory = async (code: string): Promise<string> => {
        const rows = await db!
          .insert(facilityCategories)
          .values({ code, name: `P3-3 ${code}` })
          .returning({ id: facilityCategories.id });
        const id = rows[0]?.id;
        if (id === undefined) {
          throw new Error('fixture: category insert failed');
        }
        return id;
      };
      catA = await insertCategory('P33-CAT-A');
      catB = await insertCategory('P33-CAT-B');

      const report = async (
        reporterId: string,
        categoryId: string,
        description: string,
      ): Promise<{ id: string; ticketNumber: string }> => {
        const result = await createReport(
          db!,
          {
            reporterId,
            locationId: locA,
            assetId: null,
            submittedCategoryId: categoryId,
            submittedIssueTypeId: null,
            description,
            occurredAt: null,
          },
          randomUUID(),
        );
        return { id: result.report.id, ticketNumber: result.report.ticketNumber };
      };

      // Reporter A: 3 reports (same incident scope: locA + catA, no asset/issue).
      const a1 = await report(
        reporterA,
        catA,
        'Lampu ruangan mati total sejak pagi hari, mohon segera diperbaiki.',
      );
      a1Id = a1.id;
      a1Ticket = a1.ticketNumber;
      a2Id = (
        await report(
          reporterA,
          catA,
          'Stop kontak mengeluarkan percikan api yang berbahaya bagi penghuni.',
        )
      ).id;
      a3Id = (
        await report(reporterA, catA, 'Laporan te%st khusus untuk uji escape pola pencarian.')
      ).id;
      // Reporter B: 2 reports under a different category (not the catA incident).
      b1Id = (await report(reporterB, catB, 'Unit AC split tidak dingin sama sekali.')).id;
      b2Id = (await report(reporterB, catB, 'Laporan texst biasa tanpa pola khusus.')).id;

      await db!.insert(reportAttachments).values({
        reportId: a1Id,
        storageKey: 'p33/a1-photo-1',
        originalFilename: 'photo.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 1234,
        checksum: 'p33-checksum-1',
        uploadedBy: reporterA,
      });
    },
    120_000,
  );

  afterAll(async () => {
    await close();
    const admin = postgres(baseUrl, { max: 1 });
    try {
      await admin.unsafe(`DROP DATABASE IF EXISTS "${P33_SCRATCH_DB_NAME}"`);
    } finally {
      await admin.end();
    }
  });

  it('pages reporter A list as [2,1] with no overlap and total 3', async () => {
    const page1 = await listMyReports(db!, reporterA, { limit: 2, offset: 0 });
    expect(page1.total).toBe(3);
    expect(page1.items).toHaveLength(2);
    expect(page1.limit).toBe(2);
    expect(page1.offset).toBe(0);
    const page2 = await listMyReports(db!, reporterA, { limit: 2, offset: 2 });
    expect(page2.total).toBe(3);
    expect(page2.items).toHaveLength(1);
    const page1Ids = new Set(page1.items.map((r) => r.id));
    for (const row of page2.items) {
      expect(page1Ids.has(row.id)).toBe(false);
    }
    expect(new Set([...page1.items, ...page2.items].map((r) => r.id)).size).toBe(3);
  });

  it('returns an identical 404 for foreign vs missing tickets', async () => {
    await expect(getMyReportDetail(db!, reporterB, a1Id)).rejects.toMatchObject({ status: 404 });
    await expect(getMyReportDetail(db!, reporterA, randomUUID())).rejects.toMatchObject({
      status: 404,
    });
    const foreign = await getMyReportDetail(db!, reporterB, a1Id).catch((error: unknown) => error);
    const missing = await getMyReportDetail(db!, reporterA, randomUUID()).catch(
      (error: unknown) => error,
    );
    expect(String((foreign as Error).message)).toBe(String((missing as Error).message));
  });

  it('sees all 5 rows from the admin list with total matching items length', async () => {
    const all = await listAllReports(db!, {});
    expect(all.total).toBe(5);
    expect(all.items).toHaveLength(all.total);
  });

  it('searches by ticket suffix, description keyword, and literal wildcards', async () => {
    const suffix = a1Ticket.slice(-6);
    const byTicket = await listAllReports(db!, { search: suffix });
    expect(byTicket.items.map((r) => r.ticketNumber)).toEqual([a1Ticket]);

    const byKeyword = await listAllReports(db!, { search: 'lampu' });
    expect(byKeyword.items.map((r) => r.ticketNumber)).toEqual([a1Ticket]);

    // `te%st` must match the literal row only — never the `texst` lookalike.
    const byLiteral = await listAllReports(db!, { search: 'te%st' });
    const tickets = byLiteral.items.map((r) => r.ticketNumber);
    const a3Ticket = (await getAdminReportDetail(db!, a3Id)).report.ticketNumber;
    expect(tickets).toContain(a3Ticket);
    const b2Ticket = (await getAdminReportDetail(db!, b2Id)).report.ticketNumber;
    expect(tickets).not.toContain(b2Ticket);
  });

  it('orders tied reported_at rows by id asc (deterministic pagination)', async () => {
    const tied = new Date();
    for (const id of [a1Id, a2Id, a3Id]) {
      await db!.update(maintenanceReports).set({ reportedAt: tied }).where(eq(maintenanceReports.id, id));
    }
    const page = await listMyReports(db!, reporterA, { sort: 'reported_desc' });
    expect(page.items.map((r) => r.id)).toEqual([a1Id, a2Id, a3Id].sort());
  });

  it('narrows by status + category + date range + priority', async () => {
    await db!.update(maintenanceReports).set({ status: 'VERIFIED' }).where(eq(maintenanceReports.id, a2Id));
    await db!
      .update(maintenanceReports)
      .set({ reportedAt: new Date(Date.now() - 5 * 24 * 3_600_000), finalPriority: 'HIGH' })
      .where(eq(maintenanceReports.id, a1Id));

    const byStatusCategory = await listAllReports(db!, {
      status: 'REPORTED',
      categoryId: catA,
    });
    expect(byStatusCategory.total).toBe(2);

    const multiStatus = await listMyReports(db!, reporterA, {
      status: ['REPORTED', 'VERIFIED'],
      categoryId: catA,
    });
    expect(multiStatus.total).toBe(3);

    const recent = await listMyReports(db!, reporterA, {
      from: new Date(Date.now() - 2 * 24 * 3_600_000).toISOString(),
    });
    expect(recent.total).toBe(2);
    expect(recent.items.map((r) => r.id)).not.toContain(a1Id);

    const old = await listMyReports(db!, reporterA, {
      to: new Date(Date.now() - 2 * 24 * 3_600_000).toISOString(),
    });
    expect(old.items.map((r) => r.id)).toEqual([a1Id]);

    const byPriority = await listAllReports(db!, { priority: 'HIGH' });
    expect(byPriority.items.map((r) => r.id)).toEqual([a1Id]);

    const otherLocation = await listAllReports(db!, { locationId: randomUUID() });
    expect(otherLocation.total).toBe(0);

    const ticketAsc = await listMyReports(db!, reporterA, { sort: 'ticket_asc' });
    const tickets = ticketAsc.items.map((r) => r.ticketNumber);
    expect([...tickets].sort()).toEqual(tickets);
  });

  it('returns full detail (attachments, chronological events, relations, candidates)', async () => {
    const detail = await getMyReportDetail(db!, reporterA, a1Id);
    expect(detail.report.id).toBe(a1Id);
    expect(detail.report.ticketNumber).toBe(a1Ticket);
    expect(detail.attachments).toHaveLength(1);
    expect(detail.attachments[0]).toMatchObject({
      storageKey: 'p33/a1-photo-1',
      originalFilename: 'photo.jpg',
      mimeType: 'image/jpeg',
      sizeBytes: 1234,
    });
    expect(detail.events.length).toBeGreaterThanOrEqual(1);
    expect(detail.events[0]?.eventType).toBe('REPORT_CREATED');
    for (let i = 1; i < detail.events.length; i++) {
      expect(detail.events[i - 1]?.createdAt.getTime()).toBeLessThanOrEqual(
        detail.events[i]?.createdAt.getTime() as number,
      );
    }
    expect(detail.relations).toEqual([]);
    // Same-incident siblings warn; the row itself is excluded via excludeReportId.
    const candidateTickets = detail.duplicateCandidates.map((c) => c.ticketNumber);
    const a2Ticket = (await getAdminReportDetail(db!, a2Id)).report.ticketNumber;
    const a3Ticket = (await getAdminReportDetail(db!, a3Id)).report.ticketNumber;
    expect(candidateTickets).toContain(a2Ticket);
    expect(candidateTickets).toContain(a3Ticket);
    expect(candidateTickets).not.toContain(a1Ticket);
  });

  it('returns the reporter timeline chronologically with the documented shape', async () => {
    await expect(getMyReportTimeline(db!, reporterB, a1Id)).rejects.toMatchObject({
      status: 404,
    });
    await db!.insert(reportEvents).values({
      reportId: a1Id,
      eventType: 'INTERNAL_NOTE_ADDED',
      actorId: reporterA,
      metadata: { note: 'p33 timeline probe' },
    });
    const timeline = await getMyReportTimeline(db!, reporterA, a1Id);
    expect(timeline).toHaveLength(2);
    expect(timeline[0]).toMatchObject({ type: 'REPORT_CREATED', actorId: reporterA });
    expect(timeline[1]).toMatchObject({ type: 'INTERNAL_NOTE_ADDED', actorId: reporterA });
    for (const entry of timeline) {
      expect(Object.keys(entry).sort()).toEqual(
        ['actorId', 'createdAt', 'fromValue', 'metadata', 'toValue', 'type'].sort(),
      );
    }
    expect(timeline[0]?.createdAt.getTime()).toBeLessThanOrEqual(
      timeline[1]?.createdAt.getTime() as number,
    );
  });

  it('uses an index scan for filtered reporter lists (EXPLAIN spot-check)', async () => {
    const conn = postgres(url, { max: 1 });
    try {
      await conn`SET enable_seqscan = off`;
      const rows = await conn`EXPLAIN SELECT id FROM maintenance_reports WHERE reporter_id = ${reporterA} AND status = 'REPORTED' ORDER BY reported_at DESC, id ASC LIMIT 50`;
      const plan = rows
        .map((row) => String((row as Record<string, unknown>)['QUERY PLAN'] ?? ''))
        .join('\n');
      expect(plan).toMatch(/Index Scan/);
    } finally {
      await conn.end();
    }
  });

  it('links B1→A1 as SUPPORTING without touching status, events, or jobs', async () => {
    const statusBefore = new Map(
      (await db!.select().from(maintenanceReports)).map((r) => [r.id, r.status] as const),
    );
    const eventsBefore = await db!.select().from(reportEvents);
    const outboxBefore = await db!.select().from(outboxEvents);

    const link = await linkSupportingReport(db!, {
      sourceReportId: b1Id,
      targetReportId: a1Id,
      relationType: 'SUPPORTING',
      createdBy: reporterB,
    });
    expect(link).toMatchObject({
      sourceReportId: b1Id,
      targetReportId: a1Id,
      relationType: 'SUPPORTING',
    });

    // Both submissions remain independently queryable.
    expect((await listMyReports(db!, reporterA, {})).total).toBe(3);
    expect((await listMyReports(db!, reporterB, {})).total).toBe(2);

    // Metadata only: statuses unchanged, no new events, no repair job outbox row.
    for (const row of await db!.select().from(maintenanceReports)) {
      expect(row.status).toBe(statusBefore.get(row.id));
    }
    expect((await db!.select().from(reportEvents)).length).toBe(eventsBefore.length);
    expect((await db!.select().from(outboxEvents)).length).toBe(outboxBefore.length);

    // The reverse triple is a distinct row (no auto-mirror); the same triple 409s.
    const reverse = await linkSupportingReport(db!, {
      sourceReportId: a1Id,
      targetReportId: b1Id,
      relationType: 'RELATED',
      createdBy: reporterA,
    });
    expect(reverse.relationType).toBe('RELATED');
    await expect(
      linkSupportingReport(db!, {
        sourceReportId: b1Id,
        targetReportId: a1Id,
        relationType: 'SUPPORTING',
        createdBy: reporterB,
      }),
    ).rejects.toMatchObject({ status: 409 });

    const detail = await getAdminReportDetail(db!, a1Id);
    expect(detail.relations).toHaveLength(2);
  });

  it('rejects links with unknown/inactive creators (404/400, never raw FK); duplicates still 409', async () => {
    // UUID-shaped but nonexistent creator → 404, not a raw 23503.
    await expect(
      linkSupportingReport(db!, {
        sourceReportId: b2Id,
        targetReportId: a2Id,
        relationType: 'SUPPORTING',
        createdBy: randomUUID(),
      }),
    ).rejects.toMatchObject({ status: 404 });

    // Inactive creator → 400 (mirrors the createReport reporter guard).
    const ghostId = (
      await db!
        .insert(users)
        .values({ username: 'p33-ghost-creator', role: 'REPORTER' })
        .returning({ id: users.id })
    )[0]?.id as string;
    await db!.update(users).set({ isActive: false }).where(eq(users.id, ghostId));
    await expect(
      linkSupportingReport(db!, {
        sourceReportId: b2Id,
        targetReportId: a2Id,
        relationType: 'SUPPORTING',
        createdBy: ghostId,
      }),
    ).rejects.toMatchObject({ status: 400 });

    // Duplicate triple (B1→A1 SUPPORTING linked above) still 409s.
    await expect(
      linkSupportingReport(db!, {
        sourceReportId: b1Id,
        targetReportId: a1Id,
        relationType: 'SUPPORTING',
        createdBy: reporterB,
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('counts affected reporters across the incident plus links (terminal rows collapse)', async () => {
    await db!
      .update(maintenanceReports)
      .set({ status: 'DUPLICATE', duplicateOfReportId: a1Id })
      .where(eq(maintenanceReports.id, a3Id));
    // Same-reporter DUPLICATE row collapses: reporter A still counts once.
    // Linked reporter B counts via the B1→A1 SUPPORTING link.
    expect(
      await countAffectedReporters(db!, {
        assetId: null,
        locationId: locA,
        categoryId: catA,
        issueTypeId: null,
      }),
    ).toBe(2);

    // An unlinked terminal row from a third reporter contributes nothing.
    const c1 = await createReport(
      db!,
      {
        reporterId: reporterC,
        locationId: locA,
        assetId: null,
        submittedCategoryId: catA,
        submittedIssueTypeId: null,
        description: 'Keran wastafel patah dan air mengucur terus menerus.',
        occurredAt: null,
      },
      randomUUID(),
    );
    await db!
      .update(maintenanceReports)
      .set({ status: 'REJECTED' })
      .where(eq(maintenanceReports.id, c1.report.id));
    expect(
      await countAffectedReporters(db!, {
        assetId: null,
        locationId: locA,
        categoryId: catA,
        issueTypeId: null,
      }),
    ).toBe(2);

    // The link pulls the other way too: the catB incident sees B directly + A via link.
    expect(
      await countAffectedReporters(db!, {
        assetId: null,
        locationId: locA,
        categoryId: catB,
        issueTypeId: null,
      }),
    ).toBe(2);
  });
});
