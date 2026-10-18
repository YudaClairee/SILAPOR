// @vitest-environment jsdom
// Scoring settings page contract (Phase 7 T7, UI No. 11 mock): the page is
// local-state only until the endpoint lands, so the submit stays disabled.
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { Route } from './admin.scoring';

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

afterEach(() => {
  cleanup();
});

describe('pengaturan scoring', () => {
  it('renders the heading, the four weight defaults, and editable inputs', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Pengaturan Scoring' })).toBeInTheDocument();

    const defaults: ReadonlyArray<readonly [string, number]> = [
      ['Bobot kategori', 35],
      ['Bobot aset', 25],
      ['Bobot lokasi', 25],
      ['Bobot frekuensi pelapor', 15],
    ];
    for (const [label, value] of defaults) {
      expect(screen.getByLabelText(label)).toHaveValue(value);
    }

    const category = screen.getByLabelText('Bobot kategori');
    fireEvent.change(category, { target: { value: '20' } });
    expect(category).toHaveValue(20);

    expect(screen.getByLabelText('Batas jumlah pelapor')).toHaveValue(5);
  });

  it('maps score ranges to priority levels', async () => {
    renderPage();
    const table = await screen.findByRole('table', { name: 'Ambang prioritas' });
    const mapping: ReadonlyArray<readonly [string, string]> = [
      ['0–39', 'LOW'],
      ['40–69', 'MEDIUM'],
      ['70–100', 'HIGH'],
    ];
    for (const [range, priority] of mapping) {
      const row = within(table).getByText(range).closest('tr');
      expect(row).not.toBeNull();
      expect(within(row as HTMLElement).getByText(priority)).toBeInTheDocument();
    }
  });

  it('renders mock per-category scores for the seed categories', async () => {
    renderPage();
    const table = await screen.findByRole('table', { name: 'Skor per kategori aset/ruangan' });
    const hvacRow = within(table).getByText('HVAC').closest('tr');
    expect(hvacRow).not.toBeNull();
    expect(within(hvacRow as HTMLElement).getByText('AC dan pendingin')).toBeInTheDocument();
    expect(hvacRow).toHaveTextContent('35');
    expect(within(table).getByText('ELECTRICAL')).toBeInTheDocument();
    expect(within(table).getByText('Listrik dan lampu')).toBeInTheDocument();
  });

  it('keeps submit disabled with the endpoint note visible', async () => {
    renderPage();
    expect(await screen.findByRole('button', { name: 'Simpan pengaturan' })).toBeDisabled();
    expect(screen.getByText(/Endpoint menyusul/)).toBeInTheDocument();
  });
});
