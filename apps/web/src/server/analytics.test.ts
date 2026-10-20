import { beforeEach, describe, expect, it, vi } from 'vitest';
import { forbidden, unauthorized } from '@silapor/shared';

const dbMocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  close: vi.fn(),
  getOverviewCards: vi.fn(),
  getReportsByStatus: vi.fn(),
  getReportsByCategory: vi.fn(),
  getReportsByLocation: vi.fn(),
  getReportsByBuilding: vi.fn(),
  getResolutionTimeMetrics: vi.fn(),
  getTechnicianWorkload: vi.fn(),
  getTechnicianCompletions: vi.fn(),
  getTopAssets: vi.fn(),
  getReportTrend: vi.fn(),
  getPriorityQueue: vi.fn(),
}));

vi.mock('@silapor/database', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@silapor/database')>()),
  getDb: dbMocks.getDb,
}));

vi.mock('@silapor/analytics', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@silapor/analytics')>()),
  getOverviewCards: dbMocks.getOverviewCards,
  getReportsByStatus: dbMocks.getReportsByStatus,
  getReportsByCategory: dbMocks.getReportsByCategory,
  getReportsByLocation: dbMocks.getReportsByLocation,
  getReportsByBuilding: dbMocks.getReportsByBuilding,
  getResolutionTimeMetrics: dbMocks.getResolutionTimeMetrics,
  getTechnicianWorkload: dbMocks.getTechnicianWorkload,
  getTechnicianCompletions: dbMocks.getTechnicianCompletions,
  getTopAssets: dbMocks.getTopAssets,
  getReportTrend: dbMocks.getReportTrend,
  getPriorityQueue: dbMocks.getPriorityQueue,
}));

vi.mock('./auth', () => ({
  requireAdmin: vi.fn(),
}));

import { requireAdmin } from './auth.js';
import { getDashboardOverviewRoute } from './analytics.js';

const requireAdminMock = vi.mocked(requireAdmin);

const userId = '11111111-1111-1111-1111-111111111111';
const CATEGORY_ID = '33333333-3333-3333-3333-333333333333';
const LOCATION_ID = '44444444-4444-4444-4444-444444444444';
const TECHNICIAN_ID = '55555555-5555-5555-5555-555555555555';
const REPORT_ID = '77777777-7777-7777-7777-777777777777';

const CARDS = {
  totalReports: 7,
  activeReports: 6,
  inRepair: 1,
  highPriorityActive: 1,
  resolvedThisMonth: 2,
};
const BY_STATUS = [
  { status: 'REPORTED', count: 2 },
  { status: 'VERIFIED', count: 1 },
  { status: 'ASSIGNED', count: 1 },
  { status: 'INSPECTION', count: 0 },
  { status: 'IN_REPAIR', count: 1 },
  { status: 'RESOLVED', count: 1 },
  { status: 'CLOSED', count: 1 },
];
const BY_CATEGORY = [
  { categoryId: CATEGORY_ID, categoryName: 'HVAC', count: 2 },
  { categoryId: null, categoryName: null, count: 2 },
];
const BY_LOCATION = [
  { locationId: LOCATION_ID, locationName: 'Gedung A · Ruang 101', count: 7 },
];
const RESOLUTION_TIME = { sampleSize: 2, averageSeconds: 172800, medianSeconds: 172800 };
const TECHNICIAN_WORKLOAD = [
  { technicianId: TECHNICIAN_ID, technicianName: 'Budi', activeCount: 1 },
];
const PRIORITY_QUEUE = [
  {
    reportId: REPORT_ID,
    ticketNumber: 'MNT-2026-000002',
    status: 'VERIFIED',
    finalPriority: 'HIGH',
    reportedAt: new Date('2026-10-02T03:00:00Z'),
  },
];
const BY_BUILDING = [{ buildingCode: 'C', buildingName: 'DEWI SARTIKA', count: 5 }];
const TECHNICIAN_COMPLETIONS = [
  { technicianId: TECHNICIAN_ID, technicianName: 'Budi', completedCount: 3 },
];
const TOP_ASSETS = [
  {
    assetId: '88888888-8888-4888-8888-888888888888',
    assetName: 'AC Ruang 01',
    roomName: 'Ruang 101',
    buildingCode: 'C',
    buildingName: 'DEWI SARTIKA',
    floorNumber: 1,
    count: 4,
  },
];
const TREND = [
  { date: '2026-10-01', reports: 2, resolvedCount: 1, resolutionSecondsTotal: 7200 },
];

function request(url: string): Request {
  return new Request(url);
}

function mockQueryResults(): void {
  dbMocks.getOverviewCards.mockResolvedValue(CARDS);
  dbMocks.getReportsByStatus.mockResolvedValue(BY_STATUS);
  dbMocks.getReportsByCategory.mockResolvedValue(BY_CATEGORY);
  dbMocks.getReportsByLocation.mockResolvedValue(BY_LOCATION);
  dbMocks.getReportsByBuilding.mockResolvedValue(BY_BUILDING);
  dbMocks.getResolutionTimeMetrics.mockResolvedValue(RESOLUTION_TIME);
  dbMocks.getTechnicianWorkload.mockResolvedValue(TECHNICIAN_WORKLOAD);
  dbMocks.getTechnicianCompletions.mockResolvedValue(TECHNICIAN_COMPLETIONS);
  dbMocks.getTopAssets.mockResolvedValue(TOP_ASSETS);
  dbMocks.getReportTrend.mockResolvedValue(TREND);
  dbMocks.getPriorityQueue.mockResolvedValue(PRIORITY_QUEUE);
}

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.close.mockResolvedValue(undefined);
  dbMocks.getDb.mockReturnValue({ db: {}, close: dbMocks.close });
  requireAdminMock.mockResolvedValue({ id: userId, username: 'rudi', role: 'ADMIN' });
});

describe('getDashboardOverviewRoute requireAdmin guard', () => {
  it('propagates a 401 from requireAdmin without opening the database', async () => {
    requireAdminMock.mockRejectedValue(unauthorized('Belum login'));
    const url = 'http://x/api/admin/analytics/overview';
    await expect(getDashboardOverviewRoute(request(url), url)).rejects.toMatchObject({
      status: 401,
    });
    expect(dbMocks.getDb).not.toHaveBeenCalled();
  });

  it('propagates a 403 for non-admin callers without opening the database', async () => {
    requireAdminMock.mockRejectedValue(forbidden('Akses ditolak'));
    const url = 'http://x/api/admin/analytics/overview';
    await expect(getDashboardOverviewRoute(request(url), url)).rejects.toMatchObject({
      status: 403,
    });
    expect(dbMocks.getDb).not.toHaveBeenCalled();
  });
});

describe('getDashboardOverviewRoute range mapping', () => {
  it('maps from/to to the Jakarta window and echoes the raw params', async () => {
    mockQueryResults();
    const url = 'http://x/api/admin/analytics/overview?from=2026-10-01&to=2026-10-18';
    const result = await getDashboardOverviewRoute(request(url), url);
    const range = {
      from: new Date('2026-09-30T17:00:00.000Z'),
      toExclusive: new Date('2026-10-18T17:00:00.000Z'),
    };
    expect(result.range).toEqual({ from: '2026-10-01', to: '2026-10-18' });
    expect(dbMocks.getOverviewCards).toHaveBeenCalledWith({}, range);
    expect(dbMocks.getReportsByStatus).toHaveBeenCalledWith({}, range);
    expect(dbMocks.getReportsByCategory).toHaveBeenCalledWith({}, range);
    expect(dbMocks.getReportsByLocation).toHaveBeenCalledWith({}, range);
    expect(dbMocks.getReportsByBuilding).toHaveBeenCalledWith({}, range);
    expect(dbMocks.getResolutionTimeMetrics).toHaveBeenCalledWith({}, range);
    expect(dbMocks.getTechnicianCompletions).toHaveBeenCalledWith({}, range);
    expect(dbMocks.getTopAssets).toHaveBeenCalledWith({}, range);
    expect(dbMocks.getReportTrend).toHaveBeenCalledWith({}, range);
  });

  it('treats absent params as unbounded and echoes nulls', async () => {
    mockQueryResults();
    const url = 'http://x/api/admin/analytics/overview';
    const result = await getDashboardOverviewRoute(request(url), url);
    expect(result.range).toEqual({ from: null, to: null });
    expect(dbMocks.getOverviewCards).toHaveBeenCalledWith({}, {});
    expect(dbMocks.getTechnicianWorkload).toHaveBeenCalledWith({});
    expect(dbMocks.getPriorityQueue).toHaveBeenCalledWith({});
  });
});

describe('getDashboardOverviewRoute malformed params', () => {
  it.each(['2026-13-01', '2026-1-1', 'abc'])(
    'rejects from=%s with 400 before opening the database',
    async (from) => {
      const url = `http://x/api/admin/analytics/overview?from=${from}`;
      await expect(getDashboardOverviewRoute(request(url), url)).rejects.toMatchObject({
        status: 400,
      });
      expect(dbMocks.getDb).not.toHaveBeenCalled();
    },
  );

  it('rejects a malformed to with 400 before opening the database', async () => {
    const url = 'http://x/api/admin/analytics/overview?to=2026-02-30';
    await expect(getDashboardOverviewRoute(request(url), url)).rejects.toMatchObject({
      status: 400,
    });
    expect(dbMocks.getDb).not.toHaveBeenCalled();
  });
});

describe('getDashboardOverviewRoute assembly', () => {
  it('returns every metric section from the query results and closes the connection', async () => {
    mockQueryResults();
    const url = 'http://x/api/admin/analytics/overview';
    const result = await getDashboardOverviewRoute(request(url), url);
    expect(result).toEqual({
      range: { from: null, to: null },
      cards: CARDS,
      byStatus: BY_STATUS,
      byCategory: BY_CATEGORY,
      byLocation: BY_LOCATION,
      byBuilding: BY_BUILDING,
      resolutionTime: RESOLUTION_TIME,
      technicianWorkload: TECHNICIAN_WORKLOAD,
      technicianCompletions: TECHNICIAN_COMPLETIONS,
      topAssets: TOP_ASSETS,
      trend: TREND,
      priorityQueue: PRIORITY_QUEUE,
    });
    expect(dbMocks.close).toHaveBeenCalledOnce();
  });

  it('closes the connection when a query rejects', async () => {
    mockQueryResults();
    dbMocks.getResolutionTimeMetrics.mockRejectedValue(new Error('boom'));
    const url = 'http://x/api/admin/analytics/overview';
    await expect(getDashboardOverviewRoute(request(url), url)).rejects.toThrow('boom');
    expect(dbMocks.close).toHaveBeenCalledOnce();
  });
});
