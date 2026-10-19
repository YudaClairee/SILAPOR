// Admin categories + issue types (EXECUTION-PLAN 9.4 + 10.2): dua tabel
// master dalam satu halaman. CRUD via koleksi GET/POST + PATCH item + arsip.
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

interface Cat {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly weight: number;
  readonly isActive: boolean;
}

interface It {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly categoryId: string | null;
  readonly isActive: boolean;
}

interface LoaderData {
  readonly cats: Cat[] | null;
  readonly its: It[] | null;
  readonly loadError: string | null;
  readonly forbidden: boolean;
  readonly needsClientLoad: boolean;
}

type Bundle =
  | { readonly cats: Cat[] | null; readonly its: It[] | null; readonly loadError: string | null; readonly forbidden: boolean }
  | 'unauthorized'
  | 'unavailable';

async function fetchBundle(): Promise<Bundle> {
  let c: Response;
  let t: Response;
  try {
    [c, t] = await Promise.all([
      fetch('/api/admin/categories?includeInactive=true&limit=200', { credentials: 'include' }),
      fetch('/api/admin/issue-types?includeInactive=true&limit=200', { credentials: 'include' }),
    ]);
  } catch {
    return 'unavailable';
  }
  if (c.status === 401 || t.status === 401) return 'unauthorized';
  if (c.status === 403 || t.status === 403) return { cats: null, its: null, loadError: null, forbidden: true };
  if (!c.ok) return { cats: null, its: null, loadError: 'Gagal memuat kategori (' + c.status + ').', forbidden: false };
  if (!t.ok) return { cats: null, its: null, loadError: 'Gagal memuat jenis masalah (' + t.status + ').', forbidden: false };
  try {
    return { cats: (await c.json()) as Cat[], its: (await t.json()) as It[], loadError: null, forbidden: false };
  } catch {
    return { cats: null, its: null, loadError: 'Respons master data tidak valid.', forbidden: false };
  }
}

async function errMsg(res: Response, fb: string): Promise<string> {
  try {
    const d = (await res.json()) as { readonly error?: { readonly message?: unknown } };
    if (typeof d.error?.message === 'string' && d.error.message !== '') return d.error.message;
  } catch {}
  return fb + ' (' + res.status + ').';
}

export const Route = createFileRoute('/admin/categories')({
  loader: async (): Promise<LoaderData> => {
    const r = await fetchBundle();
    if (r === 'unauthorized') throw redirect({ to: '/login' });
    if (r === 'unavailable') return { cats: null, its: null, loadError: null, forbidden: false, needsClientLoad: true };
    return { cats: r.cats, its: r.its, loadError: r.loadError, forbidden: r.forbidden, needsClientLoad: false };
  },
  pendingComponent: Pending,
  component: Page,
});

function Pending() {
  return (
    <section aria-labelledby="ac-title">
      <h1 id="ac-title" className="text-2xl font-semibold text-text">Kelola Kategori</h1>
      <div className="mt-4"><LoadingState message="Memuat\u2026" /></div>
    </section>
  );
}

function Page() {
  const loader = Route.useLoaderData() as LoaderData;
  const navigate = useNavigate();
  const [cats, setCats] = useState<Cat[] | null>(loader.needsClientLoad ? null : loader.cats);
  const [its, setIts] = useState<It[] | null>(loader.needsClientLoad ? null : loader.its);
  const [pending, setPending] = useState(loader.needsClientLoad);
  const [loadError, setLoadError] = useState<string | null>(loader.loadError);
  const [forbidden, setForbidden] = useState(loader.forbidden);
  const [cc, setCc] = useState('');
  const [cn, setCn] = useState('');
  const [cw, setCw] = useState('10');
  const [cerr, setCerr] = useState<string | null>(null);
  const [cpending, setCpending] = useState(false);
  const [ic, setIc] = useState('');
  const [iname, setIname] = useState('');
  const [icat, setIcat] = useState('');
  const [ierr, setIerr] = useState<string | null>(null);
  const [ipending, setIpending] = useState(false);
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
      setCats(r.cats);
      setIts(r.its);
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
        setCats(r.cats);
        setIts(r.its);
        setLoadError(r.loadError);
        setForbidden(r.forbidden);
      }
      setPending(false);
    })();
    return () => { c = true; };
  }, [loader.needsClientLoad, navigate]);

  async function onCat(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (cpending) return;
    if (cc.trim() === '' || cn.trim() === '') {
      setCerr('Kode dan nama kategori wajib diisi.');
      return;
    }
    const w = Number(cw);
    if (!Number.isInteger(w) || w < 0 || w > 40) {
      setCerr('Bobot harus bilangan bulat 0-40.');
      return;
    }
    setCpending(true);
    setCerr(null);
    try {
      const res = await fetch('/api/admin/categories', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: cc.trim(), name: cn.trim(), weight: w }),
      });
      if (!res.ok) {
        setCerr(await errMsg(res, 'Gagal membuat kategori'));
        return;
      }
      setCc('');
      setCn('');
      setCw('10');
      await reload();
    } catch {
      setCerr('Tidak dapat terhubung ke server.');
    } finally {
      setCpending(false);
    }
  }

  async function onIt(e: FormEvent<HTMLFormElement>): Promise<void> {
    e.preventDefault();
    if (ipending) return;
    if (ic.trim() === '' || iname.trim() === '') {
      setIerr('Kode dan nama jenis masalah wajib diisi.');
      return;
    }
    setIpending(true);
    setIerr(null);
    try {
      const res = await fetch('/api/admin/issue-types', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code: ic.trim(), name: iname.trim(), categoryId: icat === '' ? null : icat }),
      });
      if (!res.ok) {
        setIerr(await errMsg(res, 'Gagal membuat jenis masalah'));
        return;
      }
      setIc('');
      setIname('');
      setIcat('');
      await reload();
    } catch {
      setIerr('Tidak dapat terhubung ke server.');
    } finally {
      setIpending(false);
    }
  }

  async function onToggle(path: string, id: string, isActive: boolean): Promise<void> {
    setAid(id);
    setAerr(null);
    try {
      const res = await fetch(path + '/' + encodeURIComponent(id), {
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

  const names = new Map((cats ?? []).map((c) => [c.id, c.name] as const));

  return (
    <section aria-labelledby="ac-title">
      <h1 id="ac-title" className="text-2xl font-semibold text-text">Kelola Kategori</h1>
      <p className="mt-1 text-sm text-muted">Kategori memakai bobot 0-40; jenis masalah boleh umum atau terikat satu kategori.</p>
      {pending ? (
        <div className="mt-4"><LoadingState message="Memuat\u2026" /></div>
      ) : loadError !== null ? (
        <div className="mt-4"><ErrorPanel message={loadError} retry={<Button type="button" variant="secondary" onClick={() => void reload()}>Coba lagi</Button>} /></div>
      ) : forbidden ? (
        <div className="mt-4"><ErrorPanel title="Akses ditolak" message="Halaman ini hanya untuk admin." /></div>
      ) : (
        <>
          {aerr !== null ? <div className="mt-4"><ErrorPanel message={aerr} /></div> : null}
          <h2 className="mt-6 text-lg font-semibold text-text">Kategori</h2>
          <form onSubmit={(e) => void onCat(e)} className="mt-3 grid max-w-3xl gap-3 rounded-md border border-border bg-surface p-4 sm:grid-cols-3">
            <div>
              <label htmlFor="cat-code" className="mb-1 block text-sm font-medium text-text">Kode</label>
              <Input id="cat-code" value={cc} maxLength={32} placeholder="cth: HVAC" onChange={(e) => setCc(e.target.value)} disabled={cpending} />
            </div>
            <div>
              <label htmlFor="cat-name" className="mb-1 block text-sm font-medium text-text">Nama</label>
              <Input id="cat-name" value={cn} maxLength={128} placeholder="cth: AC" onChange={(e) => setCn(e.target.value)} disabled={cpending} />
            </div>
            <div>
              <label htmlFor="cat-w" className="mb-1 block text-sm font-medium text-text">Bobot (0-40)</label>
              <Input id="cat-w" type="number" min={0} max={40} value={cw} onChange={(e) => setCw(e.target.value)} disabled={cpending} />
            </div>
            {cerr !== null ? <div className="sm:col-span-3"><FieldError id="cat-err" message={cerr} /></div> : null}
            <div className="sm:col-span-3"><Button type="submit" disabled={cpending}>{cpending ? 'Menyimpan\u2026' : 'Tambah kategori'}</Button></div>
          </form>
          {(cats ?? []).length === 0 ? (
            <div className="mt-3"><EmptyState title="Belum ada kategori" description="Tambah kategori pertama di atas." /></div>
          ) : (
            <div className="mt-3 overflow-x-auto rounded-md border border-border bg-surface">
              <table className="w-full min-w-180 border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th scope="col" className="px-3 py-2 text-xs font-medium text-muted">Kode</th>
                    <th scope="col" className="px-3 py-2 text-xs font-medium text-muted">Nama</th>
                    <th scope="col" className="px-3 py-2 text-xs font-medium text-muted">Bobot</th>
                    <th scope="col" className="px-3 py-2 text-xs font-medium text-muted">Status</th>
                    <th scope="col" className="px-3 py-2 text-xs font-medium text-muted">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {(cats ?? []).map((r) => (
                    <tr key={r.id}>
                      <td className="px-3 py-2"><TicketMono>{r.code}</TicketMono></td>
                      <td className="px-3 py-2 text-text">{r.name}</td>
                      <td className="px-3 py-2 text-muted">{r.weight}</td>
                      <td className="px-3 py-2 text-muted">{r.isActive ? 'Aktif' : 'Nonaktif'}</td>
                      <td className="px-3 py-2">
                        <Button type="button" variant={r.isActive ? 'destructive' : 'secondary'} disabled={aid === r.id} onClick={() => void onToggle('/api/admin/categories', r.id, r.isActive)}>
                          {aid === r.id ? 'Memproses\u2026' : r.isActive ? 'Arsipkan' : 'Aktifkan'}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <h2 className="mt-8 text-lg font-semibold text-text">Jenis masalah</h2>
          <form onSubmit={(e) => void onIt(e)} className="mt-3 grid max-w-3xl gap-3 rounded-md border border-border bg-surface p-4 sm:grid-cols-3">
            <div>
              <label htmlFor="it-code" className="mb-1 block text-sm font-medium text-text">Kode</label>
              <Input id="it-code" value={ic} maxLength={32} placeholder="cth: LEAKING" onChange={(e) => setIc(e.target.value)} disabled={ipending} />
            </div>
            <div>
              <label htmlFor="it-name" className="mb-1 block text-sm font-medium text-text">Nama</label>
              <Input id="it-name" value={iname} maxLength={128} placeholder="cth: Bocor" onChange={(e) => setIname(e.target.value)} disabled={ipending} />
            </div>
            <div>
              <label htmlFor="it-cat" className="mb-1 block text-sm font-medium text-text">Kategori (opsional)</label>
              <Select id="it-cat" value={icat} onChange={(e) => setIcat(e.target.value)} disabled={ipending}>
                <option value="">Umum</option>
                {(cats ?? []).filter((c) => c.isActive).map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </Select>
            </div>
            {ierr !== null ? <div className="sm:col-span-3"><FieldError id="it-err" message={ierr} /></div> : null}
            <div className="sm:col-span-3"><Button type="submit" disabled={ipending}>{ipending ? 'Menyimpan\u2026' : 'Tambah jenis masalah'}</Button></div>
          </form>
          {(its ?? []).length === 0 ? (
            <div className="mt-3"><EmptyState title="Belum ada jenis masalah" description="Tambah jenis masalah pertama di atas." /></div>
          ) : (
            <div className="mt-3 overflow-x-auto rounded-md border border-border bg-surface">
              <table className="w-full min-w-180 border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th scope="col" className="px-3 py-2 text-xs font-medium text-muted">Kode</th>
                    <th scope="col" className="px-3 py-2 text-xs font-medium text-muted">Nama</th>
                    <th scope="col" className="px-3 py-2 text-xs font-medium text-muted">Kategori</th>
                    <th scope="col" className="px-3 py-2 text-xs font-medium text-muted">Status</th>
                    <th scope="col" className="px-3 py-2 text-xs font-medium text-muted">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {(its ?? []).map((r) => (
                    <tr key={r.id}>
                      <td className="px-3 py-2"><TicketMono>{r.code}</TicketMono></td>
                      <td className="px-3 py-2 text-text">{r.name}</td>
                      <td className="px-3 py-2 text-muted">{r.categoryId === null ? 'Umum' : (names.get(r.categoryId) ?? '\u2014')}</td>
                      <td className="px-3 py-2 text-muted">{r.isActive ? 'Aktif' : 'Nonaktif'}</td>
                      <td className="px-3 py-2">
                        <Button type="button" variant={r.isActive ? 'destructive' : 'secondary'} disabled={aid === r.id} onClick={() => void onToggle('/api/admin/issue-types', r.id, r.isActive)}>
                          {aid === r.id ? 'Memproses\u2026' : r.isActive ? 'Arsipkan' : 'Aktifkan'}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </section>
  );
}
