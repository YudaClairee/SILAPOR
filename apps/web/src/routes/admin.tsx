// Admin layout placeholder (Phase 2 P2-4). Renders <Outlet/> only —
// full admin UI lands in Phase 3+ (P2-5 owns admin API routes).
//
// Server enforcement is authoritative (plan principle 2): API routes guard
// with `../server/auth.ts` require* helpers. `beforeLoad` below is
// navigation convenience only: it asks GET /api/auth/me (cookie included)
// and redirects anonymous users to /login and reporters to '/' per
// `redirectForRole`. A failed fetch (e.g. SSR relative-URL fetch, offline)
// is non-definitive, so it abstains instead of redirecting.
import { Outlet, createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { redirectForRole, type GuardUser } from '../server/guard';
import { AppShell } from '../components/index.js';

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

export const Route = createFileRoute('/admin')({
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
  component: AdminLayout,
});

function AdminLayout() {
  const navigate = useNavigate();

  // Presentational shell adoption (Task D-3, mirrors D-2 reporter layout):
  // the redirect-only guard above is unchanged and authoritative
  // navigation-wise; this layout only owns the logout POST. The route tree
  // guarantees ADMIN here post-guard (anonymous/non-admins redirect), so the
  // shell role is static.
  function handleLogout(): void {
    void (async () => {
      try {
        await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
      } catch {
        // Logout is best-effort — navigation proceeds regardless.
      }
      await navigate({ to: '/login' });
    })();
  }

  return (
    <AppShell user={{ role: 'ADMIN' }} onLogout={handleLogout}>
      <Outlet />
    </AppShell>
  );
}
