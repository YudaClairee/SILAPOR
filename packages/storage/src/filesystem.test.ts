import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FilesystemAttachmentStorage } from './filesystem.js';

describe('FilesystemAttachmentStorage', () => {
  let dir: string;
  let storage: FilesystemAttachmentStorage;

  beforeEach(async () => {
    // Never touch the repo .data dir: every test gets a fresh /tmp sandbox.
    dir = await mkdtemp(path.join(tmpdir(), 'silapor-storage-'));
    storage = new FilesystemAttachmentStorage(dir);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('put/get/remove round-trips bytes and content type', async () => {
    const bytes = new TextEncoder().encode('hello-silapor');
    const put = await storage.put('reports/r1/photo.png', bytes, 'image/png');
    expect(put.key).toBe('reports/r1/photo.png');
    expect(put.size).toBe(bytes.byteLength);
    expect(put.checksum).toMatch(/^[0-9a-f]{64}$/);

    const got = await storage.get('reports/r1/photo.png');
    expect(got?.contentType).toBe('image/png');
    expect(got?.bytes).toEqual(Buffer.from(bytes));

    await storage.remove('reports/r1/photo.png');
    expect(await storage.get('reports/r1/photo.png')).toBeNull();
  });

  it('get of a missing key returns null', async () => {
    expect(await storage.get('does/not-exist.png')).toBeNull();
  });

  it('rejects path traversal, absolute paths, and empty keys', async () => {
    const bytes = new TextEncoder().encode('x');
    await expect(storage.put('../evil.png', bytes, 'image/png')).rejects.toThrow();
    await expect(storage.put('..', bytes, 'image/png')).rejects.toThrow();
    await expect(storage.put('/abs/evil.png', bytes, 'image/png')).rejects.toThrow();
    await expect(storage.put('   ', bytes, 'image/png')).rejects.toThrow();
    await expect(storage.get('../evil.png')).rejects.toThrow();
    await expect(storage.remove('/abs/evil.png')).rejects.toThrow();
  });
});
