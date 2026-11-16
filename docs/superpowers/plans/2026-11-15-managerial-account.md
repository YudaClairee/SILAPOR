# Managerial Account Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated `manajerial` login identity that can view only the managerial dashboard.

**Architecture:** Extend the existing role union and mock SSO directory with `MANAGERIAL`, route that role to `/managerial`, and enforce access on the server as well as in client navigation. Reuse the existing managerial dashboard view and analytics endpoint, adding a read-only shell without exposing admin navigation or mutation routes.

**Tech Stack:** React, TanStack Router, TypeScript, Drizzle/Postgres schema, Vitest, existing session and SSO helpers.

**Spec:** Conversation-approved behavior: username `manajerial`; shared login page; redirect to `/managerial`; dashboard viewing only; no admin pages or data-changing actions; password behavior remains unchanged in the pilot mock.

## Global Constraints

- `MANAGERIAL` is a distinct role; it must not be treated as `ADMIN`.
- The server is authoritative for authorization; client redirects and hidden navigation are convenience only.
- The account uses the existing mock SSO behavior, where the password field is accepted but not verified.
- Existing `ADMIN` and `REPORTER` behavior must remain unchanged.
- Dashboard data remains pure logic from the existing analytics endpoint; no AI or prediction is added.

## Review Focus

- A managerial session requesting `/api/admin/analytics/overview` must succeed, while every admin mutation or management endpoint remains forbidden.
- An anonymous user and a reporter must not reach `/managerial`.
- An admin must continue reaching `/admin`, and a reporter must continue reaching `/reporter`.
- Login response and root dispatch must recognize `MANAGERIAL` without falling through to an invalid home.
- Database role migration/seed behavior must preserve existing users and make the new role deployable.

---

### Task 1: Extend role and mock identity contracts

**Files:**
- Modify: `packages/auth/src/sso.ts`
- Modify: `packages/auth/src/policy.ts`
- Test: `packages/auth/src/sso.test.ts`
- Test: `packages/auth/src/policy.test.ts`

**Interfaces:**
- Produces `SsoRole = 'ADMIN' | 'REPORTER' | 'MANAGERIAL'`.
- Produces policy helpers that accept the new role while retaining `requireRole(user, 'ADMIN')` semantics.
- Mock username `manajerial` resolves to an active `MANAGERIAL` identity.

- [ ] **Step 1: Write failing tests** for the mock identity and role policy behavior, including that `MANAGERIAL` is not accepted as `ADMIN`.
- [ ] **Step 2: Run focused auth tests and verify the new assertions fail for the missing role/identity.**
- [ ] **Step 3: Implement the minimal role union, mock directory entry, and type-safe policy handling.**
- [ ] **Step 4: Run `pnpm --filter @silapor/auth test` and verify all auth tests pass.**
- [ ] **Step 5: Commit with `feat: add managerial auth role`.**

### Task 2: Persist and seed the managerial role

**Files:**
- Modify: `packages/database/src/schema.ts`
- Modify: `packages/database/src/seed.ts`
- Add or modify: the repository's existing database migration for the `user_role` enum
- Test: existing database schema/seed tests where applicable

**Interfaces:**
- The database `user_role` enum accepts `MANAGERIAL`.
- The seed directory contains an active `manajerial` user with role `MANAGERIAL`.

- [ ] **Step 1: Add a failing schema/seed assertion for the new role and account.**
- [ ] **Step 2: Run the focused database test and verify it fails before the enum/seed change.**
- [ ] **Step 3: Add the enum migration and seed entry using the existing migration/seed conventions.**
- [ ] **Step 4: Run the focused database tests and verify they pass.**
- [ ] **Step 5: Commit with `feat: persist managerial account role`.**

### Task 3: Add managerial route guards and read-only dashboard route

**Files:**
- Modify: `apps/web/src/server/guard.ts`
- Modify: `apps/web/src/server/auth.ts`
- Add: `apps/web/src/routes/managerial.tsx`
- Add: `apps/web/src/routes/managerial.test.tsx`
- Modify: `apps/web/src/routes/login.tsx`
- Modify: `apps/web/src/routes/index.tsx`
- Modify: generated `apps/web/src/routeTree.gen.ts`
- Test: `apps/web/src/server/guard.test.ts`
- Test: relevant auth route tests

**Interfaces:**
- `MANAGERIAL_HOME = '/managerial'`.
- `homeForRole('MANAGERIAL')` returns `/managerial`.
- `requireManagerial(request)` returns a session user only for `MANAGERIAL`; admin and reporter sessions receive 403.
- `/managerial` renders the existing managerial dashboard content and has no admin mutation controls or admin shell navigation.

- [ ] **Step 1: Write failing guard, login dispatch, API authorization, and route rendering tests.**
- [ ] **Step 2: Run focused web tests and verify failures identify the missing managerial route/authorization.**
- [ ] **Step 3: Implement role-aware client dispatch, the server `requireManagerial` guard, and the read-only route by reusing the existing dashboard transformation and fetch behavior.**
- [ ] **Step 4: Regenerate the TanStack route tree using the repository's existing command.**
- [ ] **Step 5: Run focused web tests and verify all new and existing guard/login/dashboard tests pass.**
- [ ] **Step 6: Commit with `feat: add managerial dashboard account route`.**

### Task 4: Verify authorization boundaries and full application behavior

**Files:**
- Modify: focused tests only if a regression is found.

- [ ] **Step 1: Run the web unit suite covering auth, guards, analytics, admin routes, and managerial routes.**
- [ ] **Step 2: Run `pnpm typecheck`.**
- [ ] **Step 3: Run `pnpm lint`.**
- [ ] **Step 4: Run `pnpm build`.**
- [ ] **Step 5: Run the full `pnpm test` suite and confirm no existing role behavior regressed.**
- [ ] **Step 6: Commit any directly related test corrections, then report the verification results.**
