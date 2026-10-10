// Auth package barrel (Phase 2 P2-3). Replaces the Task 1 stub with the
// real SSO/session/rate-limit surface; the web layer composes these with
// `@silapor/database` repository functions (this package must never depend
// on `@silapor/database`).

export * from './sso.js';
export * from './session.js';
export * from './rate-limit.js';
export * from './policy.js';
