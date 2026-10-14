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

## Phase 5 — Admin Workflow, Assignment, and Timeline (EXECUTION-PLAN.md lines 1142-1211)
Scope: domain/backend 16 steps + frontend 11 steps + test-minimum 14 items + release gate full lifecycle.
Spec authority: EXECUTION-PLAN.md §4.2/§4.4/§4.7/§4.8/§7/§8/§9 + docs/decisions/PHASE-0-PRODUCT-DECISIONS.md §§2,5,8.
Worktree: /home/yudaclairee/kuliah/silapor/.worktrees/phase-5-admin-workflow on branch phase-5-admin-workflow from BASE 81b570470765f266e91ccf59d991e57a5fb02ce1.
BASE Phase 5: 81b570470765f266e91ccf59d991e57a5fb02ce1.

### Rulings (Phase 5 pre-flight)
- Ruling: Decision §5 4-dim scoring (35+25+25+15 + frequency tiers 1→0/2→5/3-4→10/≥5→15, mapping LOW 0-39/MEDIUM 40-69/HIGH 70-100, DANGEROUS min HIGH) wins over plan §4.4 3-dim (40+30+30). — Why: plan §4 intro says decision register is source of truth; decision is newer (2026-10-10). — Cost if wrong: rubric recalibration; bounded by pure scoring fn + scoringConfigVersion.
- Ruling: Stored weights stay as-is (category 0-40, asset 0-30, tierScore 0-30); scoring fn clamps to new maxima (min(weight,35), min(weight,25), min(tierScore,25)) + frequency 0-15. Null/missing weight → new-scale medians (category 17, asset 12, location 12, frequency 0) with scoringComplete=false; admin must set finalPriority manually. — Why: avoid re-seed churn; provisional until UMPER calibrates. — Cost if wrong: slight score skew; auditable via priorityFactors snapshot.
- Ruling: Batch Phase 5 into 6 tasks (P5-1 domain; P5-2 migration; P5-3 workflow core; P5-4 assignment/transition/timeline; P5-5 transport+UI; P5-6 E2E gate). One implementer at a time, review after each. — Why: same-shape batching per SDD. — Cost if wrong: larger diffs; mitigated by scoped re-review.
- Ruling: P5-2 extends maintenance_reports in place (ADD priority_override_reason text nullable, priority_decided_by uuid FK users SET NULL nullable, priority_decided_at timestamptz nullable, scoring_config_version integer default 1); creates report_assignments + report_updates tables; no rework of Phase 3/4 tables. — Why: plan §7 + auditability. — Cost if wrong: migration rework.
- Ruling: task-brief/review-package scripts require Task-N headings absent from EXECUTION-PLAN.md; controller writes briefs manually to .superpowers/sdd/EXECUTION-PLAN/task-p5-N-brief.md and review packages via git diff file. Script failure is tooling gap, not plan gap. — Why: scripts grep '^#+ Task N'; plan uses Phase sections. — Cost if wrong: none; brief content identical in substance.

### Pre-flight conflict scan (pairs sharing files/interfaces)
| Pair | Produces vs consumes | Finding |
|---|---|---|
| P5-1 vs P5-3/P5-4 | P5-1 pure transition map + scoring fn vs P5-3/P5-4 DB transactions consuming them | Ordering enforced (domain first). Interface: canTransition(from,to), priorityScore fn signature fixed in P5-1 brief; P5-3/4 must import from @silapor/domain, not duplicate. No contradiction. |
| P5-2 vs P5-3/P5-4 | P5-2 migration tables/columns vs P5-3/P5-4 repos writing them | Ordering enforced (migration first). Column names binding: priority_override_reason, priority_decided_by, priority_decided_at, scoring_config_version; tables report_assignments/report_updates per §7. No conflict. |
| P5-3 vs P5-4 | P5-3 verify/reject/duplicate/finalPriority vs P5-4 assign/transition/updates/timeline | Both write maintenance_reports.version + report_events + audit_logs + outbox_events in same txn. Ruled: shared txn helper lives in P5-3; P5-4 reuses, never forks. Version increment +1 per mutation; conflict → 409. Clean. |
| P5-4 vs P5-5 | P5-4 timeline projection shape vs P5-5 UI consuming it | Interface: timeline entries {id, kind, actor, timestamp, payload} chronological; reporter view strips INTERNAL + PII. P5-5 must not re-query raw tables. No conflict. |
| Plan §4.4 vs decision §5 | 40+30+30 vs 35+25+25+15 | Conflict found, ruled above: decision wins. |
| P5-5 AI placeholder vs Phase 8 | P5-5 shows pending panel vs Phase 8 real AI | Ruled: P5-5 renders deterministic placeholder (no fetch, no mock inference); Phase 8 owns adapter. No contradiction. |

Plan self-check per task: briefs carry exact transition matrix + scoring numbers verbatim; no asserts-nothing or verbatim-duplication mandates. Scan table above is the scan record.

## Progress (Phase 5)
- Setup complete (worktree phase-5-admin-workflow, BASE 81b5704). Starting P5-1.
- P5-1: complete (commits 81b5704..f91fd67, review clean Approved; 45 tests pass).
- P5-1: Ruling: requiresNote(INSPECTION→IN_REPAIR)=true stands (set-membership reading). — Why: NOTE_REQUIRED_TRANSITIONS contains IN_REPAIR distinct from REOPEN; plan step 10 mandates inspection note. — Cost if wrong: one-line fix in P5-3 if UMPER wants note-free inspection→repair.
- P5-1: minor (deferred): scorePriority no rounding for non-integer weights (out-of-contract; weights integer-scaled).
- P5-1: minor (deferred): factors.affectedReporters echoes raw input; downstream must not trust echo for display.
- P5-2: complete (commit f91fd67..e81a724, review clean Approved; 109 pass/1 skip offline, migrate 0000→0004 verified on scratch DB).
- P5-2: minor (deferred): report_assignments_report_id_idx redundant prefix of (report_id,assigned_at) but brief-mandated — keep.
- P5-2 note: local dev DB volume predates chain (0000 drift) — operator must `docker compose down -v` before migrate; not done by implementer.
- P5-3: complete (commit e81a724..719da7b, review clean Approved; 135 pass/1 skip, workflow 26/26 with live scratch DB).
- P5-3: minor (deferred): withReportLock optional 5th actor param (brief self-contradiction resolved, backward-compat); outbox payload adds actorId; override reason stored trimmed; extra affectedReporters finite guard; equal no-op returns outer snapshot.
- P5-4: complete (commits 719da7b..f241b22, review Approved + fix round 1/5 clean; 154 pass/1 skip).
- P5-4: fix round 1/5 (2 addressed, 0 open — reporter STATUS_CHANGED metadata.note leak + author PII; commit efaaa1b..f241b22).
- P5-4: Ruling: reporter timeline strips internal transition note + authorId/assignedBy (keeps RESOLVED public note + opaque technicianId). — Why: plan §4.7/acceptance internal-never-visible wins over brief's INTERNAL_NOTE_ADDED-only scope. — Cost if wrong: over-redaction hides resolution context; bounded by keepsNote exception.
- P5-5: complete (commits f241b22..e5aa10d, review Needs-fixes → fix round 1/5 clean; web 146/146 + database 155/1 skip, live full-chain smoke v1→v9).
- P5-5: fix round 1/5 (3 addressed, 0 open — reporter detail network leak + DOM existence leak + stale comment; commit 29dbc48..e5aa10d).
- P5-5: Ruling: getMyReportDetail sanitizes events server-side (drops INTERNAL_NOTE_ADDED, nulls actorId/author PII, strips metadata.note except RESOLVED public); reporter UI defense-in-depth filters INTERNAL labels. — Why: acceptance internal-never-visible must hold at network level, not just DOM. — Cost if wrong: none; admin path untouched.
- P5-5: minor (deferred): admin form keeps user edits after reload (fresh version used — cosmetic); report list/create on shared dev DB INTERNAL (pre-existing migration-5 drift, isolated-DB smoke clean).
- P5-6: complete (no commits, verification only — gate PASS 12/12; domain 45/45, database 155+146 incl. live 47/47 full-chain v1→v7 on scratch DB, web 146/146 + build 3.39s).
- P5-6 note: db.integration.test.ts fails only when pointed at migrated shared dev DB (pre-existing CREATE TYPE conflict; use empty DB).
- Final review: READY TO MERGE (whole-branch 81b5704..e5aa10d, 8 commits; no blocking findings; deferred minors triaged, none block merge). Branch phase-5-admin-workflow in .worktrees/phase-5-admin-workflow; NOT merged/pushed — awaiting user decision.
