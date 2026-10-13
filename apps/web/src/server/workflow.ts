// Admin workflow server transport (Phase 5 P5-5): thin wrappers over the
// `@silapor/database` workflow mutations for the admin API routes.
//
// Thin by contract (mirrors `./reports.ts`): every function guards via
// `requireAdmin` from `./auth` (defense in depth — routes guard too), opens
// one database connection, resolves the ticket-or-UUID `ref` with
// `resolveReportId` (null scope — admin routes are unscoped), delegates to
// the matching repo mutation with `{ actorId, requestId }` (requestId from
// the route's `withRequestId()` context), and closes the connection. Repo
// `AppError`s propagate untouched for routes to map with `toHttpResponse`.
//
// Conventions:
// - Bodies accept camelCase + snake_case keys via the `copyField` pattern
//   (same helper shape as `normalizeCreateReportBody`); unknown shapes pass
//   through so repo validators — not this layer — produce the 400.
// - `expectedVersion` MUST be a present integer in every mutation body
//   (400 `'expectedVersion is required'` otherwise) — optimistic locking.
// - This module logs nothing — routes log with opaque refs.
import {
  addReportUpdate as repoAddReportUpdate,
  assignTechnician as repoAssignTechnician,
  getAdminTimeline as repoGetAdminTimeline,
  getDb,
  markDuplicate as repoMarkDuplicate,
  rejectReport as repoRejectReport,
  setFinalPriority as repoSetFinalPriority,
  transitionReport as repoTransitionReport,
  verifyReport as repoVerifyReport,
  type Report,
  type ReportUpdate,
  type TimelineEntry,
  type VerifyReportInput,
} from '@silapor/database';
import { badRequest, getRequestId } from '@silapor/shared';
import { requireAdmin } from './auth';
import { resolveReportId } from './reports.js';

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

// Every workflow mutation carries the row version the admin saw — the repo
// turns a stale version into 409. Non-integer (missing/string/float/null)
// versions are a client bug → 400 with a single shared message. Exported
// for unit tests.
export function requireExpectedVersion(body: unknown): number {
  const version = isRecord(body)
    ? (body['expectedVersion'] ?? body['expected_version'])
    : undefined;
  if (typeof version !== 'number' || !Number.isInteger(version)) {
    throw badRequest('expectedVersion is required');
  }
  return version;
}

function actorOf(userId: string): { readonly actorId: string; readonly requestId: string | null } {
  return { actorId: userId, requestId: getRequestId() ?? null };
}

// ---------------------------------------------------------------------------
// Body normalizers (pure — no DB, no auth; exported for unit tests).
// ---------------------------------------------------------------------------

export interface NormalizedVerify {
  readonly input: VerifyReportInput;
  readonly expectedVersion: number;
}

// Accepts camelCase + snake_case; missing fields pass through absent so the
// repo validators emit the 400 (this layer only guarantees the version).
export function normalizeVerifyBody(body: unknown): NormalizedVerify {
  const expectedVersion = requireExpectedVersion(body);
  if (!isRecord(body)) {
    throw badRequest('Invalid verification input');
  }
  const out: Record<string, unknown> = {};
  copyField(body, out, 'finalCategoryId', ['final_category_id']);
  copyField(body, out, 'finalIssueTypeId', ['final_issue_type_id']);
  copyField(body, out, 'assetId', ['asset_id']);
  copyField(body, out, 'locationId', ['location_id']);
  copyField(body, out, 'finalPriority', ['final_priority', 'priority']);
  copyField(body, out, 'overrideReason', ['override_reason']);
  copyField(body, out, 'affectedReporters', ['affected_reporters']);
  return { input: out as unknown as VerifyReportInput, expectedVersion };
}

export interface NormalizedReject {
  readonly reason: unknown;
  readonly expectedVersion: number;
}

export function normalizeRejectBody(body: unknown): NormalizedReject {
  const expectedVersion = requireExpectedVersion(body);
  if (!isRecord(body)) {
    throw badRequest('Invalid rejection input');
  }
  const out: Record<string, unknown> = {};
  copyField(body, out, 'reason', ['reject_reason', 'rejectReason', 'message']);
  return { reason: out['reason'], expectedVersion };
}

export interface NormalizedDuplicate {
  readonly canonicalRef: unknown;
  readonly expectedVersion: number;
}

export function normalizeDuplicateBody(body: unknown): NormalizedDuplicate {
  const expectedVersion = requireExpectedVersion(body);
  if (!isRecord(body)) {
    throw badRequest('Invalid duplicate input');
  }
  const out: Record<string, unknown> = {};
  copyField(body, out, 'canonicalRef', [
    'canonical_ref',
    'canonicalReportId',
    'canonical_report_id',
    'canonicalTicket',
    'canonical_ticket',
    'ticketNumber',
    'ticket_number',
    'ticket',
  ]);
  return { canonicalRef: out['canonicalRef'], expectedVersion };
}

export interface NormalizedPriority {
  readonly priority: unknown;
  readonly reason: unknown;
  readonly expectedVersion: number;
}

export function normalizePriorityBody(body: unknown): NormalizedPriority {
  const expectedVersion = requireExpectedVersion(body);
  if (!isRecord(body)) {
    throw badRequest('Invalid priority input');
  }
  const out: Record<string, unknown> = {};
  copyField(body, out, 'priority', ['finalPriority', 'final_priority']);
  copyField(body, out, 'reason', ['overrideReason', 'override_reason', 'message']);
  return { priority: out['priority'], reason: out['reason'], expectedVersion };
}

export interface NormalizedAssign {
  readonly technicianId: unknown;
  readonly reason: unknown;
  readonly expectedVersion: number;
}

export function normalizeAssignBody(body: unknown): NormalizedAssign {
  const expectedVersion = requireExpectedVersion(body);
  if (!isRecord(body)) {
    throw badRequest('Invalid assignment input');
  }
  const out: Record<string, unknown> = {};
  copyField(body, out, 'technicianId', ['technician_id', 'technician']);
  copyField(body, out, 'reason', ['note', 'message']);
  return { technicianId: out['technicianId'], reason: out['reason'], expectedVersion };
}

export interface NormalizedTransition {
  readonly nextStatus: unknown;
  readonly note: unknown;
  readonly expectedVersion: number;
}

export function normalizeTransitionBody(body: unknown): NormalizedTransition {
  const expectedVersion = requireExpectedVersion(body);
  if (!isRecord(body)) {
    throw badRequest('Invalid transition input');
  }
  const out: Record<string, unknown> = {};
  copyField(body, out, 'nextStatus', [
    'next_status',
    'status',
    'toStatus',
    'to_status',
    'targetStatus',
    'target_status',
  ]);
  copyField(body, out, 'note', ['message', 'reason']);
  return { nextStatus: out['nextStatus'], note: out['note'], expectedVersion };
}

export interface NormalizedUpdate {
  readonly visibility: unknown;
  readonly message: unknown;
  readonly expectedVersion: number;
}

export function normalizeUpdateBody(body: unknown): NormalizedUpdate {
  const expectedVersion = requireExpectedVersion(body);
  if (!isRecord(body)) {
    throw badRequest('Invalid update input');
  }
  const out: Record<string, unknown> = {};
  copyField(body, out, 'visibility', []);
  copyField(body, out, 'message', ['note', 'text', 'content']);
  return { visibility: out['visibility'], message: out['message'], expectedVersion };
}

// ---------------------------------------------------------------------------
// Admin route services (requireAdmin + resolve + delegate + close).
// ---------------------------------------------------------------------------

export async function verifyAdminReport(
  req: Request,
  ref: string,
  body: unknown,
): Promise<Report> {
  const user = await requireAdmin(req);
  const { input, expectedVersion } = normalizeVerifyBody(body);
  const conn = getDb();
  try {
    const id = await resolveReportId(conn.db, null, ref);
    return await repoVerifyReport(conn.db, id, input, expectedVersion, actorOf(user.id));
  } finally {
    await conn.close().catch(() => undefined);
  }
}

export async function rejectAdminReport(
  req: Request,
  ref: string,
  body: unknown,
): Promise<Report> {
  const user = await requireAdmin(req);
  const { reason, expectedVersion } = normalizeRejectBody(body);
  const conn = getDb();
  try {
    const id = await resolveReportId(conn.db, null, ref);
    return await repoRejectReport(
      conn.db,
      id,
      reason as string,
      expectedVersion,
      actorOf(user.id),
    );
  } finally {
    await conn.close().catch(() => undefined);
  }
}

export async function duplicateAdminReport(
  req: Request,
  ref: string,
  body: unknown,
): Promise<Report> {
  const user = await requireAdmin(req);
  const { canonicalRef, expectedVersion } = normalizeDuplicateBody(body);
  const conn = getDb();
  try {
    const id = await resolveReportId(conn.db, null, ref);
    // The canonical reference accepts the same UUID-or-ticket shape as any
    // admin report ref (unscoped resolution); unresolvable → same 404.
    const canonicalId = await resolveReportId(conn.db, null, String(canonicalRef));
    return await repoMarkDuplicate(conn.db, id, canonicalId, expectedVersion, actorOf(user.id));
  } finally {
    await conn.close().catch(() => undefined);
  }
}

export async function setPriorityAdminReport(
  req: Request,
  ref: string,
  body: unknown,
): Promise<Report> {
  const user = await requireAdmin(req);
  const { priority, reason, expectedVersion } = normalizePriorityBody(body);
  const conn = getDb();
  try {
    const id = await resolveReportId(conn.db, null, ref);
    return await repoSetFinalPriority(
      conn.db,
      id,
      priority as Parameters<typeof repoSetFinalPriority>[2],
      (reason ?? null) as string | null,
      expectedVersion,
      actorOf(user.id),
    );
  } finally {
    await conn.close().catch(() => undefined);
  }
}

export async function assignAdminReport(req: Request, ref: string, body: unknown): Promise<Report> {
  const user = await requireAdmin(req);
  const { technicianId, reason, expectedVersion } = normalizeAssignBody(body);
  const conn = getDb();
  try {
    const id = await resolveReportId(conn.db, null, ref);
    return await repoAssignTechnician(
      conn.db,
      id,
      technicianId as string,
      expectedVersion,
      actorOf(user.id),
      (reason ?? null) as string | null | undefined,
    );
  } finally {
    await conn.close().catch(() => undefined);
  }
}

export async function transitionAdminReport(
  req: Request,
  ref: string,
  body: unknown,
): Promise<Report> {
  const user = await requireAdmin(req);
  const { nextStatus, note, expectedVersion } = normalizeTransitionBody(body);
  const conn = getDb();
  try {
    const id = await resolveReportId(conn.db, null, ref);
    return await repoTransitionReport(
      conn.db,
      id,
      nextStatus as Parameters<typeof repoTransitionReport>[2],
      expectedVersion,
      actorOf(user.id),
      (note ?? null) as string | null | undefined,
    );
  } finally {
    await conn.close().catch(() => undefined);
  }
}

export async function addUpdateAdminReport(
  req: Request,
  ref: string,
  body: unknown,
): Promise<ReportUpdate> {
  const user = await requireAdmin(req);
  const { visibility, message, expectedVersion } = normalizeUpdateBody(body);
  const conn = getDb();
  try {
    const id = await resolveReportId(conn.db, null, ref);
    return await repoAddReportUpdate(
      conn.db,
      id,
      visibility as 'PUBLIC' | 'INTERNAL',
      message as string,
      expectedVersion,
      actorOf(user.id),
    );
  } finally {
    await conn.close().catch(() => undefined);
  }
}

export async function getAdminTimelineRoute(
  req: Request,
  ref: string,
): Promise<{ readonly entries: TimelineEntry[] }> {
  await requireAdmin(req);
  const conn = getDb();
  try {
    const id = await resolveReportId(conn.db, null, ref);
    const entries = await repoGetAdminTimeline(conn.db, id);
    return { entries };
  } finally {
    await conn.close().catch(() => undefined);
  }
}
