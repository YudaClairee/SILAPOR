// Runtime config abstraction (Task 2).
//
// Pilot note (2026-10-10): Node-only. Server code reads `process.env` ONLY
// through `getRuntimeConfig()` in this module. Domain/service layers must
// never touch `process.env`, `VITE_*` client vars, or Cloudflare bindings
// directly. Workers bindings (deferred until after the pilot) will be read
// per-request at the transport layer and passed in — never leaked into the
// client bundle. No secrets are committed here; all values come from the
// environment at runtime.

export interface RuntimeConfig {
  readonly port: number;
  readonly databaseUrl: string | undefined;
  readonly storageEndpoint: string | undefined;
  // SSO provider selector (Phase 2 P2-3). Reads AUTH_PROVIDER, defaults to
  // 'mock'; 'mock' is the only pilot value. This accessor never throws for
  // 'mock' — unknown values pass through untouched and the caller (web auth
  // routes via getSsoProvider) decides how to surface them, including any
  // warning logs.
  readonly authProvider: string;
}

const DEFAULT_PORT = 3000;
const DEFAULT_AUTH_PROVIDER = 'mock';

type EnvName = 'DATABASE_URL' | 'STORAGE_ENDPOINT' | 'PORT' | 'AUTH_PROVIDER';

function readEnv(name: EnvName): string | undefined {
  if (typeof process === 'undefined' || process.env === undefined) {
    return undefined;
  }
  const value = process.env[name];
  return value === '' ? undefined : value;
}

function parsePort(raw: string | undefined): number {
  if (raw === undefined) {
    return DEFAULT_PORT;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : DEFAULT_PORT;
}

// Server-only. Throws when called in the browser so secrets/ports can never
// be evaluated (or bundled) on the client.
export function getRuntimeConfig(): RuntimeConfig {
  if (typeof process === 'undefined' || process.env === undefined) {
    throw new Error('getRuntimeConfig() must only be called on the server.');
  }
  return {
    port: parsePort(readEnv('PORT')),
    databaseUrl: readEnv('DATABASE_URL'),
    storageEndpoint: readEnv('STORAGE_ENDPOINT'),
    authProvider: readEnv('AUTH_PROVIDER') ?? DEFAULT_AUTH_PROVIDER,
  };
}
