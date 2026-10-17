// Pre-submit photo staging rows (AI verification photo-first flow).
//
// A staged row reserves one validated, re-encoded image in private storage
// under an unguessable `staging_<uuid>` key BEFORE its report exists. The
// verified submit claims staged keys into `report_attachments` (PASS/HELD)
// or removes their objects (FAIL). Unclaimed rows expire by `created_at`:
// the submit rejects them and the janitor below removes their objects.
// Claimed rows stay as audit and cascade with their report.
//
// Validation here is structural only (types, UUIDs, non-empty): the Phase 4
// chain (`validateAttachment` magic bytes, `processImage` re-encode, 5 MB
// cap, JPEG/PNG/WebP allowlist) already ran in the staging service before
// any row is recorded. Errors use `AppError` (400 validation), no PII.
// This module logs nothing.
import { and, eq, inArray, isNull, lt } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { badRequest, conflict } from '@silapor/shared';
import * as schema from './schema.js';
import type { AttachmentSummary } from './attachments.js';
import type { ReportQueryDb } from './reports.js';

type Database = PostgresJsDatabase<typeof schema>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface RecordStagedUploadInput {
  readonly storageKey: string;
  readonly uploadedBy: string;
  readonly originalFilename: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly checksum: string;
}

export interface StagedUpload {
  readonly id: string;
  readonly storageKey: string;
  readonly uploadedBy: string;
  readonly originalFilename: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly checksum: string;
  readonly claimedReportId: string | null;
  readonly createdAt: Date;
}

function requireUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    throw badRequest(`${field} must be a valid UUID`);
  }
  return value;
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw badRequest(`${field} must be a non-empty string`);
  }
  return value;
}

function toStagedUpload(row: typeof schema.stagedUploads.$inferSelect): StagedUpload {
  return {
    id: row.id,
    storageKey: row.storageKey,
    uploadedBy: row.uploadedBy,
    originalFilename: row.originalFilename,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    checksum: row.checksum,
    claimedReportId: row.claimedReportId,
    createdAt: row.createdAt,
  };
}

export async function recordStagedUpload(
  db: Database,
  input: RecordStagedUploadInput,
): Promise<StagedUpload> {
  if (typeof input !== 'object' || input === null) {
    throw badRequest('Invalid staged upload input');
  }
  const storageKey = requireText(input.storageKey, 'storageKey');
  const uploadedBy = requireUuid(input.uploadedBy, 'uploadedBy');
  const originalFilename = requireText(input.originalFilename, 'originalFilename');
  const mimeType = requireText(input.mimeType, 'mimeType');
  const sizeBytes = input.sizeBytes;
  if (!Number.isInteger(sizeBytes) || (sizeBytes as number) <= 0) {
    throw badRequest('sizeBytes must be a positive integer');
  }
  const checksum = requireText(input.checksum, 'checksum');
  const inserted = await db
    .insert(schema.stagedUploads)
    .values({ storageKey, uploadedBy, originalFilename, mimeType, sizeBytes, checksum })
    .returning();
  const row = inserted[0];
  if (row === undefined) {
    throw badRequest('Failed to record staged upload');
  }
  return toStagedUpload(row);
}

export async function getStagedUploadsByKeys(
  db: ReportQueryDb,
  keys: readonly string[],
): Promise<StagedUpload[]> {
  if (keys.length === 0) {
    return [];
  }
  const rows = await db
    .select()
    .from(schema.stagedUploads)
    .where(inArray(schema.stagedUploads.storageKey, [...keys]));
  return rows.map(toStagedUpload);
}

// Marks unclaimed staged keys as claimed by a report. Returns the claimed
// rows; a shortfall (already claimed or unknown keys racing in) is visible
// to the caller via the count.
export async function claimStagedUploads(
  db: Database,
  reportId: string,
  keys: readonly string[],
): Promise<StagedUpload[]> {
  const id = requireUuid(reportId, 'reportId');
  if (keys.length === 0) {
    return [];
  }
  const claimed = await db
    .update(schema.stagedUploads)
    .set({ claimedReportId: id })
    .where(
      and(inArray(schema.stagedUploads.storageKey, [...keys]), isNull(schema.stagedUploads.claimedReportId)),
    )
    .returning();
  return claimed.map(toStagedUpload);
}

// Deletes staged rows for a key set. Only UNCLAIMED rows are ever deleted;
// when `uploadedBy` is a UUID, also only that uploader's rows (the FAIL
// path) — a key claimed by a concurrent submit's report in the same key
// list therefore survives with its object. The janitor passes `null` (its
// input rows are already unclaimed-only, and the claimed filter still
// guards the list→delete race). Returns the keys whose rows were deleted,
// so callers remove storage objects only for those keys.
export async function deleteStagedUploads(
  db: Database,
  uploadedBy: string | null,
  keys: readonly string[],
): Promise<readonly string[]> {
  // Validate before any query so pure tests fail loudly on the stub, not on
  // the database seam.
  const owner = uploadedBy === null ? null : requireUuid(uploadedBy, 'uploadedBy');
  if (keys.length === 0) {
    return [];
  }
  const deleted = await db
    .delete(schema.stagedUploads)
    .where(
      and(
        inArray(schema.stagedUploads.storageKey, [...keys]),
        isNull(schema.stagedUploads.claimedReportId),
        ...(owner === null ? [] : [eq(schema.stagedUploads.uploadedBy, owner)]),
      ),
    )
    .returning({ storageKey: schema.stagedUploads.storageKey });
  return deleted.map((row) => row.storageKey);
}

export async function listExpiredUnclaimedStaged(
  db: ReportQueryDb,
  before: Date,
): Promise<StagedUpload[]> {
  const rows = await db
    .select()
    .from(schema.stagedUploads)
    .where(
      and(isNull(schema.stagedUploads.claimedReportId), lt(schema.stagedUploads.createdAt, before)),
    );
  return rows.map(toStagedUpload);
}

export interface LinkStagedUploadsInput {
  readonly reportId: string;
  readonly staged: readonly {
    readonly storageKey: string;
    readonly originalFilename: string;
    readonly mimeType: string;
    readonly sizeBytes: number;
    readonly checksum: string;
  }[];
  readonly uploadedBy: string;
}

// Claims staged keys into attachment rows for a report atomically: staged
// rows flip to claimed, `report_attachments` rows appear with the staged
// canonical metadata (no re-upload, no re-process), plus one
// ATTACHMENT_ADDED event. A shortfall (keys claimed or unknown racing in)
// fails the whole link with 409 — the caller treats it as a submit error,
// never a partial link.
export async function linkStagedUploads(
  db: Database,
  input: LinkStagedUploadsInput,
): Promise<AttachmentSummary[]> {
  if (typeof input !== 'object' || input === null) {
    throw badRequest('Invalid link staged uploads input');
  }
  const reportId = requireUuid(input.reportId, 'reportId');
  const uploadedBy = requireUuid(input.uploadedBy, 'uploadedBy');
  if (!Array.isArray(input.staged) || input.staged.length === 0) {
    throw badRequest('At least one staged file is required.');
  }
  const files = input.staged.map((file) => ({
    storageKey: requireText(file?.storageKey, 'storageKey'),
    originalFilename: requireText(file?.originalFilename, 'originalFilename'),
    mimeType: requireText(file?.mimeType, 'mimeType'),
    sizeBytes: file?.sizeBytes,
    checksum: requireText(file?.checksum, 'checksum'),
  }));
  for (const file of files) {
    if (!Number.isInteger(file.sizeBytes) || (file.sizeBytes as number) <= 0) {
      throw badRequest('sizeBytes must be a positive integer');
    }
  }
  return await db.transaction(async (tx) => {
    const claimed = await tx
      .update(schema.stagedUploads)
      .set({ claimedReportId: reportId })
      .where(
        and(
          inArray(
            schema.stagedUploads.storageKey,
            files.map((file) => file.storageKey),
          ),
          isNull(schema.stagedUploads.claimedReportId),
        ),
      )
      .returning({ storageKey: schema.stagedUploads.storageKey });
    if (claimed.length !== files.length) {
      throw conflict('Staged photo already claimed.');
    }
    const inserted = await tx
      .insert(schema.reportAttachments)
      .values(
        files.map((file) => ({
          reportId,
          storageKey: file.storageKey,
          originalFilename: file.originalFilename,
          mimeType: file.mimeType,
          sizeBytes: file.sizeBytes as number,
          checksum: file.checksum,
          uploadedBy,
        })),
      )
      .returning({
        id: schema.reportAttachments.id,
        originalFilename: schema.reportAttachments.originalFilename,
        mimeType: schema.reportAttachments.mimeType,
        sizeBytes: schema.reportAttachments.sizeBytes,
        checksum: schema.reportAttachments.checksum,
        createdAt: schema.reportAttachments.createdAt,
      });
    await tx.insert(schema.reportEvents).values({
      reportId,
      eventType: 'ATTACHMENT_ADDED',
      actorId: uploadedBy,
      metadata: { attachmentIds: inserted.map((row) => row.id), count: inserted.length },
    });
    return inserted;
  });
}

// ---------------------------------------------------------------------------
// Staged janitor (orphan TTL).
// ---------------------------------------------------------------------------

// Storage surface actually used: removal only, mirroring
// `attachment-cleanup.ts` (structural so tests pass spies).
export interface StagedCleanupStorage {
  remove(key: string): Promise<void>;
}

export interface StagedStorageKeyEntry {
  readonly key: string;
  readonly lastModified: Date | null;
}

export type StagedListKeysFn = () => Promise<readonly StagedStorageKeyEntry[]>;

export interface CleanupStagedUploadsOptions {
  readonly db: ReportQueryDb;
  readonly storage: StagedCleanupStorage;
  readonly listKeys: StagedListKeysFn;
  readonly olderThanMs?: number;
  readonly dryRun?: boolean;
  readonly limit?: number;
  /** Test seam: reference instant for the age checks. @default now */
  readonly now?: Date;
}

export interface CleanupStagedUploadsResult {
  readonly checked: number;
  readonly orphans: readonly string[];
  readonly removed: number;
  readonly expiredRows: readonly string[];
  readonly dryRun: boolean;
}

export const DEFAULT_STAGED_TTL_MS = 24 * 3600 * 1000;
export const DEFAULT_STAGED_CLEANUP_LIMIT = 100;

// Removes two kinds of leftovers, both TTL-gated:
// - expired unclaimed staged rows (submit never came): object removed,
//   then the row deleted (object-first so a crash stays retryable);
// - rowless `staging_` objects (crash between storage put and row insert,
//   or manual intervention): listed by prefix, removed when older than TTL.
// Claimed keys are never touched: they have attachment rows after the
// submit links them. Sequential removals: idempotent, next run retries.
export async function cleanupStagedUploads(
  options: CleanupStagedUploadsOptions,
): Promise<CleanupStagedUploadsResult> {
  const olderThanMs = options.olderThanMs ?? DEFAULT_STAGED_TTL_MS;
  const dryRun = options.dryRun ?? false;
  const limit = options.limit ?? DEFAULT_STAGED_CLEANUP_LIMIT;
  const now = options.now ?? new Date();
  if (!Number.isInteger(limit) || limit < 0) {
    throw badRequest('Invalid cleanup limit: limit must be a non-negative integer.');
  }
  if (!Number.isFinite(olderThanMs) || olderThanMs < 0) {
    throw badRequest('Invalid cleanup age: olderThanMs must be a non-negative number.');
  }
  const cutoff = new Date(now.getTime() - olderThanMs);
  const db = options.db as Database;
  const expired = await listExpiredUnclaimedStaged(db, cutoff);
  const [stagedRows, attachmentRows, keys] = await Promise.all([
    db.select({ storageKey: schema.stagedUploads.storageKey }).from(schema.stagedUploads),
    db
      .select({ storageKey: schema.reportAttachments.storageKey })
      .from(schema.reportAttachments),
    options.listKeys(),
  ]);
  const known = new Set([
    ...stagedRows.map((row) => row.storageKey),
    ...attachmentRows.map((row) => row.storageKey),
  ]);
  const rowless = keys
    .filter(
      (item) =>
        item.key.startsWith('staging_') &&
        !known.has(item.key) &&
        (item.lastModified === null || now.getTime() - item.lastModified.getTime() >= olderThanMs),
    )
    .map((item) => item.key)
    .sort();
  const expiredKeys = expired.map((row) => row.storageKey).sort();
  const targets = [...new Set([...expiredKeys, ...rowless])].sort().slice(0, limit);
  let removed = 0;
  if (!dryRun) {
    for (const key of targets) {
      await options.storage.remove(key);
      removed += 1;
    }
    if (expired.length > 0) {
      await deleteStagedUploads(db, null, expired.map((row) => row.storageKey));
    }
  }
  return {
    checked: keys.length,
    orphans: targets,
    removed,
    expiredRows: expiredKeys,
    dryRun,
  };
}
