// Admin "Detail Tiket" history tab (Figma 150:933 "Riwayat").
import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { eventLabel } from '../lib/report-helpers.js';
import { formatJakartaDateTime } from '../lib/ticket-detail.js';
import { ErrorPanel, LoadingState, StatusBadge, TicketMono, Timeline } from './index.js';

interface HistoryEventLike {
  readonly eventType?: unknown;
  readonly type?: unknown;
  readonly createdAt: string;
  readonly metadata?: unknown;
  readonly detail?: unknown;
}

function payloadOf(entry: HistoryEventLike): Record<string, unknown> | null {
  if (entry.detail !== null && typeof entry.detail === 'object') return entry.detail as Record<string, unknown>;
  if (entry.metadata !== null && typeof entry.metadata === 'object') return entry.metadata as Record<string, unknown>;
  return null;
}

function historyText(entry: HistoryEventLike): string | null {
  const payload = payloadOf(entry);
  if (payload === null) return null;
  for (const key of ['note', 'message', 'reason', 'detail']) {
    const value = payload[key];
    if (typeof value === 'string' && value.trim() !== '') return value;
  }
  return null;
}

function historyStatus(entry: HistoryEventLike): string | null {
  const payload = payloadOf(entry);
  const direct = entry.type ?? entry.eventType;
  const candidates: unknown[] = [direct];
  if (payload !== null) candidates.push(payload['toValue'], payload['toStatus'], payload['status'], payload['nextStatus']);
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate !== '') return candidate;
  }
  return null;
}

export function AdminTicketHistoryTab(props: {
  readonly ticket: string;
  readonly events: readonly HistoryEventLike[];
  readonly relations: readonly { readonly id: string; readonly sourceReportId: string; readonly targetReportId: string; readonly relationType: string }[];
  readonly duplicates: readonly { readonly id: string; readonly ticketNumber: string }[];
}) {
  const [entries, setEntries] = useState<readonly HistoryEventLike[] | null>(null);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPending(true); setError(null);
    void (async () => {
      try {
        const response = await fetch(`/api/admin/reports/${encodeURIComponent(props.ticket)}/timeline`, { credentials: 'include' });
        if (cancelled) return;
        if (!response.ok) { setEntries(props.events); setPending(false); return; }
        const data = (await response.json()) as { entries?: unknown };
        setEntries(Array.isArray(data.entries) ? (data.entries as HistoryEventLike[]) : props.events);
        setPending(false);
      } catch {
        if (cancelled) return;
        setError('Gagal memuat riwayat. Menampilkan data ringkas.');
        setEntries(props.events); setPending(false);
      }
    })();
    return () => { cancelled = true; };
  }, [props.ticket]);

  if (pending) return <LoadingState message="Memuat riwayat…" />;

  const items = (entries ?? props.events).slice().reverse().map((entry, index) => ({
    id: `${entry.createdAt}-${index}`,
    timestamp: formatJakartaDateTime(entry.createdAt),
    label: eventLabel(typeof entry.eventType === 'string' ? entry.eventType : (typeof entry.type === 'string' ? entry.type : '')),
    badge: (() => {
      const badgeStatus = historyStatus(entry);
      return badgeStatus === null ? undefined : <StatusBadge status={badgeStatus} />;
    })(),
    description: (() => {
      const text = historyText(entry);
      return text === null ? undefined : (<span className="mt-1.5 block rounded-md bg-background px-3 py-2 text-sm text-pretty break-words text-text">{text}</span>);
    })(),
  }));

  return (
    <div className="grid grid-cols-1 gap-4">
      <section aria-labelledby="admin-history-title" className="rounded-xl border border-border bg-surface p-5 shadow-sm">
        <h2 id="admin-history-title" className="text-base font-semibold text-text">Linimasa Penanganan</h2>
        {error === null ? null : (<div className="mt-2"><ErrorPanel message={error} /></div>)}
        <div className="mt-3"><Timeline items={items} /></div>
      </section>
      {props.relations.length === 0 && props.duplicates.length === 0 ? null : (
        <section aria-labelledby="admin-relations-title" className="rounded-xl border border-border bg-surface p-5 shadow-sm">
          <h2 id="admin-relations-title" className="text-base font-semibold text-text">Relasi &amp; Laporan Serupa</h2>
          {props.duplicates.length > 0 ? (
            <ul className="mt-2 flex flex-wrap gap-2">
              {props.duplicates.map((candidate) => (
                <li key={candidate.id}>
                  <Link to="/admin/reports/$ticket" params={{ ticket: candidate.ticketNumber }} className="text-accent underline underline-offset-2">
                    <TicketMono>{candidate.ticketNumber}</TicketMono>
                  </Link>
                </li>
              ))}
            </ul>
          ) : null}
          {props.relations.length > 0 ? (
            <ul className="mt-2 flex flex-col gap-2">
              {props.relations.map((relation) => (
                <li key={relation.id} className="text-sm text-text">{relation.relationType} <TicketMono>{relation.sourceReportId === props.ticket ? relation.targetReportId : relation.sourceReportId}</TicketMono></li>
              ))}
            </ul>
          ) : null}
        </section>
      )}
    </div>
  );
}
