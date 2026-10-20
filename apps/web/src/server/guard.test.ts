// Unit murni guard navigasi (tanpa DB/HTTP/DOM).
import { describe, expect, it } from 'vitest';
import { homeForRole, redirectForRole } from './guard.js';

describe('redirectForRole', () => {
  it('mengarahkan anonim ke /login kecuali halaman publik', () => {
    expect(redirectForRole('/', null)).toBe('/login');
    expect(redirectForRole('/admin', null)).toBe('/login');
    expect(redirectForRole('/reporter', null)).toBe('/login');
    expect(redirectForRole('/login', null)).toBe(null);
    expect(redirectForRole('/kebijakan-privasi', null)).toBe(null);
  });

  it('mendispatch "/" dan "/login" ke home sesuai role', () => {
    expect(redirectForRole('/', { role: 'ADMIN' })).toBe('/admin');
    expect(redirectForRole('/', { role: 'REPORTER' })).toBe('/reporter');
    expect(redirectForRole('/login', { role: 'ADMIN' })).toBe('/admin');
    expect(redirectForRole('/login', { role: 'REPORTER' })).toBe('/reporter');
  });

  it('menolak reporter di /admin* dan mengizinkan admin di mana saja', () => {
    expect(redirectForRole('/admin', { role: 'REPORTER' })).toBe('/reporter');
    expect(redirectForRole('/admin/reports', { role: 'REPORTER' })).toBe('/reporter');
    expect(redirectForRole('/admin', { role: 'ADMIN' })).toBe(null);
    expect(redirectForRole('/reporter', { role: 'ADMIN' })).toBe(null);
    expect(redirectForRole('/reporter', { role: 'REPORTER' })).toBe(null);
  });

  it('homeForRole memetakan peran ke home yang benar', () => {
    expect(homeForRole('ADMIN')).toBe('/admin');
    expect(homeForRole('REPORTER')).toBe('/reporter');
  });
});
