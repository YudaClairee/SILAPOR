// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Route } from './managerial';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('renders the managerial dashboard without admin drill-down links', async () => {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => ({
    status: 200,
    ok: true,
    json: async () => typeof input === 'string' && input.includes('/api/auth/me')
      ? { user: { role: 'MANAGERIAL', username: 'manajerial', nim: null } }
      : ({
      range: { from: null, to: null },
      cards: { totalReports: 1, activeReports: 1, inRepair: 0, highPriorityActive: 0, resolvedThisMonth: 0 },
      byStatus: [],
      byCategory: [],
      byLocation: [],
      byBuilding: [],
      resolutionTime: { sampleSize: 0, averageSeconds: null, medianSeconds: null },
      technicianWorkload: [],
      technicianCompletions: [],
      topAssets: [],
      trend: [],
      priorityQueue: [],
    }),
  })));
  const rootRoute = createRootRoute();
  const testRoute = Route.update({
    id: '/managerial',
    path: '/managerial',
    getParentRoute: () => rootRoute,
  } as never);
  const router = createRouter({
    routeTree: rootRoute.addChildren([testRoute]),
    history: createMemoryHistory({ initialEntries: ['/managerial'] }),
  });

  render(<RouterProvider router={router} />);

  expect(await screen.findByRole('heading', { name: 'Dashboard Manajerial' })).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /admin/i })).not.toBeInTheDocument();
});
