// @vitest-environment jsdom
// Regresi tab Riwayat admin: TimelineEntry modern (kind/at/label/detail)
// harus tampil label + timestamp + aktor + badge + catatan (sebelumnya
// dibaca sebagai bentuk legacy sehingga kosong/“—”).
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminTicketHistoryTab } from './AdminTicketHistoryTab';

const ENTRIES = [
  {
    id: 'e1',
    kind: 'event',
    at: '2026-10-17T09:00:00.000Z',
    actorId: null,
    label: 'REPORT_CREATED',
    detail: { eventType: 'REPORT_CREATED' },
  },
  {
    id: 'e2',
    kind: 'assignment',
    at: '2026-10-17T11:00:00.000Z',
    actorId: 'admin-1',
    label: 'ASSIGNMENT',
    detail: { technicianId: 't-1', reason: 'Spesialis proyektor' },
  },
  {
    id: 'e3',
    kind: 'update',
    at: '2026-10-17T12:00:00.000Z',
    actorId: 'admin-1',
    label: 'PROGRESS_NOTE_ADDED',
    detail: { message: 'Lampu diganti' },
  },
];

const TECHS = [{ id: 't-1', displayName: 'Andi Pratama', isActive: true }];

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown) => {
      const u = String(url);
      if (u.includes('/timeline')) {
        return { ok: true, status: 200, json: async () => ({ entries: ENTRIES }) } as Response;
      }
      if (u.includes('/api/admin/technicians')) {
        return { ok: true, status: 200, json: async () => TECHS } as Response;
      }
      throw new Error('unexpected fetch ' + u);
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderTab(): void {
  const rootRoute = createRootRoute({
    component: () => (
      <AdminTicketHistoryTab
        ticket="MNT-2026-000001"
        reportId="report-1"
        events={[]}
        relations={[]}
        duplicates={[]}
      />
    ),
  });
  const router = createRouter({
    routeTree: rootRoute,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  render(<RouterProvider router={router} />);
}

describe('AdminTicketHistoryTab', () => {
  it('menampilkan linimasa informatif dari TimelineEntry', async () => {
    renderTab();
    expect(await screen.findByText('Laporan dibuat')).toBeInTheDocument();
    expect(screen.getByText('Teknisi ditugaskan')).toBeInTheDocument();
    expect(screen.getByText('Catatan progres')).toBeInTheDocument();
    // Badge status + aktor + catatan + nama teknisi + footnote WIB.
    expect(screen.getByText('Dilaporkan')).toBeInTheDocument();
    expect(screen.getByText('Ditugaskan')).toBeInTheDocument();
    expect(screen.getAllByText('Sistem SCMS').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Admin/UMPER').length).toBeGreaterThan(0);
    expect(screen.getByText(/Lampu diganti/)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText(/Teknisi: Andi Pratama/)).toBeInTheDocument();
    });
    expect(screen.getByText(/Waktu Indonesia Barat/)).toBeInTheDocument();
    expect(screen.getByText(/3 aktivitas tercatat/)).toBeInTheDocument();
  });
});
