// Data Master Referensi (Figma 150:2220, admin/UMPER): breadcrumb + header,
// tiga tab (Kategori/Lokasi/Jenis Masalah) + tabel lokasi 6 kolom + footer
// "Menampilkan a-b dari N" + paginasi 12 baris + dialog + Nonaktifkan.
// Backend: GET /api/admin/{locations,categories,issue-types}; turunkan view
// lokasi client-side (lihat lib/admin-master-data.ts). Admin-only.
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import {
  buildingOptions,
  DEFAULT_LOCATION_FILTERS,
  filterLocationViews,
  masterPaginationItems,
  paginateMasterRows,
  toLocationViewRows,
  type LocationViewRow,
  type MasterLocation,
} from '../lib/admin-master-data.js';
import {
  Button,
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

/* KETIDAKSESUAIAN BACKEND (lapor ke pemilik backend):
 * 1. locations mentah tanpa displayId/buildingName/floorLabel/roomName —
 *    diturunkan client-side dari hierarki (ROOM/SHARED_AREA daun).
 * 2. Tanpa ?search=/?building=/total server-side — filter + paginasi
 *    client-side setelah fetch limit=200.
 * 3. Badge tab = hitungan client-side; idealnya GET master-summary.
 * 4. POST locations wajib type+code+name mentah; desain hanya
 *    Gedung/Lantai/Ruangan — dialog meminta kode+nama agar lolos validator.
 * 5. ID desain (LOK-GDC-01, LOK-SUT-03, LOK-ISL-01, LOK-TMD-01) ilustratif;
 *    seed memakai 22.4A.01.001, C, dst. */

interface CategoryRow {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly weight: number;
  readonly isActive: boolean;
}
interface IssueRow {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly categoryId: string | null;
  readonly isActive: boolean;
}
type MasterTab = 'kategori' | 'lokasi' | 'masalah';
interface LoaderData {
  readonly locations: MasterLocation[] | null;
  readonly categories: CategoryRow[] | null;
  readonly issues: IssueRow[] | null;
  readonly loadError: string | null;
  readonly forbidden: boolean;
  readonly needsClientLoad: boolean;
}
type Bundle =
  | {
      readonly locations: MasterLocation[] | null;
      readonly categories: CategoryRow[] | null;
      readonly issues: IssueRow[] | null;
      readonly loadError: string | null;
      readonly forbidden: boolean;
    }
  | 'unauthorized'
  | 'unavailable';

async function parseJsonArray(res: Response): Promise<unknown[] | null> {
  try {
    const data: unknown = await res.json();
    return Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function toLocation(value: unknown): MasterLocation | null {
  if (!isRecord(value)) return null;
  const r = value as Record<string, unknown>;
  if (typeof r['id'] !== 'string' || typeof r['type'] !== 'string') return null;
  if (typeof r['code'] !== 'string' || typeof r['name'] !== 'string') return null;
  if (typeof r['isActive'] !== 'boolean') return null;
  return {
    id: r['id'] as string,
    type: r['type'] as string,
    code: r['code'] as string,
    name: r['name'] as string,
    buildingCode: typeof r['buildingCode'] === 'string' ? (r['buildingCode'] as string) : null,
    floorNumber: typeof r['floorNumber'] === 'number' ? (r['floorNumber'] as number) : null,
    isActive: r['isActive'] as boolean,
  };
}
function toCategory(value: unknown): CategoryRow | null {
  if (!isRecord(value)) return null;
  const r = value as Record<string, unknown>;
  if (typeof r['id'] !== 'string' || typeof r['code'] !== 'string') return null;
  if (typeof r['name'] !== 'string' || typeof r['weight'] !== 'number') return null;
  if (typeof r['isActive'] !== 'boolean') return null;
  return {
    id: r['id'] as string,
    code: r['code'] as string,
    name: r['name'] as string,
    weight: r['weight'] as number,
    isActive: r['isActive'] as boolean,
  };
}
function toIssue(value: unknown): IssueRow | null {
  if (!isRecord(value)) return null;
  const r = value as Record<string, unknown>;
  if (typeof r['id'] !== 'string' || typeof r['code'] !== 'string') return null;
  if (typeof r['name'] !== 'string' || typeof r['isActive'] !== 'boolean') return null;
  return {
    id: r['id'] as string,
    code: r['code'] as string,
    name: r['name'] as string,
    categoryId: typeof r['categoryId'] === 'string' ? (r['categoryId'] as string) : null,
    isActive: r['isActive'] as boolean,
  };
}

async function fetchBundle(): Promise<Bundle> {
  let loc: Response;
  let cat: Response;
  let iss: Response;
  try {
    const all = await Promise.all([
      fetch('/api/admin/locations?includeInactive=true&limit=200', { credentials: 'include' }),
      fetch('/api/admin/categories?includeInactive=true&limit=200', { credentials: 'include' }),
      fetch('/api/admin/issue-types?includeInactive=true&limit=200', { credentials: 'include' }),
    ]);
    loc = all[0] as Response;
    cat = all[1] as Response;
    iss = all[2] as Response;
  } catch {
    return 'unavailable';
  }
  if (loc.status === 401 || cat.status === 401 || iss.status === 401) return 'unauthorized';
  if (loc.status === 403 || cat.status === 403 || iss.status === 403) {
    return { locations: null, categories: null, issues: null, loadError: null, forbidden: true };
  }
  if (!loc.ok)
    return {
      locations: null,
      categories: null,
      issues: null,
      loadError: 'Gagal memuat lokasi (' + loc.status + ').',
      forbidden: false,
    };
  if (!cat.ok)
    return {
      locations: null,
      categories: null,
      issues: null,
      loadError: 'Gagal memuat kategori (' + cat.status + ').',
      forbidden: false,
    };
  if (!iss.ok)
    return {
      locations: null,
      categories: null,
      issues: null,
      loadError: 'Gagal memuat jenis masalah (' + iss.status + ').',
      forbidden: false,
    };
  const raws = await Promise.all([parseJsonArray(loc), parseJsonArray(cat), parseJsonArray(iss)]);
  const rawLoc = raws[0];
  const rawCat = raws[1];
  const rawIss = raws[2];
  if (rawLoc === null || rawCat === null || rawIss === null) {
    return {
      locations: null,
      categories: null,
      issues: null,
      loadError: 'Respons master data tidak valid.',
      forbidden: false,
    };
  }
  return {
    locations: rawLoc.map(toLocation).filter((r): r is MasterLocation => r !== null),
    categories: rawCat.map(toCategory).filter((r): r is CategoryRow => r !== null),
    issues: rawIss.map(toIssue).filter((r): r is IssueRow => r !== null),
    loadError: null,
    forbidden: false,
  };
}
async function errMsg(res: Response, fallback: string): Promise<string> {
  try {
    const data = (await res.json()) as { readonly error?: { readonly message?: unknown } };
    const msg = data.error?.message;
    if (typeof msg === 'string' && msg !== '') return msg;
  } catch {}
  return fallback + ' (' + res.status + ').';
}
const PAGE_SIZE = 12;
const TABS: ReadonlyArray<{ value: MasterTab; label: string }> = [
  { value: 'kategori', label: 'Kategori Fasilitas' },
  { value: 'lokasi', label: 'Lokasi' },
  { value: 'masalah', label: 'Jenis Masalah' },
];

export const Route = createFileRoute('/admin/master-data')({
  validateSearch: (search: Record<string, unknown>): { tab?: MasterTab } => {
    const raw = search['tab'];
    if (raw === 'kategori' || raw === 'lokasi' || raw === 'masalah') return { tab: raw };
    return {};
  },
  loader: async (): Promise<LoaderData> => {
    const bundle = await fetchBundle();
    if (bundle === 'unauthorized') throw redirect({ to: '/login' });
    if (bundle === 'unavailable')
      return {
        locations: null,
        categories: null,
        issues: null,
        loadError: null,
        forbidden: false,
        needsClientLoad: true,
      };
    return { ...bundle, needsClientLoad: false };
  },
  pendingComponent: Pending,
  component: Page,
});
function Pending() {
  return (
    <section aria-labelledby="md-title">
      <p className="text-xs font-medium tracking-wide text-muted">
        Data Master &amp; Parameter › <span className="font-semibold text-text">Data Master</span>
      </p>
      <h1 id="md-title" className="mt-1 text-2xl font-semibold text-text">
        Data Master Referensi
      </h1>
      <div className="mt-4">
        <LoadingState message="Memuat master data…" />
      </div>
    </section>
  );
}
type LocationModal =
  | { readonly kind: 'closed' }
  | { readonly kind: 'create' }
  | { readonly kind: 'edit'; readonly row: LocationViewRow };
type CategoryModal =
  | { readonly kind: 'closed' }
  | { readonly kind: 'create' }
  | { readonly kind: 'edit'; readonly row: CategoryRow };
type IssueModal =
  | { readonly kind: 'closed' }
  | { readonly kind: 'create' }
  | { readonly kind: 'edit'; readonly row: IssueRow };

function Page() {
  const loader = Route.useLoaderData() as LoaderData;
  const navigate = useNavigate();
  const search = Route.useSearch() as { tab?: MasterTab };
  const activeTab: MasterTab = search.tab ?? 'lokasi';
  const [locations, setLocations] = useState<MasterLocation[] | null>(
    loader.needsClientLoad ? null : loader.locations,
  );
  const [categories, setCategories] = useState<CategoryRow[] | null>(
    loader.needsClientLoad ? null : loader.categories,
  );
  const [issues, setIssues] = useState<IssueRow[] | null>(
    loader.needsClientLoad ? null : loader.issues,
  );
  const [pending, setPending] = useState(loader.needsClientLoad);
  const [loadError, setLoadError] = useState<string | null>(loader.loadError);
  const [forbidden, setForbidden] = useState(loader.forbidden);
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    if (!loader.needsClientLoad) return;
    let cancelled = false;
    void (async () => {
      const bundle = await fetchBundle();
      if (cancelled) return;
      if (bundle === 'unauthorized') {
        await navigate({ to: '/login' });
        return;
      }
      if (bundle === 'unavailable') {
        setLoadError('Tidak dapat terhubung ke server. Periksa koneksi lalu coba lagi.');
        setPending(false);
        return;
      }
      setLocations(bundle.locations);
      setCategories(bundle.categories);
      setIssues(bundle.issues);
      setLoadError(bundle.loadError);
      setForbidden(bundle.forbidden);
      setPending(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [loader.needsClientLoad, navigate, reloadKey]);
  const [filters, setFilters] = useState(DEFAULT_LOCATION_FILTERS);
  const [page, setPage] = useState(1);
  const [locModal, setLocModal] = useState<LocationModal>({ kind: 'closed' });
  const [actionId, setActionId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [catSearch, setCatSearch] = useState('');
  const [catShowInactive, setCatShowInactive] = useState(true);
  const [catPage, setCatPage] = useState(1);
  const [catModal, setCatModal] = useState<CategoryModal>({ kind: 'closed' });
  const [catActionId, setCatActionId] = useState<string | null>(null);
  const [catActionError, setCatActionError] = useState<string | null>(null);
  const [issSearch, setIssSearch] = useState('');
  const [issCategory, setIssCategory] = useState('');
  const [issShowInactive, setIssShowInactive] = useState(true);
  const [issPage, setIssPage] = useState(1);
  const [issModal, setIssModal] = useState<IssueModal>({ kind: 'closed' });
  const [issActionId, setIssActionId] = useState<string | null>(null);
  const [issActionError, setIssActionError] = useState<string | null>(null);

  const viewRows = useMemo(
    () => (locations === null ? [] : toLocationViewRows(locations)),
    [locations],
  );
  const filtered = useMemo(() => filterLocationViews(viewRows, filters), [viewRows, filters]);
  const options = useMemo(() => buildingOptions(viewRows), [viewRows]);
  const paged = useMemo(() => paginateMasterRows(filtered, page, PAGE_SIZE), [filtered, page]);
  const pageItems = useMemo(
    () => masterPaginationItems(paged.currentPage, paged.totalPages),
    [paged],
  );
  const catNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const cat of categories ?? []) map.set(cat.id, cat.name);
    return map;
  }, [categories]);
  const filteredCats = useMemo(() => {
    const needle = catSearch.trim().toLowerCase();
    return (categories ?? []).filter((row) => {
      if (!catShowInactive && !row.isActive) return false;
      if (needle === '') return true;
      return row.code.toLowerCase().includes(needle) || row.name.toLowerCase().includes(needle);
    });
  }, [categories, catSearch, catShowInactive]);
  const pagedCats = useMemo(
    () => paginateMasterRows(filteredCats, catPage, PAGE_SIZE),
    [filteredCats, catPage],
  );
  const filteredIssues = useMemo(() => {
    const needle = issSearch.trim().toLowerCase();
    return (issues ?? []).filter((row) => {
      if (!issShowInactive && !row.isActive) return false;
      if (issCategory !== '' && (row.categoryId ?? '') !== issCategory) return false;
      if (needle === '') return true;
      return row.code.toLowerCase().includes(needle) || row.name.toLowerCase().includes(needle);
    });
  }, [issues, issSearch, issCategory, issShowInactive]);
  const pagedIssues = useMemo(
    () => paginateMasterRows(filteredIssues, issPage, PAGE_SIZE),
    [filteredIssues, issPage],
  );
  const counts: Record<MasterTab, number> = {
    kategori: (categories ?? []).filter((r) => r.isActive).length,
    lokasi: viewRows.filter((r) => r.isActive).length,
    masalah: (issues ?? []).filter((r) => r.isActive).length,
  };
  function selectTab(tab: MasterTab): void {
    void navigate({ to: '/admin/master-data', search: { tab } });
  }
  function reload(): void {
    setPending(true);
    setLoadError(null);
    setReloadKey((k) => k + 1);
  }
  async function patchRow(url: string, active: boolean): Promise<unknown | null> {
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ isActive: !active }),
    });
    if (res.status === 401) {
      await navigate({ to: '/login' });
      return null;
    }
    if (res.status === 403) {
      setForbidden(true);
      return null;
    }
    if (!res.ok) throw new Error(await errMsg(res, 'Gagal memperbarui data'));
    return (await res.json()) as unknown;
  }

  async function onToggleLocation(row: LocationViewRow): Promise<void> {
    setActionId(row.id);
    setActionError(null);
    try {
      const raw = await patchRow(
        '/api/admin/locations/' + encodeURIComponent(row.id),
        row.isActive,
      );
      const updated = raw === null ? null : toLocation(raw);
      if (updated !== null) {
        setLocations((prev) =>
          prev === null ? prev : prev.map((it) => (it.id === updated.id ? updated : it)),
        );
      }
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Gagal memperbarui lokasi.');
    } finally {
      setActionId(null);
    }
  }
  async function onToggleCategory(row: CategoryRow): Promise<void> {
    setCatActionId(row.id);
    setCatActionError(null);
    try {
      const raw = await patchRow(
        '/api/admin/categories/' + encodeURIComponent(row.id),
        row.isActive,
      );
      const updated = raw === null ? null : toCategory(raw);
      if (updated !== null) {
        setCategories((prev) =>
          prev === null ? prev : prev.map((it) => (it.id === updated.id ? updated : it)),
        );
      }
    } catch (e) {
      setCatActionError(e instanceof Error ? e.message : 'Gagal memperbarui kategori.');
    } finally {
      setCatActionId(null);
    }
  }
  async function onToggleIssue(row: IssueRow): Promise<void> {
    setIssActionId(row.id);
    setIssActionError(null);
    try {
      const raw = await patchRow(
        '/api/admin/issue-types/' + encodeURIComponent(row.id),
        row.isActive,
      );
      const updated = raw === null ? null : toIssue(raw);
      if (updated !== null) {
        setIssues((prev) =>
          prev === null ? prev : prev.map((it) => (it.id === updated.id ? updated : it)),
        );
      }
    } catch (e) {
      setIssActionError(e instanceof Error ? e.message : 'Gagal memperbarui jenis masalah.');
    } finally {
      setIssActionId(null);
    }
  }

  return (
    <section aria-labelledby="md-title">
      <p className="text-xs font-medium tracking-wide text-muted">
        Data Master &amp; Parameter › <span className="font-semibold text-text">Data Master</span>
      </p>
      <h1 id="md-title" className="mt-1 text-2xl font-semibold text-text">
        Data Master Referensi
      </h1>
      <p className="mt-1 text-sm text-muted">
        Kelola daftar referensi Kategori Fasilitas, Lokasi, dan Jenis Masalah pada sistem.
      </p>
      <div
        role="tablist"
        aria-label="Jenis referensi"
        className="mt-4 flex gap-6 border-b border-[#e1e5e9]"
      >
        {TABS.map((tab) => {
          const selected = tab.value === activeTab;
          return (
            <button
              key={tab.value}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => selectTab(tab.value)}
              className={
                'relative inline-flex min-h-[44px] items-center gap-2 pb-2 text-sm ' +
                (selected ? 'font-semibold text-text' : 'font-medium text-muted hover:text-text')
              }
            >
              {tab.label}
              <span
                className={
                  'inline-flex min-h-[22px] min-w-[28px] items-center justify-center ' +
                  'rounded-full px-2 text-xs font-semibold ' +
                  (tab.value === 'kategori'
                    ? 'bg-[#e4f4ec] text-[#1c6b46]'
                    : tab.value === 'lokasi'
                      ? 'bg-[#e8eef3] text-[#33414f]'
                      : 'bg-[#eef1f4] text-[#525d66]')
                }
              >
                {counts[tab.value]}
              </span>
              <span
                aria-hidden="true"
                className={
                  'absolute inset-x-0 -bottom-px h-[2px] rounded-full ' +
                  (selected ? 'bg-accent' : 'bg-transparent')
                }
              />
            </button>
          );
        })}
      </div>
      {pending ? (
        <div className="mt-4">
          <LoadingState message="Memuat master data…" />
        </div>
      ) : loadError !== null ? (
        <div className="mt-4">
          <ErrorPanel
            message={loadError}
            retry={
              <Button type="button" variant="secondary" onClick={reload}>
                Coba lagi
              </Button>
            }
          />
        </div>
      ) : forbidden ? (
        <div className="mt-4">
          <ErrorPanel title="Akses ditolak" message="Halaman ini hanya untuk admin." />
        </div>
      ) : activeTab === 'lokasi' ? (
        <LocationTab
          rows={filtered}
          paged={paged}
          pageItems={pageItems}
          search={filters.search}
          building={filters.building}
          includeInactive={filters.includeInactive}
          options={options}
          actionId={actionId}
          actionError={actionError}
          onSearch={(v) => {
            setFilters({ ...filters, search: v });
            setPage(1);
          }}
          onBuilding={(v) => {
            setFilters({ ...filters, building: v });
            setPage(1);
          }}
          onInactive={(v) => {
            setFilters({ ...filters, includeInactive: v });
            setPage(1);
          }}
          onPage={setPage}
          onAdd={() => setLocModal({ kind: 'create' })}
          onEdit={(row) => setLocModal({ kind: 'edit', row })}
          onToggle={(row) => void onToggleLocation(row)}
        />
      ) : activeTab === 'kategori' ? (
        <CategoryTab
          paged={pagedCats}
          search={catSearch}
          showInactive={catShowInactive}
          actionId={catActionId}
          actionError={catActionError}
          onSearch={(v) => {
            setCatSearch(v);
            setCatPage(1);
          }}
          onShowInactive={(v) => {
            setCatShowInactive(v);
            setCatPage(1);
          }}
          onPage={setCatPage}
          onAdd={() => setCatModal({ kind: 'create' })}
          onEdit={(row) => setCatModal({ kind: 'edit', row })}
          onToggle={(row) => void onToggleCategory(row)}
        />
      ) : (
        <IssueTab
          paged={pagedIssues}
          search={issSearch}
          category={issCategory}
          showInactive={issShowInactive}
          categories={categories ?? []}
          catNames={catNames}
          actionId={issActionId}
          actionError={issActionError}
          onSearch={(v) => {
            setIssSearch(v);
            setIssPage(1);
          }}
          onCategory={(v) => {
            setIssCategory(v);
            setIssPage(1);
          }}
          onShowInactive={(v) => {
            setIssShowInactive(v);
            setIssPage(1);
          }}
          onPage={setIssPage}
          onAdd={() => setIssModal({ kind: 'create' })}
          onEdit={(row) => setIssModal({ kind: 'edit', row })}
          onToggle={(row) => void onToggleIssue(row)}
        />
      )}

      {locModal.kind !== 'closed' ? (
        <LocationDialog
          modal={locModal}
          locations={locations ?? []}
          onClose={() => setLocModal({ kind: 'closed' })}
          onSaved={(saved, created) => {
            setLocations((prev) => {
              if (prev === null) return prev;
              if (created) return [...prev, saved];
              return prev.map((it) => (it.id === saved.id ? saved : it));
            });
            setLocModal({ kind: 'closed' });
          }}
        />
      ) : null}
      {catModal.kind !== 'closed' ? (
        <CategoryDialog
          modal={catModal}
          onClose={() => setCatModal({ kind: 'closed' })}
          onSaved={(saved, created) => {
            setCategories((prev) => {
              if (prev === null) return prev;
              if (created) return [...prev, saved];
              return prev.map((it) => (it.id === saved.id ? saved : it));
            });
            setCatModal({ kind: 'closed' });
          }}
        />
      ) : null}
      {issModal.kind !== 'closed' ? (
        <IssueDialog
          modal={issModal}
          categories={categories ?? []}
          onClose={() => setIssModal({ kind: 'closed' })}
          onSaved={(saved, created) => {
            setIssues((prev) => {
              if (prev === null) return prev;
              if (created) return [...prev, saved];
              return prev.map((it) => (it.id === saved.id ? saved : it));
            });
            setIssModal({ kind: 'closed' });
          }}
        />
      ) : null}
    </section>
  );
}
interface PagedView {
  readonly items: readonly LocationViewRow[];
  readonly total: number;
  readonly totalPages: number;
  readonly currentPage: number;
  readonly from: number;
  readonly to: number;
}
function StatusPill(props: { readonly active: boolean }) {
  return (
    <span
      className={
        'inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ' +
        (props.active
          ? 'border-[#bfe6cf] bg-[#eaf7ef] text-[#1c6b46]'
          : 'border-[#e2e8f0] bg-[#f1f5f9] text-[#525d66]')
      }
    >
      {props.active ? 'Aktif' : 'Nonaktif'}
    </span>
  );
}
function RowActions(props: {
  readonly active: boolean;
  readonly busy: boolean;
  readonly onEdit: () => void;
  readonly onToggle: () => void;
}) {
  return (
    <span className="whitespace-nowrap">
      <button
        type="button"
        onClick={props.onEdit}
        className="font-medium text-accent underline-offset-4 hover:underline"
      >
        Ubah
      </button>
      <span aria-hidden="true" className="mx-2 text-[#d3dbe1]">
        ·
      </span>
      <button
        type="button"
        disabled={props.busy}
        onClick={props.onToggle}
        className="font-medium text-[#c0392b] underline-offset-4 hover:underline disabled:opacity-50"
      >
        {props.busy ? 'Memproses…' : props.active ? 'Nonaktifkan' : 'Aktifkan'}
      </button>
    </span>
  );
}
function Pager(props: {
  readonly current: number;
  readonly totalPages: number;
  readonly items: ReadonlyArray<number | 'ellipsis'>;
  readonly onPage: (page: number) => void;
}) {
  if (props.totalPages <= 1) return null;
  return (
    <nav aria-label="Paginasi" className="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        disabled={props.current <= 1}
        onClick={() => props.onPage(props.current - 1)}
        className="inline-flex min-h-[36px] items-center rounded-lg border border-[#dfe6ec] bg-white px-3 text-[13px] font-medium text-[#4a5a6a] hover:bg-[#f4f7fa] disabled:opacity-50"
      >
        Sebelumnya
      </button>
      {props.items.map((item, i) =>
        item === 'ellipsis' ? (
          <span key={'e' + i} aria-hidden="true" className="px-1 text-[#8a97a3]">
            …
          </span>
        ) : (
          <button
            key={item}
            type="button"
            aria-label={'Halaman ' + item}
            aria-current={item === props.current ? 'page' : undefined}
            onClick={() => props.onPage(item)}
            className={
              'inline-flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg border px-2 text-[13px] font-medium ' +
              (item === props.current
                ? 'border-accent bg-accent text-white'
                : 'border-[#dfe6ec] bg-white text-[#4a5a6a] hover:bg-[#f4f7fa]')
            }
          >
            {item}
          </button>
        ),
      )}
      <button
        type="button"
        disabled={props.current >= props.totalPages}
        onClick={() => props.onPage(props.current + 1)}
        className="inline-flex min-h-[36px] items-center rounded-lg border border-[#dfe6ec] bg-white px-3 text-[13px] font-medium text-[#4a5a6a] hover:bg-[#f4f7fa] disabled:opacity-50"
      >
        Selanjutnya
      </button>
    </nav>
  );
}

function LocationTab(props: {
  readonly rows: readonly LocationViewRow[];
  readonly paged: PagedView;
  readonly pageItems: ReadonlyArray<number | 'ellipsis'>;
  readonly search: string;
  readonly building: string;
  readonly includeInactive: boolean;
  readonly options: readonly string[];
  readonly actionId: string | null;
  readonly actionError: string | null;
  readonly onSearch: (v: string) => void;
  readonly onBuilding: (v: string) => void;
  readonly onInactive: (v: boolean) => void;
  readonly onPage: (page: number) => void;
  readonly onAdd: () => void;
  readonly onEdit: (row: LocationViewRow) => void;
  readonly onToggle: (row: LocationViewRow) => void;
}) {
  const { paged } = props;
  return (
    <>
      <div className="mt-4 flex flex-col gap-3 rounded-xl border border-[#e8edf3] bg-white p-4 lg:flex-row lg:items-center">
        <label className="relative block flex-1">
          <span className="sr-only">Cari kode, gedung, lantai, atau ruangan</span>
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8a97a3]" />
          <Input
            value={props.search}
            placeholder="Cari kode, gedung, lantai, atau ruangan…"
            onChange={(e) => props.onSearch(e.target.value)}
            className="rounded-lg border-[#dfe6ec] pl-9"
          />
        </label>
        <Select
          aria-label="Filter gedung dan area"
          value={props.building}
          onChange={(e) => props.onBuilding(e.target.value)}
          className="rounded-lg border-[#dfe6ec] lg:w-64"
        >
          <option value="">Semua Gedung &amp; Area</option>
          {props.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </Select>
        <span className="inline-flex min-h-[44px] items-center gap-2 text-sm text-[#4a5a6a]">
          <button
            type="button"
            role="switch"
            aria-checked={props.includeInactive}
            aria-label="Tampilkan data nonaktif"
            onClick={() => props.onInactive(!props.includeInactive)}
            className={
              'relative inline-flex h-6 w-11 items-center rounded-full ' +
              (props.includeInactive ? 'bg-accent' : 'bg-[#d3dbe1]')
            }
          >
            <span
              aria-hidden="true"
              className={
                'inline-block h-5 w-5 rounded-full bg-white shadow ' +
                (props.includeInactive ? 'translate-x-5' : 'translate-x-0.5')
              }
            />
          </button>
          Tampilkan data nonaktif
        </span>
        <div className="lg:ms-auto">
          <Button type="button" onClick={props.onAdd} className="w-full rounded-lg lg:w-auto">
            <PlusIcon className="h-4 w-4" />
            Tambah Lokasi
          </Button>
        </div>
      </div>
      {props.actionError !== null ? (
        <div className="mt-4">
          <ErrorPanel message={props.actionError} />
        </div>
      ) : null}

      {props.rows.length === 0 ? (
        <div className="mt-4">
          <EmptyState
            title="Belum ada lokasi"
            description="Tambah lokasi pertama lewat tombol Tambah Lokasi, atau ubah kata kunci filter."
          />
        </div>
      ) : (
        <div className="mt-4 overflow-hidden rounded-xl border border-[#e8edf3] bg-white">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[880px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-[#e8edf3] bg-[#f8fafc]">
                  <th scope="col" className="px-6 py-3 text-xs font-semibold text-[#64748b]">
                    ID LOKASI
                  </th>
                  <th scope="col" className="px-6 py-3 text-xs font-semibold text-[#64748b]">
                    GEDUNG / AREA
                  </th>
                  <th scope="col" className="px-6 py-3 text-xs font-semibold text-[#64748b]">
                    LANTAI
                  </th>
                  <th scope="col" className="px-6 py-3 text-xs font-semibold text-[#64748b]">
                    RUANGAN
                  </th>
                  <th scope="col" className="px-6 py-3 text-xs font-semibold text-[#64748b]">
                    STATUS DATA
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3 text-right text-xs font-semibold text-[#64748b]"
                  >
                    AKSI
                  </th>
                </tr>
              </thead>
              <tbody>
                {paged.items.map((row) => (
                  <tr
                    key={row.id}
                    className="border-t border-[#e8edf3] first:border-t-0 hover:bg-[#fafcff]"
                  >
                    <td className="whitespace-nowrap px-6 py-4">
                      <TicketMono className="text-[13px] text-[#5c6b7a]">{row.code}</TicketMono>
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-[14px] font-semibold text-[#202a33]">
                      {row.buildingName ?? '—'}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-[14px] text-[#4a5a6a]">
                      {row.floorLabel}
                    </td>
                    <td className="px-6 py-4 text-[14px] text-[#202a33]">{row.name}</td>
                    <td className="whitespace-nowrap px-6 py-4">
                      <StatusPill active={row.isActive} />
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-right text-[14px]">
                      <RowActions
                        active={row.isActive}
                        busy={props.actionId === row.id}
                        onEdit={() => props.onEdit(row)}
                        onToggle={() => props.onToggle(row)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-col gap-3 border-t border-[#e8edf3] px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[14px] text-[#5c6b7a]">
              Menampilkan {paged.from}–{paged.to} dari {paged.total} lokasi referensi
            </p>
            <Pager
              current={paged.currentPage}
              totalPages={paged.totalPages}
              items={props.pageItems}
              onPage={props.onPage}
            />
          </div>
        </div>
      )}
    </>
  );
}

interface PagedSimple<T> {
  readonly items: readonly T[];
  readonly total: number;
  readonly totalPages: number;
  readonly currentPage: number;
  readonly from: number;
  readonly to: number;
}
function Toggle(props: { readonly checked: boolean; readonly onFlip: () => void }) {
  return (
    <span className="inline-flex min-h-[44px] items-center gap-2 text-sm text-[#4a5a6a]">
      <button
        type="button"
        role="switch"
        aria-checked={props.checked}
        aria-label="Tampilkan data nonaktif"
        onClick={props.onFlip}
        className={
          'relative inline-flex h-6 w-11 items-center rounded-full ' +
          (props.checked ? 'bg-accent' : 'bg-[#d3dbe1]')
        }
      >
        <span
          aria-hidden="true"
          className={
            'inline-block h-5 w-5 rounded-full bg-white shadow ' +
            (props.checked ? 'translate-x-5' : 'translate-x-0.5')
          }
        />
      </button>
      Tampilkan data nonaktif
    </span>
  );
}
function CategoryTab(props: {
  readonly paged: PagedSimple<CategoryRow>;
  readonly search: string;
  readonly showInactive: boolean;
  readonly actionId: string | null;
  readonly actionError: string | null;
  readonly onSearch: (v: string) => void;
  readonly onShowInactive: (v: boolean) => void;
  readonly onPage: (page: number) => void;
  readonly onAdd: () => void;
  readonly onEdit: (row: CategoryRow) => void;
  readonly onToggle: (row: CategoryRow) => void;
}) {
  const { paged } = props;
  return (
    <>
      <div className="mt-4 flex flex-col gap-3 rounded-xl border border-[#e8edf3] bg-white p-4 lg:flex-row lg:items-center">
        <label className="relative block flex-1">
          <span className="sr-only">Cari kode atau nama kategori</span>
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8a97a3]" />
          <Input
            value={props.search}
            placeholder="Cari kode atau nama kategori…"
            onChange={(e) => props.onSearch(e.target.value)}
            className="rounded-lg border-[#dfe6ec] pl-9"
          />
        </label>
        <Toggle
          checked={props.showInactive}
          onFlip={() => props.onShowInactive(!props.showInactive)}
        />
        <div className="lg:ms-auto">
          <Button type="button" onClick={props.onAdd} className="w-full rounded-lg lg:w-auto">
            <PlusIcon className="h-4 w-4" />
            Tambah Kategori
          </Button>
        </div>
      </div>
      {props.actionError !== null ? (
        <div className="mt-4">
          <ErrorPanel message={props.actionError} />
        </div>
      ) : null}
      {paged.total === 0 ? (
        <div className="mt-4">
          <EmptyState
            title="Belum ada kategori"
            description="Tambah kategori pertama lewat tombol di atas."
          />
        </div>
      ) : (
        <div className="mt-4 overflow-hidden rounded-xl border border-[#e8edf3] bg-white">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-[#e8edf3] bg-[#f8fafc]">
                  <th scope="col" className="px-6 py-3 text-xs font-semibold text-[#64748b]">
                    KODE
                  </th>
                  <th scope="col" className="px-6 py-3 text-xs font-semibold text-[#64748b]">
                    NAMA KATEGORI
                  </th>
                  <th scope="col" className="px-6 py-3 text-xs font-semibold text-[#64748b]">
                    BOBOT
                  </th>
                  <th scope="col" className="px-6 py-3 text-xs font-semibold text-[#64748b]">
                    STATUS DATA
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3 text-right text-xs font-semibold text-[#64748b]"
                  >
                    AKSI
                  </th>
                </tr>
              </thead>
              <tbody>
                {paged.items.map((row) => (
                  <tr
                    key={row.id}
                    className="border-t border-[#e8edf3] first:border-t-0 hover:bg-[#fafcff]"
                  >
                    <td className="whitespace-nowrap px-6 py-4">
                      <TicketMono className="text-[13px] text-[#5c6b7a]">{row.code}</TicketMono>
                    </td>
                    <td className="px-6 py-4 text-[14px] font-semibold text-[#202a33]">
                      {row.name}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-[14px] text-[#4a5a6a]">
                      {row.weight}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4">
                      <StatusPill active={row.isActive} />
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-right text-[14px]">
                      <RowActions
                        active={row.isActive}
                        busy={props.actionId === row.id}
                        onEdit={() => props.onEdit(row)}
                        onToggle={() => props.onToggle(row)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-col gap-3 border-t border-[#e8edf3] px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[14px] text-[#5c6b7a]">
              Menampilkan {paged.from}–{paged.to} dari {paged.total} kategori referensi
            </p>
            <Pager
              current={paged.currentPage}
              totalPages={paged.totalPages}
              items={masterPaginationItems(paged.currentPage, paged.totalPages)}
              onPage={props.onPage}
            />
          </div>
        </div>
      )}
    </>
  );
}

function IssueTab(props: {
  readonly paged: PagedSimple<IssueRow>;
  readonly search: string;
  readonly category: string;
  readonly showInactive: boolean;
  readonly categories: readonly CategoryRow[];
  readonly catNames: ReadonlyMap<string, string>;
  readonly actionId: string | null;
  readonly actionError: string | null;
  readonly onSearch: (v: string) => void;
  readonly onCategory: (v: string) => void;
  readonly onShowInactive: (v: boolean) => void;
  readonly onPage: (page: number) => void;
  readonly onAdd: () => void;
  readonly onEdit: (row: IssueRow) => void;
  readonly onToggle: (row: IssueRow) => void;
}) {
  const { paged } = props;
  return (
    <>
      <div className="mt-4 flex flex-col gap-3 rounded-xl border border-[#e8edf3] bg-white p-4 lg:flex-row lg:items-center">
        <label className="relative block flex-1">
          <span className="sr-only">Cari kode atau nama jenis masalah</span>
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8a97a3]" />
          <Input
            value={props.search}
            placeholder="Cari kode atau nama jenis masalah…"
            onChange={(e) => props.onSearch(e.target.value)}
            className="rounded-lg border-[#dfe6ec] pl-9"
          />
        </label>
        <Select
          aria-label="Filter kategori"
          value={props.category}
          onChange={(e) => props.onCategory(e.target.value)}
          className="rounded-lg border-[#dfe6ec] lg:w-64"
        >
          <option value="">Semua Kategori</option>
          {props.categories
            .filter((c) => c.isActive)
            .map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
        </Select>
        <Toggle
          checked={props.showInactive}
          onFlip={() => props.onShowInactive(!props.showInactive)}
        />
        <div className="lg:ms-auto">
          <Button type="button" onClick={props.onAdd} className="w-full rounded-lg lg:w-auto">
            <PlusIcon className="h-4 w-4" />
            Tambah Jenis Masalah
          </Button>
        </div>
      </div>
      {props.actionError !== null ? (
        <div className="mt-4">
          <ErrorPanel message={props.actionError} />
        </div>
      ) : null}
      {paged.total === 0 ? (
        <div className="mt-4">
          <EmptyState
            title="Belum ada jenis masalah"
            description="Tambah jenis masalah pertama lewat tombol di atas."
          />
        </div>
      ) : (
        <div className="mt-4 overflow-hidden rounded-xl border border-[#e8edf3] bg-white">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-[#e8edf3] bg-[#f8fafc]">
                  <th scope="col" className="px-6 py-3 text-xs font-semibold text-[#64748b]">
                    KODE
                  </th>
                  <th scope="col" className="px-6 py-3 text-xs font-semibold text-[#64748b]">
                    NAMA JENIS MASALAH
                  </th>
                  <th scope="col" className="px-6 py-3 text-xs font-semibold text-[#64748b]">
                    KATEGORI
                  </th>
                  <th scope="col" className="px-6 py-3 text-xs font-semibold text-[#64748b]">
                    STATUS DATA
                  </th>
                  <th
                    scope="col"
                    className="px-6 py-3 text-right text-xs font-semibold text-[#64748b]"
                  >
                    AKSI
                  </th>
                </tr>
              </thead>
              <tbody>
                {paged.items.map((row) => (
                  <tr
                    key={row.id}
                    className="border-t border-[#e8edf3] first:border-t-0 hover:bg-[#fafcff]"
                  >
                    <td className="whitespace-nowrap px-6 py-4">
                      <TicketMono className="text-[13px] text-[#5c6b7a]">{row.code}</TicketMono>
                    </td>
                    <td className="px-6 py-4 text-[14px] font-semibold text-[#202a33]">
                      {row.name}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-[14px] text-[#4a5a6a]">
                      {row.categoryId === null
                        ? 'Umum'
                        : (props.catNames.get(row.categoryId) ?? '—')}
                    </td>
                    <td className="whitespace-nowrap px-6 py-4">
                      <StatusPill active={row.isActive} />
                    </td>
                    <td className="whitespace-nowrap px-6 py-4 text-right text-[14px]">
                      <RowActions
                        active={row.isActive}
                        busy={props.actionId === row.id}
                        onEdit={() => props.onEdit(row)}
                        onToggle={() => props.onToggle(row)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-col gap-3 border-t border-[#e8edf3] px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[14px] text-[#5c6b7a]">
              Menampilkan {paged.from}–{paged.to} dari {paged.total} jenis masalah referensi
            </p>
            <Pager
              current={paged.currentPage}
              totalPages={paged.totalPages}
              items={masterPaginationItems(paged.currentPage, paged.totalPages)}
              onPage={props.onPage}
            />
          </div>
        </div>
      )}
    </>
  );
}

function DialogShell(props: {
  readonly title: string;
  readonly subtitle: string;
  readonly onClose: () => void;
  readonly children: ReactNode;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={props.title}
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#0b1c24]/50 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) props.onClose();
      }}
    >
      <div className="w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-text">{props.title}</h2>
            <p className="mt-1 text-sm text-muted">{props.subtitle}</p>
          </div>
          <button
            type="button"
            aria-label="Tutup dialog"
            onClick={props.onClose}
            className="rounded-md p-2 text-muted hover:bg-background"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>
        {props.children}
      </div>
    </div>
  );
}

function LocationDialog(props: {
  readonly modal: Exclude<LocationModal, { kind: 'closed' }>;
  readonly locations: readonly MasterLocation[];
  readonly onClose: () => void;
  readonly onSaved: (saved: MasterLocation, created: boolean) => void;
}) {
  const { modal } = props;
  const editing = modal.kind === 'edit' ? modal.row : null;
  const [type, setType] = useState(editing?.type ?? 'ROOM');
  const [code, setCode] = useState(editing?.code ?? '');
  const [name, setName] = useState(editing?.name ?? '');
  const [buildingCode, setBuildingCode] = useState(editing?.buildingCode ?? '');
  const [floor, setFloor] = useState(
    editing?.floorNumber === null || editing?.floorNumber === undefined
      ? ''
      : String(editing.floorNumber),
  );
  const [savePending, setSavePending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const buildings = useMemo(
    () => props.locations.filter((r) => r.type === 'BUILDING'),
    [props.locations],
  );
  async function onSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (code.trim() === '' || name.trim() === '') {
      setError('Kode dan nama lokasi wajib diisi.');
      return;
    }
    const parsedFloor = floor.trim() === '' ? null : Number(floor);
    if (parsedFloor !== null && !Number.isInteger(parsedFloor)) {
      setError('Lantai harus bilangan bulat (cth. 1).');
      return;
    }
    setSavePending(true);
    setError(null);
    try {
      const payload = {
        type,
        code: code.trim(),
        name: name.trim(),
        buildingCode: buildingCode.trim() === '' ? null : buildingCode.trim(),
        floorNumber: parsedFloor,
      };
      const url =
        modal.kind === 'edit'
          ? '/api/admin/locations/' + encodeURIComponent(modal.row.id)
          : '/api/admin/locations';
      const res = await fetch(url, {
        method: modal.kind === 'edit' ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        setError(await errMsg(res, 'Gagal menyimpan lokasi'));
        return;
      }
      const saved = toLocation(await res.json());
      if (saved === null) {
        setError('Respons lokasi tidak valid.');
        return;
      }
      props.onSaved(saved, modal.kind === 'create');
    } catch {
      setError('Tidak dapat terhubung ke server.');
    } finally {
      setSavePending(false);
    }
  }

  return (
    <DialogShell
      title={modal.kind === 'create' ? 'Tambah Lokasi' : 'Ubah Lokasi'}
      subtitle={
        modal.kind === 'create'
          ? 'Kode mengikuti master kampus; nama gedung diambil dari kode bangunan.'
          : 'Menyunting ' + modal.row.code + ' — ' + modal.row.name + '.'
      }
      onClose={props.onClose}
    >
      <form onSubmit={(e) => void onSubmit(e)} className="mt-4 grid gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="md-loc-type" className="mb-1 block text-sm font-medium text-text">
              Tipe
            </label>
            <Select
              id="md-loc-type"
              value={type}
              onChange={(e) => setType(e.target.value)}
              disabled={savePending}
            >
              <option value="ROOM">Ruangan</option>
              <option value="SHARED_AREA">Area bersama</option>
              <option value="FLOOR">Lantai</option>
              <option value="BUILDING">Gedung</option>
            </Select>
          </div>
          <div>
            <label htmlFor="md-loc-code" className="mb-1 block text-sm font-medium text-text">
              Kode / ID Lokasi
            </label>
            <Input
              id="md-loc-code"
              value={code}
              maxLength={64}
              placeholder="cth: 22.4C.01.020"
              onChange={(e) => setCode(e.target.value)}
              disabled={savePending}
              invalid={error !== null && code.trim() === ''}
              aria-describedby={error !== null ? 'md-loc-err' : undefined}
            />
          </div>
        </div>
        <div>
          <label htmlFor="md-loc-name" className="mb-1 block text-sm font-medium text-text">
            Nama ruangan / area
          </label>
          <Input
            id="md-loc-name"
            value={name}
            maxLength={256}
            placeholder="cth: Ruang 14"
            onChange={(e) => setName(e.target.value)}
            disabled={savePending}
            invalid={error !== null && name.trim() === ''}
            aria-describedby={error !== null ? 'md-loc-err' : undefined}
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="md-loc-b" className="mb-1 block text-sm font-medium text-text">
              Gedung (opsional)
            </label>
            <Select
              id="md-loc-b"
              value={buildingCode}
              onChange={(e) => setBuildingCode(e.target.value)}
              disabled={savePending}
            >
              <option value="">Tanpa gedung</option>
              {buildings.map((r) => (
                <option key={r.id} value={r.buildingCode ?? r.code}>
                  {r.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label htmlFor="md-loc-f" className="mb-1 block text-sm font-medium text-text">
              Lantai (opsional)
            </label>
            <Input
              id="md-loc-f"
              value={floor}
              inputMode="numeric"
              placeholder="cth: 1"
              onChange={(e) => setFloor(e.target.value)}
              disabled={savePending}
            />
          </div>
        </div>
        {error !== null ? <FieldError id="md-loc-err" message={error} /> : null}
        <div className="mt-1 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={props.onClose}
            className={buttonBaseClasses + ' ' + buttonVariantClasses.secondary}
          >
            Batal
          </button>
          <Button type="submit" disabled={savePending}>
            {savePending
              ? 'Menyimpan…'
              : modal.kind === 'create'
                ? 'Tambah lokasi'
                : 'Simpan perubahan'}
          </Button>
        </div>
      </form>
    </DialogShell>
  );
}

function CategoryDialog(props: {
  readonly modal: Exclude<CategoryModal, { kind: 'closed' }>;
  readonly onClose: () => void;
  readonly onSaved: (saved: CategoryRow, created: boolean) => void;
}) {
  const { modal } = props;
  const editing = modal.kind === 'edit' ? modal.row : null;
  const [code, setCode] = useState(editing?.code ?? '');
  const [name, setName] = useState(editing?.name ?? '');
  const [weight, setWeight] = useState(editing === null ? '' : String(editing.weight));
  const [savePending, setSavePending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function onSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (code.trim() === '' || name.trim() === '') {
      setError('Kode dan nama kategori wajib diisi.');
      return;
    }
    const parsed = weight.trim() === '' ? null : Number(weight);
    if (parsed !== null && (!Number.isInteger(parsed) || parsed < 0 || parsed > 40)) {
      setError('Bobot harus 0–40 (cth. 10).');
      return;
    }
    setSavePending(true);
    setError(null);
    try {
      const payload = {
        code: code.trim(),
        name: name.trim(),
        ...(parsed === null ? {} : { weight: parsed }),
      };
      const url =
        modal.kind === 'edit'
          ? '/api/admin/categories/' + encodeURIComponent(modal.row.id)
          : '/api/admin/categories';
      const res = await fetch(url, {
        method: modal.kind === 'edit' ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        setError(await errMsg(res, 'Gagal menyimpan kategori'));
        return;
      }
      const saved = toCategory(await res.json());
      if (saved === null) {
        setError('Respons kategori tidak valid.');
        return;
      }
      props.onSaved(saved, modal.kind === 'create');
    } catch {
      setError('Tidak dapat terhubung ke server.');
    } finally {
      setSavePending(false);
    }
  }
  return (
    <DialogShell
      title={modal.kind === 'create' ? 'Tambah Kategori' : 'Ubah Kategori'}
      subtitle="Kode unik maks 32 karakter; bobot 0–40."
      onClose={props.onClose}
    >
      <form onSubmit={(e) => void onSubmit(e)} className="mt-4 grid gap-3">
        <div>
          <label htmlFor="md-cat-code" className="mb-1 block text-sm font-medium text-text">
            Kode
          </label>
          <Input
            id="md-cat-code"
            value={code}
            maxLength={32}
            placeholder="cth: HVAC"
            onChange={(e) => setCode(e.target.value)}
            disabled={savePending}
            invalid={error !== null && code.trim() === ''}
            aria-describedby={error !== null ? 'md-cat-err' : undefined}
          />
        </div>
        <div>
          <label htmlFor="md-cat-name" className="mb-1 block text-sm font-medium text-text">
            Nama kategori
          </label>
          <Input
            id="md-cat-name"
            value={name}
            maxLength={128}
            placeholder="cth: AC dan pendingin"
            onChange={(e) => setName(e.target.value)}
            disabled={savePending}
            invalid={error !== null && name.trim() === ''}
            aria-describedby={error !== null ? 'md-cat-err' : undefined}
          />
        </div>
        <div>
          <label htmlFor="md-cat-w" className="mb-1 block text-sm font-medium text-text">
            Bobot (opsional)
          </label>
          <Input
            id="md-cat-w"
            value={weight}
            inputMode="numeric"
            placeholder="cth: 10"
            onChange={(e) => setWeight(e.target.value)}
            disabled={savePending}
          />
        </div>
        {error !== null ? <FieldError id="md-cat-err" message={error} /> : null}
        <div className="mt-1 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={props.onClose}
            className={buttonBaseClasses + ' ' + buttonVariantClasses.secondary}
          >
            Batal
          </button>
          <Button type="submit" disabled={savePending}>
            {savePending
              ? 'Menyimpan…'
              : modal.kind === 'create'
                ? 'Tambah kategori'
                : 'Simpan perubahan'}
          </Button>
        </div>
      </form>
    </DialogShell>
  );
}

function IssueDialog(props: {
  readonly modal: Exclude<IssueModal, { kind: 'closed' }>;
  readonly categories: readonly CategoryRow[];
  readonly onClose: () => void;
  readonly onSaved: (saved: IssueRow, created: boolean) => void;
}) {
  const { modal } = props;
  const editing = modal.kind === 'edit' ? modal.row : null;
  const [code, setCode] = useState(editing?.code ?? '');
  const [name, setName] = useState(editing?.name ?? '');
  const [categoryId, setCategoryId] = useState(editing?.categoryId ?? '');
  const [savePending, setSavePending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function onSubmit(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (code.trim() === '' || name.trim() === '') {
      setError('Kode dan nama jenis masalah wajib diisi.');
      return;
    }
    setSavePending(true);
    setError(null);
    try {
      const payload = {
        code: code.trim(),
        name: name.trim(),
        categoryId: categoryId === '' ? null : categoryId,
      };
      const url =
        modal.kind === 'edit'
          ? '/api/admin/issue-types/' + encodeURIComponent(modal.row.id)
          : '/api/admin/issue-types';
      const res = await fetch(url, {
        method: modal.kind === 'edit' ? 'PATCH' : 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        setError(await errMsg(res, 'Gagal menyimpan jenis masalah'));
        return;
      }
      const saved = toIssue(await res.json());
      if (saved === null) {
        setError('Respons jenis masalah tidak valid.');
        return;
      }
      props.onSaved(saved, modal.kind === 'create');
    } catch {
      setError('Tidak dapat terhubung ke server.');
    } finally {
      setSavePending(false);
    }
  }
  return (
    <DialogShell
      title={modal.kind === 'create' ? 'Tambah Jenis Masalah' : 'Ubah Jenis Masalah'}
      subtitle="Kategori opsional — kosong berarti umum."
      onClose={props.onClose}
    >
      <form onSubmit={(e) => void onSubmit(e)} className="mt-4 grid gap-3">
        <div>
          <label htmlFor="md-iss-code" className="mb-1 block text-sm font-medium text-text">
            Kode
          </label>
          <Input
            id="md-iss-code"
            value={code}
            maxLength={64}
            placeholder="cth: LEAKING"
            onChange={(e) => setCode(e.target.value)}
            disabled={savePending}
            invalid={error !== null && code.trim() === ''}
            aria-describedby={error !== null ? 'md-iss-err' : undefined}
          />
        </div>
        <div>
          <label htmlFor="md-iss-name" className="mb-1 block text-sm font-medium text-text">
            Nama jenis masalah
          </label>
          <Input
            id="md-iss-name"
            value={name}
            maxLength={128}
            placeholder="cth: Bocor atau mampet"
            onChange={(e) => setName(e.target.value)}
            disabled={savePending}
            invalid={error !== null && name.trim() === ''}
            aria-describedby={error !== null ? 'md-iss-err' : undefined}
          />
        </div>
        <div>
          <label htmlFor="md-iss-cat" className="mb-1 block text-sm font-medium text-text">
            Kategori (opsional)
          </label>
          <Select
            id="md-iss-cat"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            disabled={savePending}
          >
            <option value="">Umum</option>
            {props.categories
              .filter((c) => c.isActive)
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
          </Select>
        </div>
        {error !== null ? <FieldError id="md-iss-err" message={error} /> : null}
        <div className="mt-1 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={props.onClose}
            className={buttonBaseClasses + ' ' + buttonVariantClasses.secondary}
          >
            Batal
          </button>
          <Button type="submit" disabled={savePending}>
            {savePending
              ? 'Menyimpan…'
              : modal.kind === 'create'
                ? 'Tambah jenis masalah'
                : 'Simpan perubahan'}
          </Button>
        </div>
      </form>
    </DialogShell>
  );
}
