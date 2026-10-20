// Logika murni halaman Pengaturan Scoring Prioritas (Figma 150:9390,
// admin/UMPER). Skala UI 0–100; backend menyimpan weight kategori 0–40 dan
// tierScore lokasi 0–30 — konversi dua arah ada di sini agar halaman
// terikat data live tanpa mengubah kontrak API. Tanpa DB/HTTP/DOM.
export const DEFAULT_BOBOT_ASET = '40';
export const DEFAULT_BOBOT_RUANG = '35';
export const DEFAULT_BOBOT_PELAPOR = '25';
export const DEFAULT_CMAKS = '5';
export const DEFAULT_BATAS_SEDANG = '50';
export const DEFAULT_BATAS_TINGGI = '80';

/** Skor default 0–100 per kode kategori (fallback saat backend weight null). */
export const CATEGORY_DEFAULT_SCORES: Readonly<Record<string, number>> = {
  ELECTRONIC: 85,
  HVAC: 80,
  ELECTRICAL: 85,
  PLUMBING: 75,
  FURNITURE: 50,
  OTHER: 50,
};

export const LOCATION_DEFAULT_SCORE = 50 as const;
export const LOCATION_PAGE_SIZE = 10 as const;

/** weight backend (0–40) → skor UI (0–100). */
export function categoryScoreOf(code: string, weight: number | null): number {
  if (typeof weight === 'number' && Number.isFinite(weight)) {
    return Math.max(0, Math.min(100, Math.round((weight / 40) * 100)));
  }
  return CATEGORY_DEFAULT_SCORES[code] ?? LOCATION_DEFAULT_SCORE;
}

/** skor UI (0–100) → weight backend (0–40). */
export function categoryScoreToWeight(score: number): number {
  return Math.max(0, Math.min(40, Math.round((score / 100) * 40)));
}

/** tierScore backend (0–30) → skor UI (0–100); null → 50 (DEFAULT). */
export function locationScoreOf(tierScore: number | null): number {
  if (typeof tierScore === 'number' && Number.isFinite(tierScore)) {
    return Math.max(0, Math.min(100, Math.round((tierScore / 30) * 100)));
  }
  return LOCATION_DEFAULT_SCORE;
}

/** skor UI (0–100) → tierScore backend (0–30). */
export function locationScoreToTier(score: number): number {
  return Math.max(0, Math.min(30, Math.round((score / 100) * 30)));
}

export function parseScoreInput(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === '') return null;
  const num = Number(trimmed);
  if (!Number.isFinite(num)) return null;
  return num;
}

export function isValidScore(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 100;
}

export function totalBobot(aset: string, ruang: string, pelapor: string): number | null {
  const parts = [aset, ruang, pelapor].map((part) => {
    const trimmed = part.trim();
    if (trimmed === '') return null;
    const num = Number(trimmed);
    return Number.isFinite(num) ? num : null;
  });
  if (parts.some((part) => part === null)) return null;
  return (parts[0] as number) + (parts[1] as number) + (parts[2] as number);
}

export interface ThresholdCheck {
  readonly sedang: number | null;
  readonly tinggi: number | null;
  readonly valid: boolean;
}

export function checkThresholds(sedangRaw: string, tinggiRaw: string): ThresholdCheck {
  const sedang = parseScoreInput(sedangRaw);
  const tinggi = parseScoreInput(tinggiRaw);
  const valid =
    sedang !== null &&
    tinggi !== null &&
    Number.isInteger(sedang) &&
    Number.isInteger(tinggi) &&
    sedang >= 1 &&
    sedang <= 99 &&
    tinggi >= 2 &&
    tinggi <= 100 &&
    sedang < tinggi;
  return { sedang, tinggi, valid };
}

/** "79,99" untuk batas tinggi 80 (desimal koma ala desain). */
export function sedangUpperLabel(tinggi: number): string {
  const upper = Math.max(0, tinggi - 0.01);
  return upper.toFixed(2).replace('.', ',');
}
