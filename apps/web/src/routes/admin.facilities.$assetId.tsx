// Admin facility-asset detail (Phase 6 P6-5c): asset header with the derived
// status plus the full maintenance history (all tickets, newest first).
// Fetches /api/admin/assets/$id/history through the same SSR-fallback loader
// pattern as the admin report detail. History rows tick status/finalPriority
// are report enums — StatusBadge renders them with a muted fallback for
// unknown legacy labels.
import { useEffect, useState } from 'react';
import { Link, createFileRoute, redirect, useNavigate, useRouter } from '@tanstack/react-router';
import {
  Button,
  ErrorPanel,
  LoadingState,
  StatusBadge,
  TicketMono,
  buttonBaseClasses,
  buttonVariantClasses,
} from '../components/index.js';

interface MaintenanceHistoryRow {
  readonly reportId: string;
  readonly ticketNumber: string;
  readonly status: string;
  readonly reportedAt: string;
  readonly resolvedAt: string | null;
  readonly closedAt: string | null;
  readonly finalPriority: string | null;
}

interface MaintenanceHistoryData {
  readonly asset: {
    readonly assetId: string;
    readonly assetCode: string;
    readonly assetName: string;
    readonly isActive: boolean;
    readonly locationLabel: string;
    readonly categoryName: string | null;
    readonly derivedStatus: string;
  };
  readonly items: MaintenanceHistoryRow[];
}

interface FacilityDetailLoaderData {
  readonly history: MaintenanceHistoryData | null;
  readonly notFound: boolean;
  readonly forbidden: boolean;
  readonly loadError: string | null;
  readonly needsClientLoad: boolean;
}

type FacilityDetailBundle =
  | {
      readonly history: MaintenanceHistoryData | null;
      readonly notFound: boolean;
      readonly forbidden: boolean;
      readonly loadError: string | null;
    }
  | 'unauthorized'
  | 'unavailable';

const DEFAULT_FACILITY_SEARCH = { locationId: '', status: '', includeInactive: '', offset: 0 };

const FACILITY_TONES: Record<string, string> = {
  OPERATIONAL: 'bg-tint-success text-badge-success',
  UNDER_INSPECTION: 'bg-tint-info text-badge-info',
  IN_REPAIR: 'bg-tint-danger text-badge-danger',
};

const FACILITY_STATUS_LABELS: Record<string, string> = {
  OPERATIONAL: 'Operasional',
  UNDER_INSPECTION: 'Inspeksi',
  IN_REPAIR: 'Dalam perbaikan',
};

const badgeBaseClasses = 'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium';
const MUTED_TONE = 'bg-tint-muted text-badge-muted';

function FacilityStatusBadge({ status }: { readonly status: string }) {
  const tone = FACILITY_TONES[status] ?? MUTED_TONE;
  return (
    <span className={`inline-flex items-center gap-1 ${badgeBaseClasses} ${tone}`}>
      {FACILITY_STATUS_LABELS[status] ?? status}
    </span>
  );
}

async function fetchFacilityDetailBundle(assetId: string): Promise<FacilityDetailBundle> {
  const ref = encodeURIComponent(assetId);
  let historyResponse: Response;
  try {
    historyResponse = await fetch(`/api/admin/assets/${ref}/history`, { credentials: 'include' });
  } catch {
    return 'unavailable';
  }
  if (historyResponse.status === 401) {
    return 'unauthorized';
  }
  if (historyResponse.status === 403) {
    return { history: null, notFound: false, forbidden: true, loadError: null };
  }
  if (historyResponse.status === 404) {
    return { history: null, notFound: true, forbidden: false, loadError: null };
  }
  if (!historyResponse.ok) {
    return {
      history: null,
      notFound: false,
      forbidden: false,
      loadError: `Gagal memuat riwayat pemeliharaan (${historyResponse.status}).`,
    };
  }
  return {
    history: (await historyResponse.json()) as MaintenanceHistoryData,
    notFound: false,
    forbidden: false,
    loadError: null,
  };
}

export const Route = createFileRoute('/admin/facilities/$assetId')({
  loader: async ({
    params,
  }: {
    params: { assetId: string };
  }): Promise<FacilityDetailLoaderData> => {
    const bundle = await fetchFacilityDetailBundle(params.assetId);
    if (bundle === 'unauthorized') {
      throw redirect({ to: '/login' });
    }
    if (bundle === 'unavailable') {
      // SSR relative-URL fetch (or offline): the component loads client-side.
      return {
        history: null,
        notFound: false,
        forbidden: false,
        loadError: null,
        needsClientLoad: true,
      };
    }
    return { ...bundle, needsClientLoad: false };
  },
  pendingComponent: AdminFacilityDetailPending,
  component: AdminFacilityDetailPage,
});

function AdminFacilityDetailPending() {
  return (
    <section aria-labelledby="admin-facility-detail-title" className="w-full">
      <h1 id="admin-facility-detail-title" className="text-2xl font-semibold text-text">
        Detail Fasilitas
      </h1>
      <div className="mt-4">
        <LoadingState message="Memuat riwayat pemeliharaan…" />
      </div>
    </section>
  );
}

function formatDateTime(value: string | null): string {
  if (value === null || value === '') {
    return '—';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
}

function AdminFacilityDetailPage() {
  const loaderData = Route.useLoaderData() as FacilityDetailLoaderData;
  const { assetId } = Route.useParams() as { assetId: string };
  const navigate = useNavigate();
  const router = useRouter();

  const [clientBundle, setClientBundle] = useState<FacilityDetailBundle | null>(null);
  const [clientPending, setClientPending] = useState(loaderData.needsClientLoad);
  const [clientError, setClientError] = useState<string | null>(null);

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
      const bundle = await fetchFacilityDetailBundle(assetId);
      if (cancelled) {
        return;
      }
      if (bundle === 'unauthorized') {
        await navigate({ to: '/login' });
        return;
      }
      if (bundle === 'unavailable') {
        setClientError('Gagal memuat riwayat pemeliharaan. Periksa koneksi Anda lalu coba lagi.');
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

  const bundleData =
    clientBundle !== null && clientBundle !== 'unauthorized' && clientBundle !== 'unavailable'
      ? clientBundle
      : null;
  const history = bundleData?.history ?? loaderData.history;
  const notFound = bundleData?.notFound ?? loaderData.notFound;
  const forbidden = (bundleData?.forbidden ?? loaderData.forbidden) && !clientPending;
  const loadError = clientError ?? bundleData?.loadError ?? loaderData.loadError;

  return (
    <section aria-labelledby="admin-facility-detail-title" className="w-full">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 id="admin-facility-detail-title" className="text-2xl font-semibold text-text">
          Detail Fasilitas
        </h1>
        <Link
          to="/admin/facilities"
          search={{ ...DEFAULT_FACILITY_SEARCH }}
          className={`${buttonBaseClasses} ${buttonVariantClasses.secondary}`}
        >
          Status fasilitas
        </Link>
      </div>

      {clientPending ? (
        <div className="mt-4">
          <LoadingState message="Memuat riwayat pemeliharaan…" />
        </div>
      ) : null}

      {!clientPending && notFound ? (
        <p
          role="alert"
          className="mt-4 rounded-md border border-border bg-surface px-4 py-3 text-sm text-text"
        >
          Aset tidak ditemukan
        </p>
      ) : null}

      {!clientPending && !notFound && forbidden ? (
        <div className="mt-4 rounded-md border border-border bg-surface px-4 py-3">
          <h2 className="text-base font-semibold text-text">Akses ditolak</h2>
          <p className="mt-1 text-sm text-muted">Halaman ini hanya untuk admin.</p>
        </div>
      ) : null}

      {!clientPending && !notFound && !forbidden && loadError !== null ? (
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

      {!clientPending && !notFound && !forbidden && loadError === null && history !== null ? (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <h2 className="text-xl font-medium text-text">{history.asset.assetName}</h2>
            <TicketMono className="text-sm text-muted">{history.asset.assetCode}</TicketMono>
            <FacilityStatusBadge status={history.asset.derivedStatus} />
            <span
              className={`inline-flex items-center ${badgeBaseClasses} ${
                history.asset.isActive ? 'bg-tint-info text-badge-info' : MUTED_TONE
              }`}
            >
              {history.asset.isActive ? 'Aktif' : 'Nonaktif'}
            </span>
          </div>

          <div className="mt-4 rounded-md border border-border bg-surface px-4 md:px-6">
            <dl className="divide-y divide-border">
              <div className="flex flex-col gap-1 py-3 sm:flex-row sm:gap-4">
                <dt className="shrink-0 text-sm font-medium text-muted sm:w-40">Lokasi</dt>
                <dd className="text-sm text-text">{history.asset.locationLabel || '—'}</dd>
              </div>
              <div className="flex flex-col gap-1 py-3 sm:flex-row sm:gap-4">
                <dt className="shrink-0 text-sm font-medium text-muted sm:w-40">Kategori</dt>
                <dd className="text-sm text-text">{history.asset.categoryName ?? '—'}</dd>
              </div>
              <div className="flex flex-col gap-1 py-3 sm:flex-row sm:gap-4">
                <dt className="shrink-0 text-sm font-medium text-muted sm:w-40">
                  Status fasilitas
                </dt>
                <dd className="text-sm text-text">
                  <FacilityStatusBadge status={history.asset.derivedStatus} />
                </dd>
              </div>
              <div className="flex flex-col gap-1 py-3 sm:flex-row sm:gap-4">
                <dt className="shrink-0 text-sm font-medium text-muted sm:w-40">Status aset</dt>
                <dd className="text-sm text-text">
                  {history.asset.isActive ? 'Aktif' : 'Nonaktif (diarsipkan)'}
                </dd>
              </div>
            </dl>
          </div>

          <section aria-labelledby="admin-facility-history-title" className="mt-6">
            <h2 id="admin-facility-history-title" className="text-lg font-semibold text-text">
              Riwayat pemeliharaan
            </h2>
            {history.items.length === 0 ? (
              <p className="mt-2 text-sm text-muted">Belum ada laporan untuk aset ini.</p>
            ) : (
              <div className="mt-3 overflow-x-auto rounded-md border border-border bg-surface">
                <table className="w-full min-w-200 border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th scope="col" className="px-3 py-2 text-xs font-medium text-muted">
                        Tiket
                      </th>
                      <th scope="col" className="px-3 py-2 text-xs font-medium text-muted">
                        Status
                      </th>
                      <th scope="col" className="px-3 py-2 text-xs font-medium text-muted">
                        Prioritas final
                      </th>
                      <th scope="col" className="px-3 py-2 text-xs font-medium text-muted">
                        Waktu lapor
                      </th>
                      <th scope="col" className="px-3 py-2 text-xs font-medium text-muted">
                        Waktu selesai
                      </th>
                      <th scope="col" className="px-3 py-2 text-xs font-medium text-muted">
                        Waktu tutup
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {history.items.map((report) => (
                      <tr key={report.reportId}>
                        <td className="px-3 py-2">
                          <Link
                            to="/admin/reports/$ticket"
                            params={{ ticket: report.ticketNumber }}
                            className="text-accent underline underline-offset-2"
                          >
                            <TicketMono>{report.ticketNumber}</TicketMono>
                          </Link>
                        </td>
                        <td className="px-3 py-2">
                          <StatusBadge status={report.status} />
                        </td>
                        <td className="px-3 py-2">
                          <StatusBadge priority={report.finalPriority} />
                        </td>
                        <td className="px-3 py-2">
                          <TicketMono className="text-xs text-subtle">
                            <time>{formatDateTime(report.reportedAt)}</time>
                          </TicketMono>
                        </td>
                        <td className="px-3 py-2">
                          <TicketMono className="text-xs text-subtle">
                            <time>{formatDateTime(report.resolvedAt)}</time>
                          </TicketMono>
                        </td>
                        <td className="px-3 py-2">
                          <TicketMono className="text-xs text-subtle">
                            <time>{formatDateTime(report.closedAt)}</time>
                          </TicketMono>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </>
      ) : null}
    </section>
  );
}
