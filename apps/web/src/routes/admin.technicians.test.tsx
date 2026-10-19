// @vitest-environment jsdom
// Admin technicians page contract: renders the stubbed technician list
// with the add form and archive toggles.
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
  it('renders rows with code, name, and archive action', async () => {
    stubFetch([{ id: 't1', technicianCode: 'TECH-001', displayName: 'Budi', specialty: 'Listrik', isActive: true }]);
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Kelola Teknisi' })).toBeInTheDocument();
    expect(screen.getByText('Budi')).toBeInTheDocument();
    expect(screen.getByText('TECH-001')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Arsipkan' })).toBeInTheDocument();
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
