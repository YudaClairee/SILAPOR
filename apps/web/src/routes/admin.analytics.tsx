// Admin analytics (EXECUTION-PLAN 9.5 + 10.2 /admin/analytics): breakdown
// kategori/lokasi/status + resolution time dari overview endpoint.
// Baca saja + filter rentang tanggal; chart memakai BarChart yang sama.
import { useEffect, useState } from 'react';
import { Link, createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import {
  BarChart,
  Button,
  EmptyState,
  ErrorPanel,
  Input,
  LoadingState,
  buttonBaseClasses,
  buttonVariantClasses,
} from '../components/index.js';

interface Search {
  readonly from: string;
  readonly to: string;
}

interface Data {
  readonly range: { readonly from: string | null; readonly to: string | null };
  readonly byStatus: ReadonlyArray<{ readonly status: string; readonly count: number }>;
  readonly byCategory: ReadonlyArray<{ readonly categoryId: string | null; readonly categoryName: string | null; readonly count: number }>;
  readonly byLocation: ReadonlyArray<{ readonly locationId: string; readonly locationName: string; readonly count: number }>;
  readonly resolutionTime: { readonly sampleSize: number; readonly averageSeconds: number | null; readonly medianSeconds: number | null };
}

interface LoaderData {
  readonly data: Data | null;
  readonly loadError: string | null;
  readonly forbidden: boolean;
  readonly needsClientLoad: boolean;
}

type Bundle =
  | { readonly data: Data | null; readonly loadError: string | null; readonly forbidden: boolean }
  | 'unauthorized'
  | 'unavailable';

function toQuery(s: Search): string {
  const p = new URLSearchParams();
  if (s.from !== '') p.set('from', s.from);
  if (s.to !== '') p.set('to', s.to);
  return p.toString();
}

async function fetchBundle(s: Search): Promise<Bundle> {
  const q = toQuery(s);
  const url = q === '' ? '/api/admin/analytics/overview' : '/api/admin/analytics/overview?' + q;
  let res: Response;
  try {
    res = await fetch(url, { credentials: 'include' });
  } catch {
    return 'unavailable';
  }
  if (res.status === 401) return 'unauthorized';
  if (res.status === 403) return { data: null, loadError: null, forbidden: true };
  if (!res.ok) return { data: null, loadError: 'Gagal memuat analytics (' + res.status + ').', forbidden: false };
  try {
    return { data: (await res.json()) as Data, loadError: null, forbidden: false };
  } catch {
    return { data: null, loadError: 'Respons analytics tidak valid.', forbidden: false };
  }
}

function fmtDur(s: number | null): string {
  if (s === null) return '\u2014';
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  if (d > 0) return d + ' hari ' + h + ' jam';
  if (h > 0) return h + ' jam';
  return Math.round(s / 60) + ' menit';
}

export const Route = createFileRoute('/admin/analytics')({
  validateSearch: (search: Record<string, unknown>): Search => ({
    from: typeof search['from'] === 'string' ? search['from'] : '',
    to: typeof search['to'] === 'string' ? search['to'] : '',
  }),
  loaderDeps: ({ search }) => ({ from: search.from, to: search.to }),
  loader: async ({ deps }): Promise<LoaderData> => {
    const s = (deps as Search | undefined) ?? { from: '', to: '' };
    const r = await fetchBundle({ from: s.from ?? '', to: s.to ?? '' });
    if (r === 'unauthorized') throw redirect({ to: '/login' });
    if (r === 'unavailable') return { data: null, loadError: null, forbidden: false, needsClientLoad: true };
    return { data: r.data, loadError: r.loadError, forbidden: r.forbidden, needsClientLoad: false };
  },
  pendingComponent: Pending,
  component: Page,
});

function Pending() {
  return (
    <section aria-labelledby="aa-title">
      <h1 id="aa-title" className="text-2xl font-semibold text-text">Analytics</h1>
      <div className="mt-4"><LoadingState message="Memuat\u2026" /></div>
    </section>
  );
}

function Page() {
  const loader = Route.useLoaderData() as LoaderData;
  const search = Route.useSearch() as Search;
  const navigate = useNavigate();
  const [data, setData] = useState<Data | null>(loader.needsClientLoad ? null : loader.data);
  const [pending, setPending] = useState(loader.needsClientLoad);
  const [loadError, setLoadError] = useState<string | null>(loader.loadError);
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
    let c = false;
    void (async () => {
      const r = await fetchBundle({ from: search.from, to: search.to });
      if (c) return;
      if (r === 'unauthorized') {
        await navigate({ to: '/login' });
        return;
      }
      if (r === 'unavailable') setLoadError('Tidak dapat terhubung ke server.');
      else {
        setData(r.data);
        setLoadError(r.loadError);
        setForbidden(r.forbidden);
      }
      setPending(false);
    })();
    return () => { c = true; };
  }, [loader, search.from, search.to, navigate]);

  function apply(): void {
    void navigate({ to: '/admin/analytics', search: { from, to } });
  }

  return (
    <section aria-labelledby="aa-title">
      <h1 id="aa-title" className="text-2xl font-semibold text-text">Analytics</h1>
      <p className="mt-1 text-sm text-muted">Breakdown per kategori, lokasi, status + waktu penyelesaian (final AI).</p>
      <form
        className="mt-4 flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          apply();
        }}
      >
        <div>
          <label htmlFor="an-from" className="mb-1 block text-sm font-medium text-text">Dari (YYYY-MM-DD)</label>
          <Input id="an-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div>
          <label htmlFor="an-to" className="mb-1 block text-sm font-medium text-text">Sampai (YYYY-MM-DD)</label>
          <Input id="an-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <Button type="submit">Terapkan</Button>
        {search.from !== '' || search.to !== '' ? (
          <Link to="/admin/analytics" search={{ from: '', to: '' }} className={buttonBaseClasses + ' ' + buttonVariantClasses.secondary}>
            Atur ulang
          </Link>
        ) : null}
      </form>
      {pending ? (
        <div className="mt-4"><LoadingState message="Memuat\u2026" /></div>
      ) : loadError !== null ? (
        <div className="mt-4"><ErrorPanel message={loadError} retry={<Button type="button" variant="secondary" onClick={apply}>Coba lagi</Button>} /></div>
      ) : forbidden ? (
        <div className="mt-4"><ErrorPanel title="Akses ditolak" message="Halaman ini hanya untuk admin." /></div>
      ) : data === null ? (
        <div className="mt-4"><EmptyState title="Belum ada data" description="Belum ada laporan pada rentang ini." /></div>
      ) : (
        <>
          <div className="mt-4 rounded-md border border-border bg-surface px-4 py-3 text-sm text-muted">
            Waktu penyelesaian: rata-rata <strong className="text-text">{fmtDur(data.resolutionTime.averageSeconds)}</strong>
            {' \u00b7 '}median <strong className="text-text">{fmtDur(data.resolutionTime.medianSeconds)}</strong>
            {' \u00b7 '}sampel <strong className="text-text">{data.resolutionTime.sampleSize}</strong> laporan selesai.
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <BarChart
              title="Laporan per kategori"
              data={data.byCategory.map((e) => ({ label: e.categoryName ?? 'Belum terklasifikasi', value: e.count }))}
              emptyMessage="Tidak ada laporan pada rentang ini."
            />
            <BarChart
              title="Laporan per lokasi"
              data={data.byLocation.map((e) => ({ label: e.locationName, value: e.count }))}
              emptyMessage="Tidak ada laporan pada rentang ini."
            />
          </div>
          <div className="mt-4">
            <BarChart
              title="Laporan per status"
              data={data.byStatus.map((e) => ({ label: e.status, value: e.count }))}
              emptyMessage="Tidak ada laporan pada rentang ini."
            />
          </div>
        </>
      )}
    </section>
  );
}
