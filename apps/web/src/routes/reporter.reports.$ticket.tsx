// Report detail (Phase 3 P3-5 + UI No. 5): a sanitized campus ticket by UUID
// or MNT- ticket. Shows ticket, status, classification labels, location/asset,
// description, occurredAt/reportedAt, owner-only attachments, a duplicate
// hint for the owner, and the reporter timeline with all progress notes
// (LAPORAN_PALSU already neutralized by the server).
//
// Another reporter's ticket is a normal 200 sanitized view; only a truly
// missing ticket renders "Laporan tidak ditemukan". Indonesian copy.
import { useEffect, useState } from 'react';
import { Link, createFileRoute, redirect, useNavigate, useRouter } from '@tanstack/react-router';
import { eventLabel } from '../lib/report-helpers.js';
import type { DuplicateCandidate } from '@silapor/database';
import type { FormOptions } from '../server/reports.js';
import {
  AttachmentGallery,
  Button,
  EmptyState,
  ErrorPanel,
  LoadingState,
  StatusBadge,
  TicketMono,
  Timeline,
  buttonBaseClasses,
  buttonVariantClasses,
} from '../components/index.js';

interface ReportRow {
  readonly ticketNumber: string;
  readonly status: string;
  readonly locationId: string;
  readonly assetId: string | null;
  readonly submittedCategoryId: string;
  readonly submittedIssueTypeId: string | null;
  readonly finalCategoryId?: string | null;
  readonly finalIssueTypeId?: string | null;
  readonly finalPriority?: string | null;
  readonly description: string;
  readonly occurredAt: string | null;
  readonly reportedAt: string;
}

interface TimelineRow {
  // Detail events (`eventType` + `createdAt` + `metadata`) and sanitized
  // timeline entries (`kind` + `label` + `at` + `detail`). The server
  // projection strips actor ids and neutralizes LAPORAN_PALSU.
  readonly eventType?: unknown;
  readonly type?: unknown;
  readonly kind?: unknown;
  readonly label?: unknown;
  readonly createdAt?: unknown;
  readonly at?: unknown;
  readonly metadata?: unknown;
  readonly detail?: unknown;
}

interface DetailAttachmentRow {
  readonly id: string;
  readonly originalFilename: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
}

interface ReportDetailData {
  readonly report: ReportRow;
  readonly isOwn?: boolean;
  readonly events: TimelineRow[];
  readonly duplicateCandidates: DuplicateCandidate[];
  // Gallery metadata (id + display fields only — bytes come from the
  // authorized GET url; the opaque storage key never leaves the server).
  // Optional: older cached payloads may omit it.
  readonly attachments?: readonly DetailAttachmentRow[];
}

interface DetailLoaderData {
  readonly detail: ReportDetailData | null;
  readonly options: FormOptions | null;
  readonly notFound: boolean;
  readonly loadError: string | null;
  readonly needsClientLoad: boolean;
}

type DetailBundle =
  | {
      readonly detail: ReportDetailData | null;
      readonly options: FormOptions | null;
      readonly notFound: boolean;
      readonly loadError: string | null;
    }
  | 'unauthorized'
  | 'unavailable';

async function fetchDetailBundle(ticket: string): Promise<DetailBundle> {
  const ref = encodeURIComponent(ticket);
  let detailResponse: Response;
  let optionsResponse: Response;
  try {
    [detailResponse, optionsResponse] = await Promise.all([
      fetch(`/api/reports/${ref}`, { credentials: 'include' }),
      fetch('/api/reports/form-options', { credentials: 'include' }),
    ]);
  } catch {
    return 'unavailable';
  }
  if (detailResponse.status === 401 || optionsResponse.status === 401) {
    return 'unauthorized';
  }
  const options = optionsResponse.ok ? ((await optionsResponse.json()) as FormOptions) : null;
  if (detailResponse.status === 404) {
    return { detail: null, options, notFound: true, loadError: null };
  }
  if (!detailResponse.ok) {
    return {
      detail: null,
      options,
      notFound: false,
      loadError: `Gagal memuat laporan (${detailResponse.status}).`,
    };
  }
  return {
    detail: (await detailResponse.json()) as ReportDetailData,
    options,
    notFound: false,
    loadError: null,
  };
}

export const Route = createFileRoute('/reporter/reports/$ticket')({
  loader: async ({ params }: { params: { ticket: string } }): Promise<DetailLoaderData> => {
    const bundle = await fetchDetailBundle(params.ticket);
    if (bundle === 'unauthorized') {
      throw redirect({ to: '/login' });
    }
    if (bundle === 'unavailable') {
      // SSR relative-URL fetch (or offline): the component loads client-side.
      return {
        detail: null,
        options: null,
        notFound: false,
        loadError: null,
        needsClientLoad: true,
      };
    }
    return { ...bundle, needsClientLoad: false };
  },
  pendingComponent: DetailPending,
  component: ReportDetailPage,
});

function DetailPending() {
  return (
    <section aria-labelledby="report-detail-title" className="max-w-3xl">
      <h1 id="report-detail-title" className="text-2xl font-semibold text-text">
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

// Event rows carry message/metadata blobs; the server sanitizes actor ids and
// neutralizes LAPORAN_PALSU before this component sees them. Only the event
// label, the note text, and the timestamp reach the DOM.
function entryType(entry: TimelineRow): string {
  if (typeof entry.eventType === 'string') {
    return entry.eventType;
  }
  if (typeof entry.type === 'string') {
    return entry.type;
  }
  return 'UNKNOWN';
}

function noteTextFrom(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const note = (value as Record<string, unknown>)['note'];
  return typeof note === 'string' && note !== '' ? note : null;
}

function timelineDescription(entry: TimelineRow): string | undefined {
  const note = noteTextFrom(entry.metadata);
  if (note !== null) {
    return note;
  }
  if (typeof entry.detail === 'object' && entry.detail !== null && !Array.isArray(entry.detail)) {
    const message = (entry.detail as Record<string, unknown>)['message'];
    return typeof message === 'string' && message !== '' ? message : undefined;
  }
  return undefined;
}

// Sanitized timeline entries (`kind`/`label`/`at`) render through the same
// label map; assignment entries show a static PII-free line (the technician
// id stays opaque — no name/phone lookup on reporter surfaces), and legacy
// rows fall back to `entryType`. Unknown shapes never crash.
function timelineItemLabel(entry: TimelineRow): string {
  if (typeof entry.kind === 'string') {
    if (entry.kind === 'update') {
      return 'Catatan progres';
    }
    if (entry.kind === 'assignment') {
      return 'Teknisi ditugaskan';
    }
    if (entry.kind === 'relation') {
      return 'Relasi laporan';
    }
    if (entry.kind === 'event' && typeof entry.label === 'string') {
      return eventLabel(entry.label);
    }
    return typeof entry.label === 'string' ? entry.label : entry.kind;
  }
  return eventLabel(entryType(entry));
}

function timelineTimestamp(entry: TimelineRow): string {
  if (typeof entry.createdAt === 'string') {
    return entry.createdAt;
  }
  if (typeof entry.at === 'string') {
    return entry.at;
  }
  return '';
}

function ReportDetailPage() {
  const loaderData = Route.useLoaderData() as DetailLoaderData;
  const { ticket } = Route.useParams() as { ticket: string };
  const navigate = useNavigate();
  const router = useRouter();

  const [clientBundle, setClientBundle] = useState<DetailBundle | null>(null);
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
      const bundle = await fetchDetailBundle(ticket);
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
  const loadError = clientError ?? bundleData?.loadError ?? loaderData.loadError;

  const locationNames = new Map((options?.locations ?? []).map((l) => [l.id, l.name] as const));
  const categoryNames = new Map((options?.categories ?? []).map((c) => [c.id, c.name] as const));
  const issueTypeNames = new Map((options?.issueTypes ?? []).map((i) => [i.id, i.name] as const));
  const assetNames = new Map((options?.assets ?? []).map((a) => [a.id, a.name] as const));

  return (
    <section aria-labelledby="report-detail-title" className="max-w-3xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 id="report-detail-title" className="text-2xl font-semibold text-text">
          Detail Laporan
        </h1>
        <Link
          to="/reporter/reports"
          search={{ filter: 'semua', status: '', mine: false, offset: 0 }}
          className={`${buttonBaseClasses} ${buttonVariantClasses.secondary}`}
        >
          Tiket Kampus
        </Link>
      </div>

      {clientPending ? (
        <div className="mt-4">
          <LoadingState message="Memuat laporan…" />
        </div>
      ) : null}

      {!clientPending && notFound ? (
        <div className="mt-4">
          <EmptyState
            title="Laporan tidak ditemukan"
            description="Periksa kembali nomor tiket pada URL."
          />
        </div>
      ) : null}

      {!clientPending && !notFound && loadError !== null ? (
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

      {!clientPending && !notFound && loadError === null && detail !== null ? (
        <>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <TicketMono className="text-xl font-medium text-text">
              {detail.report.ticketNumber}
            </TicketMono>
            <StatusBadge status={detail.report.status} />
            {detail.report.finalPriority ? (
              <StatusBadge priority={detail.report.finalPriority} />
            ) : null}
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
                <dt className="shrink-0 text-sm font-medium text-muted sm:w-40">Kategori</dt>
                <dd className="text-sm text-text">
                  {categoryNames.get(
                    detail.report.finalCategoryId ?? detail.report.submittedCategoryId,
                  ) ??
                    detail.report.finalCategoryId ??
                    detail.report.submittedCategoryId}
                </dd>
              </div>
              <div className="flex flex-col gap-1 py-3 sm:flex-row sm:gap-4">
                <dt className="shrink-0 text-sm font-medium text-muted sm:w-40">Jenis masalah</dt>
                <dd className="text-sm text-text">
                  {(detail.report.finalIssueTypeId ?? detail.report.submittedIssueTypeId) === null
                    ? '—'
                    : (issueTypeNames.get(
                        detail.report.finalIssueTypeId ?? detail.report.submittedIssueTypeId ?? '',
                      ) ??
                      detail.report.finalIssueTypeId ??
                      detail.report.submittedIssueTypeId)}
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
                <dt className="shrink-0 text-sm font-medium text-muted sm:w-40">Waktu kejadian</dt>
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
            </dl>
          </div>

          <section
            aria-labelledby="detail-attachments-title"
            className="mt-4 rounded-md border border-border bg-surface p-4"
          >
            <h2 id="detail-attachments-title" className="text-base font-semibold text-text">
              Lampiran
            </h2>
            {detail.isOwn === false ? (
              <p className="mt-1 text-sm text-muted">
                Lampiran hanya dapat dilihat oleh pelapor tiket ini.
              </p>
            ) : (detail.attachments ?? []).length === 0 ? (
              <p className="mt-1 text-sm text-muted">Tidak ada lampiran.</p>
            ) : (
              <AttachmentGallery
                ticketRef={detail.report.ticketNumber}
                attachments={detail.attachments ?? []}
              />
            )}
          </section>

          {detail.duplicateCandidates.length > 0 ? (
            <section
              aria-labelledby="detail-duplicate-title"
              className="mt-4 rounded-md border border-warning bg-tint-warning p-4"
            >
              <h2 id="detail-duplicate-title" className="text-base font-semibold text-text">
                Laporan serupa ditemukan
              </h2>
              <p className="mt-1 text-sm text-text">
                Laporan berikut tampak mirip dengan laporan ini.
              </p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {detail.duplicateCandidates.map((candidate) => (
                  <li key={candidate.id}>
                    <Link
                      to="/reporter/reports/$ticket"
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

          <section aria-labelledby="detail-timeline-title" className="mt-6">
            <h2 id="detail-timeline-title" className="text-lg font-semibold text-text">
              Riwayat laporan
            </h2>
            {detail.events.length === 0 ? (
              <p className="mt-2 text-sm text-muted">Belum ada riwayat.</p>
            ) : (
              <div className="mt-3">
                <Timeline
                  items={detail.events.map((entry, index) => ({
                    id: `${timelineTimestamp(entry)}-${index}`,
                    label: timelineItemLabel(entry),
                    description: timelineDescription(entry),
                    timestamp: formatDateTime(timelineTimestamp(entry)),
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
