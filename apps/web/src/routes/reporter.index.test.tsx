// @vitest-environment jsdom
// Reporter V2 dashboard contract: KPI strip + campus table from the stubbed
// stats/reports endpoints, and the empty state when no rows match.
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Route } from './reporter.index';

function renderPage(): void {
  const rootRoute = createRootRoute();
  const testRoute = Route.update({
    id: '/reporter/',
    path: '/reporter/',
    getParentRoute: () => rootRoute,
  } as never);
  const router = createRouter({
    routeTree: rootRoute.addChildren([testRoute]),
    history: createMemoryHistory({ initialEntries: ['/reporter/'] }),
  });
  render(<RouterProvider router={router} />);
}

const STATS = {
  total: 28,
  active: 6,
  inRepair: 3,
  done: 22,
  mineTotal: 3,
};

const ROW = {
  id: 'r1',
  ticketNumber: 'MNT-2026-000142',
  status: 'IN_REPAIR',
  finalPriority: 'HIGH',
  assetId: 'a1',
  assetName: 'Proyektor Epson EB-X400',
  locationId: 'l1',
  locationName: 'R. Kuliah 12',
  locationBuildingCode: 'C',
  locationFloorNumber: 3,
  reporterCount: 4,
  reportedAt: '2026-10-12T01:30:00.000Z',
  resolvedAt: null,
  closedAt: null,
  isOwn: true,
};

function stubFetch(reports: { readonly items: readonly unknown[]; readonly total: number }): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (String(url).includes('/api/reports/stats')) {
        return { status: 200, ok: true, json: async () => STATS };
      }
      return {
        status: 200,
        ok: true,
        json: async () => ({ ...reports, limit: 10, offset: 0 }),
      };
    }),
  );
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('pemantauan tiket', () => {
  it('renders KPI cards, the campus table, and the owner badge', async () => {
    stubFetch({ items: [ROW], total: 1 });
    renderPage();

    expect(
      await screen.findByRole('heading', { name: 'Pemantauan Tiket' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Total Laporan')).toBeInTheDocument();
    const totalCard = screen.getByText('Total Laporan').closest('article');
    expect(totalCard).not.toBeNull();
    if (totalCard !== null) {
      expect(within(totalCard).getByText('28')).toBeInTheDocument();
    }
    expect(screen.getByText('MNT-2026-000142')).toBeInTheDocument();
    expect(screen.getByText('Laporan Anda')).toBeInTheDocument();
    expect(screen.getByText('4 pelapor')).toBeInTheDocument();
    expect(screen.getByText('Proyektor Epson EB-X400')).toBeInTheDocument();
    expect(screen.getByText('R. Kuliah 12 · Gedung C · Lt. 3')).toBeInTheDocument();
  });

  it('shows the empty state when no rows match', async () => {
    stubFetch({ items: [], total: 0 });
    renderPage();

    expect(await screen.findByText('Belum ada laporan')).toBeInTheDocument();
  });
});
