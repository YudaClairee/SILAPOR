// "Laporan Saya" (Phase 3 P3-5): the session reporter's own reports
// (server-scoped — no other reporter's data is possible). Status filter
// chips (semua/aktif/selesai) + per-status select + prev/next pagination
// (total/limit/offset). Loading (role=status), empty, and error-with-retry
// states; rows keyed by report id. Indonesian copy, no styling framework.
import { useEffect, useState } from 'react';
import {
  Link,
  createFileRoute,
  redirect,
  useNavigate,
  useRouter,
} from '@tanstack/react-router';
import { buildMyReportsQuery, reportStatusLabel } from '../lib/report-helpers.js';
import type { FormOptions } from '../server/reports.js';

interface MyReportRow {
  readonly id: string;
  readonly ticketNumber: string;
  readonly status: string;
  readonly locationId: string;
  readonly submittedCategoryId: string;
  readonly assetId: string | null;
  readonly reportedAt: string;
}

interface ReportListData {
  readonly items: MyReportRow[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

interface ListSearch {
  readonly filter: string;
  readonly status: string;
  readonly offset: number;
}

interface ListLoaderData {
  readonly reports: ReportListData | null;
  readonly options: FormOptions | null;
  readonly loadError: string | null;
  readonly needsClientLoad: boolean;
}

interface ListBundle {
  readonly reports: ReportListData | null;
  readonly options: FormOptions | null;
  readonly loadError: string | null;
}

async function fetchListBundle(query: string): Promise<ListBundle | 'unauthorized' | 'unavailable'> {
  let reportsResponse: Response;
  let optionsResponse: Response;
  try {
    [reportsResponse, optionsResponse] = await Promise.all([
      fetch(`/api/reports?${query}`, { credentials: 'include' }),
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
  if (!reportsResponse.ok) {
    return {
      reports: null,
      options,
      loadError: `Gagal memuat laporan (${reportsResponse.status}).`,
    };
  }
  return {
    reports: (await reportsResponse.json()) as ReportListData,
    options,
    loadError: null,
  };
}

export const Route = createFileRoute('/reporter/reports/')({
  validateSearch: (search: Record<string, unknown>): ListSearch => ({
    filter: typeof search['filter'] === 'string' ? search['filter'] : 'semua',
    status: typeof search['status'] === 'string' ? search['status'] : '',
    offset:
      typeof search['offset'] === 'number' || typeof search['offset'] === 'string'
        ? Number(search['offset']) || 0
        : 0,
  }),
  loaderDeps: ({ search }) => ({ filter: search.filter, status: search.status, offset: search.offset }),
  loader: async ({ deps }): Promise<ListLoaderData> => {
    const query = buildMyReportsQuery(deps);
    const bundle = await fetchListBundle(query);
    if (bundle === 'unauthorized') {
      throw redirect({ to: '/login' });
    }
    if (bundle === 'unavailable') {
      // SSR relative-URL fetch (or offline): the component loads client-side.
      return { reports: null, options: null, loadError: null, needsClientLoad: true };
    }
    return { ...bundle, needsClientLoad: false };
  },
  pendingComponent: ReportsPending,
  component: MyReportsPage,
});

function ReportsPending() {
  return (
    <section aria-labelledby="my-reports-title">
      <h1 id="my-reports-title">Laporan Saya</h1>
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

function MyReportsPage() {
  const loaderData = Route.useLoaderData() as ListLoaderData;
  const search = Route.useSearch() as ListSearch;
  const navigate = useNavigate();
  const router = useRouter();

  const [clientBundle, setClientBundle] = useState<ListBundle | null>(null);
  const [clientPending, setClientPending] = useState(loaderData.needsClientLoad);
  const [clientError, setClientError] = useState<string | null>(null);

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
      const bundle = await fetchListBundle(buildMyReportsQuery(search));
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

  const reports = clientBundle?.reports ?? loaderData.reports;
  const options = clientBundle?.options ?? loaderData.options;
  const loadError = clientError ?? clientBundle?.loadError ?? loaderData.loadError;

  const locationNames = new Map((options?.locations ?? []).map((l) => [l.id, l.name] as const));
  const categoryNames = new Map((options?.categories ?? []).map((c) => [c.id, c.name] as const));

  const limit = reports?.limit ?? 50;
  const offset = reports?.offset ?? search.offset;
  const total = reports?.total ?? 0;
  const shownFrom = total === 0 ? 0 : offset + 1;
  const shownTo = Math.min(offset + limit, total);
  const hasPrev = offset > 0;
  const hasNext = offset + limit < total;

  return (
    <section aria-labelledby="my-reports-title">
      <h1 id="my-reports-title">Laporan Saya</h1>
      <p>
        <Link to="/reporter/reports/new">Buat laporan</Link>
      </p>

      <nav aria-label="Filter status">
        <ul>
          <li>
            <Link
              to="/reporter/reports"
              search={{ filter: 'semua', status: '', offset: 0 }}
              aria-current={search.filter === 'semua' && search.status === '' ? 'page' : undefined}
            >
              Semua
            </Link>
          </li>
          <li>
            <Link
              to="/reporter/reports"
              search={{ filter: 'aktif', status: '', offset: 0 }}
              aria-current={search.filter === 'aktif' && search.status === '' ? 'page' : undefined}
            >
              Aktif
            </Link>
          </li>
          <li>
            <Link
              to="/reporter/reports"
              search={{ filter: 'selesai', status: '', offset: 0 }}
              aria-current={
                search.filter === 'selesai' && search.status === '' ? 'page' : undefined
              }
            >
              Selesai
            </Link>
          </li>
        </ul>
        <div>
          <label htmlFor="my-reports-status">Status</label>
          <select
            id="my-reports-status"
            value={search.status}
            onChange={(event) => {
              void navigate({
                to: '/reporter/reports',
                search: { filter: search.filter, status: event.target.value, offset: 0 },
              });
            }}
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
      </nav>

      {clientPending ? <p role="status">Memuat laporan…</p> : null}

      {!clientPending && loadError !== null ? (
        <>
          <p role="alert">{loadError}</p>
          <button type="button" onClick={() => void router.invalidate()}>
            Coba lagi
          </button>
        </>
      ) : null}

      {!clientPending && loadError === null && reports !== null ? (
        reports.items.length === 0 ? (
          <>
            <h2>Belum ada laporan</h2>
            <p>Belum ada laporan yang tercatat.</p>
            <p>
              <Link to="/reporter/reports/new">Buat laporan</Link>
            </p>
          </>
        ) : (
          <>
            <ul>
              {reports.items.map((item) => (
                <li key={item.id}>
                  <Link to="/reporter/reports/$ticket" params={{ ticket: item.ticketNumber }}>
                    {item.ticketNumber}
                  </Link>{' '}
                  <span>{reportStatusLabel(item.status)}</span>{' '}
                  <span>Kategori: {categoryNames.get(item.submittedCategoryId) ?? item.submittedCategoryId}</span>{' '}
                  <span>Lokasi: {locationNames.get(item.locationId) ?? item.locationId}</span>{' '}
                  <time>{formatReportedAt(item.reportedAt)}</time>
                </li>
              ))}
            </ul>
            <p>
              Menampilkan {shownFrom}–{shownTo} dari {total}
            </p>
            <p>
              {hasPrev ? (
                <Link
                  to="/reporter/reports"
                  search={{ filter: search.filter, status: search.status, offset: offset - limit }}
                >
                  Sebelumnya
                </Link>
              ) : (
                <span>Sebelumnya</span>
              )}{' '}
              {hasNext ? (
                <Link
                  to="/reporter/reports"
                  search={{ filter: search.filter, status: search.status, offset: offset + limit }}
                >
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
