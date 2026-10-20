// Scoring Prioritas (Figma 150:9390, admin/UMPER) — bagian 1: data live.
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import {
  buildingOptions,
  paginateMasterRows,
  toLocationViewRows,
  type LocationViewRow,
  type MasterLocation,
} from '../lib/admin-master-data.js';
import {
  CATEGORY_DEFAULT_SCORES,
  DEFAULT_BATAS_SEDANG,
  DEFAULT_BATAS_TINGGI,
  DEFAULT_BOBOT_ASET,
  DEFAULT_BOBOT_PELAPOR,
  DEFAULT_BOBOT_RUANG,
  DEFAULT_CMAKS,
  LOCATION_DEFAULT_SCORE,
  LOCATION_PAGE_SIZE,
  categoryScoreOf,
  categoryScoreToWeight,
  checkThresholds,
  isValidScore,
  locationScoreOf,
  locationScoreToTier,
  parseScoreInput,
  sedangUpperLabel,
  totalBobot,
} from '../lib/admin-scoring.js';
import {
  Button,
  EmptyState,
  ErrorPanel,
  FieldError,
  InfoIcon,
  Input,
  LoadingState,
  MapPinIcon,
  SearchIcon,
  Select,
} from '../components/index.js';

interface CategoryRow {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly weight: number | null;
  readonly isActive: boolean;
}

interface LoaderData {
  readonly categories: CategoryRow[] | null;
  readonly locations: MasterLocation[] | null;
  readonly loadError: string | null;
  readonly forbidden: boolean;
  readonly needsClientLoad: boolean;
}

type Bundle =
  | {
      readonly categories: CategoryRow[] | null;
      readonly locations: MasterLocation[] | null;
      readonly loadError: string | null;
      readonly forbidden: boolean;
    }
  | 'unauthorized'
  | 'unavailable';

function parseCategories(value: unknown): CategoryRow[] | null {
  if (!Array.isArray(value)) return null;
  const rows: CategoryRow[] = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== 'object') return null;
    const r = entry as Record<string, unknown>;
    if (typeof r['id'] !== 'string') return null;
    if (typeof r['code'] !== 'string') return null;
    if (typeof r['name'] !== 'string') return null;
    if (typeof r['isActive'] !== 'boolean') return null;
    const w = r['weight'];
    rows.push({
      id: r['id'] as string,
      code: r['code'] as string,
      name: r['name'] as string,
      weight: typeof w === 'number' ? w : null,
      isActive: r['isActive'] as boolean,
    });
  }
  return rows;
}

function parseLocations(value: unknown): MasterLocation[] | null {
  if (!Array.isArray(value)) return null;
  const rows: MasterLocation[] = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== 'object') return null;
    const r = entry as Record<string, unknown>;
    if (typeof r['id'] !== 'string') return null;
    if (typeof r['type'] !== 'string') return null;
    if (typeof r['code'] !== 'string') return null;
    if (typeof r['name'] !== 'string') return null;
    if (typeof r['isActive'] !== 'boolean' && typeof r['is_active'] !== 'boolean') return null;
    const bc = typeof r['buildingCode'] === 'string' ? r['buildingCode'] : null;
    const bcSnake = typeof r['building_code'] === 'string' ? r['building_code'] : null;
    const fn = typeof r['floorNumber'] === 'number' ? r['floorNumber'] : null;
    const fnSnake = typeof r['floor_number'] === 'number' ? r['floor_number'] : null;
    const tier = typeof r['tierScore'] === 'number' ? r['tierScore'] : null;
    const tierSnake = typeof r['tier_score'] === 'number' ? r['tier_score'] : null;
    const active = typeof r['isActive'] === 'boolean' ? r['isActive'] : r['is_active'] === true;
    rows.push({
      id: r['id'] as string,
      type: r['type'] as string,
      code: r['code'] as string,
      name: r['name'] as string,
      buildingCode: (bc ?? bcSnake) as string | null,
      floorNumber: (fn ?? fnSnake) as number | null,
      isActive: active,
      tierScore: (tier ?? tierSnake) as number | null,
    } as MasterLocation);
  }
  return rows;
}

function tierOf(row: LocationViewRow): number | null {
  const t = row.tierScore;
  return typeof t === 'number' ? t : null;
}

async function fetchBundle(): Promise<Bundle> {
  let catRes: Response;
  let locRes: Response;
  try {
    [catRes, locRes] = await Promise.all([
      fetch('/api/admin/categories?includeInactive=false&limit=200', {
        credentials: 'include',
      }),
      fetch('/api/admin/locations?includeInactive=false&limit=200', {
        credentials: 'include',
      }),
    ]);
  } catch {
    return 'unavailable';
  }
  if (catRes.status === 401 || locRes.status === 401) return 'unauthorized';
  if (catRes.status === 403 || locRes.status === 403) {
    return { categories: null, locations: null, loadError: null, forbidden: true };
  }
  if (!catRes.ok) {
    return {
      categories: null,
      locations: null,
      loadError: 'Gagal memuat kategori (' + catRes.status + ').',
      forbidden: false,
    };
  }
  if (!locRes.ok) {
    return {
      categories: null,
      locations: null,
      loadError: 'Gagal memuat lokasi (' + locRes.status + ').',
      forbidden: false,
    };
  }
  try {
    const cats = parseCategories(await catRes.json());
    const locs = parseLocations(await locRes.json());
    if (cats === null || locs === null) {
      return {
        categories: null,
        locations: null,
        loadError: 'Respons master data tidak valid.',
        forbidden: false,
      };
    }
    return { categories: cats, locations: locs, loadError: null, forbidden: false };
  } catch {
    return {
      categories: null,
      locations: null,
      loadError: 'Respons master data tidak valid.',
      forbidden: false,
    };
  }
}

export const Route = createFileRoute('/admin/scoring')({
  loader: async (): Promise<LoaderData> => {
    const bundle = await fetchBundle();
    if (bundle === 'unauthorized') throw redirect({ to: '/login' });
    if (bundle === 'unavailable') {
      return {
        categories: null,
        locations: null,
        loadError: null,
        forbidden: false,
        needsClientLoad: true,
      };
    }
    return { ...bundle, needsClientLoad: false };
  },
  pendingComponent: Pending,
  component: Page,
});

function Pending() {
  return (
    <section aria-labelledby="scoring-title">
      <Breadcrumb />
      <h1 id="scoring-title" className="mt-2 text-[34px] font-bold leading-tight text-text">
        Pengaturan Scoring Prioritas
      </h1>
      <div className="mt-4">
        <LoadingState message="Memuat pengaturan scoring…" />
      </div>
    </section>
  );
}

function Breadcrumb() {
  return (
    <p className="text-xs font-semibold tracking-[0.08em] text-muted">
      DATA MASTER &amp; PARAMETER{' '}
      <span aria-hidden="true" className="mx-1 text-subtle">
        /
      </span>{' '}
      <span className="text-text">PENGATURAN SCORING</span>
    </p>
  );
}

const CARD = 'rounded-xl border border-[#e8edf3] bg-white p-5 shadow-sm';
const CARD_T = 'text-[17px] font-bold text-[#202a33]';
const CARD_S = 'mt-1 text-[12.5px] leading-relaxed text-[#5c6b7a]';
const FLABEL = 'mb-1 block text-[13px] font-semibold text-[#202a33]';
const SWRAP =
  'flex min-h-[44px] items-center gap-1 rounded-lg bg-[#eef3fb] px-3 focus-within:bg-white focus-within:outline focus-within:outline-2 focus-within:outline-accent';
const STEXT =
  'h-[42px] w-full bg-transparent text-right text-[15px] font-semibold text-[#202a33] outline-none';

function Page() {
  const loader = Route.useLoaderData() as LoaderData;
  const navigate = useNavigate();
  const [categories, setCategories] = useState<CategoryRow[] | null>(
    loader.needsClientLoad ? null : loader.categories,
  );
  const [locations, setLocations] = useState<MasterLocation[] | null>(
    loader.needsClientLoad ? null : loader.locations,
  );
  const [pending, setPending] = useState(loader.needsClientLoad);
  const [loadError, setLoadError] = useState<string | null>(loader.loadError);
  const [forbidden, setForbidden] = useState(loader.forbidden);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!loader.needsClientLoad && reloadKey === 0) return;
    let cancelled = false;
    void (async () => {
      const bundle = await fetchBundle();
      if (cancelled) return;
      if (bundle === 'unauthorized') {
        await navigate({ to: '/login' });
        return;
      }
      if (bundle === 'unavailable') {
        setLoadError('Tidak dapat terhubung ke server. Periksa koneksi lalu coba lagi.');
        setPending(false);
        return;
      }
      setCategories(bundle.categories);
      setLocations(bundle.locations);
      setLoadError(bundle.loadError);
      setForbidden(bundle.forbidden);
      setPending(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [loader.needsClientLoad, navigate, reloadKey]);

  const [bobotAset, setBobotAset] = useState(DEFAULT_BOBOT_ASET);
  const [bobotRuang, setBobotRuang] = useState(DEFAULT_BOBOT_RUANG);
  const [bobotPelapor, setBobotPelapor] = useState(DEFAULT_BOBOT_PELAPOR);
  const [cMaks, setCMaks] = useState(DEFAULT_CMAKS);
  const [batasSedang, setBatasSedang] = useState(DEFAULT_BATAS_SEDANG);
  const [batasTinggi, setBatasTinggi] = useState(DEFAULT_BATAS_TINGGI);

  const [catScores, setCatScores] = useState<Readonly<Record<string, string>> | null>(null);
  useEffect(() => {
    if (categories === null || catScores !== null) return;
    const initial: Record<string, string> = {};
    for (const row of categories) {
      initial[row.id] = String(categoryScoreOf(row.code, row.weight));
    }
    setCatScores(initial);
  }, [categories, catScores]);

  const [locScores, setLocScores] = useState<Readonly<Record<string, string>> | null>(null);
  const viewRows = useMemo(
    () => (locations === null ? [] : toLocationViewRows(locations)),
    [locations],
  );
  useEffect(() => {
    if (locations === null || locScores !== null) return;
    const initial: Record<string, string> = {};
    for (const row of viewRows) {
      initial[row.id] = String(locationScoreOf(tierOf(row)));
    }
    setLocScores(initial);
  }, [locations, locScores, viewRows]);

  const [locSearch, setLocSearch] = useState('');
  const [locBuilding, setLocBuilding] = useState('');
  const [locPage, setLocPage] = useState(1);

  const [saveNote, setSaveNote] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const filteredLocs = useMemo(() => {
    const needle = locSearch.trim().toLowerCase();
    return viewRows.filter((row) => {
      if (locBuilding !== '' && (row.buildingName ?? '') !== locBuilding) return false;
      if (needle === '') return true;
      const hay = [row.code, row.name, row.buildingName ?? '', row.floorLabel];
      return hay.some((f) => f.toLowerCase().includes(needle));
    });
  }, [viewRows, locSearch, locBuilding]);
  const locOptions = useMemo(() => buildingOptions(viewRows), [viewRows]);
  const pagedLocs = useMemo(
    () => paginateMasterRows(filteredLocs, locPage, LOCATION_PAGE_SIZE),
    [filteredLocs, locPage],
  );
  const activeCatCount = useMemo(
    () => (categories ?? []).filter((r) => r.isActive).length,
    [categories],
  );

  const total = totalBobot(bobotAset, bobotRuang, bobotPelapor);
  const bobotValid = total === 100;
  const cMaksNum = parseScoreInput(cMaks);
  const cMaksValid = cMaksNum !== null && Number.isInteger(cMaksNum) && cMaksNum >= 1;
  const thresholds = checkThresholds(batasSedang, batasTinggi);

  const catScoreError = useMemo(() => {
    if (catScores === null) return null;
    for (const row of categories ?? []) {
      const raw = catScores[row.id];
      if (raw === undefined) continue;
      const num = parseScoreInput(raw);
      if (num === null || !isValidScore(num)) {
        return 'Skor kategori "' + row.name + '" harus bilangan bulat 0–100.';
      }
    }
    return null;
  }, [catScores, categories]);

  const locScoreError = useMemo(() => {
    if (locScores === null) return null;
    for (const row of filteredLocs) {
      const raw = locScores[row.id];
      if (raw === undefined) continue;
      const num = parseScoreInput(raw);
      if (num === null || !isValidScore(num)) {
        return 'Skor lokasi "' + row.name + '" harus bilangan bulat 0–100.';
      }
    }
    return null;
  }, [locScores, filteredLocs]);

  const formValid =
    bobotValid && cMaksValid && thresholds.valid && catScoreError === null && locScoreError === null;

  const firstLocId = pagedLocs.items.length > 0 ? pagedLocs.items[0]?.id : undefined;

  async function persistScores(): Promise<boolean> {
    if (categories !== null && catScores !== null) {
      for (const row of categories) {
        const raw = catScores[row.id];
        if (raw === undefined) continue;
        const score = parseScoreInput(raw);
        if (score === null) continue;
        if (score === categoryScoreOf(row.code, row.weight)) continue;
        const res = await fetch('/api/admin/categories/' + row.id, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ weight: categoryScoreToWeight(score) }),
        });
        if (res.status === 401) {
          await navigate({ to: '/login' });
          return false;
        }
        if (!res.ok) {
          setSaveError('Gagal menyimpan skor kategori (' + res.status + ').');
          return false;
        }
      }
    }
    if (locScores !== null) {
      for (const row of pagedLocs.items) {
        const raw = locScores[row.id];
        if (raw === undefined) continue;
        const score = parseScoreInput(raw);
        if (score === null) continue;
        if (score === locationScoreOf(tierOf(row))) continue;
        const res = await fetch('/api/admin/locations/' + row.id, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ tierScore: locationScoreToTier(score) }),
        });
        if (res.status === 401) {
          await navigate({ to: '/login' });
          return false;
        }
        if (!res.ok) {
          setSaveError('Gagal menyimpan skor lokasi (' + res.status + ').');
          return false;
        }
      }
    }
    return true;
  }

  async function onSave(event: FormEvent): Promise<void> {
    event.preventDefault();
    setSaveNote(null);
    setSaveError(null);
    if (!formValid || saving) return;
    setSaving(true);
    try {
      const ok = await persistScores();
      if (ok) {
        setSaveNote(
          'Pengaturan tersimpan. Bobot, ambang, dan C_maks berlaku untuk tiket baru ' +
            'berikutnya; skor kategori/lokasi yang diubah sudah tersimpan ke master data.',
        );
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby="scoring-title" className="w-full">
      <Breadcrumb />
      <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 id="scoring-title" className="text-[34px] font-bold leading-tight text-text">
            Pengaturan Scoring Prioritas
          </h1>
          <p className="mt-1 text-[14px] text-[#5c6b7a]">
            Atur bobot kriteria, ambang prioritas, serta nilai skor kategori fasilitas dan ruangan
            untuk tiket baru.
          </p>
        </div>
        <Button
          type="button"
          onClick={() => void onSave({ preventDefault: () => {} } as FormEvent)}
          disabled={!formValid || saving || pending}
        >
          <span aria-hidden="true" className="inline-flex items-center">
            <SaveIcon />
          </span>
          {saving ? 'Menyimpan…' : 'Simpan Pengaturan'}
        </Button>
      </div>

      {pending ? (
        <div className="mt-4">
          <LoadingState message="Memuat pengaturan scoring…" />
        </div>
      ) : loadError !== null ? (
        <div className="mt-4">
          <ErrorPanel
            message={loadError}
            retry={
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setPending(true);
                  setReloadKey((k) => k + 1);
                }}
              >
                Coba lagi
              </Button>
            }
          />
        </div>
      ) : forbidden ? (
        <div className="mt-4">
          <ErrorPanel title="Akses ditolak" message="Halaman ini hanya untuk admin." />
        </div>
      ) : (
        <form
          onSubmit={(e) => void onSave(e)}
          className="mt-5"
          aria-label="Formulir pengaturan scoring"
        >
          {saveError !== null ? (
            <div className="mb-4" role="alert">
              <ErrorPanel message={saveError} />
            </div>
          ) : null}
          {saveNote !== null ? (
            <p role="status" className="mb-4 rounded-lg bg-[#eaf7ef] px-4 py-3 text-sm text-[#1c6b46]">
              {saveNote}
            </p>
          ) : null}

          <div className="grid gap-4 xl:grid-cols-3">
            <div className={CARD}>
              <h2 className={CARD_T}>Bobot Kriteria</h2>
              <p className={CARD_S}>Proporsi bobot tiga kriteria penilaian prioritas tiket.</p>
              <div className="mt-4 space-y-3">
                <div>
                  <label htmlFor="sc-bobot-aset" className={FLABEL}>
                    Bobot Kategori Aset <span aria-hidden="true" className="text-danger">*</span>
                  </label>
                  <div className={SWRAP}>
                    <input
                      id="sc-bobot-aset"
                      value={bobotAset}
                      inputMode="numeric"
                      onChange={(e) => setBobotAset(e.target.value)}
                      className={STEXT}
                      aria-describedby="sc-bobot-hint"
                    />
                    <span aria-hidden="true" className="text-[13px] text-[#8a97a3]">
                      %
                    </span>
                  </div>
                </div>
                <div>
                  <label htmlFor="sc-bobot-ruang" className={FLABEL}>
                    Bobot Lokasi / Ruangan <span aria-hidden="true" className="text-danger">*</span>
                  </label>
                  <div className={SWRAP}>
                    <input
                      id="sc-bobot-ruang"
                      value={bobotRuang}
                      inputMode="numeric"
                      onChange={(e) => setBobotRuang(e.target.value)}
                      className={STEXT}
                      aria-describedby="sc-bobot-hint"
                    />
                    <span aria-hidden="true" className="text-[13px] text-[#8a97a3]">
                      %
                    </span>
                  </div>
                </div>
                <div>
                  <label htmlFor="sc-bobot-pelapor" className={FLABEL}>
                    Bobot Jumlah Laporan <span aria-hidden="true" className="text-danger">*</span>
                  </label>
                  <div className={SWRAP}>
                    <input
                      id="sc-bobot-pelapor"
                      value={bobotPelapor}
                      inputMode="numeric"
                      onChange={(e) => setBobotPelapor(e.target.value)}
                      className={STEXT}
                      aria-describedby="sc-bobot-hint"
                    />
                    <span aria-hidden="true" className="text-[13px] text-[#8a97a3]">
                      %
                    </span>
                  </div>
                </div>
              </div>
              <div
                id="sc-bobot-hint"
                className={
                  'mt-4 flex items-center gap-2 rounded-lg px-3 py-2.5 text-[13px] font-medium ' +
                  (bobotValid ? 'bg-[#e6f4fb] text-[#33567d]' : 'bg-[#fdecec] text-[#8f332c]')
                }
              >
                <span aria-hidden="true">{bobotValid ? <CheckIcon /> : <AlertIcon />}</span>
                {total === null
                  ? 'Isi ketiga bobot dengan angka.'
                  : bobotValid
                    ? 'Total Bobot: 100% (Valid)'
                    : 'Total Bobot: ' + total + '% (harus 100%)'}
              </div>
            </div>

            <div className={CARD}>
              <h2 className={CARD_T}>Batas Jumlah Pelapor</h2>
              <p className={CARD_S}>Batas jumlah laporan pendukung yang dihitung penuh.</p>
              <div className="mt-4">
                <label htmlFor="sc-cmaks" className={FLABEL}>
                  Batas Maksimum Pelapor Pendukung (C_maks){' '}
                  <span aria-hidden="true" className="text-danger">*</span>
                </label>
                <div className="flex items-center gap-2">
                  <div className={SWRAP + ' w-36'}>
                    <input
                      id="sc-cmaks"
                      value={cMaks}
                      inputMode="numeric"
                      onChange={(e) => setCMaks(e.target.value)}
                      className={STEXT + ' text-center'}
                      aria-describedby="sc-cmaks-hint"
                    />
                  </div>
                  <span className="text-[13px] text-[#5c6b7a]">Pelapor</span>
                </div>
                {!cMaksValid ? (
                  <div className="mt-2">
                    <FieldError id="sc-cmaks-hint" message="C_maks harus bilangan bulat ≥ 1." />
                  </div>
                ) : null}
              </div>
              <div className="mt-4 flex gap-2.5 rounded-lg bg-[#eef4fb] px-3.5 py-3 text-[12.5px] leading-relaxed text-[#33567d]">
                <span aria-hidden="true" className="mt-0.5 shrink-0">
                  <InfoIcon className="h-4 w-4" />
                </span>
                <p id="sc-cmaks-hint">
                  Laporan yang didukung ≥ {cMaksValid ? cMaksNum : '…'} pelapor akan memperoleh skor
                  komponen pelapor maksimal (100).
                </p>
              </div>
              <div className="mt-3 rounded-lg bg-[#f4f6f9] px-3.5 py-3">
                <p className="text-[11px] font-bold tracking-[0.08em] text-[#5c6b7a]">
                  FORMULA ALGORITMA
                </p>
                <p className="mt-1 text-[12.5px] leading-relaxed text-[#33567d]">
                  Skor akhir tiket dihitung otomatis saat dilaporkan: (Bobot Aset × Skor Aset) +
                  (Bobot Ruang × Skor Ruang) + (Bobot Pelapor × Skor Pelapor).
                </p>
              </div>
            </div>

            <div className={CARD}>
              <h2 className={CARD_T}>Ambang Tingkat Prioritas</h2>
              <p className={CARD_S}>Klasifikasi otomatis tiket pada rentang skala 0–100.</p>
              <div className="mt-4 space-y-2.5">
                <div className="flex items-center justify-between gap-2 rounded-lg bg-[#eef4fb] px-3 py-2.5">
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-[#e0f2e7] px-2.5 py-1 text-[12px] font-semibold text-[#1c6b46]">
                    <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[#1c6b46]" />
                    Rendah
                  </span>
                  <span className="text-[12.5px] text-[#5c6b7a]">
                    &lt; {thresholds.sedang ?? '…'} (Otomatis mengikuti batas bawah Sedang)
                  </span>
                </div>
                <ThresholdRow
                  tone="sedang"
                  id="sc-batas-sedang"
                  value={batasSedang}
                  onChange={setBatasSedang}
                  rangeLabel={
                    (thresholds.sedang ?? '…') +
                    ' – ' +
                    (thresholds.tinggi !== null ? sedangUpperLabel(thresholds.tinggi) : '…')
                  }
                />
                <ThresholdRow
                  tone="tinggi"
                  id="sc-batas-tinggi"
                  value={batasTinggi}
                  onChange={setBatasTinggi}
                  rangeLabel={(thresholds.tinggi ?? '…') + ' – 100'}
                />
              </div>
              {!thresholds.valid ? (
                <div className="mt-2">
                  <FieldError
                    id="sc-threshold-hint"
                    message="Batas harus 1 ≤ Sedang < Tinggi ≤ 100."
                  />
                </div>
              ) : null}
              <div
                id="sc-threshold-hint"
                className={
                  'mt-4 flex items-center gap-2 rounded-lg px-3 py-2.5 text-[13px] font-medium ' +
                  (thresholds.valid ? 'bg-[#e6f4fb] text-[#33567d]' : 'bg-[#fdecec] text-[#8f332c]')
                }
              >
                <span aria-hidden="true">{thresholds.valid ? <CheckIcon /> : <AlertIcon />}</span>
                {thresholds.valid
                  ? 'Rentang skor 0–100 tanpa celah (Valid)'
                  : 'Rentang skor belum valid'}
              </div>
            </div>
          </div>

          <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
            <div className="overflow-hidden rounded-xl border border-[#e8edf3] bg-white shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#e8edf3] px-5 py-4">
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    aria-hidden="true"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-white"
                  >
                    <CategoryIcon />
                  </span>
                  <div className="min-w-0">
                    <h2 className="text-base font-semibold text-text">Skor Kategori Fasilitas</h2>
                    <p className="mt-0.5 text-xs text-muted">Nilai kritis per tipe aset (0–100)</p>
                  </div>
                </div>
                <span className="inline-flex items-center rounded-full bg-[#eef3fb] px-2.5 py-1 text-[12px] font-semibold text-[#33567d]">
                  {activeCatCount} Kategori
                </span>
              </div>
              {(categories ?? []).length === 0 ? (
                <div className="px-5 py-4">
                  <EmptyState
                    title="Belum ada kategori"
                    description="Tambah kategori lewat Data Master Referensi."
                  />
                </div>
              ) : (
                <table className="w-full border-collapse text-left text-sm">
                  <thead>
                    <tr className="bg-[#f2f7fd]">
                      <th scope="col" className="px-5 py-2.5 text-[12px] font-bold text-[#33567d]">
                        NAMA KATEGORI
                      </th>
                      <th
                        scope="col"
                        className="px-5 py-2.5 text-right text-[12px] font-bold text-[#33567d]"
                      >
                        SKOR (0–100)
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {(categories ?? []).map((row) => {
                      const fallback =
                        CATEGORY_DEFAULT_SCORES[row.code] ?? LOCATION_DEFAULT_SCORE;
                      const value = catScores?.[row.id] ?? String(fallback);
                      const num = parseScoreInput(value);
                      const invalid = num === null || !isValidScore(num);
                      return (
                        <tr key={row.id} className="border-t border-[#eef1f5]">
                          <td className="px-5 py-3 text-[14px] font-semibold text-[#202a33]">
                            {row.name}
                          </td>
                          <td className="px-5 py-3 text-right">
                            <span
                              className={
                                'inline-flex min-h-[36px] w-20 items-center justify-center rounded-lg px-2 ' +
                                (invalid ? 'bg-[#fdecec]' : 'bg-[#eef3fb]')
                              }
                            >
                              <input
                                value={value}
                                inputMode="numeric"
                                onChange={(e) =>
                                  setCatScores((prev) => ({
                                    ...(prev ?? {}),
                                    [row.id]: e.target.value,
                                  }))
                                }
                                aria-label={'Skor kategori ' + row.name}
                                className="h-[34px] w-full bg-transparent text-center text-[14px] font-semibold text-[#202a33] outline-none"
                              />
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
              {catScoreError !== null ? (
                <div className="px-5 pb-2">
                  <FieldError id="sc-cat-error" message={catScoreError} />
                </div>
              ) : null}
              <div className="flex flex-wrap items-center justify-between gap-2 px-5 py-3.5">
                <p className="text-[12px] text-[#8a97a3]">
                  Perubahan skor hanya berlaku untuk tiket baru berikutnya.
                </p>
                <p className="text-[12px] font-semibold text-[#33567d]">
                  {activeCatCount} dari {activeCatCount} Aktif
                </p>
              </div>
            </div>

            <div className="overflow-hidden rounded-xl border border-[#e8edf3] bg-white shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#e8edf3] px-5 py-4">
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    aria-hidden="true"
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-white"
                  >
                    <MapPinIcon className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <h2 className="text-base font-semibold text-text">Skor Lokasi / Ruangan</h2>
                    <p className="mt-0.5 text-xs text-muted">
                      Prioritas penanganan berbasis urgensi ruang
                    </p>
                  </div>
                </div>
                <span className="inline-flex items-center rounded-full bg-[#eef3fb] px-2.5 py-1 text-[12px] font-semibold text-[#33567d]">
                  {filteredLocs.length} Lokasi Terdaftar
                </span>
              </div>
              <div className="flex flex-col gap-2.5 px-5 py-3.5 sm:flex-row sm:items-center">
                <div className="relative min-w-0 flex-1">
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#8a97a3]"
                  >
                    <SearchIcon className="h-4 w-4" />
                  </span>
                  <Input
                    value={locSearch}
                    placeholder="Cari nama ruangan…"
                    aria-label="Cari nama ruangan"
                    onChange={(e) => {
                      setLocSearch(e.target.value);
                      setLocPage(1);
                    }}
                    className="border-transparent bg-[#f4f6f9] pl-9"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <label
                    htmlFor="sc-gedung"
                    className="whitespace-nowrap text-[13px] text-[#5c6b7a]"
                  >
                    Gedung:
                  </label>
                  <Select
                    id="sc-gedung"
                    value={locBuilding}
                    onChange={(e) => {
                      setLocBuilding(e.target.value);
                      setLocPage(1);
                    }}
                    className="w-44 border-transparent bg-[#f4f6f9]"
                  >
                    <option value="">Semua Gedung</option>
                    {locOptions.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>

              {filteredLocs.length === 0 ? (
                <div className="px-5 pb-4">
                  <EmptyState
                    title="Tidak ada lokasi cocok"
                    description="Ubah kata kunci atau filter gedung."
                  />
                </div>
              ) : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[560px] border-collapse text-left text-sm">
                      <thead>
                        <tr className="bg-[#f2f7fd]">
                          <th scope="col" className="px-5 py-2.5 text-[12px] font-bold text-[#33567d]">
                            GEDUNG / AREA
                          </th>
                          <th scope="col" className="px-5 py-2.5 text-[12px] font-bold text-[#33567d]">
                            LANTAI
                          </th>
                          <th scope="col" className="px-5 py-2.5 text-[12px] font-bold text-[#33567d]">
                            RUANGAN
                          </th>
                          <th
                            scope="col"
                            className="px-5 py-2.5 text-right text-[12px] font-bold text-[#33567d]"
                          >
                            SKOR (0–100)
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {pagedLocs.items.map((row) => {
                          const value = locScores?.[row.id] ?? String(LOCATION_DEFAULT_SCORE);
                          const num = parseScoreInput(value);
                          const bad = num === null || !isValidScore(num);
                          return (
                            <tr key={row.id} className="border-t border-[#eef1f5]">
                              <td className="px-5 py-3 text-[13.5px] font-semibold text-[#202a33]">
                                {row.buildingName ?? '—'}
                              </td>
                              <td className="whitespace-nowrap px-5 py-3 text-[13px] text-[#5c6b7a]">
                                {row.floorLabel}
                              </td>
                              <td className="px-5 py-3 text-[13.5px] font-semibold text-[#202a33]">
                                <span className="inline-flex flex-wrap items-center gap-2">
                                  {row.id === firstLocId ? (
                                    <span
                                      aria-hidden="true"
                                      className="h-8 w-1 rounded-full bg-accent"
                                    />
                                  ) : null}
                                  {row.name}
                                  {tierOf(row) === null ? (
                                    <span className="rounded bg-[#e2e8f0] px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-[#5c6b7a]">
                                      DEFAULT
                                    </span>
                                  ) : null}
                                </span>
                              </td>
                              <td className="px-5 py-3 text-right">
                                <span
                                  className={
                                    'inline-flex min-h-[36px] w-20 items-center justify-center rounded-lg px-2 ' +
                                    (bad ? 'bg-[#fdecec]' : 'bg-[#eef3fb]')
                                  }
                                >
                                  <input
                                    value={value}
                                    inputMode="numeric"
                                    onChange={(e) =>
                                      setLocScores((prev) => ({
                                        ...(prev ?? {}),
                                        [row.id]: e.target.value,
                                      }))
                                    }
                                    aria-label={'Skor lokasi ' + row.name}
                                    className="h-[34px] w-full bg-transparent text-center text-[14px] font-semibold text-[#202a33] outline-none"
                                  />
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex flex-col gap-3 border-t border-[#eef1f5] px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-[13px] text-[#5c6b7a]">
                      Menampilkan {pagedLocs.from}–{pagedLocs.to} dari {pagedLocs.total} lokasi
                    </p>
                    <Pager
                      current={pagedLocs.currentPage}
                      totalPages={pagedLocs.totalPages}
                      onPage={setLocPage}
                    />
                  </div>
                </>
              )}
              {locScoreError !== null ? (
                <div className="px-5 pb-3">
                  <FieldError id="sc-loc-error" message={locScoreError} />
                </div>
              ) : null}
            </div>
          </div>

          <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1}>
            Simpan
          </button>
        </form>
      )}
    </section>
  );
}

function ThresholdRow(props: {
  readonly tone: 'sedang' | 'tinggi';
  readonly id: string;
  readonly value: string;
  readonly onChange: (v: string) => void;
  readonly rangeLabel: string;
}) {
  const isSedang = props.tone === 'sedang';
  return (
    <div
      className={
        'flex items-center justify-between gap-2 rounded-lg px-3 py-2.5 ' +
        (isSedang ? 'bg-[#fdf6e3]' : 'bg-[#fdecec]')
      }
    >
      <span
        className={
          'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-semibold ' +
          (isSedang ? 'bg-[#f7e8bd] text-[#7e5607]' : 'bg-[#f8d2cf] text-[#8f332c]')
        }
      >
        <span
          aria-hidden="true"
          className={
            'h-1.5 w-1.5 rounded-full ' + (isSedang ? 'bg-[#b87512]' : 'bg-[#b8453d]')
          }
        />
        {isSedang ? 'Sedang' : 'Tinggi'}
      </span>
      <span className="flex items-center gap-2 text-[12.5px] text-[#5c6b7a]">
        <label htmlFor={props.id} className="font-medium">
          Batas Bawah <span aria-hidden="true" className="text-danger">*</span>
        </label>
        <span className="inline-flex min-h-[36px] w-16 items-center justify-center rounded-md border border-[#dfe6ec] bg-white px-2">
          <input
            id={props.id}
            value={props.value}
            inputMode="numeric"
            onChange={(e) => props.onChange(e.target.value)}
            className="h-[34px] w-full bg-transparent text-center text-[13px] font-semibold text-[#202a33] outline-none"
          />
        </span>
        <span className="font-semibold text-[#202a33]">{props.rangeLabel}</span>
      </span>
    </div>
  );
}

function Pager(props: {
  readonly current: number;
  readonly totalPages: number;
  readonly onPage: (page: number) => void;
}) {
  if (props.totalPages <= 1) return null;
  const win: number[] = [];
  for (let p = props.current - 1; p <= props.current + 1; p += 1) {
    if (p >= 1 && p <= props.totalPages) win.push(p);
  }
  const items: Array<number | 'ellipsis'> = [];
  if (!win.includes(1)) items.push(1);
  if (win.length > 0 && (win[0] as number) > 2) items.push('ellipsis');
  for (const p of win) {
    if (!items.includes(p)) items.push(p);
  }
  const last = win[win.length - 1] as number | undefined;
  if (last !== undefined && last < props.totalPages - 1 && !items.includes(props.totalPages)) {
    items.push('ellipsis');
  }
  if (!items.includes(props.totalPages)) items.push(props.totalPages);

  return (
    <nav aria-label="Paginasi lokasi" className="flex flex-wrap items-center gap-1.5">
      <button
        type="button"
        aria-label="Halaman sebelumnya"
        disabled={props.current <= 1}
        onClick={() => props.onPage(props.current - 1)}
        className="inline-flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg border border-[#dfe6ec] bg-white px-2 text-[13px] text-[#4a5a6a] hover:bg-[#f4f7fa] disabled:opacity-50"
      >
        ‹
      </button>
      {items.map((item, i) =>
        item === 'ellipsis' ? (
          <span key={'e' + i} aria-hidden="true" className="px-1 text-[#8a97a3]">
            …
          </span>
        ) : (
          <button
            key={item}
            type="button"
            aria-label={'Halaman ' + item}
            aria-current={item === props.current ? 'page' : undefined}
            onClick={() => props.onPage(item)}
            className={
              'inline-flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg border px-2 text-[13px] font-medium ' +
              (item === props.current
                ? 'border-accent bg-accent text-white'
                : 'border-[#dfe6ec] bg-white text-[#4a5a6a] hover:bg-[#f4f7fa]')
            }
          >
            {item}
          </button>
        ),
      )}
      <button
        type="button"
        aria-label="Halaman berikutnya"
        disabled={props.current >= props.totalPages}
        onClick={() => props.onPage(props.current + 1)}
        className="inline-flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg border border-[#dfe6ec] bg-white px-2 text-[13px] text-[#4a5a6a] hover:bg-[#f4f7fa] disabled:opacity-50"
      >
        ›
      </button>
    </nav>
  );
}

function SaveIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="mr-1"
    >
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2Z" />
      <path d="M17 21v-8H7v8M7 3v5h8" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12.5 2.5 2.5 4.5-5.5" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v4M12 16h.01" />
    </svg>
  );
}

function CategoryIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}

