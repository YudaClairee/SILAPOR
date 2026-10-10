// Session pure-helper unit tests (P2-3). No DB required.

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  SESSION_COOKIE,
  SESSION_TTL_MS,
  TOKEN_BYTES,
  clearSessionCookieHeader,
  createSessionToken,
  hashSessionToken,
  isSessionExpired,
  resolveSessionUser,
  sessionCookieHeader,
  tokenHashPrefix,
  type SessionRecord,
  type SessionUserRecord,
} from './session.js';

describe('createSessionToken', () => {
  it('returns 64 lowercase hex chars (32 random bytes)', () => {
    expect(TOKEN_BYTES).toBe(32);
    const token = createSessionToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is unique across draws', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) {
      seen.add(createSessionToken());
    }
    expect(seen.size).toBe(100);
  });
});

describe('hashSessionToken', () => {
  it('is deterministic sha256 hex matching node:crypto', () => {
    const token = createSessionToken();
    expect(hashSessionToken(token)).toBe(createHash('sha256').update(token, 'utf8').digest('hex'));
    expect(hashSessionToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSessionToken(token)).toBe(hashSessionToken(token));
  });

  it('differs per token', () => {
    expect(hashSessionToken(createSessionToken())).not.toBe(hashSessionToken(createSessionToken()));
  });

  it('differs from the raw token (hash stored, never raw)', () => {
    const token = createSessionToken();
    expect(hashSessionToken(token)).not.toBe(token);
    expect(hashSessionToken(token)).not.toContain(token);
  });
});

describe('tokenHashPrefix', () => {
  it('returns the first 8 chars of the hash', () => {
    const hash = hashSessionToken(createSessionToken());
    expect(tokenHashPrefix(hash)).toBe(hash.slice(0, 8));
    expect(tokenHashPrefix(hash)).toHaveLength(8);
  });
});

describe('sessionCookieHeader', () => {
  it('sets Path, HttpOnly, SameSite=Lax and a 7-day Max-Age', () => {
    const header = sessionCookieHeader('abc123', { secure: false });
    expect(header.startsWith(`${SESSION_COOKIE}=abc123`)).toBe(true);
    expect(header).toContain('Path=/');
    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=Lax');
    expect(header).toContain('Max-Age=604800');
    expect(header).not.toContain('Secure');
  });

  it('adds Secure iff the secure flag is set', () => {
    expect(sessionCookieHeader('abc123', { secure: true })).toContain('; Secure');
    expect(sessionCookieHeader('abc123', { secure: false })).not.toContain('Secure');
  });
});

describe('clearSessionCookieHeader', () => {
  it('expires the cookie immediately', () => {
    const header = clearSessionCookieHeader();
    expect(header.startsWith(`${SESSION_COOKIE}=`)).toBe(true);
    expect(header).toContain('Max-Age=0');
    expect(header).toContain('Thu, 01 Jan 1970');
    expect(header).toContain('Path=/');
    expect(header).toContain('HttpOnly');
  });
});

describe('SESSION_TTL_MS', () => {
  it('is 7 days', () => {
    expect(SESSION_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
  });
});

describe('isSessionExpired', () => {
  it('treats the exact boundary (expiresAt == now) as expired', () => {
    const now = new Date('2026-10-10T00:00:00.000Z');
    expect(isSessionExpired(new Date(now), new Date(now))).toBe(true);
    expect(isSessionExpired(new Date(now.getTime() - 1), now)).toBe(true);
    expect(isSessionExpired(new Date(now.getTime() + 1), now)).toBe(false);
  });
});

interface TestUser extends SessionUserRecord {
  readonly id: string;
}

function liveSession(): SessionRecord {
  return { expiresAt: new Date(Date.now() + SESSION_TTL_MS), revokedAt: null };
}

describe('resolveSessionUser', () => {
  it('returns the user for a live, unrevoked session with an active user', () => {
    const user: TestUser = { id: 'u-1', isActive: true };
    expect(resolveSessionUser(liveSession(), user, new Date())).toBe(user);
  });

  it('returns null for expired sessions', () => {
    const user: TestUser = { id: 'u-1', isActive: true };
    const expired: SessionRecord = { expiresAt: new Date(Date.now() - 1000), revokedAt: null };
    expect(resolveSessionUser(expired, user, new Date())).toBeNull();
  });

  it('returns null for revoked sessions', () => {
    const user: TestUser = { id: 'u-1', isActive: true };
    const revoked: SessionRecord = { ...liveSession(), revokedAt: new Date() };
    expect(resolveSessionUser(revoked, user, new Date())).toBeNull();
  });

  it('returns null when the local user is inactive (old sessions die)', () => {
    const user: TestUser = { id: 'u-1', isActive: false };
    expect(resolveSessionUser(liveSession(), user, new Date())).toBeNull();
  });

  it('returns null for missing session or user rows', () => {
    const user: TestUser = { id: 'u-1', isActive: true };
    expect(resolveSessionUser(null, user, new Date())).toBeNull();
    expect(resolveSessionUser(undefined, user, new Date())).toBeNull();
    expect(resolveSessionUser(liveSession(), null, new Date())).toBeNull();
    expect(resolveSessionUser(liveSession(), undefined, new Date())).toBeNull();
  });
});
