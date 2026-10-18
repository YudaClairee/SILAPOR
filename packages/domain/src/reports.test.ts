// P3-1 report domain constants (Phase 3 backend). Pure, no I/O.
import { describe, expect, it } from 'vitest';
import {
  ACTIVE_REPORT_STATUSES,
  DUPLICATE_LOOKBACK_DAYS,
  RELATION_TYPE,
  REPORT_EVENT_TYPE,
  REPORT_STATUS,
  formatTicketNumber,
} from './index.js';

describe('formatTicketNumber', () => {
  it('formats year and sequence as MNT-{YEAR}-{SEQ padded to 6 digits}', () => {
    expect(formatTicketNumber(2026, 124)).toBe('MNT-2026-000124');
  });

  it('pads small sequences and leaves long sequences intact', () => {
    expect(formatTicketNumber(2026, 1)).toBe('MNT-2026-000001');
    expect(formatTicketNumber(2027, 1234567)).toBe('MNT-2027-1234567');
  });
});

describe('REPORT_STATUS', () => {
  it('contains exactly the 7 binding lifecycle values', () => {
    expect([...REPORT_STATUS]).toEqual([
      'REPORTED',
      'VERIFIED',
      'ASSIGNED',
      'INSPECTION',
      'IN_REPAIR',
      'RESOLVED',
      'CLOSED',
    ]);
  });
});

describe('ACTIVE_REPORT_STATUSES', () => {
  it('is the open-work subset (RESOLVED is NOT active)', () => {
    expect([...ACTIVE_REPORT_STATUSES]).toEqual([
      'REPORTED',
      'VERIFIED',
      'ASSIGNED',
      'INSPECTION',
      'IN_REPAIR',
    ]);
    expect(ACTIVE_REPORT_STATUSES).not.toContain('RESOLVED');
    for (const status of ACTIVE_REPORT_STATUSES) {
      expect(REPORT_STATUS).toContain(status);
    }
  });
});

describe('RELATION_TYPE', () => {
  it('contains exactly SUPPORTING and RELATED', () => {
    expect([...RELATION_TYPE]).toEqual(['SUPPORTING', 'RELATED']);
  });
});

describe('REPORT_EVENT_TYPE', () => {
  it('contains at least the 11 binding minimum event types', () => {
    const minimum = [
      'REPORT_CREATED',
      'AI_ANALYSIS_COMPLETED',
      'REPORT_VERIFIED',
      'STATUS_CHANGED',
      'PRIORITY_CHANGED',
      'ASSIGNMENT_CHANGED',
      'PROGRESS_NOTE_ADDED',
      'PUBLIC_UPDATE_ADDED',
      'INTERNAL_NOTE_ADDED',
      'REPORT_RESOLVED',
      'REPORT_CLOSED',
    ];
    for (const event of minimum) {
      expect(REPORT_EVENT_TYPE).toContain(event);
    }
  });
});

describe('DUPLICATE_LOOKBACK_DAYS', () => {
  it('is 14 days', () => {
    expect(DUPLICATE_LOOKBACK_DAYS).toBe(14);
  });
});
