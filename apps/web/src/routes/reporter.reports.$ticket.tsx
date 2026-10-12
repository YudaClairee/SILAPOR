// Report detail (Phase 3 P3-5): one of my reports by UUID or MNT- ticket.
// Shows ticket, status, submitted classification labels, location/asset,
// description, occurredAt/reportedAt, a duplicate-warning panel when the
// server reports candidates, and a SAFE timeline subset (event-type labels
// + timestamps only — raw message/metadata blobs are never rendered).
//
// Missing vs foreign tickets share one identical "Laporan tidak ditemukan"
// view (the server returns byte-identical 404s, never 403). Indonesian
// copy, no styling framework.
import { useEffect, useState } from 'react';
import {
  Link,
  createFileRoute,
  redirect,
  useNavigate,
  useRouter,
} from '@tanstack/react-router';
import { eventLabel, reportStatusLabel } from '../lib/report-helpers.js';
import type { DuplicateCandidate } from '@silapor/database';
import type { FormOptions } from '../server/reports.js';

interface ReportRow {
  readonly ticketNumber: string;
  readonly status: string;
  readonly locationId: string;
  readonly assetId: string | null;
  readonly submittedCategoryId: string;
  readonly submittedIssueTypeId: string | null;
  readonly description: string;
  readonly occurredAt: string | null;
  readonly reportedAt: string;
}

interface TimelineRow {
  readonly eventType?: unknown;
  readonly type?: unknown;
  readonly createdAt: string;
}

interface ReportDetailData {
  readonly report: ReportRow;
  readonly events: TimelineRow[];
  readonly duplicateCandidates: DuplicateCandidate[];
}

interface DetailLoaderData {
  readonly detail: ReportDetailData | null;
  readonly options: FormOptions | null;
  readonly notFound: boolean;
  readonly loadError: string | null;
  readonly needsClientLoad: boolean;
}

type DetailBundle =
  | { readonly detail: ReportDetailData | null; readonly options: FormOptions | null; readonly notFound: boolean; readonly loadError: string | null }
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
  const options = optionsResponse.ok
    ? ((await optionsResponse.json()) as FormOptions)
    : null;
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
    <section aria-labelledby="report-detail-title">
      <h1 id="report-detail-title">Detail Laporan</h1>
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

// RAW event rows carry message/metadata blobs — only the type label and the
// timestamp ever reach the DOM.
function entryType(entry: TimelineRow): string {
  if (typeof entry.eventType === 'string') {
    return entry.eventType;
  }
  if (typeof entry.type === 'string') {
    return entry.type;
  }
  return 'UNKNOWN';
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
    <section aria-labelledby="report-detail-title">
      <h1 id="report-detail-title">Detail Laporan</h1>
      <p>
        <Link to="/reporter/reports" search={{ filter: 'semua', status: '', offset: 0 }}>Laporan Saya</Link>
      </p>

      {clientPending ? <p role="status">Memuat laporan…</p> : null}

      {!clientPending && notFound ? <p role="alert">Laporan tidak ditemukan</p> : null}

      {!clientPending && !notFound && loadError !== null ? (
        <>
          <p role="alert">{loadError}</p>
          <button type="button" onClick={() => void router.invalidate()}>
            Coba lagi
          </button>
        </>
      ) : null}

      {!clientPending && !notFound && loadError === null && detail !== null ? (
        <>
          <dl>
            <dt>Nomor tiket</dt>
            <dd>{detail.report.ticketNumber}</dd>
            <dt>Status</dt>
            <dd>{reportStatusLabel(detail.report.status)}</dd>
            <dt>Kategori</dt>
            <dd>{categoryNames.get(detail.report.submittedCategoryId) ?? detail.report.submittedCategoryId}</dd>
            <dt>Jenis masalah</dt>
            <dd>
              {detail.report.submittedIssueTypeId === null
                ? '—'
                : (issueTypeNames.get(detail.report.submittedIssueTypeId) ??
                  detail.report.submittedIssueTypeId)}
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
          </dl>

          {detail.duplicateCandidates.length > 0 ? (
            <section aria-labelledby="detail-duplicate-title">
              <h2 id="detail-duplicate-title">Laporan serupa ditemukan</h2>
              <p>Laporan berikut tampak mirip dengan laporan ini.</p>
              <ul>
                {detail.duplicateCandidates.map((candidate) => (
                  <li key={candidate.id}>
                    <Link
                      to="/reporter/reports/$ticket"
                      params={{ ticket: candidate.ticketNumber }}
                    >
                      {candidate.ticketNumber}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section aria-labelledby="detail-timeline-title">
            <h2 id="detail-timeline-title">Riwayat laporan</h2>
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
