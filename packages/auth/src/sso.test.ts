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

  it('resolves reporter 230001 with pelapor1', async () => {
    expect(await make().resolve('230001', 'pelapor1')).toEqual({
      externalUserId: '230001',
      username: '230001',
      nim: '230001',
      role: 'REPORTER',
      isActive: true,
    });
  });

  it('accepts every reporter 230001..230020 with pelapor<n> (no leading zeros)', async () => {
    for (let n = 1; n <= 20; n += 1) {
      const nim = `2300${String(n).padStart(2, '0')}`;
      const identity = await make().resolve(nim, `pelapor${n}`);
      expect(identity?.role).toBe('REPORTER');
      expect(identity?.nim).toBe(nim);
    }
  });

  it('rejects reporter with a wrong password', async () => {
    expect(await make().resolve('230001', 'pelapor2')).toBeNull();
    expect(await make().resolve('230001', 'pelapor01')).toBeNull();
    expect(await make().resolve('230001', '')).toBeNull();
    expect(await make().resolve('230001', undefined)).toBeNull();
  });

  it('rejects NIMs outside 230001..230020', async () => {
    expect(await make().resolve('230000', 'pelapor0')).toBeNull();
    expect(await make().resolve('230021', 'pelapor21')).toBeNull();
    expect(await make().resolve('mahasiswa', 'pelapor1')).toBeNull();
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
    expect((await provider.resolve('230001', 'pelapor1'))?.role).toBe('REPORTER');
  });

  it('trims the username but never the password', async () => {
    expect(await make().resolve('  230001  ', 'pelapor1')).not.toBeNull();
    expect(await make().resolve('230001', ' pelapor1')).toBeNull();
  });

  it('returns null for empty username', async () => {
    expect(await make().resolve('', 'pelapor1')).toBeNull();
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
