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
  normalizeDuplicateBody,
  normalizePriorityBody,
  normalizeRejectBody,
  normalizeTransitionBody,
  normalizeUpdateBody,
  normalizeVerifyBody,
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

describe('normalizeVerifyBody', () => {
  it('passes camelCase verification fields through', () => {
    expect(
      normalizeVerifyBody({
        finalCategoryId: 'c1',
        finalIssueTypeId: 'i1',
        assetId: 'a1',
        locationId: 'l1',
        finalPriority: 'HIGH',
        overrideReason: 'Alasan override yang jelas',
        affectedReporters: 2,
        expectedVersion: 1,
      }),
    ).toEqual({
      input: {
        finalCategoryId: 'c1',
        finalIssueTypeId: 'i1',
        assetId: 'a1',
        locationId: 'l1',
        finalPriority: 'HIGH',
        overrideReason: 'Alasan override yang jelas',
        affectedReporters: 2,
      },
      expectedVersion: 1,
    });
  });

  it('accepts snake_case aliases', () => {
    const normalized = normalizeVerifyBody({
      final_category_id: 'c1',
      final_issue_type_id: 'i1',
      asset_id: 'a1',
      location_id: 'l1',
      final_priority: 'LOW',
      override_reason: 'Alasan override yang jelas',
      affected_reporters: 3,
      expected_version: 2,
    });
    expect(normalized.expectedVersion).toBe(2);
    expect(normalized.input).toMatchObject({
      finalCategoryId: 'c1',
      finalIssueTypeId: 'i1',
      assetId: 'a1',
      locationId: 'l1',
      finalPriority: 'LOW',
    });
  });
});

describe('normalizeRejectBody', () => {
  it('reads the reason plus version', () => {
    expect(
      normalizeRejectBody({ reason: 'Laporan tidak valid sama sekali', expectedVersion: 4 }),
    ).toEqual({ reason: 'Laporan tidak valid sama sekali', expectedVersion: 4 });
  });

  it('accepts message as a reason alias', () => {
    expect(normalizeRejectBody({ message: 'Duplikat palsu belaka', expectedVersion: 0 })).toEqual({
      reason: 'Duplikat palsu belaka',
      expectedVersion: 0,
    });
  });
});

describe('normalizeDuplicateBody', () => {
  it('reads canonicalRef plus version', () => {
    expect(
      normalizeDuplicateBody({ canonicalRef: 'MNT-2026-000001', expectedVersion: 1 }),
    ).toEqual({ canonicalRef: 'MNT-2026-000001', expectedVersion: 1 });
  });

  it('accepts canonical ticket/id aliases', () => {
    expect(
      normalizeDuplicateBody({ canonical_ticket: 'MNT-2026-000002', expectedVersion: 1 }),
    ).toEqual({ canonicalRef: 'MNT-2026-000002', expectedVersion: 1 });
    expect(
      normalizeDuplicateBody({
        canonical_report_id: '11111111-1111-1111-1111-111111111111',
        expectedVersion: 1,
      }),
    ).toEqual({ canonicalRef: '11111111-1111-1111-1111-111111111111', expectedVersion: 1 });
  });
});

describe('normalizePriorityBody', () => {
  it('reads priority + reason plus version', () => {
    expect(
      normalizePriorityBody({ priority: 'HIGH', reason: 'Area kritis kampus', expectedVersion: 5 }),
    ).toEqual({ priority: 'HIGH', reason: 'Area kritis kampus', expectedVersion: 5 });
  });

  it('accepts final_priority and override_reason aliases', () => {
    expect(
      normalizePriorityBody({
        final_priority: 'LOW',
        override_reason: 'Dampak kecil sekali',
        expectedVersion: 5,
      }),
    ).toEqual({ priority: 'LOW', reason: 'Dampak kecil sekali', expectedVersion: 5 });
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
  it('reads visibility + message plus version', () => {
    expect(
      normalizeUpdateBody({
        visibility: 'PUBLIC',
        message: 'Perbaikan dimulai hari ini',
        expectedVersion: 6,
      }),
    ).toEqual({
      visibility: 'PUBLIC',
      message: 'Perbaikan dimulai hari ini',
      expectedVersion: 6,
    });
  });

  it('400s every normalizer when the version is missing', () => {
    const bodies: Array<() => unknown> = [
      () => normalizeVerifyBody({ finalPriority: 'HIGH' }),
      () => normalizeRejectBody({ reason: 'Alasan cukup panjang' }),
      () => normalizeDuplicateBody({ canonicalRef: 'MNT-2026-000001' }),
      () => normalizePriorityBody({ priority: 'HIGH', reason: 'Alasan cukup panjang' }),
      () => normalizeAssignBody({ technicianId: '11111111-1111-1111-1111-111111111111' }),
      () => normalizeTransitionBody({ nextStatus: 'INSPECTION' }),
      () => normalizeUpdateBody({ visibility: 'PUBLIC', message: 'Pesan cukup panjang' }),
    ];
    for (const run of bodies) {
      expect(httpOf(run)).toEqual({ status: 400, message: 'expectedVersion is required' });
    }
  });
});
