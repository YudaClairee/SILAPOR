// Admin V2 shell: top institutional header + centered nav pill + user block,
// matching the current Figma admin dashboard (150:191). Same construction as
// ReporterShell (three zones, no sidebar); the admin portal opts into this from
// routes/admin.tsx, so every /admin/* page shares one header.
//
// Two nav entries expose a small dropdown ("Fasilitas & Aset", "Data Master &
// Parameter") built on native <details>, so the summary keeps its button/expand
// semantics for keyboard and screen readers. Native <details> alone never
// closes itself, though: after picking an item the panel stayed open until the
// summary was pressed again. NavGroupMenu adds the menu behaviour on top — it
// closes after an item is clicked (even when the item points at the current
// route), on any navigation incl. back/forward, on an outside click, and on
// Escape. Each summary also takes the active accent pill while one of its own
// descendants is the current page. The bell is decorative for now: the
// notification centre is reporter-only, so there is no admin unread count to
// show yet.
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentType,
  type ReactNode,
  type SVGProps,
} from 'react';
import { Link, useLocation } from '@tanstack/react-router';
import { BellIcon, ChevronDownIcon, GridIcon, LogoMark, MenuIcon } from './Icon';

export interface AdminShellUser {
  readonly username: string;
  /** NIP when the account carries one; admins usually have none. */
  readonly nip: string | null;
}

export interface AdminShellProps {
  readonly user: AdminShellUser;
  readonly onLogout: () => void;
  readonly children: ReactNode;
}

interface NavGroupItem {
  readonly to: string;
  readonly label: string;
}

interface NavLink {
  readonly kind: 'link';
  readonly to: string;
  readonly label: string;
  readonly Icon: ComponentType<SVGProps<SVGSVGElement>>;
  readonly exact?: boolean;
}

interface NavGroup {
  readonly kind: 'group';
  readonly label: string;
  readonly items: readonly NavGroupItem[];
}

const PRIMARY_NAV: readonly NavLink[] = [
  { kind: 'link', to: '/admin', label: 'Dashboard', Icon: GridIcon, exact: true },
  { kind: 'link', to: '/admin/reports', label: 'Kelola Laporan', Icon: GridIcon },
];

const GROUP_NAV: readonly NavGroup[] = [
  {
    kind: 'group',
    label: 'Fasilitas & Aset',
    items: [
      { to: '/admin/facilities', label: 'Kelola Aset' },
      { to: '/admin/facilities/history', label: 'Histori Perbaikan Aset' },
      { to: '/admin/locations', label: 'Lokasi Kampus' },
    ],
  },
  {
    kind: 'group',
    label: 'Data Master & Parameter',
    items: [
      { to: '/admin/master-data', label: 'Data Master Referensi' },
      { to: '/admin/categories', label: 'Kategori Fasilitas' },
      { to: '/admin/technicians', label: 'Teknisi' },
      { to: '/admin/scoring', label: 'Pengaturan Scoring' },
      { to: '/admin/maintenance-report', label: 'Laporan Maintenance' },
      { to: '/admin/analytics', label: 'Analitik' },
    ],
  },
];

/** Two uppercase initials for the avatar circle ("admin" → "AD"). */
function initialsOf(username: string): string {
  const cleaned = username.trim();
  if (cleaned === '') {
    return 'AD';
  }
  const words = cleaned.split(/[\s._-]+/).filter((word) => word !== '');
  if (words.length >= 2) {
    return `${(words[0] as string).charAt(0)}${(words[1] as string).charAt(0)}`.toUpperCase();
  }
  return cleaned.slice(0, 2).toUpperCase();
}

const NAV_LINK_CLASSES =
  'inline-flex min-h-[40px] items-center justify-center gap-2 rounded-[10px] px-4 text-sm font-medium text-[#202a33] transition-colors hover:bg-white/70 data-[status=active]:bg-accent data-[status=active]:text-white data-[status=active]:shadow-sm';

const GROUP_SUMMARY_BASE_CLASSES =
  'inline-flex min-h-[40px] cursor-pointer list-none items-center gap-2 rounded-[10px] px-4 text-sm font-medium transition-colors [&::-webkit-details-marker]:hidden';

// Resting vs. active tone are separate strings (not `data-[status=active]`
// utilities) so the active pill never fights the resting `hover:bg-white/70`.
const GROUP_SUMMARY_CLASSES = `${GROUP_SUMMARY_BASE_CLASSES} text-[#202a33] hover:bg-white/70`;

/** Same accent pill as an active nav link; the chevron inherits `currentColor`. */
const GROUP_SUMMARY_ACTIVE_CLASSES = `${GROUP_SUMMARY_BASE_CLASSES} bg-accent text-white shadow-sm hover:bg-accent`;

const GROUP_PANEL_CLASSES =
  'absolute left-0 top-[calc(100%+8px)] z-30 min-w-[220px] rounded-xl border border-[#e1e5e9] bg-white p-1.5 shadow-lg';

const GROUP_ITEM_CLASSES =
  'flex min-h-[40px] items-center rounded-lg px-3 text-sm text-[#202a33] hover:bg-[#f4f8fc]';

function linkFor(item: NavLink, mobile: boolean, onNavigate?: () => void): ReactNode {
  const Icon = item.Icon;
  return (
    <Link
      key={item.to}
      to={item.to}
      activeOptions={{ exact: item.exact ?? false, includeSearch: false }}
      activeProps={{ 'aria-current': 'page' }}
      className={mobile ? `${NAV_LINK_CLASSES} justify-start` : NAV_LINK_CLASSES}
      onClick={onNavigate}
    >
      {mobile ? <Icon className="h-4 w-4" /> : null}
      {item.label}
    </Link>
  );
}

interface NavGroupMenuProps {
  readonly group: NavGroup;
  readonly mobile: boolean;
  readonly onNavigate?: (() => void) | undefined;
}

/** `to` itself or anything below it (`/admin/facilities/MNT-…`, `/…/history`). */
function isPathWithin(pathname: string, to: string): boolean {
  return pathname === to || pathname.startsWith(`${to}/`);
}

/**
 * One nav dropdown. The markup stays native <details>; the effects below only
 * remove the "panel lingers until you press it again" behaviour.
 */
function NavGroupMenu({ group, mobile, onNavigate }: NavGroupMenuProps): ReactNode {
  const detailsRef = useRef<HTMLDetailsElement | null>(null);
  // Subscribing to the pathname covers navigations that never touch the links
  // below — browser back/forward and programmatic redirects.
  const pathname = useLocation({ select: (location) => location.pathname });

  const close = useCallback((): void => {
    const details = detailsRef.current;
    if (details !== null) {
      details.open = false;
    }
  }, []);

  // The group pill mirrors the nav links: it is active while any of its
  // descendants is the current page (including detail/history sub-paths).
  const groupActive = group.items.some((item) => isPathWithin(pathname, item.to));
  const summaryTone = groupActive ? GROUP_SUMMARY_ACTIVE_CLASSES : GROUP_SUMMARY_CLASSES;
  const summaryClassName = mobile ? `${summaryTone} w-full justify-between` : summaryTone;

  useEffect(() => {
    close();
  }, [pathname, close]);

  useEffect(() => {
    function handleOutsidePress(event: Event): void {
      const details = detailsRef.current;
      if (details === null || !details.open) {
        return;
      }
      const target = event.target;
      if (target instanceof Node && details.contains(target)) {
        return;
      }
      details.open = false;
    }
    function handleKeydown(event: KeyboardEvent): void {
      const details = detailsRef.current;
      if (event.key !== 'Escape' || details === null || !details.open) {
        return;
      }
      details.open = false;
      details.querySelector('summary')?.focus();
    }
    // `pointerdown` fires before the click and covers mouse/touch/pen;
    // `mousedown` keeps the same behaviour where pointer events are missing.
    document.addEventListener('pointerdown', handleOutsidePress);
    document.addEventListener('mousedown', handleOutsidePress);
    document.addEventListener('keydown', handleKeydown);
    return () => {
      document.removeEventListener('pointerdown', handleOutsidePress);
      document.removeEventListener('mousedown', handleOutsidePress);
      document.removeEventListener('keydown', handleKeydown);
    };
  }, []);

  function handleItemClick(): void {
    // Close right away: an item for the page we are already on does not change
    // the pathname, so the effect above would never run.
    close();
    onNavigate?.();
  }

  return (
    <div className={mobile ? '' : 'relative'}>
      <details ref={detailsRef} className="group">
        <summary
          className={summaryClassName}
          aria-current={groupActive ? 'true' : undefined}
        >
          {group.label}
          <ChevronDownIcon className="h-4 w-4 transition-transform group-open:rotate-180" />
        </summary>
        <div
          className={
            mobile
              ? 'mt-1 flex flex-col gap-0.5 border-l border-[#e1e5e9] pl-3'
              : GROUP_PANEL_CLASSES
          }
        >
          {group.items.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={GROUP_ITEM_CLASSES}
              activeProps={{ 'aria-current': 'page' }}
              onClick={handleItemClick}
            >
              {item.label}
            </Link>
          ))}
        </div>
      </details>
    </div>
  );
}

function navEntries(mobile: boolean, onNavigate?: (() => void) | undefined): ReactNode[] {
  return [
    ...PRIMARY_NAV.map((item) => linkFor(item, mobile, onNavigate)),
    ...GROUP_NAV.map((group) => (
      <NavGroupMenu key={group.label} group={group} mobile={mobile} onNavigate={onNavigate} />
    )),
  ];
}

export function AdminShell({ user, onLogout, children }: AdminShellProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const identity = user.nip === null ? 'Administrator' : `NIP ${user.nip}`;

  return (
    <div className="min-h-screen bg-[#f7f9ff] text-text">
      <header className="sticky top-0 z-20 border-b border-[#e1e5e9] bg-white" data-print="hide">
        <div className="mx-auto flex min-h-[64px] w-full max-w-[1600px] items-center justify-between gap-4 px-4 md:px-8">
          <Link
            to="/admin"
            search={{ from: '', to: '', month: '' }}
            className="flex min-w-0 items-center gap-3"
          >
            <LogoMark className="h-9 w-9 shrink-0" />
            <span className="min-w-0 border-l border-[#e1e5e9] pl-3">
              <span className="block truncate text-[11px] font-bold tracking-[0.3px] text-[#202a33]">
                UNIVERSITAS PENDIDIKAN INDONESIA
              </span>
              <span className="block truncate text-[11px] text-[#697784]">Kampus Tasikmalaya</span>
              <span className="mt-1 inline-block rounded bg-[#eef2f5] px-1.5 py-px text-[9px] font-semibold tracking-[0.08em] text-[#3f4c57]">
                UMPER
              </span>
            </span>
          </Link>

          <nav
            aria-label="Navigasi utama"
            className="hidden items-center gap-1 rounded-xl bg-[#ecf4ff] p-1 lg:flex"
          >
            {navEntries(false)}
          </nav>

          <div className="flex items-center gap-3">
            <span
              aria-hidden="true"
              title="Pusat notifikasi admin belum tersedia"
              className="hidden h-9 w-9 items-center justify-center rounded-full text-[#3f4c57] sm:flex"
            >
              <BellIcon className="h-5 w-5" />
            </span>
            <div className="hidden text-right sm:block">
              <p className="text-sm font-semibold text-[#202a33]">{user.username}</p>
              <p className="text-[11px] text-[#697784]">{identity}</p>
            </div>
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent text-[13px] font-semibold text-white">
              {initialsOf(user.username)}
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
              aria-expanded={menuOpen}
              aria-controls="admin-nav-mobile"
              onClick={() => setMenuOpen((open) => !open)}
              className="inline-flex min-h-[40px] items-center gap-2 rounded-md border border-border bg-white px-3 text-sm font-medium text-text lg:hidden"
            >
              <MenuIcon className="h-4 w-4" />
              Menu
            </button>
          </div>
        </div>

        <nav
          id="admin-nav-mobile"
          aria-label="Navigasi utama (seluler)"
          className={`${menuOpen ? 'block' : 'hidden'} border-t border-[#e1e5e9] bg-white px-4 py-3 lg:hidden`}
        >
          <div className="flex flex-col gap-1">
            <div className="mb-2 border-b border-[#e1e5e9] pb-2 sm:hidden">
              <p className="text-sm font-semibold text-[#202a33]">{user.username}</p>
              <p className="text-[11px] text-[#697784]">{identity}</p>
            </div>
            {navEntries(true, () => setMenuOpen(false))}
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

      <div className="mx-auto w-full max-w-[1600px] px-4 py-8 md:px-8 md:py-10">{children}</div>

      <footer className="border-t border-[#e1e5e9] bg-white" data-print="hide">
        <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-2 px-4 py-4 text-xs text-muted sm:flex-row sm:items-center sm:justify-between md:px-8">
          <p>© 2026 Universitas Pendidikan Indonesia. Seluruh hak cipta dilindungi.</p>
          <p>SCMS v1.0 · UPI Kampus Tasikmalaya</p>
        </div>
      </footer>
    </div>
  );
}
