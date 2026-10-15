// Task 4: ai_analyses persistence for verification verdicts.
//
// Pure validation tests run offline with a never-valued stub db (option
// validation throws before any I/O). DB-gated integration uses a SCRATCH
// database (`silapor_t4_test`) created/dropped in beforeAll/afterAll — the
// shared dev database is never touched. Without a reachable PostgreSQL the
// integration suite skips (same offline-skip contract as reports.test.ts).
//
// Contract under test:
// - `recordAiAnalysis(db, { reportId, model, promptVersion, schemaVersion })`
//   inserts a PENDING row (raw prompt/response are never stored — there are
//   no such columns);
// - `markAiAnalysis(db, id, { status: 'SUCCEEDED', category, issueType,
//   priority })` flips the row to SUCCEEDED with the verdict fields.
import postgres from 'postgres';
import { randomUUID } from 'node:crypto';
import { describe, expect, it, afterAll, beforeAll } from 'vitest';
import { getDb, resolveDatabaseUrl } from './index.js';
import { runMigrations } from './migrate.js';
import {
  facilityCategories,
  locations,
  maintenanceReports,
  users,
} from './schema.js';
import { markAiAnalysis, recordAiAnalysis } from './ai-analyses.js';

// Validation in both entrypoints runs before the first query, so pure
// tests pass a stub that would crash on use; any path reaching the database
// with this stub fails loudly instead of passing silently.
const stubDb = undefined as never;

describe('ai-analyses validation (pure)', () => {
  it('rejects a malformed report id with 400', async () => {
    await expect(
      recordAiAnalysis(stubDb, {
        reportId: 'not-a-uuid',
        model: 'MODEL_UNDER_TEST',
        promptVersion: 'v1',
        schemaVersion: 'v1',
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects a missing model/promptVersion/schemaVersion with 400', async () => {
    const base = {
      reportId: '11111111-1111-4111-8111-111111111111',
      model: 'MODEL_UNDER_TEST',
      promptVersion: 'v1',
      schemaVersion: 'v1',
    };
    await expect(recordAiAnalysis(stubDb, { ...base, model: '' })).rejects.toMatchObject({
      status: 400,
    });
    await expect(recordAiAnalysis(stubDb, { ...base, promptVersion: '' })).rejects.toMatchObject({
      status: 400,
    });
    await expect(recordAiAnalysis(stubDb, { ...base, schemaVersion: '' })).rejects.toMatchObject({
      status: 400,
    });
  });

  it('rejects a malformed analysis id and unknown status with 400', async () => {
    await expect(
      markAiAnalysis(stubDb, 'not-a-uuid', { status: 'SUCCEEDED' }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      markAiAnalysis(stubDb, '11111111-1111-4111-8111-111111111111', {
        status: 'BOGUS',
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
});

// ---------------------------------------------------------------------------
// DB-gated integration (scratch database, live only).
// ---------------------------------------------------------------------------

const SCRATCH_DB_NAME = 'silapor_t4_test';

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

describe.skipIf(!enabled)('ai_analyses persistence (requires reachable PostgreSQL)', () => {
  const url = scratchUrl(baseUrl);
  let close: () => Promise<void> = async () => undefined;
  let db: ReturnType<typeof getDb>['db'] | undefined;

  let reportId = '';

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

      const userId = (
        await db!
          .insert(users)
          .values({ username: 't4-reporter', role: 'REPORTER' })
          .returning({ id: users.id })
      )[0]?.id;
      const locationId = (
        await db!
          .insert(locations)
          .values({ type: 'ROOM', code: 'T4-ROOM-A', name: 'T4 room A' })
          .returning({ id: locations.id })
      )[0]?.id;
      const categoryId = (
        await db!
          .insert(facilityCategories)
          .values({ code: 'T4-HVAC', name: 'T4 HVAC' })
          .returning({ id: facilityCategories.id })
      )[0]?.id;
      if (userId === undefined || locationId === undefined || categoryId === undefined) {
        throw new Error('fixture: user/location/category insert failed');
      }
      const report = (
        await db!
          .insert(maintenanceReports)
          .values({
            ticketNumber: `T4-${randomUUID()}`,
            idempotencyKey: randomUUID(),
            reporterId: userId,
            locationId,
            submittedCategoryId: categoryId,
            description: 'AC split di ruangan tidak dingin sama sekali sejak kemarin.',
            status: 'REPORTED',
          })
          .returning({ id: maintenanceReports.id })
      )[0]?.id;
      if (report === undefined) {
        throw new Error('fixture: report insert failed');
      }
      reportId = report;
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

  it('records a PENDING analysis then marks it SUCCEEDED', async () => {
    const row = await recordAiAnalysis(db!, {
      reportId,
      model: 'MODEL_UNDER_TEST',
      promptVersion: 'v1',
      schemaVersion: 'v1',
    });
    expect(row.status).toBe('PENDING');
    const done = await markAiAnalysis(db!, row.id, {
      status: 'SUCCEEDED',
      category: 'HVAC',
      issueType: 'LEAKING',
      priority: 'HIGH',
    });
    expect(done.status).toBe('SUCCEEDED');
  });

  it('marks a FAILED analysis with an error code', async () => {
    const row = await recordAiAnalysis(db!, {
      reportId,
      model: 'MODEL_UNDER_TEST',
      promptVersion: 'v1',
      schemaVersion: 'v1',
    });
    expect(row.status).toBe('PENDING');
    const done = await markAiAnalysis(db!, row.id, {
      status: 'FAILED',
      errorCode: 'AI_DOWN',
    });
    expect(done.status).toBe('FAILED');
    expect(done.errorCode).toBe('AI_DOWN');
  });

  it('returns 404 for an unknown report and an unknown analysis', async () => {
    await expect(
      recordAiAnalysis(db!, {
        reportId: randomUUID(),
        model: 'MODEL_UNDER_TEST',
        promptVersion: 'v1',
        schemaVersion: 'v1',
      }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      markAiAnalysis(db!, randomUUID(), { status: 'SUCCEEDED' }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

it('reports Task 4 availability (informational)', () => {
  if (!enabled) {
    console.log(
      'SKIP Task 4 integration: PostgreSQL unreachable at ' +
        'the resolved DATABASE_URL — start local postgres (docker compose up) ' +
        'or set DATABASE_URL to a live instance to run.',
    );
  }
  expect(true).toBe(true);
});
