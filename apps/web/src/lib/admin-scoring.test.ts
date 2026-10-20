// Unit murni helper admin-scoring (tanpa DB/HTTP/DOM).
import { describe, expect, it } from 'vitest';
import {
  categoryScoreOf,
  categoryScoreToWeight,
  checkThresholds,
  isValidScore,
  locationScoreOf,
  locationScoreToTier,
  parseScoreInput,
  sedangUpperLabel,
  totalBobot,
} from './admin-scoring.js';

describe('admin-scoring helpers', () => {
  it('mengonversi weight backend 0–40 ke skor UI 0–100', () => {
    expect(categoryScoreOf('ELECTRONIC', 40)).toBe(100);
    expect(categoryScoreOf('HVAC', 32)).toBe(80);
    expect(categoryScoreOf('OTHER', 20)).toBe(50);
    expect(categoryScoreOf('UNKNOWN', null)).toBe(50);
  });

  it('mengonversi skor UI kembali ke weight backend', () => {
    expect(categoryScoreToWeight(100)).toBe(40);
    expect(categoryScoreToWeight(0)).toBe(0);
    expect(categoryScoreToWeight(50)).toBe(20);
  });

  it('mengonversi tierScore lokasi 0–30 ke skor 0–100', () => {
    expect(locationScoreOf(30)).toBe(100);
    expect(locationScoreOf(15)).toBe(50);
    expect(locationScoreOf(null)).toBe(50);
    expect(locationScoreToTier(100)).toBe(30);
    expect(locationScoreToTier(0)).toBe(0);
  });

  it('memvalidasi skor bulat 0–100', () => {
    expect(isValidScore(0)).toBe(true);
    expect(isValidScore(100)).toBe(true);
    expect(isValidScore(101)).toBe(false);
    expect(isValidScore(12.5)).toBe(false);
    expect(parseScoreInput(' 80 ')).toBe(80);
    expect(parseScoreInput('')).toBe(null);
    expect(parseScoreInput('abc')).toBe(null);
  });

  it('menghitung total bobot dan ambang prioritas', () => {
    expect(totalBobot('40', '35', '25')).toBe(100);
    expect(totalBobot('40', '', '25')).toBe(null);
    const ok = checkThresholds('50', '80');
    expect(ok.valid).toBe(true);
    expect(sedangUpperLabel(80)).toBe('79,99');
    expect(checkThresholds('80', '50').valid).toBe(false);
    expect(checkThresholds('50', '50').valid).toBe(false);
  });
});
