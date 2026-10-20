// Admin ticket-detail helpers (Figma 150:933). Pure units: header hero copy,
// consolidated reporter quotes, and generic photo captions.
import { describe, expect, it } from 'vitest';
import {
  adminPhotoCaption,
  adminPriorityHero,
  adminReporterCaption,
  adminStatusPill,
  buildAdminReporterQuotes,
} from './admin-ticket-detail.js';

describe('adminPriorityHero', () => {
  it('formats the Figma "Prioritas: Tinggi (88,5/100)" hero with an Indonesian comma', () => {
    expect(adminPriorityHero('HIGH', 88.5)).toBe('Prioritas: Tinggi (88,5/100)');
  });

  it('omits the score when the ticket is still unscored', () => {
    expect(adminPriorityHero(null, null)).toBe('Prioritas: Belum ditetapkan');
  });
});

describe('adminStatusPill', () => {
  it('keeps IN_REPAIR on the amber warning tone', () => {
    expect(adminStatusPill('IN_REPAIR')).toContain('text-badge-warning');
  });
});

describe('buildAdminReporterQuotes', () => {
  it('keeps the main ticket first and numbers supporters without inventing identities', () => {
    const quotes = buildAdminReporterQuotes(
      { id: 'main', ticketNumber: 'MNT-2026-000142', description: 'Mati total.', reportedAt: '2026-10-18T01:30:00.000Z' },
      [{ id: 'sup-1', ticketNumber: 'MNT-2026-000143', description: 'Ikut mati.', reportedAt: '2026-10-18T01:35:00.000Z' }],
    );
    expect(quotes).toHaveLength(2);
    expect(adminReporterCaption(quotes[0] as never)).toContain('Pelapor Utama');
    expect(adminReporterCaption(quotes[1] as never)).toContain('Pelapor Pendukung 1');
  });
});

describe('adminPhotoCaption', () => {
  it('uses a generic caption because the backend stores no per-photo caption', () => {
    expect(adminPhotoCaption(1)).toBe('Kondisi unit di lokasi laporan');
    expect(adminPhotoCaption(2)).toBe('Foto pendukung kondisi kerusakan');
  });
});
