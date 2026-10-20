// Unit murni helper riwayat admin (tanpa DB/HTTP/DOM).
import { describe, expect, it } from 'vitest';
import {
  entryTypeOf,
  historyActorOf,
  historyLabelOf,
  historyNoteOf,
  historyStatusOf,
  historyTechnicianIdOf,
  historyTimestampOf,
  relationTypeLabel,
} from './admin-history.js';

describe('admin-history helpers', () => {
  it('membaca bentuk TimelineEntry modern (kind/at/label/detail)', () => {
    const entry = {
      kind: 'event',
      at: '2026-10-17T10:00:00.000Z',
      label: 'REPORT_VERIFIED',
      detail: { eventType: 'REPORT_VERIFIED' },
    };
    expect(historyTimestampOf(entry)).toBe('2026-10-17T10:00:00.000Z');
    expect(entryTypeOf(entry)).toBe('REPORT_VERIFIED');
    expect(historyLabelOf(entry)).toBe('Laporan diverifikasi');
    expect(historyStatusOf(entry)).toBe('VERIFIED');
    expect(historyActorOf(entry)).toBe('Sistem SCMS');
  });

  it('membaca bentuk legacy (eventType/createdAt/metadata)', () => {
    const entry = {
      eventType: 'STATUS_CHANGED',
      createdAt: '2026-10-18T09:00:00.000Z',
      metadata: { toValue: 'INSPECTION', note: 'Teknisi tiba' },
      detail: null,
    };
    expect(historyTimestampOf(entry)).toBe('2026-10-18T09:00:00.000Z');
    expect(historyStatusOf(entry)).toBe('INSPECTION');
    expect(historyNoteOf(entry)).toBe('Teknisi tiba');
    expect(historyActorOf(entry)).toBe('Admin/UMPER');
  });

  it('melabeli assignment, relasi, dan kondisi palsu', () => {
    expect(
      historyLabelOf({ kind: 'assignment', detail: { technicianId: 't-1' } }),
    ).toBe('Teknisi ditugaskan');
    expect(historyTechnicianIdOf({ kind: 'assignment', detail: { technicianId: 't-1' } })).toBe(
      't-1',
    );
    expect(historyLabelOf({ kind: 'relation', label: 'SUPPORTING' })).toBe('Relasi laporan');
    expect(historyNoteOf({ kind: 'update', detail: { message: 'Ganti lampu' } })).toBe(
      'Ganti lampu',
    );
    expect(relationTypeLabel('SUPPORTING')).toBe('Pendukung');
    expect(relationTypeLabel('RELATED')).toBe('Terkait');
    expect(historyLabelOf({})).toBe('Riwayat');
  });
});
