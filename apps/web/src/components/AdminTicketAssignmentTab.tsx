// Admin "Detail Tiket" assignment tab (Figma 150:933 "Penugasan dan Progres").
import { useState } from 'react';
import { REPORT_TRANSITIONS, requiresNote, type ReportStatus } from '@silapor/domain';
import type { FormOptions } from '../server/reports.js';
import { Button, Select, StatusBadge, Textarea } from './index.js';
import { postAdminWorkflow } from './AdminWorkflowPost.js';

export function AdminTicketAssignmentTab(props: {
  readonly ticket: string;
  readonly report: { readonly status: string; readonly version: number };
  readonly options: FormOptions | null;
  readonly onChanged: () => void;
}) {
  const technicians = props.options?.technicians ?? [];
  const [technicianId, setTechnicianId] = useState('');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <section aria-labelledby="admin-assign-title" className="rounded-xl border border-border bg-surface p-5 shadow-sm">
        <h2 id="admin-assign-title" className="text-base font-semibold text-text">Penugasan Teknisi</h2>
        <p className="mt-1 text-xs text-muted">Status saat ini: <StatusBadge status={props.report.status} /></p>
        <div className="mt-3 space-y-3">
          <label className="block"><span className="mb-1 block text-xs font-medium text-muted">Teknisi</span>
            <Select value={technicianId} onChange={(event) => setTechnicianId(event.target.value)}>
              <option value="">Pilih teknisi…</option>
              {technicians.map((technician) => (<option key={technician.id} value={technician.id}>{technician.displayName}</option>))}
            </Select>
          </label>
          <label className="block"><span className="mb-1 block text-xs font-medium text-muted">Alasan (opsional)</span>
            <Textarea value={reason} onChange={(event) => setReason(event.target.value)} rows={2} placeholder="Contoh: Teknisi spesialis proyektor sedang tersedia." />
          </label>
          {error === null ? null : <p role="alert" className="text-sm text-danger">{error}</p>}
          <Button type="button" variant="primary" disabled={pending} onClick={() => void submitAssign()}>{pending ? 'Menyimpan…' : 'Tugaskan Teknisi'}</Button>
        </div>
      </section>
      <section aria-labelledby="admin-progress-title" className="rounded-xl border border-border bg-surface p-5 shadow-sm">
        <h2 id="admin-progress-title" className="text-base font-semibold text-text">Catatan Progres &amp; Transisi Status</h2>
        <label className="mt-3 block"><span className="mb-1 block text-xs font-medium text-muted">Catatan progres (min. 5 karakter)</span>
          <Textarea value={note} onChange={(event) => setNote(event.target.value)} rows={3} placeholder="Contoh: Teknisi tiba di lokasi, lampu proyektor perlu diganti." />
        </label>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button type="button" variant="secondary" disabled={pending} onClick={() => void submitNote()}>{pending ? 'Menyimpan…' : 'Tambah Catatan'}</Button>
          {nextStatuses.map((next) => (
            <Button key={next} type="button" variant={next === 'CLOSED' ? 'primary' : 'secondary'} disabled={pending}
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
                  props.onChanged();
                });
              }}>
              {next === 'CLOSED' ? 'Konfirmasi Penyelesaian' : `Lanjut ke ${next}`}
            </Button>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted">Konflik versi (409) tampil sebagai “Tiket diperbarui admin lain — muat ulang data”.</p>
      </section>
    </div>
  );
}
