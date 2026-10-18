import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import {
  ALLOWED_ATTACHMENT_MIME_TYPES,
  AttachmentValidationError,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_REPORT,
  canAddAttachments,
  prepareVisionImage,
  processImage,
  sanitizeOriginalFilename,
  sniffImageKind,
  validateAttachment,
} from './attachments.js';

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function expectSyncCode(fn: () => unknown, code: string): void {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(AttachmentValidationError);
    expect((error as AttachmentValidationError).code).toBe(code);
    return;
  }
  expect.unreachable(`expected AttachmentValidationError with code ${code}`);
}

async function expectAsyncCode(fn: () => Promise<unknown>, code: string): Promise<void> {
  try {
    await fn();
  } catch (error) {
    expect(error).toBeInstanceOf(AttachmentValidationError);
    expect((error as AttachmentValidationError).code).toBe(code);
    return;
  }
  expect.unreachable(`expected AttachmentValidationError with code ${code}`);
}

function pngBytesWithSize(size: number): Buffer {
  const bytes = Buffer.alloc(size);
  PNG_SIG.forEach((byte, index) => {
    bytes[index] = byte;
  });
  return bytes;
}

async function makeJpeg(width = 16, height = 16): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 200, g: 30, b: 30 } },
  })
    .jpeg()
    .toBuffer();
}

async function makePng(width = 16, height = 16): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 30, g: 120, b: 200 } },
  })
    .png()
    .toBuffer();
}

async function makeWebp(width = 16, height = 16): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 30, g: 180, b: 60 } },
  })
    .webp()
    .toBuffer();
}

describe('attachment constants and boundaries', () => {
  it('pins the exact binding values', () => {
    expect(MAX_ATTACHMENT_BYTES).toBe(5_242_880);
    expect(MAX_ATTACHMENT_BYTES).toBe(5 * 1024 * 1024);
    expect(MAX_ATTACHMENTS_PER_REPORT).toBe(3);
    expect([...ALLOWED_ATTACHMENT_MIME_TYPES]).toEqual(['image/jpeg', 'image/png', 'image/webp']);
  });

  it('passes a file of exactly MAX_ATTACHMENT_BYTES', () => {
    const bytes = pngBytesWithSize(MAX_ATTACHMENT_BYTES);
    const result = validateAttachment({ bytes, declaredMime: 'image/png', originalFilename: 'photo.png' });
    expect(result.kind).toBe('png');
    expect(result.sizeBytes).toBe(MAX_ATTACHMENT_BYTES);
  });

  it('rejects a file of MAX_ATTACHMENT_BYTES + 1 with FILE_TOO_LARGE', () => {
    const bytes = pngBytesWithSize(MAX_ATTACHMENT_BYTES + 1);
    expectSyncCode(
      () => validateAttachment({ bytes, declaredMime: 'image/png', originalFilename: 'photo.png' }),
      'FILE_TOO_LARGE',
    );
  });

  it('blocks a 4th file via canAddAttachments', () => {
    expect(canAddAttachments(2, 1)).toBe(true);
    expect(canAddAttachments(0, 3)).toBe(true);
    expect(canAddAttachments(3, 0)).toBe(true);
    expect(canAddAttachments(3, 1)).toBe(false);
    expect(canAddAttachments(1, 3)).toBe(false);
    expect(canAddAttachments(0, 4)).toBe(false);
  });
});

describe('magic-byte sniffing', () => {
  it('passes real JPEG/PNG/WebP images generated at runtime', async () => {
    const jpeg = await makeJpeg();
    const png = await makePng();
    const webp = await makeWebp();
    expect(sniffImageKind(jpeg)).toBe('jpeg');
    expect(sniffImageKind(png)).toBe('png');
    expect(sniffImageKind(webp)).toBe('webp');
    expect(validateAttachment({ bytes: jpeg, declaredMime: 'image/jpeg', originalFilename: 'a.jpg' }).kind).toBe(
      'jpeg',
    );
    expect(validateAttachment({ bytes: png, declaredMime: 'image/png', originalFilename: 'a.png' }).kind).toBe(
      'png',
    );
    expect(validateAttachment({ bytes: webp, declaredMime: 'image/webp', originalFilename: 'a.webp' }).kind).toBe(
      'webp',
    );
  });

  it('sniffs raw magic headers without a decoder', () => {
    expect(sniffImageKind(Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x11]))).toBe('jpeg');
    expect(sniffImageKind(Buffer.from([...PNG_SIG, 0x00]))).toBe('png');
    expect(sniffImageKind(Buffer.from([0x52, 0x49, 0x46, 0x46, 0x01, 0x02, 0x03, 0x04, 0x57, 0x45, 0x42, 0x50]))).toBe(
      'webp',
    );
    // RIFF without WEBP is not WebP; truncated headers sniff as nothing.
    expect(sniffImageKind(Buffer.from([0x52, 0x49, 0x46, 0x46, 0x01, 0x02, 0x03, 0x04, 0x4e, 0x4f, 0x54, 0x21]))).toBeNull();
    expect(sniffImageKind(Buffer.from([0xff, 0xd8]))).toBeNull();
    expect(sniffImageKind(new Uint8Array(0))).toBeNull();
  });

  it('rejects declared-MIME vs sniffed-kind mismatch with MIME_MISMATCH', async () => {
    const jpeg = await makeJpeg();
    const png = await makePng();
    const webp = await makeWebp();
    expectSyncCode(
      () => validateAttachment({ bytes: png, declaredMime: 'image/jpeg', originalFilename: 'a.png' }),
      'MIME_MISMATCH',
    );
    expectSyncCode(
      () => validateAttachment({ bytes: jpeg, declaredMime: 'image/webp', originalFilename: 'a.jpg' }),
      'MIME_MISMATCH',
    );
    expectSyncCode(
      () => validateAttachment({ bytes: webp, declaredMime: 'image/png', originalFilename: 'a.webp' }),
      'MIME_MISMATCH',
    );
  });

  it('accepts declared MIME case-insensitively', async () => {
    const png = await makePng();
    expect(
      validateAttachment({ bytes: png, declaredMime: 'IMAGE/PNG', originalFilename: 'a.png' }).kind,
    ).toBe('png');
  });

  it('rejects SVG content with UNSUPPORTED_TYPE', () => {
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    expectSyncCode(
      () => validateAttachment({ bytes: svg, declaredMime: 'image/svg+xml', originalFilename: 'a.svg' }),
      'UNSUPPORTED_TYPE',
    );
    expectSyncCode(
      () => validateAttachment({ bytes: svg, declaredMime: 'image/png', originalFilename: 'a.svg' }),
      'UNSUPPORTED_TYPE',
    );
  });

  it('rejects MZ/ELF executables even when declared as images', () => {
    const mz = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
    const elf = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]);
    expectSyncCode(
      () => validateAttachment({ bytes: mz, declaredMime: 'image/jpeg', originalFilename: 'a.jpg' }),
      'UNSUPPORTED_TYPE',
    );
    expectSyncCode(
      () => validateAttachment({ bytes: elf, declaredMime: 'image/png', originalFilename: 'a.png' }),
      'UNSUPPORTED_TYPE',
    );
  });

  it('rejects unknown binary content with UNSUPPORTED_TYPE at validation time', () => {
    const random = Buffer.alloc(256, 0x61);
    expect(sniffImageKind(random)).toBeNull();
    expectSyncCode(
      () => validateAttachment({ bytes: random, declaredMime: 'image/png', originalFilename: 'a.png' }),
      'UNSUPPORTED_TYPE',
    );
  });
});

describe('corrupt images fail closed', () => {
  it('rejects random bytes with CORRUPT_IMAGE in processImage', async () => {
    await expectAsyncCode(() => processImage(Buffer.alloc(256, 0x61)), 'CORRUPT_IMAGE');
  });

  it('rejects magic bytes followed by garbage with CORRUPT_IMAGE', async () => {
    const garbage = Buffer.concat([Buffer.from(PNG_SIG), Buffer.alloc(200)]);
    await expectAsyncCode(() => processImage(garbage), 'CORRUPT_IMAGE');
  });

  it('rejects a truncated JPEG with CORRUPT_IMAGE', async () => {
    const full = await makeJpeg(64, 64);
    expect(full.byteLength).toBeGreaterThan(100);
    await expectAsyncCode(() => processImage(full.subarray(0, 100)), 'CORRUPT_IMAGE');
  });
});

describe('filename sanitization', () => {
  it('strips directory segments (posix and windows)', () => {
    expect(sanitizeOriginalFilename('../../etc/passwd')).toBe('passwd');
    expect(sanitizeOriginalFilename('..\\..\\evil.png')).toBe('evil.png');
    expect(sanitizeOriginalFilename('/abs/dir/photo.jpg')).toBe('photo.jpg');
    expect(sanitizeOriginalFilename('C:\\fakepath\\shot.webp')).toBe('shot.webp');
  });

  it('trims whitespace and caps length at 255 chars', () => {
    expect(sanitizeOriginalFilename('  spaced.png  ')).toBe('spaced.png');
    expect(sanitizeOriginalFilename('n'.repeat(300))).toHaveLength(255);
  });

  it('rejects empty names with INVALID_FILENAME', () => {
    expectSyncCode(() => sanitizeOriginalFilename(''), 'INVALID_FILENAME');
    expectSyncCode(() => sanitizeOriginalFilename('   '), 'INVALID_FILENAME');
  });

  it('rejects empty filenames during validation', async () => {
    const png = await makePng();
    expectSyncCode(
      () => validateAttachment({ bytes: png, declaredMime: 'image/png', originalFilename: '   ' }),
      'INVALID_FILENAME',
    );
  });
});

describe('processImage round-trip', () => {
  it('re-encodes PNG with canonical mime, dimensions, and sha256 checksum', async () => {
    const out = await processImage(await makePng(32, 16));
    expect(out.mimeType).toBe('image/png');
    expect(out.width).toBe(32);
    expect(out.height).toBe(16);
    expect(out.sizeBytes).toBe(out.bytes.byteLength);
    expect(out.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(out.checksum).toBe(createHash('sha256').update(out.bytes).digest('hex'));
    const meta = await sharp(out.bytes).metadata();
    expect(meta.format).toBe('png');
    expect(meta.width).toBe(32);
    expect(meta.height).toBe(16);
  });

  it('re-encodes JPEG and WebP with canonical mime types', async () => {
    const jpeg = await processImage(await makeJpeg(24, 12));
    expect(jpeg.mimeType).toBe('image/jpeg');
    expect(jpeg.width).toBeGreaterThan(0);
    expect(jpeg.height).toBeGreaterThan(0);
    expect((await sharp(jpeg.bytes).metadata()).format).toBe('jpeg');

    const webp = await processImage(await makeWebp(20, 10));
    expect(webp.mimeType).toBe('image/webp');
    expect(webp.width).toBe(20);
    expect(webp.height).toBe(10);
    expect((await sharp(webp.bytes).metadata()).format).toBe('webp');
  });

  it('applies EXIF orientation and strips all metadata', async () => {
    const input = await sharp({
      create: { width: 24, height: 12, channels: 3, background: { r: 10, g: 120, b: 200 } },
    })
      .jpeg()
      .withMetadata({ orientation: 6 })
      .toBuffer();
    expect((await sharp(input).metadata()).orientation).toBe(6);

    const out = await processImage(input);
    expect(out.mimeType).toBe('image/jpeg');
    expect(out.width).toBe(12);
    expect(out.height).toBe(24);
    const meta = await sharp(out.bytes).metadata();
    expect(meta.exif).toBeUndefined();
    expect(meta.orientation).toBeUndefined();
  });
});

describe('empty files', () => {
  it('rejects 0-byte input with EMPTY_FILE', async () => {
    const empty = new Uint8Array(0);
    expectSyncCode(
      () => validateAttachment({ bytes: empty, declaredMime: 'image/png', originalFilename: 'a.png' }),
      'EMPTY_FILE',
    );
    await expectAsyncCode(() => processImage(empty), 'EMPTY_FILE');
  });
});

describe('prepareVisionImage', () => {
  it('downscales the longest edge to the bound without enlarging', async () => {
    const large = await sharp({
      create: { width: 3000, height: 2000, channels: 3, background: '#808080' },
    })
      .jpeg()
      .toBuffer();
    const out = await prepareVisionImage(large);
    expect(out.mimeType).toBe('image/jpeg');
    expect(Math.max(out.width, out.height)).toBe(1280);
    const meta = await sharp(out.bytes).metadata();
    expect(meta.format).toBe('jpeg');
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBe(1280);

    const kept = await prepareVisionImage(await makeJpeg(800, 600));
    expect(kept.width).toBe(800);
    expect(kept.height).toBe(600);
  });

  it('flattens transparency onto white', async () => {
    const png = await sharp({
      create: { width: 64, height: 64, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .png()
      .toBuffer();
    const out = await prepareVisionImage(png);
    const meta = await sharp(out.bytes).metadata();
    expect(meta.hasAlpha).toBe(false);
  });

  it('rejects empty and undecodable bytes', async () => {
    await expect(prepareVisionImage(new Uint8Array(0))).rejects.toMatchObject({ code: 'EMPTY_FILE' });
    await expect(prepareVisionImage(Buffer.from('not an image'))).rejects.toMatchObject({
      code: 'CORRUPT_IMAGE',
    });
  });
});

describe('error hygiene', () => {
  it('never leaks filenames into error messages', async () => {
    const png = await makePng();
    try {
      validateAttachment({ bytes: png, declaredMime: 'image/jpeg', originalFilename: 'secret-marker-xyz.png' });
    } catch (error) {
      expect(error).toBeInstanceOf(AttachmentValidationError);
      expect((error as AttachmentValidationError).code).toBe('MIME_MISMATCH');
      expect((error as Error).message).not.toContain('secret-marker-xyz');
      return;
    }
    expect.unreachable('expected MIME_MISMATCH');
  });
});
