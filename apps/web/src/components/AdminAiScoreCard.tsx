// Admin "Detail Tiket" AI + score card (Figma 150:933). Pure UI.
import { formatConfidencePercent, formatScoreId } from '../lib/ticket-detail.js';

export function AdminAiScoreCard(props: {
  readonly categoryName: string; readonly issueTypeName: string; readonly confidence: number | null;
  readonly score: number | null; readonly priority: string | null; readonly scoreExplanation: string;
}) {
  const percent = props.confidence === null ? null : Math.round((props.confidence <= 1 ? props.confidence * 100 : props.confidence) * 10) / 10;
  const priorityLabel = props.priority === 'HIGH' ? 'Tinggi' : props.priority === 'MEDIUM' ? 'Sedang' : props.priority === 'LOW' ? 'Rendah' : '—';
  return (
    <section aria-labelledby="admin-detail-ai-title" className="rounded-xl border border-border bg-surface p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="admin-detail-ai-title" className="text-base font-semibold text-text">Hasil Pemeriksaan Sistem (AI) &amp; Skor Prioritas</h2>
        <span className="rounded bg-tint-muted px-2 py-0.5 text-[11px] font-semibold tracking-wide text-badge-muted uppercase">Read-only</span>
      </div>
      <p className="mt-3 text-xs text-muted">Kelayakan Bukti: <span className="inline-flex items-center gap-1 rounded-full bg-tint-success px-2 py-0.5 font-semibold text-badge-success">Foto jelas &amp; deskripsi relevan</span></p>
      <dl className="mt-2 grid grid-cols-1 gap-2 rounded-lg bg-background p-3 sm:grid-cols-2">
        <div><dt className="text-xs text-muted">Kategori Terklasifikasi</dt><dd className="mt-0.5 text-sm font-semibold text-text">{props.categoryName}</dd></div>
        <div><dt className="text-xs text-muted">Jenis Masalah</dt><dd className="mt-0.5 text-sm font-semibold text-text">{props.issueTypeName}</dd></div>
      </dl>
      <div className="mt-3">
        <div className="flex items-center justify-between gap-2 text-xs"><span className="text-muted">Tingkat Keyakinan Verifikasi Laporan oleh AI</span><span className="font-semibold text-text">{formatConfidencePercent(props.confidence)}</span></div>
        <div className="mt-1 h-2 overflow-hidden rounded-full bg-border" role="img" aria-label={`Keyakinan AI ${formatConfidencePercent(props.confidence)}`}>
          <div className="h-full rounded-full bg-accent" style={{ width: `${percent === null ? 0 : Math.max(0, Math.min(100, percent))}%` }} />
        </div>
      </div>
      <div className="mt-3 border-t border-border pt-3">
        <p className="text-xs font-semibold tracking-wide text-muted uppercase">Skor Prioritas Laporan</p>
        <p className="mt-1 flex items-baseline justify-between gap-2">
          <span className="text-2xl font-bold text-danger">{props.score === null ? '—' : formatScoreId(props.score)}<span className="text-base font-medium text-muted"> /100</span></span>
          <span className="rounded-full bg-tint-danger px-2.5 py-0.5 text-xs font-semibold text-badge-danger">{priorityLabel}</span>
        </p>
        <p className="mt-1 text-xs text-muted">{props.scoreExplanation}</p>
      </div>
    </section>
  );
}
