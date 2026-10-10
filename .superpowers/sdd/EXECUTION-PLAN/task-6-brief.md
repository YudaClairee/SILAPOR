# Task 6 Brief — Testing + CI via Moon + .env.example + README + docs fix (Phase 1 steps 20,21,22,24)

## Source
EXECUTION-PLAN.md Phase 1 steps 20 (Vitest, PG integration, Playwright), 21 (CI via Moon incl lint/typecheck/test/build; pilot skips Workers dry-run), 22 (.env.example + Wrangler example without secret — pilot: .env only, no wrangler), 24 (README local setup, Moon tasks, migration, worker, test). Plus deferred docs: monorepo-boundaries Rule 2 stale (jobs/storage/worker no longer depend on domain).

## Requirements
1. Vitest: root `vitest.config.ts` or per-package `vitest.config.ts` + `vitest` devDep where tests live. Minimum pure unit tests (must pass offline, no DB):
   - `packages/shared`: redact() masks password/token/email/nim + keeps benign; errors toHttpResponse mapping + unknown→500 no leak.
   - `packages/jobs`: MemoryQueue publish/size/readback.
   - `packages/storage`: filesystem put/get/remove + traversal reject (use /tmp override, never repo .data).
   - Keep tests fast, pristine output.
2. Integration test setup (gated, not required green here): `packages/database` test file (e.g. `src/db.integration.test.ts`) attempting getDb+migrate+seed double-run idempotency, but `describe.skipIf(!process.env.DATABASE_URL)` or try/catch skip with clear message. Must not fail offline.
3. Playwright: `playwright.config.ts` in apps/web (or root) with webServer `vite dev` + minimal spec `e2e/health.spec.ts` asserting `/api/health` 200 JSON has service web (fail-open ok false allowed offline). `pnpm --filter web run test:e2e` documented but NOT required green in CI here if browsers missing — config + spec enough, document `npx playwright install` step.
4. Moon tasks: ensure `test` runs vitest per package; add `test:e2e` task (non-cacheable, optional); CI workflow `.github/workflows/ci.yml`: install pnpm+node+moon, `moon run :lint :typecheck :build :test` (NOT workers dry-run per pilot). Keep deterministic cache for lint/typecheck/test/build.
5. `.env.example`: DATABASE_URL, PORT, STORAGE_DIR, STORAGE_ENDPOINT, WORKER_BEAT_FILE, no secrets. No wrangler file (pilot skip — document deferred).
6. README.md (root): local setup (pnpm install, docker compose up, db:migrate, db:seed, moon tasks, vite dev, worker dev, test, e2e, playwright install), Moon task commands, migration/seed, worker, testing, pilot Cloudflare-deferred note, health endpoint. Update `docs/monorepo-boundaries.md` Rule 2 to match reality (infra implements domain interfaces; jobs/storage/worker currently shared-only, database keeps domain dep for future repos).
7. Strict TS/eslint/prettier, no secrets, no Cloudflare, no git commit.

## Acceptance
- `moon run :lint :typecheck :build :test` green offline (integration skipped clearly, e2e not in default test).
- `.env.example`, `README.md`, `.github/workflows/ci.yml`, vitest configs + unit tests, playwright config+spec exist.
- docs/monorepo-boundaries Rule 2 fixed.

## Report
Full report to `.superpowers/sdd/EXECUTION-PLAN/task-6-report.md`. Short contract reply.
