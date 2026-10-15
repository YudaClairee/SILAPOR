// Pre-submit photo staging service (AI verification photo-first flow).
//
// Thin by contract (mirrors `./attachments.ts`): guards via `requireUser`
// from `./auth`, opens one database connection, delegates rows to
// `@silapor/database`, and closes the connection. Repo `AppError`s propagate
// untouched for routes to map with `toHttpResponse`.
//
// The SAME Phase 4 chain as report-bound uploads runs here — per-file size
// cap (`413` before any processing), `validateAttachment` (magic-byte sniff,
// JPEG/PNG/WebP allowlist), `processImage` (canonical re-encode) — then the
// bytes store under an unguessable `staging_<uuid>` key and a staged row is
// recorded. No validator is forked: limits and checks come from
// `@silapor/storage` constants and functions.
//
// Conventions:
// - `uploadedBy` ALWAYS comes from the session user, NEVER from the client.
// - Staging is all-or-nothing: any failure removes already-stored objects
//   (and recorded rows), so a failed stage leaves no orphans behind.
// - Success shapes NEVER expose bytes, only opaque keys.
// - This module logs nothing — routes log with opaque IDs.
import {
  getDb,
  getStagedUploadsByKeys as repoGetStagedUploadsByKeys,
  recordStagedUpload as repoRecordStagedUpload,
  deleteStagedUploads as repoDeleteStagedUploads,
  DEFAULT_STAGED_TTL_MS,
  type StagedUpload,
} from '@silapor/database';
import { AppError, badRequest, payloadTooLarge } from '@silapor/shared';
import {
  AttachmentValidationError,
  createAttachmentStorage,
  generateAttachmentKey,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_REPORT,
  processImage,
  sanitizeOriginalFilename,
  validateAttachment,
  type AttachmentStorage,
  type ProcessedImage,
} from '@silapor/storage';
import { requireUser } from './auth';

export interface StagingUploadFile {
  readonly bytes: Uint8Array;
  readonly declaredMime: string;
  readonly originalFilename: string;
}

export interface StageUploadsResult {
  readonly keys: readonly string[];
}

// Same fail-closed mapping as report-bound uploads: oversize is 413, every
// other validation failure is a 400 with its code. Anything else propagates
// untouched. Always throws.
function mapStagingValidationError(error: unknown): never {
  if (error instanceof AttachmentValidationError) {
    if (error.code === 'FILE_TOO_LARGE') {
      throw payloadTooLarge('Attachment exceeds the maximum allowed size.');
    }
    throw new AppError({ code: error.code, status: 400, message: error.message });
  }
  throw error;
}

interface ProcessedStage {
  readonly image: ProcessedImage;
  readonly originalFilename: string;
}

export async function stageUploads(
  req: Request,
  formFiles: readonly StagingUploadFile[],
  storageOverride?: AttachmentStorage,
): Promise<StageUploadsResult> {
  const user = await requireUser(req);
  if (!Array.isArray(formFiles) || formFiles.length === 0) {
    throw badRequest('At least one file is required.');
  }
  if (formFiles.length > MAX_ATTACHMENTS_PER_REPORT) {
    throw new AppError({
      code: 'TOO_MANY_FILES',
      status: 400,
      message: `Too many files: a report allows at most ${MAX_ATTACHMENTS_PER_REPORT} attachments.`,
    });
  }
  // Phase A: validate + process ALL files before touching storage —
  // processing is side-effect free, so a failure here stores nothing.
  const processed: ProcessedStage[] = [];
  for (const file of formFiles) {
    if (file.bytes.byteLength > MAX_ATTACHMENT_BYTES) {
      throw payloadTooLarge('Attachment exceeds the maximum allowed size.');
    }
    try {
      validateAttachment({
        bytes: file.bytes,
        declaredMime: file.declaredMime,
        originalFilename: file.originalFilename,
      });
    } catch (error) {
      mapStagingValidationError(error);
    }
    let image: ProcessedImage;
    try {
      image = await processImage(file.bytes);
    } catch (error) {
      mapStagingValidationError(error);
    }
    processed.push({ image, originalFilename: sanitizeOriginalFilename(file.originalFilename) });
  }
  // Phase B: store every processed image under an unguessable staging key
  // (keys pair with items by array position).
  const storage = storageOverride ?? createAttachmentStorage();
  const saves = processed.map((item) => ({ item, key: generateAttachmentKey('staging') }));
  const storedKeys: string[] = [];
  try {
    for (const save of saves) {
      await storage.put(save.key, save.item.image.bytes, save.item.image.mimeType);
      storedKeys.push(save.key);
    }
  } catch (error) {
    await Promise.allSettled(storedKeys.map((key) => storage.remove(key)));
    throw error;
  }
  // Phase C: record one staged row per stored object. A row failure
  // removes every stored object (and any recorded row) — no orphans.
  const conn = getDb();
  try {
    try {
      for (const save of saves) {
        await repoRecordStagedUpload(conn.db, {
          storageKey: save.key,
          uploadedBy: user.id,
          originalFilename: save.item.originalFilename,
          mimeType: save.item.image.mimeType,
          sizeBytes: save.item.image.sizeBytes,
          checksum: save.item.image.checksum,
        });
      }
    } catch (error) {
      await Promise.allSettled(storedKeys.map((key) => storage.remove(key)));
      await repoDeleteStagedUploads(conn.db, storedKeys).catch(() => undefined);
      throw error;
    }
    return { keys: saves.map((save) => save.key) };
  } finally {
    await conn.close().catch(() => undefined);
  }
}

export interface ResolvedStagedPhoto {
  readonly storageKey: string;
  readonly originalFilename: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly checksum: string;
}

export interface ResolveStagedPhotoKeysOptions {
  readonly ttlMs?: number;
  readonly now?: Date;
}

type StagedQueryDb = Parameters<typeof repoGetStagedUploadsByKeys>[0];

// Resolves submit `photoKeys` to staged metadata: every key must exist, be
// owned by the caller, unclaimed, and within TTL. One uniform 400 covers
// missing, foreign, claimed, and expired keys (no existence oracle).
export async function resolveStagedPhotoKeys(
  db: StagedQueryDb,
  userId: string,
  keys: readonly string[],
  opts?: ResolveStagedPhotoKeysOptions,
): Promise<ResolvedStagedPhoto[]> {
  const ttlMs = opts?.ttlMs ?? DEFAULT_STAGED_TTL_MS;
  const now = opts?.now ?? new Date();
  if (
    !Array.isArray(keys) ||
    keys.length < 1 ||
    keys.length > MAX_ATTACHMENTS_PER_REPORT ||
    keys.some((key) => typeof key !== 'string' || !key.startsWith('staging_'))
  ) {
    throw badRequest('Unknown or expired photo. Re-upload the photos.');
  }
  const rows: StagedUpload[] = await repoGetStagedUploadsByKeys(db, keys);
  if (rows.length !== keys.length) {
    throw badRequest('Unknown or expired photo. Re-upload the photos.');
  }
  for (const row of rows) {
    if (
      row.uploadedBy !== userId ||
      row.claimedReportId !== null ||
      now.getTime() - row.createdAt.getTime() > ttlMs
    ) {
      throw badRequest('Unknown or expired photo. Re-upload the photos.');
    }
  }
  return rows.map((row) => ({
    storageKey: row.storageKey,
    originalFilename: row.originalFilename,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    checksum: row.checksum,
  }));
}

// Best-effort object removal for the FAIL path (the TTL janitor is the
// backstop — a removal failure must not flip the already-decided 422).
export async function removeStagedObjects(
  storage: AttachmentStorage,
  keys: readonly string[],
): Promise<void> {
  await Promise.allSettled(keys.map((key) => storage.remove(key)));
}
