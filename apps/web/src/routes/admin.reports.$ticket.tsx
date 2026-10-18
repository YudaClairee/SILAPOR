import { useEffect, useState } from 'react';
import { Link, createFileRoute, redirect, useNavigate, useRouter } from '@tanstack/react-router';
import { REPORT_TRANSITIONS, requiresNote, type ReportStatus } from '@silapor/domain';
import { eventLabel } from '../lib/report-helpers.js';
import type { FormOptions } from '../server/reports.js';
import {
  AttachmentGallery,
  Button,
  ErrorPanel,
  LoadingState,
  Select,
  StatusBadge,
  Textarea,
  TicketMono,
  Timeline,
  buttonBaseClasses,
  buttonVariantClasses,
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

// Timeline rows may use `eventType` (detail shape) or `type` (timeline
// endpoint shape) — only the type label and the timestamp reach the DOM.
function entryType(entry: AdminEventRow): string {
  if (typeof entry.eventType === 'string') {
    return entry.eventType;
  }
  if (typeof entry.type === 'string') {
    return entry.type;
  }
  return 'UNKNOWN';
}

// ---------------------------------------------------------------------------
// Admin workflow: fast-path hand verification of held reports (Task 8) plus
// assign / transition / updates forms and the full admin timeline. The
// manual reject / duplicate / priority panels were removed per the AI
// verification design (2026-10-14): submit-time AI verify or held-only
// verify is the only classification path, with no admin override mid-
// lifecycle. Every mutation sends the loaded report.version as
// expectedVersion; a 409 surfaces the conflict panel ("Laporan diubah admin
// lain — muat ulang") with a reload action that re-invalidates the loader
// (fresh version).
// ---------------------------------------------------------------------------

interface WorkflowTimelineEntry {
  readonly id: string;
  readonly kind: string;
  readonly at: string;
  readonly actorId: string | null;
  readonly label: string;
  readonly detail: Record<string, unknown> | null;
  readonly condition?: string | null;
}

// Technician options carry display fields only (id + displayName + code) —
// the list endpoint returns no contact PII, and nothing else is rendered.
interface TechnicianOption {
  readonly id: string;
  readonly displayName: string;
  readonly technicianCode: string;
}

const TERMINAL_CONFIRM_STATUSES: readonly string[] = ['CLOSED'];

function validNextStatuses(status: string): readonly string[] {
  const allowed = (REPORT_TRANSITIONS as Record<string, readonly string[]>)[status];
  return allowed ?? [];
}

// `requiresNote` needs domain `ReportStatus` values — unknown runtime
// strings (never expected from the matrix above) fall back to no-note.
function noteRequiredFor(from: string, to: string): boolean {
  const known = Object.keys(REPORT_TRANSITIONS);
  if (!known.includes(from) || !known.includes(to)) {
    return false;
  }
  return requiresNote(from as ReportStatus, to as ReportStatus);
}

async function postWorkflowAction(
  path: string,
  payload: Record<string, unknown>,
): Promise<{ readonly ok: boolean; readonly status: number; readonly body: unknown }> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(payload),
  });
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  return { ok: response.ok, status: response.status, body };
}

function workflowErrorMessage(body: unknown, fallback: string): string {
  if (typeof body === 'object' && body !== null) {
    const message = (body as { readonly error?: { readonly message?: unknown } }).error?.message;
    if (typeof message === 'string' && message !== '') {
      return message;
    }
  }
  return fallback;
}

// Latest still-active assignment (unassignedAt null) → technician id.
function currentTechnicianOf(timeline: readonly WorkflowTimelineEntry[] | null): string | null {
  if (timeline === null) {
    return null;
  }
  for (let index = timeline.length - 1; index >= 0; index--) {
    const entry = timeline[index];
    if (entry === undefined || entry.kind !== 'assignment' || entry.detail === null) {
      continue;
    }
    if (entry.detail['unassignedAt'] !== null && entry.detail['unassignedAt'] !== undefined) {
      continue;
    }
    const technicianId = entry.detail['technicianId'];
    return typeof technicianId === 'string' ? technicianId : null;
  }
  return null;
}

function workflowEntryLabel(entry: WorkflowTimelineEntry): string {
  if (entry.kind === 'event') {
    if (entry.condition === 'LAPORAN_PALSU') {
      return 'Catatan progres (Laporan Palsu)';
    }
    const eventType = entry.detail !== null ? entry.detail['eventType'] : undefined;
    return eventLabel(typeof eventType === 'string' ? eventType : entry.label);
  }
  if (entry.kind === 'update') {
    return entry.condition === 'LAPORAN_PALSU'
      ? 'Catatan progres (Laporan Palsu)'
      : 'Catatan progres';
  }
  if (entry.kind === 'assignment') {
    return 'Penugasan teknisi';
  }
  if (entry.kind === 'relation') {
    return 'Relasi laporan';
  }
  return entry.label;
}

function noteTextFrom(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const note = (value as Record<string, unknown>)['note'];
  return typeof note === 'string' && note !== '' ? note : null;
}

function workflowEntryDescription(entry: WorkflowTimelineEntry): string | undefined {
  if (entry.detail === null) {
    return undefined;
  }
  if (entry.kind === 'update') {
    const message = entry.detail['message'];
    return typeof message === 'string' && message !== '' ? message : undefined;
  }
  if (entry.kind === 'event') {
    return noteTextFrom(entry.detail['metadata']) ?? undefined;
  }
  return undefined;
}

function fallbackEventDescription(entry: AdminEventRow): string | undefined {
  return noteTextFrom(entry.metadata) ?? undefined;
}

const fieldLabelClasses = 'block text-sm font-medium text-text';
const fieldHintClasses = 'mt-1 text-xs text-muted';

function AdminWorkflow({
  ticket,
  report,
  options,
  fallbackEvents,
  onChanged,
}: {
  readonly ticket: string;
  readonly report: AdminReportRow;
  readonly options: FormOptions | null;
  readonly fallbackEvents: AdminEventRow[];
  readonly onChanged: () => void;
}) {
  const [conflict, setConflict] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [timeline, setTimeline] = useState<readonly WorkflowTimelineEntry[] | null>(null);
  const [technicians, setTechnicians] = useState<readonly TechnicianOption[] | null>(null);
  const [techFailed, setTechFailed] = useState(false);

  const [vCategory, setVCategory] = useState(report.finalCategoryId ?? report.submittedCategoryId);
  const [vIssueType, setVIssueType] = useState(
    report.finalIssueTypeId ?? report.submittedIssueTypeId ?? '',
  );
  const [vPriority, setVPriority] = useState(report.finalPriority ?? 'MEDIUM');
  const [assignTech, setAssignTech] = useState('');
  const [assignReason, setAssignReason] = useState('');
  const [transitionNote, setTransitionNote] = useState('');
  const [progressMessage, setProgressMessage] = useState('');
  const [progressIsFalseReport, setProgressIsFalseReport] = useState(false);

  const ref = encodeURIComponent(ticket);
  const actionBase = `/api/admin/reports/${ref}`;

  useEffect(() => {
    let cancelled = false;
    async function loadTimeline(): Promise<void> {
      try {
        const response = await fetch(`${actionBase}/timeline`, { credentials: 'include' });
        if (!response.ok) {
          if (!cancelled) {
            setTimeline(null);
          }
          return;
        }
        const data = (await response.json()) as { entries?: unknown };
        if (!cancelled) {
          setTimeline(
            Array.isArray(data.entries) ? (data.entries as WorkflowTimelineEntry[]) : null,
          );
        }
      } catch {
        if (!cancelled) {
          setTimeline(null);
        }
      }
    }
    async function loadTechnicians(): Promise<void> {
      try {
        const response = await fetch('/api/admin/technicians', { credentials: 'include' });
        if (!response.ok) {
          if (!cancelled) {
            setTechFailed(true);
          }
          return;
        }
        const rows = (await response.json()) as Array<{
          id?: unknown;
          displayName?: unknown;
          display_name?: unknown;
          technicianCode?: unknown;
          technician_code?: unknown;
        }>;
        if (!cancelled) {
          if (!Array.isArray(rows)) {
            setTechFailed(true);
            return;
          }
          setTechnicians(
            rows.flatMap((row) => {
              const displayName =
                typeof row.displayName === 'string'
                  ? row.displayName
                  : typeof row.display_name === 'string'
                    ? row.display_name
                    : null;
              const technicianCode =
                typeof row.technicianCode === 'string'
                  ? row.technicianCode
                  : typeof row.technician_code === 'string'
                    ? row.technician_code
                    : null;
              return typeof row.id === 'string' && displayName !== null && technicianCode !== null
                ? [{ id: row.id, displayName, technicianCode }]
                : [];
            }),
          );
        }
      } catch {
        if (!cancelled) {
          setTechFailed(true);
        }
      }
    }
    void loadTimeline();
    void loadTechnicians();
    return () => {
      cancelled = true;
    };
  }, [actionBase, refreshKey]);

  async function runAction(
    key: string,
    path: string,
    payload: Record<string, unknown>,
  ): Promise<boolean> {
    setBusy(key);
    setNotice(null);
    try {
      const result = await postWorkflowAction(path, {
        ...payload,
        expectedVersion: report.version,
      });
      if (result.status === 409) {
        setConflict(true);
        return false;
      }
      if (!result.ok) {
        setNotice(workflowErrorMessage(result.body, `Aksi gagal (${result.status}).`));
        return false;
      }
      setConflict(false);
      setRefreshKey((value) => value + 1);
      onChanged();
      return true;
    } catch {
      setNotice('Aksi gagal. Periksa koneksi Anda lalu coba lagi.');
      return false;
    } finally {
      setBusy(null);
    }
  }

  const technicianNames = new Map((technicians ?? []).map((t) => [t.id, t.displayName] as const));
  const currentTechId = currentTechnicianOf(timeline);
  const nextStatuses = validNextStatuses(report.status);

  return (
    <>
      {conflict ? (
        <div className="mt-4" role="alert">
          <ErrorPanel
            message="Laporan diubah admin lain — muat ulang"
            retry={
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setConflict(false);
                  setRefreshKey((value) => value + 1);
                  onChanged();
                }}
              >
                Muat ulang
              </Button>
            }
          />
        </div>
      ) : null}

      {notice !== null ? (
        <div className="mt-4" role="alert">
          <ErrorPanel message={notice} />
        </div>
      ) : null}

      {report.status === 'REPORTED' && report.finalCategoryId === null ? (
        <section
          aria-labelledby="admin-verify-title"
          className="mt-4 rounded-md border border-border bg-surface p-4"
        >
          <h2 id="admin-verify-title" className="text-base font-semibold text-text">
            Verifikasi manual laporan tertahan
          </h2>
          <p className="mt-1 text-sm text-muted">
            Hanya untuk laporan yang ditahan karena layanan AI tidak tersedia. Hasil AI normal tidak
            dapat diubah di sini.
          </p>
          <div className="mt-3 flex flex-col gap-3">
            <label className={fieldLabelClasses}>
              Kategori final
              <Select
                className="mt-1"
                value={vCategory}
                onChange={(event) => setVCategory(event.target.value)}
              >
                {(options?.categories ?? []).map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </Select>
            </label>
            <label className={fieldLabelClasses}>
              Jenis masalah final
              <Select
                className="mt-1"
                value={vIssueType}
                onChange={(event) => setVIssueType(event.target.value)}
              >
                <option value="">— Pilih —</option>
                {(options?.issueTypes ?? []).map((issueType) => (
                  <option key={issueType.id} value={issueType.id}>
                    {issueType.name}
                  </option>
                ))}
              </Select>
            </label>
            <fieldset>
              <legend className={fieldLabelClasses}>Prioritas final</legend>
              <div className="mt-1 flex gap-4">
                {['LOW', 'MEDIUM', 'HIGH'].map((level) => (
                  <label key={level} className="flex items-center gap-1 text-sm text-text">
                    <input
                      type="radio"
                      name="verify-priority"
                      value={level}
                      checked={vPriority === level}
                      onChange={() => setVPriority(level)}
                    />
                    {level}
                  </label>
                ))}
              </div>
            </fieldset>
            <div>
              <Button
                type="button"
                disabled={busy !== null || vIssueType === ''}
                onClick={() =>
                  void runAction(`${actionBase}/verify`, `${actionBase}/verify`, {
                    finalCategoryId: vCategory,
                    finalIssueTypeId: vIssueType,
                    finalPriority: vPriority,
                  })
                }
              >
                {busy === `${actionBase}/verify` ? 'Memverifikasi…' : 'Verifikasi'}
              </Button>
            </div>
          </div>
        </section>
      ) : null}

      <section
        aria-labelledby="admin-assign-title"
        className="mt-4 rounded-md border border-border bg-surface p-4"
      >
        <h2 id="admin-assign-title" className="text-base font-semibold text-text">
          Penugasan teknisi
        </h2>
        <p className="mt-1 text-sm text-text">
          Teknisi saat ini:{' '}
          {currentTechId === null
            ? '—'
            : (technicianNames.get(currentTechId) ?? 'Teknisi ditugaskan')}
        </p>
        <div className="mt-3 flex flex-col gap-3">
          <label className={fieldLabelClasses}>
            Teknisi
            <Select
              className="mt-1"
              value={assignTech}
              onChange={(event) => setAssignTech(event.target.value)}
            >
              <option value="">— Pilih teknisi —</option>
              {(technicians ?? []).map((technician) => (
                <option key={technician.id} value={technician.id}>
                  {technician.displayName} ({technician.technicianCode})
                </option>
              ))}
            </Select>
            {techFailed ? (
              <span className={fieldHintClasses}>Gagal memuat daftar teknisi.</span>
            ) : null}
          </label>
          <label className={fieldLabelClasses}>
            Alasan (opsional)
            <Textarea
              className="mt-1"
              rows={2}
              value={assignReason}
              onChange={(event) => setAssignReason(event.target.value)}
            />
          </label>
          <div>
            <Button
              type="button"
              variant="secondary"
              disabled={busy !== null || assignTech === ''}
              onClick={() =>
                void runAction(`${actionBase}/assign`, `${actionBase}/assign`, {
                  technicianId: assignTech,
                  reason: assignReason === '' ? null : assignReason,
                })
              }
            >
              {busy === `${actionBase}/assign` ? 'Menugaskan…' : 'Tugaskan'}
            </Button>
          </div>
        </div>
      </section>

      <section
        aria-labelledby="admin-transition-title"
        className="mt-4 rounded-md border border-border bg-surface p-4"
      >
        <h2 id="admin-transition-title" className="text-base font-semibold text-text">
          Ubah status
        </h2>
        {nextStatuses.length === 0 ? (
          <p className="mt-1 text-sm text-muted">Status terminal — tidak ada transisi lanjutan.</p>
        ) : (
          <div className="mt-3 flex flex-col gap-3">
            <label className={fieldLabelClasses}>
              Catatan
              <Textarea
                className="mt-1"
                rows={2}
                value={transitionNote}
                onChange={(event) => setTransitionNote(event.target.value)}
                placeholder="Wajib untuk inspeksi, perbaikan, penyelesaian, dan pembukaan ulang"
              />
            </label>
            <div className="flex flex-wrap gap-2">
              {nextStatuses.map((target) => {
                const noteRequired = noteRequiredFor(report.status, target);
                const key = `${actionBase}/transition:${target}`;
                return (
                  <Button
                    key={target}
                    type="button"
                    variant={
                      TERMINAL_CONFIRM_STATUSES.includes(target) ? 'destructive' : 'secondary'
                    }
                    disabled={busy !== null}
                    onClick={() => {
                      if (
                        TERMINAL_CONFIRM_STATUSES.includes(target) &&
                        !window.confirm(`Ubah status ke ${target}?`)
                      ) {
                        return;
                      }
                      void runAction(key, `${actionBase}/transition`, {
                        nextStatus: target,
                        note: transitionNote === '' ? null : transitionNote,
                      });
                    }}
                  >
                    {busy === key ? 'Memproses…' : `${target}${noteRequired ? ' *' : ''}`}
                  </Button>
                );
              })}
            </div>
            <p className={fieldHintClasses}>Tanda * = catatan wajib (min 5 karakter).</p>
          </div>
        )}
      </section>

      <section
        aria-labelledby="admin-updates-title"
        className="mt-4 rounded-md border border-border bg-surface p-4"
      >
        <h2 id="admin-updates-title" className="text-base font-semibold text-text">
          Catatan progres
        </h2>
        <p className="mt-1 text-sm text-muted">
          Catatan ini terlihat oleh pelapor. Kondisi Laporan Palsu ditampilkan netral untuk pelapor.
        </p>
        <div className="mt-3 flex flex-col gap-3">
          <label className={fieldLabelClasses}>
            Catatan
            <Textarea
              className="mt-1"
              rows={3}
              value={progressMessage}
              onChange={(event) => setProgressMessage(event.target.value)}
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-text">
            <input
              type="checkbox"
              checked={progressIsFalseReport}
              onChange={(event) => setProgressIsFalseReport(event.target.checked)}
            />
            Tandai sebagai Laporan Palsu
          </label>
          <div>
            <Button
              type="button"
              variant="secondary"
              disabled={busy !== null || progressMessage.trim() === ''}
              onClick={() => {
                void (async () => {
                  const ok = await runAction(
                    `${actionBase}/updates:progress`,
                    `${actionBase}/updates`,
                    {
                      message: progressMessage.trim(),
                      condition: progressIsFalseReport ? 'LAPORAN_PALSU' : null,
                    },
                  );
                  if (ok) {
                    setProgressMessage('');
                    setProgressIsFalseReport(false);
                  }
                })();
              }}
            >
              {busy === `${actionBase}/updates:progress` ? 'Menyimpan…' : 'Simpan catatan progres'}
            </Button>
          </div>
        </div>
      </section>

      <section aria-labelledby="admin-detail-timeline-title" className="mt-6">
        <h2 id="admin-detail-timeline-title" className="text-lg font-semibold text-text">
          Riwayat laporan
        </h2>
        {timeline === null && fallbackEvents.length === 0 ? (
          <p className="mt-2 text-sm text-muted">Belum ada riwayat.</p>
        ) : null}
        {timeline !== null ? (
          timeline.length === 0 ? (
            <p className="mt-2 text-sm text-muted">Belum ada riwayat.</p>
          ) : (
            <div className="mt-3">
              <Timeline
                items={timeline.map((entry) => ({
                  id: entry.id,
                  label: workflowEntryLabel(entry),
                  description: workflowEntryDescription(entry),
                  timestamp: formatDateTime(entry.at),
                }))}
              />
            </div>
          )
        ) : fallbackEvents.length > 0 ? (
          <div className="mt-3">
            <Timeline
              items={fallbackEvents.map((entry, index) => ({
                id: `${entry.createdAt}-${index}`,
                label: eventLabel(entryType(entry)),
                description: fallbackEventDescription(entry),
                timestamp: formatDateTime(entry.createdAt),
              }))}
            />
          </div>
        ) : null}
      </section>
    </>
  );
}

function factorNumber(value: unknown, key: string): number | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const factor = (value as Record<string, unknown>)[key];
  return typeof factor === 'number' && Number.isFinite(factor) ? factor : null;
}

function scoringComplete(value: unknown): boolean | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const flag = (value as Record<string, unknown>)['scoringComplete'];
  return typeof flag === 'boolean' ? flag : null;
}

export function AdminAiPanel({
  report,
  analysis,
  categoryNames,
  issueTypeNames,
}: {
  readonly report: AdminReportRow;
  readonly analysis: AdminAiAnalysisRow | null | undefined;
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

function AdminReportDetailPage() {
  const loaderData = Route.useLoaderData() as AdminDetailLoaderData;
  const { ticket } = Route.useParams() as { ticket: string };
  const navigate = useNavigate();
  const router = useRouter();

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

  const locationNames = new Map((options?.locations ?? []).map((l) => [l.id, l.name] as const));
  const categoryNames = new Map((options?.categories ?? []).map((c) => [c.id, c.name] as const));
  const issueTypeNames = new Map((options?.issueTypes ?? []).map((i) => [i.id, i.name] as const));
  const assetNames = new Map((options?.assets ?? []).map((a) => [a.id, a.name] as const));

  return (
    <section aria-labelledby="admin-report-detail-title" className="max-w-3xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 id="admin-report-detail-title" className="text-2xl font-semibold text-text">
          Detail Laporan
        </h1>
        <Link
          to="/admin/reports"
          search={{
            search: '',
            status: '',
            categoryId: '',
            locationId: '',
            priority: '',
            reporterId: '',
            from: '',
            to: '',
            sort: 'reported_desc',
            offset: 0,
          }}
          className={`${buttonBaseClasses} ${buttonVariantClasses.secondary}`}
        >
          Semua laporan
        </Link>
      </div>

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
        <>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <TicketMono className="text-xl font-medium text-text">
              {detail.report.ticketNumber}
            </TicketMono>
            <StatusBadge status={detail.report.status} />
            <StatusBadge priority={detail.report.finalPriority} />
          </div>

          <div className="mt-4 rounded-md border border-border bg-surface px-4 md:px-6">
            <dl className="divide-y divide-border">
              <div className="flex flex-col gap-1 py-3 sm:flex-row sm:gap-4">
                <dt className="shrink-0 text-sm font-medium text-muted sm:w-40">Nomor tiket</dt>
                <dd className="text-sm text-text">
                  <TicketMono>{detail.report.ticketNumber}</TicketMono>
                </dd>
              </div>
              <div className="flex flex-col gap-1 py-3 sm:flex-row sm:gap-4">
                <dt className="shrink-0 text-sm font-medium text-muted sm:w-40">Status</dt>
                <dd className="text-sm text-text">
                  <StatusBadge status={detail.report.status} />
                </dd>
              </div>
              <div className="flex flex-col gap-1 py-3 sm:flex-row sm:gap-4">
                <dt className="shrink-0 text-sm font-medium text-muted sm:w-40">Prioritas</dt>
                <dd className="text-sm text-text">
                  <StatusBadge priority={detail.report.finalPriority} />
                </dd>
              </div>
              <div className="flex flex-col gap-1 py-3 sm:flex-row sm:gap-4">
                <dt className="shrink-0 text-sm font-medium text-muted sm:w-40">ID Pelapor</dt>
                <dd className="text-sm text-text">{detail.report.reporterId}</dd>
              </div>
              <div className="flex flex-col gap-1 py-3 sm:flex-row sm:gap-4">
                <dt className="shrink-0 text-sm font-medium text-muted sm:w-40">
                  Kategori diajukan
                </dt>
                <dd className="text-sm text-text">
                  {categoryNames.get(detail.report.submittedCategoryId) ??
                    detail.report.submittedCategoryId}
                </dd>
              </div>
              <div className="flex flex-col gap-1 py-3 sm:flex-row sm:gap-4">
                <dt className="shrink-0 text-sm font-medium text-muted sm:w-40">Kategori final</dt>
                <dd className="text-sm text-text">
                  {detail.report.finalCategoryId === null
                    ? '—'
                    : (categoryNames.get(detail.report.finalCategoryId) ??
                      detail.report.finalCategoryId)}
                </dd>
              </div>
              <div className="flex flex-col gap-1 py-3 sm:flex-row sm:gap-4">
                <dt className="shrink-0 text-sm font-medium text-muted sm:w-40">
                  Jenis masalah diajukan
                </dt>
                <dd className="text-sm text-text">
                  {detail.report.submittedIssueTypeId === null
                    ? '—'
                    : (issueTypeNames.get(detail.report.submittedIssueTypeId) ??
                      detail.report.submittedIssueTypeId)}
                </dd>
              </div>
              <div className="flex flex-col gap-1 py-3 sm:flex-row sm:gap-4">
                <dt className="shrink-0 text-sm font-medium text-muted sm:w-40">
                  Jenis masalah final
                </dt>
                <dd className="text-sm text-text">
                  {detail.report.finalIssueTypeId === null
                    ? '—'
                    : (issueTypeNames.get(detail.report.finalIssueTypeId) ??
                      detail.report.finalIssueTypeId)}
                </dd>
              </div>
              <div className="flex flex-col gap-1 py-3 sm:flex-row sm:gap-4">
                <dt className="shrink-0 text-sm font-medium text-muted sm:w-40">Lokasi</dt>
                <dd className="text-sm text-text">
                  {locationNames.get(detail.report.locationId) ?? detail.report.locationId}
                </dd>
              </div>
              <div className="flex flex-col gap-1 py-3 sm:flex-row sm:gap-4">
                <dt className="shrink-0 text-sm font-medium text-muted sm:w-40">Asset</dt>
                <dd className="text-sm text-text">
                  {detail.report.assetId === null
                    ? 'Tanpa asset'
                    : (assetNames.get(detail.report.assetId) ?? detail.report.assetId)}
                </dd>
              </div>
              <div className="flex flex-col gap-1 py-3 sm:flex-row sm:gap-4">
                <dt className="shrink-0 text-sm font-medium text-muted sm:w-40">Deskripsi</dt>
                <dd className="text-pretty text-sm break-words whitespace-pre-wrap text-text">
                  {detail.report.description}
                </dd>
              </div>
              <div className="flex flex-col gap-1 py-3 sm:flex-row sm:gap-4">
                <dt className="shrink-0 text-sm font-medium text-muted sm:w-40">Waktu kejadian</dt>
                <dd className="text-sm text-text">
                  <TicketMono>{formatDateTime(detail.report.occurredAt)}</TicketMono>
                </dd>
              </div>
              <div className="flex flex-col gap-1 py-3 sm:flex-row sm:gap-4">
                <dt className="shrink-0 text-sm font-medium text-muted sm:w-40">Waktu lapor</dt>
                <dd className="text-sm text-text">
                  <TicketMono>{formatDateTime(detail.report.reportedAt)}</TicketMono>
                </dd>
              </div>
              <div className="flex flex-col gap-1 py-3 sm:flex-row sm:gap-4">
                <dt className="shrink-0 text-sm font-medium text-muted sm:w-40">
                  Waktu verifikasi
                </dt>
                <dd className="text-sm text-text">
                  <TicketMono>{formatDateTime(detail.report.verifiedAt)}</TicketMono>
                </dd>
              </div>
              <div className="flex flex-col gap-1 py-3 sm:flex-row sm:gap-4">
                <dt className="shrink-0 text-sm font-medium text-muted sm:w-40">Waktu selesai</dt>
                <dd className="text-sm text-text">
                  <TicketMono>{formatDateTime(detail.report.resolvedAt)}</TicketMono>
                </dd>
              </div>
              <div className="flex flex-col gap-1 py-3 sm:flex-row sm:gap-4">
                <dt className="shrink-0 text-sm font-medium text-muted sm:w-40">Waktu tutup</dt>
                <dd className="text-sm text-text">
                  <TicketMono>{formatDateTime(detail.report.closedAt)}</TicketMono>
                </dd>
              </div>
              <div className="flex flex-col gap-1 py-3 sm:flex-row sm:gap-4">
                <dt className="shrink-0 text-sm font-medium text-muted sm:w-40">Versi</dt>
                <dd className="text-sm text-text">{detail.report.version}</dd>
              </div>
            </dl>
          </div>

          <AdminAiPanel
            report={detail.report}
            analysis={detail.aiAnalysis}
            categoryNames={categoryNames}
            issueTypeNames={issueTypeNames}
          />

          <AdminWorkflow
            ticket={detail.report.ticketNumber}
            report={detail.report}
            options={options}
            fallbackEvents={detail.events}
            onChanged={() => void router.invalidate()}
          />

          {detail.duplicateCandidates.length > 0 ? (
            <section
              aria-labelledby="admin-detail-duplicate-title"
              className="mt-4 rounded-md border border-warning bg-tint-warning p-4"
            >
              <h2 id="admin-detail-duplicate-title" className="text-base font-semibold text-text">
                Laporan serupa ditemukan
              </h2>
              <p className="mt-1 text-sm text-text">
                Laporan berikut tampak mirip dengan laporan ini.
              </p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {detail.duplicateCandidates.map((candidate) => (
                  <li key={candidate.id}>
                    <Link
                      to="/admin/reports/$ticket"
                      params={{ ticket: candidate.ticketNumber }}
                      className="text-accent underline underline-offset-2"
                    >
                      <TicketMono>{candidate.ticketNumber}</TicketMono>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {detail.relations.length > 0 ? (
            <section
              aria-labelledby="admin-detail-relations-title"
              className="mt-4 rounded-md border border-border bg-surface p-4"
            >
              <h2 id="admin-detail-relations-title" className="text-base font-semibold text-text">
                Relasi laporan
              </h2>
              <ul className="mt-2 flex flex-col gap-2">
                {detail.relations.map((relation) => {
                  const otherId =
                    relation.sourceReportId === detail.report.id
                      ? relation.targetReportId
                      : relation.sourceReportId;
                  return (
                    <li key={relation.id} className="text-sm text-text">
                      {relation.relationType}{' '}
                      <Link
                        to="/admin/reports/$ticket"
                        params={{ ticket: otherId }}
                        className="text-accent underline underline-offset-2"
                      >
                        <TicketMono>{otherId}</TicketMono>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          <section
            aria-labelledby="admin-detail-attachments-title"
            className="mt-4 rounded-md border border-border bg-surface p-4"
          >
            <h2 id="admin-detail-attachments-title" className="text-base font-semibold text-text">
              Lampiran
            </h2>
            {detail.attachments.length === 0 ? (
              <p className="mt-1 text-sm text-muted">Tidak ada lampiran.</p>
            ) : (
              <AttachmentGallery
                ticketRef={detail.report.ticketNumber}
                attachments={detail.attachments}
              />
            )}
          </section>
        </>
      ) : null}
    </section>
  );
}
