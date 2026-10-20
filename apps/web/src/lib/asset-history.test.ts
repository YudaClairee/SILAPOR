// Admin asset-history helpers contract (Histori Perbaikan Aset, Figma 150:1264).
import { describe, expect, it } from 'vitest';
import {
  handlingDuration,
  historyPeriodOptions,
  inHistoryPeriod,
  jakartaYearOf,
} from './asset-history.js';

describe('jakartaYearOf', () => {
  it('reads the Jakarta-calendar year across a UTC New Year boundary', () => {
    // 2025-12-31T18:30Z is already 2026-01-01 in Jakarta.
    expect(jakartaYearOf('2025-12-31T18:30:00.000Z')).toBe(2026);
    expect(jakartaYearOf('2026-06-01T00:00:00.000Z')).toBe(2026);
  });

  it('returns null for blank or invalid input', () => {
    expect(jakartaYearOf(null)).toBeNull();
    expect(jakartaYearOf('')).toBeNull();
    expect(jakartaYearOf('bukan-tanggal')).toBeNull();
  });
});

describe('historyPeriodOptions', () => {
  it('labels the default with the latest year and lists prior years desc', () => {
    expect(
      historyPeriodOptions([
        '2026-10-18T01:30:00.000Z',
        '2026-07-14T03:15:00.000Z',
        '2026-03-05T02:00:00.000Z',
      ]),
    ).toEqual([
      { value: 'all', label: 'Semua Waktu (2026)' },
      { value: '2026', label: 'Tahun 2026' },
    ]);
  });

  it('falls back to a year-less label when no ticket carries a date', () => {
    expect(historyPeriodOptions([])).toEqual([{ value: 'all', label: 'Semua Waktu' }]);
    expect(historyPeriodOptions([null])).toEqual([{ value: 'all', label: 'Semua Waktu' }]);
  });
});

describe('inHistoryPeriod', () => {
  it('keeps every ticket for the default period and filters by year', () => {
    expect(inHistoryPeriod('2026-03-05T02:00:00.000Z', 'all')).toBe(true);
    expect(inHistoryPeriod('2026-03-05T02:00:00.000Z', '2026')).toBe(true);
    expect(inHistoryPeriod('2026-03-05T02:00:00.000Z', '2025')).toBe(false);
    expect(inHistoryPeriod(null, '2026')).toBe(false);
  });
});

describe('handlingDuration', () => {
  it('renders day+hour and hour-only spans like the Figma rows', () => {
    expect(handlingDuration('2026-07-14T03:15:00.000Z', '2026-07-15T04:30:00.000Z')).toBe(
      '1 hari 1 jam',
    );
    expect(handlingDuration('2026-03-05T02:00:00.000Z', '2026-03-05T09:00:00.000Z')).toBe('7 jam');
  });

  it('returns null when the ticket has not ended yet', () => {
    expect(handlingDuration('2026-10-18T01:30:00.000Z', null)).toBeNull();
    expect(handlingDuration('2026-10-18T01:30:00.000Z', '')).toBeNull();
    // End before start is data noise — never a negative duration.
    expect(
      handlingDuration('2026-03-05T09:00:00.000Z', '2026-03-05T02:00:00.000Z'),
    ).toBeNull();
  });
});
