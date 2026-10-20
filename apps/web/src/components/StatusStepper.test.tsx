// @vitest-environment jsdom
// StatusStepper (Reporter Detail V2): seven-step rail with three visual
// states. The non-colour signals matter most — the current step carries
// aria-current="step", every dot is an icon/number, and an unreached step says
// "Menunggu" instead of rendering an empty slot.
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { StatusStepper } from './StatusStepper';
import type { FlowTimestamps } from '../lib/ticket-detail';

const TIMESTAMPS: FlowTimestamps = {
  REPORTED: '2026-10-12T01:30:00.000Z',
  VERIFIED: '2026-10-12T02:15:00.000Z',
  ASSIGNED: '2026-10-12T03:00:00.000Z',
  INSPECTION: '2026-10-12T04:00:00.000Z',
  IN_REPAIR: '2026-10-12T05:00:00.000Z',
  RESOLVED: null,
  CLOSED: null,
};

function renderStepper(status = 'IN_REPAIR', timestamps: FlowTimestamps = TIMESTAMPS) {
  render(<StatusStepper status={status} timestamps={timestamps} />);
  return screen.getByRole('list', { name: 'Alur status penanganan' });
}

afterEach(cleanup);

describe('StatusStepper', () => {
  it('renders all seven steps in order', () => {
    const rail = renderStepper();
    expect(within(rail).getAllByRole('listitem')).toHaveLength(7);
    const labels = within(rail)
      .getAllByRole('listitem')
      .map((item) => item.querySelector('span.font-mono')?.textContent);
    expect(labels).toEqual([
      'REPORTED',
      'VERIFIED',
      'ASSIGNED',
      'INSPECTION',
      'IN_REPAIR',
      'RESOLVED',
      'CLOSED',
    ]);
  });

  it('marks exactly one current step and announces it for assistive tech', () => {
    const rail = renderStepper();
    const current = rail.querySelectorAll('[aria-current="step"]');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent('IN_REPAIR');
    expect(within(rail).getByText('Aktif Sekarang')).toBeInTheDocument();
  });

  it('shows the reached milestone times in WIB and "Menunggu" ahead of the flow', () => {
    const rail = renderStepper();
    expect(within(rail).getByText('12 Okt 08:30')).toBeInTheDocument();
    expect(within(rail).getByText('12 Okt 12:00')).toBeInTheDocument();
    expect(within(rail).getAllByText('Menunggu')).toHaveLength(2);
  });

  it('keeps every step upcoming for a freshly reported ticket', () => {
    const rail = renderStepper('REPORTED', {
      ...TIMESTAMPS,
      VERIFIED: null,
      ASSIGNED: null,
      INSPECTION: null,
      IN_REPAIR: null,
    });
    expect(rail.querySelectorAll('[aria-current="step"]')[0]).toHaveTextContent('REPORTED');
    expect(within(rail).getAllByText('Menunggu')).toHaveLength(6);
  });

  it('renders the whole rail as upcoming when the status is off the normal path', () => {
    const rail = renderStepper('REJECTED', {
      ...TIMESTAMPS,
      REPORTED: null,
      VERIFIED: null,
      ASSIGNED: null,
      INSPECTION: null,
      IN_REPAIR: null,
    });
    expect(rail.querySelector('[aria-current="step"]')).toBeNull();
    expect(screen.getByText(/di luar alur perbaikan normal/i)).toHaveTextContent('Ditolak');
    expect(within(rail).getByText('REPORTED')).toBeInTheDocument();
  });

  it('exposes the phase name of each step to screen readers', () => {
    const rail = renderStepper();
    expect(within(rail).getByText('Perbaikan Sedang Berlangsung')).toBeInTheDocument();
  });
});
