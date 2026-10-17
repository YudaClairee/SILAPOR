import { useEffect, useState } from 'react';
import {
  Link,
  createFileRoute,
  redirect,
  useNavigate,
  useRouter,
} from '@tanstack/react-router';
import {
  buildAdminListParams,
  pageRange,
  toAdminListQuery,
} from '../lib/admin-reports.js';
import type { FormOptions } from '../server/reports.js';
import {
  Button,
  EmptyState,
  ErrorPanel,
  Input,
  LoadingState,
  Select,
  StatusBadge,
  TicketMono,
  buttonBaseClasses,
  buttonVariantClasses,
} from '../components/index.js';

interface AdminReportRow {
  readonly id: string;
  readonly ticketNumber: string;
  readonly status: string;
  readonly reporterId: string;
  readonly locationId: string;
  readonly submittedCategoryId: string;
  readonly finalCategoryId: string | null;
  readonly finalPriority: string | null;
  readonly reportedAt: string;
}

interface AdminListData {
  readonly items: AdminReportRow[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
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
  sort: 'reported_desc',
  offset: 0,
};

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
      limit: 50,
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
  const options = optionsResponse.ok
    ? ((await optionsResponse.json()) as FormOptions)
    : null;
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
    sort: stringParam(search, 'sort', 'reported_desc'),
    offset:
      typeof search['offset'] === 'number' || typeof search['offset'] === 'string'
        ? Number(search['offset']) || 0
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
      <h1 id="admin-reports-title" className="text-2xl font-semibold text-text">
        Semua Laporan
      </h1>
      <div className="mt-4">
        <LoadingState message="Memuat laporan…" />
      </div>
    </section>
  );
}

function formatReportedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
}

const FILTER_LABEL_CLASSES = 'mb-1 block text-sm font-medium text-text';
const FILTER_HINT_CLASSES = 'mt-1 text-xs text-muted';

function AdminReportsPage() {
  const loaderData = Route.useLoaderData() as AdminListLoaderData;
  const search = Route.useSearch() as AdminListSearch;
  const navigate = useNavigate();
  const router = useRouter();

  const [clientBundle, setClientBundle] = useState<AdminListBundle | null>(null);
  const [clientPending, setClientPending] = useState(loaderData.needsClientLoad);
  const [clientError, setClientError] = useState<string | null>(null);

  // Filter form state (applied on "Terapkan", always resetting offset to 0).
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

  // Keep the form in sync with the URL after apply/reset/pagination.
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

  const locationNames = new Map((options?.locations ?? []).map((l) => [l.id, l.name] as const));
  const categoryNames = new Map((options?.categories ?? []).map((c) => [c.id, c.name] as const));

  const range = pageRange(reports?.total ?? 0, reports?.limit ?? 50, reports?.offset ?? 0);
  const limit = reports?.limit ?? 50;
  const offset = reports?.offset ?? search.offset;
  const total = reports?.total ?? 0;

  function setField<K extends keyof AdminListSearch>(key: K, value: AdminListSearch[K]): void {
    setFields((previous) => ({ ...previous, [key]: value }));
  }

  return (
    <section aria-labelledby="admin-reports-title" className="w-full">
      <h1 id="admin-reports-title" className="text-2xl font-semibold text-text">
        Semua Laporan
      </h1>

      <form
        aria-label="Filter laporan"
        onSubmit={(event) => {
          event.preventDefault();
          void navigate({
            to: '/admin/reports',
            search: {
              search: fields.search,
              status: fields.status,
              categoryId: fields.categoryId,
              locationId: fields.locationId,
              priority: fields.priority,
              reporterId: fields.reporterId,
              from: fields.from,
              to: fields.to,
              sort: fields.sort,
              offset: 0,
            },
          });
        }}
        className="mt-4 rounded-md border border-border bg-surface p-4"
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label htmlFor="admin-reports-search" className={FILTER_LABEL_CLASSES}>
              Cari
            </label>
            <Input
              id="admin-reports-search"
              name="search"
              type="search"
              placeholder="Nomor tiket atau deskripsi"
              value={fields.search}
              onChange={(event) => setField('search', event.target.value)}
            />
            <p className={FILTER_HINT_CLASSES}>
              Minimal 2 karakter. Kosong berarti tanpa filter pencarian.
            </p>
          </div>
          <div>
            <label htmlFor="admin-reports-status" className={FILTER_LABEL_CLASSES}>
              Status
            </label>
            <Select
              id="admin-reports-status"
              value={fields.status}
              onChange={(event) => setField('status', event.target.value)}
            >
              <option value="">Semua status</option>
              <option value="REPORTED">Dilaporkan</option>
              <option value="VERIFIED">Terverifikasi</option>
              <option value="ASSIGNED">Ditugaskan</option>
              <option value="INSPECTION">Inspeksi</option>
              <option value="IN_REPAIR">Dalam perbaikan</option>
              <option value="RESOLVED">Selesai</option>
              <option value="CLOSED">Ditutup</option>
            </Select>
            <p className={FILTER_HINT_CLASSES}>
              <Link
                to="/admin/reports"
                search={{ ...fields, status: 'REPORTED', offset: 0 }}
                className="underline"
              >
                Antrian verifikasi
              </Link>{' '}
              — tiket yang menunggu pemeriksaan manual (AI tidak tersedia).
            </p>
          </div>
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
            <label htmlFor="admin-reports-sort" className={FILTER_LABEL_CLASSES}>
              Urutkan
            </label>
            <Select
              id="admin-reports-sort"
              value={fields.sort}
              onChange={(event) => setField('sort', event.target.value)}
            >
              <option value="reported_desc">Terbaru dulu</option>
              <option value="reported_asc">Terlama dulu</option>
              <option value="ticket_asc">Nomor tiket A–Z</option>
              <option value="ticket_desc">Nomor tiket Z–A</option>
            </Select>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="submit">Terapkan</Button>
          <Link
            to="/admin/reports"
            search={{ ...DEFAULT_SEARCH }}
            className={`${buttonBaseClasses} ${buttonVariantClasses.secondary}`}
          >
            Atur ulang
          </Link>
        </div>
      </form>

      {clientPending ? (
        <div className="mt-4">
          <LoadingState message="Memuat laporan…" />
        </div>
      ) : null}

      {!clientPending && forbidden ? (
        <div className="mt-4 rounded-md border border-border bg-surface px-4 py-3">
          <h2 className="text-base font-semibold text-text">Akses ditolak</h2>
          <p className="mt-1 text-sm text-muted">Halaman ini hanya untuk admin.</p>
        </div>
      ) : null}

      {!clientPending && !forbidden && loadError !== null ? (
        <div className="mt-4">
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
          <div className="mt-4">
            <EmptyState
              title="Tidak ada laporan yang cocok."
              description="Ubah filter lalu coba lagi."
            />
          </div>
        ) : (
          <>
            <div className="mt-4 overflow-x-auto rounded-md border border-border bg-surface">
              <table className="w-full min-w-220 border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th scope="col" className="px-3 py-2 text-xs font-medium text-muted">
                      Tiket
                    </th>
                    <th scope="col" className="px-3 py-2 text-xs font-medium text-muted">
                      Status
                    </th>
                    <th scope="col" className="px-3 py-2 text-xs font-medium text-muted">
                      Prioritas
                    </th>
                    <th scope="col" className="px-3 py-2 text-xs font-medium text-muted">
                      Kategori
                    </th>
                    <th scope="col" className="px-3 py-2 text-xs font-medium text-muted">
                      Lokasi
                    </th>
                    <th scope="col" className="px-3 py-2 text-xs font-medium text-muted">
                      Pelapor
                    </th>
                    <th scope="col" className="px-3 py-2 text-xs font-medium text-muted">
                      Waktu lapor
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {reports.items.map((item) => (
                    <tr key={item.id}>
                      <td className="px-3 py-2">
                        <Link
                          to="/admin/reports/$ticket"
                          params={{ ticket: item.ticketNumber }}
                          className="text-accent underline underline-offset-2"
                        >
                          <TicketMono>{item.ticketNumber}</TicketMono>
                        </Link>
                      </td>
                      <td className="px-3 py-2">
                        <StatusBadge status={item.status} />
                      </td>
                      <td className="px-3 py-2">
                        <StatusBadge priority={item.finalPriority} />
                      </td>
                      <td className="px-3 py-2 text-muted">
                        {categoryNames.get(item.finalCategoryId ?? item.submittedCategoryId) ??
                          (item.finalCategoryId ?? item.submittedCategoryId)}
                      </td>
                      <td className="px-3 py-2 text-muted">
                        {locationNames.get(item.locationId) ?? item.locationId}
                      </td>
                      <td className="px-3 py-2 text-muted">{item.reporterId}</td>
                      <td className="px-3 py-2">
                        <TicketMono className="text-xs text-subtle">
                          <time>{formatReportedAt(item.reportedAt)}</time>
                        </TicketMono>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-sm text-muted">
              Menampilkan {range.from}–{range.to} dari {total}
            </p>
            <p className="mt-2 flex gap-2">
              {range.hasPrev ? (
                <Link
                  to="/admin/reports"
                  search={{ ...search, offset: offset - limit }}
                  className={`${buttonBaseClasses} ${buttonVariantClasses.secondary}`}
                >
                  Sebelumnya
                </Link>
              ) : (
                <span
                  aria-disabled="true"
                  className={`${buttonBaseClasses} cursor-not-allowed text-subtle opacity-50`}
                >
                  Sebelumnya
                </span>
              )}
              {range.hasNext ? (
                <Link
                  to="/admin/reports"
                  search={{ ...search, offset: offset + limit }}
                  className={`${buttonBaseClasses} ${buttonVariantClasses.secondary}`}
                >
                  Berikutnya
                </Link>
              ) : (
                <span
                  aria-disabled="true"
                  className={`${buttonBaseClasses} cursor-not-allowed text-subtle opacity-50`}
                >
                  Berikutnya
                </span>
              )}
            </p>
          </>
        )
      ) : null}
    </section>
  );
}

function shallowEqualSearch(
  a: AdminListSearch,
  b: AdminListSearch,
): boolean {
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
