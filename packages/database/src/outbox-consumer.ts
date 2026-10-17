// Outbox consumer core (Phase 6 P6-4): claim → process → DISPATCHED atomically.
//
// Runs in the worker process (apps/worker owns the poll loop; this module owns
// the semantics so they are integration-testable without the loop).
//
// Claim: `status = 'PENDING' AND available_at <= now AND type <>
// 'AI_REVIEW_REQUESTED'` — AI jobs stay PENDING for the Phase 8 consumer
// (ledger ruling). Each claimed row is re-read with FOR UPDATE inside its own
// transaction, processed (currently WORKFLOW_NOTIFICATION → notifications),
// and marked DISPATCHED + processed_at in that SAME transaction, so a crash
// can never dispatch without delivering. Redelivery after commit is absorbed
// by the notifications unique constraint (P6-3).
//
// Failure policy (ledger ruling): a permanent AppError (status < 500, e.g.
// malformed payload, missing report) fails the row immediately (dead-letter);
// anything else retries with 2^n-second backoff and goes FAILED once
// attempt_count reaches MAX_OUTBOX_ATTEMPTS. `last_error` stores a redacted,
// truncated error message — never PII, tokens, or stack traces.
//
// This module logs nothing; the worker logs batch summaries.

import { and, asc, eq, lte, ne, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { isAppError, redact } from '@silapor/shared';
import * as schema from './schema.js';
import { processNotificationOutboxEvent } from './notifications.js';

type Database = PostgresJsDatabase<typeof schema>;
// Claim exclusion: AI rows are Phase 8 scope and must stay PENDING. Unknown
// future types ARE claimed and dead-letter via the retry policy — a stuck row
// becomes observable instead of rotting silently.
export const RESERVED_OUTBOX_TYPES = ['AI_REVIEW_REQUESTED'] as const;

// Dead-letter threshold (decision §7 / plan step 12: max 3 attempts).
export const MAX_OUTBOX_ATTEMPTS = 3 as const;

// 2^attempt seconds: after failure 1 → 2s, failure 2 → 4s.
export function backoffSecondsForAttempt(attemptCount: number): number {
  const attempt = Math.max(1, Math.floor(attemptCount));
  return 2 ** attempt;
}

// Redacted, bounded last_error payload for dead-letter diagnostics.
export function describeOutboxError(error: unknown): string {
  const message =
    error instanceof Error ? error.message : typeof error === 'string' ? error : 'unknown error';
  const safe = redact(message);
  return safe.length > 500 ? `${safe.slice(0, 497)}...` : safe;
}

// Permanent (4xx-class) errors never succeed on retry — dead-letter now.
export function isPermanentFailure(error: unknown): boolean {
  return isAppError(error) && error.status < 500;
}

export interface OutboxBatchResult {
  readonly dispatched: number;
  readonly failed: number;
  readonly retried: number;
  /** Claim-listed rows that were already handled by another worker. */
  readonly skipped: number;
}

export interface OutboxBatchOptions {
  readonly limit?: number | undefined;
}

export async function processOutboxBatch(
  db: Database,
  options?: OutboxBatchOptions,
): Promise<OutboxBatchResult> {
  const limit = Math.max(1, Math.min(Math.floor(options?.limit ?? 20), 100));
  const candidates = await db
    .select({ id: schema.outboxEvents.id })
    .from(schema.outboxEvents)
    .where(
      and(
        eq(schema.outboxEvents.status, 'PENDING'),
        lte(schema.outboxEvents.availableAt, sql`now()`),
        ne(schema.outboxEvents.type, 'AI_REVIEW_REQUESTED'),
      ),
    )
    .orderBy(asc(schema.outboxEvents.createdAt))
    .limit(limit);

  let dispatched = 0;
  let failed = 0;
  let retried = 0;
  let skipped = 0;
  for (const candidate of candidates) {
    const outcome = await processOutboxRow(db, candidate.id);
    if (outcome === 'dispatched') {
      dispatched += 1;
    } else if (outcome === 'failed') {
      failed += 1;
    } else if (outcome === 'retried') {
      retried += 1;
    } else {
      skipped += 1;
    }
  }
  return { dispatched, failed, retried, skipped };
}

type RowOutcome = 'dispatched' | 'failed' | 'retried' | 'skipped';

export async function processOutboxRow(db: Database, outboxEventId: string): Promise<RowOutcome> {
  let handled = false;
  try {
    await db.transaction(async (tx) => {
      // FOR UPDATE claim re-check: only one worker can take a PENDING row.
      const rows = await tx
        .select()
        .from(schema.outboxEvents)
        .where(eq(schema.outboxEvents.id, outboxEventId))
        .for('update');
      const row = rows[0];
      if (row === undefined || row.status !== 'PENDING') {
        return; // Lost the race or already handled — nothing to do.
      }
      if (row.type === 'WORKFLOW_NOTIFICATION') {
        await processNotificationOutboxEvent(tx, row.id);
      } else {
        throw new Error(`Outbox event type not consumed by this worker: ${row.type}`);
      }
      await tx
        .update(schema.outboxEvents)
        .set({ status: 'DISPATCHED', processedAt: new Date(), lastError: null })
        .where(and(eq(schema.outboxEvents.id, row.id), eq(schema.outboxEvents.status, 'PENDING')));
      handled = true;
    });
    return handled ? 'dispatched' : 'skipped';
  } catch (error) {
    return await markOutboxFailure(db, outboxEventId, error);
  }
}

async function markOutboxFailure(
  db: Database,
  outboxEventId: string,
  error: unknown,
): Promise<RowOutcome> {
  const lastError = describeOutboxError(error);
  const rows = await db
    .select({ attemptCount: schema.outboxEvents.attemptCount })
    .from(schema.outboxEvents)
    .where(eq(schema.outboxEvents.id, outboxEventId));
  const current = rows[0]?.attemptCount ?? 0;
  const nextAttempt = current + 1;
  const terminal = isPermanentFailure(error) || nextAttempt >= MAX_OUTBOX_ATTEMPTS;
  await db
    .update(schema.outboxEvents)
    .set({
      attemptCount: nextAttempt,
      status: terminal ? 'FAILED' : 'PENDING',
      availableAt: new Date(Date.now() + backoffSecondsForAttempt(nextAttempt) * 1000),
      lastError,
    })
    .where(eq(schema.outboxEvents.id, outboxEventId));
  return terminal ? 'failed' : 'retried';
}
