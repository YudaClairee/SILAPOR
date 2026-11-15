// Redirect-only navigation convenience (Phase 2 P2-4, plan step 6).
//
// Server enforcement in API routes (`./auth` require* guards) is
// AUTHORITATIVE; this helper only decides client-side redirects so users
// land on the right page. It is pure (no I/O, no imports) and fails closed:
// anonymous users land on /login except on public pages.
//
// Rules:
// - Anonymous users go to '/login' everywhere except public pages
//   ('/login', '/kebijakan-privasi').
// - Logged-in users visiting '/login' bounce to their home ('/admin' for
//   ADMIN, '/reporter' for REPORTER).
// - '/' is a dispatcher: anonymous -> '/login'; ADMIN -> '/admin';
//   REPORTER -> '/reporter'.
// - REPORTER on /admin* goes to '/reporter'; ADMIN may view reporter pages
//   (allowed).
// - Everything else passes (null = no redirect).
export interface GuardUser {
  readonly role: 'ADMIN' | 'REPORTER' | 'MANAGERIAL';
}

export const ADMIN_HOME = '/admin' as const;
export const REPORTER_HOME = '/reporter' as const;
export const MANAGERIAL_HOME = '/managerial' as const;

export function homeForRole(role: GuardUser['role']): string {
  if (role === 'ADMIN') return ADMIN_HOME;
  if (role === 'MANAGERIAL') return MANAGERIAL_HOME;
  return REPORTER_HOME;
}

const PUBLIC_PATHS: readonly string[] = ['/login', '/kebijakan-privasi'];

export function redirectForRole(pathname: string, user: GuardUser | null): string | null {
  if (user !== null && (pathname === '/login' || pathname === '/')) {
    return homeForRole(user.role);
  }
  if (user === null) {
    if (PUBLIC_PATHS.includes(pathname)) return null;
    return '/login';
  }
  if (user.role === 'REPORTER' && isPathUnder(pathname, '/admin')) return REPORTER_HOME;
  if (user.role === 'REPORTER' && isPathUnder(pathname, '/managerial')) return REPORTER_HOME;
  if (user.role === 'ADMIN' && isPathUnder(pathname, '/managerial')) return ADMIN_HOME;
  if (user.role === 'MANAGERIAL' && !isPathUnder(pathname, '/managerial')) {
    return MANAGERIAL_HOME;
  }
  return null;
}

function isPathUnder(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(prefix + '/');
}
