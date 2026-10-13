// Orphan attachment cleanup (Phase 4, task P4-4).
//
// Context: drafts do not exist — upload binds directly to a report, and
// failed puts never write rows (P4-3 removes already-stored objects when the
// DB insert fails). Leftovers can therefore only come from a crash between
// the storage put and the row insert, or from manual intervention. This
// janitor covers BOTH directions:
// - storage keys with NO row older than `olderThanMs` → `orphans` (removed
//   unless `dryRun`, capped at `limit`);
// - DB rows whose key is missing in storage → `brokenRefs` (REPORTED ONLY —
//   rows are never auto-deleted).
//
// NO interface/migration changes: `AttachmentStorage` stays frozen (only
// `remove` is used, via a minimal structural type) and no table changes. The
// `db` param accepts a drizzle database (queried directly for
// `report_attachments` rows) or a minimal row source (unit tests pass fakes).
// The `listKeys` enumerator is caller-bound — e.g. `() =>
// listFilesystemKeyEntries(dir, 'att')` or `() => listS3Keys(client, bucket,
// 'att')` from `@silapor/storage` (structurally compatible, no new
// dependency). This module logs nothing.
import { badRequest } from '@silapor/shared';
import type { ReportQueryDb } from './reports.js';
import { reportAttachments } from './schema.js';

export interface AttachmentRow {
  readonly storageKey: string;
  readonly reportId: string;
  readonly createdAt: Date;
}

export interface AttachmentRowSource {
  listAttachmentRows(): Promise<readonly AttachmentRow[]>;
}

export type CleanupDb = AttachmentRowSource | ReportQueryDb;

// Storage surface actually used: removal only. Structural so tests pass spies.
export interface CleanupStorage {
  remove(key: string): Promise<void>;
}

// Storage enumeration entry (structural twin of the `@silapor/storage`
// `StorageKeyEntry` — same shape, no cross-package dependency).
export interface StorageKeyEntry {
  readonly key: string;
  readonly lastModified: Date | null;
}

export type ListKeysFn = () => Promise<readonly StorageKeyEntry[]>;

export interface CleanupOrphanAttachmentsOptions {
  readonly db: CleanupDb;
  readonly storage: CleanupStorage;
  readonly listKeys: ListKeysFn;
  readonly olderThanMs?: number;
  readonly dryRun?: boolean;
  readonly limit?: number;
  /** Test seam: reference instant for the age checks. @default now */
  readonly now?: Date;
}

export interface CleanupOrphanAttachmentsResult {
  readonly checked: number;
  readonly orphans: readonly string[];
  readonly removed: number;
  readonly brokenRefs: readonly string[];
  readonly dryRun: boolean;
}

export const DEFAULT_ORPHAN_OLDER_THAN_MS = 24 * 3600 * 1000;
export const DEFAULT_ORPHAN_LIMIT = 100;

// Production row source: a single projection query over `report_attachments`
// (no migration — the table + index predate Phase 4).
export function createDrizzleAttachmentRowSource(db: ReportQueryDb): AttachmentRowSource {
  return {
    async listAttachmentRows(): Promise<readonly AttachmentRow[]> {
      return await db
        .select({
          storageKey: reportAttachments.storageKey,
          reportId: reportAttachments.reportId,
          createdAt: reportAttachments.createdAt,
        })
        .from(reportAttachments);
    },
  };
}

function resolveRowSource(db: CleanupDb): AttachmentRowSource {
  const candidate = db as Partial<AttachmentRowSource>;
  if (typeof candidate.listAttachmentRows === 'function') {
    return candidate as AttachmentRowSource;
  }
  return createDrizzleAttachmentRowSource(db as ReportQueryDb);
}

export async function cleanupOrphanAttachments(
  options: CleanupOrphanAttachmentsOptions,
): Promise<CleanupOrphanAttachmentsResult> {
  const olderThanMs = options.olderThanMs ?? DEFAULT_ORPHAN_OLDER_THAN_MS;
  const dryRun = options.dryRun ?? false;
  const limit = options.limit ?? DEFAULT_ORPHAN_LIMIT;
  const now = options.now ?? new Date();
  if (!Number.isInteger(limit) || limit < 0) {
    throw badRequest('Invalid cleanup limit: limit must be a non-negative integer.');
  }
  if (!Number.isFinite(olderThanMs) || olderThanMs < 0) {
    throw badRequest('Invalid cleanup age: olderThanMs must be a non-negative number.');
  }

  const source = resolveRowSource(options.db);
  const [rows, keys] = await Promise.all([source.listAttachmentRows(), options.listKeys()]);
  const rowKeys = new Set(rows.map((item) => item.storageKey));
  const storageKeys = new Set(keys.map((item) => item.key));
  const brokenRefs = rows
    .map((item) => item.storageKey)
    .filter((key) => !storageKeys.has(key))
    .sort();
  // Unknown-age keys (null) count as orphan-eligible: on the filesystem that
  // only happens on a list→stat race (the file is already gone, so the
  // idempotent remove below is a no-op); S3 always reports LastModified.
  const orphans = keys
    .filter(
      (item) =>
        !rowKeys.has(item.key) &&
        (item.lastModified === null || now.getTime() - item.lastModified.getTime() >= olderThanMs),
    )
    .map((item) => item.key)
    .sort()
    .slice(0, limit);
  // Sequential on purpose: removals are idempotent, so a mid-run failure
  // propagates loudly and the next run safely retries the remainder.
  let removed = 0;
  if (!dryRun) {
    for (const key of orphans) {
      await options.storage.remove(key);
      removed += 1;
    }
  }
  return { checked: keys.length, orphans, removed, brokenRefs, dryRun };
}
