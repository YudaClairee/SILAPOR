# SILAPOR — Smart Campus Maintenance System (pilot)

Modular monolith: TanStack Start web app (`apps/web`), Node queue worker
(`apps/worker`), and `packages/*` domain/infrastructure libraries, orchestrated
by Moon and installed with pnpm workspaces.

> Pilot note (2026-10-10): local-only deployment (app + PostgreSQL + Garage
> via `docker compose`). Object storage uses the filesystem adapter
> (`STORAGE_DIR`); Garage (S3-compatible, bucket `silapor` auto-provisioned)
> stands by for the S3 adapter landing in Phase 4. MinIO was dropped because
> upstream no longer publishes pullable public images. Cloudflare (Wrangler,
> Hyperdrive, Queues, R2/Images, Workers bundle dry-run) is **deferred**
> until the deployment decision lands.
> The worker runs as a local Node process with the same queue message contract.

## Prerequisites

- Node 24.18.0, pnpm 11.21.0 (see `.moon/toolchains.yml`)
- Docker Compose (for PostgreSQL + Garage)

## Local setup

```sh
cp .env.example .env   # optional; defaults work for the pilot
pnpm install
docker compose up -d   # postgres :5432 + garage S3 :3900 (admin :3903)
pnpm --filter @silapor/database run db:migrate
pnpm --filter @silapor/database run db:seed   # idempotent (safe to run twice)
```

Verify Garage (optional until Phase 4):

```sh
AWS_ENDPOINT_URL=http://localhost:3900 AWS_DEFAULT_REGION=garage \
  AWS_ACCESS_KEY_ID=<GARAGE_DEFAULT_ACCESS_KEY> \
  AWS_SECRET_ACCESS_KEY=<GARAGE_DEFAULT_SECRET_KEY> \
  aws s3 ls s3://silapor/
```

## Run

```sh
pnpm --filter @silapor/web run dev       # vite dev, http://localhost:3000
pnpm --filter @silapor/worker run dev    # node worker (beat file)
```

Run both from the repo root so the default `./.data/*` paths
(`STORAGE_DIR`, `WORKER_BEAT_FILE`) are shared. Or set absolute paths in `.env`.

## Moon tasks

```sh
moon run :lint :typecheck :build :test    # CI gate (offline-green)
moon run web:test-e2e                     # Playwright e2e (needs browsers)
moon query projects                       # list Moon projects
```

- `lint` / `typecheck` / `build` / `test` are deterministic and cached.
- `test` runs vitest per package. The database integration test skips without
  `DATABASE_URL`; e2e is **not** part of `test`.
- `web:test-e2e` (Moon wrapper for pnpm `test:e2e`) is non-cacheable.

## Migration and seed

```sh
pnpm --filter @silapor/database run db:migrate
pnpm --filter @silapor/database run db:seed
```

Seed upserts 1 admin + 2 reporters by email, so a second run updates zero
duplicates. Both commands print a credential-redacted URL on failure.

## Report data reset (manual testing)

```sh
pnpm --filter @silapor/database run db:reset-reports -- --dry-run   # preview counts
pnpm --filter @silapor/database run db:reset-reports                # wipe report data
```

Deletes `maintenance_reports` and everything scoped to it (events,
assignments, updates, relations, attachments), AI analyses, staged uploads,
notifications, outbox events and the ticket counter — the next submit gets
`MNT-<year>-000001` again. Master data (users, sessions, locations, facility
categories, issue types, facility assets, technicians) and `audit_logs` are
kept, so login and the report form keep working without a re-seed.

Attachment objects are removed from `STORAGE_DIR` too (`--keep-files` keeps
them; `--keep-orphan-files` only removes objects still referenced by rows;
`--storage-dir <path>` points the cleanup at another directory, e.g. the
`apps/web/.data/attachments` folder written by `pnpm --filter` runs). The
command refuses to run with `NODE_ENV=production` unless `--allow-production`
is passed. It is idempotent: a second run reports zero rows deleted.

## Worker

`apps/worker` consumes the `QueueMessage` contract from `@silapor/jobs` and
records a file beat (`WORKER_BEAT_FILE`, default `./.data/worker-beat.json`).
The web health check reads that file for cross-process liveness; the worker
also exposes in-process `getWorkerHealth()`.

## Testing

```sh
moon run :test                                        # unit + gated integration
pnpm --filter @silapor/shared run test                # redact + error mapping
pnpm --filter @silapor/jobs run test                  # MemoryQueue
pnpm --filter @silapor/storage run test               # filesystem (uses /tmp)
DATABASE_URL=postgres://silapor:silapor@localhost:5432/silapor \
  pnpm --filter @silapor/database run test            # live integration
```

- Unit tests are pure and offline (storage tests use `mkdtemp` under `/tmp`,
  never the repo `.data/` dir).
- `packages/database/src/db.integration.test.ts` uses
  `describe.skipIf(!process.env.DATABASE_URL)` — offline it reports skipped,
  never failed.
- E2E: `npx playwright install` once, then
  `pnpm --filter @silapor/web run test:e2e`. The spec asserts
  `GET /api/health → 200` with `service: "web"`; `ok: false` is allowed
  offline (fail-open health).

## Health endpoint

`GET /api/health` always answers HTTP 200 with
`{ ok, service: "web", checks: { database, storage, queue, worker } }`.
Each check is fail-open (`ok: false` + message when a dependency is down);
credentials never appear in messages.

## Config

See `.env.example`: `DATABASE_URL`, `PORT`, `STORAGE_DIR`,
`STORAGE_ENDPOINT`, `WORKER_BEAT_FILE`. No secrets are committed.
Server code reads `process.env` only through `getRuntimeConfig()`
(`@silapor/shared`); Wrangler bindings arrive later at the transport layer.
