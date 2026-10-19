// Reporter dashboard (EXECUTION-PLAN 10.1 /reporter): ringkasan laporan aktif
// + notifikasi milik reporter. SSR-fallback loader: abstain saat SSR fetch
// gagal, komponen memuat client-side. House components only.
import { useEffect, useState } from 'react';
import { Link, createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import {
  Button,
  EmptyState,
  ErrorPanel,
  LoadingState,
  StatusBadge,
  TicketMono,
  buttonBaseClasses,
  buttonVariantClasses,
} from '../components/index.js';

interface SummaryItem {
  readonly id: string;
  readonly ticketNumber: string;
  readonly status: string;
  readonly reportedAt: string;
}

interface Summary {
  readonly active: SummaryItem[];
  readonly activeCount: number;
  readonly totalMine: number;
}

interface Notif {
  readonly unreadCount: number;
  readonly total: number;
}

interface LoaderData {
  readonly summary: Summary | null;
  readonly notif: Notif | null;
  readonly loadError: string | null;
  readonly needsClientLoad: boolean;
}

type Bundle =
  | { readonly summary: Summary | null; readonly notif: Notif | null; readonly loadError: string | null }
  | 'unauthorized'
  | 'unavailable';

const ACTIVE: ReadonlySet<string> = new Set(['REPORTED', 'VERIFIED', 'ASSIGNED', 'INSPECTION', 'IN_REPAIR']);

async function fetchBundle(): Promise<Bundle> {
  let mineRes: Response;
  let notifRes: Response;
  try {
    [mineRes, notifRes] = await Promise.all([
      fetch('/api/reports?mine=true&limit=100', { credentials: 'include' }),
      fetch('/api/notifications', { credentials: 'include' }),
    ]);
  } catch {
    return 'unavailable';
  }
  if (mineRes.status === 401 || notifRes.status === 401) return 'unauthorized';
  if (!mineRes.ok) return { summary: null, notif: null, loadError: 'Gagal memuat laporan (' + mineRes.status + ').' };
  let mine: { readonly items?: ReadonlyArray<SummaryItem>; readonly total?: number };
  try {
    mine = (await mineRes.json()) as { readonly items?: ReadonlyArray<SummaryItem>; readonly total?: number };
  } catch {
    return { summary: null, notif: null, loadError: 'Respons laporan tidak valid.' };
  }
  const items = Array.isArray(mine.items) ? mine.items : [];
  const actives = items.filter((i) => ACTIVE.has(i.status));
  const summary: Summary = {
    active: actives.slice(0, 5),
    activeCount: actives.length,
    totalMine: typeof mine.total === 'number' ? mine.total : items.length,
  };
  let notif: Notif | null = null;
  if (notifRes.ok) {
    try {
      const b = (await notifRes.json()) as { readonly unreadCount?: number; readonly total?: number };
      notif = {
        unreadCount: typeof b.unreadCount === 'number' ? b.unreadCount : 0,
        total: typeof b.total === 'number' ? b.total : 0,
      };
    } catch {
      notif = null;
    }
  }
  return { summary, notif, loadError: null };
}

export const Route = createFileRoute('/reporter/')({
  loader: async (): Promise<LoaderData> => {
    const r = await fetchBundle();
    if (r === 'unauthorized') throw redirect({ to: '/login' });
    if (r === 'unavailable') return { summary: null, notif: null, loadError: null, needsClientLoad: true };
    return { summary: r.summary, notif: r.notif, loadError: r.loadError, needsClientLoad: false };
  },
  pendingComponent: Pending,
  component: Page,
});

function Pending() {
  return (
    <section aria-labelledby="rd-title">
      <h1 id="rd-title" className="text-2xl font-semibold text-text">Ringkasan Saya</h1>
      <div className="mt-4"><LoadingState message="Memuat ringkasan\u2026" /></div>
    </section>
  );
}

function fmt(v: string): string {
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
}

function Page() {
  const loader = Route.useLoaderData() as LoaderData;
  const navigate = useNavigate();
  const [summary, setSummary] = useState<Summary | null>(loader.needsClientLoad ? null : loader.summary);
  const [notif, setNotif] = useState<Notif | null>(loader.needsClientLoad ? null : loader.notif);
  const [pending, setPending] = useState(loader.needsClientLoad);
  const [loadError, setLoadError] = useState<string | null>(loader.loadError);

  useEffect(() => {
    if (!loader.needsClientLoad) return;
    let cancelled = false;
    void (async () => {
      const r = await fetchBundle();
      if (cancelled) return;
      if (r === 'unauthorized') {
        await navigate({ to: '/login' });
        return;
      }
      if (r === 'unavailable') setLoadError('Tidak dapat terhubung ke server.');
      else {
        setSummary(r.summary);
        setNotif(r.notif);
        setLoadError(r.loadError);
      }
      setPending(false);
    })();
    return () => { cancelled = true; };
  }, [loader.needsClientLoad, navigate]);

  function retry(): void {
    setPending(true);
    setLoadError(null);
    void (async () => {
      const r = await fetchBundle();
      if (r === 'unauthorized') {
        await navigate({ to: '/login' });
        return;
      }
      if (r === 'unavailable') setLoadError('Tidak dapat terhubung ke server.');
      else {
        setSummary(r.summary);
        setNotif(r.notif);
        setLoadError(r.loadError);
      }
      setPending(false);
    })();
  }

  return (
    <section aria-labelledby="rd-title">
      <h1 id="rd-title" className="text-2xl font-semibold text-text">Ringkasan Saya</h1>
      <p className="mt-1 text-sm text-muted">Laporan aktif Anda dan pemberitahuan terbaru.</p>
      {pending ? (
        <div className="mt-4"><LoadingState message="Memuat ringkasan\u2026" /></div>
      ) : loadError !== null ? (
        <div className="mt-4">
          <ErrorPanel message={loadError} retry={<Button type="button" variant="secondary" onClick={retry}>Coba lagi</Button>} />
        </div>
      ) : summary === null ? (
        <div className="mt-4">
          <EmptyState
            title="Belum ada ringkasan"
            description="Buat laporan pertama Anda agar ringkasan muncul di sini."
            action={
              <Link to="/reporter/reports/new" className={buttonBaseClasses + ' ' + buttonVariantClasses.primary}>
                Buat laporan
              </Link>
            }
          />
        </div>
      ) : (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <Link to="/reporter/reports" search={{ filter: 'semua', status: '', mine: true, offset: 0 }} className="rounded-md border border-border bg-surface px-4 py-3">
              <p className="text-xs text-muted">Laporan aktif saya</p>
              <p className="mt-1 text-2xl font-semibold text-text">{summary.activeCount}</p>
            </Link>
            <Link to="/reporter/reports" search={{ filter: 'semua', status: '', mine: true, offset: 0 }} className="rounded-md border border-border bg-surface px-4 py-3">
              <p className="text-xs text-muted">Total laporan saya</p>
              <p className="mt-1 text-2xl font-semibold text-text">{summary.totalMine}</p>
            </Link>
            <Link to="/reporter/notifikasi" className="rounded-md border border-border bg-surface px-4 py-3">
              <p className="text-xs text-muted">Notifikasi belum dibaca</p>
              <p className="mt-1 text-2xl font-semibold text-text">{notif === null ? 0 : notif.unreadCount}</p>
            </Link>
          </div>
          <h2 className="mt-6 text-lg font-semibold text-text">Laporan aktif terbaru</h2>
          {summary.active.length === 0 ? (
            <div className="mt-3">
              <EmptyState
                title="Tidak ada laporan aktif"
                description="Semua laporan Anda sudah selesai atau belum ada laporan."
                action={
                  <Link to="/reporter/reports/new" className={buttonBaseClasses + ' ' + buttonVariantClasses.secondary}>
                    Buat laporan baru
                  </Link>
                }
              />
            </div>
          ) : (
            <ul className="mt-3 divide-y divide-border rounded-md border border-border bg-surface px-4">
              {summary.active.map((item) => (
                <li key={item.id} className="flex flex-wrap items-center gap-2 py-3">
                  <Link to="/reporter/reports/$ticket" params={{ ticket: item.ticketNumber }} className="text-accent underline underline-offset-2">
                    <TicketMono>{item.ticketNumber}</TicketMono>
                  </Link>
                  <StatusBadge status={item.status} />
                  <TicketMono className="text-xs text-subtle"><time>{fmt(item.reportedAt)}</time></TicketMono>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
