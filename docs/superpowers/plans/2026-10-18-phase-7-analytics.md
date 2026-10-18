# Phase 7 — Dashboard and Deterministic Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build deterministic, fixture-tested analytics queries (overview cards, by status/category/location, resolution time, technician workload, priority queue), expose them via an admin-only endpoint, and ship the admin Dashboard page plus the two UI No. 11 mock pages (Pengaturan Scoring, Laporan Maintenance) with hand-rolled accessible SVG charts.

**Architecture:** Metric query services live in the existing `@silapor/analytics` stub package (the designated home per architecture §6.3), depending on `@silapor/database` for schema/db types. Web transport follows the P6-5c `apps/web/src/server/facilities.ts` pattern: `requireAdmin` + query parsing + `getDb()` handle, wrapped by a route file using `withRequestId`/`toHttpResponse`. Dashboard consumes `GET /api/admin/analytics/overview` through the SSR loader pattern of `admin.facilities.index.tsx`. Charts are one hand-rolled `BarChart` component (no chart library).

**Tech Stack:** TypeScript, drizzle-orm 0.45.x, PostgreSQL (live scratch-DB tests), vitest 5.0.3, TanStack Start/Router, Tailwind.

**Spec:** `EXECUTION-PLAN.md` — Phase 7 (lines 1271–1322, metric definitions + steps + test minimum + release gate); UI No. 11 at lines 17/335/337 and §10.2; timezone decision Phase 0 step 17 (`Asia/Jakarta` business tz, UTC storage). User decisions (2026-10-18): SDD flow, hand-rolled SVG charts, Dashboard real + Scoring/Maintenance mock-only.

## Global Constraints

- Canonical statuses only: `REPORTED, VERIFIED, ASSIGNED, INSPECTION, IN_REPAIR, RESOLVED, CLOSED`. Legacy pg-enum values `REJECTED`/`DUPLICATE` are superseded (UI No. 7) and **excluded from every metric** (filter with `inArray(status, REPORT_STATUS)`).
- `finalPriority` is text `LOW | MEDIUM | HIGH | null` (not a pg enum).
- Business timezone is `Asia/Jakarta` = fixed UTC+07:00 (WIB has no DST). Timestamps stored as UTC instants.
- Date params are `YYYY-MM-DD` Jakarta days, `from`/`to` inclusive; `to` maps to an exclusive upper bound of next-day 00:00 WIB.
- UI copy in Indonesian, following existing component classes and states (`LoadingState`, `EmptyState`, `ErrorPanel`, table classes from `admin.reports.index.tsx`).
- No new runtime dependencies in `apps/web`; charts are hand-rolled SVG.
- Module style: `type Database = PostgresJsDatabase<typeof schema>` alias, `AppError` factories from `@silapor/shared` (`badRequest`/`notFound`), `.js`-suffixed relative imports (ESM, matches `packages/database`).
- Every task ends green: `pnpm moon run <project>:lint <project>:typecheck <project>:test` (or `pnpm --filter <pkg> run <script>`).
- Commit message style: conventional commits, scope `p7` where sensible (e.g. `feat(p7): ...`).

## My calls (handoff checklist — verify while reviewing)

1. **Range semantics:** report-count metrics filter on `reported_at`; `resolutionTime` filters reports with `resolved_at` inside the range; `resolvedThisMonth` is always the current Jakarta month regardless of range; range absent = unbounded (all time).
2. **`activeReports`** = status in the six canonical non-CLOSED values (plan: "hanya CLOSED yang non-aktif"), which includes `RESOLVED`.
3. **Legacy rows** never appear in charts or counts (constraint above).
4. **Top-N defaults:** byCategory 8, byLocation 8, priorityQueue 10; byStatus always all 7 (zero-filled).
5. **Technician workload** lists all active technicians including zero-count rows, ordered count desc then name asc.
6. **Priority queue** = statuses `REPORTED..IN_REPAIR`, ordered HIGH→MEDIUM→LOW→null then `reported_at` asc.
7. **BarChart** is horizontal (label, bar, value text) — readable without color; values printed as text.
8. **PDF button and Scoring submit** are rendered but disabled with a visible "endpoint menyusul" note (No. 11 mock scope).
9. `runMigrations` is exported from the `@silapor/database` barrel (one-line addition) so analytics live tests can build scratch DBs.

## Review Focus

1. **Jakarta midnight boundaries** — a report at exactly `2026-09-30T17:00:00Z` is Jakarta 2026-10-01 and must be inside `from=2026-10-01`; `16:59:59Z` must be outside. Test pinned in Task 2.
2. **Empty/zero data** — zero reports in range must yield zero cards, `null` resolution metrics, empty-message charts, and zero-width bars without NaN. Tests in Tasks 2, 5, 6.
3. **Legacy status rows** — a stored `REJECTED`/`DUPLICATE` row must not affect any metric or chart. Test in Task 2.
4. **Reassignment history** — a reassigned report counts once, under its current technician; stale `unassigned_at` rows are ignored. Test in Task 3.
5. **Non-color encoding and rounding** — chart values are visible text, durations rounded to whole seconds (`Math.round`), UI shows `id-ID` formatting. Tests in Tasks 5, 6.

---

### Task 1: Analytics package bootstrap + Jakarta time-range helpers

**Files:**
- Modify: `packages/analytics/package.json` (deps, devDeps, test script)
- Create: `packages/analytics/vitest.config.ts`
- Create: `packages/analytics/src/time.ts`, `packages/analytics/src/time.test.ts`
- Modify: `packages/analytics/src/index.ts`
- Modify: `packages/database/src/index.ts` (add `export * from './migrate.js';`)

**Interfaces:**
- Produces: `jakartaDayStartUtc(day: string): Date`, `jakartaDayRange(input: { from?: string | null; to?: string | null }): { from?: Date; toExclusive?: Date }`, `jakartaMonthBoundsUtc(now?: Date): { start: Date; endExclusive: Date }` — all throwing `badRequest(...)` (AppError, status 400) on malformed input.
- `isDirectRun()` guard in `packages/database/src/migrate.ts` makes the barrel export import-safe (verified).

- [ ] **Step 1: Bootstrap package files**

`packages/analytics/package.json`: add `"@silapor/database": "workspace:*"` and `"drizzle-orm": "^0.45.4"` to dependencies; add devDependencies `"vitest": "5.0.3"`, `"@types/node": "^26.6.5"`; change test script to `"test": "vitest run"`. Mirror `packages/database/package.json` key order.

`packages/analytics/vitest.config.ts` — copy `packages/database/vitest.config.ts` (node environment, `include: ['src/**/*.test.ts']`).

`packages/database/src/index.ts`: append `export * from './migrate.js';`.

Run: `pnpm install` (repo root of the worktree).

- [ ] **Step 2: Write the failing tests**

`packages/analytics/src/time.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isAppError } from '@silapor/shared';
import { jakartaDayRange, jakartaDayStartUtc, jakartaMonthBoundsUtc } from './time.js';

describe('jakartaDayStartUtc', () => {
  it('treats a Jakarta day as starting 17:00Z the previous day', () => {
    expect(jakartaDayStartUtc('2026-10-18').toISOString()).toBe('2026-10-17T17:00:00.000Z');
  });
  it.each(['2026-13-01', '2026-02-30', 'abc', '2026-1-1', '20261018'])(
    'rejects malformed day %s with a 400',
    (day) => {
      try {
        jakartaDayStartUtc(day);
        expect.unreachable('should have thrown');
      } catch (error) {
        expect(isAppError(error) && error.status === 400).toBe(true);
      }
    },
  );
});

describe('jakartaDayRange', () => {
  it('maps from and to to an inclusive Jakarta day window', () => {
    const range = jakartaDayRange({ from: '2026-10-01', to: '2026-10-18' });
    expect(range.from?.toISOString()).toBe('2026-09-30T17:00:00.000Z');
    expect(range.toExclusive?.toISOString()).toBe('2026-10-18T17:00:00.000Z');
  });
  it('returns an empty range when params are absent', () => {
    expect(jakartaDayRange({})).toEqual({});
    expect(jakartaDayRange({ from: null, to: null })).toEqual({});
  });
});

describe('jakartaMonthBoundsUtc', () => {
  it('uses the Jakarta month even when UTC is still the previous month', () => {
    const bounds = jakartaMonthBoundsUtc(new Date('2026-10-31T18:00:00.000Z'));
    expect(bounds.start.toISOString()).toBe('2026-10-31T17:00:00.000Z');
    expect(bounds.endExclusive.toISOString()).toBe('2026-11-30T17:00:00.000Z');
  });
  it('handles year rollover', () => {
    const bounds = jakartaMonthBoundsUtc(new Date('2026-12-15T00:00:00.000Z'));
    expect(bounds.endExclusive.toISOString()).toBe('2026-12-31T17:00:00.000Z');
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @silapor/analytics test`
Expected: FAIL — cannot resolve `./time.js`.

- [ ] **Step 4: Implement `src/time.ts`**

Approach: validate with `/^\d{4}-\d{2}-\d{2}$/` plus real-calendar check (`Date.UTC` round-trip); compute instants as `Date.UTC(year, monthIndex, day) - 7 * 3600_000` (fixed WIB offset; comment that Asia/Jakarta has no DST). Derive Jakarta year/month in `jakartaMonthBoundsUtc` with `Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jakarta', year: 'numeric', month: 'numeric' })` (mirrors `getJakartaYear` in `packages/database/src/reports.ts:138`).

Update `src/index.ts`: remove the placeholder export, add `export * from './time.js';`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @silapor/analytics test`
Expected: PASS (10 tests).

- [ ] **Step 6: Full task gates + commit**

Run: `pnpm moon run analytics:lint analytics:typecheck analytics:test`
Expected: all green. Then commit:

```bash
git add packages/analytics packages/database/src/index.ts pnpm-lock.yaml
git commit -m "feat(p7): analytics package bootstrap + Jakarta time-range helpers"
```

---

### Task 2: Core dashboard metric queries (live scratch DB)

**Files:**
- Create: `packages/analytics/src/dashboard.ts`
- Create: `packages/analytics/src/dashboard.test.ts`
- Modify: `packages/analytics/src/index.ts` (add `export * from './dashboard.js';`)

**Interfaces:**
- Consumes: `time.ts` helpers; `runMigrations` from `@silapor/database` barrel.
- Produces (used by Tasks 3, 4, 6):

```ts
export interface DashboardRange { readonly from?: Date; readonly toExclusive?: Date; }
export interface OverviewCards {
  readonly totalReports: number; readonly activeReports: number; readonly inRepair: number;
  readonly highPriorityActive: number; readonly resolvedThisMonth: number;
}
export interface StatusCount { readonly status: string; readonly count: number; }
export interface CategoryCount { readonly categoryId: string | null; readonly categoryName: string | null; readonly count: number; }
export interface LocationCount { readonly locationId: string; readonly locationName: string; readonly count: number; }
export interface ResolutionTimeMetrics { readonly sampleSize: number; readonly averageSeconds: number | null; readonly medianSeconds: number | null; }

export async function getOverviewCards(db: AnalyticsDb, range: DashboardRange, now?: Date): Promise<OverviewCards>;
export async function getReportsByStatus(db: AnalyticsDb, range: DashboardRange): Promise<StatusCount[]>;
export async function getReportsByCategory(db: AnalyticsDb, range: DashboardRange, limit?: number): Promise<CategoryCount[]>;
export async function getReportsByLocation(db: AnalyticsDb, range: DashboardRange, limit?: number): Promise<LocationCount[]>;
export async function getResolutionTimeMetrics(db: AnalyticsDb, range: DashboardRange): Promise<ResolutionTimeMetrics>;
```

- Semantics (see "My calls" 1–4): counts filter `reported_at` in `[from, toExclusive)`; canonical statuses only; `byStatus` zero-fills all 7 in canonical order; `byCategory` includes a `null` bucket labeled by the transport as unclassified; resolution metrics filter `resolved_at` in range, `sampleSize` = rows with both `resolved_at` and `reported_at`, durations in whole seconds via `Math.round`, `null` values when `sampleSize === 0`.

- [ ] **Step 1: Write the failing tests**

`dashboard.test.ts` — copy the live-test harness of `packages/database/src/facilities.test.ts` (scratch DB `silapor_p7_test`, `isReachable`/`describe.skipIf(!enabled)`, `beforeAll` create DB → `runMigrations(url)` → seed fixtures, `afterAll` close + drop). Fixture set (insert directly with drizzle, no repo calls):

- 2 categories (`HVAC`, `ELECTRICAL`), 1 building + 1 room location, 1 asset, 1 admin/2 reporters.
- Reports (all with ticket numbers in insertion order; in-range means `reported_at` inside Jakarta 2026-10-01..18):
  - `R1 REPORTED`, no final category, priority null, reported `2026-10-01T03:00:00Z`.
  - `R2 VERIFIED`, cat HVAC, final `HIGH`, reported `2026-10-02T03:00:00Z`.
  - `R3 IN_REPAIR`, cat HVAC, final `MEDIUM`, reported `2026-10-03T03:00:00Z`.
  - `R4 RESOLVED`, cat ELECTRICAL, resolved `2026-10-10T05:00:00Z`, reported `2026-10-08T05:00:00Z` (48h).
  - `R5 CLOSED`, cat ELECTRICAL, resolved `2026-10-11T05:00:00Z`, reported `2026-10-09T05:00:00Z` (48h), `closed_at` `2026-10-12T05:00:00Z`.
  - `R7 REPORTED`, no final category, reported `2026-09-30T17:00:00Z` (Jakarta Oct 1 boundary IN).
  - `R10 ASSIGNED`, cat ELECTRICAL, final `LOW`, reported `2026-10-04T03:00:00Z` (workload fixture, Task 3).
  - `R6 CLOSED`, reported `2026-09-25T03:00:00Z` and resolved `2026-09-29T03:00:00Z` (both OUTSIDE the range and outside Jakarta October).
  - `R8 REPORTED`, reported `2026-09-30T16:59:59Z` (Jakarta Sep 30 boundary OUT).
  - `R9 REJECTED` (legacy), reported `2026-10-02T03:00:00Z` — must never count anywhere.

Key assertions (expected values computed from the fixture, written literally in the test):

```ts
const range = jakartaDayRange({ from: '2026-10-01', to: '2026-10-18' }) as { from: Date; toExclusive: Date };
const cards = await getOverviewCards(requireDb(), range, new Date('2026-10-15T00:00:00Z'));
expect(cards).toEqual({
  totalReports: 7, activeReports: 6, inRepair: 1, highPriorityActive: 1, resolvedThisMonth: 2,
});
// byStatus zero-filled, in-range + canonical only: REPORTED 2 (R1,R7), VERIFIED 1 (R2),
// ASSIGNED 1 (R10), IN_REPAIR 1 (R3), RESOLVED 1 (R4), CLOSED 1 (R5), INSPECTION 0.
// byCategory: HVAC 2 (R2,R3), ELECTRICAL 3 (R4,R5,R10), null bucket 2 (R1,R7).
// byLocation: all in-range grouped under the single seeded room.
const resolution = await getResolutionTimeMetrics(requireDb(), range);
expect(resolution).toEqual({ sampleSize: 2, averageSeconds: 172800, medianSeconds: 172800 });
// R6 (resolved outside range), R1/R2/R3/R7/R10 (unresolved) excluded from the sample.
```

Plus: zero-data range (`from=2025-01-01,to=2025-01-02`) → all cards 0, resolution `{ sampleSize: 0, averageSeconds: null, medianSeconds: null }`, byStatus all-zero; legacy row excluded from every result (assert totals stay at the values above); boundary IN/OUT tests as above.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @silapor/analytics test`
Expected: FAIL — `./dashboard.js` unresolved / functions undefined.

- [ ] **Step 3: Implement `src/dashboard.ts`**

Style: follow `packages/database/src/reports.ts` query style — build `conditions` arrays, `and(...)`, `count()` selects, `inArray(status, REPORT_STATUS)`, `gte/lte` on reported_at, joins via `leftJoin` for names, `sql<number>` template for `avg(extract(epoch from (resolved_at - reported_at)))` and `percentile_cont(0.5) within group (order by extract(epoch from (resolved_at - reported_at)))`. Zero-fill byStatus by mapping canonical order over a Map. `now` default `new Date()`; month bounds from `jakartaMonthBoundsUtc(now)`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @silapor/analytics test`
Expected: PASS (live block runs when PostgreSQL is reachable; skipped otherwise).

- [ ] **Step 5: Volume sanity (plan step 12)**

Add one test that bulk-inserts ~200 reports in the October range (`db.insert(...).values([...])`) and asserts `totalReports` increased by exactly 200 and `getReportsByStatus` totals sum to the same. This exercises the existing indexes (`maintenance_reports_status_reported_idx`, `_resolved_at_idx`) at volume. No timing assertions.

- [ ] **Step 6: Full task gates + commit**

Run: `pnpm moon run analytics:lint analytics:typecheck analytics:test`

```bash
git add packages/analytics
git commit -m "feat(p7): core dashboard metric queries with live fixture tests"
```

---

### Task 3: Technician workload + priority queue queries

**Files:**
- Modify: `packages/analytics/src/dashboard.ts` (append)
- Modify: `packages/analytics/src/dashboard.test.ts` (extend fixture: 2 technicians, assignments incl. a reassigned report)

**Interfaces:**
- Produces (used by Tasks 4, 6):

```ts
export interface TechnicianWorkloadItem { readonly technicianId: string; readonly technicianName: string; readonly activeCount: number; }
export interface PriorityQueueItem {
  readonly reportId: string; readonly ticketNumber: string; readonly status: string;
  readonly finalPriority: string | null; readonly reportedAt: Date;
}
export async function getTechnicianWorkload(db: AnalyticsDb): Promise<TechnicianWorkloadItem[]>;
export async function getPriorityQueue(db: AnalyticsDb, limit?: number): Promise<PriorityQueueItem[]>;
```

- Semantics ("My calls" 5–6): workload counts reports with an **active** assignment (`unassigned_at IS NULL`) whose status is `ASSIGNED|INSPECTION|IN_REPAIR`, grouped per active technician, zero-count technicians included, order count desc then name asc. Queue: statuses `REPORTED|VERIFIED|ASSIGNED|INSPECTION|IN_REPAIR`, order `finalPriority` HIGH→MEDIUM→LOW→null then `reported_at` asc (tie: `id` asc), `limit` default 10.

- [ ] **Step 1: Write the failing tests**

Extend the fixture: technician A (Budi), technician B (Sari); assignments — `R3` assigned to Budi (active); `R10` assigned to Budi first (row `unassigned_at` set) then reassigned to Sari (active) — stale row must be ignored; `R1` unassigned (still REPORTED). Assertions:

```ts
expect(await getTechnicianWorkload(requireDb())).toEqual([
  { technicianId: budiId, technicianName: 'Budi', activeCount: 1 },
  { technicianId: sariId, technicianName: 'Sari', activeCount: 1 },
]);
// R2 (VERIFIED) is never assigned in this fixture; workload counts only ASSIGNED/INSPECTION/IN_REPAIR.
// R10 appears once, under Sari — the stale Budi row with unassigned_at set is ignored.
const queue = await getPriorityQueue(requireDb(), 10);
expect(queue.map((item) => item.finalPriority)).toEqual(['HIGH', 'MEDIUM', 'LOW', null, null]);
expect(queue.map((item) => item.ticketNumber)).toEqual([r2Ticket, r3Ticket, r10Ticket, r7Ticket, r1Ticket]);
// queue = R2, R3, R10 by priority; then nulls by reported_at asc — R7 (09-30T17:00Z) precedes R1 (10-01T03:00Z).
// R4 (RESOLVED) and closed/legacy rows excluded because queue = REPORTED..IN_REPAIR only.
expect((await getPriorityQueue(requireDb(), 1)).length).toBe(1);
expect((await getPriorityQueue(requireDb(), 1))[0]!.ticketNumber).toBe(r2Ticket);
```

(Assign the seeded ticket numbers to `const r1Ticket`…`const r10Ticket` locals from the fixture inserts.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @silapor/analytics test`
Expected: FAIL — functions not exported.

- [ ] **Step 3: Implement in `src/dashboard.ts`**

Workload: `leftJoin(reportAssignments, and(eq(reportAssignments.reportId, maintenanceReports.id), isNull(reportAssignments.unassignedAt)))` scoped by statuses; group by technician. Queue: `inArray(status, [...five])`, `orderBy(sql`case ${finalPriority} when 'HIGH' then 0 ... end asc nulls last`, asc(reportedAt), asc(id))`, limit via `normalizeListOptions`-style clamp (import `normalizeListOptions` from `@silapor/database`? It is exported per P6-5c usage — if not re-exported, clamp locally with `Math.min(Math.max(1, limit), 50)`).

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @silapor/analytics test`
Expected: PASS.

- [ ] **Step 5: Full task gates + commit**

Run: `pnpm moon run analytics:lint analytics:typecheck analytics:test`

```bash
git add packages/analytics
git commit -m "feat(p7): technician workload and priority queue queries"
```

---

### Task 4: Admin transport, route, contract, app wiring

**Files:**
- Modify: `apps/web/package.json` (add `"@silapor/analytics": "workspace:*"`)
- Create: `apps/web/src/server/analytics.ts`
- Create: `apps/web/src/server/analytics.test.ts`
- Create: `apps/web/src/routes/api/admin/analytics.overview.ts`
- Modify: `docs/api-contract.md` (new §7)
- Modify: `apps/web/src/routeTree.gen.ts` (regenerated in step 4)

**Interfaces:**
- Consumes: everything from Tasks 1–3.
- Produces: `getDashboardOverviewRoute(request: Request, url: string): Promise<DashboardOverviewResponse>` in `apps/web/src/server/analytics.ts`; route `GET /api/admin/analytics/overview`.

```ts
export interface DashboardOverviewResponse {
  readonly range: { readonly from: string | null; readonly to: string | null };
  readonly cards: OverviewCards;
  readonly byStatus: StatusCount[];
  readonly byCategory: CategoryCount[];
  readonly byLocation: LocationCount[];
  readonly resolutionTime: ResolutionTimeMetrics;
  readonly technicianWorkload: TechnicianWorkloadItem[];
  readonly priorityQueue: PriorityQueueItem[];
}
```

- `range` echoes the raw `YYYY-MM-DD` params (validated by `jakartaDayRange`).

- [ ] **Step 1: Write the failing server tests**

`apps/web/src/server/analytics.test.ts` — copy the mock style of `apps/web/src/server/facilities.test.ts` (`vi.hoisted` dbMocks for `getDb` + each analytics function, `vi.mock('./auth')`, parser/delegation/error-propagation tests). Cases:

- `requireAdmin` rejects → route rejects with same status (401/403 propagation).
- `?from=2026-10-01&to=2026-10-18` → analytics functions called with `{ from: Date('2026-09-30T17:00:00Z'), toExclusive: Date('2026-10-18T17:00:00Z') }`; response `range` echoes raw strings.
- `?from=2026-13-01` → rejects with `status: 400` (from `jakartaDayRange`), db never opened.
- assembly: response contains keys cards/byStatus/byCategory/byLocation/resolutionTime/technicianWorkload/priorityQueue from mock returns; `conn.close()` called even on analytics error.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @silapor/web test -- analytics`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `server/analytics.ts` + route file**

`server/analytics.ts`: mirror `server/facilities.ts` — `searchParamsOf`/`queryParam` helpers (or import if exported), `await requireAdmin(request)`, `const range = jakartaDayRange({ from, to })`, `const conn = getDb()`, `try { const [cards, byStatus, ...] = await Promise.all([...]) } finally { await conn.close() }`, return assembled response.

`routes/api/admin/analytics.overview.ts`: copy `routes/api/facilities.status.ts` wrapper (`withRequestId(randomUUID(), ...)`, `logger.info('analytics overview served', { ... redact({ ... }) })`, error branch `Response.json(mapped.body, { status: mapped.status })`).

- [ ] **Step 4: Regenerate route tree + verify**

Run: `pnpm --filter @silapor/web run build`
Expected: build succeeds; `apps/web/src/routeTree.gen.ts` gains the `analytics.overview` entry (commit it).

- [ ] **Step 5: Contract §7**

Append to `docs/api-contract.md`:

```markdown
## 7. [Phase 7 — analytics]

| Endpoint | Method | Sukses |
|---|---|---|
| `/api/admin/analytics/overview` | GET | **admin-only** — query: `from`, `to` (`YYYY-MM-DD`, hari Jakarta inklusif; absen = tanpa batas) → `{ "range": { "from", "to" }, "cards": { "totalReports", "activeReports", "inRepair", "highPriorityActive", "resolvedThisMonth" }, "byStatus": [{ "status", "count" }], "byCategory": [{ "categoryId", "categoryName", "count" }], "byLocation": [{ "locationId", "locationName", "count" }], "resolutionTime": { "sampleSize", "averageSeconds", "medianSeconds" }, "technicianWorkload": [{ "technicianId", "technicianName", "activeCount" }], "priorityQueue": [{ "reportId", "ticketNumber", "status", "finalPriority", "reportedAt" }] }` |

**Definisi metric** (kanonik, Phase 7): `totalReports` = laporan dengan `reported_at` dalam rentang; `activeReports` = status ≠ `CLOSED` (hanya 7 status; `REJECTED`/`DUPLICATE` legacy dikecualikan dari semua metric); `inRepair` = `IN_REPAIR`; `highPriorityActive` = aktif dengan `final_priority = HIGH`; `resolvedThisMonth` = `resolved_at` pada bulan berjalan Asia/Jakarta; `resolutionTime` = `resolved_at − reported_at` untuk laporan yang `resolved_at`-nya dalam rentang (detik, dibulatkan); `byCategory` memakai `final_category_id` (`categoryId: null` = belum terklasifikasi); `byLocation` memakai lokasi laporan saat dibuat; `technicianWorkload` = tiket aktif (`ASSIGNED`/`INSPECTION`/`IN_REPAIR`) per teknisi aktif (assignment aktif); `priorityQueue` = status `REPORTED..IN_REPAIR` urut HIGH→MEDIUM→LOW→null lalu `reported_at` asc, maks 10.
```

- [ ] **Step 6: Full task gates + commit**

Run: `pnpm install && pnpm moon run web:lint web:typecheck web:test analytics:test`

```bash
git add apps/web docs/api-contract.md pnpm-lock.yaml
git commit -m "feat(p7): admin analytics overview endpoint + contract §7"
```

---

### Task 5: BarChart component

**Files:**
- Create: `apps/web/src/components/BarChart.tsx`
- Create: `apps/web/src/components/BarChart.test.tsx` (`// @vitest-environment jsdom` first line)
- Modify: `apps/web/src/components/index.ts`

**Interfaces:**
- Produces (used by Tasks 6, 8):

```tsx
export interface BarChartDatum { readonly label: string; readonly value: number; readonly description?: string; }
export interface BarChartProps { readonly title: string; readonly data: readonly BarChartDatum[]; readonly emptyMessage?: string; }
export function BarChart(props: BarChartProps): JSX.Element;
```

- Render contract: `<figure aria-label={title}>` with visible `<figcaption>` title; one row per datum — label text, an SVG bar (width = `value / max * 100%`; all-zero max → 0-width track), value text, optional `description` text; empty `data` renders `emptyMessage` (default `'Tidak ada data'`). No color-only encoding.

- [ ] **Step 1: Write the failing tests**

`BarChart.test.tsx` (jsdom + `@testing-library/react`): renders title/labels/values as visible text; renders `description` when provided; empty data shows the empty message; all-zero data renders safely (no `NaN` in the DOM — query bar widths via `style` and assert `0%` or absence); long label does not crash.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @silapor/web test -- BarChart`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `BarChart.tsx` + export from `components/index.ts`**

Tailwind classes consistent with house style (surface/border/text tokens; `text-sm`; row spacing `space-y-2`). Bar track `h-2 rounded bg-border/40`, fill `bg-accent` with inline `style={{ width }}`. `<title>` inside SVG not needed — value text is visible.

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @silapor/web test -- BarChart`
Expected: PASS.

- [ ] **Step 5: Full task gates + commit**

Run: `pnpm moon run web:lint web:typecheck web:test`

```bash
git add apps/web/src/components
git commit -m "feat(p7): accessible hand-rolled BarChart component"
```

---

### Task 6: Dashboard page `/admin` + admin nav

**Files:**
- Create: `apps/web/src/routes/admin.index.tsx`
- Create: `apps/web/src/routes/admin.index.test.tsx` (`// @vitest-environment jsdom`)
- Modify: `apps/web/src/components/AppShell.tsx` (add `{ to: '/admin', label: 'Dashboard' }` first; update comment)
- Modify: `apps/web/src/routeTree.gen.ts` (regenerated)

**Interfaces:**
- Consumes: `GET /api/admin/analytics/overview` (Task 4), `BarChart` (Task 5), `StatusBadge`/`priorityBadgeClassesFor`, `LoadingState`/`EmptyState`/`ErrorPanel`/`Button`/`inputs`.
- Route search params: `{ from: string; to: string }` (validateSearch with `stringParam` style from `admin.reports.index.tsx`).

- [ ] **Step 1: Write the failing route test**

`admin.index.test.tsx` — follow the fetch-stub + memory-router style used in `admin.reports.$ticket.test.tsx`. Stub `fetch` for `/api/admin/analytics/overview?...` returning a fixture response. Assert: five cards render with values (Total Laporan 12, Aktif 9, Dalam Perbaikan 2, Prioritas Tinggi 3, Selesai Bulan Ini 4); queue rows link to `/admin/reports/MNT-2026-000007`; chart section headings render; empty response shows empty states; fetch failure shows `ErrorPanel`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @silapor/web test -- admin.index`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the page**

Pattern from `admin.facilities.index.tsx`: `validateSearch` → `loaderDeps` → `loader` (`fetch('/api/admin/analytics/overview?...', { credentials: 'include' })`, throw on `!res.ok` with status) → `Route.useLoaderData()`. Sections:

1. Header `<h1>` "Dashboard" + date-range form (`from`/`to` `<Input type="date">` + submit "Terapkan" navigating with search).
2. Kartu ringkasan — 5 cards grid; drill-down links: Prioritas Tinggi → `/admin/reports?priority=HIGH`, Dalam Perbaikan → `?status=IN_REPAIR`, Selesai Bulan Ini → `?status=RESOLVED`, Total/Aktif → `/admin/reports` (use typed `Link` with full `AdminListSearch` defaults; copy the deep-link pattern at `admin.reports.index.tsx:344-350`).
3. "Antrean prioritas" — table (house table classes) with ticket link (`TicketMono`), `StatusBadge`, priority badge, `reportedAt` formatted `id-ID`.
4. "Laporan per status" — `BarChart` with Indonesian status labels (reuse label map from `lib/admin-reports` if exported; otherwise local map).
5. "Laporan per kategori" — `BarChart` (null categoryId → label "Belum terklasifikasi").
6. "Beban tugas teknisi" — list of technicians with counts (`EmptyState` when none).
7. Loading/error/forbidden states mirroring `admin.facilities.index.tsx` (`LoadingState` while pending, `ErrorPanel` + retry `router.invalidate()`, 403 panel).

- [ ] **Step 4: Regenerate route tree, run tests**

Run: `pnpm --filter @silapor/web run build && pnpm --filter @silapor/web test -- admin.index`
Expected: PASS + routeTree gains `admin.index`.

- [ ] **Step 5: Full task gates + commit**

Run: `pnpm moon run web:lint web:typecheck web:test`

```bash
git add apps/web
git commit -m "feat(p7): admin dashboard page with overview cards, charts, queue, workload"
```

---

### Task 7: Pengaturan Scoring mock page + nav

**Files:**
- Create: `apps/web/src/routes/admin.scoring.tsx`
- Create: `apps/web/src/routes/admin.scoring.test.tsx` (jsdom)
- Modify: `apps/web/src/components/AppShell.tsx` (add `{ to: '/admin/scoring', label: 'Scoring' }`)
- Modify: `apps/web/src/routeTree.gen.ts` (regenerated)

**Interfaces:** none consumed (mock page, No. 11); renders fully with local state.

- [ ] **Step 1: Write the failing test**

Assert: heading "Pengaturan Scoring"; four weight inputs default `35/25/25/15` and are editable (fireEvent change → value updates); thresholds table renders `0–39 → LOW`, `40–69 → MEDIUM`, `70–100 → HIGH`; mock per-category score table renders rows; submit button is `disabled` and the note "Endpoint menyusul" is visible.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @silapor/web test -- admin.scoring`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the page**

Sections per No. 11: form bobot kriteria (four numeric inputs, `useState`), ambang prioritas table, "Batas jumlah pelapor" input (affects frequency tier display, static), tabel skor per kategori aset/ruangan (mock rows consistent with seed categories: ELECTRICAL/HVAC/…), submit `<Button disabled>` + visible `<p>` note "Endpoint menyusul — pengaturan belum tersimpan." All IDs/`htmlFor`/aria wired.

- [ ] **Step 4: Regenerate route tree, run tests + gates + commit**

Run: `pnpm --filter @silapor/web run build && pnpm moon run web:lint web:typecheck web:test`

```bash
git add apps/web
git commit -m "feat(p7): scoring settings mock page (UI No. 11)"
```

---

### Task 8: Laporan Maintenance mock page + nav

**Files:**
- Create: `apps/web/src/routes/admin.maintenance-report.tsx`
- Create: `apps/web/src/routes/admin.maintenance-report.test.tsx` (jsdom)
- Modify: `apps/web/src/components/AppShell.tsx` (add `{ to: '/admin/maintenance-report', label: 'Laporan Maintenance' }` — admin nav now 5 items, comment already says "Never more than 5")
- Modify: `apps/web/src/routeTree.gen.ts` (regenerated)

**Interfaces:** consumes `BarChart` (Task 5).

- [ ] **Step 1: Write the failing test**

Assert: heading "Laporan Maintenance"; three chart sections (`Tren laporan`, `Beban tugas per teknisi`, `Tiket per kategori & gedung`) render with mock labels/values; the trend chart rows show the average-duration description; per-period table renders columns (Periode, Jumlah, Selesai, Rata-rata durasi); "Ekspor PDF" button `disabled` with note "Endpoint menyusul".

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @silapor/web test -- admin.maintenance-report`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the page**

Static mock data module-level (5 periods daily/weekly, 3 technicians, 4 category&building rows); three `BarChart`s + table (house classes) + disabled export button with note. Include visible "Data contoh" marker on the page so mock data is never mistaken for live (render as a small `text-muted` note).

- [ ] **Step 4: Regenerate route tree, run tests + gates + commit**

Run: `pnpm --filter @silapor/web run build && pnpm moon run web:lint web:typecheck web:test`

```bash
git add apps/web
git commit -m "feat(p7): maintenance report mock page with 3 charts and PDF stub (UI No. 11)"
```

---

## Task order & dependencies

1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 (sequential; 2–3 share `dashboard.ts`/`dashboard.test.ts`; 4 depends on 1–3; 6 depends on 4+5; 7 and 8 depend only on 5/6 conventions).

## Note on E2E

Plan §12.3 scenario 8 ("maintenance history dan analytics ikut berubah") stays uncovered until the container's Chromium system deps (`libnspr4`) are installed (`sudo npx playwright install-deps chromium`). Not part of these tasks; flag at final review.
