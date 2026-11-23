// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ManagerialDashboardScreen } from './ManagerialDashboard';

const response = {
  range: { from: '2026-10-01', to: '2026-10-31' },
  cards: { totalReports: 12, activeReports: 7, inRepair: 2, highPriorityActive: 3, resolvedThisMonth: 5 },
  byStatus: [],
  byCategory: [],
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
    reportedAt: '2026-10-01T01:00:00.000Z',
  }],
};

// Konstanta di luar render agar identitas props stabil dan efek tidak berulang.
const CLIENT_LOAD = { data: null, loadError: null, forbidden: false, needsClientLoad: true } as const;
const SEARCH = { from: '', to: '' } as const;

function renderPage(): void {
  const rootRoute = createRootRoute({
    component: () => (
      <ManagerialDashboardScreen loader={CLIENT_LOAD} search={SEARCH} onApply={() => {}} />
    ),
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  render(<RouterProvider router={router} />);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('dashboard manajerial', () => {
  it('renders decision cards, rankings, trend, and drill-down links', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      status: 200,
      ok: true,
      json: async () => response,
    })));

    renderPage();

    expect(await screen.findByRole('heading', { name: 'Dashboard Manajerial' })).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('Keluhan masuk')).toBeInTheDocument();
    expect(screen.getByText('Gedung A')).toBeInTheDocument();
    expect(screen.getAllByText('AC Ruang 101')).not.toHaveLength(0);
    expect(screen.getAllByText('Tren laporan harian')).not.toHaveLength(0);
    expect(screen.getByText('Rata-rata penyelesaian')).toBeInTheDocument();
    expect(screen.getByText('1 hari 1 jam')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /MNT-2026-000001/ })).toHaveAttribute(
      'href',
      '/admin/reports/MNT-2026-000001',
    );
    expect(screen.getByRole('link', { name: /AC Ruang 101/ })).toHaveAttribute(
      'href',
      '/admin/facilities/asset-1',
    );
  });

  it('renders an empty state for sections without ranking data', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      status: 200,
      ok: true,
      json: async () => ({ ...response, byLocation: [], topAssets: [], priorityQueue: [], trend: [] }),
    })));

    renderPage();

    expect(await screen.findByText('Belum ada lokasi pada periode ini.')).toBeInTheDocument();
    expect(screen.getAllByText('Belum ada aset pada periode ini.')).not.toHaveLength(0);
    expect(screen.getByText('Belum ada tren pada periode ini.')).toBeInTheDocument();
  });

  it('renders a page-level empty state when analytics has no reports', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      status: 200,
      ok: true,
      json: async () => ({
        ...response,
        cards: { totalReports: 0, activeReports: 0, inRepair: 0, highPriorityActive: 0, resolvedThisMonth: 0 },
        byStatus: [],
        byCategory: [],
        byLocation: [],
        byBuilding: [],
        resolutionTime: { sampleSize: 0, averageSeconds: null, medianSeconds: null },
        technicianWorkload: [],
        technicianCompletions: [],
        topAssets: [],
        trend: [],
        priorityQueue: [],
      }),
    })));

    renderPage();

    expect(await screen.findByText('Belum ada laporan pada rentang ini')).toBeInTheDocument();
  });

  it('renders forbidden and retryable error states', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      status: 403,
      ok: false,
      json: async () => ({}),
    })));
    renderPage();
    expect(await screen.findByText('Akses ditolak')).toBeInTheDocument();

    cleanup();
    vi.stubGlobal('fetch', vi.fn(async () => ({
      status: 500,
      ok: false,
      json: async () => ({}),
    })));
    renderPage();
    expect(await screen.findByText('Gagal memuat dashboard manajerial (500).')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Coba lagi' })).toBeInTheDocument();
  });
});
