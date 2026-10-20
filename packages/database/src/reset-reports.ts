// Report-data reset for manual testing (dev/operator tool).
//
// Wipes every report-scoped row so testers start from an empty ticket list:
// `maintenance_reports` + its children (events, assignments, updates,
// relations, attachments), AI analyses, pre-submit staged uploads,
// notifications, outbox events, and the per-year ticket counter (the next
// submit is MNT-<year>-000001 again).
//
// KEPT intact on purpose: users, sessions, locations, facility categories,
// issue types, facility assets, technicians, audit_logs. Login and the report
// form pickers keep working without a re-seed.
//
// Stored objects belonging to the removed rows are deleted from the
// attachment directory as well, together with `att_*`/`staging_*` leftovers
// (orphans once every report is gone). Pass `purgeOrphanFiles: false` to keep
// leftovers, or `skipStorageCleanup: true` for a DB-only reset.
//
// Importing this module performs no I/O. Run directly:
//   pnpm --filter @silapor/database run db:reset-reports -- --dry-run
//   pnpm --filter @silapor/database run db:reset-reports
//
// Safety: refuses to run when NODE_ENV=production unless `allowProduction` is
// set explicitly.

import { readdir, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { count } from 'drizzle-orm';
import { getDb, redactDatabaseUrl, resolveDatabaseUrl, type DatabaseConnection } from './index.js';
import {
  aiAnalyses,
  maintenanceReports,
  notifications,
  outboxEvents,
  reportAssignments,
  reportAttachments,
  reportEvents,
  reportRelations,
  reportUpdates,
  stagedUploads,
  ticketCounters,
} from './schema.js';

type ResetDb = DatabaseConnection['db'];

// Packages may be launched from any cwd (`pnpm --filter` uses
// packages/database), so relative storage paths resolve against the repo root
// — the same directory the web app runs from per README.
const REPO_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const DEFAULT_STORAGE_DIR = path.join(REPO_ROOT, '.data', 'attachments');
const ORPHAN_FILE_PREFIXES = ['att_', 'staging_'] as const;

export interface ReportDataCounts {
  readonly maintenanceReports: number;
  readonly reportEvents: number;
  readonly reportAssignments: number;
  readonly reportUpdates: number;
  readonly reportRelations: number;
  readonly reportAttachments: number;
  readonly stagedUploads: number;
  readonly aiAnalyses: number;
  readonly notifications: number;
  readonly outboxEvents: number;
  readonly ticketCounters: number;
}

export interface ResetReportDataOptions {
  readonly connectionString?: string;
  /** Report what would be deleted without touching rows or files. */
  readonly dryRun?: boolean;
  /** Explicit attachment root; defaults to `STORAGE_DIR` / repo `.data`. */
  readonly storageDir?: string;
  /** Keep stored objects (DB rows are still deleted). */
  readonly skipStorageCleanup?: boolean;
  /** Also delete `att_*`/`staging_*` files that no row references. @default true */
  readonly purgeOrphanFiles?: boolean;
  /** Bypass the NODE_ENV=production guard. */
  readonly allowProduction?: boolean;
}

export interface ResetReportDataResult {
  readonly dryRun: boolean;
  readonly deleted: ReportDataCounts;
  readonly remaining: ReportDataCounts;
  readonly storageDir: string;
  readonly filesTargeted: number;
  readonly filesRemoved: number;
  readonly storageErrors: readonly string[];
}

// Absolute attachment root: explicit arg wins, then `STORAGE_DIR` (relative
// values resolve against the repo root), then the documented default.
export function resolveResetStorageDir(explicit?: string): string {
  if (explicit !== undefined && explicit.trim() !== '') {
    return path.resolve(explicit);
  }
  const fromEnv = process.env['STORAGE_DIR'];
  if (fromEnv !== undefined && fromEnv.trim() !== '') {
    return path.resolve(REPO_ROOT, fromEnv.trim());
  }
  return DEFAULT_STORAGE_DIR;
}

export async function countReportData(db: ResetDb): Promise<ReportDataCounts> {
  const [
    reports,
    events,
    assignments,
    updates,
    relations,
    attachments,
    staged,
    analyses,
    notes,
    outbox,
    counters,
  ] = await Promise.all([
    db.select({ value: count() }).from(maintenanceReports),
    db.select({ value: count() }).from(reportEvents),
    db.select({ value: count() }).from(reportAssignments),
    db.select({ value: count() }).from(reportUpdates),
    db.select({ value: count() }).from(reportRelations),
    db.select({ value: count() }).from(reportAttachments),
    db.select({ value: count() }).from(stagedUploads),
    db.select({ value: count() }).from(aiAnalyses),
    db.select({ value: count() }).from(notifications),
    db.select({ value: count() }).from(outboxEvents),
    db.select({ value: count() }).from(ticketCounters),
  ]);

  return {
    maintenanceReports: reports[0]?.value ?? 0,
    reportEvents: events[0]?.value ?? 0,
    reportAssignments: assignments[0]?.value ?? 0,
    reportUpdates: updates[0]?.value ?? 0,
    reportRelations: relations[0]?.value ?? 0,
    reportAttachments: attachments[0]?.value ?? 0,
    stagedUploads: staged[0]?.value ?? 0,
    aiAnalyses: analyses[0]?.value ?? 0,
    notifications: notes[0]?.value ?? 0,
    outboxEvents: outbox[0]?.value ?? 0,
    ticketCounters: counters[0]?.value ?? 0,
  };
}

export function hasReportData(counts: ReportDataCounts): boolean {
  return Object.values(counts).some((value) => value > 0);
}

function isSafeStorageKey(key: string): boolean {
  if (key.trim().length === 0 || path.isAbsolute(key)) {
    return false;
  }
  const normalized = path.posix.normalize(key.split(path.sep).join('/'));
  return normalized !== '.' && normalized !== '..' && !normalized.startsWith('../');
}

// Existing files the reset targets: every storage key captured from the rows
// (object + `.meta.json` sidecar) plus, optionally, prefix-scoped files left
// behind by earlier crashes — all orphans once every report is deleted.
async function listExistingStorageTargets(
  storageDir: string,
  storageKeys: readonly string[],
  purgeOrphanFiles: boolean,
): Promise<string[]> {
  const candidates = new Set<string>();
  for (const key of storageKeys) {
    if (!isSafeStorageKey(key)) {
      continue;
    }
    candidates.add(key);
    candidates.add(`${key}.meta.json`);
  }

  try {
    const entries = await readdir(storageDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || !purgeOrphanFiles) {
        continue;
      }
      if (ORPHAN_FILE_PREFIXES.some((prefix) => entry.name.startsWith(prefix))) {
        candidates.add(entry.name);
      }
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'ENOENT') {
      throw error;
    }
  }

  const existing: string[] = [];
  for (const candidate of candidates) {
    try {
      const info = await stat(path.join(storageDir, candidate));
      if (info.isFile()) {
        existing.push(candidate);
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        throw error;
      }
    }
  }
  return existing.sort();
}

// Removal is idempotent; a failure (e.g. permissions) is reported instead of
// thrown so a committed DB reset never looks like it failed.
async function removeStorageTargets(
  storageDir: string,
  targets: readonly string[],
): Promise<{ removed: number; errors: readonly string[] }> {
  let removed = 0;
  const errors: string[] = [];
  for (const target of targets) {
    try {
      await unlink(path.join(storageDir, target));
      removed += 1;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        errors.push(`${target}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  return { removed, errors };
}

export async function resetReportData(
  options: ResetReportDataOptions = {},
): Promise<ResetReportDataResult> {
  if (process.env['NODE_ENV'] === 'production' && options.allowProduction !== true) {
    throw new Error(
      'db:reset-reports refuses to run with NODE_ENV=production (pass allowProduction/--allow-production to override).',
    );
  }

  const dryRun = options.dryRun ?? false;
  const purgeOrphanFiles = options.purgeOrphanFiles ?? true;
  const storageDir = resolveResetStorageDir(options.storageDir);
  const url = resolveDatabaseUrl(options.connectionString);
  const { db, close } = getDb(url);

  try {
    const before = await countReportData(db);

    if (dryRun) {
      const [attachmentRows, stagedRows] = await Promise.all([
        db.select({ key: reportAttachments.storageKey }).from(reportAttachments),
        db.select({ key: stagedUploads.storageKey }).from(stagedUploads),
      ]);
      const storageKeys = [
        ...attachmentRows.map((row) => row.key),
        ...stagedRows.map((row) => row.key),
      ];
      const targets =
        options.skipStorageCleanup === true
          ? []
          : await listExistingStorageTargets(storageDir, storageKeys, purgeOrphanFiles);
      return {
        dryRun: true,
        deleted: before,
        remaining: before,
        storageDir,
        filesTargeted: targets.length,
        filesRemoved: 0,
        storageErrors: [],
      };
    }

    const storageKeys = await db.transaction(async (tx) => {
      const [attachmentRows, stagedRows] = await Promise.all([
        tx.select({ key: reportAttachments.storageKey }).from(reportAttachments),
        tx.select({ key: stagedUploads.storageKey }).from(stagedUploads),
      ]);

      // Self-reference first: a bulk DELETE of every report is FK-safe, but
      // clearing `duplicate_of_report_id` keeps it independent of
      // statement-end FK timing (the column is historical-only anyway).
      await tx.update(maintenanceReports).set({ duplicateOfReportId: null });

      // Children before parents. Every child table cascades too, but the
      // explicit order keeps the intent readable and each count meaningful.
      await tx.delete(notifications);
      await tx.delete(aiAnalyses);
      await tx.delete(reportEvents);
      await tx.delete(reportAssignments);
      await tx.delete(reportUpdates);
      await tx.delete(reportRelations);
      await tx.delete(reportAttachments);
      await tx.delete(stagedUploads);
      await tx.delete(maintenanceReports);
      // Restart ticket numbering: the next submit becomes MNT-<year>-000001.
      await tx.delete(ticketCounters);
      // Report-driven queue rows (AI review + notifications); nothing left to
      // deliver once the reports are gone.
      await tx.delete(outboxEvents);

      return [...attachmentRows.map((row) => row.key), ...stagedRows.map((row) => row.key)];
    });

    let filesTargeted = 0;
    let filesRemoved = 0;
    let storageErrors: readonly string[] = [];
    if (options.skipStorageCleanup !== true) {
      const targets = await listExistingStorageTargets(storageDir, storageKeys, purgeOrphanFiles);
      filesTargeted = targets.length;
      const outcome = await removeStorageTargets(storageDir, targets);
      filesRemoved = outcome.removed;
      storageErrors = outcome.errors;
    }

    return {
      dryRun: false,
      deleted: before,
      remaining: await countReportData(db),
      storageDir,
      filesTargeted,
      filesRemoved,
      storageErrors,
    };
  } finally {
    await close();
  }
}

function formatCounts(counts: ReportDataCounts): string {
  return Object.entries(counts)
    .map(([table, value]) => `${table}=${value}`)
    .join(' ');
}

function isDirectRun(): boolean {
  const entry = process.argv[1];
  if (entry === undefined) {
    return false;
  }
  try {
    return pathToFileURL(entry).href === import.meta.url;
  } catch {
    return false;
  }
}

interface CliFlags {
  readonly dryRun: boolean;
  readonly skipStorageCleanup: boolean;
  readonly purgeOrphanFiles: boolean;
  readonly allowProduction: boolean;
  readonly storageDir?: string;
}

function parseArgs(argv: readonly string[]): CliFlags {
  let dryRun = false;
  let skipStorageCleanup = false;
  let purgeOrphanFiles = true;
  let allowProduction = false;
  let storageDir: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--keep-files') {
      skipStorageCleanup = true;
    } else if (arg === '--keep-orphan-files') {
      purgeOrphanFiles = false;
    } else if (arg === '--allow-production') {
      allowProduction = true;
    } else if (arg === '--storage-dir') {
      const value = argv[index + 1];
      if (value === undefined || value.trim() === '') {
        throw new Error('db:reset-reports: --storage-dir requires a path.');
      }
      storageDir = value;
      index += 1;
    } else {
      throw new Error(
        `db:reset-reports: unknown argument "${arg}" ` +
          '(expected --dry-run, --keep-files, --keep-orphan-files, --storage-dir <path>, --allow-production).',
      );
    }
  }
  return {
    dryRun,
    skipStorageCleanup,
    purgeOrphanFiles,
    allowProduction,
    ...(storageDir === undefined ? {} : { storageDir }),
  };
}

if (isDirectRun()) {
  const url = process.env['DATABASE_URL'];
  let flags: CliFlags | undefined;
  try {
    flags = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }

  if (flags !== undefined) {
    resetReportData({
      dryRun: flags.dryRun,
      skipStorageCleanup: flags.skipStorageCleanup,
      purgeOrphanFiles: flags.purgeOrphanFiles,
      allowProduction: flags.allowProduction,
      ...(flags.storageDir === undefined ? {} : { storageDir: flags.storageDir }),
    })
      .then((result) => {
        const target = redactDatabaseUrl(resolveDatabaseUrl(url));
        if (result.dryRun) {
          console.log(
            `db:reset-reports: DRY RUN — nothing deleted (${target}).\n` +
              `  current: ${formatCounts(result.deleted)}\n` +
              `  storage: ${result.storageDir} (${result.filesTargeted} object(s) would be removed)`,
          );
          return;
        }
        console.log(
          `db:reset-reports: deleted ${formatCounts(result.deleted)} (${target}).\n` +
            `  remaining: ${formatCounts(result.remaining)}\n` +
            `  storage: ${result.filesRemoved}/${result.filesTargeted} object(s) removed from ${result.storageDir}`,
        );
        for (const failure of result.storageErrors) {
          console.error(`  storage warning: ${failure}`);
        }
        if (hasReportData(result.remaining)) {
          console.error(
            '  warning: report rows still present — a concurrent writer may have inserted new ones.',
          );
        }
      })
      .catch((error: unknown) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
      });
  }
}
