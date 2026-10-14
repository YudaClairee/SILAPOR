# AI Verification Design — 2026-10-14

## Intent and why

Report verification belongs to the AI end to end. A reporter files a
report, the AI checks the photos are clear and real, checks the written
description actually matches the asset the reporter picked, and sets the
asset category, the issue type, and the priority by itself. A pass turns
the report VERIFIED with no admin click. The human partner's reason:
verification must be instant at submit time, and admins should spend
their time on real repair work, not re-reading every report. The admin
is purely a fallback: when the outside AI service cannot run, held
reports wait until an admin verifies them by hand.

## Goals

- Reporter submits building, floor, room, and asset (all four required),
  a description, and up to 3 photos (existing 5 MB limit stays).
- AI auto-pass: photos clear and relevant, description matches the
  chosen asset. System writes `final_category_id`, `final_issue_type_id`,
  and `final_priority`, sets status VERIFIED, and the ticket flows on
  toward assignment and repair.
- AI clear fail: stopped at submit with one plain reason the reporter
  can act on (retake the photo, fix the description). Nothing sits in a
  queue.
- AI service down (third-party API unreachable): the report is saved and
  held as unverified. The reporter sees their own report as waiting for
  its check; the full held queue is visible only to admins. The held
  report moves only when an admin verifies it by hand, doing
  the same checks (photos, description-to-asset match, category, issue
  type, priority).
- Taxonomy is fixed master data, never free text. Six active categories
  (`data/master/facility-categories.csv`: ELECTRICAL, HVAC, FURNITURE,
  ELECTRONIC, PLUMBING, OTHER) and seven generic issue types
  (`data/master/issue-types.csv`: BROKEN, NOT_WORKING, MISSING, DIRTY,
  LEAKING, DANGEROUS, OTHER). `DANGEROUS` keeps minimum HIGH priority.
  The AI chooses only from these lists (partner answer 4). If the
  description points to a different category than the chosen asset's own
  master category, that is a mismatch: fail with a wrong-asset reason
  rather than recategorizing silently (call from partner answer 4).

## Non-goals

- Review-screen UI layout (deferred; to be discussed later).
- Admin editing AI results when the AI works. There is no override path.
- Changing scoring weights, upload limits, auth, or master-data CRUD.
- Email/WhatsApp notification, predictive maintenance, reopen flows.

## Anti-goals

- The AI guessing on a report it cannot judge. Unsure while running is
  treated as a fail with a plain "needs clearer evidence" reason, never
  a silent VERIFIED (builder call, flagged below).
- A doubtful report slipping through or being killed without a reason
  the reporter can act on.
- Two sources of truth for category, issue type, or priority.

## Constraints

- Stack stays: TanStack Start modular monolith, PostgreSQL outbox plus
  Node queue worker, OpenRouter behind the existing review-assistant
  interface (raw fetch plus Zod, pinned model, ZDR routing).
- Deterministic duplicate blocking and merging (same reporter blocked,
  different reporter merged as SUPPORTING) keeps running while reports
  are held, since it needs no AI.
- The following EXECUTION-PLAN.md lines contradict this design and must
  be rewritten after approval, not before: principle 5 (AI suggestion
  vs final), the §4.2 transition table (REJECTED/DUPLICATE, reopen),
  §4.11 plus §6.4 (AI only suggests, admin decides), the Phase 3 test
  "AI down means submit fails", and Phase 5/8 manual-verify steps.

## How it behaves (decided)

1. Submit with full asset chain, description, and at least 1 photo
   (0 photos is a validation fail before the AI runs). The reporter
   waits in the submit moment for the verdict (synchronous, partner
   answer 1).
2. AI checks photo clarity and relevance, then description-to-asset
   match, then writes category, issue type, and priority from master
   data only.
3. Pass becomes VERIFIED automatically and consumes a ticket number.
   Fail saves nothing, consumes no ticket, and stops with a plain
   reason; fixing means filing a fresh report (partner answer 2).
4. AI service down means save, hold as unverified, tell the reporter it
   is waiting. Held reports are visible only to admins.
5. Admin hand-verification of a held report behaves exactly like an
   AI VERIFIED from there on (assignment, transitions, timeline,
   notifications).

## Left to the builder

- Exact copy for the "waiting for check" reporter notice and the admin
  held-queue labels.
- Retry-then-hold timing versus immediate hold when the AI API errors.
- Whether a held report keeps its place in analytics as unclassified
  until verified (suggested: yes, `final_category_id` null reads as
  unclassified).
- Manual review screen fields and layout (UI discussion deferred).

## Calls made by the writer (check while reading)

- Ticket number issued at submit even while held (pass and held only;
  fails consume none).
- Unsure-while-running treated as fail with reason, not a held item.
- Duplicate auto-checks keep running during an AI outage.
- No admin override of AI results, ever.
- Reporter sees own held report as pending; full held queue admin-only
  (settled from campus-visibility precedent, reviewer question 6).
- Error taxonomy (my call, reviewer question 3): transient failures
  (timeout, 5xx, 429) retry, then hold for admin; deterministic ones
  (4xx, auth, schema rejection, model refusal) fail at submit with a
  plain reason.
- Pipeline order (my call, reviewer question 7): duplicate block/merge
  check runs first at submit, AI verify/hold second; a report merged as
  supporting into a held ticket still needs the one verification.
