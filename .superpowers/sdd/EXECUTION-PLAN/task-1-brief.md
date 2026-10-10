# Task 1 Brief — Monorepo bootstrap (Phase 1 steps 1-3, 6-9)

## Source
EXECUTION-PLAN.md Phase 1, steps 1,2,3,6,7,8,9 + pilot note (skip Cloudflare).

## Requirements (exact, verbatim where plan mandates)
1. Init `pnpm` workspace with members `apps/web`, `apps/worker`, and packages: `packages/domain`, `packages/database`, `packages/auth`, `packages/storage`, `packages/jobs`, `packages/ai`, `packages/analytics`, `packages/shared`.
   - Create `pnpm-workspace.yaml` listing them.
   - Root `package.json` with `packageManager: pnpm@11.21.0`, engines node >=20, scripts delegating to moon (`lint`, `typecheck`, `test`, `build`).
2. Add `@moonrepo/cli` (v2.x, match installed moon 2.2.1) as root devDependency, init Moonrepo config:
   - `.moon/workspace.yml`, `.moon/toolchains.yml` (node 24.18.0, pnpm 11.21.0), `.moon/tasks.yml` with default pipeline.
   - Register `apps/*` and `packages/*` as Moon projects via workspace globs (do NOT list one-by-one if glob supported; ensure `moon query projects` finds all).
3. Strict type checking workspace-wide: root `tsconfig.base.json` with `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`, `noEmit`, `skipLibCheck: true`; per-package `tsconfig.json` extending it.
4. Formatter + linter + import boundaries + standard scripts:
   - Prettier config, ESLint (flat) with import-boundary rule: `packages/domain` MUST NOT import from framework/infra (`apps/*`, `packages/database`, `packages/storage`, `packages/jobs`, `packages/ai`, TanStack/Cloudflare/Drizzle/OpenRouter). Enforce via eslint no-restricted-imports or boundary plugin.
   - Standard scripts per package: `lint`, `typecheck`, `test`, `build` (may be stub `echo` initially but must exist for moon tasks).
5. Moon tasks for `lint`, `typecheck`, `test`, `build` with deps like `^:build`, `^:typecheck` where relevant; deterministic tasks cacheable (no DB/secret/external).
6. Package dependency rules documented (domain has zero deps on infra; database/storage/jobs/ai implement interfaces owned by domain/app layer).

## Out of scope for this task
- NO TanStack Start scaffold (Task 2), NO Drizzle schema (Task 4), NO compose/infra (Task 3), NO logging/errors (Task 5), NO CI/README (Task 6).
- NO Cloudflare plugin/Wrangler (skipped per pilot).
- DO NOT run `git commit` (user forbids commits). Leave working tree dirty.

## Acceptance
- `pnpm install` succeeds.
- `moon query projects` (or `pnpm moon query projects`) lists apps/web, apps/worker + all packages.
- `moon run lint typecheck build` (or per-project) passes on empty stubs.
- `pnpm --filter @silapor/domain exec tsc --noEmit` passes (or equivalent moon task).
- Import boundary test: adding a forbidden import in domain fails lint (demonstrate in report how verified).
- No secrets, no cloudflare deps.

## Report
Write full report to `.superpowers/sdd/EXECUTION-PLAN/task-1-report.md` (what built, test commands+output, files changed, self-review, concerns). Reply short contract only.
