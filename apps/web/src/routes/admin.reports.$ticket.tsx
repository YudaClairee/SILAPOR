import { useEffect, useState } from 'react';
import { createFileRoute, redirect, useNavigate, useRouter } from '@tanstack/react-router';
import type { FormOptions } from '../server/reports.js';
import {
  AdminTicketV2Content,
  Button,
  ErrorPanel,
  LoadingState,
  useAdminTicketV2Tab,
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
  readonly priorityScore: number | null;
  readonly priorityFactors: unknown;
  readonly priorityDecidedBy: string | null;
  readonly priorityDecidedAt: string | null;
  readonly scoringConfigVersion: number;
  readonly description: string;
  readonly occurredAt: string | null;
  readonly version: number;
  readonly reportedAt: string;
  readonly verifiedAt: string | null;
  readonly resolvedAt: string | null;
  readonly closedAt: string | null;
}

interface AdminAiAnalysisRow {
  readonly id: string;
  readonly status: string;
  readonly verdict: string | null;
  readonly category: string | null;
  readonly issueType: string | null;
  readonly priority: string | null;
  readonly confidence: number | null;
  readonly reasoningSummary: string | null;
  readonly model: string;
  readonly promptVersion: string;
  readonly createdAt: string;
  readonly completedAt: string | null;
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
  readonly metadata?: unknown;
  readonly detail?: unknown;
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
  readonly aiAnalysis?: AdminAiAnalysisRow | null;
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
  const options = optionsResponse.ok ? ((await optionsResponse.json()) as FormOptions) : null;
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

function AdminReportDetailPage() {
  const loaderData = Route.useLoaderData() as AdminDetailLoaderData;
  const { ticket } = Route.useParams() as { ticket: string };
  const navigate = useNavigate();
  const router = useRouter();
  const { activeTab, onTabChange } = useAdminTicketV2Tab(ticket);

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

  return (
    <section aria-labelledby="admin-report-detail-title" className="mx-auto w-full max-w-[1200px]">
      <h1 id="admin-report-detail-title" className="sr-only">
        Detail Tiket {ticket}
      </h1>

      {clientPending ? (
        <div className="mt-4">
          <LoadingState message="Memuat laporan…" />
        </div>
      ) : null}

      {!clientPending && notFound ? (
        <p
          role="alert"
          className="mt-4 rounded-md border border-border bg-surface px-4 py-3 text-sm text-text"
        >
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
        <div className="mt-2">
          <AdminTicketV2Content
            ticket={ticket}
            detail={detail}
            options={options}
            activeTab={activeTab}
            onTabChange={onTabChange}
            onChanged={() => void router.invalidate()}
          />
        </div>
      ) : null}
    </section>
  );
}