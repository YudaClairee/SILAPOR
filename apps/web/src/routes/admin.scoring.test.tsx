// @vitest-environment jsdom
// Pengaturan Scoring Prioritas (Figma 150:9390, admin/UMPER): bobot %,
// C_maks, ambang prioritas + dua tabel skor live dari endpoint master.
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route } from './admin.scoring';

const CATS = [
  { id: 'c1', code: 'ELECTRONIC', name: 'Elektronik', weight: 34, isActive: true },
  { id: 'c2', code: 'HVAC', name: 'Pendingin Ruangan (AC)', weight: 32, isActive: true },
  { id: 'c3', code: 'OTHER', name: 'Lainnya', weight: 20, isActive: true },
];

const LOCS = [
  {
    id: 'l1',
    type: 'ROOM',
    code: '22.4A.01.001',
    name: 'Lab IoT',
    buildingCode: 'I',
    floorNumber: 3,
    isActive: true,
    tierScore: 28,
  },
];

function mockFetch(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.includes('/api/admin/categories')) {
        return { ok: true, status: 200, json: async () => CATS } as Response;
      }
      return { ok: true, status: 200, json: async () => LOCS } as Response;
    }),
  );
}

function renderPage(): void {
  const rootRoute = createRootRoute();
  const testRoute = Route.update({
    id: '/admin/scoring',
    path: '/admin/scoring',
    getParentRoute: () => rootRoute,
  } as never);
  const router = createRouter({
    routeTree: rootRoute.addChildren([testRoute]),
    history: createMemoryHistory({ initialEntries: ['/admin/scoring'] }),
  });
  render(<RouterProvider router={router} />);
}

beforeEach(() => {
  mockFetch();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('pengaturan scoring prioritas', () => {
  it('menampilkan judul, breadcrumb, dan tombol simpan', async () => {
    renderPage();
    expect(
      await screen.findByRole('heading', { name: 'Pengaturan Scoring Prioritas' }),
    ).toBeInTheDocument();
    expect(screen.getByText('PENGATURAN SCORING')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Simpan Pengaturan/ })).toBeEnabled();
  });

  it('menampilkan default bobot 40/35/25 dengan total valid', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Pengaturan Scoring Prioritas' });
    await waitFor(() => {
      expect(screen.getByText('Total Bobot: 100% (Valid)')).toBeInTheDocument();
    });
  });

  it('menampilkan C_maks default 5 dan formula algoritma', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Pengaturan Scoring Prioritas' });
    const input = (await screen.findByLabelText(
      /Batas Maksimum Pelapor Pendukung/,
    )) as HTMLInputElement;
    expect(input.value).toBe('5');
    expect(screen.getByText('FORMULA ALGORITMA')).toBeInTheDocument();
    expect(screen.getByText(/Skor akhir tiket dihitung otomatis/)).toBeInTheDocument();
  });

  it('menampilkan ambang Rendah/Sedang/Tinggi dengan rentang valid', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Pengaturan Scoring Prioritas' });
    await waitFor(() => {
      expect(screen.getByText('Rendah')).toBeInTheDocument();
      expect(screen.getByText('Sedang')).toBeInTheDocument();
      expect(screen.getByText('Tinggi')).toBeInTheDocument();
      expect(screen.getByText('Rentang skor 0–100 tanpa celah (Valid)')).toBeInTheDocument();
    });
  });

  it('menampilkan skor kategori dari endpoint master', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Pengaturan Scoring Prioritas' });
    await waitFor(() => {
      expect(screen.getByText('Elektronik')).toBeInTheDocument();
    });
    const input = screen.getByLabelText('Skor kategori Elektronik') as HTMLInputElement;
    expect(input.value).toBe('85');
  });

  it('menampilkan skor lokasi dengan pencarian dan filter gedung', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Pengaturan Scoring Prioritas' });
    await waitFor(() => {
      expect(screen.getByText('Lab IoT')).toBeInTheDocument();
    });
    expect(screen.getByLabelText('Cari nama ruangan')).toBeInTheDocument();
    expect(screen.getByLabelText('Gedung:')).toBeInTheDocument();
    expect(screen.getByLabelText('Skor lokasi Lab IoT')).toBeInTheDocument();
  });

  it('menonaktifkan simpan saat total bobot bukan 100', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Pengaturan Scoring Prioritas' });
    await waitFor(() => {
      expect(screen.getByText('Total Bobot: 100% (Valid)')).toBeInTheDocument();
    });
    fireEvent.change(screen.getByLabelText(/Bobot Kategori Aset/), {
      target: { value: '10' },
    });
    await waitFor(() => {
      expect(screen.getByText(/harus 100%/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Simpan Pengaturan/ })).toBeDisabled();
    });
  });
});
