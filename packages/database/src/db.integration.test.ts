// Gated PostgreSQL integration (Task 6). Skipped offline: without
// `DATABASE_URL` this file reports a single skip and never fails. With
// `DATABASE_URL` set it proves migrate + double-seed idempotency against a
// live database (docker compose up).
import { describe, expect, it } from 'vitest';
import { runMigrations } from './migrate.js';
import { seedDatabase } from './seed.js';

const hasDatabaseUrl =
  typeof process.env['DATABASE_URL'] === 'string' && process.env['DATABASE_URL'].trim().length > 0;

describe.skipIf(!hasDatabaseUrl)(
  'database integration (requires DATABASE_URL; skipped offline)',
  () => {
    it('migrate + double seed is idempotent', async () => {
      const url = process.env['DATABASE_URL'] as string;
      await runMigrations(url);
      const first = await seedDatabase(url);
      const second = await seedDatabase(url);
      expect(first.totalUsers).toBe(3);
      expect(second.totalUsers).toBe(3);
      expect(first.inserted + first.updated).toBe(3);
      expect(second.inserted + second.updated).toBe(3);
    });
  },
);
