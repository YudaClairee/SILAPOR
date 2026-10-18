import { beforeEach, describe, expect, it, vi } from 'vitest';
import { badRequest, forbidden, notFound, toHttpResponse, unauthorized } from '@silapor/shared';
import {
  getAssetMaintenanceHistoryRoute,
  listFacilityStatusRoute,
  parseFacilityStatusQuery,
} from './facilities.js';

const dbMocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  listFacilityStatus: vi.fn(),
  getFacilityMaintenanceHistory: vi.fn(),
}));

vi.mock('@silapor/database', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@silapor/database')>()),
  getDb: dbMocks.getDb,
  listFacilityStatus: dbMocks.listFacilityStatus,
  getFacilityMaintenanceHistory: dbMocks.getFacilityMaintenanceHistory,
}));

vi.mock('./auth', () => ({
  requireAdmin: vi.fn(),
}));

import { requireAdmin } from './auth.js';

const requireAdminMock = vi.mocked(requireAdmin);

const userId = '11111111-1111-1111-1111-111111111111';
const ASSET_ID = '66666666-6666-6666-6666-666666666666';
const CAT_ID = '33333333-3333-3333-3333-333333333333';
const LOC_ID = '44444444-4444-4444-4444-444444444444';
const reportId = '77777777-7777-7777-7777-777777777777';

const STATUS_RESULT = {
  items: [
    {
      assetId: ASSET_ID,
      assetCode: 'AST-0001',
      assetName: 'Proyektor Ruang 101',
      locationLabel: 'Gedung A · Ruang 101',
      categoryName: 'Elektronik',
      derivedStatus: 'UNDER_INSPECTION',
      isActive: true,
      activeReportCount: 2,
      lastUpdated: new Date('2026-01-02T08:00:00Z'),
    },
  ],
  total: 1,
  limit: 50,
  offset: 0,
};

const HISTORY_RESULT = {
  asset: {
    assetId: ASSET_ID,
    assetCode: 'AST-0001',
    assetName: 'Proyektor Ruang 101',
    isActive: true,
    locationLabel: 'Gedung A · Ruang 101',
    categoryName: 'Elektronik',
    derivedStatus: 'IN_REPAIR',
  },
  items: [
    {
      reportId,
      ticketNumber: 'MNT-2026-000210',
      status: 'IN_REPAIR',
      reportedAt: new Date('2026-01-02T08:00:00Z'),
      resolvedAt: null,
      closedAt: null,
      finalPriority: 'HIGH',
    },
  ],
};

function request(url: string): Request {
  return new Request(url);
}

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.getDb.mockReturnValue({ db: {}, close: async () => undefined });
  requireAdminMock.mockResolvedValue({ id: userId, username: 'rudi', role: 'ADMIN' });
});

describe('parseFacilityStatusQuery', () => {
  it('parses camelCase params with pagination', () => {
    expect(
      parseFacilityStatusQuery(
        `http://x/api/facilities/status?locationId=${LOC_ID}&categoryId=${CAT_ID}&status=IN_REPAIR&limit=10&offset=5`,
      ),
    ).toEqual({
      locationId: LOC_ID,
      categoryId: CAT_ID,
      status: 'IN_REPAIR',
      limit: 10,
      offset: 5,
    });
  });

  it('tolerates snake_case params', () => {
    expect(
      parseFacilityStatusQuery(
        `http://x/api/facilities/status?location_id=${LOC_ID}&category_id=${CAT_ID}&status=UNDER_INSPECTION&include_inactive=true`,
      ),
    ).toEqual({
      locationId: LOC_ID,
      categoryId: CAT_ID,
      status: 'UNDER_INSPECTION',
      includeInactive: true,
    });
  });

  it('omits absent and blank filters', () => {
    expect(parseFacilityStatusQuery('http://x/api/facilities/status')).toEqual({});
    expect(
      parseFacilityStatusQuery('http://x/api/facilities/status?status=&limit=&offset='),
    ).toEqual({});
  });

  it('rejects a status outside FACILITY_STATUSES with 400', () => {
    for (const status of ['BROKEN', 'RESOLVED', 'REPORTED_ISSUE', 'operational']) {
      const error = (() => {
        try {
          parseFacilityStatusQuery(`http://x/api/facilities/status?status=${status}`);
        } catch (caught) {
          return caught;
        }
        throw new Error('expected parser to throw');
      })() as unknown;
      expect(toHttpResponse(error).status).toBe(400);
    }
  });

  it('rejects a non-positive or non-integer limit with 400', () => {
    for (const limit of ['0', '-5', '1.5', 'abc']) {
      let caught: unknown;
      try {
        parseFacilityStatusQuery(`http://x/api/facilities/status?limit=${limit}`);
      } catch (error) {
        caught = error;
      }
      expect(caught).toMatchObject({ status: 400 });
    }
  });

  it('rejects a limit above the list cap with 400', () => {
    let caught: unknown;
    try {
      parseFacilityStatusQuery('http://x/api/facilities/status?limit=201');
    } catch (error) {
      caught = error;
    }
    expect(toHttpResponse(caught).status).toBe(400);
  });

  it('accepts the list cap itself', () => {
    expect(parseFacilityStatusQuery('http://x/api/facilities/status?limit=200')).toEqual({
      limit: 200,
    });
  });

  it('rejects a negative or fractional offset with 400', () => {
    for (const offset of ['-1', '2.5', 'abc']) {
      let caught: unknown;
      try {
        parseFacilityStatusQuery(`http://x/api/facilities/status?offset=${offset}`);
      } catch (error) {
        caught = error;
      }
      expect(toHttpResponse(caught).status).toBe(400);
    }
  });

  it('rejects a malformed URL with 400', () => {
    let caught: unknown;
    try {
      parseFacilityStatusQuery('http://');
    } catch (error) {
      caught = error;
    }
    expect(toHttpResponse(caught).status).toBe(400);
  });
});

describe('listFacilityStatusRoute', () => {
  it('delegates to the repo with the parsed options and closes the connection', async () => {
    dbMocks.listFacilityStatus.mockResolvedValue(STATUS_RESULT);
    const result = await listFacilityStatusRoute(
      request('http://x/api/facilities/status?status=UNDER_INSPECTION&limit=10&offset=5'),
      'http://x/api/facilities/status?status=UNDER_INSPECTION&limit=10&offset=5',
    );
    expect(result).toEqual(STATUS_RESULT);
    expect(dbMocks.listFacilityStatus).toHaveBeenCalledWith(
      {},
      { status: 'UNDER_INSPECTION', limit: 10, offset: 5 },
    );
    expect(dbMocks.getDb).toHaveBeenCalledOnce();
  });

  it('propagates a 401 from requireAdmin without touching the repo', async () => {
    requireAdminMock.mockRejectedValue(unauthorized('Belum login'));
    const url = 'http://x/api/facilities/status';
    await expect(listFacilityStatusRoute(request(url), url)).rejects.toMatchObject({
      status: 401,
    });
    expect(dbMocks.listFacilityStatus).not.toHaveBeenCalled();
  });

  it('propagates a 403 for non-admin callers from requireAdmin', async () => {
    requireAdminMock.mockRejectedValue(forbidden('Akses ditolak'));
    const url = 'http://x/api/facilities/status?include_inactive=true';
    await expect(listFacilityStatusRoute(request(url), url)).rejects.toMatchObject({
      status: 403,
    });
    expect(dbMocks.listFacilityStatus).not.toHaveBeenCalled();
  });

  it('propagates a 400 for invalid UUID filters throwing in the repo', async () => {
    dbMocks.listFacilityStatus.mockRejectedValue(badRequest('locationId must be a valid UUID'));
    const url = 'http://x/api/facilities/status?locationId=not-a-uuid';
    await expect(listFacilityStatusRoute(request(url), url)).rejects.toMatchObject({
      status: 400,
    });
  });
});

describe('getAssetMaintenanceHistoryRoute', () => {
  it('delegates to the repo as admin and closes the connection', async () => {
    dbMocks.getFacilityMaintenanceHistory.mockResolvedValue(HISTORY_RESULT);
    const result = await getAssetMaintenanceHistoryRoute(request('http://x'), ASSET_ID);
    expect(result).toEqual(HISTORY_RESULT);
    expect(dbMocks.getFacilityMaintenanceHistory).toHaveBeenCalledWith({}, ASSET_ID);
    expect(dbMocks.getDb).toHaveBeenCalledOnce();
  });

  it('propagates a 403 for non-admin callers from requireAdmin', async () => {
    requireAdminMock.mockRejectedValue(forbidden('Akses ditolak'));
    const result = (await getAssetMaintenanceHistoryRoute(request('http://x'), ASSET_ID).catch(
      (error: unknown) => error,
    )) as unknown;
    expect(toHttpResponse(result).status).toBe(403);
    expect(dbMocks.getFacilityMaintenanceHistory).not.toHaveBeenCalled();
  });

  it('propagates the byte-identical 404 for an unknown asset', async () => {
    dbMocks.getFacilityMaintenanceHistory.mockRejectedValue(notFound('Asset not found'));
    await expect(
      getAssetMaintenanceHistoryRoute(request('http://x'), ASSET_ID),
    ).rejects.toMatchObject({ status: 404 });
    expect(toHttpResponse(notFound('Asset not found')).body.error.message).toBe('Asset not found');
  });
});
