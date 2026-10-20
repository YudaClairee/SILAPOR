// Admin "Detail Tiket" quotes card (Figma 150:933). Pure UI.
import { adminReporterCaption, type AdminReporterQuote } from '../lib/admin-ticket-detail.js';
import { formatJakartaDateTime } from '../lib/ticket-detail.js';

export function AdminReporterQuotesCard(props: { readonly quotes: readonly AdminReporterQuote[]; readonly totalLabel: string }) {
  return (
    <section aria-labelledby="admin-detail-desc-title" className="rounded-xl border border-border bg-surface p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="admin-detail-desc-title" className="text-base font-semibold text-text">Deskripsi Laporan ({props.totalLabel})</h2>
        <span className="rounded-full bg-tint-info px-2.5 py-0.5 text-[11px] font-semibold text-badge-info">Terkonsolidasi</span>
      </div>
      <ul className="mt-3 space-y-2">
        {props.quotes.map((quote) => (
          <li key={quote.key} className="rounded-lg border-l-4 border-accent bg-background px-3 py-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-[13px] font-semibold text-text">{adminReporterCaption(quote)}</p>
              {quote.reportedAt === null ? null : (<p className="font-mono text-[11px] text-muted">{formatJakartaDateTime(quote.reportedAt)}</p>)}
            </div>
            <p className="mt-1 text-sm text-pretty break-words text-text italic">“{quote.description}”</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
