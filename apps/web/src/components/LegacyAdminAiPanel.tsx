// Legacy AdminAiPanel (pre-Figma-150:933). Kept only for the existing unit
// test; the route now renders the Figma v2 blocks and never mounts this panel.
import { StatusBadge } from './index.js';

export interface LegacyAdminAiReport {
  readonly finalCategoryId: string | null;
  readonly finalIssueTypeId: string | null;
  readonly finalPriority: string | null;
  readonly priorityScore: number | null;
  readonly priorityFactors: unknown;
  readonly priorityDecidedBy: string | null;
}

export interface LegacyAdminAiAnalysis {
  readonly confidence: number | null;
  readonly reasoningSummary: string | null;
  readonly model: string;
  readonly promptVersion: string;
  readonly status: string;
}

function factorNumber(value: unknown, key: string): number | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const entry = (value as Record<string, unknown>)[key];
  return typeof entry === 'number' && Number.isFinite(entry) ? entry : null;
}

function scoringComplete(value: unknown): boolean | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const flag = (value as Record<string, unknown>)['scoringComplete'];
  return typeof flag === 'boolean' ? flag : null;
}

export function AdminAiPanel({
  report,
  analysis,
  categoryNames,
  issueTypeNames,
}: {
  readonly report: LegacyAdminAiReport;
  readonly analysis: LegacyAdminAiAnalysis | null | undefined;
  readonly categoryNames: ReadonlyMap<string, string>;
  readonly issueTypeNames: ReadonlyMap<string, string>;
}) {
  const hasFinal = report.finalCategoryId !== null && report.finalPriority !== null;
  if (!hasFinal) {
    return (
      <section
        aria-labelledby="admin-detail-ai-title"
        className="mt-4 rounded-md border border-info bg-tint-info p-4"
      >
        <h2 id="admin-detail-ai-title" className="text-base font-semibold text-text">
          Tinjauan AI
        </h2>
        <p className="mt-1 text-sm text-text">
          Menunggu verifikasi. Laporan ini ditahan karena layanan AI tidak tersedia.
        </p>
      </section>
    );
  }

  const factors = report.priorityFactors;
  const complete = scoringComplete(factors);
  const confidence =
    typeof analysis?.confidence === 'number' ? `${Math.round(analysis.confidence * 100)}%` : '—';

  return (
    <section
      aria-labelledby="admin-detail-ai-title"
      className="mt-4 rounded-md border border-info bg-tint-info p-4"
    >
      <h2 id="admin-detail-ai-title" className="text-base font-semibold text-text">
        Tinjauan AI
      </h2>
      <dl className="mt-3 divide-y divide-border">
        <div className="flex flex-col gap-1 py-2 sm:flex-row sm:gap-4">
          <dt className="shrink-0 text-sm font-medium text-muted sm:w-40">Kategori final</dt>
          <dd className="text-sm text-text">
            {categoryNames.get(report.finalCategoryId ?? '') ?? report.finalCategoryId}
          </dd>
        </div>
        <div className="flex flex-col gap-1 py-2 sm:flex-row sm:gap-4">
          <dt className="shrink-0 text-sm font-medium text-muted sm:w-40">Jenis masalah</dt>
          <dd className="text-sm text-text">
            {report.finalIssueTypeId === null
              ? '—'
              : (issueTypeNames.get(report.finalIssueTypeId) ?? report.finalIssueTypeId)}
          </dd>
        </div>
        <div className="flex flex-col gap-1 py-2 sm:flex-row sm:gap-4">
          <dt className="shrink-0 text-sm font-medium text-muted sm:w-40">Prioritas final</dt>
          <dd className="text-sm text-text">
            <StatusBadge priority={report.finalPriority} />
          </dd>
        </div>
        <div className="flex flex-col gap-1 py-2 sm:flex-row sm:gap-4">
          <dt className="shrink-0 text-sm font-medium text-muted sm:w-40">Skor prioritas</dt>
          <dd className="text-sm text-text">
            {report.priorityScore === null ? '—' : `${report.priorityScore} / 100`}
          </dd>
        </div>
        <div className="flex flex-col gap-1 py-2 sm:flex-row sm:gap-4">
          <dt className="shrink-0 text-sm font-medium text-muted sm:w-40">Faktor skor</dt>
          <dd className="text-sm text-text">
            <span className="block">
              Kategori {factorNumber(factors, 'category') ?? '—'} · Aset{' '}
              {factorNumber(factors, 'asset') ?? '—'} · Lokasi{' '}
              {factorNumber(factors, 'location') ?? '—'} · Frekuensi{' '}
              {factorNumber(factors, 'frequency') ?? '—'}
            </span>
            <span className="block text-muted">
              Pelapor terdampak: {factorNumber(factors, 'affectedReporters') ?? '—'}
              {complete === false ? ' · Bobot belum lengkap' : ''}
            </span>
          </dd>
        </div>
        <div className="flex flex-col gap-1 py-2 sm:flex-row sm:gap-4">
          <dt className="shrink-0 text-sm font-medium text-muted sm:w-40">Keyakinan AI</dt>
          <dd className="text-sm text-text">{confidence}</dd>
        </div>
        {analysis?.reasoningSummary !== null && analysis?.reasoningSummary !== undefined ? (
          <div className="flex flex-col gap-1 py-2 sm:flex-row sm:gap-4">
            <dt className="shrink-0 text-sm font-medium text-muted sm:w-40">Alasan singkat</dt>
            <dd className="text-pretty text-sm break-words text-text">
              {analysis.reasoningSummary}
            </dd>
          </div>
        ) : null}
        <div className="flex flex-col gap-1 py-2 sm:flex-row sm:gap-4">
          <dt className="shrink-0 text-sm font-medium text-muted sm:w-40">Sumber keputusan</dt>
          <dd className="text-sm text-text">
            {report.priorityDecidedBy === 'AI' ||
            (report.priorityDecidedBy === null && analysis !== null && analysis !== undefined)
              ? 'AI'
              : 'Admin (verifikasi manual)'}
          </dd>
        </div>
        <div className="flex flex-col gap-1 py-2 sm:flex-row sm:gap-4">
          <dt className="shrink-0 text-sm font-medium text-muted sm:w-40">Metadata model</dt>
          <dd className="text-sm text-text">
            {analysis === null || analysis === undefined
              ? 'Tidak ada metadata analisis AI tersimpan (kemungkinan verifikasi manual).'
              : `${analysis.model} · prompt ${analysis.promptVersion} · ${analysis.status}`}
          </dd>
        </div>
      </dl>
    </section>
  );
}
