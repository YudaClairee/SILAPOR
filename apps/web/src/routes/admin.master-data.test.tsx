// @vitest-environment jsdom
// Data Master Referensi contract (Figma 150:2220): header + 3 tabs with
// counts, location filter card, 6-column table, pagination footer, and the
// forbidden/offline panels.
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Route } from './admin.master-data';

const LOCS = [
  {
    id: 'r1',
    type: 'ROOM',
    code: 'LOK-GDC-01',
    name: 'Ruang 1',
    buildingCode: 'C',
    floorNumber: 1,
    isActive: true,
  },
  {
    id: 'b1',
    type: 'BUILDING',
    code: 'C',
    name: 'Gedung C',
    buildingCode: 'C',
    floorNumber: null,
    isActive: true,
  },
];
const CATS = [
  { id: 'c1', code: 'ELECTRICAL', name: 'Listrik dan lampu', weight: 40, isActive: true },
];
const ISSUES = [{ id: 'i1', code: 'BROKEN', name: 'Rusak', categoryId: null, isActive: true }];

function stubFetch(url: string): { status: number; ok: boolean; json: () => Promise<unknown> } {
  if (url.includes('/api/admin/locations')) {
    return { status: 200, ok: true, json: async () => LOCS };
  }
  if (url.includes('/api/admin/categories')) {
    return { status: 200, ok: true, json: async () => CATS };
  }
  return { status: 200, ok: true, json: async () => ISSUES };
}

function renderPage(initial = '/admin/master-data'): void {
  const rootRoute = createRootRoute();
  const testRoute = Route.update({
    id: '/admin/master-data',
    path: '/admin/master-data',
    getParentRoute: () => rootRoute,
  } as never);
  const router = createRouter({
    routeTree: rootRoute.addChildren([testRoute]),
    history: createMemoryHistory({ initialEntries: [initial] }),
  });
  render(<RouterProvider router={router} />);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('data master referensi', () => {
  it('renders header, tabs, location filter, table, and pagination footer', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (u: string) => stubFetch(u)),
    );
    renderPage();
    expect(
      await screen.findByRole('heading', { name: 'Data Master Referensi' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Kategori Fasilitas/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Lokasi/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Jenis Masalah/ })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Cari kode, gedung, lantai/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tambah Lokasi' })).toBeInTheDocument();
    expect(screen.getByText('Ruang 1')).toBeInTheDocument();
    expect(screen.getAllByText('Gedung C').length).toBeGreaterThan(0);
    expect(screen.getByText(/Menampilkan 1–1 dari 1 lokasi/)).toBeInTheDocument();
  });

  it('shows the forbidden panel for non-admin responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ status: 403, ok: false, json: async () => ({}) })),
    );
    renderPage();
    expect(await screen.findByText('Akses ditolak')).toBeInTheDocument();
  });

  it('shows an error panel when the fetch fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      }),
    );
    renderPage();
    expect(await screen.findByText(/Tidak dapat terhubung/)).toBeInTheDocument();
  });
});
