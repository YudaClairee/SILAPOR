# AI Verification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the AI the synchronous verifier at report submit: it checks photo clarity and description-to-asset match, sets final category, issue type, and priority from master data, and the report becomes VERIFIED inline; when the AI service is down, reports are held for manual admin verification.

**Architecture:** Submit path calls `@silapor/ai` inline with a timeout (no queue for verification); photos upload before the report row exists so the AI can read them; duplicate block/merge runs before AI; held reports stay REPORTED until hand-verified. Notifications keep the existing outbox.

**Tech Stack:** TypeScript, TanStack Start server routes, Drizzle ORM + PostgreSQL, Vitest, OpenRouter via raw fetch + Zod (`@silapor/ai`), Moonrepo tasks.

**Spec:** `docs/superpowers/specs/2026-10-14-ai-verification-design.md`

## Global Constraints

- Reporter input is Gedung → Lantai → Ruangan → Aset (all required) + description (10–2000 chars) + min 1 photo, max 3 photos, max 5 MB per file (JPEG/PNG/WebP).
- Reporter never sends category or issue type; `reporterId` always comes from the session, never the client.
- Closed taxonomy only: 6 categories and 7 issue types from `data/master/*.csv`; `DANGEROUS` forces minimum HIGH.
- Fail saves no report row, consumes no ticket; fix means a fresh report with a new idempotency key.
- No admin override of AI results, ever; all 404s use byte-identical `'Report not found'` bodies.
- `packages/domain` imports no framework or infra (see `eslint.config.mjs`).

## Review Focus

- AI call times out at the submit boundary: reporter must get a held ticket with a waiting notice, never a hang or a 500 (pinned in Task 6).
- Photo shows a different asset than chosen (e.g. toilet photo on AC-04): must fail with a wrong-asset reason, never silent recategorization (pinned in Task 2).
- Same reporter double-submits the same asset concurrently: second submit blocked with the active ticket ref, exactly one row (pinned in Task 3).
- Held REPORTED ticket later duplicated by another reporter: merge as SUPPORTING still needs the one verification, no double repair jobs (pinned in Task 3).
- Admin hand-verify sends a category code outside master data: rejected before any write (pinned in Task 7).

## File Structure

- `packages/domain/src/index.ts` (+ `transitions.test.ts`): 7-status matrix, no REJECTED/DUPLICATE, no reopen; priority scorer stays as the audit snapshot.
- New `packages/domain/src/ai-verdict.ts` (+ test): pure mapping of AI output onto master lists, mismatch detection.
- `packages/database/src/reports.ts` (+ `reports.test.ts`): new input shape (asset required, no submitted category/issue), duplicate-first block/merge, held state, verifier-applied finals.
- New migration + `packages/database/src/ai-analyses.ts`: `ai_analyses` rows per EXECUTION-PLAN §7.1 (status PENDING/PROCESSING/SUCCEEDED/FAILED, verdict fields, model, prompt/schema versions, attempt_count, error_code).
- `packages/ai/src/`: OpenRouter verify client + Zod schemas + mock assistant (replaces `AI_PLACEHOLDER`).
- `apps/web/src/server/reports.ts` (+ `reports.test.ts`), `apps/web/src/routes/api/reports.ts`: sync verify inline with timeout, photo-first flow, held fallback.
- `apps/web/src/routes/reporter.reports.new.tsx`: form without category/issue selects, waiting state, fail-reason and held-pending screens.
- Admin held queue: new server `verifyHeldReport` + route `apps/web/src/routes/api/admin/reports.$id.verify.ts` + queue UI under `/admin/reports`.
- `EXECUTION-PLAN.md` + `docs/api-contract.md` note: rewrite stale AI-suggestion/manual-verify sections.

### Task 1: Domain lifecycle to 7 statuses

**Files:**
- Modify: `packages/domain/src/index.ts`
- Test: `packages/domain/src/transitions.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `REPORT_STATUS` (7 entries, no REJECTED/DUPLICATE), `REPORT_TRANSITIONS` with `REPORTED: ['VERIFIED']`, `INSPECTION: ['IN_REPAIR']`, `RESOLVED: ['CLOSED']`, `TERMINAL_STATUSES = ['CLOSED']`, `requiresNote()` with no REOPEN path.

- [ ] **Step 1: Write the failing test**

```ts
it('has exactly 7 statuses and no reopen', () => {
  expect(REPORT_STATUS).toEqual(['REPORTED','VERIFIED','ASSIGNED','INSPECTION','IN_REPAIR','RESOLVED','CLOSED']);
  expect(canTransition('RESOLVED', 'IN_REPAIR')).toBe(false);
  expect(canTransition('REPORTED', 'VERIFIED')).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @silapor/domain run test`
Expected: FAIL on the new assertion (REJECTED/DUPLICATE still present).

- [ ] **Step 3: Implement the 7-status matrix in `packages/domain/src/index.ts`**

Remove REJECTED/DUPLICATE entries, the REOPEN branch in `requiresNote`, and shrink `TERMINAL_STATUSES` to `['CLOSED']`; keep all other exports byte-identical.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @silapor/domain run test`
Expected: PASS, all suites green.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/index.ts packages/domain/src/transitions.test.ts
git commit -m "feat(domain): seven-status lifecycle without reject duplicate reopen"
```

### Task 2: Pure AI-verdict mapping

**Files:**
- Create: `packages/domain/src/ai-verdict.ts`
- Test: `packages/domain/src/ai-verdict.test.ts`

**Interfaces:**
- Consumes: master-list codes passed in by callers (no imports; domain stays dependency-free).
- Produces: `mapAiVerdict(input: AiVerdictInput) -> AiVerdictResult` where result is `{ ok: true, categoryCode, issueTypeCode, priority }` or `{ ok: false, reason: 'WRONG_ASSET' | 'UNCLEAR_EVIDENCE' | 'UNKNOWN_CODE' }`; mismatch (description-implied category differs from the asset's master category) returns `WRONG_ASSET`, never a silent recode.

- [ ] **Step 1: Write the failing test**

```ts
it('fails wrong-asset instead of recoding', () => {
  const r = mapAiVerdict({ impliedCategory: 'PLUMBING', assetCategory: 'HVAC', category: 'PLUMBING', issueType: 'LEAKING', priority: 'HIGH', categories: CATS, issueTypes: ISSUES });
  expect(r).toEqual({ ok: false, reason: 'WRONG_ASSET' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @silapor/domain run test`
Expected: FAIL with "mapAiVerdict not defined".

- [ ] **Step 3: Implement `mapAiVerdict` in `packages/domain/src/ai-verdict.ts`**

Validate codes against the passed-in lists first (unknown → `UNKNOWN_CODE`), then mismatch check (→ `WRONG_ASSET`), else pass through priority untouched.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @silapor/domain run test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/domain/src/ai-verdict.ts packages/domain/src/ai-verdict.test.ts
git commit -m "feat(domain): pure AI verdict mapping with wrong-asset guard"
```

### Task 3: Database submit rework with duplicate-first

**Files:**
- Modify: `packages/database/src/reports.ts`
- Test: `packages/database/src/reports.test.ts`

**Interfaces:**
- Consumes: `mapAiVerdict` types from Task 2 (copied as structural types, not imported — database may not depend on domain).
- Produces: `CreateReportInput` with required `assetId: string`, no `submittedCategoryId`/`submittedIssueTypeId`/`occurredAt`; `createReport` runs duplicate check first (same reporter + same asset + active → throw `DUPLICATE_ACTIVE` carrying the active ticket number; different reporter actives → create then link SUPPORTING after verification); `applyVerification(reportId, finals)` sets final fields + VERIFIED + events atomically.

- [ ] **Step 1: Write the failing test**

```ts
it('blocks same-reporter same-asset active submit with ticket ref', async () => {
  await expect(createReport(secondSameAssetInput)).rejects.toMatchObject({ code: 'DUPLICATE_ACTIVE', ticketNumber: firstTicket });
});

it('links a different-reporter same-incident report as SUPPORTING', async () => {
  const res = await createReport(otherReporterSameAssetInput);
  expect(res.relation).toEqual({ type: 'SUPPORTING', targetTicket: firstTicket });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @silapor/database run test`
Expected: FAIL (second submit currently creates a row).

- [ ] **Step 3: Implement duplicate-first `createReport` in `packages/database/src/reports.ts`**

New shape validation (asset required, category/issue fields rejected if sent); same-reporter same-asset active lookup before ticket generation so fails consume no ticket; keep idempotency-key behavior unchanged.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @silapor/database run test`
Expected: PASS (DB integration tests run live with DATABASE_URL, skip clearly without it).

- [ ] **Step 5: Commit**

```bash
git add packages/database/src/reports.ts packages/database/src/reports.test.ts
git commit -m "feat(database): duplicate-first submit without reporter category"
```

### Task 4: ai_analyses persistence

**Files:**
- Create: migration `packages/database/drizzle/000X_ai_analyses.sql`, `packages/database/src/ai-analyses.ts`
- Test: `packages/database/src/ai-analyses.test.ts`

**Interfaces:**
- Consumes: report row id.
- Produces: `recordAiAnalysis(input)`, `markAiAnalysis(id, outcome)` with statuses `PENDING | PROCESSING | SUCCEEDED | FAILED` and nullable verdict, category, issue type, priority, confidence, reason, model, prompt/schema versions, attempt_count, error_code.

- [ ] **Step 1: Write the failing test**

```ts
it('records a PENDING analysis then marks it SUCCEEDED', async () => {
  const row = await recordAiAnalysis({ reportId, model: 'MODEL_UNDER_TEST', promptVersion: 'v1', schemaVersion: 'v1' });
  expect(row.status).toBe('PENDING');
  const done = await markAiAnalysis(row.id, { status: 'SUCCEEDED', category: 'HVAC', issueType: 'LEAKING', priority: 'HIGH' });
  expect(done.status).toBe('SUCCEEDED');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @silapor/database run test`
Expected: FAIL with "recordAiAnalysis not defined".

- [ ] **Step 3: Implement migration + `recordAiAnalysis`/`markAiAnalysis` in `packages/database/src/ai-analyses.ts`**

Columns per EXECUTION-PLAN §7.1 `ai_analyses`; raw prompt/response never stored.

- [ ] **Step 4: Run tests and migration check**

Run: `pnpm --filter @silapor/database run test`
Expected: PASS on an empty database; double-run migration stays clean.

- [ ] **Step 5: Commit**

```bash
git add packages/database/drizzle/000X_ai_analyses.sql packages/database/src/ai-analyses.ts packages/database/src/ai-analyses.test.ts
git commit -m "feat(database): ai_analyses persistence for verification verdicts"
```

### Task 5: AI verify client with timeout classes

**Files:**
- Modify: `packages/ai/src/index.ts` (remove `AI_PLACEHOLDER`)
- Create: `packages/ai/src/verify.ts`, `packages/ai/src/schema.ts`
- Test: `packages/ai/src/verify.test.ts`

**Interfaces:**
- Consumes: photos (storage keys or bytes supplied by caller), description, asset context, master code lists.
- Produces: `verifyReport(input: VerifyInput, opts: { timeoutMs }) -> VerifyOutcome` where outcome is `{ kind: 'PASS', category, issueType, priority, confidence, reasons }` | `{ kind: 'FAIL', reason }` | `{ kind: 'DOWN' }`; timeouts, 5xx, and 429 map to `DOWN`; 4xx/auth/schema rejections map to `FAIL`; plus `MockVerifyAssistant` with canned PASS/FAIL/DOWN for tests.

- [ ] **Step 1: Write the failing test**

```ts
it('maps timeout to DOWN, never to FAIL', async () => {
  const out = await verifyReport(input, { timeoutMs: 5, fetch: hangingFetch });
  expect(out).toEqual({ kind: 'DOWN' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @silapor/ai run test`
Expected: FAIL with "verifyReport not defined".

- [ ] **Step 3: Implement `verifyReport` in `packages/ai/src/verify.ts`**

Raw fetch to OpenRouter with pinned model slug, ZDR routing, Zod-validated structured output; no reporter identity, attachments, or tech PII in the payload; timeout via AbortController.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @silapor/ai run test`
Expected: PASS with no network calls (all fetch paths injected/faked).

- [ ] **Step 5: Commit**

```bash
git add packages/ai/src/index.ts packages/ai/src/verify.ts packages/ai/src/schema.ts packages/ai/src/verify.test.ts
git commit -m "feat(ai): synchronous verify client with DOWN versus FAIL classes"
```

### Task 6: Synchronous submit path with held fallback

**Files:**
- Modify: `apps/web/src/server/reports.ts`, `apps/web/src/routes/api/reports.ts`
- Test: `apps/web/src/server/reports.test.ts`

**Interfaces:**
- Consumes: `verifyReport` (Task 5), `mapAiVerdict` semantics (Task 2), `createReport`/`applyVerification` (Task 3), `recordAiAnalysis`/`markAiAnalysis` (Task 4).
- Produces: `POST /api/reports` behavior — min-1-photo validation; photos uploaded first via existing attachment flow and keys passed with submit; inline verify: PASS → row + VERIFIED + ticket (201); FAIL → 422 `{ reason }`, no row, no ticket; DOWN → row held as REPORTED + ticket (202) with waiting notice; duplicate-block → 409 with active ticket ref.

- [ ] **Step 1: Write the failing test**

```ts
it('holds as REPORTED with a ticket when the AI is DOWN', async () => {
  const res = await submitHeldReport(inputWithDownAi());
  expect(res.status).toBe(202);
  expect(res.ticketNumber).toMatch(/^MNT-/);
});
```

(Implementer: name the test for the actual submit helper in `reports.ts`; assert 202 + ticket + REPORTED row + PENDING analysis.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @silapor/web run test`
Expected: FAIL (DOWN currently surfaces as 500).

- [ ] **Step 3: Implement inline verify in `apps/web/src/server/reports.ts`**

Normalize new body (location, asset required; drop category/issue/occurredAt acceptance); call `verifyReport` with the configured timeout; map outcomes per Interfaces; keep `REPORT_NOT_FOUND_MESSAGE` and session-derived reporterId untouched. On PASS also apply the `DANGEROUS` → minimum HIGH floor, snapshot the deterministic scorer output into `priority_factors` for audit, and link any different-reporter actives as SUPPORTING before returning the ticket.

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm --filter @silapor/web run test` then `pnpm --filter @silapor/web run typecheck`
Expected: PASS, zero type errors.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/server/reports.ts apps/web/src/server/reports.test.ts apps/web/src/routes/api/reports.ts
git commit -m "feat(web): synchronous AI verification with held fallback"
```

### Task 7: Reporter form for the new flow

**Files:**
- Modify: `apps/web/src/routes/reporter.reports.new.tsx`
- Test: extend existing route/form tests or add `apps/web/src/routes/reporter.reports.new.test.tsx`

**Interfaces:**
- Consumes: `GET /api/reports/form-options` (locations + assets only), Task 6 submit behavior.
- Produces: form with Gedung → Lantai → Ruangan → Aset (all required, no category/issue selects), photo picker requiring 1–3 files, blocking waiting state for the verdict, FAIL screen with reason + fresh-report retry, HELD screen with ticket + waiting notice.

- [ ] **Step 1: Write the failing test**

```tsx
it('disables submit with no photo and requires the full asset chain', async () => {
  render(<NewReportPage />);
  expect(screen.getByRole('button', { name: /submit/i })).toBeDisabled();
  expect(screen.queryByLabelText(/kategori/i)).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @silapor/web run test`
Expected: FAIL (category select still rendered).

- [ ] **Step 3: Implement the form in `apps/web/src/routes/reporter.reports.new.tsx`**

Photo-first upload (reuse `uploadReportAttachments`), then submit with keys; verdict-driven screens per Interfaces; keep loading/empty/error/forbidden states.

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm --filter @silapor/web run test` then `pnpm --filter @silapor/web run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/routes/reporter.reports.new.tsx apps/web/src/routes/reporter.reports.new.test.tsx
git commit -m "feat(web): reporter form for AI verification flow"
```

### Task 8: Admin hand-verification of held reports

**Files:**
- Create: `apps/web/src/server/held.ts`, `apps/web/src/routes/api/admin/reports.$id.verify.ts`
- Modify: admin reports list/detail routes for the held queue
- Test: `apps/web/src/server/held.test.ts`

**Interfaces:**
- Consumes: `applyVerification` (Task 3), `mapAiVerdict` semantics (Task 2).
- Produces: `verifyHeldReport(adminId, reportId, { category, issueType, priority } | { reject: reason }, expectedVersion)` — category/issue validated against master lists before any write (invalid → 400, no write); held queue lists REPORTED-unverified rows; reporters see only their own held ticket as pending.

- [ ] **Step 1: Write the failing test**

```ts
it('rejects hand-verify with an unknown category before any write', async () => {
  await expect(verifyHeldReport(admin, heldId, { category: 'NOPE', issueType: 'LEAKING', priority: 'HIGH' }, v)).rejects.toMatchObject({ status: 400 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @silapor/web run test`
Expected: FAIL with "verifyHeldReport not defined".

- [ ] **Step 3: Implement `verifyHeldReport` in `apps/web/src/server/held.ts`**

Optimistic locking via `expectedVersion` (409 + refresh banner per API No.12); refuse any row that is not an unverified REPORTED hold (410 Gone, no write); audit the hand-verification; reporter-owned reads stay sanitized with own-held visible as pending.

- [ ] **Step 4: Run tests and typecheck**

Run: `pnpm --filter @silapor/web run test` then `pnpm --filter @silapor/web run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/server/held.ts apps/web/src/server/held.test.ts apps/web/src/routes/api/admin/reports.\$id.verify.ts
git commit -m "feat(web): admin hand-verification for held reports"
```

### Task 9: Fold the design into plan and contract docs

> **Done 2026-10-14 by controller directly in `EXECUTION-PLAN.md`** (sync verify, 7 statuses, closed taxonomy, fail/hold semantics, photo-first flow, hand-verify fallback, Phase 8 rewrite). Remaining: `docs/api-contract.md` submit contract update (step 2 below).

**Files:**
- Modify: `EXECUTION-PLAN.md` (§3 principle 5, §4.2 table, §4.11, §6.4, Phase 3/5/8 steps, demo scenario), `docs/api-contract.md` (submit/verify/held endpoints)

**Interfaces:**
- Consumes: approved spec `docs/superpowers/specs/2026-10-14-ai-verification-design.md`.
- Produces: plan text where every AI-verification statement matches the spec; explicit note that `api-contract` manual-verification section is superseded.

- [ ] **Step 1: Rewrite the conflicting EXECUTION-PLAN sections**

Sync verify at submit, 7 statuses, no reopen, closed taxonomy, fail/hold semantics, photo-first flow, hand-verify fallback.

- [ ] **Step 2: Update `docs/api-contract.md` submit contract**

201 VERIFIED + ticket, 422 fail reason, 202 held + ticket, 409 duplicate with active ticket ref; form-options without reporter category/issue.

- [ ] **Step 3: Self-check the rewrite against the spec**

Every line of the spec's Goals and Behavior sections must have a matching plan line; list any deliberate omission in the commit message.

- [ ] **Step 4: Commit**

```bash
git add EXECUTION-PLAN.md docs/api-contract.md
git commit -m "docs: fold approved AI verification design into plan and contract"
```
