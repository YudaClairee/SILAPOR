# Monorepo package boundaries (Task 1)

Source: EXECUTION-PLAN.md Phase 1 steps 7-9 + Phase 0 pilot note (Cloudflare skipped).

## Rule 1 — domain has zero deps on infra

`packages/domain` (entities, state machines, policies, use-case interfaces) MUST NOT import from:

- `apps/*` (TanStack Start app, worker entrypoint),
- `packages/database`, `packages/storage`, `packages/jobs`, `packages/ai`,
- framework/infra libraries: TanStack, Cloudflare, Drizzle, OpenRouter.

Enforcement: `eslint.config.mjs` (`no-restricted-imports` scoped to `packages/domain/**/*.ts`,
covering both bare specifiers and relative-path escapes). Verified in Task 1 report by
adding a forbidden import and observing lint failure.

`packages/domain/package.json` also declares no workspace dependencies.

## Rule 2 — infra implements domain-owned interfaces

Dependency direction is always infra -> domain, never domain -> infra:
`packages/domain` declares no workspace dependencies and the eslint boundary
stays green.

Current wiring (pilot reality):

- `packages/database` keeps its `@silapor/domain` (+ `@silapor/shared`)
  `workspace:*` dependency for the future repositories/ports that will
  implement domain-owned interfaces.
- `packages/ai`, `packages/analytics`, `packages/auth` likewise depend on
  `@silapor/domain` (+ `@silapor/shared`).
- `packages/jobs` and `packages/storage` are currently `@silapor/shared`-only
  (no domain dependency yet): the queue contract and the attachment-storage
  port are stable with no domain types to import today. When domain-owned
  ports land, these packages will implement them without ever flipping the
  dependency direction.
- `apps/worker` is likewise `@silapor/jobs` + `@silapor/shared`-only for now.

In short: infra packages implement interfaces owned by the domain/app layer
(ports); each infra package depends on `@silapor/domain` where it needs
domain types today (database/ai/analytics/auth) and on `@silapor/shared`
alone where it does not yet (jobs/storage/worker).

## Rule 3 — shared is dependency-free

`packages/shared` (validation, config, errors, logging primitives) depends on no
workspace package, so both domain and infra can use it without cycles.

## Rule 4 — apps compose, never bypass

`apps/web` and `apps/worker` depend on workspace packages (currently domain + shared;
more as later tasks land). Routes/server functions call application services, never
the ORM directly. Pilot note: NO Cloudflare/Wrangler deps anywhere in this task.
