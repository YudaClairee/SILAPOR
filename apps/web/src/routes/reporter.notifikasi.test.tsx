// @vitest-environment jsdom
// Reporter V2 notification list contract: status/ticket/place meta from the
// stubbed /api/notifications payload, the Semua/Belum Dibaca filters, and both
// mark-read actions (single row without a ticket, and mark-all).
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NOTIFICATIONS_CHANGED_EVENT } from '../lib/notification-events.js';
import { Route } from './reporter.notifikasi';

function renderPage(): void {
  const rootRoute = createRootRoute();
  const testRoute = Route.update({
    id: '/reporter/notifikasi',
    path: '/reporter/notifikasi',
    getParentRoute: () => rootRoute,
  } as never);
  const router = createRouter({
    routeTree: rootRoute.addChildren([testRoute]),
    history: createMemoryHistory({ initialEntries: ['/reporter/notifikasi'] }),
  });
  render(<RouterProvider router={router} />);
}

const LIST = {
  items: [
    {
      id: 'n1',
      type: 'STATUS_CHANGED',
      title: 'Status laporan diperbarui',
      message: 'Status penanganan Tiket MNT-2026-000210 telah diperbarui.',
      reportId: 'r1',
      ticketNumber: 'MNT-2026-000210',
      reportStatus: 'IN_REPAIR',
      assetName: 'Proyektor Epson EB-X400',
      locationName: 'R. Kuliah 12',
      locationBuildingCode: 'C',
      locationFloorNumber: 3,
      readAt: null,
      createdAt: '2026-01-03T10:00:00.000Z',
    },
    {
      id: 'n2',
      type: 'REPORT_VERIFIED',
      title: 'Laporan diverifikasi',
      message: 'Tiket MNT-2026-000209 telah diverifikasi admin.',
      reportId: null,
      ticketNumber: null,
      reportStatus: null,
      assetName: null,
      locationName: null,
      locationBuildingCode: null,
      locationFloorNumber: null,
      readAt: '2026-01-02T10:00:00.000Z',
      createdAt: '2026-01-02T09:00:00.000Z',
    },
    {
      id: 'n3',
      type: 'REPORT_ASSIGNED',
      title: 'Teknisi ditugaskan',
      message: 'Teknisi telah ditugaskan untuk menangani laporan Anda.',
      reportId: null,
      ticketNumber: null,
      reportStatus: null,
      assetName: null,
      locationName: null,
      locationBuildingCode: null,
      locationFloorNumber: null,
      readAt: null,
      createdAt: '2026-01-01T09:00:00.000Z',
    },
  ],
  total: 3,
  unreadCount: 2,
};

function jsonResponse(body: unknown): Response {
  return {
    status: 200,
    ok: true,
    headers: {
      get: (name: string) => (name.toLowerCase() === 'content-type' ? 'application/json' : null),
    },
    json: async () => body,
  } as unknown as Response;
}

function stubFetch(data: unknown = LIST) {
  const mock = vi.fn(async () => jsonResponse(data));
  vi.stubGlobal('fetch', mock);
  return mock;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('halaman notifikasi', () => {
  it('renders the unread pill, status badge, place meta, and WIB timestamp per row', async () => {
    stubFetch();
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Notifikasi' })).toBeInTheDocument();
    expect(screen.getByText('2 Belum Dibaca')).toBeInTheDocument();
    expect(screen.getByText('Semua (3)')).toBeInTheDocument();
    expect(screen.getByText('Belum Dibaca (2)')).toBeInTheDocument();

    expect(screen.getByText('Status laporan diperbarui')).toBeInTheDocument();
    expect(screen.getByText('MNT-2026-000210')).toBeInTheDocument();
    expect(screen.getByText('Dalam perbaikan')).toBeInTheDocument();
    expect(
      screen.getByText('Proyektor Epson EB-X400 · R. Kuliah 12 · Gedung C · Lt. 3'),
    ).toBeInTheDocument();
    expect(screen.getByText('3 Jan 2026, 17:00 WIB')).toBeInTheDocument();

    // Only rows that carry a ticket expose the detail affordance.
    expect(screen.getAllByRole('link', { name: /buka detail tiket/i })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: 'Tandai dibaca' })).toHaveLength(1);
  });

  it('filters to unread rows and back without refetching', async () => {
    stubFetch();
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Belum Dibaca (2)' }));
    expect(screen.getByText('Status laporan diperbarui')).toBeInTheDocument();
    expect(screen.getByText('Teknisi ditugaskan')).toBeInTheDocument();
    expect(screen.queryByText('Laporan diverifikasi')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Semua (3)' }));
    expect(screen.getByText('Laporan diverifikasi')).toBeInTheDocument();
  });

  it('marks a single ticket-less notification read locally', async () => {
    const mock = stubFetch();
    renderPage();

    fireEvent.click(await screen.findByRole('button', { name: 'Tandai dibaca' }));

    await waitFor(() => expect(screen.getByText('1 Belum Dibaca')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Tandai dibaca' })).not.toBeInTheDocument();
    expect(mock).toHaveBeenCalledWith(
      '/api/notifications/n3/read',
      expect.objectContaining({
        method: 'POST',
      }),
    );
  });

  it('marks all notifications read and reports the empty unread state', async () => {
    const mock = stubFetch();
    const changed = vi.fn();
    window.addEventListener(NOTIFICATIONS_CHANGED_EVENT, changed);
    try {
      renderPage();

      fireEvent.click(await screen.findByRole('button', { name: /tandai semua telah dibaca/i }));

      expect(
        await screen.findByText('Semua notifikasi telah ditandai dibaca.'),
      ).toBeInTheDocument();
      expect(screen.getByText('Semua telah dibaca')).toBeInTheDocument();
      expect(mock).toHaveBeenCalledWith(
        '/api/notifications/read-all',
        expect.objectContaining({ method: 'POST' }),
      );
      expect(screen.getByRole('button', { name: /tandai semua telah dibaca/i })).toBeDisabled();
      expect(changed).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener(NOTIFICATIONS_CHANGED_EVENT, changed);
    }
  });

  it('shows the empty state when the reporter has no notifications', async () => {
    stubFetch({ items: [], total: 0, unreadCount: 0 });
    renderPage();

    expect(await screen.findByText('Belum ada notifikasi')).toBeInTheDocument();
    // The empty-state CTA must stay on the V2 monitoring page (/reporter),
    // not the legacy "Tiket Kampus" list at /reporter/reports.
    const cta = screen.getByRole('link', { name: 'Lihat laporan saya' });
    expect(cta.getAttribute('href')?.startsWith('/reporter')).toBe(true);
    expect(cta.getAttribute('href')).not.toContain('/reporter/reports');
  });
});
