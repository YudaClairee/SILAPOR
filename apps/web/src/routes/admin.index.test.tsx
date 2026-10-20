// @vitest-environment jsdom
// Dashboard page contract (Figma 150:191): mounts the real /admin route in a
// memory router with a stubbed overview fetch — KPI drill-downs, trend tabs,
// category/asset/technician panels, and the failure surfaces.
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Route } from './admin.index';

const ASSET_ID = '99999999-9999-4999-8999-999999999999';
const TECHNICIAN_ID = '44444444-4444-4444-8444-444444444444';
const INITIAL_ENTRY = '/admin?from=2026-10-01&to=2026-10-31';

const STATUSES = [
  ['REPORTED', 0],
  ['VERIFIED', 3],
  ['ASSIGNED', 3],
  ['INSPECTION', 2],
  ['IN_REPAIR', 4],
  ['RESOLVED', 24],
  ['CLOSED', 12],
] as const;

function overviewResponse() {
  return {
    range: { from: '2026-10-01', to: '2026-10-31' },
    cards: {
      totalReports: 48,
      activeReports: 44,
      inRepair: 4,
      highPriorityActive: 3,
      resolvedThisMonth: 36,
    },
    byStatus: STATUSES.map(([status, count]) => ({ status, count })),
    byCategory: [
      { categoryId: '11111111-1111-4111-8111-111111111111', categoryName: 'Elektronik', count: 16 },
      {
        categoryId: '22222222-2222-4222-8222-222222222222',
        categoryName: 'Pendingin Ruangan (AC)',
        count: 12,
      },
      {
        categoryId: '33333333-3333-4333-8333-333333333333',
        categoryName: 'Kelistrikan & Penerangan',
        count: 9,
      },
      {
        categoryId: '55555555-5555-4555-8555-555555555555',
        categoryName: 'Sanitasi & Perpipaan',
        count: 7,
      },
      {
        categoryId: '66666666-6666-4666-8666-666666666666',
        categoryName: 'Furnitur & Sarana Ruang',
        count: 4,
      },
    ],
    byLocation: [
      {
        locationId: '77777777-7777-4777-8777-777777777777',
        locationName: 'Ruang Kuliah 01',
        count: 22,
      },
    ],
    byBuilding: [
      { buildingCode: 'C', buildingName: 'Gedung C', count: 22 },
      { buildingCode: 'D', buildingName: 'Gedung Dr. Sutomo', count: 12 },
      { buildingCode: 'A', buildingName: 'Gedung Isola', count: 8 },
      { buildingCode: 'T', buildingName: 'Taman Digital & Area Lainnya', count: 6 },
    ],
    resolutionTime: { sampleSize: 36, averageSeconds: 99_000, medianSeconds: 86_400 },
    technicianWorkload: [
      { technicianId: TECHNICIAN_ID, technicianName: 'Budi Santoso', activeCount: 2 },
    ],
    technicianCompletions: [
      { technicianId: TECHNICIAN_ID, technicianName: 'Budi Santoso', completedCount: 14 },
      { technicianId: '44444444-4444-4444-8444-444444444445', technicianName: 'Hendra Wijaya', completedCount: 10 },
      { technicianId: '44444444-4444-4444-8444-444444444446', technicianName: 'Dedi Kurniawan', completedCount: 7 },
      { technicianId: '44444444-4444-4444-8444-444444444447', technicianName: 'Rian Permana', completedCount: 5 },
    ],
    topAssets: [
      {
        assetId: ASSET_ID,
        assetName: 'Proyektor Epson EB-X400',
        roomName: 'Ruang 14',
        buildingCode: 'C',
        buildingName: 'Gedung C',
        floorNumber: 3,
        count: 6,
      },
      {
        assetId: '99999999-9999-4999-8999-999999999998',
        assetName: 'AC Split Daikin Inverter 2 PK',
        roomName: 'Lab IoT',
        buildingCode: 'D',
        buildingName: 'Gedung Dr. Sutomo',
        floorNumber: 3,
        count: 5,
      },
    ],
    // Weekly buckets (01–07 Oct = 10 tickets / 32h, 08–14 = 15 / 28h, …).
    trend: [
      { date: '2026-10-01', reports: 10, resolvedCount: 2, resolutionSecondsTotal: 230_400 },
      { date: '2026-10-08', reports: 15, resolvedCount: 2, resolutionSecondsTotal: 201_600 },
      { date: '2026-10-15', reports: 13, resolvedCount: 2, resolutionSecondsTotal: 187_200 },
      { date: '2026-10-22', reports: 10, resolvedCount: 2, resolutionSecondsTotal: 172_800 },
    ],
    priorityQueue: [],
  };
}

function emptyResponse() {
  return {
    ...overviewResponse(),
    cards: {
      totalReports: 0,
      activeReports: 0,
      inRepair: 0,
      highPriorityActive: 0,
      resolvedThisMonth: 0,
    },
    byStatus: ['REPORTED', 'VERIFIED', 'ASSIGNED', 'INSPECTION', 'IN_REPAIR', 'RESOLVED', 'CLOSED'].map(
      (status) => ({ status, count: 0 }),
    ),
    byCategory: [],
    byLocation: [],
    byBuilding: [],
    resolutionTime: { sampleSize: 0, averageSeconds: null, medianSeconds: null },
    technicianWorkload: [],
    technicianCompletions: [],
    topAssets: [],
    trend: [],
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
    history: createMemoryHistory({ initialEntries: [INITIAL_ENTRY] }),
  });
  render(<RouterProvider router={router} />);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('admin dashboard', () => {
  it('renders the five KPI cards with period-scoped drill-down links', async () => {
    stubFetch(overviewResponse());
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();

    const total = await screen.findByRole('link', { name: /Total Laporan/ });
    expect(total).toHaveTextContent('48');
    expect(total.getAttribute('href')).toContain('from=2026-10-01');
    expect(total.getAttribute('href')).toContain('to=2026-10-31');

    // VERIFIED + ASSIGNED + INSPECTION, exactly as the card caption states.
    const active = screen.getByRole('link', { name: /Laporan Aktif/ });
    expect(active).toHaveTextContent('8');

    const inRepair = screen.getByRole('link', { name: /Dalam Perbaikan/ });
    expect(inRepair).toHaveTextContent('4');
    expect(inRepair.getAttribute('href')).toContain('status=IN_REPAIR');

    // RESOLVED + CLOSED inside the range.
    const resolved = screen.getByRole('link', { name: /Selesai/ });
    expect(resolved).toHaveTextContent('36');
    expect(resolved.getAttribute('href')).toContain('status=RESOLVED');

    expect(screen.getByText('27,5')).toBeInTheDocument();
    expect(screen.getByText('Jam')).toBeInTheDocument();
  });

  it('renders the trend chart with weekly buckets and switchable tabs', async () => {
    stubFetch(overviewResponse());
    renderPage();

    expect(
      await screen.findByRole('heading', { name: 'Tren Laporan dan Durasi Penanganan' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Laporan Masuk (Tiket)')).toBeInTheDocument();
    expect(screen.getByText('Rata-rata Durasi (Jam)')).toBeInTheDocument();

    const weekly = screen.getByRole('tab', { name: 'Mingguan' });
    expect(weekly).toHaveAttribute('aria-selected', 'true');
    expect(screen.getAllByText('Minggu 1').length).toBeGreaterThan(0);
    expect(screen.getAllByText('01–07 Okt').length).toBeGreaterThan(0);

    const daily = screen.getByRole('tab', { name: 'Harian' });
    fireEvent.click(daily);
    expect(screen.getByRole('tab', { name: 'Harian' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Mingguan' })).toHaveAttribute(
      'aria-selected',
      'false',
    );
  });

  it('renders the category donut legend with counts and percentages', async () => {
    stubFetch(overviewResponse());
    renderPage();

    expect(await screen.findByText('Kerusakan per Kategori Fasilitas')).toBeInTheDocument();
    expect(screen.getByText('Elektronik')).toBeInTheDocument();
    expect(screen.getByText('(33,3%)')).toBeInTheDocument();
    expect(screen.getByText('Pendingin Ruangan (AC)')).toBeInTheDocument();
    expect(screen.getByText('(25,0%)')).toBeInTheDocument();
  });

  it('folds categories beyond the API window into one remainder slice', async () => {
    const full = overviewResponse();
    stubFetch({ ...full, byCategory: full.byCategory.slice(0, 4) });
    renderPage();

    // 48 - (16 + 12 + 9 + 7) = 4 unsliced tickets, 8,3% of the donut total.
    expect(await screen.findByText('Kategori lainnya')).toBeInTheDocument();
    expect(screen.getByText('(8,3%)')).toBeInTheDocument();
    expect(screen.getByText('TOTAL TIKET')).toBeInTheDocument();
    expect(screen.getAllByText('48').length).toBe(2);
  });

  it('ranks buildings as raw counts with their share of the period total', async () => {
    stubFetch(overviewResponse());
    renderPage();

    expect(await screen.findByText('Lokasi Rawan Gangguan')).toBeInTheDocument();
    expect(screen.getByText('Gedung C')).toBeInTheDocument();
    expect(screen.getByText('22 tiket (45,8%)')).toBeInTheDocument();
    expect(screen.getByText('Gedung Dr. Sutomo')).toBeInTheDocument();
  });

  it('lists repeated assets with their composed location and report count', async () => {
    stubFetch(overviewResponse());
    renderPage();

    expect(await screen.findByText('Aset yang Sering Dilaporkan')).toBeInTheDocument();
    expect(screen.getByText('Proyektor Epson EB-X400')).toBeInTheDocument();
    expect(screen.getByText('Gedung C · Lt. 3 · Ruang 14')).toBeInTheDocument();
    expect(screen.getByText('6 Laporan')).toBeInTheDocument();
  });

  it('ranks technician completions with the resolved total badge', async () => {
    stubFetch(overviewResponse());
    renderPage();

    expect(await screen.findByText('Perbaikan Selesai per Teknisi')).toBeInTheDocument();
    expect(screen.getByText('Budi Santoso')).toBeInTheDocument();
    expect(screen.getByText('14 selesai')).toBeInTheDocument();
    expect(screen.getByText('Total: 36 Perbaikan Selesai')).toBeInTheDocument();
  });

  it('shows every panel empty state when the period has no data', async () => {
    stubFetch(emptyResponse());
    renderPage();

    expect(await screen.findByRole('link', { name: /Total Laporan/ })).toHaveTextContent('0');
    expect(screen.getByText('Belum ada laporan per gedung pada periode ini.')).toBeInTheDocument();
    expect(
      screen.getByText('Belum ada laporan berbasis aset pada periode ini.'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Belum ada perbaikan selesai pada periode ini.'),
    ).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('offers the rolling month picker including all periods', async () => {
    stubFetch(overviewResponse());
    renderPage();

    const picker = await screen.findByLabelText(/Periode laporan/);
    expect(picker).toHaveValue('2026-10');
    expect(screen.getByRole('option', { name: 'Oktober 2026 (Bulan Ini)' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Semua periode' })).toBeInTheDocument();
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
