// Server session guards (Phase 2 P2-4). Composition point: pure helpers
// from `@silapor/auth` (token hash, `resolveSessionUser`, role/ownership
// policies) sequenced with the drizzle session repository from
// `@silapor/database`. Auth never imports the database — this module injects
// `db` into both.
//
// These guards are the authoritative enforcement for route handlers (plan
// principle 2); client redirects in `../server/guard` + layout routes are
// navigation convenience only and must never be relied on for security.
//
// Secrecy rule: session-cookie parsing reuses the P2-3 shape (raw token is
// hashed immediately, never stored or compared raw). This module logs
// nothing — callers log with opaque IDs via `redact()`; tokens and PII
// (usernames, NIMs) never appear here.
import { eq } from 'drizzle-orm';
import {
  SESSION_COOKIE,
  hashSessionToken,
  requireOwnerOrAdmin as requirePolicyOwnerOrAdmin,
  requireRole as requirePolicyRole,
  resolveSessionUser,
  type AuthUser,
  type Role,
} from '@silapor/auth';
import { findSessionByTokenHash, getDb, users } from '@silapor/database';
import { unauthorized } from '@silapor/shared';

// Minimal public identity handed to route handlers — no external IDs, NIMs,
// or hashes (matches GET /api/auth/me).
export interface SessionUser {
  readonly id: string;
  readonly username: string;
  readonly role: Role;
}

function parseSessionToken(cookieHeader: string | null): string | null {
  if (cookieHeader === null || cookieHeader === '') {
    return null;
  }
  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) {
      continue;
    }
    if (part.slice(0, separator).trim() === SESSION_COOKIE) {
      const value = part.slice(separator + 1).trim();
      return value === '' ? null : value;
    }
  }
  return null;
}

// Users reaching this point already passed `resolveSessionUser`
// (unexpired + unrevoked + locally active), so the policy adapter marks them
// active without re-reading the row.
function toAuthUser(user: SessionUser): AuthUser {
  return { id: user.id, username: user.username, role: user.role, isActive: true };
}

// Resolves the request's session cookie to a minimal user or null. Never
// throws for missing/invalid/expired/revoked sessions (returns null);
// unexpected failures (e.g. DB errors) propagate so callers map them to 500
// instead of masking an outage as 401. Always closes the connection.
export async function getSessionUser(req: Request): Promise<SessionUser | null> {
  const token = parseSessionToken(req.headers.get('cookie'));
  if (token === null) {
    return null;
  }
  const conn = getDb();
  try {
    const session = await findSessionByTokenHash(conn.db, hashSessionToken(token));
    if (session === undefined) {
      return null;
    }
    const userRows = await conn.db.select().from(users).where(eq(users.id, session.userId));
    const userRow = userRows[0] ?? null;
    const resolved = resolveSessionUser(session, userRow, new Date());
    if (resolved === null) {
      return null;
    }
    return { id: resolved.id, username: resolved.username, role: resolved.role };
  } finally {
    await conn.close().catch(() => undefined);
  }
}

// Same as `getSessionUser` but throws 401 `Belum login` when anonymous.
export async function requireUser(req: Request): Promise<SessionUser> {
  const user = await getSessionUser(req);
  if (user === null) {
    throw unauthorized('Belum login');
  }
  return user;
}

// Throws 401 when anonymous, 403 (`Akses ditolak`) for non-ADMIN roles.
// Used by P2-5 admin routes.
export async function requireAdmin(req: Request): Promise<SessionUser> {
  const user = await requireUser(req);
  requirePolicyRole(toAuthUser(user), 'ADMIN');
  return user;
}

// Throws 401 when anonymous, 403 unless the caller owns `ownerId` or is an
// active ADMIN. Implemented now for Phase 3 report ownership.
export async function requireOwnerOrAdmin(
  req: Request,
  ownerId: string,
): Promise<SessionUser> {
  const user = await requireUser(req);
  requirePolicyOwnerOrAdmin(toAuthUser(user), ownerId);
  return user;
}
