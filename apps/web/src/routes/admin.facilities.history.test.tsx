// @vitest-environment jsdom
// Admin asset-history page contract (Histori Perbaikan Aset, Figma 150:1264).
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Route } from './admin.facilities.history';

const ASSET_ID = '66666666-6666-6666-6666-666666666666';

function stubFetch(handlers: Record<string, { status?: number; body: unknown }>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const key = Object.keys(handlers).find((prefix) => url.startsWith(prefix));
      const handler = key === undefined ? undefined : handlers[key];
      const status = handler?.status ?? (handler === undefined ? 404 : 200);
      return {
        status,
        ok: status >= 200 && status < 300,
        json: async () => handler?.body ?? {},
      };
    }),
  );
}

function renderPage(initialEntries: string[] = ['/admin/facilities/history']): void {
  const rootRoute = createRootRoute();
  const testRoute = Route.update({
    id: '/admin/facilities/history',
    path: '/admin/facilities/history',
    getParentRoute: () => rootRoute,
  } as never);
  const router = createRouter({
    routeTree: rootRoute.addChildren([testRoute]),
    history: createMemoryHistory({ initialEntries }),
  });
  render(<RouterProvider router={router} />);
}

const ASSETS_BODY = {
  items: [
    {
      assetId: ASSET_ID,
      assetCode: 'AST-ELK-014',
      assetName: 'Proyektor Epson EB-X400',
      locationLabel: 'Gedung C · Lantai 3 · Ruang 14',
      categoryName: 'Elektronik',
      isActive: true,
    },
  ],
  total: 1,
  limit: 200,
  offset: 0,
};

function historyBody() {
  return {
    asset: {
      assetId: ASSET_ID,
      assetCode: 'AST-ELK-014',
      assetName: 'Proyektor Epson EB-X400',
      isActive: true,
      locationLabel: 'Gedung C · Lantai 3 · Ruang 14',
      categoryName: 'Elektronik',
      derivedStatus: 'IN_REPAIR',
    },
    items: [
      {
        reportId: '77777777-7777-7777-7777-777777777777',
        ticketNumber: 'SCMS-2026-0142',
        status: 'IN_REPAIR',
        reportedAt: '2026-10-18T01:30:00.000Z',
        resolvedAt: null,
        closedAt: null,
        finalPriority: 'HIGH',
        issueTypeName: 'Proyektor tidak menyala',
        technicianName: 'Budi Santoso',
      },
      {
        reportId: '88888888-8888-8888-8888-888888888888',
        ticketNumber: 'SCMS-2026-0089',
        status: 'CLOSED',
        reportedAt: '2026-07-14T03:15:00.000Z',
        resolvedAt: '2026-07-15T04:30:00.000Z',
        closedAt: '2026-07-15T04:30:00.000Z',
        finalPriority: 'MEDIUM',
        issueTypeName: 'Tampilan proyektor buram / tidak fokus',
        technicianName: 'Budi Santoso',
      },
    ],
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('histori perbaikan aset', () => {
  it('asks for an asset before any history loads', async () => {
    stubFetch({ '/api/facilities/status': { body: ASSETS_BODY } });
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Histori Perbaikan Aset' })).toBeInTheDocument();
    expect(screen.getByText('Pilih aset untuk melihat histori')).toBeInTheDocument();
    expect(screen.getByLabelText(/Pilih aset/)).toBeInTheDocument();
  });

  it('renders the Figma summary card and ticket rows after Tampilkan', async () => {
    stubFetch({
      '/api/facilities/status': { body: ASSETS_BODY },
      [`/api/admin/assets/${ASSET_ID}/history`]: { body: historyBody() },
    });
    renderPage([`/admin/facilities/history?assetId=${ASSET_ID}&period=all`]);
    expect(await screen.findByText('Proyektor Epson EB-X400')).toBeInTheDocument();
    expect(screen.getByText('Menampilkan 2 dari 2 tiket')).toBeInTheDocument();
    expect(screen.getByText('Proyektor tidak menyala')).toBeInTheDocument();
    expect(screen.getAllByText('Budi Santoso').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('1 hari 1 jam')).toBeInTheDocument();
    expect(screen.getByText('IN_REPAIR')).toBeInTheDocument();
    expect(screen.getByText('2 Tiket')).toBeInTheDocument();
  });

  it('shows the forbidden panel for non-admin responses', async () => {
    stubFetch({ '/api/facilities/status': { status: 403, body: { error: { message: 'forbidden' } } } });
    renderPage();
    expect(await screen.findByText('Akses ditolak')).toBeInTheDocument();
  });
});
