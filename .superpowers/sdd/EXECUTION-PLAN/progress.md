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
