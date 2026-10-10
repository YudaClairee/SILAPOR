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
    it(
      'migrate + double seed is idempotent',
      // Full master seed touches ~560 rows over ~1700 sequential
      // statements; needs headroom above the 5s vitest default.
      { timeout: 120_000 },
      async () => {
        const url = process.env['DATABASE_URL'] as string;
        await runMigrations(url);
        const first = await seedDatabase(url);
        const second = await seedDatabase(url);
        // 3 seed users (admin + 2 reporters) regardless of master-data growth.
        expect(first.totalUsers).toBe(3);
        expect(second.totalUsers).toBe(3);
        // Master data spans users + categories + issue types + locations +
        // assets + technicians, so one run touches far more than 3 rows.
        expect(first.inserted + first.updated).toBeGreaterThan(3);
        // Second run touches the same rows but inserts nothing new.
        expect(second.inserted).toBe(0);
        expect(second.inserted + second.updated).toBe(first.inserted + first.updated);
      },
    );
  },
);
