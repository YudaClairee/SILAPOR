// S3-compatible AttachmentStorage backed by a private Garage bucket
// (Phase 4, task P4-2).
//
// Server-only: when the caller does not inject an explicit client, the
// endpoint/credentials resolve from `process.env` (same precedent as
// `resolveStorageDir` in `filesystem.ts`). The bucket is private: `put`
// sends NO public ACL/grant headers, and no presigned/public URLs are
// generated here — download stays an authorized endpoint (P4-3).
import { createHash } from 'node:crypto';
import path from 'node:path';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import type { AttachmentData, AttachmentPutResult, AttachmentStorage } from './types';

export const DEFAULT_STORAGE_BUCKET = 'silapor';
// Default region stays 'garage' for local dev (docker compose Garage).
// Cloudflare R2 requires 'auto' — set STORAGE_REGION=auto in production.
export const DEFAULT_S3_REGION = 'garage';
export const STORAGE_REGION_ENV = 'STORAGE_REGION';

const FALLBACK_CONTENT_TYPE = 'application/octet-stream';

const STORAGE_ENDPOINT_ENV = 'STORAGE_ENDPOINT';
const STORAGE_ACCESS_KEY_ID_ENV = 'STORAGE_ACCESS_KEY_ID';
const STORAGE_SECRET_ACCESS_KEY_ENV = 'STORAGE_SECRET_ACCESS_KEY';
const GARAGE_DEFAULT_ACCESS_KEY_ENV = 'GARAGE_DEFAULT_ACCESS_KEY';
const GARAGE_DEFAULT_SECRET_KEY_ENV = 'GARAGE_DEFAULT_SECRET_KEY';

export interface S3AttachmentStorageOptions {
  readonly bucket: string;
  readonly endpoint?: string;
  readonly client?: S3Client;
}

// mirrors filesystem assertSafeKey — keep in sync
function assertSafeKey(key: string): void {
  if (key.trim().length === 0) {
    throw new Error('Invalid attachment key: key must not be empty.');
  }
  if (path.isAbsolute(key)) {
    throw new Error(`Invalid attachment key "${key}": absolute paths are not allowed.`);
  }
  const normalized = path.posix.normalize(key.split(path.sep).join('/'));
  if (normalized === '.' || normalized === '..' || normalized === '' || normalized.startsWith('../')) {
    throw new Error(`Invalid attachment key "${key}": path traversal is not allowed.`);
  }
}

// Empty strings fall through to the fallback, so `STORAGE_ENDPOINT=` (and
// friends) behave like unset — same rule as `resolveStorageDir`.
function envValue(name: string): string | undefined {
  const raw = process.env[name];
  if (raw === undefined) {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

function resolveEndpoint(explicit?: string): string {
  const trimmed = explicit?.trim();
  const value = trimmed !== undefined && trimmed.length > 0 ? trimmed : envValue(STORAGE_ENDPOINT_ENV);
  if (value === undefined) {
    throw new Error('Missing STORAGE_ENDPOINT: set STORAGE_ENDPOINT to use the "s3" storage adapter.');
  }
  return value;
}

export function resolveS3Region(explicit?: string): string {
  const trimmed = explicit?.trim();
  if (trimmed !== undefined && trimmed.length > 0) {
    return trimmed;
  }
  return envValue(STORAGE_REGION_ENV) ?? DEFAULT_S3_REGION;
}

export interface S3ClientConfigInput {
  readonly endpoint: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly region?: string | undefined;
}

export function buildS3ClientConfig(input: S3ClientConfigInput): S3ClientConfig {
  return {
    endpoint: input.endpoint,
    region: resolveS3Region(input.region),
    credentials: { accessKeyId: input.accessKeyId, secretAccessKey: input.secretAccessKey },
    forcePathStyle: true,
    // S3-compatible stores (R2, Garage): only send/verify flexible checksums
    // when the operation requires them (AWS SDK v3 >= 3.729 defaults to always).
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  };
}

// Messages name the missing key only — the secret value is never printed.
function resolveCredentials(): { accessKeyId: string; secretAccessKey: string } {
  const accessKeyId = envValue(STORAGE_ACCESS_KEY_ID_ENV) ?? envValue(GARAGE_DEFAULT_ACCESS_KEY_ENV);
  if (accessKeyId === undefined) {
    throw new Error(
      'Missing STORAGE_ACCESS_KEY_ID: set STORAGE_ACCESS_KEY_ID (or GARAGE_DEFAULT_ACCESS_KEY) to use the "s3" storage adapter.',
    );
  }
  const secretAccessKey = envValue(STORAGE_SECRET_ACCESS_KEY_ENV) ?? envValue(GARAGE_DEFAULT_SECRET_KEY_ENV);
  if (secretAccessKey === undefined) {
    throw new Error(
      'Missing STORAGE_SECRET_ACCESS_KEY: set STORAGE_SECRET_ACCESS_KEY (or GARAGE_DEFAULT_SECRET_KEY) to use the "s3" storage adapter.',
    );
  }
  return { accessKeyId, secretAccessKey };
}

function isNotFoundError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const record = error as { name?: unknown; $metadata?: unknown };
  if (record.name === 'NoSuchKey' || record.name === 'NotFound') {
    return true;
  }
  const metadata = record.$metadata;
  return (
    typeof metadata === 'object' &&
    metadata !== null &&
    (metadata as { httpStatusCode?: unknown }).httpStatusCode === 404
  );
}

async function readBody(body: unknown): Promise<Uint8Array> {
  if (body === undefined || body === null) {
    throw new Error('S3 get returned an empty body.');
  }
  if (body instanceof Uint8Array) {
    return body;
  }
  const candidate = body as { transformToByteArray?: unknown };
  if (typeof candidate.transformToByteArray === 'function') {
    return (candidate.transformToByteArray as () => Promise<Uint8Array>)();
  }
  // Async-iterable (Node readable) fallback.
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of body as AsyncIterable<Uint8Array | string>) {
    const part = typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk;
    chunks.push(part);
    total += part.byteLength;
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of chunks) {
    out.set(part, offset);
    offset += part.byteLength;
  }
  return out;
}

export class S3AttachmentStorage implements AttachmentStorage {
  private readonly bucket: string;
  private readonly endpoint: string | undefined;
  private readonly client: S3Client;

  constructor(options: S3AttachmentStorageOptions) {
    if (options.bucket.trim().length === 0) {
      throw new Error('Missing STORAGE_BUCKET: bucket must not be empty.');
    }
    this.bucket = options.bucket;
    if (options.client !== undefined) {
      this.client = options.client;
      this.endpoint = options.endpoint;
      return;
    }
    const endpoint = resolveEndpoint(options.endpoint);
    const { accessKeyId, secretAccessKey } = resolveCredentials();
    this.endpoint = endpoint;
    this.client = new S3Client(buildS3ClientConfig({ endpoint, accessKeyId, secretAccessKey }));
  }

  get bucketName(): string {
    return this.bucket;
  }

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<AttachmentPutResult> {
    assertSafeKey(key);
    if (contentType.trim().length === 0) {
      throw new Error('Invalid content type: contentType must not be empty.');
    }
    // Private bucket: no ACL/grant headers, ever.
    await this.client.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: bytes, ContentType: contentType }),
    );
    return {
      key,
      size: bytes.byteLength,
      checksum: createHash('sha256').update(bytes).digest('hex'),
    };
  }

  async get(key: string): Promise<AttachmentData | null> {
    assertSafeKey(key);
    try {
      const output = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      return {
        bytes: await readBody(output.Body),
        contentType: output.ContentType ?? FALLBACK_CONTENT_TYPE,
      };
    } catch (error: unknown) {
      if (isNotFoundError(error)) {
        return null;
      }
      throw error;
    }
  }

  async remove(key: string): Promise<void> {
    assertSafeKey(key);
    // S3 deletes are idempotent: missing keys succeed.
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
