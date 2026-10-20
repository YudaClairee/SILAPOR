// Admin layout for the V2 top-nav shell. The redirect-only guard below is
// unchanged and authoritative navigation-wise; the component owns the display
// identity fetch (username + NIP only) and the logout POST.
import { useEffect, useState } from 'react';
import { Outlet, createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { redirectForRole, type GuardUser } from '../server/guard';
import { AdminShell } from '../components/index.js';

interface MeUser {
  readonly username: string;
  readonly nip: string | null;
  readonly role: 'ADMIN' | 'REPORTER';
}

interface MeResponse {
  readonly user?: unknown;
}

function sanitizeUser(value: unknown): MeUser | null {
  if (value !== null && typeof value === 'object') {
    const record = value as {
      readonly username?: unknown;
      readonly nim?: unknown;
      readonly role?: unknown;
    };
    if (record.role === 'ADMIN' || record.role === 'REPORTER') {
      const username = typeof record.username === 'string' ? record.username : '';
      return {
        username: username === '' ? 'Administrator' : username,
        nip: typeof record.nim === 'string' && record.nim !== '' ? record.nim : null,
        role: record.role,
      };
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
        user = sanitizeUser(((await response.json()) as MeResponse).user ?? null);
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
  const [me, setMe] = useState<MeUser | null>(null);

  // Display-only fetch: the beforeLoad guard already handled auth.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch('/api/auth/me', { credentials: 'include' });
        if (cancelled || !response.ok) {
          return;
        }
        try {
          setMe(sanitizeUser(((await response.json()) as MeResponse).user ?? null));
        } catch {
          setMe(null);
        }
      } catch {
        // Display-only fetch: keep the fallback identity on failure.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Presentational shell adoption (mirrors the reporter layout): the guard
  // above stays authoritative; this layout only owns the identity display and
  // the logout POST.
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
    <AdminShell
      user={{ username: me?.username ?? 'Administrator', nip: me?.nip ?? null }}
      onLogout={handleLogout}
    >
      <Outlet />
    </AdminShell>
  );
}
