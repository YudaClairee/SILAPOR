// @vitest-environment jsdom
// Admin analytics page contract: renders breakdown charts + resolution
// summary from the stubbed overview endpoint.
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Route } from './admin.analytics';

function overview() {
  return {
    range: { from: null, to: null },
    byStatus: [{ status: 'REPORTED', count: 3 }],
    byCategory: [{ categoryId: null, categoryName: null, count: 3 }],
    byLocation: [{ locationId: 'l1', locationName: 'Gedung C', count: 3 }],
    resolutionTime: { sampleSize: 1, averageSeconds: 86400, medianSeconds: 86400 },
  };
}

function renderPage(): void {
  const rootRoute = createRootRoute();
  const testRoute = Route.update({
    id: '/admin/analytics',
    path: '/admin/analytics',
    getParentRoute: () => rootRoute,
  } as never);
  const router = createRouter({
    routeTree: rootRoute.addChildren([testRoute]),
    history: createMemoryHistory({ initialEntries: ['/admin/analytics'] }),
  });
  render(<RouterProvider router={router} />);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('analytics', () => {
  it('renders charts and the resolution summary', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 200, ok: true, json: async () => overview() })));
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Analytics' })).toBeInTheDocument();
    expect(screen.getByRole('figure', { name: 'Laporan per kategori' })).toBeInTheDocument();
    expect(screen.getByRole('figure', { name: 'Laporan per lokasi' })).toBeInTheDocument();
    expect(screen.getByRole('figure', { name: 'Laporan per status' })).toBeInTheDocument();
    expect(screen.getByText(/Waktu penyelesaian/)).toBeInTheDocument();
  });

  it('shows the forbidden panel for non-admin responses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 403, ok: false, json: async () => ({}) })));
    renderPage();
    expect(await screen.findByText('Akses ditolak')).toBeInTheDocument();
  });
});
