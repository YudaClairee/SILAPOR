# Task 5 Report — Cross-cutting: logging, errors, full health (Phase 1 steps 16,17,18)

Status: DONE_WITH_CONCERNS (concerns are informational; all acceptance criteria met)

## 1. What built (exactly per brief, no more)

**`packages/shared` — logging (`src/logging.ts`, new):**

- `createLogger({ service })` with `info/warn/error` emitting single JSON lines
  `{ timestamp, level, service, requestId?, userId?, route?, result?, code?,
  durationMs?, details?, message }` to `console.log/warn/error` respectively.
  Empty service names throw at construction (init-time, never request-path).
  Emit is wrapped so logging never throws (fail-open observability).
- Correlation: `getRequestId()` via `node:async_hooks` AsyncLocalStorage;
  `withRequestId(id, fn)` binds it (including transitively awaited work);
  explicit per-call `requestId` always wins over ALS. Documented Node-only
  pilot — no edge/Workers support; ALS-unavailable callers pass `requestId`
  explicitly.
- `redact(value)` deep-clones and masks `[REDACTED]`: exact normalised keys
  (password/passwd/secret/token/access/refresh/id-token, authorization,
  apikey, session, cookie, signedUrl, image/picture/photo/avatar, base64,
  buffer/bytes/blob/file, nim, email, phone, address, dob, nik, …) plus
  substring fallback for compound keys (deliberately not bare `auth`, which
  would false-positive on `author`), plus shape-based string redaction
  (`data:image/…`, `X-Amz-Signature/Credential`, `?signature=`). Circular
  refs collapse to `[REDACTED]`. The assembled log entry is re-redacted
  belt-and-braces (assembled keys are none of them sensitive). `userId` is
  documented as opaque account ID only — never email/NIM.

**`packages/shared` — errors (`src/errors.ts`, new, dependency-free):**

- `AppError extends Error { code, message, status, details? }` with `code` in
  `BAD_REQUEST | UNAUTHORIZED | FORBIDDEN | NOT_FOUND | CONFLICT |
  UNAVAILABLE | INTERNAL`.
- Factories `badRequest(400)/unauthorized(401)/forbidden(403)/notFound(404)/
  conflict(409)/unavailable(503)/internal(500)`, each `(message?, details?)`.
- `isAppError()` guard; `toHttpResponse(err)` → `{ status, body: { error: {
  code, message } } }`; unknown throws (Error/string/anything) → generic 500
  `INTERNAL`/`Internal server error` with no stack, SQL, paths, or provider
  output. Header comment directs stacks to `createLogger().error(...)` and
  requires `details` pre-sanitised via `redact()`. Deliberately does NOT
  import `./logging` so it stays edge-compatible (no `node:async_hooks`
  pull-through).
- `src/index.ts`: added `export * from './logging'`, `'./errors'`,
  `'./worker-beat'` (config re-export untouched).

**`packages/shared` — worker beat placeholder (`src/worker-beat.ts`, new):**

- File-based beat (web and worker are separate processes; in-memory cannot
  cross them): `{ beatAt, pid }` only — no payloads, no secrets.
- `resolveWorkerBeatFile()` (explicit → `WORKER_BEAT_FILE` env → default
  `./.data/worker-beat.json`), `recordWorkerBeat()`, `readWorkerBeat()` (null
  on missing/unreadable/malformed — never throws), `workerBeatAgeMs()`,
  `WORKER_BEAT_MAX_AGE_MS = 5min` (placeholder threshold until broker loop
  defines liveness SLOs). Documents root-cwd operation or shared absolute
  `WORKER_BEAT_FILE`.

**Web health (`apps/web/src/server/health.ts`, new):**

- `checkHealth(): Promise<HealthResult>` → `{ ok, service: 'web', checks: {
  database, storage, queue, worker } }`, each `{ ok, message, latencyMs? }`.
  `ok` is the AND of all four. Never throws (per-check try/catch plus a
  top-level fallback returning all-false health).
- database: `getDb()` (import never connects — postgres.js lazy) + `SELECT 1`
  via `db.execute(string)` (no `drizzle-orm` import needed in web) with 2s
  `Promise.race` timeout; `close()` in `finally`; message carries no
  credentials/URL; `latencyMs` recorded on success and failure.
- storage: real writable proof via `FilesystemAttachmentStorage`
  (`resolveStorageDir()` → unique `__health__/<uuid>` put with 2s timeout →
  best-effort remove).
- queue: pilot memory stub — one `MemoryQueue.publish()` of a
  `NOTIFICATION_DISPATCH` health message (durable outbox count deferred with
  the broker loop; stated in the message).
- worker: `readWorkerBeat()` → missing/invalid/stale(>5min)/fresh verdicts.

**Route wiring (`apps/web/src/routes/api/health.ts`, rewrote Task 2 stub):**

- `ping()` replaced with `checkHealth()` (services.ts `ping()` left untouched).
  Zero-arg `GET` (proven handler shape) wrapped in
  `withRequestId(randomUUID(), …)`; `createLogger({ service: 'web' })` logs
  start/complete with `route`/`result`/`durationMs`. Always answers HTTP 200
  with the `ok` flag (fail-open for load-balancers); defensive catch returns
  health-shaped 200 (not 500) and logs `code: 'INTERNAL'`. TODO kept for live
  worker-beat integration with the broker loop.
- `apps/web/package.json`: added `workspace:*` deps `@silapor/database`,
  `@silapor/jobs`, `@silapor/storage` (web composes infra at the transport
  layer); `pnpm install --offline` relinked (resolved 335, downloaded 0,
  added 0); lockfile records `link:../../packages/*`.

**Worker beat (`apps/worker/src/index.ts`, rewrote Task 3 stub shape kept):**

- Module-level `lastBeatAt` + `processedCount`; `getLastBeat()`,
  `getWorkerHealth(): { ok, lastBeat, message }` (false until first beat).
  `start()` now returns `{ stop, getWorkerHealth }` and records a `start`
  beat; `processMessage()` logs via shared logger (type + id only, never
  payloads) and refreshes both in-memory beat and beat file. Beat writes are
  best-effort (`WORKER_BEAT_WRITE_FAILED` warn, never fail processing).
  `main()`/SIGINT/SIGTERM/direct-run guard unchanged.

Out of scope respected: no Vitest/Playwright/CI/README (Task 6), no
Cloudflare, no domain writes (see §4), no git commits (repo still zero
commits; verification via `git status` reads only).

## 2. Commands + output

- `pnpm install --offline` (after web manifest edit) → exit 0, "Already up to
  date", symlinks `apps/web/node_modules/@silapor/{database,jobs,storage}`
  confirmed.
- `prettier --write` on all new/edited files → 2 reformatted (errors.ts,
  worker-beat.ts long lines); `--check` after → clean.
- `eslint` on all touched sources → exit 0 (no output).
- `pnpm --filter {shared,worker,web} run typecheck` → each exit 0 under
  strict base (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`;
  no `any`, no `undefined`-assignment on optional props — conditional spreads
  used throughout).
- `moon run shared:lint shared:typecheck web:lint web:typecheck worker:lint
  worker:typecheck` → 6 completed, 0 failed.
- `moon run :lint :typecheck :build` → 30 completed (27 cached), 0 failed,
  offline (`web:build` vite ✓ 642ms).
- Runtime smoke 1 (`tsx`, shared only): redact masks
  password/accessToken/email/nim/nested api_key/phone/data-URL/signed-URL and
  keeps benign keys; logger emits JSON lines with `service/level/timestamp`
  and ALS `requestId` (explicit wins, cleared outside); all 7 factories map
  to code+status; `new Error('super secret stack here')` and a string throw
  both → generic 500 with no leak. `SMOKE1 OK`.
- Runtime smoke 2 (unreachable
  `DATABASE_URL=postgres://silapor:wrongpass@127.0.0.1:5433/…`, nothing
  listening): `checkHealth()` → `{ ok:false, service:'web',
  database:{ok:false, message:'database unavailable: Failed query: SELECT
  1…', latencyMs:25}, storage:{ok:true,…}, queue:{ok:true,…},
  worker:{ok:false, beat-not-found} }` in 30ms — no throw, no credential
  leak, well under the 2s bound. `SMOKE2 OK`.
- Runtime smoke 3 (`WORKER_BEAT_FILE=/tmp/…/silapor-beat3.json`):
  `getLastBeat()` null → `start()` writes beat → `processMessage()` →
  `{ok:true,…}` → `getWorkerHealth()` true → web `checkHealth().worker`
  `{ok:true, 'beat fresh (17ms ago)'}`; beat file contains only
  `{"beatAt":"…","pid":…}`. `SMOKE3 OK` (one self-inflicted assertion typo
  about the `(1 processed)` message fixed in the throwaway script, not in
  shipped code).
- `grep` for secrets in shipped messages: health/worker messages contain no
  URLs, passwords, or tokens (paths and `port=` only).
- Repo hygiene: no `.data/` created in repo (smokes used `/tmp` overrides);
  `git status` shows zero tracked modifications; no `packages/domain` paths.

## 3. Files changed

New: `packages/shared/src/logging.ts`, `packages/shared/src/errors.ts`,
`packages/shared/src/worker-beat.ts`, `apps/web/src/server/health.ts`.
Rewrote (stub→real): `apps/web/src/routes/api/health.ts`,
`apps/worker/src/index.ts`. Edited: `packages/shared/src/index.ts`
(+3 re-exports), `apps/web/package.json` (+3 workspace deps),
`pnpm-lock.yaml` (workspace links, offline regen). Untouched:
`packages/domain/**` (never written), `apps/web/src/server/services.ts`
(`ping()` kept), `eslint.config.mjs`, `.moon/**`, all other packages.

## 4. Self-review

- Completeness: all 4 numbered requirements + all 4 acceptance checks pass —
  `logging.ts`/`errors.ts` expose the specified APIs, `health.ts` exists and
  the route uses it (verified by import + runtime, not just file existence);
  the 5 moon tasks from the brief plus `worker:typecheck` are green;
  unreachable-DB health returns `ok:false/database.ok:false` without throwing
  (smoke 2 output above); redact + no-raw-values discipline covers the
  secret/PII rule (smoke 1 + message grep).
- Quality: strict TS + eslint + prettier pass; behavior verified at runtime
  offline (redaction matrix, ALS + explicit override, 7 error mappings +
  unknown-throw paths, DB-failover timing/shape, beat round-trip
  worker→web). No tests committed — brief defers them to Task 6.
- YAGNI: no outbox-count query (memory stub with documented deferral), no
  `x-request-id` header plumbing (see concern 1), no `drizzle-orm` import in
  web (plain-string `execute`), no AppError wiring into future mutation
  routes (health stays health-shaped fail-open), no domain imports of shared
  yet, no build-emit changes.

## 5. Concerns

1. (informational) The health `GET` handler takes no event argument (the
   proven Task 2 shape) and mints `requestId = randomUUID()` per call. An
   incoming `x-request-id` is therefore not yet honoured; `withRequestId`
   already supports explicit passthrough, so a later phase can forward the
   header once the TanStack Start handler event type is pinned — no API
   change needed in `shared`.
2. (informational) Beat/storage defaults are cwd-relative (`./.data/…`,
   git-ignored, same convention as Task 3 storage). Pilot operators must run
   web + worker from the repo root or set absolute `WORKER_BEAT_FILE` /
   `STORAGE_DIR`; both the beat module header and the worker-missing health
   message (which prints the configured path) say so.
3. (informational) Overall health is `false` offline by design (DB down + no
   worker beat) while the route stays HTTP 200 fail-open. If operators prefer
   503-on-degraded for alerting, it is a one-line change in the route; the
   `ok` flag contract is unchanged either way.
4. (informational) Queue health is a genuine `MemoryQueue` round-trip but
   only proves the in-memory port — the durable outbox pending-count check
   arrives with the Task 4-follow-up broker loop, as the message string
   states.
