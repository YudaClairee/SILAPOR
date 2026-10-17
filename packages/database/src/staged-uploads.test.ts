// Staged-upload rows (photo-first flow) + staged janitor.
//
// Pure validation tests run offline with a never-valued stub db (input
// validation throws before any I/O). DB-gated integration uses a SCRATCH
// database (`silapor_staged_test`) created/dropped in beforeAll/afterAll —
// the shared dev database is never touched. Without a reachable PostgreSQL
// the integration suite skips (same offline-skip contract as
// ai-analyses.test.ts).
import postgres from 'postgres';
import { randomUUID } from 'node:crypto';
import { describe, expect, it, afterAll, beforeAll, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb, resolveDatabaseUrl } from './index.js';
import { runMigrations } from './migrate.js';
import { facilityCategories, locations, maintenanceReports, stagedUploads, users } from './schema.js';
import {
  claimStagedUploads,
  cleanupStagedUploads,
  deleteStagedUploads,
  getStagedUploadsByKeys,
  linkStagedUploads,
  recordStagedUpload,
} from './staged-uploads.js';

const stubDb = undefined as never;

const STAGED_INPUT = {
  storageKey: 'staging_11111111-1111-4111-8111-111111111111',
  uploadedBy: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  originalFilename: 'retak.jpg',
  mimeType: 'image/jpeg',
  sizeBytes: 10_000,
  checksum: 'abc123',
} as const;

describe('staged uploads validation (pure)', () => {
  it('rejects malformed input with 400 before any I/O', async () => {
    await expect(
      recordStagedUpload(stubDb, { ...STAGED_INPUT, storageKey: '' }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      recordStagedUpload(stubDb, { ...STAGED_INPUT, uploadedBy: 'nope' }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      recordStagedUpload(stubDb, { ...STAGED_INPUT, sizeBytes: 0 }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(claimStagedUploads(stubDb, 'nope', ['k'])).rejects.toMatchObject({
      status: 400,
    });
  });

  it('rejects janitor misuse with 400 before any I/O', async () => {
    const storage = { remove: vi.fn() };
    const listKeys = vi.fn(async () => []);
    await expect(
      cleanupStagedUploads({ db: stubDb, storage, listKeys, limit: -1 }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      cleanupStagedUploads({ db: stubDb, storage, listKeys, olderThanMs: NaN }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('returns empty results for empty key sets without I/O', async () => {
    await expect(getStagedUploadsByKeys(stubDb, [])).resolves.toEqual([]);
    await expect(claimStagedUploads(stubDb, randomUUID(), [])).resolves.toEqual([]);
    await expect(deleteStagedUploads(stubDb, null, [])).resolves.toEqual([]);
  });

  it('rejects an unowned delete with 400 before any I/O', async () => {
    await expect(deleteStagedUploads(stubDb, 'nope', ['staging_k'])).rejects.toMatchObject({
      status: 400,
    });
  });
});

const SCRATCH_DB_NAME = 'silapor_staged_test';

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

describe.skipIf(!enabled)('staged uploads persistence (requires reachable PostgreSQL)', () => {
  const url = scratchUrl(baseUrl);
  let close: () => Promise<void> = async () => undefined;
  let db: ReturnType<typeof getDb>['db'] | undefined;

  let userId = '';
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

      userId = (
        await db!
          .insert(users)
          .values({ username: 'staged-reporter', role: 'REPORTER' })
          .returning({ id: users.id })
          )[0]?.id as string;
      const locationId = (
        await db!
          .insert(locations)
          .values({ type: 'ROOM', code: 'STAGED-ROOM', name: 'Staged room' })
          .returning({ id: locations.id })
      )[0]?.id;
      const categoryId = (
        await db!
          .insert(facilityCategories)
          .values({ code: 'STAGED-HVAC', name: 'Staged HVAC' })
          .returning({ id: facilityCategories.id })
      )[0]?.id;
      if (locationId === undefined || categoryId === undefined) {
        throw new Error('fixture: location/category insert failed');
      }
      reportId = (
        await db!
          .insert(maintenanceReports)
          .values({
            ticketNumber: `STAGED-${randomUUID()}`,
            idempotencyKey: randomUUID(),
            reporterId: userId,
            locationId,
            submittedCategoryId: categoryId,
            description: 'Dinding retak memanjang dan rembes saat hujan.',
            status: 'REPORTED',
          })
          .returning({ id: maintenanceReports.id })
          )[0]?.id as string;
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

  it('records, reads, claims, then deletes a staged row', async () => {
    const key = `staging_${randomUUID()}`;
    const recorded = await recordStagedUpload(db!, { ...STAGED_INPUT, storageKey: key, uploadedBy: userId });
    expect(recorded.claimedReportId).toBeNull();
    const found = await getStagedUploadsByKeys(db!, [key, `staging_${randomUUID()}`]);
    expect(found.map((row) => row.storageKey)).toEqual([key]);
    const claimed = await claimStagedUploads(db!, reportId, [key]);
    expect(claimed.map((row) => row.claimedReportId)).toEqual([reportId]);
    // A claimed key is never deleted, even by its own uploader.
    await expect(deleteStagedUploads(db!, userId, [key])).resolves.toEqual([]);
    await expect(getStagedUploadsByKeys(db!, [key])).resolves.toHaveLength(1);
    const freshKey = `staging_${randomUUID()}`;
    await recordStagedUpload(db!, { ...STAGED_INPUT, storageKey: freshKey, uploadedBy: userId });
    await expect(deleteStagedUploads(db!, userId, [freshKey])).resolves.toEqual([freshKey]);
    await expect(getStagedUploadsByKeys(db!, [freshKey])).resolves.toEqual([]);
  });

  it('links staged keys into attachment rows atomically', async () => {
    const keys = [`staging_${randomUUID()}`, `staging_${randomUUID()}`];
    for (const storageKey of keys) {
      await recordStagedUpload(db!, { ...STAGED_INPUT, storageKey, uploadedBy: userId });
    }
    const linked = await linkStagedUploads(db!, {
      reportId,
      staged: keys.map((storageKey) => ({ ...STAGED_INPUT, storageKey })),
      uploadedBy: userId,
    });
    expect(linked).toHaveLength(2);
    expect(linked.map((row) => row.originalFilename)).toEqual(['retak.jpg', 'retak.jpg']);
    const rows = await getStagedUploadsByKeys(db!, keys);
    expect(rows.map((row) => row.claimedReportId)).toEqual([reportId, reportId]);
    await expect(
      linkStagedUploads(db!, {
        reportId,
        staged: keys.map((storageKey) => ({ ...STAGED_INPUT, storageKey })),
        uploadedBy: userId,
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it('keeps keys claimed by another report or owned by another user on FAIL-cleanup deletes', async () => {
    const otherUser = (
      await db!
        .insert(users)
        .values({ username: `staged-other-${randomUUID()}`, role: 'REPORTER' })
        .returning({ id: users.id })
        )[0]?.id as string;
    const ownKey = `staging_${randomUUID()}`;
    const claimedKey = `staging_${randomUUID()}`;
    const foreignKey = `staging_${randomUUID()}`;
    for (const storageKey of [ownKey, claimedKey]) {
      await recordStagedUpload(db!, { ...STAGED_INPUT, storageKey, uploadedBy: userId });
    }
    await recordStagedUpload(db!, { ...STAGED_INPUT, storageKey: foreignKey, uploadedBy: otherUser });
    // A concurrent submit claims its key: the row is now attached to a report.
    await claimStagedUploads(db!, reportId, [claimedKey]);

    const deleted = await deleteStagedUploads(
      db!,
      userId,
      [ownKey, claimedKey, foreignKey],
    );
    expect(deleted).toEqual([ownKey]);
    const remaining = await getStagedUploadsByKeys(db!, [claimedKey, foreignKey]);
    expect(remaining.map((row) => row.storageKey).sort()).toEqual([claimedKey, foreignKey].sort());
  });

  it('removes expired unclaimed rows and rowless objects past the TTL', async () => {
    const expiredKey = `staging_${randomUUID()}`;
    await recordStagedUpload(db!, { ...STAGED_INPUT, storageKey: expiredKey, uploadedBy: userId });
    const ancient = new Date('2000-01-01T00:00:00Z');
    await db!
      .update(stagedUploads)
      .set({ createdAt: ancient })
      .where(eq(stagedUploads.storageKey, expiredKey));
    const removedKeys: string[] = [];
    const storage = { remove: vi.fn(async (key: string) => void removedKeys.push(key)) };
    const listKeys = vi.fn(async () => [
      { key: `staging_${randomUUID()}`, lastModified: ancient },
      { key: 'att_kept', lastModified: ancient },
    ]);
    const result = await cleanupStagedUploads({
      db: db!,
      storage,
      listKeys,
      olderThanMs: 1000,
      now: new Date('2026-10-16T00:00:00Z'),
    });
    expect(result.expiredRows).toContain(expiredKey);
    expect(result.orphans).toContain(expiredKey);
    expect(result.orphans.some((key) => key === 'att_kept')).toBe(false);
    expect(result.dryRun).toBe(false);
    await expect(getStagedUploadsByKeys(db!, [expiredKey])).resolves.toEqual([]);
  });
});
