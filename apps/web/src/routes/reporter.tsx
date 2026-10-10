// Reporter layout placeholder (Phase 2 P2-4). Renders <Outlet/> only —
// full reporter UI lands in Phase 3+.
//
// Server enforcement is authoritative (plan principle 2): API routes guard
// with `../server/auth.ts` require* helpers. `beforeLoad` below is
// navigation convenience only: it asks GET /api/auth/me (cookie included)
// and redirects anonymous users to /login and non-reporters away per
// `redirectForRole`. A failed fetch (e.g. SSR relative-URL fetch, offline)
// is non-definitive, so it abstains instead of redirecting.
import { Outlet, createFileRoute, redirect } from '@tanstack/react-router';
import { redirectForRole, type GuardUser } from '../server/guard';

interface MeResponse {
  readonly user?: { readonly role?: unknown } | null;
}

function sanitizeRole(value: unknown): GuardUser | null {
  if (value !== null && typeof value === 'object') {
    const role = (value as { readonly role?: unknown }).role;
    if (role === 'ADMIN' || role === 'REPORTER') {
      return { role };
    }
  }
  return null;
}

export const Route = createFileRoute('/reporter')({
  beforeLoad: async ({ location }) => {
    let response: Response | null = null;
    try {
      response = await fetch('/api/auth/me', { credentials: 'include' });
    } catch {
      return;
    }
    let user: GuardUser | null = null;
    if (response.ok) {
      try {
        user = sanitizeRole(((await response.json()) as MeResponse).user ?? null);
      } catch {
        user = null;
      }
    }
    const target = redirectForRole(location.pathname, user);
    if (target !== null) {
      throw redirect({ to: target });
    }
  },
  component: ReporterLayout,
});

function ReporterLayout() {
  return <Outlet />;
}
