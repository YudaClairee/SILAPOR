// Admin "Detail Tiket" asset + assignment card (Figma 150:933). Pure UI.
import { formatJakartaDateTime } from '../lib/ticket-detail.js';

export function AdminAssetAssignmentCard(props: {
  readonly assetCode: string | null; readonly assetName: string; readonly categoryName: string;
  readonly locationLabel: string; readonly technicianName: string | null; readonly technicianSpecialty: string | null;
  readonly technicianActiveCount: number | null; readonly assignedAt: string | null;
}) {
  return (
    <section aria-labelledby="admin-detail-asset-title" className="rounded-xl border border-border bg-surface p-5 shadow-sm">
      <h2 id="admin-detail-asset-title" className="text-base font-semibold text-text">Identitas Aset, Lokasi &amp; Penugasan</h2>
      <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div><dt className="text-xs text-muted">ID &amp; Nama Aset</dt><dd className="mt-0.5 text-sm font-medium text-text">{props.assetCode === null ? props.assetName : `${props.assetCode} · ${props.assetName}`}</dd></div>
        <div><dt className="text-xs text-muted">Kategori Fasilitas</dt><dd className="mt-0.5 text-sm text-text">{props.categoryName}</dd></div>
      </dl>
      <div className="mt-3"><p className="text-xs text-muted">Lokasi Terdaftar</p><p className="mt-0.5 text-sm font-medium text-text">{props.locationLabel}</p></div>
      <div className="mt-4 border-t border-border pt-3">
        <p className="text-xs text-muted">Teknisi Bertugas</p>
        {props.technicianName === null ? (<p className="mt-1 text-sm text-muted italic">Belum ditugaskan</p>) : (
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-tint-info px-3 py-2">
            <div className="flex items-center gap-2">
              <span aria-hidden="true" className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-[11px] font-semibold text-accent-contrast">{props.technicianName.trim().slice(0, 2).toUpperCase()}</span>
              <div><p className="text-sm font-semibold text-text">{props.technicianName}</p>
              <p className="text-xs text-muted">{props.technicianSpecialty ?? 'Teknisi'}{props.technicianActiveCount === null ? '' : ` · ${props.technicianActiveCount} tugas aktif`}</p></div>
            </div>
            {props.assignedAt === null ? null : (<p className="text-xs text-muted">Ditugaskan {formatJakartaDateTime(props.assignedAt)}</p>)}
          </div>
        )}
      </div>
    </section>
  );
}
