// @vitest-environment jsdom
// Kelola Aset page contract (Figma 150:1748): breadcrumb + header + Tambah,
// condition cards per building, filter bar, 8-column table + pagination,
// and the failure surfaces. Fetch is stubbed per URL prefix.
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Route } from './admin.facilities.index';

const INITIAL_ENTRY = '/admin/facilities';

function statusBody() {
  return {
    items: [
      {
        assetId: 'a1',
        assetCode: 'AST-ELK-014',
        assetName: 'Proyektor Epson EB-X400',
        locationLabel: 'Gedung C · Lt. 3 · Ruang 3.2',
        buildingName: 'Gedung C',
        categoryName: 'Elektronik & Multimedia',
        categoryId: 'c1',
        derivedStatus: 'IN_REPAIR',
        isActive: true,
        activeReportCount: 1,
        lastUpdated: '2026-10-18T03:00:00.000Z',
        createdAt: '2023-05-10T02:00:00.000Z',
      },
      {
        assetId: 'a2',
        assetCode: 'AST-AC-008',
        assetName: 'AC Split Daikin Inverter 2 PK',
        locationLabel: 'Gedung Dr. Sutomo · Lt. 3 · Lab IoT',
        buildingName: 'Gedung Dr. Sutomo',
        categoryName: 'Pendingin Ruangan (AC)',
        categoryId: 'c2',
        derivedStatus: 'OPERATIONAL',
        isActive: true,
        activeReportCount: 0,
        lastUpdated: '2026-10-19T03:00:00.000Z',
        createdAt: '2022-04-01T02:00:00.000Z',
      },
    ],
    total: 2,
    limit: 200,
    offset: 0,
  };
}

function optionsBody() {
  return {
    locations: [],
    categories: [
      { id: 'c1', code: 'ELK', name: 'Elektronik & Multimedia' },
      { id: 'c2', code: 'AC', name: 'Pendingin Ruangan (AC)' },
    ],
    issueTypes: [],
    assets: [],
  };
}

function stubFetch(status = 200): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/api/facilities/status')) {
        return {
          status,
          ok: status === 200,
          json: async () => (status === 200 ? statusBody() : {}),
        };
      }
      return { status: 200, ok: true, json: async () => optionsBody() };
    }),
  );
}

function renderPage(): void {
  const rootRoute = createRootRoute();
  const testRoute = Route.update({
    id: '/admin/facilities/',
    path: '/admin/facilities',
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

describe('admin kelola aset', () => {
  it('renders the header, condition cards, filters, rows, and pagination', async () => {
    stubFetch();
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Kelola Aset' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Tambah Aset/ })).toBeInTheDocument();

    expect(
      screen.getByRole('heading', { name: 'Kondisi Fasilitas Per Lokasi Kampus' }),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Gedung C').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Gedung Dr. Sutomo').length).toBeGreaterThanOrEqual(1);

    expect(
      screen.getByPlaceholderText('Cari kode aset atau nama aset...'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Lokasi')).toBeInTheDocument();
    expect(screen.getByLabelText('Kategori')).toBeInTheDocument();
    expect(screen.getByLabelText('Status fasilitas')).toBeInTheDocument();
    expect(screen.getByText('Tampilkan aset nonaktif')).toBeInTheDocument();

    expect(screen.getByText('AST-ELK-014')).toBeInTheDocument();
    expect(screen.getByText('Proyektor Epson EB-X400')).toBeInTheDocument();
    expect(screen.getByText('2023')).toBeInTheDocument();
    expect(screen.getAllByText('In Repair').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('Menampilkan 1 - 2 dari 2 total aset kampus')).toBeInTheDocument();
  });

  it('filters rows by the search box', async () => {
    stubFetch();
    renderPage();
    await screen.findByText('AST-ELK-014');

    fireEvent.change(screen.getByPlaceholderText('Cari kode aset atau nama aset...'), {
      target: { value: 'daikin' },
    });
    expect(screen.queryByText('AST-ELK-014')).not.toBeInTheDocument();
    expect(screen.getByText('AST-AC-008')).toBeInTheDocument();
    expect(screen.getByText('Menampilkan 1 - 1 dari 1 total aset kampus')).toBeInTheDocument();
  });

  it('blocks Nonaktifkan for assets with active tickets', async () => {
    stubFetch();
    renderPage();
    await screen.findByText('AST-ELK-014');

    const blocked = screen.getByTitle('Aset memiliki tiket aktif');
    expect(blocked).toHaveTextContent('Nonaktifkan');
    expect(blocked.tagName).toBe('SPAN');
  });

  it('renders the forbidden panel for non-admin responses', async () => {
    stubFetch(403);
    renderPage();
    expect(await screen.findByText('Akses ditolak')).toBeInTheDocument();
  });

  it('surfaces a retryable load error', async () => {
    stubFetch(500);
    renderPage();
    expect(await screen.findByText('Gagal memuat aset (500).')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Coba lagi' })).toBeInTheDocument();
  });
});
