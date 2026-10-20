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
// - Missing/unresolvable report refs use the repo's exact
//   `'Report not found'` message. Reporter detail is campus-wide and
//   sanitized, so a foreign ticket is a normal 200; only attachments remain
//   owner/admin-only.
// - `getMyTimelineRoute` returns SANITIZED `TimelineEntry` rows (Phase 5
//   reporter projection: no INTERNAL updates/notes, no actor/author PII);
//   the reporter UI renders labels + timestamps only.
// - Rate limiting is intentionally NOT applied here: the login rate-limit
//   helper is login-specific (username+IP key) and not trivially reusable;
//   Phase 9 owns report-creation rate limits.
// - The only logging here is one opaque AI-outcome line per submit; routes
//   log with opaque IDs.

import { and, eq, sql } from 'drizzle-orm';
import {
  applyVerification as repoApplyVerification,
  countAffectedReporters as repoCountAffectedReporters,
  createReport as repoCreateReport,
  findDuplicateCandidates as repoFindDuplicateCandidates,
  findReportByKey as repoFindReportByKey,
  getAdminReportDetail as repoGetAdminReportDetail,
  getAsset as repoGetAsset,
  getCampusReportDetail as repoGetCampusReportDetail,
  getCampusReportStats as repoGetCampusReportStats,
  getDb,
  getLocation as repoGetLocation,
  getMyReportDetail as repoGetMyReportDetail,
  getReporterTimeline as repoGetReporterTimeline,
  listAllReports as repoListAllReports,
  listAssets as repoListAssets,
  listCampusReports as repoListCampusReports,
  listCategories as repoListCategories,
  listIssueTypes as repoListIssueTypes,
  listLocations as repoListLocations,
  listMyReports as repoListMyReports,
  maintenanceReports,
  markAiAnalysis as repoMarkAiAnalysis,
  linkStagedUploads as repoLinkStagedUploads,
  deleteStagedUploads as repoDeleteStagedUploads,
  outboxEvents,
  recordAiAnalysis as repoRecordAiAnalysis,
  type CreateReportInput,
  type CreateReportResult,
  type DuplicateCandidate,
  type FacilityAsset,
  type FacilityCategory,
  type IssueType,
  type AdminReportDetail,
  type CampusReportDetail,
  type CampusReportStats,
  type CampusReportListResult,
  type ListAllReportsOptions,
  type ListCampusReportsOptions,
  type ListMyReportsOptions,
  type Location,
  type Report,
  type ReportDetail,
  type ReportListResult,
  type ReportQueryDb,
  type SupportingRelationRef,
  type TimelineEntry,
} from '@silapor/database';
import { mapAiVerdict, scorePriority } from '@silapor/domain';
import {
  PROMPT_VERSION,
  SCHEMA_VERSION,
  verifyReport as aiVerifyReport,
  type VerifyMeta,
} from '@silapor/ai';
import {
  badRequest,
  conflict,
  createLogger,
  getRuntimeConfig,
  internal,
  isAppError,
  notFound,
} from '@silapor/shared';
import {
  createAttachmentStorage,
  prepareVisionImage,
  type AttachmentStorage,
} from '@silapor/storage';
import { requireAdmin, requireUser } from './auth';
import { removeStagedObjects, resolveStagedPhotoKeys } from './uploads.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const logger = createLogger({ service: 'web' });

// Single 404 message shared by every report lookup path (ticket miss, UUID
// miss, foreign row, invalid reference) — identical bodies by construction.
// Exported for the attachment service (P4-3), which must reuse the exact
// constant so reporter→foreign and missing references stay byte-identical.
export const REPORT_NOT_FOUND_MESSAGE = 'Report not found';

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
// Ticket lookups are scoped to `reporterId` when non-null (own-report paths:
// resolve-then-check, foreign ticket → identical 404); campus and admin
// routes pass null (unscoped). Invalid UUIDs → 404, not 500.
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
// priority&from&to&limit&offset&sort&mine&search). `mine=1|true` selects the
// "Laporan Saya" filter; absence means the whole campus. `search` (or the
// legacy `q` alias) matches ticket number, asset name, or location name.
export function parseMyReportsQuery(url: string | URL): ListMyReportsOptions {
  return parseBaseListQuery(searchParamsOf(url));
}

export function parseCampusReportsQuery(url: string | URL): ListCampusReportsOptions {
  const params = searchParamsOf(url);
  const base = parseBaseListQuery(params);
  const mine = queryParam(params, ['mine']);
  const search = queryParam(params, ['search', 'q']);
  const extra: ListCampusReportsOptions =
    search !== null ? { search } : {};
  return {
    ...base,
    ...extra,
    ...(mine === '1' || mine === 'true' ? { mine: true } : {}),
  };
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

// Campus-wide list for any authenticated reporter (UI No. 5). The session
// user is only used for the `mine` filter and the per-row `isOwn` badge;
// no client-supplied reporter id is accepted.
export async function listCampusReportsRoute(
  req: Request,
  url: string | URL,
): Promise<CampusReportListResult> {
  const user = await requireUser(req);
  const options = parseCampusReportsQuery(url);
  const conn = getDb();
  try {
    return await repoListCampusReports(conn.db, user.id, options);
  } finally {
    await conn.close().catch(() => undefined);
  }
}

// KPI counters for the reporter landing page. Auth-only: the campus-wide
// totals are already visible through the sanitized campus list, so this adds
// no new data class. `mineTotal` is scoped from the session user.
export async function getReporterStatsRoute(req: Request): Promise<CampusReportStats> {
  const user = await requireUser(req);
  const conn = getDb();
  try {
    return await repoGetCampusReportStats(conn.db, user.id);
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

// Campus-wide reporter detail (UI No. 5). Ticket refs resolve unscoped;
// the repo returns 404 only when the ticket is genuinely missing and
// sanitizes another reporter's view (no identity/technician/attachments).
export async function getCampusReportRoute(req: Request, ref: string): Promise<CampusReportDetail> {
  const user = await requireUser(req);
  const conn = getDb();
  try {
    const id = await resolveReportId(conn.db, null, ref);
    return await repoGetCampusReportDetail(conn.db, user.id, id);
  } finally {
    await conn.close().catch(() => undefined);
  }
}

// SANITIZED reporter timeline (Phase 5): all progress notes are visible;
// actor/author PII is stripped and LAPORAN_PALSU is projected to neutral
// text — safe to ship verbatim.
export async function getMyTimelineRoute(
  req: Request,
  ref: string,
): Promise<{ readonly events: TimelineEntry[] }> {
  const user = await requireUser(req);
  const conn = getDb();
  try {
    const id = await resolveReportId(conn.db, user.id, ref);
    const events = await repoGetReporterTimeline(conn.db, id, user.id);
    return { events };
  } finally {
    await conn.close().catch(() => undefined);
  }
}

export async function getAdminReportRoute(req: Request, ref: string): Promise<AdminReportDetail> {
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
  page: (
    db: ReportDb,
    opts: { includeInactive: boolean; limit: number; offset: number },
  ) => Promise<T[]>,
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

// ---------------------------------------------------------------------------
// AI-verified submit (synchronous verify with held fallback).
// ---------------------------------------------------------------------------

export interface VerifiedSubmitBody {
  readonly locationId: string;
  readonly assetId: string;
  readonly description: string;
  readonly photoKeys: readonly string[];
}

// The reporter never classifies: any category/issue/occurredAt key is a 400,
// whether camelCase or snake_case.
const CLASSIFICATION_FIELDS = [
  'submittedCategoryId',
  'submitted_category_id',
  'categoryId',
  'category_id',
  'submittedIssueTypeId',
  'submitted_issue_type_id',
  'issueTypeId',
  'issue_type_id',
  'occurredAt',
  'occurred_at',
] as const;

// New submit shape: location + asset required, description 10-2000, photo
// storage-key references min 1 max 3. NEVER copies a client-supplied
// reporter id — the caller sets it from the session.
export function normalizeVerifiedSubmitBody(body: unknown): VerifiedSubmitBody {
  if (!isRecord(body)) {
    throw badRequest('Invalid report input');
  }
  for (const field of CLASSIFICATION_FIELDS) {
    if (body[field] !== undefined) {
      throw badRequest(`${field} must not be provided`);
    }
  }
  const locationId = body['locationId'] ?? body['location_id'];
  if (typeof locationId !== 'string' || !UUID_RE.test(locationId)) {
    throw badRequest('locationId must be a valid UUID');
  }
  const assetId = body['assetId'] ?? body['asset_id'];
  if (typeof assetId !== 'string' || !UUID_RE.test(assetId)) {
    throw badRequest('assetId must be a valid UUID');
  }
  const description = body['description'];
  if (typeof description !== 'string' || description.trim().length < 10) {
    throw badRequest('description must be at least 10 characters');
  }
  if (description.trim().length > 2000) {
    throw badRequest('description must be at most 2000 characters');
  }
  const photoKeys = body['photoKeys'] ?? body['photo_keys'];
  if (
    !Array.isArray(photoKeys) ||
    photoKeys.length < 1 ||
    photoKeys.length > 3 ||
    photoKeys.some((key) => typeof key !== 'string' || key.trim() === '')
  ) {
    throw badRequest('photoKeys must include 1 to 3 photos');
  }
  return {
    locationId,
    assetId,
    description: description.trim(),
    photoKeys: (photoKeys as string[]).map((key) => key.trim()),
  };
}

// The Task 2 mapping is imported from `@silapor/domain` (`mapAiVerdict`) so
// the submit path and any other consumer share one hand-sync risk instead of
// a third copy drifting silently.

const REPORTER_REASONS: Record<string, string> = {
  INVALID_INPUT:
    'We could not verify this report. Please check the photos and description, then try again.',
  UNKNOWN_MODEL:
    'Verification is unavailable right now. Your report was not saved. Please try again later.',
  UPSTREAM_REJECTED:
    'The verification service could not process this report. It was not saved. Please try again later.',
  UNCLEAR_EVIDENCE:
    'The photos or description were not clear enough to verify. Please add clearer photos and more detail, then try again.',
  WRONG_ASSET:
    'The photos do not seem to show the selected asset. Please check the asset and photos, then try again.',
  UNKNOWN_CODE:
    'We could not classify this report. Please try again with clearer photos and description.',
};

// Machine codes never reach the reporter — FAIL bodies carry plain language only.
export function toReporterReason(code: string): string {
  return REPORTER_REASONS[code] ?? 'We could not verify this report. Please try again later.';
}

export interface SubmitVerifyInput {
  readonly description: string;
  readonly asset: { readonly name: string; readonly category: string };
  readonly photos: readonly string[];
  readonly categories: readonly string[];
  readonly issueTypes: readonly string[];
}

export type SubmitVerifyOutcome =
  | {
      readonly kind: 'PASS';
      readonly category: string;
      readonly issueType: string;
      readonly priority: string;
      readonly confidence: number;
      readonly reasons: readonly string[];
      readonly model: string;
      readonly promptVersion: string;
      readonly schemaVersion: string;
      readonly meta?: VerifyMeta;
      readonly reasoningSummary?: string;
    }
  | {
      readonly kind: 'FAIL';
      readonly reason: string;
      readonly model?: string;
      readonly meta?: VerifyMeta;
      readonly reasoningSummary?: string;
    }
  | { readonly kind: 'DOWN' };

export type SubmitVerifyFn = (
  input: SubmitVerifyInput,
  opts: {
    readonly timeoutMs: number;
    readonly model?: string;
    readonly apiKey?: string;
    readonly storage?: AttachmentStorage;
  },
) => Promise<SubmitVerifyOutcome>;

export interface SubmitVerifyDeps {
  readonly verify?: SubmitVerifyFn;
  readonly timeoutMs?: number;
  readonly model?: string;
  readonly apiKey?: string;
  readonly storage?: AttachmentStorage;
}

export type SubmitVerifiedResult =
  | {
      readonly status: 201;
      readonly ticketNumber: string;
      readonly report: Report;
      readonly verification: {
        readonly status: 'VERIFIED';
        readonly category: string;
        readonly issueType: string;
        readonly priority: string;
        readonly confidence: number;
      };
      readonly relation: SupportingRelationRef | null;
      readonly duplicateCandidates: DuplicateCandidate[];
    }
  | {
      readonly status: 200;
      readonly ticketNumber: string;
      readonly report: Report;
      readonly idempotentReplay: true;
      readonly verification: { readonly status: string };
    }
  | {
      readonly status: 202;
      readonly ticketNumber: string;
      readonly report: Report;
      readonly analysisId: string;
      readonly message: string;
      readonly verification: { readonly status: 'HELD' };
    }
  | {
      // Auto-merged as SUPPORTING evidence into another reporter's active
      // ticket at submit: the row + relation stay for audit, verification is
      // deliberately skipped in favor of the target's.
      readonly status: 201;
      readonly ticketNumber: string;
      readonly report: Report;
      readonly relation: SupportingRelationRef;
      readonly duplicateCandidates: DuplicateCandidate[];
      readonly message: string;
      readonly verification: { readonly status: 'MERGED' };
    }
  | { readonly status: 422; readonly reason: string };

// Timeout/model/key resolution uses the shared runtime config
// (AI_VERIFY_TIMEOUT_MS, OPENROUTER_MODEL, OPENROUTER_API_KEY) unless the
// caller overrides them; an empty model or key resolves to undefined. Empty
// values are deployment faults handled below (held), never reporter rejections.
// Direct process.env reads are forbidden here.
function resolveVerifyTimeoutMs(override?: number): number {
  if (override !== undefined && Number.isSafeInteger(override) && override > 0) {
    return override;
  }
  return getRuntimeConfig().aiVerifyTimeoutMs;
}

function resolveAiModel(override?: string): string | undefined {
  const configured = (override ?? getRuntimeConfig().openrouterModel).trim();
  return configured === '' ? undefined : configured;
}

function resolveAiApiKey(override?: string): string | undefined {
  const configured = (override ?? getRuntimeConfig().openrouterApiKey).trim();
  return configured === '' ? undefined : configured;
}

// Static dependency on `@silapor/ai` (no lazy-load fallback): the AI client
// itself classifies upstream errors into FAIL (deterministic) or DOWN
// (transient), so any unexpected throw only falls back to held, never
// rejected. Photos are resolved to bounded JPEG data URLs before the call —
// any storage or decode failure is a held submit, never a reporter rejection.
async function defaultSubmitVerify(
  input: SubmitVerifyInput,
  opts: {
    readonly timeoutMs: number;
    readonly model?: string;
    readonly apiKey?: string;
    readonly storage?: AttachmentStorage;
  },
): Promise<SubmitVerifyOutcome> {
  // An unconfigured API key is a deployment fault, not reporter evidence:
  // hold for admin (same ruling as an unconfigured model), never 422.
  if (opts.apiKey === undefined) {
    return { kind: 'DOWN' };
  }
  const storage = opts.storage ?? createAttachmentStorage();
  let photos: { storageKey: string; contentType: string; dataUrl: string }[];
  try {
    photos = [];
    for (const key of input.photos) {
      const loaded = await storage.get(key);
      if (loaded === null) {
        return { kind: 'DOWN' };
      }
      const prepared = await prepareVisionImage(loaded.bytes);
      photos.push({
        storageKey: key,
        contentType: prepared.mimeType,
        dataUrl: `data:${prepared.mimeType};base64,${Buffer.from(prepared.bytes).toString('base64')}`,
      });
    }
  } catch {
    return { kind: 'DOWN' };
  }
  try {
    return await aiVerifyReport(
      { ...input, photos },
      {
        timeoutMs: opts.timeoutMs,
        ...(opts.model === undefined ? {} : { model: opts.model }),
        apiKey: opts.apiKey,
      },
    );
  } catch {
    return { kind: 'DOWN' };
  }
}

// Walks the report's location chain into human labels for the verify prompt.
// Bounded to 4 hops and terminal on a root; a broken chain just yields fewer
// labels, never a failed submit.
async function locationLabels(
  db: Parameters<typeof repoGetLocation>[0],
  locationId: string,
): Promise<{ building?: string; floor?: string; room?: string }> {
  const labels: { building?: string; floor?: string; room?: string } = {};
  let current = await repoGetLocation(db, locationId);
  for (let hops = 0; current !== undefined && hops < 4; hops += 1) {
    if (current.type === 'BUILDING') labels.building = current.name;
    else if (current.type === 'FLOOR') labels.floor = current.name;
    else if (current.type === 'ROOM' || current.type === 'SHARED_AREA') labels.room = current.name;
    if (current.parentId == null) break;
    current = await repoGetLocation(db, current.parentId);
  }
  return labels;
}

function metaFields(meta?: VerifyMeta): {
  upstreamProvider?: string;
  gatewayRequestId?: string;
  inputTokens?: number;
  outputTokens?: number;
  estimatedCost?: number;
} {
  if (meta === undefined) return {};
  return {
    ...(meta.upstreamProvider === undefined ? {} : { upstreamProvider: meta.upstreamProvider }),
    ...(meta.gatewayRequestId === undefined ? {} : { gatewayRequestId: meta.gatewayRequestId }),
    ...(meta.inputTokens === undefined ? {} : { inputTokens: meta.inputTokens }),
    ...(meta.outputTokens === undefined ? {} : { outputTokens: meta.outputTokens }),
    ...(meta.estimatedCost === undefined ? {} : { estimatedCost: meta.estimatedCost }),
  };
}

// Stable FAIL codes the AI client can emit; any other FAIL reason is model
// free text and must never reach the log's machine-code field.
const VERIFY_FAIL_CODES: ReadonlySet<string> = new Set([
  'UPSTREAM_REJECTED',
  'INVALID_INPUT',
  'UNKNOWN_MODEL',
  'UNCLEAR_EVIDENCE',
]);

function logVerifyFailCode(reason: string): string {
  return VERIFY_FAIL_CODES.has(reason) ? reason : 'MODEL_VERDICT_FAIL';
}

type SubmitDb = Parameters<typeof repoCreateReport>[0];

// Removes a just-created submit and its submit-time side effects (events,
// relations, analyses cascade; the PENDING review outbox row is deleted
// explicitly) so a FAIL leaves no row and no ticket behind.
async function compensateFailedSubmit(db: SubmitDb, reportId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .delete(outboxEvents)
      .where(
        and(
          eq(outboxEvents.type, 'AI_REVIEW_REQUESTED'),
          sql`${outboxEvents.payload}->>'reportId' = ${reportId}`,
        ),
      );
    await tx.delete(maintenanceReports).where(eq(maintenanceReports.id, reportId));
  });
}

// The supporting-merged row is deliberately never verified (one verification
// per incident lives on the target ticket), so its PENDING review request is
// dropped — the queue worker would otherwise re-run the verification.
async function dropPendingAiReview(db: SubmitDb, reportId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .delete(outboxEvents)
      .where(
        and(
          eq(outboxEvents.type, 'AI_REVIEW_REQUESTED'),
          eq(outboxEvents.status, 'PENDING'),
          sql`${outboxEvents.payload}->>'reportId' = ${reportId}`,
        ),
      );
  });
}

const HELD_MESSAGE =
  'Verification is temporarily unavailable. Your report has been saved and is waiting for review.';

function mergedMessage(targetTicket: string): string {
  return `Report saved as additional evidence for ticket ${targetTicket}, which covers the same incident. Follow that ticket for updates.`;
}

function normalizeAiPriority(value: string): 'LOW' | 'MEDIUM' | 'HIGH' | undefined {
  const priority = value.trim().toUpperCase();
  if (priority === 'LOW' || priority === 'MEDIUM' || priority === 'HIGH') {
    return priority;
  }
  return undefined;
}

// Synchronous verified submit: duplicate-first create (a same-reporter
// active block throws DUPLICATE_ACTIVE before any AI call), inline verify,
// then PASS → VERIFIED + ticket (201), FAIL → 422 with no row left behind,
// DOWN → held REPORTED + ticket (202). A submit auto-merged as SUPPORTING
// evidence into another reporter's ticket skips the AI call entirely: its
// response (201 + MERGED) points the reporter at the target ticket and the
// row stays unverified outside the hand-verify queue. Idempotent replays
// skip AI.
export async function submitVerifiedReport(
  req: Request,
  body: unknown,
  idempotencyKey: string | null,
  deps?: SubmitVerifyDeps,
): Promise<SubmitVerifiedResult> {
  const user = await requireUser(req);
  const key = typeof idempotencyKey === 'string' ? idempotencyKey.trim() : '';
  if (key === '') {
    throw badRequest('Idempotency key is required');
  }
  const normalized = normalizeVerifiedSubmitBody(body);
  const timeoutMs = resolveVerifyTimeoutMs(deps?.timeoutMs);
  const model = resolveAiModel(deps?.model);
  const apiKey = resolveAiApiKey(deps?.apiKey);
  const verify = deps?.verify ?? defaultSubmitVerify;
  const conn = getDb();
  try {
    // Idempotency first (mirrors the create fast-path): a same-key retry
    // replays the prior ticket without touching staged keys, which the
    // first submit already claimed.
    const prior = await repoFindReportByKey(conn.db, key);
    if (prior !== undefined) {
      return {
        status: 200,
        ticketNumber: prior.ticketNumber,
        report: prior,
        idempotentReplay: true,
        verification: { status: prior.status },
      };
    }
    // Staged keys resolve before any row exists: unknown, foreign, claimed,
    // or expired keys fail with a uniform 400 and zero side effects (no
    // row, no ticket, no outbox event).
    const staged = await resolveStagedPhotoKeys(conn.db, user.id, normalized.photoKeys);
    const created = await repoCreateReport(
      conn.db,
      {
        reporterId: user.id,
        locationId: normalized.locationId,
        assetId: normalized.assetId,
        description: normalized.description,
      },
      key,
    );
    if (created.idempotentReplay) {
      return {
        status: 200,
        ticketNumber: created.report.ticketNumber,
        report: created.report,
        idempotentReplay: true,
        verification: { status: created.report.status },
      };
    }
    const report = created.report;
    // Auto-gabung: another reporter's active ticket already runs the one
    // verification for this incident, so the AI call and analysis row are
    // suppressed entirely — the row stays REPORTED linked SUPPORTING (kept
    // for audit, excluded from the hand-verify queue) with its photos
    // attached, and the reply reports the merge instead of a verdict.
    if (created.relation !== null) {
      await dropPendingAiReview(conn.db, report.id);
      await linkPhotosOrCompensate(report.id);
      return {
        status: 201,
        ticketNumber: report.ticketNumber,
        report,
        relation: created.relation,
        duplicateCandidates: created.duplicateCandidates,
        message: mergedMessage(created.relation.targetTicket),
        verification: { status: 'MERGED' },
      };
    }
    // FAIL cleanup deletes only this submitter's UNCLAIMED staged rows so a
    // concurrent submit's keys are never touched, then removes the storage
    // objects whose rows were deleted (best-effort; the TTL janitor
    // backstops a removal failure). The 422 stands either way.
    async function discardStagedPhotos(): Promise<void> {
      try {
        const deleted = await repoDeleteStagedUploads(conn.db, user.id, [...normalized.photoKeys]);
        const storage = deps?.storage ?? createAttachmentStorage();
        await removeStagedObjects(storage, [...deleted]);
      } catch {
        // Janitor backstop — never flips the verdict.
      }
    }
    // A link conflict means another submit claimed the same keys first:
    // drop this report (the keys belong to the winning report, so staged
    // rows stay untouched) and surface the 409.
    async function linkPhotosOrCompensate(reportId: string): Promise<void> {
      try {
        await repoLinkStagedUploads(conn.db, {
          reportId,
          staged,
          uploadedBy: user.id,
        });
      } catch (error) {
        if (isAppError(error) && error.code === 'CONFLICT') {
          await compensateFailedSubmit(conn.db, reportId).catch(() => undefined);
        }
        throw error;
      }
    }
    const analysis = await repoRecordAiAnalysis(conn.db, {
      reportId: report.id,
      model: model ?? 'unpinned',
      promptVersion: PROMPT_VERSION,
      schemaVersion: SCHEMA_VERSION,
    });
    const assetId = report.assetId;
    if (assetId === null) {
      throw internal('Report has no asset');
    }
    const asset = await repoGetAsset(conn.db, assetId);
    const categories = await listAllPages(conn.db, repoListCategories);
    const issueTypes = await listAllPages(conn.db, repoListIssueTypes);
    const assetCategory = categories.find((entry) => entry.id === asset?.categoryId);
    if (asset === undefined || assetCategory === undefined) {
      throw internal('Report asset is not usable');
    }
    const labels = await locationLabels(conn.db, report.locationId);
    const verifyStartedAt = Date.now();
    const outcome = await verify(
      {
        description: normalized.description,
        asset: { name: asset.name, category: assetCategory.code, ...labels },
        photos: [...normalized.photoKeys],
        categories: categories.map((entry) => entry.code),
        issueTypes: issueTypes.map((entry) => entry.code),
      },
      {
        timeoutMs,
        ...(model === undefined ? {} : { model }),
        ...(apiKey === undefined ? {} : { apiKey }),
        ...(deps?.storage === undefined ? {} : { storage: deps.storage }),
      },
    );
    const verifyMeta = outcome.kind === 'DOWN' ? undefined : outcome.meta;
    logger.info('ai verification outcome', {
      route: 'POST /api/reports',
      result: outcome.kind,
      ...(outcome.kind === 'FAIL' ? { code: logVerifyFailCode(outcome.reason) } : {}),
      durationMs: Date.now() - verifyStartedAt,
      ...(verifyMeta === undefined
        ? {}
        : {
            details: {
              model,
              requestId: verifyMeta.gatewayRequestId,
              provider: verifyMeta.upstreamProvider,
              usage: { input: verifyMeta.inputTokens, output: verifyMeta.outputTokens },
              costUsd: verifyMeta.estimatedCost,
            },
          }),
    });
    // DOWN is transient (timeout/5xx/429): hold the REPORTED row with its
    // PENDING analysis for manual verification instead of rejecting it.
    // Staged photos link first so the held ticket carries them.
    if (outcome.kind === 'DOWN') {
      await linkPhotosOrCompensate(report.id);
      return {
        status: 202,
        ticketNumber: report.ticketNumber,
        report,
        analysisId: analysis.id,
        message: HELD_MESSAGE,
        verification: { status: 'HELD' },
      };
    }
    if (outcome.kind === 'FAIL') {
      // Gateway-side failures are infrastructure outcomes, not verdicts about
      // the evidence: no `verdict` mark for those.
      const hasModelVerdict =
        outcome.reason !== 'UPSTREAM_REJECTED' &&
        outcome.reason !== 'INVALID_INPUT' &&
        outcome.reason !== 'UNKNOWN_MODEL';
      await repoMarkAiAnalysis(conn.db, analysis.id, {
        status: 'FAILED',
        errorCode: outcome.reason,
        ...(hasModelVerdict ? { verdict: 'FAIL' } : {}),
        ...(outcome.reasoningSummary === undefined ? {} : { reason: outcome.reasoningSummary }),
        ...metaFields(outcome.meta),
      });
      await discardStagedPhotos();
      await compensateFailedSubmit(conn.db, report.id);
      return { status: 422, reason: toReporterReason(outcome.reason) };
    }
    const mapped = mapAiVerdict({
      impliedCategory: outcome.category,
      assetCategory: assetCategory.code,
      category: outcome.category,
      issueType: outcome.issueType,
      priority: outcome.priority,
      categories: categories.map((entry) => entry.code),
      issueTypes: issueTypes.map((entry) => entry.code),
    });
    if (!mapped.ok) {
      await repoMarkAiAnalysis(conn.db, analysis.id, {
        status: 'FAILED',
        errorCode: mapped.reason,
      });
      await discardStagedPhotos();
      await compensateFailedSubmit(conn.db, report.id);
      return { status: 422, reason: toReporterReason(mapped.reason) };
    }
    const finalCategory = categories.find((entry) => entry.code === mapped.categoryCode);
    const finalIssue = issueTypes.find((entry) => entry.code === mapped.issueTypeCode);
    if (
      finalCategory === undefined ||
      finalIssue === undefined ||
      finalCategory.id !== report.submittedCategoryId ||
      (finalIssue.categoryId !== null && finalIssue.categoryId !== finalCategory.id)
    ) {
      await repoMarkAiAnalysis(conn.db, analysis.id, {
        status: 'FAILED',
        errorCode: 'WRONG_ASSET',
      });
      await discardStagedPhotos();
      await compensateFailedSubmit(conn.db, report.id);
      return { status: 422, reason: toReporterReason('WRONG_ASSET') };
    }
    const location = await repoGetLocation(conn.db, report.locationId);
    let affected = 1;
    try {
      affected = await repoCountAffectedReporters(conn.db, {
        assetId: report.assetId,
        locationId: report.locationId,
        categoryId: finalCategory.id,
        issueTypeId: finalIssue.id,
      });
    } catch {
      affected = 1;
    }
    const score = scorePriority({
      categoryWeight: finalCategory.weight,
      assetWeight: asset.weight,
      locationScore: location?.tierScore ?? null,
      affectedReporters: affected,
      issueTypeCode: finalIssue.code,
    });
    let finalPriority = normalizeAiPriority(mapped.priority) ?? score.suggestedPriority;
    if (finalIssue.code === 'DANGEROUS' && finalPriority !== 'HIGH') {
      finalPriority = 'HIGH';
    }
    const verified = await repoApplyVerification(
      conn.db,
      report.id,
      {
        finalCategoryId: finalCategory.id,
        finalIssueTypeId: finalIssue.id,
        finalPriority,
      },
      user.id,
      'AI',
    );
    const snapped = await conn.db
      .update(maintenanceReports)
      .set({
        priorityScore: score.score,
        priorityFactors: { ...score.factors, scoringComplete: score.scoringComplete },
        scoringConfigVersion: score.scoringConfigVersion,
        version: verified.version + 1,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(maintenanceReports.id, verified.id),
          eq(maintenanceReports.version, verified.version),
        ),
      )
      .returning();
    const finalRow = snapped[0];
    if (finalRow === undefined) {
      // The row changed between verification and the snapshot — same mutating
      // race as the FAIL path: mark the analysis failed, drop the staged
      // leftovers, remove the row, and surface the conflict.
      await repoMarkAiAnalysis(conn.db, analysis.id, {
        status: 'FAILED',
        errorCode: 'CONFLICT',
      });
      await discardStagedPhotos();
      await compensateFailedSubmit(conn.db, report.id);
      throw conflict('Report was modified during verification; please try again');
    }
    // Photos link atomically with the claim before the analysis is marked,
    // so SUCCEEDED always means verified plus linked.
    await linkPhotosOrCompensate(finalRow.id);
    await repoMarkAiAnalysis(conn.db, analysis.id, {
      status: 'SUCCEEDED',
      verdict: 'PASS',
      category: mapped.categoryCode,
      issueType: mapped.issueTypeCode,
      priority: finalPriority,
      confidence: outcome.confidence,
      ...(outcome.reasoningSummary === undefined ? {} : { reason: outcome.reasoningSummary }),
      ...(outcome.model.trim() === '' ? {} : { model: outcome.model }),
      promptVersion: outcome.promptVersion.trim() === '' ? PROMPT_VERSION : outcome.promptVersion,
      schemaVersion: outcome.schemaVersion.trim() === '' ? SCHEMA_VERSION : outcome.schemaVersion,
      ...metaFields(outcome.meta),
    });
    return {
      status: 201,
      ticketNumber: finalRow.ticketNumber,
      report: finalRow,
      verification: {
        status: 'VERIFIED',
        category: mapped.categoryCode,
        issueType: mapped.issueTypeCode,
        priority: finalPriority,
        confidence: outcome.confidence,
      },
      relation: created.relation,
      duplicateCandidates: created.duplicateCandidates,
    };
  } finally {
    await conn.close().catch(() => undefined);
  }
}
