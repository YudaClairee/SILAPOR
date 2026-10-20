// Kelola Aset (Figma 150:1748, admin/UMPER): breadcrumb + header + Tambah,
// kartu "Kondisi Fasilitas Per Lokasi Kampus" (agregasi per gedung dari
// proyeksi status), filter card (search kode/nama + lokasi + kategori +
// status + toggle nonaktif, client-side), tabel 8 kolom + pagination 6
// baris + dialog Tambah/Ubah + aksi Nonaktifkan/Aktifkan.
//
// Data: GET /api/facilities/status (limit 200, includeInactive — field baru
// buildingName/categoryId/createdAt) + GET /api/reports/form-options
// (opsi kategori; lokasi dropdown dibangun dari buildingName hasil agregasi).
// Kolom TAHUN = tahun Jakarta dari `createdAt` (facility_assets tak punya
// kolom tahun pengadaan). SSR-fallback loader mengikuti teknisi/lokasi.
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { jakartaYearOf } from '../lib/asset-history.js';
import {
  DEFAULT_ASSET_MANAGE_FILTERS,
  assetPaginationItems,
  filterAssetRows,
  groupAssetsByBuilding,
  paginateAssetRows,
  type AssetManageFilters,
  type AssetManageRow,
} from '../lib/admin-assets.js';
import {
  BuildingIcon,
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

interface StatusItem {
  readonly assetId: string;
  readonly assetCode: string;
  readonly assetName: string;
  readonly locationLabel: string;
  readonly buildingName: string | null;
  readonly categoryName: string | null;
  readonly categoryId: string | null;
  readonly derivedStatus: string;
  readonly isActive: boolean;
  readonly activeReportCount: number;
  readonly lastUpdated: string;
  readonly createdAt: string;
}

interface CategoryOption {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

interface LoaderData {
  readonly items: StatusItem[] | null;
  readonly categories: CategoryOption[];
  readonly loadError: string | null;
  readonly forbidden: boolean;
  readonly needsClientLoad: boolean;
}

type Bundle =
  | {
      readonly items: StatusItem[] | null;
      readonly categories: CategoryOption[];
      readonly loadError: string | null;
      readonly forbidden: boolean;
    }
  | 'unauthorized'
  | 'unavailable';

/** Baris per halaman — desain menampilkan 6 baris per halaman. */
const PAGE_SIZE = 6;

const STATUS_OPTIONS = [
  { value: '', label: 'Semua Status Fasilitas' },
  { value: 'OPERATIONAL', label: 'Operational' },
  { value: 'UNDER_INSPECTION', label: 'Under Inspection' },
  { value: 'IN_REPAIR', label: 'In Repair' },
] as const;

function toManageRow(item: StatusItem): AssetManageRow {
  return {
    assetId: item.assetId,
    assetCode: item.assetCode,
    assetName: item.assetName,
    locationLabel: item.locationLabel,
    buildingName: item.buildingName,
    categoryName: item.categoryName,
    installYear: jakartaYearOf(item.createdAt),
    derivedStatus: item.derivedStatus,
    isActive: item.isActive,
    activeReportCount: item.activeReportCount,
  };
}

function parseItems(value: unknown): StatusItem[] | null {
  if (value === null || typeof value !== 'object') return null;
  const record = value as { readonly items?: unknown };
  if (!Array.isArray(record.items)) return null;
  return record.items as StatusItem[];
}

function parseCategories(value: unknown): CategoryOption[] {
  if (value === null || typeof value !== 'object') return [];
  const record = value as { readonly categories?: unknown };
  if (!Array.isArray(record.categories)) return [];
  return (record.categories as readonly unknown[]).filter(
    (entry): entry is CategoryOption =>
      entry !== null &&
      typeof entry === 'object' &&
      typeof (entry as CategoryOption).id === 'string' &&
      typeof (entry as CategoryOption).name === 'string',
  );
}

async function fetchBundle(): Promise<Bundle> {
  let statusRes: Response;
  let optionsRes: Response | null = null;
  try {
    [statusRes, optionsRes] = await Promise.all([
      fetch('/api/facilities/status?include_inactive=true&limit=200', { credentials: 'include' }),
      fetch('/api/reports/form-options', { credentials: 'include' }).catch(() => null),
    ]);
  } catch {
    return 'unavailable';
  }
  if (statusRes.status === 401) return 'unauthorized';
  if (statusRes.status === 403) {
    return { items: null, categories: [], loadError: null, forbidden: true };
  }
  if (!statusRes.ok) {
    return {
      items: null,
      categories: [],
      loadError: `Gagal memuat aset (${statusRes.status}).`,
      forbidden: false,
    };
  }
  try {
    const items = parseItems(await statusRes.json());
    let categories: CategoryOption[] = [];
    if (optionsRes !== null && optionsRes.ok) {
      try {
        categories = parseCategories(await optionsRes.json());
      } catch {
        categories = [];
      }
    }
    if (items === null) {
      return { items: null, categories, loadError: 'Respons aset tidak valid.', forbidden: false };
    }
    return { items, categories, loadError: null, forbidden: false };
  } catch {
    return { items: null, categories: [], loadError: 'Respons aset tidak valid.', forbidden: false };
  }
}

async function errMsg(res: Response, fallback: string): Promise<string> {
  try {
    const data = (await res.json()) as { readonly error?: { readonly message?: unknown } };
    if (typeof data.error?.message === 'string' && data.error.message !== '') {
      return data.error.message;
    }
  } catch {}
  return `${fallback} (${res.status}).`;
}

export const Route = createFileRoute('/admin/facilities/')({
  loader: async (): Promise<LoaderData> => {
    const bundle = await fetchBundle();
    if (bundle === 'unauthorized') throw redirect({ to: '/login' });
    if (bundle === 'unavailable') {
      // SSR relative-URL fetch (or offline): the component loads client-side.
      return { items: null, categories: [], loadError: null, forbidden: false, needsClientLoad: true };
    }
    return { ...bundle, needsClientLoad: false };
  },
  pendingComponent: Pending,
  component: Page,
});

function Pending() {
  return (
    <section aria-labelledby="ka-title">
      <p className="text-sm text-muted">
        Fasilitas &amp; Aset › <span className="font-medium text-text">Kelola Aset</span>
      </p>
      <h1 id="ka-title" className="mt-2 text-[34px] font-bold leading-tight text-text">
        Kelola Aset
      </h1>
      <div className="mt-4">
        <LoadingState message="Memuat aset…" />
      </div>
    </section>
  );
}

type ModalState =
  | { readonly kind: 'closed' }
  | { readonly kind: 'create' }
  | { readonly kind: 'edit'; readonly row: AssetManageRow };

function Page() {
  const loader = Route.useLoaderData() as LoaderData;
  const navigate = useNavigate();
  const [items, setItems] = useState<StatusItem[] | null>(
    loader.needsClientLoad ? null : loader.items,
  );
  const [categories, setCategories] = useState<CategoryOption[]>(loader.categories);
  const [pending, setPending] = useState(loader.needsClientLoad);
  const [loadError, setLoadError] = useState<string | null>(loader.loadError);
  const [forbidden, setForbidden] = useState(loader.forbidden);

  const [filters, setFilters] = useState<AssetManageFilters>(DEFAULT_ASSET_MANAGE_FILTERS);
  const [page, setPage] = useState(1);

  const [modal, setModal] = useState<ModalState>({ kind: 'closed' });
  const [fCode, setFCode] = useState('');
  const [fName, setFName] = useState('');
  const [fCategoryId, setFCategoryId] = useState('');
  const [fLocationLabel, setFLocationLabel] = useState('');
  const [fpending, setFpending] = useState(false);
  const [ferr, setFerr] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function reload(): Promise<void> {
    setPending(true);
    const bundle = await fetchBundle();
    if (bundle === 'unauthorized') {
      await navigate({ to: '/login' });
      return;
    }
    if (bundle === 'unavailable') {
      setLoadError('Tidak dapat terhubung ke server.');
    } else {
      setItems(bundle.items);
      setCategories(bundle.categories);
      setLoadError(bundle.loadError);
      setForbidden(bundle.forbidden);
    }
    setPending(false);
  }

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
        setLoadError('Tidak dapat terhubung ke server.');
      } else {
        setItems(bundle.items);
        setCategories(bundle.categories);
        setLoadError(bundle.loadError);
        setForbidden(bundle.forbidden);
      }
      setPending(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [loader.needsClientLoad, navigate]);

  const rows = useMemo(() => (items ?? []).map(toManageRow), [items]);

  const buildingOptions = useMemo(() => {
    const names = new Set<string>();
    for (const row of rows) {
      if (row.buildingName !== null && row.buildingName.trim() !== '') names.add(row.buildingName);
    }
    return Array.from(names).sort((a, b) => (a < b ? -1 : 1));
  }, [rows]);

  const categoryOptions = useMemo(() => {
    if (categories.length > 0) return [...categories].sort((a, b) => (a.name < b.name ? -1 : 1));
    const seen = new Map<string, CategoryOption>();
    for (const item of items ?? []) {
      if (item.categoryName !== null && !seen.has(item.categoryName)) {
        seen.set(item.categoryName, {
          id: item.categoryId ?? item.categoryName,
          code: item.categoryId ?? item.categoryName,
          name: item.categoryName,
        });
      }
    }
    return Array.from(seen.values()).sort((a, b) => (a.name < b.name ? -1 : 1));
  }, [categories, items]);

  const filtered = useMemo(() => filterAssetRows(rows, filters), [rows, filters]);
  const groups = useMemo(() => groupAssetsByBuilding(rows), [rows]);
  const paged = useMemo(() => paginateAssetRows(filtered, page, PAGE_SIZE), [filtered, page]);
  const pageItems = useMemo(
    () => assetPaginationItems(paged.currentPage, paged.totalPages),
    [paged],
  );

  useEffect(() => {
    setPage(1);
  }, [filters, items]);

  useEffect(() => {
    if (paged.totalPages > 0 && page > paged.totalPages) setPage(paged.totalPages);
  }, [paged.totalPages, page]);

  function setFilter<K extends keyof AssetManageFilters>(
    key: K,
    value: AssetManageFilters[K],
  ): void {
    setFilters((previous) => ({ ...previous, [key]: value }));
  }

  function openCreate(): void {
    setFCode('');
    setFName('');
    setFCategoryId('');
    setFLocationLabel('');
    setFerr(null);
    setModal({ kind: 'create' });
  }

  function openEdit(row: AssetManageRow): void {
    setFCode(row.assetCode);
    setFName(row.assetName);
    setFCategoryId('');
    setFLocationLabel(row.locationLabel);
    setFerr(null);
    setModal({ kind: 'edit', row });
  }

  async function submitNewAsset(): Promise<void> {
    const payload: Record<string, string | null> = {
      assetCode: fCode.trim(),
      name: fName.trim(),
      categoryId: fCategoryId === '' ? null : fCategoryId,
    };
    const response = await fetch('/api/admin/assets', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      setFerr(await errMsg(response, 'Gagal menyimpan aset'));
      return;
    }
    setModal({ kind: 'closed' });
    setNotice('Aset berhasil ditambahkan.');
    await reload();
  }

  async function submitEditAsset(row: AssetManageRow): Promise<void> {
    const response = await fetch(`/api/admin/assets/${encodeURIComponent(row.assetId)}`, {
      method: 'PATCH',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        assetCode: fCode.trim(),
        name: fName.trim(),
        categoryId: fCategoryId === '' ? null : fCategoryId,
      }),
    });
    if (!response.ok) {
      setFerr(await errMsg(response, 'Gagal menyimpan aset'));
      return;
    }
    setModal({ kind: 'closed' });
    setNotice('Perubahan aset disimpan.');
    await reload();
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (fpending || modal.kind === 'closed') return;
    if (fCode.trim() === '' || fName.trim() === '') {
      setFerr('Kode aset dan nama aset wajib diisi.');
      return;
    }
    setFpending(true);
    setFerr(null);
    try {
      if (modal.kind === 'create') await submitNewAsset();
      else await submitEditAsset(modal.row);
    } finally {
      setFpending(false);
    }
  }

  async function onToggle(row: AssetManageRow): Promise<void> {
    if (actionId !== null) return;
    if (row.isActive && row.activeReportCount > 0) {
      setActionError(
        `Aset ${row.assetCode} masih memiliki ${row.activeReportCount} tiket aktif.`,
      );
      return;
    }
    setActionId(row.assetId);
    setActionError(null);
    setNotice(null);
    try {
      const response = await fetch(`/api/admin/assets/${encodeURIComponent(row.assetId)}`, {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ isActive: !row.isActive }),
      });
      if (!response.ok) {
        setActionError(await errMsg(response, 'Gagal memperbarui status aset'));
        return;
      }
      setNotice(row.isActive ? `Aset ${row.assetCode} dinonaktifkan.` : `Aset ${row.assetCode} diaktifkan.`);
      await reload();
    } finally {
      setActionId(null);
    }
  }

  return (
    <section aria-labelledby="ka-title" className="w-full">
      <p className="text-sm text-muted">
        Fasilitas &amp; Aset › <span className="font-medium text-text">Kelola Aset</span>
      </p>
      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 id="ka-title" className="text-[34px] font-bold leading-tight text-text">
            Kelola Aset
          </h1>
          <p className="mt-1 max-w-[90ch] text-[14px] text-muted">
            Kelola data aset dan pantau status kondisi fasilitas kampus yang diperbarui otomatis
            berdasarkan tiket aktif.
          </p>
        </div>
        <Button type="button" onClick={openCreate} className="shrink-0">
          <PlusIcon className="h-4 w-4" />
          Tambah Aset
        </Button>
      </div>

      {pending ? (
        <div className="mt-6">
          <LoadingState message="Memuat aset…" />
        </div>
      ) : loadError !== null ? (
        <div className="mt-6">
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
        <div className="mt-6">
          <ErrorPanel title="Akses ditolak" message="Halaman ini hanya untuk admin." />
        </div>
      ) : (
        <>
          <ConditionSection groups={groups} />
          <FilterBar
            filters={filters}
            setFilter={setFilter}
            buildingOptions={buildingOptions}
            categoryOptions={categoryOptions}
          />
          {notice !== null ? (
            <p role="status" className="mt-4 rounded-md border border-border bg-surface px-4 py-2 text-sm text-text">
              {notice}
            </p>
          ) : null}
          {actionError !== null ? (
            <div className="mt-4">
              <ErrorPanel message={actionError} />
            </div>
          ) : null}
          <AssetTable
            paged={paged}
            pageItems={pageItems}
            filteredEmpty={filtered.length === 0}
            actionId={actionId}
            onEdit={openEdit}
            onToggle={(row) => void onToggle(row)}
            onPage={setPage}
          />
        </>
      )}

      {modal.kind === 'closed' ? null : (
        <AssetModal
          modal={modal}
          code={fCode}
          name={fName}
          categoryId={fCategoryId}
          locationLabel={fLocationLabel}
          categoryOptions={categoryOptions}
          pending={fpending}
          error={ferr}
          onCode={setFCode}
          onName={setFName}
          onCategory={setFCategoryId}
          onClose={() => setModal({ kind: 'closed' })}
          onSubmit={(event) => void onSubmit(event)}
        />
      )}
    </section>
  );
}

function FilterBar({
  filters,
  setFilter,
  buildingOptions,
  categoryOptions,
}: {
  readonly filters: AssetManageFilters;
  readonly setFilter: <K extends keyof AssetManageFilters>(
    key: K,
    value: AssetManageFilters[K],
  ) => void;
  readonly buildingOptions: readonly string[];
  readonly categoryOptions: readonly CategoryOption[];
}) {
  return (
    <div className="mt-6 rounded-2xl border border-[#e8edf3] bg-white p-4">
      <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr_1fr_1fr_auto] lg:items-center">
        <label className="relative block">
          <span className="sr-only">Cari kode aset atau nama aset</span>
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8a97a3]" />
          <Input
            type="search"
            value={filters.search}
            placeholder="Cari kode aset atau nama aset..."
            onChange={(event) => setFilter('search', event.target.value)}
            className="border-transparent bg-[#eef4ff] pl-9"
          />
        </label>
        <label className="block">
          <span className="sr-only">Lokasi</span>
          <Select
            value={filters.building}
            onChange={(event) => setFilter('building', event.target.value)}
            className="border-transparent bg-[#eef4ff]"
          >
            <option value="">Semua Lokasi</option>
            {buildingOptions.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </Select>
        </label>
        <label className="block">
          <span className="sr-only">Kategori</span>
          <Select
            value={filters.category}
            onChange={(event) => setFilter('category', event.target.value)}
            className="border-transparent bg-[#eef4ff]"
          >
            <option value="">Semua Kategori</option>
            {categoryOptions.map((option) => (
              <option key={option.id} value={option.name}>
                {option.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="block">
          <span className="sr-only">Status fasilitas</span>
          <Select
            value={filters.status}
            onChange={(event) => setFilter('status', event.target.value)}
            className="border-transparent bg-[#eef4ff]"
          >
            {STATUS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex min-h-[44px] cursor-pointer items-center gap-2 text-[13px] text-[#3f4c57]">
          <input
            type="checkbox"
            checked={filters.includeInactive}
            onChange={(event) => setFilter('includeInactive', event.target.checked)}
            className="h-4 w-4 rounded accent-[#0a3947]"
          />
          Tampilkan aset nonaktif
        </label>
      </div>
    </div>
  );
}

function ConditionSection({
  groups,
}: {
  readonly groups: ReadonlyArray<{
    readonly buildingName: string;
    readonly total: number;
    readonly operational: number;
    readonly underInspection: number;
    readonly inRepair: number;
  }>;
}) {
  return (
    <section aria-labelledby="ka-condition-title" className="mt-6">
      <h2 id="ka-condition-title" className="flex items-center gap-2 text-[20px] font-bold text-text">
        <BuildingIcon className="h-5 w-5" />
        Kondisi Fasilitas Per Lokasi Kampus
      </h2>
      {groups.length === 0 ? (
        <div className="mt-3">
          <EmptyState
            title="Belum ada aset aktif"
            description="Tambah aset pertama melalui tombol Tambah Aset."
          />
        </div>
      ) : (
        <div className="mt-3 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {groups.map((group) => (
            <ConditionCard key={group.buildingName} group={group} />
          ))}
        </div>
      )}
    </section>
  );
}

function ConditionCard({
  group,
}: {
  readonly group: {
    readonly buildingName: string;
    readonly total: number;
    readonly operational: number;
    readonly underInspection: number;
    readonly inRepair: number;
  };
}) {
  const operationalPct = group.total === 0 ? 0 : (group.operational / group.total) * 100;
  const inspectionPct = group.total === 0 ? 0 : (group.underInspection / group.total) * 100;
  return (
    <article className="rounded-2xl border border-[#e8edf3] bg-white p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-[17px] font-bold text-text">{group.buildingName}</h3>
        <p className="font-mono text-[17px] font-semibold text-text">{group.total}</p>
      </div>
      <div
        role="img"
        aria-label={`${group.buildingName}: ${group.operational} operasional`}
        className="mt-2 flex h-2.5 w-full overflow-hidden rounded-full bg-[#e8edf3]"
      >
        <span style={{ width: `${operationalPct}%` }} className="h-full bg-[#2f5d64]" />
        <span style={{ width: `${inspectionPct}%` }} className="h-full bg-[#8ec5d3]" />
        {group.inRepair > 0 ? <span className="h-full flex-1 bg-[#c0392b]" /> : null}
      </div>
      <dl className="mt-3 space-y-1.5 text-[13px]">
        <div className="flex items-center justify-between gap-2">
          <dt className="flex items-center gap-2 text-[#3f4c57]">
            <span aria-hidden="true" className="h-2 w-2 rounded-full bg-[#0a3947]" />
            Operational
          </dt>
          <dd className="font-semibold text-text">{group.operational}</dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="flex items-center gap-2 text-[#3f4c57]">
            <span aria-hidden="true" className="h-2 w-2 rounded-full bg-[#8ec5d3]" />
            Under Inspection
          </dt>
          <dd className="text-[#3f4c57]">{group.underInspection}</dd>
        </div>
        <div className="flex items-center justify-between gap-2">
          <dt className="flex items-center gap-2 text-[#3f4c57]">
            <span aria-hidden="true" className="h-2 w-2 rounded-full bg-[#c0392b]" />
            In Repair
          </dt>
          <dd className={group.inRepair > 0 ? 'font-semibold text-[#c0392b]' : 'text-[#3f4c57]'}>
            {group.inRepair}
          </dd>
        </div>
      </dl>
    </article>
  );
}

function FacilityStatusPill({ status }: { readonly status: string }) {
  if (status === 'IN_REPAIR') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-[#fbe4e1] px-3 py-1 text-[13px] font-medium text-[#8f332c]">
        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[#c0392b]" />
        In Repair
      </span>
    );
  }
  if (status === 'UNDER_INSPECTION') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-[#e5edf4] px-3 py-1 text-[13px] font-medium text-[#33567d]">
        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[#33567d]" />
        Under Inspection
      </span>
    );
  }
  if (status === 'OPERATIONAL') {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-[#d6ecf3] px-3 py-1 text-[13px] font-medium text-[#0a3947]">
        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[#0a3947]" />
        Operational
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-[#eceff1] px-3 py-1 text-[13px] font-medium text-[#525d66]">
      {status}
    </span>
  );
}

interface AssetTablePaged {
  readonly items: readonly AssetManageRow[];
  readonly total: number;
  readonly totalPages: number;
  readonly currentPage: number;
  readonly from: number;
  readonly to: number;
}

const ASSET_COLUMNS = [
  'Kode / ID Aset',
  'Nama Aset',
  'Kategori',
  'Lokasi',
  'Tahun',
  'Status Fasilitas',
  'Status Data',
  'Aksi',
] as const;

function AssetRow({
  row,
  actionId,
  onEdit,
  onToggle,
}: {
  readonly row: AssetManageRow;
  readonly actionId: string | null;
  readonly onEdit: (row: AssetManageRow) => void;
  readonly onToggle: (row: AssetManageRow) => void;
}) {
  const blocked = row.isActive && row.activeReportCount > 0;
  return (
    <tr key={row.assetId} className={!row.isActive ? 'bg-[#fafcff]' : undefined}>
      <td className="whitespace-nowrap px-4 py-4">
        <TicketMono className="font-semibold text-text">{row.assetCode}</TicketMono>
      </td>
      <td className="max-w-64 px-4 py-4 font-medium text-text">{row.assetName}</td>
      <td className="max-w-48 px-4 py-4 text-text">{row.categoryName ?? '—'}</td>
      <td className="max-w-56 px-4 py-4 text-text">
        {row.locationLabel === '' ? '—' : row.locationLabel}
      </td>
      <td className="whitespace-nowrap px-4 py-4 text-text">{row.installYear ?? '—'}</td>
      <td className="whitespace-nowrap px-4 py-4">
        <FacilityStatusPill status={row.derivedStatus} />
      </td>
      <td className="whitespace-nowrap px-4 py-4">
        <span
          className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ${row.isActive ? 'bg-[#d6ecf3] text-[#0a3947]' : 'bg-[#eceff1] text-[#525d66]'}`}
        >
          {row.isActive ? 'Aktif' : 'Nonaktif'}
        </span>
      </td>
      <td className="whitespace-nowrap px-4 py-4 text-right">
        <button
          type="button"
          onClick={() => onEdit(row)}
          className="font-medium text-accent hover:underline"
        >
          Ubah
        </button>
        <span aria-hidden="true" className="mx-2 text-border">
          ·
        </span>
        {blocked ? (
          <span
            title="Aset memiliki tiket aktif"
            className="inline-flex cursor-not-allowed items-center gap-1 font-medium text-subtle"
          >
            Nonaktifkan
          </span>
        ) : (
          <button
            type="button"
            disabled={actionId === row.assetId}
            onClick={() => onToggle(row)}
            className="font-medium text-danger hover:underline disabled:cursor-not-allowed disabled:opacity-50"
          >
            {actionId === row.assetId ? 'Memproses…' : row.isActive ? 'Nonaktifkan' : 'Aktifkan'}
          </button>
        )}
      </td>
    </tr>
  );
}

function AssetTable({
  paged,
  pageItems,
  filteredEmpty,
  actionId,
  onEdit,
  onToggle,
  onPage,
}: {
  readonly paged: AssetTablePaged;
  readonly pageItems: ReadonlyArray<number | 'ellipsis'>;
  readonly filteredEmpty: boolean;
  readonly actionId: string | null;
  readonly onEdit: (row: AssetManageRow) => void;
  readonly onToggle: (row: AssetManageRow) => void;
  readonly onPage: (page: number) => void;
}) {
  if (filteredEmpty) {
    return (
      <div className="mt-4">
        <EmptyState
          title="Tidak ada aset yang cocok"
          description="Ubah kata kunci atau filter, atau tambah aset baru."
        />
      </div>
    );
  }
  return (
    <div className="mt-4 overflow-hidden rounded-2xl border border-[#e8edf3] bg-white">
      <div className="overflow-x-auto">
        <table className="w-full min-w-250 border-collapse text-left text-sm">
          <thead>
            <tr className="bg-[#eef4ff]">
              {ASSET_COLUMNS.map((label) => (
                <th
                  key={label}
                  scope="col"
                  className="whitespace-nowrap px-4 py-3 text-xs font-semibold uppercase tracking-wide text-[#5c6b7a]"
                >
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#e8edf3]">
            {paged.items.map((row) => (
              <AssetRow
                key={row.assetId}
                row={row}
                actionId={actionId}
                onEdit={onEdit}
                onToggle={onToggle}
              />
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-col gap-3 border-t border-[#e8edf3] bg-[#f8fafc] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[14px] text-[#5c6b7a]">
          Menampilkan {paged.from} - {paged.to} dari {paged.total} total aset kampus
        </p>
        <nav aria-label="Paginasi aset" className="flex flex-wrap items-center gap-1">
          <PageButton
            label="Sebelumnya"
            disabled={paged.currentPage <= 1}
            onClick={() => onPage(paged.currentPage - 1)}
          />
          {pageItems.map((item, index) =>
            item === 'ellipsis' ? (
              <span key={`e${index}`} aria-hidden="true" className="px-1 text-muted">
                …
              </span>
            ) : (
              <button
                key={item}
                type="button"
                aria-label={`Halaman ${item}`}
                aria-current={item === paged.currentPage ? 'page' : undefined}
                onClick={() => onPage(item)}
                className="inline-flex h-9 min-w-9 items-center justify-center rounded-md px-2 text-[14px] font-medium"
              >
                {item}
              </button>
            ),
          )}
          <PageButton
            label="Selanjutnya"
            disabled={paged.currentPage >= paged.totalPages}
            onClick={() => onPage(paged.currentPage + 1)}
          />
        </nav>
      </div>
    </div>
  );
}

function PageButton({
  label,
  disabled,
  onClick,
}: {
  readonly label: string;
  readonly disabled: boolean;
  readonly onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="inline-flex min-h-[36px] items-center rounded-md bg-white px-3 text-[13px] font-medium text-[#3f4c57] shadow-sm hover:bg-[#eef3fb] disabled:cursor-not-allowed disabled:opacity-40"
    >
      {label}
    </button>
  );
}

function AssetModal({
  modal,
  code,
  name,
  categoryId,
  locationLabel,
  categoryOptions,
  pending: modalPending,
  error,
  onCode,
  onName,
  onCategory,
  onClose,
  onSubmit,
}: {
  readonly modal: Exclude<ModalState, { readonly kind: 'closed' }>;
  readonly code: string;
  readonly name: string;
  readonly categoryId: string;
  readonly locationLabel: string;
  readonly categoryOptions: readonly CategoryOption[];
  readonly pending: boolean;
  readonly error: string | null;
  readonly onCode: (value: string) => void;
  readonly onName: (value: string) => void;
  readonly onCategory: (value: string) => void;
  readonly onClose: () => void;
  readonly onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="aset-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    >
      <div className="w-full max-w-lg rounded-2xl border border-border bg-surface p-6 shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="aset-modal-title" className="text-lg font-semibold text-text">
              {modal.kind === 'create' ? 'Tambah Aset' : 'Ubah Aset'}
            </h2>
            <p className="mt-1 text-sm text-muted">
              {modal.kind === 'create'
                ? 'Kode aset harus unik; status fasilitas dihitung otomatis dari tiket aktif.'
                : `Menyunting ${modal.row.assetCode} — ${modal.row.assetName}.`}
            </p>
          </div>
          <button
            type="button"
            aria-label="Tutup dialog"
            onClick={onClose}
            className="rounded-md p-2 text-muted hover:bg-background"
          >
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={onSubmit} className="mt-4 grid gap-3">
          <div>
            <label htmlFor="aset-code" className="mb-1 block text-sm font-medium text-text">
              Kode aset
            </label>
            <Input
              id="aset-code"
              value={code}
              maxLength={64}
              placeholder="cth: AST-ELK-014"
              onChange={(event) => onCode(event.target.value)}
              disabled={modalPending}
              invalid={error !== null && code.trim() === ''}
              aria-describedby={error !== null ? 'aset-modal-err' : undefined}
            />
          </div>
          <div>
            <label htmlFor="aset-name" className="mb-1 block text-sm font-medium text-text">
              Nama aset
            </label>
            <Input
              id="aset-name"
              value={name}
              maxLength={256}
              placeholder="cth: Proyektor Epson EB-X400"
              onChange={(event) => onName(event.target.value)}
              disabled={modalPending}
              invalid={error !== null && name.trim() === ''}
              aria-describedby={error !== null ? 'aset-modal-err' : undefined}
            />
          </div>
          <div>
            <label htmlFor="aset-category" className="mb-1 block text-sm font-medium text-text">
              Kategori
            </label>
            <Select
              id="aset-category"
              value={categoryId}
              onChange={(event) => onCategory(event.target.value)}
              disabled={modalPending}
            >
              <option value="">Tanpa kategori</option>
              {categoryOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </Select>
          </div>
          {modal.kind === 'edit' ? (
            <p className="text-xs text-muted">Lokasi saat ini: {locationLabel || '—'}</p>
          ) : (
            <p className="text-xs text-muted">
              Lokasi &amp; tahun pengadaan diisi otomatis — relokasi lewat Data Master Lokasi.
            </p>
          )}
          {error !== null ? <FieldError id="aset-modal-err" message={error} /> : null}
          <div className="mt-1 flex flex-wrap justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className={`${buttonBaseClasses} ${buttonVariantClasses.secondary}`}
            >
              Batal
            </button>
            <Button type="submit" disabled={modalPending}>
              {modalPending
                ? 'Menyimpan…'
                : modal.kind === 'create'
                  ? 'Tambah aset'
                  : 'Simpan perubahan'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
