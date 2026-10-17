// Client upload helpers tests (Phase 4, task P4-4). Pure validation mirrors
// the server allowlist (per-file ≤ 5_242_880 bytes, ≤ 3 total, MIME allowlist
// with extension fallback); the uploader posts FormData with the session
// cookie and maps failures to Indonesian messages. Fetch is stubbed — no
// network.
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  attachmentDownloadUrl,
  CLIENT_MAX_ATTACHMENT_BYTES,
  CLIENT_MAX_ATTACHMENTS_PER_REPORT,
  stageReportPhotos,
  uploadReportAttachments,
  validateAttachmentFiles,
  type ClientFileLike,
} from './attachments.js';

function file(name: string, type: string, size: number): ClientFileLike {
  return { name, type, size };
}

describe('client upload constants mirror the server', () => {
  it('pins 5 MiB per file and 3 files per report', () => {
    expect(CLIENT_MAX_ATTACHMENT_BYTES).toBe(5_242_880);
    expect(CLIENT_MAX_ATTACHMENTS_PER_REPORT).toBe(3);
  });
});

describe('validateAttachmentFiles', () => {
  it('accepts up to 3 valid images, including exact-limit sizes', () => {
    expect(
      validateAttachmentFiles([
        file('a.jpg', 'image/jpeg', 100),
        file('b.png', 'image/png', CLIENT_MAX_ATTACHMENT_BYTES),
        file('c.webp', 'image/webp', 10),
      ]),
    ).toEqual([]);
    expect(validateAttachmentFiles([])).toEqual([]);
  });

  it('rejects a 4th file with a single count error', () => {
    expect(
      validateAttachmentFiles([
        file('a.jpg', 'image/jpeg', 10),
        file('b.jpg', 'image/jpeg', 10),
        file('c.jpg', 'image/jpeg', 10),
        file('d.jpg', 'image/jpeg', 10),
      ]),
    ).toEqual(['Maksimal 3 foto per laporan.']);
  });

  it('rejects per-file oversize naming the file', () => {
    expect(validateAttachmentFiles([file('big.png', 'image/png', 5_242_881)])).toEqual([
      'Ukuran "big.png" melebihi 5 MB.',
    ]);
  });

  it('rejects SVG/exe types and is case-insensitive on valid types', () => {
    expect(validateAttachmentFiles([file('x.svg', 'image/svg+xml', 100)])).toEqual([
      'Format "x.svg" tidak didukung. Gunakan JPG, PNG, atau WebP.',
    ]);
    expect(validateAttachmentFiles([file('x.exe', 'application/octet-stream', 100)])).toEqual([
      'Format "x.exe" tidak didukung. Gunakan JPG, PNG, atau WebP.',
    ]);
    expect(validateAttachmentFiles([file('a.JPG', 'IMAGE/JPEG', 100)])).toEqual([]);
  });

  it('falls back to the extension only when the MIME type is missing', () => {
    expect(validateAttachmentFiles([file('foto.png', '', 100)])).toEqual([]);
    expect(validateAttachmentFiles([file('doc.txt', '', 100)])).toEqual([
      'Format "doc.txt" tidak didukung. Gunakan JPG, PNG, atau WebP.',
    ]);
  });
});

describe('attachmentDownloadUrl', () => {
  it('builds the authorized GET url with encoded segments', () => {
    expect(attachmentDownloadUrl('MNT-2026-000001', '550e8400-e29b-41d4-a716-446655440000')).toBe(
      '/api/reports/MNT-2026-000001/attachments/550e8400-e29b-41d4-a716-446655440000',
    );
    expect(attachmentDownloadUrl('a b/c', 'd/e')).toBe('/api/reports/a%20b%2Fc/attachments/d%2Fe');
  });
});

describe('uploadReportAttachments', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch(status: number, body: unknown): { calls: RequestInit[] } {
    const calls: RequestInit[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: unknown, init: RequestInit) => {
        calls.push(init);
        return new Response(JSON.stringify(body), { status });
      }),
    );
    return { calls };
  }

  function realFile(): File {
    return new File([new Uint8Array([1, 2, 3])], 'foto.png', { type: 'image/png' });
  }

  it('posts FormData with the session cookie and returns attachments', async () => {
    const { calls } = stubFetch(201, { attachments: [{ id: 'att-1' }] });
    const result = await uploadReportAttachments('MNT-2026-000001', [realFile()]);
    expect(result).toEqual([{ id: 'att-1' }]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe('POST');
    expect(calls[0]?.credentials).toBe('include');
    const body = calls[0]?.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect(body.getAll('files')).toHaveLength(1);
  });

  it('maps 401/413/failures to Indonesian messages', async () => {
    stubFetch(401, { error: { message: 'Unauthorized' } });
    await expect(uploadReportAttachments('MNT-1', [realFile()])).rejects.toThrow(
      'Sesi berakhir. Masuk kembali lalu coba lagi.',
    );
    stubFetch(413, { error: { message: 'too big' } });
    await expect(uploadReportAttachments('MNT-1', [realFile()])).rejects.toThrow('Ukuran foto melebihi 5 MB.');
    stubFetch(500, { error: { message: 'boom' } });
    await expect(uploadReportAttachments('MNT-1', [realFile()])).rejects.toThrow(
      'Gagal mengunggah foto. Coba lagi.',
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );
    await expect(uploadReportAttachments('MNT-1', [realFile()])).rejects.toThrow(
      'Gagal mengunggah foto. Coba lagi.',
    );
  });
});

describe('stageReportPhotos', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubFetch(status: number, body: unknown): { calls: { url: unknown; init: RequestInit }[] } {
    const calls: { url: unknown; init: RequestInit }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: unknown, init: RequestInit) => {
        calls.push({ url, init });
        return new Response(JSON.stringify(body), { status });
      }),
    );
    return { calls };
  }

  function realFile(): File {
    return new File([new Uint8Array([1, 2, 3])], 'foto.png', { type: 'image/png' });
  }

  it('posts files to the staging endpoint and returns keys', async () => {
    const { calls } = stubFetch(201, { keys: ['staging_a', 'staging_b'] });
    const result = await stageReportPhotos([realFile(), realFile()]);
    expect(result).toEqual(['staging_a', 'staging_b']);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe('/api/uploads');
    expect(calls[0]?.init.method).toBe('POST');
    expect(calls[0]?.init.credentials).toBe('include');
    const body = calls[0]?.init.body as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect(body.getAll('files')).toHaveLength(2);
  });

  it('maps failures and malformed keys to Indonesian messages', async () => {
    stubFetch(401, { error: { message: 'Unauthorized' } });
    await expect(stageReportPhotos([realFile()])).rejects.toThrow(
      'Sesi berakhir. Masuk kembali lalu coba lagi.',
    );
    stubFetch(413, { error: { message: 'too big' } });
    await expect(stageReportPhotos([realFile()])).rejects.toThrow('Ukuran foto melebihi 5 MB.');
    stubFetch(201, { keys: [] });
    await expect(stageReportPhotos([realFile()])).rejects.toThrow(
      'Gagal mengunggah foto. Coba lagi.',
    );
    stubFetch(500, { error: { message: 'boom' } });
    await expect(stageReportPhotos([realFile()])).rejects.toThrow(
      'Gagal mengunggah foto. Coba lagi.',
    );
  });
});
