// Admin ticket-detail presentation helpers (Figma 150:933 "Detail Tiket").
// Pure UI copy + formatting only: header hero, 7-step rail, tab labels,
// consolidated reporter quotes, and photo pager captions. All data comes
// from the existing admin detail payload — nothing here fetches or mutates.
import { formatScoreId } from './ticket-detail.js';

export const ADMIN_DETAIL_TABS = ['ringkasan', 'pelapor', 'penugasan', 'riwayat'] as const;

export type AdminDetailTab = (typeof ADMIN_DETAIL_TABS)[number];

export const ADMIN_DETAIL_TAB_LABELS: Record<AdminDetailTab, string> = {
  ringkasan: 'Ringkasan',
  pelapor: 'Pelapor',
  penugasan: 'Penugasan dan Progres',
  riwayat: 'Riwayat',
};

export const ADMIN_STEP_LABELS: Record<string, string> = {
  REPORTED: 'REPORTED',
  VERIFIED: 'VERIFIED',
  ASSIGNED: 'ASSIGNED',
  INSPECTION: 'INSPECTION',
  IN_REPAIR: 'IN_REPAIR',
  RESOLVED: 'RESOLVED',
  CLOSED: 'CLOSED',
};

export const ADMIN_STEP_SUBLABELS: Record<string, string> = {
  REPORTED: 'Laporan Diterima',
  VERIFIED: 'Verifikasi AI',
  ASSIGNED: 'Teknisi Ditugaskan',
  INSPECTION: 'Inspeksi Lapangan',
  IN_REPAIR: 'Perbaikan Berlangsung',
  RESOLVED: 'Uji Fungsi',
  CLOSED: 'Tahap Akhir',
};

export function adminStatusPill(status: string): string {
  switch (status) {
    case 'REPORTED':
    case 'VERIFIED':
    case 'ASSIGNED':
      return 'bg-tint-info text-badge-info';
    case 'INSPECTION':
    case 'IN_REPAIR':
      return 'bg-tint-warning text-badge-warning';
    case 'RESOLVED':
      return 'bg-tint-success text-badge-success';
    default:
      return 'bg-tint-muted text-badge-muted';
  }
}

export function adminPriorityLabel(priority: string | null | undefined): string {
  if (priority === 'HIGH') return 'Tinggi';
  if (priority === 'MEDIUM') return 'Sedang';
  if (priority === 'LOW') return 'Rendah';
  return 'Belum ditetapkan';
}

/** "Tinggi (88,5/100)" — koma Indonesia, skor hilang bila null. */
export function adminPriorityHero(priority: string | null, score: number | null): string {
  const label = adminPriorityLabel(priority);
  if (score === null || !Number.isFinite(score)) return `Prioritas: ${label}`;
  return `Prioritas: ${label} (${formatScoreId(score)}/100)`;
}

// Konsolidasi laporan pendukung: backend hanya mengembalikan ticketNumber +
// description + relationType tanpa identitas pelapor; UI meneruskannya apa
// adanya (posisi + nomor tiket sebagai rujukan UMPER).
export interface AdminReporterQuote {
  readonly key: string;
  readonly position: number;
  readonly badge: string;
  readonly ticketNumber: string;
  readonly description: string;
  readonly reportedAt: string | null;
}

export interface RelatedReportLike {
  readonly id: string;
  readonly ticketNumber: string;
  readonly description: string;
  readonly reportedAt: string;
}

export function buildAdminReporterQuotes(
  mainTicket: { readonly id: string; readonly ticketNumber: string; readonly description: string; readonly reportedAt: string },
  related: readonly RelatedReportLike[],
): AdminReporterQuote[] {
  const quotes: AdminReporterQuote[] = [
    {
      key: mainTicket.id,
      position: 0,
      badge: 'Pelapor Utama',
      ticketNumber: mainTicket.ticketNumber,
      description: mainTicket.description,
      reportedAt: mainTicket.reportedAt,
    },
  ];
  related.forEach((item, index) => {
    quotes.push({
      key: item.id,
      position: index + 1,
      badge: `Pelapor Pendukung ${index + 1}`,
      ticketNumber: item.ticketNumber,
      description: item.description,
      reportedAt: item.reportedAt,
    });
  });
  return quotes;
}

export function adminReporterCaption(quote: AdminReporterQuote): string {
  if (quote.position === 0) return `Pelapor Utama · ${quote.ticketNumber}`;
  return `Pelapor Pendukung ${quote.position} · ${quote.ticketNumber}`;
}

/** Caption foto generik — backend tidak menyimpan caption per foto. */
export function adminPhotoCaption(photoNumber: number): string {
  if (photoNumber === 1) return 'Kondisi unit di lokasi laporan';
  return 'Foto pendukung kondisi kerusakan';
}
