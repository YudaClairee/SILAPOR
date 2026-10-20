// Reporter landing + ticket monitoring (V2 design): KPI strip, Semua/Laporan
// Saya tabs, debounced server-side search, status/priority filter, and a
// 10-row paginated table. Data comes from GET /api/reports (campus-sanitized)
// and GET /api/reports/stats; asset/location names and reporter counts are
// already resolved server-side.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { REPORT_STATUS } from '@silapor/domain';
import {
  BellIcon,
  BriefcaseIcon,
  Button,
  CheckCircleIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  EmptyState,
  ErrorPanel,
  FilterIcon,
  LoadingState,
  PlusIcon,
  SearchIcon,
  StatusBadge,
  TicketMono,
  UsersIcon,
  WrenchIcon,
  buttonBaseClasses,
  buttonVariantClasses,
} from '../components/index.js';
import { priorityLabel, statusLabel } from '../lib/admin-reports.js';

interface Stats {
  readonly total: number;
  readonly active: number;
  readonly inRepair: number;
  readonly done: number;
  readonly mineTotal: number;
}

interface ReportRow {
  readonly id: string;
  readonly ticketNumber: string;
  readonly status: string;
  readonly finalPriority: string | null;
  readonly assetId: string | null;
  readonly assetName: string | null;
  readonly locationId: string;
  readonly locationName: string | null;
  readonly locationBuildingCode: string | null;
  readonly locationFloorNumber: number | null;
  readonly reporterCount: number | null;
  readonly reportedAt: string;
  readonly resolvedAt: string | null;
  readonly closedAt: string | null;
  readonly isOwn: boolean;
}

interface ReportListData {
  readonly items: readonly ReportRow[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

interface ListSearch {
  readonly search: string;
  readonly mine: boolean;
  readonly status: string;
  readonly priority: string;
  readonly offset: number;
}

interface LoaderData {
  readonly stats: Stats | null;
  readonly reports: ReportListData | null;
  readonly loadError: string | null;
  readonly needsClientLoad: boolean;
}

type Bundle =
  | {
      readonly stats: Stats | null;
      readonly reports: ReportListData | null;
      readonly loadError: string | null;
    }
  | 'unauthorized'
  | 'unavailable';

const PAGE_SIZE = 10;
const SEARCH_DEBOUNCE_MS = 300;
const STATUS_OPTIONS = REPORT_STATUS.map((status) => ({
  value: status,
  label: statusLabel(status),
}));
const PRIORITY_OPTIONS = [
  { value: 'HIGH', label: priorityLabel('HIGH') },
  { value: 'MEDIUM', label: priorityLabel('MEDIUM') },
  { value: 'LOW', label: priorityLabel('LOW') },
] as const;

function buildQuery(state: ListSearch): string {
  const params = new URLSearchParams();
  params.set('limit', String(PAGE_SIZE));
  params.set('offset', String(state.offset));
  params.set('sort', 'reported_desc');
  if (state.mine) params.set('mine', '1');
  if (state.status !== '') params.set('status', state.status);
  if (state.priority !== '') params.set('priority', state.priority);
  const term = state.search.trim();
  if (term.length >= 2) params.set('search', term);
  return params.toString();
}

function toStats(value: unknown): Stats {
  const record =
    value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const number = (key: keyof Stats): number => {
    const raw = record[key];
    return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? raw : 0;
  };
  return {
    total: number('total'),
    active: number('active'),
    inRepair: number('inRepair'),
    done: number('done'),
    mineTotal: number('mineTotal'),
  };
}

function toReports(value: unknown): ReportListData {
  const record =
    value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
  const items = Array.isArray(record['items']) ? (record['items'] as ReportRow[]) : [];
  const count = (key: string, fallback: number): number => {
    const raw = record[key];
    return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? raw : fallback;
  };
  return {
    items,
    total: count('total', items.length),
    limit: count('limit', PAGE_SIZE),
    offset: count('offset', 0),
  };
}

async function fetchBundle(state: ListSearch): Promise<Bundle> {
  let reportsResponse: Response;
  let statsResponse: Response;
  try {
    [reportsResponse, statsResponse] = await Promise.all([
      fetch(`/api/reports?${buildQuery(state)}`, { credentials: 'include' }),
      fetch('/api/reports/stats', { credentials: 'include' }),
    ]);
  } catch {
    return 'unavailable';
  }
  if (reportsResponse.status === 401 || statsResponse.status === 401) {
    return 'unauthorized';
  }
  if (!reportsResponse.ok) {
    return {
      stats: null,
      reports: null,
      loadError: `Gagal memuat laporan (${reportsResponse.status}).`,
    };
  }
  if (!statsResponse.ok) {
    return {
      stats: null,
      reports: null,
      loadError: `Gagal memuat ringkasan (${statsResponse.status}).`,
    };
  }
  try {
    const [reportsBody, statsBody] = await Promise.all([
      reportsResponse.json() as Promise<unknown>,
      statsResponse.json() as Promise<unknown>,
    ]);
    return {
      stats: toStats(statsBody),
      reports: toReports(reportsBody),
      loadError: null,
    };
  } catch {
    return { stats: null, reports: null, loadError: 'Respons laporan tidak valid.' };
  }
}

function fmt(value: string | null): string {
  if (value === null || value === '') return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
}

function locationLabel(row: ReportRow): string {
  if (row.locationName === null) return 'Lokasi terbatas';
  const parts = [
    row.locationName,
    row.locationBuildingCode === null ? null : `Gedung ${row.locationBuildingCode}`,
    row.locationFloorNumber === null ? null : `Lt. ${row.locationFloorNumber}`,
  ].filter((part): part is string => part !== null && part !== '');
  return parts.join(' · ');
}

function handledLabel(row: ReportRow): string {
  const doneAt = row.closedAt ?? row.resolvedAt;
  if (doneAt !== null) return `Selesai: ${fmt(doneAt)}`;
  return row.status === 'RESOLVED' || row.status === 'CLOSED' ? 'Selesai' : 'Belum selesai';
}

function pageWindow(current: number, totalPages: number): readonly (number | string)[] {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }
  const pages: (number | string)[] = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(totalPages - 1, current + 1);
  if (start > 2) pages.push('start-ellipsis');
  for (let page = start; page <= end; page += 1) pages.push(page);
  if (end < totalPages - 1) pages.push('end-ellipsis');
  pages.push(totalPages);
  return pages;
}

export const Route = createFileRoute('/reporter/')({
  validateSearch: (search: Record<string, unknown>): ListSearch => ({
    search:
      typeof search['search'] === 'string'
        ? search['search']
        : typeof search['q'] === 'string'
          ? search['q']
          : '',
    mine: search['mine'] === true || search['mine'] === '1' || search['mine'] === 'true',
    status: typeof search['status'] === 'string' ? search['status'] : '',
    priority: typeof search['priority'] === 'string' ? search['priority'] : '',
    offset:
      typeof search['offset'] === 'number' || typeof search['offset'] === 'string'
        ? Math.max(0, Number(search['offset']) || 0)
        : 0,
  }),
  loaderDeps: ({ search }) => ({ ...search }),
  loader: async ({ deps }): Promise<LoaderData> => {
    const result = await fetchBundle(deps);
    if (result === 'unauthorized') {
      throw redirect({ to: '/login' });
    }
    if (result === 'unavailable') {
      return { stats: null, reports: null, loadError: null, needsClientLoad: true };
    }
    return {
      stats: result.stats,
      reports: result.reports,
      loadError: result.loadError,
      needsClientLoad: false,
    };
  },
  pendingComponent: Pending,
  component: Page,
});

function Pending() {
  return (
    <section aria-labelledby="monitor-title">
      <h1 id="monitor-title" className="text-3xl font-bold tracking-tight text-text">
        Pemantauan Tiket
      </h1>
      <div className="mt-6">
        <LoadingState message="Memuat laporan…" />
      </div>
    </section>
  );
}

function Page() {
  const loader = Route.useLoaderData() as LoaderData;
  const search = Route.useSearch() as ListSearch;
  const navigate = useNavigate();
  const [stats, setStats] = useState<Stats | null>(loader.stats);
  const [reports, setReports] = useState<ReportListData | null>(loader.reports);
  const [pending, setPending] = useState(loader.needsClientLoad);
  const [loadError, setLoadError] = useState<string | null>(loader.loadError);
  const [searchDraft, setSearchDraft] = useState(search.search);
  const [filterOpen, setFilterOpen] = useState(false);
  const [statusDraft, setStatusDraft] = useState(search.status);
  const [priorityDraft, setPriorityDraft] = useState(search.priority);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const searchTerm = search.search;
  const mine = search.mine;
  const status = search.status;
  const priority = search.priority;
  const requestedOffset = search.offset;

  useEffect(() => {
    setStats(loader.stats);
    setReports(loader.reports);
    setLoadError(loader.loadError);
    setPending(loader.needsClientLoad);
  }, [loader]);

  useEffect(() => {
    // Do not clobber characters typed while a debounced navigation is still
    // in flight; re-sync only when the user is not actively editing.
    if (document.activeElement === searchInputRef.current) return;
    setSearchDraft(searchTerm);
  }, [searchTerm]);

  useEffect(() => {
    setStatusDraft(status);
    setPriorityDraft(priority);
  }, [status, priority]);

  // SSR fallback: load once client-side when the loader could not reach the
  // API (relative fetch on the server), and again whenever the URL changes.
  useEffect(() => {
    if (!loader.needsClientLoad) return;
    let cancelled = false;
    setPending(true);
    void (async () => {
      const result = await fetchBundle({
        search: searchTerm,
        mine,
        status,
        priority,
        offset: requestedOffset,
      });
      if (cancelled) return;
      if (result === 'unauthorized') {
        await navigate({ to: '/login' });
        return;
      }
      if (result === 'unavailable') {
        setStats(null);
        setReports(null);
        setLoadError('Tidak dapat terhubung ke server.');
      } else {
        setStats(result.stats);
        setReports(result.reports);
        setLoadError(result.loadError);
      }
      setPending(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [loader.needsClientLoad, searchTerm, mine, status, priority, requestedOffset, navigate]);

  // Debounced search: 0 or >=2 characters. One character waits so the server
  // never receives its 2-char-minimum violation.
  useEffect(() => {
    const term = searchDraft.trim();
    if (term === searchTerm || term.length === 1) return;
    const timer = setTimeout(() => {
      void navigate({
        to: '/reporter',
        search: { search: term, mine, status, priority, offset: 0 },
      });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchDraft, searchTerm, mine, status, priority, navigate]);

  // "/" focuses the search box unless the user is already typing somewhere.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) {
          return;
        }
      }
      event.preventDefault();
      searchInputRef.current?.focus();
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const items = reports?.items ?? [];
  const total = reports?.total ?? 0;
  const limit = reports?.limit ?? PAGE_SIZE;
  const offset = reports?.offset ?? requestedOffset;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const currentPage = Math.min(totalPages, Math.floor(offset / limit) + 1);
  const showingFrom = items.length === 0 ? 0 : offset + 1;
  const showingTo = offset + items.length;
  const activeFilterCount = (status === '' ? 0 : 1) + (priority === '' ? 0 : 1);

  function reload(): void {
    setPending(true);
    setLoadError(null);
    void (async () => {
      const result = await fetchBundle({ search: searchTerm, mine, status, priority, offset });
      if (result === 'unauthorized') {
        await navigate({ to: '/login' });
        return;
      }
      if (result === 'unavailable') {
        setStats(null);
        setReports(null);
        setLoadError('Tidak dapat terhubung ke server.');
      } else {
        setStats(result.stats);
        setReports(result.reports);
        setLoadError(result.loadError);
      }
      setPending(false);
    })();
  }

  function applyFilters(): void {
    setFilterOpen(false);
    void navigate({
      to: '/reporter',
      search: { search: searchTerm, mine, status: statusDraft, priority: priorityDraft, offset: 0 },
    });
  }

  function resetFilters(): void {
    setStatusDraft('');
    setPriorityDraft('');
    setFilterOpen(false);
    void navigate({
      to: '/reporter',
      search: { search: searchTerm, mine, status: '', priority: '', offset: 0 },
    });
  }

  function goToPage(page: number): void {
    const next = Math.max(1, Math.min(totalPages, page));
    void navigate({
      to: '/reporter',
      search: { search: searchTerm, mine, status, priority, offset: (next - 1) * limit },
    });
  }

  return (
    <section aria-labelledby="monitor-title">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 id="monitor-title" className="text-3xl font-bold tracking-tight text-text">
            Pemantauan Tiket
          </h1>
          <p className="mt-2 max-w-[62ch] text-sm leading-6 text-[#4b5563]">
            Pantau progres penanganan kerusakan sarana dan prasarana kampus UPI Tasikmalaya secara
            transparan dan akuntabel.
          </p>
        </div>
        <Link
          to="/reporter/reports/new"
          className={`${buttonBaseClasses} ${buttonVariantClasses.primary} shrink-0`}
        >
          <PlusIcon className="h-4 w-4" />
          Buat Laporan
        </Link>
      </div>

      <div className="mt-8 grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <KpiCard
          label="Total Laporan"
          value={stats?.total ?? 0}
          description="Semua tiket terdaftar di sistem"
          icon={<BriefcaseIcon className="h-5 w-5" />}
        />
        <KpiCard
          label="Laporan Aktif"
          value={stats?.active ?? 0}
          description="Membutuhkan perhatian teknisi"
          icon={<BellIcon className="h-5 w-5" />}
          tone="active"
        />
        <KpiCard
          label="Dalam Perbaikan"
          value={stats?.inRepair ?? 0}
          description="Pekerjaan fisik sedang berlangsung"
          icon={<WrenchIcon className="h-5 w-5" />}
        />
        <KpiCard
          label="Selesai"
          value={stats?.done ?? 0}
          description="Status terselesaikan & ditutup"
          icon={<CheckCircleIcon className="h-5 w-5" />}
        />
      </div>

      <div className="mt-6 rounded-xl border border-[#e1e5e9] bg-white p-2.5 shadow-sm">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex items-center gap-1 rounded-lg bg-[#ecf4ff] p-1">
            <Link
              to="/reporter"
              search={{ search: searchTerm, mine: false, status, priority, offset: 0 }}
              aria-current={mine ? undefined : 'page'}
              className={`inline-flex min-h-[36px] items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors ${
                mine ? 'text-[#4b5563] hover:bg-white/70' : 'bg-white text-text shadow-sm'
              }`}
            >
              Semua
              <span className="rounded-full bg-white px-1.5 text-[11px] font-semibold text-[#4b5563]">
                {(stats?.total ?? 0).toLocaleString('id-ID')}
              </span>
            </Link>
            <Link
              to="/reporter"
              search={{ search: searchTerm, mine: true, status, priority, offset: 0 }}
              aria-current={mine ? 'page' : undefined}
              className={`inline-flex min-h-[36px] items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors ${
                mine ? 'bg-white text-text shadow-sm' : 'text-[#4b5563] hover:bg-white/70'
              }`}
            >
              Laporan Saya
              <span className="rounded-full bg-[#b8e6f4] px-1.5 text-[11px] font-semibold text-[#0a3947]">
                {(stats?.mineTotal ?? 0).toLocaleString('id-ID')}
              </span>
            </Link>
          </div>

          <div className="flex flex-1 flex-col gap-2 sm:flex-row sm:items-center lg:justify-end">
            <div className="relative min-w-0 flex-1 sm:max-w-[420px]">
              <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#697784]" />
              <input
                ref={searchInputRef}
                id="monitor-search"
                type="search"
                value={searchDraft}
                onChange={(event) => setSearchDraft(event.target.value)}
                placeholder="Cari Ticket ID, nama aset, atau lokasi..."
                aria-label="Cari tiket, nama aset, atau lokasi"
                className="min-h-[44px] w-full rounded-lg border border-[#e1e5e9] bg-white pl-10 pr-12 text-sm text-text placeholder:text-[#8a949c]"
              />
              <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded border border-[#e1e5e9] bg-[#f7f9ff] px-1.5 text-[11px] text-[#697784]">
                /
              </kbd>
            </div>
            <button
              type="button"
              onClick={() => setFilterOpen((open) => !open)}
              aria-expanded={filterOpen}
              aria-controls="monitor-filter-panel"
              className={`${buttonBaseClasses} ${buttonVariantClasses.secondary} shrink-0`}
            >
              <FilterIcon className="h-4 w-4" />
              Filter
              {activeFilterCount > 0 ? (
                <span className="rounded-full bg-accent px-1.5 text-[11px] font-semibold text-white">
                  {activeFilterCount}
                </span>
              ) : null}
            </button>
          </div>
        </div>

        {searchDraft.trim().length === 1 ? (
          <p className="mt-2 px-1 text-xs text-[#697784]">Minimal 2 karakter untuk mencari.</p>
        ) : null}
        {filterOpen ? (
          <div
            id="monitor-filter-panel"
            className="mt-3 grid gap-3 rounded-lg border border-[#e1e5e9] bg-[#f7f9ff] p-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto]"
          >
            <div>
              <label
                htmlFor="monitor-status"
                className="mb-1 block text-xs font-medium text-[#4b5563]"
              >
                Status
              </label>
              <select
                id="monitor-status"
                value={statusDraft}
                onChange={(event) => setStatusDraft(event.target.value)}
                className="min-h-[44px] w-full rounded-md border border-[#e1e5e9] bg-white px-3 text-sm text-text"
              >
                <option value="">Semua status</option>
                {STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label
                htmlFor="monitor-priority"
                className="mb-1 block text-xs font-medium text-[#4b5563]"
              >
                Prioritas
              </label>
              <select
                id="monitor-priority"
                value={priorityDraft}
                onChange={(event) => setPriorityDraft(event.target.value)}
                className="min-h-[44px] w-full rounded-md border border-[#e1e5e9] bg-white px-3 text-sm text-text"
              >
                <option value="">Semua prioritas</option>
                {PRIORITY_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end gap-2">
              <Button type="button" onClick={applyFilters}>
                Terapkan
              </Button>
              <Button type="button" variant="secondary" onClick={resetFilters}>
                <CloseIcon className="h-4 w-4" />
                Reset
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      <div className="mt-6">
        {pending ? (
          <LoadingState message="Memuat laporan…" />
        ) : loadError !== null ? (
          <ErrorPanel
            message={loadError}
            retry={
              <Button type="button" variant="secondary" onClick={reload}>
                Coba lagi
              </Button>
            }
          />
        ) : items.length === 0 ? (
          <EmptyState
            title="Belum ada laporan"
            description={
              mine
                ? 'Anda belum membuat laporan, atau tidak ada laporan yang cocok dengan filter ini.'
                : 'Belum ada laporan yang cocok dengan pencarian atau filter ini.'
            }
            action={
              <Link
                to="/reporter/reports/new"
                className={`${buttonBaseClasses} ${buttonVariantClasses.primary}`}
              >
                Buat laporan
              </Link>
            }
          />
        ) : (
          <div className="overflow-hidden rounded-xl border border-[#e1e5e9] bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full min-w-0 border-collapse text-left text-xs md:min-w-[880px] md:text-sm">
                <thead>
                  <tr className="bg-[#ecf4ff]">
                    <th scope="col" className="px-5 py-3 text-xs font-semibold text-[#40484b]">
                      Ticket ID
                    </th>
                    <th scope="col" className="px-5 py-3 text-xs font-semibold text-[#40484b]">
                      Aset
                    </th>
                    <th
                      scope="col"
                      className="hidden px-5 py-3 text-xs font-semibold text-[#40484b] md:table-cell"
                    >
                      Lokasi
                    </th>
                    <th
                      scope="col"
                      className="hidden px-5 py-3 text-xs font-semibold text-[#40484b] md:table-cell"
                    >
                      Prioritas
                    </th>
                    <th scope="col" className="px-5 py-3 text-xs font-semibold text-[#40484b]">
                      Status
                    </th>
                    <th
                      scope="col"
                      className="hidden px-5 py-3 text-xs font-semibold text-[#40484b] md:table-cell"
                    >
                      Waktu Penanganan
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#e1e5e9]">
                  {items.map((row) => {
                    const finished = row.closedAt !== null || row.resolvedAt !== null;
                    return (
                      <tr key={row.id} className="align-top transition-colors hover:bg-[#f7f9ff]">
                        <td className="px-5 py-4">
                          <Link
                            to="/reporter/reports/$ticket"
                            params={{ ticket: row.ticketNumber }}
                            className="text-accent underline underline-offset-2"
                          >
                            <TicketMono className="text-sm font-semibold">
                              {row.ticketNumber}
                            </TicketMono>
                          </Link>
                          {row.isOwn ? (
                            <span className="mt-1 flex items-center gap-1 text-[11px] font-medium text-[#0a6b74]">
                              <span
                                aria-hidden="true"
                                className="h-1.5 w-1.5 rounded-full bg-[#0a6b74]"
                              />
                              Laporan Anda
                            </span>
                          ) : null}
                        </td>
                        <td className="px-5 py-4">
                          <p className="font-medium text-text">
                            {row.assetName ?? 'Aset tidak tercatat'}
                          </p>
                          {row.reporterCount !== null ? (
                            <p className="mt-1 flex items-center gap-1 text-xs text-[#697784]">
                              <UsersIcon className="h-3.5 w-3.5" />
                              {row.reporterCount} pelapor
                            </p>
                          ) : null}
                        </td>
                        <td className="hidden px-5 py-4 text-[#4b5563] md:table-cell">
                          {locationLabel(row)}
                        </td>
                        <td className="hidden px-5 py-4 md:table-cell">
                          <StatusBadge priority={row.finalPriority} />
                        </td>
                        <td className="px-5 py-4">
                          <StatusBadge status={row.status} />
                        </td>
                        <td className="hidden px-5 py-4 md:table-cell">
                          <p className="text-sm text-text">{fmt(row.reportedAt)}</p>
                          <p
                            className={`mt-1 text-xs ${
                              finished ? 'text-[#0a6b74]' : 'italic text-[#697784]'
                            }`}
                          >
                            {handledLabel(row)}
                          </p>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex flex-col gap-3 border-t border-[#e1e5e9] bg-[#ecf4ff] px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-[#40484b]">
                Menampilkan {showingFrom}–{showingTo} dari {total.toLocaleString('id-ID')} laporan
              </p>
              <nav aria-label="Navigasi halaman" className="flex flex-wrap items-center gap-1">
                <button
                  type="button"
                  onClick={() => goToPage(currentPage - 1)}
                  disabled={currentPage <= 1}
                  className="inline-flex min-h-[36px] items-center gap-1 rounded-md px-2.5 text-sm font-medium text-[#40484b] transition-colors hover:bg-white/70 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ChevronLeftIcon className="h-4 w-4" />
                  Sebelumnya
                </button>
                {pageWindow(currentPage, totalPages).map((entry) =>
                  typeof entry === 'number' ? (
                    <button
                      key={entry}
                      type="button"
                      onClick={() => goToPage(entry)}
                      aria-current={entry === currentPage ? 'page' : undefined}
                      className={`inline-flex h-9 min-w-9 items-center justify-center rounded-md px-2 text-sm font-medium transition-colors ${
                        entry === currentPage
                          ? 'bg-accent text-white'
                          : 'text-[#40484b] hover:bg-white/70'
                      }`}
                    >
                      {entry}
                    </button>
                  ) : (
                    <span key={entry} className="px-1 text-sm text-[#697784]">
                      …
                    </span>
                  ),
                )}
                <button
                  type="button"
                  onClick={() => goToPage(currentPage + 1)}
                  disabled={currentPage >= totalPages}
                  className="inline-flex min-h-[36px] items-center gap-1 rounded-md px-2.5 text-sm font-medium text-[#40484b] transition-colors hover:bg-white/70 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Berikutnya
                  <ChevronRightIcon className="h-4 w-4" />
                </button>
              </nav>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function KpiCard({
  label,
  value,
  description,
  icon,
  tone = 'default',
}: {
  readonly label: string;
  readonly value: number;
  readonly description: string;
  readonly icon: ReactNode;
  readonly tone?: 'default' | 'active';
}) {
  return (
    <article className="rounded-xl border border-[#e1e5e9] bg-white p-4 shadow-sm sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm font-medium text-[#4b5563]">{label}</p>
        <span
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
            tone === 'active' ? 'bg-[#b8e6f4] text-[#0a3947]' : 'bg-[#e4f4fb] text-accent'
          }`}
        >
          {icon}
        </span>
      </div>
      <p className="mt-4 text-2xl font-bold tracking-tight text-text sm:text-3xl">
        {value.toLocaleString('id-ID')}
      </p>
      <p className="mt-1 text-xs leading-5 text-[#697784]">{description}</p>
    </article>
  );
}
