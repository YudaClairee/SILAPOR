// New-report form (Phase 3 P3-5): dependent selects (gedung → ruangan,
// kategori → asset) fed by ONE form-options fetch → review step with a
// pre-submit duplicate check → idempotent submit → ticket success screen.
//
// Indonesian copy, accessible (labels on every input, role=alert errors,
// role=status loading, disabled-while-pending submit, real buttons), no
// styling framework (follows login.tsx). Server validation stays
// authoritative: repo 400 messages render as-is; 401 redirects to /login.
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import {
  Button,
  ErrorPanel,
  FieldError,
  Input,
  LoadingState,
  Select,
  Textarea,
  TicketMono,
  buttonBaseClasses,
  buttonVariantClasses,
} from '../components/index.js';
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
import { uploadReportAttachments, validateAttachmentFiles } from '../lib/attachments.js';
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
  readonly uploadedCount: number;
  readonly uploadFailed: boolean;
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

  // Phase 4 P4-4: optional photos, picked in the form, uploaded AFTER the
  // ticket exists (same session; a fresh ticket needs no idempotency key).
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [retryPending, setRetryPending] = useState(false);

  function onPickPhotos(event: ChangeEvent<HTMLInputElement>): void {
    const picked = Array.from(event.target.files ?? []);
    // Reset so the same file can be re-picked after a rejection.
    event.target.value = '';
    if (picked.length === 0) {
      return;
    }
    const combined = [...photoFiles, ...picked];
    const errors = validateAttachmentFiles(combined);
    if (errors.length > 0) {
      setPhotoError(errors[0] ?? 'Foto tidak valid.');
      return;
    }
    setPhotoError(null);
    setPhotoFiles(combined);
  }

  function removePhoto(index: number): void {
    setPhotoFiles((current) => current.filter((_, i) => i !== index));
    setPhotoError(null);
  }

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
      // Photos upload AFTER the ticket exists. submitPending stays true
      // throughout, so every button stays disabled while uploading. A failed
      // upload never loses the ticket — the success screen keeps the files
      // and offers a retry.
      let uploadedCount = 0;
      let uploadFailed = false;
      if (photoFiles.length > 0) {
        try {
          uploadedCount = (await uploadReportAttachments(ticketNumber, photoFiles)).length;
        } catch {
          uploadFailed = true;
        }
      }
      setResult({
        ticketNumber,
        replay: data.idempotentReplay === true,
        uploadedCount,
        uploadFailed,
      });
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
    setPhotoFiles([]);
    setPhotoError(null);
    setRetryPending(false);
    setPhase('form');
  }

  async function retryUpload(): Promise<void> {
    if (retryPending || result === null) {
      return;
    }
    setRetryPending(true);
    try {
      const uploaded = await uploadReportAttachments(result.ticketNumber, photoFiles);
      setResult({ ...result, uploadedCount: uploaded.length, uploadFailed: false });
    } catch {
      setResult({ ...result, uploadFailed: true });
    } finally {
      setRetryPending(false);
    }
  }

  if (options === null) {
    return (
      <section aria-labelledby="new-report-title" className="max-w-3xl">
        <h1 id="new-report-title" className="text-2xl font-semibold text-text">
          Buat Laporan Baru
        </h1>
        {optionsPending || (optionsError === null && initial.needsClientLoad) ? (
          <div className="mt-4">
            <LoadingState message="Memuat opsi formulir…" />
          </div>
        ) : null}
        {optionsError !== null ? (
          <div className="mt-4">
            <ErrorPanel
              message={optionsError}
              retry={
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => void loadOptions()}
                  disabled={optionsPending}
                >
                  {optionsPending ? 'Memuat…' : 'Coba lagi'}
                </Button>
              }
            />
          </div>
        ) : null}
      </section>
    );
  }

  if (phase === 'success' && result !== null) {
    return (
      <section aria-labelledby="new-report-success-title" className="max-w-3xl">
        <div className="rounded-md border border-border bg-surface p-6 text-center md:p-8">
          <h1 id="new-report-success-title" className="text-2xl font-semibold text-text">
            Laporan berhasil dikirim
          </h1>
          <p role="status" className="mt-4 text-sm text-muted">
            Nomor tiket Anda:{' '}
            <TicketMono className="block pt-2 text-3xl font-medium text-text">
              {result.ticketNumber}
            </TicketMono>
          </p>
          {photoFiles.length > 0 && result.uploadedCount > 0 ? (
            <p className="mt-2 text-sm text-muted">{result.uploadedCount} foto terlampir.</p>
          ) : null}
          {result.uploadFailed ? (
            <div className="mt-4">
              <ErrorPanel message="Foto gagal diunggah, tetapi laporan tetap tersimpan." />
              <p className="mt-2">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => void retryUpload()}
                  disabled={retryPending}
                >
                  {retryPending ? 'Mengunggah…' : 'Coba unggah lagi'}
                </Button>
              </p>
            </div>
          ) : null}
          {result.replay ? (
            <p className="mt-2 text-sm text-muted">
              Laporan sudah tercatat dengan nomor tiket tersebut.
            </p>
          ) : null}
          <p className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
            <Link
              to="/reporter/reports/$ticket"
              params={{ ticket: result.ticketNumber }}
              className={`${buttonBaseClasses} ${buttonVariantClasses.primary}`}
            >
              Lihat detail laporan
            </Link>
            <Link
              to="/reporter/reports"
              search={{ filter: 'semua', status: '', offset: 0 }}
              className={`${buttonBaseClasses} ${buttonVariantClasses.secondary}`}
            >
              Laporan Saya
            </Link>
            <Button type="button" variant="ghost" onClick={resetForm}>
              Lapor masalah lain
            </Button>
          </p>
        </div>
      </section>
    );
  }

  if (phase === 'review') {
    const assetName =
      values.assetId === '' ? 'Tanpa asset' : nameOf(options.assets, values.assetId);
    return (
      <section aria-labelledby="new-report-review-title" className="max-w-3xl">
        <h1 id="new-report-review-title" className="text-2xl font-semibold text-text">
          Tinjau Laporan
        </h1>
        <div className="mt-4 rounded-md border border-border bg-surface px-4 md:px-6">
          <dl className="divide-y divide-border">
            <div className="flex flex-col gap-1 py-3 sm:flex-row sm:gap-4">
              <dt className="shrink-0 text-sm font-medium text-muted sm:w-40">Gedung</dt>
              <dd className="text-sm text-text">{nameOf(locations, values.buildingId)}</dd>
            </div>
            <div className="flex flex-col gap-1 py-3 sm:flex-row sm:gap-4">
              <dt className="shrink-0 text-sm font-medium text-muted sm:w-40">Ruangan</dt>
              <dd className="text-sm text-text">{nameOf(locations, values.locationId)}</dd>
            </div>
            <div className="flex flex-col gap-1 py-3 sm:flex-row sm:gap-4">
              <dt className="shrink-0 text-sm font-medium text-muted sm:w-40">Kategori</dt>
              <dd className="text-sm text-text">{nameOf(categoryOptions, values.categoryId)}</dd>
            </div>
            <div className="flex flex-col gap-1 py-3 sm:flex-row sm:gap-4">
              <dt className="shrink-0 text-sm font-medium text-muted sm:w-40">Asset</dt>
              <dd className="text-sm text-text">{assetName}</dd>
            </div>
            <div className="flex flex-col gap-1 py-3 sm:flex-row sm:gap-4">
              <dt className="shrink-0 text-sm font-medium text-muted sm:w-40">
                Jenis masalah
              </dt>
              <dd className="text-sm text-text">{nameOf(options.issueTypes, values.issueTypeId)}</dd>
            </div>
            <div className="flex flex-col gap-1 py-3 sm:flex-row sm:gap-4">
              <dt className="shrink-0 text-sm font-medium text-muted sm:w-40">Deskripsi</dt>
              <dd className="text-pretty text-sm break-words whitespace-pre-wrap text-text">
                {values.description.trim()}
              </dd>
            </div>
            <div className="flex flex-col gap-1 py-3 sm:flex-row sm:gap-4">
              <dt className="shrink-0 text-sm font-medium text-muted sm:w-40">
                Waktu kejadian
              </dt>
              <dd className="text-sm text-text">{formatDateTime(values.occurredAt)}</dd>
            </div>
          </dl>
        </div>

        {dupState === 'checking' ? (
          <div className="mt-4">
            <LoadingState message="Memeriksa laporan serupa…" />
          </div>
        ) : null}
        {dupState === 'error' ? (
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:items-center">
            <p className="text-sm text-muted">Pemeriksaan duplikat gagal.</p>
            <Button
              type="button"
              variant="secondary"
              onClick={() => setDupKey((key) => key + 1)}
              disabled={submitPending}
            >
              Coba lagi
            </Button>
          </div>
        ) : null}
        {dupState === 'done' && candidates.length > 0 ? (
          <section
            aria-labelledby="duplicate-warning-title"
            className="mt-4 rounded-md border border-warning bg-tint-warning p-4"
          >
            <h2 id="duplicate-warning-title" className="text-base font-semibold text-text">
              Laporan serupa ditemukan
            </h2>
            <p className="mt-1 text-sm text-text">
              Laporan berikut tampak mirip. Jika masalah Anda sama, buka tiket lama tersebut.
              Jika berbeda, tetap kirim laporan baru.
            </p>
            <ul className="mt-2 flex flex-wrap gap-2">
              {candidates.map((candidate) => (
                <li key={candidate.id}>
                  <Link
                    to="/reporter/reports/$ticket"
                    params={{ ticket: candidate.ticketNumber }}
                    className="text-accent underline underline-offset-2"
                  >
                    <TicketMono>{candidate.ticketNumber}</TicketMono>
                  </Link>
                </li>
              ))}
            </ul>
            <p className="mt-3">
              <Link
                to="/reporter/reports/$ticket"
                params={{ ticket: candidates[0]?.ticketNumber ?? '' }}
                className={`${buttonBaseClasses} ${buttonVariantClasses.secondary}`}
              >
                Buka tiket lama
              </Link>
            </p>
          </section>
        ) : null}

        {serverError !== null ? (
          <div className="mt-4">
            <ErrorPanel message={serverError} />
          </div>
        ) : null}
        <p className="mt-4 flex flex-col gap-2 sm:flex-row">
          <Button
            type="button"
            variant="secondary"
            onClick={() => setPhase('form')}
            disabled={submitPending}
          >
            Kembali
          </Button>
          {dupState === 'done' && candidates.length > 0 ? (
            <Button type="button" onClick={() => void submit()} disabled={submitPending}>
              {submitPending ? 'Mengirim…' : 'Tetap kirim — masalah berbeda'}
            </Button>
          ) : (
            <Button type="button" onClick={() => void submit()} disabled={submitPending}>
              {submitPending ? 'Mengirim…' : 'Kirim laporan'}
            </Button>
          )}
        </p>
      </section>
    );
  }

  const descLength = values.description.trim().length;
  return (
    <section aria-labelledby="new-report-title" className="max-w-3xl">
      <h1 id="new-report-title" className="text-2xl font-semibold text-text">
        Buat Laporan Baru
      </h1>
      {formAlert !== null ? (
        <div className="mt-4">
          <ErrorPanel message={formAlert} />
        </div>
      ) : null}
      <form onSubmit={onSubmitDetails} className="mt-4 rounded-md border border-border bg-surface p-4 md:p-6">
        <div className="flex flex-col gap-4">
          <div>
            <label htmlFor="report-building" className="mb-1 block text-sm font-medium text-text">
              Gedung
            </label>
            <Select
              id="report-building"
              value={values.buildingId}
              invalid={fieldErrors.buildingId !== undefined}
              aria-describedby={fieldErrors.buildingId ? 'report-building-error' : undefined}
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
            </Select>
            <FieldError id="report-building-error" message={fieldErrors.buildingId} />
          </div>

          <div>
            <label htmlFor="report-room" className="mb-1 block text-sm font-medium text-text">
              Ruangan
            </label>
            <Select
              id="report-room"
              value={values.locationId}
              disabled={values.buildingId === ''}
              invalid={fieldErrors.locationId !== undefined}
              aria-describedby={fieldErrors.locationId ? 'report-room-error' : undefined}
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
            </Select>
            <FieldError id="report-room-error" message={fieldErrors.locationId} />
          </div>

          <div>
            <label htmlFor="report-category" className="mb-1 block text-sm font-medium text-text">
              Kategori
            </label>
            <Select
              id="report-category"
              value={values.categoryId}
              invalid={fieldErrors.categoryId !== undefined}
              aria-describedby={fieldErrors.categoryId ? 'report-category-error' : undefined}
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
            </Select>
            <FieldError id="report-category-error" message={fieldErrors.categoryId} />
          </div>

          <div>
            <label htmlFor="report-asset" className="mb-1 block text-sm font-medium text-text">
              Asset (opsional)
            </label>
            <Select
              id="report-asset"
              value={values.assetId}
              disabled={values.categoryId === '' || values.locationId === ''}
              invalid={fieldErrors.assetId !== undefined}
              aria-describedby={fieldErrors.assetId ? 'report-asset-error' : undefined}
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
            </Select>
            <FieldError id="report-asset-error" message={fieldErrors.assetId} />
          </div>

          <div>
            <label htmlFor="report-issue-type" className="mb-1 block text-sm font-medium text-text">
              Jenis masalah
            </label>
            <Select
              id="report-issue-type"
              value={values.issueTypeId}
              invalid={fieldErrors.issueTypeId !== undefined}
              aria-describedby={fieldErrors.issueTypeId ? 'report-issue-type-error' : undefined}
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
            </Select>
            <FieldError id="report-issue-type-error" message={fieldErrors.issueTypeId} />
          </div>

          <div>
            <label htmlFor="report-description" className="mb-1 block text-sm font-medium text-text">
              Deskripsi
            </label>
            <Textarea
              id="report-description"
              value={values.description}
              maxLength={2000}
              rows={5}
              invalid={fieldErrors.description !== undefined}
              aria-describedby={fieldErrors.description ? 'report-description-error' : undefined}
              onChange={(event) => {
                patch({ description: event.target.value });
              }}
            />
            <p aria-live="polite" className="mt-1 font-mono text-xs text-subtle">
              {descLength}/2000 karakter
            </p>
            <p className="mt-1 text-sm text-muted">Minimal 10 karakter.</p>
            <FieldError id="report-description-error" message={fieldErrors.description} />
          </div>

          <div>
            <label htmlFor="report-occurred-at" className="mb-1 block text-sm font-medium text-text">
              Waktu kejadian (opsional)
            </label>
            <Input
              id="report-occurred-at"
              type="datetime-local"
              value={values.occurredAt}
              invalid={fieldErrors.occurredAt !== undefined}
              aria-describedby={fieldErrors.occurredAt ? 'report-occurred-at-error' : undefined}
              onChange={(event) => {
                patch({ occurredAt: event.target.value });
              }}
            />
            <FieldError id="report-occurred-at-error" message={fieldErrors.occurredAt} />
          </div>

          <div>
            <label htmlFor="report-photos" className="mb-1 block text-sm font-medium text-text">
              Foto (opsional)
            </label>
            <Input
              id="report-photos"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              onChange={onPickPhotos}
              aria-describedby={photoError !== null ? 'report-photos-error' : 'report-photos-hint'}
            />
            <p id="report-photos-hint" className="mt-1 text-sm text-muted">
              Maksimal 3 foto, masing-masing ≤ 5 MB (JPG, PNG, WebP).
            </p>
            <FieldError id="report-photos-error" message={photoError ?? undefined} />
            {photoFiles.length > 0 ? (
              <ul className="mt-2 flex flex-col gap-1">
                {photoFiles.map((file, index) => (
                  <li
                    key={`${file.name}-${file.size}-${index}`}
                    className="flex items-center justify-between gap-2 text-sm text-text"
                  >
                    <span className="truncate">{file.name}</span>
                    <Button type="button" variant="ghost" onClick={() => removePhoto(index)}>
                      Hapus
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <Button type="submit">Lanjut ke review</Button>
        </div>
      </form>
      <p className="mt-4">
        <Link
          to="/reporter/reports"
          search={{ filter: 'semua', status: '', offset: 0 }}
          className="text-accent underline underline-offset-2"
        >
          Laporan Saya
        </Link>
      </p>
    </section>
  );
}
