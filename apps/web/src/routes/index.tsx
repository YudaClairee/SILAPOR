// Root dispatcher: first open always resolves by session.
// Anonymous -> /login; ADMIN -> /admin; REPORTER -> /reporter.
// The beforeLoad fetch is navigation-only; API routes enforce auth.
import { createFileRoute, redirect } from '@tanstack/react-router';
import { LoadingState } from '../components/index.js';
import { redirectForRole, type GuardUser } from '../server/guard';

interface MeResponse {
  readonly user?: unknown;
}

function sanitizeRole(value: unknown): GuardUser | null {
  if (value !== null && typeof value === 'object') {
    const role = (value as { readonly role?: unknown }).role;
    if (role === 'ADMIN' || role === 'REPORTER') return { role };
  }
  return null;
}

export const Route = createFileRoute('/')({
  beforeLoad: async ({ location }) => {
    let user: GuardUser | null = null;
    try {
      const response = await fetch('/api/auth/me', { credentials: 'include' });
      if (response.ok) {
        try {
          user = sanitizeRole(((await response.json()) as MeResponse).user ?? null);
        } catch {
          user = null;
        }
      }
    } catch {
      return;
    }
    const target = redirectForRole(location.pathname, user);
    if (target !== null) throw redirect({ to: target });
  },
  component: RootDispatcher,
});

function RootDispatcher() {
  return (
    <section aria-labelledby="root-dispatcher-title">
      <h1 id="root-dispatcher-title" className="sr-only">
        Mengalihkan…
      </h1>
      <LoadingState message="Mengalihkan…" />
    </section>
  );
}
