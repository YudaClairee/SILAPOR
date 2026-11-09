// @vitest-environment jsdom
// LocationBarChart contract: a scaled horizontal bar per room, a shared
// 0…max axis, visible counts, and an honest empty state.
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { LocationBarChart } from './LocationBarChart';

afterEach(cleanup);

describe('LocationBarChart', () => {
  it('sizes every bar against the shared axis and prints the counts', () => {
    const { container } = render(
      <LocationBarChart
        title="Ruang Paling Sering Dilaporkan"
        subtitle="Enam ruang dengan laporan terbanyak"
        items={[
          { id: 'a', label: 'Ruang Kuliah 01', value: 20 },
          { id: 'b', label: 'Lab IoT', value: 10 },
        ]}
      />,
    );

    expect(
      screen.getByRole('heading', { name: 'Ruang Paling Sering Dilaporkan' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Ruang Kuliah 01')).toBeInTheDocument();
    expect(screen.getByText('Lab IoT')).toBeInTheDocument();
    // The count sits in the row; the axis above it repeats the tick values.
    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent('Ruang Kuliah 01');
    expect(rows[0]).toHaveTextContent('20');
    expect(rows[1]).toHaveTextContent('10');

    const widths = [...container.querySelectorAll<HTMLElement>('li span[style]')].map(
      (fill) => fill.style.width,
    );
    expect(widths).toEqual(['100%', '50%']);
    expect(container.innerHTML).not.toContain('NaN');
  });

  it('keeps the track decorative and the label readable in full on hover', () => {
    const label = 'Ruang Rapat Lantai Tiga Gedung Utama Sayap Barat';
    const { container } = render(
      <LocationBarChart title="Ruang" items={[{ id: 'a', label, value: 3 }]} />,
    );
    expect(screen.getByTitle(label)).toHaveTextContent(label);
    expect(container.querySelector('li span[aria-hidden="true"]')).toBeInTheDocument();
  });

  it('shows the empty message when there are no rooms', () => {
    render(
      <LocationBarChart
        title="Ruang"
        items={[]}
        emptyMessage="Belum ada laporan per ruang pada periode ini."
      />,
    );
    expect(screen.getByText('Belum ada laporan per ruang pada periode ini.')).toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('does not divide by zero when every count is zero', () => {
    const { container } = render(
      <LocationBarChart
        title="Ruang"
        items={[
          { id: 'a', label: 'Ruang A', value: 0 },
          { id: 'b', label: 'Ruang B', value: 0 },
        ]}
      />,
    );
    const widths = [...container.querySelectorAll<HTMLElement>('li span[style]')].map(
      (fill) => fill.style.width,
    );
    expect(widths).toEqual(['2%', '2%']);
    expect(container.innerHTML).not.toContain('NaN');
  });
});
