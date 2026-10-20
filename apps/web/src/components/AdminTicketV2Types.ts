// Admin "Detail Tiket" v2 shared shapes + related-report extractor.
import type { FormOptions } from '../server/reports.js';

export interface AdminTicketV2Attachment {
  readonly id: string;
  readonly originalFilename: string;
}

export interface AdminTicketV2Event {
  readonly eventType?: unknown;
  readonly type?: unknown;
  readonly createdAt: string;
  readonly metadata?: unknown;
  readonly detail?: unknown;
}

export interface AdminTicketV2Report {
  readonly id: string;
  readonly ticketNumber: string;
  readonly status: string;
  readonly assetId: string | null;
  readonly locationId: string;
  readonly finalCategoryId: string | null;
  readonly finalIssueTypeId: string | null;
  readonly finalPriority: string | null;
  readonly priorityScore: number | null;
  readonly priorityFactors: unknown;
  readonly description: string;
  readonly version: number;
  readonly reportedAt: string;
  readonly verifiedAt: string | null;
  readonly resolvedAt: string | null;
  readonly closedAt: string | null;
}

export interface AdminTicketV2Detail {
  readonly report: AdminTicketV2Report;
  readonly attachments: readonly AdminTicketV2Attachment[];
  readonly events: readonly AdminTicketV2Event[];
  readonly relations: readonly {
    readonly id: string;
    readonly sourceReportId: string;
    readonly targetReportId: string;
    readonly relationType: string;
  }[];
  readonly duplicateCandidates: readonly { readonly id: string; readonly ticketNumber: string }[];
  readonly aiAnalysis?: { readonly confidence: number | null } | null;
}

export type AdminTicketV2Options = FormOptions | null;

export interface AdminTicketV2Related {
  readonly id: string;
  readonly ticketNumber: string;
  readonly description: string;
  readonly reportedAt: string;
}

export function adminV2Related(detail: AdminTicketV2Detail): AdminTicketV2Related[] {
  const byKey = new Map<string, AdminTicketV2Related>();
  for (const raw of detail.events) {
    const entry = raw as Record<string, unknown>;
    const payload =
      entry['detail'] !== null && typeof entry['detail'] === 'object'
        ? (entry['detail'] as Record<string, unknown>)
        : entry['metadata'] !== null && typeof entry['metadata'] === 'object'
          ? (entry['metadata'] as Record<string, unknown>)
          : null;
    if (payload === null) continue;
    for (const key of ['relatedReport', 'related', 'report', 'candidate']) {
      const cand = payload[key];
      if (cand === null || typeof cand !== 'object' || Array.isArray(cand)) continue;
      const row = cand as Record<string, unknown>;
      const id = typeof row['id'] === 'string' ? (row['id'] as string) : null;
      const ticket = typeof row['ticketNumber'] === 'string' ? (row['ticketNumber'] as string) : null;
      if (id === null && ticket === null) continue;
      const mapKey = (id ?? ticket ?? `${detail.report.id}-${byKey.size}`) as string;
      if (byKey.has(mapKey)) continue;
      byKey.set(mapKey, {
        id: id ?? mapKey,
        ticketNumber: ticket ?? '—',
        description: typeof row['description'] === 'string' && (row['description'] as string).trim() !== '' ? (row['description'] as string) : 'Deskripsi laporan pendukung belum tersedia di respons backend.',
        reportedAt: typeof row['reportedAt'] === 'string' ? (row['reportedAt'] as string) : detail.report.reportedAt,
      });
    }
  }
  return [...byKey.values()];
}
