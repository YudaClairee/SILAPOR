// Admin technicians — Kelola Teknisi (Figma 150:1484 / PNG admin/UMPER):
// breadcrumb + header + CTA, kartu filter (pencarian + ketersediaan +
// toggle nonaktif), tabel ID/Nama/Spesialisasi/Status ketersediaan/Jumlah
// tugas aktif/Status data/Aksi (Ubah + Nonaktifkan/Aktifkan), footer
// "Menampilkan a–b dari N" + paginasi sederhana.
//
// Backend hari ini: GET /api/admin/technicians (id, technicianCode,
// displayName, specialty, isActive) + GET /api/admin/analytics/overview
// → technicianWorkload (technicianId → activeCount). Kolom ketersediaan
// (Tersedia/Tidak Tersedia) dan filter ketersediaan BELUM ada di backend —
// halaman ini menurunkannya sementara dari beban tugas (0 tugas = Tersedia)
// sampai backend menyediakan field availability. Lihat AVAILABILITY_NOTE.
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import {
  Button,
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  EmptyState,
  ErrorPanel,
  FieldError,
  Input,
  LoadingState,
  PlusIcon,
  SearchIcon,
  Select,
  TicketMono,
  buttonBaseClasses,
  buttonVariantClasses,
} from '../components/index.js';

interface TechRow {
  readonly id: string;
  readonly technicianCode: string;
  readonly displayName: string;
  readonly specialty: string | null;
  readonly isActive: boolean;
}

interface LoaderData {
  readonly rows: TechRow[] | null;
  readonly workload: ReadonlyMap<string, number> | null;
  readonly loadError: string | null;
  readonly forbidden: boolean;
  readonly needsClientLoad: boolean;
}

type Bundle =
  | {
      readonly rows: TechRow[] | null;
      readonly workload: ReadonlyMap<string, number> | null;
      readonly loadError: string | null;
      readonly forbidden: boolean;
    }
  | 'unauthorized'
  | 'unavailable';

/** Jumlah baris per halaman. Desain PNG menampilkan 6 baris penuh. */
const PAGE_SIZE = 6;

/**
 * KETIDAKSESUAIAN BACKEND (dilaporkan ke pemilik backend):
 * 1. `technicians` tidak punya kolom availability — desain butuh status
 *    "Tersedia / Tidak Tersedia" + filter "Semua Ketersediaan". Sementara:
 *    teknisi nonaktif → "Tidak Tersedia"; teknisi aktif dengan 0 tugas aktif
 *    → "Tersedia"; teknisi aktif dengan >=1 tugas aktif → "Tersedia".
 *    Badge "Tidak Tersedia" hanya muncul untuk teknisi nonaktif sampai
 *    backend menambah field availability (mis. boolean `is_available` +
 *    endpoint PATCH + filter query `availability=`).
 * 2. Daftar teknisi tidak membawa `activeCount` — halaman menggabungkan dari
 *    `technicianWorkload` milik GET /api/admin/analytics/overview (satu
 *    request tambahan). Idealnya GET /api/admin/technicians mengembalikan
 *    `activeCount` per baris (aktif = ASSIGNED/INSPECTION/IN_REPAIR).
 * 3. Tidak ada pencarian/filter/paginasi server-side untuk teknisi —
 *    pencarian nama/spesialisasi + paginasi dilakukan client-side. Untuk
 *    dataset besar, backend perlu `?search=` + `total/limit/offset`.
 * 4. PATCH nonaktif tidak menolak saat teknisi masih punya tugas aktif —
 *    backend perlu guard 409 + pesan "masih memiliki N tugas aktif".
 * AVAILABILITY_NOTE
 */
function availabilityOf(row: TechRow, activeCount: number): 'available' | 'unavailable' {
  if (!row.isActive) return 'unavailable';
  void activeCount;
  return 'available';
}

function parseWorkload(value: unknown): ReadonlyMap<string, number> | null {
  if (value === null || typeof value !== 'object') return null;
  const record = value as { readonly technicianWorkload?: unknown };
  if (!Array.isArray(record.technicianWorkload)) return null;
  const map = new Map<string, number>();
  for (const entry of record.technicianWorkload as readonly unknown[]) {
    if (entry === null || typeof entry !== 'object') continue;
    const row = entry as { readonly technicianId?: unknown; readonly activeCount?: unknown };
    if (typeof row.technicianId === 'string' && typeof row.activeCount === 'number') {
      map.set(row.technicianId, row.activeCount);
    }
  }
  return map;
}

async function fetchBundle(): Promise<Bundle> {
  let techRes: Response;
  let workloadRes: Response | null = null;
  try {
    [techRes, workloadRes] = await Promise.all([
      fetch('/api/admin/technicians?includeInactive=true&limit=200', { credentials: 'include' }),
      fetch('/api/admin/analytics/overview', { credentials: 'include' }).catch(() => null),
    ]);
  } catch {
    return 'unavailable';
  }
  if (techRes.status === 401) return 'unauthorized';
  if (techRes.status === 403)
    return { rows: null, workload: null, loadError: null, forbidden: true };
  if (!techRes.ok)
    return {
      rows: null,
      workload: null,
      loadError: 'Gagal memuat teknisi (' + techRes.status + ').',
      forbidden: false,
    };
  try {
    const rows = (await techRes.json()) as TechRow[];
    let workload: ReadonlyMap<string, number> | null = null;
    if (workloadRes !== null && workloadRes.ok) {
      try {
        workload = parseWorkload(await workloadRes.json());
      } catch {
        workload = null;
      }
    }
    return { rows, workload, loadError: null, forbidden: false };
  } catch {
    return {
      rows: null,
      workload: null,
      loadError: 'Respons teknisi tidak valid.',
      forbidden: false,
    };
  }
}

async function errMsg(res: Response, fb: string): Promise<string> {
  try {
    const d = (await res.json()) as { readonly error?: { readonly message?: unknown } };
    if (typeof d.error?.message === 'string' && d.error.message !== '') return d.error.message;
  } catch {}
  return fb + ' (' + res.status + ').';
}

export const Route = createFileRoute('/admin/technicians')({
  loader: async (): Promise<LoaderData> => {
    const r = await fetchBundle();
    if (r === 'unauthorized') throw redirect({ to: '/login' });
    if (r === 'unavailable')
      return {
        rows: null,
        workload: null,
        loadError: null,
        forbidden: false,
        needsClientLoad: true,
      };
    return {
      rows: r.rows,
      workload: r.workload,
      loadError: r.loadError,
      forbidden: r.forbidden,
      needsClientLoad: false,
    };
  },
  pendingComponent: Pending,
  component: Page,
});

function Pending() {
  return (
    <section aria-labelledby="at-title">
      <p className="text-sm text-muted">
        Data Master &amp; Parameter › <span className="font-medium text-text">Kelola Teknisi</span>
      </p>
      <h1 id="at-title" className="mt-2 text-[34px] font-bold leading-tight text-text">
        Kelola Teknisi
      </h1>
      <div className="mt-4">
        <LoadingState message="Memuat teknisi…" />
      </div>
    </section>
  );
}

type ModalState =
  | { readonly kind: 'closed' }
  | { readonly kind: 'create' }
  | { readonly kind: 'edit'; readonly row: TechRow };

const AVAILABILITY_OPTIONS = [
  { value: 'all', label: 'Semua Ketersediaan' },
  { value: 'available', label: 'Tersedia' },
  { value: 'unavailable', label: 'Tidak Tersedia' },
] as const;

function Page() {
  const loader = Route.useLoaderData() as LoaderData;
  const navigate = useNavigate();
  const [rows, setRows] = useState<TechRow[] | null>(loader.needsClientLoad ? null : loader.rows);
  const [workload, setWorkload] = useState<ReadonlyMap<string, number> | null>(
    loader.needsClientLoad ? null : loader.workload,
  );
  const [pending, setPending] = useState(loader.needsClientLoad);
  const [loadError, setLoadError] = useState<string | null>(loader.loadError);
  const [forbidden, setForbidden] = useState(loader.forbidden);
  const [query, setQuery] = useState('');
  const [availability, setAvailability] = useState<'all' | 'available' | 'unavailable'>('all');
  const [showInactive, setShowInactive] = useState(false);
  const [page, setPage] = useState(0);
  const [modal, setModal] = useState<ModalState>({ kind: 'closed' });
  const [code, setCode] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [specialty, setSpecialty] = useState('');
  const [ferr, setFerr] = useState<string | null>(null);
  const [fpending, setFpending] = useState(false);
  const [aerr, setAerr] = useState<string | null>(null);
  const [aid, setAid] = useState<string | null>(null);

  async function reload(): Promise<void> {
    setPending(true);
    const r = await fetchBundle();
    if (r === 'unauthorized') {
      await navigate({ to: '/login' });
      return;
    }
    if (r === 'unavailable') setLoadError('Tidak dapat terhubung ke server.');
    else {
      setRows(r.rows);
      setWorkload(r.workload);
      setLoadError(r.loadError);
      setForbidden(r.forbidden);
    }
    setPending(false);
  }

  useEffect(() => {
    if (!loader.needsClientLoad) return;
    let c = false;
    void (async () => {
      const r = await fetchBundle();
      if (c) return;
      if (r === 'unauthorized') {
        await navigate({ to: '/login' });
        return;
      }
      if (r === 'unavailable') setLoadError('Tidak dapat terhubung ke server.');
      else {
        setRows(r.rows);
        setWorkload(r.workload);
        setLoadError(r.loadError);
        setForbidden(r.forbidden);
      }
      setPending(false);
    })();
    return () => {
      c = true;
    };
  }, [loader.needsClientLoad, navigate]);

  const filtered = useMemo(() => {
    const list = rows ?? [];
    const q = query.trim().toLowerCase();
    return list.filter((row) => {
      if (!showInactive && !row.isActive) return false;
      const status = availabilityOf(row, workload?.get(row.id) ?? 0);
      if (availability !== 'all' && status !== availability) return false;
      if (q === '') return true;
      const hay = `${row.displayName} ${row.specialty ?? ''} ${row.technicianCode}`.toLowerCase();
      return hay.includes(q);
    });
  }, [rows, workload, query, availability, showInactive]);

  useEffect(() => {
    setPage(0);
  }, [query, availability, showInactive, rows]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageRows = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
  const rangeFrom = filtered.length === 0 ? 0 : safePage * PAGE_SIZE + 1;
  const rangeTo = Math.min(filtered.length, safePage * PAGE_SIZE + PAGE_SIZE);
  const totalRegistered = rows?.length ?? 0;

  function openCreate(): void {
    setCode('');
    setDisplayName('');
    setSpecialty('');
    setFerr(null);
    setModal({ kind: 'create' });
  }

  function openEdit(row: TechRow): void {
    setCode(row.technicianCode);
    setDisplayName(row.displayName);
    setSpecialty(row.specialty ?? '');
    setFerr(null);
    setModal({ kind: 'edit', row });
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (fpending || modal.kind === 'closed') return;
    if (code.trim() === '' || displayName.trim() === '') {
      setFerr('Kode dan nama tampilan wajib diisi.');
      return;
    }
    setFpending(true);
    setFerr(null);
    try {
      const payload = {
        technicianCode: code.trim(),
        displayName: displayName.trim(),
        specialty: specialty.trim() === '' ? null : specialty.trim(),
      };
      const res =
        modal.kind === 'create'
          ? await fetch('/api/admin/technicians', {
              method: 'POST',
              credentials: 'include',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(payload),
            })
          : await fetch('/api/admin/technicians/' + encodeURIComponent(modal.row.id), {
              method: 'PATCH',
              credentials: 'include',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(payload),
            });
      if (!res.ok) {
        setFerr(
          await errMsg(
            res,
            modal.kind === 'create' ? 'Gagal menambah teknisi' : 'Gagal menyimpan perubahan',
          ),
        );
        return;
      }
      setModal({ kind: 'closed' });
      await reload();
    } catch {
      setFerr('Tidak dapat terhubung ke server.');
    } finally {
      setFpending(false);
    }
  }

  async function onToggle(id: string, isActive: boolean): Promise<void> {
    setAid(id);
    setAerr(null);
    try {
      const res = await fetch('/api/admin/technicians/' + encodeURIComponent(id), {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ is_active: !isActive }),
      });
      if (!res.ok) {
        setAerr(await errMsg(res, isActive ? 'Gagal menonaktifkan' : 'Gagal mengaktifkan'));
        return;
      }
      await reload();
    } catch {
      setAerr('Tidak dapat terhubung ke server.');
    } finally {
      setAid(null);
    }
  }

  return (
    <section aria-labelledby="at-title" className="w-full">
      <p className="text-sm text-muted">
        Data Master &amp; Parameter ›{' '}
        <span className="font-medium text-accent">Kelola Teknisi</span>
      </p>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 max-w-3xl">
          <h1 id="at-title" className="text-[34px] font-bold leading-tight text-text">
            Kelola Teknisi
          </h1>
          <p className="mt-2 text-[15px] leading-relaxed text-muted">
            Kelola daftar teknisi lapangan, spesialisasi, status ketersediaan, dan pantau jumlah
            tugas aktif dalam pemeliharaan kampus.
          </p>
        </div>
        <Button type="button" onClick={openCreate} className="shrink-0 rounded-lg px-5">
          <PlusIcon className="h-4 w-4" /> Tambah Teknisi
        </Button>
      </div>

      <div className="mt-6 flex flex-col gap-4 rounded-2xl border border-border bg-surface px-5 py-4 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div className="relative w-full lg:max-w-xl">
          <SearchIcon className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-subtle" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Cari nama atau spesialisasi teknisi…"
            aria-label="Cari nama atau spesialisasi teknisi"
            className="min-h-[48px] w-full rounded-lg border border-transparent bg-background pl-12 pr-4 text-[15px] text-text placeholder:text-subtle"
          />
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-[14px] text-text">
            <span className="font-medium">Ketersediaan:</span>
            <span className="relative inline-flex items-center">
              <select
                value={availability}
                onChange={(e) =>
                  setAvailability(e.target.value as 'all' | 'available' | 'unavailable')
                }
                aria-label="Filter ketersediaan"
                className="min-h-[44px] cursor-pointer appearance-none rounded-lg bg-background py-2 pl-4 pr-9 text-[14px] font-semibold text-text"
              >
                {AVAILABILITY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <span
                aria-hidden="true"
                className="pointer-events-none absolute right-3 flex flex-col text-[10px] leading-none text-muted"
              >
                ▲▼
              </span>
            </span>
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-[14px] font-medium text-text">
            <button
              type="button"
              role="switch"
              aria-checked={showInactive}
              aria-label="Tampilkan teknisi nonaktif"
              onClick={() => setShowInactive((v) => !v)}
              className="relative inline-flex h-7 w-12 items-center rounded-full bg-[#0a3947] transition-colors"
            >
              <span
                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${showInactive ? 'translate-x-6' : 'translate-x-1'}`}
              />
            </button>
            Tampilkan teknisi nonaktif
          </label>
        </div>
      </div>
      {pending ? (
        <div className="mt-5">
          <LoadingState message="Memuat teknisi…" />
        </div>
      ) : loadError !== null ? (
        <div className="mt-5">
          <ErrorPanel
            message={loadError}
            retry={
              <Button type="button" variant="secondary" onClick={() => void reload()}>
                Coba lagi
              </Button>
            }
          />
        </div>
      ) : forbidden ? (
        <div className="mt-5">
          <ErrorPanel title="Akses ditolak" message="Halaman ini hanya untuk admin." />
        </div>
      ) : (rows ?? []).length === 0 ? (
        <div className="mt-5">
          <EmptyState
            title="Belum ada teknisi"
            description="Tambah teknisi pertama melalui tombol Tambah Teknisi."
            action={
              <Button type="button" onClick={openCreate}>
                <PlusIcon className="h-4 w-4" /> Tambah Teknisi
              </Button>
            }
          />
        </div>
      ) : filtered.length === 0 ? (
        <div className="mt-5">
          <EmptyState
            title="Tidak ada hasil"
            description="Ubah kata kunci, filter ketersediaan, atau tampilkan teknisi nonaktif."
          />
        </div>
      ) : (
        <div className="mt-5 overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
          {aerr !== null ? (
            <div className="px-6 pt-4">
              <ErrorPanel message={aerr} />
            </div>
          ) : null}
          <div className="overflow-x-auto">
            <table className="w-full min-w-240 border-collapse text-left">
              <thead>
                <tr className="bg-[#f2f6fb]">
                  <th
                    scope="col"
                    className="px-6 py-4 text-[11px] font-semibold uppercase tracking-[0.09em] text-[#5a6b7d]"
                  >
                    ID Teknisi
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-4 text-[11px] font-semibold uppercase tracking-[0.09em] text-[#5a6b7d]"
                  >
                    Nama Teknisi
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-4 text-[11px] font-semibold uppercase tracking-[0.09em] text-[#5a6b7d]"
                  >
                    Spesialisasi
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-4 text-[11px] font-semibold uppercase tracking-[0.09em] text-[#5a6b7d]"
                  >
                    Status Ketersediaan
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-4 text-[11px] font-semibold uppercase tracking-[0.09em] text-[#5a6b7d]"
                  >
                    Jumlah Tugas Aktif
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-4 text-[11px] font-semibold uppercase tracking-[0.09em] text-[#5a6b7d]"
                  >
                    Status Data
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-4 text-right text-[11px] font-semibold uppercase tracking-[0.09em] text-[#5a6b7d]"
                  >
                    Aksi
                  </th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((r) => {
                  const activeCount = workload?.get(r.id) ?? 0;
                  const available = availabilityOf(r, activeCount) === 'available';
                  return (
                    <tr
                      key={r.id}
                      className="border-t border-[#e8edf3] align-middle transition-colors hover:bg-[#fafcff]"
                    >
                      <td className="whitespace-nowrap px-6 py-4">
                        <TicketMono className="text-[14px] font-semibold text-text">
                          {r.technicianCode}
                        </TicketMono>
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-[14px] font-medium text-text">
                        {r.displayName}
                      </td>
                      <td className="px-6 py-4 text-[14px] text-muted">{r.specialty ?? '—'}</td>
                      <td className="whitespace-nowrap px-6 py-4">
                        <span
                          className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[13px] font-medium ${available ? 'bg-[#e6f4ec] text-[#1e7a45]' : 'bg-[#fdf1d7] text-[#b87512]'}`}
                        >
                          <span
                            aria-hidden="true"
                            className={`h-1.5 w-1.5 rounded-full ${available ? 'bg-[#1e9e55]' : 'bg-[#e39a0b]'}`}
                          />
                          {available ? 'Tersedia' : 'Tidak Tersedia'}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-[14px] text-muted">
                        {activeCount} tugas aktif
                      </td>
                      <td className="whitespace-nowrap px-6 py-4">
                        <span
                          className={`inline-flex items-center rounded-full px-3 py-1.5 text-[13px] font-semibold ${r.isActive ? 'bg-[#e6f4ec] text-[#1e7a45]' : 'bg-[#eceff1] text-[#525d66]'}`}
                        >
                          {r.isActive ? 'Aktif' : 'Nonaktif'}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-right text-[14px]">
                        <button
                          type="button"
                          onClick={() => openEdit(r)}
                          className="font-medium text-accent hover:underline"
                        >
                          Ubah
                        </button>
                        <span aria-hidden="true" className="mx-2 text-border">
                          ·
                        </span>
                        <button
                          type="button"
                          disabled={aid === r.id}
                          onClick={() => void onToggle(r.id, r.isActive)}
                          className={`font-medium ${r.isActive ? 'text-danger hover:underline' : 'text-accent hover:underline'} disabled:cursor-not-allowed disabled:opacity-50`}
                        >
                          {aid === r.id ? 'Memproses…' : r.isActive ? 'Nonaktifkan' : 'Aktifkan'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="flex flex-col gap-3 border-t border-[#e8edf3] bg-[#f8fafc] px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[14px] text-[#5c6b7a]">
              Menampilkan {rangeFrom}–{rangeTo} dari {filtered.length} teknisi terdaftar
              {totalRegistered !== filtered.length ? ` (total ${totalRegistered})` : ''}
            </p>
            <nav aria-label="Paginasi teknisi" className="flex items-center gap-1">
              <button
                type="button"
                aria-label="Halaman sebelumnya"
                disabled={safePage === 0}
                onClick={() => setPage(safePage - 1)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-md text-[#3f4c57] hover:bg-[#eef3fb] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronLeftIcon className="h-4 w-4" />
              </button>
              {Array.from({ length: totalPages }, (_, i) => i).map((i) => (
                <button
                  key={i}
                  type="button"
                  aria-label={`Halaman ${i + 1}`}
                  aria-current={i === safePage ? 'page' : undefined}
                  onClick={() => setPage(i)}
                  className={`inline-flex h-9 min-w-9 items-center justify-center rounded-md px-2 text-[14px] font-medium ${i === safePage ? 'bg-accent text-white' : 'text-[#3f4c57] hover:bg-[#eef3fb]'}`}
                >
                  {i + 1}
                </button>
              ))}
              <button
                type="button"
                aria-label="Halaman berikutnya"
                disabled={safePage >= totalPages - 1}
                onClick={() => setPage(safePage + 1)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-md text-[#3f4c57] hover:bg-[#eef3fb] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronRightIcon className="h-4 w-4" />
              </button>
            </nav>
          </div>
        </div>
      )}

      {modal.kind === 'closed' ? null : (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="tech-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        >
          <div className="w-full max-w-lg rounded-2xl border border-border bg-surface p-6 shadow-lg">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="tech-modal-title" className="text-lg font-semibold text-text">
                  {modal.kind === 'create' ? 'Tambah Teknisi' : 'Ubah Teknisi'}
                </h2>
                <p className="mt-1 text-sm text-muted">
                  {modal.kind === 'create'
                    ? 'Teknisi tanpa akun; nama disembunyikan dari pelapor.'
                    : `Menyunting ${modal.row.technicianCode} — ${modal.row.displayName}.`}
                </p>
              </div>
              <button
                type="button"
                aria-label="Tutup dialog"
                onClick={() => setModal({ kind: 'closed' })}
                className="rounded-md p-2 text-muted hover:bg-background"
              >
                <CloseIcon className="h-4 w-4" />
              </button>
            </div>
            <form onSubmit={(e) => void onSubmit(e)} className="mt-4 grid gap-3">
              <div>
                <label htmlFor="tech-code" className="mb-1 block text-sm font-medium text-text">
                  Kode / ID Teknisi
                </label>
                <Input
                  id="tech-code"
                  value={code}
                  maxLength={64}
                  placeholder="cth: TEK-07"
                  onChange={(e) => setCode(e.target.value)}
                  disabled={fpending}
                  invalid={ferr !== null && code.trim() === ''}
                  aria-describedby={ferr !== null ? 'tech-modal-err' : undefined}
                />
              </div>
              <div>
                <label htmlFor="tech-name" className="mb-1 block text-sm font-medium text-text">
                  Nama teknisi
                </label>
                <Input
                  id="tech-name"
                  value={displayName}
                  maxLength={128}
                  placeholder="cth: Budi Santoso"
                  onChange={(e) => setDisplayName(e.target.value)}
                  disabled={fpending}
                  invalid={ferr !== null && displayName.trim() === ''}
                  aria-describedby={ferr !== null ? 'tech-modal-err' : undefined}
                />
              </div>
              <div>
                <label htmlFor="tech-sp" className="mb-1 block text-sm font-medium text-text">
                  Spesialisasi
                </label>
                <Input
                  id="tech-sp"
                  value={specialty}
                  maxLength={128}
                  placeholder="cth: Kelistrikan & Penerangan"
                  onChange={(e) => setSpecialty(e.target.value)}
                  disabled={fpending}
                />
              </div>
              {modal.kind === 'edit' ? (
                <div>
                  <label htmlFor="tech-status" className="mb-1 block text-sm font-medium text-text">
                    Status data
                  </label>
                  <Select
                    id="tech-status"
                    value={modal.row.isActive ? 'active' : 'inactive'}
                    disabled
                    aria-describedby="tech-status-hint"
                  >
                    <option value="active">Aktif</option>
                    <option value="inactive">Nonaktif</option>
                  </Select>
                  <p id="tech-status-hint" className="mt-1 text-xs text-muted">
                    Ubah status lewat aksi Nonaktifkan/Aktifkan di tabel.
                  </p>
                </div>
              ) : null}
              {ferr !== null ? <FieldError id="tech-modal-err" message={ferr} /> : null}
              <div className="mt-1 flex flex-wrap justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setModal({ kind: 'closed' })}
                  className={`${buttonBaseClasses} ${buttonVariantClasses.secondary}`}
                >
                  Batal
                </button>
                <Button type="submit" disabled={fpending}>
                  {fpending
                    ? 'Menyimpan…'
                    : modal.kind === 'create'
                      ? 'Tambah teknisi'
                      : 'Simpan perubahan'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
}
