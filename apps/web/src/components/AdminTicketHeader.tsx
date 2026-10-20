// Admin "Detail Tiket" header + stepper (Figma 150:933). Pure UI.
import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import type { ReportStatus } from '@silapor/domain';
import { deriveStatusTimestamps, flowIndexOf, formatJakartaShort } from '../lib/ticket-detail.js';
import { ADMIN_STEP_LABELS, ADMIN_STEP_SUBLABELS, adminPriorityHero, adminStatusPill } from '../lib/admin-ticket-detail.js';
import { Button, TicketMono } from './index.js';

export interface AdminTicketHeaderProps {
  readonly ticketNumber: string;
  readonly status: string;
  readonly priority: string | null;
  readonly priorityScore: number | null;
  readonly onAddNote: () => void;
  readonly onResolve: (() => void) | null;
  /** Breadcrumb link; null in unit tests (router context unavailable). */
  readonly breadcrumb?: ReactNode | null;
}

export function AdminTicketHeader(props: AdminTicketHeaderProps) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-xs text-muted">
          {props.breadcrumb === undefined ? (
            <>
              <Link to="/admin/reports" className="underline underline-offset-2 hover:text-text">
                Kelola Laporan
              </Link>{' '}
              › Detail Tiket
            </>
          ) : (
            (props.breadcrumb ?? 'Detail Tiket')
          )}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <TicketMono className="text-xl font-semibold text-text sm:text-2xl">
            #{props.ticketNumber}
          </TicketMono>
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${adminStatusPill(props.status)}`}>
            <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-current" />
            {props.status}
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-full bg-tint-danger px-2.5 py-1 text-xs font-semibold text-badge-danger">
            {adminPriorityHero(props.priority, props.priorityScore)}
          </span>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2" data-print="hide">
        <Button type="button" variant="secondary" onClick={props.onAddNote}>
          Tambah Catatan Progres
        </Button>
        {props.onResolve === null ? null : (
          <Button type="button" variant="primary" onClick={props.onResolve}>
            Konfirmasi Penyelesaian
          </Button>
        )}
      </div>
    </div>
  );
}

export interface AdminTicketStepReport {
  readonly reportedAt: string;
  readonly verifiedAt: string | null;
  readonly resolvedAt: string | null;
  readonly closedAt: string | null;
}

export function AdminTicketStepper(props: {
  readonly status: string;
  readonly report: AdminTicketStepReport;
  readonly events: readonly { readonly eventType?: unknown; readonly type?: unknown; readonly createdAt?: unknown; readonly at?: unknown; readonly toValue?: unknown }[];
}) {
  const timestamps = deriveStatusTimestamps(props.report, props.events);
  const currentIndex = flowIndexOf(props.status);
  const steps: readonly ReportStatus[] = ['REPORTED','VERIFIED','ASSIGNED','INSPECTION','IN_REPAIR','RESOLVED','CLOSED'];
  return (
    <div className="mt-4 overflow-x-auto pb-1">
      <ol aria-label="Alur status penanganan" className="grid min-w-[760px] grid-cols-7 gap-0">
        {steps.map((step, index) => {
          const reachedAt = timestamps[step] ?? null;
          const isDone = currentIndex >= 0 && index < currentIndex;
          const isCurrent = currentIndex >= 0 && index === currentIndex;
          return (
            <li key={step} className="relative flex flex-col items-center px-1 text-center">
              {index === 0 ? null : (
                <span aria-hidden="true" className={`absolute top-4 right-1/2 h-0.5 w-full -translate-y-1/2 ${currentIndex >= 0 && index <= currentIndex ? 'bg-accent' : 'bg-border'}`} />
              )}
              <span aria-hidden="true" className={`relative z-10 flex h-8 w-8 items-center justify-center rounded-full border-2 text-xs font-semibold ${isDone || isCurrent ? 'border-accent bg-accent text-accent-contrast' : 'border-border bg-surface text-muted'} ${isCurrent ? 'ring-4 ring-tint-info' : ''}`}>
                {isDone ? (
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 12 4.5 4.5L19 7" /></svg>
                ) : isCurrent ? (<span className="h-2.5 w-2.5 rounded-full bg-current" />) : (<span>{index + 1}</span>)}
              </span>
              <span className="mt-2 block font-mono text-[11px] font-semibold tracking-wide text-text uppercase">{ADMIN_STEP_LABELS[step] ?? step}</span>
              <span className="mt-0.5 block text-[11px] text-muted">{reachedAt === null ? (ADMIN_STEP_SUBLABELS[step] ?? '') : formatJakartaShort(reachedAt)}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
