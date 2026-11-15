import { describe, expect, it } from 'vitest';
import type { DashboardOverviewResponse } from '../server/analytics';
import { buildManagerialDashboardViewModel } from './managerial-dashboard';

const response: DashboardOverviewResponse = {
  range: { from: '2026-10-01', to: '2026-10-31' },
  cards: {
    totalReports: 12,
    activeReports: 7,
    inRepair: 2,
    highPriorityActive: 3,
    resolvedThisMonth: 5,
  },
  byStatus: [{ status: 'REPORTED', count: 4 }],
  byCategory: [{ categoryId: null, categoryName: null, count: 12 }],
  byLocation: [{ locationId: 'loc-1', locationName: 'Gedung A', count: 8 }],
  byBuilding: [{ buildingCode: 'A', buildingName: 'Gedung A', count: 8 }],
  resolutionTime: { sampleSize: 2, averageSeconds: 90000, medianSeconds: null },
  technicianWorkload: [],
  technicianCompletions: [],
  topAssets: [{
    assetId: 'asset-1',
    assetName: 'AC Ruang 101',
    roomName: 'Ruang 101',
    buildingCode: 'A',
    buildingName: 'Gedung A',
    floorNumber: 1,
    count: 4,
  }],
  trend: [{ date: '2026-10-01', reports: 3, resolvedCount: 1, resolutionSecondsTotal: 3600 }],
  priorityQueue: [{
    reportId: 'report-1',
    ticketNumber: 'MNT-2026-000001',
    status: 'VERIFIED',
    finalPriority: 'HIGH',
    reportedAt: new Date('2026-10-01T01:00:00Z'),
  }],
};

describe('buildManagerialDashboardViewModel', () => {
  it('maps decision cards and formats nullable resolution durations', () => {
    const model = buildManagerialDashboardViewModel(response);

    expect(model.cards).toEqual({
      totalReports: 12,
      activeReports: 7,
      inRepair: 2,
      highPriorityActive: 3,
      resolvedThisMonth: 5,
    });
    expect(model.resolutionTime).toEqual({
      sampleSize: 2,
      average: '1 hari 1 jam',
      median: '—',
    });
  });

  it('preserves ordered rankings, trend points, and drill-down identifiers', () => {
    const model = buildManagerialDashboardViewModel(response);

    expect(model.byLocation).toBe(response.byLocation);
    expect(model.byBuilding).toBe(response.byBuilding);
    expect(model.topAssets).toHaveLength(response.topAssets.length);
    expect(model.priorityQueue).toBe(response.priorityQueue);
    expect(model.trend).toBe(response.trend);
    expect(model.priorityQueue[0]?.ticketNumber).toBe('MNT-2026-000001');
    expect(model.topAssets[0]?.assetId).toBe('asset-1');
  });

  it('uses explicit labels for missing display names', () => {
    const model = buildManagerialDashboardViewModel({
      ...response,
      byCategory: [{ categoryId: null, categoryName: null, count: 2 }],
      topAssets: [{ ...response.topAssets[0]!, roomName: null, buildingName: null }],
    });

    expect(model.categoryLabels).toEqual(['Belum terklasifikasi']);
    expect(model.topAssets[0]?.locationLabel).toBe('Lokasi belum tercatat');
  });

  it('does not mutate the analytics response', () => {
    const before = structuredClone(response);

    buildManagerialDashboardViewModel(response);

    expect(response).toEqual(before);
  });
});
