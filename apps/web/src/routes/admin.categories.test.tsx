// @vitest-environment jsdom
// Admin categories page contract: two tables (categories + issue types)
// with add forms and archive toggles.
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Route } from './admin.categories';

function stubFetch(url: string): { status: number; ok: boolean; json: () => Promise<unknown> } {
  if (url.includes('/api/admin/categories')) {
    return { status: 200, ok: true, json: async () => [{ id: 'c1', code: 'HVAC', name: 'AC', weight: 35, isActive: true }] };
  }
  return { status: 200, ok: true, json: async () => [{ id: 'i1', code: 'LEAKING', name: 'Bocor', categoryId: null, isActive: true }] };
}

function renderPage(): void {
  const rootRoute = createRootRoute();
  const testRoute = Route.update({
    id: '/admin/categories',
    path: '/admin/categories',
    getParentRoute: () => rootRoute,
  } as never);
  const router = createRouter({
    routeTree: rootRoute.addChildren([testRoute]),
    history: createMemoryHistory({ initialEntries: ['/admin/categories'] }),
  });
  render(<RouterProvider router={router} />);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('kelola kategori', () => {
  it('renders both tables with rows', async () => {
    vi.stubGlobal('fetch', vi.fn(async (u: string) => stubFetch(u)));
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Kelola Kategori' })).toBeInTheDocument();
    expect(screen.getByText('HVAC')).toBeInTheDocument();
    expect(await screen.findByText('LEAKING')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tambah kategori' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Tambah jenis masalah' })).toBeInTheDocument();
  });

  it('shows the forbidden panel for non-admin responses', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ status: 403, ok: false, json: async () => ({}) })));
    renderPage();
    expect(await screen.findByText('Akses ditolak')).toBeInTheDocument();
  });
});
