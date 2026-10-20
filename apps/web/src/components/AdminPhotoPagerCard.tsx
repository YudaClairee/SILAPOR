// Admin "Detail Tiket" photo pager (Figma 150:933). Pure UI.
import { useState } from 'react';
import { adminPhotoCaption } from '../lib/admin-ticket-detail.js';
import { ChevronLeftIcon, ChevronRightIcon, ImageIcon } from './index.js';

export function AdminPhotoPagerCard(props: { readonly ticket: string; readonly attachments: readonly { readonly id: string; readonly originalFilename: string }[] }) {
  const total = props.attachments.length;
  const pageSize = 2;
  const [start, setStart] = useState(0);
  const first = total === 0 ? 0 : Math.min(start, Math.max(0, total - 1));
  const visible = props.attachments.slice(first, first + pageSize);
  const last = first + visible.length;
  return (
    <section aria-labelledby="admin-detail-photo-title" className="rounded-xl border border-border bg-surface p-5 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="admin-detail-photo-title" className="text-base font-semibold text-text">Foto Bukti Laporan ({total} Foto)</h2>
        {total <= pageSize ? null : (
          <div className="flex items-center gap-2" data-print="hide">
            <p className="text-xs text-muted">Menampilkan {first + 1}–{last} dari {total} foto</p>
            <button type="button" onClick={() => setStart(Math.max(0, first - pageSize))} disabled={first === 0} aria-label="Foto sebelumnya" className="rounded-md border border-border bg-surface p-1.5 text-text disabled:cursor-not-allowed disabled:opacity-40"><ChevronLeftIcon className="h-4 w-4" /></button>
            <button type="button" onClick={() => setStart(first + pageSize)} disabled={last >= total} aria-label="Foto berikutnya" className="rounded-md border border-border bg-surface p-1.5 text-text disabled:cursor-not-allowed disabled:opacity-40"><ChevronRightIcon className="h-4 w-4" /></button>
          </div>
        )}
      </div>
      {total === 0 ? (
        <p className="mt-3 flex items-center gap-2 text-sm text-muted"><ImageIcon className="h-4 w-4" />Tidak ada foto bukti yang dilampirkan.</p>
      ) : (
        <ul className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          {visible.map((attachment, index) => {
            const photoNumber = first + index + 1;
            return (
              <li key={attachment.id} className="overflow-hidden rounded-xl border border-border bg-surface">
                <div className="relative aspect-[4/3] w-full overflow-hidden bg-background">
                  <img src={`/api/reports/${encodeURIComponent(props.ticket)}/attachments/${encodeURIComponent(attachment.id)}`} alt={`Foto ${photoNumber} dari ${total}: ${attachment.originalFilename}`} loading="lazy" onError={(event) => { event.currentTarget.style.display = 'none'; }} className="absolute inset-0 h-full w-full object-cover" />
                  <span className="absolute top-2 left-2 inline-flex h-6 min-w-6 items-center justify-center rounded-md bg-black/60 px-1.5 font-mono text-[11px] font-semibold text-white">{photoNumber}</span>
                </div>
                <div className="px-3 py-2.5">
                  <p className="truncate text-[13px] font-semibold text-text" title={adminPhotoCaption(photoNumber)}>{adminPhotoCaption(photoNumber)}</p>
                  <p className="mt-0.5 truncate font-mono text-xs text-muted" title={attachment.originalFilename}>Foto {photoNumber} · {attachment.originalFilename}</p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
