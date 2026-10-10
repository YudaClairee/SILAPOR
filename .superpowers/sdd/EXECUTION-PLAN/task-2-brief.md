# Task 2 Brief — Web scaffold + runtime config + error boundary (Phase 1 steps 4, 6, 10, 19-partial)

## Source
EXECUTION-PLAN.md Phase 1 steps 4 (scaffold TanStack Start TS), 6 (strict typecheck — already base, extend to web), 10 (runtime config abstraction), 19 (error boundary + not-found). Pilot note: SKIP step 5 (Cloudflare Vite plugin/Wrangler/nodejs_compat) and step 11 (wrangler types).

## Requirements
1. In `apps/web`, scaffold minimal TanStack Start (TypeScript) suitable for Node target:
   - Use installed TanStack Router/Start packages (add `@tanstack/react-router`, `@tanstack/react-start`, `@tanstack/router-plugin`, vite, react, react-dom). Keep versions consistent, no Cloudflare adapter, no wrangler.
   - `vite.config.ts` for Node (no cloudflare plugin). `app.config.ts` or start config if needed for TanStack Start.
   - `src/` structure at minimum: `src/routes/__root.tsx` (root layout + error boundary + not-found), `src/routes/index.tsx` (placeholder home), `src/routes/api/health.ts` (or start server route) returning `{ ok: true, service: "web" }` placeholder — full db/storage/queue checks land in Task 5, here web-only OK is enough with TODO comment.
   - Must satisfy existing per-project `tsc --noEmit`, `eslint .`, moon `lint/typecheck/build/test`.
2. Runtime config abstraction (no direct env/cloudflare access from domain/service):
   - Create in `packages/shared/src/config.ts` (or `apps/web/src/server/runtime-config.ts` re-exporting shared): `getRuntimeConfig()` reading Node `process.env` only on server; never `VITE_`-leak secrets; document that Workers bindings will be read per-request later (deferred, pilot Node only).
   - Env keys used now: `DATABASE_URL` (optional for health TODO), `STORAGE_ENDPOINT`, `PORT`. No secrets committed.
3. Error boundary + not-found (step 19):
   - Root route has `errorComponent`/`notFoundComponent` (or TanStack equivalent) with accessible markup, retry link, no stack leak to client.
   - Placeholder pages include loading/empty/error/forbidden/success states as static placeholders only (full UX in later phases) — at minimum root handles error + not-found.
4. Strictness + boundaries preserved:
   - No imports from `packages/database|storage|jobs|ai` inside `packages/domain` (don't touch domain).
   - Web route/server functions must call application service layer placeholder, not ORM directly — create `apps/web/src/server/services.ts` stub exporting `ping()` used by health route (establishes the boundary pattern).
   - No secrets, no Cloudflare deps, no `wrangler.*`, no `nodejs_compat`.
5. Moon wiring: `apps/web` moon.yml tasks still pass; `build` should run `vite build` (or `tsc && vite build`) successfully, not just echo. Other packages keep stubs.

## Out of scope
- Full health checks (Task 5), drizzle/compose/queue/storage impl (Tasks 3-4), CI/README (Task 6).
- DO NOT run git commit.

## Acceptance
- `pnpm install` green.
- `moon run web:lint web:typecheck web:build web:test` (or `moon run :lint :typecheck :build`) green.
- `pnpm --filter @silapor/web run build` produces dist/client (or vite output) without Cloudflare plugin.
- Health route file exists, returns web-ok JSON, contains TODO for Task 5 checks.
- Root route has error + not-found components.
- `grep -ri cloudflare|wrangler apps/web package.json pnpm-lock.yaml` shows zero app deps (eslint boundary text elsewhere is OK).
- No domain-boundary violation (`moon run domain:lint` green).

## Report
Full report to `.superpowers/sdd/EXECUTION-PLAN/task-2-report.md`. Reply short contract only, no SHAs.
