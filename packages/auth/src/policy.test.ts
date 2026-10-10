// Authorization policy unit tests (P2-4). Pure — no DB required.

import { describe, expect, it } from 'vitest';
import { isAppError } from '@silapor/shared';
import {
  canPerform,
  requireOwnerOrAdmin,
  requireRole,
  type AuthUser,
} from './policy.js';

const ADMIN_CAPABILITIES = [
  'manageMasterData',
  'viewAllReports',
  'verifyReports',
  'assignTechnicians',
  'changeStatus',
  'manageUsers',
  'viewAnalytics',
];

const ACTIVE_CAPABILITIES = ['submitReport', 'viewOwnReports', 'viewCampusStatus'];

const admin: AuthUser = { id: 'u-admin', username: 'admin', role: 'ADMIN', isActive: true };
const reporter: AuthUser = {
  id: 'u-reporter',
  username: '230001',
  role: 'REPORTER',
  isActive: true,
};
const inactiveAdmin: AuthUser = { ...admin, isActive: false };
const inactiveReporter: AuthUser = { ...reporter, isActive: false };

describe('canPerform', () => {
  it('returns false for every capability when the user is null', () => {
    for (const capability of [...ADMIN_CAPABILITIES, ...ACTIVE_CAPABILITIES]) {
      expect(canPerform(null, capability)).toBe(false);
    }
    expect(canPerform(null, 'unknown-capability')).toBe(false);
  });

  it('returns false for every capability when the user is inactive (even ADMIN)', () => {
    for (const capability of [...ADMIN_CAPABILITIES, ...ACTIVE_CAPABILITIES]) {
      expect(canPerform(inactiveAdmin, capability)).toBe(false);
      expect(canPerform(inactiveReporter, capability)).toBe(false);
    }
  });

  it('denies admin-only capabilities to reporters but allows reporting ones', () => {
    for (const capability of ADMIN_CAPABILITIES) {
      expect(canPerform(reporter, capability)).toBe(false);
    }
    expect(canPerform(reporter, 'manageMasterData')).toBe(false);
    expect(canPerform(reporter, 'submitReport')).toBe(true);
    for (const capability of ACTIVE_CAPABILITIES) {
      expect(canPerform(reporter, capability)).toBe(true);
    }
  });

  it('returns true for every known capability when the user is an active admin', () => {
    for (const capability of [...ADMIN_CAPABILITIES, ...ACTIVE_CAPABILITIES]) {
      expect(canPerform(admin, capability)).toBe(true);
    }
  });

  it('returns false for unknown capabilities (deny-by-default)', () => {
    for (const capability of ['', 'ADMIN', 'manage-master-data', 'deleteEverything']) {
      expect(canPerform(admin, capability)).toBe(false);
      expect(canPerform(reporter, capability)).toBe(false);
    }
  });
});

function expectForbidden(fn: () => unknown): void {
  try {
    fn();
    expect.unreachable('expected a FORBIDDEN AppError');
  } catch (error) {
    expect(isAppError(error)).toBe(true);
    if (isAppError(error)) {
      expect(error.code).toBe('FORBIDDEN');
      expect(error.status).toBe(403);
      expect(error.message).toBe('Akses ditolak');
    }
  }
}

describe('requireRole', () => {
  it('returns the user when the role matches', () => {
    expect(requireRole(admin, 'ADMIN')).toBe(admin);
    expect(requireRole(reporter, 'REPORTER')).toBe(reporter);
  });

  it('throws FORBIDDEN 403 for wrong roles, null, and inactive users', () => {
    expectForbidden(() => requireRole(reporter, 'ADMIN'));
    expectForbidden(() => requireRole(admin, 'REPORTER'));
    expectForbidden(() => requireRole(null, 'ADMIN'));
    expectForbidden(() => requireRole(inactiveAdmin, 'ADMIN'));
  });
});

describe('requireOwnerOrAdmin', () => {
  it('passes for the owning user', () => {
    expect(requireOwnerOrAdmin(reporter, 'u-reporter')).toBe(reporter);
  });

  it('passes for an active admin on another user resource', () => {
    expect(requireOwnerOrAdmin(admin, 'u-reporter')).toBe(admin);
  });

  it('throws FORBIDDEN 403 for other users, null, and inactive users', () => {
    expectForbidden(() => requireOwnerOrAdmin(reporter, 'u-other'));
    expectForbidden(() => requireOwnerOrAdmin(null, 'u-reporter'));
    expectForbidden(() =>
      requireOwnerOrAdmin(inactiveAdmin, inactiveAdmin.id),
    );
  });
});
