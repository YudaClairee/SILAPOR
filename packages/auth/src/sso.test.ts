// MockSsoProvider / UpiSsoProvider / getSsoProvider unit tests (P2-3).
// No DB required — pure in-memory contract checks.

import { describe, expect, it } from 'vitest';
import { isAppError } from '@silapor/shared';
import {
  LocalSsoProvider,
  MockSsoProvider,
  UpiSsoProvider,
  getSsoProvider,
  type SsoProvider,
} from './sso.js';
import { hashPassword } from './password.js';

describe('MockSsoProvider', () => {
  it('has name mock', () => {
    expect(new MockSsoProvider().name).toBe('mock');
  });

  it('resolves admin to an active ADMIN with null nim', async () => {
    const identity = await new MockSsoProvider().resolve('admin');
    expect(identity).toEqual({
      externalUserId: 'admin',
      username: 'admin',
      nim: null,
      role: 'ADMIN',
      isActive: true,
    });
  });

  it('resolves manajerial to an active MANAGERIAL identity', async () => {
    const identity = await new MockSsoProvider().resolve('manajerial');
    expect(identity).toEqual({
      externalUserId: 'manajerial',
      username: 'manajerial',
      nim: null,
      role: 'MANAGERIAL',
      isActive: true,
    });
  });

  it('resolves 230001/230002 to active REPORTERs with nim=username', async () => {
    for (const username of ['230001', '230002']) {
      const identity = await new MockSsoProvider().resolve(username);
      expect(identity).toEqual({
        externalUserId: username,
        username,
        nim: username,
        role: 'REPORTER',
        isActive: true,
      });
    }
  });

  it('returns null for unknown usernames', async () => {
    expect(await new MockSsoProvider().resolve('230003')).toBeNull();
    expect(await new MockSsoProvider().resolve('mahasiswa')).toBeNull();
  });

  it('returns null for empty or whitespace-only input', async () => {
    expect(await new MockSsoProvider().resolve('')).toBeNull();
    expect(await new MockSsoProvider().resolve('   ')).toBeNull();
  });

  it('trims surrounding whitespace but stays case-sensitive', async () => {
    expect(await new MockSsoProvider().resolve('  admin  ')).not.toBeNull();
    expect(await new MockSsoProvider().resolve('Admin')).toBeNull();
    expect(await new MockSsoProvider().resolve('ADMIN')).toBeNull();
  });
});

describe('LocalSsoProvider', () => {
  const adminHash = hashPassword('sandi-admin');
  const managerialHash = hashPassword('sandi-manajer');
  const make = (): LocalSsoProvider =>
    new LocalSsoProvider({ adminPasswordHash: adminHash, managerialPasswordHash: managerialHash });

  it('has name local', () => {
    expect(make().name).toBe('local');
  });

  it('resolves any 7-digit UPI NIM with pelapor + last 4 digits', async () => {
    expect(await make().resolve('2304649', 'pelapor4649')).toEqual({
      externalUserId: '2304649',
      username: '2304649',
      nim: '2304649',
      role: 'REPORTER',
      isActive: true,
    });
    expect(await make().resolve('2300049', 'pelapor0049')).toEqual({
      externalUserId: '2300049',
      username: '2300049',
      nim: '2300049',
      role: 'REPORTER',
      isActive: true,
    });
  });

  it('rejects reporter with a wrong password', async () => {
    expect(await make().resolve('2304649', 'pelapor4648')).toBeNull();
    expect(await make().resolve('2300049', 'pelapor49')).toBeNull();
    expect(await make().resolve('2304649', '')).toBeNull();
    expect(await make().resolve('2304649', undefined)).toBeNull();
  });

  it('rejects usernames that are not 7-digit UPI NIMs', async () => {
    expect(await make().resolve('230001', 'pelapor0001')).toBeNull();
    expect(await make().resolve('23046490', 'pelapor6490')).toBeNull();
    expect(await make().resolve('230464a', 'pelapor464a')).toBeNull();
    expect(await make().resolve('mahasiswa', 'pelaporiswa')).toBeNull();
  });

  it('resolves admin and manajerial only with their own password', async () => {
    expect((await make().resolve('admin', 'sandi-admin'))?.role).toBe('ADMIN');
    expect((await make().resolve('manajerial', 'sandi-manajer'))?.role).toBe('MANAGERIAL');
    expect(await make().resolve('admin', 'sandi-manajer')).toBeNull();
    expect(await make().resolve('manajerial', 'sandi-admin')).toBeNull();
    expect(await make().resolve('admin', 'admin')).toBeNull();
    expect(await make().resolve('admin', '')).toBeNull();
  });

  it('fails closed for admin/manajerial when hashes are not configured', async () => {
    const provider = new LocalSsoProvider({});
    expect(await provider.resolve('admin', 'sandi-admin')).toBeNull();
    expect(await provider.resolve('manajerial', 'sandi-manajer')).toBeNull();
    expect((await provider.resolve('2304649', 'pelapor4649'))?.role).toBe('REPORTER');
  });

  it('trims the username but never the password', async () => {
    expect(await make().resolve('  2304649  ', 'pelapor4649')).not.toBeNull();
    expect(await make().resolve('2304649', ' pelapor4649')).toBeNull();
  });

  it('returns null for empty username', async () => {
    expect(await make().resolve('', 'pelapor4649')).toBeNull();
  });
});

describe('MockSsoProvider ignores passwords', () => {
  it('still resolves with any or no password', async () => {
    const provider: SsoProvider = new MockSsoProvider();
    expect(await provider.resolve('admin', 'apa-saja')).not.toBeNull();
    expect(await provider.resolve('admin')).not.toBeNull();
  });
});

describe('UpiSsoProvider', () => {
  it('has name upi and throws unavailable on resolve', async () => {
    const provider: SsoProvider = new UpiSsoProvider();
    expect(provider.name).toBe('upi');
    try {
      await provider.resolve('admin');
      expect.unreachable('UpiSsoProvider.resolve must throw');
    } catch (error) {
      expect(isAppError(error)).toBe(true);
      if (isAppError(error)) {
        expect(error.code).toBe('UNAVAILABLE');
        expect(error.status).toBe(503);
        expect(error.message).toBe('SSO UPI belum tersedia');
      }
    }
  });
});

describe('getSsoProvider', () => {
  it("returns the mock provider for 'mock'", () => {
    expect(getSsoProvider('mock', {}).name).toBe('mock');
  });

  it('refuses mock in production unless explicitly allowed', () => {
    try {
      getSsoProvider('mock', { NODE_ENV: 'production' });
      expect.unreachable('mock must be refused in production');
    } catch (error) {
      expect(isAppError(error)).toBe(true);
      if (isAppError(error)) {
        expect(error.status).toBe(503);
      }
    }
    expect(
      getSsoProvider('mock', { NODE_ENV: 'production', ALLOW_MOCK_AUTH_IN_PRODUCTION: 'true' })
        .name,
    ).toBe('mock');
    expect(getSsoProvider('mock', { NODE_ENV: 'development' }).name).toBe('mock');
  });

  it("returns the local provider for 'local', reading hashes from the given env", async () => {
    const provider = getSsoProvider('local', {
      ADMIN_PASSWORD_HASH: hashPassword('sandi-admin'),
    });
    expect(provider.name).toBe('local');
    expect((await provider.resolve('admin', 'sandi-admin'))?.role).toBe('ADMIN');
    expect(await provider.resolve('manajerial', 'apa-saja')).toBeNull();
  });

  it('throws badRequest for anything else', () => {
    for (const name of ['upi', 'UPI', 'MOCK', 'LOCAL', '', 'saml']) {
      try {
        getSsoProvider(name);
        expect.unreachable(`getSsoProvider(${JSON.stringify(name)}) must throw`);
      } catch (error) {
        expect(isAppError(error)).toBe(true);
        if (isAppError(error)) {
          expect(error.code).toBe('BAD_REQUEST');
          expect(error.status).toBe(400);
        }
      }
    }
  });
});
