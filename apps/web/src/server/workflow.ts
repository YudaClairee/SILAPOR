// Middleware frame: workflow transport (was Phase 5, trimmed 2026-10-15).
// Assign/transition/updates remain; the manual verify/reject/duplicate/
// priority mutations are gone — verification is the AI pass (submit) or the
// held-verify route (`./held.ts`), per the approved AI-verification design.
//
// Conventions:
// - Bodies accept camelCase + snake_case keys via the `copyField` pattern
//   (same helper shape as `normalizeCreateReportBody`); unknown shapes pass
//   through so repo validators — not this layer — produce the 400.
// - `expectedVersion` MUST be a present integer in every mutation body
//   (400 `'expectedVersion' is required'` otherwise) — optimistic locking.
// - The manual verify/reject/duplicate/priority mutations were removed per
//   the 2026-10-14 AI verification design: submit verifies via AI (held on
//   outage) and holds resolve through the held-verify transport in
//   `./held.ts`. Only assign/transition/updates/timeline remain here.
// - This module logs nothing — routes log with opaque refs.
import {
  addReportUpdate as repoAddReportUpdate,
  assignTechnician as repoAssignTechnician,
  getAdminTimeline as repoGetAdminTimeline,
  getDb,
  transitionReport as repoTransitionReport,
  type Report,
  type ReportUpdate,
  type TimelineEntry,
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
