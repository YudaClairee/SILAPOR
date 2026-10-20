// @vitest-environment jsdom
// "Kelola Laporan" page contract (Figma 150:626): status tabs with counts,
// the search/filter card, the eight-column table (asset, location, priority
// score, status, reporter count, technician, date), numbered pagination, and
// the failure surfaces. Fetch is stubbed per URL (list + form options).
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Route } from './admin.reports.index';

const INITIAL_ENTRY = '/admin/reports';

function listPayload() {
  return {
    items: [
      {
        id: 'r1',
        ticketNumber: 'MNT-2026-000001',
        status: 'IN_REPAIR',
        finalPriority: 'HIGH',
        priorityScore: 88,
        assetName: 'Proyektor Epson EB-X400',
        locationName: 'Gedung C · Lt. 3 · Ruang 14',
        technicianName: 'Budi Santoso',
        reporterCount: 3,
        reportedAt: '2026-10-18T03:00:00.000Z',
      },
      {
        id: 'r2',
        ticketNumber: 'MNT-2026-000002',
        status: 'VERIFIED',
        finalPriority: 'MEDIUM',
        priorityScore: 62,
        assetName: 'AC Split Daikin 2 PK',
        locationName: 'Gedung Dr. Sutomo · Lt. 3 · Lab IoT',
        technicianName: null,
        reporterCount: 1,
        reportedAt: '2026-10-19T03:00:00.000Z',
      },
    ],
    total: 2,
    limit: 10,
    offset: 0,
    statusCounts: [
      { status: 'REPORTED', count: 0 },
      { status: 'VERIFIED', count: 1 },
      { status: 'ASSIGNED', count: 0 },
      { status: 'INSPECTION', count: 0 },
      { status: 'IN_REPAIR', count: 1 },
      { status: 'RESOLVED', count: 0 },
      { status: 'CLOSED', count: 0 },
    ],
  };
}

function stubFetch(listStatus = 200): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/admin/reports')) {
        return {
          status: listStatus,
          ok: listStatus === 200,
          json: async () => (listStatus === 200 ? listPayload() : {}),
        };
      }
      return {
        status: 200,
        ok: true,
        json: async () => ({ locations: [], categories: [], issueTypes: [], assets: [] }),
      };
    }),
  );
}

function renderPage(): void {
  const rootRoute = createRootRoute();
  const testRoute = Route.update({
    id: '/admin/reports/',
    path: '/admin/reports',
    getParentRoute: () => rootRoute,
  } as never);
  const router = createRouter({
    routeTree: rootRoute.addChildren([testRoute]),
    history: createMemoryHistory({ initialEntries: [INITIAL_ENTRY] }),
  });
  render(<RouterProvider router={router} />);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('admin kelola laporan', () => {
  it('renders the status tabs, table rows, and numbered pagination', async () => {
    stubFetch();
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Kelola Laporan' })).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText('Cari Ticket ID, nama aset, atau lokasi...'),
    ).toBeInTheDocument();

    const allTab = screen.getByRole('link', { name: /Semua/ });
    expect(allTab).toHaveTextContent('2');
    expect(allTab).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: /^VERIFIED/ })).toHaveTextContent('1');
    expect(screen.getByRole('link', { name: /^IN_REPAIR/ })).toHaveTextContent('1');

    expect(screen.getByRole('link', { name: '#MNT-2026-000001' }).getAttribute('href')).toBe(
      '/admin/reports/MNT-2026-000001',
    );
    const firstRow = screen.getByRole('link', { name: '#MNT-2026-000001' }).closest('tr');
    expect(firstRow).not.toBeNull();
    expect(
      within(firstRow as HTMLElement).getByText('Proyektor Epson EB-X400'),
    ).toBeInTheDocument();
    expect(
      within(firstRow as HTMLElement).getByText('Gedung C · Lt. 3 · Ruang 14'),
    ).toBeInTheDocument();
    expect(within(firstRow as HTMLElement).getByText('Tinggi (88)')).toBeInTheDocument();
    expect(within(firstRow as HTMLElement).getByText('IN_REPAIR')).toBeInTheDocument();
    expect(within(firstRow as HTMLElement).getByText('3 pelapor')).toBeInTheDocument();
    expect(within(firstRow as HTMLElement).getByText('Budi Santoso')).toBeInTheDocument();
    expect(within(firstRow as HTMLElement).getByText('18 Okt 2026')).toBeInTheDocument();
    expect(screen.getByText('Belum ditugaskan')).toBeInTheDocument();

    expect(screen.getByRole('combobox', { name: 'Urutan laporan' })).toHaveValue('priority_desc');
    expect(screen.getByText('Menampilkan 1–2 dari 2 tiket')).toBeInTheDocument();
  });

  it('opens the filter panel and links to the held verification queue', async () => {
    stubFetch();
    renderPage();

    await screen.findByRole('heading', { name: 'Kelola Laporan' });
    expect(screen.queryByLabelText('Kategori')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Filter/ }));
    expect(screen.getByLabelText('Kategori')).toBeInTheDocument();
    expect(screen.getByLabelText('Lokasi')).toBeInTheDocument();
    expect(screen.getByLabelText('Prioritas')).toBeInTheDocument();
    expect(screen.getByLabelText('ID Pelapor')).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: 'Buka antrian verifikasi manual (REPORTED)' }),
    ).toBeInTheDocument();
  });

  it('renders the forbidden panel for non-admin responses', async () => {
    stubFetch(403);
    renderPage();
    expect(await screen.findByText('Akses ditolak')).toBeInTheDocument();
  });

  it('surfaces a retryable load error', async () => {
    stubFetch(500);
    renderPage();
    expect(await screen.findByText('Gagal memuat laporan (500).')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Coba lagi' })).toBeInTheDocument();
  });
});
