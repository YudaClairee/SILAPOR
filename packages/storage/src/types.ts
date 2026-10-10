// Attachment storage port (Task 3).
//
// Implemented here by the filesystem adapter (`filesystem.ts`). A future
// S3-compatible adapter (MinIO, then R2) will implement this same interface,
// so callers never depend on a concrete backend. No SDK imports.

export interface AttachmentPutResult {
  readonly key: string;
  readonly size: number;
  readonly checksum: string;
}

export interface AttachmentData {
  readonly bytes: Uint8Array;
  readonly contentType: string;
}

export interface AttachmentStorage {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<AttachmentPutResult>;
  get(key: string): Promise<AttachmentData | null>;
  remove(key: string): Promise<void>;
}
