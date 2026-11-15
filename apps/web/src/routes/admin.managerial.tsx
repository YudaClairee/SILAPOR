import { useEffect, useState } from 'react';
import { Link, createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import type { DashboardOverviewResponse } from '../server/analytics';
import {
  Button,
  EmptyState,
  ErrorPanel,
  Input,
  LoadingState,
  RankedBarList,
  TrendChart,
} from '../components/index.js';
import { buildManagerialDashboardViewModel, type ManagerialDashboardViewModel } from '../lib/managerial-dashboard.js';

interface Search {
  readonly from: string;
  readonly to: string;
}

interface LoaderData {
  readonly data: DashboardOverviewResponse | null;
  readonly loadError: string | null;
  readonly forbidden: boolean;
  readonly needsClientLoad: boolean;
}

export type Bundle =
  | { readonly data: DashboardOverviewResponse | null; readonly loadError: string | null; readonly forbidden: boolean }
  | 'unauthorized'
  | 'unavailable';

export function queryOf(search: Search): string {
  const params = new URLSearchParams();
  if (search.from !== '') params.set('from', search.from);
  if (search.to !== '') params.set('to', search.to);
  const query = params.toString();
  return query === '' ? '' : `?${query}`;
}

export async function fetchBundle(search: Search): Promise<Bundle> {
  let response: Response;
  try {
    response = await fetch(`/api/admin/analytics/overview${queryOf(search)}`, { credentials: 'include' });
  } catch {
    return 'unavailable';
  }
  if (response.status === 401) return 'unauthorized';
  if (response.status === 403) return { data: null, loadError: null, forbidden: true };
  if (!response.ok) {
    return {
      data: null,
      loadError: `Gagal memuat dashboard manajerial (${response.status}).`,
      forbidden: false,
    };
  }
  try {
    return { data: (await response.json()) as DashboardOverviewResponse, loadError: null, forbidden: false };
  } catch {
    return { data: null, loadError: 'Respons dashboard manajerial tidak valid.', forbidden: false };
  }
}

export const Route = createFileRoute('/admin/managerial')({
  validateSearch: (search: Record<string, unknown>): Search => ({
    from: typeof search.from === 'string' ? search.from : '',
    to: typeof search.to === 'string' ? search.to : '',
  }),
  loaderDeps: ({ search }) => ({ from: search.from, to: search.to }),
  loader: async ({ deps }): Promise<LoaderData> => {
    const bundle = await fetchBundle(deps as Search);
    if (bundle === 'unauthorized') throw redirect({ to: '/login' });
    if (bundle === 'unavailable') {
      return { data: null, loadError: null, forbidden: false, needsClientLoad: true };
    }
    return { ...bundle, needsClientLoad: false };
  },
  pendingComponent: Pending,
  component: Page,
});

function Pending() {
  return (
    <section aria-labelledby="managerial-title">
      <h1 id="managerial-title" className="text-2xl font-semibold text-text">Dashboard Manajerial</h1>
      <div className="mt-4"><LoadingState message="Memuat dashboard manajerial…" /></div>
    </section>
  );
}

function MetricCard({ label, value, detail }: { readonly label: string; readonly value: string | number; readonly detail: string }) {
  return (
    <article className="rounded-xl border border-border bg-white p-5 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-text">{value}</p>
      <p className="mt-1 text-xs text-muted">{detail}</p>
    </article>
  );
}

function formatTrendLabel(date: string): string {
  const [year, month, day] = date.split('-');
  return `${day ?? ''}/${month ?? ''}/${year ?? ''}`;
}

function trendData(model: ManagerialDashboardViewModel) {
  return model.trend.map((point) => ({
    key: point.date,
    label: formatTrendLabel(point.date),
    sublabel: point.date,
    reports: point.reports,
    averageSeconds: point.resolvedCount === 0 ? null : point.resolutionSecondsTotal / point.resolvedCount,
  }));
}

export function DashboardContent({
  model,
  readOnly = false,
}: {
  readonly model: ManagerialDashboardViewModel;
  readonly readOnly?: boolean;
}) {
  return (
    <>
      <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <MetricCard label="Keluhan masuk" value={model.cards.totalReports} detail="Pada periode terpilih" />
        <MetricCard label="Keluhan aktif" value={model.cards.activeReports} detail={`${model.cards.inRepair} sedang diperbaiki`} />
        <MetricCard label="Prioritas tinggi" value={model.cards.highPriorityActive} detail="Masih aktif" />
        <MetricCard label="Selesai bulan ini" value={model.cards.resolvedThisMonth} detail="Metrik bulan berjalan" />
        <MetricCard label="Rata-rata penyelesaian" value={model.resolutionTime.average} detail={`${model.resolutionTime.sampleSize} laporan selesai`} />
        <MetricCard label="Median penyelesaian" value={model.resolutionTime.median} detail={`${model.resolutionTime.sampleSize} laporan selesai`} />
      </div>

      <div className="mt-5">
        <TrendChart title="Tren laporan harian" subtitle="Jumlah laporan dan rata-rata durasi penyelesaian" data={trendData(model)} emptyMessage="Belum ada tren pada periode ini." />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <RankedBarList
          title="Lokasi dengan keluhan terbanyak"
          subtitle="Prioritas berdasarkan jumlah laporan"
          showRank
          items={model.byLocation.map((location) => ({
            id: location.locationId,
            label: location.locationName,
            value: location.count,
            valueLabel: `${location.count} keluhan`,
          }))}
          emptyMessage="Belum ada lokasi pada periode ini."
        />
        <RankedBarList
          title="Aset paling rentan rusak"
          subtitle="Aset dengan laporan berulang"
          showRank
          items={model.topAssets.map((asset) => ({
            id: asset.assetId,
            label: asset.assetName,
            value: asset.count,
            valueLabel: `${asset.count} laporan`,
            description: asset.locationLabel,
          }))}
          emptyMessage="Belum ada aset pada periode ini."
        />
      </div>

      <section aria-labelledby="managerial-assets-title" className="mt-5 rounded-xl border border-border bg-white p-5 shadow-sm">
        <h2 id="managerial-assets-title" className="text-lg font-semibold text-text">Detail aset berisiko</h2>
        {model.topAssets.length === 0 ? (
          <p className="mt-4 text-sm text-muted">Belum ada aset pada periode ini.</p>
        ) : (
          <ul className="mt-4 divide-y divide-border">
            {model.topAssets.map((asset) => (
              <li key={asset.assetId} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                <div>
                  {readOnly ? (
                    <span className="font-medium text-text">{asset.assetName}</span>
                  ) : (
                    <Link to="/admin/facilities/$assetId" params={{ assetId: asset.assetId }} className="font-medium text-accent hover:underline">
                      {asset.assetName}
                    </Link>
                  )}
                  <p className="text-sm text-muted">{asset.locationLabel}</p>
                </div>
                <span className="text-sm font-semibold text-text">{asset.count} laporan</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="managerial-queue-title" className="mt-5 rounded-xl border border-border bg-white p-5 shadow-sm">
        <h2 id="managerial-queue-title" className="text-lg font-semibold text-text">Antrian prioritas</h2>
        <p className="mt-1 text-sm text-muted">Antrian global laporan yang perlu ditindaklanjuti.</p>
        {model.priorityQueue.length === 0 ? (
          <p className="mt-4 text-sm text-muted">Belum ada laporan prioritas.</p>
        ) : (
          <ul className="mt-4 divide-y divide-border">
            {model.priorityQueue.map((item) => (
              <li key={item.reportId} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                {readOnly ? (
                  <span className="font-medium text-text">{item.ticketNumber}</span>
                ) : (
                  <Link to="/admin/reports/$ticket" params={{ ticket: item.ticketNumber }} className="font-medium text-accent hover:underline">
                    {item.ticketNumber}
                  </Link>
                )}
                <span className="text-sm text-muted">{item.finalPriority ?? 'Belum ditentukan'} · {item.status}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function Page() {
  const loader = Route.useLoaderData() as LoaderData;
  const search = Route.useSearch() as Search;
  const navigate = useNavigate();
  const [data, setData] = useState<DashboardOverviewResponse | null>(loader.needsClientLoad ? null : loader.data);
  const [pending, setPending] = useState(loader.needsClientLoad);
  const [loadError, setLoadError] = useState(loader.loadError);
  const [forbidden, setForbidden] = useState(loader.forbidden);
  const [from, setFrom] = useState(search.from);
  const [to, setTo] = useState(search.to);

  useEffect(() => {
    setFrom(search.from);
    setTo(search.to);
  }, [search.from, search.to]);

  useEffect(() => {
    if (!loader.needsClientLoad) {
      setData(loader.data);
      setLoadError(loader.loadError);
      setForbidden(loader.forbidden);
      setPending(false);
      return;
    }
    let cancelled = false;
    void fetchBundle(search).then(async (bundle) => {
      if (cancelled) return;
      if (bundle === 'unauthorized') {
        await navigate({ to: '/login' });
      } else if (bundle === 'unavailable') {
        setLoadError('Tidak dapat terhubung ke server.');
        setPending(false);
      } else {
        setData(bundle.data);
        setLoadError(bundle.loadError);
        setForbidden(bundle.forbidden);
        setPending(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [loader, navigate, search]);

  function apply(): void {
    void navigate({ to: '/admin/managerial', search: { from, to } });
  }

  const hasReports = data !== null && data.cards.totalReports > 0;

  return (
    <section aria-labelledby="managerial-title">
      <h1 id="managerial-title" className="text-2xl font-semibold text-text">Dashboard Manajerial</h1>
      <p className="mt-1 text-sm text-muted">Ringkasan deterministik untuk menentukan lokasi dan aset yang perlu diperhatikan.</p>
      <form className="mt-4 flex flex-wrap items-end gap-3" onSubmit={(event) => { event.preventDefault(); apply(); }}>
        <div>
          <label htmlFor="managerial-from" className="mb-1 block text-sm font-medium text-text">Dari</label>
          <Input id="managerial-from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} />
        </div>
        <div>
          <label htmlFor="managerial-to" className="mb-1 block text-sm font-medium text-text">Sampai</label>
          <Input id="managerial-to" type="date" value={to} onChange={(event) => setTo(event.target.value)} />
        </div>
        <Button type="submit">Terapkan</Button>
      </form>

      {pending ? <div className="mt-5"><LoadingState message="Memuat dashboard manajerial…" /></div>
        : loadError !== null ? <div className="mt-5"><ErrorPanel message={loadError} retry={<Button type="button" variant="secondary" onClick={apply}>Coba lagi</Button>} /></div>
          : forbidden ? <div className="mt-5"><ErrorPanel title="Akses ditolak" message="Dashboard ini hanya untuk admin." /></div>
            : data === null || !hasReports ? <div className="mt-5"><EmptyState title="Belum ada data" description="Belum ada data pada rentang ini." /></div>
              : <DashboardContent model={buildManagerialDashboardViewModel(data)} />}
    </section>
  );
}
