// Password hashing helpers (scrypt). Pure in-memory checks.

import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './password.js';

// Produced independently with node:crypto scryptSync(password, salt, 64);
// guards compatibility with infra/vps/hash-password.mjs.
const FIXED_HASH =
  'scrypt:00112233445566778899aabbccddeeff:5ee5c7ddbdd8b3814d0ea3492cd761724aeee7c60818a644dbd83e8e83e74cb8c3f897566b185afd86f7f252fab1e671e5f554042168443aaaa540c357f3fca5';

describe('hashPassword / verifyPassword', () => {
  it('verifies the password a hash was created from', () => {
    const hash = hashPassword('rahasia-123');
    expect(verifyPassword('rahasia-123', hash)).toBe(true);
  });

  it('rejects a different password', () => {
    const hash = hashPassword('rahasia-123');
    expect(verifyPassword('rahasia-124', hash)).toBe(false);
    expect(verifyPassword('', hash)).toBe(false);
  });

  it('uses a random salt so equal passwords hash differently', () => {
    expect(hashPassword('sama')).not.toBe(hashPassword('sama'));
  });

  it('produces the scrypt:<salt>:<hash> format without shell-special characters', () => {
    const hash = hashPassword('x');
    expect(hash).toMatch(/^scrypt:[0-9a-f]{32}:[0-9a-f]{128}$/);
    expect(hash).not.toContain('$');
  });

  it('verifies a hash generated outside this module', () => {
    expect(verifyPassword('contoh-password', FIXED_HASH)).toBe(true);
    expect(verifyPassword('salah', FIXED_HASH)).toBe(false);
  });

  it('returns false for malformed or missing hashes instead of throwing', () => {
    for (const bad of ['', 'plain', 'scrypt:zz:zz', 'bcrypt:aa:bb', 'scrypt:00:', 'scrypt$00$11']) {
      expect(verifyPassword('apa-saja', bad)).toBe(false);
    }
  });
});
