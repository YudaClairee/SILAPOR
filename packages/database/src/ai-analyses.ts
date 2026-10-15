// ai_analyses persistence (Task 4 AI verification).
//
// `recordAiAnalysis` inserts a PENDING row for a report (model +
// prompt/schema versions required); `markAiAnalysis` moves the row to a new
// status with the verifier-supplied verdict fields. Raw prompt/response are
// never stored — the table has no such columns by design.
//
// Column names follow EXECUTION-PLAN §7.1 verbatim, plus the brief's
// `category` / `issue_type` / `priority` verdict fields (the AI-decided
// finals exercised by the Task 4 test and consumed by future Tasks 5/6).
// Canonical priority column is `suggested_priority` (plan §7.1 authority);
// `priority` is a legacy mirror written atomically with it (and pinned by a
// DB CHECK so the pair can never diverge, however the row is written).
// Likewise `verdict` → `verification_recommendation` and
// `reason` → `reasoning_summary` are input aliases for the canonical
// columns. `markAiAnalysis` accepts `priority` (brief) or `suggestedPriority`
// (plan) — `priority` wins when both are given — and writes the one decision
// to both columns. Taxonomy validation (master-list codes, DANGEROUS floor) lives
// in the verifier (Task 5), not here — values are stored verbatim.
//
// `completedAt` is set on the FIRST terminal mark (SUCCEEDED/FAILED) and
// preserved on later terminal re-marks (COALESCE-style: existing ?? now),
// so re-marking never rewrites the original completion time; reopening to
// PENDING/PROCESSING clears it, so only terminal marks carry a time.
// `attemptCount` is explicit (record defaults 0,
// mark sets it only when provided) — retry policy lives with the caller.
//
// Errors use `AppError` from `@silapor/shared` (400 validation, 404
// missing). This module logs nothing and carries no PII in messages.

import { eq } from 'drizzle-orm';
import { badRequest, internal, isAppError, notFound } from '@silapor/shared';
import * as schema from './schema.js';
import { isForeignKeyViolation, type ReportQueryDb } from './reports.js';

export const AI_ANALYSIS_STATUS = ['PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED'] as const;

export type AiAnalysisStatus = (typeof AI_ANALYSIS_STATUS)[number];

const AI_ANALYSIS_STATUS_SET: ReadonlySet<string> = new Set(AI_ANALYSIS_STATUS);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface RecordAiAnalysisInput {
  readonly reportId: string;
  readonly model: string;
  readonly promptVersion: string;
  readonly schemaVersion: string;
  readonly gateway?: string | undefined;
  readonly privacyMode?: string | undefined;
  readonly attemptCount?: number | undefined;
}

export interface MarkAiAnalysisOutcome {
  readonly status: AiAnalysisStatus;
  readonly verdict?: string | null | undefined;
  readonly category?: string | null | undefined;
  readonly issueType?: string | null | undefined;
  readonly priority?: string | null | undefined;
  readonly suggestedPriority?: string | null | undefined;
  readonly confidence?: number | null | undefined;
  readonly reason?: string | null | undefined;
  // NOT NULL columns: provided values must be non-empty strings; null is
  // rejected (400) since clearing them would violate the constraint.
  readonly model?: string | undefined;
  readonly promptVersion?: string | undefined;
  readonly schemaVersion?: string | undefined;
  readonly gateway?: string | undefined;
  readonly upstreamProvider?: string | null | undefined;
  readonly gatewayRequestId?: string | null | undefined;
  readonly privacyMode?: string | undefined;
  readonly inputTokens?: number | null | undefined;
  readonly outputTokens?: number | null | undefined;
  readonly estimatedCost?: number | null | undefined;
  readonly possibleDuplicate?: boolean | null | undefined;
  readonly riskFactors?: unknown;
  readonly impactFactors?: unknown;
  readonly attemptCount?: number | undefined;
  readonly errorCode?: string | null | undefined;
}

function requireUuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    throw badRequest(`${field} must be a valid UUID`);
  }
  return value;
}

function requireNonEmpty(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw badRequest(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function optionalText(value: unknown, field: string): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw badRequest(`${field} must be a string or null`);
  }
  return value;
}

function optionalCount(value: unknown, field: string): number | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw badRequest(`${field} must be a non-negative integer or null`);
  }
  return value;
}

function optionalNumber(value: unknown, field: string): number | null | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw badRequest(`${field} must be a finite number or null`);
  }
  return value;
}

// NOT NULL text columns: undefined leaves the value, anything else must be
// a non-empty string (runtime null/blank is 400 — clearing them would
// violate the constraint).
function providedString(value: unknown, field: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string' || value.trim() === '') {
    throw badRequest(`${field} must be a non-empty string`);
  }
  return value.trim();
}

// Inserts a PENDING analysis row for an existing report. The referenced
// report is checked first so an unknown reportId is a deterministic 404
// (residual FK failures still map to 404, never raw).
export async function recordAiAnalysis(
  db: ReportQueryDb,
  input: RecordAiAnalysisInput,
): Promise<schema.AiAnalysis> {
  if (typeof input !== 'object' || input === null) {
    throw badRequest('Invalid AI analysis input');
  }
  const reportId = requireUuid(input.reportId, 'reportId');
  const model = requireNonEmpty(input.model, 'model');
  const promptVersion = requireNonEmpty(input.promptVersion, 'promptVersion');
  const schemaVersion = requireNonEmpty(input.schemaVersion, 'schemaVersion');
  const gateway = input.gateway === undefined ? undefined : requireNonEmpty(input.gateway, 'gateway');
  const privacyMode =
    input.privacyMode === undefined ? undefined : requireNonEmpty(input.privacyMode, 'privacyMode');
  if (
    input.attemptCount !== undefined &&
    (typeof input.attemptCount !== 'number' ||
      !Number.isInteger(input.attemptCount) ||
      input.attemptCount < 0)
  ) {
    throw badRequest('attemptCount must be a non-negative integer');
  }

  const report = (
    await db
      .select({ id: schema.maintenanceReports.id })
      .from(schema.maintenanceReports)
      .where(eq(schema.maintenanceReports.id, reportId))
  )[0];
  if (report === undefined) {
    throw notFound('Report not found');
  }

  try {
    const inserted = await db
      .insert(schema.aiAnalyses)
      .values({
        reportId,
        status: 'PENDING',
        model,
        promptVersion,
        schemaVersion,
        ...(gateway === undefined ? {} : { gateway }),
        ...(privacyMode === undefined ? {} : { privacyMode }),
        ...(input.attemptCount === undefined ? {} : { attemptCount: input.attemptCount }),
      })
      .returning();
    const row = inserted[0];
    if (row === undefined) {
      throw internal('Failed to record AI analysis');
    }
    return row;
  } catch (error) {
    if (isAppError(error)) {
      throw error;
    }
    if (isForeignKeyViolation(error)) {
      throw notFound('Report not found');
    }
    throw internal('Failed to record AI analysis');
  }
}

// Moves an analysis row to a new status with the supplied verdict fields.
// Only provided fields are written (undefined = leave, null = clear).
// Unknown ids are 404; unknown statuses are 400 before any write.
export async function markAiAnalysis(
  db: ReportQueryDb,
  id: string,
  outcome: MarkAiAnalysisOutcome,
): Promise<schema.AiAnalysis> {
  const analysisId = requireUuid(id, 'id');
  if (typeof outcome !== 'object' || outcome === null) {
    throw badRequest('Invalid AI analysis outcome');
  }
  if (typeof outcome.status !== 'string' || !AI_ANALYSIS_STATUS_SET.has(outcome.status)) {
    throw badRequest('Invalid AI analysis status');
  }
  const status = outcome.status as AiAnalysisStatus;

  const verificationRecommendation = optionalText(outcome.verdict, 'verdict');
  const category = optionalText(outcome.category, 'category');
  const issueType = optionalText(outcome.issueType, 'issueType');
  // Single decision, two names: `priority` (brief) wins over
  // `suggestedPriority` (plan) when both are provided.
  const priorityRaw = outcome.priority !== undefined ? outcome.priority : outcome.suggestedPriority;
  const priority = optionalText(priorityRaw, 'priority');
  const confidence = optionalNumber(outcome.confidence, 'confidence');
  const reasoningSummary = optionalText(outcome.reason, 'reason');
  const model = providedString(outcome.model, 'model');
  const markPromptVersion = providedString(outcome.promptVersion, 'promptVersion');
  const markSchemaVersion = providedString(outcome.schemaVersion, 'schemaVersion');
  const gateway = providedString(outcome.gateway, 'gateway');
  const upstreamProvider = optionalText(outcome.upstreamProvider, 'upstreamProvider');
  const gatewayRequestId = optionalText(outcome.gatewayRequestId, 'gatewayRequestId');
  const privacyMode = providedString(outcome.privacyMode, 'privacyMode');
  const inputTokens = optionalCount(outcome.inputTokens, 'inputTokens');
  const outputTokens = optionalCount(outcome.outputTokens, 'outputTokens');
  const estimatedCost = optionalNumber(outcome.estimatedCost, 'estimatedCost');
  // attempt_count is NOT NULL: undefined leaves it, anything else must be a
  // non-negative integer (runtime null is 400).
  const attemptCount = outcome.attemptCount;
  if (
    attemptCount !== undefined &&
    (typeof attemptCount !== 'number' ||
      !Number.isInteger(attemptCount) ||
      attemptCount < 0)
  ) {
    throw badRequest('attemptCount must be a non-negative integer');
  }
  const errorCode = optionalText(outcome.errorCode, 'errorCode');
  let possibleDuplicate: boolean | null | undefined;
  if (outcome.possibleDuplicate !== undefined) {
    if (outcome.possibleDuplicate !== null && typeof outcome.possibleDuplicate !== 'boolean') {
      throw badRequest('possibleDuplicate must be a boolean or null');
    }
    possibleDuplicate = outcome.possibleDuplicate;
  }

  const patch: Partial<schema.NewAiAnalysis> = { status };
  if (verificationRecommendation !== undefined) {
    patch.verificationRecommendation = verificationRecommendation;
  }
  if (category !== undefined) {
    patch.category = category;
  }
  if (issueType !== undefined) {
    patch.issueType = issueType;
  }
  if (priority !== undefined) {
    // Canonical column is `suggested_priority` (plan §7.1 authority); `priority` is a legacy mirror written atomically with it (divergence also blocked by DB CHECK).
    patch.priority = priority;
    patch.suggestedPriority = priority;
  }
  if (confidence !== undefined) {
    patch.confidence = confidence;
  }
  if (reasoningSummary !== undefined) {
    patch.reasoningSummary = reasoningSummary;
  }
  if (model !== undefined) {
    patch.model = model;
  }
  if (markPromptVersion !== undefined) {
    patch.promptVersion = markPromptVersion;
  }
  if (markSchemaVersion !== undefined) {
    patch.schemaVersion = markSchemaVersion;
  }
  if (gateway !== undefined) {
    patch.gateway = gateway;
  }
  if (upstreamProvider !== undefined) {
    patch.upstreamProvider = upstreamProvider;
  }
  if (gatewayRequestId !== undefined) {
    patch.gatewayRequestId = gatewayRequestId;
  }
  if (privacyMode !== undefined) {
    patch.privacyMode = privacyMode;
  }
  if (inputTokens !== undefined) {
    patch.inputTokens = inputTokens;
  }
  if (outputTokens !== undefined) {
    patch.outputTokens = outputTokens;
  }
  if (estimatedCost !== undefined) {
    patch.estimatedCost = estimatedCost;
  }
  if (possibleDuplicate !== undefined) {
    patch.possibleDuplicate = possibleDuplicate;
  }
  // `riskFactors`/`impactFactors` are a verbatim-store contract: no shape
  // validation here, values are written to JSONB exactly as supplied
  // (undefined = leave, anything else including null overwrites).
  if (outcome.riskFactors !== undefined) {
    patch.riskFactors = outcome.riskFactors as schema.NewAiAnalysis['riskFactors'];
  }
  if (outcome.impactFactors !== undefined) {
    patch.impactFactors = outcome.impactFactors as schema.NewAiAnalysis['impactFactors'];
  }
  if (attemptCount !== undefined) {
    patch.attemptCount = attemptCount;
  }
  if (errorCode !== undefined) {
    patch.errorCode = errorCode;
  }
  // Preserve-first completion time (COALESCE-style: existing ?? now):
  // the first terminal mark stamps `completedAt` and later terminal
  // re-marks keep it; reopening to a live status clears it.
  if (status === 'SUCCEEDED' || status === 'FAILED') {
    const existing = (
      await db
        .select({ completedAt: schema.aiAnalyses.completedAt })
        .from(schema.aiAnalyses)
        .where(eq(schema.aiAnalyses.id, analysisId))
    )[0];
    if (existing === undefined) {
      throw notFound('AI analysis not found');
    }
    patch.completedAt = existing.completedAt ?? new Date();
  } else {
    patch.completedAt = null;
  }

  try {
    const updated = await db
      .update(schema.aiAnalyses)
      .set(patch)
      .where(eq(schema.aiAnalyses.id, analysisId))
      .returning();
    const row = updated[0];
    if (row === undefined) {
      throw notFound('AI analysis not found');
    }
    return row;
  } catch (error) {
    if (isAppError(error)) {
      throw error;
    }
    if (isForeignKeyViolation(error)) {
      throw notFound('Referenced record not found');
    }
    throw internal('Failed to mark AI analysis');
  }
}
