// P6-4 outbox consumer: claim → process → DISPATCHED with retry/dead-letter.
//
// Pure policy tests run offline. DB-gated integration uses a SCRATCH database
// (`silapor_p64_test`) created/dropped in beforeAll/afterAll and skips without
// a reachable PostgreSQL (same contract as workflow.test.ts). The end-to-end
// test runs the REAL producer (verifyReport) → outbox → batch → notification.
import postgres from 'postgres';
import { randomUUID } from 'node:crypto';
import { describe, expect, it, afterAll, beforeAll } from 'vitest';
import { eq } from 'drizzle-orm';
import { badRequest, internal } from '@silapor/shared';
import { getDb, resolveDatabaseUrl } from './index.js';
import { runMigrations } from './migrate.js';
import {
  facilityAssets,
  facilityCategories,
  issueTypes,
  locations,
  maintenanceReports,
  notifications,
  outboxEvents,
  technicians,
  users,
} from './schema.js';
import { verifyReport, type VerifyReportInput } from './workflow.js';
import {
  MAX_OUTBOX_ATTEMPTS,
  backoffSecondsForAttempt,
  describeOutboxError,
  isPermanentFailure,
  processOutboxBatch,
} from './outbox-consumer.js';

// ---------------------------------------------------------------------------
// Pure policy (no DB).
// ---------------------------------------------------------------------------

describe('outbox consumer policy (pure, offline)', () => {
  it('backoff doubles per attempt (2^n seconds)', () => {
    expect(backoffSecondsForAttempt(1)).toBe(2);
    expect(backoffSecondsForAttempt(2)).toBe(4);
    expect(backoffSecondsForAttempt(3)).toBe(8);
  });

  it('treats 4xx AppErrors as permanent, everything else as retryable', () => {
    expect(isPermanentFailure(badRequest('bad'))).toBe(true);
    expect(isPermanentFailure(new Error('boom'))).toBe(false);
    expect(isPermanentFailure(internal('server down'))).toBe(false);
  });

  it('bounds and redacts the stored error message', () => {
    const long = describeOutboxError(new Error('x'.repeat(600)));
    expect(long.length).toBeLessThanOrEqual(500);
    expect(long.endsWith('...')).toBe(true);
  });

  it('documents the dead-letter threshold as 3 attempts', () => {
    expect(MAX_OUTBOX_ATTEMPTS).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// DB-gated integration (scratch database, live only).
// ---------------------------------------------------------------------------

const SCRATCH_DB_NAME = 'silapor_p64_test';

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

describe.skipIf(!enabled)('outbox consumer (requires reachable PostgreSQL)', () => {
  const url = scratchUrl(baseUrl);
  let close: () => Promise<void> = async () => undefined;
  let db: ReturnType<typeof getDb>['db'] | undefined;

  let adminId = '';
  let reporterId = '';
  let locId = '';
  let catId = '';
  let itId = '';
  let assetId = '';

  const requireDb = (): NonNullable<typeof db> => {
    if (db === undefined) {
      throw new Error('test db not initialised');
    }
    return db;
  };

  async function makeReport(): Promise<{ id: string; version: number }> {
    const rows = await requireDb()
      .insert(maintenanceReports)
      .values({
        ticketNumber: `P64-${randomUUID().slice(0, 8)}`,
        idempotencyKey: randomUUID(),
        reporterId,
        locationId: locId,
        assetId,
        submittedCategoryId: catId,
        submittedIssueTypeId: itId,
        description: 'Lampu ruangan mati total sejak pagi hari, mohon segera diperbaiki.',
        status: 'REPORTED',
      })
      .returning({ id: maintenanceReports.id, version: maintenanceReports.version });
    const row = rows[0];
    if (row === undefined) {
      throw new Error('fixture: report insert failed');
    }
    return row;
  }

  async function queueEvent(input: {
    type: string;
    payload: unknown;
    status?: 'PENDING' | 'FAILED';
    attemptCount?: number;
    availableAtPast?: boolean;
  }): Promise<string> {
    const rows = await requireDb()
      .insert(outboxEvents)
      .values({
        type: input.type,
        payload: input.payload as Record<string, unknown>,
        status: input.status ?? 'PENDING',
        attemptCount: input.attemptCount ?? 0,
        availableAt: input.availableAtPast
          ? new Date(Date.now() - 60_000)
          : new Date(Date.now() - 1_000),
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
    await runMigrations(url);
    const handle = getDb(url);
    db = handle.db;
    close = handle.close;
    const d = requireDb();

    const userRows = await d
      .insert(users)
      .values([
        { username: 'p64-admin', role: 'ADMIN' },
        { username: 'p64-reporter', role: 'REPORTER' },
      ])
      .returning({ id: users.id, role: users.role });
    adminId = userRows.find((row) => row.role === 'ADMIN')!.id;
    reporterId = userRows.find((row) => row.role === 'REPORTER')!.id;

    const locRows = await d
      .insert(locations)
      .values({ type: 'ROOM', code: 'P64-ROOM', name: 'P6-4 room', tierScore: 10 })
      .returning({ id: locations.id });
    locId = locRows[0]!.id;
    const catRows = await d
      .insert(facilityCategories)
      .values({ code: 'P64-CAT', name: 'P6-4 category', weight: 10 })
      .returning({ id: facilityCategories.id });
    catId = catRows[0]!.id;
    const itRows = await d
      .insert(issueTypes)
      .values({ code: 'P64-IT', name: 'P6-4 issue', categoryId: catId })
      .returning({ id: issueTypes.id });
    itId = itRows[0]!.id;
    const assetRows = await d
      .insert(facilityAssets)
      .values({
        assetCode: 'P64-ASSET',
        name: 'P6-4 asset',
        categoryId: catId,
        locationId: locId,
        weight: 10,
      })
      .returning({ id: facilityAssets.id });
    assetId = assetRows[0]!.id;
    await d.insert(technicians).values({ technicianCode: 'P64-TECH', displayName: 'Teknisi' });
  });

  afterAll(async () => {
    await close();
    const admin = postgres(baseUrl, { max: 1 });
    await admin`DROP DATABASE IF EXISTS ${admin(SCRATCH_DB_NAME)}`;
    await admin.end();
  });

  it('end-to-end: verifyReport outbox row becomes a reporter notification', async () => {
    const report = await makeReport();
    const input: VerifyReportInput = {
      finalCategoryId: catId,
      finalIssueTypeId: itId,
      finalPriority: 'LOW',
      affectedReporters: 1,
    };
    await verifyReport(requireDb(), report.id, input, report.version, {
      actorId: adminId,
      requestId: 'p64-req-1',
    });

    const result = await processOutboxBatch(requireDb(), {});
    expect(result.dispatched).toBeGreaterThanOrEqual(1);

    const rows = await requireDb()
      .select()
      .from(notifications)
      .where(eq(notifications.userId, reporterId));
    const verified = rows.find((row) => row.type === 'REPORT_VERIFIED');
    expect(verified).toBeDefined();
    expect(verified?.reportId).toBe(report.id);
    expect(verified?.readAt).toBeNull();

    const outboxRows = await requireDb().select().from(outboxEvents);
    const dispatched = outboxRows.filter(
      (row) => row.type === 'WORKFLOW_NOTIFICATION' && row.status === 'DISPATCHED',
    );
    expect(dispatched.length).toBeGreaterThanOrEqual(1);
    expect(dispatched.every((row) => row.processedAt !== null)).toBe(true);
  });

  it('leaves AI_REVIEW_REQUESTED rows untouched for the Phase 8 consumer', async () => {
    const eventId = await queueEvent({ type: 'AI_REVIEW_REQUESTED', payload: { reportId: null } });
    const before = await requireDb()
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.id, eventId));
    await processOutboxBatch(requireDb(), {});
    const after = await requireDb()
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.id, eventId));
    expect(before[0]!.status).toBe('PENDING');
    expect(after[0]!.status).toBe('PENDING');
    expect(after[0]!.attemptCount).toBe(0);
  });

  it('dead-letters a permanently-failing row immediately with its error', async () => {
    const eventId = await queueEvent({
      type: 'WORKFLOW_NOTIFICATION',
      payload: { kind: 42, reportId: 'not-a-uuid' },
    });
    const result = await processOutboxBatch(requireDb(), {});
    expect(result.failed).toBeGreaterThanOrEqual(1);
    const rows = await requireDb()
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.id, eventId));
    expect(rows[0]!.status).toBe('FAILED');
    expect(rows[0]!.attemptCount).toBe(1);
    expect(rows[0]!.lastError).toBeTruthy();
  });

  it('retries transient failures with backoff, then dead-letters at 3 attempts', async () => {
    // Unknown consumer type throws a plain Error (non-AppError → retryable).
    const eventId = await queueEvent({ type: 'FUTURE_JOB_TYPE', payload: { x: 1 } });
    const first = await processOutboxBatch(requireDb(), {});
    expect(first.retried).toBeGreaterThanOrEqual(1);
    let rows = await requireDb()
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.id, eventId));
    expect(rows[0]!.status).toBe('PENDING');
    expect(rows[0]!.attemptCount).toBe(1);
    expect(rows[0]!.availableAt.getTime()).toBeGreaterThan(Date.now());

    // Force the row available again with attempt_count at the threshold edge.
    await requireDb()
      .update(outboxEvents)
      .set({ attemptCount: 2, availableAt: new Date(Date.now() - 1_000) })
      .where(eq(outboxEvents.id, eventId));
    const second = await processOutboxBatch(requireDb(), {});
    expect(second.failed).toBeGreaterThanOrEqual(1);
    rows = await requireDb()
      .select()
      .from(outboxEvents)
      .where(eq(outboxEvents.id, eventId));
    expect(rows[0]!.status).toBe('FAILED');
    expect(rows[0]!.attemptCount).toBe(3);
  });

  it('re-running the batch never duplicates notifications (redelivery safety)', async () => {
    const eventId = await queueEvent({
      type: 'WORKFLOW_NOTIFICATION',
      payload: { reportId: null, ticketNumber: 'MNT-2026-000777', kind: 'REPORT_ASSIGNED' },
    });
    const report = await makeReport();
    await requireDb()
      .update(outboxEvents)
      .set({ payload: { reportId: report.id, ticketNumber: 'MNT-2026-000777', kind: 'REPORT_ASSIGNED' } })
      .where(eq(outboxEvents.id, eventId));

    const first = await processOutboxBatch(requireDb(), {});
    expect(first.dispatched).toBeGreaterThanOrEqual(1);
    const second = await processOutboxBatch(requireDb(), {});
    expect(second.dispatched).toBe(0);
    const rows = await requireDb()
      .select()
      .from(notifications)
      .where(eq(notifications.sourceEventId, eventId));
    expect(rows).toHaveLength(1);
  });
});
