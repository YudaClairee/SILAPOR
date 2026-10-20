// @vitest-environment jsdom
// Admin technicians page contract (Figma 150:1484): breadcrumb + header +
// CTA Tambah Teknisi, kartu filter (pencarian + ketersediaan + toggle
// nonaktif), tabel 7 kolom dengan badge ketersediaan/tugas aktif/status,
// aksi Ubah + Nonaktifkan/Aktifkan, footer "Menampilkan a–b dari N".
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Route } from './admin.technicians';

function stubFetch(body: unknown, status = 200): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown) => ({
      status:
        typeof url === 'string' && url.includes('/api/admin/analytics/overview') ? 500 : status,
      ok:
        typeof url === 'string' && url.includes('/api/admin/analytics/overview')
          ? false
          : status >= 200 && status < 300,
      json: async () => body,
    })),
  );
}

function renderPage(): void {
  const rootRoute = createRootRoute();
  const testRoute = Route.update({
    id: '/admin/technicians',
    path: '/admin/technicians',
    getParentRoute: () => rootRoute,
  } as never);
  const router = createRouter({
    routeTree: rootRoute.addChildren([testRoute]),
    history: createMemoryHistory({ initialEntries: ['/admin/technicians'] }),
  });
  render(<RouterProvider router={router} />);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('kelola teknisi', () => {
  it('renders rows with availability, workload, status, and edit/deactivate actions', async () => {
    stubFetch([
      {
        id: 't1',
        technicianCode: 'TEK-01',
        displayName: 'Budi Santoso',
        specialty: 'Elektronik & Audio-Visual',
        isActive: true,
      },
    ]);
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Kelola Teknisi' })).toBeInTheDocument();
    expect(screen.getByText('Budi Santoso')).toBeInTheDocument();
    expect(screen.getByText('TEK-01')).toBeInTheDocument();
    expect(screen.getAllByText('Tersedia').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('0 tugas aktif')).toBeInTheDocument();
    expect(screen.getByText('Aktif')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tambah Teknisi' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ubah' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Nonaktifkan' })).toBeInTheDocument();
    expect(screen.getByText(/Menampilkan 1–1 dari 1 teknisi terdaftar/)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Cari nama atau spesialisasi teknisi/)).toBeInTheDocument();
  });

  it('shows empty state when no technicians exist', async () => {
    stubFetch([]);
    renderPage();
    expect(await screen.findByText('Belum ada teknisi')).toBeInTheDocument();
  });

  it('shows the forbidden panel for non-admin responses', async () => {
    stubFetch({}, 403);
    renderPage();
    expect(await screen.findByText('Akses ditolak')).toBeInTheDocument();
  });
});
