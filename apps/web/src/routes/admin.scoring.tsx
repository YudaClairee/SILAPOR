// Pengaturan Scoring (Phase 7 T7, UI No. 11): mock settings page. Weight
// inputs are local state, thresholds and per-category scores are static mock
// data; the submit stays disabled until the scoring endpoint exists.
import { useState } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import { Button, Input } from '../components/index.js';

export const Route = createFileRoute('/admin/scoring')({
  component: AdminScoringPage,
});

interface WeightValues {
  category: string;
  asset: string;
  location: string;
  frequency: string;
}

interface WeightField {
  readonly key: keyof WeightValues;
  readonly id: string;
  readonly label: string;
  readonly hint: string;
  readonly max: number;
}

const DEFAULT_WEIGHTS: WeightValues = {
  category: '35',
  asset: '25',
  location: '25',
  frequency: '15',
};

const WEIGHT_FIELDS: readonly WeightField[] = [
  {
    key: 'category',
    id: 'admin-scoring-weight-category',
    label: 'Bobot kategori',
    hint: 'Skala 0–35 poin.',
    max: 35,
  },
  {
    key: 'asset',
    id: 'admin-scoring-weight-asset',
    label: 'Bobot aset',
    hint: 'Skala 0–25 poin.',
    max: 25,
  },
  {
    key: 'location',
    id: 'admin-scoring-weight-location',
    label: 'Bobot lokasi',
    hint: 'Skala 0–25 poin.',
    max: 25,
  },
  {
    key: 'frequency',
    id: 'admin-scoring-weight-frequency',
    label: 'Bobot frekuensi pelapor',
    hint: 'Skala 0–15 poin.',
    max: 15,
  },
];

const PRIORITY_THRESHOLDS: ReadonlyArray<{
  readonly range: string;
  readonly priority: string;
}> = [
  { range: '0–39', priority: 'LOW' },
  { range: '40–69', priority: 'MEDIUM' },
  { range: '70–100', priority: 'HIGH' },
];

const FREQUENCY_TIERS: ReadonlyArray<{
  readonly reporters: string;
  readonly bonus: string;
}> = [
  { reporters: '1', bonus: '0' },
  { reporters: '2', bonus: '5' },
  { reporters: '3–4', bonus: '10' },
  { reporters: '≥5', bonus: '15' },
];

const CATEGORY_SCORES: ReadonlyArray<{
  readonly code: string;
  readonly name: string;
  readonly weight: number;
}> = [
  { code: 'ELECTRICAL', name: 'Listrik dan lampu', weight: 40 },
  { code: 'HVAC', name: 'AC dan pendingin', weight: 35 },
  { code: 'PLUMBING', name: 'Toilet dan sanitasi', weight: 35 },
  { code: 'ELECTRONIC', name: 'Elektronik komputer dan jaringan', weight: 25 },
  { code: 'FURNITURE', name: 'Furniture pintu dan jendela', weight: 15 },
  { code: 'OTHER', name: 'Lainnya', weight: 10 },
];

const SECTION_TITLE_CLASSES = 'text-lg font-semibold text-text';
const SECTION_PANEL_CLASSES = 'rounded-md border border-border bg-surface p-4';
const LABEL_CLASSES = 'mb-1 block text-sm font-medium text-text';
const HINT_CLASSES = 'mt-1 text-xs text-muted';
const TABLE_HEAD_CLASSES = 'px-3 py-2 text-xs font-medium text-muted';

function AdminScoringPage() {
  const [weights, setWeights] = useState<WeightValues>(DEFAULT_WEIGHTS);
  const [reporterLimit, setReporterLimit] = useState('5');

  return (
    <section aria-labelledby="admin-scoring-title" className="w-full">
      <h1 id="admin-scoring-title" className="text-2xl font-semibold text-text">
        Pengaturan Scoring
      </h1>
      <p className="mt-1 text-sm text-muted">
        Bobot kriteria dan ambang prioritas untuk perhitungan skor 0–100 laporan baru.
      </p>

      <form
        aria-label="Pengaturan scoring"
        onSubmit={(event) => {
          event.preventDefault();
        }}
        className="mt-4"
      >
        <section aria-labelledby="admin-scoring-weights-title" className={SECTION_PANEL_CLASSES}>
          <h2 id="admin-scoring-weights-title" className={SECTION_TITLE_CLASSES}>
            Bobot kriteria
          </h2>
          <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {WEIGHT_FIELDS.map((field) => (
              <div key={field.key}>
                <label htmlFor={field.id} className={LABEL_CLASSES}>
                  {field.label}
                </label>
                <Input
                  id={field.id}
                  name={field.key}
                  type="number"
                  min={0}
                  max={field.max}
                  value={weights[field.key]}
                  aria-describedby={`${field.id}-hint`}
                  onChange={(event) =>
                    setWeights((previous) => ({ ...previous, [field.key]: event.target.value }))
                  }
                />
                <p id={`${field.id}-hint`} className={HINT_CLASSES}>
                  {field.hint}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section
          aria-labelledby="admin-scoring-thresholds-title"
          className={`mt-4 ${SECTION_PANEL_CLASSES}`}
        >
          <h2 id="admin-scoring-thresholds-title" className={SECTION_TITLE_CLASSES}>
            Ambang prioritas
          </h2>
          <div className="mt-3 overflow-x-auto">
            <table aria-label="Ambang prioritas" className="w-full min-w-100 border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th scope="col" className={TABLE_HEAD_CLASSES}>
                    Rentang skor
                  </th>
                  <th scope="col" className={TABLE_HEAD_CLASSES}>
                    Prioritas
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {PRIORITY_THRESHOLDS.map((threshold) => (
                  <tr key={threshold.priority}>
                    <td className="px-3 py-2 text-text">{threshold.range}</td>
                    <td className="px-3 py-2 text-text">{threshold.priority}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={HINT_CLASSES}>
            Skor 0–100 = bobot kategori + aset + lokasi + frekuensi pelapor.
          </p>
        </section>

        <section
          aria-labelledby="admin-scoring-reporter-title"
          className={`mt-4 ${SECTION_PANEL_CLASSES}`}
        >
          <h2 id="admin-scoring-reporter-title" className={SECTION_TITLE_CLASSES}>
            Frekuensi pelapor
          </h2>
          <div className="mt-3 sm:max-w-xs">
            <label htmlFor="admin-scoring-reporter-limit" className={LABEL_CLASSES}>
              Batas jumlah pelapor
            </label>
            <Input
              id="admin-scoring-reporter-limit"
              name="reporterLimit"
              type="number"
              min={1}
              value={reporterLimit}
              aria-describedby="admin-scoring-reporter-hint"
              onChange={(event) => setReporterLimit(event.target.value)}
            />
            <p id="admin-scoring-reporter-hint" className={HINT_CLASSES}>
              Bonus maksimum (15) diberikan mulai {reporterLimit} pelapor berbeda pada insiden yang
              sama.
            </p>
          </div>
          <div className="mt-3 overflow-x-auto">
            <table
              aria-label="Tier bonus frekuensi"
              className="w-full min-w-100 border-collapse text-left text-sm"
            >
              <thead>
                <tr className="border-b border-border">
                  <th scope="col" className={TABLE_HEAD_CLASSES}>
                    Pelapor berbeda
                  </th>
                  <th scope="col" className={TABLE_HEAD_CLASSES}>
                    Bonus frekuensi
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {FREQUENCY_TIERS.map((tier) => (
                  <tr key={tier.reporters}>
                    <td className="px-3 py-2 text-text">{tier.reporters}</td>
                    <td className="px-3 py-2 text-text">{tier.bonus}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section
          aria-labelledby="admin-scoring-category-title"
          className={`mt-4 ${SECTION_PANEL_CLASSES}`}
        >
          <h2 id="admin-scoring-category-title" className={SECTION_TITLE_CLASSES}>
            Skor per kategori
          </h2>
          <div className="mt-3 overflow-x-auto">
            <table
              aria-label="Skor per kategori aset/ruangan"
              className="w-full min-w-140 border-collapse text-left text-sm"
            >
              <thead>
                <tr className="border-b border-border">
                  <th scope="col" className={TABLE_HEAD_CLASSES}>
                    Kode
                  </th>
                  <th scope="col" className={TABLE_HEAD_CLASSES}>
                    Kategori
                  </th>
                  <th scope="col" className={TABLE_HEAD_CLASSES}>
                    Bobot
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {CATEGORY_SCORES.map((category) => (
                  <tr key={category.code}>
                    <td className="px-3 py-2 font-medium text-text">{category.code}</td>
                    <td className="px-3 py-2 text-muted">{category.name}</td>
                    <td className="px-3 py-2 text-text">{category.weight}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className={HINT_CLASSES}>Nilai contoh dari master data kategori konfigurasi v1.</p>
        </section>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button type="submit" disabled>
            Simpan pengaturan
          </Button>
          <p className="text-sm text-muted">Endpoint menyusul — pengaturan belum tersimpan.</p>
        </div>
      </form>
    </section>
  );
}
