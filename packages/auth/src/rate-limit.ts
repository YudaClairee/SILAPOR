// In-memory login rate limiter (Phase 2 P2-3). Counts failures only —
// never passwords, tokens, or other secrets. Keys isolate per
// `username + IP` so one client cannot lock out unrelated users, and a
// successful login clears the key so legitimate users recover immediately.
//
// Pilot scope: single-process memory. A multi-instance deployment would
// need a shared store; until then each instance enforces its own window.

export const LOGIN_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
export const MAX_LOGIN_FAILURES = 5;

export interface LoginRateLimitState {
  readonly allowed: boolean;
  readonly retryAfterMs: number;
}

interface AttemptEntry {
  count: number;
  firstFailureAt: number;
}

const attempts = new Map<string, AttemptEntry>();

// The limiter key. Kept as a helper so the web layer and tests build the
// identical `${username}\n${ip}` shape (the newline separator cannot appear
// in a trimmed single-line username, so keys cannot collide across parts).
export function loginRateLimitKey(username: string, ip: string): string {
  return `${username}\n${ip}`;
}

function readNow(now: number | undefined): number {
  return now ?? Date.now();
}

function isWindowOpen(entry: AttemptEntry, now: number): boolean {
  return now - entry.firstFailureAt < LOGIN_RATE_LIMIT_WINDOW_MS;
}

export function checkLoginRateLimit(key: string, now?: number): LoginRateLimitState {
  const current = readNow(now);
  const entry = attempts.get(key);
  if (entry === undefined || !isWindowOpen(entry, current)) {
    if (entry !== undefined) {
      attempts.delete(key);
    }
    return { allowed: true, retryAfterMs: 0 };
  }
  if (entry.count >= MAX_LOGIN_FAILURES) {
    return {
      allowed: false,
      retryAfterMs: entry.firstFailureAt + LOGIN_RATE_LIMIT_WINDOW_MS - current,
    };
  }
  return { allowed: true, retryAfterMs: 0 };
}

export function noteLoginFailure(key: string, now?: number): void {
  const current = readNow(now);
  const entry = attempts.get(key);
  if (entry === undefined || !isWindowOpen(entry, current)) {
    attempts.set(key, { count: 1, firstFailureAt: current });
    return;
  }
  entry.count += 1;
}

export function clearLoginAttempt(key: string): void {
  attempts.delete(key);
}

// Test-only escape hatch (also handy for operator resets in the pilot).
export function resetLoginRateLimits(): void {
  attempts.clear();
}
