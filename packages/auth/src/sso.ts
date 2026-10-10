// SSO provider contract + pilot implementations (Phase 2 P2-3).
//
// The auth package composes identity resolution only — it never touches the
// database (no @silapor/database dependency). Callers in the web layer
// resolve an `SsoIdentity` here, then load-or-create the local user row via
// `@silapor/database` and enforce `users.is_active` locally.
//
// Secrecy rule: the mock carries no passwords and none are accepted here
// (the route layer accepts-but-ignores a `password` field for future UPI
// compat). Never log usernames/NIMs — they are PII; log opaque user IDs and
// session hash prefixes only (see `./session.js`).

import { badRequest, unavailable } from '@silapor/shared';

export type SsoRole = 'ADMIN' | 'REPORTER';

export interface SsoIdentity {
  readonly externalUserId: string;
  readonly username: string;
  readonly nim: string | null;
  readonly role: SsoRole;
  readonly isActive: boolean;
}

export interface SsoProvider {
  readonly name: string;
  resolve(username: string): Promise<SsoIdentity | null>;
}

// Pilot mock: exact-match directory for the seeded pilot accounts.
// Usernames are case-sensitive; surrounding whitespace is trimmed; empty
// input resolves to null. No passwords exist or are checked.
export class MockSsoProvider implements SsoProvider {
  readonly name = 'mock' as const;

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

// UPI SSO integration is deferred past the pilot: any call throws a
// fail-closed UNAVAILABLE AppError so the web layer maps it to 503.
export class UpiSsoProvider implements SsoProvider {
  readonly name = 'upi' as const;

  async resolve(): Promise<SsoIdentity | null> {
    throw unavailable('SSO UPI belum tersedia');
  }
}

// AUTH_PROVIDER=mock everywhere in the pilot. Unknown names throw
// BAD_REQUEST so misconfiguration surfaces instead of silently degrading.
export function getSsoProvider(name: string): SsoProvider {
  if (name === 'mock') {
    return new MockSsoProvider();
  }
  throw badRequest('Penyedia SSO tidak dikenal');
}
