// Storage factory: selects the AttachmentStorage backend (Phase 4, task P4-2).
//
// Server-only: reads `process.env` directly (same precedent as
// `resolveStorageDir` in `filesystem.ts`). Explicit options win over env;
// empty strings fall through to fallback/default.
import { S3Client } from '@aws-sdk/client-s3';
import { FilesystemAttachmentStorage, resolveStorageDir } from './filesystem';
import { DEFAULT_STORAGE_BUCKET, S3_REGION, S3AttachmentStorage } from './s3';
import type { AttachmentStorage } from './types';

export type StorageAdapter = 'filesystem' | 's3';

export const STORAGE_ADAPTER_ENV = 'STORAGE_ADAPTER';

export interface CreateAttachmentStorageOptions {
  readonly adapter?: StorageAdapter;
  readonly storageDir?: string;
  readonly endpoint?: string;
  readonly bucket?: string;
  readonly accessKeyId?: string;
  readonly secretAccessKey?: string;
  readonly client?: S3Client;
}

// `STORAGE_ADAPTER`: 'filesystem' | 's3', default 'filesystem'. Empty string
// falls through to the default; anything else throws, listing the value
// received (no secret can appear here — the adapter name is not sensitive,
// and credential values are never interpolated into messages).
export function resolveStorageAdapter(explicit?: string): StorageAdapter {
  const raw = explicit ?? process.env[STORAGE_ADAPTER_ENV];
  if (raw === undefined || raw.trim().length === 0) {
    return 'filesystem';
  }
  if (raw === 'filesystem' || raw === 's3') {
    return raw;
  }
  throw new Error(`Unknown STORAGE_ADAPTER "${raw}": expected "filesystem" or "s3".`);
}

function envValue(name: string): string | undefined {
  const raw = process.env[name];
  if (raw === undefined) {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function firstNonEmpty(...candidates: Array<string | undefined>): string | undefined {
  for (const candidate of candidates) {
    if (candidate !== undefined && candidate.trim().length > 0) {
      return candidate.trim();
    }
  }
  return undefined;
}

export function createAttachmentStorage(explicit: CreateAttachmentStorageOptions = {}): AttachmentStorage {
  const adapter = resolveStorageAdapter(explicit.adapter);
  if (adapter === 'filesystem') {
    return new FilesystemAttachmentStorage(resolveStorageDir(explicit.storageDir));
  }
  const endpoint = firstNonEmpty(explicit.endpoint, envValue('STORAGE_ENDPOINT'));
  if (endpoint === undefined) {
    throw new Error('Missing STORAGE_ENDPOINT: set STORAGE_ENDPOINT to use the "s3" storage adapter.');
  }
  const bucket = firstNonEmpty(explicit.bucket, envValue('STORAGE_BUCKET')) ?? DEFAULT_STORAGE_BUCKET;
  const accessKeyId = firstNonEmpty(
    explicit.accessKeyId,
    envValue('STORAGE_ACCESS_KEY_ID'),
    envValue('GARAGE_DEFAULT_ACCESS_KEY'),
  );
  if (accessKeyId === undefined) {
    throw new Error(
      'Missing STORAGE_ACCESS_KEY_ID: set STORAGE_ACCESS_KEY_ID (or GARAGE_DEFAULT_ACCESS_KEY) to use the "s3" storage adapter.',
    );
  }
  const secretAccessKey = firstNonEmpty(
    explicit.secretAccessKey,
    envValue('STORAGE_SECRET_ACCESS_KEY'),
    envValue('GARAGE_DEFAULT_SECRET_KEY'),
  );
  if (secretAccessKey === undefined) {
    throw new Error(
      'Missing STORAGE_SECRET_ACCESS_KEY: set STORAGE_SECRET_ACCESS_KEY (or GARAGE_DEFAULT_SECRET_KEY) to use the "s3" storage adapter.',
    );
  }
  const client =
    explicit.client ??
    new S3Client({
      endpoint,
      region: S3_REGION,
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: true,
    });
  return new S3AttachmentStorage({ bucket, endpoint, client });
}
