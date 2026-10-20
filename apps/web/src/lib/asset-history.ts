// Admin asset-repair history helpers (Histori Perbaikan Aset, Figma 150:1264).
//
// Pure client-side only: Indonesian handling-duration copy, Jakarta-year
// extraction for the Periode filter, and the year-option list. No DB, no
// HTTP, no DOM. Duration is derived from `reportedAt` → `resolvedAt`
// (`closedAt` fallback) so the DB stays a factual transport; an active
// ticket (no end yet) renders "Belum selesai".

/** Jakarta-calendar year of an ISO timestamp; null when unparseable. */
export function jakartaYearOf(value: string | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const year = Number(
    new Intl.DateTimeFormat('id-ID', { year: 'numeric', timeZone: 'Asia/Jakarta' }).format(date),
  );
  return Number.isFinite(year) ? year : null;
}

export interface PeriodOption {
  readonly value: string;
  readonly label: string;
}

/**
 * Year options for the Periode filter: "Semua Waktu (YYYY)" (latest year)
 * then one "Tahun YYYY" per year present in the loaded tickets, desc.
 * Empty input → a single "Semua Waktu" option (no year suffix).
 */
export function historyPeriodOptions(reportedAts: readonly (string | null | undefined)[]): PeriodOption[] {
  const years = Array.from(
    new Set(
      reportedAts
        .map((value) => jakartaYearOf(value))
        .filter((year): year is number => year !== null),
    ),
  ).sort((a, b) => b - a);
  if (years.length === 0) return [{ value: 'all', label: 'Semua Waktu' }];
  const latest = years[0] as number;
  return [
    { value: 'all', label: `Semua Waktu (${latest})` },
    ...years.map((year) => ({ value: String(year), label: `Tahun ${year}` })),
  ];
}

/** True when a ticket's `reportedAt` falls in the selected period. */
export function inHistoryPeriod(reportedAt: string | null | undefined, period: string): boolean {
  if (period === '' || period === 'all') return true;
  const year = jakartaYearOf(reportedAt);
  return year !== null && String(year) === period;
}

/**
 * "1 hari 1 jam" / "7 jam" / "45 menit" Indonesian duration between two ISO
 * timestamps. Null/empty/invalid input or a non-positive span → null so the
 * caller renders "Belum selesai".
 */
export function handlingDuration(
  reportedAt: string | null | undefined,
  endedAt: string | null | undefined,
): string | null {
  if (reportedAt === null || reportedAt === undefined || reportedAt === '') return null;
  if (endedAt === null || endedAt === undefined || endedAt === '') return null;
  const start = new Date(reportedAt);
  const end = new Date(endedAt);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  const diffMs = end.getTime() - start.getTime();
  if (diffMs <= 0) return null;
  const totalMinutes = Math.floor(diffMs / 60_000);
  const days = Math.floor(totalMinutes / 1_440);
  const hours = Math.floor((totalMinutes % 1_440) / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days} hari`);
  if (hours > 0) parts.push(`${hours} jam`);
  if (parts.length === 0) parts.push(`${Math.max(minutes, 1)} menit`);
  return parts.join(' ');
}
