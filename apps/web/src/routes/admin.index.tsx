// Admin dashboard V2 (Figma 150:191): period header, five KPI cards, the
// volume/duration trend chart, category donut, building ranking, repeated
// assets and per-technician completions — all fed by
// GET /api/admin/analytics/overview. Same SSR-fallback loader pattern as the
// other admin surfaces; the server sanitizes every number.
import { useEffect, useState, type ComponentType, type SVGProps } from 'react';
import { Link, createFileRoute, redirect, useNavigate, useRouter } from '@tanstack/react-router';
import {
  ALL_PERIODS,
  buildTrendBuckets,
  composeLocationLabel,
  defaultGranularity,
  formatHours,
  formatNumberId,
  formatPercent,
  jakartaMonthKey,
  monthOptions,
  monthRange,
  rangeLabel,
  selectedMonthKey,
  type TrendGranularity,
} from '../lib/dashboard-period.js';
import {
  Button,
  CalendarIcon,
  CategoryDonut,
  CheckCircleIcon,
  ClipboardIcon,
  ClockIcon,
  DownloadIcon,
  ErrorPanel,
  FilterIcon,
  LoadingState,
  RankedBarList,
  Select,
  TrendChart,
  WrenchIcon,
  buttonBaseClasses,
  buttonVariantClasses,
} from '../components/index.js';

interface TrendPointResponse {
  readonly date: string;
  readonly reports: number;
  readonly resolvedCount: number;
  readonly resolutionSecondsTotal: number;
}

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
  readonly byBuilding?: ReadonlyArray<{
    readonly buildingCode: string;
    readonly buildingName: string;
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
  readonly technicianCompletions?: ReadonlyArray<{
    readonly technicianId: string;
    readonly technicianName: string;
    readonly completedCount: number;
  }>;
  readonly topAssets?: ReadonlyArray<{
    readonly assetId: string;
    readonly assetName: string;
    readonly roomName: string | null;
    readonly buildingCode: string | null;
    readonly buildingName: string | null;
    readonly floorNumber: number | null;
    readonly count: number;
  }>;
  readonly trend?: ReadonlyArray<TrendPointResponse>;
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
  /** `YYYY-MM`, `all`, or `''` (defaults to the current Jakarta month). */
  readonly month: string;
}

interface DateRange {
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

const DEFAULT_SEARCH: DashboardSearch = { from: '', to: '', month: '' };

// The reports route validates a full search object, so drill-down links carry
// every default alongside the range override.
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

/** Picker value / legacy `from`+`to` → the inclusive Jakarta day window. */
function resolveRange(search: DashboardSearch): DateRange {
  if (search.month === ALL_PERIODS) {
    return { from: '', to: '' };
  }
  if (/^\d{4}-\d{2}$/.test(search.month)) {
    return monthRange(search.month);
  }
  if (search.from !== '' || search.to !== '') {
    return { from: search.from, to: search.to };
  }
  return monthRange(jakartaMonthKey());
}

async function fetchDashboardBundle(
  range: DateRange,
): Promise<DashboardBundle | 'unauthorized' | 'unavailable'> {
  const params = new URLSearchParams();
  if (range.from !== '') {
    params.set('from', range.from);
  }
  if (range.to !== '') {
    params.set('to', range.to);
  }
  const query = params.toString();
  let response: Response;
  try {
    response = await fetch(`/api/admin/analytics/overview${query === '' ? '' : `?${query}`}`, {
      credentials: 'include',
    });
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
    month: stringParam(search, 'month', ''),
  }),
  loaderDeps: ({ search }) => ({ ...search }),
  loader: async ({ deps }): Promise<DashboardLoaderData> => {
    const bundle = await fetchDashboardBundle(resolveRange(deps as DashboardSearch));
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
      <h1 id="admin-dashboard-title" className="text-[34px] font-bold text-[#202a33]">
        Dashboard
      </h1>
      <div className="mt-4">
        <LoadingState message="Memuat dashboard…" />
      </div>
    </section>
  );
}

const CARD_CLASSES = 'rounded-xl border border-[#e1e5e9] bg-white shadow-sm';
const CARD_TITLE_CLASSES = 'text-lg font-semibold text-[#202a33]';
const CARD_SUBTITLE_CLASSES = 'mt-1 text-[13px] text-[#697784]';

interface KpiCard {
  readonly key: string;
  readonly label: string;
  readonly value: string;
  readonly unit: string;
  readonly caption: string;
  readonly Icon: ComponentType<SVGProps<SVGSVGElement>>;
  /** Drill-down into the report list; omitted for the duration metric. */
  readonly search?: Record<string, string>;
}

function sumStatus(data: DashboardData, statuses: readonly string[]): number {
  return data.byStatus
    .filter((entry) => statuses.includes(entry.status))
    .reduce((total, entry) => total + entry.count, 0);
}

// The API returns at most eight categories, so the donut reconciles the
// remainder under one "Kategori lainnya" slice — its centre total must equal
// the "Total Laporan" KPI.
function categorySlices(data: DashboardData): ReadonlyArray<{
  readonly label: string;
  readonly value: number;
}> {
  const rows = data.byCategory ?? [];
  const slices = rows.map((entry) => ({
    label: entry.categoryName ?? 'Belum terklasifikasi',
    value: entry.count,
  }));
  const covered = rows.reduce((total, entry) => total + entry.count, 0);
  const remainder = Math.max(0, data.cards.totalReports - covered);
  return remainder > 0 ? [...slices, { label: 'Kategori lainnya', value: remainder }] : slices;
}

function kpiCards(data: DashboardData): readonly KpiCard[] {
  const resolved = sumStatus(data, ['RESOLVED', 'CLOSED']);
  const active = sumStatus(data, ['VERIFIED', 'ASSIGNED', 'INSPECTION']);
  return [
    {
      key: 'total',
      label: 'Total Laporan',
      value: formatNumberId(data.cards.totalReports),
      unit: 'tiket',
      caption: 'Tiket pada periode terpilih',
      Icon: ClipboardIcon,
      search: {},
    },
    {
      key: 'active',
      label: 'Laporan Aktif',
      value: formatNumberId(active),
      unit: 'tiket',
      caption: 'VERIFIED, ASSIGNED, INSPECTION',
      Icon: ClipboardIcon,
      search: {},
    },
    {
      key: 'in-repair',
      label: 'Dalam Perbaikan',
      value: formatNumberId(data.cards.inRepair),
      unit: 'tiket',
      caption: 'Tiket berstatus IN_REPAIR',
      Icon: WrenchIcon,
      search: { status: 'IN_REPAIR' },
    },
    {
      key: 'resolved',
      label: 'Selesai',
      value: formatNumberId(resolved),
      unit: 'tiket',
      caption: 'Tiket RESOLVED & CLOSED',
      Icon: CheckCircleIcon,
      search: { status: 'RESOLVED' },
    },
    {
      key: 'duration',
      label: 'Rata-rata Durasi',
      value: formatHours(data.resolutionTime.averageSeconds),
      unit: 'Jam',
      caption: 'Historis REPORTED ke RESOLVED',
      Icon: ClockIcon,
    },
  ];
}

function KpiTile({ card, range }: { readonly card: KpiCard; readonly range: DateRange }) {
  const Icon = card.Icon;
  const body = (
    <>
      <span className="flex items-start justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[#697784]">
          {card.label}
        </span>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#ecf4ff] text-accent">
          <Icon className="h-4 w-4" />
        </span>
      </span>
      <span className="mt-3 flex items-baseline gap-1.5">
        <span className="text-[32px] font-bold leading-none text-[#202a33]">{card.value}</span>
        <span className="text-xs font-medium text-[#697784]">{card.unit}</span>
      </span>
      <span className="mt-2 block text-[11px] leading-snug text-[#8a97a3]">{card.caption}</span>
    </>
  );
  const classes = `${CARD_CLASSES} flex h-full flex-col px-5 py-4`;

  if (card.search === undefined) {
    return <li className={classes}>{body}</li>;
  }
  return (
    <li>
      <Link
        to="/admin/reports"
        search={{ ...REPORT_LIST_DEFAULTS, ...card.search, from: range.from, to: range.to }}
        className={`${classes} transition-colors hover:border-[#c9d6e2]`}
      >
        {body}
      </Link>
    </li>
  );
}

function AdminDashboardPage() {
  const loaderData = Route.useLoaderData() as DashboardLoaderData;
  const search = Route.useSearch() as DashboardSearch;
  const navigate = useNavigate();
  const router = useRouter();

  const [clientBundle, setClientBundle] = useState<DashboardBundle | null>(null);
  const [clientPending, setClientPending] = useState(loaderData.needsClientLoad);
  const [clientError, setClientError] = useState<string | null>(null);

  const range = resolveRange(search);
  const [granularity, setGranularity] = useState<TrendGranularity>(() =>
    defaultGranularity(range.from, range.to),
  );

  // A new range re-derives the tab: a month groups by week, a week by day.
  useEffect(() => {
    setGranularity(defaultGranularity(range.from, range.to));
  }, [range.from, range.to]);

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
      const bundle = await fetchDashboardBundle(range);
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
    // `range` is derived from the loader deps, so the loader payload is the
    // only trigger; listing the fields keeps the dependency honest.
  }, [loaderData, range.from, range.to]);

  const data = clientBundle?.data ?? loaderData.data;
  const loadError = clientError ?? clientBundle?.loadError ?? loaderData.loadError;
  const forbidden = (clientBundle?.forbidden ?? loaderData.forbidden) && !clientPending;
  const monthValue =
    search.month !== '' ? search.month : selectedMonthKey(range.from, range.to) || ALL_PERIODS;

  return (
    <section aria-labelledby="admin-dashboard-title" className="w-full">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1
            id="admin-dashboard-title"
            className="text-[34px] font-bold leading-tight text-[#202a33]"
          >
            Dashboard
          </h1>
          <p className="mt-1 text-sm text-[#697784]">
            Ringkasan laporan kerusakan fasilitas dan evaluasi penanganan pemeliharaan kampus.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2" data-print="hide">
          <div className="relative">
            <CalendarIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#3f4c57]" />
            <label htmlFor="admin-dashboard-period" className="sr-only">
              {`Periode laporan: ${rangeLabel(range.from, range.to)}`}
            </label>
            <Select
              id="admin-dashboard-period"
              value={monthValue}
              onChange={(event) =>
                void navigate({
                  to: '/admin',
                  search: { ...DEFAULT_SEARCH, month: event.target.value },
                })
              }
              className="min-w-[230px] bg-white pl-9 text-[#202a33]"
            >
              {monthOptions().map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>
          <Link
            to="/admin/reports"
            search={{ ...REPORT_LIST_DEFAULTS, from: range.from, to: range.to }}
            className={`${buttonBaseClasses} ${buttonVariantClasses.secondary} bg-white`}
          >
            <FilterIcon className="h-4 w-4" />
            Filter Lanjutan
          </Link>
          <Button type="button" onClick={() => window.print()}>
            <DownloadIcon className="h-4 w-4" />
            Ekspor Laporan PDF
          </Button>
        </div>
      </header>

      {clientPending ? (
        <div className="mt-6">
          <LoadingState message="Memuat dashboard…" />
        </div>
      ) : null}

      {!clientPending && forbidden ? (
        <div className="mt-6 rounded-md border border-border bg-surface px-4 py-3">
          <h2 className="text-base font-semibold text-text">Akses ditolak</h2>
          <p className="mt-1 text-sm text-muted">Halaman ini hanya untuk admin.</p>
        </div>
      ) : null}

      {!clientPending && !forbidden && loadError !== null ? (
        <div className="mt-6">
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
          <ul aria-label="Kartu ringkasan" className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            {kpiCards(data).map((card) => (
              <KpiTile key={card.key} card={card} range={range} />
            ))}
          </ul>

          <div className="mt-6">
            <TrendChart
              title="Tren Laporan dan Durasi Penanganan"
              subtitle="Korelasi volume tiket masuk terhadap kecepatan penyelesaian historis"
              data={buildTrendBuckets(data.trend ?? [], granularity, range)}
              aside={<TrendAside granularity={granularity} onChange={setGranularity} />}
              emptyMessage="Belum ada laporan pada periode ini."
            />
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <CategoryDonut
              title="Kerusakan per Kategori Fasilitas"
              subtitle={`Distribusi ${formatNumberId(
                data.cards.totalReports,
              )} laporan berdasarkan disiplin penanganan teknis`}
              centerLabel="TOTAL TIKET"
              titleId="admin-dashboard-category-title"
              data={categorySlices(data)}
            />
            <RankedBarList
              title="Lokasi Rawan Gangguan"
              subtitle="Peringkat akumulasi frekuensi insiden berdasarkan area gedung kampus"
              titleId="admin-dashboard-building-title"
              showRank
              items={(data.byBuilding ?? []).slice(0, 4).map((building) => ({
                id: building.buildingCode,
                label: building.buildingName,
                value: building.count,
                valueLabel: `${formatNumberId(building.count)} tiket (${formatPercent(
                  building.count,
                  data.cards.totalReports,
                )})`,
              }))}
              emptyMessage="Belum ada laporan per gedung pada periode ini."
            />
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <AssetHotspots assets={data.topAssets ?? []} />
            <RankedBarList
              title="Perbaikan Selesai per Teknisi"
              subtitle="Jumlah tiket berstatus RESOLVED atau CLOSED dalam periode ini"
              titleId="admin-dashboard-technician-title"
              aside={
                <span className="inline-flex rounded-full bg-[#dceef3] px-3 py-1 text-xs font-medium text-[#0a3947]">
                  {`Total: ${formatNumberId(
                    sumStatus(data, ['RESOLVED', 'CLOSED']),
                  )} Perbaikan Selesai`}
                </span>
              }
              items={(data.technicianCompletions ?? [])
                .filter((item) => item.completedCount > 0)
                .slice(0, 4)
                .map((item) => ({
                  id: item.technicianId,
                  label: item.technicianName,
                  value: item.completedCount,
                  valueLabel: `${formatNumberId(item.completedCount)} selesai`,
                }))}
              emptyMessage="Belum ada perbaikan selesai pada periode ini."
            />
          </div>
        </>
      ) : null}
    </section>
  );
}

function TrendAside({
  granularity,
  onChange,
}: {
  readonly granularity: TrendGranularity;
  readonly onChange: (value: TrendGranularity) => void;
}) {
  const options: ReadonlyArray<{ value: TrendGranularity; label: string }> = [
    { value: 'day', label: 'Harian' },
    { value: 'week', label: 'Mingguan' },
    { value: 'month', label: 'Bulanan' },
  ];
  return (
    <div className="flex flex-wrap items-center gap-4">
      <ul
        aria-label="Legenda tren"
        className="flex flex-wrap items-center gap-4 text-xs text-[#3f4c57]"
      >
        <li className="flex items-center gap-2">
          <span aria-hidden="true" className="h-[3px] w-5 rounded-full bg-accent" />
          Laporan Masuk (Tiket)
        </li>
        <li className="flex items-center gap-2">
          <span aria-hidden="true" className="w-5 border-t-2 border-dashed border-[#3d6d7a]" />
          Rata-rata Durasi (Jam)
        </li>
      </ul>
      <div role="tablist" aria-label="Granularitas tren" className="flex rounded-lg bg-[#f2f6fa] p-1">
        {options.map((option) => {
          const selected = granularity === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => onChange(option.value)}
              className={`inline-flex items-center rounded-md px-3 text-xs font-medium transition-colors ${
                selected
                  ? 'bg-white text-[#202a33] shadow-sm'
                  : 'text-[#697784] hover:text-[#202a33]'
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function AssetHotspots({ assets }: { readonly assets: NonNullable<DashboardData['topAssets']> }) {
  return (
    <section aria-labelledby="admin-dashboard-assets-title" className={`${CARD_CLASSES} p-6`}>
      <h2 id="admin-dashboard-assets-title" className={CARD_TITLE_CLASSES}>
        Aset yang Sering Dilaporkan
      </h2>
      <p className={CARD_SUBTITLE_CLASSES}>Aset berulang yang sering mengalami degradasi fungsi</p>

      {assets.length === 0 ? (
        <p className="mt-6 text-sm text-[#697784]">
          Belum ada laporan berbasis aset pada periode ini.
        </p>
      ) : (
        <ul className="mt-5 space-y-3">
          {assets.map((asset) => (
            <li
              key={asset.assetId}
              className="flex items-center justify-between gap-3 rounded-lg bg-[#f4f7fb] px-4 py-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-[#202a33]">{asset.assetName}</p>
                <p className="mt-0.5 truncate text-xs text-[#697784]">{composeLocationLabel(asset)}</p>
              </div>
              <span className="shrink-0 rounded-full bg-[#e2eaf3] px-3 py-1 text-xs font-medium text-[#3f4c57]">
                {`${formatNumberId(asset.count)} Laporan`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
