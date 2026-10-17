import { describe, expect, it } from 'vitest';
import { deriveFacilityStatus, FACILITY_STATUSES } from './index.js';

describe('deriveFacilityStatus (plan §4.6)', () => {
  it('exposes exactly the four public statuses', () => {
    expect(FACILITY_STATUSES).toEqual([
      'OPERATIONAL',
      'REPORTED_ISSUE',
      'UNDER_INSPECTION',
      'IN_REPAIR',
    ]);
  });

  it('returns OPERATIONAL when there is no active report', () => {
    expect(deriveFacilityStatus([])).toBe('OPERATIONAL');
  });

  it('maps REPORTED and VERIFIED to REPORTED_ISSUE', () => {
    expect(deriveFacilityStatus(['REPORTED'])).toBe('REPORTED_ISSUE');
    expect(deriveFacilityStatus(['VERIFIED'])).toBe('REPORTED_ISSUE');
  });

  it('maps ASSIGNED and INSPECTION to UNDER_INSPECTION', () => {
    expect(deriveFacilityStatus(['ASSIGNED'])).toBe('UNDER_INSPECTION');
    expect(deriveFacilityStatus(['INSPECTION'])).toBe('UNDER_INSPECTION');
  });

  it('maps IN_REPAIR to IN_REPAIR', () => {
    expect(deriveFacilityStatus(['IN_REPAIR'])).toBe('IN_REPAIR');
  });

  it('applies precedence IN_REPAIR > UNDER_INSPECTION > REPORTED_ISSUE', () => {
    expect(deriveFacilityStatus(['REPORTED', 'ASSIGNED'])).toBe('UNDER_INSPECTION');
    expect(deriveFacilityStatus(['IN_REPAIR', 'ASSIGNED', 'REPORTED'])).toBe('IN_REPAIR');
    expect(deriveFacilityStatus(['ASSIGNED', 'REPORTED'])).toBe('UNDER_INSPECTION');
  });

  it('keeps the highest severity regardless of input order', () => {
    expect(deriveFacilityStatus(['IN_REPAIR', 'VERIFIED'])).toBe('IN_REPAIR');
    expect(deriveFacilityStatus(['VERIFIED', 'IN_REPAIR'])).toBe('IN_REPAIR');
  });

  it('ignores duplicate statuses and terminal/unknown values defensively', () => {
    expect(deriveFacilityStatus(['REPORTED', 'REPORTED'])).toBe('REPORTED_ISSUE');
    expect(deriveFacilityStatus(['RESOLVED', 'CLOSED', 'REJECTED', 'DUPLICATE'])).toBe(
      'OPERATIONAL',
    );
    expect(deriveFacilityStatus(['WEIRD_STATUS'])).toBe('OPERATIONAL');
    expect(deriveFacilityStatus(['IN_REPAIR', 'CLOSED'])).toBe('IN_REPAIR');
  });
});
