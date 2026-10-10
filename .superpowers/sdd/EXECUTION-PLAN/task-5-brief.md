# Task 5 Brief — Cross-cutting: logging, errors, full health (Phase 1 steps 16,17,18)

## Source
EXECUTION-PLAN.md Phase 1 steps 16 (health web/db/storage/queue/worker), 17 (structured logging + request/correlation ID), 18 (standardized app errors + HTTP mapping).

## Requirements
1. `packages/shared/src/logging.ts`: `createLogger({ service })` with `info/warn/error` emitting JSON lines `{ timestamp, level, service, requestId?, userId?, route?, result?, code?, durationMs?, message }`; `getRequestId()` via AsyncLocalStorage (or explicit param passthrough if ALS unavailable in edge — document Node-only pilot); never log password/token/raw image/signed URL/PII (provide `redact()` helper masking those keys).
2. `packages/shared/src/errors.ts`: `AppError { code, message, status, details? }` + factories `badRequest/unauthorized/forbidden/notFound/conflict/unavailable/internal`; `toHttpResponse(err)` mapping to `{ error: { code, message } }` with status; unknown errors → 500 INTERNAL without leaking stack (stack only in server log).
3. Full health:
   - `apps/web/src/server/health.ts`: `checkHealth()` returning `{ ok, service: "web", checks: { database: {ok, latencyMs?}, storage: {ok}, queue: {ok}, worker: {ok} }, }`; each check fail-open with clear message (DB via getDb lightweight `select 1` with 2s timeout; storage via FilesystemStorage dir writable check; queue via outbox pending count or memory stub; worker via env flag/last-beat placeholder). Never throw — return ok:false with per-check detail.
   - Wire `apps/web/src/routes/api/health.ts` to `checkHealth()` (keep `ping()` fallback if checks unavailable? No — replace with checkHealth, keep TODO for worker beat in later phase).
   - `apps/worker/src/index.ts`: extend `start()` to expose `getWorkerHealth()` (or `lastBeat` timestamp updated in processMessage) consumed by health check via shared placeholder (file-based beat or in-memory export; document).
4. Re-export logging+errors from `packages/shared/src/index.ts`. Strict TS, eslint, prettier. Domain untouched except allowed error-type import? Keep domain dependency-free — errors live in shared, domain may import shared later (not now).
5. Moon lint/typecheck/build green offline (health DB check must skip/timeout gracefully without DB).

## Out of scope
- Vitest/Playwright/CI/README (Task 6). No Cloudflare. No git commit.

## Acceptance
- logging.ts, errors.ts exist with specified API; health.ts exists and route uses it.
- `moon run shared:lint shared:typecheck web:lint web:typecheck worker:lint` green.
- Failing DB (unreachable DATABASE_URL) yields health `{ ok:false, checks.database.ok:false }` not 500 throw (reviewable by code read + unit-less logic).
- No secret/PII logging (redact helper + no raw values in code).

## Report
Full report to `.superpowers/sdd/EXECUTION-PLAN/task-5-report.md`. Short contract reply.
