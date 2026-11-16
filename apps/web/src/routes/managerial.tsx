import { useEffect, useState } from 'react';
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { AppShell } from '../components/index.js';
import { buildManagerialDashboardViewModel } from '../lib/managerial-dashboard.js';
import {
  DashboardContent,
  fetchBundle,
  queryOf,
  type Bundle,
} from './admin.managerial.js';
import type { DashboardOverviewResponse } from '../server/analytics.js';
import { redirectForRole, type GuardUser } from '../server/guard.js';

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

interface MeResponse {
  readonly user?: unknown;
}

function isManagerial(value: unknown): GuardUser | null {
  if (value !== null && typeof value === 'object') {
    const role = (value as { readonly role?: unknown }).role;
    if (role === 'ADMIN' || role === 'REPORTER' || role === 'MANAGERIAL') return { role };
  }
  return null;
}

export const Route = createFileRoute('/managerial')({
  validateSearch: (search: Record<string, unknown>): Search => ({
    from: typeof search.from === 'string' ? search.from : '',
    to: typeof search.to === 'string' ? search.to : '',
  }),
  beforeLoad: async ({ location }) => {
    let user: GuardUser | null = null;
    try {
      const response = await fetch('/api/auth/me', { credentials: 'include' });
      if (response.ok) {
        const body = (await response.json()) as MeResponse;
        user = isManagerial(body.user ?? null);
      }
    } catch {
      return;
    }
    const target = redirectForRole(location.pathname, user);
    if (target !== null) throw redirect({ to: target });
  },
  loaderDeps: ({ search }) => ({ from: search.from, to: search.to }),
  loader: async ({ deps }): Promise<LoaderData> => {
    const bundle = await fetchBundle(deps as Search);
    if (bundle === 'unauthorized') throw redirect({ to: '/login' });
    if (bundle === 'unavailable') {
      return { data: null, loadError: null, forbidden: false, needsClientLoad: true };
    }
    return { ...bundle, needsClientLoad: false };
  },
  component: ManagerialPage,
});

function ManagerialPage() {
  const loader = Route.useLoaderData() as LoaderData;
  const search = Route.useSearch() as Search;
  const navigate = useNavigate();
  const [data, setData] = useState(loader.needsClientLoad ? null : loader.data);
  const [pending, setPending] = useState(loader.needsClientLoad);
  const [loadError, setLoadError] = useState(loader.loadError);
  const [forbidden, setForbidden] = useState(loader.forbidden);
  const [from, setFrom] = useState(search.from);
  const [to, setTo] = useState(search.to);

  useEffect(() => {
    if (!loader.needsClientLoad) return;
    let cancelled = false;
    void fetchBundle(search).then(async (bundle: Bundle) => {
      if (cancelled) return;
      if (bundle === 'unauthorized') {
        await navigate({ to: '/login' });
        return;
      }
      if (bundle === 'unavailable') {
        setLoadError('Tidak dapat terhubung ke server.');
      } else {
        setData(bundle.data);
        setLoadError(bundle.loadError);
        setForbidden(bundle.forbidden);
      }
      setPending(false);
    });
    return () => {
      cancelled = true;
    };
  }, [loader.needsClientLoad, navigate, search]);

  useEffect(() => {
    setData(loader.data);
    setLoadError(loader.loadError);
    setForbidden(loader.forbidden);
    setPending(false);
    setFrom(search.from);
    setTo(search.to);
  }, [loader.data, loader.forbidden, loader.loadError, search.from, search.to]);

  function apply(): void {
    void navigate({ to: '/managerial', search: { from, to } });
  }

  const hasReports = data !== null && data.cards.totalReports > 0;
  const content =
    pending ? <p className="mt-5 text-sm text-muted">Memuat dashboard manajerial…</p>
      : loadError !== null ? <p className="mt-5 text-sm text-danger">{loadError}</p>
        : forbidden ? <p className="mt-5 text-sm text-danger">Akses ditolak.</p>
          : data === null || !hasReports ? <p className="mt-5 text-sm text-muted">Belum ada data pada rentang ini.</p>
            : <DashboardContent model={buildManagerialDashboardViewModel(data)} readOnly />;

  return (
    <AppShell
      user={{ role: 'MANAGERIAL' }}
      onLogout={() => {
        void fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).finally(() => {
          void navigate({ to: '/login' });
        });
      }}
    >
      <section aria-labelledby="managerial-title">
        <h1 id="managerial-title" className="text-2xl font-semibold text-text">Dashboard Manajerial</h1>
        <p className="mt-1 text-sm text-muted">Ringkasan deterministik untuk pengambilan keputusan.</p>
        <form className="mt-4 flex flex-wrap items-end gap-3" onSubmit={(event) => { event.preventDefault(); apply(); }}>
          <label className="text-sm font-medium text-text">Dari <input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
          <label className="text-sm font-medium text-text">Sampai <input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
          <button type="submit" className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-white">Terapkan</button>
        </form>
        {content}
      </section>
    </AppShell>
  );
}
