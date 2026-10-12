// New-report form (Phase 3 P3-5): dependent selects (gedung → ruangan,
// kategori → asset) fed by ONE form-options fetch → review step with a
// pre-submit duplicate check → idempotent submit → ticket success screen.
//
// Indonesian copy, accessible (labels on every input, role=alert errors,
// role=status loading, disabled-while-pending submit, real buttons), no
// styling framework (follows login.tsx). Server validation stays
// authoritative: repo 400 messages render as-is; 401 redirects to /login.
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import {
  buildDuplicateCheckParams,
  buildingsOf,
  filterAssetsByCategoryLocation,
  issueTypesForCategory,
  roomsForBuilding,
  toDuplicateCheckQuery,
  validateReportForm,
  visibleLocations,
  type ReportFormErrors,
  type ReportFormValues,
} from '../lib/report-helpers.js';
import type { DuplicateCandidate } from '@silapor/database';
import type { FormOptions } from '../server/reports.js';

interface NewLoaderData {
  readonly options: FormOptions | null;
  readonly loadError: string | null;
  readonly needsClientLoad: boolean;
}

export const Route = createFileRoute('/reporter/reports/new')({
  loader: async (): Promise<NewLoaderData> => {
    let response: Response | null = null;
    try {
      response = await fetch('/api/reports/form-options', { credentials: 'include' });
    } catch {
      // SSR relative-URL fetch (or offline): the component loads client-side.
      return { options: null, loadError: null, needsClientLoad: true };
    }
    if (response.status === 401) {
      throw redirect({ to: '/login' });
    }
    if (!response.ok) {
      return {
        options: null,
        loadError: `Gagal memuat opsi formulir (${response.status}).`,
        needsClientLoad: false,
      };
    }
    return {
      options: (await response.json()) as FormOptions,
      loadError: null,
      needsClientLoad: false,
    };
  },
  component: NewReportPage,
});

const EMPTY_VALUES: ReportFormValues = {
  buildingId: '',
  locationId: '',
  categoryId: '',
  assetId: '',
  issueTypeId: '',
  description: '',
  occurredAt: '',
};

interface ErrorBody {
  readonly error?: { readonly message?: unknown };
}

async function readErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const data = (await response.json()) as ErrorBody;
    if (typeof data.error?.message === 'string' && data.error.message !== '') {
      return data.error.message;
    }
  } catch {
    // Unparseable body — keep the fallback below.
  }
  return fallback;
}

function nameOf(options: ReadonlyArray<{ readonly id: string; readonly name: string }>, id: string): string {
  return options.find((option) => option.id === id)?.name ?? '—';
}

function formatDateTime(value: string): string {
  if (value === '') {
    return '—';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
}

type Phase = 'form' | 'review' | 'success';
type DupState = 'idle' | 'checking' | 'done' | 'error';

interface SubmitResult {
  readonly ticketNumber: string;
  readonly replay: boolean;
}

function NewReportPage() {
  const initial = Route.useLoaderData() as NewLoaderData;
  const navigate = useNavigate();

  const [options, setOptions] = useState<FormOptions | null>(initial.options);
  const [optionsError, setOptionsError] = useState<string | null>(initial.loadError);
  const [optionsPending, setOptionsPending] = useState(false);

  const [values, setValues] = useState<ReportFormValues>(EMPTY_VALUES);
  const [fieldErrors, setFieldErrors] = useState<ReportFormErrors>({});
  const [formAlert, setFormAlert] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('form');

  const [dupState, setDupState] = useState<DupState>('idle');
  const [candidates, setCandidates] = useState<DuplicateCandidate[]>([]);
  const [dupKey, setDupKey] = useState(0);

  const [submitPending, setSubmitPending] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [result, setResult] = useState<SubmitResult | null>(null);

  // Idempotency key per form INSTANCE: generated on mount, reused across
  // retries of the same payload; reset only via "Lapor masalah lain".
  const keyRef = useRef<string | null>(null);
  if (keyRef.current === null) {
    keyRef.current = crypto.randomUUID();
  }

  async function loadOptions(): Promise<void> {
    setOptionsPending(true);
    setOptionsError(null);
    try {
      const response = await fetch('/api/reports/form-options', { credentials: 'include' });
      if (response.status === 401) {
        await navigate({ to: '/login' });
        return;
      }
      if (!response.ok) {
        setOptionsError(`Gagal memuat opsi formulir (${response.status}).`);
        return;
      }
      setOptions((await response.json()) as FormOptions);
    } catch {
      setOptionsError('Gagal memuat opsi formulir. Periksa koneksi Anda lalu coba lagi.');
    } finally {
      setOptionsPending(false);
    }
  }

  // SSR fallback: the loader could not fetch (relative URL on the server),
  // so load client-side once after hydration.
  useEffect(() => {
    if (initial.needsClientLoad) {
      void loadOptions();
    }
  }, []);

  const locations = visibleLocations(options?.locations ?? []);
  const buildingOptions = buildingsOf(locations);
  const roomOptions = values.buildingId === '' ? [] : roomsForBuilding(locations, values.buildingId);
  const categoryOptions = options?.categories ?? [];
  const assetOptions =
    values.categoryId === '' || values.locationId === ''
      ? []
      : filterAssetsByCategoryLocation(
          options?.assets ?? [],
          values.categoryId,
          values.locationId,
        );
  const issueOptions = issueTypesForCategory(options?.issueTypes ?? [], values.categoryId);

  function patch(patchValues: Partial<ReportFormValues>): void {
    setValues((current) => ({ ...current, ...patchValues }));
  }

  function onSubmitDetails(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const errors = validateReportForm(values);
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) {
      setFormAlert('Periksa kembali isian formulir.');
      return;
    }
    setFormAlert(null);
    setServerError(null);
    setCandidates([]);
    setDupState('idle');
    setDupKey((key) => key + 1);
    setPhase('review');
  }

  // Pre-submit duplicate check: runs on entering review. Candidates are a
  // warning only — submit creates regardless.
  useEffect(() => {
    if (phase !== 'review') {
      return;
    }
    let cancelled = false;
    async function check(): Promise<void> {
      setDupState('checking');
      const params = buildDuplicateCheckParams(values);
      try {
        const response = await fetch(
          `/api/reports/duplicate-check?${toDuplicateCheckQuery(params)}`,
          { credentials: 'include' },
        );
        if (response.status === 401) {
          await navigate({ to: '/login' });
          return;
        }
        if (!response.ok) {
          if (!cancelled) {
            setDupState('error');
          }
          return;
        }
        const data = (await response.json()) as { candidates?: DuplicateCandidate[] };
        if (!cancelled) {
          setCandidates(Array.isArray(data.candidates) ? data.candidates : []);
          setDupState('done');
        }
      } catch {
        if (!cancelled) {
          setDupState('error');
        }
      }
    }
    void check();
    return () => {
      cancelled = true;
    };
  }, [dupKey]);

  async function submit(): Promise<void> {
    if (submitPending) {
      return;
    }
    setSubmitPending(true);
    setServerError(null);
    const payload = {
      locationId: values.locationId,
      assetId: values.assetId === '' ? null : values.assetId,
      submittedCategoryId: values.categoryId,
      submittedIssueTypeId: values.issueTypeId,
      description: values.description.trim(),
      occurredAt:
        values.occurredAt === '' ? null : new Date(values.occurredAt).toISOString(),
    };
    try {
      const response = await fetch('/api/reports', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'content-type': 'application/json',
          'x-idempotency-key': keyRef.current ?? crypto.randomUUID(),
        },
        body: JSON.stringify(payload),
      });
      if (response.status === 401) {
        await navigate({ to: '/login' });
        return;
      }
      if (!response.ok) {
        // Server validation is authoritative — render the repo message as-is.
        setServerError(await readErrorMessage(response, 'Gagal mengirim laporan. Coba lagi.'));
        return;
      }
      const data = (await response.json()) as {
        report?: { ticketNumber?: unknown };
        idempotentReplay?: unknown;
      };
      const ticketNumber =
        typeof data.report?.ticketNumber === 'string' ? data.report.ticketNumber : '';
      setResult({ ticketNumber, replay: data.idempotentReplay === true });
      setPhase('success');
    } catch {
      setServerError('Jaringan bermasalah. Coba lagi — kunci idempotensi dipakai ulang.');
    } finally {
      setSubmitPending(false);
    }
  }

  function resetForm(): void {
    keyRef.current = crypto.randomUUID();
    setValues(EMPTY_VALUES);
    setFieldErrors({});
    setFormAlert(null);
    setServerError(null);
    setCandidates([]);
    setDupState('idle');
    setResult(null);
    setPhase('form');
  }

  if (options === null) {
    return (
      <section aria-labelledby="new-report-title">
        <h1 id="new-report-title">Buat Laporan Baru</h1>
        {optionsPending || (optionsError === null && initial.needsClientLoad) ? (
          <p role="status">Memuat opsi formulir…</p>
        ) : null}
        {optionsError !== null ? (
          <>
            <p role="alert">{optionsError}</p>
            <button type="button" onClick={() => void loadOptions()} disabled={optionsPending}>
              {optionsPending ? 'Memuat…' : 'Coba lagi'}
            </button>
          </>
        ) : null}
      </section>
    );
  }

  if (phase === 'success' && result !== null) {
    return (
      <section aria-labelledby="new-report-success-title">
        <h1 id="new-report-success-title">Laporan berhasil dikirim</h1>
        <p role="status">
          Nomor tiket Anda: <strong>{result.ticketNumber}</strong>
        </p>
        {result.replay ? <p>Laporan sudah tercatat dengan nomor tiket tersebut.</p> : null}
        <p>
          <Link to="/reporter/reports/$ticket" params={{ ticket: result.ticketNumber }}>
            Lihat detail laporan
          </Link>
        </p>
        <p>
          <Link to="/reporter/reports" search={{ filter: 'semua', status: '', offset: 0 }}>Laporan Saya</Link>
        </p>
        <button type="button" onClick={resetForm}>
          Lapor masalah lain
        </button>
      </section>
    );
  }

  if (phase === 'review') {
    const assetName =
      values.assetId === '' ? 'Tanpa asset' : nameOf(options.assets, values.assetId);
    return (
      <section aria-labelledby="new-report-review-title">
        <h1 id="new-report-review-title">Tinjau Laporan</h1>
        <dl>
          <dt>Gedung</dt>
          <dd>{nameOf(locations, values.buildingId)}</dd>
          <dt>Ruangan</dt>
          <dd>{nameOf(locations, values.locationId)}</dd>
          <dt>Kategori</dt>
          <dd>{nameOf(categoryOptions, values.categoryId)}</dd>
          <dt>Asset</dt>
          <dd>{assetName}</dd>
          <dt>Jenis masalah</dt>
          <dd>{nameOf(options.issueTypes, values.issueTypeId)}</dd>
          <dt>Deskripsi</dt>
          <dd>{values.description.trim()}</dd>
          <dt>Waktu kejadian</dt>
          <dd>{formatDateTime(values.occurredAt)}</dd>
        </dl>

        {dupState === 'checking' ? <p role="status">Memeriksa laporan serupa…</p> : null}
        {dupState === 'error' ? (
          <p>
            Pemeriksaan duplikat gagal.{' '}
            <button
              type="button"
              onClick={() => setDupKey((key) => key + 1)}
              disabled={submitPending}
            >
              Coba lagi
            </button>
          </p>
        ) : null}
        {dupState === 'done' && candidates.length > 0 ? (
          <section aria-labelledby="duplicate-warning-title">
            <h2 id="duplicate-warning-title">Laporan serupa ditemukan</h2>
            <p>
              Laporan berikut tampak mirip. Jika masalah Anda sama, buka tiket lama tersebut.
              Jika berbeda, tetap kirim laporan baru.
            </p>
            <ul>
              {candidates.map((candidate) => (
                <li key={candidate.id}>
                  <Link to="/reporter/reports/$ticket" params={{ ticket: candidate.ticketNumber }}>
                    {candidate.ticketNumber}
                  </Link>
                </li>
              ))}
            </ul>
            <p>
              <Link
                to="/reporter/reports/$ticket"
                params={{ ticket: candidates[0]?.ticketNumber ?? '' }}
              >
                Buka tiket lama
              </Link>
            </p>
          </section>
        ) : null}

        {serverError !== null ? <p role="alert">{serverError}</p> : null}
        <p>
          <button type="button" onClick={() => setPhase('form')} disabled={submitPending}>
            Kembali
          </button>{' '}
          {dupState === 'done' && candidates.length > 0 ? (
            <button type="button" onClick={() => void submit()} disabled={submitPending}>
              {submitPending ? 'Mengirim…' : 'Tetap kirim — masalah berbeda'}
            </button>
          ) : (
            <button type="button" onClick={() => void submit()} disabled={submitPending}>
              {submitPending ? 'Mengirim…' : 'Kirim laporan'}
            </button>
          )}
        </p>
      </section>
    );
  }

  const descLength = values.description.trim().length;
  return (
    <section aria-labelledby="new-report-title">
      <h1 id="new-report-title">Buat Laporan Baru</h1>
      {formAlert !== null ? <p role="alert">{formAlert}</p> : null}
      <form onSubmit={onSubmitDetails}>
        <div>
          <label htmlFor="report-building">Gedung</label>
          <select
            id="report-building"
            value={values.buildingId}
            onChange={(event) => {
              patch({ buildingId: event.target.value, locationId: '', assetId: '' });
            }}
          >
            <option value="">Pilih gedung</option>
            {buildingOptions.map((building) => (
              <option key={building.id} value={building.id}>
                {building.name}
              </option>
            ))}
          </select>
          {fieldErrors.buildingId !== undefined ? <p>{fieldErrors.buildingId}</p> : null}
        </div>

        <div>
          <label htmlFor="report-room">Ruangan</label>
          <select
            id="report-room"
            value={values.locationId}
            disabled={values.buildingId === ''}
            onChange={(event) => {
              patch({ locationId: event.target.value, assetId: '' });
            }}
          >
            <option value="">
              {values.buildingId === '' ? 'Pilih gedung terlebih dahulu' : 'Pilih ruangan'}
            </option>
            {roomOptions.map((room) => (
              <option key={room.id} value={room.id}>
                {room.name}
              </option>
            ))}
          </select>
          {fieldErrors.locationId !== undefined ? <p>{fieldErrors.locationId}</p> : null}
        </div>

        <div>
          <label htmlFor="report-category">Kategori</label>
          <select
            id="report-category"
            value={values.categoryId}
            onChange={(event) => {
              patch({ categoryId: event.target.value, assetId: '' });
            }}
          >
            <option value="">Pilih kategori</option>
            {categoryOptions.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
          {fieldErrors.categoryId !== undefined ? <p>{fieldErrors.categoryId}</p> : null}
        </div>

        <div>
          <label htmlFor="report-asset">Asset (opsional)</label>
          <select
            id="report-asset"
            value={values.assetId}
            disabled={values.categoryId === '' || values.locationId === ''}
            onChange={(event) => {
              patch({ assetId: event.target.value });
            }}
          >
            <option value="">Tanpa asset — asset tidak ditemukan</option>
            {assetOptions.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.name} ({asset.assetCode})
              </option>
            ))}
          </select>
          {fieldErrors.assetId !== undefined ? <p>{fieldErrors.assetId}</p> : null}
        </div>

        <div>
          <label htmlFor="report-issue-type">Jenis masalah</label>
          <select
            id="report-issue-type"
            value={values.issueTypeId}
            onChange={(event) => {
              patch({ issueTypeId: event.target.value });
            }}
          >
            <option value="">Pilih jenis masalah</option>
            {issueOptions.map((issueType) => (
              <option key={issueType.id} value={issueType.id}>
                {issueType.name}
              </option>
            ))}
          </select>
          {fieldErrors.issueTypeId !== undefined ? <p>{fieldErrors.issueTypeId}</p> : null}
        </div>

        <div>
          <label htmlFor="report-description">Deskripsi</label>
          <textarea
            id="report-description"
            value={values.description}
            maxLength={2000}
            rows={5}
            onChange={(event) => {
              patch({ description: event.target.value });
            }}
          />
          <p aria-live="polite">{descLength}/2000 karakter</p>
          <p>Minimal 10 karakter.</p>
          {fieldErrors.description !== undefined ? <p>{fieldErrors.description}</p> : null}
        </div>

        <div>
          <label htmlFor="report-occurred-at">Waktu kejadian (opsional)</label>
          <input
            id="report-occurred-at"
            type="datetime-local"
            value={values.occurredAt}
            onChange={(event) => {
              patch({ occurredAt: event.target.value });
            }}
          />
          {fieldErrors.occurredAt !== undefined ? <p>{fieldErrors.occurredAt}</p> : null}
        </div>

        <button type="submit">Lanjut ke review</button>
      </form>
      <p>
        <Link to="/reporter/reports" search={{ filter: 'semua', status: '', offset: 0 }}>Laporan Saya</Link>
      </p>
    </section>
  );
}
