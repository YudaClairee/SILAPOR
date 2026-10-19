// Admin locations (EXECUTION-PLAN 9.4 + 10.2 /admin/locations): daftar +
// tambah + arsip via GET/POST /api/admin/locations dan PATCH item.
// SSR-fallback loader mengikuti admin.facilities.index.tsx.
import { useEffect, useState, type FormEvent } from 'react';
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import {
  Button,
  EmptyState,
  ErrorPanel,
  FieldError,
  Input,
  LoadingState,
  Select,
  TicketMono,
} from '../components/index.js';

interface Row {
  readonly id: string;
  readonly type: string;
  readonly code: string;
  readonly name: string;
  readonly buildingCode: string | null;
  readonly floorNumber: number | null;
  readonly isActive: boolean;
}

interface LoaderData {
  readonly rows: Row[] | null;
  readonly loadError: string | null;
  readonly forbidden: boolean;
  readonly needsClientLoad: boolean;
}

type Bundle =
  | { readonly rows: Row[] | null; readonly loadError: string | null; readonly forbidden: boolean }
  | 'unauthorized'
  | 'unavailable';

async function fetchList(includeInactive: boolean): Promise<Bundle> {
  let res: Response;
  try {
    res = await fetch('/api/admin/locations?includeInactive=' + (includeInactive ? 'true' : 'false') + '&limit=200', { credentials: 'include' });
  } catch {
    return 'unavailable';
  }
  if (res.status === 401) return 'unauthorized';
  if (res.status === 403) return { rows: null, loadError: null, forbidden: true };
  if (!res.ok) return { rows: null, loadError: 'Gagal memuat lokasi (' + res.status + ').', forbidden: false };
  try {
    return { rows: (await res.json()) as Row[], loadError: null, forbidden: false };
  } catch {
    return { rows: null, loadError: 'Respons lokasi tidak valid.', forbidden: false };
  }
}

async function errMsg(res: Response, fallback: string): Promise<string> {
  try {
    const d = (await res.json()) as { readonly error?: { readonly message?: unknown } };
    if (typeof d.error?.message === 'string' && d.error.message !== '') return d.error.message;
  } catch {}
  return fallback + ' (' + res.status + ').';
}

export const Route = createFileRoute('/admin/locations')({
  loader: async (): Promise<LoaderData> => {
    const r = await fetchList(false);
    if (r === 'unauthorized') throw redirect({ to: '/login' });
    if (r === 'unavailable') return { rows: null, loadError: null, forbidden: false, needsClientLoad: true };
    return { rows: r.rows, loadError: r.loadError, forbidden: r.forbidden, needsClientLoad: false };
  },
  pendingComponent: Pending,
  component: Page,
});

function Pending() {
  return (
    <section aria-labelledby="al-title">
      <h1 id="al-title" className="text-2xl font-semibold text-text">Kelola Lokasi</h1>
      <div className="mt-4"><LoadingState message="Memuat lokasi\u2026" /></div>
    </section>
  );
}

const TYPES = ['CAMPUS', 'BUILDING', 'FLOOR', 'ROOM', 'SHARED_AREA'] as const;

function Page() {
  const loader = Route.useLoaderData() as LoaderData;
  const navigate = useNavigate();
  const [rows, setRows] = useState<Row[] | null>(loader.needsClientLoad ? null : loader.rows);
  const [pending, setPending] = useState(loader.needsClientLoad);
  const [loadError, setLoadError] = useState<string | null>(loader.loadError);
  const [forbidden, setForbidden] = useState(loader.forbidden);
  const [showInactive, setShowInactive] = useState(false);
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<string>('ROOM');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [ferr, setFerr] = useState<string | null>(null);
  const [fpending, setFpending] = useState(false);
  const [aerr, setAerr] = useState<string | null>(null);
  const [aid, setAid] = useState<string | null>(null);

  async function reload(inc: boolean): Promise<void> {
    setPending(true);
    setLoadError(null);
    const r = await fetchList(inc);
    if (r === 'unauthorized') {
      await navigate({ to: '/login' });
      return;
    }
    if (r === 'unavailable') setLoadError('Tidak dapat terhubung ke server.');
    else {
      setRows(r.rows);
      setLoadError(r.loadError);
      setForbidden(r.forbidden);
    }
    setPending(false);
  }

  useEffect(() => {
    if (!loader.needsClientLoad) return;
    let c = false;
    void (async () => {
      const r = await fetchList(false);
      if (c) return;
      if (r === 'unauthorized') {
        await navigate({ to: '/login' });
        return;
      }
      if (r === 'unavailable') setLoadError('Tidak dapat terhubung ke server.');
      else {
        setRows(r.rows);
        setLoadError(r.loadError);
        setForbidden(r.forbidden);
      }
      setPending(false);
    })();
    return () => { c = true; };
  }, [loader.needsClientLoad, navigate]);

  async function onCreate(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (fpending) return;
    if (code.trim() === '' || name.trim() === '') {
      setFerr('Kode dan nama wajib diisi.');
      return;
    }
    setFpending(true);
    setFerr(null);
    try {
      const res = await fetch('/api/admin/locations', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type, code: code.trim(), name: name.trim() }),
      });
      if (!res.ok) {
        setFerr(await errMsg(res, 'Gagal membuat lokasi'));
        return;
      }
      setCode('');
      setName('');
      setOpen(false);
      await reload(showInactive);
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
      const res = await fetch('/api/admin/locations/' + encodeURIComponent(id), {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ is_active: !isActive }),
      });
      if (!res.ok) {
        setAerr(await errMsg(res, isActive ? 'Gagal mengarsipkan' : 'Gagal mengaktifkan'));
        return;
      }
      await reload(showInactive);
    } catch {
      setAerr('Tidak dapat terhubung ke server.');
    } finally {
      setAid(null);
    }
  }

  return (
    <section aria-labelledby="al-title">
      <h1 id="al-title" className="text-2xl font-semibold text-text">Kelola Lokasi</h1>
      <p className="mt-1 text-sm text-muted">Hierarki kampus, gedung, lantai, ruang. Arsip menonaktifkan tanpa menghapus histori.</p>
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button type="button" variant="secondary" onClick={() => setOpen((v) => !v)}>
          {open ? 'Tutup formulir' : 'Tambah lokasi'}
        </Button>
        <label className="flex items-center gap-2 text-sm text-muted">
          <input
            type="checkbox"
            checked={showInactive}
            onChange={(e) => {
              setShowInactive(e.target.checked);
              void reload(e.target.checked);
            }}
          />
          Tampilkan nonaktif
        </label>
      </div>
      {open ? (
        <form onSubmit={(e) => void onCreate(e)} className="mt-4 max-w-xl rounded-md border border-border bg-surface p-4">
          <div>
            <label htmlFor="loc-type" className="mb-1 block text-sm font-medium text-text">Tipe</label>
            <Select id="loc-type" value={type} onChange={(e) => setType(e.target.value)} disabled={fpending}>
              {TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </Select>
          </div>
          <div className="mt-3">
            <label htmlFor="loc-code" className="mb-1 block text-sm font-medium text-text">Kode</label>
            <Input id="loc-code" value={code} maxLength={64} placeholder="cth: C" onChange={(e) => setCode(e.target.value)} disabled={fpending} invalid={ferr !== null && code.trim() === ''} />
          </div>
          <div className="mt-3">
            <label htmlFor="loc-name" className="mb-1 block text-sm font-medium text-text">Nama</label>
            <Input id="loc-name" value={name} maxLength={128} placeholder="cth: Gedung C" onChange={(e) => setName(e.target.value)} disabled={fpending} invalid={ferr !== null && name.trim() === ''} />
          </div>
          {ferr !== null ? <div className="mt-3"><FieldError id="loc-ferr" message={ferr} /></div> : null}
          <div className="mt-4"><Button type="submit" disabled={fpending}>{fpending ? 'Menyimpan\u2026' : 'Simpan lokasi'}</Button></div>
        </form>
      ) : null}
      {pending ? (
        <div className="mt-4"><LoadingState message="Memuat lokasi\u2026" /></div>
      ) : loadError !== null ? (
        <div className="mt-4">
          <ErrorPanel message={loadError} retry={<Button type="button" variant="secondary" onClick={() => void reload(showInactive)}>Coba lagi</Button>} />
        </div>
      ) : forbidden ? (
        <div className="mt-4"><ErrorPanel title="Akses ditolak" message="Halaman ini hanya untuk admin." /></div>
      ) : rows === null || rows.length === 0 ? (
        <div className="mt-4"><EmptyState title="Belum ada lokasi" description="Tambah lokasi pertama melalui formulir di atas." /></div>
      ) : (
        <>
          {aerr !== null ? <div className="mt-4"><ErrorPanel message={aerr} /></div> : null}
          <div className="mt-4 overflow-x-auto rounded-md border border-border bg-surface">
            <table className="w-full min-w-180 border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th scope="col" className="px-3 py-2 text-xs font-medium text-muted">Kode</th>
                  <th scope="col" className="px-3 py-2 text-xs font-medium text-muted">Nama</th>
                  <th scope="col" className="px-3 py-2 text-xs font-medium text-muted">Tipe</th>
                  <th scope="col" className="px-3 py-2 text-xs font-medium text-muted">Status</th>
                  <th scope="col" className="px-3 py-2 text-xs font-medium text-muted">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td className="px-3 py-2"><TicketMono>{row.code}</TicketMono></td>
                    <td className="px-3 py-2 text-text">{row.name}</td>
                    <td className="px-3 py-2 text-muted">{row.type}</td>
                    <td className="px-3 py-2 text-muted">{row.isActive ? 'Aktif' : 'Nonaktif'}</td>
                    <td className="px-3 py-2">
                      <Button type="button" variant={row.isActive ? 'destructive' : 'secondary'} disabled={aid === row.id} onClick={() => void onToggle(row.id, row.isActive)}>
                        {aid === row.id ? 'Memproses\u2026' : row.isActive ? 'Arsipkan' : 'Aktifkan'}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-sm text-muted">{rows.length} lokasi ditampilkan.</p>
        </>
      )}
    </section>
  );
}
