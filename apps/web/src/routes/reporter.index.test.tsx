// @vitest-environment jsdom
// Reporter dashboard contract: summary cards + active list from the stubbed
// mine + notifications endpoints.
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Route } from './reporter.index';

function renderPage(): void {
  const rootRoute = createRootRoute();
  const testRoute = Route.update({
    id: '/reporter/',
    path: '/reporter/',
    getParentRoute: () => rootRoute,
  } as never);
  const router = createRouter({
    routeTree: rootRoute.addChildren([testRoute]),
    history: createMemoryHistory({ initialEntries: ['/reporter/'] }),
  });
  render(<RouterProvider router={router} />);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('ringkasan saya', () => {
  it('renders cards and the active ticket list', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('/api/notifications')) {
          return { status: 200, ok: true, json: async () => ({ unreadCount: 2, total: 5 }) };
        }
        return {
          status: 200,
          ok: true,
          json: async () => ({
            items: [{ id: 'r1', ticketNumber: 'MNT-2026-000001', status: 'REPORTED', reportedAt: '2026-10-18T02:00:00.000Z' }],
            total: 1,
          }),
        };
      }),
    );
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Ringkasan Saya' })).toBeInTheDocument();
    expect(screen.getByText('MNT-2026-000001')).toBeInTheDocument();
    expect(screen.getByText('Laporan aktif saya')).toBeInTheDocument();
  });

  it('shows empty state when the reporter has no active reports', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url).includes('/api/notifications')) {
          return { status: 200, ok: true, json: async () => ({ unreadCount: 0, total: 0 }) };
        }
        return { status: 200, ok: true, json: async () => ({ items: [], total: 0 }) };
      }),
    );
    renderPage();
    expect(await screen.findByText('Tidak ada laporan aktif')).toBeInTheDocument();
  });
});
