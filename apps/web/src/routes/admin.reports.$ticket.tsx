// Admin report detail (Phase 3 P3-6): one report by UUID or MNT- ticket.
// Read-only (workflow actions land in Phase 5): full report fields,
// submitted + final-or-empty classification, location/asset, description,
// occurredAt, lifecycle timestamps, version, duplicate candidates (with
// links), relations, attachment metadata (no download until Phase 4), the
// FULL timeline (every event, chronological), and a static AI placeholder
// ("Tinjauan AI: menunggu" — Phase 8 fills it, no polling).
// Loading, error-with-retry, 404, and 403-forbidden states; 401 redirects
// to /login. Indonesian copy, no styling framework.
import { useEffect, useState } from 'react';
import {
  Link,
  createFileRoute,
  redirect,
  useNavigate,
  useRouter,
} from '@tanstack/react-router';
import { eventLabel } from '../lib/report-helpers.js';
import { priorityLabel, statusLabel } from '../lib/admin-reports.js';
import type { FormOptions } from '../server/reports.js';

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
    <section aria-labelledby="admin-report-detail-title">
      <h1 id="admin-report-detail-title">Detail Laporan</h1>
      <p role="status">Memuat laporan…</p>
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
    <section aria-labelledby="admin-report-detail-title">
      <h1 id="admin-report-detail-title">Detail Laporan</h1>
      <p>
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
        >
          Semua laporan
        </Link>
      </p>

      {clientPending ? <p role="status">Memuat laporan…</p> : null}

      {!clientPending && notFound ? <p role="alert">Laporan tidak ditemukan</p> : null}

      {!clientPending && !notFound && forbidden ? (
        <>
          <h2>Akses ditolak</h2>
          <p>Halaman ini hanya untuk admin.</p>
        </>
      ) : null}

      {!clientPending && !notFound && !forbidden && loadError !== null ? (
        <>
          <p role="alert">{loadError}</p>
          <button type="button" onClick={() => void router.invalidate()}>
            Coba lagi
          </button>
        </>
      ) : null}

      {!clientPending && !notFound && !forbidden && loadError === null && detail !== null ? (
        <>
          <dl>
            <dt>Nomor tiket</dt>
            <dd>{detail.report.ticketNumber}</dd>
            <dt>Status</dt>
            <dd>{statusLabel(detail.report.status)}</dd>
            <dt>Prioritas</dt>
            <dd>{priorityLabel(detail.report.finalPriority)}</dd>
            <dt>ID Pelapor</dt>
            <dd>{detail.report.reporterId}</dd>
            <dt>Kategori diajukan</dt>
            <dd>
              {categoryNames.get(detail.report.submittedCategoryId) ??
                detail.report.submittedCategoryId}
            </dd>
            <dt>Kategori final</dt>
            <dd>
              {detail.report.finalCategoryId === null
                ? '—'
                : (categoryNames.get(detail.report.finalCategoryId) ??
                  detail.report.finalCategoryId)}
            </dd>
            <dt>Jenis masalah diajukan</dt>
            <dd>
              {detail.report.submittedIssueTypeId === null
                ? '—'
                : (issueTypeNames.get(detail.report.submittedIssueTypeId) ??
                  detail.report.submittedIssueTypeId)}
            </dd>
            <dt>Jenis masalah final</dt>
            <dd>
              {detail.report.finalIssueTypeId === null
                ? '—'
                : (issueTypeNames.get(detail.report.finalIssueTypeId) ??
                  detail.report.finalIssueTypeId)}
            </dd>
            <dt>Lokasi</dt>
            <dd>{locationNames.get(detail.report.locationId) ?? detail.report.locationId}</dd>
            <dt>Asset</dt>
            <dd>
              {detail.report.assetId === null
                ? 'Tanpa asset'
                : (assetNames.get(detail.report.assetId) ?? detail.report.assetId)}
            </dd>
            <dt>Deskripsi</dt>
            <dd>{detail.report.description}</dd>
            <dt>Waktu kejadian</dt>
            <dd>{formatDateTime(detail.report.occurredAt)}</dd>
            <dt>Waktu lapor</dt>
            <dd>{formatDateTime(detail.report.reportedAt)}</dd>
            <dt>Waktu verifikasi</dt>
            <dd>{formatDateTime(detail.report.verifiedAt)}</dd>
            <dt>Waktu selesai</dt>
            <dd>{formatDateTime(detail.report.resolvedAt)}</dd>
            <dt>Waktu tutup</dt>
            <dd>{formatDateTime(detail.report.closedAt)}</dd>
            <dt>Versi</dt>
            <dd>{detail.report.version}</dd>
          </dl>

          <section aria-labelledby="admin-detail-ai-title">
            <h2 id="admin-detail-ai-title">Tinjauan AI</h2>
            <p>Tinjauan AI: menunggu</p>
          </section>

          {detail.duplicateCandidates.length > 0 ? (
            <section aria-labelledby="admin-detail-duplicate-title">
              <h2 id="admin-detail-duplicate-title">Laporan serupa ditemukan</h2>
              <p>Laporan berikut tampak mirip dengan laporan ini.</p>
              <ul>
                {detail.duplicateCandidates.map((candidate) => (
                  <li key={candidate.id}>
                    <Link
                      to="/admin/reports/$ticket"
                      params={{ ticket: candidate.ticketNumber }}
                    >
                      {candidate.ticketNumber}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {detail.relations.length > 0 ? (
            <section aria-labelledby="admin-detail-relations-title">
              <h2 id="admin-detail-relations-title">Relasi laporan</h2>
              <ul>
                {detail.relations.map((relation) => {
                  const otherId =
                    relation.sourceReportId === detail.report.id
                      ? relation.targetReportId
                      : relation.sourceReportId;
                  return (
                    <li key={relation.id}>
                      {relation.relationType}{' '}
                      <Link to="/admin/reports/$ticket" params={{ ticket: otherId }}>
                        {otherId}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          <section aria-labelledby="admin-detail-attachments-title">
            <h2 id="admin-detail-attachments-title">Lampiran</h2>
            {detail.attachments.length === 0 ? (
              <p>Tidak ada lampiran.</p>
            ) : (
              <>
                <ul>
                  {detail.attachments.map((attachment) => (
                    <li key={attachment.id}>
                      {attachment.originalFilename} ({attachment.mimeType},{' '}
                      {attachment.sizeBytes} byte)
                    </li>
                  ))}
                </ul>
                <p>Pratinjau tersedia di Fase 4.</p>
              </>
            )}
          </section>

          <section aria-labelledby="admin-detail-timeline-title">
            <h2 id="admin-detail-timeline-title">Riwayat laporan</h2>
            {detail.events.length === 0 ? (
              <p>Belum ada riwayat.</p>
            ) : (
              <ol>
                {detail.events.map((entry, index) => (
                  <li key={`${entry.createdAt}-${index}`}>
                    {eventLabel(entryType(entry))} — {formatDateTime(entry.createdAt)}
                  </li>
                ))}
              </ol>
            )}
          </section>
        </>
      ) : null}
    </section>
  );
}
