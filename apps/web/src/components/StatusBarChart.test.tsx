// @vitest-environment jsdom
// StatusBarChart contract: one column per *active* pipeline stage, Indonesian
// labels from the shared status map, and a visually hidden table that repeats
// every number for assistive tech.
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { StatusBarChart, statusBarTone } from './StatusBarChart';

afterEach(cleanup);

describe('StatusBarChart', () => {
  it('renders a column per active stage plus an accessible table', () => {
    render(
      <StatusBarChart
        title="Alur Status Tiket"
        subtitle="Sebaran tiket per tahap"
        data={[
          { status: 'REPORTED', value: 0 },
          { status: 'VERIFIED', value: 3 },
          { status: 'IN_REPAIR', value: 4 },
          { status: 'RESOLVED', value: 24 },
        ]}
      />,
    );

    expect(screen.getByRole('heading', { name: 'Alur Status Tiket' })).toBeInTheDocument();
    expect(screen.getByText('Sebaran tiket per tahap')).toBeInTheDocument();
    // Labels print in the plot and again in the hidden table.
    expect(screen.getAllByText('Terverifikasi')).toHaveLength(2);
    expect(screen.getByText('Dalam')).toBeInTheDocument();
    expect(screen.getByText('perbaikan')).toBeInTheDocument();

    // The zero-count stage disappears from the plot and the table.
    expect(screen.queryByText('Dilaporkan')).not.toBeInTheDocument();

    const table = screen.getByRole('table', { name: 'Alur Status Tiket' });
    expect(within(table).getAllByRole('row')).toHaveLength(4); // header + 3 stages
    expect(within(table).getByText('77,4%')).toBeInTheDocument(); // 24 / 31
  });

  it('keeps the plot decorative so the table is the single source of numbers', () => {
    const { container } = render(
      <StatusBarChart title="Alur" data={[{ status: 'CLOSED', value: 2 }]} />,
    );
    const plot = container.querySelector('svg');
    expect(plot).toHaveAttribute('aria-hidden', 'true');
    expect(plot).toHaveAttribute('role', 'presentation');
  });

  it('shows the empty message when every stage is zero', () => {
    render(
      <StatusBarChart
        title="Alur"
        data={[
          { status: 'REPORTED', value: 0 },
          { status: 'CLOSED', value: 0 },
        ]}
        emptyMessage="Belum ada tiket pada periode ini."
      />,
    );
    expect(screen.getByText('Belum ada tiket pada periode ini.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('renders an unknown status label without crashing', () => {
    render(<StatusBarChart title="Alur" data={[{ status: 'MENUNGGU_SPAREPART', value: 1 }]} />);
    expect(screen.getAllByText('MENUNGGU_SPAREPART')).toHaveLength(2);
  });

  it('derives semantic tones from the status family', () => {
    expect(statusBarTone('REPORTED')).toBe('active');
    expect(statusBarTone('IN_REPAIR')).toBe('active');
    expect(statusBarTone('RESOLVED')).toBe('success');
    expect(statusBarTone('CLOSED')).toBe('success');
    expect(statusBarTone('REJECTED')).toBe('danger');
    expect(statusBarTone('DUPLICATE')).toBe('muted');
  });
});
