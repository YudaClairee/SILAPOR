// Admin dashboard (Phase 7 T6): overview cards, priority queue, per-status
// and per-category charts, and technician workload from
// GET /api/admin/analytics/overview. Same SSR-fallback loader pattern as the
// admin reports/facilities lists; the server sanitizes metrics.
import { useEffect, useState } from 'react';
import {
  Link,
  createFileRoute,
  redirect,
  useNavigate,
  useRouter,
} from '@tanstack/react-router';
import { statusLabel } from '../lib/admin-reports.js';
import {
  BarChart,
  Button,
  EmptyState,
  ErrorPanel,
  Input,
  LoadingState,
  StatusBadge,
  TicketMono,
  buttonBaseClasses,
  buttonVariantClasses,
} from '../components/index.js';

interface DashboardData {
  readonly range: { readonly from: string | null; readonly to: string | null };
  readonly cards: {
    readonly totalReports: number;
    readonly activeReports: number;
    readonly inRepair: number;
    readonly highPriorityActive: number;
    readonly resolvedThisMonth: number;
  };
  readonly byStatus: ReadonlyArray<{ readonly status: string; readonly count: number }>;
  readonly byCategory: ReadonlyArray<{
    readonly categoryId: string | null;
    readonly categoryName: string | null;
    readonly count: number;
  }>;
  readonly byLocation: ReadonlyArray<{
    readonly locationId: string;
    readonly locationName: string;
    readonly count: number;
  }>;
  readonly resolutionTime: {
    readonly sampleSize: number;
    readonly averageSeconds: number | null;
    readonly medianSeconds: number | null;
  };
  readonly technicianWorkload: ReadonlyArray<{
    readonly technicianId: string;
    readonly technicianName: string;
    readonly activeCount: number;
  }>;
  readonly priorityQueue: ReadonlyArray<{
    readonly reportId: string;
    readonly ticketNumber: string;
    readonly status: string;
    readonly finalPriority: string | null;
    readonly reportedAt: string;
  }>;
}

interface DashboardSearch {
  readonly from: string;
  readonly to: string;
}

interface DashboardLoaderData {
  readonly data: DashboardData | null;
  readonly loadError: string | null;
  readonly forbidden: boolean;
  readonly needsClientLoad: boolean;
}

interface DashboardBundle {
  readonly data: DashboardData | null;
  readonly loadError: string | null;
  readonly forbidden: boolean;
}

const DEFAULT_SEARCH: DashboardSearch = { from: '', to: '' };

// The reports route validates a full search object, so drill-down cards
// carry every default alongside the status/priority override.
const REPORT_LIST_DEFAULTS = {
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
} as const;

function stringParam(search: Record<string, unknown>, key: string, fallback: string): string {
  const value = search[key];
  return typeof value === 'string' ? value : fallback;
}

async function fetchDashboardBundle(
  search: DashboardSearch,
): Promise<DashboardBundle | 'unauthorized' | 'unavailable'> {
  const params = new URLSearchParams();
  if (search.from !== '') {
    params.set('from', search.from);
  }
  if (search.to !== '') {
    params.set('to', search.to);
  }
  const query = params.toString();
  let response: Response;
  try {
    response = await fetch(
      `/api/admin/analytics/overview${query === '' ? '' : `?${query}`}`,
      { credentials: 'include' },
    );
  } catch {
    return 'unavailable';
  }
  if (response.status === 401) {
    return 'unauthorized';
  }
  if (response.status === 403) {
    return { data: null, loadError: null, forbidden: true };
  }
  if (!response.ok) {
    return {
      data: null,
      loadError: `Gagal memuat data dashboard (${response.status}).`,
      forbidden: false,
    };
  }
  return {
    data: (await response.json()) as DashboardData,
    loadError: null,
    forbidden: false,
  };
}

export const Route = createFileRoute('/admin/')({
  validateSearch: (search: Record<string, unknown>): DashboardSearch => ({
    from: stringParam(search, 'from', ''),
    to: stringParam(search, 'to', ''),
  }),
  loaderDeps: ({ search }) => ({ ...search }),
  loader: async ({ deps }): Promise<DashboardLoaderData> => {
    const bundle = await fetchDashboardBundle(deps as DashboardSearch);
    if (bundle === 'unauthorized') {
      throw redirect({ to: '/login' });
    }
    if (bundle === 'unavailable') {
      // SSR relative-URL fetch (or offline): the component loads client-side.
      return {
        data: null,
        loadError: null,
        forbidden: false,
        needsClientLoad: true,
      };
    }
    return { ...bundle, needsClientLoad: false };
  },
  pendingComponent: AdminDashboardPending,
  component: AdminDashboardPage,
});

function AdminDashboardPending() {
  return (
    <section aria-labelledby="admin-dashboard-title" className="w-full">
      <h1 id="admin-dashboard-title" className="text-2xl font-semibold text-text">
        Dashboard
      </h1>
      <div className="mt-4">
        <LoadingState message="Memuat dashboard…" />
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

function cardDefinitions(data: DashboardData) {
  return [
    { label: 'Total Laporan', value: data.cards.totalReports, search: {} },
    { label: 'Aktif', value: data.cards.activeReports, search: {} },
    {
      label: 'Dalam Perbaikan',
      value: data.cards.inRepair,
      search: { status: 'IN_REPAIR' },
    },
    {
      label: 'Prioritas Tinggi',
      value: data.cards.highPriorityActive,
      search: { priority: 'HIGH' },
    },
    {
      label: 'Selesai Bulan Ini',
      value: data.cards.resolvedThisMonth,
      search: { status: 'RESOLVED' },
    },
  ];
}

const FILTER_LABEL_CLASSES = 'mb-1 block text-sm font-medium text-text';
const FILTER_HINT_CLASSES = 'mt-1 text-xs text-muted';
const SECTION_TITLE_CLASSES = 'text-lg font-semibold text-text';
const TABLE_HEAD_CLASSES = 'px-3 py-2 text-xs font-medium text-muted';

function AdminDashboardPage() {
  const loaderData = Route.useLoaderData() as DashboardLoaderData;
  const search = Route.useSearch() as DashboardSearch;
  const navigate = useNavigate();
  const router = useRouter();

  const [clientBundle, setClientBundle] = useState<DashboardBundle | null>(null);
  const [clientPending, setClientPending] = useState(loaderData.needsClientLoad);
  const [clientError, setClientError] = useState<string | null>(null);

  // Range form state (applied on "Terapkan").
  const [fields, setFields] = useState<DashboardSearch>({ ...search });

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
      const bundle = await fetchDashboardBundle(search);
      if (cancelled) {
        return;
      }
      if (bundle === 'unauthorized') {
        await navigate({ to: '/login' });
        return;
      }
      if (bundle === 'unavailable') {
        setClientError('Gagal memuat data dashboard. Periksa koneksi Anda lalu coba lagi.');
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

  // Keep the form in sync with the URL after apply/reset.
  useEffect(() => {
    setFields((previous) =>
      previous.from === search.from && previous.to === search.to
        ? previous
        : { ...search },
    );
  }, [search]);

  const data = clientBundle?.data ?? loaderData.data;
  const loadError = clientError ?? clientBundle?.loadError ?? loaderData.loadError;
  const forbidden = (clientBundle?.forbidden ?? loaderData.forbidden) && !clientPending;

  return (
    <section aria-labelledby="admin-dashboard-title" className="w-full">
      <h1 id="admin-dashboard-title" className="text-2xl font-semibold text-text">
        Dashboard
      </h1>

      <form
        aria-label="Rentang tanggal dashboard"
        onSubmit={(event) => {
          event.preventDefault();
          void navigate({ to: '/admin', search: { from: fields.from, to: fields.to } });
        }}
        className="mt-4 rounded-md border border-border bg-surface p-4"
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label htmlFor="admin-dashboard-from" className={FILTER_LABEL_CLASSES}>
              Dari tanggal
            </label>
            <Input
              id="admin-dashboard-from"
              name="from"
              type="date"
              value={fields.from}
              onChange={(event) =>
                setFields((previous) => ({ ...previous, from: event.target.value }))
              }
            />
          </div>
          <div>
            <label htmlFor="admin-dashboard-to" className={FILTER_LABEL_CLASSES}>
              Sampai tanggal
            </label>
            <Input
              id="admin-dashboard-to"
              name="to"
              type="date"
              value={fields.to}
              onChange={(event) =>
                setFields((previous) => ({ ...previous, to: event.target.value }))
              }
            />
          </div>
        </div>
        <p className={FILTER_HINT_CLASSES}>
          Tanggal mengikuti hari Asia/Jakarta. Kosong berarti tanpa batas.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="submit">Terapkan</Button>
          <Link
            to="/admin"
            search={{ ...DEFAULT_SEARCH }}
            className={`${buttonBaseClasses} ${buttonVariantClasses.secondary}`}
          >
            Atur ulang
          </Link>
        </div>
      </form>

      {clientPending ? (
        <div className="mt-4">
          <LoadingState message="Memuat dashboard…" />
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

      {!clientPending && !forbidden && loadError === null && data !== null ? (
        <>
          <ul
            aria-label="Kartu ringkasan"
            className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-5"
          >
            {cardDefinitions(data).map((card) => (
              <li key={card.label}>
                <Link
                  to="/admin/reports"
                  search={{ ...REPORT_LIST_DEFAULTS, ...card.search }}
                  className="block h-full rounded-md border border-border bg-surface px-4 py-3 hover:bg-background"
                >
                  <span className="text-sm text-muted">{card.label}</span>
                  <span className="mt-1 block text-2xl font-semibold text-text">
                    {card.value}
                  </span>
                </Link>
              </li>
            ))}
          </ul>

          <section aria-labelledby="admin-dashboard-queue-title" className="mt-6">
            <h2 id="admin-dashboard-queue-title" className={SECTION_TITLE_CLASSES}>
              Antrean prioritas
            </h2>
            {data.priorityQueue.length === 0 ? (
              <div className="mt-3">
                <EmptyState
                  title="Antrean prioritas kosong."
                  description="Tidak ada tiket aktif yang menunggu penanganan."
                />
              </div>
            ) : (
              <div className="mt-3 overflow-x-auto rounded-md border border-border bg-surface">
                <table className="w-full min-w-140 border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th scope="col" className={TABLE_HEAD_CLASSES}>
                        Tiket
                      </th>
                      <th scope="col" className={TABLE_HEAD_CLASSES}>
                        Status
                      </th>
                      <th scope="col" className={TABLE_HEAD_CLASSES}>
                        Prioritas
                      </th>
                      <th scope="col" className={TABLE_HEAD_CLASSES}>
                        Waktu lapor
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {data.priorityQueue.map((item) => (
                      <tr key={item.reportId}>
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
            )}
          </section>

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <BarChart
              title="Laporan per status"
              data={data.byStatus.map((entry) => ({
                label: statusLabel(entry.status),
                value: entry.count,
              }))}
              emptyMessage="Tidak ada data status pada rentang ini."
            />
            <BarChart
              title="Laporan per kategori"
              data={data.byCategory.map((entry) => ({
                label: entry.categoryName ?? 'Belum terklasifikasi',
                value: entry.count,
              }))}
              emptyMessage="Tidak ada laporan pada rentang ini."
            />
          </div>

          <section aria-labelledby="admin-dashboard-workload-title" className="mt-6">
            <h2 id="admin-dashboard-workload-title" className={SECTION_TITLE_CLASSES}>
              Beban tugas teknisi
            </h2>
            {data.technicianWorkload.length === 0 ? (
              <div className="mt-3">
                <EmptyState
                  title="Belum ada data teknisi."
                  description="Tidak ada teknisi aktif saat ini."
                />
              </div>
            ) : (
              <ul aria-label="Beban tugas teknisi" className="mt-3 space-y-2">
                {data.technicianWorkload.map((item) => (
                  <li
                    key={item.technicianId}
                    className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface px-4 py-3 text-sm"
                  >
                    <span className="text-text">{item.technicianName}</span>
                    <span className="text-muted">{item.activeCount} tiket aktif</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : null}
    </section>
  );
}
