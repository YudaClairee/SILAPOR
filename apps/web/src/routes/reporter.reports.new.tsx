// New-report form for the AI verification flow: full chain
// gedung → lantai → ruangan → aset (all required) plus description and
// 1-3 photos, then a blocking wait for the inline verdict.
//
// Indonesian copy, accessible labels on every input, role=alert errors,
// role=status loading, disabled-until-valid submit, real buttons, no
// styling framework (follows login.tsx). Server validation stays
// authoritative: 422 reasons render as-is; 401 redirects to /login.
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import { Link, createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import {
  Button,
  EmptyState,
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
import { visibleLocations } from '../lib/report-helpers.js';
import {
  uploadReportAttachments,
  validateAttachmentFiles,
  type ClientFileLike,
} from '../lib/attachments.js';

// ---------------------------------------------------------------------------
// Pure form contract (exported for tests).
// ---------------------------------------------------------------------------

export interface NewReportValues {
  readonly buildingId: string;
  readonly floorId: string;
  readonly locationId: string;
  readonly assetId: string;
  readonly description: string;
}

export type NewReportField =
  | 'buildingId'
  | 'floorId'
  | 'locationId'
  | 'assetId'
  | 'description'
  | 'photos';

export type NewReportErrors = Partial<Record<NewReportField, string>>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CascadeLocation {
  readonly id: string;
  readonly type: string;
  readonly parentId: string | null;
}

export interface RoomAsset {
  readonly id: string;
  readonly locationId: string | null;
}

// Floors of one building (BUILDING → FLOOR rows).
export function floorsForBuilding<T extends CascadeLocation>(
  locations: readonly T[],
  buildingId: string,
): T[] {
  return locations.filter(
    (location) => location.type === 'FLOOR' && location.parentId === buildingId,
  );
}

// Rooms directly under a parent: a selected floor, or the building itself
// when the building lists rooms without floors.
export function roomsForParent<T extends CascadeLocation>(
  locations: readonly T[],
  parentId: string,
): T[] {
  return locations.filter(
    (location) => location.type === 'ROOM' && location.parentId === parentId,
  );
}

// Assets placed in the chosen room. Null placements never match.
export function assetsForRoom<T extends RoomAsset>(assets: readonly T[], roomId: string): T[] {
  return assets.filter((asset) => asset.locationId === roomId);
}

// Fast client feedback only: required chain, description 10-2000 trimmed,
// 1-3 valid photos. The server validators stay authoritative.
export function validateNewReportForm(
  values: NewReportValues,
  photoFiles: readonly ClientFileLike[],
  floorRequired: boolean,
): NewReportErrors {
  const errors: NewReportErrors = {};
  if (values.buildingId === '') {
    errors.buildingId = 'Pilih gedung terlebih dahulu.';
  }
  if (floorRequired && values.floorId === '') {
    errors.floorId = 'Pilih lantai terlebih dahulu.';
  }
  if (values.locationId === '') {
    errors.locationId = 'Pilih ruangan terlebih dahulu.';
  } else if (!UUID_RE.test(values.locationId)) {
    errors.locationId = 'Ruangan tidak valid.';
  }
  if (values.assetId === '') {
    errors.assetId = 'Pilih aset terlebih dahulu.';
  } else if (!UUID_RE.test(values.assetId)) {
    errors.assetId = 'Aset tidak valid.';
  }
  const trimmed = values.description.trim();
  if (trimmed.length < 10) {
    errors.description = 'Deskripsi minimal 10 karakter.';
  } else if (trimmed.length > 2000) {
    errors.description = 'Deskripsi maksimal 2000 karakter.';
  }
  if (photoFiles.length === 0) {
    errors.photos = 'Tambahkan minimal 1 foto.';
  } else {
    const photoError = validateAttachmentFiles(photoFiles)[0];
    if (photoError !== undefined) {
      errors.photos = photoError;
    }
  }
  return errors;
}

export function isNewReportSubmittable(
  values: NewReportValues,
  photoFiles: readonly ClientFileLike[],
  floorRequired: boolean,
): boolean {
  return Object.keys(validateNewReportForm(values, photoFiles, floorRequired)).length === 0;
}

// No staging endpoint exists yet, so the submit carries file names as
// photo refs. Bytes upload to the ticket right after the verdict.
export function photoRefsForSubmit(files: readonly ClientFileLike[]): string[] {
  return files.map((file) => file.name);
}

export type SubmitOutcome =
  | { readonly kind: 'verified'; readonly ticketNumber: string; readonly replay: boolean }
  | { readonly kind: 'held'; readonly ticketNumber: string; readonly message: string }
  | { readonly kind: 'failed'; readonly reason: string }
  | { readonly kind: 'duplicate'; readonly ticketNumber: string | null; readonly message: string }
  | { readonly kind: 'error'; readonly message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(body: Record<string, unknown>, key: string): string | null {
  const value = body[key];
  return typeof value === 'string' && value !== '' ? value : null;
}

// Maps the verified submit statuses onto their screens: 201/200 verified,
// 202 held, 422 failed with reason, 409 duplicate block with ticket ref.
export function toSubmitOutcome(status: number, body: unknown): SubmitOutcome {
  if (!isRecord(body)) {
    if (status === 422) {
      return { kind: 'failed', reason: 'Verifikasi gagal. Coba lagi dengan foto yang lebih jelas.' };
    }
    return { kind: 'error', message: `Gagal mengirim laporan (status ${status}).` };
  }
  if (status === 201 || status === 200) {
    const ticketNumber = stringField(body, 'ticketNumber');
    if (ticketNumber === null) {
      return { kind: 'error', message: 'Tiket tidak ditemukan pada respons server.' };
    }
    return { kind: 'verified', ticketNumber, replay: body['idempotentReplay'] === true };
  }
  if (status === 202) {
    const ticketNumber = stringField(body, 'ticketNumber');
    if (ticketNumber === null) {
      return { kind: 'error', message: 'Tiket tidak ditemukan pada respons server.' };
    }
    const message =
      stringField(body, 'message') ?? 'Laporan tersimpan dan menunggu pemeriksaan.';
    return { kind: 'held', ticketNumber, message };
  }
  if (status === 422) {
    const reason =
      stringField(body, 'reason') ?? 'Verifikasi gagal. Coba lagi dengan foto yang lebih jelas.';
    return { kind: 'failed', reason };
  }
  if (status === 409) {
    const errorBody = body['error'];
    const message = isRecord(errorBody)
      ? (stringField(errorBody, 'message') ?? 'Laporan serupa sudah tercatat.')
      : 'Laporan serupa sudah tercatat.';
    const raw = body['ticketNumber'];
    return {
      kind: 'duplicate',
      ticketNumber: typeof raw === 'string' && raw !== '' ? raw : null,
      message,
    };
  }
  const errorBody = body['error'];
  const message = isRecord(errorBody)
    ? (stringField(errorBody, 'message') ?? `Gagal mengirim laporan (status ${status}).`)
    : `Gagal mengirim laporan (status ${status}).`;
  return { kind: 'error', message };
}

// ---------------------------------------------------------------------------
// Route.
// ---------------------------------------------------------------------------

interface LocationOption {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly type: string;
  readonly parentId: string | null;
  readonly buildingCode: string | null;
}

interface AssetOption {
  readonly id: string;
  readonly assetCode: string;
  readonly name: string;
  readonly locationId: string | null;
}

// The form reads only locations and assets from the payload.
interface NewFormOptions {
  readonly locations: LocationOption[];
  readonly assets: AssetOption[];
}

interface NewLoaderData {
  readonly options: NewFormOptions | null;
  readonly loadError: string | null;
  readonly forbidden: boolean;
  readonly needsClientLoad: boolean;
}

function toNewFormOptions(data: unknown): NewFormOptions | null {
  if (!isRecord(data)) {
    return null;
  }
  const locations = data['locations'];
  const assets = data['assets'];
  if (!Array.isArray(locations) || !Array.isArray(assets)) {
    return null;
  }
  return {
    locations: locations as LocationOption[],
    assets: assets as AssetOption[],
  };
}

export const Route = createFileRoute('/reporter/reports/new')({
  loader: async (): Promise<NewLoaderData> => {
    let response: Response | null = null;
    try {
      response = await fetch('/api/reports/form-options', { credentials: 'include' });
    } catch {
      // SSR relative-URL fetch (or offline): the component loads client-side.
      return { options: null, loadError: null, forbidden: false, needsClientLoad: true };
    }
    if (response.status === 401) {
      throw redirect({ to: '/login' });
    }
    if (response.status === 403) {
      return { options: null, loadError: null, forbidden: true, needsClientLoad: false };
    }
    if (!response.ok) {
      return {
        options: null,
        loadError: `Gagal memuat opsi formulir (${response.status}).`,
        forbidden: false,
        needsClientLoad: false,
      };
    }
    let data: unknown = null;
    try {
      data = (await response.json()) as unknown;
    } catch {
      data = null;
    }
    const options = toNewFormOptions(data);
    if (options === null) {
      return {
        options: null,
        loadError: 'Format opsi formulir tidak dikenal.',
        forbidden: false,
        needsClientLoad: false,
      };
    }
    return { options, loadError: null, forbidden: false, needsClientLoad: false };
  },
  component: NewReportPage,
});

const EMPTY_VALUES: NewReportValues = {
  buildingId: '',
  floorId: '',
  locationId: '',
  assetId: '',
  description: '',
};

function nameOf(options: ReadonlyArray<{ readonly id: string; readonly name: string }>, id: string): string {
  return options.find((option) => option.id === id)?.name ?? '—';
}

type Phase = 'form' | 'waiting' | 'verified' | 'held' | 'failed' | 'duplicate';

function NewReportPage() {
  const initial = Route.useLoaderData() as NewLoaderData;
  const navigate = useNavigate();

  const [options, setOptions] = useState<NewFormOptions | null>(initial.options);
  const [optionsError, setOptionsError] = useState<string | null>(initial.loadError);
  const [forbidden, setForbidden] = useState(initial.forbidden);
  const [optionsPending, setOptionsPending] = useState(false);

  const [values, setValues] = useState<NewReportValues>(EMPTY_VALUES);
  const [attempted, setAttempted] = useState(false);
  const [formAlert, setFormAlert] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('form');

  const [photoFiles, setPhotoFiles] = useState<File[]>([]);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [failReason, setFailReason] = useState<string | null>(null);
  const [ticket, setTicket] = useState<string | null>(null);
  const [heldMessage, setHeldMessage] = useState<string | null>(null);
  const [replay, setReplay] = useState(false);
  const [duplicateTicket, setDuplicateTicket] = useState<string | null>(null);
  const [duplicateMessage, setDuplicateMessage] = useState<string | null>(null);

  const [uploadPending, setUploadPending] = useState(false);
  const [uploadFailed, setUploadFailed] = useState(false);
  const [uploadedCount, setUploadedCount] = useState(0);

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

  // Idempotency key per form instance. A failed verification consumes no
  // ticket, so the fresh report after a fail gets a new key.
  const keyRef = useRef<string | null>(null);
  if (keyRef.current === null) {
    keyRef.current = crypto.randomUUID();
  }

  async function loadOptions(): Promise<void> {
    setOptionsPending(true);
    setOptionsError(null);
    setForbidden(false);
    try {
      const response = await fetch('/api/reports/form-options', { credentials: 'include' });
      if (response.status === 401) {
        await navigate({ to: '/login' });
        return;
      }
      if (response.status === 403) {
        setOptions(null);
        setForbidden(true);
        return;
      }
      if (!response.ok) {
        setOptionsError(`Gagal memuat opsi formulir (${response.status}).`);
        return;
      }
      let data: unknown = null;
      try {
        data = (await response.json()) as unknown;
      } catch {
        data = null;
      }
      const parsed = toNewFormOptions(data);
      if (parsed === null) {
        setOptionsError('Format opsi formulir tidak dikenal.');
        return;
      }
      setOptions(parsed);
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
  const buildingOptions = locations.filter((location) => location.type === 'BUILDING');
  const buildingFloors =
    values.buildingId === '' ? [] : floorsForBuilding(locations, values.buildingId);
  const floorRequired = buildingFloors.length > 0;
  const roomOptions =
    values.buildingId === ''
      ? []
      : !floorRequired
        ? roomsForParent(locations, values.buildingId)
        : values.floorId === ''
          ? []
          : roomsForParent(locations, values.floorId);
  const assetOptions =
    values.locationId === '' ? [] : assetsForRoom(options?.assets ?? [], values.locationId);

  const liveErrors = validateNewReportForm(values, photoFiles, floorRequired);
  const submittable = Object.keys(liveErrors).length === 0 && photoError === null;
  const shownErrors = attempted ? liveErrors : {};
  const shownPhotoError = photoError ?? (attempted ? liveErrors.photos : undefined);

  function patch(patchValues: Partial<NewReportValues>): void {
    setValues((current) => ({ ...current, ...patchValues }));
  }

  async function uploadToTicket(ticketNumber: string): Promise<void> {
    if (photoFiles.length === 0) {
      return;
    }
    setUploadPending(true);
    setUploadFailed(false);
    try {
      const uploaded = await uploadReportAttachments(ticketNumber, photoFiles);
      setUploadedCount(uploaded.length);
    } catch {
      setUploadFailed(true);
    } finally {
      setUploadPending(false);
    }
  }

  async function retryUpload(): Promise<void> {
    if (uploadPending || ticket === null) {
      return;
    }
    await uploadToTicket(ticket);
  }

  async function submitReport(): Promise<void> {
    setPhase('waiting');
    setSubmitError(null);
    let response: Response;
    try {
      response = await fetch('/api/reports', {
        method: 'POST',
        credentials: 'include',
        headers: {
          'content-type': 'application/json',
          'x-idempotency-key': keyRef.current ?? crypto.randomUUID(),
        },
        body: JSON.stringify({
          locationId: values.locationId,
          assetId: values.assetId,
          description: values.description.trim(),
          photoKeys: photoRefsForSubmit(photoFiles),
        }),
      });
    } catch {
      setSubmitError('Jaringan bermasalah. Coba lagi.');
      return;
    }
    if (response.status === 401) {
      await navigate({ to: '/login' });
      return;
    }
    let body: unknown = null;
    try {
      body = (await response.json()) as unknown;
    } catch {
      body = null;
    }
    const outcome = toSubmitOutcome(response.status, body);
    switch (outcome.kind) {
      case 'verified': {
        setTicket(outcome.ticketNumber);
        setReplay(outcome.replay);
        await uploadToTicket(outcome.ticketNumber);
        setPhase('verified');
        return;
      }
      case 'held': {
        setTicket(outcome.ticketNumber);
        setHeldMessage(outcome.message);
        await uploadToTicket(outcome.ticketNumber);
        setPhase('held');
        return;
      }
      case 'failed': {
        setFailReason(outcome.reason);
        setPhase('failed');
        return;
      }
      case 'duplicate': {
        setDuplicateTicket(outcome.ticketNumber);
        setDuplicateMessage(outcome.message);
        setPhase('duplicate');
        return;
      }
      case 'error': {
        setSubmitError(outcome.message);
        return;
      }
    }
  }

  function onSubmitForm(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setAttempted(true);
    if (!isNewReportSubmittable(values, photoFiles, floorRequired) || photoError !== null) {
      setFormAlert('Periksa kembali isian formulir.');
      return;
    }
    setFormAlert(null);
    void submitReport();
  }

  function retryFresh(): void {
    keyRef.current = crypto.randomUUID();
    setFailReason(null);
    setAttempted(false);
    setFormAlert(null);
    setPhase('form');
  }

  function resetForm(): void {
    keyRef.current = crypto.randomUUID();
    setValues(EMPTY_VALUES);
    setAttempted(false);
    setFormAlert(null);
    setSubmitError(null);
    setFailReason(null);
    setTicket(null);
    setHeldMessage(null);
    setReplay(false);
    setDuplicateTicket(null);
    setDuplicateMessage(null);
    setPhotoFiles([]);
    setPhotoError(null);
    setUploadPending(false);
    setUploadFailed(false);
    setUploadedCount(0);
    setPhase('form');
  }

  function uploadStatus(): ReactNode {
    if (uploadPending) {
      return (
        <div className="mt-4">
          <LoadingState message="Mengunggah foto…" />
        </div>
      );
    }
    if (uploadFailed) {
      return (
        <div className="mt-4">
          <ErrorPanel message="Foto gagal diunggah, tetapi laporan tetap tersimpan." />
          <p className="mt-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => void retryUpload()}
              disabled={uploadPending}
            >
              Coba unggah lagi
            </Button>
          </p>
        </div>
      );
    }
    if (uploadedCount > 0) {
      return <p className="mt-2 text-sm text-muted">{uploadedCount} foto terlampir.</p>;
    }
    return null;
  }

  function resultLinks(): ReactNode {
    if (ticket === null) {
      return null;
    }
    return (
      <p className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
        <Link
          to="/reporter/reports/$ticket"
          params={{ ticket }}
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
    );
  }

  if (options === null) {
    return (
      <section aria-labelledby="new-report-title" className="max-w-3xl">
        <h1 id="new-report-title" className="text-2xl font-semibold text-text">
          Buat Laporan Baru
        </h1>
        {optionsPending || (!forbidden && optionsError === null && initial.needsClientLoad) ? (
          <div className="mt-4">
            <LoadingState message="Memuat opsi formulir…" />
          </div>
        ) : null}
        {forbidden ? (
          <div className="mt-4">
            <ErrorPanel
              title="Akses ditolak"
              message="Akun ini tidak memiliki akses ke formulir pelaporan."
            />
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

  if (buildingOptions.length === 0) {
    return (
      <section aria-labelledby="new-report-title" className="max-w-3xl">
        <h1 id="new-report-title" className="text-2xl font-semibold text-text">
          Buat Laporan Baru
        </h1>
        <div className="mt-4">
          <EmptyState
            title="Belum ada gedung yang bisa dipilih"
            description="Daftar lokasi kosong atau belum tersedia. Coba muat ulang, atau lihat laporan yang sudah ada."
            action={
              <Link
                to="/reporter/reports"
                search={{ filter: 'semua', status: '', offset: 0 }}
                className={`${buttonBaseClasses} ${buttonVariantClasses.secondary}`}
              >
                Laporan Saya
              </Link>
            }
          />
        </div>
      </section>
    );
  }

  if (phase === 'waiting') {
    return (
      <section aria-labelledby="new-report-waiting-title" className="max-w-3xl">
        <div className="rounded-md border border-border bg-surface p-6 text-center md:p-8">
          <h1 id="new-report-waiting-title" className="text-2xl font-semibold text-text">
            Menunggu hasil verifikasi
          </h1>
          <div className="mt-4">
            <LoadingState message="Mengirim laporan dan menunggu hasil verifikasi…" />
          </div>
          <p className="mt-2 text-sm text-muted">Jangan tutup halaman ini.</p>
          {submitError !== null ? (
            <div className="mt-4">
              <ErrorPanel message={submitError} />
              <p className="mt-4 flex flex-col justify-center gap-2 sm:flex-row">
                <Button type="button" onClick={() => void submitReport()}>
                  Coba lagi
                </Button>
                <Button type="button" variant="secondary" onClick={() => setPhase('form')}>
                  Kembali ke formulir
                </Button>
              </p>
            </div>
          ) : null}
        </div>
      </section>
    );
  }

  if (phase === 'failed' && failReason !== null) {
    return (
      <section aria-labelledby="new-report-failed-title" className="max-w-3xl">
        <div className="rounded-md border border-border bg-surface p-6 text-center md:p-8">
          <h1 id="new-report-failed-title" className="text-2xl font-semibold text-text">
            Laporan tidak lolos verifikasi
          </h1>
          <div className="mt-4">
            <ErrorPanel title="Alasan" message={failReason} />
          </div>
          <p className="mt-4 text-sm text-muted">
            Perbaiki foto atau deskripsi, lalu kirim ulang sebagai laporan baru.
          </p>
          <p className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
            <Button type="button" onClick={retryFresh}>
              Buat laporan baru
            </Button>
            <Link
              to="/reporter/reports"
              search={{ filter: 'semua', status: '', offset: 0 }}
              className={`${buttonBaseClasses} ${buttonVariantClasses.secondary}`}
            >
              Laporan Saya
            </Link>
          </p>
        </div>
      </section>
    );
  }

  if (phase === 'duplicate') {
    return (
      <section aria-labelledby="new-report-duplicate-title" className="max-w-3xl">
        <div className="rounded-md border border-border bg-surface p-6 text-center md:p-8">
          <h1 id="new-report-duplicate-title" className="text-2xl font-semibold text-text">
            Laporan serupa sudah tercatat
          </h1>
          <p className="mt-4 text-sm text-text">{duplicateMessage}</p>
          {duplicateTicket !== null ? (
            <p className="mt-4">
              <Link
                to="/reporter/reports/$ticket"
                params={{ ticket: duplicateTicket }}
                className={`${buttonBaseClasses} ${buttonVariantClasses.primary}`}
              >
                Buka tiket yang sudah ada
              </Link>
            </p>
          ) : null}
          <p className="mt-4 flex flex-col justify-center gap-2 sm:flex-row">
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

  if (phase === 'held' && ticket !== null) {
    return (
      <section aria-labelledby="new-report-held-title" className="max-w-3xl">
        <div className="rounded-md border border-border bg-surface p-6 text-center md:p-8">
          <h1 id="new-report-held-title" className="text-2xl font-semibold text-text">
            Laporan menunggu pemeriksaan
          </h1>
          <p role="status" className="mt-4 text-sm text-muted">
            Nomor tiket Anda:{' '}
            <TicketMono className="block pt-2 text-3xl font-medium text-text">
              {ticket}
            </TicketMono>
          </p>
          <p className="mt-4 text-sm text-text">{heldMessage}</p>
          {uploadStatus()}
          {resultLinks()}
        </div>
      </section>
    );
  }

  if (phase === 'verified' && ticket !== null) {
    return (
      <section aria-labelledby="new-report-success-title" className="max-w-3xl">
        <div className="rounded-md border border-border bg-surface p-6 text-center md:p-8">
          <h1 id="new-report-success-title" className="text-2xl font-semibold text-text">
            Laporan berhasil dikirim
          </h1>
          <p role="status" className="mt-4 text-sm text-muted">
            Nomor tiket Anda:{' '}
            <TicketMono className="block pt-2 text-3xl font-medium text-text">
              {ticket}
            </TicketMono>
          </p>
          {replay ? (
            <p className="mt-2 text-sm text-muted">
              Laporan sudah tercatat dengan nomor tiket tersebut.
            </p>
          ) : null}
          {uploadStatus()}
          {resultLinks()}
        </div>
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
      <form
        onSubmit={onSubmitForm}
        className="mt-4 rounded-md border border-border bg-surface p-4 md:p-6"
      >
        <div className="flex flex-col gap-4">
          <div>
            <label htmlFor="report-building" className="mb-1 block text-sm font-medium text-text">
              Gedung
            </label>
            <Select
              id="report-building"
              value={values.buildingId}
              invalid={shownErrors.buildingId !== undefined}
              aria-describedby={shownErrors.buildingId ? 'report-building-error' : undefined}
              onChange={(event) => {
                patch({ buildingId: event.target.value, floorId: '', locationId: '', assetId: '' });
              }}
            >
              <option value="">Pilih gedung</option>
              {buildingOptions.map((building) => (
                <option key={building.id} value={building.id}>
                  {building.name}
                </option>
              ))}
            </Select>
            <FieldError id="report-building-error" message={shownErrors.buildingId} />
          </div>

          <div>
            <label htmlFor="report-floor" className="mb-1 block text-sm font-medium text-text">
              Lantai
            </label>
            <Select
              id="report-floor"
              value={values.floorId}
              disabled={values.buildingId === '' || !floorRequired}
              invalid={shownErrors.floorId !== undefined}
              aria-describedby={shownErrors.floorId ? 'report-floor-error' : undefined}
              onChange={(event) => {
                patch({ floorId: event.target.value, locationId: '', assetId: '' });
              }}
            >
              <option value="">
                {values.buildingId === ''
                  ? 'Pilih gedung terlebih dahulu'
                  : !floorRequired
                    ? 'Gedung ini tidak memiliki lantai'
                    : 'Pilih lantai'}
              </option>
              {buildingFloors.map((floor) => (
                <option key={floor.id} value={floor.id}>
                  {floor.name}
                </option>
              ))}
            </Select>
            <FieldError id="report-floor-error" message={shownErrors.floorId} />
          </div>

          <div>
            <label htmlFor="report-room" className="mb-1 block text-sm font-medium text-text">
              Ruangan
            </label>
            <Select
              id="report-room"
              value={values.locationId}
              disabled={values.buildingId === '' || (floorRequired && values.floorId === '')}
              invalid={shownErrors.locationId !== undefined}
              aria-describedby={shownErrors.locationId ? 'report-room-error' : undefined}
              onChange={(event) => {
                patch({ locationId: event.target.value, assetId: '' });
              }}
            >
              <option value="">
                {values.buildingId === ''
                  ? 'Pilih gedung terlebih dahulu'
                  : floorRequired && values.floorId === ''
                    ? 'Pilih lantai terlebih dahulu'
                    : 'Pilih ruangan'}
              </option>
              {roomOptions.map((room) => (
                <option key={room.id} value={room.id}>
                  {room.name}
                </option>
              ))}
            </Select>
            <FieldError id="report-room-error" message={shownErrors.locationId} />
          </div>

          <div>
            <label htmlFor="report-asset" className="mb-1 block text-sm font-medium text-text">
              Aset
            </label>
            <Select
              id="report-asset"
              value={values.assetId}
              disabled={values.locationId === ''}
              invalid={shownErrors.assetId !== undefined}
              aria-describedby={shownErrors.assetId ? 'report-asset-error' : undefined}
              onChange={(event) => {
                patch({ assetId: event.target.value });
              }}
            >
              <option value="">
                {values.locationId === '' ? 'Pilih ruangan terlebih dahulu' : 'Pilih aset'}
              </option>
              {assetOptions.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.name} ({asset.assetCode})
                </option>
              ))}
            </Select>
            <FieldError id="report-asset-error" message={shownErrors.assetId} />
            {values.locationId !== '' && assetOptions.length === 0 ? (
              <p className="mt-1 text-sm text-muted">
                Belum ada aset di ruangan ini. Pilih ruangan lain.
              </p>
            ) : null}
          </div>

          <div>
            <label
              htmlFor="report-description"
              className="mb-1 block text-sm font-medium text-text"
            >
              Deskripsi
            </label>
            <Textarea
              id="report-description"
              value={values.description}
              maxLength={2000}
              rows={5}
              invalid={shownErrors.description !== undefined}
              aria-describedby={shownErrors.description ? 'report-description-error' : undefined}
              onChange={(event) => {
                patch({ description: event.target.value });
              }}
            />
            <p aria-live="polite" className="mt-1 font-mono text-xs text-subtle">
              {descLength}/2000 karakter
            </p>
            <p className="mt-1 text-sm text-muted">Minimal 10 karakter.</p>
            <FieldError id="report-description-error" message={shownErrors.description} />
          </div>

          <div>
            <label htmlFor="report-photos" className="mb-1 block text-sm font-medium text-text">
              Foto
            </label>
            <Input
              id="report-photos"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              onChange={onPickPhotos}
              aria-describedby={shownPhotoError ? 'report-photos-error' : 'report-photos-hint'}
            />
            <p id="report-photos-hint" className="mt-1 text-sm text-muted">
              Wajib 1 sampai 3 foto, masing-masing tidak lebih dari 5 MB (JPG, PNG, WebP).
            </p>
            <FieldError id="report-photos-error" message={shownPhotoError ?? undefined} />
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

          <Button type="submit" disabled={!submittable}>
            Kirim laporan
          </Button>
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
