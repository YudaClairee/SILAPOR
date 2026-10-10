# Task 4 Report — Drizzle schema + Kit + first migration + idempotent seed

Status: DONE_WITH_CONCERNS (concerns are informational; all acceptance criteria met)

## 1. What built (exactly per brief, no more)

**`packages/database` foundation (no Cloudflare/Hyperdrive anywhere):**

- `package.json`: deps add `drizzle-orm ^0.45.4`, `postgres ^3.4.9` (kept
  workspace `@silapor/domain` + `@silapor/shared`); devDeps add `drizzle-kit
  ^0.31.11`, `tsx ^4.23.15`, `@types/node ^26.6.5`. Scripts add
  `db:generate` (`drizzle-kit generate`), `db:migrate` (`tsx src/migrate.ts`),
  `db:seed` (`tsx src/seed.ts`). `lint`/`typecheck`/`test`/`build` unchanged,
  so the Task 1 moon pipeline stays green offline. `db:migrate`/`db:seed` are
  deliberately NOT moon tasks (they mutate a live DB and need secrets —
  non-cacheable per `.moon/tasks.yml` policy).
- `drizzle.config.ts` (new, package root): `DATABASE_URL` with default
  `postgres://silapor:silapor@localhost:5432/silapor` (matches
  `docker-compose.yml`), `schema: './src/schema.ts'`, `out: './drizzle'`,
  `dialect: 'postgresql'`.
- `src/schema.ts` (new): foundation tables only —
  `users` (`id` uuid pk `defaultRandom`, `email` unique, `name`, `role`
  pgEnum `REPORTER|ADMIN`, `is_active` default true, `created_at`/`updated_at`
  timestamptz default now) and `outbox_events` (`id` uuid pk, `type` text,
  `payload` jsonb, `status` pgEnum `PENDING|DISPATCHED|FAILED` default
  `PENDING`, `attempt_count` default 0, `available_at`/`created_at` default
  now, nullable `processed_at`) plus composite index
  `outbox_events_status_available_at_idx(status, available_at)`. Exports
  `User`/`NewUser`/`OutboxEvent`/`NewOutboxEvent` infer types. No
  `schema_migrations` table (drizzle journal handles it).
- `src/index.ts` (rewrote Task 1 stub): `getDb(connectionString?)` returning
  `{ db, close() }` (postgres.js, lazy — import never connects);
  `resolveDatabaseUrl()` (explicit arg → `getRuntimeConfig()` from
  `@silapor/shared` inside the function only, never at import time → local
  default); `redactDatabaseUrl()` (masks password in logs/errors);
  re-exports schema.
- `src/migrate.ts` (new): `runMigrations()` applies `./drizzle` (path resolved
  from `import.meta.url`, cwd-independent) via the drizzle postgres-js
  migrator; works on an empty DB (pure `CREATE TYPE/TABLE/INDEX`, no
  prerequisites). Direct-run guarded by `pathToFileURL(process.argv[1])` vs
  `import.meta.url`, so importing never runs or connects. Any failure throws /
  prints a credential-redacted message and exits 1.
- `src/seed.ts` (new): `seedDatabase()` upserts `admin@mock.upi.ac.id`
  (ADMIN) + `230001@upi.ac.id`, `230002@upi.ac.id` (REPORTER) via
  `onConflictDoUpdate` on `users.email` (name/role/`is_active`/timestamp
  refreshed on conflict), so a second run creates zero duplicates; pre-checks
  existence per email to log `inserted`/`updated` counts; read-only
  `outbox_events` count check (no inserts — no master import). Same `getDb()`,
  same redacted-error + exit-1 contract, same direct-run guard.
- `drizzle/0000_foundation.sql` + `drizzle/meta/0000_snapshot.json` +
  `drizzle/meta/_journal.json`: generated offline by `drizzle-kit generate
  --name foundation` (no live DB needed). SQL creates both enums, both tables,
  the email unique constraint, and the outbox composite index.
- `tsconfig.json`: `include` widened to `["src", "drizzle.config.ts"]` so
  `typecheck` actually covers the Kit config.

Out of scope respected: no full §7 entities, no TanStack UI, no
health/logging/errors (Task 5), no vitest/playwright/CI/README (Task 6), no
live-DB verification. No git commits (repo still has zero commits).
`packages/domain` untouched (never written; eslint boundary intact).

## 2. Commands + output

- `pnpm install` (after manifest edit) → exit 0, +15 packages (esbuild build
  already approved in Task 3, no new approval needed).
- `pnpm run db:generate --name foundation` → `drizzle/0000_foundation.sql`
  created offline, exit 0. Re-run `pnpm run db:generate` → "No schema changes,
  nothing to migrate" (idempotent; covers the `--check`/no-diff acceptance —
  drizzle-kit `generate` has no `--check` flag, so the re-run is the check).
- `prettier --write` on new/edited files → `migrate.ts`, `seed.ts`,
  `_journal.json` reformatted; `--check` after → clean (generated `.sql` left
  in drizzle-kit's own formatting; prettier has no SQL parser).
- `pnpm run lint` → exit 0. `pnpm run typecheck` → exit 0 after one fix (see
  self-review).
- Offline import smoke (`tsx -e`, `DATABASE_URL` unset): `index.ts` import +
  `getDb()` + `close()` ok with default URL; `migrate.ts`/`seed.ts` imports
  print ok with zero connection attempts.
- Negative-path (unreachable `DATABASE_URL=postgres://silapor:***@127.0.0.1:5433/…`,
  nothing listening): `db:migrate` → clear redacted message, exit 1;
  `db:seed` → clear redacted message, exit 1. Password never printed.
- `moon run database:lint database:typecheck database:build` → 3 completed,
  0 failed (also with `--force`). `moon run :lint :typecheck :build` → 30
  completed, 0 failed.
- `grep -rEn 'cloudflare|wrangler|hyperdrive'` over database manifest +
  sources + config → no matches.

## 3. Files changed

New: `packages/database/drizzle.config.ts`, `packages/database/src/schema.ts`,
`packages/database/src/migrate.ts`, `packages/database/src/seed.ts`,
`packages/database/drizzle/0000_foundation.sql`,
`packages/database/drizzle/meta/0000_snapshot.json`,
`packages/database/drizzle/meta/_journal.json`. Rewrote (stub→real):
`packages/database/src/index.ts`. Edited: `packages/database/package.json`,
`packages/database/tsconfig.json`, `pnpm-lock.yaml` (regen). Untouched:
`packages/domain/**`, `eslint.config.mjs`, `.moon/**`, all other packages.

## 4. Self-review

- Completeness: all 3 numbered requirements + all 6 acceptance checks pass
  (all six required paths exist; moon lint/typecheck/build green offline;
  generate re-run shows no diff; migration SQL reviewable with both tables +
  indexes; seed upsert-by-email reviewable without a live DB).
- Quality: strict TS (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`)
  + eslint + prettier pass. One strictness fix during work: array-destructured
  `count()` rows (`[{ value }]`) failed typecheck because indexed access may be
  `undefined`; replaced with `rows[0]?.value ?? 0`. Behavior verified at
  runtime as far as possible without a live DB (import purity, failure
  contract, exit codes, URL redaction) — not just by file existence.
- YAGNI: no Phase 2 entities, no `locked_at`/`last_error` outbox columns
  (§7 extras deferred with the queue consumer), no `updated_at` trigger, no
  moon tasks for DB-mutating scripts, no build-emit change.

## 5. Concerns

1. (naming, needs controller ack) Drizzle numbers the first migration `0000`,
   so the file is `drizzle/0000_foundation.sql`, not the brief's `0001_*`.
   Renaming to `0001_` would desync the `_journal.json` `idx` and break
   `migrate`/`generate`; the canonical generated name is kept intentionally.
2. (informational) No live-DB verification possible here (no postgres in env,
   per brief). `runMigrations`/`seedDatabase` are untested against a real
   server; first `docker compose up` + `db:migrate` + double `db:seed` run
   should confirm empty-DB migrate and zero-duplicate reseed.
3. (informational) `users` carries only `created_at`/`updated_at`; §7 extras
   (`external_user_id`, `nim`, `last_login_at`) arrive with the Phase 2 auth
   migration. `outbox_events` likewise omits `locked_at`/`last_error` until
   the Task 4-follow-up queue consumer needs claim semantics.
4. (informational) `@silapor/database` keeps the `@silapor/domain` workspace
   dep from the Task 1 stub though nothing imports it yet (mirrors the
   Task 3-noted pattern; repositories implementing domain interfaces will use
   it in Phase 2+).
