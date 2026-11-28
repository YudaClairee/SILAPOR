// @vitest-environment jsdom
// Regresi: dropdown teknisi di tab Penugasan harus terisi dari endpoint
// admin (sebelumnya baca options.technicians yang tidak pernah dikirim
// /api/reports/form-options sehingga selalu kosong).
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

  it('hanya menampilkan card Penugasan Teknisi saat status VERIFIED', async () => {
    render(
      <AdminTicketAssignmentTab
        ticket="MNT-2026-000001"
        report={{ status: 'VERIFIED', version: 1 }}
        options={null}
        onChanged={() => undefined}
      />,
    );
    expect(screen.getByRole('region', { name: 'Penugasan Teknisi' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Catatan Progres & Transisi Status' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Lanjut ke ASSIGNED' })).not.toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Andi Pratama' })).toBeInTheDocument();
    });
  });

  it('menyembunyikan card Penugasan Teknisi dan menampilkan card Progres saat status ASSIGNED ke atas', () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const cases: ReadonlyArray<readonly [string, string, string]> = [
      ['ASSIGNED', 'Ditugaskan', 'Lanjut ke INSPECTION'],
      ['INSPECTION', 'Inspeksi', 'Lanjut ke IN_REPAIR'],
      ['IN_REPAIR', 'Dalam perbaikan', 'Lanjut ke RESOLVED'],
      ['RESOLVED', 'Selesai', 'Konfirmasi Penyelesaian'],
    ];

    for (const [status, statusText, nextButton] of cases) {
      render(
        <AdminTicketAssignmentTab
          ticket="MNT-2026-000001"
          report={{ status, version: 2 }}
          options={null}
          onChanged={() => undefined}
        />,
      );
      expect(screen.queryByRole('region', { name: 'Penugasan Teknisi' })).not.toBeInTheDocument();
      const progressCard = screen.getByRole('region', { name: 'Catatan Progres & Transisi Status' });
      expect(progressCard).toBeInTheDocument();
      expect(progressCard).toHaveTextContent(statusText);
      expect(screen.getByRole('button', { name: nextButton })).toBeInTheDocument();
      cleanup();
    }

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('menampilkan error validasi di dalam card Progres saat status ASSIGNED', () => {
    render(
      <AdminTicketAssignmentTab
        ticket="MNT-2026-000001"
        report={{ status: 'ASSIGNED', version: 2 }}
        options={null}
        onChanged={() => undefined}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Lanjut ke INSPECTION' }));
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Transisi ke INSPECTION wajib disertai catatan (min. 5 karakter).',
    );
  });

  it('menampilkan status tertutup tanpa form aksi saat status CLOSED', () => {
    render(
      <AdminTicketAssignmentTab
        ticket="MNT-2026-000001"
        report={{ status: 'CLOSED', version: 6 }}
        options={null}
        onChanged={() => undefined}
      />,
    );
    expect(screen.queryByRole('region', { name: 'Penugasan Teknisi' })).not.toBeInTheDocument();
    const progressCard = screen.getByRole('region', { name: 'Catatan Progres & Transisi Status' });
    expect(progressCard).toHaveTextContent('Ditutup');
    expect(progressCard).toHaveTextContent(/Laporan sudah ditutup/);
    expect(screen.queryByRole('button', { name: 'Tambah Catatan' })).not.toBeInTheDocument();
  });

  it('menampilkan pesan menunggu verifikasi saat status REPORTED', () => {
    render(
      <AdminTicketAssignmentTab
        ticket="MNT-2026-000001"
        report={{ status: 'REPORTED', version: 1 }}
        options={null}
        onChanged={() => undefined}
      />,
    );
    expect(screen.queryByRole('region', { name: 'Penugasan Teknisi' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Catatan Progres & Transisi Status' })).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Menunggu Verifikasi' })).toBeInTheDocument();
  });
});
