// Admin technicians (EXECUTION-PLAN 9.4 + 10.2 /admin/technicians): daftar +
// tambah + arsip. Tanpa akun; nama disembunyikan dari pelapor (No. 9).
import { useEffect, useState, type FormEvent } from 'react';
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import {
  Button,
  EmptyState,
  ErrorPanel,
  FieldError,
  Input,
  LoadingState,
  TicketMono,
} from '../components/index.js';

interface Row {
  readonly id: string;
  readonly technicianCode: string;
  readonly displayName: string;
  readonly specialty: string | null;
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

async function fetchList(): Promise<Bundle> {
  let res: Response;
  try {
    res = await fetch('/api/admin/technicians?includeInactive=true&limit=200', { credentials: 'include' });
  } catch {
    return 'unavailable';
  }
  if (res.status === 401) return 'unauthorized';
  if (res.status === 403) return { rows: null, loadError: null, forbidden: true };
  if (!res.ok) return { rows: null, loadError: 'Gagal memuat teknisi (' + res.status + ').', forbidden: false };
  try {
    return { rows: (await res.json()) as Row[], loadError: null, forbidden: false };
  } catch {
    return { rows: null, loadError: 'Respons teknisi tidak valid.', forbidden: false };
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
    const r = await fetchList();
    if (r === 'unauthorized') throw redirect({ to: '/login' });
    if (r === 'unavailable') return { rows: null, loadError: null, forbidden: false, needsClientLoad: true };
    return { rows: r.rows, loadError: r.loadError, forbidden: r.forbidden, needsClientLoad: false };
  },
  pendingComponent: Pending,
  component: Page,
});

function Pending() {
  return (
    <section aria-labelledby="at-title">
      <h1 id="at-title" className="text-2xl font-semibold text-text">Kelola Teknisi</h1>
      <div className="mt-4"><LoadingState message="Memuat\u2026" /></div>
    </section>
  );
}

function Page() {
  const loader = Route.useLoaderData() as LoaderData;
  const navigate = useNavigate();
  const [rows, setRows] = useState<Row[] | null>(loader.needsClientLoad ? null : loader.rows);
  const [pending, setPending] = useState(loader.needsClientLoad);
  const [loadError, setLoadError] = useState<string | null>(loader.loadError);
  const [forbidden, setForbidden] = useState(loader.forbidden);
  const [code, setCode] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [specialty, setSpecialty] = useState('');
  const [ferr, setFerr] = useState<string | null>(null);
  const [fpending, setFpending] = useState(false);
  const [aerr, setAerr] = useState<string | null>(null);
  const [aid, setAid] = useState<string | null>(null);

  async function reload(): Promise<void> {
    setPending(true);
    const r = await fetchList();
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
      const r = await fetchList();
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
    if (code.trim() === '' || displayName.trim() === '') {
      setFerr('Kode dan nama tampilan wajib diisi.');
      return;
    }
    setFpending(true);
    setFerr(null);
    try {
      const res = await fetch('/api/admin/technicians', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          technicianCode: code.trim(),
          displayName: displayName.trim(),
          specialty: specialty.trim() === '' ? null : specialty.trim(),
        }),
      });
      if (!res.ok) {
        setFerr(await errMsg(res, 'Gagal menambah teknisi'));
        return;
      }
      setCode('');
      setDisplayName('');
      setSpecialty('');
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
        setAerr(await errMsg(res, isActive ? 'Gagal mengarsipkan' : 'Gagal mengaktifkan'));
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
    <section aria-labelledby="at-title">
      <h1 id="at-title" className="text-2xl font-semibold text-text">Kelola Teknisi</h1>
      <p className="mt-1 text-sm text-muted">Teknisi tanpa akun; admin mencatat semua tindakan. Nama disembunyikan dari pelapor.</p>
      <form onSubmit={(e) => void onCreate(e)} className="mt-4 grid max-w-3xl gap-3 rounded-md border border-border bg-surface p-4 sm:grid-cols-3">
        <div>
          <label htmlFor="tech-code" className="mb-1 block text-sm font-medium text-text">Kode</label>
          <Input id="tech-code" value={code} maxLength={32} placeholder="cth: TECH-001" onChange={(e) => setCode(e.target.value)} disabled={fpending} />
        </div>
        <div>
          <label htmlFor="tech-name" className="mb-1 block text-sm font-medium text-text">Nama tampilan</label>
          <Input id="tech-name" value={displayName} maxLength={128} placeholder="cth: Budi" onChange={(e) => setDisplayName(e.target.value)} disabled={fpending} />
        </div>
        <div>
          <label htmlFor="tech-sp" className="mb-1 block text-sm font-medium text-text">Spesialisasi (opsional)</label>
          <Input id="tech-sp" value={specialty} maxLength={128} placeholder="cth: Listrik" onChange={(e) => setSpecialty(e.target.value)} disabled={fpending} />
        </div>
        {ferr !== null ? <div className="sm:col-span-3"><FieldError id="tech-err" message={ferr} /></div> : null}
        <div className="sm:col-span-3"><Button type="submit" disabled={fpending}>{fpending ? 'Menyimpan\u2026' : 'Tambah teknisi'}</Button></div>
      </form>
      {pending ? (
        <div className="mt-4"><LoadingState message="Memuat\u2026" /></div>
      ) : loadError !== null ? (
        <div className="mt-4"><ErrorPanel message={loadError} retry={<Button type="button" variant="secondary" onClick={() => void reload()}>Coba lagi</Button>} /></div>
      ) : forbidden ? (
        <div className="mt-4"><ErrorPanel title="Akses ditolak" message="Halaman ini hanya untuk admin." /></div>
      ) : rows === null || rows.length === 0 ? (
        <div className="mt-4"><EmptyState title="Belum ada teknisi" description="Tambah teknisi pertama di atas." /></div>
      ) : (
        <>
          {aerr !== null ? <div className="mt-4"><ErrorPanel message={aerr} /></div> : null}
          <div className="mt-4 overflow-x-auto rounded-md border border-border bg-surface">
            <table className="w-full min-w-180 border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th scope="col" className="px-3 py-2 text-xs font-medium text-muted">Kode</th>
                  <th scope="col" className="px-3 py-2 text-xs font-medium text-muted">Nama</th>
                  <th scope="col" className="px-3 py-2 text-xs font-medium text-muted">Spesialisasi</th>
                  <th scope="col" className="px-3 py-2 text-xs font-medium text-muted">Status</th>
                  <th scope="col" className="px-3 py-2 text-xs font-medium text-muted">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="px-3 py-2"><TicketMono>{r.technicianCode}</TicketMono></td>
                    <td className="px-3 py-2 text-text">{r.displayName}</td>
                    <td className="px-3 py-2 text-muted">{r.specialty ?? '\u2014'}</td>
                    <td className="px-3 py-2 text-muted">{r.isActive ? 'Aktif' : 'Nonaktif'}</td>
                    <td className="px-3 py-2">
                      <Button type="button" variant={r.isActive ? 'destructive' : 'secondary'} disabled={aid === r.id} onClick={() => void onToggle(r.id, r.isActive)}>
                        {aid === r.id ? 'Memproses\u2026' : r.isActive ? 'Arsipkan' : 'Aktifkan'}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-sm text-muted">{rows.length} teknisi ditampilkan.</p>
        </>
      )}
    </section>
  );
}
