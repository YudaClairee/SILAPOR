// Idempotent seed (Task 4, Phase 1 step 23). Users only — no master import
// (locations/categories/assets arrive in Phase 2).
//
// Upserts one ADMIN + two REPORTERs keyed by username (NIM-style for
// reporters), so running twice creates zero duplicates. Also performs a
// read-only outbox sanity check (expects an empty table on a fresh DB,
// never inserts).
//
// Importing this module performs no I/O. Run directly:
//   pnpm --filter @silapor/database run db:seed
// Exits non-zero with a clear (credential-redacted) message when
// DATABASE_URL is unreachable.

import { pathToFileURL } from 'node:url';
import { count, eq, inArray } from 'drizzle-orm';
import { getDb, redactDatabaseUrl, resolveDatabaseUrl } from './index.js';
import { outboxEvents, users } from './schema.js';

interface SeedUser {
  readonly username: string;
  readonly role: 'ADMIN' | 'REPORTER';
}

const SEED_USERS: readonly SeedUser[] = [
  { username: 'admin', role: 'ADMIN' },
  { username: '230001', role: 'REPORTER' },
  { username: '230002', role: 'REPORTER' },
];

export interface SeedResult {
  readonly inserted: number;
  readonly updated: number;
  readonly totalUsers: number;
  readonly outboxEvents: number;
}

export async function seedDatabase(connectionString?: string): Promise<SeedResult> {
  const url = resolveDatabaseUrl(connectionString);
  const { db, close } = getDb(url);
  try {
    let inserted = 0;
    let updated = 0;
    for (const seedUser of SEED_USERS) {
      const existing = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.username, seedUser.username));
      if (existing.length === 0) {
        inserted += 1;
      } else {
        updated += 1;
      }
      await db
        .insert(users)
        .values({
          username: seedUser.username,
          role: seedUser.role,
          isActive: true,
        })
        .onConflictDoUpdate({
          target: users.username,
          set: { role: seedUser.role, isActive: true, updatedAt: new Date() },
        });
    }

    const totalRows = await db
      .select({ value: count() })
      .from(users)
      .where(
        inArray(
          users.username,
          SEED_USERS.map((user) => user.username),
        ),
      );
    const totalUsers = totalRows[0]?.value ?? 0;
    const outboxRows = await db.select({ value: count() }).from(outboxEvents);
    const outboxEventsCount = outboxRows[0]?.value ?? 0;

    return { inserted, updated, totalUsers, outboxEvents: outboxEventsCount };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `db:seed failed: unable to reach PostgreSQL at ${redactDatabaseUrl(url)}. ` +
        `Is the database running and DATABASE_URL correct? Underlying error: ${detail}`,
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
  seedDatabase(url)
    .then((result) => {
      console.log(
        `db:seed: upserted ${result.inserted + result.updated} users ` +
          `(inserted=${result.inserted}, updated=${result.updated}, ` +
          `seed usernames present=${result.totalUsers}, outbox_events=${result.outboxEvents}).`,
      );
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
