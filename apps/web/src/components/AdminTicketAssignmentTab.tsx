// Admin "Detail Tiket" assignment tab (Figma 150:933 "Penugasan dan Progres").
import { useEffect, useState } from 'react';
import { REPORT_TRANSITIONS, requiresNote, type ReportStatus } from '@silapor/domain';
import type { FormOptions } from '../server/reports.js';
import { Button, LoadingState, Select, StatusBadge, Textarea } from './index.js';
import { postAdminWorkflow } from './AdminWorkflowPost.js';

interface TechnicianOption {
  readonly id: string;
  readonly displayName: string;
  readonly isActive: boolean;
}

function parseTechnicians(value: unknown): TechnicianOption[] {
  if (!Array.isArray(value)) return [];
  const out: TechnicianOption[] = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== 'object') continue;
    const r = entry as Record<string, unknown>;
    if (typeof r['id'] !== 'string') continue;
    if (typeof r['displayName'] !== 'string') continue;
    out.push({
      id: r['id'] as string,
      displayName: r['displayName'] as string,
      isActive: r['isActive'] === true,
    });
  }
  return out;
}

const POST_ASSIGNED_STATUSES: ReadonlySet<string> = new Set([
  'ASSIGNED',
  'INSPECTION',
  'IN_REPAIR',
  'RESOLVED',
  'CLOSED',
]);

export function AdminTicketAssignmentTab(props: {
  readonly ticket: string;
  readonly report: { readonly status: string; readonly version: number };
  readonly options: FormOptions | null;
  readonly onChanged: () => void;
}) {
  const showAssignCard = props.report.status === 'VERIFIED';
  const showProgressCard = POST_ASSIGNED_STATUSES.has(props.report.status);
  const isClosed = props.report.status === 'CLOSED';

  const [technicians, setTechnicians] = useState<TechnicianOption[] | null>(null);
  const [techError, setTechError] = useState<string | null>(null);
  const [technicianId, setTechnicianId] = useState('');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
  }, [props.report.status]);

  // Daftar teknisi TIDAK ada di /api/reports/form-options (payload reporter),
  // jadi dimuat dari endpoint admin khusus teknisi. Hanya yang aktif yg tampil.
  useEffect(() => {
    if (!showAssignCard) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/admin/technicians?includeInactive=false&limit=200', {
          credentials: 'include',
        });
        if (cancelled) return;
        if (!res.ok) {
          setTechError('Gagal memuat daftar teknisi (' + res.status + ').');
          setTechnicians([]);
          return;
        }
        try {
          const rows = parseTechnicians(await res.json()).filter((t) => t.isActive);
          if (!cancelled) {
            setTechnicians(rows);
            setTechError(rows.length === 0 ? 'Belum ada teknisi aktif. Tambahkan di Kelola Teknisi.' : null);
          }
        } catch {
          if (!cancelled) {
            setTechError('Respons daftar teknisi tidak valid.');
            setTechnicians([]);
          }
        }
      } catch {
        if (!cancelled) {
          setTechError('Tidak dapat terhubung ke server saat memuat teknisi.');
          setTechnicians([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showAssignCard]);

  const nextStatuses = (REPORT_TRANSITIONS[props.report.status as ReportStatus] ?? []) as readonly ReportStatus[];

  async function submitAssign(): Promise<void> {
    if (technicianId === '') { setError('Pilih teknisi terlebih dahulu.'); return; }
    setPending(true); setError(null);
    const result = await postAdminWorkflow(props.ticket, 'assign', {
      technicianId, reason: reason.trim() === '' ? null : reason.trim(), expectedVersion: props.report.version,
    });
    setPending(false);
    if (!result.ok) { setError(result.message); return; }
    setTechnicianId(''); setReason(''); props.onChanged();
  }

  async function submitNote(): Promise<void> {
    if (note.trim().length < 5) { setError('Catatan minimal 5 karakter.'); return; }
    setPending(true); setError(null);
    const result = await postAdminWorkflow(props.ticket, 'updates', { message: note.trim(), expectedVersion: props.report.version });
    setPending(false);
    if (!result.ok) { setError(result.message); return; }
    setNote(''); props.onChanged();
  }

  return (
    <div className="grid grid-cols-1 gap-4">
      {showAssignCard ? (
        <section aria-labelledby="admin-assign-title" className="rounded-xl border border-border bg-surface p-5 shadow-sm">
          <h2 id="admin-assign-title" className="text-base font-semibold text-text">Penugasan Teknisi</h2>
          <p className="mt-1 text-xs text-muted">Status saat ini: <StatusBadge status={props.report.status} /></p>
          <div className="mt-3 max-w-2xl space-y-3">
            <label className="block"><span className="mb-1 block text-xs font-medium text-muted">Teknisi</span>
              {technicians === null ? (
                <LoadingState message="Memuat teknisi…" />
              ) : (
                <Select value={technicianId} onChange={(event) => setTechnicianId(event.target.value)}>
                  <option value="">Pilih teknisi…</option>
                  {technicians.map((technician) => (<option key={technician.id} value={technician.id}>{technician.displayName}</option>))}
                </Select>
              )}
            </label>
            {techError === null ? null : <p className="text-sm text-muted">{techError}</p>}
            <label className="block"><span className="mb-1 block text-xs font-medium text-muted">Alasan (opsional)</span>
              <Textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={2} placeholder="Contoh: Teknisi spesialis proyektor sedang tersedia." />
            </label>
            {error === null ? null : <p role="alert" className="text-sm text-danger">{error}</p>}
            <Button type="button" variant="primary" disabled={pending} onClick={() => void submitAssign()}>{pending ? 'Menyimpan…' : 'Tugaskan Teknisi'}</Button>
          </div>
        </section>
      ) : null}

      {showProgressCard ? (
        <section aria-labelledby="admin-progress-title" className="rounded-xl border border-border bg-surface p-5 shadow-sm">
          <h2 id="admin-progress-title" className="text-base font-semibold text-text">Catatan Progres &amp; Transisi Status</h2>
          <p className="mt-1 text-xs text-muted">Status saat ini: <StatusBadge status={props.report.status} /></p>
          {isClosed ? (
            <p className="mt-3 text-sm text-muted">
              Laporan sudah ditutup. Tidak ada catatan progres atau transisi status lanjutan.
            </p>
          ) : (
            <div className="mt-3 max-w-2xl space-y-3">
              <label className="block"><span className="mb-1 block text-xs font-medium text-muted">Catatan progres (min. 5 karakter)</span>
                <Textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} placeholder="Contoh: Teknisi tiba di lokasi, lampu proyektor perlu diganti." />
              </label>
              {error === null ? null : <p role="alert" className="text-sm text-danger">{error}</p>}
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="secondary" disabled={pending} onClick={() => void submitNote()}>{pending ? 'Menyimpan…' : 'Tambah Catatan'}</Button>
                {nextStatuses.map((next) => (
                  <Button key={next} type="button" variant="primary" disabled={pending}
                    onClick={() => {
                      if (requiresNote(props.report.status as ReportStatus, next) && note.trim().length < 5) {
                        setError(`Transisi ke ${next} wajib disertai catatan (min. 5 karakter).`); return;
                      }
                      setPending(true); setError(null);
                      void postAdminWorkflow(props.ticket, 'transition', {
                        nextStatus: next, note: note.trim() === '' ? null : note.trim(), expectedVersion: props.report.version,
                      }).then((result) => {
                        setPending(false);
                        if (!result.ok) { setError(result.message); return; }
                        setNote(''); props.onChanged();
                      });
                    }}>
                    {next === 'CLOSED' ? 'Konfirmasi Penyelesaian' : `Lanjut ke ${next}`}
                  </Button>
                ))}
              </div>
              <p className="text-xs text-muted">Konflik versi (409) akan meminta Anda memuat ulang data sebelum menyimpan.</p>
            </div>
          )}
        </section>
      ) : null}

      {!showAssignCard && !showProgressCard ? (
        <section aria-labelledby="admin-pending-verify-title" className="rounded-xl border border-border bg-surface p-5 shadow-sm">
          <h2 id="admin-pending-verify-title" className="text-base font-semibold text-text">Menunggu Verifikasi</h2>
          <p className="mt-1 text-xs text-muted">Status saat ini: <StatusBadge status={props.report.status} /></p>
          <p className="mt-3 text-sm text-muted">
            Laporan belum terverifikasi. Selesaikan verifikasi laporan terlebih dahulu sebelum menugaskan teknisi.
          </p>
        </section>
      ) : null}
    </div>
  );
}
