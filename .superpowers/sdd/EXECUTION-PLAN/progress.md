# SDD ledger — plan: /home/yudaclairee/kuliah/silapor/EXECUTION-PLAN.md (Phase 1 + Phase 2)

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

## Phase 2 — Database, Master Data, Authentication, RBAC (EXECUTION-PLAN.md lines 1003-1040)
Scope: 12 steps + test-minimum (7 items) + release gate (role boundary + master data stabil).
Spec authority: EXECUTION-PLAN.md §4.1/§7/§8/§9 + docs/decisions/PHASE-0-PRODUCT-DECISIONS.md §§1-2,6,8 + data/master/*.csv.
User constraint (2026-10-10): NO commits — implementers must NOT run git commit/git push; leave working-tree changes. Controller makes zero commits.
BASE Phase 2: b74e54f2f878819e3358f4ae1ecf86a7798e93cb.

### Rulings (Phase 2 pre-flight)
- Ruling: Batch 12 steps into 5 tasks (P2-1 schema+migration; P2-2 seed; P2-3 auth/session/rate-limit; P2-4 authorization+middleware; P2-5 admin CRUD+archive+audit). One implementer at a time, review after each. — Why: same-shape batching per SDD; 12 dispatches wasteful. — Cost if wrong: larger diffs per review; mitigated by scoped re-review.
- Ruling: P2-1 extends users table in place (keep username unique + user_role enum + is_active); ADD external_user_id unique nullable, nim nullable, last_login_at nullable, keep created_at/updated_at. Do NOT reintroduce name/email (minimal auth contract per 2026-10-10 decision). Existing 3-user seed test must keep passing. — Why: decision §1 minimal contract. — Cost if wrong: auth/duplicate-detection keyed on wrong identity; rework P2-2/P2-3.
- Ruling: P2-1 scoring weights stored as numeric columns only (category weight 0-40 on facility_categories, asset weight 0-30 on facility_assets, location tier score 0-30 on locations); NO scoring service in Phase 2 (Phase 5 owns it). Decision §5 4-dim baseline (35+25+25+15) NOT implemented now; only persist v1 CSV values for later use. — Why: plan §4.4 weights provisional + scoring lands Phase 5. — Cost if wrong: premature scoring logic needing recalibration.
- Ruling: locations model = buildings as location rows (type CAMPUS/BUILDING/FLOOR/ROOM) + rooms from rooms_lengkap.csv; floor derived from room_code segment; single-floor buildings (B,D,E,F,G,J) floor_number=1. Lift rooms (name contains LIFT) seeded is_active=true but flagged reporter_hidden=true for Phase 3 form filtering. — Why: decision §6 exceptions. — Cost if wrong: Phase 3 form shows lift rooms; small fix then.
- Ruling: issue_types are 7 generic rows (BROKEN/NOT_WORKING/MISSING/DIRTY/LEAKING/DANGEROUS/OTHER) with NULL category_id (valid for all categories); legacy per-category codes from CSV seeded is_active=false. facility_categories: 6 active + legacy codes inactive. — Why: decision §6 taxonomy. — Cost if wrong: Phase 3 dependent-select breaks; caught by P2-5 tests.
- Ruling: sessions table = id uuid pk, user_id fk cascade, token_hash text unique (sha256 hex, never raw token), expires_at timestamptz, created_at, revoked_at nullable; index (user_id), (token_hash). No password column (MockSso has no passwords; UpiSso deferred). — Why: plan step 4 MockSso all env + decision §1 no fake passwords. — Cost if wrong: session hijack surface; mitigated by hash + secure cookie + expiry.
- Ruling: Pilot local only — no Cloudflare/Wrangler work in Phase 2. Queue/outbox untouched (Phase 1 outbox_events stays as-is). — Why: pilot note lokal saja. — Cost if wrong: none; adapters deferred.

### Pre-flight conflict scan (pairs sharing files/interfaces)
| Pair | Produces vs consumes | Finding |
|---|---|---|
| P2-1 vs P2-2 | P2-1 creates tables/enums vs P2-2 seed inserts | Ordering enforced (schema first). P2-2 must be idempotent upserts keyed on natural codes (username/code/room_code/asset_code/technician_code); archive flags preserved. No conflict. |
| P2-1 vs P2-3 | P2-1 sessions table vs P2-3 session create/validate/revoke | Interface agreement: token_hash sha256 hex, 7-day expiry default, secure cookie name silapor_session. Both recorded here. No contradiction. |
| P2-3 vs P2-4 | P2-3 getSessionUser vs P2-4 requireRole/requireOwner policy | P2-3 owns session resolution; P2-4 owns role checks consuming it. No overlap; P2-4 must not reimplement session lookup. Clean. |
| P2-4 vs P2-5 | P2-4 policy fns vs P2-5 admin CRUD calling them | P2-5 consumes requireAdmin from P2-4; if P2-4 API differs, P2-5 adapts without editing P2-4 files (or flags conflict). Ordering enforced. |
| Plan §7 users (name/email) vs decision §1 minimal (username only) | Plan text vs binding decision | Conflict found, ruled above: username-only wins (decision is source of truth; plan §4.1 points to decision register). |
| Plan §4.4 3-dim weights (40+30+30) vs decision §5 4-dim (35+25+25+15) | Plan text vs decision update | Conflict found, ruled above: persist numeric weights only in Phase 2; scoring formula deferred to Phase 5 with decision baseline. |
| P2-5 archive vs seed re-run | archive sets is_active=false vs seed upsert | Ruled: seed never reactivates manually-archived rows except for its own seed codes on first insert; seed upsert updates weights/names but preserves is_active=false if admin archived after first seed (track via explicit logic + test). |

Plan self-check per task: briefs carry exact CSV values verbatim; no asserts-nothing or verbatim-duplication mandates. Scan table above is the scan record.

## Progress (Phase 2)
- Setup complete. Starting P2-1.
- P2-1: complete (no commits; schema 7 tables + 0001_redundant_dagger, journal-consistent; typecheck+lint clean, test 1 skipped offline; review Spec ✅ Quality Approved, no findings).
- P2-2: complete (no commits; seed 3 users/15 categories/11 issue_types/196 locations/334 assets/5 technicians live-verified 561→0 idempotent, archive guard verified; review Spec ✅ Approved, 3 deferred minors: CLI wording, brief-vs-CSV legacy count 10-vs-9, ~1700-stmt seed perf).
- P2-3: complete (no commits; SsoProvider+Mock/UPI-stub, session helpers, rate-limit 5/10min, sessions repo, 3 web routes, auth 33/33 tests, web build green, live smoke login/429/logout/me; review Spec ✅ Approved, 3 minors: empty-insert 400-vs-500, logout log unredacted detail, UPI resolve arity — all deferred).
- P2-4: complete (no commits; pure deny-by-default policies + server requireUser/Admin/Owner guards + redirect-only admin/reporter layouts + login page; auth 43/43, web build green; review Spec ✅ Approved, 3 minors: parseSessionToken triplication, layout beforeLoad duplication, stale P2-3 header — all deferred).
- P2-5: complete (no commits; repos+validators for 5 entities, 10 admin routes, audit transactions, no-delete; db 26 pass, web build green with 10 routes, live cycle per-entity verified; review Spec ✅ Approved, 3 minors: specialization alias, unwired archive fns, index-line note — all deferred).
- Final verification (controller, 2026-10-10): moon run :typecheck 10/10 green; :lint 10/10 green; :test green (shared 5, auth 43, database 26 + 1 pre-existing gated skip); :build 10/10 green. Release gate: role boundary + master data stabil — PASS (server requireAdmin everywhere, reporter-blocked, archive-never-delete, audit on all mutations, seed idempotent, inactive sessions dead). Zero commits per user rule — changes in working tree for user to review/commit.
