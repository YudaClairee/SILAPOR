// Report server transport service (Phase 3 P3-4, frontend foundation).
//
// Thin by contract (mirrors `./master-data.ts`): every function guards via
// `requireUser`/`requireAdmin` from `./auth` (defense in depth — routes guard
// too), opens one database connection, delegates to a repository in
// `@silapor/database`, and closes the connection. Repo `AppError`s propagate
// untouched for routes to map with `toHttpResponse`.
//
// Conventions:
// - `reporterId` ALWAYS comes from the session user, NEVER from the client —
//   `normalizeCreateReportBody` deliberately drops any client-supplied
//   reporter/user id before the repo sees the input.
// - All 404s use the repo's exact `'Report not found'` message so a missing
//   row, a foreign row (another reporter's ticket), and an unresolvable
//   ticket/UUID reference produce byte-identical HTTP bodies (no existence
//   oracle for other reporters' tickets).
// - `getMyTimelineRoute` returns RAW `report_events` rows: Phase 5 owns
//   sanitization, so the reporter UI must render a safe subset only.
// - Rate limiting is intentionally NOT applied here: the login rate-limit
//   helper is login-specific (username+IP key) and not trivially reusable;
//   Phase 9 owns report-creation rate limits.
// - This module logs nothing — routes log with opaque IDs.

import { eq } from 'drizzle-orm';
import {
  createReport as repoCreateReport,
  findDuplicateCandidates as repoFindDuplicateCandidates,
  getAdminReportDetail as repoGetAdminReportDetail,
  getDb,
  getMyReportDetail as repoGetMyReportDetail,
  getMyReportTimeline as repoGetMyReportTimeline,
  listAllReports as repoListAllReports,
  listAssets as repoListAssets,
  listCategories as repoListCategories,
  listIssueTypes as repoListIssueTypes,
  listLocations as repoListLocations,
  listMyReports as repoListMyReports,
  maintenanceReports,
  type CreateReportInput,
  type CreateReportResult,
  type DuplicateCandidate,
  type FacilityAsset,
  type FacilityCategory,
  type IssueType,
  type ListAllReportsOptions,
  type ListMyReportsOptions,
  type Location,
  type ReportDetail,
  type ReportListResult,
  type ReportQueryDb,
  type ReportTimelineEntry,
} from '@silapor/database';
import { badRequest, notFound } from '@silapor/shared';
import { requireAdmin, requireUser } from './auth';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Single 404 message shared by every report lookup path (ticket miss, UUID
// miss, foreign row, invalid reference) — identical bodies by construction.
const REPORT_NOT_FOUND_MESSAGE = 'Report not found';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Copies the first present key (camelCase preferred, snake_case fallbacks)
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

// ---------------------------------------------------------------------------
// Ticket/UUID resolution (§3).
// ---------------------------------------------------------------------------

export type ReportRefKind = 'ticket' | 'uuid' | 'invalid';

// Pure classifier for a report reference: `MNT-…` is a ticket number,
// a UUID-shaped string is a row id, anything else is invalid (→ 404, never
// 500). Exported for unit tests.
export function classifyReportRef(ref: string): ReportRefKind {
  if (ref.startsWith('MNT-')) {
    return 'ticket';
  }
  return UUID_RE.test(ref) ? 'uuid' : 'invalid';
}

// Resolves a reporter-facing `ref` (UUID or `MNT-…` ticket) to a row id.
// Ticket lookups are scoped to `reporterId` when non-null (reporter routes:
// resolve-then-check, foreign ticket → identical 404); admin routes pass
// null (unscoped). Invalid UUIDs → 404, not 500.
export async function resolveReportId(
  db: ReportQueryDb,
  reporterId: string | null,
  ref: string,
): Promise<string> {
  if (ref.startsWith('MNT-')) {
    const rows = await db
      .select({ id: maintenanceReports.id, reporterId: maintenanceReports.reporterId })
      .from(maintenanceReports)
      .where(eq(maintenanceReports.ticketNumber, ref));
    const row = rows[0];
    if (row === undefined || (reporterId !== null && row.reporterId !== reporterId)) {
      throw notFound(REPORT_NOT_FOUND_MESSAGE);
    }
    return row.id;
  }
  if (!UUID_RE.test(ref)) {
    throw notFound(REPORT_NOT_FOUND_MESSAGE);
  }
  return ref;
}

// ---------------------------------------------------------------------------
// Create.
// ---------------------------------------------------------------------------

// Normalizes a client body to the repo's `CreateReportInput` shape (minus
// `reporterId`, which the caller sets from the session). Accepts camelCase
// or snake_case keys; unknown shapes pass through so repo validators — not
// this layer — produce the 400. NEVER copies a client-supplied reporter id.
export function normalizeCreateReportBody(body: unknown): CreateReportInput {
  if (!isRecord(body)) {
    return body as CreateReportInput;
  }
  const out: Record<string, unknown> = {};
  copyField(body, out, 'locationId', ['location_id']);
  copyField(body, out, 'assetId', ['asset_id']);
  copyField(body, out, 'submittedCategoryId', [
    'submitted_category_id',
    'categoryId',
    'category_id',
  ]);
  copyField(body, out, 'submittedIssueTypeId', [
    'submitted_issue_type_id',
    'issueTypeId',
    'issue_type_id',
  ]);
  copyField(body, out, 'description', []);
  copyField(body, out, 'occurredAt', ['occurred_at']);
  return out as unknown as CreateReportInput;
}

// Creates one report for the session user. `idempotencyKey` comes from the
// route's `x-idempotency-key` header (400 when missing/empty, same message
// as the repo). Returns the repo shape verbatim (`report` camelCase row +
// `duplicateCandidates` warning + `idempotentReplay`); 201 vs 200 mapping
// happens in the route.
export async function createMyReport(
  req: Request,
  body: unknown,
  idempotencyKey: string | null,
): Promise<CreateReportResult> {
  const user = await requireUser(req);
  const key = typeof idempotencyKey === 'string' ? idempotencyKey.trim() : '';
  if (key === '') {
    throw badRequest('Idempotency key is required');
  }
  const conn = getDb();
  try {
    return await repoCreateReport(
      conn.db,
      { ...normalizeCreateReportBody(body), reporterId: user.id },
      key,
    );
  } finally {
    await conn.close().catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Duplicate check (no creation).
// ---------------------------------------------------------------------------

function queryParam(params: URLSearchParams, names: readonly string[]): string | null {
  for (const name of names) {
    const value = params.get(name);
    if (value !== null) {
      return value;
    }
  }
  return null;
}

function searchParamsOf(url: string | URL): URLSearchParams {
  try {
    return (typeof url === 'string' ? new URL(url) : url).searchParams;
  } catch {
    throw badRequest('Invalid query parameters');
  }
}

function requireParamUuid(raw: string | null, field: string): string {
  if (raw === null || !UUID_RE.test(raw)) {
    throw badRequest(`${field} must be a valid UUID`);
  }
  return raw;
}

function optionalParamUuid(raw: string | null, field: string): string | undefined {
  if (raw === null) {
    return undefined;
  }
  return requireParamUuid(raw, field);
}

export interface DuplicateCheckFilter {
  readonly locationId: string;
  readonly categoryId: string;
  readonly assetId?: string | undefined;
  readonly issueTypeId?: string | undefined;
}

// Pure parser for `GET /api/reports/duplicate-check`. `locationId` +
// `categoryId` are required (400 when missing/invalid, same message format
// as the repo validators); `assetId`/`issueTypeId` are optional UUIDs.
export function parseDuplicateCheckQuery(url: string | URL): DuplicateCheckFilter {
  const params = searchParamsOf(url);
  const locationId = requireParamUuid(
    queryParam(params, ['locationId', 'location_id']),
    'locationId',
  );
  const categoryId = requireParamUuid(
    queryParam(params, ['categoryId', 'category_id', 'submittedCategoryId']),
    'categoryId',
  );
  const assetId = optionalParamUuid(queryParam(params, ['assetId', 'asset_id']), 'assetId');
  const issueTypeId = optionalParamUuid(
    queryParam(params, ['issueTypeId', 'issue_type_id', 'submittedIssueTypeId']),
    'issueTypeId',
  );
  const filter: { locationId: string; categoryId: string; assetId?: string; issueTypeId?: string } =
    { locationId, categoryId };
  if (assetId !== undefined) {
    filter.assetId = assetId;
  }
  if (issueTypeId !== undefined) {
    filter.issueTypeId = issueTypeId;
  }
  return filter;
}

// Returns `{ candidates }` for the session user WITHOUT creating anything.
export async function checkMyDuplicates(
  req: Request,
  url: string | URL,
): Promise<{ readonly candidates: DuplicateCandidate[] }> {
  const user = await requireUser(req);
  const filter = parseDuplicateCheckQuery(url);
  const conn = getDb();
  try {
    const candidates = await repoFindDuplicateCandidates(conn.db, {
      reporterId: user.id,
      ...filter,
    });
    return { candidates };
  } finally {
    await conn.close().catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// List parsing (reporter + admin share the base filters).
// ---------------------------------------------------------------------------

function numberParam(params: URLSearchParams, names: readonly string[]): number | undefined {
  const raw = queryParam(params, names);
  return raw === null ? undefined : Number(raw);
}

function parseBaseListQuery(params: URLSearchParams): ListMyReportsOptions {
  const status = params.getAll('status');
  const options: {
    status?: string[];
    categoryId?: string;
    locationId?: string;
    priority?: string;
    from?: string;
    to?: string;
    limit?: number;
    offset?: number;
    sort?: string;
  } = {};
  if (status.length > 0) {
    options.status = status;
  }
  const categoryId = queryParam(params, ['categoryId', 'category_id']);
  if (categoryId !== null) {
    options.categoryId = categoryId;
  }
  const locationId = queryParam(params, ['locationId', 'location_id']);
  if (locationId !== null) {
    options.locationId = locationId;
  }
  const priority = queryParam(params, ['priority']);
  if (priority !== null) {
    options.priority = priority;
  }
  const from = queryParam(params, ['from']);
  if (from !== null) {
    options.from = from;
  }
  const to = queryParam(params, ['to']);
  if (to !== null) {
    options.to = to;
  }
  const limit = numberParam(params, ['limit']);
  if (limit !== undefined) {
    options.limit = limit;
  }
  const offset = numberParam(params, ['offset']);
  if (offset !== undefined) {
    options.offset = offset;
  }
  const sort = queryParam(params, ['sort']);
  if (sort !== null) {
    options.sort = sort;
  }
  // Invalid status/priority/sort/UUID/date values throw 400 inside the repo
  // validators; limit/offset fall back to repo defaults via clamping.
  return options;
}

// Pure parser for `GET /api/reports` query (?status&categoryId&locationId&
// priority&from&to&limit&offset&sort).
export function parseMyReportsQuery(url: string | URL): ListMyReportsOptions {
  return parseBaseListQuery(searchParamsOf(url));
}

// Pure parser for `GET /api/admin/reports` query (base filters +
// ?reporterId&search).
export function parseAdminReportsQuery(url: string | URL): ListAllReportsOptions {
  const params = searchParamsOf(url);
  const base = parseBaseListQuery(params);
  const reporterId = queryParam(params, ['reporterId', 'reporter_id']);
  const search = queryParam(params, ['search']);
  const extra: ListAllReportsOptions =
    reporterId !== null && search !== null
      ? { reporterId, search }
      : reporterId !== null
        ? { reporterId }
        : search !== null
          ? { search }
          : {};
  const merged: ListAllReportsOptions = { ...base, ...extra };
  return merged;
}

export async function listMyReportsRoute(
  req: Request,
  url: string | URL,
): Promise<ReportListResult> {
  const user = await requireUser(req);
  const options = parseMyReportsQuery(url);
  const conn = getDb();
  try {
    return await repoListMyReports(conn.db, user.id, options);
  } finally {
    await conn.close().catch(() => undefined);
  }
}

export async function listAllReportsRoute(
  req: Request,
  url: string | URL,
): Promise<ReportListResult> {
  await requireAdmin(req);
  const options = parseAdminReportsQuery(url);
  const conn = getDb();
  try {
    return await repoListAllReports(conn.db, options);
  } finally {
    await conn.close().catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Detail + timeline (ticket-or-UUID references).
// ---------------------------------------------------------------------------

export async function getMyReportRoute(req: Request, ref: string): Promise<ReportDetail> {
  const user = await requireUser(req);
  const conn = getDb();
  try {
    const id = await resolveReportId(conn.db, user.id, ref);
    return await repoGetMyReportDetail(conn.db, user.id, id);
  } finally {
    await conn.close().catch(() => undefined);
  }
}

// RAW `report_events` rows (Phase 5 sanitizes; reporter UI must render a
// safe subset only).
export async function getMyTimelineRoute(
  req: Request,
  ref: string,
): Promise<{ readonly events: ReportTimelineEntry[] }> {
  const user = await requireUser(req);
  const conn = getDb();
  try {
    const id = await resolveReportId(conn.db, user.id, ref);
    const events = await repoGetMyReportTimeline(conn.db, user.id, id);
    return { events };
  } finally {
    await conn.close().catch(() => undefined);
  }
}

export async function getAdminReportRoute(req: Request, ref: string): Promise<ReportDetail> {
  await requireAdmin(req);
  const conn = getDb();
  try {
    const id = await resolveReportId(conn.db, null, ref);
    return await repoGetAdminReportDetail(conn.db, id);
  } finally {
    await conn.close().catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Form options (reporter-facing master-data subset).
// ---------------------------------------------------------------------------

export interface LocationOption {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly type: string;
  readonly parentId: string | null;
  readonly buildingCode: string | null;
  readonly floorNumber: number | null;
  readonly usageTier: string | null;
  readonly tierScore: number | null;
}

export interface CategoryOption {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly weight: number;
}

export interface IssueTypeOption {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly categoryId: string | null;
}

export interface AssetOption {
  readonly id: string;
  readonly assetCode: string;
  readonly name: string;
  readonly categoryId: string | null;
  readonly locationId: string | null;
  readonly weight: number;
}

export interface FormOptions {
  readonly locations: LocationOption[];
  readonly categories: CategoryOption[];
  readonly issueTypes: IssueTypeOption[];
  readonly assets: AssetOption[];
}

// Reporter-visible locations: active rows EXCLUDING `reporterHidden` (lift
// rooms). Exported for unit tests.
export function isReporterVisibleLocation(row: Location): boolean {
  return row.isActive && !row.reporterHidden;
}

// Small-payload projections: id/code/name + parent links + tier/weight
// display fields only — no timestamps, no quantities, no descriptions, no
// PII. Exported for unit tests.
export function toLocationOption(row: Location): LocationOption {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    type: row.type,
    parentId: row.parentId,
    buildingCode: row.buildingCode,
    floorNumber: row.floorNumber,
    usageTier: row.usageTier,
    tierScore: row.tierScore,
  };
}

export function toCategoryOption(row: FacilityCategory): CategoryOption {
  return { id: row.id, code: row.code, name: row.name, weight: row.weight };
}

export function toIssueTypeOption(row: IssueType): IssueTypeOption {
  return { id: row.id, code: row.code, name: row.name, categoryId: row.categoryId };
}

export function toAssetOption(row: FacilityAsset): AssetOption {
  return {
    id: row.id,
    assetCode: row.assetCode,
    name: row.name,
    categoryId: row.categoryId,
    locationId: row.locationId,
    weight: row.weight,
  };
}

type ReportDb = Parameters<typeof repoListLocations>[0];

async function listAllPages<T>(
  db: ReportDb,
  page: (db: ReportDb, opts: { includeInactive: boolean; limit: number; offset: number }) => Promise<T[]>,
): Promise<T[]> {
  const out: T[] = [];
  let offset = 0;
  for (;;) {
    const rows = await page(db, { includeInactive: false, limit: 200, offset });
    out.push(...rows);
    if (rows.length < 200) {
      break;
    }
    offset += 200;
  }
  return out;
}

// Active-only master-data subset for the report form: locations exclude
// `reporterHidden`, assets carry their location/category codes for dependent
// filtering. Reporters and admins both use this (requireUser).
export async function listFormOptions(req: Request): Promise<FormOptions> {
  await requireUser(req);
  const conn = getDb();
  try {
    const locationRows = await listAllPages(conn.db, repoListLocations);
    const categoryRows = await listAllPages(conn.db, repoListCategories);
    const issueTypeRows = await listAllPages(conn.db, repoListIssueTypes);
    const assetRows = await listAllPages(conn.db, repoListAssets);
    return {
      locations: locationRows.filter(isReporterVisibleLocation).map(toLocationOption),
      categories: categoryRows.map(toCategoryOption),
      issueTypes: issueTypeRows.map(toIssueTypeOption),
      assets: assetRows.map(toAssetOption),
    };
  } finally {
    await conn.close().catch(() => undefined);
  }
}
