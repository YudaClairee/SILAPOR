// Attachment upload/download service (Phase 4 P4-3).
//
// Thin by contract (mirrors `./reports.ts`): every function guards via
// `requireUser` from `./auth` (defense in depth — routes guard too), opens
// one database connection, delegates to the attachment repository in
// `@silapor/database`, consumes P4-1 validation/processing
// (`validateAttachment`/`processImage`/`sanitizeOriginalFilename`/
// `canAddAttachments`) and P4-2 storage (`createAttachmentStorage()`), and
// closes the connection. Repo `AppError`s propagate untouched for routes to
// map with `toHttpResponse`.
//
// Conventions:
// - `reporterId`/`uploadedBy` ALWAYS come from the session user, NEVER from
//   the client (same rule as `createMyReport`).
// - Upload remains owner-only: reporter→foreign and missing report references
//   produce byte-identical 404s via the shared `REPORT_NOT_FOUND_MESSAGE`
//   constant (no existence oracle for other reporters' tickets).
// - Download is campus-readable: any authenticated reporter may read any
//   attachment of an existing report; only missing reports/attachments 404.
// - Upload permission: reporters on own NON-terminal reports only
//   (`CLOSED`/`REJECTED`/`DUPLICATE` → 409; `RESOLVED` is NOT terminal for
//   attachments); admins on any report. Download applies no ownership filter.
// - Fail-closed validation chain per file, in order: presence → size
//   (`413 FILE_TOO_LARGE`, before any processing) → `validateAttachment`
//   (400 with its P4-1 code) → `processImage` (corrupt → `400
//   CORRUPT_IMAGE`). ALL files validate + process before ANY storage write,
//   then all objects store, then ONE transaction inserts rows + event: any
//   failure → zero rows, zero orphan objects (stored objects are removed on
//   DB failure, and partially-stored objects on a mid-batch storage failure).
// - Success shapes NEVER expose `storageKey`.
// - This module logs nothing — routes log with opaque IDs.

import {
  countAttachments as repoCountAttachments,
  createAttachments as repoCreateAttachments,
  getAttachmentById as repoGetAttachmentById,
  getDb,
  getReportHeader as repoGetReportHeader,
  type AttachmentSummary,
} from '@silapor/database';
import { AppError, badRequest, conflict, notFound, payloadTooLarge } from '@silapor/shared';
import {
  AttachmentValidationError,
  canAddAttachments,
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
import { REPORT_NOT_FOUND_MESSAGE, resolveReportId } from './reports';

export interface AttachmentUploadFile {
  readonly bytes: Uint8Array;
  readonly declaredMime: string;
  readonly originalFilename: string;
}

export interface UploadAttachmentsResult {
  readonly attachments: readonly AttachmentSummary[];
}

export interface AttachmentDownload {
  readonly bytes: Uint8Array;
  readonly contentType: string;
  readonly filename: string;
}

const ATTACHMENT_NOT_FOUND_MESSAGE = 'Attachment not found';

// Binding upload-terminal set: reporters cannot upload to these statuses.
// `RESOLVED` is deliberately NOT terminal for attachments.
const UPLOAD_TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  'CLOSED',
  'REJECTED',
  'DUPLICATE',
]);

function tooManyFilesError(): AppError {
  return new AppError({
    code: 'TOO_MANY_FILES',
    status: 400,
    message: `Too many files: a report allows at most ${MAX_ATTACHMENTS_PER_REPORT} attachments.`,
  });
}

// Maps a P4-1 validation/processing failure to its HTTP shape (413 for
// oversize, 400 with the P4-1 code otherwise, reusing the generic P4-1
// message which never carries filenames/bytes). Anything else propagates
// untouched (storage/DB failures must not mask as 400). Always throws.
function mapAttachmentValidationError(error: unknown): never {
  if (error instanceof AttachmentValidationError) {
    if (error.code === 'FILE_TOO_LARGE') {
      throw payloadTooLarge('Attachment exceeds the maximum allowed size.');
    }
    throw new AppError({ code: error.code, status: 400, message: error.message });
  }
  throw error;
}

interface ProcessedUpload {
  readonly image: ProcessedImage;
  readonly originalFilename: string;
}

export async function uploadAttachments(
  req: Request,
  ref: string,
  formFiles: readonly AttachmentUploadFile[],
  storageOverride?: AttachmentStorage,
): Promise<UploadAttachmentsResult> {
  const user = await requireUser(req);
  if (!Array.isArray(formFiles) || formFiles.length === 0) {
    throw badRequest('At least one file is required.');
  }
  if (formFiles.length > MAX_ATTACHMENTS_PER_REPORT) {
    throw tooManyFilesError();
  }
  const isAdmin = user.role === 'ADMIN';
  const conn = getDb();
  try {
    const reportId = await resolveReportId(conn.db, isAdmin ? null : user.id, ref);
    const header = await repoGetReportHeader(conn.db, reportId);
    if (header === null || (!isAdmin && header.reporterId !== user.id)) {
      throw notFound(REPORT_NOT_FOUND_MESSAGE);
    }
    if (!isAdmin && UPLOAD_TERMINAL_STATUSES.has(header.status)) {
      throw conflict('Report is closed to new attachments.');
    }
    const existingCount = await repoCountAttachments(conn.db, reportId);
    if (!canAddAttachments(existingCount, formFiles.length)) {
      throw tooManyFilesError();
    }

    // Phase A: validate + process ALL files before touching storage —
    // processing is side-effect free, so a failure here stores nothing.
    const processed: ProcessedUpload[] = [];
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
        mapAttachmentValidationError(error);
      }
      let image: ProcessedImage;
      try {
        image = await processImage(file.bytes);
      } catch (error) {
        mapAttachmentValidationError(error);
      }
      // `validateAttachment` already accepted the name, so this cannot
      // throw: it yields the display-only basename for storage.
      processed.push({ image, originalFilename: sanitizeOriginalFilename(file.originalFilename) });
    }

    // Phase B: store every processed image (keys pair with items by array
    // position — no index juggling on a separate key list).
    const storage = storageOverride ?? createAttachmentStorage();
    const saves = processed.map((item) => ({ item, key: generateAttachmentKey('att') }));
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

    // Phase C: single-transaction insert (rows + ATTACHMENT_ADDED event).
    // On DB failure every stored object is removed — no orphans.
    try {
      const created = await repoCreateAttachments(conn.db, {
        reportId,
        files: saves.map((save) => ({
          storageKey: save.key,
          originalFilename: save.item.originalFilename,
          mimeType: save.item.image.mimeType,
          sizeBytes: save.item.image.sizeBytes,
          checksum: save.item.image.checksum,
        })),
        uploadedBy: user.id,
      });
      return { attachments: created };
    } catch (error) {
      await Promise.allSettled(storedKeys.map((key) => storage.remove(key)));
      throw error;
    }
  } finally {
    await conn.close().catch(() => undefined);
  }
}

export async function downloadAttachment(
  req: Request,
  ref: string,
  attachmentId: string,
  storageOverride?: AttachmentStorage,
): Promise<AttachmentDownload> {
  await requireUser(req);
  const conn = getDb();
  try {
    // Campus-readable: resolve the ref unscoped so any authenticated reporter
    // can read another reporter's ticket attachment. Unknown refs still 404.
    const reportId = await resolveReportId(conn.db, null, ref);
    const header = await repoGetReportHeader(conn.db, reportId);
    if (header === null) {
      throw notFound(REPORT_NOT_FOUND_MESSAGE);
    }
    const attachment = await repoGetAttachmentById(conn.db, attachmentId);
    if (attachment === null || attachment.reportId !== reportId) {
      throw notFound(ATTACHMENT_NOT_FOUND_MESSAGE);
    }
    const storage = storageOverride ?? createAttachmentStorage();
    const data = await storage.get(attachment.storageKey);
    if (data === null) {
      throw notFound(ATTACHMENT_NOT_FOUND_MESSAGE);
    }
    return {
      bytes: data.bytes,
      // Canonical re-encoded MIME from the DB row, not the stored sidecar.
      contentType: attachment.mimeType,
      filename: sanitizeOriginalFilename(attachment.originalFilename),
    };
  } finally {
    await conn.close().catch(() => undefined);
  }
}

// RFC 5987 `filename*` encoding for Content-Disposition (`encodeURIComponent`
// leaves `'`/`(`/`)`/`*` unescaped, all of which are outside attr-char).
function encodeRFC5987(value: string): string {
  return encodeURIComponent(value)
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/\*/g, '%2A');
}

// Builds the exact byte-streaming response for a download (pure —
// unit-tested for the header contract; routes only call it).
export function toAttachmentResponse(download: AttachmentDownload): Response {
  // `Uint8Array<ArrayBufferLike>` is a valid body at runtime; the cast only
  // satisfies the DOM `BodyInit` generic parameter.
  const body = download.bytes as unknown as BodyInit;
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': download.contentType,
      'Content-Disposition': `inline; filename*=UTF-8''${encodeRFC5987(download.filename)}`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, max-age=60',
    },
  });
}
