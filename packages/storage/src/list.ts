// Standalone orphan-enumeration helpers (Phase 4, task P4-4).
//
// ADDITIVE ONLY: the `AttachmentStorage` interface stays frozen — these are
// standalone functions (not interface methods) consumed by the orphan cleanup
// (`@silapor/database` `attachment-cleanup.ts`) through caller-bound thunks.
// Server-only (node:fs + AWS SDK): never import from client code.
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { ListObjectsV2Command } from '@aws-sdk/client-s3';

// S3 page size: the ListObjectsV2 service maximum per call.
export const S3_LIST_MAX_KEYS = 1000;

const META_SUFFIX = '.meta.json';

// One enumerated object: the storage key plus the last-modified instant when
// the backend reports one. The filesystem entry carries the file mtime (`null`
// only on a list→stat race, i.e. the file vanished — removal is idempotent on
// both backends, so cleanup treats unknown-age keys as orphan-eligible); S3
// carries the native `LastModified` (`null` when the SDK omits it).
export interface StorageKeyEntry {
  readonly key: string;
  readonly lastModified: Date | null;
}

// Minimal S3 surface for listing: structural so unit tests pass stub doubles
// without casts. A real `S3Client` satisfies it via `as unknown as
// S3ListClient` (the full client type is wider than this projection).
export interface S3ListItem {
  readonly Key?: string;
  readonly LastModified?: Date;
}

export interface S3ListPage {
  readonly Contents?: readonly S3ListItem[];
  readonly IsTruncated?: boolean;
  readonly NextContinuationToken?: string;
}

export interface S3ListClient {
  send(command: ListObjectsV2Command): Promise<S3ListPage>;
}

// Traversal guard for listing scopes: prefixes match literally INSIDE the
// backend, so `..` segments and absolute prefixes are never valid scopes and
// throw before any I/O (mirrors the `assertSafeKey` rule in
// `filesystem.ts`/`s3.ts` — keep in sync).
function assertSafePrefix(prefix: string): void {
  if (prefix === '') {
    return;
  }
  if (prefix.startsWith('/')) {
    throw new Error(`Invalid list prefix "${prefix}": absolute prefixes are not allowed.`);
  }
  const segments = prefix.split(/[\\/]/);
  if (segments.some((segment) => segment === '..')) {
    throw new Error(`Invalid list prefix "${prefix}": path traversal is not allowed.`);
  }
}

// Recursive mtime-enriched walk. Symlinks (files AND directories) are skipped
// fail-closed so a link can never pull the walk outside the root; every
// emitted key is additionally verified to resolve inside the root. Missing
// root → [] (fresh environments have nothing to clean).
export async function listFilesystemKeyEntries(rootDir: string, prefix: string): Promise<StorageKeyEntry[]> {
  assertSafePrefix(prefix);
  const rootResolved = path.resolve(rootDir);
  const out: StorageKeyEntry[] = [];
  const pending: string[] = [''];
  let first = true;
  while (pending.length > 0) {
    const rel = pending.pop() as string;
    const full = path.join(rootResolved, rel);
    let dirents;
    try {
      dirents = await readdir(full, { withFileTypes: true });
    } catch (error: unknown) {
      // Missing root on the first read means "nothing stored yet".
      if (first && (error as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      throw error;
    } finally {
      first = false;
    }
    for (const dirent of dirents ?? []) {
      if (dirent.isSymbolicLink()) {
        continue;
      }
      const childRel = rel === '' ? dirent.name : `${rel}/${dirent.name}`;
      const childFull = path.join(rootResolved, childRel);
      const resolved = path.resolve(childFull);
      if (resolved !== rootResolved && !resolved.startsWith(rootResolved + path.sep)) {
        continue;
      }
      if (dirent.isDirectory()) {
        pending.push(childRel);
      } else if (dirent.isFile()) {
        if (childRel.endsWith(META_SUFFIX)) {
          continue;
        }
        const key = childRel.split(path.sep).join('/');
        if (prefix !== '' && !key.startsWith(prefix)) {
          continue;
        }
        let lastModified: Date | null = null;
        try {
          lastModified = (await stat(resolved)).mtime;
        } catch {
          // List→stat race (deleted concurrently): keep the key with unknown
          // age — removal below is idempotent (`rm --force` semantics).
        }
        out.push({ key, lastModified });
      }
    }
  }
  out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return out;
}

// Bare-key filesystem listing (readdir-based, guard-escaped).
export async function listFilesystemKeys(rootDir: string, prefix: string): Promise<string[]> {
  return (await listFilesystemKeyEntries(rootDir, prefix)).map((entry) => entry.key);
}

// S3 key listing with `ListObjectsV2Command` pagination (max 1000/page).
// Private-bucket safe: list-only, no ACL/URL generation. Empty/undefined keys
// are skipped; a truncated page without a continuation token ends the walk
// (never loops forever on a malformed response).
export async function listS3Keys(
  client: S3ListClient,
  bucket: string,
  prefix: string,
): Promise<StorageKeyEntry[]> {
  if (bucket.trim().length === 0) {
    throw new Error('Missing STORAGE_BUCKET: bucket must not be empty.');
  }
  assertSafePrefix(prefix);
  const out: StorageKeyEntry[] = [];
  let token: string | undefined;
  for (;;) {
    const output = await client.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        MaxKeys: S3_LIST_MAX_KEYS,
        ...(token === undefined ? {} : { ContinuationToken: token }),
      }),
    );
    for (const item of output.Contents ?? []) {
      if (item.Key === undefined || item.Key === '') {
        continue;
      }
      out.push({ key: item.Key, lastModified: item.LastModified ?? null });
    }
    if (output.IsTruncated === true && output.NextContinuationToken !== undefined) {
      token = output.NextContinuationToken;
      continue;
    }
    break;
  }
  out.sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return out;
}
