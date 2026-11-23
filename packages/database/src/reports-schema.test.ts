// P3-1 report schema integration (Phase 3 backend). DB-gated: without a
// reachable PostgreSQL this file reports skips and never fails. With a
// database (local `docker compose up`, default DATABASE_URL) it proves the
// migration applies on an EMPTY scratch database and the new constraints
// hold with real inserts.
//
// The scratch database (`silapor_p31_test`) is dropped if it exists,
// recreated, migrated from scratch, exercised, then dropped again — the
// shared dev database is never touched.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { eq } from 'drizzle-orm';
import postgres from 'postgres';
import { describe, expect, it, afterAll, beforeAll } from 'vitest';
import { runMigrations } from './migrate.js';
import { getDb, resolveDatabaseUrl } from './index.js';
import {
  facilityCategories,
  locations,
  maintenanceReports,
  outboxEvents,
  reportAttachments,
  reportRelations,
  reportSupporters,
  stagedUploads,
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

  // Drizzle wraps PG failures in `DrizzleQueryError` ("Failed query: ...")
  // with the postgres error (SQLSTATE `code`) nested under `.cause`, so
  // assertions match against the whole chain, not just the top message.
  function errorChainText(error: unknown): string {
    const parts: string[] = [];
    let current: unknown = error;
    for (let depth = 0; depth < 5; depth++) {
      if (typeof current !== 'object' || current === null) {
        break;
      }
      if (current instanceof Error) {
        parts.push(current.message);
      }
      const code = (current as Record<string, unknown>)['code'];
      if (code !== undefined && code !== null) {
        parts.push(String(code));
      }
      const next = (current as Record<string, unknown>)['cause'];
      if (next === undefined || next === null) {
        break;
      }
      current = next;
    }
    return parts.join('\n');
  }

  async function expectDbError(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
    let error: unknown;
    try {
      await promise;
    } catch (caught) {
      error = caught;
    }
    expect(error, 'expected the query to fail').toBeDefined();
    expect(errorChainText(error)).toMatch(pattern);
  }

  it('migrates an empty database with all report tables present and empty', async () => {
    expect(await db!.select().from(maintenanceReports)).toEqual([]);
    expect(await db!.select().from(reportSupporters)).toEqual([]);
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
    await expectDbError(
      insertReport({
        ticketNumber: 'MNT-2026-000002',
        idempotencyKey: '33333333-3333-4333-8333-333333333333',
      }),
      /23505|duplicate key/,
    );
  });

  it('enforces unique idempotency_key', async () => {
    await insertReport({
      ticketNumber: 'MNT-2026-000003',
      idempotencyKey: '44444444-4444-4444-8444-444444444444',
    });
    await expectDbError(
      insertReport({
        ticketNumber: 'MNT-2026-000004',
        idempotencyKey: '44444444-4444-4444-8444-444444444444',
      }),
      /23505|duplicate key/,
    );
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
    await expectDbError(
      db!.insert(reportRelations).values({
        sourceReportId: source.id,
        targetReportId: target.id,
        relationType: 'SUPPORTING',
        createdBy: reporterId,
      }),
      /23505|duplicate key/,
    );
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
    await expectDbError(
      db!.insert(reportRelations).values({
        sourceReportId: source.id,
        targetReportId: target.id,
        relationType: 'BOGUS',
        createdBy: reporterId,
      }),
      /23514|check constraint/,
    );
  });

  it('rejects priority_score 101 but accepts the 0..100 boundaries', async () => {
    await expectDbError(
      insertReport({
        ticketNumber: 'MNT-2026-000009',
        idempotencyKey: '99999999-9999-4999-8999-999999999999',
        priorityScore: 101,
      }),
      /23514|check constraint/,
    );
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

  it('enforces report_supporters constraints, nullable supporter_id, and cascade deletes', async () => {
    const [supporterA] = await db!
      .insert(users)
      .values({ username: 'p31-supporter-a', role: 'REPORTER' })
      .returning({ id: users.id });
    const [supporterB] = await db!
      .insert(users)
      .values({ username: 'p31-supporter-b', role: 'REPORTER' })
      .returning({ id: users.id });
    const report = await insertReport({
      ticketNumber: 'MNT-2026-000012',
      idempotencyKey: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    });

    const [supA] = await db!
      .insert(reportSupporters)
      .values({
        reportId: report.id,
        reporterId: supporterA!.id,
        idempotencyKey: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        description: 'pendukung A',
      })
      .returning();
    expect(supA?.reportId).toBe(report.id);

    // Unique (report_id, reporter_id)
    await expectDbError(
      db!.insert(reportSupporters).values({
        reportId: report.id,
        reporterId: supporterA!.id,
        idempotencyKey: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        description: 'duplikat reporter pada tiket sama',
      }),
      /23505|duplicate key/,
    );

    // Unique idempotency_key
    await expectDbError(
      db!.insert(reportSupporters).values({
        reportId: report.id,
        reporterId: supporterB!.id,
        idempotencyKey: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        description: 'duplikat idempotency key',
      }),
      /23505|duplicate key/,
    );

    const [supB] = await db!
      .insert(reportSupporters)
      .values({
        reportId: report.id,
        reporterId: supporterB!.id,
        idempotencyKey: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        description: 'pendukung B',
      })
      .returning();

    // Nullable supporter_id on report_attachments
    const [primaryAtt] = await db!
      .insert(reportAttachments)
      .values({
        reportId: report.id,
        supporterId: null,
        storageKey: 'att-primary-1',
        originalFilename: 'primary.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 123,
        checksum: 'abc',
        uploadedBy: reporterId,
      })
      .returning();
    const [supporterAtt] = await db!
      .insert(reportAttachments)
      .values({
        reportId: report.id,
        supporterId: supB!.id,
        storageKey: 'att-supporter-1',
        originalFilename: 'supporter.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 456,
        checksum: 'def',
        uploadedBy: supporterB!.id,
      })
      .returning();
    expect(primaryAtt?.supporterId).toBeNull();
    expect(supporterAtt?.supporterId).toBe(supB!.id);

    // Deleting a supporter cascades only that supporter's attachment
    await db!.delete(reportSupporters).where(eq(reportSupporters.id, supB!.id));
    const afterSupDelete = await db!
      .select()
      .from(reportAttachments)
      .where(eq(reportAttachments.reportId, report.id));
    expect(afterSupDelete.map((a) => a.id)).toEqual([primaryAtt!.id]);

    // Deleting the report cascades remaining supporters and attachments
    await db!.delete(maintenanceReports).where(eq(maintenanceReports.id, report.id));
    expect(
      await db!.select().from(reportSupporters).where(eq(reportSupporters.reportId, report.id)),
    ).toEqual([]);
    expect(
      await db!.select().from(reportAttachments).where(eq(reportAttachments.reportId, report.id)),
    ).toEqual([]);
  });

  it('migrates legacy SUPPORTING relations into report_supporters on 0013', async () => {
    const legacyDbName = 'silapor_0013_legacy_test';
    const legacyUrlObj = new URL(baseUrl);
    legacyUrlObj.pathname = `/${legacyDbName}`;
    const legacyUrl = legacyUrlObj.toString();

    const drizzleDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'drizzle');
    const journal = JSON.parse(
      fs.readFileSync(path.join(drizzleDir, 'meta', '_journal.json'), 'utf8'),
    ) as { entries: Array<{ tag: string }> };

    const applySqlFile = async (sqlClient: postgres.Sql, tag: string) => {
      const raw = fs.readFileSync(path.join(drizzleDir, `${tag}.sql`), 'utf8');
      const statements = raw
        .split('--> statement-breakpoint')
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      await sqlClient.begin(async (tx) => {
        for (const stmt of statements) {
          await tx.unsafe(stmt);
        }
      });
    };

    const admin = postgres(baseUrl, { max: 1 });
    try {
      await admin.unsafe(`DROP DATABASE IF EXISTS "${legacyDbName}"`);
      await admin.unsafe(`CREATE DATABASE "${legacyDbName}"`);
    } finally {
      await admin.end();
    }

    const legacySql = postgres(legacyUrl, { max: 1 });
    const legacyConn = getDb(legacyUrl);
    try {
      const pre0013 = journal.entries.filter((e) => !e.tag.startsWith('0013_'));
      for (const entry of pre0013) {
        await applySqlFile(legacySql, entry.tag);
      }

      const [primaryUser] = await legacyConn.db
        .insert(users)
        .values({ username: 'legacy-primary', role: 'REPORTER' })
        .returning({ id: users.id });
      const [supportUser] = await legacyConn.db
        .insert(users)
        .values({ username: 'legacy-supporter', role: 'REPORTER' })
        .returning({ id: users.id });
      const [loc] = await legacyConn.db
        .insert(locations)
        .values({ type: 'ROOM', code: 'LEG-ROOM', name: 'Legacy room' })
        .returning({ id: locations.id });
      const [cat] = await legacyConn.db
        .insert(facilityCategories)
        .values({ code: 'LEG-CAT', name: 'Legacy category' })
        .returning({ id: facilityCategories.id });

      const [targetReport] = await legacyConn.db
        .insert(maintenanceReports)
        .values({
          ticketNumber: 'MNT-2026-900001',
          idempotencyKey: '10101010-1010-4010-8010-101010101010',
          reporterId: primaryUser!.id,
          locationId: loc!.id,
          submittedCategoryId: cat!.id,
          finalCategoryId: cat!.id,
          status: 'VERIFIED',
          description: 'AC utama bocor',
        })
        .returning();

      const [legacySupportReport] = await legacyConn.db
        .insert(maintenanceReports)
        .values({
          ticketNumber: 'MNT-2026-900002',
          idempotencyKey: '20202020-2020-4020-8020-202020202020',
          reporterId: supportUser!.id,
          locationId: loc!.id,
          submittedCategoryId: cat!.id,
          status: 'REPORTED',
          description: 'AC juga bocor dari saya',
        })
        .returning();

      await legacyConn.db.insert(reportRelations).values({
        sourceReportId: legacySupportReport!.id,
        targetReportId: targetReport!.id,
        relationType: 'SUPPORTING',
        createdBy: supportUser!.id,
      });

      await legacySql.unsafe(
        `INSERT INTO "report_attachments" ("report_id", "storage_key", "original_filename", "mime_type", "size_bytes", "checksum", "uploaded_by")
         VALUES ($1, 'leg-att-1', 'leg.jpg', 'image/jpeg', 100, 'chk', $2)`,
        [legacySupportReport!.id, supportUser!.id],
      );

      await legacyConn.db.insert(stagedUploads).values({
        storageKey: 'staging_legacy_1',
        uploadedBy: supportUser!.id,
        originalFilename: 'leg.jpg',
        mimeType: 'image/jpeg',
        sizeBytes: 100,
        checksum: 'chk',
        claimedReportId: legacySupportReport!.id,
      });

      await legacyConn.db.insert(outboxEvents).values({
        type: 'AI_REVIEW_REQUESTED',
        payload: { reportId: legacySupportReport!.id, ticketNumber: 'MNT-2026-900002' },
        status: 'PENDING',
      });

      await applySqlFile(legacySql, '0013_report_supporters');

      const supporters = await legacyConn.db
        .select()
        .from(reportSupporters)
        .where(eq(reportSupporters.reportId, targetReport!.id));
      expect(supporters).toHaveLength(1);
      expect(supporters[0]?.reporterId).toBe(supportUser!.id);
      expect(supporters[0]?.idempotencyKey).toBe('20202020-2020-4020-8020-202020202020');
      expect(supporters[0]?.description).toBe('AC juga bocor dari saya');

      const movedAtts = await legacyConn.db
        .select()
        .from(reportAttachments)
        .where(eq(reportAttachments.reportId, targetReport!.id));
      expect(movedAtts).toHaveLength(1);
      expect(movedAtts[0]?.supporterId).toBe(supporters[0]?.id);

      const movedStaged = await legacyConn.db
        .select()
        .from(stagedUploads)
        .where(eq(stagedUploads.storageKey, 'staging_legacy_1'));
      expect(movedStaged[0]?.claimedReportId).toBe(targetReport!.id);

      const remainingOutbox = await legacyConn.db.select().from(outboxEvents);
      expect(remainingOutbox).toEqual([]);

      const remainingRelations = await legacyConn.db.select().from(reportRelations);
      expect(remainingRelations).toEqual([]);

      const remainingReports = await legacyConn.db.select().from(maintenanceReports);
      expect(remainingReports.map((r) => r.id)).toEqual([targetReport!.id]);
    } finally {
      await legacyConn.close();
      await legacySql.end();
      const cleanupAdmin = postgres(baseUrl, { max: 1 });
      try {
        await cleanupAdmin.unsafe(`DROP DATABASE IF EXISTS "${legacyDbName}"`);
      } finally {
        await cleanupAdmin.end();
      }
    }
  }, 120_000);
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
