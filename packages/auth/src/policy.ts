// Authorization policies (Phase 2 P2-4): pure role/ownership checks.
//
// No I/O, no database imports — only `AppError` helpers from
// `@silapor/shared`. Server enforcement in API routes
// (`apps/web/src/server/auth.ts` require* guards) is authoritative; these
// predicates decide *whether* a resolved user may act.
//
// Deny-by-default: null users, inactive users, and unknown capabilities all
// return false / throw. Never log here (pure module); callers log opaque IDs
// only.

import { forbidden } from '@silapor/shared';

export type Role = 'ADMIN' | 'REPORTER';

export interface AuthUser {
  readonly id: string;
  readonly username: string;
  readonly role: Role;
  readonly isActive: boolean;
}

// Known capabilities. `canPerform` accepts any string so unknown values fail
// closed (false) instead of failing to compile at call sites.
export type Capability =
  | 'manageMasterData'
  | 'viewAllReports'
  | 'verifyReports'
  | 'assignTechnicians'
  | 'changeStatus'
  | 'manageUsers'
  | 'viewAnalytics'
  | 'submitReport'
  | 'viewOwnReports'
  | 'viewCampusStatus';

// Admin-only: master data, full report visibility, verification workflow,
// technician assignment, status changes, user management, analytics.
const ADMIN_ONLY_CAPABILITIES: ReadonlySet<string> = new Set([
  'manageMasterData',
  'viewAllReports',
  'verifyReports',
  'assignTechnicians',
  'changeStatus',
  'manageUsers',
  'viewAnalytics',
]);

// Any active user (ADMIN or REPORTER): reporting + read-only campus status.
const ACTIVE_USER_CAPABILITIES: ReadonlySet<string> = new Set([
  'submitReport',
  'viewOwnReports',
  'viewCampusStatus',
]);

export function canPerform(user: AuthUser | null, capability: string): boolean {
  if (user === null || !user.isActive) {
    return false;
  }
  if (ADMIN_ONLY_CAPABILITIES.has(capability)) {
    return user.role === 'ADMIN';
  }
  if (ACTIVE_USER_CAPABILITIES.has(capability)) {
    return true;
  }
  return false;
}

// Returns the user when its role matches exactly; otherwise throws a generic
// 403 (no detail, so responses cannot be used to probe roles).
export function requireRole(user: AuthUser | null, role: Role): AuthUser {
  if (user === null || !user.isActive || user.role !== role) {
    throw forbidden('Akses ditolak');
  }
  return user;
}

// Passes when the user owns the resource (`user.id === ownerId`) or is an
// active ADMIN; otherwise throws a generic 403.
export function requireOwnerOrAdmin(user: AuthUser | null, ownerId: string): AuthUser {
  if (user === null || !user.isActive) {
    throw forbidden('Akses ditolak');
  }
  if (user.role === 'ADMIN' || user.id === ownerId) {
    return user;
  }
  throw forbidden('Akses ditolak');
}
