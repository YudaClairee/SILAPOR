// Dashboard period/trend helper contract (Admin dashboard V2). Pure functions:
// no DOM, no fetch — the node environment is enough.
import { describe, expect, it } from 'vitest';
import {
  buildTrendBuckets,
  composeLocationLabel,
  defaultGranularity,
  formatHours,
  formatNumberId,
  formatPercent,
  jakartaMonthKey,
  monthLabel,
  monthOptions,
  monthRange,
  rangeLabel,
  selectedMonthKey,
  shiftMonthKey,
} from './dashboard-period';

describe('month helpers', () => {
  it('returns the inclusive Jakarta day range of a month', () => {
    expect(monthRange('2026-10')).toEqual({ from: '2026-10-01', to: '2026-10-31' });
    expect(monthRange('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(monthRange('2024-02')).toEqual({ from: '2024-02-01', to: '2024-02-29' });
  });

  it('resolves the current month in Asia/Jakarta, not UTC', () => {
    // 2026-09-30T17:30Z is already 1 October 00:30 in Jakarta.
    expect(jakartaMonthKey(new Date('2026-09-30T17:30:00.000Z'))).toBe('2026-10');
    expect(jakartaMonthKey(new Date('2026-10-20T03:00:00.000Z'))).toBe('2026-10');
  });

  it('shifts month keys across the year boundary', () => {
    expect(shiftMonthKey('2026-01', -1)).toBe('2025-12');
    expect(shiftMonthKey('2026-12', 1)).toBe('2027-01');
    expect(shiftMonthKey('2026-10', -11)).toBe('2025-11');
  });

  it('renders Indonesian month labels', () => {
    expect(monthLabel('2026-10')).toBe('Oktober 2026');
    expect(monthLabel('2026-01')).toBe('Januari 2026');
  });

  it('builds the 12-month picker ending at the current month plus all periods', () => {
    const options = monthOptions(new Date('2026-10-15T03:00:00.000Z'));
    expect(options).toHaveLength(13);
    expect(options[0]).toEqual({ value: '2026-10', label: 'Oktober 2026 (Bulan Ini)' });
    expect(options[1]).toEqual({ value: '2026-09', label: 'September 2026' });
    expect(options[11]).toEqual({ value: '2025-11', label: 'November 2025' });
    expect(options[12]).toEqual({ value: 'all', label: 'Semua periode' });
  });

  it('detects a whole-month range and labels it', () => {
    expect(selectedMonthKey('2026-10-01', '2026-10-31')).toBe('2026-10');
    expect(selectedMonthKey('2026-10-01', '2026-10-18')).toBe('');
    expect(selectedMonthKey('', '')).toBe('');
    expect(rangeLabel('2026-10-01', '2026-10-31')).toBe('1–31 Oktober 2026');
    expect(rangeLabel('2026-10-01', '2026-10-18')).toBe('1 Okt 2026 – 18 Okt 2026');
    expect(rangeLabel('', '')).toBe('Semua periode');
  });

  it('defaults to daily for a week and weekly for longer ranges', () => {
    expect(defaultGranularity('2026-10-01', '2026-10-07')).toBe('day');
    expect(defaultGranularity('2026-10-01', '2026-10-31')).toBe('week');
    expect(defaultGranularity('', '')).toBe('week');
  });
});

describe('buildTrendBuckets', () => {
  const octoberPoints = [
    { date: '2026-10-01', reports: 4, resolvedCount: 1, resolutionSecondsTotal: 115_200 },
    { date: '2026-10-02', reports: 6, resolvedCount: 1, resolutionSecondsTotal: 115_200 },
    { date: '2026-10-08', reports: 15, resolvedCount: 0, resolutionSecondsTotal: 0 },
  ];

  it('folds October into 7-day weeks starting at the range start', () => {
    const buckets = buildTrendBuckets(octoberPoints, 'week', {
      from: '2026-10-01',
      to: '2026-10-31',
    });
    expect(buckets.map((bucket) => bucket.label)).toEqual([
      'Minggu 1',
      'Minggu 2',
      'Minggu 3',
      'Minggu 4',
      'Minggu 5',
    ]);
    expect(buckets.map((bucket) => bucket.sublabel)).toEqual([
      '01–07 Okt',
      '08–14 Okt',
      '15–21 Okt',
      '22–28 Okt',
      '29–31 Okt',
    ]);
    expect(buckets[0]?.reports).toBe(10);
    expect(buckets[1]?.reports).toBe(15);
    expect(buckets[2]?.reports).toBe(0);
  });

  it('keeps the duration average weighted by resolved sample size', () => {
    // Week 1: two resolved tickets of 32h each → 32h, not an average of days.
    const buckets = buildTrendBuckets(octoberPoints, 'week', {
      from: '2026-10-01',
      to: '2026-10-31',
    });
    expect(buckets[0]?.averageSeconds).toBe(115_200);
    expect(buckets[1]?.averageSeconds).toBeNull();
  });

  it('fills quiet days and labels them by day + short month', () => {
    const buckets = buildTrendBuckets(octoberPoints, 'day', {
      from: '2026-10-01',
      to: '2026-10-03',
    });
    expect(buckets).toEqual([
      { key: '2026-10-01', label: '1', sublabel: 'Okt', reports: 4, averageSeconds: 115_200 },
      { key: '2026-10-02', label: '2', sublabel: 'Okt', reports: 6, averageSeconds: 115_200 },
      { key: '2026-10-03', label: '3', sublabel: 'Okt', reports: 0, averageSeconds: null },
    ]);
  });

  it('groups by calendar month across a year boundary', () => {
    const buckets = buildTrendBuckets(
      [
        { date: '2025-12-20', reports: 2, resolvedCount: 0, resolutionSecondsTotal: 0 },
        { date: '2026-01-05', reports: 3, resolvedCount: 0, resolutionSecondsTotal: 0 },
      ],
      'month',
      { from: '2025-12-20', to: '2026-01-05' },
    );
    expect(buckets.map((bucket) => [bucket.label, bucket.sublabel, bucket.reports])).toEqual([
      ['Des', '2025', 2],
      ['Jan', '2026', 3],
    ]);
  });

  it('spans first-to-last data day and gap-fills between them when unbounded', () => {
    const buckets = buildTrendBuckets(octoberPoints, 'day', { from: '', to: '' });
    expect(buckets.map((bucket) => bucket.key)).toEqual([
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
      '2026-10-05',
      '2026-10-06',
      '2026-10-07',
      '2026-10-08',
    ]);
    expect(buckets[2]?.reports).toBe(0);
    expect(buckets[7]?.reports).toBe(15);
  });

  it('returns no buckets without data or bounds', () => {
    expect(buildTrendBuckets([], 'week', { from: '', to: '' })).toEqual([]);
    expect(buildTrendBuckets([], 'week', { from: '2026-10-31', to: '2026-10-01' })).toEqual([]);
  });
});

describe('formatters', () => {
  it('formats Indonesian numbers, hours and percentages', () => {
    expect(formatNumberId(1234)).toBe('1.234');
    expect(formatHours(99_000)).toBe('27,5');
    expect(formatHours(null)).toBe('—');
    expect(formatPercent(16, 48)).toBe('33,3%');
    expect(formatPercent(4, 0)).toBe('0%');
  });

  it('composes the asset location line from the available parts', () => {
    expect(
      composeLocationLabel({ buildingName: 'Gedung C', floorNumber: 3, roomName: 'Ruang 14' }),
    ).toBe('Gedung C · Lt. 3 · Ruang 14');
    expect(composeLocationLabel({ buildingCode: 'C', floorNumber: null, roomName: null })).toBe(
      'Gedung C',
    );
    expect(composeLocationLabel({})).toBe('Lokasi tidak tercatat');
  });
});
