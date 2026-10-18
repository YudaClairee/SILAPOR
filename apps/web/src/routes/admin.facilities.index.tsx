// Admin facility status list (Phase 6 P6-5c): ticket-independent projection
// of facility assets derived from active reports. Fetches
// /api/facilities/status (plus /api/reports/form-options for the location
// filter) through the same SSR-fallback loader pattern as the admin reports
// list. The server keeps sanitizing — this page renders labels, counts, and
// timestamps only, never report content.
import { useEffect, useState } from 'react';
import { Link, createFileRoute, redirect, useNavigate, useRouter } from '@tanstack/react-router';
import { pageRange } from '../lib/admin-reports.js';
import type { FormOptions } from '../server/reports.js';
import {
  Button,
  EmptyState,
  ErrorPanel,
  LoadingState,
  Select,
  TicketMono,
  buttonBaseClasses,
  buttonVariantClasses,
} from '../components/index.js';

interface FacilityStatusRow {
  readonly assetId: string;
  readonly assetCode: string;
  readonly assetName: string;
  readonly locationLabel: string;
  readonly categoryName: string | null;
  readonly derivedStatus: string;
  readonly isActive: boolean;
  readonly activeReportCount: number;
  readonly lastUpdated: string;
}

interface FacilityStatusData {
  readonly items: FacilityStatusRow[];
  readonly total: number;
  readonly limit: number;
  readonly offset: number;
}

interface FacilityListSearch {
  readonly locationId: string;
  readonly status: string;
  readonly includeInactive: string;
  readonly offset: number;
}

interface FacilityListLoaderData {
  readonly facilities: FacilityStatusData | null;
  readonly options: FormOptions | null;
  readonly loadError: string | null;
  readonly forbidden: boolean;
  readonly needsClientLoad: boolean;
}

interface FacilityListBundle {
  readonly facilities: FacilityStatusData | null;
  readonly options: FormOptions | null;
  readonly loadError: string | null;
  readonly forbidden: boolean;
}

const DEFAULT_SEARCH: FacilityListSearch = {
  locationId: '',
  status: '',
  includeInactive: '',
  offset: 0,
};

const FACILITY_STATUS_LIMIT = 50;

const FACILITY_TONES: Record<string, string> = {
  OPERATIONAL: 'bg-tint-success text-badge-success',
  UNDER_INSPECTION: 'bg-tint-info text-badge-info',
  IN_REPAIR: 'bg-tint-danger text-badge-danger',
};

const FACILITY_STATUS_LABELS: Record<string, string> = {
  OPERATIONAL: 'Operasional',
  UNDER_INSPECTION: 'Inspeksi',
  IN_REPAIR: 'Dalam perbaikan',
};

const badgeBaseClasses = 'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium';
const MUTED_TONE = 'bg-tint-muted text-badge-muted';

// Derived facility statuses are NOT report statuses (StatusBadge copy would
// mismap) — small local badge with the same tone convention; unknown values
// render defensively muted with the raw label.
function FacilityStatusBadge({ status }: { readonly status: string }) {
  const tone = FACILITY_TONES[status] ?? MUTED_TONE;
  return (
    <span className={`inline-flex items-center gap-1 ${badgeBaseClasses} ${tone}`}>
      {FACILITY_STATUS_LABELS[status] ?? status}
    </span>
  );
}

function stringParam(search: Record<string, unknown>, key: string, fallback: string): string {
  const value = search[key];
  return typeof value === 'string' ? value : fallback;
}

async function fetchFacilityListBundle(
  search: FacilityListSearch,
): Promise<FacilityListBundle | 'unauthorized' | 'unavailable'> {
  const params = new URLSearchParams();
  if (search.locationId !== '') {
    params.set('location_id', search.locationId);
  }
  if (search.status !== '') {
    params.set('status', search.status);
  }
  if (search.includeInactive === 'true') {
    params.set('include_inactive', 'true');
  }
  params.set('limit', String(FACILITY_STATUS_LIMIT));
  params.set('offset', String(search.offset));
  let statusResponse: Response;
  let optionsResponse: Response;
  try {
    [statusResponse, optionsResponse] = await Promise.all([
      fetch(`/api/facilities/status?${params.toString()}`, { credentials: 'include' }),
      fetch('/api/reports/form-options', { credentials: 'include' }),
    ]);
  } catch {
    return 'unavailable';
  }
  if (statusResponse.status === 401 || optionsResponse.status === 401) {
    return 'unauthorized';
  }
  const options = optionsResponse.ok ? ((await optionsResponse.json()) as FormOptions) : null;
  if (statusResponse.status === 403) {
    return { facilities: null, options, loadError: null, forbidden: true };
  }
  if (!statusResponse.ok) {
    return {
      facilities: null,
      options,
      loadError: `Gagal memuat status fasilitas (${statusResponse.status}).`,
      forbidden: false,
    };
  }
  return {
    facilities: (await statusResponse.json()) as FacilityStatusData,
    options,
    loadError: null,
    forbidden: false,
  };
}

export const Route = createFileRoute('/admin/facilities/')({
  validateSearch: (search: Record<string, unknown>): FacilityListSearch => ({
    locationId: stringParam(search, 'locationId', ''),
    status: stringParam(search, 'status', ''),
    includeInactive: stringParam(search, 'includeInactive', ''),
    offset:
      typeof search['offset'] === 'number' || typeof search['offset'] === 'string'
        ? Number(search['offset']) || 0
        : 0,
  }),
  loaderDeps: ({ search }) => ({ ...search }),
  loader: async ({ deps }): Promise<FacilityListLoaderData> => {
    const bundle = await fetchFacilityListBundle(deps as FacilityListSearch);
    if (bundle === 'unauthorized') {
      throw redirect({ to: '/login' });
    }
    if (bundle === 'unavailable') {
      // SSR relative-URL fetch (or offline): the component loads client-side.
      return {
        facilities: null,
        options: null,
        loadError: null,
        forbidden: false,
        needsClientLoad: true,
      };
    }
    return { ...bundle, needsClientLoad: false };
  },
  pendingComponent: AdminFacilitiesPending,
  component: AdminFacilitiesPage,
});

function AdminFacilitiesPending() {
  return (
    <section aria-labelledby="admin-facilities-title" className="w-full">
      <h1 id="admin-facilities-title" className="text-2xl font-semibold text-text">
        Status Fasilitas
      </h1>
      <div className="mt-4">
        <LoadingState message="Memuat status fasilitas…" />
      </div>
    </section>
  );
}

function formatUpdatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
}

const FILTER_LABEL_CLASSES = 'block text-sm font-medium text-text';
const FILTER_HINT_CLASSES = 'mt-1 text-xs text-muted';

function AdminFacilitiesPage() {
  const loaderData = Route.useLoaderData() as FacilityListLoaderData;
  const search = Route.useSearch() as FacilityListSearch;
  const navigate = useNavigate();
  const router = useRouter();

  const [clientBundle, setClientBundle] = useState<FacilityListBundle | null>(null);
  const [clientPending, setClientPending] = useState(loaderData.needsClientLoad);
  const [clientError, setClientError] = useState<string | null>(null);

  // Filter form state (applied on "Terapkan", always resetting offset to 0).
  const [fields, setFields] = useState<FacilityListSearch>({ ...search });

  // SSR fallback: load the same bundle client-side once after hydration.
  // A fresh loader payload (search change) discards client state.
  useEffect(() => {
    setClientBundle(null);
    setClientError(null);
    if (!loaderData.needsClientLoad) {
      setClientPending(false);
      return;
    }
    let cancelled = false;
    setClientPending(true);
    async function load(): Promise<void> {
      const bundle = await fetchFacilityListBundle(search);
      if (cancelled) {
        return;
      }
      if (bundle === 'unauthorized') {
        await navigate({ to: '/login' });
        return;
      }
      if (bundle === 'unavailable') {
        setClientError('Gagal memuat status fasilitas. Periksa koneksi Anda lalu coba lagi.');
        setClientPending(false);
        return;
      }
      setClientBundle(bundle);
      setClientPending(false);
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [loaderData]);

  // Keep the form in sync with the URL after apply/reset/pagination.
  useEffect(() => {
    setFields((previous) => (shallowEqualSearch(previous, search) ? previous : { ...search }));
  }, [search]);

  const facilities = clientBundle?.facilities ?? loaderData.facilities;
  const options = clientBundle?.options ?? loaderData.options;
  const loadError = clientError ?? clientBundle?.loadError ?? loaderData.loadError;
  const forbidden = (clientBundle?.forbidden ?? loaderData.forbidden) && !clientPending;

  const range = pageRange(
    facilities?.total ?? 0,
    facilities?.limit ?? FACILITY_STATUS_LIMIT,
    facilities?.offset ?? 0,
  );
  const limit = facilities?.limit ?? FACILITY_STATUS_LIMIT;
  const offset = facilities?.offset ?? search.offset;
  const total = facilities?.total ?? 0;

  function setField<K extends keyof FacilityListSearch>(
    key: K,
    value: FacilityListSearch[K],
  ): void {
    setFields((previous) => ({ ...previous, [key]: value }));
  }

  function toSearch(state: FacilityListSearch) {
    return {
      locationId: state.locationId,
      status: state.status,
      includeInactive: state.includeInactive,
      offset: state.offset,
    };
  }

  return (
    <section aria-labelledby="admin-facilities-title" className="w-full">
      <h1 id="admin-facilities-title" className="text-2xl font-semibold text-text">
        Status Fasilitas
      </h1>

      <form
        aria-label="Filter fasilitas"
        onSubmit={(event) => {
          event.preventDefault();
          void navigate({ to: '/admin/facilities', search: toSearch({ ...fields, offset: 0 }) });
        }}
        className="mt-4 rounded-md border border-border bg-surface p-4"
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <label htmlFor="admin-facilities-location" className={FILTER_LABEL_CLASSES}>
              Lokasi
            </label>
            <Select
              id="admin-facilities-location"
              value={fields.locationId}
              onChange={(event) => setField('locationId', event.target.value)}
            >
              <option value="">Semua lokasi</option>
              {(options?.locations ?? []).map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <label htmlFor="admin-facilities-status" className={FILTER_LABEL_CLASSES}>
              Status fasilitas
            </label>
            <Select
              id="admin-facilities-status"
              value={fields.status}
              onChange={(event) => setField('status', event.target.value)}
            >
              <option value="">Semua status</option>
              <option value="OPERATIONAL">Operasional</option>
              <option value="UNDER_INSPECTION">Inspeksi</option>
              <option value="IN_REPAIR">Dalam perbaikan</option>
            </Select>
          </div>
          <div>
            <span id="admin-facilities-inactive-label" className={FILTER_LABEL_CLASSES}>
              Aset
            </span>
            <label className="mt-1 flex items-center gap-2 text-sm text-text">
              <input
                type="checkbox"
                aria-labelledby="admin-facilities-inactive-label"
                checked={fields.includeInactive === 'true'}
                onChange={(event) =>
                  setField('includeInactive', event.target.checked ? 'true' : '')
                }
              />
              Termasuk aset nonaktif
            </label>
            <p className={FILTER_HINT_CLASSES}>
              Status turun dari laporan aktif, bukan isian manual.
            </p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button type="submit">Terapkan</Button>
          <Link
            to="/admin/facilities"
            search={{ ...DEFAULT_SEARCH }}
            className={`${buttonBaseClasses} ${buttonVariantClasses.secondary}`}
          >
            Atur ulang
          </Link>
        </div>
      </form>

      {clientPending ? (
        <div className="mt-4">
          <LoadingState message="Memuat status fasilitas…" />
        </div>
      ) : null}

      {!clientPending && forbidden ? (
        <div className="mt-4 rounded-md border border-border bg-surface px-4 py-3">
          <h2 className="text-base font-semibold text-text">Akses ditolak</h2>
          <p className="mt-1 text-sm text-muted">Halaman ini hanya untuk admin.</p>
        </div>
      ) : null}

      {!clientPending && !forbidden && loadError !== null ? (
        <div className="mt-4">
          <ErrorPanel
            message={loadError}
            retry={
              <Button type="button" variant="secondary" onClick={() => void router.invalidate()}>
                Coba lagi
              </Button>
            }
          />
        </div>
      ) : null}

      {!clientPending && !forbidden && loadError === null && facilities !== null ? (
        facilities.items.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              title="Tidak ada fasilitas yang cocok."
              description="Ubah filter lalu coba lagi."
            />
          </div>
        ) : (
          <>
            <div className="mt-4 overflow-x-auto rounded-md border border-border bg-surface">
              <table className="w-full min-w-200 border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th scope="col" className="px-3 py-2 text-xs font-medium text-muted">
                      Aset
                    </th>
                    <th scope="col" className="px-3 py-2 text-xs font-medium text-muted">
                      Lokasi
                    </th>
                    <th scope="col" className="px-3 py-2 text-xs font-medium text-muted">
                      Kategori
                    </th>
                    <th scope="col" className="px-3 py-2 text-xs font-medium text-muted">
                      Status
                    </th>
                    <th scope="col" className="px-3 py-2 text-xs font-medium text-muted">
                      Laporan aktif
                    </th>
                    <th scope="col" className="px-3 py-2 text-xs font-medium text-muted">
                      Diperbarui
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {facilities.items.map((item) => (
                    <tr key={item.assetId}>
                      <td className="px-3 py-2">
                        <Link
                          to="/admin/facilities/$assetId"
                          params={{ assetId: item.assetId }}
                          className="text-accent underline underline-offset-2"
                        >
                          {item.assetName}
                        </Link>
                        <span className="mt-0.5 block">
                          <TicketMono className="text-xs text-subtle">{item.assetCode}</TicketMono>
                        </span>
                      </td>
                      <td className="px-3 py-2 text-muted">{item.locationLabel || '—'}</td>
                      <td className="px-3 py-2 text-muted">{item.categoryName ?? '—'}</td>
                      <td className="px-3 py-2">
                        <FacilityStatusBadge status={item.derivedStatus} />
                        {!item.isActive ? (
                          <span className={`ml-2 ${badgeBaseClasses} ${MUTED_TONE}`}>Nonaktif</span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-muted">{item.activeReportCount}</td>
                      <td className="px-3 py-2">
                        <TicketMono className="text-xs text-subtle">
                          <time>{formatUpdatedAt(item.lastUpdated)}</time>
                        </TicketMono>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-sm text-muted">
              Menampilkan {range.from}–{range.to} dari {total}
            </p>
            <p className="mt-2 flex gap-2">
              {range.hasPrev ? (
                <Link
                  to="/admin/facilities"
                  search={toSearch({ ...search, offset: offset - limit })}
                  className={`${buttonBaseClasses} ${buttonVariantClasses.secondary}`}
                >
                  Sebelumnya
                </Link>
              ) : (
                <span
                  aria-disabled="true"
                  className={`${buttonBaseClasses} cursor-not-allowed text-subtle opacity-50`}
                >
                  Sebelumnya
                </span>
              )}
              {range.hasNext ? (
                <Link
                  to="/admin/facilities"
                  search={toSearch({ ...search, offset: offset + limit })}
                  className={`${buttonBaseClasses} ${buttonVariantClasses.secondary}`}
                >
                  Berikutnya
                </Link>
              ) : (
                <span
                  aria-disabled="true"
                  className={`${buttonBaseClasses} cursor-not-allowed text-subtle opacity-50`}
                >
                  Berikutnya
                </span>
              )}
            </p>
          </>
        )
      ) : null}
    </section>
  );
}

function shallowEqualSearch(a: FacilityListSearch, b: FacilityListSearch): boolean {
  return (
    a.locationId === b.locationId &&
    a.status === b.status &&
    a.includeInactive === b.includeInactive &&
    a.offset === b.offset
  );
}
