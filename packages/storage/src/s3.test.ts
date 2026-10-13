// S3 adapter + storage factory tests (Phase 4, task P4-2).
//
// Groups: (a) factory permutations, (b) key guard without network,
// (c) put/get/remove against an injected mock S3Client, (d) live Garage
// round-trip gated on STORAGE_ENDPOINT reachability (skipped clearly when
// Garage is down — no server runs in this sandbox).
import { createHash, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { processImage } from './attachments.js';
import { createAttachmentStorage, resolveStorageAdapter } from './factory.js';
import { FilesystemAttachmentStorage } from './filesystem.js';
import { S3AttachmentStorage } from './s3.js';

const ENV_KEYS = [
  'STORAGE_ADAPTER',
  'STORAGE_ENDPOINT',
  'STORAGE_BUCKET',
  'STORAGE_ACCESS_KEY_ID',
  'STORAGE_SECRET_ACCESS_KEY',
  'GARAGE_DEFAULT_ACCESS_KEY',
  'GARAGE_DEFAULT_SECRET_KEY',
] as const;

let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = savedEnv[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

// Hand-rolled S3 double: records commands, never touches the network.
function stubS3Client(send: (command: unknown) => Promise<unknown>): S3Client {
  return { send: send as S3Client['send'] } as S3Client;
}

function throwingStubS3Client(): { client: S3Client; calls: () => number } {
  let calls = 0;
  const client = stubS3Client(async () => {
    calls += 1;
    throw new Error('network must not be touched by key-guard tests');
  });
  return { client, calls: () => calls };
}

describe('storage factory', () => {
  it('defaults to the filesystem adapter when STORAGE_ADAPTER is unset', () => {
    expect(resolveStorageAdapter()).toBe('filesystem');
    expect(createAttachmentStorage()).toBeInstanceOf(FilesystemAttachmentStorage);
  });

  it('treats an empty STORAGE_ADAPTER as the default', () => {
    process.env.STORAGE_ADAPTER = '   ';
    expect(resolveStorageAdapter()).toBe('filesystem');
    expect(createAttachmentStorage()).toBeInstanceOf(FilesystemAttachmentStorage);
  });

  it('explicit adapter wins over env', () => {
    process.env.STORAGE_ADAPTER = 'filesystem';
    process.env.STORAGE_ENDPOINT = 'http://localhost:3900';
    process.env.STORAGE_ACCESS_KEY_ID = 'id';
    process.env.STORAGE_SECRET_ACCESS_KEY = 'secret';
    const { client } = throwingStubS3Client();
    expect(createAttachmentStorage({ adapter: 's3', client })).toBeInstanceOf(S3AttachmentStorage);
  });

  it('throws naming STORAGE_ENDPOINT when s3 is selected without an endpoint', () => {
    process.env.STORAGE_ADAPTER = 's3';
    expect(() => createAttachmentStorage()).toThrow(
      'Missing STORAGE_ENDPOINT: set STORAGE_ENDPOINT to use the "s3" storage adapter.',
    );
  });

  it('throws naming the missing credential key, never the secret value', () => {
    process.env.STORAGE_ADAPTER = 's3';
    process.env.STORAGE_ENDPOINT = 'http://localhost:3900';
    process.env.STORAGE_ACCESS_KEY_ID = 'sentinel-id';
    process.env.STORAGE_SECRET_ACCESS_KEY = 'sentinel-secret-value';
    delete process.env.STORAGE_ACCESS_KEY_ID;
    delete process.env.STORAGE_SECRET_ACCESS_KEY;
    try {
      createAttachmentStorage();
      expect.unreachable('expected missing STORAGE_ACCESS_KEY_ID to throw');
    } catch (error) {
      expect(String(error)).toBe(
        'Error: Missing STORAGE_ACCESS_KEY_ID: set STORAGE_ACCESS_KEY_ID (or GARAGE_DEFAULT_ACCESS_KEY) to use the "s3" storage adapter.',
      );
      expect(String(error)).not.toContain('sentinel');
    }
    process.env.STORAGE_ACCESS_KEY_ID = 'sentinel-id';
    try {
      createAttachmentStorage();
      expect.unreachable('expected missing STORAGE_SECRET_ACCESS_KEY to throw');
    } catch (error) {
      expect(String(error)).toBe(
        'Error: Missing STORAGE_SECRET_ACCESS_KEY: set STORAGE_SECRET_ACCESS_KEY (or GARAGE_DEFAULT_SECRET_KEY) to use the "s3" storage adapter.',
      );
      expect(String(error)).not.toContain('sentinel');
    }
  });

  it('falls back to GARAGE_DEFAULT_* credentials', () => {
    process.env.STORAGE_ADAPTER = 's3';
    process.env.STORAGE_ENDPOINT = 'http://localhost:3900';
    process.env.GARAGE_DEFAULT_ACCESS_KEY = 'id';
    process.env.GARAGE_DEFAULT_SECRET_KEY = 'secret';
    // Constructing the real S3Client performs no I/O.
    expect(createAttachmentStorage()).toBeInstanceOf(S3AttachmentStorage);
  });

  it('throws Unknown STORAGE_ADAPTER listing the value received', () => {
    process.env.STORAGE_ADAPTER = 'minio';
    expect(() => resolveStorageAdapter()).toThrow('Unknown STORAGE_ADAPTER "minio": expected "filesystem" or "s3".');
    expect(() => createAttachmentStorage()).toThrow('Unknown STORAGE_ADAPTER "minio": expected "filesystem" or "s3".');
  });

  it('explicit unknown adapter throws', () => {
    expect(() => createAttachmentStorage({ adapter: 'bogus' as unknown as 's3' })).toThrow(
      'Unknown STORAGE_ADAPTER "bogus": expected "filesystem" or "s3".',
    );
  });
});

describe('S3AttachmentStorage key guard (no network)', () => {
  it('rejects unsafe keys on put/get/remove before touching the network', async () => {
    const { client, calls } = throwingStubS3Client();
    const storage = new S3AttachmentStorage({ bucket: 'silapor', client });
    const bytes = new TextEncoder().encode('x');
    for (const bad of ['../x', '..', '/abs/x', '', '   ']) {
      await expect(storage.put(bad, bytes, 'image/png')).rejects.toThrow(/Invalid attachment key/);
      await expect(storage.get(bad)).rejects.toThrow(/Invalid attachment key/);
      await expect(storage.remove(bad)).rejects.toThrow(/Invalid attachment key/);
    }
    expect(calls()).toBe(0);
  });

  it('rejects an empty bucket at construction', () => {
    const { client } = throwingStubS3Client();
    expect(() => new S3AttachmentStorage({ bucket: '   ', client })).toThrow(/STORAGE_BUCKET/);
  });
});

describe('S3AttachmentStorage with injected mock client', () => {
  it('put sends PutObjectCommand with private defaults and returns sha256', async () => {
    const bytes = new TextEncoder().encode('processed-bytes');
    const commands: unknown[] = [];
    const client = stubS3Client(async (command: unknown) => {
      commands.push(command);
      return {};
    });
    const storage = new S3AttachmentStorage({ bucket: 'silapor', client });

    const result = await storage.put('att_123', bytes, 'image/png');

    expect(result).toEqual({
      key: 'att_123',
      size: bytes.byteLength,
      checksum: createHash('sha256').update(bytes).digest('hex'),
    });
    expect(commands).toHaveLength(1);
    expect(commands[0]).toBeInstanceOf(PutObjectCommand);
    const input = (commands[0] as PutObjectCommand).input;
    expect(Object.keys(input).sort()).toEqual(['Body', 'Bucket', 'ContentType', 'Key']);
    expect(input).toMatchObject({ Bucket: 'silapor', Key: 'att_123', ContentType: 'image/png' });
    expect(input.Body).toEqual(bytes);
  });

  it('put rejects an empty content type without network', async () => {
    const { client, calls } = throwingStubS3Client();
    const storage = new S3AttachmentStorage({ bucket: 'silapor', client });
    await expect(storage.put('att_123', new TextEncoder().encode('x'), '  ')).rejects.toThrow(/contentType/);
    expect(calls()).toBe(0);
  });

  it('get returns bytes with content-type passthrough', async () => {
    const bytes = new TextEncoder().encode('image-bytes');
    const client = stubS3Client(async (command: unknown) => {
      expect(command).toBeInstanceOf(GetObjectCommand);
      expect((command as GetObjectCommand).input).toEqual({ Bucket: 'silapor', Key: 'att_123' });
      return { Body: { transformToByteArray: async () => bytes }, ContentType: 'image/png' };
    });
    const storage = new S3AttachmentStorage({ bucket: 'silapor', client });

    const got = await storage.get('att_123');

    expect(got?.contentType).toBe('image/png');
    expect(got?.bytes).toEqual(bytes);
  });

  it('get maps NoSuchKey to null', async () => {
    const client = stubS3Client(async () => {
      throw Object.assign(new Error('not found'), { name: 'NoSuchKey' });
    });
    const storage = new S3AttachmentStorage({ bucket: 'silapor', client });
    await expect(storage.get('missing')).resolves.toBeNull();
  });

  it('get maps 404 metadata to null', async () => {
    const client = stubS3Client(async () => {
      throw Object.assign(new Error('not found'), { $metadata: { httpStatusCode: 404 } });
    });
    const storage = new S3AttachmentStorage({ bucket: 'silapor', client });
    await expect(storage.get('missing')).resolves.toBeNull();
  });

  it('remove sends DeleteObjectCommand and treats missing as success', async () => {
    const commands: unknown[] = [];
    const client = stubS3Client(async (command: unknown) => {
      commands.push(command);
      return {};
    });
    const storage = new S3AttachmentStorage({ bucket: 'silapor', client });

    await storage.remove('att_123');

    expect(commands).toHaveLength(1);
    expect(commands[0]).toBeInstanceOf(DeleteObjectCommand);
    expect((commands[0] as DeleteObjectCommand).input).toEqual({ Bucket: 'silapor', Key: 'att_123' });
  });
});

describe('S3AttachmentStorage live Garage round-trip', () => {
  // Captured at import time (before the env-wiping beforeEach above runs).
  const liveEndpoint = (process.env.STORAGE_ENDPOINT ?? '').trim();
  const liveBucket = (process.env.STORAGE_BUCKET ?? '').trim() || 'silapor';
  // Dev-only defaults mirroring .env.example (Garage single-node auto-setup).
  // Never real credentials: used only for the gated live round-trip.
  const devAccessKeyId =
    (process.env.STORAGE_ACCESS_KEY_ID ?? '').trim() ||
    (process.env.GARAGE_DEFAULT_ACCESS_KEY ?? '').trim() ||
    'GKaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const devSecretAccessKey =
    (process.env.STORAGE_SECRET_ACCESS_KEY ?? '').trim() ||
    (process.env.GARAGE_DEFAULT_SECRET_KEY ?? '').trim() ||
    'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';

  it.skipIf(liveEndpoint.length === 0)('put/get/remove round-trips processed bytes in Garage', async (ctx) => {
    // Reachability probe: any HTTP response (even 4xx) means Garage is up;
    // only a network failure skips. No server runs in the sandbox.
    try {
      await fetch(liveEndpoint, { signal: AbortSignal.timeout(2000) });
    } catch {
      ctx.skip();
      return;
    }
    const created = await sharp({
      create: { width: 2, height: 2, channels: 3, background: { r: 0, g: 128, b: 255 } },
    })
      .png()
      .toBuffer();
    const processed = await processImage(new Uint8Array(created));
    const storage = createAttachmentStorage({
      adapter: 's3',
      endpoint: liveEndpoint,
      bucket: liveBucket,
      accessKeyId: devAccessKeyId,
      secretAccessKey: devSecretAccessKey,
    });

    const key = `e2e_${randomUUID()}`;
    const put = await storage.put(key, processed.bytes, processed.mimeType);
    expect(put.key).toBe(key);
    const got = await storage.get(key);
    expect(got?.contentType).toBe(processed.mimeType);
    expect(Buffer.from(got?.bytes ?? []).equals(Buffer.from(processed.bytes))).toBe(true);
    await storage.remove(key);
    await expect(storage.get(key)).resolves.toBeNull();
  });
});
