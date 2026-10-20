// Ticket detail helpers (Reporter Detail V2). Pure units only: the route and
// the stepper consume these, so pinning them here keeps the page thin.
//
// Timestamps are asserted as literal WIB text: the host timezone must never
// change what a ticket shows, so these tests would fail under a TZ-dependent
// formatter even on a UTC CI box.
import { describe, expect, it } from 'vitest';
import {
  actorLabel,
  confidenceBand,
  confidencePercent,
  deriveStatusTimestamps,
  FLOW_PHASE_LABELS,
  flowIndexOf,
  flowPhaseLine,
  formatJakartaDate,
  formatJakartaDateTime,
  formatJakartaDayMonth,
  formatJakartaShort,
  isFlowStatus,
  locationParts,
  STATUS_FLOW,
  timelineLabel,
} from './ticket-detail.js';

const REPORT = {
  reportedAt: '2026-10-12T01:30:00.000Z',
  verifiedAt: '2026-10-12T02:15:00.000Z',
  resolvedAt: null,
  closedAt: null,
};

describe('status flow', () => {
  it('keeps the seven reporter-visible steps in order', () => {
    expect(STATUS_FLOW).toEqual([
      'REPORTED',
      'VERIFIED',
      'ASSIGNED',
      'INSPECTION',
      'IN_REPAIR',
      'RESOLVED',
      'CLOSED',
    ]);
  });

  it('labels every step', () => {
    for (const step of STATUS_FLOW) {
      expect(FLOW_PHASE_LABELS[step]).not.toBe('');
    }
  });

  it('treats REJECTED/DUPLICATE as off-path', () => {
    expect(flowIndexOf('IN_REPAIR')).toBe(4);
    expect(flowIndexOf('REJECTED')).toBe(-1);
    expect(isFlowStatus('DUPLICATE')).toBe(false);
    expect(flowPhaseLine('REJECTED')).toBeNull();
    expect(flowPhaseLine('IN_REPAIR')).toBe('Tahap 5 dari 7 · Perbaikan Sedang Berlangsung');
  });
});

describe('deriveStatusTimestamps', () => {
  it('fills milestones from the report row', () => {
    const stamps = deriveStatusTimestamps(REPORT, []);
    expect(stamps.REPORTED).toBe(REPORT.reportedAt);
    expect(stamps.VERIFIED).toBe(REPORT.verifiedAt);
    expect(stamps.ASSIGNED).toBeNull();
    expect(stamps.INSPECTION).toBeNull();
    expect(stamps.IN_REPAIR).toBeNull();
    expect(stamps.RESOLVED).toBeNull();
    expect(stamps.CLOSED).toBeNull();
  });

  it('takes the earliest event when a status repeats', () => {
    const stamps = deriveStatusTimestamps(REPORT, [
      { eventType: 'REPORT_VERIFIED', createdAt: '2026-10-12T02:00:00.000Z' },
      { eventType: 'REPORT_VERIFIED', createdAt: '2026-10-12T06:00:00.000Z' },
    ]);
    // The row column already answered; the event must not overwrite it.
    expect(stamps.VERIFIED).toBe(REPORT.verifiedAt);

    const assigned = deriveStatusTimestamps(REPORT, [
      { eventType: 'ASSIGNMENT_CHANGED', createdAt: '2026-10-12T03:00:00.000Z' },
      { eventType: 'ASSIGNMENT_CHANGED', createdAt: '2026-10-12T09:00:00.000Z' },
    ]);
    expect(assigned.ASSIGNED).toBe('2026-10-12T03:00:00.000Z');
  });

  it('maps STATUS_CHANGED toValue onto the flow steps', () => {
    const stamps = deriveStatusTimestamps(REPORT, [
      { eventType: 'STATUS_CHANGED', createdAt: '2026-10-12T04:00:00.000Z', toValue: 'INSPECTION' },
      { eventType: 'STATUS_CHANGED', createdAt: '2026-10-12T05:00:00.000Z', toValue: 'IN_REPAIR' },
    ]);
    expect(stamps.INSPECTION).toBe('2026-10-12T04:00:00.000Z');
    expect(stamps.IN_REPAIR).toBe('2026-10-12T05:00:00.000Z');
  });

  it('ignores unknown, off-path, and timestamp-less events', () => {
    const stamps = deriveStatusTimestamps(REPORT, [
      { eventType: 'PROGRESS_NOTE_ADDED' },
      { eventType: 'STATUS_CHANGED', createdAt: '2026-10-12T05:00:00.000Z', toValue: 'REJECTED' },
      { eventType: 'ASSIGNMENT_CHANGED', createdAt: '2026-10-12T06:00:00.000Z' },
    ]);
    expect(stamps.ASSIGNED).toBe('2026-10-12T06:00:00.000Z');
    expect(stamps.IN_REPAIR).toBeNull();
  });

  it('tolerates a payload that omitted the milestone columns', () => {
    const stamps = deriveStatusTimestamps(
      { reportedAt: REPORT.reportedAt },
      [{ eventType: 'REPORT_CLOSED', createdAt: '2026-10-13T02:00:00.000Z' }],
    );
    expect(stamps.VERIFIED).toBeNull();
    expect(stamps.CLOSED).toBe('2026-10-13T02:00:00.000Z');
  });
});

describe('Jakarta formatting', () => {
  it('renders full timestamps in WIB regardless of host timezone', () => {
    expect(formatJakartaDateTime('2026-10-12T01:30:00.000Z')).toBe('12 Okt 2026, 08:30 WIB');
    // Crossing midnight in UTC still lands on the same Jakarta day.
    expect(formatJakartaDateTime('2026-10-11T18:05:00.000Z')).toBe('12 Okt 2026, 01:05 WIB');
  });

  it('renders the compact stepper and pager variants', () => {
    expect(formatJakartaShort('2026-10-12T01:30:00.000Z')).toBe('12 Okt 08:30');
    expect(formatJakartaDate('2026-10-12T01:30:00.000Z')).toBe('12 Okt 2026');
    expect(formatJakartaDayMonth('2026-10-12T01:30:00.000Z')).toBe('12 Okt');
  });

  it('falls back to an em dash for empty or invalid input', () => {
    expect(formatJakartaDateTime(null)).toBe('—');
    expect(formatJakartaShort('')).toBe('—');
    expect(formatJakartaDate('bukan-tanggal')).toBe('—');
    expect(formatJakartaDayMonth(null)).toBe('—');
  });
});

describe('actor and timeline labels', () => {
  it('labels system steps apart from admin/UMPER notes', () => {
    expect(actorLabel({ eventType: 'REPORT_CREATED' })).toBe('Sistem SCMS');
    expect(actorLabel({ eventType: 'AI_ANALYSIS_COMPLETED' })).toBe('Sistem SCMS');
    expect(actorLabel({ eventType: 'REPORT_VERIFIED' })).toBe('Sistem SCMS');
    expect(actorLabel({ eventType: 'ASSIGNMENT_CHANGED' })).toBe('Catatan Admin/UMPER');
    expect(actorLabel({ eventType: 'PROGRESS_NOTE_ADDED' })).toBe('Catatan Admin/UMPER');
  });

  it('falls back to Riwayat when the event type is missing', () => {
    expect(timelineLabel({})).toBe('Riwayat');
    expect(timelineLabel({ eventType: 'REPORT_CREATED' })).not.toBe('');
  });
});

describe('classifier confidence', () => {
  it('normalizes 0..1 and already-percent values to integers', () => {
    expect(confidencePercent(0.94)).toBe(94);
    expect(confidencePercent(1)).toBe(100);
    expect(confidencePercent(94)).toBe(94);
    expect(confidencePercent(0)).toBe(0);
    // Only values ≤ 1 are treated as a ratio; anything above is already a
    // percentage (the classifier column is 0..1, the fallback is 0..100).
    expect(confidencePercent(1.4)).toBe(1);
    expect(confidencePercent(null)).toBeNull();
    expect(confidencePercent(Number.NaN)).toBeNull();
  });

  it('bands the meter copy', () => {
    expect(confidenceBand(94)).toBe('Tinggi');
    expect(confidenceBand(80)).toBe('Tinggi');
    expect(confidenceBand(79)).toBe('Sedang');
    expect(confidenceBand(50)).toBe('Sedang');
    expect(confidenceBand(49)).toBe('Rendah');
  });
});

describe('locationParts', () => {
  const LOCATIONS = [
    { id: 'b', name: 'Gedung A', type: 'BUILDING', parentId: null, buildingCode: 'A', floorNumber: null },
    { id: 'f', name: 'Lantai 3', type: 'FLOOR', parentId: 'b', buildingCode: 'A', floorNumber: 3 },
    { id: 'r', name: 'Ruang 302', type: 'ROOM', parentId: 'f', buildingCode: 'A', floorNumber: 3 },
    { id: 'lobby', name: 'Lobi', type: 'SHARED_AREA', parentId: 'b', buildingCode: 'A', floorNumber: null },
  ];

  it('walks ROOM → FLOOR → BUILDING', () => {
    expect(locationParts('r', LOCATIONS)).toEqual({
      building: 'Gedung A',
      floor: 'Lantai 3',
      room: 'Ruang 302',
    });
  });

  it('treats a shared area as a room', () => {
    expect(locationParts('lobby', LOCATIONS).room).toBe('Lobi');
  });

  it('degrades to nulls for a missing or null branch', () => {
    expect(locationParts(null, LOCATIONS)).toEqual({ building: null, floor: null, room: null });
    expect(locationParts('unknown', LOCATIONS)).toEqual({
      building: null,
      floor: null,
      room: null,
    });
  });

  it('falls back to the code/floor columns when ancestors are absent', () => {
    const orphan = [
      { id: 'x', name: '', type: 'ROOM', parentId: null, buildingCode: 'C', floorNumber: 2 },
    ];
    expect(locationParts('x', orphan)).toEqual({
      building: 'Gedung C',
      floor: 'Lantai 2',
      room: '',
    });
  });

  it('terminates on a parent cycle', () => {
    const cycle = [
      { id: 'a', name: 'A', type: 'ROOM', parentId: 'b', buildingCode: null, floorNumber: null },
      { id: 'b', name: 'B', type: 'FLOOR', parentId: 'a', buildingCode: null, floorNumber: null },
    ];
    expect(locationParts('a', cycle)).toEqual({ building: null, floor: 'B', room: 'A' });
  });
});
