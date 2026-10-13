// P5-1 state machine tests (Phase 5 backend). Pure, no I/O.
import { describe, expect, it } from 'vitest';
import {
  NOTE_REQUIRED_TRANSITIONS,
  REPORT_TRANSITIONS,
  TERMINAL_STATUSES,
  assertTransition,
  canTransition,
  requiresNote,
  type ReportStatus,
} from './index.js';

const ALLOWED: ReadonlyArray<readonly [ReportStatus, ReportStatus]> = [
  ['REPORTED', 'VERIFIED'],
  ['REPORTED', 'REJECTED'],
  ['REPORTED', 'DUPLICATE'],
  ['VERIFIED', 'ASSIGNED'],
  ['ASSIGNED', 'INSPECTION'],
  ['INSPECTION', 'IN_REPAIR'],
  ['INSPECTION', 'RESOLVED'],
  ['IN_REPAIR', 'RESOLVED'],
  ['RESOLVED', 'CLOSED'],
  ['RESOLVED', 'IN_REPAIR'],
];

describe('REPORT_TRANSITIONS', () => {
  it('matches the canonical matrix exactly', () => {
    expect(REPORT_TRANSITIONS).toEqual({
      REPORTED: ['VERIFIED', 'REJECTED', 'DUPLICATE'],
      VERIFIED: ['ASSIGNED'],
      ASSIGNED: ['INSPECTION'],
      INSPECTION: ['IN_REPAIR', 'RESOLVED'],
      IN_REPAIR: ['RESOLVED'],
      RESOLVED: ['CLOSED', 'IN_REPAIR'],
      CLOSED: [],
      REJECTED: [],
      DUPLICATE: [],
    });
  });
});

describe('canTransition', () => {
  it('returns true for every allowed transition', () => {
    for (const [from, to] of ALLOWED) {
      expect(canTransition(from, to)).toBe(true);
    }
  });

  it('returns true for both RESOLVED exits (CLOSED and IN_REPAIR reopen)', () => {
    expect(canTransition('RESOLVED', 'CLOSED')).toBe(true);
    expect(canTransition('RESOLVED', 'IN_REPAIR')).toBe(true);
  });

  it('returns false for illegal skips and backwards moves', () => {
    expect(canTransition('REPORTED', 'ASSIGNED')).toBe(false);
    expect(canTransition('ASSIGNED', 'RESOLVED')).toBe(false);
    expect(canTransition('VERIFIED', 'INSPECTION')).toBe(false);
    expect(canTransition('IN_REPAIR', 'CLOSED')).toBe(false);
    expect(canTransition('RESOLVED', 'VERIFIED')).toBe(false);
    expect(canTransition('IN_REPAIR', 'ASSIGNED')).toBe(false);
  });

  it('returns false for self-transitions (no self loops)', () => {
    const statuses: ReportStatus[] = [
      'REPORTED',
      'VERIFIED',
      'ASSIGNED',
      'INSPECTION',
      'IN_REPAIR',
      'RESOLVED',
      'CLOSED',
      'REJECTED',
      'DUPLICATE',
    ];
    for (const s of statuses) {
      expect(canTransition(s, s)).toBe(false);
    }
  });

  it('treats CLOSED/REJECTED/DUPLICATE as terminal (no outgoing)', () => {
    const terminals: ReportStatus[] = ['CLOSED', 'REJECTED', 'DUPLICATE'];
    const targets: ReportStatus[] = [
      'REPORTED',
      'VERIFIED',
      'ASSIGNED',
      'INSPECTION',
      'IN_REPAIR',
      'RESOLVED',
      'CLOSED',
      'REJECTED',
      'DUPLICATE',
    ];
    for (const from of terminals) {
      for (const to of targets) {
        expect(canTransition(from, to)).toBe(false);
      }
    }
  });

  it('returns false for unknown strings instead of throwing', () => {
    expect(
      canTransition(
        'NOPE' as unknown as ReportStatus,
        'VERIFIED' as ReportStatus,
      ),
    ).toBe(false);
    expect(
      canTransition(
        'REPORTED' as ReportStatus,
        'NOPE' as unknown as ReportStatus,
      ),
    ).toBe(false);
  });
});

describe('assertTransition', () => {
  it('does not throw for legal transitions', () => {
    for (const [from, to] of ALLOWED) {
      expect(() => assertTransition(from, to)).not.toThrow();
    }
  });

  it('throws with the exact message for illegal transitions', () => {
    expect(() => assertTransition('REPORTED', 'ASSIGNED')).toThrowError(
      'Invalid transition from REPORTED to ASSIGNED',
    );
    expect(() => assertTransition('CLOSED', 'REPORTED')).toThrowError(
      'Invalid transition from CLOSED to REPORTED',
    );
  });
});

describe('TERMINAL_STATUSES', () => {
  it('contains exactly CLOSED, REJECTED, DUPLICATE', () => {
    expect([...TERMINAL_STATUSES]).toEqual(['CLOSED', 'REJECTED', 'DUPLICATE']);
  });
});

describe('NOTE_REQUIRED_TRANSITIONS', () => {
  it('contains the six binding keys', () => {
    expect([...NOTE_REQUIRED_TRANSITIONS].sort()).toEqual(
      ['DUPLICATE', 'IN_REPAIR', 'INSPECTION', 'REJECTED', 'REOPEN', 'RESOLVED'].sort(),
    );
  });
});

describe('requiresNote', () => {
  it('requires a note when entering INSPECTION (inspection result)', () => {
    expect(requiresNote('ASSIGNED', 'INSPECTION')).toBe(true);
  });

  it('requires a note when entering IN_REPAIR', () => {
    expect(requiresNote('INSPECTION', 'IN_REPAIR')).toBe(true);
  });

  it('requires a note when entering RESOLVED (resolution note)', () => {
    expect(requiresNote('IN_REPAIR', 'RESOLVED')).toBe(true);
    expect(requiresNote('INSPECTION', 'RESOLVED')).toBe(true);
  });

  it('requires a note for the RESOLVED → IN_REPAIR reopen (REOPEN)', () => {
    expect(requiresNote('RESOLVED', 'IN_REPAIR')).toBe(true);
  });

  it('requires a note when entering REJECTED or DUPLICATE', () => {
    expect(requiresNote('REPORTED', 'REJECTED')).toBe(true);
    expect(requiresNote('REPORTED', 'DUPLICATE')).toBe(true);
  });

  it('does not require a note for plain progressions and closure', () => {
    expect(requiresNote('REPORTED', 'VERIFIED')).toBe(false);
    expect(requiresNote('VERIFIED', 'ASSIGNED')).toBe(false);
    expect(requiresNote('RESOLVED', 'CLOSED')).toBe(false);
  });
});
