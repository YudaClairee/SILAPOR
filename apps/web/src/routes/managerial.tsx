import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { AdminShell } from '../components/index.js';
import { ManagerialDashboardScreen, fetchBundle } from '../components/ManagerialDashboard.js';
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

interface MeUser extends GuardUser {
  readonly username: string;
  readonly nip: string | null;
}

interface MeResponse {
  readonly user?: unknown;
}

function sanitizeUser(value: unknown): MeUser | null {
  if (value !== null && typeof value === 'object') {
    const record = value as {
      readonly role?: unknown;
      readonly username?: unknown;
      readonly nim?: unknown;
    };
    if (record.role === 'ADMIN' || record.role === 'REPORTER' || record.role === 'MANAGERIAL') {
      return {
        role: record.role,
        username: typeof record.username === 'string' ? record.username : '',
        nip: typeof record.nim === 'string' && record.nim !== '' ? record.nim : null,
      };
    }
  }
  return null;
}

export const Route = createFileRoute('/managerial')({
  validateSearch: (search: Record<string, unknown>): Search => ({
    from: typeof search.from === 'string' ? search.from : '',
    to: typeof search.to === 'string' ? search.to : '',
  }),
  beforeLoad: async ({ location }) => {
    let user: MeUser | null = null;
    try {
      const response = await fetch('/api/auth/me', { credentials: 'include' });
      if (response.ok) {
        const body = (await response.json()) as MeResponse;
        user = sanitizeUser(body.user ?? null);
      }
    } catch {
      return { user: null };
    }
    const target = redirectForRole(location.pathname, user);
    if (target !== null) throw redirect({ to: target });
    return { user };
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
  const { user } = Route.useRouteContext();

  return (
    <AdminShell
      variant="managerial"
      user={{ username: user?.username || 'Manajerial', nip: user?.nip ?? null }}
      onLogout={() => {
        void fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).finally(() => {
          void navigate({ to: '/login' });
        });
      }}
    >
      <ManagerialDashboardScreen
        loader={loader}
        search={search}
        readOnly
        onApply={(range) => void navigate({ to: '/managerial', search: range })}
      />
    </AdminShell>
  );
}
