// @vitest-environment jsdom
// Dashboard page contract (Phase 7 T6): mounts the real /admin route in a
// memory router with a stubbed overview fetch — cards, drill-down links,
// queue rows, charts, empty states, and failure surfaces.
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Route } from './admin.index';

const CATEGORY_ID = '11111111-1111-4111-8111-111111111111';
const REPORT_ID = '22222222-2222-4222-8222-222222222222';
const REPORT_ID_2 = '33333333-3333-4333-8333-333333333333';
const TECHNICIAN_ID = '44444444-4444-4444-8444-444444444444';
const REPORTED_AT = '2026-10-17T02:00:00.000Z';

const STATUSES = [
  'REPORTED',
  'VERIFIED',
  'ASSIGNED',
  'INSPECTION',
  'IN_REPAIR',
  'RESOLVED',
  'CLOSED',
] as const;

function overviewResponse() {
  return {
    range: { from: '2026-10-01', to: '2026-10-18' },
    cards: {
      totalReports: 12,
      activeReports: 9,
      inRepair: 2,
      highPriorityActive: 3,
      resolvedThisMonth: 4,
    },
    byStatus: [
      { status: 'REPORTED', count: 4 },
      { status: 'VERIFIED', count: 2 },
      { status: 'ASSIGNED', count: 1 },
      { status: 'INSPECTION', count: 1 },
      { status: 'IN_REPAIR', count: 2 },
      { status: 'RESOLVED', count: 1 },
      { status: 'CLOSED', count: 1 },
    ],
    byCategory: [
      { categoryId: CATEGORY_ID, categoryName: 'HVAC', count: 7 },
      { categoryId: null, categoryName: null, count: 5 },
    ],
    byLocation: [
      {
        locationId: '55555555-5555-4555-8555-555555555555',
        locationName: 'Ruang 101',
        count: 12,
      },
    ],
    resolutionTime: { sampleSize: 3, averageSeconds: 172800, medianSeconds: 172800 },
    technicianWorkload: [
      { technicianId: TECHNICIAN_ID, technicianName: 'Budi', activeCount: 2 },
      { technicianId: TECHNICIAN_ID, technicianName: 'Sari', activeCount: 1 },
    ],
    priorityQueue: [
      {
        reportId: REPORT_ID,
        ticketNumber: 'MNT-2026-000007',
        status: 'IN_REPAIR',
        finalPriority: 'HIGH',
        reportedAt: REPORTED_AT,
      },
      {
        reportId: REPORT_ID_2,
        ticketNumber: 'MNT-2026-000003',
        status: 'REPORTED',
        finalPriority: null,
        reportedAt: '2026-10-16T02:00:00.000Z',
      },
    ],
  };
}

function emptyResponse() {
  return {
    range: { from: null, to: null },
    cards: {
      totalReports: 0,
      activeReports: 0,
      inRepair: 0,
      highPriorityActive: 0,
      resolvedThisMonth: 0,
    },
    byStatus: STATUSES.map((status) => ({ status, count: 0 })),
    byCategory: [],
    byLocation: [],
    resolutionTime: { sampleSize: 0, averageSeconds: null, medianSeconds: null },
    technicianWorkload: [],
    priorityQueue: [],
  };
}

function stubFetch(body: unknown, status = 200): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      status,
      ok: status >= 200 && status < 300,
      json: async () => body,
    })),
  );
}

function renderPage(): void {
  const rootRoute = createRootRoute();
  const testRoute = Route.update({
    id: '/admin/',
    path: '/admin/',
    getParentRoute: () => rootRoute,
  } as never);
  const router = createRouter({
    routeTree: rootRoute.addChildren([testRoute]),
    history: createMemoryHistory({ initialEntries: ['/admin'] }),
  });
  render(<RouterProvider router={router} />);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('admin dashboard', () => {
  it('renders the five overview cards with drill-down links', async () => {
    stubFetch(overviewResponse());
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();

    const total = await screen.findByRole('link', { name: /Total Laporan/ });
    expect(total).toHaveTextContent('12');
    expect(total.getAttribute('href')).toMatch(/^\/admin\/reports/);

    const active = screen.getByRole('link', { name: /Aktif/ });
    expect(active).toHaveTextContent('9');
    expect(active.getAttribute('href')).toMatch(/^\/admin\/reports/);

    const inRepair = screen.getByRole('link', { name: /Dalam Perbaikan/ });
    expect(inRepair).toHaveTextContent('2');
    expect(inRepair.getAttribute('href')).toContain('status=IN_REPAIR');

    const high = screen.getByRole('link', { name: /Prioritas Tinggi/ });
    expect(high).toHaveTextContent('3');
    expect(high.getAttribute('href')).toContain('priority=HIGH');

    const resolved = screen.getByRole('link', { name: /Selesai Bulan Ini/ });
    expect(resolved).toHaveTextContent('4');
    expect(resolved.getAttribute('href')).toContain('status=RESOLVED');
  });

  it('links queue rows to the report detail with status and priority badges', async () => {
    stubFetch(overviewResponse());
    renderPage();

    const ticketLink = await screen.findByRole('link', { name: 'MNT-2026-000007' });
    expect(ticketLink).toHaveAttribute('href', '/admin/reports/MNT-2026-000007');
    const row = ticketLink.closest('tr');
    expect(row).not.toBeNull();
    expect(row).toHaveTextContent('Dalam perbaikan');
    expect(row).toHaveTextContent('Tinggi');
    const expectedReported = new Date(REPORTED_AT).toLocaleString('id-ID', {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
    expect(within(row as HTMLElement).getByText(expectedReported)).toBeInTheDocument();

    const heldRow = screen.getByRole('link', { name: 'MNT-2026-000003' }).closest('tr');
    expect(heldRow).toHaveTextContent('Belum ditetapkan');
  });

  it('renders the queue, chart, and workload section headings with data', async () => {
    stubFetch(overviewResponse());
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Antrean prioritas' })).toBeInTheDocument();

    expect(screen.getByRole('figure', { name: 'Laporan per status' })).toBeInTheDocument();
    expect(screen.getByRole('figure', { name: 'Laporan per kategori' })).toBeInTheDocument();
    expect(screen.getByText('Ditutup')).toBeInTheDocument();
    expect(screen.getByText('Belum terklasifikasi')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Beban tugas teknisi' })).toBeInTheDocument();
    expect(screen.getByText('Budi')).toBeInTheDocument();
    expect(screen.getByText('2 tiket aktif')).toBeInTheDocument();
  });

  it('shows empty states when the range has no data', async () => {
    stubFetch(emptyResponse());
    renderPage();
    expect(await screen.findByText('Antrean prioritas kosong.')).toBeInTheDocument();

    expect(screen.getByRole('link', { name: /Total Laporan/ })).toHaveTextContent('0');
    expect(screen.getByRole('link', { name: /Aktif/ })).toHaveTextContent('0');
    expect(screen.getByText('Tidak ada laporan pada rentang ini.')).toBeInTheDocument();
    expect(screen.getByText('Belum ada data teknisi.')).toBeInTheDocument();
  });

  it('shows an error panel when the overview fetch fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );
    renderPage();

    expect(await screen.findByText(/Gagal memuat data dashboard/)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('shows the forbidden panel for non-admin responses', async () => {
    stubFetch(overviewResponse(), 403);
    renderPage();

    expect(await screen.findByText('Akses ditolak')).toBeInTheDocument();
  });
});
