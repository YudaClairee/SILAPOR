// Admin "Detail Tiket" tab bar (Figma 150:933). Pure UI.
import { ADMIN_DETAIL_TAB_LABELS, ADMIN_DETAIL_TABS, type AdminDetailTab } from '../lib/admin-ticket-detail.js';

export function AdminTicketTabs(props: { readonly active: AdminDetailTab; readonly reporterCount: number; readonly onChange: (tab: AdminDetailTab) => void }) {
  return (
    <div role="tablist" aria-label="Bagian detail tiket" className="mt-4 flex gap-1 overflow-x-auto border-b border-border">
      {ADMIN_DETAIL_TABS.map((tab) => {
        const selected = tab === props.active;
        return (
          <button key={tab} type="button" role="tab" id={`admin-detail-tab-${tab}`} aria-selected={selected} onClick={() => props.onChange(tab)}
            className={`inline-flex min-h-[44px] shrink-0 items-center gap-2 border-b-2 px-4 text-sm font-medium whitespace-nowrap ${selected ? 'border-accent text-text' : 'border-transparent text-muted hover:text-text'}`}>
            {ADMIN_DETAIL_TAB_LABELS[tab]}
            {tab === 'pelapor' ? (
              <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-tint-info px-1.5 text-[11px] font-semibold text-badge-info">{props.reporterCount}</span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
