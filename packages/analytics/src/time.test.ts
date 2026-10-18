import { describe, expect, it } from 'vitest';
import { isAppError } from '@silapor/shared';
import { jakartaDayRange, jakartaDayStartUtc, jakartaMonthBoundsUtc } from './time.js';

describe('jakartaDayStartUtc', () => {
  it('treats a Jakarta day as starting 17:00Z the previous day', () => {
    expect(jakartaDayStartUtc('2026-10-18').toISOString()).toBe('2026-10-17T17:00:00.000Z');
  });
  it.each(['2026-13-01', '2026-02-30', 'abc', '2026-1-1', '20261018'])(
    'rejects malformed day %s with a 400',
    (day) => {
      try {
        jakartaDayStartUtc(day);
        expect.unreachable('should have thrown');
      } catch (error) {
        expect(isAppError(error) && error.status === 400).toBe(true);
      }
    },
  );
});

describe('jakartaDayRange', () => {
  it('maps from and to to an inclusive Jakarta day window', () => {
    const range = jakartaDayRange({ from: '2026-10-01', to: '2026-10-18' });
    expect(range.from?.toISOString()).toBe('2026-09-30T17:00:00.000Z');
    expect(range.toExclusive?.toISOString()).toBe('2026-10-18T17:00:00.000Z');
  });
  it('returns an empty range when params are absent', () => {
    expect(jakartaDayRange({})).toEqual({});
    expect(jakartaDayRange({ from: null, to: null })).toEqual({});
  });
});

describe('jakartaMonthBoundsUtc', () => {
  it('uses the Jakarta month even when UTC is still the previous month', () => {
    const bounds = jakartaMonthBoundsUtc(new Date('2026-10-31T18:00:00.000Z'));
    expect(bounds.start.toISOString()).toBe('2026-10-31T17:00:00.000Z');
    expect(bounds.endExclusive.toISOString()).toBe('2026-11-30T17:00:00.000Z');
  });
  it('handles year rollover', () => {
    const bounds = jakartaMonthBoundsUtc(new Date('2026-12-15T00:00:00.000Z'));
    expect(bounds.endExclusive.toISOString()).toBe('2026-12-31T17:00:00.000Z');
  });
});
