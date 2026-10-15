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
// - `getMyTimelineRoute` returns SANITIZED `TimelineEntry` rows (Phase 5
//   reporter projection: no INTERNAL updates/notes, no actor/author PII);
//   the reporter UI renders labels + timestamps only.
// - Rate limiting is intentionally NOT applied here: the login rate-limit
//   helper is login-specific (username+IP key) and not trivially reusable;
//   Phase 9 owns report-creation rate limits.
// - This module logs nothing — routes log with opaque IDs.

import { and, eq, sql } from 'drizzle-orm';
import {
  applyVerification as repoApplyVerification,
  countAffectedReporters as repoCountAffectedReporters,
  createReport as repoCreateReport,
  findDuplicateCandidates as repoFindDuplicateCandidates,
  getAdminReportDetail as repoGetAdminReportDetail,
  getAsset as repoGetAsset,
  getDb,
  getIssueType as repoGetIssueType,
  getLocation as repoGetLocation,
  getMyReportDetail as repoGetMyReportDetail,
  getReporterTimeline as repoGetReporterTimeline,
  listAllReports as repoListAllReports,
  listAssets as repoListAssets,
  listCategories as repoListCategories,
  listIssueTypes as repoListIssueTypes,
  listLocations as repoListLocations,
  listMyReports as repoListMyReports,
  maintenanceReports,
  markAiAnalysis as repoMarkAiAnalysis,
  outboxEvents,
  recordAiAnalysis as repoRecordAiAnalysis,
  type CreateReportInput,
  type CreateReportResult,
  type DuplicateCandidate,
  type FacilityAsset,
  type FacilityCategory,
  type IssueType,
  type ListAllReportsOptions,
  type ListMyReportsOptions,
  type Location,
  type Report,
  type ReportDetail,
  type ReportListResult,
  type ReportQueryDb,
  type SupportingRelationRef,
  type TimelineEntry,
} from '@silapor/database';
import { scorePriority } from '@silapor/domain';
import { badRequest, internal, notFound } from '@silapor/shared';
import { requireAdmin, requireUser } from './auth';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

// SANITIZED reporter timeline (Phase 5 P5-5): INTERNAL updates/notes and
// actor/author PII are stripped by the repo — safe to ship verbatim.
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

export interface SubmitAiVerdictInput {
  readonly impliedCategory: string;
  readonly assetCategory: string;
  readonly category: string;
  readonly issueType: string;
  readonly priority: string;
  readonly categories: readonly string[];
  readonly issueTypes: readonly string[];
}

export type SubmitAiVerdict =
  | { ok: true; categoryCode: string; issueTypeCode: string; priority: string }
  | { ok: false; reason: 'WRONG_ASSET' | 'UNCLEAR_EVIDENCE' | 'UNKNOWN_CODE' };

// Local copy of the Task 2 mapping (kept in sync by hand: `@silapor/domain`
// does not export `mapAiVerdict`, and this package must not deep-import it).
export function mapSubmitAiVerdict(input: SubmitAiVerdictInput): SubmitAiVerdict {
  const raw = (input ?? {}) as unknown as Partial<Record<string, unknown>>;
  const implied =
    typeof raw['impliedCategory'] === 'string' ? (raw['impliedCategory'] as string).trim() : '';
  if (implied === '') {
    return { ok: false, reason: 'UNCLEAR_EVIDENCE' };
  }
  if (
    typeof raw['assetCategory'] !== 'string' ||
    typeof raw['category'] !== 'string' ||
    typeof raw['issueType'] !== 'string'
  ) {
    return { ok: false, reason: 'UNKNOWN_CODE' };
  }
  const assetCategory = (raw['assetCategory'] as string).trim();
  const category = (raw['category'] as string).trim();
  const issueType = (raw['issueType'] as string).trim();
  const priority =
    typeof raw['priority'] === 'string' ? (raw['priority'] as string).trim() : input.priority;
  if (
    !input.categories.includes(implied) ||
    !input.categories.includes(assetCategory) ||
    !input.categories.includes(category) ||
    !input.issueTypes.includes(issueType)
  ) {
    return { ok: false, reason: 'UNKNOWN_CODE' };
  }
  if (implied !== assetCategory) {
    return { ok: false, reason: 'WRONG_ASSET' };
  }
  return { ok: true, categoryCode: category, issueTypeCode: issueType, priority };
}

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
    }
  | { readonly kind: 'FAIL'; readonly reason: string; readonly model?: string }
  | { readonly kind: 'DOWN' };

export type SubmitVerifyFn = (
  input: SubmitVerifyInput,
  opts: { readonly timeoutMs: number; readonly model?: string },
) => Promise<SubmitVerifyOutcome>;

export interface SubmitVerifyDeps {
  readonly verify?: SubmitVerifyFn;
  readonly timeoutMs?: number;
  readonly model?: string;
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
  | { readonly status: 422; readonly reason: string };

const DEFAULT_VERIFY_TIMEOUT_MS = 10_000;

function resolveVerifyTimeoutMs(override?: number): number {
  if (override !== undefined && Number.isSafeInteger(override) && override > 0) {
    return override;
  }
  const fromEnv = Number.parseInt(process.env['AI_VERIFY_TIMEOUT_MS'] ?? '', 10);
  if (Number.isSafeInteger(fromEnv) && fromEnv > 0) {
    return fromEnv;
  }
  return DEFAULT_VERIFY_TIMEOUT_MS;
}

function resolveAiModel(override?: string): string | undefined {
  const configured = (override ?? process.env['OPENROUTER_MODEL'] ?? '').trim();
  return configured === '' ? undefined : configured;
}

// The AI client is an optional runtime peer: when it cannot be loaded the
// submit is held for manual review rather than rejected.
async function defaultSubmitVerify(
  input: SubmitVerifyInput,
  opts: { readonly timeoutMs: number; readonly model?: string },
): Promise<SubmitVerifyOutcome> {
  const specifier = '@silapor/ai';
  try {
    const mod = (await import(/* @vite-ignore */ specifier)) as {
      verifyReport?: unknown;
    };
    if (typeof mod.verifyReport !== 'function') {
      return { kind: 'DOWN' };
    }
    return await (mod.verifyReport as SubmitVerifyFn)(input, {
      timeoutMs: opts.timeoutMs,
      ...(opts.model === undefined ? {} : { model: opts.model }),
    });
  } catch {
    return { kind: 'DOWN' };
  }
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

const HELD_MESSAGE =
  'Verification is temporarily unavailable. Your report has been saved and is waiting for review.';

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
// DOWN → held REPORTED + ticket (202). Idempotent replays skip AI.
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
  const verify = deps?.verify ?? defaultSubmitVerify;
  const conn = getDb();
  try {
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
    const analysis = await repoRecordAiAnalysis(conn.db, {
      reportId: report.id,
      model: model ?? 'unpinned',
      promptVersion: 'v1',
      schemaVersion: 'v1',
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
    const outcome = await verify(
      {
        description: normalized.description,
        asset: { name: asset.name, category: assetCategory.code },
        photos: [...normalized.photoKeys],
        categories: categories.map((entry) => entry.code),
        issueTypes: issueTypes.map((entry) => entry.code),
      },
      { timeoutMs, ...(model === undefined ? {} : { model }) },
    );
    // DOWN is transient (timeout/5xx/429): hold the REPORTED row with its
    // PENDING analysis for manual verification instead of rejecting it.
    if (outcome.kind === 'DOWN') {
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
      await repoMarkAiAnalysis(conn.db, analysis.id, {
        status: 'FAILED',
        errorCode: outcome.reason,
      });
      await compensateFailedSubmit(conn.db, report.id);
      return { status: 422, reason: toReporterReason(outcome.reason) };
    }
    const mapped = mapSubmitAiVerdict({
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
      .where(eq(maintenanceReports.id, verified.id))
      .returning();
    const finalRow = snapped[0] ?? verified;
    await repoMarkAiAnalysis(conn.db, analysis.id, {
      status: 'SUCCEEDED',
      category: mapped.categoryCode,
      issueType: mapped.issueTypeCode,
      priority: finalPriority,
      confidence: outcome.confidence,
      ...(outcome.model.trim() === '' ? {} : { model: outcome.model }),
      promptVersion: outcome.promptVersion.trim() === '' ? 'v1' : outcome.promptVersion,
      schemaVersion: outcome.schemaVersion.trim() === '' ? 'v1' : outcome.schemaVersion,
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
