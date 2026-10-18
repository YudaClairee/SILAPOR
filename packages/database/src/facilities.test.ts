// P6-2 facilities: derived facility status projection + maintenance history.
//
// Pure label/validation tests run offline. DB-gated integration uses a SCRATCH
// database (`silapor_p62_test`) created/dropped in beforeAll/afterAll and
// skips without a reachable PostgreSQL (same contract as workflow.test.ts).
import postgres from 'postgres';
import { randomUUID } from 'node:crypto';
import { describe, expect, it, afterAll, beforeAll } from 'vitest';
import { eq } from 'drizzle-orm';
import type { ReportStatus } from '@silapor/domain';
import { getDb, resolveDatabaseUrl } from './index.js';
import { runMigrations } from './migrate.js';
import {
  facilityAssets,
  facilityCategories,
  locations,
  maintenanceReports,
  users,
} from './schema.js';
import {
  buildLocationLabel,
  getFacilityMaintenanceHistory,
  listFacilityStatus,
} from './facilities.js';

type FacilitiesDb = Parameters<typeof listFacilityStatus>[0];

// Untouched handle: pure-validation paths throw before the first query.
const UNTOUCHED_DB = undefined as unknown as FacilitiesDb;

// ---------------------------------------------------------------------------
// Pure (no DB).
// ---------------------------------------------------------------------------

describe('buildLocationLabel (pure, offline)', () => {
  it('joins building and room with a separator', () => {
    expect(buildLocationLabel('Ruang Kuliah 01', 'Gedung C')).toBe('Gedung C · Ruang Kuliah 01');
  });

  it('falls back to whichever part exists', () => {
    expect(buildLocationLabel('Ruang Kuliah 01', null)).toBe('Ruang Kuliah 01');
    expect(buildLocationLabel(null, 'Gedung C')).toBe('Gedung C');
    expect(buildLocationLabel(null, null)).toBe('');
  });
});

describe('facilities validation (pure, offline)', () => {
  it('rejects malformed filter ids with 400 before any query', async () => {
    await expect(
      listFacilityStatus(UNTOUCHED_DB, { locationId: 'bogus' }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      listFacilityStatus(UNTOUCHED_DB, { categoryId: 'bogus' }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects an unknown derived-status filter with 400', async () => {
    await expect(listFacilityStatus(UNTOUCHED_DB, { status: 'CLOSED' })).rejects.toMatchObject({
      status: 400,
    });
    await expect(listFacilityStatus(UNTOUCHED_DB, { status: 'BOGUS' })).rejects.toMatchObject({
      status: 400,
    });
  });

  it('rejects a malformed asset id for history with 400', async () => {
    await expect(getFacilityMaintenanceHistory(UNTOUCHED_DB, 'nope')).rejects.toMatchObject({
      status: 400,
    });
  });
});

// ---------------------------------------------------------------------------
// DB-gated integration (scratch database, live only).
// ---------------------------------------------------------------------------

const SCRATCH_DB_NAME = 'silapor_p62_test';

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

describe.skipIf(!enabled)('facility status + history (requires reachable PostgreSQL)', () => {
  const url = scratchUrl(baseUrl);
  let close: () => Promise<void> = async () => undefined;
  let db: ReturnType<typeof getDb>['db'] | undefined;

  let reporterId = '';
  let buildingCode = '';
  let roomId = '';
  let otherRoomId = '';
  let categoryId = '';
  let otherCategoryId = '';
  let assetId = '';
  let assetBId = '';
  let inactiveAssetId = '';

  const requireDb = (): NonNullable<typeof db> => {
    if (db === undefined) {
      throw new Error('test db not initialised');
    }
    return db;
  };

  async function insertReport(input: {
    assetId: string | null;
    status: ReportStatus;
    locationId?: string;
  }): Promise<string> {
    const rows = await requireDb()
      .insert(maintenanceReports)
      .values({
        ticketNumber: `P62-${randomUUID().slice(0, 8)}`,
        idempotencyKey: randomUUID(),
        reporterId,
        locationId: input.locationId ?? roomId,
        assetId: input.assetId,
        submittedCategoryId: categoryId,
        description: 'Kipas angin ruangan berhenti berputar sama sekali.',
        status: input.status,
      })
      .returning({ id: maintenanceReports.id });
    const row = rows[0];
    if (row === undefined) {
      throw new Error('fixture: report insert failed');
    }
    return row.id;
  }

  beforeAll(async () => {
    const admin = postgres(baseUrl, { max: 1 });
    try {
      await admin.unsafe(`DROP DATABASE IF EXISTS "${SCRATCH_DB_NAME}"`);
      await admin.unsafe(`CREATE DATABASE "${SCRATCH_DB_NAME}"`);
    } finally {
      await admin.end();
    }
    const handle = getDb(url);
    db = handle.db;
    close = handle.close;
    await runMigrations(url);
    const d = requireDb();

    const userRows = await d
      .insert(users)
      .values({ username: `p62-${randomUUID().slice(0, 8)}`, role: 'REPORTER' })
      .returning({ id: users.id });
    reporterId = userRows[0]?.id ?? '';

    const campusRows = await d
      .insert(locations)
      .values({ type: 'CAMPUS', code: 'P62-CAMPUS', name: 'Kampus' })
      .returning({ id: locations.id });
    const campusId = campusRows[0]?.id ?? '';
    const buildingRows = await d
      .insert(locations)
      .values({
        type: 'BUILDING',
        code: 'P62-BLD-C',
        name: 'Gedung C',
        parentId: campusId,
      })
      .returning({ id: locations.id });
    buildingCode = 'P62-BLD-C';
    const roomRows = await d
      .insert(locations)
      .values({
        type: 'ROOM',
        code: 'P62-ROOM-01',
        name: 'Ruang Kuliah 01',
        parentId: buildingRows[0]?.id ?? campusId,
        buildingCode,
      })
      .returning({ id: locations.id });
    roomId = roomRows[0]?.id ?? '';
    const otherRoomRows = await d
      .insert(locations)
      .values({
        type: 'ROOM',
        code: 'P62-ROOM-02',
        name: 'Ruang Kuliah 02',
        parentId: buildingRows[0]?.id ?? campusId,
        buildingCode,
      })
      .returning({ id: locations.id });
    otherRoomId = otherRoomRows[0]?.id ?? '';

    const catRows = await d
      .insert(facilityCategories)
      .values({ code: 'P62-HVAC', name: 'HVAC' })
      .returning({ id: facilityCategories.id });
    categoryId = catRows[0]?.id ?? '';
    const otherCatRows = await d
      .insert(facilityCategories)
      .values({ code: 'P62-ELEC', name: 'Elektronik' })
      .returning({ id: facilityCategories.id });
    otherCategoryId = otherCatRows[0]?.id ?? '';

    const assetRows = await d
      .insert(facilityAssets)
      .values({
        assetCode: 'P62-AC-01',
        categoryId,
        locationId: roomId,
        name: 'AC Ruang 01',
      })
      .returning({ id: facilityAssets.id });
    assetId = assetRows[0]?.id ?? '';
    const assetBRows = await d
      .insert(facilityAssets)
      .values({
        assetCode: 'P62-TV-02',
        categoryId: otherCategoryId,
        locationId: otherRoomId,
        name: 'TV Ruang 02',
      })
      .returning({ id: facilityAssets.id });
    assetBId = assetBRows[0]?.id ?? '';
    const inactiveRows = await d
      .insert(facilityAssets)
      .values({
        assetCode: 'P62-OLD-03',
        categoryId,
        locationId: roomId,
        name: 'Proyektor Retired',
        isActive: false,
      })
      .returning({ id: facilityAssets.id });
    inactiveAssetId = inactiveRows[0]?.id ?? '';
  });

  afterAll(async () => {
    await close();
    const admin = postgres(baseUrl, { max: 1 });
    await admin`DROP DATABASE IF EXISTS ${admin(SCRATCH_DB_NAME)}`;
    await admin.end();
  });

  it('shows an asset without reports as OPERATIONAL (asset.updatedAt as lastUpdated)', async () => {
    const result = await listFacilityStatus(requireDb(), {});
    const tv = result.items.find((item) => item.assetId === assetBId);
    expect(tv?.derivedStatus).toBe('OPERATIONAL');
    expect(tv?.activeReportCount).toBe(0);
    expect(tv?.locationLabel).toBe('Gedung C · Ruang Kuliah 02');
    expect(tv?.categoryName).toBe('Elektronik');
    expect(tv?.lastUpdated.getTime()).toBeGreaterThan(0);
  });

  it('excludes inactive assets by default and includes them only on request', async () => {
    const activeOnly = await listFacilityStatus(requireDb(), {});
    expect(activeOnly.items.some((item) => item.assetId === inactiveAssetId)).toBe(false);
    const withInactive = await listFacilityStatus(requireDb(), { includeInactive: true });
    const retired = withInactive.items.find((item) => item.assetId === inactiveAssetId);
    expect(retired?.isActive).toBe(false);
    expect(retired?.derivedStatus).toBe('OPERATIONAL');
  });

  it('derives UNDER_INSPECTION from an asset with only a held REPORTED report', async () => {
    await insertReport({ assetId, status: 'REPORTED' });
    const result = await listFacilityStatus(requireDb(), {});
    const ac = result.items.find((item) => item.assetId === assetId);
    expect(ac?.derivedStatus).toBe('UNDER_INSPECTION');
    expect(ac?.activeReportCount).toBe(1);
  });

  it('applies precedence when one asset has several active tickets', async () => {
    await insertReport({ assetId, status: 'IN_REPAIR' });
    const result = await listFacilityStatus(requireDb(), {});
    const ac = result.items.find((item) => item.assetId === assetId);
    expect(ac?.derivedStatus).toBe('IN_REPAIR');
    expect(ac?.activeReportCount).toBe(2);
  });

  it('sets lastUpdated to the latest active report reported_at', async () => {
    const result = await listFacilityStatus(requireDb(), {});
    const ac = result.items.find((item) => item.assetId === assetId);
    const assetRow = (
      await requireDb().select().from(facilityAssets).where(eq(facilityAssets.id, assetId))
    )[0];
    // Reported later than the asset row was created/updated.
    expect(ac?.lastUpdated.getTime()).toBeGreaterThanOrEqual(assetRow?.updatedAt.getTime() ?? 0);
  });

  it('stays OPERATIONAL when only terminal (CLOSED/RESOLVED) tickets exist', async () => {
    await insertReport({ assetId: assetBId, status: 'RESOLVED' });
    await insertReport({ assetId: assetBId, status: 'CLOSED' });
    const result = await listFacilityStatus(requireDb(), {});
    const tv = result.items.find((item) => item.assetId === assetBId);
    expect(tv?.derivedStatus).toBe('OPERATIONAL');
    expect(tv?.activeReportCount).toBe(0);
  });

  it('filters by location, category, and derived status', async () => {
    const byLocation = await listFacilityStatus(requireDb(), { locationId: otherRoomId });
    expect(byLocation.total).toBe(1);
    expect(byLocation.items[0]?.assetId).toBe(assetBId);
    const byCategory = await listFacilityStatus(requireDb(), { categoryId });
    expect(byCategory.items.every((item) => item.categoryName === 'HVAC')).toBe(true);
    const byStatus = await listFacilityStatus(requireDb(), { status: 'IN_REPAIR' });
    expect(byStatus.total).toBe(1);
    expect(byStatus.items[0]?.assetId).toBe(assetId);
    const none = await listFacilityStatus(requireDb(), { status: 'UNDER_INSPECTION' });
    expect(none.total).toBe(0);
    expect(none.items).toEqual([]);
  });

  it('paginates deterministically without dropping or duplicating items', async () => {
    const page1 = await listFacilityStatus(requireDb(), { limit: 1, offset: 0 });
    const page2 = await listFacilityStatus(requireDb(), { limit: 1, offset: 1 });
    expect(page1.total).toBe(page2.total);
    expect(page1.items).toHaveLength(1);
    expect(page2.items).toHaveLength(1);
    expect(page1.items[0]?.assetId).not.toBe(page2.items[0]?.assetId);
    // Highest severity first (IN_REPAIR asset before others).
    expect(page1.items[0]?.derivedStatus).toBe('IN_REPAIR');
  });

  it('projects only sanitized fields (no reporter identity or report content)', async () => {
    const result = await listFacilityStatus(requireDb(), {});
    for (const item of result.items) {
      expect(Object.keys(item).sort()).toEqual([
        'activeReportCount',
        'assetCode',
        'assetId',
        'assetName',
        'categoryName',
        'derivedStatus',
        'isActive',
        'lastUpdated',
        'locationLabel',
      ]);
    }
  });

  it('lists the full maintenance history for an asset, newest first', async () => {
    const history = await getFacilityMaintenanceHistory(requireDb(), assetId);
    expect(history.asset.assetCode).toBe('P62-AC-01');
    expect(history.asset.locationLabel).toBe('Gedung C · Ruang Kuliah 01');
    expect(history.asset.derivedStatus).toBe('IN_REPAIR');
    expect(history.items.length).toBe(2);
    expect(history.items[0]?.status).toBe('IN_REPAIR');
    expect(history.items[1]?.status).toBe('REPORTED');
    expect(
      history.items[0]!.reportedAt.getTime() >= history.items[1]!.reportedAt.getTime(),
    ).toBe(true);
    for (const item of history.items) {
      expect(item.ticketNumber).toMatch(/^P62-/);
    }
  });

  it('returns 404 for an unknown asset but keeps archived-asset history', async () => {
    await expect(
      getFacilityMaintenanceHistory(requireDb(), '00000000-0000-4000-8000-000000000000'),
    ).rejects.toMatchObject({ status: 404 });
    const archived = await getFacilityMaintenanceHistory(requireDb(), inactiveAssetId);
    expect(archived.asset.isActive).toBe(false);
    expect(archived.items).toEqual([]);
  });
});
