// @silapor/storage: attachment port + filesystem adapter (Task 3).
// The S3-compatible (MinIO/R2) adapter lands later and implements the same
// AttachmentStorage interface.
export * from './types';
export * from './filesystem';
export * from './attachments';
export * from './s3';
export * from './factory';
export * from './list';
