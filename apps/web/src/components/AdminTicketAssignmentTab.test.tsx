// @vitest-environment jsdom
// Regresi: dropdown teknisi di tab Penugasan harus terisi dari endpoint
// admin (sebelumnya baca options.technicians yang tidak pernah dikirim
// /api/reports/form-options sehingga selalu kosong).
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminTicketAssignmentTab } from './AdminTicketAssignmentTab';

const TECHS = [
  { id: 't1', technicianCode: 'TECH-001', displayName: 'Andi Pratama', isActive: true },
  { id: 't2', technicianCode: 'TECH-002', displayName: 'Budi Santoso', isActive: true },
  { id: 't3', technicianCode: 'TECH-999', displayName: 'Nonaktif X', isActive: false },
];

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: unknown) => {
      if (String(url).includes('/api/admin/technicians')) {
        return { ok: true, status: 200, json: async () => TECHS } as Response;
      }
      throw new Error('unexpected fetch ' + String(url));
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('AdminTicketAssignmentTab', () => {
  it('memuat nama teknisi aktif dari endpoint admin', async () => {
    render(
      <AdminTicketAssignmentTab
        ticket="MNT-2026-000001"
        report={{ status: 'VERIFIED', version: 1 }}
        options={null}
        onChanged={() => undefined}
      />,
    );
    expect(screen.getByText('Memuat teknisi…')).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Andi Pratama' })).toBeInTheDocument();
      expect(screen.getByRole('option', { name: 'Budi Santoso' })).toBeInTheDocument();
    });
    expect(screen.queryByRole('option', { name: 'Nonaktif X' })).not.toBeInTheDocument();
  });

  it('menampilkan pesan saat tidak ada teknisi aktif', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, json: async () => [] }) as Response),
    );
    render(
      <AdminTicketAssignmentTab
        ticket="MNT-2026-000001"
        report={{ status: 'VERIFIED', version: 1 }}
        options={null}
        onChanged={() => undefined}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText(/Belum ada teknisi aktif/)).toBeInTheDocument();
    });
  });
});
