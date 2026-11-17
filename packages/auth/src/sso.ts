// SSO provider contract + pilot implementations (Phase 2 P2-3).
//
// The auth package composes identity resolution only — it never touches the
// database (no @silapor/database dependency). Callers in the web layer
// resolve an `SsoIdentity` here, then load-or-create the local user row via
// `@silapor/database` and enforce `users.is_active` locally.
//
// Secrecy rule: the mock carries no passwords and ignores any it is given.
// The `local` provider verifies passwords (see `./password.js`); admin and
// managerial hashes come from env, never from source. Never log
// usernames/NIMs — they are PII; log opaque user IDs and session hash
// prefixes only (see `./session.js`).

import { createHash, timingSafeEqual } from 'node:crypto';
import { badRequest, unavailable } from '@silapor/shared';
import { verifyPassword } from './password.js';

export type SsoRole = 'ADMIN' | 'REPORTER' | 'MANAGERIAL';

export interface SsoIdentity {
  readonly externalUserId: string;
  readonly username: string;
  readonly nim: string | null;
  readonly role: SsoRole;
  readonly isActive: boolean;
}

export interface SsoProvider {
  readonly name: string;
  resolve(username: string, password?: string): Promise<SsoIdentity | null>;
}

// Pilot mock: exact-match directory for the seeded pilot accounts.
// Usernames are case-sensitive; surrounding whitespace is trimmed; empty
// input resolves to null. No passwords exist or are checked.
export class MockSsoProvider implements SsoProvider {
  readonly name = 'mock' as const;

  // Takes no password parameter: any password passed through the
  // SsoProvider interface is ignored.
  async resolve(username: string): Promise<SsoIdentity | null> {
    const trimmed = username.trim();
    if (trimmed === '') {
      return null;
    }
    if (trimmed === 'admin') {
      return {
        externalUserId: 'admin',
        username: 'admin',
        nim: null,
        role: 'ADMIN',
        isActive: true,
      };
    }
    if (trimmed === 'manajerial') {
      return {
        externalUserId: 'manajerial',
        username: 'manajerial',
        nim: null,
        role: 'MANAGERIAL',
        isActive: true,
      };
    }
    if (trimmed === '230001' || trimmed === '230002') {
      return {
        externalUserId: trimmed,
        username: trimmed,
        nim: trimmed,
        role: 'REPORTER',
        isActive: true,
      };
    }
    return null;
  }
}

const REPORTER_COUNT = 20;
const REPORTER_NIM_PREFIX = '2300';

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(digest(a), digest(b));
}

export interface LocalSsoOptions {
  readonly adminPasswordHash?: string | undefined;
  readonly managerialPasswordHash?: string | undefined;
}

// Limited class-test directory with password verification.
// - Reporters: NIM 230001..230020, password `pelapor<n>` (n without leading
//   zeros; derived, so it is intentionally shareable with the class).
// - admin / manajerial: password verified against scrypt hashes from env.
//   Missing or malformed hash => that account cannot log in (fail closed).
// Usernames are trimmed and case-sensitive; passwords are never trimmed.
export class LocalSsoProvider implements SsoProvider {
  readonly name = 'local' as const;

  constructor(private readonly options: LocalSsoOptions) {}

  async resolve(username: string, password?: string): Promise<SsoIdentity | null> {
    const trimmed = username.trim();
    if (trimmed === '' || password === undefined || password === '') {
      return null;
    }
    if (trimmed === 'admin') {
      return this.checkHash(password, this.options.adminPasswordHash, {
        externalUserId: 'admin',
        username: 'admin',
        nim: null,
        role: 'ADMIN',
        isActive: true,
      });
    }
    if (trimmed === 'manajerial') {
      return this.checkHash(password, this.options.managerialPasswordHash, {
        externalUserId: 'manajerial',
        username: 'manajerial',
        nim: null,
        role: 'MANAGERIAL',
        isActive: true,
      });
    }
    const match = /^2300(\d{2})$/.exec(trimmed);
    if (match !== null && trimmed.startsWith(REPORTER_NIM_PREFIX)) {
      const n = Number(match[1]);
      if (n >= 1 && n <= REPORTER_COUNT && safeEqual(password, `pelapor${n}`)) {
        return {
          externalUserId: trimmed,
          username: trimmed,
          nim: trimmed,
          role: 'REPORTER',
          isActive: true,
        };
      }
    }
    return null;
  }

  private checkHash(
    password: string,
    hash: string | undefined,
    identity: SsoIdentity,
  ): SsoIdentity | null {
    if (hash === undefined || hash === '') {
      return null;
    }
    return verifyPassword(password, hash) ? identity : null;
  }
}

// UPI SSO integration is deferred past the pilot: any call throws a
// fail-closed UNAVAILABLE AppError so the web layer maps it to 503.
export class UpiSsoProvider implements SsoProvider {
  readonly name = 'upi' as const;

  async resolve(): Promise<SsoIdentity | null> {
    throw unavailable('SSO UPI belum tersedia');
  }
}

// AUTH_PROVIDER=mock for dev/e2e, `local` for the password-protected class
// pilot. Unknown names throw BAD_REQUEST so misconfiguration surfaces instead
// of silently degrading.
export function getSsoProvider(
  name: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): SsoProvider {
  if (name === 'mock') {
    return new MockSsoProvider();
  }
  if (name === 'local') {
    return new LocalSsoProvider({
      adminPasswordHash: env['ADMIN_PASSWORD_HASH'],
      managerialPasswordHash: env['MANAGERIAL_PASSWORD_HASH'],
    });
  }
  throw badRequest('Penyedia SSO tidak dikenal');
}
