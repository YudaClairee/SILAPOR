// Idempotent master-data seed (Phase 2 P2-2). Seeds ALL Phase 2 master data
// from data/master/*.csv: users, facility_categories (+ weights), issue_types,
// locations hierarchy (campus -> buildings -> floors -> rooms + usage tiers),
// facility_assets (derived from asset-profiles.csv rules), technicians.
//
// Idempotency: every table upserts on its natural code (username / code /
// asset_code / technician_code). Double-run produces zero duplicates.
// Manually-archived rows (is_active=false set by an admin AFTER the first
// seed) are never reactivated by re-seed: only the first insert writes
// is_active; conflict updates sync mutable fields (name/weight/tier/role/...)
// but omit is_active. Exception: users reactivate (is_active=true) on conflict
// to preserve the Phase 1 behaviour.
//
// Importing this module performs no I/O. Run directly:
//   pnpm --filter @silapor/database run db:seed
// Exits non-zero with a clear (credential-redacted) message when
// DATABASE_URL is unreachable or a CSV file is missing/malformed.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { count, eq, inArray } from 'drizzle-orm';
import { getDb, redactDatabaseUrl, resolveDatabaseUrl } from './index.js';
import {
  facilityAssets,
  facilityCategories,
  issueTypes,
  locations,
  outboxEvents,
  technicians,
  users,
} from './schema.js';

interface SeedUser {
  readonly username: string;
  readonly role: 'ADMIN' | 'REPORTER';
  readonly nim: string | null;
  readonly externalUserId: string;
}

const SEED_USERS: readonly SeedUser[] = [
  { username: 'admin', role: 'ADMIN', nim: null, externalUserId: 'admin' },
  { username: '230001', role: 'REPORTER', nim: '230001', externalUserId: '230001' },
  { username: '230002', role: 'REPORTER', nim: '230002', externalUserId: '230002' },
];

const CAMPUS_CODE = 'UPI-TASIK';
const CAMPUS_NAME = 'UPI Kampus Tasikmalaya';

// asset-profiles.csv asset_type -> facility_categories.code (identity map today).
const ASSET_TYPE_CATEGORY: Readonly<Record<string, string>> = {
  ELECTRONIC: 'ELECTRONIC',
  FURNITURE: 'FURNITURE',
  ELECTRICAL: 'ELECTRICAL',
  HVAC: 'HVAC',
  PLUMBING: 'PLUMBING',
};

export interface SeedResult {
  readonly inserted: number;
  readonly updated: number;
  readonly totalUsers: number;
  readonly outboxEvents: number;
}

export interface SeedTableCounts {
  readonly inserted: number;
  readonly updated: number;
}

export interface SeedDetail extends SeedResult {
  readonly tables: Readonly<Record<string, SeedTableCounts>>;
}

type CsvRow = Readonly<Record<string, string>>;

function masterDir(): string {
  // seed.ts lives at packages/database/src/seed.ts; CSVs at <root>/data/master.
  return path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'data', 'master');
}

// Dependency-free CSV reader. The master files contain no quoted commas
// (verified by inspection); fail fast instead of silently misparsing if a
// quote ever appears.
function readCsvRows(fileName: string): CsvRow[] {
  const filePath = path.join(masterDir(), fileName);
  let text: string;
  try {
    text = readFileSync(filePath, 'utf8');
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`db:seed: unable to read ${fileName} at ${filePath}: ${detail}`);
  }
  if (text.includes('"')) {
    throw new Error(
      `db:seed: ${fileName} contains a double-quote; the dependency-free parser only supports unquoted comma-separated values.`,
    );
  }
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const headerLine = lines[0];
  if (headerLine === undefined) {
    throw new Error(`db:seed: ${fileName} is empty (expected a header row).`);
  }
  const header = headerLine.split(',').map((cell) => cell.trim());
  return lines.slice(1).map((line, index) => {
    const cells = line.split(',');
    if (cells.length !== header.length) {
      throw new Error(
        `db:seed: ${fileName} line ${index + 2} has ${cells.length} cells, expected ${header.length}.`,
      );
    }
    const row: Record<string, string> = {};
    for (let i = 0; i < header.length; i++) {
      const key = header[i];
      const value = cells[i];
      if (key === undefined || value === undefined) {
        throw new Error(`db:seed: ${fileName} line ${index + 2} is malformed.`);
      }
      row[key] = value.trim();
    }
    return row;
  });
}

function col(row: CsvRow, name: string): string {
  return row[name] ?? '';
}

function parseBool(raw: string, context: string): boolean {
  if (raw === 'true') {
    return true;
  }
  if (raw === 'false') {
    return false;
  }
  throw new Error(`db:seed: ${context} has invalid boolean '${raw}' (expected true/false).`);
}

function parseIntField(raw: string, context: string): number {
  if (!/^-?\d+$/.test(raw)) {
    throw new Error(`db:seed: ${context} has invalid integer '${raw}'.`);
  }
  return Number.parseInt(raw, 10);
}

interface CategoryWeights {
  readonly category: ReadonlyMap<string, number>;
  readonly asset: ReadonlyMap<string, number>;
}

function loadWeights(): CategoryWeights {
  const category = new Map<string, number>();
  const asset = new Map<string, number>();
  for (const row of readCsvRows('facility-weights.csv')) {
    if (col(row, 'config_version') !== 'v1') {
      continue;
    }
    const weight = parseIntField(
      col(row, 'weight_value'),
      `facility-weights.csv ${col(row, 'weight_type')}/${col(row, 'target_code')}`,
    );
    if (col(row, 'weight_type') === 'CATEGORY') {
      category.set(col(row, 'target_code'), weight);
    } else if (col(row, 'weight_type') === 'ASSET') {
      asset.set(col(row, 'target_code'), weight);
    }
  }
  return { category, asset };
}

interface AssetProfile {
  readonly appliesTo: string;
  readonly assetCode: string;
  readonly assetName: string;
  readonly quantity: number | null;
  readonly assetType: string;
}

function loadAssetProfiles(): AssetProfile[] {
  return readCsvRows('asset-profiles.csv').map((row, index) => {
    const quantityRaw = row['quantity'] ?? '';
    return {
      appliesTo: row['applies_to'] ?? '',
      assetCode: row['asset_code'] ?? '',
      assetName: row['asset_name'] ?? '',
      quantity:
        quantityRaw === '' ? null : parseIntField(quantityRaw, `asset-profiles.csv row ${index + 2}`),
      assetType: row['asset_type'] ?? '',
    };
  });
}

interface RoomSeed {
  readonly roomCode: string;
  readonly roomName: string;
  readonly buildingCode: string;
  readonly locationId: string;
}

function profileMatches(
  appliesTo: string,
  room: Pick<RoomSeed, 'roomCode' | 'buildingCode'> & { readonly roomNameUpper: string },
): boolean {
  const conditions = appliesTo
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return conditions.every((condition) => {
    if (condition.startsWith('ROOM_NAME_CONTAINS=')) {
      return room.roomNameUpper.includes(condition.slice('ROOM_NAME_CONTAINS='.length).toUpperCase());
    }
    if (condition.startsWith('ROOM_CODE=')) {
      return room.roomCode === condition.slice('ROOM_CODE='.length).trim();
    }
    if (condition.startsWith('BUILDING_CODE!=')) {
      return room.buildingCode !== condition.slice('BUILDING_CODE!='.length).trim();
    }
    if (condition.startsWith('BUILDING_CODE=')) {
      return room.buildingCode === condition.slice('BUILDING_CODE='.length).trim();
    }
    throw new Error(`db:seed: unsupported asset-profiles applies_to condition '${condition}'.`);
  });
}

async function runSeed(url: string): Promise<SeedDetail> {
  const { db, close } = getDb(url);
  const tables: Record<string, { inserted: number; updated: number }> = {};
  const tally = (table: string, existed: boolean): void => {
    const entry = tables[table] ?? { inserted: 0, updated: 0 };
    if (existed) {
      entry.updated += 1;
    } else {
      entry.inserted += 1;
    }
    tables[table] = entry;
  };
  try {
    // 1. Users (Phase 1 behaviour kept: reactivate + sync role/nim/external id).
    for (const seedUser of SEED_USERS) {
      const existing = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.username, seedUser.username));
      tally('users', existing.length > 0);
      await db
        .insert(users)
        .values({
          username: seedUser.username,
          role: seedUser.role,
          nim: seedUser.nim,
          externalUserId: seedUser.externalUserId,
          isActive: true,
        })
        .onConflictDoUpdate({
          target: users.username,
          set: {
            role: seedUser.role,
            nim: seedUser.nim,
            externalUserId: seedUser.externalUserId,
            isActive: true,
            updatedAt: new Date(),
          },
        });
    }

    // 2. Facility categories (weights from facility-weights.csv CATEGORY v1;
    // legacy codes not present there get weight 0).
    const weights = loadWeights();
    const categoryIds = new Map<string, string>();
    for (const row of readCsvRows('facility-categories.csv')) {
      const code = row['code'] ?? '';
      const name = row['name'] ?? '';
      if (code === '' || name === '') {
        throw new Error('db:seed: facility-categories.csv has a row with empty code/name.');
      }
      const weight = weights.category.get(code) ?? 0;
      const isActive = parseBool(row['is_active'] ?? '', `facility-categories.csv ${code}`);
      const existing = await db
        .select({ id: facilityCategories.id })
        .from(facilityCategories)
        .where(eq(facilityCategories.code, code));
      tally('facility_categories', existing.length > 0);
      const upserted = await db
        .insert(facilityCategories)
        .values({ code, name, weight, isActive })
        .onConflictDoUpdate({
          target: facilityCategories.code,
          // Never flip is_active false->true: admin archivals survive re-seed.
          set: { name, weight },
        })
        .returning({ id: facilityCategories.id });
      const id = existing[0]?.id ?? upserted[0]?.id;
      if (id === undefined) {
        throw new Error(`db:seed: failed to resolve facility_categories id for ${code}.`);
      }
      categoryIds.set(code, id);
    }

    // 3. Issue types (7 generic rows have empty category_code -> NULL;
    // legacy rows resolve to their (inactive) category).
    for (const row of readCsvRows('issue-types.csv')) {
      const code = row['code'] ?? '';
      const name = row['name'] ?? '';
      if (code === '' || name === '') {
        throw new Error('db:seed: issue-types.csv has a row with empty code/name.');
      }
      const categoryCode = (row['category_code'] ?? '').trim();
      let categoryId: string | null = null;
      if (categoryCode !== '') {
        const resolved = categoryIds.get(categoryCode);
        if (resolved === undefined) {
          throw new Error(
            `db:seed: issue-types.csv ${code} references unknown category_code '${categoryCode}'.`,
          );
        }
        categoryId = resolved;
      }
      const isActive = parseBool(row['is_active'] ?? '', `issue-types.csv ${code}`);
      const existing = await db
        .select({ id: issueTypes.id })
        .from(issueTypes)
        .where(eq(issueTypes.code, code));
      tally('issue_types', existing.length > 0);
      await db
        .insert(issueTypes)
        .values({ code, name, categoryId, isActive })
        .onConflictDoUpdate({
          target: issueTypes.code,
          set: { name, categoryId },
        });
    }

    // 4. Locations hierarchy: campus -> buildings -> floors -> rooms.
    const locationIds = new Map<string, string>();
    const upsertLocation = async (
      code: string,
      insertValues: typeof locations.$inferInsert,
      updateValues: Partial<typeof locations.$inferInsert>,
    ): Promise<string> => {
      const existing = await db
        .select({ id: locations.id })
        .from(locations)
        .where(eq(locations.code, code));
      tally('locations', existing.length > 0);
      const upserted = await db
        .insert(locations)
        .values(insertValues)
        .onConflictDoUpdate({ target: locations.code, set: updateValues })
        .returning({ id: locations.id });
      const id = existing[0]?.id ?? upserted[0]?.id;
      if (id === undefined) {
        throw new Error(`db:seed: failed to resolve locations id for ${code}.`);
      }
      locationIds.set(code, id);
      return id;
    };

    const campusId = await upsertLocation(
      CAMPUS_CODE,
      {
        code: CAMPUS_CODE,
        name: CAMPUS_NAME,
        type: 'CAMPUS',
        parentId: null,
        buildingCode: null,
        floorNumber: null,
        usageTier: null,
        tierScore: null,
        reporterHidden: false,
        isActive: true,
      },
      { name: CAMPUS_NAME, type: 'CAMPUS', parentId: null },
    );

    const buildingNames = new Map<string, string>();
    for (const row of readCsvRows('buildings.csv')) {
      const code = row['building_code'] ?? '';
      const name = row['building_name'] ?? '';
      if (code === '' || name === '') {
        throw new Error('db:seed: buildings.csv has a row with empty building_code/name.');
      }
      const isActive = parseBool(row['is_active'] ?? '', `buildings.csv ${code}`);
      buildingNames.set(code, name);
      await upsertLocation(
        code,
        {
          code,
          name,
          type: 'BUILDING',
          parentId: campusId,
          buildingCode: code,
          floorNumber: null,
          usageTier: null,
          tierScore: null,
          reporterHidden: false,
          isActive,
        },
        { name, type: 'BUILDING', parentId: campusId, buildingCode: code },
      );
    }

    const roomRows = readCsvRows('rooms_lengkap.csv');
    const floorKeys: Array<{ readonly buildingCode: string; readonly floorNumber: number }> = [];
    {
      const seen = new Set<string>();
      for (const row of roomRows) {
        const buildingCode = row['building_code'] ?? '';
        const floorNumber = parseIntField(
          row['floor_number'] ?? '',
          `rooms_lengkap.csv ${row['room_code'] ?? '?'}`,
        );
        const key = `${buildingCode}-F${floorNumber}`;
        if (!seen.has(key)) {
          seen.add(key);
          floorKeys.push({ buildingCode, floorNumber });
        }
      }
      floorKeys.sort(
        (a, b) =>
          a.buildingCode.localeCompare(b.buildingCode) || a.floorNumber - b.floorNumber,
      );
    }
    for (const floor of floorKeys) {
      const buildingId = locationIds.get(floor.buildingCode);
      if (buildingId === undefined) {
        throw new Error(
          `db:seed: rooms_lengkap.csv references unknown building_code '${floor.buildingCode}'.`,
        );
      }
      const buildingName = buildingNames.get(floor.buildingCode) ?? floor.buildingCode;
      const code = `${floor.buildingCode}-F${floor.floorNumber}`;
      const name = `Lantai ${floor.floorNumber} ${buildingName}`;
      await upsertLocation(
        code,
        {
          code,
          name,
          type: 'FLOOR',
          parentId: buildingId,
          buildingCode: floor.buildingCode,
          floorNumber: floor.floorNumber,
          usageTier: null,
          tierScore: null,
          reporterHidden: false,
          isActive: true,
        },
        {
          name,
          type: 'FLOOR',
          parentId: buildingId,
          buildingCode: floor.buildingCode,
          floorNumber: floor.floorNumber,
        },
      );
    }

    const usageByRoom = new Map<string, { tier: string; score: number }>();
    for (const row of readCsvRows('location-usage.csv')) {
      const roomCode = row['room_code'] ?? '';
      const tier = row['usage_tier'] ?? '';
      if (!/^TIER_[1-4]$/.test(tier)) {
        throw new Error(`db:seed: location-usage.csv ${roomCode} has invalid usage_tier '${tier}'.`);
      }
      const score = parseIntField(row['tier_score'] ?? '', `location-usage.csv ${roomCode}`);
      if (score < 0 || score > 30) {
        throw new Error(`db:seed: location-usage.csv ${roomCode} tier_score ${score} out of range 0-30.`);
      }
      usageByRoom.set(roomCode, { tier, score });
    }

    const rooms: RoomSeed[] = [];
    for (const row of roomRows) {
      const buildingCode = row['building_code'] ?? '';
      const floorNumber = parseIntField(
        row['floor_number'] ?? '',
        `rooms_lengkap.csv ${row['room_code'] ?? '?'}`,
      );
      const roomCode = row['room_code'] ?? '';
      const roomName = row['room_name'] ?? '';
      if (roomCode === '' || roomName === '') {
        throw new Error('db:seed: rooms_lengkap.csv has a row with empty room_code/name.');
      }
      const floorId = locationIds.get(`${buildingCode}-F${floorNumber}`);
      if (floorId === undefined) {
        throw new Error(`db:seed: no FLOOR location for room ${roomCode}.`);
      }
      const usage = usageByRoom.get(roomCode);
      const isActive = parseBool(row['is_active'] ?? '', `rooms_lengkap.csv ${roomCode}`);
      const locationId = await upsertLocation(
        roomCode,
        {
          code: roomCode,
          name: roomName,
          type: 'ROOM',
          parentId: floorId,
          buildingCode,
          floorNumber,
          usageTier: usage?.tier ?? null,
          tierScore: usage?.score ?? null,
          reporterHidden: /lift/i.test(roomName),
          isActive,
        },
        {
          name: roomName,
          type: 'ROOM',
          parentId: floorId,
          buildingCode,
          floorNumber,
          usageTier: usage?.tier ?? null,
          tierScore: usage?.score ?? null,
          reporterHidden: /lift/i.test(roomName),
        },
      );
      rooms.push({ roomCode, roomName, buildingCode, locationId });
    }

    // 5. Facility assets from asset-profiles.csv rules (NOT the empty assets.csv).
    const profiles = loadAssetProfiles();
    for (const room of rooms) {
      const roomNameUpper = room.roomName.toUpperCase();
      for (const profile of profiles) {
        if (!profileMatches(profile.appliesTo, { ...room, roomNameUpper })) {
          continue;
        }
        const categoryCode = ASSET_TYPE_CATEGORY[profile.assetType];
        if (categoryCode === undefined) {
          throw new Error(
            `db:seed: asset-profiles.csv ${profile.assetCode} has unknown asset_type '${profile.assetType}'.`,
          );
        }
        const categoryId = categoryIds.get(categoryCode);
        if (categoryId === undefined) {
          throw new Error(`db:seed: unknown facility category '${categoryCode}'.`);
        }
        const weight = weights.asset.get(profile.assetCode);
        if (weight === undefined) {
          throw new Error(
            `db:seed: facility-weights.csv has no ASSET v1 row for '${profile.assetCode}'.`,
          );
        }
        const assetCode = `${profile.assetCode}-${room.roomCode}`;
        const existing = await db
          .select({ id: facilityAssets.id })
          .from(facilityAssets)
          .where(eq(facilityAssets.assetCode, assetCode));
        tally('facility_assets', existing.length > 0);
        await db
          .insert(facilityAssets)
          .values({
            assetCode,
            categoryId,
            locationId: room.locationId,
            name: profile.assetName,
            weight,
            quantity: profile.quantity,
            isActive: true,
          })
          .onConflictDoUpdate({
            target: facilityAssets.assetCode,
            set: {
              categoryId,
              locationId: room.locationId,
              name: profile.assetName,
              weight,
              quantity: profile.quantity,
              updatedAt: new Date(),
            },
          });
      }
    }

    // 6. Technicians.
    for (const row of readCsvRows('technicians.csv')) {
      const code = row['technician_code'] ?? '';
      const displayName = row['display_name'] ?? '';
      if (code === '' || displayName === '') {
        throw new Error('db:seed: technicians.csv has a row with empty technician_code/name.');
      }
      const specialty = (row['specialization'] ?? '').trim() || null;
      const isActive = parseBool(row['is_active'] ?? '', `technicians.csv ${code}`);
      const existing = await db
        .select({ id: technicians.id })
        .from(technicians)
        .where(eq(technicians.technicianCode, code));
      tally('technicians', existing.length > 0);
      await db
        .insert(technicians)
        .values({ technicianCode: code, displayName, specialty, isActive })
        .onConflictDoUpdate({
          target: technicians.technicianCode,
          set: { displayName, specialty, updatedAt: new Date() },
        });
    }

    let inserted = 0;
    let updated = 0;
    for (const entry of Object.values(tables)) {
      inserted += entry.inserted;
      updated += entry.updated;
    }

    const totalRows = await db
      .select({ value: count() })
      .from(users)
      .where(
        inArray(
          users.username,
          SEED_USERS.map((user) => user.username),
        ),
      );
    const totalUsers = totalRows[0]?.value ?? 0;
    const outboxRows = await db.select({ value: count() }).from(outboxEvents);
    const outboxEventsCount = outboxRows[0]?.value ?? 0;

    return { inserted, updated, totalUsers, outboxEvents: outboxEventsCount, tables };
  } finally {
    await close();
  }
}

function wrapSeedError(url: string, error: unknown): Error {
  const detail = error instanceof Error ? error.message : String(error);
  if (detail.startsWith('db:seed:')) {
    return error instanceof Error ? error : new Error(detail);
  }
  return new Error(
    `db:seed failed: unable to reach PostgreSQL at ${redactDatabaseUrl(url)}. ` +
      `Is the database running and DATABASE_URL correct? Underlying error: ${detail}`,
  );
}

export async function seedDatabase(connectionString?: string): Promise<SeedResult> {
  const url = resolveDatabaseUrl(connectionString);
  try {
    const detail = await runSeed(url);
    return {
      inserted: detail.inserted,
      updated: detail.updated,
      totalUsers: detail.totalUsers,
      outboxEvents: detail.outboxEvents,
    };
  } catch (error) {
    throw wrapSeedError(url, error);
  }
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) {
    return false;
  }
  try {
    return pathToFileURL(entry).href === import.meta.url;
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  const rawUrl = process.env['DATABASE_URL'];
  const url = resolveDatabaseUrl(rawUrl);
  runSeed(url)
    .then((result) => {
      const masters = Object.entries(result.tables)
        .map(([table, counts]) => `${table}=${counts.inserted + counts.updated}`)
        .join(' ');
      console.log(
        `db:seed: upserted ${result.inserted + result.updated} users ` +
          `(inserted=${result.inserted}, updated=${result.updated}, ` +
          `seed usernames present=${result.totalUsers}, outbox_events=${result.outboxEvents}) ` +
          `masters: ${masters}.`,
      );
    })
    .catch((error: unknown) => {
      console.error(wrapSeedError(url, error).message);
      process.exitCode = 1;
    });
}
