# SDD ledger — plan: /home/yudaclairee/kuliah/silapor/EXECUTION-PLAN.md (Phase 1 only)

## Scope
Phase 1 — Repository and Engineering Foundation (EXECUTION-PLAN.md lines 948-1000).
Spec authority: Tugas-Tugas Semester 7.md (PRD) + docs/decisions/PHASE-0-PRODUCT-DECISIONS.md.
User constraint (2026-10-10): NO commits — implementers must not run git commit; leave working-tree changes. Tell user when finished.

## Rulings
- Ruling: No git repo exists + user forbids commits — work in place at /home/yudaclairee/kuliah/silapor, skip git-worktree isolation and skip sdd-workspace/review-package scripts (they require git). Reviews read working tree directly. — Why: scripts fail without git; user forbids commits. — Cost if wrong: history not bisectable; acceptable for Phase 1 bootstrap.
- Ruling: Pilot note applies — SKIP Cloudflare-only steps (Phase 1 steps 5, 11, Wrangler dry-run part of 21). Web targets Node, worker is Node process with same queue-message contract. Revisit when deployment final. — Why: plan explicitly says lewati sampai keputusan deployment final. — Cost if wrong: rework adapters later; bounded by port/adapter boundary.
- Ruling: No docker/podman/postgres binaries in env — provide docker-compose.yml for Postgres+MinIO as documented path, but foundation must pass lint/typecheck/unit without docker. Integration tests gate on DATABASE_URL and skip clearly if unavailable. Storage defaults to filesystem adapter locally with S3-compatible interface for MinIO later. — Why: cannot provision containers here. — Cost if wrong: staging may diverge; mitigated by interface boundary + health checks.
- Ruling: Batch 24 Phase-1 steps into 6 tasks (T1 monorepo, T2 web scaffold, T3 local infra, T4 drizzle+migration+seed, T5 cross-cutting, T6 testing+CI+docs). One implementer at a time, review after each. — Why: same-shape batching per SDD; 24 dispatches wasteful. — Cost if wrong: larger diffs per review; mitigated by scoped re-review.

## Pre-flight conflict scan (pairs sharing files/interfaces)
| Pair | Produces vs consumes | Finding |
|---|---|---|
| T1 vs T2-T6 | T1 creates pnpm-workspace, moon config, tsconfig, lint | Must land first; all others depend. No conflict, ordering enforced. |
| T2 vs T5 | T2 health skeleton vs T5 full health/logging/errors | Overlap risk: T2 creates placeholder health route; T5 fills it. Ruled: T2 creates route file with TODO + web-only OK; T5 implements db/storage/queue/worker checks. |
| T3 vs T4 | T3 compose/queue+storage interfaces vs T4 Drizzle schema/outbox table | Interface agreement: outbox table name `outbox_events`, storage interface `AttachmentStorage`. Both recorded here; T4 implements tables, T3 implements adapters+compose. No contradiction. |
| T4 vs T6 (seed) | T4 migration+schema vs T6 seed command | Ruled: T4 owns schema+migration; seed idempotent command lands in T4 (step 23) to avoid split ownership; T6 only wires `moon run seed` task + docs. |
| Plan step 5/11 vs pilot note | Cloudflare plugin + wrangler types vs "dilewati" | Conflict found, ruled above: SKIP for pilot. |
| Plan test-minimum (Workers build, dry-run) vs pilot note | Workers build/dry-run vs local-only | Conflict found, ruled: replace with Node build + `moon run build` green; record as deferred until deployment final. |
| T5 vs T6 | errors/logging vs CI/test | No file overlap beyond package scripts; T6 only adds tasks, not redefines errors. Clean. |

Plan text self-check per task: briefs carry exact values verbatim; no test-asserts-nothing or verbatim-duplication mandates found in Phase 1 text. Scan table above is the scan record.

## Progress
- Setup complete. Starting Task 1.
- Task 1: complete (no commits per user; 40/40 moon tasks green per implementer; review Approved).
- Task 1: minor (deferred): eslint domain scope only *.ts, add tsx/mts/cts.
- Task 1: minor (deferred): eslint pattern gaps bare @openrouter, drizzle-kit/**, wrangler/**, bare @silapor/web|worker.
- Task 1: minor (deferred): pnpm-workspace globs vs explicit list — compliant in substance, no fix.
- Task 1 concern ack: .moon/tasks.yml top-level ignored by moon v2, thin .moon/tasks/common.yml shim is source-of-truth bridge — accepted.
- Task 2: complete (no commits; web vite build + health/error/not-found per report; review Approved).
- Task 2: minor (deferred): @tanstack/router-plugin installed but not instantiated — document or drop later.
- Task 2: minor (deferred): pnpm minimumReleaseAgeExclude side effect — left as-is.
- Task 3: complete (no new commits by controller; review Approved).
- Task 3: minor (deferred): jobs/storage declare @silapor/shared unused until Task 4.
- Task 3: minor (deferred): docs/monorepo-boundaries Rule 2 stale (infra no longer depends on domain) — Task 6 docs pass.
- Task 3: minor (deferred): minio healthcheck curl presence — verify on first compose up.
- Note: reviewer observed single git init commit in env; controller made zero commits per user rule. Future implementers reminded: NO commits.
- Task 4: complete (review Approved; accept 0000_foundation.sql as meeting 0001_* intent — tool-canonical, journal-consistent; brief acceptance amended).
- Task 4: deferred live-DB check: first docker compose up must confirm empty-DB migrate + double-seed zero duplicates.
- Task 3: complete (review Approved).
- Task 5: complete (review Approved).
- Task 5: minor (deferred): logging doc wording bare auth vs substring — no functional bug.
- Task 5: minor (deferred): worker messageId fallback inconsistent log code vs return.
- Task 5: minor (deferred): health messages echo absolute paths — ok pilot, revisit for public hardening.
- Task 6: complete (review Approved; 40 moon tasks green offline per report; integration skipped, e2e list-only).
- Task 6 notes (deferred, informational): Moon wrapper test-e2e vs pnpm test:e2e (documented); web test echo stub; e2e needs playwright install; .env dev password local-only.
- Final review: PASS (pilot-scoped). 2 FIX NOW items → one fix dispatch + one scoped re-review per SDD.
- Final fix wave: 2/2 addressed, scoped re-review clean, no residuals.
- Task Final review: complete (PASS pilot-scoped, fixes merged in working tree, no commits per user).
- Infra change (post-Phase-1, per user): dropped MinIO (images no longer publicly pullable), added Garage v2.3.0 single-node service + infra/garage/garage.toml; .env.example STORAGE_ENDPOINT now :3900 + GARAGE_DEFAULT_* dev defaults; README updated. Filesystem adapter still default; S3 adapter lands Phase 4.
- Product input (2026-10-10, user): SSO login pakai username+password; username = identitas pelapor (NIM/NIP/identitas kampus). Dicatat di docs/decisions/PHASE-0-PRODUCT-DECISIONS.md §1 sebagai arahan pending approval UMPER/admin. Dampak Phase 2: kontrak SsoProvider + tabel users harus membawa username/identity (bukan hanya email); mock accounts dipetakan ke bentuk yang sama.
- Product input refined (2026-10-10, user): kontrak auth minimal — hanya username + password + role + status aktif; nama/email ditunda. Dampak Phase 2: tabel users + seed (saat ini email-based: admin@mock.upi.ac.id dkk.) harus migrasi ke username-based (NIM/NIP).
- Schema change (2026-10-10, per user): users table email+name -> username unique (minimal auth contract); seed now admin/230001/230002; migration 0000_foundation regenerated; decision doc mock accounts updated. Verified: db typecheck+lint green, integration test skips offline. Note: reset local DB volume (down -v) if 0000 already applied with email schema.
- Product input (2026-10-10, user): scoring tambah dimensi frekuensi 0-15 ( distinct reporters, insiden sama, hanya aktif); baseline provisional 35+25+25+15; tier 0/5/10/15. Dicatat di decision §5, pending kalibrasi UMPER/admin. Dampak: EXECUTION-PLAN §4.4 + data/master bobot + scoring service Phase 5 perlu update saat implementasi (belum diubah sekarang).
