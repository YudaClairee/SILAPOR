// Admin Histori Perbaikan Aset (Figma 150:1264): per-asset ticket ledger.
// Explicit asset picker (required) + Periode year filter (client-side)
// drive one /api/admin/assets/$id/history fetch behind Tampilkan.
// Header card: asset identity (no TAHUN PASANG — facility_assets has no
// install-year column). Table: TICKET ID · JENIS MASALAH · TEKNISI ·
// TANGGAL LAPOR · WAKTU SELESAI · DURASI · STATUS.
// Backend gap fixed: history now carries issueTypeName (final-preferred)
// + technicianName (active displayName, no PII). Duration derived
// client-side; "Belum selesai" while active. Status pills echo raw enum
// on Figma amber/slate tones (not the global Indonesian StatusBadge).
import { useEffect, useMemo, useState } from 'react';
import { Link, createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { handlingDuration, historyPeriodOptions, inHistoryPeriod } from '../lib/asset-history.js';
import { formatJakartaDateTime } from '../lib/ticket-detail.js';
import {
  Button,
  EmptyState,
  ErrorPanel,
  FieldError,
  LoadingState,
  TicketMono,
} from '../components/index.js';

interface AssetOption {
  readonly assetId: string;
  readonly assetCode: string;
  readonly assetName: string;
  readonly locationLabel: string;
  readonly categoryName: string | null;
  readonly isActive: boolean;
}

interface HistoryTicket {
  readonly reportId: string;
  readonly ticketNumber: string;
  readonly status: string;
  readonly reportedAt: string;
  readonly resolvedAt: string | null;
  readonly closedAt: string | null;
  readonly finalPriority: string | null;
  readonly issueTypeName?: string | null;
  readonly technicianName?: string | null;
}

interface HistoryAsset {
  readonly assetId: string;
  readonly assetCode: string;
  readonly assetName: string;
  readonly isActive: boolean;
  readonly locationLabel: string;
  readonly categoryName: string | null;
  readonly derivedStatus: string;
}

interface HistoryPayload {
  readonly asset: HistoryAsset;
  readonly items: HistoryTicket[];
}

interface HistorySearch {
  readonly assetId: string;
  readonly period: string;
}

interface HistoryLoaderData {
  readonly assets: AssetOption[] | null;
  readonly loadError: string | null;
  readonly forbidden: boolean;
  readonly needsClientLoad: boolean;
}
type AssetBundle =
  | { readonly assets: AssetOption[] | null; readonly loadError: string | null; readonly forbidden: boolean }
  | 'unauthorized'
  | 'unavailable';

type HistoryBundle =
  | { readonly payload: HistoryPayload }
  | { readonly notFound: true }
  | { readonly forbidden: true }
  | { readonly loadError: string }
  | 'unauthorized'
  | 'unavailable';

const ASSET_OPTION_LIMIT = 200;

const DERIVED_TONES: Record<string, string> = {
  OPERATIONAL: 'bg-tint-success text-badge-success',
  UNDER_INSPECTION: 'bg-tint-info text-badge-info',
  IN_REPAIR: 'bg-tint-warning text-badge-warning',
};

const DERIVED_LABELS: Record<string, string> = {
  OPERATIONAL: 'Operasional',
  UNDER_INSPECTION: 'Inspeksi',
  IN_REPAIR: 'In Repair',
};

const MUTED_TONE = 'bg-tint-muted text-badge-muted';
const pillBase = 'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold';

const TICKET_TONES: Record<string, string> = {
  IN_REPAIR: 'bg-[#fdf0d5] text-[#8a6100]',
  RESOLVED: 'bg-tint-success text-badge-success',
  CLOSED: 'bg-[#e8edf2] text-[#475569]',
};

function DerivedStatusPill({ status }: { readonly status: string }) {
  const tone = DERIVED_TONES[status] ?? MUTED_TONE;
  return (
    <span className={`${pillBase} ${tone}`}>
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
      {DERIVED_LABELS[status] ?? status}
    </span>
  );
}

function TicketStatusPill({ status }: { readonly status: string }) {
  const tone = TICKET_TONES[status] ?? MUTED_TONE;
  return <span className={`${pillBase} ${tone}`}>{status}</span>;
}

function stringParam(search: Record<string, unknown>, key: string, fallback: string): string {
  const value = search[key];
  return typeof value === 'string' ? value : fallback;
}

async function fetchAssetOptions(): Promise<AssetBundle> {
  let response: Response;
  try {
    response = await fetch(
      `/api/facilities/status?includeInactive=false&limit=${ASSET_OPTION_LIMIT}&offset=0`,
      { credentials: 'include' },
    );
  } catch {
    return 'unavailable';
  }
  if (response.status === 401) return 'unauthorized';
  if (response.status === 403) return { assets: null, loadError: null, forbidden: true };
  if (!response.ok) {
    return {
      assets: null,
      loadError: `Gagal memuat daftar aset (${response.status}).`,
      forbidden: false,
    };
  }
  try {
    const data = (await response.json()) as { readonly items?: readonly AssetOption[] };
    return {
      assets: Array.isArray(data.items) ? [...data.items] : [],
      loadError: null,
      forbidden: false,
    };
  } catch {
    return { assets: null, loadError: 'Respons daftar aset tidak valid.', forbidden: false };
  }
}

async function fetchHistory(assetId: string): Promise<HistoryBundle> {
  let response: Response;
  try {
    response = await fetch(`/api/admin/assets/${encodeURIComponent(assetId)}/history`, {
      credentials: 'include',
    });
  } catch {
    return 'unavailable';
  }
  if (response.status === 401) return 'unauthorized';
  if (response.status === 403) return { forbidden: true };
  if (response.status === 404) return { notFound: true };
  if (!response.ok) return { loadError: `Gagal memuat histori (${response.status}).` };
  try {
    const data = (await response.json()) as {
      readonly asset?: HistoryAsset;
      readonly items?: HistoryTicket[];
    };
    if (data.asset === undefined || !Array.isArray(data.items)) {
      return { loadError: 'Respons histori tidak valid.' };
    }
    return { payload: { asset: data.asset, items: data.items } };
  } catch {
    return { loadError: 'Respons histori tidak valid.' };
  }
}

export const Route = createFileRoute('/admin/facilities/history')({
  validateSearch: (search: Record<string, unknown>): HistorySearch => ({
    assetId: stringParam(search, 'assetId', ''),
    period: stringParam(search, 'period', 'all'),
  }),
  loader: async (): Promise<HistoryLoaderData> => {
    const bundle = await fetchAssetOptions();
    if (bundle === 'unauthorized') throw redirect({ to: '/login' });
    if (bundle === 'unavailable') {
      return { assets: null, loadError: null, forbidden: false, needsClientLoad: true };
    }
    return { ...bundle, needsClientLoad: false };
  },
  pendingComponent: HistoryPending,
  component: AssetHistoryPage,
});

function HistoryPending() {
  return (
    <section aria-labelledby="asset-history-title" className="w-full">
      <Breadcrumb />
      <h1 id="asset-history-title" className="mt-2 text-2xl font-semibold text-text">
        Histori Perbaikan Aset
      </h1>
      <div className="mt-4">
        <LoadingState message="Memuat histori perbaikan…" />
      </div>
    </section>
  );
}

function Breadcrumb() {
  return (
    <p className="mt-1 text-xs font-semibold tracking-[0.08em] text-muted">
      FASILITAS &amp; ASET <span aria-hidden="true" className="mx-1 text-subtle">/</span>{' '}
      <span className="text-accent">HISTORI PERBAIKAN ASET</span>
    </p>
  );
}


function AssetHistoryPage() {
  const loaderData = Route.useLoaderData() as HistoryLoaderData;
  const search = Route.useSearch() as HistorySearch;
  const navigate = useNavigate();

  const [assets, setAssets] = useState<AssetOption[] | null>(
    loaderData.needsClientLoad ? null : loaderData.assets,
  );
  const [assetsPending, setAssetsPending] = useState(loaderData.needsClientLoad);
  const [assetsError, setAssetsError] = useState<string | null>(loaderData.loadError);
  const [forbidden, setForbidden] = useState(loaderData.forbidden);

  const [draftAssetId, setDraftAssetId] = useState(search.assetId);
  const [draftPeriod, setDraftPeriod] = useState(search.period);
  const [formError, setFormError] = useState<string | null>(null);

  const [history, setHistory] = useState<HistoryPayload | null>(null);
  const [historyPending, setHistoryPending] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyNotFound, setHistoryNotFound] = useState(false);

  async function reloadAssets(): Promise<void> {
    setAssetsPending(true);
    setAssetsError(null);
    const bundle = await fetchAssetOptions();
    if (bundle === 'unauthorized') {
      await navigate({ to: '/login' });
      return;
    }
    if (bundle === 'unavailable') {
      setAssets(null);
      setAssetsError('Tidak dapat terhubung. Periksa koneksi lalu coba lagi.');
      setAssetsPending(false);
      return;
    }
    setAssets(bundle.assets);
    setAssetsError(bundle.loadError);
    setForbidden(bundle.forbidden);
    setAssetsPending(false);
  }

  useEffect(() => {
    if (!loaderData.needsClientLoad) return;
    let cancelled = false;
    void (async () => {
      if (cancelled) return;
      await reloadAssets();
    })();
    return () => {
      cancelled = true;
    };
  }, [loaderData.needsClientLoad]);

  useEffect(() => {
    if (search.assetId === '') {
      setHistory(null);
      setHistoryError(null);
      setHistoryNotFound(false);
      setHistoryPending(false);
      return;
    }
    let cancelled = false;
    setHistoryPending(true);
    setHistoryError(null);
    setHistoryNotFound(false);
    void (async () => {
      const bundle = await fetchHistory(search.assetId);
      if (cancelled) return;
      if (bundle === 'unauthorized') {
        await navigate({ to: '/login' });
        return;
      }
      if (bundle === 'unavailable') {
        setHistory(null);
        setHistoryError('Tidak dapat terhubung. Periksa koneksi lalu coba lagi.');
        setHistoryPending(false);
        return;
      }
      if ('forbidden' in bundle) {
        setHistory(null);
        setForbidden(true);
        setHistoryPending(false);
        return;
      }
      if ('notFound' in bundle) {
        setHistory(null);
        setHistoryNotFound(true);
        setHistoryPending(false);
        return;
      }
      if ('loadError' in bundle) {
        setHistory(null);
        setHistoryError(bundle.loadError);
        setHistoryPending(false);
        return;
      }
      setHistory(bundle.payload);
      setHistoryPending(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [search.assetId, navigate]);


  const periodOptions = useMemo(
    () => historyPeriodOptions((history?.items ?? []).map((item) => item.reportedAt)),
    [history],
  );
  const appliedLabel =
    periodOptions.find((option) => option.value === search.period)?.label ?? 'Semua Waktu';
  const visible = useMemo(
    () => (history?.items ?? []).filter((item) => inHistoryPeriod(item.reportedAt, search.period)),
    [history, search.period],
  );
  const dirty = draftAssetId !== search.assetId || draftPeriod !== search.period;

  function handleSubmit(event: React.FormEvent): void {
    event.preventDefault();
    if (draftAssetId === '') {
      setFormError('Pilih aset terlebih dahulu.');
      return;
    }
    setFormError(null);
    void navigate({
      to: '/admin/facilities/history',
      search: { assetId: draftAssetId, period: draftPeriod },
    });
  }

  const assetErrorId = 'asset-history-asset-error';

  return (
    <section aria-labelledby="asset-history-title" className="w-full">
      <Breadcrumb />
      <h1 id="asset-history-title" className="mt-2 text-2xl font-semibold text-text">
        Histori Perbaikan Aset
      </h1>
      <p className="mt-1 text-sm text-muted">
        Telusuri riwayat tiket perbaikan dan durasi penanganan berdasarkan unit aset.
      </p>

      <form
        onSubmit={handleSubmit}
        className="mt-6 rounded-2xl border border-border bg-surface p-4 shadow-sm md:p-5"
      >
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_240px_auto] lg:items-end">
          <div>
            <label htmlFor="asset-history-asset" className="mb-1.5 block text-sm font-semibold text-text">
              Pilih aset <span aria-hidden="true" className="text-danger">*</span>
            </label>
            <div className="relative">
              <span aria-hidden="true" className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-subtle">
                <SearchGlyph />
              </span>
              <select
                id="asset-history-asset"
                value={draftAssetId}
                onChange={(event) => {
                  setDraftAssetId(event.target.value);
                  if (event.target.value !== '') setFormError(null);
                }}
                disabled={assetsPending || assets === null}
                aria-describedby={formError !== null ? assetErrorId : undefined}
                aria-invalid={formError !== null || undefined}
                className="min-h-[44px] w-full appearance-none rounded-lg border border-border bg-[#eef4ff] py-2 pr-9 pl-9 text-sm text-text disabled:cursor-not-allowed disabled:opacity-60"
              >
                <option value="">Pilih aset…</option>
                {(assets ?? []).map((asset) => (
                  <option key={asset.assetId} value={asset.assetId}>
                    {`${asset.assetCode} — ${asset.assetName} (${asset.locationLabel || 'Lokasi belum diisi'})`}
                  </option>
                ))}
              </select>
              <span aria-hidden="true" className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-subtle">
                <ChevronGlyph />
              </span>
            </div>
            {formError !== null ? <FieldError id={assetErrorId} message={formError} /> : null}
          </div>
          <PeriodField
            value={draftPeriod}
            options={history === null ? [{ value: 'all', label: 'Semua Waktu' }] : periodOptions}
            onChange={setDraftPeriod}
          />
          <div>
            <Button type="submit" disabled={assetsPending || !dirty}>
              <span aria-hidden="true" className="inline-flex">
                <SearchGlyph />
              </span>
              Tampilkan
            </Button>
          </div>
        </div>
      </form>


      {assetsPending ? (
        <div className="mt-4">
          <LoadingState message="Memuat daftar aset…" />
        </div>
      ) : assetsError !== null ? (
        <div className="mt-4">
          <ErrorPanel
            message={assetsError}
            retry={
              <Button type="button" variant="secondary" onClick={() => void reloadAssets()}>
                Coba lagi
              </Button>
            }
          />
        </div>
      ) : forbidden ? (
        <div className="mt-4">
          <ErrorPanel title="Akses ditolak" message="Halaman ini hanya untuk admin." />
        </div>
      ) : search.assetId === '' ? (
        <div className="mt-4">
          <EmptyState
            title="Pilih aset untuk melihat histori"
            description="Pilih unit aset pada formulir di atas lalu tekan Tampilkan untuk memuat riwayat tiket perbaikannya."
          />
        </div>
      ) : historyPending ? (
        <div className="mt-4">
          <LoadingState message="Memuat histori perbaikan…" />
        </div>
      ) : historyError !== null ? (
        <div className="mt-4">
          <ErrorPanel message={historyError} />
        </div>
      ) : historyNotFound ? (
        <div className="mt-4">
          <ErrorPanel title="Aset tidak ditemukan" message="Aset yang dipilih tidak ada atau sudah dihapus." />
        </div>
      ) : history !== null ? (
        <>
          <SummaryCard asset={history.asset} periodLabel={appliedLabel} count={visible.length} />
          <TicketTable tickets={visible} total={history.items.length} />
        </>
      ) : null}
    </section>
  );
}

function PeriodField({
  value,
  options,
  onChange,
}: {
  readonly value: string;
  readonly options: readonly { readonly value: string; readonly label: string }[];
  readonly onChange: (value: string) => void;
}) {
  return (
    <div>
      <label htmlFor="asset-history-period" className="mb-1.5 block text-sm font-semibold text-text">
        Periode
      </label>
      <div className="relative">
        <select
          id="asset-history-period"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="min-h-[44px] w-full appearance-none rounded-lg border border-border bg-[#eef4ff] px-3 py-2 pr-9 text-sm text-text"
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <span aria-hidden="true" className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-subtle">
          <ChevronGlyph />
        </span>
      </div>
    </div>
  );
}


function SummaryCard({
  asset,
  periodLabel,
  count,
}: {
  readonly asset: HistoryAsset;
  readonly periodLabel: string;
  readonly count: number;
}) {
  return (
    <section
      aria-labelledby="asset-history-summary-title"
      className="mt-4 grid grid-cols-2 gap-4 rounded-2xl border border-border bg-surface p-4 shadow-sm md:grid-cols-6 md:p-5"
    >
      <h2 id="asset-history-summary-title" className="sr-only">
        Ringkasan aset
      </h2>
      <div className="col-span-2">
        <p className="text-xs font-semibold tracking-wide text-muted uppercase">ID &amp; Nama Aset</p>
        <div className="mt-1 text-sm">
          <TicketMono className="font-semibold text-accent">{asset.assetCode}</TicketMono>{' '}
          <span aria-hidden="true" className="mx-1 text-subtle">•</span>{' '}
          <span className="font-medium text-text">{asset.assetName}</span>
        </div>
      </div>
      <div>
        <p className="text-xs font-semibold tracking-wide text-muted uppercase">Kategori Fasilitas</p>
        <p className="mt-1 text-sm text-text">{asset.categoryName ?? '—'}</p>
      </div>
      <div>
        <p className="text-xs font-semibold tracking-wide text-muted uppercase">Lokasi</p>
        <p className="mt-1 text-sm text-text">{asset.locationLabel || '—'}</p>
      </div>
      <div>
        <p className="text-xs font-semibold tracking-wide text-muted uppercase">Periode</p>
        <p className="mt-1 text-sm text-text">{periodLabel}</p>
      </div>
      <div>
        <p className="text-xs font-semibold tracking-wide text-muted uppercase">Status Terkini</p>
        <div className="mt-1">
          <DerivedStatusPill status={asset.derivedStatus} />
        </div>
      </div>
      <div className="md:text-right">
        <p className="text-xs font-semibold tracking-wide text-muted uppercase md:text-right">Perbaikan</p>
        <p className="mt-1 text-sm font-semibold text-text">{`${count} Tiket`}</p>
      </div>
    </section>
  );
}


function TicketTable({
  tickets,
  total,
}: {
  readonly tickets: readonly HistoryTicket[];
  readonly total: number;
}) {
  return (
    <section
      aria-labelledby="asset-history-table-title"
      className="mt-4 overflow-hidden rounded-2xl border border-border bg-surface shadow-sm"
    >
      <div className="p-4 md:p-5">
        <h2 id="asset-history-table-title" className="flex flex-wrap items-center gap-2 text-lg font-semibold text-text">
          Daftar Tiket Penanganan Kerusakan{' '}
          <span className="rounded-full bg-[#e8eefb] px-2.5 py-1 text-xs font-medium text-muted">
            {`Menampilkan ${tickets.length} dari ${total} tiket`}
          </span>
        </h2>
        <p className="mt-1 text-sm text-muted">
          Histori menampilkan catatan penanganan yang tersimpan di sistem.
        </p>
      </div>
      {tickets.length === 0 ? (
        <div className="px-4 pb-5 md:px-5">
          <EmptyState
            title="Tidak ada tiket pada periode ini"
            description="Coba pilih periode lain atau aset yang berbeda."
          />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-240 border-collapse text-left text-sm">
            <thead>
              <tr className="bg-[#eef4ff]">
                <th scope="col" className="px-4 py-3 text-xs font-semibold tracking-wide text-muted">TICKET ID</th>
                <th scope="col" className="px-4 py-3 text-xs font-semibold tracking-wide text-muted">JENIS MASALAH</th>
                <th scope="col" className="px-4 py-3 text-xs font-semibold tracking-wide text-muted">TEKNISI</th>
                <th scope="col" className="px-4 py-3 text-xs font-semibold tracking-wide text-muted">TANGGAL LAPOR</th>
                <th scope="col" className="px-4 py-3 text-xs font-semibold tracking-wide text-muted">WAKTU SELESAI</th>
                <th scope="col" className="px-4 py-3 text-xs font-semibold tracking-wide text-muted">DURASI PENANGANAN</th>
                <th scope="col" className="px-4 py-3 text-xs font-semibold tracking-wide text-muted">STATUS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {tickets.map((ticket) => (
                <TicketRow key={ticket.reportId} ticket={ticket} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function TicketRow({ ticket }: { readonly ticket: HistoryTicket }) {
  const endedAt = ticket.resolvedAt ?? ticket.closedAt;
  const duration = handlingDuration(ticket.reportedAt, endedAt);
  return (
    <tr>
      <td className="px-4 py-3">
        <Link
          to="/admin/reports/$ticket"
          params={{ ticket: ticket.ticketNumber }}
          className="text-accent underline underline-offset-2"
        >
          <TicketMono className="font-semibold">#{ticket.ticketNumber}</TicketMono>
        </Link>
      </td>
      <td className="max-w-60 px-4 py-3 text-text">{ticket.issueTypeName ?? '—'}</td>
      <td className="px-4 py-3 text-text">{ticket.technicianName ?? '—'}</td>
      <td className="whitespace-nowrap px-4 py-3 text-text">{formatJakartaDateTime(ticket.reportedAt)}</td>
      <td className="whitespace-nowrap px-4 py-3 text-text">
        {endedAt === null ? (
          <span className="italic text-muted">Belum selesai</span>
        ) : (
          formatJakartaDateTime(endedAt)
        )}
      </td>
      <td className="whitespace-nowrap px-4 py-3 text-text">
        {duration === null ? (
          <span className="italic text-muted">Belum selesai</span>
        ) : (
          <span className="font-medium">{duration}</span>
        )}
      </td>
      <td className="px-4 py-3">
        <TicketStatusPill status={ticket.status} />
      </td>
    </tr>
  );
}

function SearchGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.5" y2="16.5" />
    </svg>
  );
}

function ChevronGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

