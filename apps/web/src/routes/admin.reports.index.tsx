// Admin "Kelola Laporan" (Figma 150:626): status tabs with live counts, a
// search + filter card, and the ticket table (asset, location, priority score,
// status, reporter count, assigned technician, reported date). Data comes from
// GET /api/admin/reports, whose admin projection returns the display labels
// plus `statusCounts`; the loader/SSR-fallback pattern matches the other admin
// surfaces. Sort defaults to the design's priority-score order.
import { useEffect, useState } from 'react';
import { Link, createFileRoute, redirect, useNavigate, useRouter } from '@tanstack/react-router';
import {
  ADMIN_SORT_OPTIONS,
  buildAdminListParams,
  pageRange,
  priorityLabel,
  toAdminListQuery,
} from '../lib/admin-reports.js';
import type { FormOptions } from '../server/reports.js';
import {
  Button,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  EmptyState,
  ErrorPanel,
  FilterIcon,
  Input,
  LoadingState,
  SearchIcon,
  Select,
  buttonBaseClasses,
  buttonVariantClasses,
} from '../components/index.js';

/** Rows per page. The design frame shows seven rows on a 48-ticket mock. */
const PAGE_SIZE = 10;

interface AdminReportRow {
  readonly id: string;
  readonly ticketNumber: string;
  readonly status: string;
  readonly finalPriority: string | null;
  readonly priorityScore: number | null;
  readonly assetName: string | null;
  readonly locationName: string | null;
  readonly technicianName: string | null;
  readonly reporterCount: number | null;
  readonly reportedAt: string;
}

interface AdminStatusCount {
  readonly status: string;
  readonly count: number;
}

interface AdminListData {
  readonly items: AdminReportRow[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
  readonly statusCounts?: ReadonlyArray<AdminStatusCount>;
}

interface AdminListSearch {
  readonly search: string;
  readonly status: string;
  readonly categoryId: string;
  readonly locationId: string;
  readonly priority: string;
  readonly reporterId: string;
  readonly from: string;
  readonly to: string;
  readonly sort: string;
  readonly offset: number;
}

interface AdminListLoaderData {
  readonly reports: AdminListData | null;
  readonly options: FormOptions | null;
  readonly loadError: string | null;
  readonly forbidden: boolean;
  readonly needsClientLoad: boolean;
}

interface AdminListBundle {
  readonly reports: AdminListData | null;
  readonly options: FormOptions | null;
  readonly loadError: string | null;
  readonly forbidden: boolean;
}

const DEFAULT_SEARCH: AdminListSearch = {
  search: '',
  status: '',
  categoryId: '',
  locationId: '',
  priority: '',
  reporterId: '',
  from: '',
  to: '',
  // Figma 150:626 "Urutan Default: Skor Prioritas Tertinggi".
  sort: 'priority_desc',
  offset: 0,
};

// The design tabs skip REPORTED (AI verification owns that queue); the held
// queue stays reachable from the filter panel link and renders as an extra
// active pill when selected.
const STATUS_TABS = [
  'VERIFIED',
  'ASSIGNED',
  'INSPECTION',
  'IN_REPAIR',
  'RESOLVED',
  'CLOSED',
] as const;

const REPORT_COLUMNS = [
  'Ticket ID',
  'Aset',
  'Lokasi',
  'Prioritas',
  'Status',
  'Jumlah Pelapor',
  'Teknisi Bertugas',
  'Tanggal Lapor',
] as const;

const TH_CLASSES = 'px-6 py-4 text-[11px] font-semibold uppercase tracking-[0.09em] text-[#5a6b7d]';

function stringParam(search: Record<string, unknown>, key: string, fallback: string): string {
  const value = search[key];
  return typeof value === 'string' ? value : fallback;
}

async function fetchAdminListBundle(
  search: AdminListSearch,
): Promise<AdminListBundle | 'unauthorized' | 'unavailable'> {
  const query = toAdminListQuery(
    buildAdminListParams({
      search: search.search,
      status: search.status,
      categoryId: search.categoryId,
      locationId: search.locationId,
      priority: search.priority,
      reporterId: search.reporterId,
      from: search.from,
      to: search.to,
      sort: search.sort,
      limit: PAGE_SIZE,
      offset: search.offset,
    }),
  );
  let reportsResponse: Response;
  let optionsResponse: Response;
  try {
    [reportsResponse, optionsResponse] = await Promise.all([
      fetch(`/api/admin/reports?${query}`, { credentials: 'include' }),
      fetch('/api/reports/form-options', { credentials: 'include' }),
    ]);
  } catch {
    return 'unavailable';
  }
  if (reportsResponse.status === 401 || optionsResponse.status === 401) {
    return 'unauthorized';
  }
  const options = optionsResponse.ok ? ((await optionsResponse.json()) as FormOptions) : null;
  if (reportsResponse.status === 403) {
    return { reports: null, options, loadError: null, forbidden: true };
  }
  if (!reportsResponse.ok) {
    return {
      reports: null,
      options,
      loadError: `Gagal memuat laporan (${reportsResponse.status}).`,
      forbidden: false,
    };
  }
  return {
    reports: (await reportsResponse.json()) as AdminListData,
    options,
    loadError: null,
    forbidden: false,
  };
}

export const Route = createFileRoute('/admin/reports/')({
  validateSearch: (search: Record<string, unknown>): AdminListSearch => ({
    search: stringParam(search, 'search', ''),
    status: stringParam(search, 'status', ''),
    categoryId: stringParam(search, 'categoryId', ''),
    locationId: stringParam(search, 'locationId', ''),
    priority: stringParam(search, 'priority', ''),
    reporterId: stringParam(search, 'reporterId', ''),
    from: stringParam(search, 'from', ''),
    to: stringParam(search, 'to', ''),
    sort: stringParam(search, 'sort', DEFAULT_SEARCH.sort),
    offset:
      typeof search['offset'] === 'number' || typeof search['offset'] === 'string'
        ? Math.max(0, Number(search['offset']) || 0)
        : 0,
  }),
  loaderDeps: ({ search }) => ({ ...search }),
  loader: async ({ deps }): Promise<AdminListLoaderData> => {
    const bundle = await fetchAdminListBundle(deps as AdminListSearch);
    if (bundle === 'unauthorized') {
      throw redirect({ to: '/login' });
    }
    if (bundle === 'unavailable') {
      // SSR relative-URL fetch (or offline): the component loads client-side.
      return {
        reports: null,
        options: null,
        loadError: null,
        forbidden: false,
        needsClientLoad: true,
      };
    }
    return { ...bundle, needsClientLoad: false };
  },
  pendingComponent: AdminReportsPending,
  component: AdminReportsPage,
});

function AdminReportsPending() {
  return (
    <section aria-labelledby="admin-reports-title" className="w-full">
      <p className="text-[13px] font-semibold text-[#202a33]">Kelola Laporan</p>
      <h1
        id="admin-reports-title"
        className="mt-1 text-[32px] font-bold tracking-tight text-[#202a33] sm:text-[36px]"
      >
        Kelola Laporan
      </h1>
      <div className="mt-6">
        <LoadingState message="Memuat laporan…" />
      </div>
    </section>
  );
}

function formatReportedDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
}

function formatScore(score: number | null): string | null {
  if (score === null || !Number.isFinite(score)) {
    return null;
  }
  return new Intl.NumberFormat('id-ID', { maximumFractionDigits: 1 }).format(score);
}

function paginationItems(current: number, totalPages: number): ReadonlyArray<number | 'ellipsis'> {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, index) => index + 1);
  }
  const pages: Array<number | 'ellipsis'> = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(totalPages - 1, current + 1);
  if (start > 2) {
    pages.push('ellipsis');
  }
  for (let page = start; page <= end; page += 1) {
    pages.push(page);
  }
  if (end < totalPages - 1) {
    pages.push('ellipsis');
  }
  pages.push(totalPages);
  return pages;
}

function hasAdvancedFilters(search: AdminListSearch): boolean {
  return (
    search.categoryId !== '' ||
    search.locationId !== '' ||
    search.priority !== '' ||
    search.reporterId !== '' ||
    search.from !== '' ||
    search.to !== ''
  );
}

const CARD_CLASSES = 'rounded-xl border border-[#e1e5e9] bg-white shadow-sm';

const FILTER_LABEL_CLASSES = 'mb-1 block text-[13px] font-medium text-[#3f4c57]';

// Status chips follow Figma 150:626: a tinted pill + solid dot + the raw
// lifecycle code, so state never relies on color alone.
const STATUS_CHIP_CLASSES: Readonly<Record<string, string>> = {
  REPORTED: 'bg-[#e8eef6] text-[#3f5f7e]',
  VERIFIED: 'bg-[#def1f2] text-[#157b7b]',
  ASSIGNED: 'bg-[#e4eef8] text-[#3a5f82]',
  INSPECTION: 'bg-[#e9f0fb] text-[#3f5f7e]',
  IN_REPAIR: 'bg-[#e3ecf7] text-[#3c5c78]',
  RESOLVED: 'bg-[#e3eff9] text-[#3d6484]',
  CLOSED: 'bg-[#e9edf1] text-[#5b6b7b]',
};

const STATUS_DOT_CLASSES: Readonly<Record<string, string>> = {
  REPORTED: 'bg-[#5d7fa2]',
  VERIFIED: 'bg-[#1aa3a3]',
  ASSIGNED: 'bg-[#4c7ca6]',
  INSPECTION: 'bg-[#5d7fa2]',
  IN_REPAIR: 'bg-[#4a6b8a]',
  RESOLVED: 'bg-[#4e86ad]',
  CLOSED: 'bg-[#7a8b9b]',
};

const PRIORITY_CHIP_CLASSES: Readonly<Record<string, string>> = {
  HIGH: 'bg-[#fde8ea] text-[#b23b43]',
  MEDIUM: 'bg-[#e7eef6] text-[#3e5d7c]',
  LOW: 'bg-[#e9edf1] text-[#5c6b7a]',
};

const CHIP_BASE_CLASSES =
  'inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[13px] font-medium whitespace-nowrap';

function StatusChip({ status }: { readonly status: string }) {
  const tone = STATUS_CHIP_CLASSES[status] ?? 'bg-[#eceff1] text-[#525d66]';
  const dot = STATUS_DOT_CLASSES[status] ?? 'bg-[#8a97a3]';
  return (
    <span className={`${CHIP_BASE_CLASSES} ${tone}`}>
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {status}
    </span>
  );
}

function PriorityChip({
  priority,
  score,
}: {
  readonly priority: string | null;
  readonly score: number | null;
}) {
  const tone =
    priority === null || priority === ''
      ? 'bg-[#eceff1] text-[#525d66]'
      : (PRIORITY_CHIP_CLASSES[priority] ?? 'bg-[#eceff1] text-[#525d66]');
  const formatted = formatScore(score);
  const label = priorityLabel(priority);
  return (
    <span className={`${CHIP_BASE_CLASSES} ${tone}`}>
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
      {formatted === null ? label : `${label} (${formatted})`}
    </span>
  );
}

interface StatusTabProps {
  readonly status: string;
  readonly label: string;
  readonly count: number | undefined;
  readonly active: boolean;
  readonly search: AdminListSearch;
}

function StatusTab({ status, label, count, active, search }: StatusTabProps) {
  return (
    <Link
      to="/admin/reports"
      search={{ ...search, status, offset: 0 }}
      aria-current={active ? 'page' : undefined}
      className={`inline-flex min-h-[40px] items-center gap-2 rounded-[10px] px-3.5 text-[14px] font-medium transition-colors ${
        active ? 'bg-accent text-white shadow-sm' : 'text-[#33414d] hover:bg-[#eef3fb]'
      }`}
    >
      {label}
      {count === undefined ? null : (
        <span
          className={`inline-flex min-h-[20px] min-w-[22px] items-center justify-center rounded-full px-1.5 text-[11px] font-semibold ${
            active ? 'bg-white/20 text-white' : 'bg-[#e6eef8] text-[#3d5a75]'
          }`}
        >
          {count}
        </span>
      )}
    </Link>
  );
}

interface PaginationProps {
  readonly current: number;
  readonly totalPages: number;
  readonly limit: number;
  readonly search: AdminListSearch;
}

function Pagination({ current, totalPages, limit, search }: PaginationProps) {
  const items = paginationItems(current, totalPages);
  return (
    <nav aria-label="Paginasi laporan" className="flex flex-wrap items-center gap-1">
      {current > 1 ? (
        <Link
          to="/admin/reports"
          search={{ ...search, offset: (current - 2) * limit }}
          className="inline-flex min-h-[36px] items-center gap-1 rounded-md px-3 text-[14px] text-[#3f4c57] hover:bg-[#eef3fb]"
        >
          <ChevronLeftIcon className="h-4 w-4" />
          Sebelumnya
        </Link>
      ) : (
        <span
          aria-disabled="true"
          className="inline-flex min-h-[36px] cursor-not-allowed items-center gap-1 rounded-md px-3 text-[14px] text-[#b3bdc8]"
        >
          <ChevronLeftIcon className="h-4 w-4" />
          Sebelumnya
        </span>
      )}

      {items.map((item, index) =>
        item === 'ellipsis' ? (
          <span key={`ellipsis-${index}`} className="px-1.5 text-[14px] text-[#8a97a3]">
            …
          </span>
        ) : (
          <Link
            key={item}
            to="/admin/reports"
            search={{ ...search, offset: (item - 1) * limit }}
            aria-current={item === current ? 'page' : undefined}
            className={`inline-flex h-9 min-h-[36px] min-w-[36px] items-center justify-center rounded-md text-[14px] font-medium transition-colors ${
              item === current ? 'bg-accent text-white' : 'text-[#3f4c57] hover:bg-[#eef3fb]'
            }`}
          >
            {item}
          </Link>
        ),
      )}

      {current < totalPages ? (
        <Link
          to="/admin/reports"
          search={{ ...search, offset: current * limit }}
          className="inline-flex min-h-[36px] items-center gap-1 rounded-md px-3 text-[14px] text-[#3f4c57] hover:bg-[#eef3fb]"
        >
          Berikutnya
          <ChevronRightIcon className="h-4 w-4" />
        </Link>
      ) : (
        <span
          aria-disabled="true"
          className="inline-flex min-h-[36px] cursor-not-allowed items-center gap-1 rounded-md px-3 text-[14px] text-[#b3bdc8]"
        >
          Berikutnya
          <ChevronRightIcon className="h-4 w-4" />
        </span>
      )}
    </nav>
  );
}

function AdminReportsPage() {
  const loaderData = Route.useLoaderData() as AdminListLoaderData;
  const search = Route.useSearch() as AdminListSearch;
  const navigate = useNavigate();
  const router = useRouter();

  const [clientBundle, setClientBundle] = useState<AdminListBundle | null>(null);
  const [clientPending, setClientPending] = useState(loaderData.needsClientLoad);
  const [clientError, setClientError] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(() => hasAdvancedFilters(search));
  const [fields, setFields] = useState<AdminListSearch>({ ...search });

  // SSR fallback: load the same bundle client-side once after hydration.
  // A fresh loader payload (search change) discards client state.
  useEffect(() => {
    setClientBundle(null);
    setClientError(null);
    if (!loaderData.needsClientLoad) {
      setClientPending(false);
      return;
    }
    let cancelled = false;
    setClientPending(true);
    async function load(): Promise<void> {
      const bundle = await fetchAdminListBundle(search);
      if (cancelled) {
        return;
      }
      if (bundle === 'unauthorized') {
        await navigate({ to: '/login' });
        return;
      }
      if (bundle === 'unavailable') {
        setClientError('Gagal memuat laporan. Periksa koneksi Anda lalu coba lagi.');
        setClientPending(false);
        return;
      }
      setClientBundle(bundle);
      setClientPending(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [loaderData]);

  // Keep the filter form in sync with the URL after apply/reset/pagination.
  useEffect(() => {
    setFields((previous) => {
      const next = { ...search };
      return shallowEqualSearch(previous, next) ? previous : { ...next };
    });
  }, [search]);

  const reports = clientBundle?.reports ?? loaderData.reports;
  const options = clientBundle?.options ?? loaderData.options;
  const loadError = clientError ?? clientBundle?.loadError ?? loaderData.loadError;
  const forbidden = (clientBundle?.forbidden ?? loaderData.forbidden) && !clientPending;

  const limit = reports?.limit ?? PAGE_SIZE;
  const offset = reports?.offset ?? search.offset;
  const total = reports?.total ?? 0;
  const range = pageRange(total, limit, offset);
  const currentPage = Math.max(1, Math.floor(offset / limit) + 1);
  const totalPages = Math.max(1, Math.ceil(total / limit));

  const statusCounts = reports?.statusCounts;
  const allCount =
    statusCounts === undefined
      ? undefined
      : statusCounts.reduce((sum, entry) => sum + entry.count, 0);
  const countFor = (status: string): number | undefined =>
    statusCounts?.find((entry) => entry.status === status)?.count;
  const extraStatus =
    search.status !== '' && !(STATUS_TABS as readonly string[]).includes(search.status)
      ? search.status
      : null;

  function setField<K extends keyof AdminListSearch>(key: K, value: AdminListSearch[K]): void {
    setFields((previous) => ({ ...previous, [key]: value }));
  }

  function navigateTo(next: Partial<AdminListSearch>): void {
    void navigate({
      to: '/admin/reports',
      search: { ...search, ...next, offset: next.offset ?? 0 },
    });
  }

  const inactiveFilterCount = [
    search.categoryId,
    search.locationId,
    search.priority,
    search.reporterId,
    search.from,
    search.to,
  ].filter((value) => value !== '').length;

  return (
    <section aria-labelledby="admin-reports-title" className="w-full">
      <p className="text-[13px] font-semibold text-[#202a33]">Kelola Laporan</p>
      <h1
        id="admin-reports-title"
        className="mt-1 text-[32px] font-bold leading-[1.15] tracking-tight text-[#202a33] sm:text-[36px]"
      >
        Kelola Laporan
      </h1>
      <p className="mt-2 max-w-[920px] text-[15px] leading-relaxed text-[#5c6b7a]">
        Pusat penemuan, penyaringan, perbandingan prioritas otomatis, dan pengelolaan tiket laporan
        fasilitas kampus.
      </p>

      <div className={`${CARD_CLASSES} mt-6 px-3 py-2.5`}>
        <div className="flex flex-wrap items-center gap-1">
          <StatusTab
            status=""
            label="Semua"
            count={allCount}
            active={search.status === ''}
            search={search}
          />
          {STATUS_TABS.map((status) => (
            <StatusTab
              key={status}
              status={status}
              label={status}
              count={countFor(status)}
              active={search.status === status}
              search={search}
            />
          ))}
          {extraStatus === null ? null : (
            <StatusTab
              status={extraStatus}
              label={extraStatus}
              count={countFor(extraStatus)}
              active
              search={search}
            />
          )}
        </div>
      </div>

      <form
        aria-label="Cari dan filter laporan"
        onSubmit={(event) => {
          event.preventDefault();
          navigateTo({ ...fields, offset: 0 });
        }}
        className={`${CARD_CLASSES} mt-5 p-4`}
      >
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative min-w-0 flex-1">
            <label htmlFor="admin-reports-search" className="sr-only">
              Cari Ticket ID, nama aset, atau lokasi
            </label>
            <SearchIcon className="pointer-events-none absolute left-5 top-1/2 h-5 w-5 -translate-y-1/2 text-[#7b8a99]" />
            <Input
              id="admin-reports-search"
              name="search"
              type="search"
              aria-describedby="admin-reports-search-hint"
              placeholder="Cari Ticket ID, nama aset, atau lokasi..."
              value={fields.search}
              onChange={(event) => setField('search', event.target.value)}
              className="min-h-[56px] rounded-lg border-transparent bg-[#f2f6fb] pl-14 pr-4 text-[15px]"
            />
          </div>
          <button
            type="button"
            aria-expanded={filtersOpen}
            aria-controls="admin-reports-filters"
            onClick={() => setFiltersOpen((open) => !open)}
            className="inline-flex min-h-[56px] items-center justify-center gap-2 rounded-lg border border-[#d7e0ea] bg-white px-5 text-[14px] font-semibold text-[#202a33] transition-colors hover:bg-[#f8fafc]"
          >
            <FilterIcon className="h-5 w-5" />
            Filter
            {inactiveFilterCount === 0 ? null : (
              <span className="inline-flex min-h-[20px] min-w-[20px] items-center justify-center rounded-full bg-accent px-1.5 text-[11px] font-semibold text-white">
                {inactiveFilterCount}
              </span>
            )}
          </button>
          <label className="flex items-center gap-1.5 text-[14px] text-[#4a5a6a] lg:ml-2">
            <span>{search.sort === DEFAULT_SEARCH.sort ? 'Urutan Default:' : 'Urutan:'}</span>
            <span className="relative inline-flex items-center">
              <select
                aria-label="Urutan laporan"
                value={search.sort}
                onChange={(event) => navigateTo({ sort: event.target.value })}
                className="min-h-[44px] cursor-pointer appearance-none rounded-md bg-transparent py-2 pl-1 pr-7 text-[14px] font-semibold text-[#202a33]"
              >
                {ADMIN_SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <ChevronDownIcon className="pointer-events-none absolute right-0 h-4 w-4 text-[#202a33]" />
            </span>
          </label>
        </div>
        <p id="admin-reports-search-hint" className="sr-only">
          Minimal 2 karakter. Tekan Enter untuk menerapkan pencarian.
        </p>

        {filtersOpen ? (
          <div id="admin-reports-filters" className="mt-4 border-t border-[#e8edf3] pt-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <label htmlFor="admin-reports-category" className={FILTER_LABEL_CLASSES}>
                  Kategori
                </label>
                <Select
                  id="admin-reports-category"
                  value={fields.categoryId}
                  onChange={(event) => setField('categoryId', event.target.value)}
                >
                  <option value="">Semua kategori</option>
                  {(options?.categories ?? []).map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <label htmlFor="admin-reports-location" className={FILTER_LABEL_CLASSES}>
                  Lokasi
                </label>
                <Select
                  id="admin-reports-location"
                  value={fields.locationId}
                  onChange={(event) => setField('locationId', event.target.value)}
                >
                  <option value="">Semua lokasi</option>
                  {(options?.locations ?? []).map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <label htmlFor="admin-reports-priority" className={FILTER_LABEL_CLASSES}>
                  Prioritas
                </label>
                <Select
                  id="admin-reports-priority"
                  value={fields.priority}
                  onChange={(event) => setField('priority', event.target.value)}
                >
                  <option value="">Semua prioritas</option>
                  <option value="LOW">Rendah</option>
                  <option value="MEDIUM">Sedang</option>
                  <option value="HIGH">Tinggi</option>
                </Select>
              </div>
              <div>
                <label htmlFor="admin-reports-from" className={FILTER_LABEL_CLASSES}>
                  Dari tanggal
                </label>
                <Input
                  id="admin-reports-from"
                  name="from"
                  type="date"
                  value={fields.from}
                  onChange={(event) => setField('from', event.target.value)}
                />
              </div>
              <div>
                <label htmlFor="admin-reports-to" className={FILTER_LABEL_CLASSES}>
                  Sampai tanggal
                </label>
                <Input
                  id="admin-reports-to"
                  name="to"
                  type="date"
                  value={fields.to}
                  onChange={(event) => setField('to', event.target.value)}
                />
              </div>
              <div>
                <label htmlFor="admin-reports-reporter" className={FILTER_LABEL_CLASSES}>
                  ID Pelapor
                </label>
                <Input
                  id="admin-reports-reporter"
                  name="reporterId"
                  type="text"
                  value={fields.reporterId}
                  onChange={(event) => setField('reporterId', event.target.value)}
                />
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <Button type="submit">Terapkan filter</Button>
              <Link
                to="/admin/reports"
                search={{ ...DEFAULT_SEARCH }}
                className={`${buttonBaseClasses} ${buttonVariantClasses.secondary}`}
              >
                Atur ulang
              </Link>
            </div>
            <p className="mt-3 text-[12px] leading-relaxed text-[#5c6b7a]">
              <Link
                to="/admin/reports"
                search={{ ...search, status: 'REPORTED', offset: 0 }}
                className="font-medium text-[#0b5c8a] underline underline-offset-2"
              >
                Buka antrian verifikasi manual (REPORTED)
              </Link>{' '}
              — tiket yang ditahan karena layanan AI tidak tersedia.
            </p>
          </div>
        ) : null}
      </form>

      {clientPending ? (
        <div className="mt-5">
          <LoadingState message="Memuat laporan…" />
        </div>
      ) : null}

      {!clientPending && forbidden ? (
        <div className={`${CARD_CLASSES} mt-5 px-6 py-5`}>
          <h2 className="text-base font-semibold text-[#202a33]">Akses ditolak</h2>
          <p className="mt-1 text-sm text-[#5c6b7a]">Halaman ini hanya untuk admin/UMPER.</p>
        </div>
      ) : null}

      {!clientPending && !forbidden && loadError !== null ? (
        <div className="mt-5">
          <ErrorPanel
            message={loadError}
            retry={
              <Button type="button" variant="secondary" onClick={() => void router.invalidate()}>
                Coba lagi
              </Button>
            }
          />
        </div>
      ) : null}

      {!clientPending && !forbidden && loadError === null && reports !== null ? (
        reports.items.length === 0 ? (
          <div className={`${CARD_CLASSES} mt-5 px-6 py-10`}>
            <EmptyState
              title="Tidak ada laporan yang cocok."
              description="Ubah pencarian atau filter lalu coba lagi."
            />
          </div>
        ) : (
          <div className={`${CARD_CLASSES} mt-5 overflow-hidden`}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[1100px] border-collapse text-left">
                <thead>
                  <tr className="bg-[#eef3fb]">
                    {REPORT_COLUMNS.map((label) => (
                      <th key={label} scope="col" className={TH_CLASSES}>
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {reports.items.map((item) => (
                    <tr
                      key={item.id}
                      className="border-t border-[#e8edf3] align-middle transition-colors hover:bg-[#fafcff]"
                    >
                      <td className="whitespace-nowrap px-6 py-4">
                        <Link
                          to="/admin/reports/$ticket"
                          params={{ ticket: item.ticketNumber }}
                          className="font-mono text-[13px] font-semibold text-[#0b5c8a] underline decoration-[#a9c8d9] underline-offset-4 hover:text-[#083f5c]"
                        >
                          #{item.ticketNumber}
                        </Link>
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-[14px] font-semibold text-[#202a33]">
                        {item.assetName ?? '—'}
                      </td>
                      <td className="px-6 py-4 text-[14px] text-[#4a5a6a]">
                        {item.locationName ?? '—'}
                      </td>
                      <td className="px-6 py-4">
                        <PriorityChip priority={item.finalPriority} score={item.priorityScore} />
                      </td>
                      <td className="px-6 py-4">
                        <StatusChip status={item.status} />
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-[14px] text-[#4a5a6a]">
                        {`${item.reporterCount ?? 1} pelapor`}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-[14px]">
                        {item.technicianName === null ? (
                          <span className="italic text-[#8a97a3]">Belum ditugaskan</span>
                        ) : (
                          <span className="text-[#202a33]">{item.technicianName}</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-[14px] text-[#4a5a6a]">
                        <time dateTime={item.reportedAt}>
                          {formatReportedDate(item.reportedAt)}
                        </time>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-col gap-3 border-t border-[#e8edf3] px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-[14px] text-[#5c6b7a]">
                Menampilkan {range.from}–{range.to} dari {total} tiket
              </p>
              <Pagination
                current={currentPage}
                totalPages={totalPages}
                limit={limit}
                search={search}
              />
            </div>
          </div>
        )
      ) : null}
    </section>
  );
}

function shallowEqualSearch(a: AdminListSearch, b: AdminListSearch): boolean {
  return (
    a.search === b.search &&
    a.status === b.status &&
    a.categoryId === b.categoryId &&
    a.locationId === b.locationId &&
    a.priority === b.priority &&
    a.reporterId === b.reporterId &&
    a.from === b.from &&
    a.to === b.to &&
    a.sort === b.sort &&
    a.offset === b.offset
  );
}
