// Migration runner (Task 4). Applies ./drizzle SQL to an empty or
// existing PostgreSQL via the drizzle postgres-js migrator.
//
// NOTE (P2-1): a local DB volume with only 0000_foundation applied must be
// reset with `docker compose down -v` before migrating to the P2-1 chain
// (do NOT run it here — operator action only).
//
// Importing this module performs no I/O. Run directly:
//   pnpm --filter @silapor/database run db:migrate
// Exits non-zero with a clear (credential-redacted) message when
// DATABASE_URL is unreachable or the migration folder is unreadable.

import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { getDb, redactDatabaseUrl, resolveDatabaseUrl } from './index.js';

function migrationsFolder(): string {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'drizzle');
}

export async function runMigrations(connectionString?: string): Promise<void> {
  const url = resolveDatabaseUrl(connectionString);
  const { db, close } = getDb(url);
  try {
    await migrate(db, { migrationsFolder: migrationsFolder() });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `db:migrate failed: unable to apply migrations to PostgreSQL at ` +
        `${redactDatabaseUrl(url)}. Is the database running and DATABASE_URL correct? ` +
        `Underlying error: ${detail}`,
    );
  } finally {
    await close();
  }
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) {
    return false;
  }
  try {
    return pathToFileURL(entry).href === import.meta.url;
  } catch {
    return false;
  }
}

if (isDirectRun()) {
  const url = process.env['DATABASE_URL'];
  runMigrations(url)
    .then(() => {
      console.log(
        `db:migrate: migrations applied (${redactDatabaseUrl(resolveDatabaseUrl(url))}).`,
      );
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
