// MockSsoProvider / UpiSsoProvider / getSsoProvider unit tests (P2-3).
// No DB required — pure in-memory contract checks.

import { describe, expect, it } from 'vitest';
import { isAppError } from '@silapor/shared';
import { MockSsoProvider, UpiSsoProvider, getSsoProvider, type SsoProvider } from './sso.js';

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
    expect(getSsoProvider('mock').name).toBe('mock');
  });

  it('throws badRequest for anything else', () => {
    for (const name of ['upi', 'UPI', 'MOCK', '', 'saml']) {
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
