// Report attachment repository (Phase 4 P4-3).
//
// `createAttachments` inserts `report_attachments` rows plus ONE
// `report_events` row (`ATTACHMENT_ADDED`) in a SINGLE transaction, so a
// mid-write failure leaves zero rows and zero events (no partial uploads at
// the DB layer either). Read helpers project WITHOUT `storageKey` except
// `getAttachmentById`, which the authorized download service needs to fetch
// bytes — callers must never return that field to clients.
//
// The `report_attachments` table + `report_id` index already exist from
// P3-1: this module adds no migration (proven in `attachments.test.ts`).
//
// Errors use `AppError` from `@silapor/shared` (400 validation, 404 missing
// parent, 500 residual) with no PII. This module logs nothing.

import { asc, count, eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { badRequest, internal, isAppError, notFound } from '@silapor/shared';
import * as schema from './schema.js';
import { isForeignKeyViolation, type ReportQueryDb } from './reports.js';

type Database = PostgresJsDatabase<typeof schema>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface CreateAttachmentFileInput {
  readonly storageKey: string;
  readonly originalFilename: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly checksum: string;
}

export interface CreateAttachmentsInput {
  readonly reportId: string;
  readonly files: readonly CreateAttachmentFileInput[];
  readonly uploadedBy: string;
}

// Client-safe projection: id, display metadata, integrity fields — NEVER
// `storageKey`.
export interface AttachmentSummary {
  readonly id: string;
  readonly originalFilename: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly checksum: string;
  readonly createdAt: Date;
}

// Service-internal row: the summary plus the opaque `storageKey` (for the
// storage fetch) and the parent report's `reporterId` + `status` (for
// ownership + terminal checks). Never serialized to clients as-is.
export interface AttachmentWithReport extends AttachmentSummary {
  readonly storageKey: string;
  readonly reportId: string;
  readonly reporterId: string;
  readonly status: string;
}

// Minimal ownership/status projection for the upload/download guards.
export interface ReportHeader {
  readonly id: string;
  readonly reporterId: string;
  readonly status: string;
}

function requireUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    throw badRequest(`${field} must be a valid UUID`);
  }
  return value;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

// Shape-only file check (content validation is P4-1, enforced by the
// service before this repo is reached). Throws 400 before any I/O.
function validateFileInput(file: unknown): CreateAttachmentFileInput {
  if (typeof file !== 'object' || file === null) {
    throw badRequest('Invalid attachment input');
  }
  const record = file as Record<string, unknown>;
  const storageKey = record['storageKey'];
  const originalFilename = record['originalFilename'];
  const mimeType = record['mimeType'];
  const checksum = record['checksum'];
  const sizeBytes = record['sizeBytes'];
  if (
    !isNonEmptyString(storageKey) ||
    !isNonEmptyString(originalFilename) ||
    !isNonEmptyString(mimeType) ||
    !isNonEmptyString(checksum)
  ) {
    throw badRequest('Invalid attachment input');
  }
  if (typeof sizeBytes !== 'number' || !Number.isInteger(sizeBytes) || sizeBytes <= 0) {
    throw badRequest('Invalid attachment input');
  }
  return { storageKey, originalFilename, mimeType, sizeBytes, checksum };
}

export async function createAttachments(
  db: Database,
  input: CreateAttachmentsInput,
): Promise<AttachmentSummary[]> {
  if (typeof input !== 'object' || input === null) {
    throw badRequest('Invalid attachment input');
  }
  const reportId = requireUuid(input.reportId, 'reportId');
  const uploadedBy = requireUuid(input.uploadedBy, 'uploadedBy');
  if (!Array.isArray(input.files) || input.files.length === 0) {
    throw badRequest('At least one file is required.');
  }
  const files = input.files.map(validateFileInput);

  try {
    return await db.transaction(async (tx) => {
      const inserted = await tx
        .insert(schema.reportAttachments)
        .values(
          files.map((file) => ({
            reportId,
            storageKey: file.storageKey,
            originalFilename: file.originalFilename,
            mimeType: file.mimeType,
            sizeBytes: file.sizeBytes,
            checksum: file.checksum,
            uploadedBy,
          })),
        )
        .returning({
          id: schema.reportAttachments.id,
          originalFilename: schema.reportAttachments.originalFilename,
          mimeType: schema.reportAttachments.mimeType,
          sizeBytes: schema.reportAttachments.sizeBytes,
          checksum: schema.reportAttachments.checksum,
          createdAt: schema.reportAttachments.createdAt,
        });
      await tx.insert(schema.reportEvents).values({
        reportId,
        eventType: 'ATTACHMENT_ADDED',
        actorId: uploadedBy,
        metadata: { attachmentIds: inserted.map((row) => row.id), count: inserted.length },
      });
      return inserted;
    });
  } catch (error) {
    // Same residual mapping as `createReport`: a parent deleted mid-write
    // surfaces as 404, never as a raw driver error (SQL/PII leak risk).
    if (isAppError(error)) {
      throw error;
    }
    if (isForeignKeyViolation(error)) {
      throw notFound('Report not found');
    }
    throw internal('Failed to create attachments');
  }
}

// Chronological per-report listing without `storageKey`.
export async function listAttachments(
  db: ReportQueryDb,
  reportId: string,
): Promise<AttachmentSummary[]> {
  const id = requireUuid(reportId, 'reportId');
  return await db
    .select({
      id: schema.reportAttachments.id,
      originalFilename: schema.reportAttachments.originalFilename,
      mimeType: schema.reportAttachments.mimeType,
      sizeBytes: schema.reportAttachments.sizeBytes,
      checksum: schema.reportAttachments.checksum,
      createdAt: schema.reportAttachments.createdAt,
    })
    .from(schema.reportAttachments)
    .where(eq(schema.reportAttachments.reportId, id))
    .orderBy(asc(schema.reportAttachments.createdAt), asc(schema.reportAttachments.id));
}

// Single attachment plus its parent report's `reporterId` + `status` in one
// join. `null` when the attachment does not exist (callers map to 404).
export async function getAttachmentById(
  db: ReportQueryDb,
  id: string,
): Promise<AttachmentWithReport | null> {
  const attachmentId = requireUuid(id, 'attachmentId');
  const rows = await db
    .select({
      id: schema.reportAttachments.id,
      storageKey: schema.reportAttachments.storageKey,
      originalFilename: schema.reportAttachments.originalFilename,
      mimeType: schema.reportAttachments.mimeType,
      sizeBytes: schema.reportAttachments.sizeBytes,
      checksum: schema.reportAttachments.checksum,
      createdAt: schema.reportAttachments.createdAt,
      reportId: schema.reportAttachments.reportId,
      reporterId: schema.maintenanceReports.reporterId,
      status: schema.maintenanceReports.status,
    })
    .from(schema.reportAttachments)
    .innerJoin(
      schema.maintenanceReports,
      eq(schema.reportAttachments.reportId, schema.maintenanceReports.id),
    )
    .where(eq(schema.reportAttachments.id, attachmentId));
  const row = rows[0];
  return row ?? null;
}

export async function countAttachments(db: ReportQueryDb, reportId: string): Promise<number> {
  const id = requireUuid(reportId, 'reportId');
  const rows = await db
    .select({ value: count() })
    .from(schema.reportAttachments)
    .where(eq(schema.reportAttachments.reportId, id));
  return rows[0]?.value ?? 0;
}

// Ownership/status projection for the upload/download guards. `null` when
// the report does not exist (callers map to the identical 404).
export async function getReportHeader(
  db: ReportQueryDb,
  reportId: string,
): Promise<ReportHeader | null> {
  const id = requireUuid(reportId, 'reportId');
  const rows = await db
    .select({
      id: schema.maintenanceReports.id,
      reporterId: schema.maintenanceReports.reporterId,
      status: schema.maintenanceReports.status,
    })
    .from(schema.maintenanceReports)
    .where(eq(schema.maintenanceReports.id, id));
  const row = rows[0];
  if (row === undefined) {
    return null;
  }
  return { id: row.id, reporterId: row.reporterId, status: row.status };
}
