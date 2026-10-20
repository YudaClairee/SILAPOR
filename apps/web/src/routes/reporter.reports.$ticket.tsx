// Report detail (Phase 3 P3-5 + UI No. 5 + Figma "Detail Tiket" 90-1706): a
// sanitized campus ticket by UUID or MNT- ticket. Two-column layout — flow
// stepper, location/asset, description + supporting reports, classification,
// photo evidence on the left; status facts and the progress timeline on the
// right.
//
// Another reporter's ticket is a normal 200 sanitized view; only a truly
// missing ticket renders "Laporan tidak ditemukan". Indonesian copy.
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, createFileRoute, redirect, useNavigate, useRouter } from '@tanstack/react-router';
import { eventLabel } from '../lib/report-helpers.js';
import {
  actorLabel,
  confidenceBand,
  confidencePercent,
  deriveStatusTimestamps,
  flowPhaseLine,
  formatJakartaDateTime,
  locationParts,
} from '../lib/ticket-detail.js';
import type { DuplicateCandidate } from '@silapor/database';
import type { FormOptions } from '../server/reports.js';
import {
  ActivityIcon,
  ArrowLeftIcon,
  BuildingIcon,
  Button,
  ClipboardIcon,
  EmptyState,
  ErrorPanel,
  FileTextIcon,
  FlagIcon,
  HistoryIcon,
  ImageIcon,
  InfoIcon,
  LoadingState,
  LockIcon,
  MapPinIcon,
  PhotoEvidence,
  SectionCard,
  ShieldCheckIcon,
  SparkleIcon,
  StatusBadge,
  StatusStepper,
  TicketMono,
  Timeline,
  UsersIcon,
  buttonBaseClasses,
  buttonVariantClasses,
  priorityBadgeClassesFor,
} from '../components/index.js';
import { priorityLabel } from '../lib/admin-reports.js';

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
  // Verified impact snapshot (`priority_factors.affectedReporters`).
  readonly reporterCount?: number | null;
  readonly description: string;
  readonly occurredAt: string | null;
  readonly reportedAt: string;
  readonly verifiedAt?: string | null;
  readonly resolvedAt?: string | null;
  readonly closedAt?: string | null;
}

interface RelatedReportRow {
  readonly id: string;
  readonly ticketNumber: string;
  readonly description: string;
  readonly status: string;
  readonly relationType: string;
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
  readonly toValue?: unknown;
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
  // Optional for the same reason: a payload cached before Detail Tiket V2
  // simply hides the confidence meter / supporting-report block.
  readonly classificationConfidence?: number | null;
  readonly relatedReports?: readonly RelatedReportRow[];
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
    <section aria-labelledby="report-detail-title" className="max-w-6xl">
      <h1 id="report-detail-title" className="text-2xl font-semibold text-text">
        Detail Laporan
      </h1>
      <div className="mt-4">
        <LoadingState message="Memuat laporan…" />
      </div>
    </section>
  );
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

function timelineTimestamp(entry: TimelineRow): string {
  if (typeof entry.createdAt === 'string') {
    return entry.createdAt;
  }
  if (typeof entry.at === 'string') {
    return entry.at;
  }
  return '';
}

// Sanitized timeline entries (`kind`/`label`/`at`) render through the same
// label map; assignment entries show a static PII-free line (the technician
// id stays opaque — no name/phone lookup on reporter surfaces).
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

// Status reached BY this event, for the timeline chip. Notes/assignments that
// do not move the status render without a chip.
function timelineStatus(entry: TimelineRow): string | null {
  const type = entryType(entry);
  if (type === 'REPORT_CREATED') return 'REPORTED';
  if (type === 'REPORT_VERIFIED') return 'VERIFIED';
  if (type === 'ASSIGNMENT_CHANGED') return 'ASSIGNED';
  if (type === 'REPORT_RESOLVED') return 'RESOLVED';
  if (type === 'REPORT_CLOSED') return 'CLOSED';
  if (type === 'STATUS_CHANGED' && typeof entry.toValue === 'string') return entry.toValue;
  return null;
}

function DetailRow({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="text-right text-sm font-medium text-text">{children}</dd>
    </div>
  );
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

  const report = detail?.report ?? null;
  const categoryNames = new Map((options?.categories ?? []).map((c) => [c.id, c.name] as const));
  const issueTypeNames = new Map((options?.issueTypes ?? []).map((i) => [i.id, i.name] as const));
  const assetsById = new Map((options?.assets ?? []).map((a) => [a.id, a] as const));

  const related = detail?.relatedReports ?? [];
  // Two distinct counts stay separate: `related` are the grouped tickets the
  // reporter can open, `reporterCount` is the verified impact snapshot an admin
  // recorded (`priority_factors.affectedReporters`) and may exceed the linked
  // rows. Never inflate one with the other.
  const relatedCount = related.length;
  const reporterCount = report?.reporterCount ?? null;
  const confidence = confidencePercent(detail?.classificationConfidence ?? null);
  const priority = report?.finalPriority ?? null;
  const parts = locationParts(report?.locationId ?? null, options?.locations ?? []);
  const asset = report?.assetId == null ? null : (assetsById.get(report.assetId) ?? null);
  const categoryId = report === null ? null : (report.finalCategoryId ?? report.submittedCategoryId);
  const issueTypeId = report === null ? null : (report.finalIssueTypeId ?? report.submittedIssueTypeId);
  const categoryName = categoryId == null ? '—' : (categoryNames.get(categoryId) ?? '—');
  const issueTypeName =
    issueTypeId == null || issueTypeId === undefined
      ? '—'
      : (issueTypeNames.get(issueTypeId) ?? '—');
  const timestamps =
    report === null ? null : deriveStatusTimestamps(report, detail?.events ?? []);
  const phaseLine = report === null ? null : flowPhaseLine(report.status);

  return (
    <section aria-labelledby="report-detail-title" className="max-w-6xl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <nav aria-label="Breadcrumb" className="text-xs text-muted">
            <Link
              to="/reporter/reports"
              search={{ filter: 'semua', status: '', mine: false, offset: 0 }}
              className="hover:text-accent hover:underline"
            >
              Pemantauan Tiket
            </Link>
            <span aria-hidden="true"> / </span>
            <span>Detail Tiket</span>
          </nav>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <h1
              id="report-detail-title"
              className="font-mono text-3xl font-semibold tracking-tight text-text"
            >
              {report === null ? 'Detail Laporan' : `#${report.ticketNumber}`}
            </h1>
            {report === null ? null : <StatusBadge status={report.status} />}
            {priority === null ? null : (
              <span className={priorityBadgeClassesFor(priority)}>
                <FlagIcon className="h-3 w-3" aria-hidden="true" />
                Prioritas {priorityLabel(priority)}
              </span>
            )}
          </div>
          {report === null ? null : (
            <p className="mt-2 flex flex-wrap items-center gap-1.5 text-sm text-muted">
              <ClipboardIcon className="h-4 w-4" aria-hidden="true" />
              Dilaporkan pada:{' '}
              <TicketMono className="text-text">{formatJakartaDateTime(report.reportedAt)}</TicketMono>
            </p>
          )}
        </div>
        <Link
          to="/reporter/reports"
          search={{ filter: 'semua', status: '', mine: false, offset: 0 }}
          className={`${buttonBaseClasses} ${buttonVariantClasses.secondary} gap-2 rounded-full`}
        >
          <ArrowLeftIcon className="h-4 w-4" aria-hidden="true" />
          Kembali ke Pemantauan Tiket
        </Link>
      </div>

      {clientPending ? (
        <div className="mt-6">
          <LoadingState message="Memuat laporan…" />
        </div>
      ) : null}

      {!clientPending && notFound ? (
        <div className="mt-6">
          <EmptyState
            title="Laporan tidak ditemukan"
            description="Periksa kembali nomor tiket pada URL."
          />
        </div>
      ) : null}

      {!clientPending && !notFound && loadError !== null ? (
        <div className="mt-6">
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

      {!clientPending && !notFound && loadError === null && detail !== null && report !== null ? (
        <>
          <SectionCard
            icon={<ActivityIcon className="h-4 w-4" />}
            title="Alur Status Penanganan Fasilitas"
            titleId="detail-flow-title"
            className="mt-6"
            aside={
              <span className="inline-flex rounded-full bg-tint-info px-3 py-1 text-xs font-medium text-badge-info">
                {phaseLine ?? `Status: ${report.status}`}
              </span>
            }
          >
            {timestamps === null ? null : (
              <StatusStepper status={report.status} timestamps={timestamps} />
            )}
          </SectionCard>

          <div className="mt-4 grid grid-cols-1 items-start gap-4 lg:grid-cols-[1.35fr_1fr]">
            <div className="flex min-w-0 flex-col gap-4">
              <SectionCard
                icon={<MapPinIcon className="h-4 w-4" />}
                title="Lokasi dan Aset"
                subtitle="Rincian inventaris dan penempatan fasilitas perkuliahan"
                titleId="detail-location-title"
                bodyClassName="px-0 py-0"
              >
                <dl className="divide-y divide-border">
                  <DetailRow label="Nama Aset">
                    <span className="flex flex-wrap items-center justify-end gap-1.5">
                      <BuildingIcon className="h-4 w-4 text-muted" aria-hidden="true" />
                      {asset?.name ?? 'Tidak tercatat'}
                    </span>
                  </DetailRow>
                  <DetailRow label="Gedung">{parts.building ?? '—'}</DetailRow>
                  <DetailRow label="Lantai">{parts.floor ?? '—'}</DetailRow>
                  <DetailRow label="Ruangan">{parts.room ?? '—'}</DetailRow>
                </dl>
                <p className="flex items-start gap-2 border-t border-border px-5 py-3 text-xs text-muted">
                  <ShieldCheckIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>Terdaftar dalam Inventaris Resmi UMPER UPI Kampus Tasikmalaya</span>
                </p>
              </SectionCard>

              <SectionCard
                icon={<FileTextIcon className="h-4 w-4" />}
                title="Deskripsi Laporan & Dukungan Pelapor"
                titleId="detail-description-title"
              >
                <div className="rounded-md border-l-4 border-accent bg-background p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                      Deskripsi Laporan Utama
                    </p>
                    <p className="font-mono text-[11px] text-muted">Laporan Awal</p>
                  </div>
                  <p className="mt-2 text-sm text-pretty break-words whitespace-pre-wrap text-text">
                    “{report.description}”
                  </p>
                </div>

                <div className="mt-4">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <p className="flex items-center gap-1.5 text-sm font-semibold text-text">
                      <UsersIcon className="h-4 w-4 text-muted" aria-hidden="true" />
                      {relatedCount === 0
                        ? 'Laporan pendukung'
                        : `${relatedCount} laporan mendukung tiket ini`}
                    </p>
                    <p className="text-xs text-muted">
                      (Dikelompokkan otomatis berdasarkan kesamaan sarana &amp; lokasi)
                    </p>
                  </div>
                  {relatedCount === 0 ? (
                    <p className="mt-2 text-sm text-muted">
                      Belum ada laporan pendukung yang dikelompokkan.
                    </p>
                  ) : (
                    <ul className="mt-3 grid gap-3 sm:grid-cols-3">
                      {related.map((item, index) => (
                        <li
                          key={item.id}
                          className="flex flex-col rounded-md border border-border bg-surface p-3"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="flex items-center gap-1.5 text-[11px] font-semibold text-muted">
                              <UsersIcon className="h-3 w-3" aria-hidden="true" />
                              Laporan Pendukung #{index + 1}
                            </p>
                            <StatusBadge status={item.status} />
                          </div>
                          <p className="mt-2 line-clamp-4 text-sm text-pretty break-words text-text">
                            “{item.description}”
                          </p>
                          <Link
                            to="/reporter/reports/$ticket"
                            params={{ ticket: item.ticketNumber }}
                            className="mt-2 inline-block text-xs text-accent hover:underline"
                          >
                            <TicketMono>{item.ticketNumber}</TicketMono>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {detail.duplicateCandidates.length === 0 ? null : (
                  <div className="mt-4 rounded-md border border-warning bg-tint-warning p-3">
                    <p className="text-sm font-semibold text-text">Laporan serupa ditemukan</p>
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
                  </div>
                )}
              </SectionCard>

              <SectionCard
                icon={<SparkleIcon className="h-4 w-4" />}
                title="Klasifikasi Laporan"
                subtitle="Standardisasi kategori terotomasi cerdas SCMS"
                titleId="detail-classification-title"
                aside={
                  <span className="inline-flex rounded-full bg-tint-muted px-2.5 py-1 text-xs font-medium text-badge-muted">
                    Read-Only
                  </span>
                }
              >
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-md border border-border bg-background p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                      Kategori Fasilitas
                    </p>
                    <p className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-text">
                      <BuildingIcon className="h-4 w-4 text-muted" aria-hidden="true" />
                      {categoryName}
                    </p>
                  </div>
                  <div className="rounded-md border border-border bg-background p-3">
                    <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                      Jenis Masalah
                    </p>
                    <p className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-text">
                      <ActivityIcon className="h-4 w-4 text-muted" aria-hidden="true" />
                      {issueTypeName}
                    </p>
                  </div>
                  <div className="rounded-md border border-border bg-background p-3">
                    <div className="flex flex-wrap items-center justify-between gap-1">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted">
                        Tingkat Keyakinan
                      </p>
                      <p className="font-mono text-[11px] font-semibold text-text">
                        {confidence === null
                          ? 'Belum dinilai'
                          : `${confidence}% (${confidenceBand(confidence)})`}
                      </p>
                    </div>
                    <div className="mt-2 h-1.5 w-full rounded-full bg-tint-muted">
                      <div
                        className="h-1.5 rounded-full bg-accent-secondary"
                        style={{ width: `${confidence ?? 0}%` }}
                      />
                    </div>
                  </div>
                </div>
                <p className="mt-3 flex items-start gap-2 text-xs text-muted">
                  <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>
                    Label standar dihasilkan otomatis dari analisis deskripsi laporan untuk
                    mempercepat triase dan perbaikan sarana. Hasil bersifat read-only.
                  </span>
                </p>
              </SectionCard>

              <SectionCard
                icon={<ImageIcon className="h-4 w-4" />}
                title="Foto Bukti Kerusakan"
                titleId="detail-photos-title"
              >
                {detail.isOwn === false ? (
                  <p className="flex items-start gap-2 text-sm text-muted">
                    <LockIcon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                    <span>Lampiran hanya dapat dilihat oleh pelapor tiket ini.</span>
                  </p>
                ) : (
                  <PhotoEvidence
                    ticketRef={report.ticketNumber}
                    attachments={detail.attachments ?? []}
                  />
                )}
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-xs text-muted">
                  <p className="flex items-center gap-1.5">
                    <ImageIcon className="h-3.5 w-3.5" aria-hidden="true" />
                    Klik untuk memperbesar pratinjau
                  </p>
                  <p>Hanya menampilkan foto bukti dari pelapor</p>
                </div>
              </SectionCard>
            </div>

            <div className="flex min-w-0 flex-col gap-4">
              <SectionCard
                icon={<ClipboardIcon className="h-4 w-4" />}
                title="Status Laporan"
                subtitle="Klasifikasi proses dan penanganan pengaduan"
                titleId="detail-status-title"
                bodyClassName="px-0 py-0"
              >
                <dl className="divide-y divide-border">
                  <DetailRow label="Status Saat Ini">
                    <StatusBadge status={report.status} />
                  </DetailRow>
                  <DetailRow label="Prioritas">
                    <StatusBadge priority={priority} />
                  </DetailRow>
                  <DetailRow label="Jumlah Pelapor">
                    <span className="flex flex-wrap items-center justify-end gap-1.5">
                      <UsersIcon className="h-4 w-4 text-muted" aria-hidden="true" />
                      {reporterCount !== null
                        ? `${reporterCount} pelapor terdampak`
                        : relatedCount > 0
                          ? `${relatedCount + 1} laporan terkait`
                          : 'Hanya laporan ini'}
                    </span>
                  </DetailRow>
                  <DetailRow label="Metode Pelaporan">Portal SCMS Mahasiswa</DetailRow>
                </dl>
                <p className="flex items-start gap-2 border-t border-border px-5 py-3 text-xs text-muted">
                  <LockIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>
                    <span className="font-semibold text-text">Privasi Pelapor:</span> Identitas
                    pelapor lain dirahasiakan sepenuhnya untuk perlindungan data pribadi.
                  </span>
                </p>
              </SectionCard>

              <SectionCard
                icon={<HistoryIcon className="h-4 w-4" />}
                title="Linimasa Penanganan"
                subtitle="Riwayat aktivitas dan pembaruan status tiket"
                titleId="detail-timeline-title"
              >
                <Timeline
                  items={(detail.events ?? [])
                    .slice()
                    .reverse()
                    .map((entry, index) => {
                      const rawTimestamp = timelineTimestamp(entry);
                      const note = timelineDescription(entry);
                      const badgeStatus = timelineStatus(entry);
                      return {
                        id: `${rawTimestamp}-${String(index)}`,
                        timestamp: formatJakartaDateTime(rawTimestamp === '' ? null : rawTimestamp),
                        label: timelineItemLabel(entry),
                        badge:
                          badgeStatus === null ? undefined : <StatusBadge status={badgeStatus} />,
                        actor: actorLabel(entry),
                        description:
                          note === null ? undefined : (
                            <span className="mt-1.5 block rounded-md bg-background px-3 py-2 text-sm text-pretty break-words text-text">
                              {note}
                            </span>
                          ),
                      };
                    })}
                />
                <p className="mt-3 flex items-start gap-2 border-t border-border pt-3 text-xs text-muted">
                  <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>Seluruh waktu ditampilkan dalam Waktu Indonesia Barat (WIB).</span>
                </p>
              </SectionCard>
            </div>
          </div>
        </>
      ) : null}
    </section>
  );
}
