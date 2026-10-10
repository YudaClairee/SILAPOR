// Redirect-only navigation convenience (Phase 2 P2-4, plan step 6).
//
// Server enforcement in API routes (`./auth.ts` require* guards) is
// AUTHORITATIVE; this helper only decides client-side redirects so users
// land on the right page. It is pure (no I/O, no imports) and fails closed:
// unknown states on protected prefixes redirect to /login.
//
// Rules:
// - '/login' always passes through (never redirect; avoids loops).
// - Anonymous users on protected prefixes (/admin, /reporter, /notifications)
//   go to '/login'; elsewhere they pass (public pages).
// - REPORTER on /admin* goes to '/'; ADMIN may view reporter pages (allowed).
// - Everything else passes (null = no redirect).
export interface GuardUser {
  readonly role: 'ADMIN' | 'REPORTER';
}

const PROTECTED_PREFIXES: readonly string[] = ['/admin', '/reporter', '/notifications'];

function isPathUnder(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function redirectForRole(pathname: string, user: GuardUser | null): string | null {
  if (pathname === '/login') {
    return null;
  }
  if (user === null) {
    return PROTECTED_PREFIXES.some((prefix) => isPathUnder(pathname, prefix)) ? '/login' : null;
  }
  if (user.role === 'REPORTER' && isPathUnder(pathname, '/admin')) {
    return '/';
  }
  return null;
}
