// Admin report detail (Phase 3 P3-6): one report by UUID or MNT- ticket.
// Read-only (workflow actions land in Phase 5): full report fields,
// submitted + final-or-empty classification, location/asset, description,
// occurredAt, lifecycle timestamps, version, duplicate candidates (with
// links), relations, attachment metadata (no download until Phase 4), the
// FULL timeline (every event, chronological), and a static AI placeholder
// ("Tinjauan AI: menunggu" — Phase 8 fills it, no polling).
// Loading, error-with-retry, 404, and 403-forbidden states; 401 redirects
// to /login. Indonesian copy. Styled per DESIGN.md (Task D-3): ruled
// sections, D-1 StatusBadge/Timeline/TicketMono/ErrorPanel/LoadingState.
import { useEffect, useState } from 'react';
import {
  Link,
  createFileRoute,
  redirect,
  useNavigate,
  useRouter,
} from '@tanstack/react-router';
import { eventLabel } from '../lib/report-helpers.js';
import type { FormOptions } from '../server/reports.js';
import {
  Button,
  ErrorPanel,
  LoadingState,
  StatusBadge,
  TicketMono,
  Timeline,
  buttonBaseClasses,
  buttonVariantClasses,
} from '../components/index.js';

interface AdminReportRow {
  readonly id: string;
  readonly ticketNumber: string;
  readonly status: string;
  readonly reporterId: string;
  readonly locationId: string;
  readonly assetId: string | null;
  readonly submittedCategoryId: string;
  readonly submittedIssueTypeId: string | null;
  readonly finalCategoryId: string | null;
  readonly finalIssueTypeId: string | null;
  readonly finalPriority: string | null;
  readonly description: string;
  readonly occurredAt: string | null;
  readonly version: number;
  readonly reportedAt: string;
  readonly verifiedAt: string | null;
  readonly resolvedAt: string | null;
  readonly closedAt: string | null;
}

interface AdminAttachmentRow {
  readonly id: string;
  readonly originalFilename: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
}

interface AdminEventRow {
  readonly eventType?: unknown;
  readonly type?: unknown;
  readonly createdAt: string;
}

interface AdminRelationRow {
  readonly id: string;
  readonly sourceReportId: string;
  readonly targetReportId: string;
  readonly relationType: string;
}

interface AdminDuplicateRow {
  readonly id: string;
  readonly ticketNumber: string;
}

interface AdminDetailData {
  readonly report: AdminReportRow;
  readonly attachments: AdminAttachmentRow[];
  readonly events: AdminEventRow[];
  readonly relations: AdminRelationRow[];
  readonly duplicateCandidates: AdminDuplicateRow[];
}

interface AdminDetailLoaderData {
  readonly detail: AdminDetailData | null;
  readonly options: FormOptions | null;
  readonly notFound: boolean;
  readonly forbidden: boolean;
  readonly loadError: string | null;
  readonly needsClientLoad: boolean;
}

type AdminDetailBundle =
  | {
      readonly detail: AdminDetailData | null;
      readonly options: FormOptions | null;
      readonly notFound: boolean;
      readonly forbidden: boolean;
      readonly loadError: string | null;
    }
  | 'unauthorized'
  | 'unavailable';

async function fetchAdminDetailBundle(ticket: string): Promise<AdminDetailBundle> {
  const ref = encodeURIComponent(ticket);
  let detailResponse: Response;
  let optionsResponse: Response;
  try {
    [detailResponse, optionsResponse] = await Promise.all([
      fetch(`/api/admin/reports/${ref}`, { credentials: 'include' }),
      fetch('/api/reports/form-options', { credentials: 'include' }),
    ]);
  } catch {
    return 'unavailable';
  }
  if (detailResponse.status === 401 || optionsResponse.status === 401) {
    return 'unauthorized';
  }
  const options = optionsResponse.ok
    ? ((await optionsResponse.json()) as FormOptions)
    : null;
  if (detailResponse.status === 403) {
    return { detail: null, options, notFound: false, forbidden: true, loadError: null };
  }
  if (detailResponse.status === 404) {
    return { detail: null, options, notFound: true, forbidden: false, loadError: null };
  }
  if (!detailResponse.ok) {
    return {
      detail: null,
      options,
      notFound: false,
      forbidden: false,
      loadError: `Gagal memuat laporan (${detailResponse.status}).`,
    };
  }
  return {
    detail: (await detailResponse.json()) as AdminDetailData,
    options,
    notFound: false,
    forbidden: false,
    loadError: null,
  };
}

export const Route = createFileRoute('/admin/reports/$ticket')({
  loader: async ({ params }: { params: { ticket: string } }): Promise<AdminDetailLoaderData> => {
    const bundle = await fetchAdminDetailBundle(params.ticket);
    if (bundle === 'unauthorized') {
      throw redirect({ to: '/login' });
    }
    if (bundle === 'unavailable') {
      // SSR relative-URL fetch (or offline): the component loads client-side.
      return {
        detail: null,
        options: null,
        notFound: false,
        forbidden: false,
        loadError: null,
        needsClientLoad: true,
      };
    }
    return { ...bundle, needsClientLoad: false };
  },
  pendingComponent: AdminDetailPending,
  component: AdminReportDetailPage,
});

function AdminDetailPending() {
  return (
    <section aria-labelledby="admin-report-detail-title" className="max-w-3xl">
      <h1 id="admin-report-detail-title" className="text-2xl font-semibold text-text">
        Detail Laporan
      </h1>
      <div className="mt-4">
        <LoadingState message="Memuat laporan…" />
      </div>
    </section>
  );
}

function formatDateTime(value: string | null): string {
  if (value === null || value === '') {
    return '—';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
}

// Timeline rows may use `eventType` (detail shape) or `type` (timeline
// endpoint shape) — only the type label and the timestamp reach the DOM.
function entryType(entry: AdminEventRow): string {
  if (typeof entry.eventType === 'string') {
    return entry.eventType;
  }
  if (typeof entry.type === 'string') {
    return entry.type;
  }
  return 'UNKNOWN';
}

function AdminReportDetailPage() {
  const loaderData = Route.useLoaderData() as AdminDetailLoaderData;
  const { ticket } = Route.useParams() as { ticket: string };
  const navigate = useNavigate();
  const router = useRouter();

  const [clientBundle, setClientBundle] = useState<AdminDetailBundle | null>(null);
  const [clientPending, setClientPending] = useState(loaderData.needsClientLoad);
  const [clientError, setClientError] = useState<string | null>(null);

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
      const bundle = await fetchAdminDetailBundle(ticket);
      if (cancelled) {
        return;
      }
      if (bundle === 'unauthorized') {
        await navigate({ to: '/login' });
        return;
      }
      if (bundle === 'unavailable') {
        setClientError('Gagal memuat laporan. Periksa koneksi Anda lalu coba lagi.');
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

  const bundleData =
    clientBundle !== null && clientBundle !== 'unauthorized' && clientBundle !== 'unavailable'
      ? clientBundle
      : null;
  const detail = bundleData?.detail ?? loaderData.detail;
  const options = bundleData?.options ?? loaderData.options;
  const notFound = bundleData?.notFound ?? loaderData.notFound;
  const forbidden = (bundleData?.forbidden ?? loaderData.forbidden) && !clientPending;
  const loadError = clientError ?? bundleData?.loadError ?? loaderData.loadError;

  const locationNames = new Map((options?.locations ?? []).map((l) => [l.id, l.name] as const));
  const categoryNames = new Map((options?.categories ?? []).map((c) => [c.id, c.name] as const));
  const issueTypeNames = new Map((options?.issueTypes ?? []).map((i) => [i.id, i.name] as const));
  const assetNames = new Map((options?.assets ?? []).map((a) => [a.id, a.name] as const));

  return (
    <section aria-labelledby="admin-report-detail-title" className="max-w-3xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 id="admin-report-detail-title" className="text-2xl font-semibold text-text">
          Detail Laporan
        </h1>
        <Link
          to="/admin/reports"
          search={{
            search: '',
            status: '',
            categoryId: '',
            locationId: '',
            priority: '',
            reporterId: '',
            from: '',
            to: '',
            sort: 'reported_desc',
            offset: 0,
          }}
          className={`${buttonBaseClasses} ${buttonVariantClasses.secondary}`}
        >
          Semua laporan
        </Link>
      </div>

      {clientPending ? (
        <div className="mt-4">
          <LoadingState message="Memuat laporan…" />
        </div>
      ) : null}

      {!clientPending && notFound ? (
        <p role="alert" className="mt-4 rounded-md border border-border bg-surface px-4 py-3 text-sm text-text">
          Laporan tidak ditemukan
        </p>
      ) : null}

      {!clientPending && !notFound && forbidden ? (
        <div className="mt-4 rounded-md border border-border bg-surface px-4 py-3">
          <h2 className="text-base font-semibold text-text">Akses ditolak</h2>
          <p className="mt-1 text-sm text-muted">Halaman ini hanya untuk admin.</p>
        </div>
      ) : null}

      {!clientPending && !notFound && !forbidden && loadError !== null ? (
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

      {!clientPending && !notFound && !forbidden && loadError === null && detail !== null ? (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <TicketMono className="text-xl font-medium text-text">
              {detail.report.ticketNumber}
            </TicketMono>
            <StatusBadge status={detail.report.status} />
            <StatusBadge priority={detail.report.finalPriority} />
          </div>

          <div className="mt-4 rounded-md border border-border bg-surface px-4 md:px-6">
            <dl className="divide-y divide-border">
              <div className="flex flex-col gap-1 py-3 sm:flex-row sm:gap-4">
                <dt className="shrink-0 text-sm font-medium text-muted sm:w-40">Nomor tiket</dt>
                <dd className="text-sm text-text">
                  <TicketMono>{detail.report.ticketNumber}</TicketMono>
                </dd>
              </div>
              <div className="flex flex-col gap-1 py-3 sm:flex-row sm:gap-4">
                <dt className="shrink-0 text-sm font-medium text-muted sm:w-40">Status</dt>
                <dd className="text-sm text-text">
                  <StatusBadge status={detail.report.status} />
                </dd>
              </div>
              <div className="flex flex-col gap-1 py-3 sm:flex-row sm:gap-4">
                <dt className="shrink-0 text-sm font-medium text-muted sm:w-40">Prioritas</dt>
                <dd className="text-sm text-text">
                  <StatusBadge priority={detail.report.finalPriority} />
                </dd>
              </div>
              <div className="flex flex-col gap-1 py-3 sm:flex-row sm:gap-4">
                <dt className="shrink-0 text-sm font-medium text-muted sm:w-40">ID Pelapor</dt>
                <dd className="text-sm text-text">{detail.report.reporterId}</dd>
              </div>
              <div className="flex flex-col gap-1 py-3 sm:flex-row sm:gap-4">
                <dt className="shrink-0 text-sm font-medium text-muted sm:w-40">
                  Kategori diajukan
                </dt>
                <dd className="text-sm text-text">
                  {categoryNames.get(detail.report.submittedCategoryId) ??
                    detail.report.submittedCategoryId}
                </dd>
              </div>
              <div className="flex flex-col gap-1 py-3 sm:flex-row sm:gap-4">
                <dt className="shrink-0 text-sm font-medium text-muted sm:w-40">Kategori final</dt>
                <dd className="text-sm text-text">
                  {detail.report.finalCategoryId === null
                    ? '—'
                    : (categoryNames.get(detail.report.finalCategoryId) ??
                      detail.report.finalCategoryId)}
                </dd>
              </div>
              <div className="flex flex-col gap-1 py-3 sm:flex-row sm:gap-4">
                <dt className="shrink-0 text-sm font-medium text-muted sm:w-40">
                  Jenis masalah diajukan
                </dt>
                <dd className="text-sm text-text">
                  {detail.report.submittedIssueTypeId === null
                    ? '—'
                    : (issueTypeNames.get(detail.report.submittedIssueTypeId) ??
                      detail.report.submittedIssueTypeId)}
                </dd>
              </div>
              <div className="flex flex-col gap-1 py-3 sm:flex-row sm:gap-4">
                <dt className="shrink-0 text-sm font-medium text-muted sm:w-40">
                  Jenis masalah final
                </dt>
                <dd className="text-sm text-text">
                  {detail.report.finalIssueTypeId === null
                    ? '—'
                    : (issueTypeNames.get(detail.report.finalIssueTypeId) ??
                      detail.report.finalIssueTypeId)}
                </dd>
              </div>
              <div className="flex flex-col gap-1 py-3 sm:flex-row sm:gap-4">
                <dt className="shrink-0 text-sm font-medium text-muted sm:w-40">Lokasi</dt>
                <dd className="text-sm text-text">
                  {locationNames.get(detail.report.locationId) ?? detail.report.locationId}
                </dd>
              </div>
              <div className="flex flex-col gap-1 py-3 sm:flex-row sm:gap-4">
                <dt className="shrink-0 text-sm font-medium text-muted sm:w-40">Asset</dt>
                <dd className="text-sm text-text">
                  {detail.report.assetId === null
                    ? 'Tanpa asset'
                    : (assetNames.get(detail.report.assetId) ?? detail.report.assetId)}
                </dd>
              </div>
              <div className="flex flex-col gap-1 py-3 sm:flex-row sm:gap-4">
                <dt className="shrink-0 text-sm font-medium text-muted sm:w-40">Deskripsi</dt>
                <dd className="text-pretty text-sm break-words whitespace-pre-wrap text-text">
                  {detail.report.description}
                </dd>
              </div>
              <div className="flex flex-col gap-1 py-3 sm:flex-row sm:gap-4">
                <dt className="shrink-0 text-sm font-medium text-muted sm:w-40">
                  Waktu kejadian
                </dt>
                <dd className="text-sm text-text">
                  <TicketMono>{formatDateTime(detail.report.occurredAt)}</TicketMono>
                </dd>
              </div>
              <div className="flex flex-col gap-1 py-3 sm:flex-row sm:gap-4">
                <dt className="shrink-0 text-sm font-medium text-muted sm:w-40">Waktu lapor</dt>
                <dd className="text-sm text-text">
                  <TicketMono>{formatDateTime(detail.report.reportedAt)}</TicketMono>
                </dd>
              </div>
              <div className="flex flex-col gap-1 py-3 sm:flex-row sm:gap-4">
                <dt className="shrink-0 text-sm font-medium text-muted sm:w-40">
                  Waktu verifikasi
                </dt>
                <dd className="text-sm text-text">
                  <TicketMono>{formatDateTime(detail.report.verifiedAt)}</TicketMono>
                </dd>
              </div>
              <div className="flex flex-col gap-1 py-3 sm:flex-row sm:gap-4">
                <dt className="shrink-0 text-sm font-medium text-muted sm:w-40">Waktu selesai</dt>
                <dd className="text-sm text-text">
                  <TicketMono>{formatDateTime(detail.report.resolvedAt)}</TicketMono>
                </dd>
              </div>
              <div className="flex flex-col gap-1 py-3 sm:flex-row sm:gap-4">
                <dt className="shrink-0 text-sm font-medium text-muted sm:w-40">Waktu tutup</dt>
                <dd className="text-sm text-text">
                  <TicketMono>{formatDateTime(detail.report.closedAt)}</TicketMono>
                </dd>
              </div>
              <div className="flex flex-col gap-1 py-3 sm:flex-row sm:gap-4">
                <dt className="shrink-0 text-sm font-medium text-muted sm:w-40">Versi</dt>
                <dd className="text-sm text-text">{detail.report.version}</dd>
              </div>
            </dl>
          </div>

          <section
            aria-labelledby="admin-detail-ai-title"
            className="mt-4 rounded-md border border-info bg-tint-info p-4"
          >
            <h2 id="admin-detail-ai-title" className="text-base font-semibold text-text">
              Tinjauan AI
            </h2>
            <p className="mt-1 text-sm text-text">Tinjauan AI: menunggu</p>
          </section>

          {detail.duplicateCandidates.length > 0 ? (
            <section
              aria-labelledby="admin-detail-duplicate-title"
              className="mt-4 rounded-md border border-warning bg-tint-warning p-4"
            >
              <h2 id="admin-detail-duplicate-title" className="text-base font-semibold text-text">
                Laporan serupa ditemukan
              </h2>
              <p className="mt-1 text-sm text-text">
                Laporan berikut tampak mirip dengan laporan ini.
              </p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {detail.duplicateCandidates.map((candidate) => (
                  <li key={candidate.id}>
                    <Link
                      to="/admin/reports/$ticket"
                      params={{ ticket: candidate.ticketNumber }}
                      className="text-accent underline underline-offset-2"
                    >
                      <TicketMono>{candidate.ticketNumber}</TicketMono>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {detail.relations.length > 0 ? (
            <section
              aria-labelledby="admin-detail-relations-title"
              className="mt-4 rounded-md border border-border bg-surface p-4"
            >
              <h2 id="admin-detail-relations-title" className="text-base font-semibold text-text">
                Relasi laporan
              </h2>
              <ul className="mt-2 flex flex-col gap-2">
                {detail.relations.map((relation) => {
                  const otherId =
                    relation.sourceReportId === detail.report.id
                      ? relation.targetReportId
                      : relation.sourceReportId;
                  return (
                    <li key={relation.id} className="text-sm text-text">
                      {relation.relationType}{' '}
                      <Link
                        to="/admin/reports/$ticket"
                        params={{ ticket: otherId }}
                        className="text-accent underline underline-offset-2"
                      >
                        <TicketMono>{otherId}</TicketMono>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          <section
            aria-labelledby="admin-detail-attachments-title"
            className="mt-4 rounded-md border border-border bg-surface p-4"
          >
            <h2 id="admin-detail-attachments-title" className="text-base font-semibold text-text">
              Lampiran
            </h2>
            {detail.attachments.length === 0 ? (
              <p className="mt-1 text-sm text-muted">Tidak ada lampiran.</p>
            ) : (
              <>
                <ul className="mt-2 flex flex-col gap-1">
                  {detail.attachments.map((attachment) => (
                    <li key={attachment.id} className="text-sm text-text">
                      {attachment.originalFilename} ({attachment.mimeType},{' '}
                      {attachment.sizeBytes} byte)
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-sm text-muted">Pratinjau tersedia di Fase 4.</p>
              </>
            )}
          </section>

          <section aria-labelledby="admin-detail-timeline-title" className="mt-6">
            <h2 id="admin-detail-timeline-title" className="text-lg font-semibold text-text">
              Riwayat laporan
            </h2>
            {detail.events.length === 0 ? (
              <p className="mt-2 text-sm text-muted">Belum ada riwayat.</p>
            ) : (
              <div className="mt-3">
                <Timeline
                  items={detail.events.map((entry, index) => ({
                    id: `${entry.createdAt}-${index}`,
                    label: eventLabel(entryType(entry)),
                    timestamp: formatDateTime(entry.createdAt),
                  }))}
                />
              </div>
            )}
          </section>
        </>
      ) : null}
    </section>
  );
}
