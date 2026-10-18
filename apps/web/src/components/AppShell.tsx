// AppShell (Task D-1). Institutional shell: header (SILAPOR wordmark + UPI
// Kampus Tasikmalaya identifier + login-state-aware auth control) +
// persistent 240px nav rail (desktop) / top bar + menu trigger (mobile) +
// <=1200px content region with one primary-action slot per view.
//
// Presentational only: auth state arrives via the `user` prop and logout via
// `onLogout` (page layouts keep owning the /api/auth/me + /api/auth/logout
// fetches and role redirects). Active state comes from the router (Link
// data-status=active + aria-current). No <main> is rendered here —
// __root.tsx owns main#main and the skip-link, which this shell preserves by
// not duplicating them.
//
// D-1 adoption: shipped UNUSED by pages (zero-risk); D-2/D-3 adopt it.
import { useState, type ReactNode } from 'react';
import { Link } from '@tanstack/react-router';

export type AppShellRole = 'ADMIN' | 'REPORTER';

export interface AppShellUser {
  readonly role: AppShellRole;
}

export interface AppShellNavItem {
  readonly to: string;
  readonly label: string;
}

/** Role-aware nav: reporter (Laporkan, Tiket Kampus, Notifikasi), admin
 *  (Dashboard, Semua Laporan, Fasilitas). Shared auth entry is rendered
 *  separately (Masuk/Keluar). Never more than 5 items. */
export function navItemsForRole(role: AppShellRole): readonly AppShellNavItem[] {
  if (role === 'ADMIN') {
    return [
      { to: '/admin', label: 'Dashboard' },
      { to: '/admin/reports', label: 'Semua Laporan' },
      { to: '/admin/facilities', label: 'Fasilitas' },
    ];
  }
  return [
    { to: '/reporter/reports/new', label: 'Laporkan' },
    { to: '/reporter/reports', label: 'Tiket Kampus' },
    { to: '/reporter/notifikasi', label: 'Notifikasi' },
  ];
}

const NAV_LINK_CLASSES =
  'flex min-h-[44px] items-center gap-2 rounded-md px-3 text-sm font-medium text-text hover:bg-background data-[status=active]:bg-background data-[status=active]:font-semibold data-[status=active]:shadow-[inset_3px_0_0_0_var(--color-accent)]';

export interface AppShellProps {
  /** Null = anonymous (nav shows Masuk). Non-null = role-scoped nav + Keluar. */
  readonly user: AppShellUser | null;
  /** Page-level logout handler (POST /api/auth/logout + navigate). */
  readonly onLogout: () => void;
  /** The view's single primary action (e.g. "Laporan Baru" button). */
  readonly action?: ReactNode;
  readonly children: ReactNode;
}

export function AppShell({ user, onLogout, action, children }: AppShellProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const items = user === null ? [] : navItemsForRole(user.role);

  const authControl =
    user === null ? (
      <Link to="/login" className={NAV_LINK_CLASSES}>
        Masuk
      </Link>
    ) : (
      <button type="button" onClick={onLogout} className={NAV_LINK_CLASSES}>
        Keluar
      </button>
    );

  return (
    <div className="min-h-screen bg-background text-text">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex min-h-[60px] w-full max-w-[1200px] items-center justify-between gap-4 px-4 md:px-6">
          <div className="flex items-center gap-3">
            <Link to="/" className="text-base font-semibold tracking-tight text-text">
              SILAPOR
            </Link>
            <span className="hidden text-sm text-muted sm:inline">UPI Kampus Tasikmalaya</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="hidden md:block">{authControl}</div>
            <button
              type="button"
              className="inline-flex items-center rounded-md border border-border bg-surface px-3 text-sm font-medium text-text md:hidden"
              aria-expanded={menuOpen}
              aria-controls="app-nav"
              onClick={() => setMenuOpen((open) => !open)}
            >
              Menu
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-[1200px] flex-col md:flex-row">
        <nav
          id="app-nav"
          aria-label="Navigasi utama"
          className={`${menuOpen ? 'block' : 'hidden'} w-full shrink-0 border-b border-border bg-surface px-4 py-3 md:block md:w-60 md:border-b-0 md:border-r md:bg-background md:px-3 md:py-4`}
        >
          <ul className="flex flex-col gap-1">
            {items.map((item) => (
              <li key={item.to}>
                <Link
                  to={item.to}
                  className={NAV_LINK_CLASSES}
                  activeProps={{ 'aria-current': 'page' }}
                >
                  {item.label}
                </Link>
              </li>
            ))}
            <li className="md:hidden">{authControl}</li>
          </ul>
        </nav>

        <div className="w-full min-w-0 flex-1 px-4 py-4 md:px-6 md:py-6">
          {action === undefined ? null : <div className="mb-4 flex justify-end">{action}</div>}
          {children}
        </div>
      </div>
    </div>
  );
}
