// Staging service tests (photo-first flow). Unit tests with MOCK storage
// (put/remove spies) plus mocked auth and database repo fns — no DB, no
// network, fully offline. The real P4-1 chain (`validateAttachment` /
// `processImage`) and `generateAttachmentKey` run unmocked, so the
// validation chain is proven end to end up to the storage seam. Every
// reject asserts exact status + code/message.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./auth.js', () => ({ requireUser: vi.fn() }));

vi.mock('@silapor/database', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@silapor/database')>();
  return {
    ...actual,
    getDb: vi.fn(),
    recordStagedUpload: vi.fn(),
    deleteStagedUploads: vi.fn(),
    getStagedUploadsByKeys: vi.fn(),
  };
});

import { requireUser } from './auth.js';
import {
  deleteStagedUploads,
  getDb,
  getStagedUploadsByKeys,
  recordStagedUpload,
} from '@silapor/database';
import { toHttpResponse } from '@silapor/shared';
import type { AttachmentStorage } from '@silapor/storage';
import {
  removeStagedObjects,
  resolveStagedPhotoKeys,
  stageUploads,
  type StagingUploadFile,
} from './uploads.js';

const requireUserMock = vi.mocked(requireUser);
const getDbMock = vi.mocked(getDb);
const recordStagedUploadMock = vi.mocked(recordStagedUpload);
const deleteStagedUploadsMock = vi.mocked(deleteStagedUploads);
const getStagedUploadsByKeysMock = vi.mocked(getStagedUploadsByKeys);

const requireUserFake = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  username: 'reporter',
  role: 'REPORTER',
} as const;

const FAKE_DB = { marker: 'fake-db' } as never;
const fakeClose = vi.fn(async () => undefined);

// 8x8 PNG generated once via sharp (mirrors attachments.test.ts) —
// embedded so this suite needs no image encoder.
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVR4nGOQqziBFTEMLQkABkZXgRDDjAEAAAAASUVORK5CYII=';
const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function pngFile(name = 'photo.png'): StagingUploadFile {
  return {
    bytes: new Uint8Array(Buffer.from(PNG_B64, 'base64')),
    declaredMime: 'image/png',
    originalFilename: name,
  };
}

function mockStorage(): AttachmentStorage & {
  put: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
} {
  return {
    put: vi.fn(async () => ({ key: 'stored', size: 10, checksum: 'mock' })),
    get: vi.fn(async () => null),
    remove: vi.fn(async () => undefined),
  } as unknown as AttachmentStorage & {
    put: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  };
}

function setupReporter(): void {
  requireUserMock.mockResolvedValue({ ...requireUserFake });
  getDbMock.mockReturnValue({ db: FAKE_DB, close: fakeClose } as never);
}

async function expectReject(
  promise: Promise<unknown>,
  status: number,
  code: string,
): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const mapped = toHttpResponse(error);
    expect(mapped.status).toBe(status);
    expect(mapped.body.error.code).toBe(code);
    return mapped.body.error.message as string;
  }
  throw new Error('expected rejection');
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('stageUploads', () => {
  it('stages valid photos and returns unguessable staging keys', async () => {
    setupReporter();
    const storage = mockStorage();
    const result = await stageUploads(new Request('http://localhost/x'), [pngFile(), pngFile('b.png')], storage);
    expect(result.keys).toHaveLength(2);
    for (const key of result.keys) {
      expect(key.startsWith('staging_')).toBe(true);
    }
    expect(storage.put).toHaveBeenCalledTimes(2);
    expect(recordStagedUploadMock).toHaveBeenCalledTimes(2);
    const firstCall = recordStagedUploadMock.mock.calls[0]?.[1];
    expect(firstCall).toMatchObject({
      uploadedBy: requireUserFake.id,
      originalFilename: 'photo.png',
      mimeType: 'image/png',
    });
    expect(typeof firstCall?.checksum).toBe('string');
  });

  it('rejects empty input and more than 3 files', async () => {
    setupReporter();
    const storage = mockStorage();
    await expectReject(stageUploads(new Request('http://localhost/x'), [], storage), 400, 'BAD_REQUEST');
    await expectReject(
      stageUploads(
        new Request('http://localhost/x'),
        [pngFile('a.png'), pngFile('b.png'), pngFile('c.png'), pngFile('d.png')],
        storage,
      ),
      400,
      'TOO_MANY_FILES',
    );
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('rejects oversize, wrong-type, and corrupt files without storing', async () => {
    setupReporter();
    const storage = mockStorage();
    const big = { bytes: new Uint8Array(5_242_881), declaredMime: 'image/png', originalFilename: 'big.png' };
    await expectReject(stageUploads(new Request('http://localhost/x'), [big], storage), 413, 'FILE_TOO_LARGE');
    const svg = { bytes: new Uint8Array([1, 2, 3]), declaredMime: 'image/svg+xml', originalFilename: 'x.svg' };
    await expectReject(stageUploads(new Request('http://localhost/x'), [svg], storage), 400, 'UNSUPPORTED_TYPE');
    const garbage = {
      bytes: new Uint8Array([...PNG_SIG, ...new Array(200).fill(0)]),
      declaredMime: 'image/png',
      originalFilename: 'garbage.png',
    };
    await expectReject(stageUploads(new Request('http://localhost/x'), [garbage], storage), 400, 'CORRUPT_IMAGE');
    expect(storage.put).not.toHaveBeenCalled();
    expect(recordStagedUploadMock).not.toHaveBeenCalled();
  });

  it('stores nothing when a later file fails validation', async () => {
    setupReporter();
    const storage = mockStorage();
    const svg = { bytes: new Uint8Array([1, 2, 3]), declaredMime: 'image/svg+xml', originalFilename: 'x.svg' };
    await expectReject(
      stageUploads(new Request('http://localhost/x'), [pngFile(), svg], storage),
      400,
      'UNSUPPORTED_TYPE',
    );
    expect(storage.put).not.toHaveBeenCalled();
    expect(recordStagedUploadMock).not.toHaveBeenCalled();
  });

  it('removes stored objects when a later put fails', async () => {
    setupReporter();
    const storage = mockStorage();
    storage.put
      .mockResolvedValueOnce({ key: 'first', size: 10, checksum: 'mock' })
      .mockRejectedValueOnce(new Error('storage down'));
    await expect(stageUploads(new Request('http://localhost/x'), [pngFile(), pngFile('b.png')], storage)).rejects.toThrow(
      'storage down',
    );
    expect(storage.remove).toHaveBeenCalledTimes(1);
    expect(recordStagedUploadMock).not.toHaveBeenCalled();
  });

  it('removes stored objects and recorded rows when row insert fails', async () => {
    setupReporter();
    const storage = mockStorage();
    recordStagedUploadMock.mockRejectedValueOnce(new Error('db down'));
    deleteStagedUploadsMock.mockResolvedValue(1);
    await expect(
      stageUploads(new Request('http://localhost/x'), [pngFile(), pngFile('b.png')], storage),
    ).rejects.toThrow('db down');
    expect(storage.put).toHaveBeenCalledTimes(2);
    expect(storage.remove).toHaveBeenCalledTimes(2);
    expect(deleteStagedUploadsMock).toHaveBeenCalledTimes(1);
  });
});

describe('resolveStagedPhotoKeys', () => {
  const FRESH = new Date('2026-10-15T12:00:00Z');
  const NOW = new Date('2026-10-15T12:05:00Z');

  function stagedRow(key: string, overrides: Record<string, unknown> = {}) {
    return {
      id: 'row-id',
      storageKey: key,
      uploadedBy: requireUserFake.id,
      originalFilename: 'photo.png',
      mimeType: 'image/png',
      sizeBytes: 100,
      checksum: 'abc',
      claimedReportId: null,
      createdAt: FRESH,
      ...overrides,
    };
  }

  it('resolves owned unclaimed fresh keys to metadata', async () => {
    getStagedUploadsByKeysMock.mockResolvedValue([stagedRow('staging_k1'), stagedRow('staging_k2')]);
    const resolved = await resolveStagedPhotoKeys(FAKE_DB as never, requireUserFake.id, [
      'staging_k1',
      'staging_k2',
    ], { now: NOW });
    expect(resolved.map((row) => row.storageKey)).toEqual(['staging_k1', 'staging_k2']);
    expect(resolved[0]).toMatchObject({ originalFilename: 'photo.png', mimeType: 'image/png' });
  });

  it('rejects missing, foreign, claimed, and expired keys uniformly', async () => {
    getStagedUploadsByKeysMock.mockResolvedValue([stagedRow('staging_k1')]);
    await expectReject(
      resolveStagedPhotoKeys(FAKE_DB as never, requireUserFake.id, ['staging_k1', 'staging_k2'], { now: NOW }),
      400,
      'BAD_REQUEST',
    );
    getStagedUploadsByKeysMock.mockResolvedValue([stagedRow('staging_k1', { uploadedBy: 'other-user' })]);
    await expectReject(
      resolveStagedPhotoKeys(FAKE_DB as never, requireUserFake.id, ['staging_k1'], { now: NOW }),
      400,
      'BAD_REQUEST',
    );
    getStagedUploadsByKeysMock.mockResolvedValue([stagedRow('staging_k1', { claimedReportId: 'report-id' })]);
    await expectReject(
      resolveStagedPhotoKeys(FAKE_DB as never, requireUserFake.id, ['staging_k1'], { now: NOW }),
      400,
      'BAD_REQUEST',
    );
    getStagedUploadsByKeysMock.mockResolvedValue([
      stagedRow('staging_k1', { createdAt: new Date('2000-01-01T00:00:00Z') }),
    ]);
    await expectReject(
      resolveStagedPhotoKeys(FAKE_DB as never, requireUserFake.id, ['staging_k1'], { now: NOW, ttlMs: 1000 }),
      400,
      'BAD_REQUEST',
    );
    await expectReject(
      resolveStagedPhotoKeys(FAKE_DB as never, requireUserFake.id, ['not-a-staging-key'], { now: NOW }),
      400,
      'BAD_REQUEST',
    );
  });
});

describe('removeStagedObjects', () => {
  it('never throws, even when removal fails', async () => {
    const storage = mockStorage();
    storage.remove.mockRejectedValueOnce(new Error('gone'));
    await expect(removeStagedObjects(storage, ['staging_k1'])).resolves.toBeUndefined();
  });
});
