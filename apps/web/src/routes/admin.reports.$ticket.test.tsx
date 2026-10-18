import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AdminAiPanel } from './admin.reports.$ticket';

const CATEGORY_ID = '11111111-1111-4111-8111-111111111111';
const ISSUE_TYPE_ID = '22222222-2222-4222-8222-222222222222';
const LOCATION_ID = '33333333-3333-4333-8333-333333333333';
const ASSET_ID = '44444444-4444-4444-8444-444444444444';
const REPORT_ID = '55555555-5555-4555-8555-555555555555';
const REPORTER_ID = '66666666-6666-4666-8666-666666666666';

const categoryNames = new Map([[CATEGORY_ID, 'HVAC']]);
const issueTypeNames = new Map([[ISSUE_TYPE_ID, 'Bocor']]);

function report(overrides: Record<string, unknown> = {}) {
  return {
    id: REPORT_ID,
    ticketNumber: 'MNT-2026-000001',
    status: 'VERIFIED',
    reporterId: REPORTER_ID,
    locationId: LOCATION_ID,
    assetId: ASSET_ID,
    submittedCategoryId: CATEGORY_ID,
    submittedIssueTypeId: ISSUE_TYPE_ID,
    finalCategoryId: CATEGORY_ID,
    finalIssueTypeId: ISSUE_TYPE_ID,
    finalPriority: 'HIGH',
    priorityScore: 78,
    priorityFactors: {
      category: 35,
      asset: 20,
      location: 18,
      frequency: 5,
      affectedReporters: 2,
      scoringComplete: true,
    },
    priorityDecidedBy: 'AI',
    priorityDecidedAt: '2026-10-17T10:00:00.000Z',
    scoringConfigVersion: 1,
    description: 'AC bocor di ruang 204.',
    occurredAt: null,
    version: 3,
    reportedAt: '2026-10-17T09:00:00.000Z',
    verifiedAt: '2026-10-17T10:00:00.000Z',
    resolvedAt: null,
    closedAt: null,
    ...overrides,
  };
}

const analysis = {
  id: '77777777-7777-4777-8777-777777777777',
  status: 'SUCCEEDED',
  verdict: 'PASS',
  category: 'HVAC',
  issueType: 'LEAKING',
  priority: 'HIGH',
  confidence: 0.86,
  reasoningSummary: 'Foto jelas dan deskripsi sesuai aset.',
  model: 'test/model',
  promptVersion: 'v1',
  createdAt: '2026-10-17T09:59:00.000Z',
  completedAt: '2026-10-17T10:00:00.000Z',
};

describe('AdminAiPanel', () => {
  it('renders the final AI classification, score factors, and model metadata', () => {
    const html = renderToStaticMarkup(
      <AdminAiPanel
        report={report()}
        analysis={analysis}
        categoryNames={categoryNames}
        issueTypeNames={issueTypeNames}
      />,
    );
    expect(html).toContain('HVAC');
    expect(html).toContain('Bocor');
    expect(html).toContain('78 / 100');
    expect(html).toContain('Kategori 35');
    expect(html).toContain('Pelapor terdampak: 2');
    expect(html).toContain('86%');
    expect(html).toContain('Foto jelas dan deskripsi sesuai aset.');
    expect(html).toContain('test/model');
    expect(html).toContain('Sumber keputusan');
    expect(html).toContain('AI');
    expect(html).not.toContain('menunggu');
  });

  it('renders the held state while a REPORTED report has no finals', () => {
    const html = renderToStaticMarkup(
      <AdminAiPanel
        report={report({
          status: 'REPORTED',
          finalCategoryId: null,
          finalIssueTypeId: null,
          finalPriority: null,
          priorityScore: null,
          priorityFactors: null,
          verifiedAt: null,
        })}
        analysis={{ ...analysis, status: 'PENDING', confidence: null }}
        categoryNames={categoryNames}
        issueTypeNames={issueTypeNames}
      />,
    );
    expect(html).toContain('Menunggu verifikasi');
    expect(html).toContain('layanan AI tidak tersedia');
    expect(html).not.toContain('78 / 100');
  });
});
