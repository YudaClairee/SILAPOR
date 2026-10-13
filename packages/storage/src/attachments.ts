// Pure attachment validation + image-processing core (Phase 4, task P4-1).
//
// Domain-boundary rule: this module is pure. It imports `sharp` (decode and
// re-encode) and `node:crypto` (sha256) only — no `process.env`, no DB, no
// framework/UI imports. Filenames are untrusted metadata: they are sanitised
// for display only and NEVER used as storage keys (P4-2 keeps using
// `generateAttachmentKey()` from `filesystem.ts`).
import { createHash } from 'node:crypto';
import sharp from 'sharp';

// Binding value: files of exactly this size PASS; +1 byte FAILS.
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

// Binding value: enforcement lives in P4-3; the constant and helper live here.
export const MAX_ATTACHMENTS_PER_REPORT = 3;

// Canonical allowlist (post-processing MIME). NOTHING else passes.
export const ALLOWED_ATTACHMENT_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type AllowedAttachmentMimeType = (typeof ALLOWED_ATTACHMENT_MIME_TYPES)[number];

export type ImageKind = 'jpeg' | 'png' | 'webp';

export const IMAGE_KIND_MIME_TYPES: Record<ImageKind, AllowedAttachmentMimeType> = {
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

export type AttachmentValidationCode =
  | 'FILE_TOO_LARGE'
  | 'TOO_MANY_FILES'
  | 'UNSUPPORTED_TYPE'
  | 'MIME_MISMATCH'
  | 'CORRUPT_IMAGE'
  | 'INVALID_FILENAME'
  | 'EMPTY_FILE';

// Messages are generic on purpose: they never carry file bytes, base64, or
// paths outside the opaque storage key.
export class AttachmentValidationError extends Error {
  readonly code: AttachmentValidationCode;

  constructor(code: AttachmentValidationCode, message: string) {
    super(message);
    this.name = 'AttachmentValidationError';
    this.code = code;
  }
}

const JPEG_MAGIC = [0xff, 0xd8, 0xff];
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const RIFF_MAGIC = [0x52, 0x49, 0x46, 0x46];
const WEBP_MAGIC = [0x57, 0x45, 0x42, 0x50];

// Magic-byte sniffing. Never trusts the browser `Content-Type`:
// JPEG = FF D8 FF; PNG = 89 50 4E 47 0D 0A 1A 0A; WebP = RIFF....WEBP.
export function sniffImageKind(bytes: Uint8Array): ImageKind | null {
  if (JPEG_MAGIC.every((byte, index) => bytes[index] === byte)) {
    return 'jpeg';
  }
  if (PNG_MAGIC.every((byte, index) => bytes[index] === byte)) {
    return 'png';
  }
  if (
    bytes.length >= 12 &&
    RIFF_MAGIC.every((byte, index) => bytes[index] === byte) &&
    WEBP_MAGIC.every((byte, index) => bytes[8 + index] === byte)
  ) {
    return 'webp';
  }
  return null;
}

export interface ValidateAttachmentInput {
  readonly bytes: Uint8Array;
  readonly declaredMime: string;
  readonly originalFilename: string;
}

export interface AttachmentValidation {
  readonly kind: ImageKind;
  readonly sizeBytes: number;
}

function normalizeMime(declaredMime: string): string {
  const beforeParams = declaredMime.split(';')[0] ?? '';
  return beforeParams.trim().toLowerCase();
}

export function validateAttachment(input: ValidateAttachmentInput): AttachmentValidation {
  const { bytes, declaredMime, originalFilename } = input;
  if (bytes.byteLength === 0) {
    throw new AttachmentValidationError('EMPTY_FILE', 'Attachment is empty: a file must contain at least one byte.');
  }
  // Filename is metadata only: validated here, never used as a storage key.
  sanitizeOriginalFilename(originalFilename);
  if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
    throw new AttachmentValidationError(
      'FILE_TOO_LARGE',
      `Attachment exceeds the maximum size of ${MAX_ATTACHMENT_BYTES} bytes.`,
    );
  }
  // Null sniff covers SVG/XML strings, MZ/ELF executables, and any other
  // non-image bytes: all are UNSUPPORTED_TYPE at validation time.
  const kind = sniffImageKind(bytes);
  if (kind === null) {
    throw new AttachmentValidationError(
      'UNSUPPORTED_TYPE',
      'Unsupported attachment type: only JPEG, PNG, and WebP images are allowed.',
    );
  }
  if (normalizeMime(declaredMime) !== IMAGE_KIND_MIME_TYPES[kind]) {
    throw new AttachmentValidationError(
      'MIME_MISMATCH',
      'Attachment MIME type does not match the detected image format.',
    );
  }
  return { kind, sizeBytes: bytes.byteLength };
}

export interface ProcessedImage {
  readonly bytes: Uint8Array;
  readonly mimeType: AllowedAttachmentMimeType;
  readonly width: number;
  readonly height: number;
  readonly sizeBytes: number;
  readonly checksum: string;
}

// Fail-closed re-encode: corrupt/truncated bytes throw CORRUPT_IMAGE, never
// passthrough. Applies EXIF orientation via `.rotate()` then strips all
// metadata (`.withMetadata()` is never called). Re-encodes the same format:
// jpeg quality 82, png default, webp quality 82.
export async function processImage(bytes: Uint8Array): Promise<ProcessedImage> {
  if (bytes.byteLength === 0) {
    throw new AttachmentValidationError('EMPTY_FILE', 'Attachment is empty: a file must contain at least one byte.');
  }
  if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
    throw new AttachmentValidationError(
      'FILE_TOO_LARGE',
      `Attachment exceeds the maximum size of ${MAX_ATTACHMENT_BYTES} bytes.`,
    );
  }
  const kind = sniffImageKind(bytes);
  if (kind === null) {
    throw new AttachmentValidationError('CORRUPT_IMAGE', 'Attachment is not a decodable image.');
  }
  try {
    let pipeline = sharp(Buffer.from(bytes)).rotate();
    if (kind === 'jpeg') {
      pipeline = pipeline.jpeg({ quality: 82, mozjpeg: false });
    } else if (kind === 'png') {
      pipeline = pipeline.png();
    } else {
      pipeline = pipeline.webp({ quality: 82 });
    }
    const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
    return {
      bytes: data,
      mimeType: IMAGE_KIND_MIME_TYPES[kind],
      width: info.width,
      height: info.height,
      sizeBytes: data.byteLength,
      checksum: createHash('sha256').update(data).digest('hex'),
    };
  } catch {
    throw new AttachmentValidationError('CORRUPT_IMAGE', 'Attachment is not a decodable image.');
  }
}

// Filename is METADATA ONLY: strips `/` and `\` directory segments down to
// the basename, trims, caps at 255 chars, and rejects empty-after-trim.
export function sanitizeOriginalFilename(name: string): string {
  const segments = name.split(/[/\\]+/);
  const base = segments[segments.length - 1] ?? '';
  const trimmed = base.trim();
  if (trimmed.length === 0) {
    throw new AttachmentValidationError('INVALID_FILENAME', 'Invalid filename: a filename must not be empty.');
  }
  return trimmed.slice(0, 255);
}

export function canAddAttachments(existingCount: number, newCount: number): boolean {
  return existingCount + newCount <= MAX_ATTACHMENTS_PER_REPORT;
}
