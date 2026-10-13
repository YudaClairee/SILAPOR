// P4-3 attachment repository tests (Phase 4 secure upload).
//
// Pure input-validation tests run offline with a never-valued stub db
// (validation throws before any I/O). DB-gated integration uses a SCRATCH
// database (`silapor_p43_test`) created/dropped in beforeAll/afterAll — the
// shared dev database is never touched. Without a reachable PostgreSQL the
// integration suite skips (same offline-skip contract as reports.test.ts).
import postgres from 'postgres';
import { randomUUID } from 'node:crypto';
import { describe, expect, it, afterAll, beforeAll } from 'vitest';
import { getDb, resolveDatabaseUrl } from './index.js';
import { runMigrations } from './migrate.js';
import {
  facilityCategories,
  locations,
  maintenanceReports,
  reportAttachments,
  reportEvents,
  users,
} from './schema.js';
import {
  countAttachments,
  createAttachments,
  getAttachmentById,
  getReportHeader,
  listAttachments,
  type CreateAttachmentFileInput,
} from './attachments.js';

// Validation in every attachments entrypoint runs before the first query,
// so pure tests pass a stub that would crash on use; any path reaching the
// database with this stub fails loudly instead of passing silently.
const stubDb = undefined as never;

const VALID_UUID = '11111111-1111-4111-8111-111111111111';

function validFile(overrides: Partial<CreateAttachmentFileInput> = {}): CreateAttachmentFileInput {
  return {
    storageKey: 'att_valid-key-1',
    originalFilename: 'photo.png',
    mimeType: 'image/png',
    sizeBytes: 1234,
    checksum: 'a'.repeat(64),
    ...overrides,
  };
}

describe('attachments input validation (pure)', () => {
  it('rejects a non-object input with 400', async () => {
    await expect(createAttachments(stubDb, null as never)).rejects.toMatchObject({ status: 400 });
  });

  it('rejects malformed reportId / uploadedBy with 400', async () => {
    await expect(
      createAttachments(stubDb, { reportId: 'not-a-uuid', files: [validFile()], uploadedBy: VALID_UUID } as never),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      createAttachments(stubDb, { reportId: VALID_UUID, files: [validFile()], uploadedBy: 'nope' } as never),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects an empty files array with 400', async () => {
    await expect(
      createAttachments(stubDb, { reportId: VALID_UUID, files: [], uploadedBy: VALID_UUID }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects malformed file rows with 400', async () => {
    await expect(
      createAttachments(stubDb, {
        reportId: VALID_UUID,
        files: [validFile({ storageKey: '' })],
        uploadedBy: VALID_UUID,
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      createAttachments(stubDb, {
        reportId: VALID_UUID,
        files: [validFile({ sizeBytes: 0 })],
        uploadedBy: VALID_UUID,
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      createAttachments(stubDb, {
        reportId: VALID_UUID,
        files: [validFile({ checksum: '' })],
        uploadedBy: VALID_UUID,
      }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects malformed ids in the read helpers with 400', async () => {
    await expect(getAttachmentById(stubDb, 'not-a-uuid')).rejects.toMatchObject({ status: 400 });
    await expect(listAttachments(stubDb, 'not-a-uuid')).rejects.toMatchObject({ status: 400 });
    await expect(countAttachments(stubDb, 'not-a-uuid')).rejects.toMatchObject({ status: 400 });
    await expect(getReportHeader(stubDb, 'not-a-uuid')).rejects.toMatchObject({ status: 400 });
  });
});

// ---------------------------------------------------------------------------
// DB-gated integration (scratch database, live only).
// ---------------------------------------------------------------------------

const SCRATCH_DB_NAME = 'silapor_p43_test';

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

describe.skipIf(!enabled)('report attachments repository (requires reachable PostgreSQL)', () => {
  const url = scratchUrl(baseUrl);
  let close: () => Promise<void> = async () => undefined;
  let db: ReturnType<typeof getDb>['db'] | undefined;

  let reporterA = '';
  let reporterB = '';
  let reportA = '';
  let reportB = '';

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

      reporterA = (
        await db
          .insert(users)
          .values({ username: 'p43-reporter-a', role: 'REPORTER' })
          .returning({ id: users.id })
      )[0]?.id as string;
      reporterB = (
        await db
          .insert(users)
          .values({ username: 'p43-reporter-b', role: 'REPORTER' })
          .returning({ id: users.id })
      )[0]?.id as string;
      const locationId = (
        await db
          .insert(locations)
          .values({ type: 'ROOM', code: 'P43-ROOM-A', name: 'P4-3 room A' })
          .returning({ id: locations.id })
      )[0]?.id as string;
      const categoryId = (
        await db
          .insert(facilityCategories)
          .values({ code: 'P43-CAT-A', name: 'P4-3 category A' })
          .returning({ id: facilityCategories.id })
      )[0]?.id as string;

      const insertReport = async (reporterId: string, ticket: string, key: string): Promise<string> => {
        const rows = await db!
          .insert(maintenanceReports)
          .values({
            ticketNumber: ticket,
            idempotencyKey: key,
            reporterId,
            locationId,
            submittedCategoryId: categoryId,
            description: 'Lampu ruangan mati total sejak pagi hari, mohon diperbaiki.',
          })
          .returning({ id: maintenanceReports.id });
        const id = rows[0]?.id;
        if (id === undefined) {
          throw new Error('fixture: report insert failed');
        }
        return id;
      };
      reportA = await insertReport(reporterA, 'MNT-2026-000101', randomUUID());
      reportB = await insertReport(reporterB, 'MNT-2026-000102', randomUUID());
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

  it('inserts rows plus exactly ONE ATTACHMENT_ADDED event in a single transaction', async () => {
    const eventsBefore = await db!.select().from(reportEvents);
    const created = await createAttachments(db!, {
      reportId: reportA,
      files: [
        {
          storageKey: 'att_p43-a-1',
          originalFilename: 'photo-a.png',
          mimeType: 'image/png',
          sizeBytes: 1111,
          checksum: 'b'.repeat(64),
        },
        {
          storageKey: 'att_p43-a-2',
          originalFilename: 'photo-b.jpg',
          mimeType: 'image/jpeg',
          sizeBytes: 2222,
          checksum: 'c'.repeat(64),
        },
      ],
      uploadedBy: reporterA,
    });
    expect(created).toHaveLength(2);
    for (const row of created) {
      expect(Object.keys(row).sort()).toEqual(
        ['checksum', 'createdAt', 'id', 'mimeType', 'originalFilename', 'sizeBytes'].sort(),
      );
      expect('storageKey' in row).toBe(false);
    }

    const rows = await db!.select().from(reportAttachments);
    expect(rows).toHaveLength(2);

    const eventsAfter = await db!.select().from(reportEvents);
    expect(eventsAfter.length).toBe(eventsBefore.length + 1);
    const event = eventsAfter[eventsAfter.length - 1];
    expect(event?.reportId).toBe(reportA);
    expect(event?.eventType).toBe('ATTACHMENT_ADDED');
    expect(event?.actorId).toBe(reporterA);
    expect(event?.metadata).toEqual({
      attachmentIds: created.map((row) => row.id),
      count: 2,
    });
  });

  it('counts attachments per report', async () => {
    expect(await countAttachments(db!, reportB)).toBe(0);
    expect(await countAttachments(db!, reportA)).toBe(2);
    await createAttachments(db!, {
      reportId: reportB,
      files: [
        {
          storageKey: 'att_p43-b-1',
          originalFilename: 'other.webp',
          mimeType: 'image/webp',
          sizeBytes: 3333,
          checksum: 'd'.repeat(64),
        },
      ],
      uploadedBy: reporterB,
    });
    expect(await countAttachments(db!, reportB)).toBe(1);
    expect(await countAttachments(db!, reportA)).toBe(2);
  });

  it('lists attachments without storageKey in chronological order', async () => {
    const listed = await listAttachments(db!, reportA);
    expect(listed).toHaveLength(2);
    // Same-statement inserts share a timestamp, so assert the set plus
    // non-decreasing chronology (the repo orders by createdAt, id).
    expect(listed.map((row) => row.originalFilename).sort()).toEqual(['photo-a.png', 'photo-b.jpg']);
    for (let i = 1; i < listed.length; i++) {
      expect(listed[i - 1]?.createdAt.getTime()).toBeLessThanOrEqual(
        listed[i]?.createdAt.getTime() as number,
      );
    }
    for (const row of listed) {
      expect('storageKey' in row).toBe(false);
      expect(Object.keys(row).sort()).toEqual(
        ['checksum', 'createdAt', 'id', 'mimeType', 'originalFilename', 'sizeBytes'].sort(),
      );
    }
  });

  it('joins the parent report for reporterId and status (join scoping)', async () => {
    const listed = await listAttachments(db!, reportA);
    const first = listed.find((row) => row.originalFilename === 'photo-a.png');
    const found = await getAttachmentById(db!, first?.id as string);
    expect(found?.storageKey).toBe('att_p43-a-1');
    expect(found?.reportId).toBe(reportA);
    expect(found?.reporterId).toBe(reporterA);
    expect(found?.status).toBe('REPORTED');

    const other = await listAttachments(db!, reportB);
    const otherFound = await getAttachmentById(db!, other[0]?.id as string);
    expect(otherFound?.reporterId).toBe(reporterB);
    expect(otherFound?.reportId).toBe(reportB);
  });

  it('returns null for a missing attachment id', async () => {
    await expect(getAttachmentById(db!, randomUUID())).resolves.toBeNull();
  });

  it('returns the report header for ownership checks, null when missing', async () => {
    await expect(getReportHeader(db!, reportA)).resolves.toMatchObject({
      id: reportA,
      reporterId: reporterA,
      status: 'REPORTED',
    });
    await expect(getReportHeader(db!, randomUUID())).resolves.toBeNull();
  });

  it('leaves zero rows and zero events when the report does not exist (FK atomicity)', async () => {
    const rowsBefore = await db!.select().from(reportAttachments);
    const eventsBefore = await db!.select().from(reportEvents);
    await expect(
      createAttachments(db!, {
        reportId: randomUUID(),
        files: [
          {
            storageKey: 'att_p43-ghost-1',
            originalFilename: 'ghost.png',
            mimeType: 'image/png',
            sizeBytes: 10,
            checksum: 'e'.repeat(64),
          },
        ],
        uploadedBy: reporterA,
      }),
    ).rejects.toMatchObject({ status: 404 });
    expect(await db!.select().from(reportAttachments)).toHaveLength(rowsBefore.length);
    expect(await db!.select().from(reportEvents)).toHaveLength(eventsBefore.length);
  });

  it('proves the report_attachments table + report_id index already exist (no migration)', async () => {
    const conn = postgres(url, { max: 1 });
    try {
      const indexes = await conn`
        SELECT indexname FROM pg_indexes
        WHERE tablename = 'report_attachments' AND indexname = 'report_attachments_report_id_idx'
      `;
      expect(indexes.length).toBe(1);
      // Ownership of the proof: the table accepts rows written above.
      expect(await db!.select().from(reportAttachments)).not.toHaveLength(0);
    } finally {
      await conn.end();
    }
  });
});

it('reports P4-3 availability (informational)', () => {
  if (!enabled) {
    console.log(
      'SKIP P4-3 integration: PostgreSQL unreachable at ' +
        'the resolved DATABASE_URL — start local postgres (docker compose up) ' +
        'or set DATABASE_URL to a live instance to run.',
    );
  }
  expect(true).toBe(true);
});
