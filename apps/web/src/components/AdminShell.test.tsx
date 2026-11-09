// @vitest-environment jsdom
// Regresi menu nav admin: panel grup ("Fasilitas & Aset", "Data Master &
// Parameter") harus menutup sendiri setelah itemnya diklik. Sebelumnya panel
// memakai <details> native tanpa penutup, jadi tetap terbuka sampai summary
// dipencet ulang — termasuk setelah pindah halaman.
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { AdminShell } from './AdminShell';

const ADMIN_PATHS = [
  '/admin',
  '/admin/reports',
  '/admin/facilities',
  '/admin/facilities/$assetId',
  '/admin/facilities/history',
  '/admin/locations',
  '/admin/master-data',
  '/admin/categories',
  '/admin/technicians',
  '/admin/scoring',
  '/admin/maintenance-report',
  '/admin/analytics',
] as const;

async function renderShell(initialPath: string) {
  const rootRoute = createRootRoute({
    component: () => (
      <AdminShell user={{ username: 'admin', nip: null }} onLogout={() => {}}>
        <p>konten admin</p>
      </AdminShell>
    ),
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren(
      ADMIN_PATHS.map((path) =>
        createRoute({ getParentRoute: () => rootRoute, path, component: () => null }),
      ),
    ),
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  });
  render(<RouterProvider router={router} />);
  // Header tampil setelah rute pertama resolve.
  await screen.findAllByText('Fasilitas & Aset');
  return { router };
}

/** `index` 0 = panel desktop, 1 = panel di menu seluler. */
function groupSummary(label: string, index = 0): HTMLElement {
  const summary = screen.getAllByText(label, { selector: 'summary' })[index];
  expect(summary).toBeDefined();
  return summary as HTMLElement;
}

function groupDetails(label: string, index = 0): HTMLDetailsElement {
  const details = groupSummary(label, index).closest('details');
  expect(details).toBeInstanceOf(HTMLDetailsElement);
  return details as HTMLDetailsElement;
}

afterEach(cleanup);

describe('AdminShell nav group', () => {
  it('menutup panel grup setelah itemnya diklik, walau tetap di halaman yang sama', async () => {
    await renderShell('/admin/facilities');
    const details = groupDetails('Fasilitas & Aset');
    details.open = true;

    fireEvent.click(within(details).getByRole('link', { name: 'Kelola Aset' }));

    await waitFor(() => expect(details.open).toBe(false));
  });

  it('menutup panel grup setelah pindah halaman ke item lain', async () => {
    await renderShell('/admin/facilities');
    const details = groupDetails('Data Master & Parameter');
    details.open = true;

    fireEvent.click(within(details).getByRole('link', { name: 'Teknisi' }));

    await waitFor(() => expect(details.open).toBe(false));
  });

  it('menutup panel saat navigasi riwayat (back/forward) dan bukan lewat item', async () => {
    const { router } = await renderShell('/admin/facilities');
    const details = groupDetails('Fasilitas & Aset');
    details.open = true;

    await act(async () => {
      await router.navigate({ to: '/admin/locations' });
    });

    await waitFor(() => expect(details.open).toBe(false));
  });

  it('menutup panel saat klik di luar dan saat Escape ditekan', async () => {
    await renderShell('/admin/facilities');
    const details = groupDetails('Fasilitas & Aset');

    details.open = true;
    fireEvent.mouseDown(document.body);
    expect(details.open).toBe(false);

    details.open = true;
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(details.open).toBe(false);
  });

  it('membiarkan panel terbuka selama klik terjadi di dalam panel', async () => {
    await renderShell('/admin/facilities');
    const details = groupDetails('Fasilitas & Aset');
    details.open = true;

    fireEvent.mouseDown(within(details).getByText('Histori Perbaikan Aset'));

    expect(details.open).toBe(true);
  });
});

// Pill active: grup induk menyala selama salah satu turunannya halaman aktif,
// supaya user tahu sedang berada di menu mana walau panelnya tertutup.
describe('AdminShell nav group active', () => {
  it('menyalakan grup Fasilitas & Aset di halaman turunannya', async () => {
    await renderShell('/admin/facilities');

    expect(groupSummary('Fasilitas & Aset')).toHaveClass('bg-accent');
    expect(groupSummary('Fasilitas & Aset')).toHaveClass('text-white');
    expect(groupSummary('Data Master & Parameter')).not.toHaveClass('bg-accent');
  });

  it('menyalakan grup Data Master & Parameter untuk turunannya', async () => {
    await renderShell('/admin/technicians');

    expect(groupSummary('Data Master & Parameter')).toHaveClass('bg-accent');
    expect(groupSummary('Fasilitas & Aset')).not.toHaveClass('bg-accent');
  });

  it('tetap menyala di sub-path seperti histori dan detail aset', async () => {
    await renderShell('/admin/facilities/history');
    expect(groupSummary('Fasilitas & Aset')).toHaveClass('bg-accent');

    cleanup();
    await renderShell('/admin/facilities/MNT-2026-000001');
    expect(groupSummary('Fasilitas & Aset')).toHaveClass('bg-accent');
  });

  it('tidak menyalakan grup mana pun di luar turunannya', async () => {
    await renderShell('/admin/reports');

    expect(groupSummary('Fasilitas & Aset')).not.toHaveClass('bg-accent');
    expect(groupSummary('Data Master & Parameter')).not.toHaveClass('bg-accent');
  });

  it('memindahkan pill active saat user berpindah grup', async () => {
    const { router } = await renderShell('/admin/locations');
    expect(groupSummary('Fasilitas & Aset')).toHaveClass('bg-accent');

    await act(async () => {
      await router.navigate({ to: '/admin/scoring' });
    });

    await waitFor(() => expect(groupSummary('Data Master & Parameter')).toHaveClass('bg-accent'));
    expect(groupSummary('Fasilitas & Aset')).not.toHaveClass('bg-accent');
  });
});
