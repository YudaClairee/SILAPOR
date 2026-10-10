# Task 3 Report — Local infra: compose + queue/storage abstraction + worker entry

Status: DONE_WITH_CONCERNS (concerns are informational; all acceptance criteria met)

## 1. What built (exactly per brief, no more)

**`docker-compose.yml` (new, root, documented-only):**

- Services `postgres` (`postgres:16`, db/user `silapor`, port `5432`, volume
  `pgdata`, healthcheck `pg_isready -U silapor -d silapor`) and `minio`
  (`minio/minio`, `server /data --console-address ':9001'`, ports `9000`/`9001`,
  volume `minio-data`, `MINIO_ROOT_USER/PASSWORD=minioadmin` via env,
  healthcheck `curl -f http://localhost:9000/minio/health/live`). Named volumes
  `pgdata`, `minio-data`.
- Header documents: no-docker-env constraint, `up -d`/`down` usage,
  `DATABASE_URL`/`STORAGE_ENDPOINT`/`STORAGE_DIR` wiring, console URL. Never
  started here (no docker binaries in this env, per brief).

**Queue abstraction (`packages/jobs/src/`):**

- `types.ts` (new): `QueueMessageType`, `QueueMessage` (`id`, `type`,
  `payload` with optional `analysisId`/`reportId`/`eventId`, `createdAt`),
  `QueuePort { publish(message): Promise<void> }`,
  `OutboxStatus = 'PENDING' | 'DISPATCHED' | 'FAILED'`. Types only, zero
  imports (not even shared — nothing to use).
- `memory.ts` (new): `MemoryQueue implements QueuePort` (append-only array,
  `published`/`size` getters, `clear()`). No I/O, timers, or services.
- `index.ts` (rewrote Task 1 stub): re-exports `./types` + `./memory`.
- `package.json`: dropped `@silapor/domain` (nothing imports it; brief says
  jobs depend only on shared). Kept `@silapor/shared` (allowed; unused for
  now, same pattern as pre-existing stubs).

**Storage abstraction (`packages/storage/src/`):**

- `types.ts` (new): `AttachmentPutResult { key, size, checksum }`,
  `AttachmentData { bytes: Uint8Array, contentType }`, `AttachmentStorage`
  (`put`/`get`→null-on-missing/`remove`). No SDK imports.
- `filesystem.ts` (new): `FilesystemAttachmentStorage` rooted at
  `resolveStorageDir()` (explicit arg → `STORAGE_DIR` env → default
  `./.data/attachments`; empty string falls through to default).
  `generateAttachmentKey()` sanitises prefix + `randomUUID()`. Traversal guard
  rejects empty/absolute/`..`-escaping keys plus a resolve-then-containment
  check. SHA-256 checksum, `contentType` round-tripped via `<file>.meta.json`
  sidecar (fallback `application/octet-stream`), `remove()` clears both files
  with `force: true` (idempotent).
- `index.ts` (rewrote stub): re-exports `./types` + `./filesystem`.
- `package.json`: dropped `@silapor/domain`, kept `@silapor/shared`, added
  `@types/node ^26.6.5` devDep (node builtins; matches shared/web pattern).

**Worker entry (`apps/worker/`):**

- `src/index.ts` (rewrote stub): exports `processMessage(msg)` (logs
  `type`+`id`, returns `{ ok: true, messageId, type }`) and async `start()`
  (reads config only via `getRuntimeConfig()` from `@silapor/shared`, logs
  stub notice, returns `{ stop }` handle with SIGINT/SIGTERM wiring in a
  direct-run `main()` guarded by `import.meta.url` vs `process.argv[1]`).
- `package.json`: deps now `@silapor/jobs` + `@silapor/shared` only (domain
  removed); scripts add `dev: tsx src/index.ts`; devDeps `@types/node`,
  `tsx ^4.23.15`.

**Wiring/support edits:**

- `.gitignore`: added `.data/` (local filesystem-storage default dir).
- `pnpm-workspace.yaml`: `allowBuilds: { esbuild: true }` via
  `pnpm approve-builds esbuild` (see concern 1). `pnpm-lock.yaml` regenerated
  (tsx + `@types/node` linkages).
- `docs/monorepo-boundaries.md` Rule 2 ("each infra package depends on
  `@silapor/domain`") now overstates: jobs/storage/worker no longer declare
  the domain dep (brief §5 required shared-only). Doc left untouched as out of
  scope; flagged here for a Task 6 docs pass.

Out of scope respected: no Drizzle tables/migrations, no MinIO SDK adapter, no
full health/logging/errors, no CI/README, no Cloudflare Queues/R2. No git
commits (only `git status` reads). `packages/domain` untouched (read-only
access; `git status` shows no tracked modifications — repo has zero commits,
all files untracked).

## 2. Commands + output

- `moon run :lint :typecheck :build` (pre-change baseline) → 30 completed,
  0 failed.
- `pnpm install` (after package.json edits) → initially exit 1
  (`ERR_PNPM_IGNORED_BUILDS`, esbuild postinstall from new tsx dep); after
  `pnpm approve-builds esbuild` → exit 0, "Already up to date" on rerun.
- `prettier --write` on all new/edited files → 1 file reformatted
  (`filesystem.ts`, long `return` line wrap); `--check` after → all clean.
- `eslint packages/jobs packages/storage apps/worker` → exit 0.
- `tsc --noEmit` per project (`jobs`, `storage`, `worker`) → all pass under
  strict base (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`).
- Runtime smoke (throwaway tsx script, `STORAGE_DIR=/tmp/...`, deleted after):
  `MemoryQueue` publish→size 1/type readback; `put`→
  `{size:13, checksum:12e51efa…}`, `get`→text+`contentType` round-trip,
  missing→`null`, `../evil`+`/abs`+`..`+`''` all rejected, `remove`→`null`;
  `processMessage`→`{ok:true,…}`; `start()`→port log→`stop()`. All as
  expected.
- `pnpm --dir apps/worker run dev` (`tsx src/index.ts`) → logs start stub,
  exit 0.
- `moon run :lint :typecheck :build :test` (final) → 40 completed, 0 failed.
  Rerun `moon run :lint :typecheck :build` → exit 0.
- `grep -rEn 'cloudflare|wrangler|drizzle'` over jobs/storage/worker manifests
  + sources + compose → no matches. `git status` → no tracked-file
  modifications; domain never written.

## 3. Files changed

New: `docker-compose.yml`, `packages/jobs/src/types.ts`,
`packages/jobs/src/memory.ts`, `packages/storage/src/types.ts`,
`packages/storage/src/filesystem.ts`. Rewrote (stub→real):
`packages/jobs/src/index.ts`, `packages/storage/src/index.ts`,
`apps/worker/src/index.ts`. Edited: `packages/jobs/package.json`,
`packages/storage/package.json`, `apps/worker/package.json`, `.gitignore`,
`pnpm-workspace.yaml` (allowBuilds), `pnpm-lock.yaml` (regen). Untouched:
`packages/domain/**`, `eslint.config.mjs`, `.moon/**`, all other packages.

## 4. Self-review

- Completeness: all 4 numbered requirements + boundary rule + all 5 acceptance
  checks pass (compose services/ports/volumes/healthchecks as specified; moon
  lint/typecheck/build green incl. `jobs:lint storage:lint worker:lint`;
  real implementations, not echo stubs; dep scan clean; domain untouched).
- Quality: strict TS + eslint + prettier pass; behavior verified at runtime
  (queue publish, storage round-trip + guards, worker start/process/stop), not
  just by file existence. No tests committed — brief defers them to Task 6.
- YAGNI: no minio SDK, no Drizzle, no outbox table, no broker polling, no
  OpenRouter/DB in worker, no doc rewrites.

## 5. Concerns

1. (informational) pnpm v11 fails `install` (exit 1) when any dep ships an
   unapproved build script; new `tsx`→`esbuild` postinstall tripped it, which
   would have broken every `pnpm run` (hence moon) workflow. Fixed the standard
   way: `pnpm approve-builds esbuild` → `allowBuilds: { esbuild: true }` in
   `pnpm-workspace.yaml`. esbuild is a ubiquitous build tool; its postinstall
   only verifies the prebuilt binary.
2. (informational) `MemoryQueue` lists `@silapor/shared` as a dep without
   importing it (kept per brief "depend only on shared"; harmless, matches the
   pre-existing stub pattern). Real shared usage (env/config) starts in Task 4
   outbox work.
3. (form note, needs controller ack) `docs/monorepo-boundaries.md` Rule 2 still
   says every infra package depends on `@silapor/domain`; after this task
   jobs/storage/worker do not. Left for a Task 6 docs pass; domain-side
   enforcement (`eslint.config.mjs`) is unaffected.
4. (informational) MinIO healthcheck assumes the image ships `curl` (canonical
   upstream example); unverifiable here — no docker binaries, compose is
   documented-only per brief. First `docker compose up` owner should confirm.
5. (informational) Worker `dev` exits 0 after the start log (no broker loop
   yet, so the event loop drains). Intended stub behavior; a persistent poll
   loop arrives with the Task 4 outbox/broker wiring.
