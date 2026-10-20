// Admin "Detail Tiket" history tab (Figma 150:933 "Riwayat").
//
// Membaca TimelineEntry modern (kind/at/label/detail dari
// /api/admin/reports/:id/timeline) dengan fallback bentuk legacy
// (eventType/createdAt/metadata) saat fetch gagal. Pola label/badge/aktor
// mengikuti halaman reporter (report-helpers + ticket-detail).
import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import {
  historyActorOf,
  historyConditionOf,
  historyLabelOf,
  historyNoteOf,
  historyStatusOf,
  historyTechnicianIdOf,
  historyTimestampOf,
  relationTypeLabel,
  type HistoryEntryLike,
} from '../lib/admin-history.js';
import { formatJakartaDateTime } from '../lib/ticket-detail.js';
import {
  EmptyState,
  ErrorPanel,
  InfoIcon,
  LoadingState,
  StatusBadge,
  TicketMono,
  Timeline,
} from './index.js';

interface TechnicianName {
  readonly id: string;
  readonly displayName: string;
}

function parseTechnicians(value: unknown): TechnicianName[] {
  if (!Array.isArray(value)) return [];
  const out: TechnicianName[] = [];
  for (const item of value) {
    if (item === null || typeof item !== 'object') continue;
    const r = item as Record<string, unknown>;
    if (typeof r['id'] !== 'string') continue;
    if (typeof r['displayName'] !== 'string') continue;
    out.push({ id: r['id'] as string, displayName: r['displayName'] as string });
  }
  return out;
}

function parseEntries(value: unknown): HistoryEntryLike[] | null {
  if (!Array.isArray(value)) return null;
  return value as HistoryEntryLike[];
}

export function AdminTicketHistoryTab(props: {
  readonly ticket: string;
  readonly reportId: string | null;
  readonly events: readonly HistoryEntryLike[];
  readonly relations: readonly {
    readonly id: string;
    readonly sourceReportId: string;
    readonly targetReportId: string;
    readonly relationType: string;
  }[];
  readonly duplicates: readonly { readonly id: string; readonly ticketNumber: string }[];
}) {
  const [entries, setEntries] = useState<readonly HistoryEntryLike[] | null>(null);
  const [pending, setPending] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [techNames, setTechNames] = useState<ReadonlyMap<string, string> | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPending(true);
    setError(null);
    void (async () => {
      try {
        const res = await fetch(
          `/api/admin/reports/${encodeURIComponent(props.ticket)}/timeline`,
          { credentials: 'include' },
        );
        if (cancelled) return;
        if (!res.ok) {
          setEntries(props.events);
          setPending(false);
          return;
        }
        try {
          const data = (await res.json()) as { entries?: unknown };
          setEntries(parseEntries(data.entries) ?? props.events);
        } catch {
          setEntries(props.events);
        }
        setPending(false);
      } catch {
        if (cancelled) return;
        setError('Gagal memuat riwayat. Menampilkan data ringkas.');
        setEntries(props.events);
        setPending(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [props.ticket]);

  // Nama teknisi untuk entry assignment (UUID opaque -> displayName).
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/admin/technicians?includeInactive=true&limit=200', {
          credentials: 'include',
        });
        if (cancelled || !res.ok) return;
        try {
          const rows = parseTechnicians(await res.json());
          if (!cancelled) setTechNames(new Map(rows.map((r) => [r.id, r.displayName])));
        } catch {
          if (!cancelled) setTechNames(new Map());
        }
      } catch {
        if (!cancelled) setTechNames(new Map());
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (pending) return <LoadingState message="Memuat riwayat…" />;

  const source = (entries ?? props.events).slice().reverse();
  const items = source.map((entry, index) => {
    const rawTs = historyTimestampOf(entry);
    const status = historyStatusOf(entry);
    const note = historyNoteOf(entry);
    const condition = historyConditionOf(entry);
    const techId = historyTechnicianIdOf(entry);
    const techName = techId === null ? null : (techNames?.get(techId) ?? null);
    const descriptionParts: string[] = [];
    if (techName !== null) descriptionParts.push('Teknisi: ' + techName);
    else if (techId !== null) descriptionParts.push('Teknisi: ' + techId);
    if (note !== null) descriptionParts.push(note);
    if (condition === 'LAPORAN_PALSU') descriptionParts.push('Kondisi: LAPORAN_PALSU');

    return {
      id: `${typeof entry.id === 'string' ? entry.id : rawTs}-${index}`,
      timestamp: rawTs === '' ? '—' : formatJakartaDateTime(rawTs),
      label: historyLabelOf(entry),
      badge: status === null ? undefined : <StatusBadge status={status} />,
      actor: historyActorOf(entry),
      description:
        descriptionParts.length === 0 ? undefined : (
          <span className="mt-1.5 block rounded-md bg-background px-3 py-2 text-sm text-pretty break-words text-text">
            {descriptionParts.join('\n')}
          </span>
        ),
    };
  });

  return (
    <div className="grid grid-cols-1 gap-4">
      <section
        aria-labelledby="admin-history-title"
        className="rounded-xl border border-border bg-surface p-5 shadow-sm"
      >
        <h2 id="admin-history-title" className="text-base font-semibold text-text">
          Linimasa Penanganan
        </h2>
        <p className="mt-1 text-xs text-muted">
          {items.length === 0
            ? 'Belum ada aktivitas tercatat untuk tiket ini.'
            : `${items.length} aktivitas tercatat, terbaru di atas.`}
        </p>
        {error === null ? null : (
          <div className="mt-2">
            <ErrorPanel message={error} />
          </div>
        )}
        <div className="mt-3">
          {items.length === 0 ? (
            <EmptyState
              title="Belum ada riwayat"
              description="Aktivitas penanganan (verifikasi, penugasan, catatan, transisi) akan tampil di sini."
            />
          ) : (
            <Timeline items={items} />
          )}
        </div>
        <p className="mt-3 flex items-start gap-2 border-t border-border pt-3 text-xs text-muted">
          <InfoIcon className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>Seluruh waktu ditampilkan dalam Waktu Indonesia Barat (WIB).</span>
        </p>
      </section>
      <RelationsCard
        reportId={props.reportId}
        relations={props.relations}
        duplicates={props.duplicates}
      />
    </div>
  );
}

function RelationsCard(props: {
  readonly reportId: string | null;
  readonly relations: readonly {
    readonly id: string;
    readonly sourceReportId: string;
    readonly targetReportId: string;
    readonly relationType: string;
  }[];
  readonly duplicates: readonly { readonly id: string; readonly ticketNumber: string }[];
}) {
  // UUID lawan relasi (bukan nomor tiket — backend tidak mengirimnya di sini).
  // Dibandingkan dengan reportId (UUID), bukan nomor tiket, supaya tidak salah.
  const relationRows = props.relations.map((relation) => {
    const mine = props.reportId;
    const otherId =
      mine !== null && relation.sourceReportId === mine
        ? relation.targetReportId
        : relation.sourceReportId;
    return { ...relation, otherId };
  });

  if (relationRows.length === 0 && props.duplicates.length === 0) return null;

  return (
    <section
      aria-labelledby="admin-relations-title"
      className="rounded-xl border border-border bg-surface p-5 shadow-sm"
    >
      <h2 id="admin-relations-title" className="text-base font-semibold text-text">
        Relasi &amp; Laporan Serupa
      </h2>
      {props.duplicates.length > 0 ? (
        <ul className="mt-2 flex flex-wrap gap-2">
          {props.duplicates.map((candidate) => (
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
      ) : null}
      {relationRows.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-2">
          {relationRows.map((relation) => (
            <li key={relation.id} className="text-sm text-text">
              Laporan {relationTypeLabel(relation.relationType).toLowerCase()}{' '}
              <TicketMono>{relation.otherId}</TicketMono>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

