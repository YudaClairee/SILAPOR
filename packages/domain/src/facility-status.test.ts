import { describe, expect, it } from 'vitest';
import {
  deriveFacilityStatus,
  FACILITY_STATUSES,
  facilityStatusSeverity,
} from './index.js';

describe('deriveFacilityStatus (plan §4.6, 2026-10-17 realignment)', () => {
  it('exposes exactly the three public statuses', () => {
    expect(FACILITY_STATUSES).toEqual(['OPERATIONAL', 'UNDER_INSPECTION', 'IN_REPAIR']);
  });

  it('returns OPERATIONAL when there is no active report', () => {
    expect(deriveFacilityStatus([])).toBe('OPERATIONAL');
  });

  it('maps REPORTED and VERIFIED to UNDER_INSPECTION', () => {
    expect(deriveFacilityStatus(['REPORTED'])).toBe('UNDER_INSPECTION');
    expect(deriveFacilityStatus(['VERIFIED'])).toBe('UNDER_INSPECTION');
  });

  it('maps ASSIGNED and INSPECTION to UNDER_INSPECTION', () => {
    expect(deriveFacilityStatus(['ASSIGNED'])).toBe('UNDER_INSPECTION');
    expect(deriveFacilityStatus(['INSPECTION'])).toBe('UNDER_INSPECTION');
  });

  it('maps IN_REPAIR to IN_REPAIR', () => {
    expect(deriveFacilityStatus(['IN_REPAIR'])).toBe('IN_REPAIR');
  });

  it('applies precedence IN_REPAIR > UNDER_INSPECTION', () => {
    expect(deriveFacilityStatus(['REPORTED', 'ASSIGNED'])).toBe('UNDER_INSPECTION');
    expect(deriveFacilityStatus(['IN_REPAIR', 'ASSIGNED', 'REPORTED'])).toBe('IN_REPAIR');
    expect(deriveFacilityStatus(['ASSIGNED', 'REPORTED'])).toBe('UNDER_INSPECTION');
  });

  it('keeps the highest severity regardless of input order', () => {
    expect(deriveFacilityStatus(['IN_REPAIR', 'VERIFIED'])).toBe('IN_REPAIR');
    expect(deriveFacilityStatus(['VERIFIED', 'IN_REPAIR'])).toBe('IN_REPAIR');
  });

  it('ignores duplicate statuses and terminal/unknown values defensively', () => {
    expect(deriveFacilityStatus(['REPORTED', 'REPORTED'])).toBe('UNDER_INSPECTION');
    expect(deriveFacilityStatus(['RESOLVED', 'CLOSED', 'REJECTED', 'DUPLICATE'])).toBe(
      'OPERATIONAL',
    );
    expect(deriveFacilityStatus(['WEIRD_STATUS'])).toBe('OPERATIONAL');
    expect(deriveFacilityStatus(['IN_REPAIR', 'CLOSED'])).toBe('IN_REPAIR');
  });
});

describe('facilityStatusSeverity (plan §4.6)', () => {
  it('ranks IN_REPAIR > UNDER_INSPECTION > OPERATIONAL', () => {
    expect(facilityStatusSeverity('IN_REPAIR')).toBeGreaterThan(
      facilityStatusSeverity('UNDER_INSPECTION'),
    );
    expect(facilityStatusSeverity('UNDER_INSPECTION')).toBeGreaterThan(
      facilityStatusSeverity('OPERATIONAL'),
    );
    expect(facilityStatusSeverity('OPERATIONAL')).toBe(0);
  });
});
