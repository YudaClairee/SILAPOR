// Admin "Detail Tiket" new blocks (Figma 150:933). Rendered on the route;
// the legacy AdminAiPanel + AdminWorkflow below stay untouched until the
// new layout is wired (prevents a half-migrated page).
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AdminTicketHeader, AdminTicketStepper } from './AdminTicketHeader';
import { AdminTicketTabs } from './AdminTicketTabs';
import { AdminAssetAssignmentCard } from './AdminAssetAssignmentCard';
import { AdminAiScoreCard } from './AdminAiScoreCard';
import { AdminReporterQuotesCard } from './AdminReporterQuotesCard';
import { AdminPhotoPagerCard } from './AdminPhotoPagerCard';
import { AdminTicketV2Content } from './AdminTicketV2Content';
import type { AdminTicketV2Detail } from './AdminTicketV2Types';

describe('AdminTicketHeader', () => {
  it('renders the Figma hero: ticket + status pill + priority hero + actions', () => {
    const html = renderToStaticMarkup(
      <AdminTicketHeader
        ticketNumber="MNT-2026-000142"
        status="IN_REPAIR"
        priority="HIGH"
        priorityScore={88.5}
        onAddNote={vi.fn()}
        onResolve={vi.fn()}
        breadcrumb={null}
      />,
    );
    expect(html).toContain('MNT-2026-000142');
    expect(html).toContain('IN_REPAIR');
    expect(html).toContain('Prioritas: Tinggi (88,5/100)');
    expect(html).toContain('Tambah Catatan Progres');
    expect(html).toContain('Konfirmasi Penyelesaian');
  });
});

describe('AdminTicketStepper', () => {
  it('renders all seven steps with the current step marked', () => {
    const html = renderToStaticMarkup(
      <AdminTicketStepper
        status="IN_REPAIR"
        report={{
          reportedAt: '2026-10-18T01:30:00.000Z',
          verifiedAt: '2026-10-18T01:31:00.000Z',
          resolvedAt: null,
          closedAt: null,
        }}
        events={[]}
      />,
    );
    for (const step of ['REPORTED', 'VERIFIED', 'ASSIGNED', 'INSPECTION', 'IN_REPAIR', 'RESOLVED', 'CLOSED']) {
      expect(html).toContain(step);
    }
  });
});

describe('AdminTicketTabs', () => {
  it('renders the four Figma tabs with the reporter count badge', () => {
    const html = renderToStaticMarkup(
      <AdminTicketTabs active="ringkasan" reporterCount={3} onChange={vi.fn()} />,
    );
    expect(html).toContain('Ringkasan');
    expect(html).toContain('Pelapor');
    expect(html).toContain('Penugasan dan Progres');
    expect(html).toContain('Riwayat');
    expect(html).toContain('3');
  });
});

describe('AdminAssetAssignmentCard', () => {
  it('renders asset identity, location, and the unassigned state', () => {
    const html = renderToStaticMarkup(
      <AdminAssetAssignmentCard
        assetCode="AST-ELK-014"
        assetName="Proyektor Epson EB-X400"
        categoryName="Elektronik"
        locationLabel="Gedung C · Lantai 3 · Ruang 14"
        technicianName={null}
        technicianSpecialty={null}
        technicianActiveCount={null}
        assignedAt={null}
      />,
    );
    expect(html).toContain('AST-ELK-014');
    expect(html).toContain('Gedung C');
    expect(html).toContain('Belum ditugaskan');
  });

  it('labels a service report as having no asset', () => {
    const html = renderToStaticMarkup(
      <AdminAssetAssignmentCard
        assetLabel="Jenis Laporan"
        assetCode={null}
        assetName="Laporan layanan — tidak terkait aset"
        categoryName="Akses & Kunci"
        locationLabel="Gedung C · Lantai 3 · Ruang 14"
        technicianName={null}
        technicianSpecialty={null}
        technicianActiveCount={null}
        assignedAt={null}
      />,
    );
    expect(html).toContain('Jenis Laporan');
    expect(html).toContain('Laporan layanan — tidak terkait aset');
    expect(html).not.toContain('ID &amp; Nama Aset');
  });
});

describe('AdminAiScoreCard', () => {
  it('renders classification, confidence, and the Indonesian score', () => {
    const html = renderToStaticMarkup(
      <AdminAiScoreCard
        categoryName="Elektronik"
        issueTypeName="Proyektor tidak menyala"
        confidence={0.94}
        score={88.5}
        priority="HIGH"
        scoreExplanation="Dihitung dari kategori Elektronik dan 3 pelapor."
      />,
    );
    expect(html).toContain('Elektronik');
    expect(html).toContain('94%');
    expect(html).toContain('88,5');
  });
});

describe('AdminReporterQuotesCard', () => {
  it('renders consolidated quotes without separate supporter ticket numbers', () => {
    const html = renderToStaticMarkup(
      <AdminReporterQuotesCard
        quotes={[
          { key: 'a', position: 0, badge: 'Pelapor Utama', ticketNumber: 'MNT-1', description: 'Mati total.', reportedAt: '2026-10-18T01:30:00.000Z' },
          { key: 'b', position: 1, badge: 'Pelapor Pendukung 1', ticketNumber: null, description: 'Ikut mati.', reportedAt: null },
        ]}
        totalLabel="2 Laporan Tergabung"
      />,
    );
    expect(html).toContain('Terkonsolidasi');
    expect(html).toContain('Pelapor Utama · MNT-1');
    expect(html).toContain('Pelapor Pendukung 1');
    expect(html).not.toContain('Pelapor Pendukung 1 ·');
  });
});

describe('AdminPhotoPagerCard', () => {
  it('renders the two-up pager header with the photo count and supporter caption', () => {
    const html = renderToStaticMarkup(
      <AdminPhotoPagerCard
        ticket="MNT-1"
        attachments={[
          { id: 'p1', supporterId: null, originalFilename: 'a.jpg' },
          { id: 'p2', supporterId: 'sup-1', originalFilename: 'b.jpg' },
        ]}
      />,
    );
    expect(html).toContain('Foto Bukti Laporan (2 Foto)');
    expect(html).toContain('Bukti pelapor pendukung');
  });
});

describe('AdminTicketV2Content with supporters', () => {
  it('renders 3 quotes, tab counter 3, and supporter attachment from detail.supporters', () => {
    const detail: AdminTicketV2Detail = {
      report: {
        id: 'rep-1',
        ticketNumber: 'MNT-2026-000001',
        status: 'VERIFIED',
        assetId: 'ast-1',
        locationId: 'loc-1',
        finalCategoryId: 'cat-1',
        finalIssueTypeId: 'iss-1',
        finalPriority: 'HIGH',
        priorityScore: 88.5,
        priorityFactors: { affectedReporters: 3 },
        description: 'Proyektor mati total saat kuliah pagi.',
        version: 2,
        reportedAt: '2026-10-18T01:30:00.000Z',
        verifiedAt: '2026-10-18T01:31:00.000Z',
        resolvedAt: null,
        closedAt: null,
      },
      attachments: [
        { id: 'att-1', supporterId: null, originalFilename: 'utama.jpg' },
        { id: 'att-2', supporterId: 'sup-1', originalFilename: 'pendukung.jpg' },
      ],
      events: [],
      relations: [],
      duplicateCandidates: [],
      aiAnalysis: { confidence: 0.94 },
      supporters: [
        { id: 'sup-1', description: 'Kabel power juga tidak menyala.', createdAt: '2026-10-18T02:00:00.000Z' },
        { id: 'sup-2', description: 'Proyektor tetap gelap di jam siang.', createdAt: '2026-10-18T03:00:00.000Z' },
      ],
    };

    const html = renderToStaticMarkup(
      <AdminTicketV2Content
        ticket="MNT-2026-000001"
        detail={detail}
        options={null}
        activeTab="ringkasan"
        onTabChange={vi.fn()}
        onChanged={vi.fn()}
        breadcrumb={null}
      />,
    );

    expect(html).toContain('3 Laporan Tergabung');
    expect(html).toContain('Pelapor Utama · MNT-2026-000001');
    expect(html).toContain('Pelapor Pendukung 1');
    expect(html).toContain('Pelapor Pendukung 2');
    expect(html).toContain('Proyektor mati total saat kuliah pagi.');
    expect(html).toContain('Kabel power juga tidak menyala.');
    expect(html).toContain('Proyektor tetap gelap di jam siang.');
    expect(html).toContain('dan 3 pelapor.');
    expect(html).toContain('Pelapor');
    expect(html).toContain('>3<');
    expect(html).toContain('Foto Bukti Laporan (2 Foto)');
    expect(html).toContain('Bukti pelapor pendukung');
  });
});
