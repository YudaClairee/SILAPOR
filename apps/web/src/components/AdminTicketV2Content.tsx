// Admin "Detail Tiket" v2 content (Figma 150:933).
import { useEffect, useState } from 'react';
import { buildAdminReporterQuotes, type AdminDetailTab } from '../lib/admin-ticket-detail.js';
import {
  AdminAiScoreCard,
  AdminAssetAssignmentCard,
  AdminPhotoPagerCard,
  AdminReporterQuotesCard,
  AdminTicketAssignmentTab,
  AdminTicketHeader,
  AdminTicketHistoryTab,
  AdminTicketStepper,
  AdminTicketTabs,
} from './index.js';
import { adminV2Related, type AdminTicketV2Detail, type AdminTicketV2Options } from './AdminTicketV2Types.js';

export function useAdminTicketV2Tab(ticket: string) {
  const [activeTab, setActiveTab] = useState<AdminDetailTab>('ringkasan');
  useEffect(() => { setActiveTab('ringkasan'); }, [ticket]);
  return { activeTab, onTabChange: setActiveTab };
}

export function AdminTicketV2Content(props: {
  readonly ticket: string;
  readonly detail: AdminTicketV2Detail;
  readonly options: AdminTicketV2Options;
  readonly activeTab: AdminDetailTab;
  readonly onTabChange: (tab: AdminDetailTab) => void;
  readonly onChanged: () => void;
}) {
  const { detail, options } = props;
  const categoryNames = new Map((options?.categories ?? []).map((c) => [c.id, c.name] as const));
  const issueTypeNames = new Map((options?.issueTypes ?? []).map((i) => [i.id, i.name] as const));
  const assetNames = new Map((options?.assets ?? []).map((a) => [a.id, a.name] as const));
  const assetCodes = new Map((options?.assets ?? []).map((a) => [a.id, a.code] as const));
  const locationNames = new Map((options?.locations ?? []).map((l) => [l.id, l.name] as const));
  const related = adminV2Related(detail);
  const quotes = buildAdminReporterQuotes(
    { id: detail.report.id, ticketNumber: detail.report.ticketNumber, description: detail.report.description, reportedAt: detail.report.reportedAt },
    related,
  );
  const totalLabel = related.length === 0 ? '1 Laporan' : `${related.length + 1} Laporan Tergabung`;
  const categoryName = detail.report.finalCategoryId === null ? '—' : (categoryNames.get(detail.report.finalCategoryId) ?? detail.report.finalCategoryId);
  const issueTypeName = detail.report.finalIssueTypeId === null ? '—' : (issueTypeNames.get(detail.report.finalIssueTypeId) ?? detail.report.finalIssueTypeId);
  return (
    <>
      <AdminTicketHeader
        ticketNumber={detail.report.ticketNumber}
        status={detail.report.status}
        priority={detail.report.finalPriority}
        priorityScore={detail.report.priorityScore}
        onAddNote={() => props.onTabChange('penugasan')}
        onResolve={detail.report.status === 'IN_REPAIR' ? () => props.onTabChange('penugasan') : null}
      />
      <AdminTicketStepper status={detail.report.status} report={detail.report} events={detail.events} />
      <AdminTicketTabs active={props.activeTab} reporterCount={quotes.length} onChange={props.onTabChange} />
      <div className="mt-4">
        {props.activeTab === 'ringkasan' ? (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <AdminAssetAssignmentCard
              assetCode={detail.report.assetId === null ? null : (assetCodes.get(detail.report.assetId) ?? null)}
              assetName={detail.report.assetId === null ? 'Tanpa aset terdaftar' : (assetNames.get(detail.report.assetId) ?? detail.report.assetId)}
              categoryName={categoryName}
              locationLabel={locationNames.get(detail.report.locationId) ?? detail.report.locationId}
              technicianName={null}
              technicianSpecialty={null}
              technicianActiveCount={null}
              assignedAt={null}
            />
            <AdminAiScoreCard
              categoryName={categoryName}
              issueTypeName={issueTypeName}
              confidence={detail.aiAnalysis?.confidence ?? null}
              score={detail.report.priorityScore}
              priority={detail.report.finalPriority}
              scoreExplanation={detail.report.priorityScore === null ? 'Skor prioritas belum tersedia untuk tiket ini.' : `Dihitung dari kategori ${categoryName}, lokasi ${locationNames.get(detail.report.locationId) ?? detail.report.locationId}, dan ${related.length + 1} pelapor.`}
            />
            <AdminReporterQuotesCard quotes={quotes} totalLabel={totalLabel} />
            <AdminPhotoPagerCard ticket={detail.report.ticketNumber} attachments={detail.attachments} />
          </div>
        ) : null}
        {props.activeTab === 'pelapor' ? (
          <div className="grid grid-cols-1 gap-4">
            <AdminReporterQuotesCard quotes={quotes} totalLabel={totalLabel} />
            <AdminPhotoPagerCard ticket={detail.report.ticketNumber} attachments={detail.attachments} />
          </div>
        ) : null}
        {props.activeTab === 'penugasan' ? (
          <AdminTicketAssignmentTab ticket={props.ticket} report={detail.report} options={options} onChanged={props.onChanged} />
        ) : null}
        {props.activeTab === 'riwayat' ? (
          <AdminTicketHistoryTab ticket={props.ticket} events={detail.events} relations={detail.relations} duplicates={detail.duplicateCandidates} />
        ) : null}
      </div>
    </>
  );
}
