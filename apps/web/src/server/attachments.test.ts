// P4-3 attachment service tests (Phase 4 secure upload). Unit tests with
// MOCK storage (put/get/remove spies) plus mocked auth, ref resolution, and
// database repo fns — no DB, no network, fully offline. The real P4-1 chain
// (`validateAttachment`/`processImage`) and `generateAttachmentKey` run
// unmocked, so the validation chain is proven end-to-end up to the storage
// seam. Every reject asserts exact status + code/message.
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./auth.js', () => ({ requireUser: vi.fn() }));

vi.mock('./reports.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./reports.js')>();
  return { ...actual, resolveReportId: vi.fn() };
});

vi.mock('@silapor/database', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@silapor/database')>();
  return {
    ...actual,
    getDb: vi.fn(),
    createAttachments: vi.fn(),
    getAttachmentById: vi.fn(),
    countAttachments: vi.fn(),
    getReportHeader: vi.fn(),
  };
});

import { requireUser } from './auth.js';
import { resolveReportId } from './reports.js';
import {
  countAttachments,
  createAttachments,
  getAttachmentById,
  getDb,
  getReportHeader,
} from '@silapor/database';
import { toHttpResponse, unauthorized } from '@silapor/shared';
import type { AttachmentStorage } from '@silapor/storage';
import {
  downloadAttachment,
  toAttachmentResponse,
  uploadAttachments,
  type AttachmentUploadFile,
} from './attachments.js';

const requireUserMock = vi.mocked(requireUser);
const resolveReportIdMock = vi.mocked(resolveReportId);
const getDbMock = vi.mocked(getDb);
const createAttachmentsMock = vi.mocked(createAttachments);
const getAttachmentByIdMock = vi.mocked(getAttachmentById);
const countAttachmentsMock = vi.mocked(countAttachments);
const getReportHeaderMock = vi.mocked(getReportHeader);

const FAKE_DB = { marker: 'fake-db' } as never;
const fakeClose = vi.fn();

const REPORTER = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', username: 'reporter', role: 'REPORTER' } as const;
const OTHER_REPORTER_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ADMIN = { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', username: 'admin', role: 'ADMIN' } as const;
const REPORT_ID = '11111111-1111-4111-8111-111111111111';
const ATTACHMENT_ID = '22222222-2222-4222-8222-222222222222';

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
// 8x8 PNG generated once via sharp (packages/storage dev) — embedded so
// this suite needs no image encoder.
const PNG_B64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVR4nGOQqziBFTEMLQkABkZXgRDDjAEAAAAASUVORK5CYII=';
// 8x8 JPEG generated once via sharp.
const JPEG_B64 =
  '/9j/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAAIAAgDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAABgf/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCAAHlhf//Z';

const MAX_BYTES = 5_242_880;

function pngFile(name = 'photo.png'): AttachmentUploadFile {
  return {
    bytes: new Uint8Array(Buffer.from(PNG_B64, 'base64')),
    declaredMime: 'image/png',
    originalFilename: name,
  };
}

function jpegFile(): AttachmentUploadFile {
  return {
    bytes: new Uint8Array(Buffer.from(JPEG_B64, 'base64')),
    declaredMime: 'image/jpeg',
    originalFilename: 'shot.jpg',
  };
}

function mockStorage(): AttachmentStorage & {
  put: ReturnType<typeof vi.fn>;
  get: ReturnType<typeof vi.fn>;
  remove: ReturnType<typeof vi.fn>;
} {
  return {
    put: vi.fn(async (key: string, bytes: Uint8Array) => ({
      key,
      size: bytes.byteLength,
      checksum: 'mock-checksum',
    })),
    get: vi.fn(async () => null),
    remove: vi.fn(async () => undefined),
  } as unknown as AttachmentStorage & {
    put: ReturnType<typeof vi.fn>;
    get: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  };
}

function ownReportHeader(status = 'REPORTED'): {
  readonly id: string;
  readonly reporterId: string;
  readonly status: string;
} {
  return { id: REPORT_ID, reporterId: REPORTER.id, status };
}

function setupReporterOwnReport(status = 'REPORTED', existingCount = 0): void {
  requireUserMock.mockResolvedValue({ ...REPORTER });
  resolveReportIdMock.mockResolvedValue(REPORT_ID);
  getDbMock.mockReturnValue({ db: FAKE_DB, close: fakeClose } as never);
  getReportHeaderMock.mockResolvedValue(ownReportHeader(status));
  countAttachmentsMock.mockResolvedValue(existingCount);
}

async function expectReject(
  promise: Promise<unknown>,
  status: number,
  code: string,
): Promise<{ readonly message: string; readonly body: unknown }> {
  let caught: unknown;
  try {
    await promise;
  } catch (error) {
    caught = error;
  }
  expect(caught, 'expected the service call to reject').toBeDefined();
  const mapped = toHttpResponse(caught);
  expect(mapped.status).toBe(status);
  expect(mapped.body.error.code).toBe(code);
  return { message: mapped.body.error.message, body: mapped.body };
}

beforeEach(() => {
  vi.resetAllMocks();
  fakeClose.mockResolvedValue(undefined);
});

describe('upload auth + ownership', () => {
  it('rejects anonymous uploads with 401', async () => {
    requireUserMock.mockRejectedValue(unauthorized('Belum login'));
    const storage = mockStorage();
    const rejected = await expectReject(
      uploadAttachments(new Request('http://localhost/api/reports/x/attachments'), 'x', [pngFile()], storage),
      401,
      'UNAUTHORIZED',
    );
    expect(rejected.message).toBe('Belum login');
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('rejects a reporter uploading to a foreign report with byte-identical 404 bodies', async () => {
    setupReporterOwnReport();
    const storage = mockStorage();
    getReportHeaderMock.mockResolvedValue({ id: REPORT_ID, reporterId: OTHER_REPORTER_ID, status: 'REPORTED' });

    const foreign = await expectReject(
      uploadAttachments(new Request('http://localhost/api/reports/foreign/attachments'), 'foreign', [pngFile()], storage),
      404,
      'NOT_FOUND',
    );

    getReportHeaderMock.mockResolvedValue(null);
    const missing = await expectReject(
      uploadAttachments(new Request('http://localhost/api/reports/missing/attachments'), 'missing', [pngFile()], storage),
      404,
      'NOT_FOUND',
    );

    expect(foreign.message).toBe('Report not found');
    expect(JSON.stringify(foreign.body)).toBe(JSON.stringify(missing.body));
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('scopes ticket resolution to the reporter but not to admins', async () => {
    setupReporterOwnReport();
    const storage = mockStorage();
    createAttachmentsMock.mockResolvedValue([
      {
        id: ATTACHMENT_ID,
        originalFilename: 'photo.png',
        mimeType: 'image/png',
        sizeBytes: 95,
        checksum: 'c'.repeat(64),
        createdAt: new Date('2026-10-13T00:00:00.000Z'),
      },
    ]);
    await uploadAttachments(new Request('http://localhost/x'), 'MNT-2026-000001', [pngFile()], storage);
    expect(resolveReportIdMock).toHaveBeenCalledWith(FAKE_DB, REPORTER.id, 'MNT-2026-000001');

    vi.resetAllMocks();
    fakeClose.mockResolvedValue(undefined);
    requireUserMock.mockResolvedValue({ ...ADMIN });
    resolveReportIdMock.mockResolvedValue(REPORT_ID);
    getDbMock.mockReturnValue({ db: FAKE_DB, close: fakeClose } as never);
    getReportHeaderMock.mockResolvedValue({ id: REPORT_ID, reporterId: OTHER_REPORTER_ID, status: 'CLOSED' });
    countAttachmentsMock.mockResolvedValue(0);
    createAttachmentsMock.mockResolvedValue([]);
    await uploadAttachments(new Request('http://localhost/x'), 'MNT-2026-000001', [pngFile()], mockStorage());
    expect(resolveReportIdMock).toHaveBeenCalledWith(FAKE_DB, null, 'MNT-2026-000001');
  });
});

describe('upload validation chain (fail-closed)', () => {
  it('rejects an empty file list with 400', async () => {
    setupReporterOwnReport();
    const rejected = await expectReject(
      uploadAttachments(new Request('http://localhost/x'), 'ref', [], mockStorage()),
      400,
      'BAD_REQUEST',
    );
    expect(rejected.message).toBe('At least one file is required.');
  });

  it('rejects oversize bytes with 413 FILE_TOO_LARGE before any processing', async () => {
    setupReporterOwnReport();
    const storage = mockStorage();
    const oversize = Buffer.alloc(MAX_BYTES + 1);
    PNG_SIG.forEach((byte, index) => {
      oversize[index] = byte;
    });
    const rejected = await expectReject(
      uploadAttachments(
        new Request('http://localhost/x'),
        'ref',
        [{ bytes: new Uint8Array(oversize), declaredMime: 'image/png', originalFilename: 'big.png' }],
        storage,
      ),
      413,
      'FILE_TOO_LARGE',
    );
    expect(rejected.message).toBe('Attachment exceeds the maximum allowed size.');
    expect(storage.put).not.toHaveBeenCalled();
    expect(createAttachmentsMock).not.toHaveBeenCalled();
  });

  it('rejects SVG content with 400 UNSUPPORTED_TYPE', async () => {
    setupReporterOwnReport();
    const storage = mockStorage();
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    const rejected = await expectReject(
      uploadAttachments(
        new Request('http://localhost/x'),
        'ref',
        [{ bytes: svg, declaredMime: 'image/svg+xml', originalFilename: 'pic.svg' }],
        storage,
      ),
      400,
      'UNSUPPORTED_TYPE',
    );
    expect(typeof rejected.message).toBe('string');
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('rejects a declared-MIME vs magic mismatch with 400 MIME_MISMATCH', async () => {
    setupReporterOwnReport();
    const file = pngFile();
    const rejected = await expectReject(
      uploadAttachments(
        new Request('http://localhost/x'),
        'ref',
        [{ ...file, declaredMime: 'image/jpeg' }],
        mockStorage(),
      ),
      400,
      'MIME_MISMATCH',
    );
    expect(typeof rejected.message).toBe('string');
  });

  it('rejects magic-bytes-plus-garbage with 400 CORRUPT_IMAGE', async () => {
    setupReporterOwnReport();
    const garbage = new Uint8Array([...PNG_SIG, ...new Array(200).fill(0)]);
    const rejected = await expectReject(
      uploadAttachments(
        new Request('http://localhost/x'),
        'ref',
        [{ bytes: garbage, declaredMime: 'image/png', originalFilename: 'broken.png' }],
        mockStorage(),
      ),
      400,
      'CORRUPT_IMAGE',
    );
    expect(typeof rejected.message).toBe('string');
  });

  it('rejects an empty filename with 400 INVALID_FILENAME', async () => {
    setupReporterOwnReport();
    const rejected = await expectReject(
      uploadAttachments(new Request('http://localhost/x'), 'ref', [pngFile('   ')], mockStorage()),
      400,
      'INVALID_FILENAME',
    );
    expect(typeof rejected.message).toBe('string');
  });

  it('rejects a 4th file in one request with 400 TOO_MANY_FILES', async () => {
    setupReporterOwnReport('REPORTED', 0);
    const storage = mockStorage();
    const rejected = await expectReject(
      uploadAttachments(new Request('http://localhost/x'), 'ref', [pngFile('a.png'), pngFile('b.png'), pngFile('c.png'), jpegFile()], storage),
      400,
      'TOO_MANY_FILES',
    );
    expect(rejected.message).toBe('Too many files: a report allows at most 3 attachments.');
    expect(storage.put).not.toHaveBeenCalled();
    expect(createAttachmentsMock).not.toHaveBeenCalled();
  });

  it('rejects when existing + incoming exceeds 3 with 400 TOO_MANY_FILES', async () => {
    setupReporterOwnReport('REPORTED', 2);
    const storage = mockStorage();
    await expectReject(
      uploadAttachments(new Request('http://localhost/x'), 'ref', [pngFile('a.png'), jpegFile()], storage),
      400,
      'TOO_MANY_FILES',
    );
    expect(storage.put).not.toHaveBeenCalled();
    expect(createAttachmentsMock).not.toHaveBeenCalled();
  });

  it('stores nothing when one of several files is invalid (no partial uploads)', async () => {
    setupReporterOwnReport();
    const storage = mockStorage();
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    await expectReject(
      uploadAttachments(
        new Request('http://localhost/x'),
        'ref',
        [pngFile(), { bytes: svg, declaredMime: 'image/svg+xml', originalFilename: 'evil.svg' }],
        storage,
      ),
      400,
      'UNSUPPORTED_TYPE',
    );
    expect(storage.put).not.toHaveBeenCalled();
    expect(storage.remove).not.toHaveBeenCalled();
    expect(createAttachmentsMock).not.toHaveBeenCalled();
  });
});

describe('upload terminal reports', () => {
  it.each(['CLOSED', 'REJECTED', 'DUPLICATE'])('rejects reporter uploads to %s with 409', async (status) => {
    setupReporterOwnReport(status);
    const storage = mockStorage();
    const rejected = await expectReject(
      uploadAttachments(new Request('http://localhost/x'), 'ref', [pngFile()], storage),
      409,
      'CONFLICT',
    );
    expect(rejected.message).toBe('Report is closed to new attachments.');
    expect(storage.put).not.toHaveBeenCalled();
  });

  it('allows reporter uploads to RESOLVED (not terminal for attachments)', async () => {
    setupReporterOwnReport('RESOLVED');
    const storage = mockStorage();
    createAttachmentsMock.mockResolvedValue([]);
    await uploadAttachments(new Request('http://localhost/x'), 'ref', [pngFile()], storage);
    expect(storage.put).toHaveBeenCalledTimes(1);
  });

  it('allows admin uploads to terminal foreign reports', async () => {
    requireUserMock.mockResolvedValue({ ...ADMIN });
    resolveReportIdMock.mockResolvedValue(REPORT_ID);
    getDbMock.mockReturnValue({ db: FAKE_DB, close: fakeClose } as never);
    getReportHeaderMock.mockResolvedValue({ id: REPORT_ID, reporterId: OTHER_REPORTER_ID, status: 'CLOSED' });
    countAttachmentsMock.mockResolvedValue(0);
    createAttachmentsMock.mockResolvedValue([]);
    const storage = mockStorage();
    await uploadAttachments(new Request('http://localhost/x'), 'ref', [pngFile()], storage);
    expect(storage.put).toHaveBeenCalledTimes(1);
  });
});

describe('upload success + cleanup', () => {
  it('returns 201-shaped attachments without storageKey', async () => {
    setupReporterOwnReport('VERIFIED', 1);
    const storage = mockStorage();
    const createdAt = new Date('2026-10-13T00:00:00.000Z');
    createAttachmentsMock.mockResolvedValue([
      {
        id: ATTACHMENT_ID,
        originalFilename: 'photo.png',
        mimeType: 'image/png',
        sizeBytes: 95,
        checksum: 'c'.repeat(64),
        createdAt,
      },
    ]);

    const result = await uploadAttachments(new Request('http://localhost/x'), 'ref', [pngFile()], storage);

    expect(Object.keys(result).sort()).toEqual(['attachments']);
    expect(result.attachments).toHaveLength(1);
    expect(result.attachments[0]).toEqual({
      id: ATTACHMENT_ID,
      originalFilename: 'photo.png',
      mimeType: 'image/png',
      sizeBytes: 95,
      checksum: 'c'.repeat(64),
      createdAt,
    });
    expect(JSON.stringify(result)).not.toContain('storageKey');

    expect(storage.put).toHaveBeenCalledTimes(1);
    const [key, bytes, contentType] = storage.put.mock.calls[0] as [string, Uint8Array, string];
    expect(key.startsWith('att_')).toBe(true);
    expect(contentType).toBe('image/png');
    expect(bytes.byteLength).toBeGreaterThan(0);

    expect(createAttachmentsMock).toHaveBeenCalledTimes(1);
    const input = createAttachmentsMock.mock.calls[0]?.[1] as unknown as {
      reportId: string;
      files: Array<{ storageKey: string; mimeType: string }>;
      uploadedBy: string;
    };
    expect(input.reportId).toBe(REPORT_ID);
    expect(input.uploadedBy).toBe(REPORTER.id);
    expect(input.files).toHaveLength(1);
    expect(input.files[0]?.storageKey).toBe(key);
    expect(input.files[0]?.mimeType).toBe('image/png');
  });

  it('sanitizes the stored filename (basename only)', async () => {
    setupReporterOwnReport();
    const storage = mockStorage();
    createAttachmentsMock.mockResolvedValue([]);
    await uploadAttachments(new Request('http://localhost/x'), 'ref', [pngFile('../../etc/passwd.png')], storage);
    const input = createAttachmentsMock.mock.calls[0]?.[1] as unknown as {
      files: Array<{ originalFilename: string }>;
    };
    expect(input.files[0]?.originalFilename).toBe('passwd.png');
  });

  it('removes stored objects when the DB insert fails, then propagates the error', async () => {
    setupReporterOwnReport();
    const storage = mockStorage();
    createAttachmentsMock.mockRejectedValue(new Error('db is down'));
    let caught: unknown;
    try {
      await uploadAttachments(new Request('http://localhost/x'), 'ref', [pngFile()], storage);
    } catch (error) {
      caught = error;
    }
    expect((caught as Error).message).toBe('db is down');
    expect(storage.put).toHaveBeenCalledTimes(1);
    const [key] = storage.put.mock.calls[0] as [string];
    expect(storage.remove).toHaveBeenCalledTimes(1);
    expect(storage.remove).toHaveBeenCalledWith(key);
  });
});

describe('download auth + ownership', () => {
  it('rejects anonymous downloads with 401', async () => {
    requireUserMock.mockRejectedValue(unauthorized('Belum login'));
    await expectReject(
      downloadAttachment(new Request('http://localhost/x'), 'ref', ATTACHMENT_ID, mockStorage()),
      401,
      'UNAUTHORIZED',
    );
  });

  it('rejects reporter downloads via a foreign report with byte-identical 404 bodies', async () => {
    requireUserMock.mockResolvedValue({ ...REPORTER });
    resolveReportIdMock.mockResolvedValue(REPORT_ID);
    getDbMock.mockReturnValue({ db: FAKE_DB, close: fakeClose } as never);
    getReportHeaderMock.mockResolvedValue({ id: REPORT_ID, reporterId: OTHER_REPORTER_ID, status: 'REPORTED' });
    getAttachmentByIdMock.mockResolvedValue({
      id: ATTACHMENT_ID,
      reportId: REPORT_ID,
      storageKey: 'att_x',
      originalFilename: 'a.png',
      mimeType: 'image/png',
      sizeBytes: 10,
      checksum: 'x',
      createdAt: new Date(),
      reporterId: OTHER_REPORTER_ID,
      status: 'REPORTED',
    });
    const storage = mockStorage();

    const foreign = await expectReject(
      downloadAttachment(new Request('http://localhost/x'), 'foreign', ATTACHMENT_ID, storage),
      404,
      'NOT_FOUND',
    );

    getReportHeaderMock.mockResolvedValue(null);
    const missing = await expectReject(
      downloadAttachment(new Request('http://localhost/x'), 'missing', ATTACHMENT_ID, storage),
      404,
      'NOT_FOUND',
    );

    expect(foreign.message).toBe('Report not found');
    expect(JSON.stringify(foreign.body)).toBe(JSON.stringify(missing.body));
    expect(storage.get).not.toHaveBeenCalled();
  });

  it('denies when the attachment join disagrees with the report gate (defense in depth)', async () => {
    setupReporterOwnReport();
    getAttachmentByIdMock.mockResolvedValue({
      id: ATTACHMENT_ID,
      reportId: REPORT_ID,
      storageKey: 'att_x',
      originalFilename: 'a.png',
      mimeType: 'image/png',
      sizeBytes: 10,
      checksum: 'x',
      createdAt: new Date(),
      reporterId: OTHER_REPORTER_ID,
      status: 'REPORTED',
    });
    const rejected = await expectReject(
      downloadAttachment(new Request('http://localhost/x'), 'ref', ATTACHMENT_ID, mockStorage()),
      404,
      'NOT_FOUND',
    );
    expect(rejected.message).toBe('Report not found');
  });

  it('rejects missing attachments with 404 Attachment not found', async () => {
    setupReporterOwnReport();
    getAttachmentByIdMock.mockResolvedValue(null);
    const rejected = await expectReject(
      downloadAttachment(new Request('http://localhost/x'), 'ref', ATTACHMENT_ID, mockStorage()),
      404,
      'NOT_FOUND',
    );
    expect(rejected.message).toBe('Attachment not found');
  });

  it('rejects cross-report attachment ids with 404 Attachment not found', async () => {
    setupReporterOwnReport();
    getAttachmentByIdMock.mockResolvedValue({
      id: ATTACHMENT_ID,
      reportId: 'other-report-id',
      storageKey: 'att_x',
      originalFilename: 'a.png',
      mimeType: 'image/png',
      sizeBytes: 10,
      checksum: 'x',
      createdAt: new Date(),
      reporterId: REPORTER.id,
      status: 'REPORTED',
    });
    await expectReject(
      downloadAttachment(new Request('http://localhost/x'), 'ref', ATTACHMENT_ID, mockStorage()),
      404,
      'NOT_FOUND',
    );
  });

  it('rejects with 404 when the stored object is gone', async () => {
    setupReporterOwnReport();
    getAttachmentByIdMock.mockResolvedValue({
      id: ATTACHMENT_ID,
      reportId: REPORT_ID,
      storageKey: 'att_gone',
      originalFilename: 'a.png',
      mimeType: 'image/png',
      sizeBytes: 10,
      checksum: 'x',
      createdAt: new Date(),
      reporterId: REPORTER.id,
      status: 'REPORTED',
    });
    const storage = mockStorage();
    storage.get.mockResolvedValue(null);
    const rejected = await expectReject(
      downloadAttachment(new Request('http://localhost/x'), 'ref', ATTACHMENT_ID, storage),
      404,
      'NOT_FOUND',
    );
    expect(rejected.message).toBe('Attachment not found');
    expect(storage.get).toHaveBeenCalledWith('att_gone');
  });

  it('returns bytes with the canonical db mimeType for owners and admins', async () => {
    setupReporterOwnReport();
    const bytes = new Uint8Array([1, 2, 3, 4]);
    getAttachmentByIdMock.mockResolvedValue({
      id: ATTACHMENT_ID,
      reportId: REPORT_ID,
      storageKey: 'att_ok',
      originalFilename: 'a.png',
      mimeType: 'image/png',
      sizeBytes: 4,
      checksum: 'x',
      createdAt: new Date(),
      reporterId: REPORTER.id,
      status: 'REPORTED',
    });
    const storage = mockStorage();
    storage.get.mockResolvedValue({ bytes, contentType: 'image/png' });

    const result = await downloadAttachment(new Request('http://localhost/x'), 'ref', ATTACHMENT_ID, storage);
    expect(result.bytes).toEqual(bytes);
    expect(result.contentType).toBe('image/png');
    expect(result.filename).toBe('a.png');
    expect('storageKey' in result).toBe(false);

    vi.resetAllMocks();
    fakeClose.mockResolvedValue(undefined);
    requireUserMock.mockResolvedValue({ ...ADMIN });
    resolveReportIdMock.mockResolvedValue(REPORT_ID);
    getDbMock.mockReturnValue({ db: FAKE_DB, close: fakeClose } as never);
    getAttachmentByIdMock.mockResolvedValue({
      id: ATTACHMENT_ID,
      reportId: REPORT_ID,
      storageKey: 'att_ok',
      originalFilename: 'a.png',
      mimeType: 'image/png',
      sizeBytes: 4,
      checksum: 'x',
      createdAt: new Date(),
      reporterId: OTHER_REPORTER_ID,
      status: 'REPORTED',
    });
    const adminStorage = mockStorage();
    adminStorage.get.mockResolvedValue({ bytes, contentType: 'image/png' });
    const adminResult = await downloadAttachment(new Request('http://localhost/x'), 'ref', ATTACHMENT_ID, adminStorage);
    expect(adminResult.bytes).toEqual(bytes);
  });
});

describe('toAttachmentResponse headers', () => {
  it('sets the exact download headers', async () => {
    const bytes = new Uint8Array(Buffer.from(PNG_B64, 'base64'));
    const response = toAttachmentResponse({ bytes, contentType: 'image/png', filename: 'photo.png' });
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(response.headers.get('Content-Disposition')).toBe("inline; filename*=UTF-8''photo.png");
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.headers.get('Cache-Control')).toBe('private, max-age=60');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  });

  it('encodes unsafe filename characters per RFC 5987', async () => {
    const response = toAttachmentResponse({
      bytes: new Uint8Array([9]),
      contentType: 'image/jpeg',
      filename: 'my photo (1).jpg',
    });
    expect(response.headers.get('Content-Disposition')).toBe(
      "inline; filename*=UTF-8''my%20photo%20%281%29.jpg",
    );
  });
});
