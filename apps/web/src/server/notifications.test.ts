import { beforeEach, describe, expect, it, vi } from 'vitest';
import { notFound, toHttpResponse, unauthorized } from '@silapor/shared';
import {
  getMyNotificationsRoute,
  markMyNotificationReadRoute,
  markMyNotificationsAllReadRoute,
} from './notifications.js';

const dbMocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  listNotificationsForUser: vi.fn(),
  markNotificationRead: vi.fn(),
  markAllNotificationsRead: vi.fn(),
}));

vi.mock('@silapor/database', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@silapor/database')>()),
  getDb: dbMocks.getDb,
  listNotificationsForUser: dbMocks.listNotificationsForUser,
  markNotificationRead: dbMocks.markNotificationRead,
  markAllNotificationsRead: dbMocks.markAllNotificationsRead,
}));

vi.mock('./auth', () => ({
  requireUser: vi.fn(),
}));

import { requireUser } from './auth.js';

const requireUserMock = vi.mocked(requireUser);

const userId = '11111111-1111-1111-1111-111111111111';
const otherId = '22222222-2222-2222-2222-222222222222';
const notificationId = '33333333-3333-3333-3333-333333333333';

const LIST_RESULT = {
  items: [
    {
      id: notificationId,
      type: 'REPORT_VERIFIED',
      title: 'Laporan diverifikasi',
      message: 'Tiket MNT-2026-000210 telah diverifikasi admin.',
      reportId: '44444444-4444-4444-4444-444444444444',
      ticketNumber: 'MNT-2026-000210',
      readAt: null,
      createdAt: new Date('2026-01-03T10:00:00Z'),
    },
  ],
  total: 1,
  unreadCount: 1,
};

function request(): Request {
  return new Request('http://localhost/api/notifications');
}

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.getDb.mockReturnValue({ db: {}, close: async () => undefined });
  requireUserMock.mockResolvedValue({ id: userId, username: 'rina', role: 'REPORTER' });
});

describe('getMyNotificationsRoute', () => {
  it("returns the session user's own list and closes the connection", async () => {
    dbMocks.listNotificationsForUser.mockResolvedValue(LIST_RESULT);
    const result = await getMyNotificationsRoute(request());
    expect(result).toEqual(LIST_RESULT);
    expect(dbMocks.listNotificationsForUser).toHaveBeenCalledWith({}, userId);
    expect(dbMocks.getDb).toHaveBeenCalledOnce();
  });

  it('propagates a 401 from requireUser without touching the repo', async () => {
    requireUserMock.mockRejectedValue(unauthorized('Belum login'));
    await expect(getMyNotificationsRoute(request())).rejects.toMatchObject({ status: 401 });
    expect(dbMocks.listNotificationsForUser).not.toHaveBeenCalled();
  });
});

describe('markMyNotificationReadRoute', () => {
  it('marks one own notification read with the session user id', async () => {
    dbMocks.markNotificationRead.mockResolvedValue(undefined);
    await markMyNotificationReadRoute(request(), notificationId);
    expect(dbMocks.markNotificationRead).toHaveBeenCalledWith({}, userId, notificationId);
  });

  it('propagates the byte-identical 404 for foreign or unknown ids', async () => {
    dbMocks.markNotificationRead.mockRejectedValue(notFound('Notification not found'));
    await expect(markMyNotificationReadRoute(request(), otherId)).rejects.toMatchObject({
      status: 404,
    });
    expect(toHttpResponse(notFound('Notification not found')).body.error.message).toBe(
      'Notification not found',
    );
  });
});

describe('markMyNotificationsAllReadRoute', () => {
  it('returns the unread→read transition count from the repo', async () => {
    dbMocks.markAllNotificationsRead.mockResolvedValue(3);
    const result = await markMyNotificationsAllReadRoute(request());
    expect(result).toEqual({ updated: 3 });
    expect(dbMocks.markAllNotificationsRead).toHaveBeenCalledWith({}, userId);
  });

  it('reports zero when nothing was unread and still closes the connection', async () => {
    dbMocks.markAllNotificationsRead.mockResolvedValue(0);
    const result = await markMyNotificationsAllReadRoute(request());
    expect(result.updated).toBe(0);
  });
});
