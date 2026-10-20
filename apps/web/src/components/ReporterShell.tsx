// Reporter V2 shell: top institutional header + center nav pill + user block.
// This intentionally follows the current Figma design (not the legacy
// DESIGN.md rail). Admin pages keep AppShell; the reporter portal opts into
// this shell from routes/reporter.tsx.
import { useState, type ComponentType, type ReactNode, type SVGProps } from 'react';
import { Link } from '@tanstack/react-router';
import { BellIcon, GridIcon, LogoMark, MenuIcon, PlusIcon, UserIcon } from './Icon';

export interface ReporterShellUser {
  readonly username: string;
  readonly nim: string | null;
}

export interface ReporterShellProps {
  readonly user: ReporterShellUser;
  readonly unreadCount: number;
  readonly onLogout: () => void;
  readonly children: ReactNode;
}

interface NavItem {
  readonly to: string;
  readonly label: string;
  readonly Icon: ComponentType<SVGProps<SVGSVGElement>>;
}

const NAV_ITEMS: readonly NavItem[] = [
  { to: '/reporter', label: 'Pemantauan Tiket', Icon: GridIcon },
  { to: '/reporter/reports/new', label: 'Buat Laporan', Icon: PlusIcon },
  { to: '/reporter/notifikasi', label: 'Notifikasi', Icon: BellIcon },
];

const NAV_LINK_CLASSES =
  'inline-flex min-h-[40px] items-center justify-center gap-2 rounded-[10px] px-4 text-sm font-medium text-text transition-colors hover:bg-white/70 data-[status=active]:bg-accent data-[status=active]:text-white data-[status=active]:shadow-sm';

function navLinkFor(item: NavItem, unreadCount: number, onNavigate?: () => void, mobile = false) {
  const Icon = item.Icon;
  const className = mobile
    ? `${NAV_LINK_CLASSES} justify-start lg:justify-center`
    : NAV_LINK_CLASSES;
  return (
    <Link
      key={item.to}
      to={item.to}
      activeOptions={{ exact: true, includeSearch: false }}
      activeProps={{ 'aria-current': 'page' }}
      className={className}
      onClick={onNavigate}
    >
      <span className="relative inline-flex">
        <Icon className="h-4 w-4" />
        {item.to === '/reporter/notifikasi' && unreadCount > 0 ? (
          <>
            <span
              aria-hidden="true"
              className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-[#e5484d]"
            />
            <span className="sr-only">, {unreadCount} belum dibaca</span>
          </>
        ) : null}
      </span>
      {item.label}
    </Link>
  );
}

export function ReporterShell({ user, unreadCount, onLogout, children }: ReporterShellProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const nimLabel = user.nim ?? user.username;

  return (
    <div className="min-h-screen bg-[#f7f9ff] text-text">
      <header className="sticky top-0 z-20 border-b border-[#e1e5e9] bg-white">
        <div className="mx-auto flex min-h-[64px] w-full max-w-[1280px] items-center justify-between gap-4 px-4 md:px-12">
          <Link
            to="/reporter"
            search={{ search: '', mine: false, status: '', priority: '', offset: 0 }}
            className="flex min-w-0 items-center gap-3"
          >
            <LogoMark className="h-9 w-9 shrink-0" />
            <span className="min-w-0 border-l border-[#e1e5e9] pl-3">
              <span className="block truncate text-[11px] font-bold tracking-[0.3px] text-[#202a33]">
                UPI KAMPUS TASIKMALAYA
              </span>
              <span className="block truncate text-[11px] text-[#697784]">
                Smart Campus Maintenance System
              </span>
            </span>
          </Link>

          <nav
            aria-label="Navigasi utama"
            className="hidden items-center gap-1 rounded-xl bg-[#ecf4ff] p-1 lg:flex"
          >
            {NAV_ITEMS.map((item) => navLinkFor(item, unreadCount))}
          </nav>

          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <p className="text-sm font-semibold text-text">NIM {nimLabel}</p>
              <p className="text-[11px] text-muted">Reporter</p>
            </div>
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-white">
              <UserIcon className="h-5 w-5" />
            </span>
            <button
              type="button"
              onClick={onLogout}
              className="hidden text-xs font-medium text-muted underline underline-offset-2 hover:text-text lg:block"
            >
              Keluar
            </button>
            <button
              type="button"
              className="inline-flex min-h-[40px] items-center gap-2 rounded-md border border-border bg-white px-3 text-sm font-medium text-text lg:hidden"
              aria-expanded={menuOpen}
              aria-controls="reporter-nav-mobile"
              onClick={() => setMenuOpen((open) => !open)}
            >
              <MenuIcon className="h-4 w-4" />
              Menu
            </button>
          </div>
        </div>

        <nav
          id="reporter-nav-mobile"
          aria-label="Navigasi utama (seluler)"
          className={`${menuOpen ? 'block' : 'hidden'} border-t border-[#e1e5e9] bg-white px-4 py-3 lg:hidden`}
        >
          <div className="flex flex-col gap-1">
            <div className="mb-2 border-b border-[#e1e5e9] pb-2 sm:hidden">
              <p className="text-sm font-semibold text-text">NIM {nimLabel}</p>
              <p className="text-[11px] text-muted">Reporter</p>
            </div>
            {NAV_ITEMS.map((item) => navLinkFor(item, unreadCount, () => setMenuOpen(false), true))}
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                onLogout();
              }}
              className="mt-2 inline-flex min-h-[40px] items-center rounded-[10px] px-4 text-left text-sm font-medium text-muted hover:bg-[#f7f9ff]"
            >
              Keluar
            </button>
          </div>
        </nav>
      </header>

      <div className="mx-auto w-full max-w-[1280px] px-4 py-8 md:px-12 md:py-12">{children}</div>

      <footer className="border-t border-[#e1e5e9] bg-white">
        <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-2 px-4 py-4 text-xs text-muted sm:flex-row sm:items-center sm:justify-between md:px-12">
          <p>© 2026 Universitas Pendidikan Indonesia. Seluruh hak cipta dilindungi.</p>
          <p>SCMS v1.0 · UMPER UPI Kampus Tasikmalaya</p>
        </div>
      </footer>
    </div>
  );
}
