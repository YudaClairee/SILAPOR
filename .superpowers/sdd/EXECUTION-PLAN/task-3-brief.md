# Task 3 Brief — Local infra: compose + queue/storage abstraction + worker entry (Phase 1 steps 12,13,15)

## Source
EXECUTION-PLAN.md Phase 1 steps 12 (Postgres local via container), 13 (MinIO/private storage local), 15 (queue abstraction + local Postgres queue/outbox). Pilot: local containers documented; worker is Node process with same queue-message contract.

## Environment constraint (exact)
No docker/podman/postgres binaries in this env. Therefore: provide `docker-compose.yml` as documented path BUT foundation must pass lint/typecheck/unit without docker. No live container verification required.

## Requirements
1. `docker-compose.yml` at root: services `postgres` (postgres:16, db silapor, volume pgdata, port 5432, healthcheck pg_isready) and `minio` (minio/minio, ports 9000/9001, volume minio-data, default creds minioadmin/minioadmin via env, healthcheck). Documented only; do not require running.
2. Queue abstraction in `packages/jobs/src/`:
   - `types.ts`: `QueueMessage = { id: string; type: "AI_REVIEW_REQUESTED" | "NOTIFICATION_DISPATCH"; payload: { analysisId?: string; reportId?: string; eventId?: string }; createdAt: string }`, `QueuePort { publish(msg): Promise<void>; }`, `OutboxStatus = "PENDING"|"DISPATCHED"|"FAILED"`.
   - `index.ts` re-exports. No DB/cloud deps (types only). Table `outbox_events` itself lands in Task 4 (Drizzle) — here only contract + in-memory `MemoryQueue` for tests in `memory.ts`.
3. Storage abstraction in `packages/storage/src/`:
   - `types.ts`: `AttachmentStorage { put(key, bytes, contentType): Promise<{key,size,checksum}>; get(key): Promise<{bytes,contentType}|null>; remove(key): Promise<void>; }`.
   - `filesystem.ts`: `FilesystemAttachmentStorage` rooted at env `STORAGE_DIR` (default `./.data/attachments`), random key generation helper, path-traversal guard (reject `..`, absolute).
   - `index.ts` re-exports. No minio SDK needed now (S3-compatible adapter later); document that MinIO adapter will implement same interface.
4. Worker entry in `apps/worker/src/index.ts`: Node process stub exporting `start()` + `processMessage(msg: QueueMessage)` (logs + returns ok; full OpenRouter/DB in later phases). `package.json` script `dev: tsx` or node stub + moon tasks pass. Depends on `@silapor/jobs`, `@silapor/shared` only.
5. Preserve boundaries: domain untouched; jobs/storage depend only on shared (+ node builtins). Strict TS, eslint, prettier. Moon lint/typecheck/build/test green.

## Out of scope
- Drizzle tables/migrations (Task 4), full health/logging/errors (Task 5), CI/README (Task 6). No Cloudflare Queues/R2. No git commit.

## Acceptance
- `docker-compose.yml` exists with postgres+minio as specified.
- `moon run :lint :typecheck :build` green; `jobs:lint storage:lint worker:lint` green.
- In-memory queue + filesystem storage have pure unit tests? — NO, tests land in Task 6; here `tsc` + lint is enough, but files must be real (not echo).
- No forbidden deps (no @cloudflare, wrangler, drizzle in jobs/storage/worker package.json unless Task 4 owns drizzle — keep drizzle out here).
- No domain changes.

## Report
Full report to `.superpowers/sdd/EXECUTION-PLAN/task-3-report.md`. Short contract reply, no SHAs.
