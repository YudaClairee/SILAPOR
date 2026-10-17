// Facility status transport service (Phase 6 P6-5c; mirrors `./reports.ts`).
// Thin: `requireUser` (status list, any role) / `requireAdmin` (maintenance
// history) guards, one database connection per call, delegate to the repo in
// `@silapor/database`, close the connection. Repo `AppError`s propagate
// untouched for routes to map with `toHttpResponse` (400 for invalid
// UUID/status filters, 404 for an unknown asset). Response sanitization
// happens by construction in the repo — no reporter identity or report
// content passes through this layer. Dates are `Date` objects; routes
// serialize them as ISO strings via `Response.json`. This module logs
// nothing — routes log with opaque IDs via `redact()`.
import { FACILITY_STATUSES, type FacilityStatus } from '@silapor/domain';
import {
  MAX_LIST_LIMIT,
  getDb,
  getFacilityMaintenanceHistory as repoGetFacilityMaintenanceHistory,
  listFacilityStatus as repoListFacilityStatus,
  type AssetMaintenanceHistory,
  type FacilityStatusOptions,
  type FacilityStatusResult,
} from '@silapor/database';
import { badRequest } from '@silapor/shared';
import { requireAdmin, requireUser } from './auth';

const FACILITY_STATUS_SET: ReadonlySet<string> = new Set(FACILITY_STATUSES);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function searchParamsOf(url: string | URL): URLSearchParams {
  try {
    return (typeof url === 'string' ? new URL(url) : url).searchParams;
  } catch {
    throw badRequest('Invalid query parameters');
  }
}

function queryParam(params: URLSearchParams, names: readonly string[]): string | null {
  for (const name of names) {
    const value = params.get(name);
    if (value !== null) {
      return value;
    }
  }
  return null;
}

function optionalParamUuid(raw: string | null, field: string): string | undefined {
  if (raw === null || raw === '') {
    return undefined;
  }
  if (!UUID_RE.test(raw)) {
    throw badRequest(`${field} must be a valid UUID`);
  }
  return raw;
}

function optionalStatusParam(raw: string | null): FacilityStatus | undefined {
  if (raw === null || raw === '') {
    return undefined;
  }
  if (!FACILITY_STATUS_SET.has(raw)) {
    throw badRequest('Invalid facility status');
  }
  return raw as FacilityStatus;
}

function pageParam(raw: string | null, field: 'limit' | 'offset'): number | undefined {
  if (raw === null || raw === '') {
    return undefined;
  }
  if (!/^\d+$/.test(raw)) {
    throw badRequest(
      field === 'offset'
        ? 'offset must be a non-negative integer'
        : 'limit must be a positive integer',
    );
  }
  const value = Number(raw);
  if (field === 'limit' && (value < 1 || value > MAX_LIST_LIMIT)) {
    throw badRequest(`limit must be a positive integer at most ${MAX_LIST_LIMIT}`);
  }
  if (field === 'offset' && value < 0) {
    throw badRequest('offset must be a non-negative integer');
  }
  return value;
}

// Pure parser for `GET /api/facilities/status` query (`location_id`,
// `category_id`, `status`, `limit`, `offset`, plus the admin extra
// `include_inactive`). camelCase equivalents tolerated; absent/blank keys
// stay absent so the repo defaults (active-only, limit 50, offset 0) apply.
export function parseFacilityStatusQuery(url: string | URL): FacilityStatusOptions {
  const params = searchParamsOf(url);
  const options: {
    locationId?: string;
    categoryId?: string;
    status?: FacilityStatus;
    includeInactive?: boolean;
    limit?: number;
    offset?: number;
  } = {};
  const locationId = optionalParamUuid(
    queryParam(params, ['locationId', 'location_id']),
    'locationId',
  );
  if (locationId !== undefined) {
    options.locationId = locationId;
  }
  const categoryId = optionalParamUuid(
    queryParam(params, ['categoryId', 'category_id']),
    'categoryId',
  );
  if (categoryId !== undefined) {
    options.categoryId = categoryId;
  }
  const status = optionalStatusParam(queryParam(params, ['status']));
  if (status !== undefined) {
    options.status = status;
  }
  const includeInactive = queryParam(params, ['includeInactive', 'include_inactive']);
  if (includeInactive !== null) {
    options.includeInactive = includeInactive === 'true' || includeInactive === '1';
  }
  const limit = pageParam(params.get('limit'), 'limit');
  if (limit !== undefined) {
    options.limit = limit;
  }
  const offset = pageParam(params.get('offset'), 'offset');
  if (offset !== undefined) {
    options.offset = offset;
  }
  return options;
}

// Public facility status projection for ANY authenticated session (pilot
// ruling: the list is access-restricted, never anonymous). The admin extra
// `include_inactive` is stripped for non-admin sessions — they always see the
// active-only projection, silently, never an error.
export async function listFacilityStatusRoute(
  req: Request,
  url: string | URL,
): Promise<FacilityStatusResult> {
  const user = await requireUser(req);
  const parsed = parseFacilityStatusQuery(url);
  const options: FacilityStatusOptions =
    user.role !== 'ADMIN' ? { ...parsed, includeInactive: undefined } : parsed;
  const conn = getDb();
  try {
    return await repoListFacilityStatus(conn.db, options);
  } finally {
    await conn.close().catch(() => undefined);
  }
}

// Full maintenance history (all tickets for the asset, newest first) —
// admin-only; archived assets keep their history. 404/400 come from the repo.
export async function getAssetMaintenanceHistoryRoute(
  req: Request,
  assetId: string,
): Promise<AssetMaintenanceHistory> {
  await requireAdmin(req);
  const conn = getDb();
  try {
    return await repoGetFacilityMaintenanceHistory(conn.db, assetId);
  } finally {
    await conn.close().catch(() => undefined);
  }
}
