import { badRequest } from '@silapor/shared';

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000;

// Asia/Jakarta (WIB) is a fixed UTC+07:00 offset with no DST, so every Jakarta
// midnight is 17:00Z on the previous UTC day.
function jakartaMidnightUtcMs(year: number, monthIndex: number, day: number): number {
  return Date.UTC(year, monthIndex, day) - WIB_OFFSET_MS;
}

function parseDay(day: string): { year: number; monthIndex: number; dayOfMonth: number } {
  if (!DAY_PATTERN.test(day)) {
    throw badRequest(`invalid day "${day}": expected YYYY-MM-DD`);
  }
  const year = Number(day.slice(0, 4));
  const monthIndex = Number(day.slice(5, 7)) - 1;
  const dayOfMonth = Number(day.slice(8, 10));
  const utc = new Date(Date.UTC(year, monthIndex, dayOfMonth));
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== monthIndex ||
    utc.getUTCDate() !== dayOfMonth
  ) {
    throw badRequest(`invalid calendar day "${day}"`);
  }
  return { year, monthIndex, dayOfMonth };
}

function jakartaYearMonth(now: Date): { year: number; month: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: 'numeric',
  }).formatToParts(now);
  const part = (type: 'year' | 'month'): number =>
    Number(parts.find((entry) => entry.type === type)?.value);
  return { year: part('year'), month: part('month') };
}

export interface JakartaDayRangeInput {
  readonly from?: string | null;
  readonly to?: string | null;
}

export interface JakartaDayRange {
  readonly from?: Date;
  readonly toExclusive?: Date;
}

export interface JakartaMonthBounds {
  readonly start: Date;
  readonly endExclusive: Date;
}

export function jakartaDayStartUtc(day: string): Date {
  const { year, monthIndex, dayOfMonth } = parseDay(day);
  return new Date(jakartaMidnightUtcMs(year, monthIndex, dayOfMonth));
}

export function jakartaDayRange(input: JakartaDayRangeInput): JakartaDayRange {
  const range: { from?: Date; toExclusive?: Date } = {};
  if (input.from !== undefined && input.from !== null) {
    range.from = jakartaDayStartUtc(input.from);
  }
  if (input.to !== undefined && input.to !== null) {
    range.toExclusive = new Date(
      jakartaDayStartUtc(input.to).getTime() + 24 * 60 * 60 * 1000,
    );
  }
  return range;
}

export function jakartaMonthBoundsUtc(now: Date = new Date()): JakartaMonthBounds {
  const { year, month } = jakartaYearMonth(now);
  return {
    start: new Date(jakartaMidnightUtcMs(year, month - 1, 1)),
    endExclusive: new Date(jakartaMidnightUtcMs(year, month, 1)),
  };
}
