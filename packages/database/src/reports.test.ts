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
  reportEvents,
  reportRelations,
  users,
} from './schema.js';
import {
  createReport,
  findDuplicateCandidates,
  getJakartaYear,
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
