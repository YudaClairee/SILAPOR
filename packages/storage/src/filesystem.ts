// Filesystem AttachmentStorage for local dev and tests (Task 3).
// Node-only: server code reads `process.env` exclusively through
// `resolveStorageDir()` here (same rule as @silapor/shared config).
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AttachmentData, AttachmentPutResult, AttachmentStorage } from './types';

export const DEFAULT_STORAGE_DIR = './.data/attachments';
export const STORAGE_DIR_ENV = 'STORAGE_DIR';

const META_SUFFIX = '.meta.json';
const FALLBACK_CONTENT_TYPE = 'application/octet-stream';

// Root directory for attachments: explicit argument wins, otherwise the
// `STORAGE_DIR` env var, otherwise `./.data/attachments`. Empty strings
// fall through to the default so `STORAGE_DIR=` cannot produce a cwd write.
export function resolveStorageDir(explicit?: string): string {
  const candidate = explicit ?? process.env[STORAGE_DIR_ENV];
  if (candidate === undefined || candidate.trim().length === 0) {
    return DEFAULT_STORAGE_DIR;
  }
  return candidate;
}

// Opaque, collision-free key. The optional prefix is sanitised to
// `[a-zA-Z0-9_-]` so generated keys always pass the traversal guard below.
export function generateAttachmentKey(prefix: string = 'att'): string {
  const trimmed = prefix.trim();
  const safe = trimmed.length === 0 ? 'att' : trimmed.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `${safe}_${randomUUID()}`;
}

function assertSafeKey(key: string): void {
  if (key.trim().length === 0) {
    throw new Error('Invalid attachment key: key must not be empty.');
  }
  if (path.isAbsolute(key)) {
    throw new Error(`Invalid attachment key "${key}": absolute paths are not allowed.`);
  }
  const normalized = path.posix.normalize(key.split(path.sep).join('/'));
  if (
    normalized === '.' ||
    normalized === '..' ||
    normalized === '' ||
    normalized.startsWith('../')
  ) {
    throw new Error(`Invalid attachment key "${key}": path traversal is not allowed.`);
  }
}

export class FilesystemAttachmentStorage implements AttachmentStorage {
  private readonly root: string;

  constructor(root: string = resolveStorageDir()) {
    this.root = root;
  }

  get rootDir(): string {
    return this.root;
  }

  private resolvePath(key: string): string {
    assertSafeKey(key);
    const rootResolved = path.resolve(this.root);
    const full = path.resolve(rootResolved, key);
    if (full !== rootResolved && !full.startsWith(rootResolved + path.sep)) {
      throw new Error(`Invalid attachment key "${key}": escapes the storage root.`);
    }
    return full;
  }

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<AttachmentPutResult> {
    if (contentType.trim().length === 0) {
      throw new Error('Invalid content type: contentType must not be empty.');
    }
    const full = this.resolvePath(key);
    await mkdir(path.dirname(full), { recursive: true });
    await writeFile(full, bytes);
    // Sidecar preserves contentType across restarts; get() falls back to
    // application/octet-stream when it is missing or unreadable.
    await writeFile(full + META_SUFFIX, JSON.stringify({ contentType }), 'utf8');
    return {
      key,
      size: bytes.byteLength,
      checksum: createHash('sha256').update(bytes).digest('hex'),
    };
  }

  async get(key: string): Promise<AttachmentData | null> {
    const full = this.resolvePath(key);
    let bytes: Buffer;
    try {
      bytes = await readFile(full);
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
    return { bytes, contentType: await this.readContentType(full) };
  }

  async remove(key: string): Promise<void> {
    const full = this.resolvePath(key);
    await rm(full, { force: true });
    await rm(full + META_SUFFIX, { force: true });
  }

  private async readContentType(full: string): Promise<string> {
    try {
      const parsed: unknown = JSON.parse(await readFile(full + META_SUFFIX, 'utf8'));
      if (typeof parsed === 'object' && parsed !== null && 'contentType' in parsed) {
        const contentType = (parsed as { contentType: unknown }).contentType;
        if (typeof contentType === 'string' && contentType.trim().length > 0) {
          return contentType;
        }
      }
    } catch {
      // Missing/corrupt sidecar: fall through to the default below.
    }
    return FALLBACK_CONTENT_TYPE;
  }
}
