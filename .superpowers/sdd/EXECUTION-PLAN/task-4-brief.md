# Task 4 Brief — Drizzle schema + Kit + first migration + idempotent seed (Phase 1 steps 14, 23)

## Source
EXECUTION-PLAN.md Phase 1 steps 14 (Drizzle schema, Kit, first migration), 23 (idempotent seed). Data model §7 + master CSVs in data/master/ as reference (do NOT import all rows now — foundation only).

## Requirements
1. In `packages/database`:
   - Deps: `drizzle-orm`, `postgres` (or `pg`), devDeps `drizzle-kit`, `tsx`, `@types/node`. No Cloudflare/Hyperdrive.
   - `drizzle.config.ts` reading `DATABASE_URL` (default `postgres://silapor:silapor@localhost:5432/silapor`), schema `./src/schema.ts`, out `./drizzle`.
   - `src/schema.ts`: minimal foundation tables only (full §7 entities land in Phase 2; here prove migration chain works):
     - `users` (id uuid pk default random, email unique, name, role `REPORTER|ADMIN`, is_active default true, timestamps).
     - `outbox_events` (id uuid pk, type text, payload jsonb, status `PENDING|DISPATCHED|FAILED` default PENDING, attempt_count int default 0, available_at timestamptz default now, created_at default now, processed_at nullable). Matches jobs contract table name.
     - `schema_migrations` NOT needed (drizzle journal handles it).
   - `src/index.ts`: `getDb(connectionString)` returning drizzle client + `close()`. No direct env read at import time (accept param, fallback to getRuntimeConfig from shared inside function only).
   - `src/migrate.ts`: runner invoking drizzle-kit/migrator against `./drizzle` (or node-postgres migration using generated SQL). Must work on empty DB; failure message clear if DATABASE_URL unreachable (do NOT crash import).
   - `drizzle/` first migration SQL generated (or hand-written if generation needs live DB): `0001_foundation.{sql,snapshot}` creating both tables + indexes (users.email unique, outbox status+available_at).
   - Scripts: `db:generate` (drizzle-kit generate), `db:migrate` (tsx src/migrate.ts), moon tasks wire-up but keep Task 1 pipeline green.
2. Seed (step 23) in `packages/database/src/seed.ts` + `apps/worker` or database script `db:seed`:
   - Idempotent: upsert admin `admin@mock.upi.ac.id` (ADMIN) + reporters `230001@upi.ac.id`, `230002@upi.ac.id` (REPORTER) by email; running twice creates zero duplicates (verify via onConflictDoNothing/Update).
   - Uses same `getDb()`; logs counts; exits non-zero with clear message if DB unreachable (do NOT hide).
   - NO full master import (locations/categories/assets in Phase 2); seed only users + no-op outbox check.
3. Strict TS, eslint, prettier. Domain untouched. No secrets. No git commit. Moon lint/typecheck/build green without live DB (migrate/seed only run when DATABASE_URL set; unit `tsc` must pass offline).

## Out of scope
- Full §7 entities, TanStack UI, health/logging/errors (Task 5), vitest/playwright/CI/README (Task 6). No live DB verification here (no postgres in env).

## Acceptance
- `packages/database/drizzle.config.ts`, `src/schema.ts`, `src/index.ts`, `src/migrate.ts`, `src/seed.ts`, `drizzle/0001_*` exist.
- `moon run database:lint database:typecheck database:build` green offline.
- `pnpm --filter @silapor/database run db:generate --check` (or drizzle-kit check) shows no diff (or documents why generation needs DB).
- Code review can read migration SQL and confirm users+outbox tables + indexes.
- Seed file contains idempotent upsert by email (reviewable without live DB).

## Report
Full report to `.superpowers/sdd/EXECUTION-PLAN/task-4-report.md`. Short contract reply.
