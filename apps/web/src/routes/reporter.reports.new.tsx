// New-report form for the AI verification flow: full chain
// gedung → lantai → ruangan → aset (all required) plus description and
// 1-3 photos, then a blocking wait for the inline verdict.
// Verification is text-only (description + asset + location): the photos are
// evidence for the technician and are never sent to the model.
//
// Photo-first: picked photos stage to /api/uploads before the submit, and
// the submit carries the returned storage keys. The server links staged
// photos into attachments on VERIFIED and HELD, and removes them on FAIL.
//
// Indonesian copy, accessible labels on every input, role=alert errors,
// role=status loading, disabled-until-valid submit, real buttons, no
// styling framework (follows login.tsx). Server validation stays
// authoritative: 422 reasons render as-is; 401 redirects to /login.
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
  type FormEvent,
  type ReactNode,
} from 'react';
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
import { InfoIcon, ShieldCheckIcon, TrashIcon, UploadIcon } from '../components/Icon.js';
import { visibleLocations } from '../lib/report-helpers.js';
import {
  stageReportPhotos,
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
      return { kind: 'failed', reason: 'Verifikasi gagal. Periksa kembali deskripsi dan lokasi, lalu coba lagi.' };
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
      stringField(body, 'reason') ?? 'Verifikasi gagal. Periksa kembali deskripsi dan lokasi, lalu coba lagi.';
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

type Phase = 'form' | 'review' | 'waiting' | 'verified' | 'held' | 'failed' | 'duplicate';

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
  const [photoDropActive, setPhotoDropActive] = useState(false);

  const [submitError, setSubmitError] = useState<string | null>(null);
  const [failReason, setFailReason] = useState<string | null>(null);
  const [ticket, setTicket] = useState<string | null>(null);
  const [heldMessage, setHeldMessage] = useState<string | null>(null);
  const [replay, setReplay] = useState(false);
  const [duplicateTicket, setDuplicateTicket] = useState<string | null>(null);
  const [duplicateMessage, setDuplicateMessage] = useState<string | null>(null);

  const [waitingStep, setWaitingStep] = useState<'staging' | 'verdict'>('staging');

  function onPickPhotos(event: ChangeEvent<HTMLInputElement>): void {
    const picked = Array.from(event.target.files ?? []);
    // Reset so the same file can be re-picked after a rejection.
    event.target.value = '';
    addPhotos(picked);
  }

  function addPhotos(picked: readonly File[]): void {
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

  function onDropPhotos(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault();
    setPhotoDropActive(false);
    addPhotos(Array.from(event.dataTransfer.files));
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

  async function submitReport(): Promise<void> {
    setPhase('waiting');
    setWaitingStep('staging');
    setSubmitError(null);
    // Photo-first: the validated files stage before the submit, and the
    // submit carries the returned keys. A staged batch whose submit never
    // arrives expires via the staged TTL.
    let photoKeys: string[];
    try {
      photoKeys = await stageReportPhotos(photoFiles);
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'Gagal mengunggah foto. Coba lagi.');
      return;
    }
    setWaitingStep('verdict');
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
          photoKeys,
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
        setPhase('verified');
        return;
      }
      case 'held': {
        setTicket(outcome.ticketNumber);
        setHeldMessage(outcome.message);
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
    setPhase('review');
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
    setWaitingStep('staging');
    setPhase('form');
  }

  function photoCountLine(): ReactNode {
    if (photoFiles.length === 0) {
      return null;
    }
    return <p className="mt-2 text-sm text-muted">{photoFiles.length} foto terlampir.</p>;
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
          to="/reporter"
          search={{ search: '', mine: true, status: '', priority: '', offset: 0 }}
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
                to="/reporter"
                search={{ search: '', mine: true, status: '', priority: '', offset: 0 }}
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
            {waitingStep === 'staging' ? 'Mengunggah foto' : 'Menunggu hasil verifikasi'}
          </h1>
          <div className="mt-4">
            <LoadingState
              message={
                waitingStep === 'staging'
                  ? 'Mengunggah foto…'
                  : 'Mengirim laporan dan menunggu hasil verifikasi…'
              }
            />
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
            Perbaiki deskripsi atau lokasi, lalu kirim ulang sebagai laporan baru.
          </p>
          <p className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
            <Button type="button" onClick={retryFresh}>
              Buat laporan baru
            </Button>
            <Link
              to="/reporter"
              search={{ search: '', mine: true, status: '', priority: '', offset: 0 }}
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
              to="/reporter"
              search={{ search: '', mine: true, status: '', priority: '', offset: 0 }}
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
          {photoCountLine()}
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
          {photoCountLine()}
          {resultLinks()}
        </div>
      </section>
    );
  }

  if (phase === 'review') {
    const selectedBuilding = buildingOptions.find((item) => item.id === values.buildingId);
    const selectedFloor = buildingFloors.find((item) => item.id === values.floorId);
    const selectedRoom = roomOptions.find((item) => item.id === values.locationId);
    const selectedAsset = assetOptions.find((item) => item.id === values.assetId);
    return (
      <section aria-labelledby="new-report-review-title" className="max-w-3xl">
        <h1 id="new-report-review-title" className="text-2xl font-semibold text-text">
          Tinjau Laporan
        </h1>
        <div className="mt-4 rounded-md border border-border bg-surface p-4 md:p-6">
          <dl className="divide-y divide-border">
            <div className="flex flex-col gap-1 py-3 sm:flex-row sm:gap-4">
              <dt className="shrink-0 text-sm font-medium text-muted sm:w-40">Gedung</dt>
              <dd className="text-sm text-text">{selectedBuilding?.name ?? values.buildingId}</dd>
            </div>
            <div className="flex flex-col gap-1 py-3 sm:flex-row sm:gap-4">
              <dt className="shrink-0 text-sm font-medium text-muted sm:w-40">Lantai</dt>
              <dd className="text-sm text-text">
                {floorRequired ? (selectedFloor?.name ?? values.floorId) : '—'}
              </dd>
            </div>
            <div className="flex flex-col gap-1 py-3 sm:flex-row sm:gap-4">
              <dt className="shrink-0 text-sm font-medium text-muted sm:w-40">Ruangan</dt>
              <dd className="text-sm text-text">{selectedRoom?.name ?? values.locationId}</dd>
            </div>
            <div className="flex flex-col gap-1 py-3 sm:flex-row sm:gap-4">
              <dt className="shrink-0 text-sm font-medium text-muted sm:w-40">Aset</dt>
              <dd className="text-sm text-text">{selectedAsset?.name ?? values.assetId}</dd>
            </div>
            <div className="flex flex-col gap-1 py-3 sm:flex-row sm:gap-4">
              <dt className="shrink-0 text-sm font-medium text-muted sm:w-40">Deskripsi</dt>
              <dd className="whitespace-pre-wrap text-sm text-text">{values.description.trim()}</dd>
            </div>
          </dl>
          {photoCountLine()}
          <p className="mt-2 text-sm text-muted">
            Foto hanya menjadi bukti untuk teknisi; deskripsi dan lokasi akan diperiksa AI saat laporan dikirim.
          </p>
          <p className="mt-6 flex flex-col gap-2 sm:flex-row">
            <Button type="button" onClick={() => void submitReport()}>
              Kirim laporan
            </Button>
            <Button type="button" variant="secondary" onClick={() => setPhase('form')}>
              Ubah laporan
            </Button>
          </p>
        </div>
      </section>
    );
  }

  const descLength = values.description.trim().length;
  return (
    <section aria-labelledby="new-report-title" className="w-full">
      <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 id="new-report-title" className="text-[clamp(1.75rem,3vw,2rem)] font-semibold tracking-[-0.04em] text-[#202a33]">
            Buat Laporan Kerusakan
          </h1>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-muted">
            Lokasi, deskripsi kondisi fisik, dan foto bukti diperlukan untuk memeriksa serta memproses laporan penanganan sarana prasarana kampus.
          </p>
        </div>
        <div className="inline-flex w-fit items-center gap-2 rounded-full bg-[#e7f7fb] px-3 py-2 text-[11px] font-semibold tracking-[0.02em] text-[#0a3947]">
          <ShieldCheckIcon className="h-4 w-4" />
          Verifikasi Cepat Otomatis
        </div>
      </div>
      {formAlert !== null ? (
        <div className="mt-4">
          <ErrorPanel message={formAlert} />
        </div>
      ) : null}
      <form
        onSubmit={onSubmitForm}
        className="mt-6 rounded-lg border border-[#edf0f2] bg-surface p-6 shadow-[0_1px_2px_rgba(6,70,83,0.06)] md:p-8"
      >
        <div className="grid gap-x-4 gap-y-5 md:grid-cols-2">
          <div className="min-w-0">
            <div className="mb-1.5 flex items-center justify-between gap-3">
              <label htmlFor="report-building" className="text-xs font-semibold tracking-[0.02em] text-[#202a33] after:ml-0.5 after:text-[#ba1a1a] after:content-['*']">
                Gedung
              </label>
              <span className="text-[11px] text-muted">Kampus Tasikmalaya</span>
            </div>
            <Select
              id="report-building"
              className="shadow-[0_1px_1px_rgba(0,0,0,0.05)]"
              required
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

          <div className="min-w-0">
            <label htmlFor="report-floor" className="mb-1.5 block text-xs font-semibold tracking-[0.02em] text-[#202a33] after:ml-0.5 after:text-[#ba1a1a] after:content-['*']">
              Lantai
            </label>
            <Select
              id="report-floor"
              className="shadow-[0_1px_1px_rgba(0,0,0,0.05)]"
              required
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

          <div className="min-w-0">
            <label htmlFor="report-room" className="mb-1.5 block text-xs font-semibold tracking-[0.02em] text-[#202a33] after:ml-0.5 after:text-[#ba1a1a] after:content-['*']">
              Ruangan
            </label>
            <Select
              id="report-room"
              className="shadow-[0_1px_1px_rgba(0,0,0,0.05)]"
              required
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

          <div className="min-w-0">
            <div className="mb-1.5 flex items-center justify-between gap-3">
              <label htmlFor="report-asset" className="text-xs font-semibold tracking-[0.02em] text-[#202a33] after:ml-0.5 after:text-[#ba1a1a] after:content-['*']">
                Aset
              </label>
              {values.locationId !== '' ? (
                <span className="text-[11px] text-muted">{assetOptions.length} Aset terdaftar</span>
              ) : null}
            </div>
            <Select
              id="report-asset"
              className="shadow-[0_1px_1px_rgba(0,0,0,0.05)]"
              required
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

          <div className="md:col-span-2">
            <label
              htmlFor="report-description"
              className="mb-1.5 block text-xs font-semibold tracking-[0.02em] text-[#202a33]"
            >
              Deskripsi Kerusakan
            </label>
            <Textarea
              id="report-description"
              value={values.description}
              required
              maxLength={2000}
              rows={4}
              invalid={shownErrors.description !== undefined}
              aria-describedby={shownErrors.description ? 'report-description-error' : undefined}
              onChange={(event) => {
                patch({ description: event.target.value });
              }}
            />
            <p aria-live="polite" className="mt-1 font-mono text-xs text-subtle">
              {descLength} / 2000 karakter
            </p>
            <p className="mt-2 flex items-start gap-2 rounded-md bg-[#eef7ff] px-3 py-2 text-xs leading-5 text-muted">
              <InfoIcon className="mt-0.5 h-4 w-4 shrink-0 text-[#426e9b]" />
              Jelaskan kondisi fisik yang terlihat secara spesifik, bukan menebak penyebab teknis kerusakan.
            </p>
            <FieldError id="report-description-error" message={shownErrors.description} />
          </div>

          <div className="md:col-span-2">
            <div className="mb-1.5 flex items-center justify-between gap-3">
              <label htmlFor="report-photos" className="text-xs font-semibold tracking-[0.02em] text-[#202a33]">
                Foto Bukti Kerusakan
              </label>
              <span className="text-[11px] text-muted">{photoFiles.length} / 3 foto terlampir</span>
            </div>
            <div
              className={`rounded-lg border border-dashed px-4 py-7 text-center transition-colors ${
                photoDropActive
                  ? 'border-accent bg-[#eef8fb]'
                  : 'border-[#d9e8ed] bg-[#f7fbff] hover:border-[#94cbd5]'
              }`}
              onDragEnter={(event) => {
                event.preventDefault();
                setPhotoDropActive(true);
              }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={() => setPhotoDropActive(false)}
              onDrop={onDropPhotos}
            >
              <UploadIcon className="mx-auto h-6 w-6 text-accent" />
              <p className="mt-2 text-sm font-semibold text-accent">Tarik &amp; lepaskan foto ke sini, atau</p>
              <label
                htmlFor="report-photos"
                className="mt-2 inline-flex min-h-[44px] cursor-pointer items-center justify-center rounded-md bg-[#e2f4f8] px-4 py-2 text-sm font-semibold text-accent transition-colors hover:bg-[#d2edf2]"
              >
                Pilih Foto
              </label>
              <p className="mt-2 text-[11px] text-muted">Dukungan: JPG, PNG, WebP (Maks. 5 MB)</p>
            </div>
            <Input
              id="report-photos"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              onChange={onPickPhotos}
              className="sr-only"
              aria-describedby={shownPhotoError ? 'report-photos-error' : 'report-photos-hint'}
            />
            <p id="report-photos-hint" className="sr-only">
              Wajib 1 sampai 3 foto, masing-masing tidak lebih dari 5 MB (JPG, PNG, WebP).
            </p>
            <FieldError id="report-photos-error" message={shownPhotoError ?? undefined} />
            {photoFiles.length > 0 ? (
              <ul className="mt-4 grid gap-3 sm:grid-cols-2">
                {photoFiles.map((file, index) => (
                  <li
                    key={`${file.name}-${file.size}-${index}`}
                    className="flex min-w-0 items-center justify-between gap-3 rounded-md border border-[#edf0f2] px-3 py-2 text-sm text-text"
                  >
                    <span className="min-w-0 truncate">{file.name}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      aria-label={`Hapus ${file.name}`}
                      className="shrink-0 px-2 text-danger"
                      onClick={() => removePhoto(index)}
                    >
                      <TrashIcon className="h-4 w-4" />
                      Hapus
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <div className="flex flex-col-reverse gap-3 border-t border-[#edf0f2] pt-5 sm:flex-row sm:items-center sm:justify-end md:col-span-2">
            <Link
              to="/reporter"
              search={{ search: '', mine: true, status: '', priority: '', offset: 0 }}
              className={`${buttonBaseClasses} ${buttonVariantClasses.ghost} justify-center text-muted`}
            >
              Batal / Kembali
            </Link>
            <Button type="submit" disabled={!submittable}>
              Lanjut ke review
            </Button>
          </div>
        </div>
      </form>
    </section>
  );
}
