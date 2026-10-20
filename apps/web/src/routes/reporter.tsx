// Reporter layout for the V2 top-nav shell. The redirect-only guard below is
// unchanged and authoritative navigation-wise; the component owns the display
// identity fetch (username + NIM only) and the logout POST.
import { useCallback, useEffect, useState } from 'react';
import { Outlet, createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { redirectForRole, type GuardUser } from '../server/guard';
import { NOTIFICATIONS_CHANGED_EVENT } from '../lib/notification-events.js';
import { ReporterShell } from '../components/index.js';

interface MeUser {
  readonly username: string;
  readonly nim: string | null;
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
        username: username === '' ? 'Reporter' : username,
        nim: typeof record.nim === 'string' && record.nim !== '' ? record.nim : null,
        role: record.role,
      };
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
  component: ReporterLayout,
});

function ReporterLayout() {
  const navigate = useNavigate();
  const [me, setMe] = useState<MeUser | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const [meResponse, notificationResponse] = await Promise.all([
          fetch('/api/auth/me', { credentials: 'include' }),
          fetch('/api/notifications', { credentials: 'include' }),
        ]);
        if (cancelled) return;
        if (meResponse.ok) {
          try {
            setMe(sanitizeUser(((await meResponse.json()) as MeResponse).user ?? null));
          } catch {
            setMe(null);
          }
        }
        if (notificationResponse.ok) {
          try {
            const body = (await notificationResponse.json()) as {
              readonly unreadCount?: unknown;
            };
            setUnreadCount(
              typeof body.unreadCount === 'number' && body.unreadCount >= 0 ? body.unreadCount : 0,
            );
          } catch {
            setUnreadCount(0);
          }
        }
      } catch {
        // Display-only fetch: the beforeLoad guard already handled auth.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // The notification page marks rows read in-place, so refetch the dot count
  // when it announces a change instead of waiting for the next full reload.
  const refreshUnreadCount = useCallback((): void => {
    void (async () => {
      try {
        const response = await fetch('/api/notifications', { credentials: 'include' });
        if (!response.ok) return;
        const body = (await response.json()) as { readonly unreadCount?: unknown };
        setUnreadCount(
          typeof body.unreadCount === 'number' && body.unreadCount >= 0 ? body.unreadCount : 0,
        );
      } catch {
        // Display-only refresh: keep the last known count on failure.
      }
    })();
  }, []);

  useEffect(() => {
    window.addEventListener(NOTIFICATIONS_CHANGED_EVENT, refreshUnreadCount);
    return () => {
      window.removeEventListener(NOTIFICATIONS_CHANGED_EVENT, refreshUnreadCount);
    };
  }, [refreshUnreadCount]);

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
    <ReporterShell
      user={{ username: me?.username ?? 'Reporter', nim: me?.nim ?? null }}
      unreadCount={unreadCount}
      onLogout={handleLogout}
    >
      <Outlet />
    </ReporterShell>
  );
}
