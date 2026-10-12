// P3-1 report schema integration (Phase 3 backend). DB-gated: without a
// reachable PostgreSQL this file reports skips and never fails. With a
// database (local `docker compose up`, default DATABASE_URL) it proves the
// migration applies on an EMPTY scratch database and the new constraints
// hold with real inserts.
//
// The scratch database (`silapor_p31_test`) is dropped if it exists,
// recreated, migrated from scratch, exercised, then dropped again — the
// shared dev database is never touched.
import postgres from 'postgres';
import { describe, expect, it, afterAll, beforeAll } from 'vitest';
import { runMigrations } from './migrate.js';
import { getDb, resolveDatabaseUrl } from './index.js';
import {
  facilityCategories,
  locations,
  maintenanceReports,
  reportRelations,
  ticketCounters,
  users,
} from './schema.js';

const SCRATCH_DB_NAME = 'silapor_p31_test';

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

describe.skipIf(!enabled)('reports schema (requires reachable PostgreSQL)', () => {
  const url = scratchUrl(baseUrl);
  let close: () => Promise<void> = async () => undefined;
  let db: ReturnType<typeof getDb>['db'] | undefined;
  let reporterId = '';
  let locationId = '';
  let categoryId = '';

  beforeAll(
    async () => {
      // Empty-DB starting point: recreate the scratch database, then
      // migrate the full chain (0000 → 0002) onto nothing.
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

      const reporter = await db
        .insert(users)
        .values({ username: 'p31-reporter', role: 'REPORTER' })
        .returning({ id: users.id });
      reporterId = reporter[0]?.id ?? '';
      const location = await db
        .insert(locations)
        .values({ type: 'ROOM', code: 'P31-ROOM', name: 'P3-1 room' })
        .returning({ id: locations.id });
      locationId = location[0]?.id ?? '';
      const category = await db
        .insert(facilityCategories)
        .values({ code: 'P31-CAT', name: 'P3-1 category' })
        .returning({ id: facilityCategories.id });
      categoryId = category[0]?.id ?? '';
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

  async function insertReport(overrides: {
    readonly ticketNumber: string;
    readonly idempotencyKey: string;
    readonly priorityScore?: number | null;
  }) {
    const rows = await db!
      .insert(maintenanceReports)
      .values({
        ticketNumber: overrides.ticketNumber,
        idempotencyKey: overrides.idempotencyKey,
        reporterId,
        locationId,
        submittedCategoryId: categoryId,
        description: 'lampu mati',
        priorityScore: overrides.priorityScore ?? null,
      })
      .returning();
    const row = rows[0];
    if (row === undefined) {
      throw new Error('insertReport: no row returned');
    }
    return row;
  }

  it('migrates an empty database with all report tables present and empty', async () => {
    expect(await db!.select().from(maintenanceReports)).toEqual([]);
    expect(await db!.select().from(ticketCounters)).toEqual([]);
    expect(await db!.select().from(reportRelations)).toEqual([]);
  });

  it('defaults new reports to status REPORTED and version 1', async () => {
    const row = await insertReport({
      ticketNumber: 'MNT-2026-000001',
      idempotencyKey: '11111111-1111-4111-8111-111111111111',
    });
    expect(row.status).toBe('REPORTED');
    expect(row.version).toBe(1);
  });

  it('enforces unique ticket_number', async () => {
    await insertReport({
      ticketNumber: 'MNT-2026-000002',
      idempotencyKey: '22222222-2222-4222-8222-222222222222',
    });
    await expect(
      insertReport({
        ticketNumber: 'MNT-2026-000002',
        idempotencyKey: '33333333-3333-4333-8333-333333333333',
      }),
    ).rejects.toThrow();
  });

  it('enforces unique idempotency_key', async () => {
    await insertReport({
      ticketNumber: 'MNT-2026-000003',
      idempotencyKey: '44444444-4444-4444-8444-444444444444',
    });
    await expect(
      insertReport({
        ticketNumber: 'MNT-2026-000004',
        idempotencyKey: '44444444-4444-4444-8444-444444444444',
      }),
    ).rejects.toThrow();
  });

  it('enforces the report_relations unique (source, target, type) triple', async () => {
    const source = await insertReport({
      ticketNumber: 'MNT-2026-000005',
      idempotencyKey: '55555555-5555-4555-8555-555555555555',
    });
    const target = await insertReport({
      ticketNumber: 'MNT-2026-000006',
      idempotencyKey: '66666666-6666-4666-8666-666666666666',
    });
    await db!.insert(reportRelations).values({
      sourceReportId: source.id,
      targetReportId: target.id,
      relationType: 'SUPPORTING',
      createdBy: reporterId,
    });
    await expect(
      db!.insert(reportRelations).values({
        sourceReportId: source.id,
        targetReportId: target.id,
        relationType: 'SUPPORTING',
        createdBy: reporterId,
      }),
    ).rejects.toThrow();
  });

  it('rejects an invalid relation_type', async () => {
    const source = await insertReport({
      ticketNumber: 'MNT-2026-000007',
      idempotencyKey: '77777777-7777-4777-8777-777777777777',
    });
    const target = await insertReport({
      ticketNumber: 'MNT-2026-000008',
      idempotencyKey: '88888888-8888-4888-8888-888888888888',
    });
    await expect(
      db!.insert(reportRelations).values({
        sourceReportId: source.id,
        targetReportId: target.id,
        relationType: 'BOGUS',
        createdBy: reporterId,
      }),
    ).rejects.toThrow();
  });

  it('rejects priority_score 101 but accepts the 0..100 boundaries', async () => {
    await expect(
      insertReport({
        ticketNumber: 'MNT-2026-000009',
        idempotencyKey: '99999999-9999-4999-8999-999999999999',
        priorityScore: 101,
      }),
    ).rejects.toThrow();
    const low = await insertReport({
      ticketNumber: 'MNT-2026-000010',
      idempotencyKey: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      priorityScore: 0,
    });
    expect(low.priorityScore).toBe(0);
    const high = await insertReport({
      ticketNumber: 'MNT-2026-000011',
      idempotencyKey: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      priorityScore: 100,
    });
    expect(high.priorityScore).toBe(100);
  });
});

it('reports schema availability (informational)', () => {
  if (!enabled) {
    console.log(
      'SKIP reports-schema integration: PostgreSQL unreachable at ' +
        'the resolved DATABASE_URL — start local postgres (docker compose up) ' +
        'or set DATABASE_URL to a live instance to run.',
    );
  }
  expect(true).toBe(true);
});
