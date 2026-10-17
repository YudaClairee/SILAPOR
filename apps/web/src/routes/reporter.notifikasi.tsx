// "Notifikasi" (Phase 6 P6-5b): the session reporter's in-app notifications
// (server-scoped — no other user's rows are possible). Read vs unread visual
// distinction, per-item "Tandai dibaca", and "Tandai semua dibaca"; rows link
// to the report detail via the joined ticket number when present. No
// pagination UI (contract has none); unread badge in the nav is deferred to
// UI styling. Indonesian copy, no styling framework.
import { useEffect, useState } from 'react';
import { Link, createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import {
  Button,
  EmptyState,
  ErrorPanel,
  LoadingState,
  TicketMono,
  buttonBaseClasses,
  buttonVariantClasses,
} from '../components/index.js';

interface NotificationItem {
  readonly id: string;
  readonly type: string;
  readonly title: string;
  readonly message: string;
  readonly reportId: string | null;
  readonly ticketNumber: string | null;
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
    <section aria-labelledby="notifikasi-title" className="max-w-3xl">
      <h1 id="notifikasi-title" className="text-2xl font-semibold text-text">
        Notifikasi
      </h1>
      <div className="mt-4">
        <LoadingState message="Memuat notifikasi…" />
      </div>
    </section>
  );
}

function formatDiterima(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
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
  const [markingId, setMarkingId] = useState<string | null>(null);
  const [markingAll, setMarkingAll] = useState(false);

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
    } catch {
      setActionError('Gagal menandai notifikasi dibaca. Periksa koneksi Anda lalu coba lagi.');
    } finally {
      setMarkingId(null);
    }
  }

  async function handleMarkAll(): Promise<void> {
    setMarkingAll(true);
    setActionError(null);
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
    } catch {
      setActionError(
        'Gagal menandai semua notifikasi dibaca. Periksa koneksi Anda lalu coba lagi.',
      );
    } finally {
      setMarkingAll(false);
    }
  }

  const unreadCount = list?.unreadCount ?? 0;

  return (
    <section aria-labelledby="notifikasi-title" className="max-w-3xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 id="notifikasi-title" className="text-2xl font-semibold text-text">
          Notifikasi
        </h1>
        <div>
          <Button
            type="button"
            variant="secondary"
            onClick={() => void handleMarkAll()}
            disabled={unreadCount === 0 || markingAll}
          >
            Tandai semua dibaca
          </Button>
        </div>
      </div>

      {clientPending ? (
        <div className="mt-4">
          <LoadingState message="Memuat notifikasi…" />
        </div>
      ) : null}

      {!clientPending && loadError !== null ? (
        <div className="mt-4">
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
          <div className="mt-4">
            <EmptyState
              title="Belum ada notifikasi"
              description="Pemberitahuan tentang laporan Anda akan muncul di sini."
              action={
                <Link
                  to="/reporter/reports"
                  search={{ filter: 'semua', status: '', offset: 0 }}
                  className={`${buttonBaseClasses} ${buttonVariantClasses.secondary}`}
                >
                  Lihat laporan saya
                </Link>
              }
            />
          </div>
        ) : (
          <>
            {actionError !== null ? (
              <div className="mt-4" role="alert">
                <p className="text-sm text-danger">{actionError}</p>
                <Button type="button" variant="ghost" onClick={() => void retryLoad()}>
                  Perbarui daftar
                </Button>
              </div>
            ) : null}
            <ul className="mt-4 divide-y divide-border rounded-md border border-border bg-surface">
              {list.items.map((item) => {
                const unread = item.readAt === null;
                return (
                  <li
                    key={item.id}
                    className={`flex flex-col gap-1 px-4 py-3 ${unread ? 'border-l-2 border-accent' : ''}`}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      {unread ? (
                        <span className="text-sm font-semibold text-text">Baru</span>
                      ) : null}
                      {item.ticketNumber !== null ? (
                        <Link
                          to="/reporter/reports/$ticket"
                          params={{ ticket: item.ticketNumber }}
                          className="text-accent underline underline-offset-2"
                        >
                          <TicketMono>{item.ticketNumber}</TicketMono>
                        </Link>
                      ) : null}
                      <span
                        className={
                          unread ? 'text-sm font-semibold text-text' : 'text-sm text-muted'
                        }
                      >
                        {item.title}
                      </span>
                    </div>
                    <p className={unread ? 'text-sm text-text' : 'text-sm text-muted'}>
                      {item.message}
                    </p>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <TicketMono className="text-xs text-subtle">
                        <time dateTime={item.createdAt}>{formatDiterima(item.createdAt)}</time>
                      </TicketMono>
                      {unread ? (
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() => void handleMarkRead(item.id)}
                          disabled={markingId === item.id}
                        >
                          Tandai dibaca
                        </Button>
                      ) : (
                        <span className="text-xs text-subtle">Sudah dibaca</span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
            <p className="mt-3 text-sm text-muted">
              {unreadCount} belum dibaca dari {list.total}
            </p>
          </>
        )
      ) : null}
    </section>
  );
}
