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
