// Pure session helpers (Phase 2 P2-3). No I/O, no database imports —
// the web layer injects repository functions from `@silapor/database`.
//
// Secrecy rule: raw tokens are shown to the client exactly once (login
// Set-Cookie) and stored only as sha256 hashes. Never log raw tokens —
// diagnostics use `tokenHashPrefix()` (first 8 hex chars of the hash).

import { createHash, randomBytes } from 'node:crypto';

export const SESSION_COOKIE = 'silapor_session' as const;

// 7 days, in milliseconds (expiry clock) and seconds (cookie Max-Age).
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60;

// Raw token entropy: 32 bytes rendered as 64 lowercase hex chars.
export const TOKEN_BYTES = 32 as const;

export function createSessionToken(): string {
  return randomBytes(TOKEN_BYTES).toString('hex');
}

export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

// First 8 hex chars of a token hash — the only token-derived value that
// may appear in logs. It cannot be reversed into the raw token.
export function tokenHashPrefix(tokenHash: string): string {
  return tokenHash.slice(0, 8);
}

export interface SessionCookieOptions {
  // True when the request arrived over https or NODE_ENV=production.
  readonly secure: boolean;
}

export function sessionCookieHeader(token: string, options: SessionCookieOptions): string {
  const base =
    `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; ` +
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`;
  return options.secure ? `${base}; Secure` : base;
}

export function clearSessionCookieHeader(): string {
  return (
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; ` +
    `Expires=Thu, 01 Jan 1970 00:00:00 GMT`
  );
}

export function isSessionExpired(expiresAt: Date, now: Date): boolean {
  return expiresAt.getTime() <= now.getTime();
}

// Minimal structural shapes so this module stays free of the database
// package: any row with these fields (e.g. drizzle `Session`/`User`) fits.
export interface SessionRecord {
  readonly expiresAt: Date;
  readonly revokedAt: Date | null;
}

export interface SessionUserRecord {
  readonly isActive: boolean;
}

// Step 12 enforcement: a session resolves to its user only when it is
// unexpired, unrevoked, and the local user row is active. The local
// `is_active` flag is the enforcement point — deactivating a user kills
// even previously issued sessions.
export function resolveSessionUser<S extends SessionRecord, U extends SessionUserRecord>(
  sessionRow: S | null | undefined,
  userRow: U | null | undefined,
  now: Date,
): U | null {
  if (sessionRow === null || sessionRow === undefined) {
    return null;
  }
  if (userRow === null || userRow === undefined) {
    return null;
  }
  if (sessionRow.revokedAt !== null) {
    return null;
  }
  if (isSessionExpired(sessionRow.expiresAt, now)) {
    return null;
  }
  if (!userRow.isActive) {
    return null;
  }
  return userRow;
}
