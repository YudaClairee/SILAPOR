# Task 6 Report — Testing + CI via Moon + .env.example + README + docs fix (Phase 1 steps 20,21,22,24)

Status: DONE_WITH_CONCERNS (concerns are informational; all acceptance criteria met)

## 1. What built (exactly per brief, no more)

**Vitest unit tests (offline-green, pure, fast):**

- `packages/shared/vitest.config.ts` (new): `environment: node`,
  `include: ['src/**/*.test.ts']`.
- `packages/shared/src/redact.test.ts` (new): `redact()` masks
  password/token/email/nim, keeps benign keys, masks nested objects/arrays,
  no false-positive on `author`. (One self-caught fix: initial draft used a
  `tokens` key, which is correctly masked by the substring rule — renamed to
  `items`.)
- `packages/shared/src/errors.test.ts` (new): all 7 `AppError` factories map
  to status/code/message; unknown `Error`/string/`null` throws map to generic
  500 `INTERNAL` with no leak (asserts secret input absent from output).
- `packages/jobs/vitest.config.ts` (new) + `src/memory.test.ts` (new):
  `MemoryQueue` starts empty, publish/size/readback in order, `clear()`.
- `packages/storage/vitest.config.ts` (new) + `src/filesystem.test.ts`
  (new): `FilesystemAttachmentStorage` put/get/remove round-trip (bytes +
  content type + sha256), missing-key `null`, traversal/absolute/empty-key
  rejection. Every test uses `mkdtemp` under `/tmp` — never the repo `.data/`.
- `packages/{shared,jobs,storage,database}/package.json`: `test` script is now
  `vitest run`; `vitest 5.0.3` added as exact devDep where tests live.

**Gated DB integration (not required green here, must not fail offline):**

- `packages/database/vitest.config.ts` (new) + `src/db.integration.test.ts`
  (new): `describe.skipIf(!process.env.DATABASE_URL)` around
  getDb+migrate+seed double-run idempotency (`runMigrations`, two
  `seedDatabase` calls, `totalUsers === 3`, no duplicates). Offline reports
  `1 skipped`, never failed. Static imports only (modules perform no I/O at
  import; postgres.js is lazy).

**Playwright (config + spec, not required green in CI):**

- `apps/web/playwright.config.ts` (new): `testDir ./e2e`, baseURL
  `http://localhost:3000`, `webServer { command: 'pnpm dev',
  url: 'http://localhost:3000/api/health', reuseExistingServer: true }`.
- `apps/web/e2e/health.spec.ts` (new): `GET /api/health → 200` with
  `service: "web"`; `ok` deliberately NOT asserted (fail-open `ok:false`
  allowed offline). `playwright test --list` confirms 1 test loads.
- `apps/web/package.json`: kept `test` as echo stub (no unit tests; keeps
  `moon run :test` browser-free) and added `test:e2e: playwright test`;
  `@playwright/test 1.64.0` devDep. `apps/web/tsconfig.json` include extended
  to `["src", "playwright.config.ts", "e2e"]` so strict TS covers the new
  files.

**Moon tasks:**

- `.moon/tasks.yml`: `test` inputs now include `vitest.config.ts`
  (deterministic cache preserved for lint/typecheck/test/build; verified
  `shared:test` resolved inputs contain the config).
- `apps/web/moon.yml`: new `test-e2e` task (`pnpm run test:e2e`,
  `options.cache: false`, inputs `e2e/**`, `playwright.config.ts`, `src/**`).
  Moon task ids cannot contain `:`, so `test-e2e` is the Moon wrapper for the
  pnpm script `test:e2e` (`moon run web:test-e2e`; `moon task` JSON confirms
  `cache: false`). E2E stays out of the default `test` pipeline.

**CI, env, docs:**

- `.github/workflows/ci.yml` (new): checkout → pnpm 11.21.0 → Node 24.18.0
  (pnpm cache) → `pnpm install --frozen-lockfile` → `pnpm exec moon run
  :lint :typecheck :build :test`. No Workers dry-run (pilot), no e2e, no DB
  services. YAML validated.
- `.env.example` (new): `DATABASE_URL`, `PORT`, `STORAGE_DIR`,
  `STORAGE_ENDPOINT`, `WORKER_BEAT_FILE` with dev defaults; no secrets; notes
  Wrangler is deferred (no wrangler file committed).
- `README.md` (new): local setup (install, compose, migrate, seed, Moon
  tasks, vite/worker dev, test, e2e + `npx playwright install`), Moon
  commands, migration/seed idempotency, worker beat, testing matrix (unit,
  gated integration, e2e), pilot Cloudflare-deferred note, health endpoint
  contract, config table.
- `docs/monorepo-boundaries.md` Rule 2 fixed: direction stays infra → domain;
  documents pilot reality — database/ai/analytics/auth depend on
  `@silapor/domain` (+ shared) for future ports, while jobs/storage/worker
  are currently shared-only and will implement domain-owned ports without
  flipping direction.

Out of scope respected: no Cloudflare/Wrangler implementation (only
deferred-notes in docs/env/README/CI), no secrets, no git commits.

## 2. Commands + output

- `pnpm add -D vitest@5.0.3 --filter shared/jobs/storage/database` → resolved
  351, done (offline store reuse where possible).
- `pnpm add -D @playwright/test@1.64.0 --filter @silapor/web` → resolved 354,
  done.
- `pnpm --filter {shared,jobs,storage,database} run typecheck` → 4 × exit 0
  under strict base (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`).
- `pnpm --filter @silapor/shared run test` → 2 files, 5 tests passed (after
  the `tokens`-key fix above).
- `pnpm --filter @silapor/jobs run test` → 1 file, 2 passed.
- `pnpm --filter @silapor/storage run test` → 1 file, 3 passed.
- `pnpm --filter @silapor/database run test` (no env) → 1 skipped, 0 failed.
- `pnpm --filter @silapor/web run typecheck` → exit 0 (covers
  playwright.config + e2e).
- `pnpm --filter @silapor/web exec playwright test --list` → 1 test in 1 file.
- `prettier --write` on all new/edited files → clean; `--check` after → all
  pass (`.env.example` has no prettier parser, expected — not checked).
- `eslint` on all new test/config/spec files → exit 0.
- `moon task web:test-e2e --json` → `cache: false` confirmed.
- `moon run :lint :typecheck :build :test` → **40 completed, 0 failed**
  (offline; `shared:test` 5 passed, `jobs:test` 2 passed, `storage:test` 3
  passed, `database:test` 1 skipped, `web:test` stub). Second run fully
  cached, still green.
- Hygiene: no `.data/` in repo; `grep` for cloudflare/wrangler hits only
  pilot-deferred notes; secret-like strings are synthetic test fixtures only
  (`hunter2` masking fixture, leak-assertion input); `git status` read-only,
  zero commits made.

## 3. Files changed

New: `packages/{shared,jobs,storage,database}/vitest.config.ts`,
`packages/shared/src/{redact,errors}.test.ts`,
`packages/jobs/src/memory.test.ts`,
`packages/storage/src/filesystem.test.ts`,
`packages/database/src/db.integration.test.ts`,
`apps/web/{playwright.config.ts,e2e/health.spec.ts}`,
`.github/workflows/ci.yml`, `.env.example`, `README.md`.
Edited: `packages/{shared,jobs,storage,database}/package.json` (test →
`vitest run` + devDeps), `apps/web/{package.json (test:e2e + playwright
dep), tsconfig.json (include e2e), moon.yml (test-e2e)}`,
`.moon/tasks.yml` (test inputs + comment), `docs/monorepo-boundaries.md`
(Rule 2), `pnpm-lock.yaml` (offline regen). Untouched: `packages/domain/**`,
all source implementations, `eslint.config.mjs`.

## 4. Self-review

- Completeness: all 7 numbered requirements + all 3 acceptance checks pass —
  vitest configs + offline-green unit tests exist per package, integration is
  gated-skip offline, playwright config+spec exist and list correctly, Moon
  `test` runs vitest with deterministic cache plus a non-cacheable e2e
  wrapper, CI runs exactly `:lint :typecheck :build :test` (no dry-run),
  `.env.example`/README/CI exist, Rule 2 matches `package.json` reality
  (verified per-package deps).
- Quality: strict TS + eslint + prettier pass on every new file; behavior
  verified at runtime offline (5+2+3 unit, 1 skipped integration, 1 listed
  e2e, 40-task Moon gate twice).
- YAGNI: no root vitest config (per-package is sufficient), no coverage
  thresholds, no `test:e2e` in CI, no wrangler file, no extra Moon tasks, no
  domain changes.

## 5. Concerns

1. (informational) Moon task ids cannot contain `:`, so the Moon wrapper is
   `test-e2e` (`moon run web:test-e2e`) for the pnpm script `test:e2e`
   (`pnpm --filter web run test:e2e` and the scoped form both resolve).
   Both names are documented in README and `apps/web/moon.yml`.
2. (informational) `apps/web` `test` stays an echo stub so `moon run :test`
   needs no browsers; unit coverage for web arrives with feature phases.
   Other stub packages (domain/ai/auth/analytics/worker) likewise stay echo
   until they gain tests — `test` inputs already include `vitest.config.ts`
   for the cutover.
3. (informational) E2E was validated with `playwright test --list` only;
   full browser runs need `npx playwright install` + `vite dev` and are
   intentionally outside CI in this phase.
4. (informational) `.env.example` `DATABASE_URL` carries the dev default
   `silapor:silapor` (same as `docker-compose.yml` and the code default) —
   not a secret; no other credentials are committed.
