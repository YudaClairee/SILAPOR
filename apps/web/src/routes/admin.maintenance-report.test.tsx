// @vitest-environment jsdom
// Maintenance report page contract (Phase 7 T8, UI No. 11 mock): three
// static BarCharts plus a per-period table; PDF export stays a stub.
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { Route } from './admin.maintenance-report';

function renderPage(): void {
  const rootRoute = createRootRoute();
  const testRoute = Route.update({
    id: '/admin/maintenance-report',
    path: '/admin/maintenance-report',
    getParentRoute: () => rootRoute,
  } as never);
  const router = createRouter({
    routeTree: rootRoute.addChildren([testRoute]),
    history: createMemoryHistory({ initialEntries: ['/admin/maintenance-report'] }),
  });
  render(<RouterProvider router={router} />);
}

afterEach(() => {
  cleanup();
});

describe('laporan maintenance', () => {
  it('renders the heading and marks the mock data as contoh', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Laporan Maintenance' })).toBeInTheDocument();
    expect(screen.getByText(/Data contoh/)).toBeInTheDocument();
  });

  it('renders the trend chart with period labels, counts, and average durations', async () => {
    renderPage();
    const chart = await screen.findByRole('figure', { name: 'Tren laporan' });
    const lastRow = within(chart).getByText('12–18 Okt').closest('li');
    expect(lastRow).not.toBeNull();
    const row = within(lastRow as HTMLElement);
    expect(row.getByText('14')).toBeInTheDocument();
    expect(row.getByText('Rata-rata durasi: 1 hari 12 jam')).toBeInTheDocument();
    expect(within(chart).getByText('28 Sep–4 Okt')).toBeInTheDocument();
  });

  it('renders the technician workload chart', async () => {
    renderPage();
    const chart = await screen.findByRole('figure', { name: 'Beban tugas per teknisi' });
    const andiRow = within(chart).getByText('Andi Pratama').closest('li');
    expect(andiRow).not.toBeNull();
    expect(within(andiRow as HTMLElement).getByText('4')).toBeInTheDocument();
    expect(within(chart).getByText('Siti Rahayu')).toBeInTheDocument();
    expect(within(chart).getByText('Budi Santoso')).toBeInTheDocument();
  });

  it('renders the category and building chart', async () => {
    renderPage();
    const chart = await screen.findByRole('figure', { name: 'Tiket per kategori & gedung' });
    const electricalRow = within(chart).getByText('Listrik dan lampu — Gedung A').closest('li');
    expect(electricalRow).not.toBeNull();
    expect(within(electricalRow as HTMLElement).getByText('7')).toBeInTheDocument();
    expect(within(chart).getByText('AC dan pendingin — Gedung B')).toBeInTheDocument();
    expect(within(chart).getByText('Toilet dan sanitasi — Gedung C')).toBeInTheDocument();
    expect(
      within(chart).getByText('Elektronik komputer dan jaringan — Gedung A'),
    ).toBeInTheDocument();
  });

  it('renders the per-period table with its four columns', async () => {
    renderPage();
    const table = await screen.findByRole('table', { name: 'Tiket per periode' });
    for (const column of ['Periode', 'Jumlah', 'Selesai', 'Rata-rata durasi']) {
      expect(within(table).getByRole('columnheader', { name: column })).toBeInTheDocument();
    }
    const lastRow = within(table).getByText('12–18 Okt').closest('tr');
    expect(lastRow).not.toBeNull();
    const row = within(lastRow as HTMLElement);
    expect(row.getByText('14')).toBeInTheDocument();
    expect(row.getByText('11')).toBeInTheDocument();
    expect(row.getByText('1 hari 12 jam')).toBeInTheDocument();
  });

  it('keeps the PDF export disabled with the endpoint note', async () => {
    renderPage();
    expect(await screen.findByRole('button', { name: 'Ekspor PDF' })).toBeDisabled();
    expect(screen.getByText(/Endpoint menyusul/)).toBeInTheDocument();
  });
});
