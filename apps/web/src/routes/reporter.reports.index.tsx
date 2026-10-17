// "Tiket Kampus" (Phase 3 P3-5 + UI No. 5): every reporter sees the
// sanitized campus report list, with a "Laporan Saya" filter. Status filter
// chips (semua/laporan saya/aktif/selesai) + per-status select + prev/next
// pagination (total/limit/offset). Loading (role=status), empty, and
// error-with-retry states; rows keyed by report id. Indonesian copy.
import { useEffect, useState } from 'react';
import {
  Link,
  createFileRoute,
  redirect,
  useNavigate,
  useRouter,
} from '@tanstack/react-router';
import { buildMyReportsQuery } from '../lib/report-helpers.js';
import type { FormOptions } from '../server/reports.js';
import {
  Button,
  EmptyState,
  ErrorPanel,
  LoadingState,
  Select,
  StatusBadge,
  TicketMono,
  buttonBaseClasses,
  buttonVariantClasses,
} from '../components/index.js';

interface MyReportRow {
  readonly id: string;
  readonly ticketNumber: string;
  readonly status: string;
  readonly locationId: string;
  readonly submittedCategoryId: string;
  readonly finalCategoryId: string | null;
  readonly assetId: string | null;
  readonly reportedAt: string;
  readonly isOwn: boolean;
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
  readonly mine: boolean;
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
    mine: search['mine'] === true || search['mine'] === '1' || search['mine'] === 'true',
    offset:
      typeof search['offset'] === 'number' || typeof search['offset'] === 'string'
        ? Number(search['offset']) || 0
        : 0,
  }),
  loaderDeps: ({ search }) => ({
    filter: search.filter,
    status: search.status,
    mine: search.mine,
    offset: search.offset,
  }),
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
    <section aria-labelledby="my-reports-title" className="max-w-3xl">
      <h1 id="my-reports-title" className="text-2xl font-semibold text-text">
        Tiket Kampus
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
    <section aria-labelledby="my-reports-title" className="max-w-3xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 id="my-reports-title" className="text-2xl font-semibold text-text">
          Tiket Kampus
        </h1>
        <Link
          to="/reporter/reports/new"
          className={`${buttonBaseClasses} ${buttonVariantClasses.primary}`}
        >
          Buat laporan
        </Link>
      </div>

      <nav aria-label="Filter status" className="mt-4">
        <ul className="flex flex-wrap gap-2">
          <li>
            <Link
              to="/reporter/reports"
              search={{ filter: 'semua', status: '', mine: false, offset: 0 }}
              aria-current={
                search.filter === 'semua' && search.status === '' && !search.mine
                  ? 'page'
                  : undefined
              }
              className={`${buttonBaseClasses} ${buttonVariantClasses.secondary}`}
            >
              Semua
            </Link>
          </li>
          <li>
            <Link
              to="/reporter/reports"
              search={{ filter: 'semua', status: '', mine: true, offset: 0 }}
              aria-current={search.mine && search.status === '' ? 'page' : undefined}
              className={`${buttonBaseClasses} ${buttonVariantClasses.secondary}`}
            >
              Laporan Saya
            </Link>
          </li>
          <li>
            <Link
              to="/reporter/reports"
              search={{ filter: 'aktif', status: '', mine: false, offset: 0 }}
              aria-current={
                search.filter === 'aktif' && search.status === '' && !search.mine
                  ? 'page'
                  : undefined
              }
              className={`${buttonBaseClasses} ${buttonVariantClasses.secondary}`}
            >
              Aktif
            </Link>
          </li>
          <li>
            <Link
              to="/reporter/reports"
              search={{ filter: 'selesai', status: '', mine: false, offset: 0 }}
              aria-current={
                search.filter === 'selesai' && search.status === '' && !search.mine
                  ? 'page'
                  : undefined
              }
              className={`${buttonBaseClasses} ${buttonVariantClasses.secondary}`}
            >
              Selesai
            </Link>
          </li>
        </ul>
        <div className="mt-3 max-w-xs">
          <label htmlFor="my-reports-status" className="mb-1 block text-sm font-medium text-text">
            Status
          </label>
          <Select
            id="my-reports-status"
            value={search.status}
            onChange={(event) => {
              void navigate({
                to: '/reporter/reports',
                search: {
                  filter: search.filter,
                  status: event.target.value,
                  mine: search.mine,
                  offset: 0,
                },
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
          </Select>
        </div>
      </nav>

      {clientPending ? (
        <div className="mt-4">
          <LoadingState message="Memuat laporan…" />
        </div>
      ) : null}

      {!clientPending && loadError !== null ? (
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

      {!clientPending && loadError === null && reports !== null ? (
        reports.items.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              title="Belum ada laporan"
              description="Belum ada laporan yang tercatat."
              action={
                <Link
                  to="/reporter/reports/new"
                  className={`${buttonBaseClasses} ${buttonVariantClasses.primary}`}
                >
                  Buat laporan
                </Link>
              }
            />
          </div>
        ) : (
          <>
            <ul className="mt-4 divide-y divide-border rounded-md border border-border bg-surface px-4">
              {reports.items.map((item) => (
                <li key={item.id} className="flex flex-col gap-1 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      to="/reporter/reports/$ticket"
                      params={{ ticket: item.ticketNumber }}
                      className="text-accent underline underline-offset-2"
                    >
                      <TicketMono>{item.ticketNumber}</TicketMono>
                    </Link>
                    <StatusBadge status={item.status} />
                    {item.isOwn ? (
                      <span className="rounded-full border border-border px-2 py-0.5 text-xs text-muted">
                        Laporan Saya
                      </span>
                    ) : null}
                  </div>
                  <p className="text-sm text-muted">
                    Kategori:{' '}
                    {categoryNames.get(item.finalCategoryId ?? item.submittedCategoryId) ??
                      item.finalCategoryId ??
                      item.submittedCategoryId}
                  </p>
                  <p className="text-sm text-muted">
                    Lokasi: {locationNames.get(item.locationId) ?? item.locationId}
                  </p>
                  <TicketMono className="text-xs text-subtle">
                    <time>{formatReportedAt(item.reportedAt)}</time>
                  </TicketMono>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-sm text-muted">
              Menampilkan {shownFrom}–{shownTo} dari {total}
            </p>
            <p className="mt-2 flex gap-2">
              {hasPrev ? (
                <Link
                  to="/reporter/reports"
                  search={{
                    filter: search.filter,
                    status: search.status,
                    mine: search.mine,
                    offset: offset - limit,
                  }}
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
              {hasNext ? (
                <Link
                  to="/reporter/reports"
                  search={{
                    filter: search.filter,
                    status: search.status,
                    mine: search.mine,
                    offset: offset + limit,
                  }}
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
