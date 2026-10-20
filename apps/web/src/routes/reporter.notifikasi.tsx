// "Notifikasi" (Figma PL-04 / node 90-1395, reporter V2): automatic updates
// about the session reporter's reports. Rows show the type glyph, the current
// report status, the ticket chip, and the asset/location meta that the server
// resolves (hidden/inactive locations degrade to null). Two client-side
// filters (Semua / Belum Dibaca) plus "Tandai Semua Telah Dibaca"; opening a
// ticket also marks that row read. No pagination (the contract has none).
import { useEffect, useState, type ComponentType, type SVGProps } from 'react';
import { Link, createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import {
  ActivityIcon,
  ArrowRightIcon,
  BellIcon,
  BriefcaseIcon,
  BuildingIcon,
  Button,
  CheckCircleIcon,
  CheckIcon,
  ClockIcon,
  CloseIcon,
  DoubleCheckIcon,
  EmptyState,
  ErrorPanel,
  LoadingState,
  LockIcon,
  MergeIcon,
  ShieldCheckIcon,
  TicketMono,
  buttonBaseClasses,
  buttonVariantClasses,
  statusBadgeClassesFor,
} from '../components/index.js';
import { statusLabel } from '../lib/admin-reports.js';
import { announceNotificationsChanged } from '../lib/notification-events.js';
import { formatJakartaDateTime } from '../lib/ticket-detail.js';

interface NotificationItem {
  readonly id: string;
  readonly type: string;
  readonly title: string;
  readonly message: string;
  readonly reportId: string | null;
  readonly ticketNumber: string | null;
  readonly reportStatus: string | null;
  readonly assetName: string | null;
  readonly locationName: string | null;
  readonly locationBuildingCode: string | null;
  readonly locationFloorNumber: number | null;
  readonly readAt: string | null;
  readonly createdAt: string;
}

interface NotificationListData {
  readonly items: NotificationItem[];
  readonly total: number;
  readonly unreadCount: number;
}

interface ListLoaderData {
  readonly list: NotificationListData | null;
  readonly loadError: string | null;
  readonly needsClientLoad: boolean;
}

type NotificationFilter = 'all' | 'unread';

// Decorative row glyph per notification type; unknown/legacy types fall back
// to the bell so a new backend kind can never break the list.
const NOTIFICATION_GLYPHS: Record<string, ComponentType<SVGProps<SVGSVGElement>>> = {
  STATUS_CHANGED: ActivityIcon,
  PROGRESS_NOTE_ADDED: ClockIcon,
  PUBLIC_UPDATE_ADDED: ClockIcon,
  REPORT_VERIFIED: ShieldCheckIcon,
  REPORT_ASSIGNED: BriefcaseIcon,
  REPORT_MARKED_DUPLICATE: MergeIcon,
  REPORT_RESOLVED: CheckCircleIcon,
  REPORT_CLOSED: LockIcon,
  REPORT_REJECTED: CloseIcon,
};

function NotificationGlyph({ type }: { readonly type: string }) {
  const Glyph = NOTIFICATION_GLYPHS[type] ?? BellIcon;
  return <Glyph className="h-5 w-5" />;
}

/** Asset + visible location, e.g. "Proyektor · R. Kuliah 12 · Gedung C · Lt. 3". */
function placeLabel(item: NotificationItem): string | null {
  const location =
    item.locationName === null
      ? null
      : [
          item.locationName,
          item.locationBuildingCode === null ? null : `Gedung ${item.locationBuildingCode}`,
          item.locationFloorNumber === null ? null : `Lt. ${item.locationFloorNumber}`,
        ]
          .filter((part): part is string => part !== null && part !== '')
          .join(' · ');
  const parts = [item.assetName, location].filter(
    (part): part is string => part !== null && part !== '',
  );
  return parts.length === 0 ? null : parts.join(' · ');
}

async function fetchList(): Promise<NotificationListData | 'unauthorized' | 'unavailable'> {
  let response: Response;
  try {
    response = await fetch('/api/notifications', { credentials: 'include' });
  } catch {
    return 'unavailable';
  }
  if (response.status === 401) {
    return 'unauthorized';
  }
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) {
    return 'unavailable';
  }
  try {
    return (await response.json()) as NotificationListData;
  } catch {
    return 'unavailable';
  }
}

export const Route = createFileRoute('/reporter/notifikasi')({
  loader: async (): Promise<ListLoaderData> => {
    const result = await fetchList();
    if (result === 'unauthorized') {
      throw redirect({ to: '/login' });
    }
    if (result === 'unavailable') {
      // SSR relative-URL fetch (or offline): the component loads client-side.
      return { list: null, loadError: null, needsClientLoad: true };
    }
    return { list: result, loadError: null, needsClientLoad: false };
  },
  pendingComponent: NotifikasiPending,
  component: NotifikasiPage,
});

function NotifikasiPending() {
  return (
    <section aria-labelledby="notifikasi-title">
      <h1 id="notifikasi-title" className="text-3xl font-bold tracking-tight text-text">
        Notifikasi
      </h1>
      <div className="mt-8">
        <LoadingState message="Memuat notifikasi…" />
      </div>
    </section>
  );
}

function NotifikasiPage() {
  const loaderData = Route.useLoaderData() as ListLoaderData;
  const navigate = useNavigate();

  // SSR fallback plus the locally updated list after a mark-read action.
  const [list, setList] = useState<NotificationListData | null>(
    loaderData.needsClientLoad ? null : (loaderData.list ?? null),
  );
  const [clientPending, setClientPending] = useState(loaderData.needsClientLoad);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [markingId, setMarkingId] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);
  const [filter, setFilter] = useState<NotificationFilter>('all');

  useEffect(() => {
    if (!loaderData.needsClientLoad) {
      setList(loaderData.list ?? null);
      setClientPending(false);
      return;
    }
    let cancelled = false;
    setClientPending(true);
    setLoadError(null);
    async function load(): Promise<void> {
      const result = await fetchList();
      if (cancelled) {
        return;
      }
      if (result === 'unauthorized') {
        await navigate({ to: '/login' });
        return;
      }
      if (result === 'unavailable') {
        setLoadError('Gagal memuat notifikasi. Periksa koneksi Anda lalu coba lagi.');
      } else {
        setList(result);
      }
      setClientPending(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [loaderData]);

  async function retryLoad(): Promise<void> {
    setClientPending(true);
    setLoadError(null);
    const result = await fetchList();
    if (result === 'unauthorized') {
      await navigate({ to: '/login' });
      return;
    }
    if (result === 'unavailable') {
      setLoadError('Gagal memuat notifikasi. Periksa koneksi Anda lalu coba lagi.');
    } else {
      setList(result);
    }
    setClientPending(false);
  }

  // The server only ever flips unread → read on POST, so the success branch
  // mirrors its semantics locally without a second round-trip.
  function applyReadLocally(id: string): void {
    setList((current) => {
      if (current === null || !current.items.some((item) => item.id === id)) {
        return current;
      }
      const readAt = new Date().toISOString();
      const items = current.items.map((item) =>
        item.id === id && item.readAt === null ? { ...item, readAt } : item,
      );
      return {
        ...current,
        items,
        unreadCount: items.filter((item) => item.readAt === null).length,
      };
    });
  }

  function applyAllReadLocally(): void {
    setList((current) =>
      current === null
        ? current
        : {
            ...current,
            items: current.items.map((item) =>
              item.readAt === null ? { ...item, readAt: new Date().toISOString() } : item,
            ),
            unreadCount: 0,
          },
    );
  }

  async function handleMarkRead(id: string): Promise<void> {
    setMarkingId(id);
    setActionError(null);
    try {
      const response = await fetch(`/api/notifications/${id}/read`, {
        method: 'POST',
        credentials: 'include',
      });
      if (response.status === 401) {
        await navigate({ to: '/login' });
        return;
      }
      if (!response.ok) {
        setActionError('Gagal menandai notifikasi dibaca. Coba lagi.');
        return;
      }
      applyReadLocally(id);
      announceNotificationsChanged();
    } catch {
      setActionError('Gagal menandai notifikasi dibaca. Periksa koneksi Anda lalu coba lagi.');
    } finally {
      setMarkingId(null);
    }
  }

  async function handleMarkAll(): Promise<void> {
    setMarkingAll(true);
    setActionError(null);
    setSuccessMessage(null);
    try {
      const response = await fetch('/api/notifications/read-all', {
        method: 'POST',
        credentials: 'include',
      });
      if (response.status === 401) {
        await navigate({ to: '/login' });
        return;
      }
      if (!response.ok) {
        setActionError('Gagal menandai semua notifikasi dibaca. Coba lagi.');
        return;
      }
      applyAllReadLocally();
      announceNotificationsChanged();
      setSuccessMessage('Semua notifikasi telah ditandai dibaca.');
    } catch {
      setActionError(
        'Gagal menandai semua notifikasi dibaca. Periksa koneksi Anda lalu coba lagi.',
      );
    } finally {
      setMarkingAll(false);
    }
  }

  const unreadCount = list?.unreadCount ?? 0;
  const totalCount = list?.total ?? 0;
  const visibleItems =
    list === null
      ? []
      : filter === 'all'
        ? list.items
        : list.items.filter((item) => item.readAt === null);
  const filters = [
    { id: 'all' as const, label: `Semua (${totalCount.toLocaleString('id-ID')})` },
    { id: 'unread' as const, label: `Belum Dibaca (${unreadCount.toLocaleString('id-ID')})` },
  ];

  return (
    <section aria-labelledby="notifikasi-title">
      <div className="flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 id="notifikasi-title" className="text-3xl font-bold tracking-tight text-text">
              Notifikasi
            </h1>
            {unreadCount > 0 ? (
              <span className="inline-flex items-center gap-2 rounded-full bg-[#d9eaf6] px-3 py-1 text-[13px] font-semibold text-[#0a3947]">
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-accent" />
                {unreadCount.toLocaleString('id-ID')} Belum Dibaca
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-[#e6f2eb] px-3 py-1 text-[13px] font-semibold text-[#1c6b46]">
                <CheckIcon className="h-3.5 w-3.5" aria-hidden="true" />
                Semua telah dibaca
              </span>
            )}
          </div>
          <p className="mt-2 max-w-[70ch] text-sm leading-6 text-[#4b5563]">
            Pemberitahuan otomatis terkait pembaruan status dan progres penanganan laporan sarana
            prasarana Anda di kampus UPI Tasikmalaya.
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row sm:items-center xl:shrink-0">
          <div
            role="group"
            aria-label="Filter notifikasi"
            className="flex items-center gap-1 rounded-lg bg-[#ecf4ff] p-1"
          >
            {filters.map((tab) => (
              <button
                key={tab.id}
                type="button"
                aria-pressed={filter === tab.id}
                onClick={() => setFilter(tab.id)}
                className={`inline-flex min-h-[40px] items-center rounded-md px-4 text-sm font-medium transition-colors ${
                  filter === tab.id
                    ? 'bg-accent text-white shadow-sm'
                    : 'text-[#4b5563] hover:bg-white/70'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <Button
            type="button"
            variant="secondary"
            className="border-transparent bg-white font-semibold shadow-sm"
            onClick={() => void handleMarkAll()}
            disabled={unreadCount === 0 || markingAll}
          >
            <DoubleCheckIcon className="h-4 w-4" aria-hidden="true" />
            {markingAll ? 'Menandai…' : 'Tandai Semua Telah Dibaca'}
          </Button>
        </div>
      </div>

      <p
        role="status"
        aria-live="polite"
        className={successMessage === null ? 'sr-only' : 'mt-4 text-sm font-medium text-[#1c6b46]'}
      >
        {successMessage ?? ''}
      </p>

      {actionError === null ? null : (
        <div
          role="alert"
          className="mt-4 flex flex-wrap items-center gap-3 rounded-lg bg-[#f5e4e2] px-4 py-3"
        >
          <p className="text-sm text-[#8f332c]">{actionError}</p>
          <Button
            type="button"
            variant="ghost"
            className="min-h-[32px] px-2 text-sm font-semibold text-[#8f332c] underline"
            onClick={() => void retryLoad()}
          >
            Perbarui daftar
          </Button>
        </div>
      )}

      {clientPending ? (
        <div className="mt-8">
          <LoadingState message="Memuat notifikasi…" />
        </div>
      ) : null}

      {!clientPending && loadError !== null ? (
        <div className="mt-8">
          <ErrorPanel
            message={loadError}
            retry={
              <Button type="button" variant="secondary" onClick={() => void retryLoad()}>
                Coba lagi
              </Button>
            }
          />
        </div>
      ) : null}

      {!clientPending && loadError === null && list !== null ? (
        list.items.length === 0 ? (
          <div className="mt-8">
            <EmptyState
              title="Belum ada notifikasi"
              description="Pemberitahuan tentang laporan Anda akan muncul di sini."
              action={
                <Link
                  to="/reporter"
                  search={{ search: '', mine: true, status: '', priority: '', offset: 0 }}
                  className={`${buttonBaseClasses} ${buttonVariantClasses.secondary}`}
                >
                  Lihat laporan saya
                </Link>
              }
            />
          </div>
        ) : visibleItems.length === 0 ? (
          <div className="mt-8">
            <EmptyState
              title="Semua notifikasi telah dibaca"
              description="Tidak ada pemberitahuan yang belum dibaca saat ini."
              action={
                <Button type="button" variant="secondary" onClick={() => setFilter('all')}>
                  Lihat semua notifikasi
                </Button>
              }
            />
          </div>
        ) : (
          <div className="mt-8 overflow-hidden rounded-xl border border-[#e1e5e9] bg-white shadow-sm">
            <ul className="divide-y divide-[#e1e5e9]">
              {visibleItems.map((item) => (
                <NotificationRow
                  key={item.id}
                  item={item}
                  marking={markingId === item.id}
                  onMarkRead={(id) => void handleMarkRead(id)}
                />
              ))}
            </ul>
          </div>
        )
      ) : null}
    </section>
  );
}

interface NotificationRowProps {
  readonly item: NotificationItem;
  readonly marking: boolean;
  readonly onMarkRead: (id: string) => void;
}

function NotificationRow({ item, marking, onMarkRead }: NotificationRowProps) {
  const unread = item.readAt === null;
  const place = placeLabel(item);

  return (
    <li className="flex flex-col gap-3 px-5 py-5 sm:px-6 sm:py-6 md:flex-row md:items-start md:gap-6">
      <div className="flex min-w-0 flex-1 items-start gap-4">
        <span className="relative mt-0.5 shrink-0">
          <span
            aria-hidden="true"
            className="flex h-12 w-12 items-center justify-center rounded-full bg-[#eef2f7] text-[#33424d]"
          >
            <NotificationGlyph type={item.type} />
          </span>
          {unread ? (
            <span
              aria-hidden="true"
              className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full border-2 border-white bg-accent"
            />
          ) : null}
        </span>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold leading-7 text-text">{item.title}</h2>
            {unread ? <span className="sr-only">Belum dibaca</span> : null}
            {item.reportStatus === null ? null : (
              <span className={statusBadgeClassesFor(item.reportStatus)}>
                <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
                {statusLabel(item.reportStatus)}
              </span>
            )}
            {item.ticketNumber === null ? null : (
              <TicketMono className="rounded bg-[#eef2f7] px-2 py-0.5 text-xs tracking-[0.02em] text-[#4b5563]">
                {item.ticketNumber}
              </TicketMono>
            )}
          </div>

          <p className="mt-1.5 text-sm leading-6 text-[#4b5563]">{item.message}</p>

          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[#697784]">
            {place === null ? null : (
              <>
                <span className="inline-flex min-w-0 items-center gap-1.5">
                  <BuildingIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span className="truncate">{place}</span>
                </span>
                <span aria-hidden="true">•</span>
              </>
            )}
            <span className="inline-flex items-center gap-1.5">
              <ClockIcon className="h-3.5 w-3.5" aria-hidden="true" />
              <TicketMono>
                <time dateTime={item.createdAt}>{formatJakartaDateTime(item.createdAt)}</time>
              </TicketMono>
            </span>
          </div>
        </div>
      </div>

      <div className="shrink-0 pl-16 md:pl-0">
        {item.ticketNumber === null ? (
          unread ? (
            <button
              type="button"
              onClick={() => onMarkRead(item.id)}
              disabled={marking}
              className="inline-flex min-h-[32px] items-center text-sm font-semibold text-[#0a6b74] hover:underline disabled:cursor-not-allowed disabled:opacity-50"
            >
              {marking ? 'Menandai…' : 'Tandai dibaca'}
            </button>
          ) : null
        ) : (
          <Link
            to="/reporter/reports/$ticket"
            params={{ ticket: item.ticketNumber }}
            onClick={() => {
              if (unread) onMarkRead(item.id);
            }}
            className="inline-flex min-h-[32px] items-center gap-1 text-sm font-semibold text-[#0a6b74] hover:underline"
          >
            Buka Detail Tiket
            <ArrowRightIcon className="h-4 w-4" aria-hidden="true" />
          </Link>
        )}
      </div>
    </li>
  );
}
