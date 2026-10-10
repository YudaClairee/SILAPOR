// Login rate-limiter unit tests (P2-3). Time is injected so the window
// logic is deterministic; no DB required.

import { beforeEach, describe, expect, it } from 'vitest';
import {
  LOGIN_RATE_LIMIT_WINDOW_MS,
  MAX_LOGIN_FAILURES,
  checkLoginRateLimit,
  clearLoginAttempt,
  loginRateLimitKey,
  noteLoginFailure,
  resetLoginRateLimits,
} from './rate-limit.js';

const T0 = 1_000_000_000_000;

beforeEach(() => {
  resetLoginRateLimits();
});

describe('login rate limiter', () => {
  it('allows a fresh key', () => {
    expect(checkLoginRateLimit(loginRateLimitKey('230001', '1.2.3.4'), T0)).toEqual({
      allowed: true,
      retryAfterMs: 0,
    });
  });

  it('blocks after 5 failures and reports a positive retryAfterMs', () => {
    const key = loginRateLimitKey('230001', '1.2.3.4');
    expect(MAX_LOGIN_FAILURES).toBe(5);
    for (let i = 0; i < 5; i++) {
      noteLoginFailure(key, T0 + i);
    }
    const state = checkLoginRateLimit(key, T0 + 5);
    expect(state.allowed).toBe(false);
    expect(state.retryAfterMs).toBeGreaterThan(0);
    expect(state.retryAfterMs).toBe(LOGIN_RATE_LIMIT_WINDOW_MS - 5);
  });

  it('keeps blocking on further failures inside the window', () => {
    const key = loginRateLimitKey('230001', '1.2.3.4');
    for (let i = 0; i < 6; i++) {
      noteLoginFailure(key, T0);
    }
    expect(checkLoginRateLimit(key, T0 + 1000).allowed).toBe(false);
  });

  it('clears the key on successful login', () => {
    const key = loginRateLimitKey('230001', '1.2.3.4');
    for (let i = 0; i < 4; i++) {
      noteLoginFailure(key, T0 + i);
    }
    clearLoginAttempt(key);
    expect(checkLoginRateLimit(key, T0 + 4)).toEqual({ allowed: true, retryAfterMs: 0 });
    // The count restarts: four more failures still leave room for one.
    for (let i = 0; i < 4; i++) {
      noteLoginFailure(key, T0 + 10 + i);
    }
    expect(checkLoginRateLimit(key, T0 + 14).allowed).toBe(true);
  });

  it('isolates keys per username+ip', () => {
    const blocked = loginRateLimitKey('230001', '1.2.3.4');
    for (let i = 0; i < 5; i++) {
      noteLoginFailure(blocked, T0);
    }
    expect(checkLoginRateLimit(blocked, T0).allowed).toBe(false);
    expect(checkLoginRateLimit(loginRateLimitKey('230002', '1.2.3.4'), T0).allowed).toBe(true);
    expect(checkLoginRateLimit(loginRateLimitKey('230001', '5.6.7.8'), T0).allowed).toBe(true);
  });

  it('re-opens the window after 10 minutes', () => {
    const key = loginRateLimitKey('230001', '1.2.3.4');
    for (let i = 0; i < 5; i++) {
      noteLoginFailure(key, T0);
    }
    expect(checkLoginRateLimit(key, T0).allowed).toBe(false);
    const after = T0 + LOGIN_RATE_LIMIT_WINDOW_MS + 1;
    expect(checkLoginRateLimit(key, after)).toEqual({ allowed: true, retryAfterMs: 0 });
    // A failure after the window starts a fresh count of one.
    noteLoginFailure(key, after);
    expect(checkLoginRateLimit(key, after).allowed).toBe(true);
  });

  it('resetLoginRateLimits clears every key', () => {
    const a = loginRateLimitKey('230001', '1.2.3.4');
    const b = loginRateLimitKey('230002', '1.2.3.4');
    for (let i = 0; i < 5; i++) {
      noteLoginFailure(a, T0);
      noteLoginFailure(b, T0);
    }
    resetLoginRateLimits();
    expect(checkLoginRateLimit(a, T0).allowed).toBe(true);
    expect(checkLoginRateLimit(b, T0).allowed).toBe(true);
  });

  it('builds distinct keys with the newline separator', () => {
    expect(loginRateLimitKey('a', 'b')).toBe('a\nb');
    expect(loginRateLimitKey('a', 'b')).not.toBe(loginRateLimitKey('a\n', 'b'));
  });
});
