// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { BarChart } from './BarChart';

afterEach(cleanup);

describe('BarChart', () => {
  it('shows title, labels, and values as visible text', () => {
    render(
      <BarChart
        title="Laporan per status"
        data={[
          { label: 'REPORTED', value: 4 },
          { label: 'VERIFIED', value: 2 },
        ]}
      />,
    );
    expect(screen.getByRole('figure', { name: 'Laporan per status' })).toBeInTheDocument();
    expect(screen.getByText('Laporan per status')).toBeInTheDocument();
    expect(screen.getByText('REPORTED')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getByText('VERIFIED')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('sizes each bar relative to the largest value', () => {
    const { container } = render(
      <BarChart
        title="Ukuran"
        data={[
          { label: 'A', value: 4 },
          { label: 'B', value: 2 },
        ]}
      />,
    );
    const widths = [...container.querySelectorAll<HTMLElement>('div[style]')].map(
      (fill) => fill.style.width,
    );
    expect(widths).toEqual(['100%', '50%']);
  });

  it('renders a description when provided', () => {
    render(
      <BarChart
        title="Tren"
        data={[{ label: '1 Okt', value: 3, description: 'rata-rata 2 hari' }]}
      />,
    );
    expect(screen.getByText('rata-rata 2 hari')).toBeInTheDocument();
  });

  it('omits the description slot when absent', () => {
    render(<BarChart title="Tren" data={[{ label: '1 Okt', value: 3 }]} />);
    expect(screen.queryByText('rata-rata 2 hari')).not.toBeInTheDocument();
  });

  it('shows the default empty message when there is no data', () => {
    render(<BarChart title="Kosong" data={[]} />);
    expect(screen.getByText('Tidak ada data')).toBeInTheDocument();
  });

  it('honors a custom empty message', () => {
    render(<BarChart title="Kosong" data={[]} emptyMessage="Belum ada laporan" />);
    expect(screen.getByText('Belum ada laporan')).toBeInTheDocument();
  });

  it('renders zero-width bars without NaN when every value is zero', () => {
    const { container } = render(
      <BarChart
        title="Nol"
        data={[
          { label: 'A', value: 0 },
          { label: 'B', value: 0 },
        ]}
      />,
    );
    const fills = [...container.querySelectorAll<HTMLElement>('div[style]')];
    expect(fills).toHaveLength(2);
    for (const fill of fills) {
      expect(fill.style.width).toBe('0%');
    }
    expect(container.innerHTML).not.toContain('NaN');
  });

  it('renders a long label without crashing', () => {
    const label = 'Ruang rapat lantai tiga gedung utama sayap barat '.repeat(6).trim();
    render(<BarChart title="Panjang" data={[{ label, value: 1 }]} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });
});
