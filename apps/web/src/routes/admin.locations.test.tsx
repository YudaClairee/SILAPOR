// @vitest-environment jsdom
// Admin locations page contract: renders the stubbed location list,
// the add form, and the include-inactive + archive controls.
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Route } from './admin.locations';

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
    id: '/admin/locations',
    path: '/admin/locations',
    getParentRoute: () => rootRoute,
  } as never);
  const router = createRouter({
    routeTree: rootRoute.addChildren([testRoute]),
    history: createMemoryHistory({ initialEntries: ['/admin/locations'] }),
  });
  render(<RouterProvider router={router} />);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('kelola lokasi', () => {
  it('renders rows with code, name, type, and archive action', async () => {
    stubFetch([
      { id: '1', type: 'BUILDING', code: 'C', name: 'Gedung C', buildingCode: 'C', floorNumber: null, isActive: true },
    ]);
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Kelola Lokasi' })).toBeInTheDocument();
    expect(screen.getByText('Gedung C')).toBeInTheDocument();
    expect(screen.getByText('C')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Arsipkan' })).toBeInTheDocument();
  });

  it('shows empty state when no locations exist', async () => {
    stubFetch([]);
    renderPage();
    expect(await screen.findByText('Belum ada lokasi')).toBeInTheDocument();
  });

  it('shows the forbidden panel for non-admin responses', async () => {
    stubFetch({ error: { message: 'forbidden' } }, 403);
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
