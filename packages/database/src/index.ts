// Database client factory (Task 4). Node-only, postgres.js driver.
//
// No environment is read at import time: callers pass an explicit connection
// string, otherwise `getRuntimeConfig()` (from @silapor/shared) is consulted
// inside the function and the local-dev default is used as a last resort.
// Importing this module never opens a connection (postgres.js is lazy).

import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { getRuntimeConfig } from '@silapor/shared';
import * as schema from './schema.js';

export const DEFAULT_DATABASE_URL = 'postgres://silapor:silapor@localhost:5432/silapor';

export interface DatabaseConnection {
  readonly db: PostgresJsDatabase<typeof schema>;
  close(): Promise<void>;
}

// Explicit arg wins; empty/whitespace-only falls through to runtime config,
// then to the local-dev default. Never throws for a missing DATABASE_URL —
// connection errors surface on first query / migrate / seed instead.
export function resolveDatabaseUrl(explicit?: string): string {
  if (explicit !== undefined && explicit.trim() !== '') {
    return explicit;
  }
  const fromConfig = getRuntimeConfig().databaseUrl;
  if (fromConfig !== undefined && fromConfig.trim() !== '') {
    return fromConfig;
  }
  return DEFAULT_DATABASE_URL;
}

// Redacts the password so URLs are safe to print in logs and error messages.
export function redactDatabaseUrl(url: string): string {
  return url.replace(/(:\/\/[^/:@]+:)[^@]+(@)/, '$1***$2');
}

export function getDb(connectionString?: string): DatabaseConnection {
  const url = resolveDatabaseUrl(connectionString);
  const sql = postgres(url, { max: 10 });
  const db = drizzle(sql, { schema });
  return {
    db,
    async close(): Promise<void> {
      await sql.end();
    },
  };
}

export * from './schema.js';
export * from './sessions.js';
export * from './master-data.js';
