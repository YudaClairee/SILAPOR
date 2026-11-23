// Task 3: duplicate-first submit without reporter category.
//
// Pure validator tests run offline. DB-gated integration uses a SCRATCH
// database (`silapor_p32_test`) created/dropped in beforeAll/afterAll — the
// shared dev database is never touched. Without a reachable PostgreSQL the
// integration suite skips (same offline-skip contract as db.integration.test.ts
// and reports-schema.test.ts).
//
// Submit contract under test:
// - input is { reporterId, locationId, assetId (required), description } —
//   `submittedCategoryId` / `submittedIssueTypeId` / `occurredAt` are rejected
//   when sent (the reporter never classifies; the asset's master category is
//   stored as the submitted category server-side);
// - same reporter + same asset + active row → throw carrying
//   code 'DUPLICATE_ACTIVE' and the active ticketNumber, before ticket
//   generation (no ticket consumed);
// - different reporter + same asset + active row → create the row and link it
//   as SUPPORTING to the earliest active ticket in the SAME create
//   transaction (auto-gabung; verification later must not disturb the link).
import postgres from 'postgres';
import { randomUUID } from 'node:crypto';
import { describe, expect, it, afterAll, beforeAll } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { isAppError } from '@silapor/shared';
import { getDb, resolveDatabaseUrl } from './index.js';
import {
  createAsset as repoCreateAsset,
  createCategory as repoCreateCategory,
  updateAsset as repoUpdateAsset,
  updateCategory as repoUpdateCategory,
} from './master-data.js';
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
  reportSupporters,
  ticketCounters,
  users,
} from './schema.js';
import {
  applyVerification,
  buildSearchPattern,
  compensateFailedSupporter,
  countAffectedReporters,
  createReport,
  findDuplicateCandidates,
  findSupporterByKey,
  getAdminReportDetail,
  getCampusReportDetail,
  getCampusReportStats,
  getJakartaYear,
  getMyReportDetail,
  getMyReportTimeline,
  isForeignKeyViolation,
  isUniqueViolation,
  linkSupportingReport,
  listAllReports,
  listCampusReports,
  listMyReports,
  reportOrderBy,
  validateCreateReportInput,
} from './reports.js';

const VALID_UUID_A = '11111111-1111-4111-8111-111111111111';
const VALID_UUID_B = '22222222-2222-4222-8222-222222222222';
const VALID_UUID_C = '33333333-3333-4333-8333-333333333333';

function validInput(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    reporterId: VALID_UUID_A,
    locationId: VALID_UUID_B,
    assetId: VALID_UUID_C,
    description: 'Lampu ruangan mati total sejak pagi, mohon segera diperbaiki.',
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Pure validator (no DB).
// ---------------------------------------------------------------------------

describe('validateCreateReportInput (pure)', () => {
  it('accepts a valid input with required asset and no category fields', () => {
    expect(validateCreateReportInput(validInput())).toEqual([]);
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
    expect(
      validateCreateReportInput(validInput({ description: '123456789' })).length,
    ).toBeGreaterThan(0);
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

  it('rejects missing or malformed reporter/location/asset references', () => {
    expect(validateCreateReportInput(validInput({ reporterId: undefined })).length).toBeGreaterThan(
      0,
    );
    expect(
      validateCreateReportInput(validInput({ locationId: 'not-a-uuid' })).length,
    ).toBeGreaterThan(0);
    expect(validateCreateReportInput(validInput({ assetId: '' })).length).toBeGreaterThan(0);
    expect(validateCreateReportInput(validInput({ assetId: null })).length).toBeGreaterThan(0);
    expect(validateCreateReportInput(validInput({ assetId: 42 })).length).toBeGreaterThan(0);
    const rest: Record<string, unknown> = validInput();
    delete rest['assetId'];
    expect(validateCreateReportInput(rest).length).toBeGreaterThan(0);
  });

  it('rejects reporter-supplied category, issue type, and occurredAt when sent', () => {
    expect(
      validateCreateReportInput(validInput({ submittedCategoryId: VALID_UUID_A })).length,
    ).toBeGreaterThan(0);
    expect(
      validateCreateReportInput(validInput({ submittedCategoryId: null })).length,
    ).toBeGreaterThan(0);
    expect(
      validateCreateReportInput(validInput({ submittedIssueTypeId: VALID_UUID_A })).length,
    ).toBeGreaterThan(0);
    expect(
      validateCreateReportInput(validInput({ submittedIssueTypeId: null })).length,
    ).toBeGreaterThan(0);
    expect(validateCreateReportInput(validInput({ occurredAt: null })).length).toBeGreaterThan(0);
    expect(
      validateCreateReportInput(
        validInput({ occurredAt: new Date(Date.now() - 3_600_000).toISOString() }),
      ).length,
    ).toBeGreaterThan(0);
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

describe('validateCreateReportInput service target (pure)', () => {
  // Service report: no asset, a service category instead.
  const serviceInput = (overrides: Record<string, unknown> = {}): Record<string, unknown> => {
    const input = validInput();
    delete input['assetId'];
    return { ...input, serviceCategoryId: VALID_UUID_C, ...overrides };
  };

  it('accepts a service input with serviceCategoryId and no assetId', () => {
    expect(validateCreateReportInput(serviceInput())).toEqual([]);
  });

  it('rejects an asset and a service category sent together', () => {
    expect(
      validateCreateReportInput(validInput({ serviceCategoryId: VALID_UUID_A })).length,
    ).toBeGreaterThan(0);
  });

  it('rejects input with neither an asset nor a service category', () => {
    const input = validInput();
    delete input['assetId'];
    expect(validateCreateReportInput(input).length).toBeGreaterThan(0);
  });

  it('rejects a malformed or null serviceCategoryId', () => {
    expect(
      validateCreateReportInput(serviceInput({ serviceCategoryId: 'not-a-uuid' })).length,
    ).toBeGreaterThan(0);
    expect(
      validateCreateReportInput(serviceInput({ serviceCategoryId: null })).length,
    ).toBeGreaterThan(0);
  });

  it('still rejects reporter-supplied classification on a service input', () => {
    expect(
      validateCreateReportInput(serviceInput({ submittedCategoryId: VALID_UUID_A })).length,
    ).toBeGreaterThan(0);
  });

  it('compensateFailedSupporter rejects malformed supporterId with 400 before any I/O', async () => {
    await expect(compensateFailedSupporter(undefined as never, 'not-a-uuid')).rejects.toMatchObject({
      status: 400,
    });
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

describe.skipIf(!enabled)(
  'createReport duplicate-first + applyVerification (requires reachable PostgreSQL)',
  () => {
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
    let catAccess = '';
    let catSecurity = '';
    let catServiceOff = '';
    let locC = '';
    let svcFirstTicket = '';
    let itElec = '';
    let itHvac = '';
    let itAccess = '';
    let itGeneric = '';
    let assetElec1 = '';
    let assetElec2 = '';
    let assetElec3 = '';
    let assetElec4 = '';
    let assetElec5 = '';
    let assetElec6 = '';
    let assetHvac1 = '';
    let assetHvac2 = '';
    let assetInactive = '';
    let assetOffCategory = '';

    const longDescription = (label: string): string =>
      `Laporan verifikasi ${label} dengan deskripsi yang cukup panjang untuk validasi.`;

    // A fresh room per test, so a service report never collides with another
    // test's active report at the same location and category.
    const freshRoom = async (code: string): Promise<string> => {
      const rows = await db!
        .insert(locations)
        .values({ type: 'ROOM', code, name: `T3 room ${code}` })
        .returning({ id: locations.id });
      const id = rows[0]?.id;
      if (id === undefined) {
        throw new Error('fixture: location insert failed');
      }
      return id;
    };

    const createAsset = async (assetCode: string, categoryId: string): Promise<string> => {
      const rows = await db!
        .insert(facilityAssets)
        .values({ assetCode, name: `T3 ${assetCode}`, categoryId, locationId: locA })
        .returning({ id: facilityAssets.id });
      const id = rows[0]?.id;
      if (id === undefined) {
        throw new Error('fixture: asset insert failed');
      }
      return id;
    };

    const counterForYear = async (): Promise<number | null> => {
      const year = getJakartaYear(new Date());
      const rows = await db!.select().from(ticketCounters).where(eq(ticketCounters.year, year));
      return rows[0]?.lastSeq ?? null;
    };

    beforeAll(async () => {
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
          .values({ type: 'ROOM', code, name: `T3 room ${code}` })
          .returning({ id: locations.id });
        const id = rows[0]?.id;
        if (id === undefined) {
          throw new Error('fixture: location insert failed');
        }
        return id;
      };
      locA = await insertLocation('T3-ROOM-A');
      locB = await insertLocation('T3-ROOM-B');
      locC = await insertLocation('T3-ROOM-C');

      const insertCategory = async (
        code: string,
        isActive: boolean,
        requiresAsset = true,
      ): Promise<string> => {
        const rows = await db!
          .insert(facilityCategories)
          .values({ code, name: `T3 ${code}`, isActive, requiresAsset })
          .returning({ id: facilityCategories.id });
        const id = rows[0]?.id;
        if (id === undefined) {
          throw new Error('fixture: category insert failed');
        }
        return id;
      };
      catElec = await insertCategory('T3-ELEC', true);
      catHvac = await insertCategory('T3-HVAC', true);
      catInactive = await insertCategory('T3-OFF', false);
      catAccess = await insertCategory('T3-ACCESS', true, false);
      catSecurity = await insertCategory('T3-SECURITY', true, false);
      catServiceOff = await insertCategory('T3-SVC-OFF', false, false);

      const insertIssueType = async (code: string, categoryId: string | null): Promise<string> => {
        const rows = await db!
          .insert(issueTypes)
          .values({ code, name: `T3 ${code}`, categoryId })
          .returning({ id: issueTypes.id });
        const id = rows[0]?.id;
        if (id === undefined) {
          throw new Error('fixture: issue type insert failed');
        }
        return id;
      };
      itElec = await insertIssueType('T3-IT-ELEC', catElec);
      itHvac = await insertIssueType('T3-IT-HVAC', catHvac);
      itAccess = await insertIssueType('T3-IT-ACCESS', catAccess);
      itGeneric = await insertIssueType('T3-IT-GENERIC', null);

      const insertAsset = async (
        assetCode: string,
        categoryId: string,
        isActive: boolean,
      ): Promise<string> => {
        const rows = await db!
          .insert(facilityAssets)
          .values({ assetCode, name: `T3 ${assetCode}`, categoryId, locationId: locA })
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
      assetElec1 = await insertAsset('T3-ASSET-ELEC-1', catElec, true);
      assetElec2 = await insertAsset('T3-ASSET-ELEC-2', catElec, true);
      assetElec3 = await insertAsset('T3-ASSET-ELEC-3', catElec, true);
      assetElec4 = await insertAsset('T3-ASSET-ELEC-4', catElec, true);
      assetElec5 = await insertAsset('T3-ASSET-ELEC-5', catElec, true);
      assetElec6 = await insertAsset('T3-ASSET-ELEC-6', catElec, true);
      assetHvac1 = await insertAsset('T3-ASSET-HVAC-1', catHvac, true);
      assetHvac2 = await insertAsset('T3-ASSET-HVAC-2', catHvac, true);
      assetInactive = await insertAsset('T3-ASSET-OFF', catElec, false);
      assetOffCategory = await insertAsset('T3-ASSET-OFFCAT', catInactive, true);
    }, 120_000);

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
          description: 'Lampu ruangan mati total sejak pagi hari, mohon segera diperbaiki.',
        },
        randomUUID(),
      );
      expect(result.idempotentReplay).toBe(false);
      expect(result.kind).toBe('CREATED');
      expect(result.supporter).toBeNull();
      expect(result.report.status).toBe('REPORTED');
      expect(result.report.version).toBe(1);
      // The reporter's asset determines the stored submitted category.
      expect(result.report.submittedCategoryId).toBe(catElec);
      expect(result.report.submittedIssueTypeId).toBeNull();
      expect(result.report.occurredAt).toBeNull();
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
          assetId: assetElec2,
          description: 'AC split tidak dingin sama sekali sejak kemarin sore.',
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
          assetId: assetElec2,
          description: 'AC split tidak dingin sama sekali sejak kemarin sore.',
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
          assetId: assetElec3,
          description: 'Kabel stop kontak terkelupas dan terlihat berbahaya bagi penghuni.',
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
          assetId: assetElec3,
          description: 'pendek',
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

    it('blocks same-reporter same-asset active submit with ticket ref', async () => {
      const first = await createReport(
        db!,
        {
          reporterId: reporterA,
          locationId: locA,
          assetId: assetElec4,
          description: longDescription('pertama aset empat'),
        },
        randomUUID(),
      );
      expect(first.kind).toBe('CREATED');

      const reportsBefore = await db!.select().from(maintenanceReports);
      const eventsBefore = await db!.select().from(reportEvents);
      const outboxBefore = await db!.select().from(outboxEvents);
      const seqBefore = await counterForYear();

      const blocked = await createReport(
        db!,
        {
          reporterId: reporterA,
          locationId: locA,
          assetId: assetElec4,
          description: longDescription('kedua aset sama diblokir'),
        },
        randomUUID(),
      ).then(
        () => {
          throw new Error('test: blocked submit unexpectedly succeeded');
        },
        (error: unknown) => error,
      );
      // Transport-safe: AppError with 409 + active ticket ref in details.
      expect(isAppError(blocked)).toBe(true);
      expect(blocked).toMatchObject({
        code: 'DUPLICATE_ACTIVE',
        status: 409,
        details: { ticketNumber: first.report.ticketNumber },
      });

      // The blocked submit writes nothing and consumes no ticket.
      expect(await db!.select().from(maintenanceReports)).toHaveLength(reportsBefore.length);
      expect(await db!.select().from(reportEvents)).toHaveLength(eventsBefore.length);
      expect(await db!.select().from(outboxEvents)).toHaveLength(outboxBefore.length);
      expect(await counterForYear()).toBe(seqBefore);
    });

    it('allows resubmission on the same asset once the active ticket is CLOSED', async () => {
      const first = await createReport(
        db!,
        {
          reporterId: reporterA,
          locationId: locA,
          assetId: assetElec5,
          description: longDescription('pertama aset lima'),
        },
        randomUUID(),
      );
      const blockedResubmit = await createReport(
        db!,
        {
          reporterId: reporterA,
          locationId: locA,
          assetId: assetElec5,
          description: longDescription('kedua aset lima diblokir'),
        },
        randomUUID(),
      ).then(
        () => {
          throw new Error('test: blocked submit unexpectedly succeeded');
        },
        (error: unknown) => error,
      );
      expect(isAppError(blockedResubmit)).toBe(true);
      expect(blockedResubmit).toMatchObject({
        code: 'DUPLICATE_ACTIVE',
        status: 409,
        details: { ticketNumber: first.report.ticketNumber },
      });

      await db!
        .update(maintenanceReports)
        .set({ status: 'CLOSED' })
        .where(eq(maintenanceReports.id, first.report.id));

      const third = await createReport(
        db!,
        {
          reporterId: reporterA,
          locationId: locA,
          assetId: assetElec5,
          description: longDescription('ketiga aset lima setelah tutup'),
        },
        randomUUID(),
      );
      expect(third.idempotentReplay).toBe(false);
      expect(third.report.ticketNumber).not.toBe(first.report.ticketNumber);
      expect(third.report.status).toBe('REPORTED');
      expect(third.kind).toBe('CREATED');
    });

    it('attaches a different-reporter same-incident report as supporter without minting a ticket', async () => {
      const seqBefore = (await counterForYear()) ?? 0;
      const first = await createReport(
        db!,
        {
          reporterId: reporterA,
          locationId: locA,
          assetId: assetElec6,
          description: longDescription('pertama aset enam'),
        },
        randomUUID(),
      );
      expect(first.kind).toBe('CREATED');
      const seqAfterFirst = await counterForYear();
      expect(seqAfterFirst).toBe(seqBefore + 1);
      const reportsBefore = await db!.select().from(maintenanceReports);
      const outboxBefore = await db!.select().from(outboxEvents);

      const supKeyB = randomUUID();
      const res = await createReport(
        db!,
        {
          reporterId: reporterB,
          locationId: locA,
          assetId: assetElec6,
          description: longDescription('pelapor lain aset sama'),
        },
        supKeyB,
      );
      expect(res.kind).toBe('SUPPORTED');
      if (res.kind !== 'SUPPORTED') throw new Error('expected SUPPORTED');
      expect(res.idempotentReplay).toBe(false);
      expect(res.report.id).toBe(first.report.id);
      expect(res.report.ticketNumber).toBe(first.report.ticketNumber);
      expect(res.affectedReporters).toBe(2);
      expect(res.supporter.reportId).toBe(first.report.id);
      expect(res.supporter.reporterId).toBe(reporterB);
      expect(res.supporter.idempotencyKey).toBe(supKeyB);

      // No new ticket counter increment, no new maintenance_reports row, no AI outbox row.
      expect(await counterForYear()).toBe(seqAfterFirst);
      expect(await db!.select().from(maintenanceReports)).toHaveLength(reportsBefore.length);
      expect(await db!.select().from(outboxEvents)).toHaveLength(outboxBefore.length);
      expect(await db!.select().from(reportRelations)).toHaveLength(0);

      const supporters = await db!
        .select()
        .from(reportSupporters)
        .where(eq(reportSupporters.reportId, first.report.id));
      expect(supporters).toHaveLength(1);

      const events = await db!
        .select()
        .from(reportEvents)
        .where(eq(reportEvents.reportId, first.report.id));
      expect(events.some((e) => e.eventType === 'SUPPORTER_ADDED')).toBe(true);

      // Same idempotency key from reporter B replays SUPPORTED without new rows.
      const replay = await createReport(
        db!,
        {
          reporterId: reporterB,
          locationId: locA,
          assetId: assetElec6,
          description: 'pendek',
        },
        supKeyB,
      );
      expect(replay.kind).toBe('SUPPORTED');
      expect(replay.idempotentReplay).toBe(true);
      expect(replay.report.id).toBe(first.report.id);
      expect(
        await db!.select().from(reportSupporters).where(eq(reportSupporters.reportId, first.report.id)),
      ).toHaveLength(1);
      const foundByKey = await findSupporterByKey(db!, supKeyB);
      expect(foundByKey?.supporter.id).toBe(res.supporter.id);
      expect(foundByKey?.report.id).toBe(first.report.id);

      // Different idempotency key from reporter B while still active blocks with 409.
      const blockedB = await createReport(
        db!,
        {
          reporterId: reporterB,
          locationId: locA,
          assetId: assetElec6,
          description: longDescription('pelapor B kirim ulang key beda'),
        },
        randomUUID(),
      ).then(
        () => {
          throw new Error('expected 409 DUPLICATE_ACTIVE');
        },
        (error: unknown) => error,
      );
      expect(isAppError(blockedB)).toBe(true);
      expect(blockedB).toMatchObject({
        code: 'DUPLICATE_ACTIVE',
        status: 409,
        details: { ticketNumber: first.report.ticketNumber },
      });

      // Third reporter joins → 2 supporters, affectedReporters = 3.
      const reporterC = (
        await db!
          .insert(users)
          .values({ username: `p32-rep-c-${randomUUID()}`, role: 'REPORTER' })
          .returning({ id: users.id })
      )[0]?.id as string;
      const resC = await createReport(
        db!,
        {
          reporterId: reporterC,
          locationId: locA,
          assetId: assetElec6,
          description: longDescription('pelapor ketiga aset sama'),
        },
        randomUUID(),
      );
      expect(resC.kind).toBe('SUPPORTED');
      if (resC.kind !== 'SUPPORTED') throw new Error('expected SUPPORTED');
      expect(resC.affectedReporters).toBe(3);
      expect(
        await db!.select().from(reportSupporters).where(eq(reportSupporters.reportId, first.report.id)),
      ).toHaveLength(2);
    });

    it('creates without a supporter for a different asset', async () => {
      const created = await createReport(
        db!,
        {
          reporterId: reporterA,
          locationId: locA,
          assetId: assetHvac1,
          description: longDescription('aset berbeda tanpa tautan'),
        },
        randomUUID(),
      );
      expect(created.kind).toBe('CREATED');
      expect(created.report.status).toBe('REPORTED');
    });

    it('serializes concurrent A & B submits on the same asset into 1 CREATED + 1 SUPPORTED', async () => {
      const raceAsset = await createAsset('T3-ASSET-CONC-AB', catElec);
      const seqBefore = (await counterForYear()) ?? 0;
      const [resA, resB] = await Promise.all([
        createReport(
          db!,
          {
            reporterId: reporterA,
            locationId: locA,
            assetId: raceAsset,
            description: longDescription('balapan A pada aset sama'),
          },
          randomUUID(),
        ),
        createReport(
          db!,
          {
            reporterId: reporterB,
            locationId: locA,
            assetId: raceAsset,
            description: longDescription('balapan B pada aset sama'),
          },
          randomUUID(),
        ),
      ]);
      const kinds = [resA.kind, resB.kind].sort();
      expect(kinds).toEqual(['CREATED', 'SUPPORTED']);
      expect(resA.report.id).toBe(resB.report.id);
      expect(resA.report.ticketNumber).toBe(resB.report.ticketNumber);
      expect(await counterForYear()).toBe(seqBefore + 1);
      expect(
        await db!.select().from(reportSupporters).where(eq(reportSupporters.reportId, resA.report.id)),
      ).toHaveLength(1);
    });

    it('compensateFailedSupporter removes only the supporter and its event without touching the primary ticket', async () => {
      const compAsset = await createAsset('T3-ASSET-COMP-SUP', catElec);
      const primary = await createReport(
        db!,
        {
          reporterId: reporterA,
          locationId: locA,
          assetId: compAsset,
          description: longDescription('tiket utama untuk uji kompensasi supporter'),
        },
        randomUUID(),
      );
      const sup = await createReport(
        db!,
        {
          reporterId: reporterB,
          locationId: locA,
          assetId: compAsset,
          description: longDescription('pendukung yang gagal klaim foto'),
        },
        randomUUID(),
      );
      if (sup.kind !== 'SUPPORTED') throw new Error('expected SUPPORTED');

      await compensateFailedSupporter(db!, sup.supporter.id);

      expect(
        await db!.select().from(maintenanceReports).where(eq(maintenanceReports.id, primary.report.id)),
      ).toHaveLength(1);
      expect(
        await db!.select().from(reportSupporters).where(eq(reportSupporters.id, sup.supporter.id)),
      ).toHaveLength(0);
      const events = await db!
        .select()
        .from(reportEvents)
        .where(eq(reportEvents.reportId, primary.report.id));
      expect(events.some((e) => e.eventType === 'SUPPORTER_ADDED')).toBe(false);
    });

    it('rejects a submit when the asset points at an inactive category', async () => {
      const reportsBefore = await db!.select().from(maintenanceReports);
      await expect(
        createReport(
          db!,
          {
            reporterId: reporterA,
            locationId: locA,
            assetId: assetOffCategory,
            description: longDescription('aset kategori nonaktif'),
          },
          randomUUID(),
        ),
      ).rejects.toMatchObject({ status: 400 });
      expect(await db!.select().from(maintenanceReports)).toHaveLength(reportsBefore.length);
    });

    it('still blocks on an active match older than the 14-day lookback', async () => {
      const asset = await createAsset('T3-ASSET-LOOKBACK', catHvac);
      const old = await createReport(
        db!,
        {
          reporterId: reporterB,
          locationId: locB,
          assetId: asset,
          description: longDescription('laporan lama di luar jendela'),
        },
        randomUUID(),
      );
      await db!
        .update(maintenanceReports)
        .set({ reportedAt: new Date(Date.now() - 20 * 24 * 3_600_000) })
        .where(eq(maintenanceReports.id, old.report.id));

      const blockedOld = await createReport(
        db!,
        {
          reporterId: reporterB,
          locationId: locB,
          assetId: asset,
          description: longDescription('laporan baru tetap diblokir'),
        },
        randomUUID(),
      ).then(
        () => {
          throw new Error('test: blocked submit unexpectedly succeeded');
        },
        (error: unknown) => error,
      );
      expect(isAppError(blockedOld)).toBe(true);
      expect(blockedOld).toMatchObject({
        code: 'DUPLICATE_ACTIVE',
        status: 409,
        details: { ticketNumber: old.report.ticketNumber },
      });
    });

    it('findDuplicateCandidates matches final-category rows and orders newest first', async () => {
      const ticket = (suffix: string): string => `T3-DIRECT-${suffix}-${randomUUID()}`;
      const insertDirect = async (reportedAt: Date, finalCategoryId: string | null) => {
        const rows = await db!
          .insert(maintenanceReports)
          .values({
            ticketNumber: ticket('ord'),
            idempotencyKey: randomUUID(),
            reporterId: reporterA,
            locationId: locA,
            assetId: null,
            submittedCategoryId: catElec,
            submittedIssueTypeId: null,
            finalCategoryId,
            description: longDescription('kandidat langsung'),
            status: 'REPORTED',
            reportedAt,
          })
          .returning({ id: maintenanceReports.id, ticketNumber: maintenanceReports.ticketNumber });
        const row = rows[0];
        if (row === undefined) {
          throw new Error('fixture: direct insert failed');
        }
        return row;
      };
      const older = await insertDirect(new Date(Date.now() - 2 * 3_600_000), null);
      const newer = await insertDirect(new Date(), null);
      await db!
        .update(maintenanceReports)
        .set({ finalCategoryId: catHvac })
        .where(eq(maintenanceReports.id, older.id));

      const candidates = await findDuplicateCandidates(db!, {
        reporterId: reporterA,
        assetId: null,
        locationId: locA,
        categoryId: catElec,
        issueTypeId: null,
      });
      const tickets = candidates.map((c) => c.ticketNumber);
      expect(tickets).toContain(newer.ticketNumber);
      expect(tickets.indexOf(newer.ticketNumber)).toBeLessThan(tickets.indexOf(older.ticketNumber));

      // The retargeted row still matches through its final category.
      const viaFinal = await findDuplicateCandidates(db!, {
        reporterId: reporterA,
        assetId: null,
        locationId: locA,
        categoryId: catHvac,
        issueTypeId: null,
      });
      expect(viaFinal.map((c) => c.ticketNumber)).toContain(older.ticketNumber);
    });

    it('findDuplicateCandidates distinguishes null vs set issue types', async () => {
      const rows = await db!
        .insert(maintenanceReports)
        .values({
          ticketNumber: `T3-DIRECT-null-${randomUUID()}`,
          idempotencyKey: randomUUID(),
          reporterId: reporterB,
          locationId: locB,
          assetId: null,
          submittedCategoryId: catElec,
          submittedIssueTypeId: null,
          description: longDescription('isu null langsung'),
          status: 'REPORTED',
        })
        .returning({ ticketNumber: maintenanceReports.ticketNumber });
      const withNull = rows[0];
      if (withNull === undefined) {
        throw new Error('fixture: direct insert failed');
      }
      const sameNull = await findDuplicateCandidates(db!, {
        reporterId: reporterB,
        assetId: null,
        locationId: locB,
        categoryId: catElec,
        issueTypeId: null,
      });
      expect(sameNull.map((c) => c.ticketNumber)).toContain(withNull.ticketNumber);

      const mismatchedIssue = await findDuplicateCandidates(db!, {
        reporterId: reporterB,
        assetId: null,
        locationId: locB,
        categoryId: catElec,
        issueTypeId: itElec,
      });
      expect(mismatchedIssue.map((c) => c.ticketNumber)).not.toContain(withNull.ticketNumber);
    });

    it('rejects invalid input and missing/inactive references with AppError statuses', async () => {
      const good = {
        reporterId: reporterA,
        locationId: locA,
        assetId: assetElec6,
        description: 'Lampu ruangan mati total sejak pagi hari, mohon diperbaiki.',
      };
      await expect(createReport(db!, good, '')).rejects.toMatchObject({ status: 400 });
      await expect(
        createReport(db!, { ...good, description: 'pendek' }, randomUUID()),
      ).rejects.toMatchObject({ status: 400 });
      await expect(
        createReport(db!, { ...good, assetId: 'not-a-uuid' }, randomUUID()),
      ).rejects.toMatchObject({ status: 400 });
      await expect(
        createReport(db!, { ...good, assetId: undefined as never }, randomUUID()),
      ).rejects.toMatchObject({ status: 400 });
      await expect(
        createReport(
          db!,
          { ...good, submittedCategoryId: catElec } as Record<string, unknown> as never,
          randomUUID(),
        ),
      ).rejects.toMatchObject({ status: 400 });
      await expect(
        createReport(
          db!,
          { ...good, submittedIssueTypeId: itElec } as Record<string, unknown> as never,
          randomUUID(),
        ),
      ).rejects.toMatchObject({ status: 400 });
      await expect(
        createReport(
          db!,
          { ...good, occurredAt: null } as Record<string, unknown> as never,
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
        createReport(db!, { ...good, assetId: randomUUID() }, randomUUID()),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        createReport(db!, { ...good, assetId: assetInactive }, randomUUID()),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('mints unique tickets under parallel load across distinct assets', async () => {
      const assets = await Promise.all(
        Array.from({ length: 10 }, (_, i) => createAsset(`T3-ASSET-PAR-${i}`, catElec)),
      );
      const results = await Promise.all(
        assets.map((assetId, i) =>
          createReport(
            db!,
            {
              reporterId: reporterA,
              locationId: locA,
              assetId,
              description: `Laporan beban paralel ke-${i} dengan deskripsi yang cukup panjang.`,
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
      for (const result of results) {
        expect(result.kind).toBe('CREATED');
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
              assetId: assetHvac2,
              description: 'Balon lampu lorong pecah dan perlu diganti segera.',
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

    it('serializes concurrent same-reporter same-asset submits: one row + one DUPLICATE_ACTIVE', async () => {
      const asset = await createAsset('T3-ASSET-RACE', catElec);
      type RaceOutcome =
        | { readonly ok: true; readonly ticket: string }
        | { readonly ok: false; readonly error: unknown };
      const outcomes: RaceOutcome[] = await Promise.all(
        [randomUUID(), randomUUID()].map(async (key) => {
          try {
            const res = await createReport(
              db!,
              {
                reporterId: reporterA,
                locationId: locA,
                assetId: asset,
                description: longDescription('balapan aset sama'),
              },
              key,
            );
            return { ok: true as const, ticket: res.report.ticketNumber };
          } catch (error) {
            return { ok: false as const, error };
          }
        }),
      );
      const winners = outcomes.filter((o): o is Extract<RaceOutcome, { ok: true }> => o.ok);
      const losers = outcomes.filter((o): o is Extract<RaceOutcome, { ok: false }> => !o.ok);
      expect(winners).toHaveLength(1);
      expect(losers).toHaveLength(1);
      const winner = winners[0];
      const loser = losers[0];
      if (winner === undefined || loser === undefined) {
        throw new Error('test: expected one winner and one blocked submit');
      }
      expect(isAppError(loser.error)).toBe(true);
      expect(loser.error).toMatchObject({
        code: 'DUPLICATE_ACTIVE',
        status: 409,
        details: { ticketNumber: winner.ticket },
      });
      const rows = await db!
        .select()
        .from(maintenanceReports)
        .where(
          and(eq(maintenanceReports.reporterId, reporterA), eq(maintenanceReports.assetId, asset)),
        );
      expect(rows).toHaveLength(1);
      expect(rows[0]?.ticketNumber).toBe(winner.ticket);
    });

    it('applyVerification sets VERIFIED finals plus the verification event', async () => {
      const asset = await createAsset('T3-ASSET-AV-1', catElec);
      const created = await createReport(
        db!,
        {
          reporterId: reporterA,
          locationId: locA,
          assetId: asset,
          description: longDescription('verifikasi langsung pertama'),
        },
        randomUUID(),
      );
      const next = await applyVerification(db!, created.report.id, {
        finalCategoryId: catElec,
        finalIssueTypeId: itElec,
        finalPriority: 'HIGH',
      });
      expect(next.status).toBe('VERIFIED');
      expect(next.finalCategoryId).toBe(catElec);
      expect(next.finalIssueTypeId).toBe(itElec);
      expect(next.finalPriority).toBe('HIGH');
      expect(next.verifiedAt).not.toBeNull();
      expect(next.version).toBe(created.report.version + 1);
      const events = await db!
        .select()
        .from(reportEvents)
        .where(eq(reportEvents.reportId, created.report.id));
      expect(events.map((e) => e.eventType)).toContain('REPORT_VERIFIED');
    });

    it('applyVerification queues a REPORT_VERIFIED notification for the worker', async () => {
      const asset = await createAsset('T3-ASSET-AV-N1', catElec);
      const created = await createReport(
        db!,
        {
          reporterId: reporterA,
          locationId: locA,
          assetId: asset,
          description: longDescription('notifikasi verifikasi'),
        },
        randomUUID(),
      );
      await applyVerification(db!, created.report.id, {
        finalCategoryId: catElec,
        finalIssueTypeId: itElec,
        finalPriority: 'MEDIUM',
      });
      // Only WORKFLOW_NOTIFICATION rows reach the reporter (notifications.ts);
      // the submit-time AI_REVIEW_REQUESTED row is a separate concern.
      const queued = (await db!.select().from(outboxEvents)).filter(
        (row) =>
          row.type === 'WORKFLOW_NOTIFICATION' &&
          (row.payload as { reportId?: string }).reportId === created.report.id,
      );
      expect(queued).toHaveLength(1);
      expect(queued[0]?.status).toBe('PENDING');
      expect(queued[0]?.payload).toMatchObject({
        reportId: created.report.id,
        ticketNumber: created.report.ticketNumber,
        kind: 'REPORT_VERIFIED',
        actorId: null,
      });
    });

    it('applyVerification leaves attached report_supporters untouched', async () => {
      const asset = await createAsset('T3-ASSET-AV-2', catElec);
      const first = await createReport(
        db!,
        {
          reporterId: reporterA,
          locationId: locA,
          assetId: asset,
          description: longDescription('verifikasi tautan pertama'),
        },
        randomUUID(),
      );
      const second = await createReport(
        db!,
        {
          reporterId: reporterB,
          locationId: locA,
          assetId: asset,
          description: longDescription('verifikasi tautan kedua'),
        },
        randomUUID(),
      );
      expect(second.kind).toBe('SUPPORTED');
      expect(second.report.id).toBe(first.report.id);

      const verified = await applyVerification(db!, first.report.id, {
        finalCategoryId: catElec,
        finalIssueTypeId: itElec,
        finalPriority: 'MEDIUM',
      });
      expect(verified.status).toBe('VERIFIED');
      const supporters = await db!
        .select()
        .from(reportSupporters)
        .where(eq(reportSupporters.reportId, first.report.id));
      expect(supporters).toHaveLength(1);
    });

    it('applyVerification rejects an unknown category before any write', async () => {
      const asset = await createAsset('T3-ASSET-AV-3', catElec);
      const created = await createReport(
        db!,
        {
          reporterId: reporterA,
          locationId: locA,
          assetId: asset,
          description: longDescription('verifikasi kategori tak dikenal'),
        },
        randomUUID(),
      );
      const eventsBefore = await db!
        .select()
        .from(reportEvents)
        .where(eq(reportEvents.reportId, created.report.id));
      await expect(
        applyVerification(db!, created.report.id, {
          finalCategoryId: randomUUID(),
          finalIssueTypeId: itElec,
          finalPriority: 'HIGH',
        }),
      ).rejects.toMatchObject({ status: 404 });

      const rows = await db!
        .select()
        .from(maintenanceReports)
        .where(eq(maintenanceReports.id, created.report.id));
      expect(rows[0]?.status).toBe('REPORTED');
      expect(rows[0]?.version).toBe(created.report.version);
      expect(rows[0]?.finalCategoryId).toBeNull();
      expect(
        await db!.select().from(reportEvents).where(eq(reportEvents.reportId, created.report.id)),
      ).toHaveLength(eventsBefore.length);
    });

    it('applyVerification rejects an issue type outside the final category before any write', async () => {
      const asset = await createAsset('T3-ASSET-AV-5', catElec);
      const created = await createReport(
        db!,
        {
          reporterId: reporterA,
          locationId: locA,
          assetId: asset,
          description: longDescription('verifikasi isu lintas kategori'),
        },
        randomUUID(),
      );
      const eventsBefore = await db!
        .select()
        .from(reportEvents)
        .where(eq(reportEvents.reportId, created.report.id));
      // itHvac is bound to T3-HVAC, not the T3-ELEC final category.
      await expect(
        applyVerification(db!, created.report.id, {
          finalCategoryId: catElec,
          finalIssueTypeId: itHvac,
          finalPriority: 'HIGH',
        }),
      ).rejects.toMatchObject({ status: 400 });

      const rows = await db!
        .select()
        .from(maintenanceReports)
        .where(eq(maintenanceReports.id, created.report.id));
      expect(rows[0]?.status).toBe('REPORTED');
      expect(rows[0]?.version).toBe(created.report.version);
      expect(rows[0]?.finalCategoryId).toBeNull();
      expect(rows[0]?.finalIssueTypeId).toBeNull();
      expect(
        await db!.select().from(reportEvents).where(eq(reportEvents.reportId, created.report.id)),
      ).toHaveLength(eventsBefore.length);
    });

    it('applyVerification rejects a final category outside the report asset category', async () => {
      const asset = await createAsset('T3-ASSET-AV-6', catElec);
      const created = await createReport(
        db!,
        {
          reporterId: reporterA,
          locationId: locA,
          assetId: asset,
          description: longDescription('verifikasi recode lintas aset'),
        },
        randomUUID(),
      );
      const eventsBefore = await db!
        .select()
        .from(reportEvents)
        .where(eq(reportEvents.reportId, created.report.id));
      // itHvac belongs to catHvac so the taxonomy checks pass; only the
      // asset-category guard (no silent recode) must fire.
      await expect(
        applyVerification(db!, created.report.id, {
          finalCategoryId: catHvac,
          finalIssueTypeId: itHvac,
          finalPriority: 'HIGH',
        }),
      ).rejects.toMatchObject({
        status: 400,
        message: 'Final category does not match asset category',
      });

      const rows = await db!
        .select()
        .from(maintenanceReports)
        .where(eq(maintenanceReports.id, created.report.id));
      expect(rows[0]?.status).toBe('REPORTED');
      expect(rows[0]?.version).toBe(created.report.version);
      expect(rows[0]?.finalCategoryId).toBeNull();
      expect(rows[0]?.finalIssueTypeId).toBeNull();
      expect(
        await db!.select().from(reportEvents).where(eq(reportEvents.reportId, created.report.id)),
      ).toHaveLength(eventsBefore.length);
    });

    it('applyVerification refuses a report that is no longer REPORTED', async () => {
      const asset = await createAsset('T3-ASSET-AV-4', catHvac);
      const created = await createReport(
        db!,
        {
          reporterId: reporterB,
          locationId: locB,
          assetId: asset,
          description: longDescription('verifikasi ganda pertama'),
        },
        randomUUID(),
      );
      await applyVerification(db!, created.report.id, {
        finalCategoryId: catHvac,
        finalIssueTypeId: itHvac,
        finalPriority: 'LOW',
      });
      await expect(
        applyVerification(db!, created.report.id, {
          finalCategoryId: catHvac,
          finalIssueTypeId: itHvac,
          finalPriority: 'LOW',
        }),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('floors a hand-verified DANGEROUS issue type to minimum HIGH', async () => {
      const asset = await createAsset('T3-ASSET-AV-DANGER', catElec);
      const created = await createReport(
        db!,
        {
          reporterId: reporterA,
          locationId: locA,
          assetId: asset,
          description: longDescription('verifikasi berbahaya'),
        },
        randomUUID(),
      );
      const itDangerous = (
        await db!
          .insert(issueTypes)
          .values({ code: 'DANGEROUS', name: 'T3 Dangerous', categoryId: catElec })
          .returning({ id: issueTypes.id })
      )[0]?.id as string;
      // Hand verify writes DANGEROUS + LOW; the stored final must be floored.
      const next = await applyVerification(db!, created.report.id, {
        finalCategoryId: catElec,
        finalIssueTypeId: itDangerous,
        finalPriority: 'LOW',
      });
      expect(next.status).toBe('VERIFIED');
      expect(next.finalIssueTypeId).toBe(itDangerous);
      expect(next.finalPriority).toBe('HIGH');
      const events = await db!
        .select()
        .from(reportEvents)
        .where(eq(reportEvents.reportId, created.report.id));
      const verifiedEvent = events.find((e) => e.eventType === 'REPORT_VERIFIED');
      expect((verifiedEvent?.metadata as Record<string, unknown>)?.['finalPriority']).toBe('HIGH');
    });

    it('attaches another reporter as supporter without creating a second REPORTED row', async () => {
      const reporterC = (
        await db!
          .insert(users)
          .values({ username: `p32-queue-${randomUUID()}`, role: 'REPORTER' })
          .returning({ id: users.id })
      )[0]?.id as string;
      const asset = await createAsset('T3-ASSET-QUEUE', catElec);
      const target = await createReport(
        db!,
        {
          reporterId: reporterA,
          locationId: locA,
          assetId: asset,
          description: longDescription('antrian target pertama'),
        },
        randomUUID(),
      );
      const merged = await createReport(
        db!,
        {
          reporterId: reporterC,
          locationId: locA,
          assetId: asset,
          description: longDescription('antrian digabung kedua'),
        },
        randomUUID(),
      );
      expect(merged.kind).toBe('SUPPORTED');
      expect(merged.report.id).toBe(target.report.id);

      const heldQueue = await listAllReports(db!, {
        status: 'REPORTED',
        reporterId: reporterC,
      });
      expect(heldQueue.items).toHaveLength(0);

      const targetQueue = await listAllReports(db!, {
        status: 'REPORTED',
        reporterId: reporterA,
      });
      expect(targetQueue.items.map((r) => r.ticketNumber)).toContain(target.report.ticketNumber);
    });

    // -----------------------------------------------------------------
    // Service reports (no asset): keyed by location + category.
    // -----------------------------------------------------------------

    it('creates a service report without an asset, filed under the service category', async () => {
      const result = await createReport(
        db!,
        {
          reporterId: reporterA,
          locationId: locC,
          serviceCategoryId: catAccess,
          description: longDescription('layanan akses pertama'),
        },
        randomUUID(),
      );
      expect(result.idempotentReplay).toBe(false);
      expect(result.kind).toBe('CREATED');
      expect(result.supporter).toBeNull();
      expect(result.report.assetId).toBeNull();
      expect(result.report.submittedCategoryId).toBe(catAccess);
      expect(result.report.locationId).toBe(locC);
      expect(result.report.status).toBe('REPORTED');
      svcFirstTicket = result.report.ticketNumber;
    });

    it('blocks a second service report by the same reporter, location and category (409, no ticket)', async () => {
      const seqBefore = await counterForYear();
      const blocked = await createReport(
        db!,
        {
          reporterId: reporterA,
          locationId: locC,
          serviceCategoryId: catAccess,
          description: longDescription('layanan akses kedua diblokir'),
        },
        randomUUID(),
      ).then(
        () => {
          throw new Error('test: blocked service submit unexpectedly succeeded');
        },
        (error: unknown) => error,
      );
      expect(blocked).toMatchObject({
        code: 'DUPLICATE_ACTIVE',
        status: 409,
        details: { ticketNumber: svcFirstTicket },
      });
      expect(
        await db!.select().from(maintenanceReports).where(eq(maintenanceReports.locationId, locC)),
      ).toHaveLength(1);
      expect(await counterForYear()).toBe(seqBefore);
    });

    it('attaches another reporter service report as supporter on the existing service ticket', async () => {
      const svcSupKey = randomUUID();
      const merged = await createReport(
        db!,
        {
          reporterId: reporterB,
          locationId: locC,
          serviceCategoryId: catAccess,
          description: longDescription('layanan akses dari pelapor lain'),
        },
        svcSupKey,
      );
      expect(merged.kind).toBe('SUPPORTED');
      expect(merged.report.ticketNumber).toBe(svcFirstTicket);
      expect(merged.report.assetId).toBeNull();

      // Same-key replay returns SUPPORTED replay.
      const replay = await createReport(
        db!,
        {
          reporterId: reporterB,
          locationId: locC,
          serviceCategoryId: catAccess,
          description: longDescription('layanan akses dari pelapor lain'),
        },
        svcSupKey,
      );
      expect(replay.kind).toBe('SUPPORTED');
      expect(replay.idempotentReplay).toBe(true);

      // Different key by the same supporting reporter blocks with 409.
      const blocked = await createReport(
        db!,
        {
          reporterId: reporterB,
          locationId: locC,
          serviceCategoryId: catAccess,
          description: longDescription('layanan akses ulang dari pendukung'),
        },
        randomUUID(),
      ).then(
        () => {
          throw new Error('expected 409 DUPLICATE_ACTIVE');
        },
        (error: unknown) => error,
      );
      expect(blocked).toMatchObject({
        code: 'DUPLICATE_ACTIVE',
        status: 409,
        details: { ticketNumber: svcFirstTicket },
      });
    });

    it('creates a separate report for the same location with a different service category', async () => {
      const other = await createReport(
        db!,
        {
          reporterId: reporterA,
          locationId: locC,
          serviceCategoryId: catSecurity,
          description: longDescription('layanan keamanan di ruangan yang sama'),
        },
        randomUUID(),
      );
      expect(other.kind).toBe('CREATED');
      expect(other.report.submittedCategoryId).toBe(catSecurity);
      expect(other.report.ticketNumber).not.toBe(svcFirstTicket);
    });

    it('never mixes service and damage reports at the same location', async () => {
      const freshAsset = await createAsset('T3-ASSET-SVC-ISO', catElec);
      const damage = await createReport(
        db!,
        {
          reporterId: reporterA,
          locationId: locA,
          assetId: freshAsset,
          description: longDescription('kerusakan aset terpisah'),
        },
        randomUUID(),
      );
      const service = await createReport(
        db!,
        {
          reporterId: reporterA,
          locationId: locA,
          serviceCategoryId: catAccess,
          description: longDescription('layanan akses di ruangan yang sama dengan kerusakan'),
        },
        randomUUID(),
      );
      expect(service.kind).toBe('CREATED');
      expect(service.duplicateCandidates).toEqual([]);
      expect(service.report.ticketNumber).not.toBe(damage.report.ticketNumber);

      // A later damage report on the same asset merges with the damage ticket,
      // never with the service report at the location.
      const damageLater = await createReport(
        db!,
        {
          reporterId: reporterB,
          locationId: locA,
          assetId: freshAsset,
          description: longDescription('kerusakan aset yang sama dari pelapor lain'),
        },
        randomUUID(),
      );
      expect(damageLater.kind).toBe('SUPPORTED');
      expect(damageLater.report.ticketNumber).toBe(damage.report.ticketNumber);
    });

    it('rejects an asset and a service category sent together with 400', async () => {
      await expect(
        createReport(
          db!,
          {
            reporterId: reporterA,
            locationId: locC,
            assetId: assetElec1,
            serviceCategoryId: catAccess,
            description: longDescription('dua target sekaligus'),
          },
          randomUUID(),
        ),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('rejects a damage category (requiresAsset=true) submitted without an asset with 400', async () => {
      await expect(
        createReport(
          db!,
          {
            reporterId: reporterA,
            locationId: locC,
            serviceCategoryId: catElec,
            description: longDescription('kategori kerusakan tanpa aset'),
          },
          randomUUID(),
        ),
      ).rejects.toMatchObject({ status: 400 });
    });

    it('applyVerification verifies a held service report under its reported service category', async () => {
      const locD = await freshRoom('T3-ROOM-D');
      const created = await createReport(
        db!,
        {
          reporterId: reporterA,
          locationId: locD,
          serviceCategoryId: catAccess,
          description: longDescription('verifikasi layanan akses'),
        },
        randomUUID(),
      );
      const next = await applyVerification(db!, created.report.id, {
        finalCategoryId: catAccess,
        finalIssueTypeId: itAccess,
        finalPriority: 'HIGH',
      });
      expect(next.status).toBe('VERIFIED');
      expect(next.assetId).toBeNull();
      expect(next.finalCategoryId).toBe(catAccess);
      expect(next.finalIssueTypeId).toBe(itAccess);
    });

    it('applyVerification rejects a service report finalized under another category, with no write', async () => {
      const locE = await freshRoom('T3-ROOM-E');
      const created = await createReport(
        db!,
        {
          reporterId: reporterA,
          locationId: locE,
          serviceCategoryId: catAccess,
          description: longDescription('verifikasi layanan pindah kategori'),
        },
        randomUUID(),
      );
      await expect(
        applyVerification(db!, created.report.id, {
          finalCategoryId: catSecurity,
          finalIssueTypeId: itGeneric,
          finalPriority: 'HIGH',
        }),
      ).rejects.toMatchObject({
        status: 400,
        message: 'Final category does not match the reported service category',
      });

      const rows = await db!
        .select()
        .from(maintenanceReports)
        .where(eq(maintenanceReports.id, created.report.id));
      expect(rows[0]?.status).toBe('REPORTED');
      expect(rows[0]?.finalCategoryId).toBeNull();
    });

    it('lists a service report with its category name and no asset name', async () => {
      const locF = await freshRoom('T3-ROOM-F');
      const created = await createReport(
        db!,
        {
          reporterId: reporterA,
          locationId: locF,
          serviceCategoryId: catAccess,
          description: longDescription('daftar layanan tanpa aset'),
        },
        randomUUID(),
      );
      const campus = await listCampusReports(db!, reporterA, {
        search: created.report.ticketNumber,
      });
      const item = campus.items.find((row) => row.id === created.report.id);
      expect(item?.assetId).toBeNull();
      expect(item?.assetName).toBeNull();
      expect(item?.submittedCategoryName).toBe('T3 T3-ACCESS');
    });

    it('filters the admin list by report kind: service rows have no asset, damage rows do', async () => {
      const locG = await freshRoom('T3-ROOM-G');
      const svc = await createReport(
        db!,
        {
          reporterId: reporterA,
          locationId: locG,
          serviceCategoryId: catAccess,
          description: longDescription('filter jenis layanan'),
        },
        randomUUID(),
      );
      const dmgAsset = await createAsset('T3-ASSET-KIND-1', catElec);
      const dmg = await createReport(
        db!,
        {
          reporterId: reporterB,
          locationId: locA,
          assetId: dmgAsset,
          description: longDescription('filter jenis kerusakan'),
        },
        randomUUID(),
      );
      const serviceOnly = await listAllReports(db!, {
        reportKind: 'SERVICE',
        search: svc.report.ticketNumber,
      });
      expect(serviceOnly.items.map((row) => row.ticketNumber)).toEqual([svc.report.ticketNumber]);
      expect(serviceOnly.items.every((row) => row.assetId === null)).toBe(true);

      const damageOnly = await listAllReports(db!, {
        reportKind: 'DAMAGE',
        search: dmg.report.ticketNumber,
      });
      expect(damageOnly.items.map((row) => row.ticketNumber)).toEqual([dmg.report.ticketNumber]);

      // A service ticket never shows under the damage filter.
      const crossed = await listAllReports(db!, {
        reportKind: 'DAMAGE',
        search: svc.report.ticketNumber,
      });
      expect(crossed.items).toEqual([]);
    });

    it('rejects an inactive service category with 400 and an unknown one with 404', async () => {
      await expect(
        createReport(
          db!,
          {
            reporterId: reporterA,
            locationId: locC,
            serviceCategoryId: catServiceOff,
            description: longDescription('kategori layanan nonaktif'),
          },
          randomUUID(),
        ),
      ).rejects.toMatchObject({ status: 400 });
      await expect(
        createReport(
          db!,
          {
            reporterId: reporterA,
            locationId: locC,
            serviceCategoryId: randomUUID(),
            description: longDescription('kategori layanan tidak ada'),
          },
          randomUUID(),
        ),
      ).rejects.toMatchObject({ status: 404 });
    });

    // -----------------------------------------------------------------
    // Master-data guards for requires_asset (admin category/asset API).
    // -----------------------------------------------------------------

    const masterCtx = { actorId: null, requestId: null };

    it('refuses to attach an asset to a service category, on create and on update, with 400', async () => {
      await expect(
        repoCreateAsset(
          db!,
          { assetCode: `T3-SVC-ASSET-${randomUUID()}`, name: 'Aset salah', categoryId: catAccess },
          masterCtx,
        ),
      ).rejects.toMatchObject({ status: 400, message: 'Service category cannot have assets' });
      await expect(
        repoUpdateAsset(db!, assetElec1, { categoryId: catAccess }, masterCtx),
      ).rejects.toMatchObject({ status: 400, message: 'Service category cannot have assets' });
    });

    it('creates a category as damage (requiresAsset true) by default and as service when asked', async () => {
      const defaulted = await repoCreateCategory(
        db!,
        { code: `T3-DEF-${randomUUID().slice(0, 8)}`, name: 'Default' },
        masterCtx,
      );
      expect(defaulted.requiresAsset).toBe(true);
      const service = await repoCreateCategory(
        db!,
        { code: `T3-SVC-${randomUUID().slice(0, 8)}`, name: 'Layanan', requiresAsset: false },
        masterCtx,
      );
      expect(service.requiresAsset).toBe(false);
    });

    it('turns an asset-less category into a service category and back', async () => {
      const made = await repoCreateCategory(
        db!,
        { code: `T3-FLIP-${randomUUID().slice(0, 8)}`, name: 'Flip' },
        masterCtx,
      );
      const asService = await repoUpdateCategory(db!, made.id, { requiresAsset: false }, masterCtx);
      expect(asService.requiresAsset).toBe(false);
      const back = await repoUpdateCategory(db!, made.id, { requiresAsset: true }, masterCtx);
      expect(back.requiresAsset).toBe(true);
    });

    it('refuses to turn a category that already owns assets into a service category, with 409 and no write', async () => {
      await expect(
        repoUpdateCategory(db!, catElec, { requiresAsset: false }, masterCtx),
      ).rejects.toMatchObject({ status: 409 });
      const rows = await db!
        .select()
        .from(facilityCategories)
        .where(eq(facilityCategories.id, catElec));
      expect(rows[0]?.requiresAsset).toBe(true);
    });

    it('countAffectedReporters counts primary + report_supporters across null/non-null issueTypeId and ignores non-active rows', async () => {
      const asset = await createAsset(`T3-ASSET-CNT-${randomUUID()}`, catElec);
      const first = await createReport(
        db!,
        {
          reporterId: reporterA,
          locationId: locA,
          assetId: asset,
          description: longDescription('hitung pelapor terdampak utama'),
        },
        randomUUID(),
      );
      const second = await createReport(
        db!,
        {
          reporterId: reporterB,
          locationId: locA,
          assetId: asset,
          description: longDescription('hitung pelapor terdampak pendukung'),
        },
        randomUUID(),
      );
      expect(second.kind).toBe('SUPPORTED');

      // Both null issueTypeId and specific final issueTypeId must count primary + supporter on held REPORTED row.
      expect(
        await countAffectedReporters(db!, {
          assetId: asset,
          locationId: locA,
          categoryId: catElec,
          issueTypeId: null,
        }),
      ).toBe(2);
      expect(
        await countAffectedReporters(db!, {
          assetId: asset,
          locationId: locA,
          categoryId: catElec,
          issueTypeId: itElec,
        }),
      ).toBe(2);

      await applyVerification(db!, first.report.id, {
        finalCategoryId: catElec,
        finalIssueTypeId: itElec,
        finalPriority: 'LOW',
      });
      expect(
        await countAffectedReporters(db!, {
          assetId: asset,
          locationId: locA,
          categoryId: catElec,
          issueTypeId: itElec,
        }),
      ).toBe(2);

      await db!
        .update(maintenanceReports)
        .set({ status: 'RESOLVED' })
        .where(eq(maintenanceReports.id, first.report.id));
      expect(
        await countAffectedReporters(db!, {
          assetId: asset,
          locationId: locA,
          categoryId: catElec,
          issueTypeId: itElec,
        }),
      ).toBe(0);
    });

    it('re-scores a verified LOW ticket upward when a supporter joins and records PRIORITY_CHANGED', async () => {
      const room = (
        await db!
          .insert(locations)
          .values({
            type: 'ROOM',
            code: `T3-RESCORE-R-${randomUUID().slice(0, 8)}`,
            name: 'Ruang Rescore',
            tierScore: 10,
          })
          .returning({ id: locations.id })
      )[0]?.id as string;
      const cat = (
        await db!
          .insert(facilityCategories)
          .values({
            code: `T3-RSC-${randomUUID().slice(0, 8)}`,
            name: 'Kategori Rescore',
            weight: 15,
          })
          .returning({ id: facilityCategories.id })
      )[0]?.id as string;
      const it = (
        await db!
          .insert(issueTypes)
          .values({
            code: `T3-IT-RSC-${randomUUID().slice(0, 8)}`,
            name: 'Issue Rescore',
            categoryId: cat,
          })
          .returning({ id: issueTypes.id })
      )[0]?.id as string;
      const asset = (
        await db!
          .insert(facilityAssets)
          .values({
            assetCode: `T3-AST-RSC-${randomUUID().slice(0, 8)}`,
            name: 'Aset Rescore',
            categoryId: cat,
            locationId: room,
            weight: 12,
          })
          .returning({ id: facilityAssets.id })
      )[0]?.id as string;

      const created = await createReport(
        db!,
        {
          reporterId: reporterA,
          locationId: room,
          assetId: asset,
          description: longDescription('rescore tiket verified low'),
        },
        randomUUID(),
      );
      const verified = await applyVerification(db!, created.report.id, {
        finalCategoryId: cat,
        finalIssueTypeId: it,
        finalPriority: 'LOW',
      });
      // 15 + 12 + 10 + 0 = 37 → LOW.
      expect(verified.priorityScore).toBe(37);
      expect(verified.finalPriority).toBe('LOW');

      const merged = await createReport(
        db!,
        {
          reporterId: reporterB,
          locationId: room,
          assetId: asset,
          description: longDescription('pendukung menaikkan skor ke medium'),
        },
        randomUUID(),
      );
      expect(merged.kind).toBe('SUPPORTED');
      if (merged.kind !== 'SUPPORTED') {
        throw new Error('expected SUPPORTED');
      }
      // 15 + 12 + 10 + 5 (2 reporters) = 42 → MEDIUM.
      expect(merged.affectedReporters).toBe(2);
      expect(merged.report.priorityScore).toBe(42);
      expect(merged.report.finalPriority).toBe('MEDIUM');
      expect(merged.report.version).toBe(verified.version + 1);
      expect(merged.report.priorityFactors).toMatchObject({
        category: 15,
        asset: 12,
        location: 10,
        frequency: 5,
        affectedReporters: 2,
        scoringComplete: true,
      });

      const events = await db!
        .select()
        .from(reportEvents)
        .where(eq(reportEvents.reportId, created.report.id));
      const priorityChanged = events.find((e) => e.eventType === 'PRIORITY_CHANGED');
      expect(priorityChanged).toBeDefined();
      expect(priorityChanged?.fromValue).toBe('LOW');
      expect(priorityChanged?.toValue).toBe('MEDIUM');
      expect(priorityChanged?.metadata).toMatchObject({
        reason: 'SUPPORTER_ADDED',
        supporterId: merged.supporter.id,
        affectedReporters: 2,
      });
    });

    it('updates score without downgrading HIGH or overwriting admin priority override', async () => {
      const room = (
        await db!
          .insert(locations)
          .values({
            type: 'ROOM',
            code: `T3-OVR-R-${randomUUID().slice(0, 8)}`,
            name: 'Ruang Override',
            tierScore: 10,
          })
          .returning({ id: locations.id })
      )[0]?.id as string;
      const cat = (
        await db!
          .insert(facilityCategories)
          .values({
            code: `T3-OVR-${randomUUID().slice(0, 8)}`,
            name: 'Kategori Override',
            weight: 15,
          })
          .returning({ id: facilityCategories.id })
      )[0]?.id as string;
      const it = (
        await db!
          .insert(issueTypes)
          .values({
            code: `T3-IT-OVR-${randomUUID().slice(0, 8)}`,
            name: 'Issue Override',
            categoryId: cat,
          })
          .returning({ id: issueTypes.id })
      )[0]?.id as string;
      const highAsset = (
        await db!
          .insert(facilityAssets)
          .values({
            assetCode: `T3-AST-HI-${randomUUID().slice(0, 8)}`,
            name: 'Aset High',
            categoryId: cat,
            locationId: room,
            weight: 12,
          })
          .returning({ id: facilityAssets.id })
      )[0]?.id as string;
      const ovrAsset = (
        await db!
          .insert(facilityAssets)
          .values({
            assetCode: `T3-AST-OV-${randomUUID().slice(0, 8)}`,
            name: 'Aset Override',
            categoryId: cat,
            locationId: room,
            weight: 12,
          })
          .returning({ id: facilityAssets.id })
      )[0]?.id as string;

      // Case A: already HIGH (even though computed score suggests MEDIUM).
      const highCreated = await createReport(
        db!,
        {
          reporterId: reporterA,
          locationId: room,
          assetId: highAsset,
          description: longDescription('tiket sudah high'),
        },
        randomUUID(),
      );
      await applyVerification(db!, highCreated.report.id, {
        finalCategoryId: cat,
        finalIssueTypeId: it,
        finalPriority: 'HIGH',
      });
      const highMerged = await createReport(
        db!,
        {
          reporterId: reporterB,
          locationId: room,
          assetId: highAsset,
          description: longDescription('pendukung pada tiket high'),
        },
        randomUUID(),
      );
      expect(highMerged.report.priorityScore).toBe(42);
      expect(highMerged.report.finalPriority).toBe('HIGH');
      expect(highMerged.report.priorityFactors).toMatchObject({ affectedReporters: 2 });
      const highEvents = await db!
        .select()
        .from(reportEvents)
        .where(eq(reportEvents.reportId, highCreated.report.id));
      expect(highEvents.some((e) => e.eventType === 'PRIORITY_CHANGED')).toBe(false);

      // Case B: admin manual override on LOW is preserved when score crosses MEDIUM threshold.
      const ovrCreated = await createReport(
        db!,
        {
          reporterId: reporterA,
          locationId: room,
          assetId: ovrAsset,
          description: longDescription('tiket override manual admin'),
        },
        randomUUID(),
      );
      await applyVerification(db!, ovrCreated.report.id, {
        finalCategoryId: cat,
        finalIssueTypeId: it,
        finalPriority: 'LOW',
      });
      await db!
        .update(maintenanceReports)
        .set({ priorityOverrideReason: 'Diputuskan admin tetap LOW' })
        .where(eq(maintenanceReports.id, ovrCreated.report.id));
      const ovrMerged = await createReport(
        db!,
        {
          reporterId: reporterB,
          locationId: room,
          assetId: ovrAsset,
          description: longDescription('pendukung pada tiket override'),
        },
        randomUUID(),
      );
      expect(ovrMerged.report.priorityScore).toBe(42);
      expect(ovrMerged.report.finalPriority).toBe('LOW');
      expect(ovrMerged.report.priorityFactors).toMatchObject({ affectedReporters: 2 });
      const ovrEvents = await db!
        .select()
        .from(reportEvents)
        .where(eq(reportEvents.reportId, ovrCreated.report.id));
      expect(ovrEvents.some((e) => e.eventType === 'PRIORITY_CHANGED')).toBe(false);
    });

    it('preserves assetless flag on verified service report when supporter joins', async () => {
      const room = (
        await db!
          .insert(locations)
          .values({
            type: 'ROOM',
            code: `T3-SVC-R-${randomUUID().slice(0, 8)}`,
            name: 'Ruang Layanan Rescore',
            tierScore: 10,
          })
          .returning({ id: locations.id })
      )[0]?.id as string;
      const svcCat = (
        await db!
          .insert(facilityCategories)
          .values({
            code: `T3-SVC-RSC-${randomUUID().slice(0, 8)}`,
            name: 'Layanan Rescore',
            weight: 15,
            requiresAsset: false,
          })
          .returning({ id: facilityCategories.id })
      )[0]?.id as string;
      const created = await createReport(
        db!,
        {
          reporterId: reporterA,
          locationId: room,
          serviceCategoryId: svcCat,
          description: longDescription('layanan verified untuk rescore'),
        },
        randomUUID(),
      );
      const verified = await applyVerification(db!, created.report.id, {
        finalCategoryId: svcCat,
        finalIssueTypeId: itGeneric,
        finalPriority: 'LOW',
      });
      // 15 (category) + 12 (asset median) + 10 (location) + 0 = 37; assetless: true.
      expect(verified.priorityScore).toBe(37);
      expect(verified.priorityFactors).toMatchObject({
        assetless: true,
        scoringComplete: false,
        affectedReporters: 1,
      });

      const merged = await createReport(
        db!,
        {
          reporterId: reporterB,
          locationId: room,
          serviceCategoryId: svcCat,
          description: longDescription('pendukung layanan verified'),
        },
        randomUUID(),
      );
      expect(merged.report.priorityScore).toBe(42);
      expect(merged.report.finalPriority).toBe('MEDIUM');
      expect(merged.report.priorityFactors).toMatchObject({
        assetless: true,
        scoringComplete: false,
        frequency: 5,
        affectedReporters: 2,
      });
    });

    it('keeps held REPORTED ticket unscored on supporter join, then scores with 2 reporters on applyVerification', async () => {
      const room = (
        await db!
          .insert(locations)
          .values({
            type: 'ROOM',
            code: `T3-HLD-R-${randomUUID().slice(0, 8)}`,
            name: 'Ruang Held',
            tierScore: 10,
          })
          .returning({ id: locations.id })
      )[0]?.id as string;
      const cat = (
        await db!
          .insert(facilityCategories)
          .values({
            code: `T3-HLD-${randomUUID().slice(0, 8)}`,
            name: 'Kategori Held',
            weight: 10,
          })
          .returning({ id: facilityCategories.id })
      )[0]?.id as string;
      const it = (
        await db!
          .insert(issueTypes)
          .values({
            code: `T3-IT-HLD-${randomUUID().slice(0, 8)}`,
            name: 'Issue Held',
            categoryId: cat,
          })
          .returning({ id: issueTypes.id })
      )[0]?.id as string;
      const asset = (
        await db!
          .insert(facilityAssets)
          .values({
            assetCode: `T3-AST-HLD-${randomUUID().slice(0, 8)}`,
            name: 'Aset Held',
            categoryId: cat,
            locationId: room,
            weight: 10,
          })
          .returning({ id: facilityAssets.id })
      )[0]?.id as string;

      const created = await createReport(
        db!,
        {
          reporterId: reporterA,
          locationId: room,
          assetId: asset,
          description: longDescription('tiket held belum verifikasi'),
        },
        randomUUID(),
      );
      const merged = await createReport(
        db!,
        {
          reporterId: reporterB,
          locationId: room,
          assetId: asset,
          description: longDescription('pendukung pada tiket held'),
        },
        randomUUID(),
      );
      expect(merged.kind).toBe('SUPPORTED');
      expect(merged.report.status).toBe('REPORTED');
      expect(merged.report.finalCategoryId).toBeNull();
      expect(merged.report.finalIssueTypeId).toBeNull();
      expect(merged.report.priorityScore).toBeNull();
      expect(merged.report.priorityFactors).toBeNull();
      expect(merged.report.finalPriority).toBeNull();

      const heldEvents = await db!
        .select()
        .from(reportEvents)
        .where(eq(reportEvents.reportId, created.report.id));
      expect(heldEvents.some((e) => e.eventType === 'PRIORITY_CHANGED')).toBe(false);

      expect(
        await countAffectedReporters(db!, {
          assetId: asset,
          locationId: room,
          categoryId: cat,
          issueTypeId: it,
        }),
      ).toBe(2);

      const verified = await applyVerification(db!, created.report.id, {
        finalCategoryId: cat,
        finalIssueTypeId: it,
        finalPriority: 'LOW',
      });
      // 10 + 10 + 10 + 5 = 35.
      expect(verified.priorityScore).toBe(35);
      expect(verified.priorityFactors).toMatchObject({
        category: 10,
        asset: 10,
        location: 10,
        frequency: 5,
        affectedReporters: 2,
        scoringComplete: true,
      });
    });

    it('compensateFailedSupporter rolls back supporter, PRIORITY_CHANGED event, and priority score/level while keeping primary report', async () => {
      const room = (
        await db!
          .insert(locations)
          .values({
            type: 'ROOM',
            code: `T3-CMP-R-${randomUUID().slice(0, 8)}`,
            name: 'Ruang Kompensasi',
            tierScore: 10,
          })
          .returning({ id: locations.id })
      )[0]?.id as string;
      const cat = (
        await db!
          .insert(facilityCategories)
          .values({
            code: `T3-CMP-${randomUUID().slice(0, 8)}`,
            name: 'Kategori Kompensasi',
            weight: 15,
          })
          .returning({ id: facilityCategories.id })
      )[0]?.id as string;
      const it = (
        await db!
          .insert(issueTypes)
          .values({
            code: `T3-IT-CMP-${randomUUID().slice(0, 8)}`,
            name: 'Issue Kompensasi',
            categoryId: cat,
          })
          .returning({ id: issueTypes.id })
      )[0]?.id as string;
      const asset = (
        await db!
          .insert(facilityAssets)
          .values({
            assetCode: `T3-AST-CMP-${randomUUID().slice(0, 8)}`,
            name: 'Aset Kompensasi',
            categoryId: cat,
            locationId: room,
            weight: 12,
          })
          .returning({ id: facilityAssets.id })
      )[0]?.id as string;

      const created = await createReport(
        db!,
        {
          reporterId: reporterA,
          locationId: room,
          assetId: asset,
          description: longDescription('tiket utama sebelum kompensasi'),
        },
        randomUUID(),
      );
      await applyVerification(db!, created.report.id, {
        finalCategoryId: cat,
        finalIssueTypeId: it,
        finalPriority: 'LOW',
      });
      const merged = await createReport(
        db!,
        {
          reporterId: reporterB,
          locationId: room,
          assetId: asset,
          description: longDescription('pendukung gagal klaim foto'),
        },
        randomUUID(),
      );
      if (merged.kind !== 'SUPPORTED') {
        throw new Error('expected SUPPORTED');
      }
      expect(merged.report.priorityScore).toBe(42);
      expect(merged.report.finalPriority).toBe('MEDIUM');

      await compensateFailedSupporter(db!, merged.supporter.id);

      const supportersAfter = await db!
        .select()
        .from(reportSupporters)
        .where(eq(reportSupporters.reportId, created.report.id));
      expect(supportersAfter).toHaveLength(0);

      const eventsAfter = await db!
        .select()
        .from(reportEvents)
        .where(eq(reportEvents.reportId, created.report.id));
      expect(eventsAfter.some((e) => e.eventType === 'SUPPORTER_ADDED')).toBe(false);
      expect(eventsAfter.some((e) => e.eventType === 'PRIORITY_CHANGED')).toBe(false);

      const primaryAfter = (
        await db!
          .select()
          .from(maintenanceReports)
          .where(eq(maintenanceReports.id, created.report.id))
      )[0];
      expect(primaryAfter).toBeDefined();
      expect(primaryAfter?.priorityScore).toBe(37);
      expect(primaryAfter?.finalPriority).toBe('LOW');
      expect(primaryAfter?.priorityFactors).toMatchObject({
        affectedReporters: 1,
        frequency: 0,
      });
    });
  },
);
it('reports Task 3 availability (informational)', () => {
  if (!enabled) {
    console.log(
      'SKIP Task 3 integration: PostgreSQL unreachable at ' +
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
//
// Fixtures below insert rows directly (bypassing createReport) so the query,
// link, and count paths keep their legacy incident shapes (null asset +
// submitted category) independent of the Task 3 submit contract.
// ---------------------------------------------------------------------------

// Validation in every P3-3 entrypoint runs before the first query, so pure
// tests pass a stub that would crash on use; any path reaching the database
// with this stub fails loudly instead of passing silently.
const stubDb = undefined as never;

describe('report kind filter (pure)', () => {
  it('rejects an unknown kind with 400 before any query', async () => {
    await expect(listAllReports(stubDb, { reportKind: 'OTHER' })).rejects.toMatchObject({
      status: 400,
    });
  });
});

describe('P3-3 list validation (pure)', () => {
  it('rejects invalid status values with 400', async () => {
    await expect(listMyReports(stubDb, VALID_UUID_A, { status: 'BOGUS' })).rejects.toMatchObject({
      status: 400,
    });
    await expect(
      listMyReports(stubDb, VALID_UUID_A, { status: ['REPORTED', 'NOPE'] }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects invalid priority values with 400', async () => {
    await expect(listMyReports(stubDb, VALID_UUID_A, { priority: 'URGENT' })).rejects.toMatchObject(
      { status: 400 },
    );
  });

  it('rejects invalid from/to dates with 400', async () => {
    await expect(listMyReports(stubDb, VALID_UUID_A, { from: 'not-a-date' })).rejects.toMatchObject(
      { status: 400 },
    );
    await expect(listMyReports(stubDb, VALID_UUID_A, { to: '2342-13-99' })).rejects.toMatchObject({
      status: 400,
    });
  });

  it('rejects invalid sort values with 400', async () => {
    await expect(listMyReports(stubDb, VALID_UUID_A, { sort: 'newest' })).rejects.toMatchObject({
      status: 400,
    });
    await expect(listAllReports(stubDb, { sort: 'ticket_up' })).rejects.toMatchObject({
      status: 400,
    });
  });

  it('rejects too-short and too-long search with 400', async () => {
    await expect(listAllReports(stubDb, { search: 'x' })).rejects.toMatchObject({
      status: 400,
    });
    await expect(listAllReports(stubDb, { search: 'x'.repeat(101) })).rejects.toMatchObject({
      status: 400,
    });
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
    for (const sort of [
      'reported_desc',
      'reported_asc',
      'ticket_asc',
      'ticket_desc',
      'priority_desc',
    ] as const) {
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

  it('orders the admin priority sort by score desc with nulls last', () => {
    expect(reportOrderBy('priority_desc')[0]).toEqual({
      column: 'priorityScore',
      direction: 'desc',
      nullsLast: true,
    });
    expect(reportOrderBy('priority_desc')[1]).toEqual({
      column: 'reportedAt',
      direction: 'desc',
    });
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
        categoryId: VALID_UUID_A,
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

describe.skipIf(!enabled)(
  'P3-3 report queries + supporting links (requires reachable PostgreSQL)',
  () => {
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

    beforeAll(async () => {
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

      // Direct REPORTED inserts (bypass createReport): query/link/count paths
      // keep legacy incident shapes (null asset + submitted category) so they
      // stay independent of the Task 3 submit contract.
      const report = async (
        reporterId: string,
        categoryId: string,
        description: string,
      ): Promise<{ id: string; ticketNumber: string }> => {
        const ticketNumber = `P33-${randomUUID()}`;
        const inserted = await db!
          .insert(maintenanceReports)
          .values({
            ticketNumber,
            idempotencyKey: randomUUID(),
            reporterId,
            locationId: locA,
            assetId: null,
            submittedCategoryId: categoryId,
            submittedIssueTypeId: null,
            description,
            status: 'REPORTED',
          })
          .returning({ id: maintenanceReports.id });
        const id = inserted[0]?.id;
        if (id === undefined) {
          throw new Error('fixture: report insert failed');
        }
        await db!.insert(reportEvents).values({
          reportId: id,
          eventType: 'REPORT_CREATED',
          actorId: reporterId,
        });
        return { id, ticketNumber };
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
    }, 120_000);

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
      const foreign = await getMyReportDetail(db!, reporterB, a1Id).catch(
        (error: unknown) => error,
      );
      const missing = await getMyReportDetail(db!, reporterA, randomUUID()).catch(
        (error: unknown) => error,
      );
      expect(String((foreign as Error).message)).toBe(String((missing as Error).message));
    });

    it('lists every campus ticket with a sanitized projection; mine narrows to the viewer', async () => {
      const campus = await listCampusReports(db!, reporterB, {});
      expect(campus.total).toBe(5);
      expect(campus.items).toHaveLength(5);
      expect(campus.items.filter((item) => item.isOwn)).toHaveLength(2);
      for (const item of campus.items) {
        expect(Object.keys(item)).not.toContain('reporterId');
        expect(Object.keys(item)).not.toContain('idempotencyKey');
      }

      const mine = await listCampusReports(db!, reporterB, { mine: true });
      expect(mine.total).toBe(2);
      expect(mine.items).toHaveLength(2);
      expect(mine.items.every((item) => item.isOwn)).toBe(true);
    });

    it('returns sanitized campus detail with attachments for another reporter but owner-only candidates', async () => {
      const foreign = await getCampusReportDetail(db!, reporterB, a1Id);
      expect(foreign.isOwn).toBe(false);
      expect(foreign.attachments).toHaveLength(1);
      expect(foreign.duplicateCandidates).toEqual([]);
      expect(Object.keys(foreign.report)).not.toContain('reporterId');
      expect(Object.keys(foreign.report)).not.toContain('idempotencyKey');
      expect(foreign.report.ticketNumber).toBe(a1Ticket);
      for (const relation of foreign.relations) {
        expect(Object.keys(relation)).not.toContain('createdBy');
      }

      const own = await getCampusReportDetail(db!, reporterA, a1Id);
      expect(own.isOwn).toBe(true);
      expect(own.attachments).toHaveLength(1);
      expect(own.duplicateCandidates.length).toBeGreaterThan(0);
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
        await db!
          .update(maintenanceReports)
          .set({ reportedAt: tied })
          .where(eq(maintenanceReports.id, id));
      }
      const page = await listMyReports(db!, reporterA, { sort: 'reported_desc' });
      expect(page.items.map((r) => r.id)).toEqual([a1Id, a2Id, a3Id].sort());
    });

    it('narrows by status + category + date range + priority', async () => {
      await db!
        .update(maintenanceReports)
        .set({ status: 'VERIFIED' })
        .where(eq(maintenanceReports.id, a2Id));
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
        originalFilename: 'photo.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 1234,
      });
      // Public-safe projection: exact keys only — the opaque `storageKey`,
      // `uploadedBy` (user id), and redundant `reportId` never leave the repo.
      expect(Object.keys(detail.attachments[0] ?? {}).sort()).toEqual(
        [
          'checksum',
          'createdAt',
          'id',
          'mimeType',
          'originalFilename',
          'sizeBytes',
          'supporterId',
        ].sort(),
      );
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

    it('never exposes storageKey/uploadedBy in reporter or admin detail payloads', async () => {
      const reporterDetail = await getMyReportDetail(db!, reporterA, a1Id);
      const adminDetail = await getAdminReportDetail(db!, a1Id);
      for (const detail of [reporterDetail, adminDetail]) {
        expect(detail.attachments).toHaveLength(1);
        const serialized = JSON.stringify(detail.attachments);
        expect(serialized).not.toContain('storageKey');
        expect(serialized).not.toContain('uploadedBy');
        // `reportId` lives on events/relations rows, but never on attachments.
        expect(serialized).not.toContain('reportId');
        for (const row of detail.attachments) {
          expect('storageKey' in row).toBe(false);
          expect('uploadedBy' in row).toBe(false);
          expect('reportId' in row).toBe(false);
        }
      }
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
      expect(timeline[0]).toMatchObject({ type: 'REPORT_CREATED', actorId: null });
      expect(timeline[1]).toMatchObject({ type: 'PROGRESS_NOTE_ADDED', actorId: null });
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
        const rows =
          await conn`EXPLAIN SELECT id FROM maintenance_reports WHERE reporter_id = ${reporterA} AND status = 'REPORTED' ORDER BY reported_at DESC, id ASC LIMIT 50`;
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

    it('counts affected reporters across the incident plus links (non-active rows collapse)', async () => {
      await db!
        .update(maintenanceReports)
        .set({ status: 'CLOSED' })
        .where(eq(maintenanceReports.id, a3Id));
      // Same-reporter CLOSED row collapses: reporter A still counts once via
      // the remaining actives. Linked reporter B counts via B1→A1 SUPPORTING.
      expect(
        await countAffectedReporters(db!, {
          assetId: null,
          locationId: locA,
          categoryId: catA,
          issueTypeId: null,
        }),
      ).toBe(2);

      // An unlinked non-active row from a third reporter contributes nothing.
      const c1 = await db!
        .insert(maintenanceReports)
        .values({
          ticketNumber: `P33-${randomUUID()}`,
          idempotencyKey: randomUUID(),
          reporterId: reporterC,
          locationId: locA,
          assetId: null,
          submittedCategoryId: catA,
          submittedIssueTypeId: null,
          description: 'Keran wastafel patah dan air mengucur terus menerus.',
          status: 'REPORTED',
        })
        .returning({ id: maintenanceReports.id });
      const c1Id = c1[0]?.id as string;
      await db!
        .update(maintenanceReports)
        .set({ status: 'RESOLVED' })
        .where(eq(maintenanceReports.id, c1Id));
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

    it('treats date-only filters as inclusive Jakarta days on the report list', async () => {
      const insertAt = async (ticketNumber: string, reportedAt: Date): Promise<void> => {
        await db!.insert(maintenanceReports).values({
          ticketNumber,
          idempotencyKey: randomUUID(),
          reporterId: reporterA,
          locationId: locA,
          assetId: null,
          submittedCategoryId: catA,
          description: 'Uji batas hari Jakarta pada filter tanggal daftar laporan.',
          status: 'REPORTED',
          reportedAt,
        });
      };
      // Jakarta 2026-03-01 spans [2026-02-28T17:00Z, 2026-03-01T17:00Z).
      await insertAt('P33-JB-IN-START', new Date('2026-02-28T17:00:00.000Z'));
      await insertAt('P33-JB-OUT-BEFORE', new Date('2026-02-28T16:59:59.000Z'));
      await insertAt('P33-JB-IN-END', new Date('2026-03-01T16:59:59.000Z'));
      await insertAt('P33-JB-OUT-AFTER', new Date('2026-03-01T17:00:00.000Z'));

      const page = await listAllReports(db!, {
        from: '2026-03-01',
        to: '2026-03-01',
        limit: 50,
      });
      const tickets = page.items.map((item) => item.ticketNumber);
      expect(tickets).toContain('P33-JB-IN-START');
      expect(tickets).toContain('P33-JB-IN-END');
      expect(tickets).not.toContain('P33-JB-OUT-BEFORE');
      expect(tickets).not.toContain('P33-JB-OUT-AFTER');
    });

    it('searches campus by asset/location, masks hidden locations, and reports KPI counts', async () => {
      const before = await getCampusReportStats(db!, reporterB);

      const visibleLocationId = (
        await db!
          .insert(locations)
          .values({
            type: 'ROOM',
            code: `P33-VISIBLE-${randomUUID()}`,
            name: 'Ruang Rapat Melati',
            buildingCode: 'Z',
            floorNumber: 2,
          })
          .returning({ id: locations.id })
      )[0]?.id as string;
      const hiddenLocationId = (
        await db!
          .insert(locations)
          .values({
            type: 'ROOM',
            code: `P33-HIDDEN-${randomUUID()}`,
            name: 'Ruang Lift Rahasia',
            reporterHidden: true,
          })
          .returning({ id: locations.id })
      )[0]?.id as string;
      const assetId = (
        await db!
          .insert(facilityAssets)
          .values({
            assetCode: `P33-ASSET-${randomUUID()}`,
            name: 'Proyektor P33',
            categoryId: catB,
            locationId: visibleLocationId,
          })
          .returning({ id: facilityAssets.id })
      )[0]?.id as string;

      const insertCampusReport = async (
        locationId: string,
        linkedAssetId: string | null,
        factors: Record<string, unknown> | null = null,
      ): Promise<string> => {
        const rows = await db!
          .insert(maintenanceReports)
          .values({
            ticketNumber: `P33-${randomUUID()}`,
            idempotencyKey: randomUUID(),
            reporterId: reporterB,
            locationId,
            assetId: linkedAssetId,
            submittedCategoryId: catB,
            submittedIssueTypeId: null,
            description: 'Laporan uji pencarian kampus dan sanitasi lokasi tersembunyi.',
            status: 'REPORTED',
            priorityFactors: factors,
          })
          .returning({ id: maintenanceReports.id });
        return rows[0]?.id as string;
      };
      const assetReportId = await insertCampusReport(visibleLocationId, assetId, {
        affectedReporters: 4,
      });
      const visibleReportId = await insertCampusReport(visibleLocationId, null);
      const hiddenReportId = await insertCampusReport(hiddenLocationId, null);

      const after = await getCampusReportStats(db!, reporterB);
      expect(after.total).toBe(before.total + 3);
      expect(after.active).toBe(before.active + 3);
      expect(after.done).toBe(before.done);
      expect(after.mineTotal).toBe(before.mineTotal + 3);

      const byAsset = await listCampusReports(db!, reporterB, { search: 'Proyektor' });
      expect(byAsset.items.map((item) => item.id)).toEqual([assetReportId]);
      expect(byAsset.items[0]).toMatchObject({
        assetName: 'Proyektor P33',
        locationName: 'Ruang Rapat Melati',
        locationBuildingCode: 'Z',
        locationFloorNumber: 2,
        reporterCount: 4,
      });

      const byLocation = await listCampusReports(db!, reporterB, { search: 'melati' });
      expect(new Set(byLocation.items.map((item) => item.id))).toEqual(
        new Set([assetReportId, visibleReportId]),
      );

      // Search must not reveal a reporter-hidden location by name.
      const byHiddenLocation = await listCampusReports(db!, reporterB, { search: 'Rahasia' });
      expect(byHiddenLocation.total).toBe(0);

      const all = await listCampusReports(db!, reporterB, { limit: 100 });
      const hidden = all.items.find((item) => item.id === hiddenReportId);
      expect(hidden).toMatchObject({
        assetName: null,
        locationName: null,
        locationBuildingCode: null,
        locationFloorNumber: null,
      });
    });
  },
);
