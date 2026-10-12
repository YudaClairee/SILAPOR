// Admin reports table (Phase 3 P3-6): every report in the system with
// search (ticket/description, min 2 chars, blank = no filter), filters
// (status, category, location, priority, reporter id, date range), sort,
// and server-side pagination (limit 50, prev/next, total count).
// Read-only rows keyed by report id; changing filters resets offset to 0.
// Loading (role=status), empty, error-with-retry, and 403-forbidden states;
// 401 redirects to /login. Indonesian copy, no styling framework.
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
  priorityLabel,
  statusLabel,
  toAdminListQuery,
} from '../lib/admin-reports.js';
import type { FormOptions } from '../server/reports.js';

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
    <section aria-labelledby="admin-reports-title">
      <h1 id="admin-reports-title">Semua Laporan</h1>
      <p role="status">Memuat laporan…</p>
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
    <section aria-labelledby="admin-reports-title">
      <h1 id="admin-reports-title">Semua Laporan</h1>

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
      >
        <div>
          <label htmlFor="admin-reports-search">Cari</label>
          <input
            id="admin-reports-search"
            name="search"
            type="search"
            placeholder="Nomor tiket atau deskripsi"
            value={fields.search}
            onChange={(event) => setField('search', event.target.value)}
          />
          <p>Minimal 2 karakter. Kosong berarti tanpa filter pencarian.</p>
        </div>
        <div>
          <label htmlFor="admin-reports-status">Status</label>
          <select
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
            <option value="REJECTED">Ditolak</option>
            <option value="DUPLICATE">Duplikat</option>
          </select>
        </div>
        <div>
          <label htmlFor="admin-reports-category">Kategori</label>
          <select
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
          </select>
        </div>
        <div>
          <label htmlFor="admin-reports-location">Lokasi</label>
          <select
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
          </select>
        </div>
        <div>
          <label htmlFor="admin-reports-priority">Prioritas</label>
          <select
            id="admin-reports-priority"
            value={fields.priority}
            onChange={(event) => setField('priority', event.target.value)}
          >
            <option value="">Semua prioritas</option>
            <option value="LOW">Rendah</option>
            <option value="MEDIUM">Sedang</option>
            <option value="HIGH">Tinggi</option>
          </select>
        </div>
        <div>
          <label htmlFor="admin-reports-reporter">ID Pelapor</label>
          <input
            id="admin-reports-reporter"
            name="reporterId"
            type="text"
            value={fields.reporterId}
            onChange={(event) => setField('reporterId', event.target.value)}
          />
        </div>
        <div>
          <label htmlFor="admin-reports-from">Dari tanggal</label>
          <input
            id="admin-reports-from"
            name="from"
            type="date"
            value={fields.from}
            onChange={(event) => setField('from', event.target.value)}
          />
        </div>
        <div>
          <label htmlFor="admin-reports-to">Sampai tanggal</label>
          <input
            id="admin-reports-to"
            name="to"
            type="date"
            value={fields.to}
            onChange={(event) => setField('to', event.target.value)}
          />
        </div>
        <div>
          <label htmlFor="admin-reports-sort">Urutkan</label>
          <select
            id="admin-reports-sort"
            value={fields.sort}
            onChange={(event) => setField('sort', event.target.value)}
          >
            <option value="reported_desc">Terbaru dulu</option>
            <option value="reported_asc">Terlama dulu</option>
            <option value="ticket_asc">Nomor tiket A–Z</option>
            <option value="ticket_desc">Nomor tiket Z–A</option>
          </select>
        </div>
        <button type="submit">Terapkan</button>{' '}
        <Link to="/admin/reports" search={{ ...DEFAULT_SEARCH }}>
          Atur ulang
        </Link>
      </form>

      {clientPending ? <p role="status">Memuat laporan…</p> : null}

      {!clientPending && forbidden ? (
        <>
          <h2>Akses ditolak</h2>
          <p>Halaman ini hanya untuk admin.</p>
        </>
      ) : null}

      {!clientPending && !forbidden && loadError !== null ? (
        <>
          <p role="alert">{loadError}</p>
          <button type="button" onClick={() => void router.invalidate()}>
            Coba lagi
          </button>
        </>
      ) : null}

      {!clientPending && !forbidden && loadError === null && reports !== null ? (
        reports.items.length === 0 ? (
          <p>Tidak ada laporan yang cocok. Ubah filter lalu coba lagi.</p>
        ) : (
          <>
            <table>
              <thead>
                <tr>
                  <th scope="col">Tiket</th>
                  <th scope="col">Status</th>
                  <th scope="col">Prioritas</th>
                  <th scope="col">Kategori</th>
                  <th scope="col">Lokasi</th>
                  <th scope="col">Pelapor</th>
                  <th scope="col">Waktu lapor</th>
                </tr>
              </thead>
              <tbody>
                {reports.items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <Link
                        to="/admin/reports/$ticket"
                        params={{ ticket: item.ticketNumber }}
                      >
                        {item.ticketNumber}
                      </Link>
                    </td>
                    <td>{statusLabel(item.status)}</td>
                    <td>{priorityLabel(item.finalPriority)}</td>
                    <td>
                      {categoryNames.get(item.finalCategoryId ?? item.submittedCategoryId) ??
                        (item.finalCategoryId ?? item.submittedCategoryId)}
                    </td>
                    <td>{locationNames.get(item.locationId) ?? item.locationId}</td>
                    <td>{item.reporterId}</td>
                    <td>
                      <time>{formatReportedAt(item.reportedAt)}</time>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p>
              Menampilkan {range.from}–{range.to} dari {total}
            </p>
            <p>
              {range.hasPrev ? (
                <Link to="/admin/reports" search={{ ...search, offset: offset - limit }}>
                  Sebelumnya
                </Link>
              ) : (
                <span>Sebelumnya</span>
              )}{' '}
              {range.hasNext ? (
                <Link to="/admin/reports" search={{ ...search, offset: offset + limit }}>
                  Berikutnya
                </Link>
              ) : (
                <span>Berikutnya</span>
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
