// Workflow transport service tests (Phase 5 P5-5). Pure body
// normalization only — no DB, no HTTP: route-level handler tests are
// impractical (Start server handlers), so live route checks are proven
// with fetch in the task report instead.
//
// Covers: expectedVersion presence/integer enforcement (single shared 400
// message), camelCase + snake_case acceptance per mutation normalizer, and
// resolveReportId reuse (admin unscoped resolution lives in reports.ts and
// is covered there — workflow services delegate to it).
import { describe, expect, it } from 'vitest';
import { toHttpResponse } from '@silapor/shared';
import {
  normalizeAssignBody,
  normalizeTransitionBody,
  normalizeUpdateBody,
  requireExpectedVersion,
} from './workflow.js';

function httpOf(fn: () => unknown): { status: number; message: string } {
  try {
    fn();
  } catch (error) {
    const mapped = toHttpResponse(error);
    const body = mapped.body as { error: { message: string } };
    return { status: mapped.status, message: body.error.message };
  }
  throw new Error('expected normalizer to throw');
}

describe('requireExpectedVersion', () => {
  it('accepts a present integer version', () => {
    expect(requireExpectedVersion({ expectedVersion: 3 })).toBe(3);
    expect(requireExpectedVersion({ expected_version: 0 })).toBe(0);
  });

  it('400s with the shared message when missing or non-integer', () => {
    for (const body of [
      {},
      null,
      undefined,
      'nope',
      [],
      { expectedVersion: undefined },
      { expectedVersion: null },
      { expectedVersion: '3' },
      { expectedVersion: 1.5 },
      { expectedVersion: Number.NaN },
    ]) {
      expect(httpOf(() => requireExpectedVersion(body))).toEqual({
        status: 400,
        message: 'expectedVersion is required',
      });
    }
  });
});

describe('normalizeAssignBody', () => {
  it('reads technicianId plus optional reason', () => {
    expect(
      normalizeAssignBody({
        technicianId: '11111111-1111-1111-1111-111111111111',
        reason: 'Shift pagi tersedia',
        expectedVersion: 2,
      }),
    ).toEqual({
      technicianId: '11111111-1111-1111-1111-111111111111',
      reason: 'Shift pagi tersedia',
      expectedVersion: 2,
    });
  });

  it('accepts technician_id and leaves an absent reason absent', () => {
    expect(
      normalizeAssignBody({
        technician_id: '11111111-1111-1111-1111-111111111111',
        expectedVersion: 2,
      }),
    ).toEqual({
      technicianId: '11111111-1111-1111-1111-111111111111',
      reason: undefined,
      expectedVersion: 2,
    });
  });
});

describe('normalizeTransitionBody', () => {
  it('reads nextStatus plus optional note', () => {
    expect(
      normalizeTransitionBody({
        nextStatus: 'INSPECTION',
        note: 'Mulai inspeksi lapangan',
        expectedVersion: 3,
      }),
    ).toEqual({ nextStatus: 'INSPECTION', note: 'Mulai inspeksi lapangan', expectedVersion: 3 });
  });

  it('accepts next_status and message aliases', () => {
    expect(
      normalizeTransitionBody({
        next_status: 'IN_REPAIR',
        message: 'Mulai perbaikan segera',
        expectedVersion: 3,
      }),
    ).toEqual({ nextStatus: 'IN_REPAIR', note: 'Mulai perbaikan segera', expectedVersion: 3 });
  });
});

describe('normalizeUpdateBody', () => {
  it('reads condition + message plus version', () => {
    expect(
      normalizeUpdateBody({
        condition: 'LAPORAN_PALSU',
        message: 'Kerusakan tidak ditemukan saat pemeriksaan',
        expectedVersion: 6,
      }),
    ).toEqual({
      condition: 'LAPORAN_PALSU',
      message: 'Kerusakan tidak ditemukan saat pemeriksaan',
      expectedVersion: 6,
    });
  });

  it('accepts an absent condition', () => {
    expect(
      normalizeUpdateBody({
        message: 'Perbaikan dimulai hari ini',
        expectedVersion: 6,
      }),
    ).toEqual({
      condition: undefined,
      message: 'Perbaikan dimulai hari ini',
      expectedVersion: 6,
    });
  });

  it('rejects the retired visibility field', () => {
    expect(
      httpOf(() =>
        normalizeUpdateBody({
          visibility: 'PUBLIC',
          message: 'Pesan cukup panjang',
          expectedVersion: 6,
        }),
      ),
    ).toEqual({
      status: 400,
      message: 'visibility is no longer supported; use condition',
    });
  });

  it('400s every normalizer when the version is missing', () => {
    const bodies: Array<() => unknown> = [
      () => normalizeAssignBody({ technicianId: '11111111-1111-1111-1111-111111111111' }),
      () => normalizeTransitionBody({ nextStatus: 'INSPECTION' }),
      () => normalizeUpdateBody({ condition: null, message: 'Pesan cukup panjang' }),
    ];
    for (const run of bodies) {
      expect(httpOf(run)).toEqual({ status: 400, message: 'expectedVersion is required' });
    }
  });
});
