# Phase 6 SDD Ledger — Facility Status, Maintenance History, and Notification

BASE: 83d0768 (main). Branch: phase-6-facility-notification. Worktree: .worktrees/phase-6-facility-notification.
Historical Phase 1-5 ledger lives in the main checkout (this file was reset for the fresh phase).

## Process ruling
- Ruling: no subagent-dispatch tool in this environment — SDD loop runs inline: one task per commit, spec+quality review gate after each task (findings logged here, fixes before next task), final whole-branch review at P6-6. — Why: skill fallback for missing subagent tool; preserves per-task review isolation. — Cost if wrong: reviewer shares implementer context; mitigated by written review checklists per task and fresh-eyes checklists in briefs.

## Phase 6 pre-flight rulings
- Ruling: `notifications` table gains `source_event_id uuid NOT NULL` + UNIQUE (source_event_id, user_id) beyond plan §7.1 minimum. — Why: plan step 11 requires idempotent processing on worker retry; unique constraint is the only DB-level guarantee (at-least-once delivery). — Cost if wrong: extra column; harmless if never needed.
- Ruling: migration 0005 also adds `outbox_events.last_error text NULL` (plan §7.1 lists it; deferred in Phase 1). — Why: dead-letter state needs the failure reason visible. — Cost if wrong: none.
- Ruling: outbox claim loop skips `type='AI_REVIEW_REQUESTED'` rows entirely (stay PENDING for Phase 8); worker processes `WORKFLOW_NOTIFICATION` only. — Why: AI consumer is Phase 8 scope; consuming rows now would lose jobs. — Cost if wrong: AI jobs pile up unprocessed — intended until Phase 8.
- Ruling: notification recipients = report.reporterId only; admin actions are audited via audit_logs (no admin notifications in MVP). INTERNAL_NOTE_ADDED and PRIORITY_CHANGED kinds produce NO notification (plan step 9 list + decision §7 visibility rules). REPORT_REJECTED and REPORT_MARKED_DUPLICATE DO notify (they are terminal status changes; §4.10 “status berubah” covers them — a reporter must learn their report was rejected). — Cost if wrong: extra/missing notification types; small remap in one mapping table.
- Ruling: facility status derivation is a PURE domain function (plan §12.1 lists it under unit tests); DB layer only aggregates active statuses per asset. Precedence: IN_REPAIR > UNDER_INSPECTION > REPORTED_ISSUE; REPORTED/VERIFIED→REPORTED_ISSUE, ASSIGNED/INSPECTION→UNDER_INSPECTION, IN_REPAIR→IN_REPAIR; none → OPERATIONAL. — Why: plan §4.6 mapping. — Cost if wrong: wrong status shown publicly; guarded by boundary tests.
- Ruling: public projection excludes inactive assets entirely; assets with no active report are OPERATIONAL. `lastUpdated` = latest active report's reported_at when active reports exist, else asset.updated_at. — Why: plan step 4. — Cost if wrong: cosmetic timestamp choice; revisitable.
- Ruling: `/facilities/status` requires an authenticated session (any role) — pilot is access-restricted (decision §1); page is sanitized but not anonymous. — Cost if wrong: one guard line to relax.
- Ruling: admin maintenance history ships as `/admin/facilities` (asset list w/ derived status) + `/admin/facilities/$assetId` (detail + full history); admin-only per §8 matrix. — Why: plan steps 1–2 need a display surface; no admin facilities pages exist yet. — Cost if wrong: extra page scope; kept minimal.
- Ruling: worker processes outbox rows in a transaction that inserts notifications + marks the row DISPATCHED atomically; failure path increments attempt_count, sets available_at backoff (2^attempt seconds), last_error; FAILED after attempt_count reaches 3 (dead-letter). AI rows excluded from claim. — Why: plan step 12 + decision §7 (max 3 retries then failed state). — Cost if wrong: at-least-once duplicates — guarded by P6-3 unique constraint.
- Ruling: notification count/read endpoints return only the session user's rows (ownership filter at query level, IDOR guard per §12.4). — Cost if wrong: privacy leak; tested.

## Task log
- (pending P6-1)
- P6-1: complete (commit 83d0768..0d25b57, review clean; domain 53/53, migration 0005 generated: notifications table + outbox last_error).
- P6-2: complete (commit 0d25b57..7b5f8c8, review clean; database 171 pass live incl. 16 new facilities tests; derived status pure fn + sanitized projection + history).
- P6-3: complete (commit 7b5f8c8..HEAD, review clean; database 179 pass live; content mapping + redelivery-duplicate + internal-note skip + 400/404 paths tested).
- P6-4 ruling: outbox claim = PENDING + available_at<=now + type<>AI_REVIEW_REQUESTED; process inside tx with FOR UPDATE re-check, then DISPATCHED+processed_at atomically. Failure: AppError status<500 → FAILED immediately (permanent, e.g. malformed payload/missing report); other errors retry with 2^n-second backoff, FAILED dead-letter at attempt_count 3 with redacted last_error. Lives in packages/database/src/outbox-consumer.ts (worker stays a thin loop). — Why: plan steps 8+12; 4xx never succeeds on retry (mirrors plan §8.7). — Cost if wrong: transient-looking 4xx kills a row early; bounded by content mapping being deterministic.
- P6-4 ruling update: claim uses negation (type <> AI_REVIEW_REQUESTED) instead of an allowlist so unknown future job types are claimed, retried, and visibly dead-lettered rather than silently rotting in PENDING. — Why: operational observability; AI rows still protected. — Cost if wrong: stray types burn retries — acceptable, visible in FAILED.
- Ruling: notifications GET shape = contract §6 verbatim ({ items, total, unreadCount }); addition, POST /api/notifications/read-all (bulk mark-as-read) alongside single read — plan step 10 wants the reporter to clear the queue; one extra guarded UPDATE is cheap. Contract gains the row in P6-6. — Cost if wrong: unused endpoint; trivial to drop.
- Ruling: REPORT_VERIFIED producer exists (repoApplyVerification queues the outbox row for both AI-PASS submit and held-verify) — P6-5a touches transitionReport only.

## P6-5 resume (2026-10-17, post-merge)
Branch phase-6-p6-5 from main aa8b9d8 (P6-1..P6-4 already merged to main; migration renumbered 0005→0008_bent_prowler during merge, SQL identical, journal/snapshot regenerated via drizzle-kit).
- Ruling: P6-4 logged as complete without its own review gate — the branch was merged and full suites ran green on the merge (database 200 live, worker 3/3); P6-6 whole-branch review covers P6-4's diff. — Why: review seat would duplicate the final review scope. — Cost if wrong: a P6-4 defect reaches P6-5b/c consumers; caught by final review.
- Ruling: report_events already emits REPORT_RESOLVED/REPORT_CLOSED but outbox rows enqueue kind STATUS_CHANGED for all transitions; notification mapper's RESOLVED/CLOSED cases are dead. P6-5a aligns producer kinds with the mapper (RESOLVED→REPORT_RESOLVED, CLOSED→REPORT_CLOSED, else STATUS_CHANGED). — Why: plan step 9 names resolved+closed notifications; ledger ruling 13 maps those kinds. — Cost if wrong: duplicate/missing rows; unique constraint guards.

### Pre-flight conflict scan (P6-5 tasks)
| Pair | Produces vs consumes | Finding |
|---|---|---|
| P6-5a vs notification mapper | enqueues kinds vs maps kinds | Mapper already has REPORT_RESOLVED + REPORT_CLOSED cases — no conflict, consuming side exists. |
| P6-5a vs P6-5b | producer adds kinds vs queries notifications table | Different files (workflow-extra.ts vs notifications.ts); 5b's list shows stored rows regardless of kind. Clean. |
| P6-5b vs P6-5c | /api/notifications routes vs /api/facilities + /api/admin/assets routes | Disjoint route files and pages; routeTree.gen.ts regenerated sequentially by single-file dispatch ordering. Clean. |
| P6-5b/c vs UI team | functional minimal UI now vs UI-Team designs later | Ruled: Phase 5 practice — ship minimal functional pages (release gate must be verifiable); UI team restyles. — Cost: rework by restyle, bounded. |
| P6-6 contract update vs 5b/5c endpoints | documents built endpoints | Runs after both; /api/notifications/:id/read and facilities shapes come verbatim from contract §6 plus mark-all ruling below. Clean. |
- P6-5a: complete (commit 12743ca, review Approved, 2 minors deferred below; database 201 pass). TDD RED→GREEN evidence in p6-5a-report.md.
- P6-5a: minor (deferred): test helper kindsFor count-delta style slightly verbose — reviewer ok, no rework.
- P6-5a ⚠️ resolved: reviewer's "line 417 still STATUS_CHANGED" was a grep of the MAIN checkout, not the worktree — verified kind conditional exists at HEAD 12743ca.
- P6-5b: complete (commit aac0f01, review Approved; 6 minors deferred below; database 206 + web 205 pass; RED/GREEN evidence in p6-5b-report.md).
- P6-5b deviation ruled: markAllNotificationsRead returns Promise<number> (brief said void) — required for the 200 { updated } read-all response; sole caller is the read-all transport. Record shape in contract at P6-6.
- P6-5b: minor (deferred): route files untested at handler level (matches codebase pattern); row-click vs ticketNumber-link-only interpretation; nav badge out (UI team); 403 N/A-by-construction (auth only 401 here); formatter rewrap of pre-existing AppShell line.
- P6-5b flake note (deferred): reports.test.ts transient green-on-rerun under parallel scratch-DB load — watch at P6-6.
- P6-5c: complete (commit b9396f8, review Approved; 5 minors deferred below; web 221 pass, 16 new service tests TDD).
- P6-5c interpretation ruled: include_inactive silently stripped for non-admin sessions (least-leaky reading of "admin extra" — no 400 leaking the flag's spelling); tested.
- P6-5c: minor (deferred): unbounded digit offset→Infinity path (repo returns empty page, mirrors admin reports); parser-level UUID-400 not explicitly asserted (mock throws both paths); double requireAdmin (route+service defense-in-depth); <time> missing dateTime attr (cosmetic).
- P6-5c ⚠️ resolved: facilities/status response passes DB projection through wholesale — sanitization rests on the DB layer per brief; DB-layer fields checked (no report content columns in FacilityStatusItem).

## P6-6b realignment ruling (EXECUTION-PLAN.md 2026-10-17 revision, single source of truth)
- Ruling: REPORTED_ISSUE DIHAPUS from domain FACILITY_STATUSES/deriveFacilityStatus (plan §4.6 "Tanpa REPORTED_ISSUE; 3 status aset admin-only"). Active REPORTED/VERIFIED reports map to UNDER_INSPECTION (the only "known issue, not yet in repair" bucket; mapping them OPERATIONAL would hide held-but-real defects). — Why: plan supersedes ledger ruling 14 (REPORTED/VERIFIED→REPORTED_ISSUE). — Cost if wrong: held (REPORTED) assets show UNDER_INSPECTION while unverified; acceptable proxy for "dilaporkan, ditangani".
- Ruling: /api/facilities/status restricted to ADMIN (plan §8 matrix: reporter = Tidak, UI No. 6; "tanpa endpoint status publik" test-minimum). Transport path unchanged (path is not a permission boundary); contract rows fix to admin-only. — Why: any-role session let reporters read facility status via API. — Cost if wrong: none (reporter never needed it).
- Ruled deferred (NOT Phase 6 scope): UI No. 10 progress-note rework (single note without PUBLIC/INTERNAL choice, LAPORAN_PALSU neutral projection, notifications for catatan progres incl. neutral projection) — Phase 5 frontend/backend follow-up, logged as successor work after Phase 6; mapper's INTERNAL_NOTE_ADDED skip stays correct until that rework lands.
- P6-6a: complete (commit 3ff4146, review Approved).
- P6-6b: complete (commit 2c0cf6b, review Approved; domain REPORTED_ISSUE eliminated, facilities/status admin-only, contract coherent after both tasks; domain 60 / database 206 live / web 221 pass).
- P6-6a/6b: minor (deferred): contract preamble line "[Phase 6] belum dibangun" now contradicts §6 heading (doc polish at P6-6-final); guard tests mock requireAdmin (house pattern, real role path unexercised in transport package).
- P6-6-final: dispatch final whole-branch review (aa8b9d8..2c0cf6b, all Phase 6 + realignment work) with deferred-minors triage.
- P6-6-final: review READY (no Critical/Important; test-minimum checklist fully mapped; deferred minors all SHIP except 1-line contract preamble → fixed in 631a7c8; scoped re-review clean).
- Phase 6: COMPLETE on branch phase-6-p6-5. Merge to main follows; ledger workspace retained until merge verified.
## P6-5 merge to main (2026-10-18)
- Main moved during P6-5 SDD: user committed 283c2f9 (P5 e2e incl. UI No. 10 progress-note rework — addProgressNote single note with condition, migration 0009, PROGRESS_NOTE_ADDED notifications, LAPORAN_PALSU neutral projection — the deferred rule's successor work landed) and b1f2768 (phase-3 fixes: /reporter/reports gains mine param, nav label Tiket Kampus).
- Merge 5786ac8 resolved 3 conflicts: AppShell (reporter nav = Laporkan + Tiket Kampus + Notifikasi), progress.md (kept user's 2 ruling lines + full P6-5/P6-6 section), api-contract.md (their supersede-preamble kept + built-state sentence; §6 merged: their heading/assertion + built /api/facilities/status admin-only row; "endpoint daftar status admin menyusul" moot + removed; notification kinds now name PROGRESS_NOTE_ADDED produced, PUBLIC_UPDATE_ADDED legacy-only).
- Semantic integration verified: P6-5a kind conditional survived their workflow-extra rewrite; their addProgressNote→PROGRESS_NOTE_ADDED + mapper case 79 both present pre-commit.
- Merge follow-up: reporter.notifikasi Link needed their new required `mine` search param (typecheck-only failure; fixed post-merge).
- Post-merge verification green: domain 60/60, web 228/228, database 208 pass + 1 skip (13 files), worker 3/3; :lint ×10, :typecheck ×10 pass. Migration 0009 applied to dev DB (report_updates.condition verified).

## Phase 7 (Dashboard + deterministic analytics) — SDD bootstrap (2026-10-18)
- Worktree `.worktrees/phase-7-analytics`, branch `phase-7-analytics` from 816af0b (main post-P6 merge). Plan committed 47c27b5: docs/superpowers/plans/2026-10-18-phase-7-analytics.md.
- User decisions 2026-10-18: SDD flow (worktree/ledger/briefs/reviews, continuous execution); hand-rolled SVG charts, no chart lib; UI No. 11 = Dashboard real + Pengaturan Scoring / Laporan Maintenance mock-only (disabled submit + "Endpoint menyusul" note); playwright system deps installed by user.
- Pre-task e2e triage (env now works): scenarios 7 and 9 red. 7 = stale selector for the P5-reworked duplicate-block screen; 9 = hardcoded asset index 2 already reporter-active on the persistent dev DB + stacked second photo (success screen showed "2 foto terlampir."). Both test-only; fix 86beff9 (auto-pick first asset without a reporter-active ticket, single named-photo fixture, current block-screen link + href assert). Full e2e dir 10/10 green after fix.
- Observation (benign, no action): e2e runs log dev-server `unhandled: true` ECONNRESET "aborted" entries — in-flight requests aborted at browser-context close; no test impact; structured rejection audits (NOT_FOUND/FORBIDDEN/DUPLICATE_ACTIVE) appear as designed.

### Phase 7 tasks
- T1 (analytics bootstrap + Jakarta time helpers): complete (commit 4491194, review Approved w/ minors; analytics lint/typecheck/test green, 10 tests; database:typecheck green with the barrel migrate export). Minor: plan's "(11 tests)" was a miscount → fixed to 10. Minor deferred: years 0000–0099 rejected by the Date.UTC round-trip (still 400; harmless for report-era dates).
