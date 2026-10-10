// Admin master-data service layer (Phase 2 P2-5, plan steps 8-10).
//
// Thin by contract: every function guards via `requireAdmin(req)` from
// `./auth` (401 anonymous / 403 non-ADMIN), opens one database connection,
// delegates to a repository in `@silapor/database`, and closes the
// connection. No drizzle queries here (`eq()` lives in the repo file); repo
// 404/409/400 `AppError`s propagate untouched for routes to map with
// `toHttpResponse`.
//
// Request bodies accept camelCase or snake_case keys (PATCH `{ is_active:
// false }` archives via the repo's ARCHIVED action); responses are full DB
// rows. Audit `requestId` comes from the route's `withRequestId()` context.
// This module logs nothing — routes log with opaque IDs.

import {
  archiveAsset as repoArchiveAsset,
  archiveCategory as repoArchiveCategory,
  archiveIssueType as repoArchiveIssueType,
  archiveLocation as repoArchiveLocation,
  archiveTechnician as repoArchiveTechnician,
  createAsset as repoCreateAsset,
  createCategory as repoCreateCategory,
  createIssueType as repoCreateIssueType,
  createLocation as repoCreateLocation,
  createTechnician as repoCreateTechnician,
  getAsset as repoGetAsset,
  getCategory as repoGetCategory,
  getDb,
  getIssueType as repoGetIssueType,
  getLocation as repoGetLocation,
  getTechnician as repoGetTechnician,
  listAssets as repoListAssets,
  listCategories as repoListCategories,
  listIssueTypes as repoListIssueTypes,
  listLocations as repoListLocations,
  listTechnicians as repoListTechnicians,
  updateAsset as repoUpdateAsset,
  updateCategory as repoUpdateCategory,
  updateIssueType as repoUpdateIssueType,
  updateLocation as repoUpdateLocation,
  updateTechnician as repoUpdateTechnician,
  type AssetCreateInput,
  type AssetPatch,
  type AuditContext,
  type CategoryCreateInput,
  type CategoryPatch,
  type FacilityAsset,
  type FacilityCategory,
  type IssueType,
  type IssueTypeCreateInput,
  type IssueTypePatch,
  type Location,
  type LocationCreateInput,
  type LocationPatch,
  type Technician,
  type TechnicianCreateInput,
  type TechnicianPatch,
} from '@silapor/database';
import { getRequestId, notFound } from '@silapor/shared';
import { requireAdmin } from './auth';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Copies the first present key (camelCase preferred, snake_case fallback)
// onto `out` under the camelCase name. Absent keys stay absent so repo
// validators see the same shape as a camelCase-only client.
function copyField(
  source: Record<string, unknown>,
  out: Record<string, unknown>,
  camel: string,
  snakes: readonly string[],
): void {
  const direct = source[camel];
  if (direct !== undefined) {
    out[camel] = direct;
    return;
  }
  for (const snake of snakes) {
    const value = source[snake];
    if (value !== undefined) {
      out[camel] = value;
      return;
    }
  }
}

function passthrough<T>(input: unknown): T {
  return input as T;
}

function normalizeLocationInput(input: unknown): LocationCreateInput {
  if (!isRecord(input)) {
    return passthrough<LocationCreateInput>(input);
  }
  const out: Record<string, unknown> = {};
  copyField(input, out, 'type', []);
  copyField(input, out, 'code', []);
  copyField(input, out, 'name', []);
  copyField(input, out, 'parentId', ['parent_id']);
  copyField(input, out, 'buildingCode', ['building_code']);
  copyField(input, out, 'floorNumber', ['floor_number']);
  copyField(input, out, 'usageTier', ['usage_tier']);
  copyField(input, out, 'tierScore', ['tier_score']);
  copyField(input, out, 'reporterHidden', ['reporter_hidden']);
  copyField(input, out, 'isActive', ['is_active']);
  return out as unknown as LocationCreateInput;
}

function normalizeLocationPatch(patch: unknown): LocationPatch {
  return normalizeLocationInput(patch) as unknown as LocationPatch;
}

function normalizeCategoryInput(input: unknown): CategoryCreateInput {
  if (!isRecord(input)) {
    return passthrough<CategoryCreateInput>(input);
  }
  const out: Record<string, unknown> = {};
  copyField(input, out, 'code', []);
  copyField(input, out, 'name', []);
  copyField(input, out, 'description', []);
  copyField(input, out, 'weight', []);
  copyField(input, out, 'isActive', ['is_active']);
  return out as unknown as CategoryCreateInput;
}

function normalizeCategoryPatch(patch: unknown): CategoryPatch {
  return normalizeCategoryInput(patch) as unknown as CategoryPatch;
}

function normalizeIssueTypeInput(input: unknown): IssueTypeCreateInput {
  if (!isRecord(input)) {
    return passthrough<IssueTypeCreateInput>(input);
  }
  const out: Record<string, unknown> = {};
  copyField(input, out, 'code', []);
  copyField(input, out, 'name', []);
  copyField(input, out, 'categoryId', ['category_id']);
  copyField(input, out, 'isActive', ['is_active']);
  return out as unknown as IssueTypeCreateInput;
}

function normalizeIssueTypePatch(patch: unknown): IssueTypePatch {
  return normalizeIssueTypeInput(patch) as unknown as IssueTypePatch;
}

function normalizeAssetInput(input: unknown): AssetCreateInput {
  if (!isRecord(input)) {
    return passthrough<AssetCreateInput>(input);
  }
  const out: Record<string, unknown> = {};
  copyField(input, out, 'assetCode', ['asset_code']);
  copyField(input, out, 'name', []);
  copyField(input, out, 'categoryId', ['category_id']);
  copyField(input, out, 'locationId', ['location_id']);
  copyField(input, out, 'weight', []);
  copyField(input, out, 'quantity', []);
  copyField(input, out, 'isActive', ['is_active']);
  return out as unknown as AssetCreateInput;
}

function normalizeAssetPatch(patch: unknown): AssetPatch {
  return normalizeAssetInput(patch) as unknown as AssetPatch;
}

function normalizeTechnicianInput(input: unknown): TechnicianCreateInput {
  if (!isRecord(input)) {
    return passthrough<TechnicianCreateInput>(input);
  }
  const out: Record<string, unknown> = {};
  copyField(input, out, 'technicianCode', ['technician_code']);
  copyField(input, out, 'displayName', ['display_name']);
  copyField(input, out, 'specialty', ['specialization']);
  copyField(input, out, 'isActive', ['is_active']);
  return out as unknown as TechnicianCreateInput;
}

function normalizeTechnicianPatch(patch: unknown): TechnicianPatch {
  return normalizeTechnicianInput(patch) as unknown as TechnicianPatch;
}

interface ListQuery {
  readonly includeInactive: boolean;
  readonly limit: number | undefined;
  readonly offset: number | undefined;
}

// Collection query `?includeInactive=1&limit&offset`. Unparseable URLs or
// values fall back to repo defaults (limit/offset NaN → default/clamp).
function parseListQuery(req: Request): ListQuery {
  try {
    const url = new URL(req.url);
    const flag = url.searchParams.get('includeInactive');
    const limitRaw = url.searchParams.get('limit');
    const offsetRaw = url.searchParams.get('offset');
    return {
      includeInactive: flag === '1' || flag === 'true',
      limit: limitRaw === null ? undefined : Number(limitRaw),
      offset: offsetRaw === null ? undefined : Number(offsetRaw),
    };
  } catch {
    return { includeInactive: false, limit: undefined, offset: undefined };
  }
}

function auditContext(actorId: string): AuditContext {
  return { actorId, requestId: getRequestId() ?? null };
}

// ---------------------------------------------------------------------------
// Locations.
// ---------------------------------------------------------------------------

export async function listLocations(req: Request): Promise<Location[]> {
  await requireAdmin(req);
  const query = parseListQuery(req);
  const conn = getDb();
  try {
    return await repoListLocations(conn.db, {
      includeInactive: query.includeInactive,
      limit: query.limit,
      offset: query.offset,
    });
  } finally {
    await conn.close().catch(() => undefined);
  }
}

export async function getLocation(req: Request, id: string): Promise<Location> {
  await requireAdmin(req);
  const conn = getDb();
  try {
    const row = await repoGetLocation(conn.db, id);
    if (row === undefined) {
      throw notFound('Location not found');
    }
    return row;
  } finally {
    await conn.close().catch(() => undefined);
  }
}

export async function createLocation(req: Request, input: unknown): Promise<Location> {
  const user = await requireAdmin(req);
  const conn = getDb();
  try {
    return await repoCreateLocation(
      conn.db,
      normalizeLocationInput(input),
      auditContext(user.id),
    );
  } finally {
    await conn.close().catch(() => undefined);
  }
}

export async function updateLocation(
  req: Request,
  id: string,
  patch: unknown,
): Promise<Location> {
  const user = await requireAdmin(req);
  const conn = getDb();
  try {
    return await repoUpdateLocation(
      conn.db,
      id,
      normalizeLocationPatch(patch),
      auditContext(user.id),
    );
  } finally {
    await conn.close().catch(() => undefined);
  }
}

export async function archiveLocation(req: Request, id: string): Promise<Location> {
  const user = await requireAdmin(req);
  const conn = getDb();
  try {
    return await repoArchiveLocation(conn.db, id, auditContext(user.id));
  } finally {
    await conn.close().catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Facility categories.
// ---------------------------------------------------------------------------

export async function listCategories(req: Request): Promise<FacilityCategory[]> {
  await requireAdmin(req);
  const query = parseListQuery(req);
  const conn = getDb();
  try {
    return await repoListCategories(conn.db, {
      includeInactive: query.includeInactive,
      limit: query.limit,
      offset: query.offset,
    });
  } finally {
    await conn.close().catch(() => undefined);
  }
}

export async function getCategory(req: Request, id: string): Promise<FacilityCategory> {
  await requireAdmin(req);
  const conn = getDb();
  try {
    const row = await repoGetCategory(conn.db, id);
    if (row === undefined) {
      throw notFound('Category not found');
    }
    return row;
  } finally {
    await conn.close().catch(() => undefined);
  }
}

export async function createCategory(
  req: Request,
  input: unknown,
): Promise<FacilityCategory> {
  const user = await requireAdmin(req);
  const conn = getDb();
  try {
    return await repoCreateCategory(
      conn.db,
      normalizeCategoryInput(input),
      auditContext(user.id),
    );
  } finally {
    await conn.close().catch(() => undefined);
  }
}

export async function updateCategory(
  req: Request,
  id: string,
  patch: unknown,
): Promise<FacilityCategory> {
  const user = await requireAdmin(req);
  const conn = getDb();
  try {
    return await repoUpdateCategory(
      conn.db,
      id,
      normalizeCategoryPatch(patch),
      auditContext(user.id),
    );
  } finally {
    await conn.close().catch(() => undefined);
  }
}

export async function archiveCategory(req: Request, id: string): Promise<FacilityCategory> {
  const user = await requireAdmin(req);
  const conn = getDb();
  try {
    return await repoArchiveCategory(conn.db, id, auditContext(user.id));
  } finally {
    await conn.close().catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Issue types.
// ---------------------------------------------------------------------------

export async function listIssueTypes(req: Request): Promise<IssueType[]> {
  await requireAdmin(req);
  const query = parseListQuery(req);
  const conn = getDb();
  try {
    return await repoListIssueTypes(conn.db, {
      includeInactive: query.includeInactive,
      limit: query.limit,
      offset: query.offset,
    });
  } finally {
    await conn.close().catch(() => undefined);
  }
}

export async function getIssueType(req: Request, id: string): Promise<IssueType> {
  await requireAdmin(req);
  const conn = getDb();
  try {
    const row = await repoGetIssueType(conn.db, id);
    if (row === undefined) {
      throw notFound('Issue type not found');
    }
    return row;
  } finally {
    await conn.close().catch(() => undefined);
  }
}

export async function createIssueType(req: Request, input: unknown): Promise<IssueType> {
  const user = await requireAdmin(req);
  const conn = getDb();
  try {
    return await repoCreateIssueType(
      conn.db,
      normalizeIssueTypeInput(input),
      auditContext(user.id),
    );
  } finally {
    await conn.close().catch(() => undefined);
  }
}

export async function updateIssueType(
  req: Request,
  id: string,
  patch: unknown,
): Promise<IssueType> {
  const user = await requireAdmin(req);
  const conn = getDb();
  try {
    return await repoUpdateIssueType(
      conn.db,
      id,
      normalizeIssueTypePatch(patch),
      auditContext(user.id),
    );
  } finally {
    await conn.close().catch(() => undefined);
  }
}

export async function archiveIssueType(req: Request, id: string): Promise<IssueType> {
  const user = await requireAdmin(req);
  const conn = getDb();
  try {
    return await repoArchiveIssueType(conn.db, id, auditContext(user.id));
  } finally {
    await conn.close().catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Facility assets.
// ---------------------------------------------------------------------------

export async function listAssets(req: Request): Promise<FacilityAsset[]> {
  await requireAdmin(req);
  const query = parseListQuery(req);
  const conn = getDb();
  try {
    return await repoListAssets(conn.db, {
      includeInactive: query.includeInactive,
      limit: query.limit,
      offset: query.offset,
    });
  } finally {
    await conn.close().catch(() => undefined);
  }
}

export async function getAsset(req: Request, id: string): Promise<FacilityAsset> {
  await requireAdmin(req);
  const conn = getDb();
  try {
    const row = await repoGetAsset(conn.db, id);
    if (row === undefined) {
      throw notFound('Asset not found');
    }
    return row;
  } finally {
    await conn.close().catch(() => undefined);
  }
}

export async function createAsset(req: Request, input: unknown): Promise<FacilityAsset> {
  const user = await requireAdmin(req);
  const conn = getDb();
  try {
    return await repoCreateAsset(conn.db, normalizeAssetInput(input), auditContext(user.id));
  } finally {
    await conn.close().catch(() => undefined);
  }
}

export async function updateAsset(
  req: Request,
  id: string,
  patch: unknown,
): Promise<FacilityAsset> {
  const user = await requireAdmin(req);
  const conn = getDb();
  try {
    return await repoUpdateAsset(
      conn.db,
      id,
      normalizeAssetPatch(patch),
      auditContext(user.id),
    );
  } finally {
    await conn.close().catch(() => undefined);
  }
}

export async function archiveAsset(req: Request, id: string): Promise<FacilityAsset> {
  const user = await requireAdmin(req);
  const conn = getDb();
  try {
    return await repoArchiveAsset(conn.db, id, auditContext(user.id));
  } finally {
    await conn.close().catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Technicians.
// ---------------------------------------------------------------------------

export async function listTechnicians(req: Request): Promise<Technician[]> {
  await requireAdmin(req);
  const query = parseListQuery(req);
  const conn = getDb();
  try {
    return await repoListTechnicians(conn.db, {
      includeInactive: query.includeInactive,
      limit: query.limit,
      offset: query.offset,
    });
  } finally {
    await conn.close().catch(() => undefined);
  }
}

export async function getTechnician(req: Request, id: string): Promise<Technician> {
  await requireAdmin(req);
  const conn = getDb();
  try {
    const row = await repoGetTechnician(conn.db, id);
    if (row === undefined) {
      throw notFound('Technician not found');
    }
    return row;
  } finally {
    await conn.close().catch(() => undefined);
  }
}

export async function createTechnician(
  req: Request,
  input: unknown,
): Promise<Technician> {
  const user = await requireAdmin(req);
  const conn = getDb();
  try {
    return await repoCreateTechnician(
      conn.db,
      normalizeTechnicianInput(input),
      auditContext(user.id),
    );
  } finally {
    await conn.close().catch(() => undefined);
  }
}

export async function updateTechnician(
  req: Request,
  id: string,
  patch: unknown,
): Promise<Technician> {
  const user = await requireAdmin(req);
  const conn = getDb();
  try {
    return await repoUpdateTechnician(
      conn.db,
      id,
      normalizeTechnicianPatch(patch),
      auditContext(user.id),
    );
  } finally {
    await conn.close().catch(() => undefined);
  }
}

export async function archiveTechnician(req: Request, id: string): Promise<Technician> {
  const user = await requireAdmin(req);
  const conn = getDb();
  try {
    return await repoArchiveTechnician(conn.db, id, auditContext(user.id));
  } finally {
    await conn.close().catch(() => undefined);
  }
}
