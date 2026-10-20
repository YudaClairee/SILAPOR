// Dashboard period + trend helpers (Admin dashboard V2, Figma 150:191).
//
// The overview endpoint returns one point per active Asia/Jakarta day; the
// chart's Harian/Mingguan/Bulanan tabs re-bucket those points here so the
// server keeps a single cheap query. Everything is pure and timezone-explicit:
// ISO day keys are parsed as UTC calendar days, and "today" is resolved in
// Asia/Jakarta (`jakartaMonthKey`) instead of the browser zone.

export interface TrendPointInput {
  /** `YYYY-MM-DD`, Asia/Jakarta day. */
  readonly date: string;
  readonly reports: number;
  readonly resolvedCount: number;
  readonly resolutionSecondsTotal: number;
}

export type TrendGranularity = 'day' | 'week' | 'month';

export interface TrendBucket {
  /** Stable bucket id (start day or `YYYY-MM`). */
  readonly key: string;
  /** Primary x-axis label ("Minggu 1", "12", "Okt"). */
  readonly label: string;
  /** Secondary x-axis label ("01–07 Okt", "Okt", "2026"). */
  readonly sublabel: string;
  readonly reports: number;
  /** Mean REPORTED→RESOLVED duration of the tickets resolved in the bucket. */
  readonly averageSeconds: number | null;
}

export interface MonthOption {
  /** `YYYY-MM`, or `all` for "Semua periode". */
  readonly value: string;
  readonly label: string;
}

const JAKARTA = 'Asia/Jakarta';
const ALL_PERIOD_LABEL = 'Semua periode';

/** Picker value for "Semua periode" (no lower/upper bound). */
export const ALL_PERIODS = 'all';

function parseDay(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(iso: string, days: number): string {
  const date = parseDay(iso);
  date.setUTCDate(date.getUTCDate() + days);
  return isoDay(date);
}

function daysBetween(fromIso: string, toIso: string): number {
  return Math.round((parseDay(toIso).getTime() - parseDay(fromIso).getTime()) / 86_400_000);
}

function shortMonth(iso: string): string {
  return parseDay(iso).toLocaleDateString('id-ID', { month: 'short', timeZone: 'UTC' });
}

/** Long Indonesian month name for a `YYYY-MM` key: "Oktober 2026". */
export function monthLabel(key: string): string {
  const year = Number(key.slice(0, 4));
  const month = Number(key.slice(5, 7));
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return key;
  }
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString('id-ID', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** Current month key in Asia/Jakarta: `YYYY-MM`. */
export function jakartaMonthKey(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: JAKARTA,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now);
  const year = parts.find((part) => part.type === 'year')?.value ?? '1970';
  const month = parts.find((part) => part.type === 'month')?.value ?? '01';
  return `${year}-${month}`;
}

/** Shift a `YYYY-MM` key by whole months (negative goes back). */
export function shiftMonthKey(key: string, delta: number): string {
  const year = Number(key.slice(0, 4));
  const month = Number(key.slice(5, 7));
  const shifted = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** Inclusive first/last Jakarta day of a `YYYY-MM` month. */
export function monthRange(key: string): { from: string; to: string } {
  const year = Number(key.slice(0, 4));
  const month = Number(key.slice(5, 7));
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: `${key}-01`, to: `${key}-${String(lastDay).padStart(2, '0')}` };
}

/**
 * Month choices for the period picker: the rolling months ending at the
 * current Jakarta month (newest first) plus an all-periods entry.
 */
export function monthOptions(now: Date = new Date(), count = 12): MonthOption[] {
  const current = jakartaMonthKey(now);
  const options: MonthOption[] = [];
  for (let index = 0; index < count; index += 1) {
    const key = shiftMonthKey(current, -index);
    options.push({
      value: key,
      label: index === 0 ? `${monthLabel(key)} (Bulan Ini)` : monthLabel(key),
    });
  }
  options.push({ value: ALL_PERIODS, label: ALL_PERIOD_LABEL });
  return options;
}

/** `YYYY-MM` when the range is exactly one calendar month, else `''`. */
export function selectedMonthKey(from: string, to: string): string {
  if (!/^\d{4}-\d{2}-01$/.test(from)) {
    return '';
  }
  const key = from.slice(0, 7);
  return monthRange(key).to === to ? key : '';
}

/** Human range label: "1–31 Oktober 2026", "1 Okt 2026 – 18 Okt 2026". */
export function rangeLabel(from: string, to: string): string {
  if (from === '' || to === '') {
    return ALL_PERIOD_LABEL;
  }
  const key = selectedMonthKey(from, to);
  if (key !== '') {
    return `1–${Number(to.slice(8, 10))} ${monthLabel(key)}`;
  }
  const format = (iso: string): string =>
    parseDay(iso).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
  return `${format(from)} – ${format(to)}`;
}

/** Default tab: a single week stays daily, anything longer groups by week. */
export function defaultGranularity(from: string, to: string): TrendGranularity {
  if (from === '' || to === '') {
    return 'week';
  }
  return daysBetween(from, to) + 1 > 7 ? 'week' : 'day';
}

function sumPoints(points: readonly TrendPointInput[]): {
  reports: number;
  resolvedCount: number;
  seconds: number;
} {
  return points.reduce(
    (total, point) => ({
      reports: total.reports + point.reports,
      resolvedCount: total.resolvedCount + point.resolvedCount,
      seconds: total.seconds + point.resolutionSecondsTotal,
    }),
    { reports: 0, resolvedCount: 0, seconds: 0 },
  );
}

function bucketOf(
  points: readonly TrendPointInput[],
  key: string,
  label: string,
  sublabel: string,
): TrendBucket {
  const total = sumPoints(points);
  return {
    key,
    label,
    sublabel,
    reports: total.reports,
    averageSeconds:
      total.resolvedCount === 0 ? null : Math.round(total.seconds / total.resolvedCount),
  };
}

/**
 * Re-bucket daily points for the chart tabs.
 *
 * Bounded ranges span the requested days; unbounded ranges span the first to
 * last day that carries data (inventing empty weeks before the first report
 * would be misleading). In both cases the in-between days are gap-filled, so a
 * quiet day/week still plots a 0 and the axis stays continuous.
 */
export function buildTrendBuckets(
  points: readonly TrendPointInput[],
  granularity: TrendGranularity,
  range: { readonly from: string; readonly to: string },
): TrendBucket[] {
  const byDate = new Map(points.map((point) => [point.date, point]));
  const dataDays = points
    .map((point) => point.date)
    .filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  const bounded = range.from !== '' && range.to !== '';
  const firstDay = bounded ? range.from : (dataDays[0] ?? '');
  const lastDay = bounded ? range.to : (dataDays[dataDays.length - 1] ?? '');
  if (firstDay === '' || lastDay === '' || daysBetween(firstDay, lastDay) < 0) {
    return [];
  }
  const days: string[] = [];
  for (let cursor = firstDay; cursor <= lastDay; cursor = addDays(cursor, 1)) {
    days.push(cursor);
  }
  const pick = (date: string): TrendPointInput =>
    byDate.get(date) ?? { date, reports: 0, resolvedCount: 0, resolutionSecondsTotal: 0 };

  if (granularity === 'day') {
    return days.map((date) =>
      bucketOf([pick(date)], date, String(Number(date.slice(8, 10))), shortMonth(date)),
    );
  }

  if (granularity === 'month') {
    const months = new Map<string, string[]>();
    for (const date of days) {
      const key = date.slice(0, 7);
      const bucketDays = months.get(key);
      if (bucketDays === undefined) {
        months.set(key, [date]);
      } else {
        bucketDays.push(date);
      }
    }
    return [...months.entries()].map(([key, bucketDays]) =>
      bucketOf(
        bucketDays.map(pick),
        key,
        parseDay(`${key}-01`).toLocaleDateString('id-ID', { month: 'short', timeZone: 'UTC' }),
        key.slice(0, 4),
      ),
    );
  }

  const weeks: Array<{ start: string; end: string; days: string[] }> = [];
  for (let index = 0; index < days.length; index += 7) {
    const chunk = days.slice(index, index + 7);
    const start = chunk[0] as string;
    weeks.push({ start, end: chunk[chunk.length - 1] as string, days: chunk });
  }
  return weeks.map((week, index) => {
    const startDay = String(Number(week.start.slice(8, 10))).padStart(2, '0');
    const endDay = String(Number(week.end.slice(8, 10))).padStart(2, '0');
    const startMonth = shortMonth(week.start);
    const endMonth = shortMonth(week.end);
    const sublabel =
      startMonth === endMonth
        ? `${startDay}–${endDay} ${endMonth}`
        : `${startDay} ${startMonth} – ${endDay} ${endMonth}`;
    return bucketOf(week.days.map(pick), week.start, `Minggu ${index + 1}`, sublabel);
  });
}

/** Indonesian number: thousands with dots. */
export function formatNumberId(value: number): string {
  return value.toLocaleString('id-ID');
}

/** Hours with at most one decimal: 99_000s → "27,5". */
export function formatHours(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) {
    return '—';
  }
  return (seconds / 3600).toLocaleString('id-ID', { maximumFractionDigits: 1 });
}

/** Percentage with one decimal, as the design prints it: "33,3%", "25,0%". */
export function formatPercent(part: number, total: number): string {
  if (total <= 0) {
    return '0%';
  }
  return `${((part / total) * 100).toLocaleString('id-ID', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;
}

/** "Gedung C · Lt. 3 · Ruang 14" from the asset hotspot location fields. */
export function composeLocationLabel(location: {
  readonly buildingName?: string | null;
  readonly buildingCode?: string | null;
  readonly floorNumber?: number | null;
  readonly roomName?: string | null;
}): string {
  const building =
    location.buildingName ?? (location.buildingCode ? `Gedung ${location.buildingCode}` : null);
  const parts = [
    building,
    location.floorNumber === null || location.floorNumber === undefined
      ? null
      : `Lt. ${location.floorNumber}`,
    location.roomName ?? null,
  ].filter((part): part is string => part !== null && part !== '');
  return parts.length === 0 ? 'Lokasi tidak tercatat' : parts.join(' · ');
}
