// Password hashing helpers for the `local` SSO provider (scrypt, node:crypto).
//
// Format: `scrypt:<saltHex>:<hashHex>` (16-byte salt, 64-byte derived key).
// `:` is used instead of `$` because the same env file is read by docker
// compose, which would interpolate `$`. infra/vps/hash-password.mjs produces
// the same format on the VPS so the operator can generate hashes without a
// build step. Never log passwords or hashes.

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const SALT_BYTES = 16;
const KEY_BYTES = 64;
const PREFIX = 'scrypt';

export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_BYTES);
  const key = scryptSync(password, salt, KEY_BYTES);
  return `${PREFIX}:${salt.toString('hex')}:${key.toString('hex')}`;
}

// Returns false (never throws) for malformed hashes so a bad env value fails
// closed instead of crashing the login route.
export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(':');
  if (parts.length !== 3 || parts[0] !== PREFIX) {
    return false;
  }
  const [, saltHex, keyHex] = parts as [string, string, string];
  if (!/^[0-9a-f]+$/.test(saltHex) || !/^[0-9a-f]+$/.test(keyHex)) {
    return false;
  }
  const salt = Buffer.from(saltHex, 'hex');
  const expected = Buffer.from(keyHex, 'hex');
  if (salt.length === 0 || expected.length !== KEY_BYTES) {
    return false;
  }
  const actual = scryptSync(password, salt, KEY_BYTES);
  return timingSafeEqual(actual, expected);
}
