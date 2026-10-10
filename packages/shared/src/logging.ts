// Structured JSON-line logger with request/correlation IDs (Task 5).
//
// Node-only pilot (2026-10-10): request IDs flow through
// `node:async_hooks` AsyncLocalStorage. There is no edge/Workers support in
// this pilot — the web app runs on the TanStack Start Node target and the
// worker is a Node process. Where ALS is unavailable, callers pass
// `requestId` explicitly in the per-call fields; explicit fields always win
// over the ALS store.
//
// Secrecy rule: NEVER log passwords, tokens, raw image bytes, signed URLs,
// or PII (email, NIM, phone, addresses, …). Do not interpolate such values
// into `message`; pass only opaque IDs (e.g. `userId`) as fields and run any
// uncertain object through `redact()` first. `userId` below must be an
// opaque account ID, never an email or NIM.

import { AsyncLocalStorage } from 'node:async_hooks';

export type LogLevel = 'info' | 'warn' | 'error';

export interface LoggerFields {
  readonly requestId?: string;
  readonly userId?: string;
  readonly route?: string;
  readonly result?: string;
  readonly code?: string;
  readonly durationMs?: number;
  readonly details?: unknown;
}

export interface Logger {
  info(message: string, fields?: LoggerFields): void;
  warn(message: string, fields?: LoggerFields): void;
  error(message: string, fields?: LoggerFields): void;
}

export interface CreateLoggerOptions {
  readonly service: string;
}

const REDACTED = '[REDACTED]' as const;

function normalizedKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Exact (normalised) keys whose values are always masked.
const SENSITIVE_EXACT_KEYS: ReadonlySet<string> = new Set([
  'password',
  'passwd',
  'pwd',
  'secret',
  'token',
  'accesstoken',
  'refreshtoken',
  'idtoken',
  'authorization',
  'auth',
  'apikey',
  'accesskey',
  'session',
  'sessionid',
  'cookie',
  'cookies',
  'setcookie',
  'signedurl',
  'image',
  'images',
  'picture',
  'photo',
  'avatar',
  'base64',
  'buffer',
  'bytes',
  'blob',
  'file',
  'nim',
  'email',
  'phone',
  'phonenumber',
  'address',
  'dob',
  'birthdate',
  'nik',
]);

function isSensitiveKey(key: string): boolean {
  const n = normalizedKey(key);
  if (n.length === 0) {
    return false;
  }
  if (SENSITIVE_EXACT_KEYS.has(n)) {
    return true;
  }
  // Substring fallback for compound keys such as `db_password_hash_note`
  // (deliberately NOT bare `auth`, which would false-positive on `author`).
  return (
    n.includes('password') ||
    n.includes('secret') ||
    n.includes('token') ||
    n.includes('signedurl') ||
    n.includes('apikey') ||
    n.includes('session') ||
    n.includes('cookie') ||
    n.includes('authorization')
  );
}

// Masks string values that are secrets by shape even when the key is bland
// (inline data-URL images, presigned URLs carrying signatures).
function isSensitiveString(value: string): boolean {
  if (value.startsWith('data:image/') || value.startsWith('data:application/octet-stream')) {
    return true;
  }
  return (
    value.includes('X-Amz-Signature') ||
    value.includes('X-Amz-Credential') ||
    /[?&]signature=/i.test(value)
  );
}

// Deep-clones `value`, replacing sensitive entries with `[REDACTED]`.
// Objects already seen (circular refs) are replaced rather than recursed.
export function redact<T>(value: T, seen?: WeakSet<object>): T {
  if (typeof value === 'string') {
    return (isSensitiveString(value) ? REDACTED : value) as T;
  }
  if (typeof value !== 'object' || value === null) {
    return value;
  }
  const tracker = seen ?? new WeakSet<object>();
  if (tracker.has(value)) {
    return REDACTED as T;
  }
  tracker.add(value);
  if (Array.isArray(value)) {
    return value.map((entry) => redact(entry, tracker)) as T;
  }
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    out[key] = isSensitiveKey(key) ? REDACTED : redact(entry, tracker);
  }
  return out as T;
}

interface RequestStore {
  readonly requestId: string;
}

const requestStore = new AsyncLocalStorage<RequestStore>();

// Correlation ID for the current execution context, if any.
export function getRequestId(): string | undefined {
  return requestStore.getStore()?.requestId;
}

// Runs `fn` with `requestId` bound for `getRequestId()` lookups inside it
// (including transitively awaited work).
export function withRequestId<T>(requestId: string, fn: () => T): T {
  return requestStore.run({ requestId }, fn);
}

export function createLogger(options: CreateLoggerOptions): Logger {
  const service = options.service.trim();
  if (service.length === 0) {
    throw new Error('createLogger requires a non-empty service name.');
  }

  const emit = (level: LogLevel, message: string, fields?: LoggerFields): void => {
    try {
      const entry: Record<string, unknown> = {
        timestamp: new Date().toISOString(),
        level,
        service,
        message,
      };
      const requestId = fields?.requestId ?? getRequestId();
      if (requestId !== undefined) {
        entry['requestId'] = requestId;
      }
      if (fields?.userId !== undefined) {
        entry['userId'] = fields.userId;
      }
      if (fields?.route !== undefined) {
        entry['route'] = fields.route;
      }
      if (fields?.result !== undefined) {
        entry['result'] = fields.result;
      }
      if (fields?.code !== undefined) {
        entry['code'] = fields.code;
      }
      if (fields?.durationMs !== undefined) {
        entry['durationMs'] = fields.durationMs;
      }
      if (fields?.details !== undefined) {
        entry['details'] = redact(fields.details);
      }
      // Belt-and-braces: redact the assembled entry so a caller slip (e.g. a
      // secret smuggled into `details` under an innocent key shape) still
      // masks known-sensitive keys. Assembled keys above (timestamp, level,
      // service, requestId, userId, route, result, code, durationMs, message)
      // are none of them sensitive, so this cannot nuke legit fields.
      const line = JSON.stringify(redact(entry));
      if (level === 'error') {
        console.error(line);
      } else if (level === 'warn') {
        console.warn(line);
      } else {
        console.log(line);
      }
    } catch {
      // Logging must never throw (fail-open observability).
    }
  };

  return {
    info: (message, fields) => emit('info', message, fields),
    warn: (message, fields) => emit('warn', message, fields),
    error: (message, fields) => emit('error', message, fields),
  };
}
